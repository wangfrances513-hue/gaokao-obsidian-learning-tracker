/* eslint-disable camelcase -- Synthetic entry-point fixtures only. */
import { TFile } from "obsidian";
import { DataManager } from "src/data/data-manager";
import { DEFAULT_SETTINGS } from "src/data/settings";
import { GaokaoManager, RoundTarget } from "src/gaokao/gaokao-manager";
import { LearningEvent } from "src/gaokao/learning-event";
import { RoundCompletionInput, RoundState } from "src/gaokao/review-flow";
import { GaokaoWorkflowManager } from "src/gaokao/workflow-manager";
import { NextNoteReviewHandler } from "src/note/next-note-review-handler";
import { ReviewResponse } from "src/scheduling/algorithms/base/repetition-item";
import { GaokaoRoundChoiceModal, GaokaoRoundResultModal } from "src/ui/obsidian-ui-components/modals/gaokao-workflow-modal";

jest.mock("obsidian", () => ({
    TFile: class MockTFile {}, TFolder: class MockTFolder {}, MarkdownView: class MockMarkdownView {},
    Notice: jest.fn(), normalizePath: (path: string) => path,
    getFrontMatterInfo: () => ({ contentStart: 0 }),
}));
jest.mock("src/lang/helpers", () => ({ t: (key: string) => key }));
jest.mock("src/parser", () => ({ setDebugParser: jest.fn() }));
jest.mock("src/gaokao/image-evidence", () => ({}));
jest.mock("src/ui/obsidian-ui-components/modals/review-deck-selection-modal", () => ({ ReviewDeckSelectionModal: jest.fn() }));
jest.mock("src/ui/obsidian-ui-components/modals/gaokao-image-evidence-modal", () => ({ GaokaoImageEvidenceModal: {} }));
jest.mock("src/ui/obsidian-ui-components/modals/gaokao-workflow-modal", () => ({
    GaokaoRoundChoiceModal: { choose: jest.fn() }, GaokaoRoundResultModal: jest.fn().mockImplementation(() => ({ open: jest.fn() })),
}));

describe("T24 whole-note shortcut and auto-next routes", () => {
    test.each([ReviewResponse.Again, ReviewResponse.Hard, ReviewResponse.Good, ReviewResponse.Easy])("existing shortcut %s reaches shared flow entry before any legacy scheduling", async (response) => {
        const entry = jest.fn(async (_id: string, _rating?: unknown): Promise<void> => undefined);
        const legacy = jest.fn(async (): Promise<void> => undefined);
        const manager: DataManager = Object.assign(Object.create(DataManager.prototype), {
            inspectGaokaoFile: () => ({ status: "valid", entity: { gaokao_id: "synthetic" } }),
            gaokaoManager: { getRoundState: () => ({ ok: true, state: { round: "R4", cycleRef: "prior" } }) },
            roundEntry: entry, saveLegacyNoteReviewResponse: legacy,
            pluginDataManager: { pluginData: { gaokao: { version: 2, learningEvents: [] } } },
        });
        await manager.saveNoteReviewResponse({ path: "synthetic.md" } as TFile, response);
        expect(entry).toHaveBeenCalledTimes(1);
        expect(entry.mock.calls[0][0]).toBe("synthetic");
        expect(legacy).not.toHaveBeenCalled();
    });
    test("ordinary note still uses its original scheduling path, even with another entity's pending", async () => {
        const legacy = jest.fn(async (): Promise<void> => undefined);
        const manager: DataManager = Object.assign(Object.create(DataManager.prototype), {
            inspectGaokaoFile: () => ({ status: "ordinary" }), roundScheduleQueue: Promise.resolve(),
            saveLegacyNoteReviewResponse: legacy,
            pluginDataManager: { pluginData: { gaokao: { pendingRoundCommit: { event: { entity_id: "another" } } } } },
        });
        const file = { path: "ordinary.md" } as TFile;
        await manager.saveNoteReviewResponse(file, ReviewResponse.Good);
        expect(legacy).toHaveBeenCalledWith(file, ReviewResponse.Good);
    });
    test("auto-next delegates flow items instead of opening an R4/R5 Entity", async () => {
        const file = { path: "flow.md" } as TFile;
        const openFile = jest.fn(async (): Promise<void> => undefined);
        const route = jest.fn(async () => true);
        const names = Object.assign(["review"], { contains: (name: string) => name === "review" });
        const queue = { reviewDeckNameList: names, reviewDecks: new Map([["review", { determineNextNote: () => ({ tfile: file }) }]]) };
        const handler = new NextNoteReviewHandler({ workspace: { getLeaf: () => ({ openFile }) } } as never,
            { autoNextNote: true, openRandomNote: false } as never, queue as never, route);
        await handler.autoReviewNextNote();
        expect(route).toHaveBeenCalledWith(file); expect(openFile).not.toHaveBeenCalled();
        route.mockResolvedValue(false);
        await handler.openNote("review", file);
        expect(openFile).toHaveBeenCalledWith(file);
    });
    test("auto-next releases the scheduling queue before an explicit pending recovery", async () => {
        const recovery = jest.fn(async () => ({ status: "committed", event: { event_id: "fixed" } }));
        const manager: DataManager = Object.assign(Object.create(DataManager.prototype), {
            inspectGaokaoFile: () => ({ status: "ordinary" }), roundScheduleQueue: Promise.resolve(),
            saveLegacyNoteReviewResponse: jest.fn(async () => true),
            settingsManager: { settings: { autoNextNote: true } },
            gaokaoManager: { recoverRound: recovery }, roundIO: () => ({}),
        });
        const navigate = jest.fn(async () => { await manager.recoverRound("fixed", "record"); });
        Object.assign(manager, { plugin: { nextNoteReviewHandler: { autoReviewNextNote: navigate } } });
        await manager.saveNoteReviewResponse({ path: "ordinary.md" } as TFile, ReviewResponse.Good);
        expect(navigate).toHaveBeenCalledTimes(1);
        expect(recovery).toHaveBeenCalledWith("fixed", "record", {});
    });
});

describe("T15 T16 durable identity and scheduling readiness", () => {
    function targetHarness() {
        const file = Object.assign(new TFile(), { path: "synthetic.md", basename: "Synthetic", extension: "md" });
        const frontmatter = { gaokao_id: "synthetic", entity_type: "knowledge_point", subject: "数学" };
        const metadata = { text: "synthetic", frontmatter, tags: ["#review"] };
        const read = jest.fn(async () => metadata);
        const files = [file];
        const registry = new GaokaoManager({ getData: () => ({ version: 2, learningEvents: [] }),
            transact: async () => { throw new Error("Read-only target resolution must not save"); } });
        const manager: DataManager = Object.assign(Object.create(DataManager.prototype), {
            isOsrCoreLoaded: () => true, _syncLock: false, gaokaoManager: registry,
            settingsManager: { settings: { ...DEFAULT_SETTINGS, tagsToReview: ["#review"] } },
            createSRNoteTFile: () => ({ readPersistentMetadata: read }),
            plugin: { app: { vault: { getMarkdownFiles: () => files,
                getAbstractFileByPath: (path: string) => files.find((item) => item.path === path) ?? null } } },
        });
        return { manager, metadata, read, files };
    }
    test.each(["core", "sync"])("unready %s does not interpret an empty queue as unscheduled", async (reason) => {
        const h = targetHarness();
        if (reason === "core") Object.assign(h.manager, { isOsrCoreLoaded: () => false });
        else Object.assign(h.manager, { _syncLock: true });
        await expect(h.manager.resolveRoundTarget("synthetic")).rejects.toThrow(/就绪|刷新/);
        expect(h.read).not.toHaveBeenCalled();
    });
    test("removed review tags and freshly discovered duplicate IDs block the target", async () => {
        const h = targetHarness();
        await expect(h.manager.resolveRoundTarget("synthetic")).resolves.toMatchObject({ schedule: null });
        h.metadata.tags = [];
        await expect(h.manager.resolveRoundTarget("synthetic")).rejects.toThrow(/标签/);
        h.metadata.tags = ["#review"];
        h.files.push(Object.assign(new TFile(), { path: "duplicate.md", basename: "Duplicate", extension: "md" }));
        await expect(h.manager.resolveRoundTarget("synthetic")).rejects.toThrow(/唯一|无效/);
    });
});

function workflowHarness(round: "R1" | "R4" = "R1") {
    const file = Object.assign(new TFile(), { path: "synthetic.md", basename: "Synthetic", extension: "md" });
    const text = "# Synthetic\n\n## Source\nPrinted paper A, Q3\n\n## Prompt\nAttempt Q3 on paper.\n";
    const state: RoundState = { round, cycleRef: round === "R1" ? null : "prior", tail: null };
    const plugin = {
        register: jest.fn(), refreshGaokaoToday: jest.fn(), isInitialized: true,
        app: { vault: { getAbstractFileByPath: () => file, read: jest.fn(async () => text) }, workspace: { getActiveFile: () => file } },
        dataManager: { data: { gaokao: { learningEvents: [] as LearningEvent[] }, settings: { autoNextNote: false } },
            gaokaoManager: { getRoundState: () => ({ ok: true, state }) },
            resolveRoundTarget: jest.fn(async (): Promise<RoundTarget> => ({ entityId: "synthetic", path: file.path, schedule: null })),
            resolveGaokaoEntity: () => ({ path: file.path, entity: { gaokao_id: "synthetic", subject: "数学" } }),
            getGaokaoEventHistory: (): LearningEvent[] => [],
            completeRound: jest.fn(async () => ({ status: "committed", event: { event_id: "fixed" } })),
        },
    };
    return { plugin, file, text, state, manager: new GaokaoWorkflowManager(plugin as never) };
}

describe("T19 T21 R1 material and target confirmation", () => {
    test("R1 reads only linked Entity material, and does not create sources/events in validation", async () => {
        const h = workflowHarness();
        const input: RoundCompletionInput = { entityId: "synthetic", expectedCycleRef: null, expectedPath: h.file.path, expectedSubject: "数学",
            expectedSourceText: h.text, actionConfirmed: true };
        await expect(h.manager.validateRoundAction({ entityId: "synthetic", path: h.file.path, schedule: null }, input)).resolves.toBeUndefined();
        expect(h.plugin.dataManager.completeRound).not.toHaveBeenCalled();
        h.plugin.app.vault.read.mockResolvedValue("# Synthetic\n");
        await expect(h.manager.validateRoundAction({ entityId: "synthetic", path: h.file.path, schedule: null }, input)).rejects.toThrow(/来源|题面/);
    });
    test("changed material or displayed subject invalidates R1 confirmation", async () => {
        const h = workflowHarness();
        const target: RoundTarget = { entityId: "synthetic", path: h.file.path, schedule: null };
        const input: RoundCompletionInput = { entityId: "synthetic", expectedCycleRef: null, expectedPath: h.file.path, expectedSubject: "数学", expectedSourceText: h.text, actionConfirmed: true };
        h.plugin.app.vault.read.mockResolvedValue(h.text + "new material");
        await expect(h.manager.validateRoundAction(target, input)).rejects.toThrow(/改变/);
        await expect(h.manager.validateRoundAction(target, { ...input, expectedSubject: "物理" })).rejects.toThrow(/学科/);
    });
    test("R4 result entry opens no original Entity and binds the expected predecessor", async () => {
        const h = workflowHarness("R4");
        await h.manager.openRoundEntry("synthetic", "hard");
        const calls = jest.mocked(GaokaoRoundResultModal).mock.calls;
        const options = calls[calls.length - 1][1];
        expect(options).toMatchObject({ entityId: "synthetic", state: { round: "R4", cycleRef: "prior" }, userRating: "hard" });
        expect(h.plugin.dataManager.completeRound).not.toHaveBeenCalled();
        expect(GaokaoRoundChoiceModal.choose).not.toHaveBeenCalled();
    });
});
