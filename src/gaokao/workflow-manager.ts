/* eslint-disable camelcase -- Event inputs use the persisted snake_case contract. */

import { normalizePath, Notice, TFile, TFolder } from "obsidian";
import { RoundTarget } from "src/gaokao/gaokao-manager";
import { RoundCompletionInput, RoundState } from "src/gaokao/review-flow";
import { inspectR1Text, planRoundPresentation, RoundPresentation } from "src/gaokao/review-presentation";

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
    calculateGaokaoImageSha256, canonicalExtensionForImageKind, detectGaokaoImageKind,
    GAOKAO_IMAGE_MAX_BYTES, gaokaoImageBytesEqual, isCanonicalGaokaoImagePath,
} from "src/gaokao/image-evidence";
import { LearningEventType, ReviewRating } from "src/gaokao/learning-event";
import { GaokaoEntity, GaokaoSubject } from "src/gaokao/schema";
import {
    buildGaokaoNote,
    createGaokaoImageBodyEvidence,
    GaokaoNoteTemplateId,
    generateGaokaoId,
    getGaokaoNoteTemplate,
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
    GaokaoRoundChoiceModal, GaokaoRoundResultModal,
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

interface GaokaoImageCapturePlan {
    readonly image: PreparedGaokaoImageEvidence;
    readonly subject: GaokaoImageSubject;
    readonly title: string;
    readonly knowledgeId: string;
    readonly knowledgePath: string;
    readonly templateId: GaokaoNoteTemplateId;
    readonly folder: string;
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
    private readonly presentation: RoundPresentation;

    constructor(plugin: SRPlugin) {
        this.plugin = plugin;
        this.presentation = new RoundPresentation(plugin.app);
        plugin.register(() => this.presentation.dispose());
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
                    const generated = buildGaokaoNote({ ...input, roundFlow: true });
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
                    new Notice(`GAOKAO：已创建 ${file.path}。R1 待完成：准备来源后从 Today 或记录入口确认。`);
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
        const template = this.getImageTemplateDefinition(draft.subject, draft.templateId);
        const knowledge =
            template.entityType === "problem_case"
                ? this.resolveImageKnowledgePoint(draft.knowledgeId, draft.subject)
                : null;
        const gaokaoId = generateGaokaoId(template.id);
        const existingIdPaths = this.plugin.dataManager.getGaokaoIdPaths(gaokaoId);
        if (existingIdPaths.length > 0) {
            throw new Error(
                `新生成的 gaokao_id 已存在于：${existingIdPaths.join(", ")}。未生成替代 ID。`,
            );
        }
        const reviewTag = this.getDefaultReviewTag();
        const requestedNotePath = `${template.defaultFolder}/${title}.md`;
        const notePath = this.findAvailableNotePath(requestedNotePath);
        const generated = buildGaokaoNote({
            roundFlow: true,
            templateId: template.id,
            gaokaoId,
            title,
            folder: template.defaultFolder,
            source: "image_capture",
            knowledgeIds: knowledge === null ? [] : [knowledge.id],
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
            knowledgeId: knowledge?.id ?? "",
            knowledgePath: knowledge?.path ?? "",
            templateId: template.id,
            folder: template.defaultFolder,
            reviewTag,
            gaokaoId,
            notePath,
            frontmatter: freezeFrontmatter(generated.frontmatter),
            noteContent: generated.content,
        });
        return Object.freeze({
            confirmation: Object.freeze({
                subject: plan.subject,
                templateId: template.id,
                templateLabel: template.label,
                entityType: template.entityType,
                folder: template.defaultFolder,
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
        const template = this.getImageTemplateDefinition(plan.subject, plan.templateId);
        if (plan.folder !== template.defaultFolder) {
            throw new Error("已确认模板的目标目录与当前权威模板不一致。未写入任何内容。");
        }
        const knowledge =
            template.entityType === "problem_case"
                ? this.resolveImageKnowledgePoint(
                      plan.knowledgeId,
                      plan.subject,
                      plan.knowledgePath,
                  )
                : null;
        if (
            template.entityType === "knowledge_point" &&
            (plan.knowledgeId.length > 0 || plan.knowledgePath.length > 0)
        ) {
            throw new Error("知识类模板不接受题例知识点关联。未写入任何内容。");
        }
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
            roundFlow: true,
            templateId: template.id,
            gaokaoId: plan.gaokaoId,
            title: plan.title,
            folder: plan.folder,
            source: "image_capture",
            knowledgeIds: knowledge === null ? [] : [knowledge.id],
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
            this.plugin.dataManager.indexGaokaoFrontmatter(noteFile.path, plan.frontmatter);
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
        new Notice(`GAOKAO：已创建 ${noteFile.path}｜${disposition} ${attachment.path}。来源已准备，R1 尚待确认。`);
        // Preparation succeeded. Cancellation/failure below must not re-create or delete either resource.
        await this.startRound(plan.gaokaoId);
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

    private getImageTemplateDefinition(
        subject: GaokaoImageSubject,
        templateId: GaokaoNoteTemplateId,
    ) {
        const template = getGaokaoNoteTemplate(templateId);
        if (template.subject !== subject) {
            throw new Error(`模板 ${templateId} 不属于当前科目 ${subject}。`);
        }
        return template;
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
        const choice = await GaokaoRoundChoiceModal.choose(this.plugin.app, "GAOKAO 记录", "完成本轮与普通历史记录分别提交；普通记录不推进 Round。", [
            ["round", "完成本轮（评分可不选）"], ["ordinary", "仅记录普通历史事件"],
        ]);
        if (choice === null) return;
        if (choice === "round") { await this.openRoundEntry(current.entity.gaokao_id); return; }
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

    async startRound(entityId: string, userRating?: ReviewRating): Promise<void> {
        try {
            if (this.plugin.dataManager.data.gaokao.pendingRoundCommit) { await this.showRoundRecovery(); return; }
            const target = await this.plugin.dataManager.resolveRoundTarget(entityId);
            const derived = this.plugin.dataManager.gaokaoManager.getRoundState(entityId);
            if (derived.ok === false) throw new Error(derived.issue);
            const state = derived.state;
            if (state.round === "R2" || state.round === "R3") {
                const file = this.plugin.app.vault.getAbstractFileByPath(target.path);
                if (!(file instanceof TFile) || !state.cycleRef) throw new Error("展示目标或周期不可用。");
                const parsed = planRoundPresentation(await this.plugin.app.vault.read(file), file.basename, state.round);
                if (parsed.ok === false) throw new Error(parsed.issue);
                const choice = await GaokaoRoundChoiceModal.choose(this.plugin.app, `${state.round}｜展示前确认`,
                    state.round === "R2"
                        ? "请确认准备阶段已核对：Identity 无答案，Source 仅现实位置/链接，Prompt 是无答案题面或纸面任务。完整原图及解答会默认折叠。"
                        : "请确认准备阶段已核对：Identity 无答案，Source 仅现实位置/链接，Cues 是 3–5 个短关键词。其余内容默认折叠。",
                    [["ready", "已确认，开始本轮"]]);
                if (choice !== "ready") return;
                await this.presentation.open(file, entityId, state.cycleRef, state.round,
                    async () => await this.showRoundResult(entityId, state, userRating));
            } else {
                await this.showRoundResult(entityId, state, userRating);
            }
        } catch (error: unknown) { new Notice(messageFromError(error, "流程会话未就绪。"), 10000); }
    }

    async openRoundEntry(entityId: string, userRating?: ReviewRating): Promise<void> {
        if (this.plugin.dataManager.data.gaokao.pendingRoundCommit) { await this.showRoundRecovery(); return; }
        const derived = this.plugin.dataManager.gaokaoManager.getRoundState(entityId);
        if (derived.ok === false) { new Notice(derived.issue, 10000); return; }
        if (derived.state.round === "R2" || derived.state.round === "R3") {
            try { await this.presentation.assertReady(entityId, derived.state.cycleRef); }
            catch { await this.startRound(entityId, userRating); return; }
        }
        await this.showRoundResult(entityId, derived.state, userRating);
    }

    private async showRoundResult(entityId: string, state: RoundState, userRating?: ReviewRating): Promise<void> {
        try {
            const target = await this.plugin.dataManager.resolveRoundTarget(entityId);
            const resolved = this.plugin.dataManager.resolveGaokaoEntity(entityId);
            const file = this.plugin.app.vault.getAbstractFileByPath(target.path);
            if (!resolved || !(file instanceof TFile)) throw new Error("目标身份已改变。");
            if (state.round === "R2" || state.round === "R3") await this.presentation.assertReady(entityId, state.cycleRef);
            const source = state.round === "R1" ? await this.verifyR1Source(target) : undefined;
            const practiceHint = state.round === "R4" ? inspectR1Text(await this.plugin.app.vault.read(file)).variantPool : undefined;
            new GaokaoRoundResultModal(this.plugin.app, {
                entityId, state, title: file.basename, subject: resolved.entity.subject, userRating,
                sourceSummary: source?.summary, expectedSourceText: source?.text, expectedPath: target.path,
                practiceHint,
                history: this.plugin.dataManager.getGaokaoEventHistory(entityId),
                onSubmit: async (input) => {
                    const result = await this.plugin.dataManager.completeRound(input);
                    this.plugin.refreshGaokaoToday();
                    if (result.status !== "committed") throw new Error(result.issue);
                    this.presentation.clear(entityId);
                    new Notice(result.refreshIssue ?? "本轮已记录；下一行为由事件链推导，排期沿用原 scheduler。", 10000);
                    if (!result.refreshIssue && this.plugin.dataManager.data.settings.autoNextNote) {
                        // Defer until the result dialog closes; navigation never invokes scoring.
                        window.setTimeout(() => { void this.plugin.nextNoteReviewHandler.autoReviewNextNote(); }, 0);
                    }
                },
            }).open();
        } catch (error: unknown) { new Notice(messageFromError(error, "完成界面未就绪。"), 10000); }
    }

    async validateRoundAction(target: RoundTarget, input: RoundCompletionInput): Promise<void> {
        const derived = this.plugin.dataManager.gaokaoManager.getRoundState(input.entityId);
        if (derived.ok === false || derived.state.cycleRef !== input.expectedCycleRef) throw new Error("行动周期已改变。");
        const resolved = this.plugin.dataManager.resolveGaokaoEntity(input.entityId);
        if (input.expectedPath !== target.path || input.expectedSubject !== resolved?.entity.subject) throw new Error("打开结果界面后目标路径或学科已改变，请重新确认。");
        if (derived.state.round === "R1") {
            const source = await this.verifyR1Source(target);
            if (source.text !== input.expectedSourceText) throw new Error("R1 来源在结果界面打开后改变，请重新确认。");
        }
        if (derived.state.round === "R2" || derived.state.round === "R3") await this.presentation.assertReady(input.entityId, input.expectedCycleRef);
    }

    private async verifyR1Source(target: RoundTarget): Promise<{ summary: string; text: string }> {
        const file = this.plugin.app.vault.getAbstractFileByPath(target.path);
        if (!(file instanceof TFile)) throw new Error("R1 材料目标不可读。");
        const text = await this.plugin.app.vault.read(file);
        const { body, source, prompt, images } = inspectR1Text(text);
        if (/!\[(?!\[)|<(?:img|iframe)/i.test(body)) throw new Error("R1 含尚未通过本地图片证据规则确认的嵌入，请先人工准备。");
        if (!source && !prompt && images.length === 0) throw new Error("R1 待入库：来源或题面尚未实际关联，请先准备材料。");
        for (const match of `${source}\n${prompt}`.matchAll(/(?<!!)\[\[([^\]\n]+)\]\]/g)) {
            const link = match[1].split("|")[0].split("#")[0];
            const linked = this.plugin.app.vault.getAbstractFileByPath(link) ??
                this.plugin.app.metadataCache.getFirstLinkpathDest(link, target.path);
            if (!(linked instanceof TFile)) throw new Error("R1 来源中的本地链接尚未成功关联。");
            if (linked.extension === "md") await this.plugin.app.vault.read(linked);
            else await this.plugin.app.vault.readBinary(linked);
        }
        for (const path of images) {
            const imageFile = this.plugin.app.vault.getAbstractFileByPath(path);
            if (!(imageFile instanceof TFile)) throw new Error("R1 图片附件不可读。");
            const bytes = await this.plugin.app.vault.readBinary(imageFile);
            if (!bytes.byteLength || bytes.byteLength > GAOKAO_IMAGE_MAX_BYTES) throw new Error("R1 图片为空或超限。");
            const kind = detectGaokaoImageKind(new Uint8Array(bytes));
            const sha = await calculateGaokaoImageSha256(bytes);
            if (!isCanonicalGaokaoImagePath(path, sha, canonicalExtensionForImageKind(kind)) ||
                !body.includes(`SHA-256: ${sha}`)) throw new Error("R1 图片路径、字节签名或已保留的 SHA 不符。");
            const reread = await this.plugin.app.vault.readBinary(imageFile);
            if (!gaokaoImageBytesEqual(new Uint8Array(bytes), new Uint8Array(reread))) throw new Error("R1 图片在确认期间改变。");
        }
        if (await this.plugin.app.vault.read(file) !== text) throw new Error("R1 来源在确认期间改变。");
        return { text, summary: `已读到关联材料；${images.length ? `${images.length} 个受管原图已核对字节与 SHA。` : "无嵌入原图。"}请确认材料、学科与目标后完成。` };
    }

    async showRoundRecovery(): Promise<void> {
        const recovery = await this.plugin.dataManager.inspectRoundRecovery();
        const choices: [string, string][] = recovery.position === "before" ? [["continue", "继续原候选（不重新评分）"]]
            : recovery.position === "after" || recovery.position === "committed" ? [["record", "仅完成固定 ID 的记录核对"]] : [];
        const choice = await GaokaoRoundChoiceModal.choose(this.plugin.app, "未确认提交", recovery.issue, choices);
        if (!choice || !recovery.pending) return;
        const result = await this.plugin.dataManager.recoverRound(recovery.pending.event.event_id, choice as "continue" | "record");
        this.plugin.refreshGaokaoToday();
        new Notice(result.status === "committed" ? result.refreshIssue ?? "同一提交已完成核对。" : result.issue, 10000);
    }

    async routeReviewNavigation(file: TFile): Promise<boolean> {
        const inspection = this.plugin.dataManager.inspectGaokaoFile(file);
        if (inspection.status === "ordinary") return false;
        if (inspection.status !== "valid" || !inspection.entity) { new Notice("GAOKAO 身份无效，未打开复习正文。", 10000); return true; }
        const state = this.plugin.dataManager.gaokaoManager.getRoundState(inspection.entity.gaokao_id);
        if (state.ok === false) { new Notice(state.issue, 10000); return true; }
        if (state.state.cycleRef === null && this.plugin.dataManager.data.gaokao.pendingRoundCommit?.event.entity_id !== inspection.entity.gaokao_id) return false;
        await this.startRound(inspection.entity.gaokao_id);
        return true;
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
            new Notice("GAOKAO：事件保存未确认，请先核对历史；不能据此认定没有落盘。", 10000);
        } else {
            new Notice(`GAOKAO：学习事件未记录（${status}）。`, 10000);
        }
    }
}
