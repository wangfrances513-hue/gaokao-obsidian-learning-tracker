/* eslint-disable camelcase -- Tests exercise GAOKAO and learning-event persisted contracts. */

import { GaokaoEntityRegistry } from "src/gaokao/entity-registry";
import { LearningEvent, ReviewRating } from "src/gaokao/learning-event";
import { GaokaoEntity, GaokaoSubject } from "src/gaokao/schema";
import {
    buildTodayPlan,
    DEFAULT_ESTIMATED_DURATION_MINUTES,
    estimateDuration,
    SUBJECT_PRIORITY_WEIGHTS,
    TodayPlannerCandidate,
} from "src/gaokao/today-planner";

const DAY = 24 * 60 * 60 * 1000;
const TODAY = Date.UTC(2026, 7, 8);

function entity(
    id: string,
    subject: GaokaoSubject = "数学",
    overrides: Partial<GaokaoEntity> = {},
): GaokaoEntity {
    return {
        gaokao_id: id,
        entity_type: "knowledge_point",
        subject,
        status: "active",
        ...overrides,
    };
}

function event(
    id: string,
    entityId: string,
    input: { rating?: ReviewRating; duration?: number } = {},
): LearningEvent {
    return {
        event_id: id,
        entity_id: entityId,
        event_type: "study",
        timestamp: `2026-08-0${id.length}T00:00:00.000Z`,
        ...(input.rating === undefined ? {} : { rating: input.rating }),
        ...(input.duration === undefined ? {} : { duration_minutes: input.duration }),
    };
}

function candidate(
    id: string,
    subject: GaokaoSubject = "数学",
    input: {
        dueUnix?: number;
        events?: LearningEvent[];
        entityOverrides?: Partial<GaokaoEntity>;
        unavailableSchedule?: boolean;
    } = {},
): TodayPlannerCandidate {
    return {
        path: `${subject}/${id}.md`,
        title: id,
        entity: entity(id, subject, input.entityOverrides),
        events: input.events ?? [],
        schedule: input.unavailableSchedule
            ? { kind: "unavailable" }
            : input.dueUnix === undefined
              ? { kind: "none" }
              : { kind: "scheduled", dueUnix: input.dueUnix },
    };
}

describe("Task 006 Today protected reviews", () => {
    test("never suppresses an overdue low-weight subject for new Math work", () => {
        const chineseOverdue = candidate("chinese-overdue", "语文", { dueUnix: TODAY - DAY });
        const mathNew = candidate("math-new", "数学");
        const plan = buildTodayPlan([mathNew, chineseOverdue], {
            todayUnix: TODAY,
            discretionaryLimit: 1,
        });

        expect(plan.protectedReviews.map((item) => item.entityId)).toEqual(["chinese-overdue"]);
        expect(plan.protectedReviews[0]).toMatchObject({
            dueStatus: "overdue",
            overdueDays: 1,
        });
        expect(plan.discretionaryWork.map((item) => item.entityId)).toEqual(["math-new"]);
    });

    test("classifies before-today, today, and tomorrow at the injected day boundary", () => {
        const plan = buildTodayPlan(
            [
                candidate("before", "物理", { dueUnix: TODAY - DAY }),
                candidate("today", "数学", { dueUnix: TODAY }),
                candidate("tomorrow", "数学", { dueUnix: TODAY + DAY }),
            ],
            { todayUnix: TODAY },
        );

        expect(plan.protectedReviews.map((item) => [item.entityId, item.dueStatus])).toEqual([
            ["before", "overdue"],
            ["today", "due_today"],
        ]);
        expect(plan.protectedReviews).not.toEqual(
            expect.arrayContaining([expect.objectContaining({ entityId: "tomorrow" })]),
        );
        expect(plan.discretionaryWork).toHaveLength(0);
    });

    test("orders oldest due work first and keeps the entire backlog visible", () => {
        const plan = buildTodayPlan(
            Array.from({ length: 5 }, (_, index) =>
                candidate(`due-${index}`, "数学", { dueUnix: TODAY - (5 - index) * DAY }),
            ),
            { todayUnix: TODAY, minimumReviewLimit: 3 },
        );

        expect(plan.protectedReviews).toHaveLength(5);
        expect(plan.minimumRecommendedReviews.map((item) => item.entityId)).toEqual([
            "due-0",
            "due-1",
            "due-2",
        ]);
        expect(plan.remainingDueBacklog.map((item) => item.entityId)).toEqual(["due-3", "due-4"]);
    });
});

describe("Task 006 discretionary ranking", () => {
    test("uses the canonical subject priority baseline for otherwise equal candidates", () => {
        const subjects: GaokaoSubject[] = ["语文", "英语", "生物", "化学", "物理", "数学"];
        const plan = buildTodayPlan(
            subjects.map((subject) => candidate(`candidate-${subject}`, subject)),
            { todayUnix: TODAY, discretionaryLimit: 6 },
        );

        expect(SUBJECT_PRIORITY_WEIGHTS).toEqual({
            数学: 1,
            物理: 0.85,
            化学: 0.65,
            生物: 0.6,
            英语: 0.45,
            语文: 0.3,
        });
        expect(plan.discretionaryWork.map((item) => item.subject)).toEqual([
            "数学",
            "物理",
            "化学",
            "生物",
            "英语",
            "语文",
        ]);
    });

    test("applies the documented latest semantic-rating need signal", () => {
        const ratings: (ReviewRating | undefined)[] = ["easy", "good", undefined, "hard", "again"];
        const plan = buildTodayPlan(
            ratings.map((rating, index) => {
                const id = `math-${index}`;
                return candidate(id, "数学", {
                    events: rating === undefined ? [] : [event(`event-${index}`, id, { rating })],
                });
            }),
            { todayUnix: TODAY, discretionaryLimit: 5 },
        );

        expect(plan.discretionaryWork.map((item) => item.needLabel)).toEqual([
            "again",
            "hard",
            "unrated",
            "good",
            "easy",
        ]);
    });

    test("is deterministic for identical date, metadata, schedules, and events", () => {
        const candidates = [
            candidate("z-id", "数学"),
            candidate("a-id", "数学"),
            candidate("overdue", "英语", { dueUnix: TODAY - 2 * DAY }),
        ];

        expect(buildTodayPlan(candidates, { todayUnix: TODAY })).toEqual(
            buildTodayPlan(candidates, { todayUnix: TODAY }),
        );
        expect(
            buildTodayPlan(candidates, { todayUnix: TODAY }).discretionaryWork.map(
                (item) => item.entityId,
            ),
        ).toEqual(["a-id", "z-id"]);
    });

    test("excludes inactive, completed, future-scheduled, and unavailable candidates", () => {
        const plan = buildTodayPlan(
            [
                candidate("paused", "数学", { entityOverrides: { status: "paused" } }),
                candidate("mastered", "数学", { entityOverrides: { status: "mastered" } }),
                candidate("archived", "数学", { entityOverrides: { status: "archived" } }),
                candidate("completed-resource", "英语", {
                    entityOverrides: {
                        entity_type: "resource_unit",
                        resource_status: "completed",
                    },
                }),
                candidate("future", "数学", { dueUnix: TODAY + DAY }),
                candidate("unavailable", "数学", { unavailableSchedule: true }),
            ],
            { todayUnix: TODAY },
        );

        expect(plan.protectedReviews).toHaveLength(0);
        expect(plan.discretionaryWork).toHaveLength(0);
        expect(plan.unavailableScheduleCount).toBe(1);
    });
});

describe("Task 006 duration estimates", () => {
    test("uses the median of the five most recent valid observations", () => {
        const events = [100, 5, 10, 15, 20, 30].map((duration, index) =>
            event(`duration-${index}`, "math", { duration }),
        );
        expect(estimateDuration(events)).toEqual({
            minutes: 15,
            source: "history",
            observationCount: 5,
        });
    });

    test("uses an explicit fallback when no duration history exists", () => {
        expect(estimateDuration([])).toEqual({
            minutes: DEFAULT_ESTIMATED_DURATION_MINUTES,
            source: "fallback",
            observationCount: 0,
        });
    });

    test("ignores invalid duration values without mutating history", () => {
        const events = [
            event("valid-a", "math", { duration: 10 }),
            event("invalid-negative", "math", { duration: -1 }),
            event("invalid-nan", "math", { duration: Number.NaN }),
            event("invalid-infinite", "math", { duration: Number.POSITIVE_INFINITY }),
            event("valid-b", "math", { duration: 30 }),
        ];
        const before = events.map((item) => ({ ...item }));
        expect(estimateDuration(events)).toEqual({
            minutes: 20,
            source: "history",
            observationCount: 2,
        });
        expect(events).toEqual(before);
    });
});

describe("Task 006 identity and safe eligibility", () => {
    test("keeps gaokao_id stable across rename and move", () => {
        const registry = new GaokaoEntityRegistry();
        const frontmatter = {
            gaokao_id: "stable-math-id",
            entity_type: "knowledge_point",
            subject: "数学",
            status: "active",
        };
        registry.rebuild([{ path: "数学/旧名称.md", frontmatter }]);
        registry.rename("数学/旧名称.md", "数学/新目录/新名称.md");

        expect(registry.getEntityById("stable-math-id")).toEqual({
            path: "数学/新目录/新名称.md",
            entity: frontmatter,
        });
        const plan = buildTodayPlan(
            registry.getEntities().map(({ path, entity }) => ({
                path,
                title: "新名称",
                entity,
                events: [] as LearningEvent[],
                schedule: { kind: "none" },
            })),
            { todayUnix: TODAY },
        );
        expect(plan.discretionaryWork[0]).toMatchObject({
            entityId: "stable-math-id",
            path: "数学/新目录/新名称.md",
        });
    });

    test("does not silently combine duplicate IDs", () => {
        const registry = new GaokaoEntityRegistry();
        const frontmatter = {
            gaokao_id: "duplicate-id",
            entity_type: "knowledge_point",
            subject: "数学",
        };
        registry.rebuild([
            { path: "数学/A.md", frontmatter },
            { path: "数学/B.md", frontmatter },
        ]);

        expect(registry.getEntities()).toEqual([]);
        expect(registry.getCandidatePaths("duplicate-id")).toEqual(["数学/A.md", "数学/B.md"]);
        expect(registry.getAllInspections().map((inspection) => inspection.status)).toEqual([
            "duplicate",
            "duplicate",
        ]);
    });

    test("ordinary notes never become planner candidates", () => {
        const registry = new GaokaoEntityRegistry();
        registry.rebuild([
            { path: "普通笔记.md", frontmatter: { aliases: ["普通"] } },
            {
                path: "数学/有效.md",
                frontmatter: {
                    gaokao_id: "valid-id",
                    entity_type: "knowledge_point",
                    subject: "数学",
                },
            },
        ]);
        expect(registry.getEntities().map(({ path }) => path)).toEqual(["数学/有效.md"]);
        expect(registry.inspect("普通笔记.md").status).toBe("ordinary");
    });

    test("repeated Today reads have no input or event side effects", () => {
        const history = [event("history", "math-id", { rating: "hard", duration: 15 })];
        const candidates = [candidate("math-id", "数学", { events: history })];
        const before = JSON.stringify(candidates);

        buildTodayPlan(candidates, { todayUnix: TODAY });
        buildTodayPlan(candidates, { todayUnix: TODAY });

        expect(JSON.stringify(candidates)).toBe(before);
        expect(history).toHaveLength(1);
    });
});

describe("Task 006 empty states", () => {
    test("supports no due reviews while still recommending discretionary work", () => {
        const plan = buildTodayPlan([candidate("new-math")], { todayUnix: TODAY });
        expect(plan.protectedReviews).toHaveLength(0);
        expect(plan.discretionaryWork).toHaveLength(1);
    });

    test("supports due reviews with no discretionary work", () => {
        const plan = buildTodayPlan([candidate("due-math", "数学", { dueUnix: TODAY })], {
            todayUnix: TODAY,
        });
        expect(plan.protectedReviews).toHaveLength(1);
        expect(plan.discretionaryWork).toHaveLength(0);
    });

    test("does not manufacture tasks when nothing is eligible", () => {
        const plan = buildTodayPlan([], { todayUnix: TODAY });
        expect(plan.protectedReviews).toEqual([]);
        expect(plan.minimumRecommendedReviews).toEqual([]);
        expect(plan.remainingDueBacklog).toEqual([]);
        expect(plan.discretionaryWork).toEqual([]);
    });
});
