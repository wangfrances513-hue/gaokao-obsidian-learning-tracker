import moment from "moment";
import { Notice, TFile, WorkspaceLeaf } from "obsidian";
import { readRoundScheduleFrontmatter } from "src/data/data-structures/file/note-file";
import { SettingsUtil } from "src/data/settings";
import { sameRoundData } from "src/gaokao/review-flow";
import { inspectR1Text } from "src/gaokao/review-presentation";

import {
    buildTodayPlan,
    TodayPlan,
    TodayPlannerCandidate,
    TodayScheduleState,
} from "src/gaokao/today-planner";
import type SRPlugin from "src/main";
import {
    GAOKAO_TODAY_VIEW_TYPE,
    GaokaoTodayView,
} from "src/ui/obsidian-ui-components/item-views/gaokao-today-view";
import { globalDateProvider } from "src/utils/dates";

export interface GaokaoTodaySnapshot {
    plan: TodayPlan;
    invalidOrDuplicateCount: number;
    pendingIssue?: string;
}

export class GaokaoTodayManager {
    private view: GaokaoTodayView | null = null;

    constructor(private readonly plugin: SRPlugin) {
        this.plugin.registerView(GAOKAO_TODAY_VIEW_TYPE, (leaf: WorkspaceLeaf) => {
            this.view = new GaokaoTodayView(leaf, this);
            return this.view;
        });
    }

    async openToday(): Promise<void> {
        const leaves = this.plugin.app.workspace.getLeavesOfType(GAOKAO_TODAY_VIEW_TYPE);
        const leaf = leaves[0] ?? this.plugin.app.workspace.getLeaf(true);
        await leaf.setViewState({ type: GAOKAO_TODAY_VIEW_TYPE, active: true });
        await this.plugin.app.workspace.revealLeaf(leaf);
        this.redraw();
    }

    async createSnapshot(): Promise<GaokaoTodaySnapshot> {
        const candidates: TodayPlannerCandidate[] = [];
        for (const { path, entity } of this.plugin.dataManager.getGaokaoEntities()) {
                const file = this.plugin.app.vault.getAbstractFileByPath(path);
                const flow = this.plugin.dataManager.gaokaoManager.getRoundState(entity.gaokao_id);
                let schedule: TodayScheduleState = { kind: "unavailable" };
                let flowIssue: string | undefined;
                let r1Action: string | undefined;
                if (file instanceof TFile && this.plugin.dataManager.isOsrCoreLoaded() && !this.plugin.dataManager.syncLock) {
                    try {
                        const metadata = await this.plugin.dataManager.createSRNoteTFile(file).readPersistentMetadata();
                        r1Action = inspectR1Text(metadata.text).hasMaterial ? "R1 待完成：确认入库并记录" : "R1 待入库：先确认来源材料";
                        const settings = this.plugin.dataManager.data.settings;
                        if (metadata.frontmatter.gaokao_id !== entity.gaokao_id ||
                            !SettingsUtil.isAnyTagANoteReviewTag(settings, metadata.tags) ||
                            SettingsUtil.isAnyTagIgnoredForNotes(settings, metadata.tags) ||
                            SettingsUtil.isPathInFoldersToIgnore(settings, path)) throw new Error("身份或复习标签待核对。");
                        const receipt = readRoundScheduleFrontmatter(metadata.frontmatter);
                        schedule = receipt === null ? { kind: "none" } : { kind: "scheduled", dueUnix: moment(receipt.due, "YYYY-MM-DD", true).valueOf() };
                        if (flow.ok && flow.state.tail && !sameRoundData(receipt, flow.state.tail.schedule_after)) flowIssue = "当前排期与流程收据不符，待核对";
                    } catch { schedule = { kind: "invalid" }; }
                }
                candidates.push({
                    path,
                    title: file instanceof TFile ? file.basename : path,
                    entity,
                    events: this.plugin.dataManager.getGaokaoEventHistory(entity.gaokao_id),
                    schedule, flow, flowIssue, r1Action,
                });
        }

        const invalidOrDuplicateCount = this.plugin.dataManager
            .getGaokaoInspections()
            .filter(
                (inspection) =>
                    inspection.status === "invalid" || inspection.status === "duplicate",
            ).length;

        return {
            plan: buildTodayPlan(candidates, {
                todayUnix: globalDateProvider.today.valueOf(),
            }),
            invalidOrDuplicateCount,
            ...(this.plugin.dataManager.data.gaokao.pendingRoundCommit ? {
                pendingIssue: `存在未确认提交：${this.plugin.dataManager.data.gaokao.pendingRoundCommit.event.entity_id}。排期可能已改变；先核对同一提交，后续流程暂停。`,
            } : {}),
        };
    }

    redraw(): void {
        this.view?.redraw();
    }

    detach(): void {
        this.plugin.app.workspace
            .getLeavesOfType(GAOKAO_TODAY_VIEW_TYPE)
            .forEach((leaf) => leaf.detach());
        this.view = null;
    }

    async openEntity(entityId: string): Promise<void> {
        const resolved = this.plugin.dataManager.resolveGaokaoEntity(entityId);
        if (!resolved) {
            new Notice("GAOKAO：实体当前无唯一有效路径，未执行导航。", 10000);
            return;
        }
        const file = this.plugin.app.vault.getAbstractFileByPath(resolved.path);
        if (!(file instanceof TFile)) {
            new Notice("GAOKAO：实体文件当前不可用，未执行导航。", 10000);
            return;
        }
        await this.plugin.dataManager.openRoundEntry(entityId);
    }

    async openRecovery(): Promise<void> {
        const pending = this.plugin.dataManager.data.gaokao.pendingRoundCommit;
        if (pending) await this.plugin.dataManager.openRoundEntry(pending.event.entity_id);
    }
}
