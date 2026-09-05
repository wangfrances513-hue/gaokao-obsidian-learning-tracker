import { App, Modal, Setting } from "obsidian";

import {
    GAOKAO_IMAGE_SUBJECTS,
    GaokaoImageAttachmentDisposition,
    GaokaoImageSubject,
} from "src/gaokao/image-evidence";

export interface GaokaoImageEvidenceKnowledgeChoice {
    readonly id: string;
    readonly path: string;
    readonly subject: GaokaoImageSubject;
}

export interface GaokaoImageEvidenceDraft {
    readonly file: File;
    readonly subject: GaokaoImageSubject;
    readonly title: string;
    readonly knowledgeId: string;
}

export interface GaokaoImageEvidenceConfirmation {
    readonly subject: GaokaoImageSubject;
    readonly knowledgeId: string;
    readonly knowledgePath: string;
    readonly attachmentDisposition: GaokaoImageAttachmentDisposition;
    readonly attachmentPath: string;
    readonly notePath: string;
    readonly sha256: string;
    readonly byteLength: number;
    readonly canonicalKind: "jpeg" | "png";
    readonly capturedYear: string;
    readonly capturedMonth: string;
    readonly duplicateRisk: {
        readonly exactMatchPaths: readonly string[];
    };
    readonly sourceHintWarnings: readonly string[];
}

export interface GaokaoImageEvidenceModalPlan<TPlan> {
    readonly confirmation: GaokaoImageEvidenceConfirmation;
    readonly plan: TPlan;
}

export interface GaokaoImageEvidenceModalOptions<TPlan> {
    readonly knowledgePoints: readonly GaokaoImageEvidenceKnowledgeChoice[];
    readonly onPlan: (
        draft: GaokaoImageEvidenceDraft,
    ) => Promise<GaokaoImageEvidenceModalPlan<TPlan>>;
    readonly onCommit: (plan: TPlan) => Promise<void>;
}

export type GaokaoImageEvidenceModalResult = "success" | "cancelled";

function errorMessage(error: unknown, fallback: string): string {
    return error instanceof Error ? error.message : fallback;
}

export class GaokaoImageEvidenceModal<TPlan> extends Modal {
    private readonly waitForClose: Promise<GaokaoImageEvidenceModalResult>;
    private resolvePromise: (result: GaokaoImageEvidenceModalResult) => void = () => undefined;
    private readonly options: GaokaoImageEvidenceModalOptions<TPlan>;
    private subject: GaokaoImageSubject = "数学";
    private title = "";
    private knowledgeId = "";
    private selectedFile: File | null = null;
    private busy = false;
    private settled = false;
    private commitAttempted = false;
    private closedWhileBusy = false;
    private planned: GaokaoImageEvidenceModalPlan<TPlan> | null = null;

    static capture<TPlan>(
        app: App,
        options: GaokaoImageEvidenceModalOptions<TPlan>,
    ): Promise<GaokaoImageEvidenceModalResult> {
        const modal = new GaokaoImageEvidenceModal<TPlan>(app, options);
        modal.open();
        return modal.waitForClose;
    }

    private constructor(app: App, options: GaokaoImageEvidenceModalOptions<TPlan>) {
        super(app);
        this.options = options;
        this.waitForClose = new Promise((resolve) => {
            this.resolvePromise = resolve;
        });
        this.modalEl.addClass("gaokao-workflow-modal");
    }

    onOpen(): void {
        this.renderDraft();
    }

    private renderDraft(): void {
        this.contentEl.empty();
        this.setTitle("捕获 GAOKAO 图片证据");
        this.contentEl.createDiv({
            cls: "gaokao-workflow-help",
            text: "仅接收一张本地 JPEG 或 PNG。MIME 与文件名只是提示，字节签名才是依据。",
        });
        this.contentEl.createDiv({
            cls: "gaokao-workflow-help",
            text: "隐私提示：本切片不会移除 EXIF 或其他图片元数据；请在选择前确认图片可安全保存在 Vault 中。不会访问网络。",
        });

        const fileSetting = new Setting(this.contentEl)
            .setName("本地图片")
            .setDesc("最大 26,214,400 字节。");
        const input = fileSetting.controlEl.createEl("input");
        input.type = "file";
        input.accept = ".jpg,.jpeg,.png,image/jpeg,image/png";
        input.multiple = false;
        input.addEventListener("change", () => {
            const files = input.files;
            this.selectedFile = files !== null && files.length === 1 ? files[0] : null;
            fileSetting.setDesc(
                this.selectedFile === null
                    ? "请选择且仅选择一个本地文件。"
                    : `${this.selectedFile.name}｜${this.selectedFile.size} 字节`,
            );
        });

        const knowledgeSelect = this.contentEl.ownerDocument.createElement("select");
        const selectedKnowledge = this.contentEl.createDiv({ cls: "gaokao-workflow-help" });
        const updateKnowledgeDisplay = () => {
            const choice = this.currentKnowledgeChoice();
            selectedKnowledge.setText(
                choice === undefined
                    ? "尚未选择知识点。"
                    : `已选知识点：${choice.path}｜${choice.id}`,
            );
        };
        const rebuildKnowledgeOptions = () => {
            knowledgeSelect.replaceChildren();
            const empty = this.contentEl.ownerDocument.createElement("option");
            empty.text = "请选择一个知识点";
            empty.value = "";
            knowledgeSelect.appendChild(empty);
            for (const choice of this.subjectKnowledgeChoices()) {
                const option = this.contentEl.ownerDocument.createElement("option");
                option.text = `${choice.path}｜${choice.id}`;
                option.value = choice.id;
                knowledgeSelect.appendChild(option);
            }
            this.knowledgeId = "";
            knowledgeSelect.value = "";
            updateKnowledgeDisplay();
        };

        new Setting(this.contentEl).setName("科目").addDropdown((dropdown) => {
            for (const subject of GAOKAO_IMAGE_SUBJECTS) dropdown.addOption(subject, subject);
            dropdown.setValue(this.subject).onChange((value) => {
                this.subject = GAOKAO_IMAGE_SUBJECTS.find((subject) => subject === value) ?? "数学";
                rebuildKnowledgeOptions();
            });
        });

        new Setting(this.contentEl).setName("问题标题").addText((text) =>
            text
                .setPlaceholder("必填")
                .setValue(this.title)
                .onChange((value) => (this.title = value)),
        );

        const knowledgeSetting = new Setting(this.contentEl)
            .setName("关联知识点")
            .setDesc("必须选择一个当前科目的唯一有效 knowledge_point；不可手工输入。");
        knowledgeSetting.controlEl.appendChild(knowledgeSelect);
        knowledgeSelect.addEventListener("change", () => {
            this.knowledgeId = knowledgeSelect.value;
            updateKnowledgeDisplay();
        });
        rebuildKnowledgeOptions();

        const actionSetting = new Setting(this.contentEl);
        actionSetting.addButton((button) =>
            button.setButtonText("取消").onClick(() => {
                if (this.busy) return;
                this.close();
            }),
        );
        actionSetting.addButton((button) =>
            button
                .setButtonText("生成确认计划")
                .setCta()
                .onClick(async () => {
                    if (this.busy || this.planned !== null) return;
                    actionSetting.setErrorMessage(null);
                    if (this.selectedFile === null) {
                        actionSetting.setErrorMessage("请选择且仅选择一个本地图片文件。");
                        return;
                    }
                    this.busy = true;
                    button.setDisabled(true);
                    try {
                        const planned = await this.options.onPlan({
                            file: this.selectedFile,
                            subject: this.subject,
                            title: this.title,
                            knowledgeId: this.knowledgeId,
                        });
                        if (this.closedWhileBusy) return;
                        this.planned = Object.freeze({
                            confirmation: Object.freeze({ ...planned.confirmation }),
                            plan: planned.plan,
                        });
                        this.renderConfirmation();
                    } catch (error: unknown) {
                        if (!this.closedWhileBusy) {
                            actionSetting.setErrorMessage(
                                errorMessage(error, "无法生成确认计划。"),
                            );
                            button.setDisabled(false);
                        }
                    } finally {
                        this.busy = false;
                        if (this.closedWhileBusy && !this.settled) this.finish("cancelled");
                    }
                }),
        );
    }

    private renderConfirmation(): void {
        const planned = this.planned;
        if (planned === null) throw new Error("图片证据确认计划不存在。");
        const confirmation = planned.confirmation;
        this.contentEl.empty();
        this.setTitle("最终确认｜GAOKAO 图片证据");
        const disposition =
            confirmation.attachmentDisposition === "reused_existing"
                ? "复用现有附件"
                : "新建当前操作拥有的附件";
        const visibleLines = [
            `科目：${confirmation.subject}`,
            `知识点：${confirmation.knowledgePath}｜${confirmation.knowledgeId}`,
            `附件处置：${disposition}`,
            `计划附件路径：${confirmation.attachmentPath}`,
            `计划问题笔记路径：${confirmation.notePath}`,
            "本次操作不会记录 Learning Event。",
        ];
        this.contentEl.createDiv({
            cls: "gaokao-workflow-help",
            text: visibleLines.join("\n"),
        });
        const technicalDetails = this.contentEl.createEl("details");
        technicalDetails.createEl("summary", { text: "技术详情" });
        technicalDetails.createDiv({
            cls: "gaokao-workflow-help",
            text: [
                `SHA-256：${confirmation.sha256}`,
                `字节长度：${confirmation.byteLength}`,
                `规范类型：${confirmation.canonicalKind}`,
                `本机捕获年月：${confirmation.capturedYear}-${confirmation.capturedMonth}`,
            ].join("\n"),
        });
        this.contentEl.createDiv({
            cls: "gaokao-workflow-help",
            text: "隐私提示：图片元数据（包括可能存在的 EXIF）将保持原样。确认后的 ID、路径、哈希、正文和 frontmatter 不会静默改变。",
        });
        if (confirmation.duplicateRisk.exactMatchPaths.length > 0) {
            this.contentEl.createDiv({
                cls: "gaokao-workflow-help",
                text: [
                    "精确字节重复风险：以下受管附件与来源图片完全相同：",
                    ...confirmation.duplicateRisk.exactMatchPaths.map((path) => `- ${path}`),
                ].join("\n"),
            });
        }
        if (confirmation.sourceHintWarnings.length > 0) {
            this.contentEl.createDiv({
                cls: "gaokao-workflow-help",
                text: confirmation.sourceHintWarnings.join("\n"),
            });
        }

        const actionSetting = new Setting(this.contentEl);
        actionSetting.addButton((button) =>
            button.setButtonText("取消").onClick(() => {
                if (this.busy) return;
                this.close();
            }),
        );
        actionSetting.addButton((button) =>
            button
                .setButtonText("确认写入并打开")
                .setCta()
                .onClick(async () => {
                    if (this.busy || this.commitAttempted) return;
                    this.busy = true;
                    this.commitAttempted = true;
                    button.setDisabled(true);
                    actionSetting.setErrorMessage(null);
                    try {
                        await this.options.onCommit(planned.plan);
                        this.finish("success");
                    } catch (error: unknown) {
                        if (!this.closedWhileBusy) {
                            actionSetting.setErrorMessage(
                                errorMessage(error, "图片证据写入失败。"),
                            );
                        }
                    } finally {
                        this.busy = false;
                        if (this.closedWhileBusy && !this.settled) this.finish("cancelled");
                    }
                }),
        );
    }

    private subjectKnowledgeChoices(): readonly GaokaoImageEvidenceKnowledgeChoice[] {
        return this.options.knowledgePoints.filter((choice) => choice.subject === this.subject);
    }

    private currentKnowledgeChoice(): GaokaoImageEvidenceKnowledgeChoice | undefined {
        return this.subjectKnowledgeChoices().find((choice) => choice.id === this.knowledgeId);
    }

    private finish(result: GaokaoImageEvidenceModalResult): void {
        if (this.settled) return;
        this.settled = true;
        this.resolvePromise(result);
        this.close();
    }

    onClose(): void {
        this.contentEl.empty();
        if (this.settled) return;
        if (this.busy) {
            this.closedWhileBusy = true;
            return;
        }
        this.settled = true;
        this.resolvePromise("cancelled");
    }
}
