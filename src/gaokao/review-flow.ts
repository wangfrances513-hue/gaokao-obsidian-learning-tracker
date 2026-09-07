/* eslint-disable camelcase -- Persisted event field names follow the v0.2 contract. */

import {
    isRoundEvidence, isRoundScheduleReceipt, LearningEvent, LearningEventType,
    ReviewRating, RoundEvidence, RoundScheduleReceipt, validateLearningEventInput,
} from "src/gaokao/learning-event";
import { ReviewResponse } from "src/scheduling/algorithms/base/repetition-item";

export type ReviewRound = "R1" | "R2" | "R3" | "R4" | "R5";
export const ROUND_EVENT_TYPE: Readonly<Record<ReviewRound, LearningEventType>> = {
    R1: "study", R2: "review", R3: "review", R4: "practice", R5: "verification",
};
export const ROUND_ACTION: Readonly<Record<ReviewRound, string>> = {
    R1: "确认来源与入库，完成 R1",
    R2: "打开无答案题面，尝试重建",
    R3: "打开 3–5 个 Cues，尝试回忆",
    R4: "完成现实同构题后记录本轮结果",
    R5: "完成现实验证并核对结果后记录",
};

export interface PendingRoundCommit {
    event: LearningEvent;
    schedule_before: RoundScheduleReceipt | null;
}

export interface RoundState {
    round: ReviewRound;
    cycleRef: string | null;
    tail: LearningEvent | null;
}

export type RoundStateResult =
    | { ok: true; state: RoundState }
    | { ok: false; issue: string };

/** These confirmations only live in the submitting session, not in plugin data. */
export interface RoundCompletionInput {
    entityId: string;
    expectedCycleRef: string | null;
    expectedPath?: string;
    expectedSubject?: string;
    expectedSourceText?: string;
    userRating?: ReviewRating;
    evidence?: RoundEvidence;
    durationMinutes?: number;
    actionConfirmed: boolean;
    sourceConfirmed?: boolean;
    subjectConfirmed?: boolean;
    originalRetained?: boolean;
    presentationConfirmed?: boolean;
    resultChecked?: boolean;
    noModelHint?: boolean;
    isolatedConfirmed?: boolean;
    fullPaperLimitConfirmed?: boolean;
    unregisteredActivityConfirmed?: boolean;
    speedVerification?: boolean;
}

export function nextReviewRound(round: ReviewRound, rating?: ReviewRating): ReviewRound {
    if (round === "R1") return "R2";
    if (round === "R5" || rating === "good" || rating === "easy") return "R5";
    return round === "R2" ? "R3" : round === "R3" ? "R4" : "R5";
}

export function schedulerResponseFor(rating?: ReviewRating): ReviewResponse {
    switch (rating) {
        case "again": return ReviewResponse.Again;
        case "hard": return ReviewResponse.Hard;
        case "easy": return ReviewResponse.Easy;
        default: return ReviewResponse.Good;
    }
}

export function hasCycleRef(event: LearningEvent): boolean {
    return Object.prototype.hasOwnProperty.call(event, "cycle_ref");
}

/** Order-independent comparison of JSON data, including field presence. */
export function sameRoundData(left: unknown, right: unknown): boolean {
    const canonical = (value: unknown): unknown => {
        if (value instanceof Date) return value.toISOString();
        if (Array.isArray(value)) return value.map(canonical);
        if (value && typeof value === "object") {
            return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b))
                .map(([key, item]) => [key, canonical(item)]));
        }
        return value;
    };
    return JSON.stringify(canonical(left)) === JSON.stringify(canonical(right));
}

export function deriveRoundState(
    events: readonly LearningEvent[], entityId: string, version: number = 2,
): RoundStateResult {
    const fail = (issue: string): RoundStateResult => ({ ok: false, issue });
    if (version !== 1 && version !== 2) return fail("不识别的 GAOKAO 数据版本。");
    const flow = events.filter((event) => event.entity_id === entityId && hasCycleRef(event));
    if (flow.length && version !== 2) return fail("旧版本中存在未识别的流程上下文。");
    const allIds = new Map<string, LearningEvent>();
    for (const event of events) {
        if (allIds.has(event.event_id)) return fail("事件 ID 重复，流程已停止。");
        allIds.set(event.event_id, event);
    }
    if (flow.length === 0) return { ok: true, state: { round: "R1", cycleRef: null, tail: null } };
    const roots = flow.filter((event) => event.cycle_ref === null);
    if (roots.length !== 1) return fail("流程必须恰好有一条 R1 起点。");
    const successors = new Map<string | null, LearningEvent>();
    for (const event of flow) {
        if (!event.event_id || !Number.isFinite(Date.parse(event.timestamp)) ||
            validateLearningEventInput(event).length) return fail("流程事件字段无效。");
        const ref = event.cycle_ref;
        if (ref === undefined || successors.has(ref)) return fail("流程前驱不明确或存在分叉。");
        if (ref !== null) {
            const predecessor = allIds.get(ref);
            if (!predecessor || predecessor.entity_id !== entityId || !hasCycleRef(predecessor)) {
                return fail("流程断链或跨 Entity 引用。");
            }
        }
        successors.set(ref, event);
    }
    let round: ReviewRound = "R1";
    let tail: LearningEvent | null = null;
    let current: LearningEvent | undefined = roots[0];
    const visited = new Set<string>();
    while (current) {
        if (visited.has(current.event_id)) return fail("流程存在循环引用。");
        if (current.event_type !== ROUND_EVENT_TYPE[round]) return fail("事件类型与当前行动不符。");
        if (tail && Date.parse(current.timestamp) < Date.parse(tail.timestamp)) return fail("流程时间顺序不明确。");
        if (round === "R4" || round === "R5") {
            const issue = evidenceIssue(current.evidence, round, tail, current.timestamp,
                events.filter((event) => event.entity_id === entityId && event.event_id !== current?.event_id));
            if (issue) return fail(issue);
        } else if (current.evidence !== undefined) return fail("R1–R3 不接受现实训练替代证据。");
        if (current.duration_minutes !== undefined &&
            (round !== "R5" || current.evidence?.mode !== "isolated")) return fail("流程用时仅适用于 R5 Isolated。");
        visited.add(current.event_id);
        round = nextReviewRound(round, current.rating);
        tail = current;
        current = successors.get(current.event_id);
    }
    if (visited.size !== flow.length) return fail("存在无法到达的流程事件。");
    return { ok: true, state: { round, cycleRef: tail?.event_id ?? null, tail } };
}

function evidenceKey(evidence: RoundEvidence): string {
    return `${evidence.ref.trim().replace(/\s+/g, " ")}\n${Date.parse(evidence.performed_at)}`;
}

export function evidenceIssue(
    evidence: RoundEvidence | undefined, round: ReviewRound, tail: LearningEvent | null,
    timestamp: string, history: readonly LearningEvent[],
): string | null {
    if (!isRoundEvidence(evidence) || !tail) return "缺少真实题/卷、作答位置或明确发生时间。";
    const occurred = Date.parse(evidence.performed_at);
    if (occurred <= Date.parse(tail.timestamp) || occurred > Date.parse(timestamp)) {
        return "活动必须发生在本周期建立之后、提交之前。";
    }
    if (round === "R4" && evidence.mode !== undefined) return "R4 不保存考试模式。";
    if (round === "R5" && !evidence.mode) return "R5 必须如实选择 Mixed 或 Isolated。";
    if (history.some((event) => isRoundEvidence(event.evidence) && evidenceKey(event.evidence) === evidenceKey(evidence))) {
        return "该现实活动已有记录，不能再次抵扣或跨轮使用。";
    }
    return null;
}

export function completionIssue(
    input: RoundCompletionInput, state: RoundState, history: readonly LearningEvent[], timestamp: string,
): string | null {
    if (state.cycleRef !== input.expectedCycleRef) return "该会话周期已改变，请重新查看当前行动。";
    if (!input.actionConfirmed) return "请先完成并确认本轮真实行动。";
    if (input.userRating !== undefined && !["again", "hard", "good", "easy"].includes(input.userRating)) return "评分无效。";
    if (state.round === "R1" && (!input.subjectConfirmed || !input.sourceConfirmed || !input.originalRetained)) {
        return "R1 需要确认学科、目标、已关联的可读来源及原件保留。";
    }
    if ((state.round === "R2" || state.round === "R3") && !input.presentationConfirmed) {
        return "本轮展示尚未确认就绪，请先完成展示与实际尝试。";
    }
    if (state.round === "R4" || state.round === "R5") {
        if (!input.unregisteredActivityConfirmed) return "仅可登记本周期内尚未入账的真实活动一次。";
        const issue = evidenceIssue(input.evidence, state.round, state.tail, timestamp, history);
        if (issue) return issue;
        if (state.round === "R5") {
            if (!input.resultChecked) return "请先完成真实作答并核对结果；失败也可如实记录。";
            if (input.evidence?.mode === "mixed" && (!input.noModelHint || !input.fullPaperLimitConfirmed)) {
                return "Mixed 需要真实整卷限时，以及作答前未获得对应模型提示的确认。";
            }
            if (input.evidence?.mode === "isolated" && !input.isolatedConfirmed) return "请确认本次实际满足专项验证条件。";
        }
    } else if (input.evidence !== undefined) return "本轮不接受现实训练替代证据。";
    if (input.durationMinutes !== undefined &&
        (state.round !== "R5" || input.evidence?.mode !== "isolated" || !input.speedVerification ||
        !Number.isFinite(input.durationMinutes) || input.durationMinutes < 0)) return "只有明确的 R5 专项速度验证可记录事后单题用时。";
    return null;
}

export type RecoveryPosition = "before" | "after" | "ambiguous" | "changed";
export function recoveryPosition(pending: PendingRoundCommit, actual: RoundScheduleReceipt | null): RecoveryPosition {
    const before = sameRoundData(actual, pending.schedule_before);
    const after = sameRoundData(actual, pending.event.schedule_after);
    return before && after ? "ambiguous" : after ? "after" : before ? "before" : "changed";
}

export function isPendingRoundCommit(value: unknown): value is PendingRoundCommit {
    if (!value || typeof value !== "object") return false;
    const pending = value as PendingRoundCommit;
    return !!pending.event && typeof pending.event.event_id === "string" &&
        pending.event.event_id.length > 0 && hasCycleRef(pending.event) &&
        Number.isFinite(Date.parse(pending.event.timestamp)) &&
        validateLearningEventInput(pending.event).length === 0 &&
        typeof pending.event.source_path === "string" &&
        (pending.schedule_before === null || isRoundScheduleReceipt(pending.schedule_before));
}
