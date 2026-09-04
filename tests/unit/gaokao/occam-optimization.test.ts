/* eslint-disable camelcase -- Tests exercise persisted GAOKAO fields. */

import { Notice, TFile } from "obsidian";

import { GaokaoWorkflowManager } from "src/gaokao/workflow-manager";
import {
    GaokaoEventTypeModal,
    GaokaoFeedbackModal,
} from "src/ui/obsidian-ui-components/modals/gaokao-workflow-modal";

jest.mock("obsidian", () => {
    class MockTFile {
        path: string;
        extension: string;

        constructor(path: string) {
            this.path = path;
            this.extension = path.split(".").pop() ?? "";
        }
    }

    return {
        Notice: jest.fn(),
        TFile: MockTFile,
        TFolder: class MockTFolder {},
        normalizePath: (path: string) => path,
    };
});

jest.mock("src/gaokao/image-evidence", () => ({}));
jest.mock("src/ui/obsidian-ui-components/modals/gaokao-image-evidence-modal", () => ({
    GaokaoImageEvidenceModal: { capture: jest.fn() },
}));
jest.mock("src/ui/obsidian-ui-components/modals/gaokao-workflow-modal", () => ({
    GaokaoEventTypeModal: { choose: jest.fn() },
    GaokaoFeedbackModal: { capture: jest.fn() },
    GaokaoNoteCreationModal: jest.fn(),
    GaokaoRecentEventsModal: jest.fn(),
}));

const eventTypeModalMock = jest.mocked(GaokaoEventTypeModal);
const feedbackModalMock = jest.mocked(GaokaoFeedbackModal);
const noticeMock = jest.mocked(Notice);

function setupManager() {
    const RuntimeTFile = TFile as unknown as new (path: string) => TFile;
    const file = new RuntimeTFile("数学/函数.md");
    const recordGaokaoLearningEvent = jest.fn(() =>
        Promise.resolve({ status: "recorded" as const }),
    );
    const plugin = {
        isInitialized: true,
        app: {
            workspace: {
                getActiveFile: () => file,
            },
        },
        dataManager: {
            data: { settings: { tagsToReview: ["#review"] } },
            inspectGaokaoFile: () => ({
                status: "valid",
                entity: {
                    gaokao_id: "math-knowledge-001",
                    entity_type: "knowledge_point",
                    subject: "数学",
                },
            }),
            recordGaokaoLearningEvent,
        },
    };
    return {
        manager: new GaokaoWorkflowManager(plugin as never),
        recordGaokaoLearningEvent,
    };
}

describe("V2 package A review and manual recording semantics", () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    test.each(["good", "easy"] as const)(
        "%s returns empty feedback without a modal",
        async (rating) => {
            const { manager } = setupManager();

            await expect(
                manager.captureReviewFeedback({
                    notePath: "数学/函数.md",
                    subject: "数学",
                    rating,
                    visibleRating: rating,
                }),
            ).resolves.toEqual({});
            expect(feedbackModalMock.capture.mock.calls).toHaveLength(0);
        },
    );

    test.each(["again", "hard"] as const)("%s keeps the review feedback modal", async (rating) => {
        const { manager } = setupManager();
        feedbackModalMock.capture.mockResolvedValue({ mistake_type: "K" });

        await expect(
            manager.captureReviewFeedback({
                notePath: "数学/函数.md",
                subject: "数学",
                rating,
                visibleRating: rating,
            }),
        ).resolves.toEqual({ mistake_type: "K" });
        expect(feedbackModalMock.capture.mock.calls).toContainEqual([
            expect.anything(),
            {
                notePath: "数学/函数.md",
                visibleRating: rating,
                context: "review",
            },
        ]);
    });

    test("closing manual feedback records no event", async () => {
        const { manager, recordGaokaoLearningEvent } = setupManager();
        eventTypeModalMock.choose.mockResolvedValue("study");
        feedbackModalMock.capture.mockResolvedValue(null);

        await manager.recordLearningEventForCurrentNote();

        expect(feedbackModalMock.capture.mock.calls).toContainEqual([
            expect.anything(),
            {
                notePath: "数学/函数.md",
                visibleRating: "学习",
                context: "manual",
            },
        ]);
        expect(recordGaokaoLearningEvent).not.toHaveBeenCalled();
        expect(noticeMock).not.toHaveBeenCalled();
    });

    test.each([
        [{}, { event_type: "practice" }],
        [{ duration_minutes: 10 }, { event_type: "practice", duration_minutes: 10 }],
    ])("an explicit manual submission records exactly one event", async (feedback, expected) => {
        const { manager, recordGaokaoLearningEvent } = setupManager();
        eventTypeModalMock.choose.mockResolvedValue("practice");
        feedbackModalMock.capture.mockResolvedValue(feedback);

        await manager.recordLearningEventForCurrentNote();

        expect(recordGaokaoLearningEvent).toHaveBeenCalledTimes(1);
        expect(recordGaokaoLearningEvent).toHaveBeenCalledWith(expect.any(TFile), expected);
        expect(noticeMock).toHaveBeenCalledTimes(1);
    });
});
