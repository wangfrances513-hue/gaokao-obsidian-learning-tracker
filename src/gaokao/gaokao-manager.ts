/* eslint-disable camelcase -- Persisted GAOKAO/event field names are snake_case by contract. */

import {
    GaokaoEntityInspection,
    GaokaoEntityRegistry,
    GaokaoEntitySource,
} from "src/gaokao/entity-registry";
import { GaokaoFeedback } from "src/gaokao/feedback";
import {
    createLearningEvent,
    getLearningEventHistory,
    LearningEvent,
    LearningEventFactory,
    LearningEventInput,
    LearningEventValidationIssue,
    ReviewRating,
} from "src/gaokao/learning-event";
import { ReviewResponse } from "src/scheduling/algorithms/base/repetition-item";

export interface GaokaoPluginData {
    version: 1;
    learningEvents: LearningEvent[];
}

export function createDefaultGaokaoPluginData(): GaokaoPluginData {
    return { version: 1, learningEvents: [] };
}

export type RecordLearningEventResult =
    | { status: "recorded"; event: LearningEvent }
    | { status: "ordinary"; inspection: GaokaoEntityInspection }
    | { status: "invalid_entity"; inspection: GaokaoEntityInspection }
    | { status: "invalid_event"; issues: LearningEventValidationIssue[] }
    | { status: "persistence_error"; error: unknown };

export interface GaokaoManagerDependencies {
    getData: () => GaokaoPluginData;
    persist: () => Promise<void>;
    eventFactory?: LearningEventFactory;
}

export class GaokaoManager {
    private readonly registry = new GaokaoEntityRegistry();
    private readonly dependencies: GaokaoManagerDependencies;
    private eventWriteQueue: Promise<void> = Promise.resolve();

    constructor(dependencies: GaokaoManagerDependencies) {
        this.dependencies = dependencies;
    }

    rebuildIndex(sources: GaokaoEntitySource[]): void {
        this.registry.rebuild(sources);
    }

    updateEntitySource(path: string, frontmatter: unknown): void {
        this.registry.upsert(path, frontmatter);
    }

    removeEntitySource(path: string): void {
        this.registry.remove(path);
    }

    renameEntitySource(oldPath: string, newPath: string): void {
        this.registry.rename(oldPath, newPath);
    }

    inspect(path: string): GaokaoEntityInspection {
        return this.registry.inspect(path);
    }

    getHistory(entityId: string): LearningEvent[] {
        return getLearningEventHistory(this.dependencies.getData().learningEvents, entityId);
    }

    getCandidatePaths(entityId: string): string[] {
        return this.registry.getCandidatePaths(entityId);
    }

    getKnowledgePoints() {
        return this.registry.getKnowledgePoints();
    }

    getEntities() {
        return this.registry.getEntities();
    }

    getInspections(): GaokaoEntityInspection[] {
        return this.registry.getAllInspections();
    }

    resolveEntity(entityId: string) {
        return this.registry.getEntityById(entityId);
    }

    async recordForPath(
        path: string,
        input: Omit<LearningEventInput, "entity_id" | "source_path">,
    ): Promise<RecordLearningEventResult> {
        const inspection = this.registry.inspect(path);
        if (inspection.status === "ordinary") return { status: "ordinary", inspection };
        if (inspection.status !== "valid" || !inspection.entity) {
            return { status: "invalid_entity", inspection };
        }

        return await this.enqueueEventWrite(async () => {
            const currentInspection = this.registry.inspect(path);
            if (currentInspection.status === "ordinary") {
                return { status: "ordinary", inspection: currentInspection };
            }
            if (currentInspection.status !== "valid" || !currentInspection.entity) {
                return { status: "invalid_entity", inspection: currentInspection };
            }

            const data = this.dependencies.getData();
            const existingIds = new Set(data.learningEvents.map((event) => event.event_id));
            const created = createLearningEvent(
                {
                    ...input,
                    entity_id: currentInspection.entity.gaokao_id,
                    source_path: path,
                },
                existingIds,
                this.dependencies.eventFactory,
            );
            if (created.ok === false) return { status: "invalid_event", issues: created.issues };

            data.learningEvents.push(created.event);
            try {
                await this.dependencies.persist();
            } catch (error: unknown) {
                const index = data.learningEvents.findIndex(
                    (event) => event.event_id === created.event.event_id,
                );
                if (index >= 0) data.learningEvents.splice(index, 1);
                return { status: "persistence_error", error };
            }
            return { status: "recorded", event: created.event };
        });
    }

    async recordReviewForPath(
        path: string,
        response: ReviewResponse,
        feedback: GaokaoFeedback = {},
    ): Promise<RecordLearningEventResult | null> {
        const rating = reviewResponseToRating(response);
        if (rating === null) return null;
        return await this.recordForPath(path, { event_type: "review", rating, ...feedback });
    }

    private async enqueueEventWrite<T>(operation: () => Promise<T>): Promise<T> {
        const result = this.eventWriteQueue.then(operation, operation);
        this.eventWriteQueue = result.then(
            (): undefined => undefined,
            (): undefined => undefined,
        );
        return await result;
    }
}

export function reviewResponseToRating(response: ReviewResponse): ReviewRating | null {
    switch (response) {
        case ReviewResponse.Again:
            return "again";
        case ReviewResponse.Hard:
            return "hard";
        case ReviewResponse.Good:
            return "good";
        case ReviewResponse.Easy:
            return "easy";
        case ReviewResponse.Reset:
            return null;
    }
}
