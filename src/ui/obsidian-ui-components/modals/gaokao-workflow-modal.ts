/* eslint-disable camelcase -- Feedback uses the persisted snake_case event contract. */

import "src/ui/obsidian-ui-components/modals/gaokao-workflow-modal.css";
import { App, Modal, Setting } from "obsidian";

import { GaokaoFeedback, parseCustomDuration, QUICK_DURATIONS } from "src/gaokao/feedback";
import { LearningEvent, LearningEventType, MistakeType } from "src/gaokao/learning-event";
import { GaokaoSubject } from "src/gaokao/schema";
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

export interface GaokaoKnowledgePointChoice {
    id: string;
    path: string;
    subject: GaokaoSubject;
}

export interface GaokaoReviewFeedbackModalOptions {
    notePath: string;
    visibleRating: string;
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
            text: `${options.notePath}\n错因和时长均可跳过；关闭窗口仍会保存本次语义评分。`,
        });
        this.renderMistakes();
        this.renderDurations();
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

    private renderDurations(): void {
        this.contentEl.createEl("h3", { text: "时长（分钟）" });
        const buttonGrid = this.contentEl.createDiv("gaokao-button-grid");
        for (const duration of QUICK_DURATIONS) {
            const button = buttonGrid.createEl("button", { text: String(duration) });
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
            button.setButtonText("跳过时长并记录").onClick(() => {
                this.finish(
                    this.mistakeType === undefined ? {} : { mistake_type: this.mistakeType },
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
            text: "仅标题必填。稳定 ID 已生成，保存后不会随文件重命名或移动而变化。",
        });

        new Setting(this.contentEl).setName("模板").addDropdown((dropdown) => {
            for (const template of GAOKAO_NOTE_TEMPLATES) {
                dropdown.addOption(template.id, template.label);
            }
            dropdown.setValue(this.templateId).onChange((value) => {
                this.templateId = value as GaokaoNoteTemplateId;
                const template = this.currentTemplate();
                this.folder = template.defaultFolder;
                this.gaokaoId = generateGaokaoId(this.templateId);
                this.knowledgeId = "";
                this.render();
            });
        });

        new Setting(this.contentEl).setName("标题").addText((text) =>
            text
                .setPlaceholder("中文标题")
                .setValue(this.title)
                .onChange((value) => (this.title = value)),
        );

        new Setting(this.contentEl)
            .setName("文件夹")
            .setDesc("Vault 内相对路径；不会修改全局附件设置。")
            .addText((text) =>
                text.setValue(this.folder).onChange((value) => (this.folder = value)),
            );

        new Setting(this.contentEl)
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
                        submitSetting.setErrorMessage(
                            error instanceof Error ? error.message : "创建笔记失败。",
                        );
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
