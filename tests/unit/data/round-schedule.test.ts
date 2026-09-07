/* eslint-disable camelcase -- Synthetic frontmatter only; source prepared, not run in G1. */
import { readRoundScheduleFrontmatter, SRNoteTFile } from "src/data/data-structures/file/note-file";
import { DEFAULT_SETTINGS } from "src/data/settings";
import { SRAlgorithmOsr } from "src/scheduling/algorithms/osr/srs-algorithm-osr";
import { ReviewResponse } from "src/scheduling/algorithms/base/repetition-item";
import { RepItemScheduleInfoOsr } from "src/scheduling/algorithms/osr/rep-item-schedule-info-osr";
import { NoteDueDateHistogram } from "src/scheduling/due-date-histogram";
import { setupStaticDateProvider20230906 } from "src/utils/dates";
import { schedulerResponseFor } from "src/gaokao/review-flow";
import { OsrCore } from "src/data/core";
import { NoteReviewQueue } from "src/note/note-review-queue";

jest.mock("src/lang/helpers", () => ({ t: (key: string) => key }));
jest.mock("obsidian", () => ({
    getFrontMatterInfo: () => ({ exists: true, frontmatter: "synthetic", contentStart: 0 }),
    parseYaml: () => ({ gaokao_id: "synthetic", tags: ["review"], "sr-due": "2026-09-06", "sr-interval": 1, "sr-ease": 250 }),
}));
const before = { due: "2026-09-06", interval: 1, ease: 250 };
const after = { due: "2026-09-09", interval: 3, ease: 250 };

describe("T15 T16 persistent metadata and atomic expected-before comparison", () => {
    test.each([
        { "sr-due": "2026-09-06" },
        { "sr-due": "2026-02-30", "sr-interval": 1, "sr-ease": 250 },
        { "sr-due": "2026-09-06", "sr-interval": "1x", "sr-ease": 250 },
        { "sr-due": "2026-09-06", "sr-interval": 1, "sr-ease": null },
    ])("invalid/partial sr-* is never none %#", (frontmatter) => {
        expect(() => readRoundScheduleFrontmatter(frontmatter)).toThrow();
    });
    test("only absence of all three fields is unambiguously none", () => {
        expect(readRoundScheduleFrontmatter({ gaokao_id: "synthetic" })).toBeNull();
    });
    test("readback reads persistent text even when metadata cache still has an older due", async () => {
        const vault = { read: jest.fn(async () => "durable text") };
        const cache = { getFileCache: () => ({ frontmatter: { "sr-due": "2000-01-01" } }) };
        const file = new SRNoteTFile(vault as never, cache as never, {} as never, { path: "synthetic.md" } as never);
        expect(await file.readPersistentSchedule()).toEqual(before);
        expect(vault.read).toHaveBeenCalledTimes(1);
    });
    test("external due/identity mutation at actual callback cannot be overwritten", async () => {
        const frontmatter: Record<string, unknown> = { gaokao_id: "synthetic", "sr-due": "2026-09-06", "sr-interval": 1, "sr-ease": 250, aliases: ["keep"] };
        const fm = { processFrontMatter: async (_file: unknown, write: (value: Record<string, unknown>) => void) => { frontmatter["sr-ease"] = 240; write(frontmatter); } };
        const file = new SRNoteTFile({} as never, {} as never, fm as never, { path: "synthetic.md" } as never);
        await expect(file.compareAndSetRoundSchedule("synthetic", before, after, () => undefined)).rejects.toThrow(/变化/);
        expect(frontmatter).toMatchObject({ "sr-due": "2026-09-06", "sr-ease": 240, aliases: ["keep"] });
        frontmatter.gaokao_id = "other";
        await expect(file.compareAndSetRoundSchedule("synthetic", before, after, () => undefined)).rejects.toThrow(/gaokao_id/);
    });
    test("successful write changes only scheduler-owned fields", async () => {
        const fmValue = { gaokao_id: "synthetic", tags: ["review"], aliases: ["keep"], "sr-due": before.due, "sr-interval": 1, "sr-ease": 250 };
        const fm = { processFrontMatter: async (_file: unknown, write: (value: Record<string, unknown>) => void) => write(fmValue) };
        const file = new SRNoteTFile({} as never, {} as never, fm as never, { path: "synthetic.md" } as never);
        await file.compareAndSetRoundSchedule("synthetic", before, after, () => undefined);
        expect(fmValue).toEqual({ gaokao_id: "synthetic", tags: ["review"], aliases: ["keep"], "sr-due": after.due, "sr-interval": 3, "sr-ease": 250 });
    });
});

describe("T11 original algorithm cache isolation, no duplicated formula", () => {
    test("T05 actual original scheduler gives equal dates for fallback Good and explicit Good", () => {
        setupStaticDateProvider20230906();
        const algorithm = new SRAlgorithmOsr(DEFAULT_SETTINGS);
        const start = RepItemScheduleInfoOsr.fromDueDateStr("2023-09-06", 3, 250);
        const histogram = new NoteDueDateHistogram();
        const calculate = (rating?: "good") => algorithm.withoutNoteEaseSideEffects(() =>
            algorithm.noteCalcUpdatedSchedule("synthetic.md", start, schedulerResponseFor(rating), histogram));
        expect(calculate().serializeSchedule()).toEqual(calculate("good").serializeSchedule());
    });
    test("preparation returns the original result while leaving ease input unchanged", () => {
        setupStaticDateProvider20230906();
        const algorithm = new SRAlgorithmOsr(DEFAULT_SETTINGS);
        algorithm.noteStats().setEaseForPath("synthetic.md", 250);
        const schedule = RepItemScheduleInfoOsr.fromDueDateStr("2023-09-06", 3, 250);
        const histogram = new NoteDueDateHistogram();
        const prepared = algorithm.withoutNoteEaseSideEffects(() => algorithm.noteCalcUpdatedSchedule("synthetic.md", schedule, ReviewResponse.Hard, histogram));
        expect(algorithm.noteStats().getEaseByPath("synthetic.md")).toBe(250);
        const reference = new SRAlgorithmOsr(DEFAULT_SETTINGS).noteCalcUpdatedSchedule("synthetic.md", schedule, ReviewResponse.Hard, histogram);
        expect(prepared.serializeSchedule()).toEqual(reference.serializeSchedule());
        algorithm.noteStats().setEaseForPath("synthetic.md", prepared.latestEase);
        expect(algorithm.noteStats().getEaseByPath("synthetic.md")).toBe(prepared.latestEase);
    });
    test("calculation failure restores added and modified ease keys", () => {
        const algorithm = new SRAlgorithmOsr(DEFAULT_SETTINGS);
        algorithm.noteStats().setEaseForPath("existing", 260);
        expect(() => algorithm.withoutNoteEaseSideEffects(() => {
            algorithm.noteStats().setEaseForPath("existing", 130);
            algorithm.noteStats().setEaseForPath("new", 130);
            throw new Error("prepare failed");
        })).toThrow();
        expect(algorithm.noteStats().dict).toEqual({ existing: 260 });
    });
});

test("T24 confirmed derived refresh updates all existing review-group memberships without scoring", async () => {
    const queue = new NoteReviewQueue(); queue.init();
    const note = { path: "synthetic.md", getAllTagsFromCache: () => ["#a", "#b"] } as never;
    const settings = { ...DEFAULT_SETTINGS, tagsToReview: ["#a", "#b"] };
    queue.addNoteToQueue(note, null, settings.tagsToReview);
    const refresh = jest.fn(async (): Promise<void> => undefined);
    const core: OsrCore = Object.assign(Object.create(OsrCore.prototype), {
        _noteReviewQueue: queue, settings, calculateDerivedInfo: jest.fn(),
        buryAllCardsInNote: jest.fn(async (): Promise<void> => undefined), dataChangedHandler: refresh,
    });
    const schedule = RepItemScheduleInfoOsr.fromDueDateStr(after.due, after.interval, after.ease);
    await core.refreshAfterNoteSchedule(note, null, schedule, settings, true);
    for (const deck of queue.reviewDecks.values()) {
        expect(deck.newNotes).toEqual([]);
        expect(deck.scheduledNotes).toHaveLength(1);
        expect(deck.scheduledNotes[0].dueUnix).toBe(schedule.dueDateAsUnix);
    }
    expect(refresh).toHaveBeenCalledTimes(1);
});
