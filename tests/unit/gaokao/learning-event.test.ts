/* eslint-disable camelcase -- Tests exercise the persisted snake_case event contract. */

import {
    createLearningEvent,
    getLearningEventHistory,
    LearningEvent,
    MISTAKE_TYPES,
    validateLearningEventInput,
} from "src/gaokao/learning-event";

const fixedFactory = {
    createId: () => "123e4567-e89b-42d3-a456-426614174000",
    now: () => new Date("2026-08-08T06:23:16.000Z"),
};

describe("GAOKAO learning events", () => {
    test("generates a UUID event ID and canonical ISO 8601 UTC timestamp", () => {
        const result = createLearningEvent({
            entity_id: "math-calculus-monotonicity",
            event_type: "study",
        });
        expect(result.ok).toBe(true);
        if (result.ok) {
            expect(result.event.event_id).toMatch(
                /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
            );
            expect(new Date(result.event.timestamp).toISOString()).toBe(result.event.timestamp);
        }
    });

    test("produces unique IDs and retries a collision", () => {
        const ids = [
            "123e4567-e89b-42d3-a456-426614174000",
            "123e4567-e89b-42d3-a456-426614174001",
        ];
        const result = createLearningEvent(
            { entity_id: "math-001", event_type: "review", rating: "good" },
            new Set([ids[0]]),
            { ...fixedFactory, createId: () => ids.shift() ?? "" },
        );
        expect(result.ok && result.event.event_id).toBe("123e4567-e89b-42d3-a456-426614174001");
    });

    test("rejects repeated collisions and an invalid clock", () => {
        const collisions = createLearningEvent(
            { entity_id: "math-001", event_type: "study" },
            new Set(["duplicate"]),
            { ...fixedFactory, createId: () => "duplicate" },
        );
        expect(collisions.ok).toBe(false);

        const badClock = createLearningEvent(
            { entity_id: "math-001", event_type: "study" },
            new Set(),
            { ...fixedFactory, now: () => new Date(Number.NaN) },
        );
        expect(badClock.ok).toBe(false);
    });

    test.each(["again", "hard", "good", "easy"] as const)(
        "persists semantic review rating %s",
        (rating) => {
            const result = createLearningEvent(
                { entity_id: "math-001", event_type: "review", rating },
                new Set(),
                fixedFactory,
            );
            expect(result.ok && result.event.rating).toBe(rating);
        },
    );

    test("rejects invalid ratings and event types", () => {
        expect(
            validateLearningEventInput({
                entity_id: "math-001",
                event_type: "review",
                rating: "great" as "good",
            }).map((issue) => issue.code),
        ).toContain("invalid_rating");
        expect(
            validateLearningEventInput({
                entity_id: "math-001",
                event_type: "quiz" as "study",
            }).map((issue) => issue.code),
        ).toContain("invalid_event_type");
    });

    test.each(MISTAKE_TYPES)("persists mistake type %s", (mistakeType) => {
        const result = createLearningEvent(
            { entity_id: "problem-001", event_type: "practice", mistake_type: mistakeType },
            new Set(),
            fixedFactory,
        );
        expect(result.ok && result.event.mistake_type).toBe(mistakeType);
    });

    test("rejects invalid mistake type", () => {
        const issues = validateLearningEventInput({
            entity_id: "problem-001",
            event_type: "practice",
            mistake_type: "X" as "K",
        });
        expect(issues.map((issue) => issue.code)).toContain("invalid_mistake_type");
    });

    test.each([0, 5, 12, 25.5])("persists non-negative duration %p", (duration) => {
        const result = createLearningEvent(
            { entity_id: "math-001", event_type: "study", duration_minutes: duration },
            new Set(),
            fixedFactory,
        );
        expect(result.ok && result.event.duration_minutes).toBe(duration);
    });

    test.each([-1, Number.NaN, Number.POSITIVE_INFINITY])("rejects duration %p", (duration) => {
        const issues = validateLearningEventInput({
            entity_id: "math-001",
            event_type: "study",
            duration_minutes: duration,
        });
        expect(issues.map((issue) => issue.code)).toContain("invalid_duration_minutes");
    });

    test("rejects invalid entity IDs and source paths", () => {
        const issues = validateLearningEventInput({
            entity_id: "Math 001",
            event_type: "study",
            source_path: "",
        });
        expect(issues.map((issue) => issue.code)).toEqual(
            expect.arrayContaining(["invalid_entity_id", "invalid_source_path"]),
        );
    });

    test("returns append history by stable entity ID rather than path", () => {
        const events: LearningEvent[] = [
            {
                event_id: "event-1",
                timestamp: "2026-08-08T06:23:16.000Z",
                entity_id: "math-001",
                event_type: "study",
                source_path: "旧路径.md",
            },
            {
                event_id: "event-2",
                timestamp: "2026-08-08T07:23:16.000Z",
                entity_id: "math-002",
                event_type: "study",
            },
        ];
        const history = getLearningEventHistory(events, "math-001");
        expect(history).toHaveLength(1);
        expect(history[0].source_path).toBe("旧路径.md");
        history[0].source_path = "mutated.md";
        expect(events[0].source_path).toBe("旧路径.md");
    });
});
