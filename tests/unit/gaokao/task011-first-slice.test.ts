/* eslint-disable camelcase -- Tests exercise generated snake_case YAML contracts. */

import { Notice, TFile, TFolder } from "obsidian";

import {
    assertGaokaoImageFolderState,
    commitPreparedGaokaoImageEvidence,
    GaokaoImageAttachmentDisposition,
    GaokaoImageSubject,
    PreparedGaokaoImageEvidence,
    prepareGaokaoImageEvidence,
    revalidatePreparedGaokaoImageEvidence,
    rollbackGaokaoImageAttachment,
} from "src/gaokao/image-evidence";
import { GaokaoWorkflowManager } from "src/gaokao/workflow-manager";
import {
    GaokaoImageEvidenceConfirmation,
    GaokaoImageEvidenceDraft,
    GaokaoImageEvidenceKnowledgeChoice,
    GaokaoImageEvidenceModal,
} from "src/ui/obsidian-ui-components/modals/gaokao-image-evidence-modal";

jest.mock("obsidian", () => {
    function enhance<T extends HTMLElement>(element: T): T {
        const extended = element as T & {
            addClass: (...classes: string[]) => void;
            createDiv: (options?: { cls?: string; text?: string }) => HTMLDivElement;
            empty: () => void;
            setText: (text: string) => void;
        };
        extended.addClass = (...classes: string[]) => element.classList.add(...classes);
        extended.createDiv = (options = {}) => {
            const child = enhance(document.createElement("div"));
            const cls = typeof options === "string" ? options : options.cls;
            const text = typeof options === "string" ? undefined : options.text;
            if (typeof cls === "string") child.className = cls;
            if (typeof text === "string") child.textContent = text;
            element.appendChild(child);
            return child;
        };
        extended.createEl = <K extends keyof HTMLElementTagNameMap>(tag: K) => {
            const child = enhance(document.createElement(tag));
            element.appendChild(child);
            return child;
        };
        extended.empty = () => element.replaceChildren();
        extended.setText = (text: string) => {
            element.textContent = text;
        };
        return element;
    }

    class MockTFile {
        path: string;
        name: string;
        basename: string;
        extension: string;
        stat: { size: number };

        constructor(path: string, size = 0) {
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

    class MockModal {
        app: unknown;
        modalEl = enhance(document.createElement("div"));
        contentEl = enhance(document.createElement("div"));
        titleEl = enhance(document.createElement("h2"));

        constructor(app: unknown) {
            this.app = app;
            this.modalEl.append(this.titleEl, this.contentEl);
        }

        setTitle(title: string): void {
            this.titleEl.textContent = title;
        }

        open(): void {
            document.body.appendChild(this.modalEl);
            const instance = this as unknown as { onOpen?: () => void };
            instance.onOpen?.();
        }

        close(): void {
            this.modalEl.remove();
            const instance = this as unknown as { onClose?: () => void };
            instance.onClose?.();
        }
    }

    class MockSetting {
        settingEl = enhance(document.createElement("div"));
        infoEl = enhance(document.createElement("div"));
        controlEl = enhance(document.createElement("div"));
        nameEl = enhance(document.createElement("div"));
        descEl = enhance(document.createElement("div"));
        errorEl = enhance(document.createElement("div"));

        constructor(container: HTMLElement) {
            this.infoEl.append(this.nameEl, this.descEl, this.errorEl);
            this.settingEl.append(this.infoEl, this.controlEl);
            container.appendChild(this.settingEl);
        }

        setName(name: string): this {
            this.nameEl.textContent = name;
            return this;
        }

        setDesc(description: string): this {
            this.descEl.textContent = description;
            return this;
        }

        setErrorMessage(message: string | null): this {
            this.errorEl.textContent = message ?? "";
            return this;
        }

        addDropdown(callback: (dropdown: unknown) => void): this {
            const selectEl = document.createElement("select");
            this.controlEl.appendChild(selectEl);
            const component = {
                addOption: (value: string, label: string) => {
                    const option = document.createElement("option");
                    option.value = value;
                    option.text = label;
                    selectEl.appendChild(option);
                    return component;
                },
                onChange: (handler: (value: string) => void) => {
                    selectEl.addEventListener("change", () => handler(selectEl.value));
                    return component;
                },
                setValue: (value: string) => {
                    selectEl.value = value;
                    return component;
                },
            };
            callback(component);
            return this;
        }

        addText(callback: (text: unknown) => void): this {
            const inputEl = document.createElement("input");
            inputEl.type = "text";
            this.controlEl.appendChild(inputEl);
            const component = {
                onChange: (handler: (value: string) => void) => {
                    inputEl.addEventListener("input", () => handler(inputEl.value));
                    return component;
                },
                setPlaceholder: (placeholder: string) => {
                    inputEl.placeholder = placeholder;
                    return component;
                },
                setValue: (value: string) => {
                    inputEl.value = value;
                    return component;
                },
            };
            callback(component);
            return this;
        }

        addButton(callback: (button: unknown) => void): this {
            const buttonEl = document.createElement("button");
            this.controlEl.appendChild(buttonEl);
            const component = {
                onClick: (handler: () => void | Promise<void>) => {
                    buttonEl.addEventListener("click", () => void handler());
                    return component;
                },
                setButtonText: (text: string) => {
                    buttonEl.textContent = text;
                    return component;
                },
                setCta: () => component,
                setDisabled: (disabled: boolean) => {
                    buttonEl.disabled = disabled;
                    return component;
                },
            };
            callback(component);
            return this;
        }
    }

    return {
        Modal: MockModal,
        Notice: jest.fn(),
        Setting: MockSetting,
        TFile: MockTFile,
        TFolder: MockTFolder,
        normalizePath: (path: string) => path.replace(/\/{2,}/g, "/"),
    };
});

jest.mock("src/gaokao/image-evidence", () => ({
    assertGaokaoImageFolderState: jest.fn(),
    commitPreparedGaokaoImageEvidence: jest.fn(),
    prepareGaokaoImageEvidence: jest.fn(),
    revalidatePreparedGaokaoImageEvidence: jest.fn(),
    rollbackGaokaoImageAttachment: jest.fn(),
}));

jest.mock("src/ui/obsidian-ui-components/modals/gaokao-workflow-modal", () => ({
    GaokaoEventTypeModal: { choose: jest.fn() },
    GaokaoFeedbackModal: { capture: jest.fn() },
    GaokaoNoteCreationModal: jest.fn(),
    GaokaoRecentEventsModal: jest.fn(),
}));

type RuntimeTFile = TFile & { stat: { size: number } };
type RuntimeTFolder = TFolder;
type VaultEntry = RuntimeTFile | RuntimeTFolder | { path: string };

const RuntimeTFile = TFile as unknown as new (path: string, size?: number) => RuntimeTFile;
const RuntimeTFolder = TFolder as unknown as new (path: string) => RuntimeTFolder;
const noticeMock = Notice as unknown as jest.Mock;
const prepareMock = jest.mocked(prepareGaokaoImageEvidence);
const revalidateMock = jest.mocked(revalidatePreparedGaokaoImageEvidence);
const commitMock = jest.mocked(commitPreparedGaokaoImageEvidence);
const rollbackMock = jest.mocked(rollbackGaokaoImageAttachment);
const assertImageFolderMock = jest.mocked(assertGaokaoImageFolderState);

interface KnowledgeRecord {
    path: string;
    entity: {
        gaokao_id: string;
        entity_type: string;
        subject: string;
    };
}

interface CapturedModalOptions {
    knowledgePoints: readonly GaokaoImageEvidenceKnowledgeChoice[];
    onPlan: (draft: GaokaoImageEvidenceDraft) => Promise<{
        confirmation: GaokaoImageEvidenceConfirmation;
        plan: unknown;
    }>;
    onCommit: (plan: unknown) => Promise<void>;
}

interface FrozenCapturePlan {
    readonly image: { readonly sha256: string; readonly byteLength: number };
    readonly subject: string;
    readonly knowledgeId: string;
    readonly knowledgePath: string;
    readonly gaokaoId: string;
    readonly notePath: string;
    readonly frontmatter: Readonly<Record<string, unknown>>;
    readonly noteContent: string;
}

class ManagerVault {
    readonly entries = new Map<string, VaultEntry>();
    readonly contents = new Map<string, string>();
    createError: Error | null = null;
    beforeCreateError: ((path: string, content: string) => void) | null = null;

    readonly getAbstractFileByPath = jest.fn(
        (path: string): VaultEntry | null => this.entries.get(path) ?? null,
    );

    readonly createFolder = jest.fn(async (path: string): Promise<RuntimeTFolder> => {
        const folder = new RuntimeTFolder(path);
        this.entries.set(path, folder);
        return folder;
    });

    readonly create = jest.fn(async (path: string, content: string): Promise<RuntimeTFile> => {
        if (this.createError !== null) {
            this.beforeCreateError?.(path, content);
            throw this.createError;
        }
        const file = new RuntimeTFile(path, content.length);
        this.entries.set(path, file);
        this.contents.set(path, content);
        return file;
    });

    readonly read = jest.fn(async (file: RuntimeTFile): Promise<string> => {
        const content = this.contents.get(file.path);
        if (content === undefined) throw new Error(`missing note: ${file.path}`);
        return content;
    });

    readonly trash = jest.fn();
}

function knowledgePoint(id: string, subject: string, path?: string): KnowledgeRecord {
    return {
        path: path ?? `${subject}/知识点/${id}.md`,
        entity: { gaokao_id: id, entity_type: "knowledge_point", subject },
    };
}

function makePrepared(
    subject: GaokaoImageSubject,
    disposition: GaokaoImageAttachmentDisposition = "newly_created_by_current_operation",
): PreparedGaokaoImageEvidence {
    const sha256 = subject === "数学" ? "a".repeat(64) : "b".repeat(64);
    const extension = subject === "数学" ? "jpg" : "png";
    const path = `资源/图片/${subject}/2026/08/${sha256}.${extension}`;
    return Object.freeze({
        subject,
        kind: subject === "数学" ? ("jpeg" as const) : ("png" as const),
        canonicalExtension: extension,
        byteLength: 9,
        sha256,
        capturedYear: "2026",
        capturedMonth: "08",
        disposition,
        attachmentPath: path,
        canonicalPath: path,
        duplicateRisk: Object.freeze({
            managedFileCount: 0,
            sameSizeCandidateCount: 0,
            exactMatchPaths: Object.freeze([]),
            sourceHintWarnings: Object.freeze([]),
        }),
        sourceBytes: new ArrayBuffer(9),
    });
}

function fakeSelectedFile(): File {
    return {
        name: "capture.png",
        type: "image/png",
        size: 9,
        arrayBuffer: async () => new ArrayBuffer(9),
    } as unknown as File;
}

function findButton(text: string): HTMLButtonElement {
    const button = [...document.querySelectorAll("button")].find(
        (candidate) => candidate.textContent === text,
    );
    if (!(button instanceof HTMLButtonElement)) throw new Error(`missing button: ${text}`);
    return button;
}

function tick(): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, 0));
}

function setupManager() {
    const vault = new ManagerVault();
    const knowledgePoints: KnowledgeRecord[] = [
        knowledgePoint("math-knowledge-001", "数学"),
        knowledgePoint("biology-knowledge-001", "生物"),
        knowledgePoint("physics-knowledge-001", "物理"),
    ];
    const candidateOverrides = new Map<string, string[]>();
    const dataManager = {
        data: { settings: { tagsToReview: ["review"] } },
        getGaokaoKnowledgePoints: jest.fn(() => knowledgePoints),
        getGaokaoIdPaths: jest.fn((id: string) => {
            const override = candidateOverrides.get(id);
            if (override !== undefined) return override;
            const matches = knowledgePoints.filter((item) => item.entity.gaokao_id === id);
            return matches.map((item) => item.path);
        }),
        indexGaokaoFrontmatter: jest.fn(),
        recordGaokaoLearningEvent: jest.fn(),
        recordForPath: jest.fn(),
        recordReviewForPath: jest.fn(),
        persistToday: jest.fn(),
        writeSettings: jest.fn(),
        saveData: jest.fn(),
    };
    const openFile = jest.fn(async (): Promise<void> => undefined);
    const plugin = {
        isInitialized: true,
        app: {
            vault,
            workspace: { getLeaf: () => ({ openFile }) },
        },
        dataManager,
    };
    return {
        candidateOverrides,
        dataManager,
        knowledgePoints,
        manager: new GaokaoWorkflowManager(plugin as never),
        openFile,
        plugin,
        vault,
    };
}

function expectNoAuthorityWrites(harness: ReturnType<typeof setupManager>): void {
    expect(harness.dataManager.recordGaokaoLearningEvent).not.toHaveBeenCalled();
    expect(harness.dataManager.recordForPath).not.toHaveBeenCalled();
    expect(harness.dataManager.recordReviewForPath).not.toHaveBeenCalled();
    expect(harness.dataManager.persistToday).not.toHaveBeenCalled();
    expect(harness.dataManager.writeSettings).not.toHaveBeenCalled();
    expect(harness.dataManager.saveData).not.toHaveBeenCalled();
}

describe("Task 011 first-slice workflow orchestration", () => {
    let capturedOptions: CapturedModalOptions | null;
    let captureSpy: jest.SpiedFunction<typeof GaokaoImageEvidenceModal.capture>;
    let randomUuid: jest.Mock;

    beforeEach(() => {
        document.body.replaceChildren();
        jest.clearAllMocks();
        capturedOptions = null;
        randomUuid = jest.fn(() => "123e4567-e89b-42d3-a456-426614174000");
        Object.defineProperty(globalThis, "crypto", {
            configurable: true,
            value: { randomUUID: randomUuid },
        });
        prepareMock.mockImplementation(async (_vault, _file, subject) => makePrepared(subject));
        revalidateMock.mockResolvedValue({
            managedFileCount: 0,
            sameSizeCandidateCount: 0,
            exactMatchPaths: [],
            sourceHintWarnings: [],
        });
        commitMock.mockImplementation(async (_vault, prepared) => ({
            disposition: prepared.disposition,
            path: prepared.attachmentPath,
            file: new RuntimeTFile(prepared.attachmentPath, prepared.byteLength),
        }));
        rollbackMock.mockImplementation(async (_vault, attachment) =>
            attachment.disposition === "reused_existing"
                ? { status: "not_required", detail: "reused" }
                : { status: "trashed", detail: "trashed" },
        );
        assertImageFolderMock.mockImplementation(() => undefined);
        captureSpy = jest
            .spyOn(GaokaoImageEvidenceModal, "capture")
            .mockImplementation(async (_app, options) => {
                capturedOptions = options as unknown as CapturedModalOptions;
                return "cancelled";
            });
    });

    afterEach(() => {
        captureSpy.mockRestore();
    });

    async function optionsFor(
        harness: ReturnType<typeof setupManager>,
    ): Promise<CapturedModalOptions> {
        await harness.manager.captureImageEvidence();
        if (capturedOptions === null) throw new Error("capture options not received");
        return capturedOptions;
    }

    test("exposes only Math/Biology canonical choices and rejects unsupported subject", async () => {
        const harness = setupManager();
        const options = await optionsFor(harness);
        expect(options.knowledgePoints.map((choice) => choice.subject)).toEqual(["数学", "生物"]);
        await expect(
            options.onPlan({
                file: fakeSelectedFile(),
                subject: "物理" as never,
                title: "不支持",
                knowledgeId: "physics-knowledge-001",
            }),
        ).rejects.toThrow(/仅支持数学和生物/);
        expect(harness.vault.create).not.toHaveBeenCalled();
    });

    test("requires exactly one valid same-subject knowledge point", async () => {
        const missing = setupManager();
        await expect(
            (await optionsFor(missing)).onPlan({
                file: fakeSelectedFile(),
                subject: "数学",
                title: "缺失",
                knowledgeId: "",
            }),
        ).rejects.toThrow(/必须选择/);

        const duplicate = setupManager();
        duplicate.candidateOverrides.set("math-knowledge-001", ["数学/A.md", "数学/B.md"]);
        await expect(
            (await optionsFor(duplicate)).onPlan({
                file: fakeSelectedFile(),
                subject: "数学",
                title: "重复",
                knowledgeId: "math-knowledge-001",
            }),
        ).rejects.toThrow(/不是唯一有效实体/);

        const wrongSubject = setupManager();
        await expect(
            (await optionsFor(wrongSubject)).onPlan({
                file: fakeSelectedFile(),
                subject: "数学",
                title: "错科",
                knowledgeId: "biology-knowledge-001",
            }),
        ).rejects.toThrow(/不是当前科目/);

        const wrongType = setupManager();
        wrongType.knowledgePoints[0].entity.entity_type = "resource_unit";
        await expect(
            (await optionsFor(wrongType)).onPlan({
                file: fakeSelectedFile(),
                subject: "数学",
                title: "错类型",
                knowledgeId: "math-knowledge-001",
            }),
        ).rejects.toThrow(/knowledge_point/);
    });

    test("rejects a generated gaokao_id collision before writes", async () => {
        const harness = setupManager();
        harness.candidateOverrides.set("problem-math-123e4567e89b", ["数学/既有.md"]);
        const options = await optionsFor(harness);
        await expect(
            options.onPlan({
                file: fakeSelectedFile(),
                subject: "数学",
                title: "ID 冲突",
                knowledgeId: "math-knowledge-001",
            }),
        ).rejects.toThrow(/未生成替代 ID/);
        expect(harness.vault.create).not.toHaveBeenCalled();
    });

    test("freezes the complete final plan and all confirmed authority values", async () => {
        const harness = setupManager();
        const planned = await (
            await optionsFor(harness)
        ).onPlan({
            file: fakeSelectedFile(),
            subject: "数学",
            title: "冻结计划",
            knowledgeId: "math-knowledge-001",
        });
        const plan = planned.plan as FrozenCapturePlan;
        expect(Object.isFrozen(planned)).toBe(true);
        expect(Object.isFrozen(planned.confirmation)).toBe(true);
        expect(Object.isFrozen(plan)).toBe(true);
        expect(Object.isFrozen(plan.image)).toBe(true);
        expect(Object.isFrozen(plan.frontmatter)).toBe(true);
        expect(Object.isFrozen(plan.frontmatter.knowledge_ids)).toBe(true);
        expect(plan).toMatchObject({
            subject: "数学",
            knowledgeId: "math-knowledge-001",
            gaokaoId: "problem-math-123e4567e89b",
            notePath: "数学/代表题/冻结计划.md",
        });
        expect(plan.image).toMatchObject({ sha256: "a".repeat(64), byteLength: 9 });
        expect(plan.noteContent).toContain(`SHA-256: ${"a".repeat(64)}`);
    });

    test("stale knowledge path, duplicate state, and occupied note path fail before writes", async () => {
        const stale = setupManager();
        const staleOptions = await optionsFor(stale);
        const stalePlan = await staleOptions.onPlan({
            file: fakeSelectedFile(),
            subject: "数学",
            title: "陈旧知识",
            knowledgeId: "math-knowledge-001",
        });
        stale.knowledgePoints[0].path = "数学/知识点/已移动.md";
        await expect(staleOptions.onCommit(stalePlan.plan)).rejects.toThrow(/已从确认路径/);
        expect(commitMock).not.toHaveBeenCalled();

        jest.clearAllMocks();
        prepareMock.mockImplementation(async (_vault, _file, subject) => makePrepared(subject));
        const duplicate = setupManager();
        const duplicateOptions = await optionsFor(duplicate);
        const duplicatePlan = await duplicateOptions.onPlan({
            file: fakeSelectedFile(),
            subject: "数学",
            title: "重复状态变化",
            knowledgeId: "math-knowledge-001",
        });
        revalidateMock.mockRejectedValueOnce(new Error("duplicate state changed"));
        await expect(duplicateOptions.onCommit(duplicatePlan.plan)).rejects.toThrow(
            /duplicate state changed/,
        );
        expect(commitMock).not.toHaveBeenCalled();

        jest.clearAllMocks();
        prepareMock.mockImplementation(async (_vault, _file, subject) => makePrepared(subject));
        revalidateMock.mockResolvedValue({
            managedFileCount: 0,
            sameSizeCandidateCount: 0,
            exactMatchPaths: [],
            sourceHintWarnings: [],
        });
        const occupied = setupManager();
        const occupiedOptions = await optionsFor(occupied);
        const occupiedPlan = await occupiedOptions.onPlan({
            file: fakeSelectedFile(),
            subject: "数学",
            title: "占用路径",
            knowledgeId: "math-knowledge-001",
        });
        const notePath = (occupiedPlan.plan as FrozenCapturePlan).notePath;
        occupied.vault.entries.set(notePath, new RuntimeTFile(notePath));
        await expect(occupiedOptions.onCommit(occupiedPlan.plan)).rejects.toThrow(/现已被占用/);
        expect(commitMock).not.toHaveBeenCalled();
    });

    test.each([
        ["数学", "math-knowledge-001", "math_problem", "数学/代表题"],
        ["生物", "biology-knowledge-001", "biology_problem_answer", "生物/问题与答案"],
    ] as const)(
        "creates the confirmed %s note shape with zero authority writes",
        async (subject, knowledgeId, workflowKind, folder) => {
            const harness = setupManager();
            const options = await optionsFor(harness);
            const planned = await options.onPlan({
                file: fakeSelectedFile(),
                subject,
                title: `${subject}捕获成功`,
                knowledgeId,
            });
            await options.onCommit(planned.plan);

            expect(commitMock).toHaveBeenCalledTimes(1);
            expect(harness.vault.create).toHaveBeenCalledTimes(1);
            const [notePath, content] = harness.vault.create.mock.calls[0];
            expect(notePath.startsWith(`${folder}/`)).toBe(true);
            expect(content.match(/!\[\[/g)).toHaveLength(1);
            expect(content.match(/^SHA-256: [a-f0-9]{64}$/gm)).toHaveLength(1);
            expect(content).toContain('source: "image_capture"');
            expect(content).toContain("knowledge_ids:");
            if (workflowKind === "biology_problem_answer") {
                expect(content).toContain('workflow_kind: "biology_problem_answer"');
            }
            expectNoAuthorityWrites(harness);
        },
    );

    test("does not silently regenerate confirmed ID, path, date, subject, or selection", async () => {
        const harness = setupManager();
        const options = await optionsFor(harness);
        const planned = await options.onPlan({
            file: fakeSelectedFile(),
            subject: "数学",
            title: "不静默变化",
            knowledgeId: "math-knowledge-001",
        });
        randomUuid.mockReturnValue("ffffffff-ffff-ffff-ffff-ffffffffffff");
        harness.dataManager.data.settings.tagsToReview[0] = "changed";
        await options.onCommit(planned.plan);
        const [notePath, content] = harness.vault.create.mock.calls[0];
        expect(notePath).toBe("数学/代表题/不静默变化.md");
        expect(content).toContain('gaokao_id: "problem-math-123e4567e89b"');
        expect(content).toContain('  - "math-knowledge-001"');
        expect(content).toContain('tags:\n  - "review"');
        expect(randomUuid).toHaveBeenCalledTimes(1);
    });

    test("cancellation before confirmation performs zero writes", async () => {
        const harness = setupManager();
        await harness.manager.captureImageEvidence();
        expect(prepareMock).not.toHaveBeenCalled();
        expect(harness.vault.createFolder).not.toHaveBeenCalled();
        expect(harness.vault.create).not.toHaveBeenCalled();
        expect(commitMock).not.toHaveBeenCalled();
        expectNoAuthorityWrites(harness);
    });

    test("attachment failure creates no note or event", async () => {
        const harness = setupManager();
        const options = await optionsFor(harness);
        const planned = await options.onPlan({
            file: fakeSelectedFile(),
            subject: "数学",
            title: "附件失败",
            knowledgeId: "math-knowledge-001",
        });
        commitMock.mockRejectedValueOnce(new Error("attachment failed"));
        await expect(options.onCommit(planned.plan)).rejects.toThrow(/attachment failed/);
        expect(harness.vault.create).not.toHaveBeenCalled();
        expectNoAuthorityWrites(harness);
    });

    test("proven-absent note failure rolls back only newly owned attachment", async () => {
        const harness = setupManager();
        harness.vault.createError = new Error("note create failed");
        const options = await optionsFor(harness);
        const planned = await options.onPlan({
            file: fakeSelectedFile(),
            subject: "数学",
            title: "笔记失败",
            knowledgeId: "math-knowledge-001",
        });
        await expect(options.onCommit(planned.plan)).rejects.toThrow(/确认不存在/);
        expect(rollbackMock).toHaveBeenCalledWith(
            harness.vault,
            expect.objectContaining({ disposition: "newly_created_by_current_operation" }),
        );
        expectNoAuthorityWrites(harness);
    });

    test("failed note creation preserves reused attachments", async () => {
        const harness = setupManager();
        const reused = makePrepared("数学", "reused_existing");
        prepareMock.mockResolvedValueOnce(reused);
        commitMock.mockResolvedValueOnce({
            disposition: "reused_existing",
            path: reused.attachmentPath,
            file: new RuntimeTFile(reused.attachmentPath, reused.byteLength),
        });
        harness.vault.createError = new Error("note create failed");
        const options = await optionsFor(harness);
        const planned = await options.onPlan({
            file: fakeSelectedFile(),
            subject: "数学",
            title: "复用附件",
            knowledgeId: "math-knowledge-001",
        });
        await expect(options.onCommit(planned.plan)).rejects.toThrow(/复用|reused/);
        expect(rollbackMock).toHaveBeenCalledWith(
            harness.vault,
            expect.objectContaining({ disposition: "reused_existing" }),
        );
        expect(harness.vault.trash).not.toHaveBeenCalled();
    });

    test("ambiguous or identical note results are classified and preserved", async () => {
        const ambiguous = setupManager();
        ambiguous.vault.createError = new Error("ambiguous create");
        ambiguous.vault.beforeCreateError = (path) => {
            ambiguous.vault.entries.set(path, new RuntimeTFolder(path));
        };
        const ambiguousOptions = await optionsFor(ambiguous);
        const ambiguousPlan = await ambiguousOptions.onPlan({
            file: fakeSelectedFile(),
            subject: "数学",
            title: "歧义",
            knowledgeId: "math-knowledge-001",
        });
        await expect(ambiguousOptions.onCommit(ambiguousPlan.plan)).rejects.toThrow(/文件夹/);
        expect(rollbackMock).not.toHaveBeenCalled();
        expect(ambiguous.vault.trash).not.toHaveBeenCalled();

        jest.clearAllMocks();
        prepareMock.mockImplementation(async (_vault, _file, subject) => makePrepared(subject));
        revalidateMock.mockResolvedValue({
            managedFileCount: 0,
            sameSizeCandidateCount: 0,
            exactMatchPaths: [],
            sourceHintWarnings: [],
        });
        commitMock.mockImplementation(async (_vault, prepared) => ({
            disposition: prepared.disposition,
            path: prepared.attachmentPath,
            file: new RuntimeTFile(prepared.attachmentPath, prepared.byteLength),
        }));
        const identical = setupManager();
        identical.vault.createError = new Error("create reported failure");
        const identicalOptions = await optionsFor(identical);
        const identicalPlan = await identicalOptions.onPlan({
            file: fakeSelectedFile(),
            subject: "数学",
            title: "内容一致",
            knowledgeId: "math-knowledge-001",
        });
        identical.vault.beforeCreateError = (path, content) => {
            identical.vault.entries.set(path, new RuntimeTFile(path, content.length));
            identical.vault.contents.set(path, content);
        };
        await expect(identicalOptions.onCommit(identicalPlan.plan)).rejects.toThrow(/完全一致/);
        expect(rollbackMock).not.toHaveBeenCalled();
        expect(identical.vault.trash).not.toHaveBeenCalled();
    });

    test("index and open failures preserve the note and attachment", async () => {
        const indexFailure = setupManager();
        indexFailure.dataManager.indexGaokaoFrontmatter.mockImplementation(() => {
            throw new Error("index failed");
        });
        const indexOptions = await optionsFor(indexFailure);
        const indexPlan = await indexOptions.onPlan({
            file: fakeSelectedFile(),
            subject: "数学",
            title: "索引失败",
            knowledgeId: "math-knowledge-001",
        });
        await expect(indexOptions.onCommit(indexPlan.plan)).rejects.toThrow(/已创建并保留/);
        expect(indexFailure.vault.entries.has((indexPlan.plan as FrozenCapturePlan).notePath)).toBe(
            true,
        );
        expect(rollbackMock).not.toHaveBeenCalled();

        jest.clearAllMocks();
        prepareMock.mockImplementation(async (_vault, _file, subject) => makePrepared(subject));
        revalidateMock.mockResolvedValue({
            managedFileCount: 0,
            sameSizeCandidateCount: 0,
            exactMatchPaths: [],
            sourceHintWarnings: [],
        });
        commitMock.mockImplementation(async (_vault, prepared) => ({
            disposition: prepared.disposition,
            path: prepared.attachmentPath,
            file: new RuntimeTFile(prepared.attachmentPath, prepared.byteLength),
        }));
        const openFailure = setupManager();
        openFailure.openFile.mockRejectedValueOnce(new Error("open failed"));
        const openOptions = await optionsFor(openFailure);
        const openPlan = await openOptions.onPlan({
            file: fakeSelectedFile(),
            subject: "生物",
            title: "打开失败",
            knowledgeId: "biology-knowledge-001",
        });
        await expect(openOptions.onCommit(openPlan.plan)).rejects.toThrow(/打开失败/);
        expect(openFailure.vault.entries.has((openPlan.plan as FrozenCapturePlan).notePath)).toBe(
            true,
        );
        expect(rollbackMock).not.toHaveBeenCalled();
        expect(
            (openFailure.vault as unknown as { removeFolder?: unknown }).removeFolder,
        ).toBeUndefined();
    });

    test("serializes duplicate submissions with the existing operation guard", async () => {
        const harness = setupManager();
        let resolveCapture: ((result: "cancelled") => void) | undefined;
        captureSpy.mockImplementationOnce(
            async () =>
                await new Promise<"cancelled">((resolve) => {
                    resolveCapture = resolve;
                }),
        );
        const first = harness.manager.captureImageEvidence();
        await tick();
        await harness.manager.captureImageEvidence();
        expect(captureSpy).toHaveBeenCalledTimes(1);
        expect(noticeMock).toHaveBeenCalledWith(expect.stringMatching(/另一条图片证据捕获/), 10000);
        resolveCapture?.("cancelled");
        await first;
    });

    test("visibly discloses multiple exact duplicate paths in final confirmation", async () => {
        captureSpy.mockRestore();
        const duplicatePaths = [
            `资源/图片/数学/2025/01/${"a".repeat(64)}.jpg`,
            `资源/图片/生物/2025/02/${"a".repeat(64)}.jpg`,
        ];
        const capturePromise = GaokaoImageEvidenceModal.capture({} as never, {
            knowledgePoints: [
                {
                    id: "math-knowledge-001",
                    path: "数学/知识点/函数.md",
                    subject: "数学",
                },
            ],
            onPlan: async (_draft) => ({
                confirmation: {
                    subject: "数学",
                    knowledgeId: "math-knowledge-001",
                    knowledgePath: "数学/知识点/函数.md",
                    attachmentDisposition: "reused_existing",
                    attachmentPath: duplicatePaths[0],
                    notePath: "数学/代表题/重复披露.md",
                    sha256: "a".repeat(64),
                    byteLength: 9,
                    canonicalKind: "jpeg",
                    capturedYear: "2026",
                    capturedMonth: "08",
                    sourceHintWarnings: [],
                    duplicateRisk: { exactMatchPaths: duplicatePaths },
                } as unknown as GaokaoImageEvidenceConfirmation,
                plan: {},
            }),
            onCommit: async () => undefined,
        });
        const fileInput = document.querySelector('input[type="file"]');
        if (!(fileInput instanceof HTMLInputElement)) throw new Error("missing file input");
        Object.defineProperty(fileInput, "files", {
            configurable: true,
            value: [fakeSelectedFile()],
        });
        fileInput.dispatchEvent(new Event("change"));
        const titleInput = document.querySelector('input[type="text"]');
        if (!(titleInput instanceof HTMLInputElement)) throw new Error("missing title input");
        titleInput.value = "重复披露";
        titleInput.dispatchEvent(new Event("input"));
        const selects = document.querySelectorAll("select");
        const knowledgeSelect = selects[1];
        if (!(knowledgeSelect instanceof HTMLSelectElement)) {
            throw new Error("missing knowledge select");
        }
        knowledgeSelect.value = "math-knowledge-001";
        knowledgeSelect.dispatchEvent(new Event("change"));
        findButton("生成确认计划").click();
        await tick();
        const visibleConfirmation = document.body.textContent ?? "";
        findButton("取消").click();
        await capturePromise;

        expect(visibleConfirmation).toContain(duplicatePaths[0]);
        expect(visibleConfirmation).toContain(duplicatePaths[1]);
    });
});
