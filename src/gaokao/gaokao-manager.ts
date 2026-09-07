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
    RoundScheduleReceipt,
} from "src/gaokao/learning-event";
import {
    completionIssue, deriveRoundState, hasCycleRef, isPendingRoundCommit,
    PendingRoundCommit, recoveryPosition, ROUND_EVENT_TYPE, RoundCompletionInput,
    sameRoundData, schedulerResponseFor,
} from "src/gaokao/review-flow";
import { ReviewResponse } from "src/scheduling/algorithms/base/repetition-item";

export interface GaokaoPluginData {
    version: 1 | 2;
    learningEvents: LearningEvent[];
    pendingRoundCommit?: PendingRoundCommit;
    [key: string]: unknown;
}

export function createDefaultGaokaoPluginData(): GaokaoPluginData {
    return { version: 2, learningEvents: [] };
}

export interface GaokaoDataTransaction {
    readonly data: GaokaoPluginData;
    save: (next: GaokaoPluginData) => Promise<void>;
}

export interface RoundTarget {
    entityId: string;
    path: string;
    schedule: RoundScheduleReceipt | null;
}

export interface RoundCommitIO {
    readTarget: (entityId: string) => Promise<RoundTarget>;
    checkAction: (target: RoundTarget, input: RoundCompletionInput) => Promise<void>;
    prepareSchedule: (target: RoundTarget, response: ReviewResponse) => RoundScheduleReceipt;
    writeSchedule: (pending: PendingRoundCommit) => Promise<void>;
    refresh: (event: LearningEvent) => Promise<void>;
}

export type RoundCommitResult =
    | { status: "committed"; event: LearningEvent; refreshIssue?: string }
    | { status: "blocked" | "pending"; issue: string };

export interface RoundRecoveryInspection {
    position: "none" | "before" | "after" | "ambiguous" | "changed" | "committed";
    issue: string;
    pending?: PendingRoundCommit;
}

export type RecordLearningEventResult =
    | { status: "recorded"; event: LearningEvent }
    | { status: "ordinary"; inspection: GaokaoEntityInspection }
    | { status: "invalid_entity"; inspection: GaokaoEntityInspection }
    | { status: "invalid_event"; issues: LearningEventValidationIssue[] }
    | { status: "persistence_error"; error: unknown };

export interface GaokaoManagerDependencies {
    getData: () => GaokaoPluginData;
    transact: <T>(operation: (transaction: GaokaoDataTransaction) => Promise<T>) => Promise<T>;
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

        try {
        return await this.enqueueEventWrite<RecordLearningEventResult>(async () => this.dependencies.transact<RecordLearningEventResult>(async (transaction) => {
            const currentInspection = this.registry.inspect(path);
            if (currentInspection.status === "ordinary") {
                return { status: "ordinary", inspection: currentInspection };
            }
            if (currentInspection.status !== "valid" || !currentInspection.entity) {
                return { status: "invalid_entity", inspection: currentInspection };
            }

            const data = transaction.data;
            if (hasCycleRef(input as LearningEvent) || input.schedule_after !== undefined || input.evidence !== undefined) {
                return { status: "invalid_event", issues: [{ code: "flow_context", message: "流程上下文只能通过完成本轮入口提交。" }] };
            }
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

            try {
                await transaction.save({ ...data, learningEvents: [...data.learningEvents, created.event] });
            } catch (error: unknown) {
                return { status: "persistence_error", error };
            }
            return { status: "recorded", event: created.event };
        }));
        } catch (error: unknown) { return { status: "persistence_error", error }; }
    }

    getRoundState(entityId: string) {
        const data = this.dependencies.getData();
        return deriveRoundState(data.learningEvents, entityId, data.version);
    }

    async commitRound(input: RoundCompletionInput, io: RoundCommitIO): Promise<RoundCommitResult> {
        let result: RoundCommitResult;
        try {
            result = await this.dependencies.transact(async (transaction): Promise<RoundCommitResult> => {
                const data = transaction.data;
                if (data.pendingRoundCommit) return { status: "pending", issue: "有未确认提交，请先核对同一笔 pending。" };
                const derived = deriveRoundState(data.learningEvents, input.entityId, data.version);
                if (derived.ok === false) return { status: "blocked", issue: derived.issue };
                const timestamp = (this.dependencies.eventFactory?.now() ?? new Date()).toISOString();
                const issue = completionIssue(input, derived.state,
                    data.learningEvents.filter((event) => event.entity_id === input.entityId), timestamp);
                if (issue) return { status: "blocked", issue };
                const target = await io.readTarget(input.entityId);
                if (target.entityId !== input.entityId) throw new Error("提交目标身份不符。");
                if (input.expectedPath !== undefined && target.path !== input.expectedPath) throw new Error("提交目标路径已改变。");
                if (derived.state.tail && !sameRoundData(target.schedule, derived.state.tail.schedule_after)) {
                    return { status: "blocked", issue: "当前持久排期与链尾收据不符，未覆盖或重新评分。" };
                }
                await io.checkAction(target, input);
                const after = io.prepareSchedule(target, schedulerResponseFor(input.userRating));
                const created = createLearningEvent({
                    entity_id: input.entityId,
                    event_type: ROUND_EVENT_TYPE[derived.state.round],
                    source_path: target.path,
                    cycle_ref: input.expectedCycleRef,
                    schedule_after: after,
                    ...(input.userRating === undefined ? {} : { rating: input.userRating }),
                    ...(input.evidence === undefined ? {} : { evidence: input.evidence }),
                    ...(input.durationMinutes === undefined ? {} : { duration_minutes: input.durationMinutes }),
                }, new Set(data.learningEvents.map((event) => event.event_id)), {
                    createId: this.dependencies.eventFactory?.createId ?? (() => crypto.randomUUID()),
                    now: () => new Date(timestamp),
                });
                if (created.ok === false) return { status: "blocked", issue: created.issues.map((item) => item.message).join(" ") };
                const pending: PendingRoundCommit = { event: created.event, schedule_before: target.schedule };
                try {
                    await transaction.save({ ...data, version: 2, pendingRoundCommit: pending });
                } catch (error: unknown) {
                    return { status: "pending", issue: `准备保存未确认，未开始排期写入：${errorMessage(error)}` };
                }
                try {
                    await io.writeSchedule(pending);
                } catch (error: unknown) {
                    // A throw does not establish that the note write did not happen.
                    const observed = await this.inspectPending(transaction.data, io);
                    return { status: "pending", issue: `${observed.issue} ${errorMessage(error)}` };
                }
                const observed = await io.readTarget(input.entityId);
                if (observed.path !== target.path || !sameRoundData(observed.schedule, after)) {
                    return { status: "pending", issue: "排期回读未确认目标状态；保留 pending，未追加事件。" };
                }
                // A successful write plus readback establishes this live boundary even if before=after.
                return await this.finishPending(transaction, pending, io);
            });
        } catch (error: unknown) {
            result = { status: this.dependencies.getData().pendingRoundCommit ? "pending" : "blocked", issue: errorMessage(error) };
        }
        return await this.refreshCommitted(result, io);
    }

    async inspectRoundRecovery(io: RoundCommitIO): Promise<RoundRecoveryInspection> {
        try {
            return await this.dependencies.transact(async (transaction) => await this.inspectPending(transaction.data, io));
        } catch (error: unknown) {
            return { position: "changed", issue: errorMessage(error) };
        }
    }

    /** Called only by an explicit recovery choice, never by load or redraw. */
    async recoverRound(eventId: string, choice: "continue" | "record", io: RoundCommitIO): Promise<RoundCommitResult> {
        let result: RoundCommitResult;
        try {
            result = await this.dependencies.transact(async (transaction): Promise<RoundCommitResult> => {
                const observed = await this.inspectPending(transaction.data, io);
                const pending = observed.pending;
                if (!pending || pending.event.event_id !== eventId) return { status: "blocked", issue: "恢复目标已改变。" };
                if (observed.position === "before" && choice === "continue") {
                    try { await io.writeSchedule(pending); }
                    catch (error: unknown) { return { status: "pending", issue: errorMessage(error) }; }
                } else if (!((observed.position === "after" || observed.position === "committed") && choice === "record")) {
                    return { status: "pending", issue: observed.issue };
                }
                return await this.finishPending(transaction, pending, io);
            });
        } catch (error: unknown) {
            result = { status: "pending", issue: errorMessage(error) };
        }
        return await this.refreshCommitted(result, io);
    }

    private async inspectPending(data: GaokaoPluginData, io: RoundCommitIO): Promise<RoundRecoveryInspection> {
        const pending = data.pendingRoundCommit;
        if (!pending) return { position: "none", issue: "没有待恢复提交。" };
        if (data.version !== 2 || !isPendingRoundCommit(pending)) return { position: "changed", issue: "pending 结构或版本无法识别。" };
        const existing = data.learningEvents.find((event) => event.event_id === pending.event.event_id);
        if (existing && !sameRoundData(existing, pending.event)) return { position: "changed", issue: "固定事件 ID 的内容不符。", pending };
        const history = data.learningEvents.filter((event) => event.event_id !== pending.event.event_id);
        const prior = deriveRoundState(history, pending.event.entity_id, data.version);
        const replay = deriveRoundState([...history, pending.event], pending.event.entity_id, data.version);
        if (prior.ok === false || replay.ok === false || prior.state.cycleRef !== pending.event.cycle_ref ||
            (prior.state.tail && !sameRoundData(prior.state.tail.schedule_after, pending.schedule_before))) {
            return { position: "changed", issue: "pending 的前驱、事件链或收据不符。", pending };
        }
        const actual = await io.readTarget(pending.event.entity_id);
        if (actual.path !== pending.event.source_path) return { position: "changed", issue: "pending 的目标路径已改变，停止恢复。", pending };
        const position = recoveryPosition(pending, actual.schedule);
        if (existing) return { position: position === "after" || position === "ambiguous" ? "committed" : "changed", issue: "固定事件已存在，仅可核对并清除对应 pending。", pending };
        const messages = {
            before: "排期仍为 before，本轮未完成；可明确继续同一候选。",
            after: "排期已更新，记录待核对；可仅完成固定 ID 的记录。",
            ambiguous: "before 与 after 相同，无法自动确定中断位置；保留 pending 并停止。",
            changed: "持久排期与 before/after 均不符；保留 pending 并停止。",
        };
        return { position, issue: messages[position], pending };
    }

    private async finishPending(transaction: GaokaoDataTransaction, pending: PendingRoundCommit, io: RoundCommitIO): Promise<RoundCommitResult> {
        const actual = await io.readTarget(pending.event.entity_id);
        if (actual.path !== pending.event.source_path || !sameRoundData(actual.schedule, pending.event.schedule_after)) {
            return { status: "pending", issue: "事件提交前排期或身份发生变化。" };
        }
        const data = transaction.data;
        const existing = data.learningEvents.find((event) => event.event_id === pending.event.event_id);
        if (existing && !sameRoundData(existing, pending.event)) return { status: "pending", issue: "固定事件 ID 内容冲突。" };
        const next = { ...data, learningEvents: existing ? [...data.learningEvents] : [...data.learningEvents, pending.event] };
        const replay = deriveRoundState(next.learningEvents, pending.event.entity_id, next.version);
        if (replay.ok === false) return { status: "pending", issue: replay.issue };
        delete next.pendingRoundCommit;
        try { await transaction.save(next); }
        catch (error: unknown) { return { status: "pending", issue: `排期已更新，记录保存未确认：${errorMessage(error)}` }; }
        return { status: "committed", event: pending.event };
    }

    private async refreshCommitted(result: RoundCommitResult, io: RoundCommitIO): Promise<RoundCommitResult> {
        if (result.status !== "committed") return result;
        try { await io.refresh(result.event); }
        catch (error: unknown) { return { ...result, refreshIssue: `本轮已提交，派生界面刷新失败：${errorMessage(error)}` }; }
        return result;
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

function errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : "提交状态无法确认。";
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
