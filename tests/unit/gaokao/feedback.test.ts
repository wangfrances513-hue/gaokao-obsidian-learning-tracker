/* eslint-disable camelcase -- Tests exercise persisted snake_case feedback fields. */

import {
    formatEventConfirmation,
    GaokaoSubmissionGuard,
    getFollowUpGuidance,
    parseCustomDuration,
    QUICK_DURATIONS,
    runScheduledReviewWorkflow,
} from "src/gaokao/feedback";

describe("Task 005 low-friction feedback contract", () => {
    test("exposes the required quick durations", () => {
        expect(QUICK_DURATIONS).toEqual([5, 10, 15, 20, 30, 45, 60]);
        expect(formatEventConfirmation("review", "Good", { duration_minutes: 15 })).toBe(
            "Good · 15 min\n已记录",
        );
    });

    test.each([
        ["0", 0],
        ["12.5", 12.5],
        [" 45 ", 45],
    ])("accepts custom duration %s", (raw, expected) => {
        expect(parseCustomDuration(raw)).toEqual({ ok: true, value: expected });
    });

    test.each(["", "-1", "NaN", "Infinity", "十"])("rejects invalid custom duration %p", (raw) => {
        const result = parseCustomDuration(raw);
        expect(result.ok).toBe(false);
        expect(result.message).toBeDefined();
    });

    test("cancellation records the semantic rating with optional fields absent", async () => {
        const sequence: string[] = [];
        const result = await runScheduledReviewWorkflow({
            schedule: () => {
                sequence.push("scheduled");
                return Promise.resolve();
            },
            captureFeedback: () => {
                sequence.push("cancelled");
                return Promise.resolve(null);
            },
            recordEvent: (feedback) => {
                sequence.push("recorded");
                return Promise.resolve({ rating: "good", ...feedback });
            },
        });

        expect(sequence).toEqual(["scheduled", "cancelled", "recorded"]);
        expect(result.recordResult).toEqual({ rating: "good" });
        expect(result.feedback).toEqual({});
    });

    test("scheduler failure cannot produce a false completed-review event", async () => {
        const capture = jest.fn<Promise<null>, []>(() => Promise.resolve(null));
        const record = jest.fn<Promise<void>, [unknown]>(() => Promise.resolve());
        await expect(
            runScheduledReviewWorkflow({
                schedule: () => Promise.reject(new Error("scheduler write failed")),
                captureFeedback: capture,
                recordEvent: record,
            }),
        ).rejects.toThrow("scheduler write failed");
        expect(capture).not.toHaveBeenCalled();
        expect(record).not.toHaveBeenCalled();
    });

    test("optional UI failure falls back to a rating-only event", async () => {
        const result = await runScheduledReviewWorkflow({
            schedule: () => Promise.resolve(),
            captureFeedback: () => Promise.reject(new Error("modal unavailable")),
            recordEvent: (feedback) => Promise.resolve(feedback),
        });
        expect(result.feedback).toEqual({});
        expect(result.captureError).toBeInstanceOf(Error);
        expect(result.recordResult).toEqual({});
    });

    test("rapid duplicate submission is rejected only while the first operation is pending", async () => {
        const guard = new GaokaoSubmissionGuard();
        let release: () => void = () => undefined;
        const pending = new Promise<void>((resolve) => {
            release = resolve;
        });
        const first = guard.run("math-001", async () => {
            await pending;
            return "first";
        });
        const duplicate = await guard.run("math-001", () => Promise.resolve("duplicate"));
        expect(duplicate).toEqual({ status: "duplicate" });

        release();
        expect(await first).toEqual({ status: "started", value: "first" });
        expect(await guard.run("math-001", () => Promise.resolve("later"))).toEqual({
            status: "started",
            value: "later",
        });
    });

    test("Again guidance is subject- and K/M/P/C/R-aware", () => {
        expect(getFollowUpGuidance("数学", "again", "K")).toMatch(/定义、公式/);
        expect(getFollowUpGuidance("数学", "again", "M")).toMatch(/标准模型/);
        expect(getFollowUpGuidance("物理", "again", "P")).toMatch(/方向、符号/);
        expect(getFollowUpGuidance("物理", "again", "C")).toMatch(/状态、过程/);
        expect(getFollowUpGuidance("物理", "again", "R")).toMatch(/闭卷复现/);
        expect(getFollowUpGuidance("数学", "hard", "P")).toMatch(/同类标准题/);
        expect(getFollowUpGuidance("数学", "good")).toMatch(/下一次计划复习/);
        expect(getFollowUpGuidance("物理", "easy")).toMatch(/既有调度/);
    });

    test.each([
        ["化学", "K", /物质、反应与条件/],
        ["化学", "P", /方程、步骤、单位/],
        ["生物", "M", /机制、实验或答题路径/],
        ["生物", "C", /材料、图表、条件/],
        ["英语", "R", /闭卷提取规则或表达/],
        ["语文", "C", /文本、题干、语境/],
    ] as const)("Task 007 %s guidance preserves %s semantics", (subject, mistakeType, pattern) => {
        expect(getFollowUpGuidance(subject, "again", mistakeType)).toMatch(pattern);
        expect(getFollowUpGuidance(subject, "hard", mistakeType)).toMatch(/既有调度/);
    });
});
