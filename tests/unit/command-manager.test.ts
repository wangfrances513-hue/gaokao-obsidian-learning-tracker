import type { Command } from "obsidian";

import { CommandManager } from "src/command-manager";
import type { SettingsManager } from "src/data/settings-manager";
import type { GaokaoTodayManager } from "src/gaokao/today-manager";
import type { GaokaoWorkflowManager } from "src/gaokao/workflow-manager";
import type SRPlugin from "src/main";
import { ReviewResponse } from "src/scheduling/algorithms/base/repetition-item";
import type { UIManager } from "src/ui/ui-manager";
import { UIState } from "src/ui/ui-manager";

jest.mock("obsidian", () => ({
    Notice: jest.fn(),
    Platform: { isMobile: false },
    TFile: class MockTFile {},
}));

jest.mock("src/lang/helpers", () => ({
    t: (key: string): string => key,
}));

jest.mock("src/scheduling/algorithms/base/repetition-item", () => ({
    ReviewResponse: {
        Again: "Again",
        Hard: "Hard",
        Good: "Good",
        Easy: "Easy",
        Reset: "Reset",
    },
}));

jest.mock("src/scheduling/flashcard-review-sequencer", () => ({
    FlashcardReviewMode: { Review: "Review", Cram: "Cram" },
}));

jest.mock("src/ui/ui-manager", () => ({
    UIState: {
        Closed: 0,
        DeckList: 1,
        CardFront: 2,
        CardBack: 3,
        EditModal: 4,
    },
}));

jest.mock("src/utils/platform-detector", () => ({
    __esModule: true,
    default: (): { isMobile: boolean } => ({ isMobile: false }),
}));

interface ReviewContentManager {
    _jumpToCurrentCard: jest.Mock<void, []>;
    _processReview: jest.Mock<Promise<void>, [ReviewResponse]>;
}

interface Harness {
    commands: Command[];
    contentManager: ReviewContentManager;
    manager: CommandManager;
    removeCommand: jest.Mock<void, [string]>;
}

function createHarness(): Harness {
    const commands: Command[] = [];
    const removeCommand = jest.fn<void, [string]>();
    const plugin = {
        addCommand: jest.fn((command: Command): Command => {
            commands.push(command);
            return command;
        }),
        isInitialized: true,
        removeCommand,
    } as unknown as SRPlugin;
    const settingsManager = {
        settings: {
            flashcardAgainText: "Again",
            flashcardEasyText: "Easy",
            flashcardGoodText: "Good",
            flashcardHardText: "Hard",
            useCustomHotkeys: true,
        },
    } as unknown as SettingsManager;
    const contentManager: ReviewContentManager = {
        _jumpToCurrentCard: jest.fn<void, []>(),
        _processReview: jest.fn<Promise<void>, [ReviewResponse]>().mockResolvedValue(undefined),
    };
    const uiManager = {
        contentManager,
        isSRInFocus: true,
        uiState: UIState.CardBack,
    } as unknown as UIManager;
    const manager = new CommandManager(
        plugin,
        settingsManager,
        uiManager,
        {} as GaokaoWorkflowManager,
        {} as GaokaoTodayManager,
    );

    manager.onLayoutReady();

    return { commands, contentManager, manager, removeCommand };
}

function findCommand(commands: Command[], id: string): Command {
    const command = commands.find((candidate) => candidate.id === id);
    if (command === undefined) throw new Error(`Command was not registered: ${id}`);
    return command;
}

describe("CommandManager command registration", () => {
    beforeAll(() => {
        Object.defineProperty(globalThis, "activeDocument", {
            configurable: true,
            value: document,
        });
    });

    test("registers unique IDs and distinct reset/open-in-background commands", () => {
        const { commands } = createHarness();
        const ids = commands.map((command) => command.id);
        const resetCommands = commands.filter((command) => command.id === "srs-card-review-reset");
        const openInBackgroundCommands = commands.filter(
            (command) => command.id === "srs-card-review-open-in-background",
        );

        expect(new Set(ids).size).toBe(ids.length);
        expect(resetCommands).toHaveLength(1);
        expect(openInBackgroundCommands).toHaveLength(1);
        expect(resetCommands[0].name).toBe("RESET_CARD_PROGRESS");
        expect(openInBackgroundCommands[0].name).toBe("OPEN_IN_BACKGROUND");
    });

    test("routes reset only to Reset review processing", () => {
        const { commands, contentManager } = createHarness();
        const resetCommand = findCommand(commands, "srs-card-review-reset");

        expect(resetCommand.checkCallback?.(false)).toBe(true);
        expect(contentManager._processReview).toHaveBeenCalledTimes(1);
        expect(contentManager._processReview).toHaveBeenCalledWith(ReviewResponse.Reset);
        expect(contentManager._jumpToCurrentCard).not.toHaveBeenCalled();
    });

    test("routes open-in-background only to the current card jump", () => {
        const { commands, contentManager } = createHarness();
        const openInBackgroundCommand = findCommand(commands, "srs-card-review-open-in-background");

        expect(openInBackgroundCommand.checkCallback?.(false)).toBe(true);
        expect(contentManager._jumpToCurrentCard).toHaveBeenCalledTimes(1);
        expect(contentManager._processReview).not.toHaveBeenCalledWith(ReviewResponse.Reset);
    });

    test("removes both reset and open-in-background custom commands", () => {
        const { manager, removeCommand } = createHarness();

        manager.removeCustomHotkeys();

        expect(removeCommand).toHaveBeenCalledWith("srs-card-review-reset");
        expect(removeCommand).toHaveBeenCalledWith("srs-card-review-open-in-background");
    });
});
