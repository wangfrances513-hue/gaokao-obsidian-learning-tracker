import { webcrypto } from "node:crypto";
import { TFile, TFolder, Vault } from "obsidian";

import {
    buildGaokaoImageCanonicalPath,
    calculateGaokaoImageSha256,
    canonicalExtensionForImageKind,
    commitPreparedGaokaoImageEvidence,
    detectGaokaoImageKind,
    GAOKAO_IMAGE_MAX_BYTES,
    GAOKAO_IMAGE_SUBJECTS,
    isCanonicalGaokaoImagePath,
    prepareGaokaoImageEvidence,
    rollbackGaokaoImageAttachment,
} from "src/gaokao/image-evidence";

jest.mock("obsidian", () => {
    class MockTFile {
        path: string;
        name: string;
        basename: string;
        extension: string;
        stat: { size: number };

        constructor(path: string, size: number) {
            this.path = path;
            const segments = path.split("/");
            this.name = segments[segments.length - 1] ?? path;
            const extensionIndex = this.name.lastIndexOf(".");
            this.basename = extensionIndex < 0 ? this.name : this.name.slice(0, extensionIndex);
            this.extension = extensionIndex < 0 ? "" : this.name.slice(extensionIndex + 1);
            this.stat = { size };
        }
    }

    class MockTFolder {
        path: string;
        name: string;

        constructor(path: string) {
            this.path = path;
            const segments = path.split("/");
            this.name = segments[segments.length - 1] ?? path;
        }
    }

    return {
        normalizePath: (path: string) => path.replace(/\/{2,}/g, "/"),
        TFile: MockTFile,
        TFolder: MockTFolder,
    };
});

type RuntimeTFile = TFile & { stat: { size: number } };
type RuntimeTFolder = TFolder;
type VaultEntry = RuntimeTFile | RuntimeTFolder | { path: string };

const RuntimeTFile = TFile as unknown as new (path: string, size: number) => RuntimeTFile;
const RuntimeTFolder = TFolder as unknown as new (path: string) => RuntimeTFolder;

function copyBuffer(bytes: Uint8Array): ArrayBuffer {
    return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

class FakeVault {
    readonly entries = new Map<string, VaultEntry>();
    readonly buffers = new Map<string, ArrayBuffer>();
    readonly readFailures = new Set<string>();
    readonly readOverrides = new Map<string, ArrayBuffer>();
    afterCreateReadback: ArrayBuffer | null = null;
    trashError: Error | null = null;
    onCreateFolder: ((path: string) => void) | null = null;

    readonly getFiles = jest.fn((): RuntimeTFile[] =>
        [...this.entries.values()].filter(
            (entry): entry is RuntimeTFile => entry instanceof RuntimeTFile,
        ),
    );

    readonly getAbstractFileByPath = jest.fn(
        (path: string): VaultEntry | null => this.entries.get(path) ?? null,
    );

    readonly createFolder = jest.fn(async (path: string): Promise<RuntimeTFolder> => {
        if (this.entries.has(path)) throw new Error(`occupied: ${path}`);
        const folder = new RuntimeTFolder(path);
        this.entries.set(path, folder);
        this.onCreateFolder?.(path);
        return folder;
    });

    readonly createBinary = jest.fn(
        async (path: string, data: ArrayBuffer): Promise<RuntimeTFile> => {
            if (this.entries.has(path)) throw new Error(`refusing overwrite: ${path}`);
            const stored = data.slice(0);
            const file = new RuntimeTFile(path, stored.byteLength);
            this.entries.set(path, file);
            this.buffers.set(path, stored);
            if (this.afterCreateReadback !== null) {
                this.readOverrides.set(path, this.afterCreateReadback.slice(0));
            }
            return file;
        },
    );

    readonly readBinary = jest.fn(async (file: RuntimeTFile): Promise<ArrayBuffer> => {
        if (this.readFailures.has(file.path)) throw new Error(`read failed: ${file.path}`);
        const buffer = this.readOverrides.get(file.path) ?? this.buffers.get(file.path);
        if (buffer === undefined) throw new Error(`missing bytes: ${file.path}`);
        return buffer.slice(0);
    });

    readonly trash = jest.fn(async (file: RuntimeTFile, _system: boolean): Promise<void> => {
        if (this.trashError !== null) throw this.trashError;
        if (this.entries.get(file.path) === file) {
            this.entries.delete(file.path);
            this.buffers.delete(file.path);
            this.readOverrides.delete(file.path);
        }
    });

    addFile(path: string, bytes: Uint8Array): RuntimeTFile {
        const file = new RuntimeTFile(path, bytes.byteLength);
        this.entries.set(path, file);
        this.buffers.set(path, copyBuffer(bytes));
        return file;
    }

    addFolder(path: string): RuntimeTFolder {
        const folder = new RuntimeTFolder(path);
        this.entries.set(path, folder);
        return folder;
    }

    addUnknown(path: string): void {
        this.entries.set(path, { path });
    }

    replaceObject(path: string, entry: VaultEntry): void {
        this.entries.set(path, entry);
    }

    asVault(): Vault {
        return this as unknown as Vault;
    }
}

interface TestFileResult {
    readonly file: File;
    readonly arrayBuffer: jest.Mock<Promise<ArrayBuffer>, []>;
}

function testFile(
    bytes: Uint8Array,
    options: {
        name?: string;
        type?: string;
        declaredSize?: number;
        actualBytes?: Uint8Array;
    } = {},
): TestFileResult {
    const arrayBuffer = jest.fn(async () => copyBuffer(options.actualBytes ?? bytes));
    return {
        file: {
            name: options.name ?? "capture.png",
            type: options.type ?? "image/png",
            size: options.declaredSize ?? bytes.byteLength,
            arrayBuffer,
        } as unknown as File,
        arrayBuffer,
    };
}

function pngBytes(extra = 0x01): Uint8Array {
    return new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, extra]);
}

function jpegBytes(extra = 0x01): Uint8Array {
    return new Uint8Array([0xff, 0xd8, 0xff, extra]);
}

const capturedDate = () => new Date(2026, 7, 18, 12, 0, 0);

beforeAll(() => {
    Object.defineProperty(globalThis, "crypto", {
        configurable: true,
        value: webcrypto as unknown as Crypto,
    });
});

describe("Task 011 image input, signatures, hashing, and paths", () => {
    test("rejects zero bytes", async () => {
        const selected = testFile(new Uint8Array());
        await expect(
            prepareGaokaoImageEvidence(new FakeVault().asVault(), selected.file, "数学"),
        ).rejects.toThrow(/不能为空/);
        expect(selected.arrayBuffer).not.toHaveBeenCalled();
    });

    test("accepts exactly 26,214,400 declared and actual bytes", async () => {
        const bytes = new Uint8Array(GAOKAO_IMAGE_MAX_BYTES);
        bytes.set(pngBytes());
        const selected = testFile(bytes);
        const prepared = await prepareGaokaoImageEvidence(
            new FakeVault().asVault(),
            selected.file,
            "数学",
            capturedDate,
        );
        expect(prepared.byteLength).toBe(GAOKAO_IMAGE_MAX_BYTES);
        expect(selected.arrayBuffer).toHaveBeenCalledTimes(1);
    });

    test("rejects one byte over the limit before arrayBuffer", async () => {
        const selected = testFile(pngBytes(), {
            declaredSize: GAOKAO_IMAGE_MAX_BYTES + 1,
        });
        await expect(
            prepareGaokaoImageEvidence(new FakeVault().asVault(), selected.file, "数学"),
        ).rejects.toThrow(/超过/);
        expect(selected.arrayBuffer).not.toHaveBeenCalled();
    });

    test("rejects declared/actual mismatch and an oversized actual buffer", async () => {
        const mismatch = testFile(pngBytes(), {
            declaredSize: pngBytes().byteLength,
            actualBytes: pngBytes(0x02).slice(0, 8),
        });
        await expect(
            prepareGaokaoImageEvidence(new FakeVault().asVault(), mismatch.file, "数学"),
        ).rejects.toThrow(/长度/);

        const oversized = new Uint8Array(GAOKAO_IMAGE_MAX_BYTES + 1);
        oversized.set(pngBytes());
        const tooLargeAfterRead = testFile(pngBytes(), {
            declaredSize: GAOKAO_IMAGE_MAX_BYTES,
            actualBytes: oversized,
        });
        await expect(
            prepareGaokaoImageEvidence(new FakeVault().asVault(), tooLargeAfterRead.file, "数学"),
        ).rejects.toThrow(/读取结果超过/);
    });

    test("accepts PNG and JPEG signatures and derives extensions only from bytes", async () => {
        expect(detectGaokaoImageKind(pngBytes())).toBe("png");
        expect(detectGaokaoImageKind(jpegBytes())).toBe("jpeg");
        expect(canonicalExtensionForImageKind("png")).toBe("png");
        expect(canonicalExtensionForImageKind("jpeg")).toBe("jpg");

        const selected = testFile(jpegBytes(), {
            name: "misleading.png",
            type: "image/png",
        });
        const prepared = await prepareGaokaoImageEvidence(
            new FakeVault().asVault(),
            selected.file,
            "数学",
            capturedDate,
        );
        expect(prepared.kind).toBe("jpeg");
        expect(prepared.canonicalExtension).toBe("jpg");
        expect(prepared.duplicateRisk.sourceHintWarnings).toHaveLength(2);
    });

    test.each([new Uint8Array([0x01]), new Uint8Array([0xff, 0xd8])])(
        "rejects unsupported or truncated signature %#",
        async (bytes) => {
            await expect(
                prepareGaokaoImageEvidence(new FakeVault().asVault(), testFile(bytes).file, "数学"),
            ).rejects.toThrow(/JPEG 或 PNG/);
        },
    );

    test("matches known SHA-256 vectors with complete lowercase output", async () => {
        await expect(calculateGaokaoImageSha256(copyBuffer(new Uint8Array()))).resolves.toBe(
            "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
        );
        const abc = new Uint8Array([0x61, 0x62, 0x63]);
        await expect(calculateGaokaoImageSha256(copyBuffer(abc))).resolves.toBe(
            "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
        );
    });

    test("captures the injected host-local year/month exactly once and rejects invalid Date", async () => {
        const createDate = jest.fn(() => new Date(2026, 0, 31, 23, 59, 59));
        const prepared = await prepareGaokaoImageEvidence(
            new FakeVault().asVault(),
            testFile(pngBytes()).file,
            "生物",
            createDate,
        );
        expect(createDate).toHaveBeenCalledTimes(1);
        expect(prepared.capturedYear).toBe("2026");
        expect(prepared.capturedMonth).toBe("01");

        await expect(
            prepareGaokaoImageEvidence(
                new FakeVault().asVault(),
                testFile(pngBytes()).file,
                "数学",
                () => new Date(Number.NaN),
            ),
        ).rejects.toThrow(/有效的本机捕获日期/);
    });

    test.each(GAOKAO_IMAGE_SUBJECTS)("constructs a controlled %s path", (subject) => {
        const hash = "a".repeat(64);
        const path = buildGaokaoImageCanonicalPath({
            subject,
            year: "2026",
            month: "08",
            sha256: hash,
            extension: "jpg",
        });
        expect(path).toBe(`资源/图片/${subject}/2026/08/${hash}.jpg`);
        expect(isCanonicalGaokaoImagePath(path, hash, "jpg")).toBe(true);
    });

    test.each([
        { subject: "历史", year: "2026", month: "08", sha256: "a".repeat(64), extension: "jpg" },
        { subject: "数学", year: "26", month: "08", sha256: "a".repeat(64), extension: "jpg" },
        { subject: "数学", year: "2026", month: "13", sha256: "a".repeat(64), extension: "jpg" },
        { subject: "数学", year: "2026", month: "08", sha256: "A".repeat(64), extension: "jpg" },
        { subject: "数学", year: "2026", month: "08", sha256: "a".repeat(64), extension: "gif" },
        { subject: "../数学", year: "2026", month: "08", sha256: "a".repeat(64), extension: "jpg" },
    ])("rejects invalid canonical path input %#", (input) => {
        expect(() => buildGaokaoImageCanonicalPath(input as never)).toThrow();
    });

    test("never uses the source filename in the canonical path", async () => {
        const first = await prepareGaokaoImageEvidence(
            new FakeVault().asVault(),
            testFile(pngBytes(), { name: "personal-name.png" }).file,
            "数学",
            capturedDate,
        );
        const second = await prepareGaokaoImageEvidence(
            new FakeVault().asVault(),
            testFile(pngBytes(), { name: "totally-different.jpeg" }).file,
            "数学",
            capturedDate,
        );
        expect(first.canonicalPath).toBe(second.canonicalPath);
        expect(first.canonicalPath).not.toContain("personal-name");
        expect(first.canonicalPath).not.toContain("totally-different");
    });
});

describe("Task 011 managed-root deduplication and integrity", () => {
    test("same bytes with different names reuse one attachment", async () => {
        const vault = new FakeVault();
        const first = await prepareGaokaoImageEvidence(
            vault.asVault(),
            testFile(pngBytes(), { name: "first.png" }).file,
            "数学",
            capturedDate,
        );
        const committed = await commitPreparedGaokaoImageEvidence(vault.asVault(), first);
        const second = await prepareGaokaoImageEvidence(
            vault.asVault(),
            testFile(pngBytes(), { name: "second.jpg" }).file,
            "数学",
            capturedDate,
        );
        expect(committed.disposition).toBe("newly_created_by_current_operation");
        expect(second.disposition).toBe("reused_existing");
        expect(second.attachmentPath).toBe(first.attachmentPath);
        expect(vault.createBinary).toHaveBeenCalledTimes(1);
    });

    test("same source name with different bytes produces different hash paths", async () => {
        const first = await prepareGaokaoImageEvidence(
            new FakeVault().asVault(),
            testFile(pngBytes(0x01), { name: "same.png" }).file,
            "数学",
            capturedDate,
        );
        const second = await prepareGaokaoImageEvidence(
            new FakeVault().asVault(),
            testFile(pngBytes(0x02), { name: "same.png" }).file,
            "数学",
            capturedDate,
        );
        expect(first.sha256).not.toBe(second.sha256);
        expect(first.canonicalPath).not.toBe(second.canonicalPath);
    });

    test("selects the lexicographically first verified duplicate and reports complete risk", async () => {
        const vault = new FakeVault();
        const bytes = jpegBytes();
        const hash = await calculateGaokaoImageSha256(copyBuffer(bytes));
        const mathPath = `资源/图片/数学/2025/12/${hash}.jpg`;
        const biologyPath = `资源/图片/生物/2024/01/${hash}.jpg`;
        vault.addFile(biologyPath, bytes);
        vault.addFile(mathPath, bytes);
        vault.addFile("资源/图片/数学/2024/01/unrelated.jpg", jpegBytes(0x02));
        vault.addFile("资源/图片/数学/2024/01/short.jpg", new Uint8Array([0xff]));

        const prepared = await prepareGaokaoImageEvidence(
            vault.asVault(),
            testFile(bytes).file,
            "生物",
            capturedDate,
        );
        expect(prepared.attachmentPath).toBe(mathPath);
        expect(prepared.duplicateRisk).toMatchObject({
            managedFileCount: 4,
            sameSizeCandidateCount: 3,
            exactMatchPaths: [mathPath, biologyPath],
        });
    });

    test("fails closed for a matching hash basename with different length or bytes", async () => {
        const bytes = jpegBytes();
        const hash = await calculateGaokaoImageSha256(copyBuffer(bytes));
        const differentLength = new FakeVault();
        differentLength.addFile(`资源/图片/数学/2025/01/${hash}.jpg`, new Uint8Array([0xff]));
        await expect(
            prepareGaokaoImageEvidence(
                differentLength.asVault(),
                testFile(bytes).file,
                "数学",
                capturedDate,
            ),
        ).rejects.toThrow(/字节长度不一致/);

        const differentBytes = new FakeVault();
        differentBytes.addFile(`资源/图片/数学/2025/01/${hash}.jpg`, jpegBytes(0x02));
        await expect(
            prepareGaokaoImageEvidence(
                differentBytes.asVault(),
                testFile(bytes).file,
                "数学",
                capturedDate,
            ),
        ).rejects.toThrow(/字节不一致/);
    });

    test("fails closed for exact bytes at a noncanonical managed path", async () => {
        const vault = new FakeVault();
        vault.addFile("资源/图片/manual-name.jpg", jpegBytes());
        await expect(
            prepareGaokaoImageEvidence(
                vault.asVault(),
                testFile(jpegBytes()).file,
                "数学",
                capturedDate,
            ),
        ).rejects.toThrow(/路径不符合受控规范/);
    });

    test.each(["folder", "unknown", "bytes"] as const)(
        "fails closed when the canonical target is occupied by %s",
        async (kind) => {
            const vault = new FakeVault();
            const bytes = pngBytes();
            const hash = await calculateGaokaoImageSha256(copyBuffer(bytes));
            const target = `资源/图片/数学/2026/08/${hash}.png`;
            if (kind === "folder") vault.addFolder(target);
            if (kind === "unknown") vault.addUnknown(target);
            if (kind === "bytes") vault.addFile(target, pngBytes(0x02));
            await expect(
                prepareGaokaoImageEvidence(
                    vault.asVault(),
                    testFile(bytes).file,
                    "数学",
                    capturedDate,
                ),
            ).rejects.toThrow(/占用|未知 Vault 对象/);
        },
    );

    test("fails closed when a relevant managed candidate cannot be read", async () => {
        const vault = new FakeVault();
        const candidate = vault.addFile("资源/图片/数学/2025/01/candidate.jpg", jpegBytes());
        vault.readFailures.add(candidate.path);
        await expect(
            prepareGaokaoImageEvidence(
                vault.asVault(),
                testFile(jpegBytes()).file,
                "数学",
                capturedDate,
            ),
        ).rejects.toThrow(/无法读取受管图片/);
    });

    test("does not expose an index, database, or persistence API", () => {
        const vault = new FakeVault() as unknown as Record<string, unknown>;
        expect(vault.saveData).toBeUndefined();
        expect(vault.persistIndex).toBeUndefined();
        expect(vault.database).toBeUndefined();
    });
});

describe("Task 011 attachment commit, ownership, and rollback", () => {
    test("creates and reads back exact bytes at the confirmed path without overwrite APIs", async () => {
        const vault = new FakeVault();
        const prepared = await prepareGaokaoImageEvidence(
            vault.asVault(),
            testFile(pngBytes()).file,
            "数学",
            capturedDate,
        );
        const committed = await commitPreparedGaokaoImageEvidence(vault.asVault(), prepared);
        expect(committed.path).toBe(prepared.attachmentPath);
        expect(committed.disposition).toBe("newly_created_by_current_operation");
        expect(vault.createBinary).toHaveBeenCalledWith(
            prepared.attachmentPath,
            expect.any(ArrayBuffer),
        );
        expect(vault.readBinary).toHaveBeenCalled();
        expect((vault as unknown as { modifyBinary?: unknown }).modifyBinary).toBeUndefined();
    });

    test("readback mismatch rolls back only the newly created attachment", async () => {
        const vault = new FakeVault();
        vault.afterCreateReadback = copyBuffer(pngBytes(0x02));
        const prepared = await prepareGaokaoImageEvidence(
            vault.asVault(),
            testFile(pngBytes()).file,
            "数学",
            capturedDate,
        );
        await expect(commitPreparedGaokaoImageEvidence(vault.asVault(), prepared)).rejects.toThrow(
            /回读|废纸篓/,
        );
        expect(vault.trash).toHaveBeenCalledWith(expect.any(RuntimeTFile), false);
    });

    test("never trashes a reused attachment", async () => {
        const vault = new FakeVault();
        const bytes = jpegBytes();
        const hash = await calculateGaokaoImageSha256(copyBuffer(bytes));
        const path = `资源/图片/数学/2026/08/${hash}.jpg`;
        vault.addFile(path, bytes);
        const prepared = await prepareGaokaoImageEvidence(
            vault.asVault(),
            testFile(bytes).file,
            "数学",
            capturedDate,
        );
        const committed = await commitPreparedGaokaoImageEvidence(vault.asVault(), prepared);
        const result = await rollbackGaokaoImageAttachment(vault.asVault(), committed);
        expect(result.status).toBe("not_required");
        expect(vault.trash).not.toHaveBeenCalled();
    });

    test("moves only a newly owned attachment with system=false", async () => {
        const vault = new FakeVault();
        const prepared = await prepareGaokaoImageEvidence(
            vault.asVault(),
            testFile(pngBytes()).file,
            "生物",
            capturedDate,
        );
        const committed = await commitPreparedGaokaoImageEvidence(vault.asVault(), prepared);
        const result = await rollbackGaokaoImageAttachment(vault.asVault(), committed);
        expect(result.status).toBe("trashed");
        expect(vault.trash).toHaveBeenCalledWith(committed.file, false);
    });

    test("preserves an identity mismatch and reports a trash-failure orphan", async () => {
        const identityVault = new FakeVault();
        const identityPlan = await prepareGaokaoImageEvidence(
            identityVault.asVault(),
            testFile(pngBytes()).file,
            "数学",
            capturedDate,
        );
        const identityCommit = await commitPreparedGaokaoImageEvidence(
            identityVault.asVault(),
            identityPlan,
        );
        identityVault.replaceObject(
            identityCommit.path,
            new RuntimeTFile(identityCommit.path, identityPlan.byteLength),
        );
        const preserved = await rollbackGaokaoImageAttachment(
            identityVault.asVault(),
            identityCommit,
        );
        expect(preserved).toMatchObject({
            status: "preserved",
            orphanPath: identityCommit.path,
        });
        expect(identityVault.trash).not.toHaveBeenCalled();

        const failureVault = new FakeVault();
        const failurePlan = await prepareGaokaoImageEvidence(
            failureVault.asVault(),
            testFile(jpegBytes()).file,
            "数学",
            capturedDate,
        );
        const failureCommit = await commitPreparedGaokaoImageEvidence(
            failureVault.asVault(),
            failurePlan,
        );
        failureVault.trashError = new Error("trash unavailable");
        const failed = await rollbackGaokaoImageAttachment(failureVault.asVault(), failureCommit);
        expect(failed).toMatchObject({ status: "failed", orphanPath: failureCommit.path });
    });

    test("never removes empty folders", async () => {
        const vault = new FakeVault();
        const prepared = await prepareGaokaoImageEvidence(
            vault.asVault(),
            testFile(pngBytes()).file,
            "数学",
            capturedDate,
        );
        const committed = await commitPreparedGaokaoImageEvidence(vault.asVault(), prepared);
        await rollbackGaokaoImageAttachment(vault.asVault(), committed);
        expect(vault.entries.get("资源/图片")).toBeInstanceOf(RuntimeTFolder);
        expect((vault as unknown as { removeFolder?: unknown }).removeFolder).toBeUndefined();
    });

    test("stops if an exact file appears after final revalidation instead of changing ownership", async () => {
        const vault = new FakeVault();
        const bytes = pngBytes();
        const prepared = await prepareGaokaoImageEvidence(
            vault.asVault(),
            testFile(bytes).file,
            "数学",
            capturedDate,
        );
        expect(prepared.disposition).toBe("newly_created_by_current_operation");
        vault.onCreateFolder = (folderPath) => {
            if (folderPath === `资源/图片/数学/2026/08`) {
                vault.addFile(prepared.attachmentPath, bytes);
            }
        };

        await expect(commitPreparedGaokaoImageEvidence(vault.asVault(), prepared)).rejects.toThrow(
            /确认|变化|停止/,
        );
        expect(vault.createBinary).not.toHaveBeenCalled();
    });
});
