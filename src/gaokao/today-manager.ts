import { Notice, TFile, WorkspaceLeaf } from "obsidian";

import {
    buildTodayPlan,
    TodayPlan,
    TodayPlannerCandidate,
    TodayScheduleState,
} from "src/gaokao/today-planner";
import type SRPlugin from "src/main";
import { SchedNote } from "src/note/note-review-deck";
import {
    GAOKAO_TODAY_VIEW_TYPE,
    GaokaoTodayView,
} from "src/ui/obsidian-ui-components/item-views/gaokao-today-view";
import { globalDateProvider } from "src/utils/dates";

export interface GaokaoTodaySnapshot {
    plan: TodayPlan;
    invalidOrDuplicateCount: number;
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

    createSnapshot(): GaokaoTodaySnapshot {
        const scheduleStates = this.collectAuthoritativeScheduleStates();
        const candidates: TodayPlannerCandidate[] = this.plugin.dataManager
            .getGaokaoEntities()
            .map(({ path, entity }) => {
                const file = this.plugin.app.vault.getAbstractFileByPath(path);
                return {
                    path,
                    title: file instanceof TFile ? file.basename : path,
                    entity,
                    events: this.plugin.dataManager.getGaokaoEventHistory(entity.gaokao_id),
                    schedule: scheduleStates.get(path) ?? { kind: "none" },
                };
            });

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
        await this.plugin.app.workspace.getLeaf().openFile(file);
    }

    private collectAuthoritativeScheduleStates(): Map<string, TodayScheduleState> {
        const states = new Map<string, TodayScheduleState>();
        if (!this.plugin.dataManager.isOsrCoreLoaded()) return states;
        const reviewDecks = this.plugin.dataManager.osrCore.noteReviewQueue.reviewDecks;
        if (!reviewDecks) return states;

        for (const deck of reviewDecks.values()) {
            for (const scheduledNote of deck.scheduledNotes) {
                this.mergeScheduledState(states, scheduledNote);
            }
        }
        return states;
    }

    private mergeScheduledState(
        states: Map<string, TodayScheduleState>,
        scheduledNote: SchedNote,
    ): void {
        const path = scheduledNote.note.path;
        const dueUnix = scheduledNote.dueUnix;
        const current = states.get(path);
        if (!Number.isFinite(dueUnix)) {
            if (current === undefined) states.set(path, { kind: "unavailable" });
            return;
        }
        if (current?.kind === "scheduled" && current.dueUnix <= dueUnix) return;
        states.set(path, { kind: "scheduled", dueUnix });
    }
}
