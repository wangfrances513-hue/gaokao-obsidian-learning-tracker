/* eslint-disable camelcase -- Existing GAOKAO entity types use persisted snake_case values. */

import { TICKS_PER_DAY } from "src/data/constants";
import { LearningEvent, ReviewRating } from "src/gaokao/learning-event";
import { GaokaoEntity, GaokaoEntityType, GaokaoSubject } from "src/gaokao/schema";
import { deriveRoundState, ROUND_ACTION, ReviewRound, RoundStateResult } from "src/gaokao/review-flow";

export const SUBJECT_PRIORITY_WEIGHTS: Readonly<Record<GaokaoSubject, number>> = Object.freeze({
    数学: 1,
    物理: 0.85,
    化学: 0.65,
    生物: 0.6,
    英语: 0.45,
    语文: 0.3,
});

export const DEFAULT_MINIMUM_REVIEW_LIMIT = 3;
export const DEFAULT_DISCRETIONARY_LIMIT = 3;

export type TodayScheduleState =
    | { kind: "none" }
    | { kind: "scheduled"; dueUnix: number }
    | { kind: "unavailable" | "invalid" };

export interface TodayPlannerCandidate {
    path: string;
    title: string;
    entity: GaokaoEntity;
    events: readonly LearningEvent[];
    schedule: TodayScheduleState;
    flow?: RoundStateResult;
    flowIssue?: string;
    r1Action?: string;
}

export type TodayNeedLabel = "again" | "hard" | "unrated" | "good" | "easy";

export interface TodayPlanItem {
    entityId: string;
    path: string;
    title: string;
    subject: GaokaoSubject;
    entityType: GaokaoEntityType;
    subjectWeight: number;
    needLabel: TodayNeedLabel;
    needScore: number;
    round?: ReviewRound;
    cycleRef?: string | null;
    action: string;
    flowIssue?: string;
    dueUnix?: number;
    dueStatus?: "overdue" | "due_today";
    overdueDays?: number;
}

export interface TodayPlan {
    todayUnix: number;
    protectedReviews: TodayPlanItem[];
    minimumRecommendedReviews: TodayPlanItem[];
    remainingDueBacklog: TodayPlanItem[];
    discretionaryWork: TodayPlanItem[];
    unavailableScheduleCount: number;
}

export interface TodayPlannerOptions {
    todayUnix: number;
    minimumReviewLimit?: number;
    discretionaryLimit?: number;
}

const RATING_NEED: Readonly<Record<ReviewRating, number>> = Object.freeze({
    again: 4,
    hard: 3,
    good: 1,
    easy: 0,
});

const ENTITY_TYPE_ORDER: Readonly<Record<GaokaoEntityType, number>> = Object.freeze({
    knowledge_point: 0,
    problem_case: 1,
    resource_unit: 2,
});

function isReviewRating(value: unknown): value is ReviewRating {
    return value === "again" || value === "hard" || value === "good" || value === "easy";
}

export function calculateCurrentNeed(events: readonly LearningEvent[]): {
    label: TodayNeedLabel;
    score: number;
} {
    for (let index = events.length - 1; index >= 0; index--) {
        const rating = events[index]?.rating;
        if (isReviewRating(rating)) return { label: rating, score: RATING_NEED[rating] };
    }
    return { label: "unrated", score: 2 };
}

function priorityTier(entity: GaokaoEntity): number {
    if (entity.entity_type !== "knowledge_point") return 4;
    return entity.priority_tier ?? 4;
}

function toPlanItem(candidate: TodayPlannerCandidate): TodayPlanItem {
    const need = calculateCurrentNeed(candidate.events);
    const flow = candidate.flow ?? deriveRoundState(candidate.events, candidate.entity.gaokao_id);
    const flowIssue = candidate.flowIssue ?? (flow.ok === false ? flow.issue : undefined);
    return {
        entityId: candidate.entity.gaokao_id,
        path: candidate.path,
        title: candidate.title,
        subject: candidate.entity.subject,
        entityType: candidate.entity.entity_type,
        subjectWeight: SUBJECT_PRIORITY_WEIGHTS[candidate.entity.subject],
        needLabel: need.label,
        needScore: need.score,
        round: flow.ok ? flow.state.round : undefined,
        cycleRef: flow.ok ? flow.state.cycleRef : undefined,
        action: flowIssue ?? (flow.ok ? (flow.state.round === "R1" ? candidate.r1Action ?? ROUND_ACTION.R1 : ROUND_ACTION[flow.state.round]) : "待核对"),
        ...(flowIssue ? { flowIssue } : {}),
    };
}

function isEligibleStatus(entity: GaokaoEntity): boolean {
    if (entity.status !== undefined && entity.status !== "active") return false;
    if (entity.entity_type !== "resource_unit") return true;
    return entity.resource_status !== "completed" && entity.resource_status !== "verified";
}

function compareProtected(left: TodayPlanItem, right: TodayPlanItem): number {
    const dueDifference = (left.dueUnix ?? 0) - (right.dueUnix ?? 0);
    if (dueDifference !== 0) return dueDifference;
    const needDifference = right.needScore - left.needScore;
    if (needDifference !== 0) return needDifference;
    const idDifference = left.entityId.localeCompare(right.entityId, "en");
    if (idDifference !== 0) return idDifference;
    return left.path.localeCompare(right.path, "zh-CN");
}

function compareDiscretionary(
    left: { candidate: TodayPlannerCandidate; item: TodayPlanItem },
    right: { candidate: TodayPlannerCandidate; item: TodayPlanItem },
): number {
    const needDifference = right.item.needScore - left.item.needScore;
    if (needDifference !== 0) return needDifference;

    const tierDifference =
        priorityTier(left.candidate.entity) - priorityTier(right.candidate.entity);
    if (tierDifference !== 0) return tierDifference;

    const historyDifference = left.candidate.events.length - right.candidate.events.length;
    if (historyDifference !== 0) return historyDifference;

    const typeDifference =
        ENTITY_TYPE_ORDER[left.item.entityType] - ENTITY_TYPE_ORDER[right.item.entityType];
    if (typeDifference !== 0) return typeDifference;

    const weightDifference = right.item.subjectWeight - left.item.subjectWeight;
    if (weightDifference !== 0) return weightDifference;

    const idDifference = left.item.entityId.localeCompare(right.item.entityId, "en");
    if (idDifference !== 0) return idDifference;
    return left.item.path.localeCompare(right.item.path, "zh-CN");
}

function normalizeLimit(value: number | undefined, fallback: number): number {
    if (value === undefined) return fallback;
    if (!Number.isFinite(value)) return fallback;
    return Math.max(0, Math.floor(value));
}

export function buildTodayPlan(
    candidates: readonly TodayPlannerCandidate[],
    options: TodayPlannerOptions,
): TodayPlan {
    const minimumReviewLimit = normalizeLimit(
        options.minimumReviewLimit,
        DEFAULT_MINIMUM_REVIEW_LIMIT,
    );
    const discretionaryLimit = normalizeLimit(
        options.discretionaryLimit,
        DEFAULT_DISCRETIONARY_LIMIT,
    );
    const protectedReviews: TodayPlanItem[] = [];
    const discretionary: { candidate: TodayPlannerCandidate; item: TodayPlanItem }[] = [];
    let unavailableScheduleCount = 0;

    for (const candidate of candidates) {
        if (!isEligibleStatus(candidate.entity)) continue;
        if (candidate.schedule.kind === "unavailable" || candidate.schedule.kind === "invalid") {
            unavailableScheduleCount++;
            continue;
        }

        const item = toPlanItem(candidate);
        if (candidate.schedule.kind === "scheduled") {
            if (!Number.isFinite(candidate.schedule.dueUnix)) {
                unavailableScheduleCount++;
                continue;
            }
            if (candidate.schedule.dueUnix <= options.todayUnix) {
                const overdueDays = Math.max(
                    0,
                    Math.floor((options.todayUnix - candidate.schedule.dueUnix) / TICKS_PER_DAY),
                );
                protectedReviews.push({
                    ...item,
                    dueUnix: candidate.schedule.dueUnix,
                    dueStatus: overdueDays > 0 ? "overdue" : "due_today",
                    overdueDays,
                });
            }
            continue;
        }

        if (item.flowIssue || item.cycleRef !== null) {
            unavailableScheduleCount++;
            continue;
        }
        discretionary.push({ candidate, item });
    }

    protectedReviews.sort(compareProtected);
    discretionary.sort(compareDiscretionary);

    return {
        todayUnix: options.todayUnix,
        protectedReviews,
        minimumRecommendedReviews: protectedReviews.slice(0, minimumReviewLimit),
        remainingDueBacklog: protectedReviews.slice(minimumReviewLimit),
        discretionaryWork: discretionary.slice(0, discretionaryLimit).map(({ item }) => item),
        unavailableScheduleCount,
    };
}
