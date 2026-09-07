/* eslint-disable camelcase -- Feedback uses the persisted snake_case event contract. */

import "src/ui/obsidian-ui-components/modals/gaokao-workflow-modal.css";
import { App, Modal, Setting } from "obsidian";

import { GaokaoFeedback, parseCustomDuration, QUICK_DURATIONS } from "src/gaokao/feedback";
import { LearningEvent, LearningEventType, MistakeType, ReviewRating } from "src/gaokao/learning-event";
import { RoundCompletionInput, RoundState, completionIssue } from "src/gaokao/review-flow";
import { GAOKAO_SUBJECTS, GaokaoSubject } from "src/gaokao/schema";
import {
    GAOKAO_NOTE_TEMPLATES,
    GaokaoNoteTemplateId,
    GaokaoTemplateInput,
    generateGaokaoId,
} from "src/gaokao/workflow";

const MISTAKE_DESCRIPTIONS: readonly [MistakeType, string][] = [
    ["K", "知识｜概念、公式、事实、条件、边界不知道或记错"],
    ["M", "方法｜模型识别、方法选择、解题路径或策略错误"],
    ["P", "过程｜计算、推导、代入、化简、步骤执行错误"],
    ["C", "审题理解｜条件理解、信息提取、题意转换错误"],
    ["R", "提取｜学过，但无法稳定或及时调用"],
];

export class GaokaoRoundChoiceModal extends Modal {
    private settled = false;
    private resolveChoice: (choice: string | null) => void = () => undefined;
    private readonly result: Promise<string | null>;

    static choose(app: App, title: string, detail: string, choices: readonly [string, string][]): Promise<string | null> {
        const modal = new GaokaoRoundChoiceModal(app, title, detail, choices);
        modal.open();
        return modal.result;
    }

    private constructor(app: App, title: string, detail: string, choices: readonly [string, string][]) {
        super(app);
        this.result = new Promise((resolve) => { this.resolveChoice = resolve; });
        this.setTitle(title);
        this.contentEl.createEl("p", { text: detail });
        for (const [value, label] of choices) new Setting(this.contentEl).addButton((button) => {
            button.setButtonText(label).onClick(() => {
                if (this.settled) return;
                this.settled = true; this.resolveChoice(value); this.close();
            });
        });
        new Setting(this.contentEl).addButton((button) => button.setButtonText("取消").onClick(() => this.close()));
    }

    onClose(): void {
        if (!this.settled) { this.settled = true; this.resolveChoice(null); }
        this.contentEl.empty();
    }
}

export interface GaokaoRoundResultOptions {
    entityId: string;
    title: string;
    subject: string;
    state: RoundState;
    history: readonly LearningEvent[];
    userRating?: ReviewRating;
    sourceSummary?: string;
    practiceHint?: string;
    expectedPath: string;
    expectedSourceText?: string;
    onSubmit: (input: RoundCompletionInput) => Promise<void>;
}

/** Closing this modal never submits, including when rating is absent. */
export class GaokaoRoundResultModal extends Modal {
    private readonly input: RoundCompletionInput;
    private evidenceRef = "";
    private performedAt = "";
    private mode: "mixed" | "isolated" | undefined;
    private duration = "";
    private submitting = false;

    constructor(app: App, private readonly options: GaokaoRoundResultOptions) {
        super(app);
        this.input = { entityId: options.entityId, expectedCycleRef: options.state.cycleRef,
            expectedPath: options.expectedPath, expectedSubject: options.subject, expectedSourceText: options.expectedSourceText,
            userRating: options.userRating, actionConfirmed: false,
            presentationConfirmed: options.state.round === "R2" || options.state.round === "R3" };
        this.modalEl.addClass("gaokao-workflow-modal");
        this.setTitle(`${options.state.round}｜完成本轮`);
        this.contentEl.createEl("p", { text: `${options.title} · ${options.subject}\n${options.entityId}` });
        this.contentEl.createEl("p", { text: "完成表示记录真实行动；无评分不表示答对，进入 R5 不表示通过考试。提交前取消或关闭不记录；提交后请等待核对结果。" });
        this.confirm("已完成本轮真实行动（真实失败也可记录）", "actionConfirmed");
        if (options.state.round === "R1") {
            this.contentEl.createEl("p", { text: options.sourceSummary ?? "先确认已落地的来源材料。" });
            this.confirm("确认显示的学科与准确目标 Entity", "subjectConfirmed");
            this.confirm("材料可读，Source、Prompt 或原图已关联到此 Entity", "sourceConfirmed");
            this.confirm("有图时收件原件已保留，未删除、改名或移动（无图也可确认）", "originalRetained");
        }
        new Setting(this.contentEl).setName("可选评分").addDropdown((dropdown) => {
            dropdown.addOption("", "未选择评分");
            for (const rating of ["again", "hard", "good", "easy"]) dropdown.addOption(rating, rating[0].toUpperCase() + rating.slice(1));
            dropdown.setValue(options.userRating ?? "").onChange((value) => {
                this.input.userRating = value === "" ? undefined : value as ReviewRating;
            });
        });
        if (options.state.round === "R4" || options.state.round === "R5") {
            if (options.state.round === "R4" && options.practiceHint) this.contentEl.createEl("p", { text: `已有关联候选位置（请核对是否为陌生同构题）：${options.practiceHint}` });
            this.contentEl.createEl("p", { text: options.state.round === "R4"
                ? "从现有教材、教辅或真题选陌生同构题；请填真实题目与作答位置。"
                : "请按实际作答环境选择。看过对应模型提示后作答，不能记为无提示 Mixed。" });
            new Setting(this.contentEl).setName("真实题/卷及作答位置").addText((text) => text.onChange((value) => { this.evidenceRef = value; }));
            new Setting(this.contentEl).setName("实际发生时间").setDesc("补录填写实际完成时间，含时区；不能用上轮活动。")
                .addText((text) => {
                    text.setPlaceholder("YYYY-MM-DDTHH:mm:ss+08:00").onChange((value) => { this.performedAt = value; });
                    new Setting(this.contentEl).addButton((button) => button.setButtonText("我刚刚完成").onClick(() => {
                        this.performedAt = new Date().toISOString(); text.setValue(this.performedAt);
                    }));
                });
            this.confirm("这次活动发生在本周期，尚未记入插件，也未用于该 Entity 的其他轮次", "unregisteredActivityConfirmed");
        }
        if (options.state.round === "R5") {
            this.confirm("已经实际作答并核对结果", "resultChecked");
            let resetSpeed: () => void = () => undefined;
            new Setting(this.contentEl).setName("实际验证模式").addDropdown((dropdown) => {
                dropdown.addOption("", "请选择实际环境").addOption("mixed", "Mixed · 现实混合考试").addOption("isolated", "Isolated · 专项验证")
                    .onChange((value) => { this.mode = value === "" ? undefined : value as "mixed" | "isolated";
                        this.input.speedVerification = false; this.duration = ""; resetSpeed();
                        mixed.hidden = this.mode !== "mixed"; isolated.hidden = this.mode !== "isolated"; duration.hidden = true;
                    });
            });
            const mixed = this.contentEl.createDiv(); mixed.hidden = true;
            const isolated = this.contentEl.createDiv(); isolated.hidden = true;
            this.confirm("Mixed：作答前未获得本题对应模型提示；可在现实考试后才关联", "noModelHint", mixed);
            this.confirm("Mixed：使用了现实考试/整卷限时，全卷时长不分摊给此 Entity", "fullPaperLimitConfirmed", mixed);
            this.confirm("Isolated：本次实际属于高难、长推导或明确专项验证", "isolatedConfirmed", isolated);
            const duration = isolated.createDiv(); duration.hidden = true;
            new Setting(isolated).setName("本次明确验证单题速度").addToggle((toggle) => {
                resetSpeed = () => { toggle.setValue(false); return undefined; };
                toggle.setValue(false).onChange((value) => { this.input.speedVerification = value; duration.hidden = !value; });
            });
            new Setting(duration).setName("事后单题用时（分钟，可不填）").addText((text) => text.onChange((value) => { this.duration = value; }));
        }
        const submit = new Setting(this.contentEl);
        submit.addButton((button) => button.setButtonText("完成本轮").setCta().onClick(async () => {
            if (this.submitting) return;
            this.input.evidence = options.state.round === "R4" || options.state.round === "R5"
                ? { ref: this.evidenceRef.trim(), performed_at: this.performedAt.trim(), ...(this.mode ? { mode: this.mode } : {}) } : undefined;
            this.input.durationMinutes = this.mode === "isolated" && this.input.speedVerification && this.duration.trim()
                ? Number(this.duration) : undefined;
            const issue = completionIssue(this.input, options.state, options.history, new Date().toISOString());
            if (issue) { submit.setErrorMessage(issue); return; }
            this.submitting = true; button.setDisabled(true);
            try { await options.onSubmit({ ...this.input }); this.close(); }
            catch (error: unknown) { submit.setErrorMessage(error instanceof Error ? error.message : "提交未确认。"); }
            finally { this.submitting = false; button.setDisabled(false); }
        }));
        new Setting(this.contentEl).addButton((button) => button.setButtonText("取消").onClick(() => this.close()));
    }

    private confirm(label: string, key: "actionConfirmed" | "sourceConfirmed" | "subjectConfirmed" | "originalRetained" |
        "resultChecked" | "noModelHint" | "fullPaperLimitConfirmed" | "isolatedConfirmed" | "unregisteredActivityConfirmed", parent: HTMLElement = this.contentEl): void {
        new Setting(parent).setName(label).addToggle((toggle) => toggle.setValue(false).onChange((value) => { this.input[key] = value; }));
    }

    onClose(): void { this.contentEl.empty(); }
}

export interface GaokaoKnowledgePointChoice {
    id: string;
    path: string;
    subject: GaokaoSubject;
}

export interface GaokaoReviewFeedbackModalOptions {
    notePath: string;
    visibleRating: string;
    context: "review" | "manual";
}

export class GaokaoFeedbackModal extends Modal {
    private readonly waitForClose: Promise<GaokaoFeedback | null>;
    private resolvePromise: (feedback: GaokaoFeedback | null) => void = () => undefined;
    private settled = false;
    private mistakeType: MistakeType | undefined;

    static capture(
        app: App,
        options: GaokaoReviewFeedbackModalOptions,
    ): Promise<GaokaoFeedback | null> {
        const modal = new GaokaoFeedbackModal(app, options);
        modal.open();
        return modal.waitForClose;
    }

    private constructor(app: App, options: GaokaoReviewFeedbackModalOptions) {
        super(app);
        this.waitForClose = new Promise((resolve) => {
            this.resolvePromise = resolve;
        });
        this.modalEl.addClass("gaokao-workflow-modal");
        this.setTitle(`${options.visibleRating}｜补充反馈`);
        this.contentEl.createDiv({
            cls: "gaokao-feedback-help",
            text: `${options.notePath}\n${
                options.context === "review"
                    ? "错因和时长均可跳过；关闭窗口仍会保存本次语义评分。"
                    : "错因和时长均可跳过；关闭窗口将取消，不会记录学习事件。"
            }`,
        });
        this.renderMistakes();
        this.renderDurations(options.context);
    }

    private renderMistakes(): void {
        this.contentEl.createEl("h3", { text: "主要错因（可选）" });
        const buttonGrid = this.contentEl.createDiv("gaokao-button-grid");
        const buttons: HTMLButtonElement[] = [];
        const addButton = (label: string, value: MistakeType | undefined) => {
            const button = buttonGrid.createEl("button", { text: label });
            if (value === undefined) button.addClass("gaokao-selected");
            button.addEventListener("click", () => {
                this.mistakeType = value;
                for (const candidate of buttons) candidate.removeClass("gaokao-selected");
                button.addClass("gaokao-selected");
            });
            buttons.push(button);
        };
        addButton("无 / 跳过", undefined);
        for (const [code] of MISTAKE_DESCRIPTIONS) addButton(code, code);

        const legend = this.contentEl.createDiv("gaokao-mistake-legend");
        for (const [code, description] of MISTAKE_DESCRIPTIONS) {
            legend.createDiv({ text: `${code}｜${description}` });
        }
    }

    private renderDurations(context: "review" | "manual"): void {
        this.contentEl.createEl("h3", { text: "时长（分钟）" });
        const buttonGrid = this.contentEl.createDiv("gaokao-button-grid");
        for (const duration of QUICK_DURATIONS) {
            const button = buttonGrid.createEl("button", { text: `记录 ${duration} 分钟` });
            button.addEventListener("click", () => {
                this.finish({
                    ...(this.mistakeType === undefined ? {} : { mistake_type: this.mistakeType }),
                    duration_minutes: duration,
                });
            });
        }

        let customDuration = "";
        const customSetting = new Setting(this.contentEl)
            .setName("自定义")
            .setDesc("支持 0 和小数。")
            .addText((text) =>
                text.setPlaceholder("例如 12.5").onChange((value) => {
                    customDuration = value;
                    customSetting.setErrorMessage(null);
                }),
            )
            .addButton((button) =>
                button
                    .setButtonText("记录")
                    .setCta()
                    .onClick(() => {
                        const parsed = parseCustomDuration(customDuration);
                        if (!parsed.ok || parsed.value === undefined) {
                            customSetting.setErrorMessage(parsed.message ?? "无效时长。");
                            return;
                        }
                        this.finish({
                            ...(this.mistakeType === undefined
                                ? {}
                                : { mistake_type: this.mistakeType }),
                            duration_minutes: parsed.value,
                        });
                    }),
            );

        new Setting(this.contentEl).addButton((button) =>
            button
                .setButtonText(context === "manual" ? "跳过补充并记录" : "跳过时长并记录")
                .onClick(() => {
                    this.finish(
                        context === "manual" || this.mistakeType === undefined
                            ? {}
                            : { mistake_type: this.mistakeType },
                    );
                }),
        );
    }

    private finish(feedback: GaokaoFeedback): void {
        if (this.settled) return;
        this.settled = true;
        this.resolvePromise(feedback);
        this.close();
    }

    onClose(): void {
        this.contentEl.empty();
        if (this.settled) return;
        this.settled = true;
        this.resolvePromise(null);
    }
}

export class GaokaoEventTypeModal extends Modal {
    private readonly waitForClose: Promise<LearningEventType | null>;
    private resolvePromise: (eventType: LearningEventType | null) => void = () => undefined;
    private settled = false;

    static choose(app: App): Promise<LearningEventType | null> {
        const modal = new GaokaoEventTypeModal(app);
        modal.open();
        return modal.waitForClose;
    }

    private constructor(app: App) {
        super(app);
        this.waitForClose = new Promise((resolve) => {
            this.resolvePromise = resolve;
        });
        this.modalEl.addClass("gaokao-workflow-modal");
        this.setTitle("记录学习事件");
        this.contentEl.createDiv({
            cls: "gaokao-workflow-help",
            text: "复习事件请使用既有 Again / Hard / Good / Easy；这里记录其他学习活动。",
        });
        const grid = this.contentEl.createDiv("gaokao-button-grid");
        const choices: readonly [LearningEventType, string][] = [
            ["study", "学习"],
            ["practice", "练习"],
            ["verification", "再验证"],
        ];
        for (const [eventType, label] of choices) {
            const button = grid.createEl("button", { text: label });
            button.addEventListener("click", () => this.finish(eventType));
        }
    }

    private finish(eventType: LearningEventType): void {
        if (this.settled) return;
        this.settled = true;
        this.resolvePromise(eventType);
        this.close();
    }

    onClose(): void {
        this.contentEl.empty();
        if (this.settled) return;
        this.settled = true;
        this.resolvePromise(null);
    }
}

export interface GaokaoNoteCreationModalOptions {
    knowledgePoints: GaokaoKnowledgePointChoice[];
    reviewTag: string;
    onSubmit: (input: GaokaoTemplateInput) => Promise<void>;
}

export class GaokaoNoteCreationModal extends Modal {
    private templateId: GaokaoNoteTemplateId = "math_concept";
    private templateSubject: GaokaoSubject | "" = "";
    private title = "";
    private folder = GAOKAO_NOTE_TEMPLATES[0].defaultFolder;
    private gaokaoId = generateGaokaoId(this.templateId);
    private chapter = "";
    private source = "";
    private knowledgeId = "";
    private readonly options: GaokaoNoteCreationModalOptions;

    constructor(app: App, options: GaokaoNoteCreationModalOptions) {
        super(app);
        this.options = options;
        this.modalEl.addClass("gaokao-workflow-modal");
    }

    onOpen(): void {
        this.render();
    }

    private render(): void {
        this.contentEl.empty();
        this.setTitle("创建 GAOKAO 学习笔记");
        this.contentEl.createDiv({
            cls: "gaokao-workflow-help",
            text: "仅标题必填。可按学科缩小模板范围；文件夹和稳定 ID 在高级信息中按需调整。",
        });

        new Setting(this.contentEl).setName("学科筛选").addDropdown((dropdown) => {
            dropdown.addOption("", "全部学科");
            for (const subject of GAOKAO_SUBJECTS) dropdown.addOption(subject, subject);
            dropdown.setValue(this.templateSubject).onChange((value) => {
                this.templateSubject = value as GaokaoSubject | "";
                if (
                    this.templateSubject !== "" &&
                    this.currentTemplate().subject !== this.templateSubject
                ) {
                    const firstMatch = GAOKAO_NOTE_TEMPLATES.find(
                        (template) => template.subject === this.templateSubject,
                    );
                    if (firstMatch !== undefined) this.selectTemplate(firstMatch.id);
                }
                this.render();
            });
        });

        new Setting(this.contentEl).setName("模板").addDropdown((dropdown) => {
            const templates = GAOKAO_NOTE_TEMPLATES.filter(
                (template) =>
                    this.templateSubject === "" || template.subject === this.templateSubject,
            );
            for (const template of templates) {
                dropdown.addOption(template.id, template.label);
            }
            dropdown.setValue(this.templateId).onChange((value) => {
                this.selectTemplate(value as GaokaoNoteTemplateId);
                this.render();
            });
        });

        new Setting(this.contentEl).setName("标题").addText((text) =>
            text
                .setPlaceholder("中文标题")
                .setValue(this.title)
                .onChange((value) => (this.title = value)),
        );

        const advanced = this.contentEl.createEl("details");
        advanced.createEl("summary", { text: "高级信息" });

        new Setting(advanced)
            .setName("文件夹")
            .setDesc("Vault 内相对路径；不会修改全局附件设置。")
            .addText((text) =>
                text.setValue(this.folder).onChange((value) => (this.folder = value)),
            );

        new Setting(advanced)
            .setName("稳定 ID")
            .setDesc("中性随机 ID；可在创建前修改，之后保持不变。")
            .addText((text) =>
                text.setValue(this.gaokaoId).onChange((value) => (this.gaokaoId = value)),
            );

        if (this.currentTemplate().entityType === "knowledge_point") {
            new Setting(this.contentEl)
                .setName("章节（可选）")
                .addText((text) =>
                    text.setValue(this.chapter).onChange((value) => (this.chapter = value)),
                );
        } else {
            new Setting(this.contentEl)
                .setName("来源（可选）")
                .addText((text) =>
                    text.setValue(this.source).onChange((value) => (this.source = value)),
                );
            const candidates = this.options.knowledgePoints.filter(
                (choice) => choice.subject === this.currentTemplate().subject,
            );
            new Setting(this.contentEl)
                .setName("关联知识点（可选）")
                .setDesc("选择稳定 ID；无需手工输入。首版支持一个主知识点。")
                .addDropdown((dropdown) => {
                    dropdown.addOption("", "暂不关联");
                    for (const choice of candidates) {
                        dropdown.addOption(choice.id, `${choice.path}｜${choice.id}`);
                    }
                    dropdown.setValue(this.knowledgeId).onChange((value) => {
                        this.knowledgeId = value;
                    });
                });
        }

        const submitSetting = new Setting(this.contentEl).addButton((button) =>
            button
                .setButtonText("创建并打开")
                .setCta()
                .onClick(async () => {
                    button.setDisabled(true);
                    submitSetting.setErrorMessage(null);
                    try {
                        await this.options.onSubmit({
                            templateId: this.templateId,
                            gaokaoId: this.gaokaoId,
                            title: this.title,
                            folder: this.folder,
                            chapter: this.chapter,
                            source: this.source,
                            knowledgeIds: this.knowledgeId.length === 0 ? [] : [this.knowledgeId],
                            reviewTag: this.options.reviewTag,
                        });
                        this.close();
                    } catch (error: unknown) {
                        const message = error instanceof Error ? error.message : "创建笔记失败。";
                        if (/文件夹|(?:稳定\s*)?ID|gaokao_id/i.test(message)) advanced.open = true;
                        submitSetting.setErrorMessage(message);
                        button.setDisabled(false);
                    }
                }),
        );
    }

    private currentTemplate() {
        const template = GAOKAO_NOTE_TEMPLATES.find(
            (candidate) => candidate.id === this.templateId,
        );
        if (!template) throw new Error("不支持的 GAOKAO 模板类型。");
        return template;
    }

    private selectTemplate(templateId: GaokaoNoteTemplateId): void {
        this.templateId = templateId;
        const template = this.currentTemplate();
        this.folder = template.defaultFolder;
        this.gaokaoId = generateGaokaoId(this.templateId);
        this.knowledgeId = "";
    }

    onClose(): void {
        this.contentEl.empty();
    }
}

export class GaokaoRecentEventsModal extends Modal {
    constructor(app: App, entityId: string, events: LearningEvent[]) {
        super(app);
        this.modalEl.addClass("gaokao-workflow-modal");
        this.setTitle(`最近学习事件｜${entityId}`);
        if (events.length === 0) {
            this.contentEl.createDiv({ cls: "gaokao-recent-empty", text: "尚无学习事件。" });
            return;
        }

        const list = this.contentEl.createDiv("gaokao-recent-events");
        for (const event of events.slice(-10).reverse()) {
            const parts = [
                new Date(event.timestamp).toLocaleString(),
                event.event_type,
                event.rating,
                event.mistake_type,
                event.duration_minutes === undefined ? undefined : `${event.duration_minutes} min`,
            ].filter((value): value is string => value !== undefined);
            list.createDiv({ cls: "gaokao-recent-event", text: parts.join(" · ") });
        }
    }
}
