/* eslint-disable camelcase -- Event inputs use the persisted snake_case contract. */

import { normalizePath, Notice, TFile, TFolder } from "obsidian";

import {
    formatEventConfirmation,
    GaokaoFeedback,
    GaokaoSubmissionGuard,
} from "src/gaokao/feedback";
import {
    assertGaokaoImageFolderState,
    commitPreparedGaokaoImageEvidence,
    CommittedGaokaoImageAttachment,
    GaokaoImageSubject,
    PreparedGaokaoImageEvidence,
    prepareGaokaoImageEvidence,
    revalidatePreparedGaokaoImageEvidence,
    rollbackGaokaoImageAttachment,
} from "src/gaokao/image-evidence";
import { LearningEventType, ReviewRating } from "src/gaokao/learning-event";
import { GaokaoEntity, GaokaoSubject } from "src/gaokao/schema";
import {
    buildGaokaoNote,
    createGaokaoImageBodyEvidence,
    GaokaoNoteTemplateId,
    generateGaokaoId,
    validateGaokaoNoteTitle,
} from "src/gaokao/workflow";
import SRPlugin from "src/main";
import {
    GaokaoImageEvidenceDraft,
    GaokaoImageEvidenceKnowledgeChoice,
    GaokaoImageEvidenceModal,
    GaokaoImageEvidenceModalPlan,
} from "src/ui/obsidian-ui-components/modals/gaokao-image-evidence-modal";
import {
    GaokaoEventTypeModal,
    GaokaoFeedbackModal,
    GaokaoKnowledgePointChoice,
    GaokaoNoteCreationModal,
    GaokaoRecentEventsModal,
} from "src/ui/obsidian-ui-components/modals/gaokao-workflow-modal";

export interface GaokaoReviewFeedbackRequest {
    notePath: string;
    subject: GaokaoSubject;
    rating: ReviewRating;
    visibleRating: string;
}

interface GaokaoResolvedImageKnowledgePoint {
    readonly id: string;
    readonly path: string;
    readonly subject: GaokaoImageSubject;
}

interface GaokaoImageWorkflowDefinition {
    readonly templateId: Extract<GaokaoNoteTemplateId, "math_problem" | "biology_problem_answer">;
    readonly folder: "数学/代表题" | "生物/问题与答案";
}

interface GaokaoImageCapturePlan {
    readonly image: PreparedGaokaoImageEvidence;
    readonly subject: GaokaoImageSubject;
    readonly title: string;
    readonly knowledgeId: string;
    readonly knowledgePath: string;
    readonly templateId: GaokaoImageWorkflowDefinition["templateId"];
    readonly folder: GaokaoImageWorkflowDefinition["folder"];
    readonly reviewTag: string;
    readonly gaokaoId: string;
    readonly notePath: string;
    readonly frontmatter: Readonly<Record<string, unknown>>;
    readonly noteContent: string;
}

function freezeFrontmatter(
    frontmatter: Record<string, unknown>,
): Readonly<Record<string, unknown>> {
    const frozen: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(frontmatter)) {
        frozen[key] = Array.isArray(value) ? Object.freeze([...value]) : value;
    }
    return Object.freeze(frozen);
}

function messageFromError(error: unknown, fallback: string): string {
    return error instanceof Error ? error.message : fallback;
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

export class GaokaoWorkflowManager {
    private readonly plugin: SRPlugin;
    private readonly submissionGuard = new GaokaoSubmissionGuard();

    constructor(plugin: SRPlugin) {
        this.plugin = plugin;
    }

    async captureReviewFeedback(
        request: GaokaoReviewFeedbackRequest,
    ): Promise<GaokaoFeedback | null> {
        if (request.rating === "good" || request.rating === "easy") {
            return {};
        }
        return await GaokaoFeedbackModal.capture(this.plugin.app, {
            notePath: request.notePath,
            visibleRating: request.visibleRating,
            context: "review",
        });
    }

    createLearningNote(): void {
        const choices: GaokaoKnowledgePointChoice[] = this.plugin.dataManager
            .getGaokaoKnowledgePoints()
            .map((item) => ({
                id: item.entity.gaokao_id,
                path: item.path,
                subject: item.entity.subject,
            }));

        const modal = new GaokaoNoteCreationModal(this.plugin.app, {
            knowledgePoints: choices,
            reviewTag: this.getDefaultReviewTag(),
            onSubmit: async (input) => {
                const guarded = await this.submissionGuard.run("create-note", async () => {
                    const generated = buildGaokaoNote(input);
                    const existingIdPaths = this.plugin.dataManager.getGaokaoIdPaths(
                        generated.entity.gaokao_id,
                    );
                    if (existingIdPaths.length > 0) {
                        throw new Error(
                            `gaokao_id 已存在于：${existingIdPaths.join(", ")}。未创建重复实体。`,
                        );
                    }

                    const notePath = this.findAvailableNotePath(generated.path);
                    await this.ensureFolder(notePath.slice(0, notePath.lastIndexOf("/")));
                    const file = await this.plugin.app.vault.create(notePath, generated.content);
                    this.plugin.dataManager.indexGaokaoFrontmatter(
                        file.path,
                        generated.frontmatter,
                    );
                    await this.plugin.app.workspace.getLeaf().openFile(file);
                    new Notice(`GAOKAO：已创建 ${file.path}`);
                });
                if (guarded.status === "duplicate") {
                    throw new Error("另一条 GAOKAO 笔记正在创建，请稍候。");
                }
            },
        });
        modal.open();
    }

    async captureImageEvidence(): Promise<void> {
        if (!this.plugin.isInitialized) return;
        try {
            const guarded = await this.submissionGuard.run("capture-image-evidence", async () => {
                const knowledgePoints: GaokaoImageEvidenceKnowledgeChoice[] = [];
                for (const item of this.plugin.dataManager.getGaokaoKnowledgePoints()) {
                    if (item.entity.subject !== "数学" && item.entity.subject !== "生物") continue;
                    knowledgePoints.push({
                        id: item.entity.gaokao_id,
                        path: item.path,
                        subject: item.entity.subject,
                    });
                }
                await GaokaoImageEvidenceModal.capture(this.plugin.app, {
                    knowledgePoints,
                    onPlan: async (draft) => await this.planImageEvidenceCapture(draft),
                    onCommit: async (plan) => await this.commitImageEvidenceCapture(plan),
                });
            });
            if (guarded.status === "duplicate") {
                new Notice("GAOKAO：另一条图片证据捕获正在进行，请先完成或取消。", 10000);
            }
        } catch (error: unknown) {
            new Notice(messageFromError(error, "GAOKAO 图片证据捕获失败。"), 10000);
        }
    }

    private async planImageEvidenceCapture(
        draft: GaokaoImageEvidenceDraft,
    ): Promise<GaokaoImageEvidenceModalPlan<GaokaoImageCapturePlan>> {
        const image = await prepareGaokaoImageEvidence(
            this.plugin.app.vault,
            draft.file,
            draft.subject,
        );
        const title = validateGaokaoNoteTitle(draft.title);
        const knowledge = this.resolveImageKnowledgePoint(draft.knowledgeId, draft.subject);
        const workflow = this.getImageWorkflowDefinition(draft.subject);
        const gaokaoId = generateGaokaoId(workflow.templateId);
        const existingIdPaths = this.plugin.dataManager.getGaokaoIdPaths(gaokaoId);
        if (existingIdPaths.length > 0) {
            throw new Error(
                `新生成的 gaokao_id 已存在于：${existingIdPaths.join(", ")}。未生成替代 ID。`,
            );
        }
        const reviewTag = this.getDefaultReviewTag();
        const requestedNotePath = `${workflow.folder}/${title}.md`;
        const notePath = this.findAvailableNotePath(requestedNotePath);
        const generated = buildGaokaoNote({
            templateId: workflow.templateId,
            gaokaoId,
            title,
            folder: workflow.folder,
            source: "image_capture",
            knowledgeIds: [knowledge.id],
            reviewTag,
            bodyEvidence: createGaokaoImageBodyEvidence(image.attachmentPath, image.sha256),
        });
        if (generated.path !== requestedNotePath) {
            throw new Error("既有模板生成的笔记路径与已验证的计划路径不一致。");
        }
        this.assertFolderCanBeEnsured(notePath.slice(0, notePath.lastIndexOf("/")));
        const plan: GaokaoImageCapturePlan = Object.freeze({
            image,
            subject: draft.subject,
            title,
            knowledgeId: knowledge.id,
            knowledgePath: knowledge.path,
            templateId: workflow.templateId,
            folder: workflow.folder,
            reviewTag,
            gaokaoId,
            notePath,
            frontmatter: freezeFrontmatter(generated.frontmatter),
            noteContent: generated.content,
        });
        return Object.freeze({
            confirmation: Object.freeze({
                subject: plan.subject,
                knowledgeId: plan.knowledgeId,
                knowledgePath: plan.knowledgePath,
                attachmentDisposition: plan.image.disposition,
                attachmentPath: plan.image.attachmentPath,
                notePath: plan.notePath,
                sha256: plan.image.sha256,
                byteLength: plan.image.byteLength,
                canonicalKind: plan.image.kind,
                capturedYear: plan.image.capturedYear,
                capturedMonth: plan.image.capturedMonth,
                duplicateRisk: Object.freeze({
                    exactMatchPaths: Object.freeze([...plan.image.duplicateRisk.exactMatchPaths]),
                }),
                sourceHintWarnings: plan.image.duplicateRisk.sourceHintWarnings,
            }),
            plan,
        });
    }

    private async commitImageEvidenceCapture(plan: GaokaoImageCapturePlan): Promise<void> {
        this.resolveImageKnowledgePoint(plan.knowledgeId, plan.subject, plan.knowledgePath);
        const existingIdPaths = this.plugin.dataManager.getGaokaoIdPaths(plan.gaokaoId);
        if (existingIdPaths.length > 0) {
            throw new Error(
                `已确认 gaokao_id 现已存在于：${existingIdPaths.join(", ")}。未写入任何内容。`,
            );
        }
        await revalidatePreparedGaokaoImageEvidence(this.plugin.app.vault, plan.image);
        assertGaokaoImageFolderState(this.plugin.app.vault, plan.image.attachmentPath);
        this.assertFolderCanBeEnsured(plan.notePath.slice(0, plan.notePath.lastIndexOf("/")));
        if (this.plugin.app.vault.getAbstractFileByPath(plan.notePath) !== null) {
            throw new Error(`已确认笔记路径 ${plan.notePath} 现已被占用。未写入任何内容。`);
        }
        const rebuilt = buildGaokaoNote({
            templateId: plan.templateId,
            gaokaoId: plan.gaokaoId,
            title: plan.title,
            folder: plan.folder,
            source: "image_capture",
            knowledgeIds: [plan.knowledgeId],
            reviewTag: plan.reviewTag,
            bodyEvidence: createGaokaoImageBodyEvidence(
                plan.image.attachmentPath,
                plan.image.sha256,
            ),
        });
        if (
            rebuilt.content !== plan.noteContent ||
            JSON.stringify(rebuilt.frontmatter) !== JSON.stringify(plan.frontmatter)
        ) {
            throw new Error("已确认的完整笔记内容或 frontmatter 无法原样重建。未写入任何内容。");
        }

        const attachment = await commitPreparedGaokaoImageEvidence(
            this.plugin.app.vault,
            plan.image,
        );
        if (attachment.path !== plan.image.attachmentPath) {
            throw new Error(`附件提交返回未确认路径 ${attachment.path}；笔记未创建，附件已保留。`);
        }

        let noteFile: TFile;
        try {
            await this.ensureFolder(plan.notePath.slice(0, plan.notePath.lastIndexOf("/")));
            if (this.plugin.app.vault.getAbstractFileByPath(plan.notePath) !== null) {
                throw new Error(`已确认笔记路径 ${plan.notePath} 在提交期间被占用。`);
            }
            noteFile = await this.plugin.app.vault.create(plan.notePath, plan.noteContent);
            if (noteFile.path !== plan.notePath) {
                throw new Error(`Vault 返回了未确认的笔记路径 ${noteFile.path}。`);
            }
        } catch (error: unknown) {
            return await this.failAfterNoteCreationError(plan, attachment, error);
        }

        try {
            this.plugin.dataManager.indexGaokaoFrontmatter(
                noteFile.path,
                plan.frontmatter as Record<string, unknown>,
            );
        } catch (error: unknown) {
            throw errorWithCause(
                `笔记 ${noteFile.path} 与附件 ${attachment.path} 已创建并保留，但索引失败：${messageFromError(
                    error,
                    "未知索引错误",
                )}`,
                error,
            );
        }
        try {
            await this.plugin.app.workspace.getLeaf().openFile(noteFile);
        } catch (error: unknown) {
            throw errorWithCause(
                `笔记 ${noteFile.path} 与附件 ${attachment.path} 已创建、索引并保留，但打开失败：${messageFromError(
                    error,
                    "未知导航错误",
                )}`,
                error,
            );
        }
        const disposition =
            attachment.disposition === "reused_existing" ? "复用现有附件" : "新建附件";
        new Notice(`GAOKAO：已创建 ${noteFile.path}｜${disposition} ${attachment.path}`);
    }

    private resolveImageKnowledgePoint(
        knowledgeId: string,
        subject: GaokaoImageSubject,
        expectedPath?: string,
    ): GaokaoResolvedImageKnowledgePoint {
        if (knowledgeId.trim().length === 0) throw new Error("必须选择一个关联知识点。");
        const matches = this.plugin.dataManager
            .getGaokaoKnowledgePoints()
            .filter((item) => item.entity.gaokao_id === knowledgeId);
        const candidatePaths = this.plugin.dataManager.getGaokaoIdPaths(knowledgeId);
        if (matches.length !== 1 || candidatePaths.length !== 1) {
            throw new Error(`知识点 ${knowledgeId} 当前不是唯一有效实体。`);
        }
        const match = matches[0];
        if (match.entity.entity_type !== "knowledge_point" || match.entity.subject !== subject) {
            throw new Error(`知识点 ${knowledgeId} 不是当前科目的有效 knowledge_point。`);
        }
        if (candidatePaths[0] !== match.path) {
            throw new Error(`知识点 ${knowledgeId} 的注册路径状态不一致。`);
        }
        if (expectedPath !== undefined && match.path !== expectedPath) {
            throw new Error(
                `知识点 ${knowledgeId} 已从确认路径 ${expectedPath} 变为 ${match.path}。未写入任何内容。`,
            );
        }
        return { id: match.entity.gaokao_id, path: match.path, subject };
    }

    private getImageWorkflowDefinition(subject: GaokaoImageSubject): GaokaoImageWorkflowDefinition {
        if (subject === "数学") {
            return { templateId: "math_problem", folder: "数学/代表题" };
        }
        if (subject === "生物") {
            return { templateId: "biology_problem_answer", folder: "生物/问题与答案" };
        }
        throw new Error("图片证据首个实现切片仅支持数学和生物。");
    }

    private assertFolderCanBeEnsured(folderPath: string): void {
        const normalized = normalizePath(folderPath);
        if (normalized.length === 0) return;
        const segments = normalized.split("/");
        let current = "";
        for (const segment of segments) {
            current = current.length === 0 ? segment : `${current}/${segment}`;
            const existing = this.plugin.app.vault.getAbstractFileByPath(current);
            if (existing === null || existing instanceof TFolder) continue;
            throw new Error(`${current} 已存在，但不是文件夹。`);
        }
    }

    private async failAfterNoteCreationError(
        plan: GaokaoImageCapturePlan,
        attachment: CommittedGaokaoImageAttachment,
        cause: unknown,
    ): Promise<never> {
        const causeMessage = messageFromError(cause, "未知笔记创建错误");
        const current = this.plugin.app.vault.getAbstractFileByPath(plan.notePath);
        if (current === null) {
            const rollback = await rollbackGaokaoImageAttachment(this.plugin.app.vault, attachment);
            const orphanSuffix =
                "orphanPath" in rollback ? ` 孤立附件路径：${rollback.orphanPath}。` : "";
            throw new Error(
                `笔记路径 ${plan.notePath} 确认不存在。${rollback.detail}${orphanSuffix} 原因：${causeMessage}`,
            );
        }

        if (current instanceof TFile && current.extension.toLowerCase() === "md") {
            let classification: string;
            try {
                const actualContent = await this.plugin.app.vault.read(current);
                classification =
                    actualContent === plan.noteContent
                        ? "存在与确认内容完全一致的 Markdown 文件"
                        : "存在内容不同的 Markdown 文件";
            } catch (error: unknown) {
                classification = `存在 Markdown 文件，但无法读取分类：${messageFromError(
                    error,
                    "未知读取错误",
                )}`;
            }
            throw new Error(
                `笔记创建结果不明确：${plan.notePath} ${classification}。附件 ${attachment.path} 已保留且未删除。原因：${causeMessage}`,
            );
        }
        const objectKind = current instanceof TFolder ? "文件夹" : "未知 Vault 对象";
        throw new Error(
            `笔记创建结果不明确：${plan.notePath} 当前是${objectKind}。附件 ${attachment.path} 已保留且未删除。原因：${causeMessage}`,
        );
    }

    async recordLearningEventForCurrentNote(): Promise<void> {
        const current = this.getCurrentGaokaoEntity();
        if (!current) return;
        const guardKey = `manual-event:${current.entity.gaokao_id}`;
        const guarded = await this.submissionGuard.run(guardKey, async () => {
            const eventType = await GaokaoEventTypeModal.choose(this.plugin.app);
            if (eventType === null) return;
            const feedback = await GaokaoFeedbackModal.capture(this.plugin.app, {
                notePath: current.file.path,
                visibleRating: this.getEventTypeLabel(eventType),
                context: "manual",
            });
            if (feedback === null) return;

            const result = await this.plugin.dataManager.recordGaokaoLearningEvent(current.file, {
                event_type: eventType,
                ...feedback,
            });
            if (result.status === "recorded") {
                new Notice(formatEventConfirmation(eventType, undefined, feedback));
            } else {
                this.showRecordingFailure(result.status);
            }
        });
        if (guarded.status === "duplicate") {
            new Notice("GAOKAO：当前笔记已有一条学习事件正在记录。");
        }
    }

    showRecentEventsForCurrentNote(): void {
        const file = this.plugin.app.workspace.getActiveFile();
        if (!file || file.extension !== "md") return;
        const inspection = this.plugin.dataManager.inspectGaokaoFile(file);
        if (inspection.status !== "valid" || !inspection.entity) {
            new Notice("GAOKAO：当前笔记不是唯一有效的 GAOKAO 实体。");
            return;
        }
        new GaokaoRecentEventsModal(
            this.plugin.app,
            inspection.entity.gaokao_id,
            this.plugin.dataManager.getGaokaoEventHistory(inspection.entity.gaokao_id),
        ).open();
    }

    canRecordCurrentNote(): boolean {
        const file = this.plugin.app.workspace.getActiveFile();
        if (!file || file.extension !== "md" || !this.plugin.isInitialized) return false;
        const inspection = this.plugin.dataManager.inspectGaokaoFile(file);
        return Boolean(inspection.status === "valid" && inspection.entity);
    }

    canShowRecentEventsForCurrentNote(): boolean {
        const file = this.plugin.app.workspace.getActiveFile();
        return Boolean(file && file.extension === "md" && this.plugin.isInitialized);
    }

    private getCurrentGaokaoEntity(): { file: TFile; entity: GaokaoEntity } | null {
        const file = this.plugin.app.workspace.getActiveFile();
        if (!file || file.extension !== "md") return null;
        const inspection = this.plugin.dataManager.inspectGaokaoFile(file);
        if (inspection.status !== "valid" || !inspection.entity) {
            new Notice("GAOKAO：仅唯一有效的 GAOKAO 实体可记录此事件。");
            return null;
        }
        return { file, entity: inspection.entity };
    }

    private getDefaultReviewTag(): string {
        const configured = this.plugin.dataManager.data.settings.tagsToReview[0];
        return configured ?? "review";
    }

    private getEventTypeLabel(eventType: LearningEventType): string {
        if (eventType === "study") return "学习";
        if (eventType === "practice") return "练习";
        if (eventType === "verification") return "再验证";
        return "复习";
    }

    private findAvailableNotePath(requestedPath: string): string {
        const normalized = normalizePath(requestedPath);
        if (this.plugin.app.vault.getAbstractFileByPath(normalized) === null) return normalized;

        const extensionIndex = normalized.toLowerCase().lastIndexOf(".md");
        const base =
            extensionIndex === normalized.length - 3 ? normalized.slice(0, -3) : normalized;
        for (let suffix = 2; suffix <= 999; suffix++) {
            const candidate = `${base} (${suffix}).md`;
            if (this.plugin.app.vault.getAbstractFileByPath(candidate) === null) return candidate;
        }
        throw new Error("同名笔记过多，无法安全选择新文件名。");
    }

    private async ensureFolder(folderPath: string): Promise<void> {
        const normalized = normalizePath(folderPath);
        if (normalized.length === 0) return;
        const segments = normalized.split("/");
        let current = "";
        for (const segment of segments) {
            current = current.length === 0 ? segment : `${current}/${segment}`;
            const existing = this.plugin.app.vault.getAbstractFileByPath(current);
            if (existing instanceof TFolder) continue;
            if (existing !== null) throw new Error(`${current} 已存在，但不是文件夹。`);
            await this.plugin.app.vault.createFolder(current);
        }
    }

    private showRecordingFailure(status: string): void {
        if (status === "persistence_error") {
            new Notice("GAOKAO：data.json 保存失败；本次事件未写入。", 10000);
        } else {
            new Notice(`GAOKAO：学习事件未记录（${status}）。`, 10000);
        }
    }
}
