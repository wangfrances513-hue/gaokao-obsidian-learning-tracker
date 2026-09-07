/* eslint-disable camelcase -- Synthetic persisted events; source only, not executed in G1. */
import { createLearningEvent, LearningEvent, ReviewRating } from "src/gaokao/learning-event";
import { completionIssue, deriveRoundState, nextReviewRound, ReviewRound, ROUND_EVENT_TYPE,
    RoundCompletionInput, RoundState, schedulerResponseFor } from "src/gaokao/review-flow";
import { ReviewResponse } from "src/scheduling/algorithms/base/repetition-item";
import { buildTodayPlan, calculateCurrentNeed } from "src/gaokao/today-planner";

const schedule = { due: "2026-09-20", interval: 3, ease: 250 };
const ratings: (ReviewRating | undefined)[] = [undefined, "again", "hard", "good", "easy"];
function event(id: string, ref: string | null, type: LearningEvent["event_type"], rating?: ReviewRating): LearningEvent {
    return { event_id: id, entity_id: "synthetic-math", source_path: "synthetic.md", timestamp: "2026-09-05T12:00:00Z",
        cycle_ref: ref, event_type: type, schedule_after: schedule, ...(rating ? { rating } : {}) };
}

describe("v0.2 T01–T08 deterministic semantics", () => {
    test.each<ReviewRound>(["R1", "R2", "R3", "R4", "R5"])("all five inputs at %s", (round) => {
        const expected: Record<ReviewRound, ReviewRound[]> = {
            R1: ["R2", "R2", "R2", "R2", "R2"], R2: ["R3", "R3", "R3", "R5", "R5"],
            R3: ["R4", "R4", "R4", "R5", "R5"], R4: ["R5", "R5", "R5", "R5", "R5"],
            R5: ["R5", "R5", "R5", "R5", "R5"],
        };
        expect(ratings.map((rating) => nextReviewRound(round, rating))).toEqual(expected[round]);
    });

    test("T01 T08 predecessor replay distinguishes equal-time R2/R3 reviews", () => {
        const root = event("root", null, "study");
        const review2 = event("r2", "root", "review");
        const review3 = event("r3", "r2", "review");
        expect(deriveRoundState([review3, root, review2], root.entity_id)).toMatchObject({ ok: true, state: { round: "R4", cycleRef: "r3" } });
        for (const item of [root, review2, review3]) expect(JSON.parse(JSON.stringify(item))).not.toHaveProperty("rating");
    });

    test.each(["good", "easy"] as const)("T02 R2 %s skips without fabricating events", (rating) => {
        const events = [event("root", null, "study"), event("review", "root", "review", rating)];
        expect(deriveRoundState(events, "synthetic-math")).toMatchObject({ ok: true, state: { round: "R5" } });
        expect(events.map((item) => item.event_type)).toEqual(["study", "review"]);
    });

    test("T05 internal Good and explicit Good remain different event facts", () => {
        const base = event("root", null, "study");
        const make = (rating?: ReviewRating) => createLearningEvent({
            entity_id: base.entity_id, event_type: "review", cycle_ref: "root", schedule_after: schedule,
            ...(rating ? { rating } : {}),
        }, new Set(["root"]), { createId: () => "new", now: () => new Date(base.timestamp) });
        const unrated = make(); const good = make("good");
        if (unrated.ok === false || good.ok === false) throw new Error("Synthetic factory failed");
        expect(schedulerResponseFor()).toBe(ReviewResponse.Good);
        expect(schedulerResponseFor("good")).toBe(ReviewResponse.Good);
        expect(unrated.event.schedule_after).toEqual(good.event.schedule_after);
        expect(unrated.event).not.toHaveProperty("rating");
        expect(good.event.rating).toBe("good");
        expect(deriveRoundState([base, unrated.event], base.entity_id)).toMatchObject({ state: { round: "R3" } });
        expect(deriveRoundState([base, good.event], base.entity_id)).toMatchObject({ state: { round: "R5" } });
    });

    test("T07 T18 legacy Good does not start/advance flow; unscored completion retains Hard", () => {
        const legacy = { ...event("old", null, "verification", "good"), duration_minutes: 14, custom_fact: "retain" };
        delete legacy.cycle_ref; delete legacy.schedule_after;
        const bytes = JSON.stringify(legacy);
        expect(deriveRoundState([legacy], legacy.entity_id, 1)).toMatchObject({ state: { round: "R1" } });
        const history = [legacy, event("r1", null, "study", "hard"), event("r2", "r1", "review")];
        expect(calculateCurrentNeed(history).label).toBe("hard");
        expect(calculateCurrentNeed([event("r1", null, "study")]).label).toBe("unrated");
        expect(JSON.stringify(legacy)).toBe(bytes);
    });
});

describe("v0.2 T09 T10 invalid chains", () => {
    test.each([
        [event("a", null, "study"), event("b", "missing", "review")],
        [event("a", null, "study"), event("b", "a", "review"), event("c", "a", "review")],
        [event("a", null, "study"), event("a", "a", "review")],
        [event("a", null, "study"), event("b", null, "study")],
        [event("a", null, "study"), event("b", "a", "practice")],
        [{ ...event("a", null, "study"), entity_id: "another" }, event("b", "a", "review")],
        [event("a", null, "review")],
    ])("rejects broken/branched/cross-entity/duplicate/type-invalid chain %#", (...events) => {
        expect(deriveRoundState(events, "synthetic-math").ok).toBe(false);
    });
    test("rejects old/unknown flow version and explicit undefined predecessor", () => {
        const root = event("a", null, "study");
        expect(deriveRoundState([root], root.entity_id, 1).ok).toBe(false);
        expect(deriveRoundState([root], root.entity_id, 3).ok).toBe(false);
        expect(deriveRoundState([{ ...root, cycle_ref: undefined }], root.entity_id).ok).toBe(false);
    });
});

describe("v0.2 T04 T06 T25–T27 action and evidence gates", () => {
    const tail = event("tail", "earlier", "review");
    const state = { round: "R5" as const, cycleRef: "tail", tail };
    const input: RoundCompletionInput = {
        entityId: tail.entity_id, expectedCycleRef: "tail", actionConfirmed: true,
        evidence: { ref: "Synthetic mixed paper / Q7 / answer page 2", performed_at: "2026-09-06T08:00:00Z", mode: "mixed" },
        unregisteredActivityConfirmed: true, resultChecked: true, noModelHint: true, fullPaperLimitConfirmed: true,
    };
    const now = "2026-09-06T10:00:00Z";
    test.each(ratings)("T04 real checked verification accepts rating %s without claiming mastery", (rating) => {
        expect(completionIssue({ ...input, userRating: rating }, state, [], now)).toBeNull();
        expect(nextReviewRound("R5", rating)).toBe("R5");
        expect(ROUND_EVENT_TYPE.R5).toBe("verification");
    });
    test.each(["actionConfirmed", "resultChecked", "noModelHint", "fullPaperLimitConfirmed", "unregisteredActivityConfirmed"] as const)("T25 T26 requires %s", (field) => {
        expect(completionIssue({ ...input, [field]: false }, state, [], now)).not.toBeNull();
    });
    test("T25 rejects old-cycle, future, missing and duplicate evidence", () => {
        for (const evidence of [undefined, { ...input.evidence!, performed_at: tail.timestamp },
            { ...input.evidence!, performed_at: "2026-09-07T00:00:00Z" }, { ...input.evidence!, ref: "" }]) {
            expect(completionIssue({ ...input, evidence }, state, [], now)).not.toBeNull();
        }
        expect(completionIssue(input, state, [{ ...tail, evidence: input.evidence }], now)).not.toBeNull();
        expect(completionIssue({ ...input, expectedCycleRef: "old" }, state, [], now)).not.toBeNull();
    });
    test("T27 time is absent by default; Mixed cannot save per-entity duration", () => {
        expect(completionIssue(input, state, [], now)).toBeNull();
        expect(completionIssue({ ...input, durationMinutes: 120 }, state, [], now)).not.toBeNull();
        const isolated = { ...input, evidence: { ...input.evidence!, mode: "isolated" as const }, isolatedConfirmed: true };
        expect(completionIssue(isolated, state, [], now)).toBeNull();
        expect(completionIssue({ ...isolated, durationMinutes: 7 }, state, [], now)).not.toBeNull();
        expect(completionIssue({ ...isolated, speedVerification: true, durationMinutes: 7 }, state, [], now)).toBeNull();
    });
    test("T06 R1 requires confirmed intake, not closed-book success", () => {
        const r1: RoundState = { round: "R1", cycleRef: null, tail: null };
        const intake: RoundCompletionInput = { entityId: tail.entity_id, expectedCycleRef: null, actionConfirmed: true,
            sourceConfirmed: true, subjectConfirmed: true, originalRetained: true };
        expect(completionIssue(intake, r1, [], now)).toBeNull();
        expect(completionIssue({ ...intake, sourceConfirmed: false }, r1, [], now)).not.toBeNull();
    });
});

test("T17 earlier due outranks Again; same due uses need and keeps full backlog", () => {
    const today = Date.UTC(2026, 8, 6);
    const candidates = ["good", "again", "hard", "easy"].map((rating, index) => ({
        path: `${index}.md`, title: `${index}`, entity: { gaokao_id: `id-${index}`, entity_type: "knowledge_point" as const, subject: "数学" as const },
        events: [{ event_id: `legacy-${index}`, entity_id: `id-${index}`, event_type: "review" as const, timestamp: "2026-09-01T00:00:00Z", rating: rating as ReviewRating }],
        schedule: { kind: "scheduled" as const, dueUnix: index === 0 ? today - 86400000 : today },
    }));
    const plan = buildTodayPlan(candidates, { todayUnix: today, minimumReviewLimit: 2 });
    expect(plan.protectedReviews.map((item) => item.needLabel)).toEqual(["good", "again", "hard", "easy"]);
    expect(plan.minimumRecommendedReviews).toHaveLength(2);
    expect(plan.remainingDueBacklog).toHaveLength(2);
});
