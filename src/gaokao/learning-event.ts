/* eslint-disable camelcase -- Persisted learning-event field names are snake_case by contract. */

import { isValidGaokaoId } from "src/gaokao/schema";

export const LEARNING_EVENT_TYPES = ["review", "study", "practice", "verification"] as const;
export type LearningEventType = (typeof LEARNING_EVENT_TYPES)[number];

export const REVIEW_RATINGS = ["again", "hard", "good", "easy"] as const;
export type ReviewRating = (typeof REVIEW_RATINGS)[number];

export const MISTAKE_TYPES = ["K", "M", "P", "C", "R"] as const;
export type MistakeType = (typeof MISTAKE_TYPES)[number];

export interface LearningEvent {
    event_id: string;
    timestamp: string;
    entity_id: string;
    event_type: LearningEventType;
    rating?: ReviewRating;
    mistake_type?: MistakeType;
    duration_minutes?: number;
    source_path?: string;
}

export interface LearningEventInput {
    entity_id: string;
    event_type: LearningEventType;
    rating?: ReviewRating;
    mistake_type?: MistakeType;
    duration_minutes?: number;
    source_path?: string;
}

export interface LearningEventFactory {
    createId: () => string;
    now: () => Date;
}

export interface LearningEventValidationIssue {
    code: string;
    message: string;
}

export type CreateLearningEventResult =
    | { ok: true; event: LearningEvent }
    | { ok: false; issues: LearningEventValidationIssue[] };

const DEFAULT_FACTORY: LearningEventFactory = {
    createId: () => crypto.randomUUID(),
    now: () => new Date(),
};

function isOneOf<T extends string>(value: unknown, allowed: readonly T[]): value is T {
    return typeof value === "string" && allowed.includes(value as T);
}

export function validateLearningEventInput(
    input: LearningEventInput,
): LearningEventValidationIssue[] {
    const issues: LearningEventValidationIssue[] = [];
    if (!isValidGaokaoId(input.entity_id)) {
        issues.push({ code: "invalid_entity_id", message: "entity_id must be a valid gaokao_id." });
    }
    if (!isOneOf(input.event_type, LEARNING_EVENT_TYPES)) {
        issues.push({ code: "invalid_event_type", message: "event_type is not supported." });
    }
    if (input.rating !== undefined && !isOneOf(input.rating, REVIEW_RATINGS)) {
        issues.push({ code: "invalid_rating", message: "rating is not supported." });
    }
    if (input.mistake_type !== undefined && !isOneOf(input.mistake_type, MISTAKE_TYPES)) {
        issues.push({ code: "invalid_mistake_type", message: "mistake_type is not supported." });
    }
    if (
        input.duration_minutes !== undefined &&
        (typeof input.duration_minutes !== "number" ||
            !Number.isFinite(input.duration_minutes) ||
            input.duration_minutes < 0)
    ) {
        issues.push({
            code: "invalid_duration_minutes",
            message: "duration_minutes must be a finite non-negative number.",
        });
    }
    if (
        input.source_path !== undefined &&
        (typeof input.source_path !== "string" || input.source_path.length === 0)
    ) {
        issues.push({ code: "invalid_source_path", message: "source_path must be non-empty." });
    }
    return issues;
}

export function createLearningEvent(
    input: LearningEventInput,
    existingEventIds: ReadonlySet<string> = new Set<string>(),
    factory: LearningEventFactory = DEFAULT_FACTORY,
): CreateLearningEventResult {
    const issues = validateLearningEventInput(input);
    if (issues.length > 0) return { ok: false, issues };

    let eventId = "";
    for (let attempt = 0; attempt < 5; attempt++) {
        eventId = factory.createId();
        if (eventId.length > 0 && !existingEventIds.has(eventId)) break;
        eventId = "";
    }
    if (eventId.length === 0) {
        return {
            ok: false,
            issues: [
                { code: "event_id_collision", message: "Unable to generate a unique event ID." },
            ],
        };
    }

    const now = factory.now();
    if (Number.isNaN(now.valueOf())) {
        return {
            ok: false,
            issues: [
                { code: "invalid_timestamp", message: "Unable to generate a valid timestamp." },
            ],
        };
    }

    return {
        ok: true,
        event: {
            event_id: eventId,
            timestamp: now.toISOString(),
            entity_id: input.entity_id,
            event_type: input.event_type,
            ...(input.rating === undefined ? {} : { rating: input.rating }),
            ...(input.mistake_type === undefined ? {} : { mistake_type: input.mistake_type }),
            ...(input.duration_minutes === undefined
                ? {}
                : { duration_minutes: input.duration_minutes }),
            ...(input.source_path === undefined ? {} : { source_path: input.source_path }),
        },
    };
}

export function getLearningEventHistory(
    events: readonly LearningEvent[],
    entityId: string,
): LearningEvent[] {
    return events.filter((event) => event.entity_id === entityId).map((event) => ({ ...event }));
}
