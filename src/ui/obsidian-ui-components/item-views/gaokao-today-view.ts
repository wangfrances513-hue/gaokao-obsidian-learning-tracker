/* eslint-disable camelcase -- Existing GAOKAO entity types use persisted snake_case values. */

import "src/ui/obsidian-ui-components/item-views/gaokao-today-view.css";
import { ItemView, setIcon, WorkspaceLeaf } from "obsidian";

import type { GaokaoTodayManager } from "src/gaokao/today-manager";
import { TodayPlanItem } from "src/gaokao/today-planner";
import { formatDate } from "src/utils/dates";

export const GAOKAO_TODAY_VIEW_TYPE = "gaokao-today-view";

const ENTITY_TYPE_LABELS = {
    knowledge_point: "知识点",
    problem_case: "题例",
    resource_unit: "资源",
} as const;

const NEED_LABELS = {
    again: "需重学",
    hard: "较难",
    unrated: "未评级",
    good: "良好",
    easy: "熟练",
} as const;

export class GaokaoTodayView extends ItemView {
    constructor(
        leaf: WorkspaceLeaf,
        private readonly todayManager: GaokaoTodayManager,
    ) {
        super(leaf);
        this.navigation = false;
    }

    getViewType(): string {
        return GAOKAO_TODAY_VIEW_TYPE;
    }

    getDisplayText(): string {
        return "GAOKAO Today";
    }

    getIcon(): string {
        return "calendar-check-2";
    }

    protected onOpen(): Promise<void> {
        this.redraw();
        return Promise.resolve();
    }

    redraw(): void {
        const snapshot = this.todayManager.createSnapshot();
        const { plan } = snapshot;
        this.contentEl.empty();
        this.contentEl.addClass("gaokao-today-page");

        const header = this.contentEl.createDiv("gaokao-today-header");
        const heading = header.createDiv("gaokao-today-heading");
        const icon = heading.createSpan("gaokao-today-heading-icon");
        setIcon(icon, "calendar-check-2");
        const title = heading.createDiv();
        title.createEl("h1", { text: "Today" });
        title.createDiv({
            cls: "gaokao-today-date",
            text: formatDate(plan.todayUnix),
        });

        const refresh = header.createEl("button", {
            cls: "gaokao-today-refresh",
            text: "刷新",
        });
        refresh.setAttr("type", "button");
        refresh.onClickEvent(() => this.redraw());

        const summary = this.contentEl.createDiv("gaokao-today-summary");
        this.createSummaryCard(
            summary,
            "到期复习",
            plan.protectedReviews.length.toString(),
            "全部保留",
        );
        this.createSummaryCard(
            summary,
            "最低建议",
            plan.minimumRecommendedReviews.length.toString(),
            "先完成这些复习",
        );
        this.createSummaryCard(
            summary,
            "推荐学习",
            plan.discretionaryWork.length.toString(),
            "未排期主动任务",
        );

        const primaryEntityId =
            plan.protectedReviews[0]?.entityId ?? plan.discretionaryWork[0]?.entityId;
        this.renderProtectedReviews(plan, primaryEntityId);
        this.renderDiscretionaryWork(plan.discretionaryWork, primaryEntityId);

        if (snapshot.invalidOrDuplicateCount > 0 || plan.unavailableScheduleCount > 0) {
            const diagnostics = this.contentEl.createDiv("gaokao-today-diagnostics");
            diagnostics.createEl("strong", { text: "安全排除：" });
            const messages: string[] = [];
            if (snapshot.invalidOrDuplicateCount > 0) {
                messages.push(`${snapshot.invalidOrDuplicateCount} 个无效或重复实体`);
            }
            if (plan.unavailableScheduleCount > 0) {
                messages.push(`${plan.unavailableScheduleCount} 个调度状态不可用实体`);
            }
            diagnostics.appendText(`${messages.join("；")}未进入今日计划。`);
        }

        if (plan.protectedReviews.length === 0 && plan.discretionaryWork.length === 0) {
            this.contentEl.createDiv({
                cls: "gaokao-today-empty gaokao-today-empty-all",
                text: "今天没有可执行的 GAOKAO 项目。不会为了填满页面而制造任务。",
            });
        }
    }

    private createSummaryCard(
        parent: HTMLElement,
        label: string,
        value: string,
        detail: string,
    ): void {
        const card = parent.createDiv("gaokao-today-summary-card");
        card.createDiv({ cls: "gaokao-today-summary-label", text: label });
        card.createDiv({ cls: "gaokao-today-summary-value", text: value });
        card.createDiv({ cls: "gaokao-today-summary-detail", text: detail });
    }

    private renderProtectedReviews(
        plan: {
            protectedReviews: TodayPlanItem[];
            minimumRecommendedReviews: TodayPlanItem[];
        },
        primaryEntityId: string | undefined,
    ): void {
        const section = this.createSection(
            "到期与逾期复习",
            "调度器是唯一日期权威；学科权重不会隐藏这里的任何项目。",
        );
        if (plan.protectedReviews.length === 0) {
            section.createDiv({ cls: "gaokao-today-empty", text: "今天没有到期复习。" });
            return;
        }

        const minimumIds = new Set(plan.minimumRecommendedReviews.map((item) => item.entityId));
        const list = section.createDiv("gaokao-today-list");
        for (const item of plan.protectedReviews) {
            const badge = minimumIds.has(item.entityId) ? "最低建议" : "到期积压";
            this.createItem(
                list,
                item,
                badge,
                this.formatDueStatus(item),
                item.entityId === primaryEntityId,
            );
        }
    }

    private renderDiscretionaryWork(
        items: TodayPlanItem[],
        primaryEntityId: string | undefined,
    ): void {
        const section = this.createSection(
            "最低日常任务 / 推荐学习",
            "仅对未排期的有效实体排序；不会提前改写或替代复习调度。",
        );
        if (items.length === 0) {
            section.createDiv({
                cls: "gaokao-today-empty",
                text: "当前没有合适的主动学习候选。",
            });
            return;
        }

        const list = section.createDiv("gaokao-today-list");
        for (const item of items) {
            this.createItem(
                list,
                item,
                "推荐",
                `学习需求：${NEED_LABELS[item.needLabel]}`,
                item.entityId === primaryEntityId,
            );
        }
    }

    private createSection(title: string, description: string): HTMLElement {
        const section = this.contentEl.createEl("section", { cls: "gaokao-today-section" });
        section.createEl("h2", { text: title });
        section.createEl("p", { cls: "gaokao-today-section-description", text: description });
        return section;
    }

    private createItem(
        parent: HTMLElement,
        item: TodayPlanItem,
        badge: string,
        status: string,
        isPrimary: boolean,
    ): void {
        const button = parent.createEl("button", { cls: "gaokao-today-item" });
        button.setAttr("type", "button");
        button.setAttr("aria-label", `打开 ${item.title}`);
        button.onClickEvent(() => void this.todayManager.openEntity(item.entityId));

        const main = button.createDiv("gaokao-today-item-main");
        const titleRow = main.createDiv("gaokao-today-item-title-row");
        if (isPrimary) {
            titleRow.createSpan({ cls: "gaokao-today-badge", text: "立即开始" });
        }
        titleRow.createSpan({ cls: "gaokao-today-badge", text: badge });
        titleRow.createSpan({ cls: "gaokao-today-item-title", text: item.title });
        main.createDiv({
            cls: "gaokao-today-item-meta",
            text: `${item.subject} · ${ENTITY_TYPE_LABELS[item.entityType]} · ${status}`,
        });

        const estimate = button.createDiv("gaokao-today-estimate");
        if (item.durationEstimate.source === "history") {
            estimate.createSpan({ text: `约 ${item.durationEstimate.minutes} 分钟` });
            estimate.createEl("small", { text: "历史中位数，仅供参考" });
        } else {
            estimate.createSpan({ text: "用时未知" });
            estimate.createEl("small", { text: "无有效历史" });
        }
        const arrow = button.createSpan("gaokao-today-item-arrow");
        setIcon(arrow, "arrow-up-right");
    }

    private formatDueStatus(item: TodayPlanItem): string {
        if (item.dueStatus === "overdue") return `逾期 ${item.overdueDays ?? 0} 天`;
        return "今日到期";
    }
}
