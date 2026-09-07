/* eslint-disable camelcase -- In-memory faults only; test source prepared, not run in G1. */
import { GaokaoManager, GaokaoPluginData, RoundCommitIO, GaokaoDataTransaction } from "src/gaokao/gaokao-manager";
import { LearningEvent, ReviewRating, RoundScheduleReceipt } from "src/gaokao/learning-event";
import { RoundCompletionInput, sameRoundData } from "src/gaokao/review-flow";
import { ReviewResponse } from "src/scheduling/algorithms/base/repetition-item";

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
const after = { due: "2026-09-10", interval: 2, ease: 250 };
function harness(initial?: GaokaoPluginData) {
    let data: GaokaoPluginData = clone(initial ?? { version: 2, learningEvents: [] });
    let actual: RoundScheduleReceipt | null = data.learningEvents.slice(-1)[0]?.schedule_after ?? null;
    let queue = Promise.resolve();
    let sequence = 0; let saves = 0; let failedSave = -1;
    let path = "synthetic.md"; let entityId = "synthetic-math";
    let now = "2026-09-06T12:00:00Z";
    const trace: string[] = [];
    const transact = async <T>(operation: (transaction: GaokaoDataTransaction) => Promise<T>): Promise<T> => {
        const result = queue.then(() => operation({ get data() { return clone(data); }, save: async (next) => {
            saves++; trace.push(next.pendingRoundCommit ? "save-pending" : "save-event");
            if (saves === failedSave) throw new Error("synthetic save failure");
            data = clone(next);
        } }));
        queue = result.then((): void => undefined, (): void => undefined); return await result;
    };
    const makeManager = () => new GaokaoManager({ getData: () => data, transact,
        eventFactory: { createId: () => `fixed-${sequence++}`, now: () => new Date(now) } });
    const io: RoundCommitIO = {
        readTarget: jest.fn(async (): Promise<{ entityId: string; path: string; schedule: RoundScheduleReceipt | null }> => ({ entityId, path, schedule: clone(actual) })),
        checkAction: jest.fn(async (): Promise<void> => undefined),
        prepareSchedule: jest.fn(() => { trace.push("calculate"); return clone(after); }),
        writeSchedule: jest.fn(async (pending) => {
            trace.push("write-schedule");
            if (!sameRoundData(actual, pending.schedule_before)) throw new Error("external change");
            actual = clone(pending.event.schedule_after!);
        }),
        refresh: jest.fn(async () => { trace.push("refresh"); }),
    };
    return { manager: makeManager(), makeManager, io, trace, get data() { return data; },
        get actual() { return actual; }, setActual: (value: RoundScheduleReceipt | null) => { actual = value; },
        failSave: (number: number) => { failedSave = number; }, setNow: (value: string) => { now = value; },
        move: () => { path = "moved.md"; }, duplicate: () => { entityId = "another-entity"; } };
}
const intake: RoundCompletionInput = { entityId: "synthetic-math", expectedCycleRef: null, actionConfirmed: true,
    subjectConfirmed: true, sourceConfirmed: true, originalRetained: true };

describe("T01 T05 T06 full shared commit semantics", () => {
    test.each(["R1", "R2", "R3", "R4", "R5"])("T02 T03 T04 T06 %s preserves all five rating inputs through the real commit boundary", async (round) => {
        const prior: LearningEvent[] = ["study", "review", "review", "practice"].map((type, index) => ({
            event_id: `prior-${index}`, entity_id: "synthetic-math", event_type: type as LearningEvent["event_type"],
            source_path: "synthetic.md", cycle_ref: index === 0 ? null : `prior-${index - 1}`,
            schedule_after: after, timestamp: index === 3 ? "2026-09-05T14:00:00Z" : "2026-09-05T12:00:00Z",
            ...(index === 3 ? { evidence: { ref: "Earlier practice Q2", performed_at: "2026-09-05T13:00:00Z" } } : {}),
        }));
        const index = ["R1", "R2", "R3", "R4", "R5"].indexOf(round);
        const expected = [["R2", "R2", "R2", "R2", "R2"], ["R3", "R3", "R3", "R5", "R5"],
            ["R4", "R4", "R4", "R5", "R5"], ["R5", "R5", "R5", "R5", "R5"], ["R5", "R5", "R5", "R5", "R5"]];
        const ratings: (ReviewRating | undefined)[] = [undefined, "again", "hard", "good", "easy"];
        const responses = [ReviewResponse.Good, ReviewResponse.Again, ReviewResponse.Hard, ReviewResponse.Good, ReviewResponse.Easy];
        for (let ratingIndex = 0; ratingIndex < ratings.length; ratingIndex++) {
            const h = harness({ version: 2, learningEvents: prior.slice(0, index) });
            const result = await h.manager.commitRound({ ...intake,
                expectedCycleRef: index === 0 ? null : `prior-${index - 1}`, userRating: ratings[ratingIndex], presentationConfirmed: true,
                ...(index < 3 ? {} : { evidence: { ref: "Current real paper Q7", performed_at: "2026-09-06T11:00:00Z",
                    ...(index === 4 ? { mode: "isolated" as const } : {}) }, unregisteredActivityConfirmed: true, resultChecked: true, isolatedConfirmed: true }),
            }, h.io);
            expect(result.status).toBe("committed");
            expect(h.data.learningEvents).toHaveLength(index + 1);
            const saved = h.data.learningEvents[index];
            expect(saved.event_type).toBe(["study", "review", "review", "practice", "verification"][index]);
            if (ratingIndex === 0) expect(saved).not.toHaveProperty("rating");
            else expect(saved.rating).toBe(ratings[ratingIndex]);
            expect(jest.mocked(h.io.prepareSchedule).mock.calls[0][1]).toBe(responses[ratingIndex]);
            expect(h.manager.getRoundState("synthetic-math")).toMatchObject({ state: { round: expected[index][ratingIndex] } });
        }
    });

    test("full unscored cycle writes exactly study/review/review/practice/verification", async () => {
        const h = harness();
        for (let index = 0; index < 5; index++) {
            h.setNow(`2026-09-${String(index + 6).padStart(2, "0")}T12:00:00Z`);
            const previous = h.data.learningEvents.slice(-1)[0];
            const input = { ...intake, expectedCycleRef: previous?.event_id ?? null, presentationConfirmed: true,
                ...(index < 3 ? {} : { unregisteredActivityConfirmed: true,
                    evidence: { ref: `synthetic-real-paper-Q${index}`, performed_at: `2026-09-${String(index + 6).padStart(2, "0")}T11:00:00Z`,
                        ...(index === 4 ? { mode: "isolated" as const } : {}) }, resultChecked: true, isolatedConfirmed: true }) };
            expect((await h.manager.commitRound(input, h.io)).status).toBe("committed");
        }
        expect(h.data.learningEvents.map((event) => event.event_type)).toEqual(["study", "review", "review", "practice", "verification"]);
        expect(h.data.learningEvents.every((event) => !Object.prototype.hasOwnProperty.call(event, "rating"))).toBe(true);
        expect(h.manager.getRoundState("synthetic-math")).toMatchObject({ state: { round: "R5" } });
        expect(jest.mocked(h.io.prepareSchedule).mock.calls.every((call) => call[1] === ReviewResponse.Good)).toBe(true);
        expect(h.trace.slice(0, 5)).toEqual(["calculate", "save-pending", "write-schedule", "save-event", "refresh"]);
    });

    test("T05 same schedule from unscored and explicit Good produces R3 and R5", async () => {
        const root: LearningEvent = { event_id: "root", entity_id: "synthetic-math", event_type: "study", cycle_ref: null,
            timestamp: "2026-09-05T12:00:00Z", source_path: "synthetic.md", schedule_after: after };
        const run = async (userRating?: "good") => {
            const h = harness({ version: 2, learningEvents: [root] });
            await h.manager.commitRound({ ...intake, expectedCycleRef: "root", presentationConfirmed: true, userRating }, h.io);
            return h;
        };
        const unrated = await run(); const good = await run("good");
        expect(unrated.actual).toEqual(good.actual);
        expect(unrated.data.learningEvents[1]).not.toHaveProperty("rating");
        expect(good.data.learningEvents[1].rating).toBe("good");
        expect(unrated.manager.getRoundState("synthetic-math")).toMatchObject({ state: { round: "R3" } });
        expect(good.manager.getRoundState("synthetic-math")).toMatchObject({ state: { round: "R5" } });
    });
});

describe("T09 T11–T15 T21 pending boundaries", () => {
    test("cancel/unconfirmed source has no calculation or writes", async () => {
        const h = harness();
        expect((await h.manager.commitRound({ ...intake, actionConfirmed: false }, h.io)).status).toBe("blocked");
        expect(h.trace).toEqual([]);
    });
    test("double click and two panes consume a predecessor only once", async () => {
        const h = harness();
        const result = await Promise.all([h.manager.commitRound(intake, h.io), h.manager.commitRound(intake, h.io)]);
        expect(result.map((item) => item.status)).toEqual(["committed", "blocked"]);
        expect(h.data.learningEvents).toHaveLength(1);
        expect(h.io.prepareSchedule).toHaveBeenCalledTimes(1);
        expect((await h.makeManager().commitRound(intake, h.io)).status).toBe("blocked");
    });
    test("pending prepare failure never starts schedule write", async () => {
        const h = harness(); h.failSave(1);
        expect((await h.manager.commitRound(intake, h.io)).status).toBe("pending");
        expect(h.io.writeSchedule).not.toHaveBeenCalled();
        expect(h.actual).toBeNull(); expect(h.data.learningEvents).toEqual([]);
    });
    test("schedule success/event failure survives restart and records fixed ID without rescoring", async () => {
        const h = harness(); h.failSave(2);
        expect((await h.manager.commitRound(intake, h.io)).status).toBe("pending");
        const fixedId = h.data.pendingRoundCommit!.event.event_id;
        const restarted = h.makeManager();
        expect((await restarted.inspectRoundRecovery(h.io)).position).toBe("after");
        expect(h.data.learningEvents).toEqual([]);
        expect((await restarted.recoverRound(fixedId, "record", h.io)).status).toBe("committed");
        expect(h.io.prepareSchedule).toHaveBeenCalledTimes(1);
        expect(h.io.writeSchedule).toHaveBeenCalledTimes(1);
        expect(h.data.learningEvents[0].event_id).toBe(fixedId);
        expect(h.data).not.toHaveProperty("pendingRoundCommit");
    });
    test("schedule save throws after landing: readback reports after and does not assume zero writes", async () => {
        const h = harness();
        h.io.writeSchedule = jest.fn(async (pending) => { h.setActual(pending.event.schedule_after!); throw new Error("after landing"); });
        expect((await h.manager.commitRound(intake, h.io)).status).toBe("pending");
        expect((await h.manager.inspectRoundRecovery(h.io)).position).toBe("after");
        const id = h.data.pendingRoundCommit!.event.event_id;
        expect((await h.manager.recoverRound(id, "record", h.io)).status).toBe("committed");
        expect(h.io.writeSchedule).toHaveBeenCalledTimes(1);
    });
    test("restart at before requires explicit continue and reuses original candidate", async () => {
        const h = harness(); const originalWriter = h.io.writeSchedule;
        h.io.writeSchedule = jest.fn(async () => { throw new Error("before landing"); });
        await h.manager.commitRound(intake, h.io);
        const pending = clone(h.data.pendingRoundCommit!);
        expect((await h.makeManager().inspectRoundRecovery(h.io)).position).toBe("before");
        h.io.writeSchedule = originalWriter;
        expect((await h.manager.recoverRound(pending.event.event_id, "continue", h.io)).status).toBe("committed");
        expect(h.data.learningEvents[0]).toEqual(pending.event);
        expect(h.io.prepareSchedule).toHaveBeenCalledTimes(1);
    });
    test("before=after interrupted commit is ambiguous and cannot replay", async () => {
        const h = harness(); h.setActual(after); h.failSave(2);
        await h.manager.commitRound(intake, h.io);
        const id = h.data.pendingRoundCommit!.event.event_id;
        expect((await h.makeManager().inspectRoundRecovery(h.io)).position).toBe("ambiguous");
        expect((await h.manager.recoverRound(id, "record", h.io)).status).toBe("pending");
        expect((await h.manager.recoverRound(id, "continue", h.io)).status).toBe("pending");
        expect(h.data.learningEvents).toEqual([]);
    });
    test("external schedule/path changes retain pending and never overwrite", async () => {
        const h = harness(); h.failSave(2); await h.manager.commitRound(intake, h.io);
        h.setActual({ ...after, ease: 240 });
        expect((await h.manager.inspectRoundRecovery(h.io)).position).toBe("changed");
        h.setActual(after); h.move();
        expect((await h.manager.inspectRoundRecovery(h.io)).position).toBe("changed");
        expect(h.data.pendingRoundCommit).toBeDefined();
    });
    test("wrong identity and action-readiness failure do not prepare", async () => {
        const h = harness(); h.duplicate();
        expect((await h.manager.commitRound(intake, h.io)).status).toBe("blocked");
        expect(h.io.prepareSchedule).not.toHaveBeenCalled();
    });
    test("only UI refresh failure is still a committed event, never a second score", async () => {
        const h = harness(); h.io.refresh = jest.fn(async () => { throw new Error("UI only"); });
        const result = await h.manager.commitRound(intake, h.io);
        expect(result).toMatchObject({ status: "committed", refreshIssue: expect.any(String) });
        expect((await h.manager.commitRound(intake, h.io)).status).toBe("blocked");
        expect(h.data.learningEvents).toHaveLength(1);
        expect(h.io.prepareSchedule).toHaveBeenCalledTimes(1);
    });
});
