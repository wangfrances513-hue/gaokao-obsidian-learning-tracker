import { normalizePath, TFile, TFolder, Vault } from "obsidian";

import { GaokaoSubject } from "src/gaokao/schema";

export const GAOKAO_IMAGE_MANAGED_ROOT = "资源/图片";
export const GAOKAO_IMAGE_MAX_BYTES = 26_214_400;

const JPEG_SIGNATURE = [0xff, 0xd8, 0xff] as const;
const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] as const;
const SHA256_PATTERN = /^[a-f0-9]{64}$/;
const YEAR_PATTERN = /^\d{4}$/;
const MONTH_PATTERN = /^(0[1-9]|1[0-2])$/;

export const GAOKAO_IMAGE_SUBJECTS = ["数学", "生物", "化学", "物理", "英语", "语文"] as const;
export type GaokaoImageSubject = GaokaoSubject;
export type GaokaoImageKind = "jpeg" | "png";
export type GaokaoImageExtension = "jpg" | "png";
export type GaokaoImageAttachmentDisposition =
    | "reused_existing"
    | "newly_created_by_current_operation";

export interface GaokaoImageDuplicateRisk {
    readonly managedFileCount: number;
    readonly sameSizeCandidateCount: number;
    readonly exactMatchPaths: readonly string[];
    readonly sourceHintWarnings: readonly string[];
}

export interface PreparedGaokaoImageEvidence {
    readonly subject: GaokaoImageSubject;
    readonly kind: GaokaoImageKind;
    readonly canonicalExtension: GaokaoImageExtension;
    readonly byteLength: number;
    readonly sha256: string;
    readonly capturedYear: string;
    readonly capturedMonth: string;
    readonly disposition: GaokaoImageAttachmentDisposition;
    readonly attachmentPath: string;
    readonly canonicalPath: string;
    readonly duplicateRisk: GaokaoImageDuplicateRisk;
    readonly sourceBytes: ArrayBuffer;
}

export interface CommittedGaokaoImageAttachment {
    readonly disposition: GaokaoImageAttachmentDisposition;
    readonly path: string;
    readonly file: TFile;
}

export type GaokaoImageRollbackResult =
    | { readonly status: "not_required"; readonly detail: string }
    | { readonly status: "trashed"; readonly detail: string }
    | { readonly status: "already_absent"; readonly detail: string }
    | { readonly status: "preserved"; readonly detail: string; readonly orphanPath: string }
    | { readonly status: "failed"; readonly detail: string; readonly orphanPath: string };

export class GaokaoImageEvidenceError extends Error {
    readonly rollback?: GaokaoImageRollbackResult;

    constructor(message: string, rollback?: GaokaoImageRollbackResult) {
        super(message);
        this.name = "GaokaoImageEvidenceError";
        this.rollback = rollback;
    }
}

function errorWithCause(message: string, cause: unknown): Error {
    const error = new Error(message);
    Object.defineProperty(error, "cause", {
        configurable: true,
        enumerable: false,
        value: cause,
        writable: true,
    });
    return error;
}

interface DuplicateScanResult {
    readonly exactMatchPaths: string[];
    readonly managedFileCount: number;
    readonly sameSizeCandidateCount: number;
}

function startsWithSignature(bytes: Uint8Array, signature: readonly number[]): boolean {
    return (
        bytes.byteLength >= signature.length &&
        signature.every((value, index) => bytes[index] === value)
    );
}

export function detectGaokaoImageKind(bytes: Uint8Array): GaokaoImageKind {
    if (startsWithSignature(bytes, PNG_SIGNATURE)) return "png";
    if (startsWithSignature(bytes, JPEG_SIGNATURE)) return "jpeg";
    throw new Error("仅支持具有有效字节签名的 JPEG 或 PNG 图片。");
}

export function canonicalExtensionForImageKind(kind: GaokaoImageKind): GaokaoImageExtension {
    return kind === "jpeg" ? "jpg" : "png";
}

export function gaokaoImageBytesEqual(left: Uint8Array, right: Uint8Array): boolean {
    if (left.byteLength !== right.byteLength) return false;
    for (let index = 0; index < left.byteLength; index++) {
        if (left[index] !== right[index]) return false;
    }
    return true;
}

export async function calculateGaokaoImageSha256(bytes: ArrayBuffer): Promise<string> {
    const digest = await crypto.subtle.digest("SHA-256", bytes);
    return Array.from(new Uint8Array(digest), (value) => value.toString(16).padStart(2, "0")).join(
        "",
    );
}

function assertSafePathSegment(segment: string, label: string): void {
    if (
        segment.length === 0 ||
        segment === "." ||
        segment === ".." ||
        /[/\\:\n\r[\]#|]/.test(segment)
    ) {
        throw new Error(`${label} 包含不安全的 Vault 路径片段。`);
    }
}

export function buildGaokaoImageCanonicalPath(input: {
    subject: GaokaoImageSubject;
    year: string;
    month: string;
    sha256: string;
    extension: GaokaoImageExtension;
}): string {
    if (!GAOKAO_IMAGE_SUBJECTS.some((subject) => subject === input.subject)) {
        throw new Error("图片证据仅支持六个 GAOKAO 学科。");
    }
    assertSafePathSegment(input.subject, "科目");
    if (!YEAR_PATTERN.test(input.year)) throw new Error("图片年份不是四位数字。");
    if (!MONTH_PATTERN.test(input.month)) throw new Error("图片月份不在 01 至 12 之间。");
    if (!SHA256_PATTERN.test(input.sha256)) throw new Error("图片 SHA-256 格式无效。");
    if (input.extension !== "jpg" && input.extension !== "png") {
        throw new Error("图片扩展名不是受控的 jpg 或 png。");
    }
    return normalizePath(
        `${GAOKAO_IMAGE_MANAGED_ROOT}/${input.subject}/${input.year}/${input.month}/${input.sha256}.${input.extension}`,
    );
}

export function isCanonicalGaokaoImagePath(
    path: string,
    sha256: string,
    extension: GaokaoImageExtension,
): boolean {
    if (!SHA256_PATTERN.test(sha256)) return false;
    const escapedRoot = GAOKAO_IMAGE_MANAGED_ROOT.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const subjectPattern = GAOKAO_IMAGE_SUBJECTS.join("|");
    const pattern = new RegExp(
        `^${escapedRoot}/(${subjectPattern})/\\d{4}/(0[1-9]|1[0-2])/${sha256}\\.${extension}$`,
    );
    return pattern.test(path);
}

function isManagedImageFile(file: TFile): boolean {
    return file.path.startsWith(`${GAOKAO_IMAGE_MANAGED_ROOT}/`);
}

function compareVaultPaths(left: string, right: string): number {
    if (left < right) return -1;
    if (left > right) return 1;
    return 0;
}

function collectSourceHintWarnings(file: File, kind: GaokaoImageKind): string[] {
    const warnings: string[] = [];
    const mime = file.type.trim().toLowerCase();
    const expectedMimes = kind === "jpeg" ? ["image/jpeg", "image/jpg"] : ["image/png"];
    if (mime.length > 0 && !expectedMimes.includes(mime)) {
        warnings.push(`来源 MIME 提示为 ${file.type}，已按字节签名识别。`);
    }

    const extensionMatch = /\.([^.]+)$/.exec(file.name.trim().toLowerCase());
    if (extensionMatch) {
        const hintedExtension = extensionMatch[1];
        const expectedExtensions = kind === "jpeg" ? ["jpg", "jpeg"] : ["png"];
        if (!expectedExtensions.includes(hintedExtension)) {
            warnings.push(`来源文件扩展名提示为 .${hintedExtension}，已按字节签名识别。`);
        }
    }
    return warnings;
}

async function readAndVerifyExactFile(
    vault: Vault,
    file: TFile,
    expectedBytes: Uint8Array,
    expectedSha256: string,
): Promise<boolean> {
    let buffer: ArrayBuffer;
    try {
        buffer = await vault.readBinary(file);
    } catch (error: unknown) {
        const message = error instanceof Error ? error.message : "未知读取错误";
        throw errorWithCause(`无法读取受管图片 ${file.path}：${message}`, error);
    }
    if (buffer.byteLength !== expectedBytes.byteLength) return false;
    const actualBytes = new Uint8Array(buffer);
    const actualSha256 = await calculateGaokaoImageSha256(buffer);
    return actualSha256 === expectedSha256 && gaokaoImageBytesEqual(actualBytes, expectedBytes);
}

async function scanManagedImages(
    vault: Vault,
    expectedBytes: Uint8Array,
    expectedSha256: string,
    extension: GaokaoImageExtension,
): Promise<DuplicateScanResult> {
    const managedFiles = vault
        .getFiles()
        .filter(isManagedImageFile)
        .sort((left, right) => compareVaultPaths(left.path, right.path));
    const conflictingHashName = managedFiles.find(
        (candidate) =>
            candidate.basename.toLowerCase() === expectedSha256 &&
            candidate.stat.size !== expectedBytes.byteLength,
    );
    if (conflictingHashName !== undefined) {
        throw new Error(
            `受管图片 ${conflictingHashName.path} 声明了相同 SHA-256 文件名，但字节长度不一致；已停止。`,
        );
    }
    const sameSizeCandidates = managedFiles.filter(
        (candidate) => candidate.stat.size === expectedBytes.byteLength,
    );
    const exactMatchPaths: string[] = [];

    for (const candidate of sameSizeCandidates) {
        const exact = await readAndVerifyExactFile(vault, candidate, expectedBytes, expectedSha256);
        if (exact) {
            if (!isCanonicalGaokaoImagePath(candidate.path, expectedSha256, extension)) {
                throw new Error(
                    `受管图片 ${candidate.path} 与来源字节相同，但路径不符合受控规范；已停止。`,
                );
            }
            exactMatchPaths.push(candidate.path);
        } else if (candidate.basename.toLowerCase() === expectedSha256) {
            throw new Error(
                `受管图片 ${candidate.path} 声明了相同 SHA-256 文件名，但字节不一致；已停止。`,
            );
        }
    }

    exactMatchPaths.sort(compareVaultPaths);
    return {
        exactMatchPaths,
        managedFileCount: managedFiles.length,
        sameSizeCandidateCount: sameSizeCandidates.length,
    };
}

async function resolveAttachmentDisposition(
    vault: Vault,
    expectedBytes: Uint8Array,
    expectedSha256: string,
    extension: GaokaoImageExtension,
    canonicalPath: string,
): Promise<{
    disposition: GaokaoImageAttachmentDisposition;
    attachmentPath: string;
    scan: DuplicateScanResult;
}> {
    const canonicalTarget = vault.getAbstractFileByPath(canonicalPath);
    if (canonicalTarget instanceof TFolder) {
        throw new Error(`${canonicalPath} 已被文件夹占用；不会覆盖或改用其他路径。`);
    }
    if (canonicalTarget !== null && !(canonicalTarget instanceof TFile)) {
        throw new Error(`${canonicalPath} 存在未知 Vault 对象；不会覆盖或改用其他路径。`);
    }
    if (
        canonicalTarget instanceof TFile &&
        !(await readAndVerifyExactFile(vault, canonicalTarget, expectedBytes, expectedSha256))
    ) {
        throw new Error(`${canonicalPath} 已被不同字节占用；不会覆盖或改用其他路径。`);
    }

    const scan = await scanManagedImages(vault, expectedBytes, expectedSha256, extension);
    const firstExactPath = scan.exactMatchPaths[0];
    return firstExactPath === undefined
        ? {
              disposition: "newly_created_by_current_operation",
              attachmentPath: canonicalPath,
              scan,
          }
        : { disposition: "reused_existing", attachmentPath: firstExactPath, scan };
}

function freezeDuplicateRisk(
    scan: DuplicateScanResult,
    sourceHintWarnings: readonly string[],
): GaokaoImageDuplicateRisk {
    return Object.freeze({
        managedFileCount: scan.managedFileCount,
        sameSizeCandidateCount: scan.sameSizeCandidateCount,
        exactMatchPaths: Object.freeze([...scan.exactMatchPaths]),
        sourceHintWarnings: Object.freeze([...sourceHintWarnings]),
    });
}

export function assertGaokaoImageFolderState(vault: Vault, attachmentPath: string): void {
    const normalized = normalizePath(attachmentPath);
    if (!normalized.startsWith(`${GAOKAO_IMAGE_MANAGED_ROOT}/`)) {
        throw new Error("图片附件路径不在受管根目录内。");
    }
    const segments = normalized.split("/");
    segments.pop();
    let current = "";
    for (const segment of segments) {
        assertSafePathSegment(segment, "图片文件夹");
        current = current.length === 0 ? segment : `${current}/${segment}`;
        const existing = vault.getAbstractFileByPath(current);
        if (existing === null || existing instanceof TFolder) continue;
        throw new Error(`${current} 已存在，但不是文件夹。`);
    }
}

async function ensureGaokaoImageFolder(vault: Vault, attachmentPath: string): Promise<void> {
    assertGaokaoImageFolderState(vault, attachmentPath);
    const segments = normalizePath(attachmentPath).split("/");
    segments.pop();
    let current = "";
    for (const segment of segments) {
        current = current.length === 0 ? segment : `${current}/${segment}`;
        const existing = vault.getAbstractFileByPath(current);
        if (existing instanceof TFolder) continue;
        if (existing !== null) throw new Error(`${current} 已存在，但不是文件夹。`);
        try {
            await vault.createFolder(current);
        } catch (error: unknown) {
            if (vault.getAbstractFileByPath(current) instanceof TFolder) continue;
            throw error;
        }
    }
}

export async function prepareGaokaoImageEvidence(
    vault: Vault,
    file: File,
    subject: GaokaoImageSubject,
    createDate: () => Date = () => new Date(),
): Promise<PreparedGaokaoImageEvidence> {
    if (file.size <= 0) throw new Error("图片文件不能为空。");
    if (file.size > GAOKAO_IMAGE_MAX_BYTES) {
        throw new Error(`图片超过 ${GAOKAO_IMAGE_MAX_BYTES} 字节上限。`);
    }

    let sourceBuffer: ArrayBuffer;
    try {
        sourceBuffer = await file.arrayBuffer();
    } catch (error: unknown) {
        const message = error instanceof Error ? error.message : "未知读取错误";
        throw errorWithCause(`无法读取所选图片：${message}`, error);
    }
    if (sourceBuffer.byteLength === 0) throw new Error("图片读取结果为空。");
    if (sourceBuffer.byteLength > GAOKAO_IMAGE_MAX_BYTES) {
        throw new Error(`图片读取结果超过 ${GAOKAO_IMAGE_MAX_BYTES} 字节上限。`);
    }
    if (sourceBuffer.byteLength !== file.size) {
        throw new Error(
            `图片读取长度 ${sourceBuffer.byteLength} 与声明长度 ${file.size} 不一致；可能已截断。`,
        );
    }

    const sourceBytes = new Uint8Array(sourceBuffer);
    const kind = detectGaokaoImageKind(sourceBytes);
    const canonicalExtension = canonicalExtensionForImageKind(kind);
    const sha256 = await calculateGaokaoImageSha256(sourceBuffer);
    const capturedDate = createDate();
    if (Number.isNaN(capturedDate.getTime())) throw new Error("无法取得有效的本机捕获日期。");
    const capturedYear = String(capturedDate.getFullYear()).padStart(4, "0");
    const capturedMonth = String(capturedDate.getMonth() + 1).padStart(2, "0");
    const canonicalPath = buildGaokaoImageCanonicalPath({
        subject,
        year: capturedYear,
        month: capturedMonth,
        sha256,
        extension: canonicalExtension,
    });
    assertGaokaoImageFolderState(vault, canonicalPath);
    const resolved = await resolveAttachmentDisposition(
        vault,
        sourceBytes,
        sha256,
        canonicalExtension,
        canonicalPath,
    );
    const sourceHintWarnings = collectSourceHintWarnings(file, kind);

    return Object.freeze({
        subject,
        kind,
        canonicalExtension,
        byteLength: sourceBuffer.byteLength,
        sha256,
        capturedYear,
        capturedMonth,
        disposition: resolved.disposition,
        attachmentPath: resolved.attachmentPath,
        canonicalPath,
        duplicateRisk: freezeDuplicateRisk(resolved.scan, sourceHintWarnings),
        sourceBytes: sourceBuffer.slice(0),
    });
}

export async function revalidatePreparedGaokaoImageEvidence(
    vault: Vault,
    prepared: PreparedGaokaoImageEvidence,
): Promise<GaokaoImageDuplicateRisk> {
    const expectedBytes = new Uint8Array(prepared.sourceBytes);
    if (expectedBytes.byteLength !== prepared.byteLength) {
        throw new Error("已确认图片的内存字节长度发生变化；未写入任何内容。");
    }
    if ((await calculateGaokaoImageSha256(prepared.sourceBytes)) !== prepared.sha256) {
        throw new Error("已确认图片的内存 SHA-256 发生变化；未写入任何内容。");
    }
    const canonicalPath = buildGaokaoImageCanonicalPath({
        subject: prepared.subject,
        year: prepared.capturedYear,
        month: prepared.capturedMonth,
        sha256: prepared.sha256,
        extension: prepared.canonicalExtension,
    });
    if (canonicalPath !== prepared.canonicalPath) {
        throw new Error("已确认图片的规范目标路径发生变化；未写入任何内容。");
    }
    assertGaokaoImageFolderState(vault, canonicalPath);
    const resolved = await resolveAttachmentDisposition(
        vault,
        expectedBytes,
        prepared.sha256,
        prepared.canonicalExtension,
        canonicalPath,
    );
    if (
        resolved.disposition !== prepared.disposition ||
        resolved.attachmentPath !== prepared.attachmentPath
    ) {
        throw new Error("受管图片重复状态或已确认附件路径已经变化；未写入任何内容。");
    }
    return freezeDuplicateRisk(resolved.scan, prepared.duplicateRisk.sourceHintWarnings);
}

async function verifyCommittedFile(
    vault: Vault,
    file: TFile,
    prepared: PreparedGaokaoImageEvidence,
): Promise<void> {
    if (
        !(await readAndVerifyExactFile(
            vault,
            file,
            new Uint8Array(prepared.sourceBytes),
            prepared.sha256,
        ))
    ) {
        throw new Error(`附件 ${file.path} 回读后的长度、SHA-256 或字节不一致。`);
    }
}

export async function rollbackGaokaoImageAttachment(
    vault: Vault,
    attachment: CommittedGaokaoImageAttachment,
): Promise<GaokaoImageRollbackResult> {
    if (attachment.disposition === "reused_existing") {
        return { status: "not_required", detail: "复用附件不具备回滚删除资格。" };
    }
    const current = vault.getAbstractFileByPath(attachment.path);
    if (current === null) {
        return { status: "already_absent", detail: "新建附件已不在确认路径，无需回滚。" };
    }
    if (current !== attachment.file) {
        return {
            status: "preserved",
            detail: "确认路径上的 Vault 对象身份不明确，已保留且未删除。",
            orphanPath: attachment.path,
        };
    }
    try {
        await vault.trash(attachment.file, false);
        return { status: "trashed", detail: "新建附件已移入 Vault 本地废纸篓。" };
    } catch (error: unknown) {
        const message = error instanceof Error ? error.message : "未知回滚错误";
        return {
            status: "failed",
            detail: `新建附件回滚失败：${message}`,
            orphanPath: attachment.path,
        };
    }
}

async function failNewAttachment(
    vault: Vault,
    attachment: CommittedGaokaoImageAttachment,
    message: string,
): Promise<never> {
    const rollback = await rollbackGaokaoImageAttachment(vault, attachment);
    const orphanSuffix = "orphanPath" in rollback ? ` 孤立附件路径：${rollback.orphanPath}。` : "";
    throw new GaokaoImageEvidenceError(`${message} ${rollback.detail}${orphanSuffix}`, rollback);
}

export async function commitPreparedGaokaoImageEvidence(
    vault: Vault,
    prepared: PreparedGaokaoImageEvidence,
): Promise<CommittedGaokaoImageAttachment> {
    await revalidatePreparedGaokaoImageEvidence(vault, prepared);
    const expectedBytes = new Uint8Array(prepared.sourceBytes);
    if (prepared.disposition === "reused_existing") {
        const existing = vault.getAbstractFileByPath(prepared.attachmentPath);
        if (!(existing instanceof TFile)) {
            throw new Error(`已确认复用附件 ${prepared.attachmentPath} 不再是文件。`);
        }
        await verifyCommittedFile(vault, existing, prepared);
        return Object.freeze({
            disposition: "reused_existing",
            path: existing.path,
            file: existing,
        });
    }

    await ensureGaokaoImageFolder(vault, prepared.attachmentPath);
    await revalidatePreparedGaokaoImageEvidence(vault, prepared);
    const appeared = vault.getAbstractFileByPath(prepared.attachmentPath);
    if (appeared instanceof TFile) {
        if (await readAndVerifyExactFile(vault, appeared, expectedBytes, prepared.sha256)) {
            throw new Error(
                `确认后的附件状态发生变化；${appeared.path} 已出现完全相同的受管附件。已停止写入，并保留该文件。`,
            );
        }
        throw new Error(`${prepared.attachmentPath} 在提交期间被不同字节占用；未覆盖。`);
    }
    if (appeared !== null) {
        throw new Error(`${prepared.attachmentPath} 在提交期间被非文件对象占用；未覆盖。`);
    }

    let created: TFile;
    try {
        created = await vault.createBinary(prepared.attachmentPath, prepared.sourceBytes.slice(0));
    } catch (error: unknown) {
        const raced = vault.getAbstractFileByPath(prepared.attachmentPath);
        if (raced instanceof TFile) {
            let exact: boolean;
            try {
                exact = await readAndVerifyExactFile(vault, raced, expectedBytes, prepared.sha256);
            } catch (readError: unknown) {
                throw errorWithCause(
                    `附件创建结果不明确；${raced.path} 已保留且未删除，回读失败：${
                        readError instanceof Error ? readError.message : "未知读取错误"
                    }`,
                    readError,
                );
            }
            if (exact) {
                throw errorWithCause(
                    `确认后的附件状态发生变化；${raced.path} 在创建期间出现完全相同的受管附件。已停止写入，并保留该文件。`,
                    error,
                );
            }
            throw errorWithCause(
                `附件创建结果不明确；${raced.path} 已被不同字节占用并已保留，未覆盖或删除。`,
                error,
            );
        }
        if (raced !== null) {
            throw errorWithCause(
                `附件创建结果不明确；${prepared.attachmentPath} 当前为非文件对象，已保留且未删除。`,
                error,
            );
        }
        const message = error instanceof Error ? error.message : "未知写入错误";
        throw errorWithCause(`无法创建图片附件 ${prepared.attachmentPath}：${message}`, error);
    }

    const committed: CommittedGaokaoImageAttachment = Object.freeze({
        disposition: "newly_created_by_current_operation",
        path: created.path,
        file: created,
    });
    if (created.path !== prepared.attachmentPath) {
        return await failNewAttachment(
            vault,
            committed,
            `Vault 返回了未确认的附件路径 ${created.path}。`,
        );
    }
    try {
        await verifyCommittedFile(vault, created, prepared);
    } catch (error: unknown) {
        const message = error instanceof Error ? error.message : "未知回读错误";
        return await failNewAttachment(vault, committed, message);
    }
    return committed;
}
