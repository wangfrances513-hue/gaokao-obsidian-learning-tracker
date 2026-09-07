/* eslint-disable camelcase -- Tests exercise persisted snake_case GAOKAO/event contracts. */

import { createDefaultGaokaoPluginData, GaokaoManager } from "src/gaokao/gaokao-manager";
import { MistakeType, ReviewRating } from "src/gaokao/learning-event";
import { ReviewResponse } from "src/scheduling/algorithms/base/repetition-item";

function createHarness() {
    const data = createDefaultGaokaoPluginData();
    const persisted: string[] = [];
    let sequence = 0;
    const manager = new GaokaoManager({
        getData: () => data,
        transact: async (operation) => await operation({ data, save: async (next) => {
            Object.assign(data, next); persisted.push(JSON.stringify(data));
        } }),
        eventFactory: {
            createId: () => `00000000-0000-4000-8000-${String(sequence++).padStart(12, "0")}`,
            now: () => new Date("2026-08-08T06:23:16.000Z"),
        },
    });
    return { data, manager, persisted };
}

const knowledgePoint = {
    gaokao_id: "math-calculus-monotonicity",
    entity_type: "knowledge_point",
    subject: "数学",
    chapter: "函数与导数",
};

const reviewFeedbackCases: readonly [
    ReviewResponse,
    ReviewRating,
    MistakeType | undefined,
    number | undefined,
][] = [
    [ReviewResponse.Again, "again", "K", 15],
    [ReviewResponse.Again, "again", "M", 20],
    [ReviewResponse.Hard, "hard", "P", 5],
    [ReviewResponse.Good, "good", undefined, undefined],
    [ReviewResponse.Easy, "easy", undefined, undefined],
    [ReviewResponse.Hard, "hard", "C", 12.5],
    [ReviewResponse.Good, "good", "R", undefined],
];

describe("GAOKAO manager integration", () => {
    test.each([
        [ReviewResponse.Again, "again"],
        [ReviewResponse.Hard, "hard"],
        [ReviewResponse.Good, "good"],
        [ReviewResponse.Easy, "easy"],
    ] as const)("captures whole-note response %p as %s after linkage", async (response, rating) => {
        const { data, manager, persisted } = createHarness();
        manager.rebuildIndex([
            { path: "数学/函数与导数/导数判断单调性.md", frontmatter: knowledgePoint },
        ]);

        const result = await manager.recordReviewForPath(
            "数学/函数与导数/导数判断单调性.md",
            response,
        );
        expect(result?.status).toBe("recorded");
        expect(data.learningEvents[0]).toMatchObject({
            entity_id: knowledgePoint.gaokao_id,
            event_type: "review",
            rating,
            source_path: "数学/函数与导数/导数判断单调性.md",
        });
        expect(persisted).toHaveLength(1);
    });

    test.each(reviewFeedbackCases)(
        "captures feedback %s + %s + %s + %s",
        async (response, rating, mistakeType, duration) => {
            const { data, manager, persisted } = createHarness();
            manager.updateEntitySource("数学/知识点.md", knowledgePoint);
            const result = await manager.recordReviewForPath("数学/知识点.md", response, {
                ...(mistakeType === undefined ? {} : { mistake_type: mistakeType }),
                ...(duration === undefined ? {} : { duration_minutes: duration }),
            });

            expect(result?.status).toBe("recorded");
            expect(data.learningEvents[0]).toEqual(
                expect.objectContaining({
                    event_type: "review",
                    rating,
                    ...(mistakeType === undefined ? {} : { mistake_type: mistakeType }),
                    ...(duration === undefined ? {} : { duration_minutes: duration }),
                }),
            );
            if (mistakeType === undefined) {
                expect(data.learningEvents[0]).not.toHaveProperty("mistake_type");
            }
            if (duration === undefined) {
                expect(data.learningEvents[0]).not.toHaveProperty("duration_minutes");
            }
            expect(persisted).toHaveLength(1);
        },
    );

    test.each(["study", "practice", "verification"] as const)(
        "records explicit %s events through the shared Task 004 API",
        async (eventType) => {
            const { data, manager } = createHarness();
            manager.updateEntitySource("数学/知识点.md", knowledgePoint);
            const result = await manager.recordForPath("数学/知识点.md", {
                event_type: eventType,
                duration_minutes: 10,
            });
            expect(result.status).toBe("recorded");
            expect(data.learningEvents[0].event_type).toBe(eventType);
        },
    );

    test("does not capture Reset as a semantic review rating", async () => {
        const { data, manager } = createHarness();
        manager.rebuildIndex([{ path: "note.md", frontmatter: knowledgePoint }]);
        expect(await manager.recordReviewForPath("note.md", ReviewResponse.Reset)).toBeNull();
        expect(data.learningEvents).toEqual([]);
    });

    test("ordinary notes retain existing review behavior without GAOKAO persistence", async () => {
        const { data, manager, persisted } = createHarness();
        manager.rebuildIndex([{ path: "日记.md", frontmatter: { tags: ["review"] } }]);

        const result = await manager.recordReviewForPath("日记.md", ReviewResponse.Good);
        expect(result?.status).toBe("ordinary");
        expect(data.learningEvents).toEqual([]);
        expect(persisted).toEqual([]);
    });

    test("invalid and duplicate entities never receive merged history", async () => {
        const { data, manager } = createHarness();
        manager.rebuildIndex([
            { path: "缺少ID.md", frontmatter: { entity_type: "knowledge_point", subject: "数学" } },
            { path: "A.md", frontmatter: knowledgePoint },
            { path: "B.md", frontmatter: { ...knowledgePoint } },
        ]);

        expect((await manager.recordReviewForPath("缺少ID.md", ReviewResponse.Good))?.status).toBe(
            "invalid_entity",
        );
        expect((await manager.recordReviewForPath("A.md", ReviewResponse.Good))?.status).toBe(
            "invalid_entity",
        );
        expect(data.learningEvents).toEqual([]);
    });

    test("rename, move, and recent-event lookup preserve history linkage by gaokao_id", async () => {
        const { manager } = createHarness();
        const original = "数学/函数与导数/导数判断单调性.md";
        const renamed = "数学/函数与导数/导数单调性判断.md";
        const moved = "数学/重点/导数单调性判断.md";
        manager.rebuildIndex([{ path: original, frontmatter: knowledgePoint }]);
        await manager.recordReviewForPath(original, ReviewResponse.Good);

        manager.renameEntitySource(original, renamed);
        manager.renameEntitySource(renamed, moved);
        await manager.recordForPath(moved, {
            event_type: "practice",
            mistake_type: "M",
            duration_minutes: 12.5,
        });

        const history = manager.getHistory(knowledgePoint.gaokao_id);
        expect(history).toHaveLength(2);
        expect(history.map((event) => event.source_path)).toEqual([original, moved]);
        expect(manager.inspect(moved).entity?.gaokao_id).toBe(knowledgePoint.gaokao_id);
    });

    test("serialized plugin data preserves event history across reload", async () => {
        const { data, manager } = createHarness();
        manager.rebuildIndex([{ path: "知识点.md", frontmatter: knowledgePoint }]);
        await manager.recordForPath("知识点.md", {
            event_type: "verification",
            duration_minutes: 5,
        });

        const reloadedData = JSON.parse(JSON.stringify(data)) as typeof data;
        const reloadedManager = new GaokaoManager({
            getData: () => reloadedData,
            transact: async (operation) => await operation({ data: reloadedData, save: async (next) => { Object.assign(reloadedData, next); } }),
            eventFactory: {
                createId: () => "00000000-0000-4000-8000-999999999999",
                now: () => new Date("2026-08-08T08:00:00.000Z"),
            },
        });
        reloadedManager.rebuildIndex([{ path: "知识点.md", frontmatter: knowledgePoint }]);

        expect(reloadedManager.getHistory(knowledgePoint.gaokao_id)).toEqual(data.learningEvents);
    });

    test("does not expose an unconfirmed append when persistence fails", async () => {
        const data = createDefaultGaokaoPluginData();
        const manager = new GaokaoManager({
            getData: () => data,
            transact: async (operation) => await operation({ data, save: async () => { throw new Error("disk unavailable"); } }),
            eventFactory: {
                createId: () => "00000000-0000-4000-8000-999999999999",
                now: () => new Date("2026-08-08T08:00:00.000Z"),
            },
        });
        manager.updateEntitySource("知识点.md", knowledgePoint);

        expect((await manager.recordForPath("知识点.md", { event_type: "study" })).status).toBe(
            "persistence_error",
        );
        expect(data.learningEvents).toEqual([]);
    });

    test("rejects invalid manual event data without persistence", async () => {
        const { data, manager, persisted } = createHarness();
        manager.updateEntitySource("知识点.md", knowledgePoint);
        const result = await manager.recordForPath("知识点.md", {
            event_type: "study",
            duration_minutes: -1,
        });
        expect(result.status).toBe("invalid_event");
        expect(data.learningEvents).toEqual([]);
        expect(persisted).toEqual([]);
    });

    test("serializes concurrent appends in call order with unique IDs", async () => {
        const { data, manager } = createHarness();
        manager.updateEntitySource("知识点.md", knowledgePoint);

        await Promise.all([
            manager.recordForPath("知识点.md", { event_type: "study" }),
            manager.recordForPath("知识点.md", { event_type: "practice", mistake_type: "P" }),
        ]);
        expect(data.learningEvents.map((event) => event.event_id)).toEqual([
            "00000000-0000-4000-8000-000000000000",
            "00000000-0000-4000-8000-000000000001",
        ]);
    });
});
