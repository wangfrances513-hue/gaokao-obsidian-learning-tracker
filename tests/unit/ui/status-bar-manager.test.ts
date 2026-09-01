import { request } from "obsidian";

import { DEFAULT_SETTINGS, SRSettings } from "src/data/settings";
import { SettingsManager } from "src/data/settings-manager";
import type SRPlugin from "src/main";
import StatusBarManager from "src/ui/status-bar-manager";

jest.mock("obsidian", () => ({
    request: jest.fn(),
}));

jest.mock("src/lang/helpers", () => ({
    t: (key: string): string => key,
}));

jest.mock("src/scheduling/flashcard-review-sequencer", () => ({
    FlashcardReviewMode: { Review: "Review" },
}));

jest.mock("src/ui/obsidian-ui-components/statusbar-items/counter-statusbar-item", () => ({
    __esModule: true,
    default: class MockCounterStatusBarItem {
        private readonly type: string;
        private text: string;

        readonly show = jest.fn();
        readonly hide = jest.fn();
        readonly setCounter = jest.fn();

        constructor(_plugin: unknown, type: string, props: { text: string; count: number }) {
            this.type = type;
            this.text = `${props.count} ${props.text}`;
        }

        getStatusBarItemType(): string {
            return this.type;
        }

        getText(): string {
            return this.text;
        }

        setText(text: string): void {
            this.text = text;
        }
    },
}));

jest.mock("src/ui/obsidian-ui-components/statusbar-items/text-statusbar-item", () => {
    const instances: MockStatusBarItem[] = [];

    class MockTextStatusBarItem implements MockStatusBarItem {
        private readonly type: string;
        private text: string;

        readonly show = jest.fn();
        readonly hide = jest.fn();
        readonly setText = jest.fn((text: string): void => {
            this.text = text;
        });

        constructor(_plugin: unknown, type: string, props: { text: string }) {
            this.type = type;
            this.text = props.text;
            instances.push(this);
        }

        getStatusBarItemType(): string {
            return this.type;
        }

        getText(): string {
            return this.text;
        }
    }

    return {
        __esModule: true,
        default: MockTextStatusBarItem,
        instances,
    };
});

interface MockStatusBarItem {
    getStatusBarItemType(): string;
    getText(): string;
    hide: jest.Mock<void, []>;
    setText: jest.Mock<void, [string]>;
    show: jest.Mock<void, []>;
}

interface MockTextStatusBarItemModule {
    instances: MockStatusBarItem[];
}

const GITHUB_REPOSITORY = "st3v3nmw/obsidian-spaced-repetition";
const ENDPOINT = `https://api.github.com/repos/${GITHUB_REPOSITORY}/releases/latest`;
const MANIFEST_VERSION = "0.1.0-rc.1";
const UPDATE_TEXT = "Spaced Repetition: new Update!";

const mockRequest = jest.mocked(request);
const mockTextStatusBarItemModule = jest.requireMock<MockTextStatusBarItemModule>(
    "src/ui/obsidian-ui-components/statusbar-items/text-statusbar-item",
);

function createManager(settings: SRSettings): StatusBarManager {
    const plugin = {
        manifest: { version: MANIFEST_VERSION },
    } as unknown as SRPlugin;
    const settingsManager = { settings } as unknown as SettingsManager;
    return new StatusBarManager(plugin, settingsManager);
}

function getUpdateItem(): MockStatusBarItem {
    const item = mockTextStatusBarItemModule.instances.find(
        (candidate) => candidate.getStatusBarItemType() === "update-available",
    );
    if (item === undefined) throw new Error("update status-bar item was not created");
    return item;
}

describe("StatusBarManager update checking", () => {
    beforeEach(() => {
        mockRequest.mockReset();
        mockTextStatusBarItemModule.instances.length = 0;
    });

    afterEach(() => {
        jest.restoreAllMocks();
    });

    test("first-run defaults do not request the latest version", async () => {
        const manager = createManager(DEFAULT_SETTINGS);

        await manager.createStatusBarItems();

        expect(mockRequest).not.toHaveBeenCalled();
        expect(getUpdateItem().getText()).toBe("");
    });

    test("explicit opt-in requests the fixed endpoint once and ignores the current version", async () => {
        mockRequest.mockResolvedValue(JSON.stringify({ ["tag_name"]: MANIFEST_VERSION }));
        const manager = createManager({
            ...DEFAULT_SETTINGS,
            showUpdateAvailableStatusBarItem: true,
        });

        await manager.createStatusBarItems();

        expect(mockRequest).toHaveBeenCalledTimes(1);
        expect(mockRequest).toHaveBeenCalledWith({ url: ENDPOINT });
        expect(getUpdateItem().getText()).toBe("");
    });

    test("explicit opt-in shows the update prompt only for a different version", async () => {
        mockRequest.mockResolvedValue(JSON.stringify({ ["tag_name"]: "0.1.1" }));
        const manager = createManager({
            ...DEFAULT_SETTINGS,
            showUpdateAvailableStatusBarItem: true,
        });

        await manager.createStatusBarItems();

        expect(mockRequest).toHaveBeenCalledTimes(1);
        expect(mockRequest).toHaveBeenCalledWith({ url: ENDPOINT });
        expect(getUpdateItem().getText()).toBe(UPDATE_TEXT);
    });

    test("request failure completes without displaying an update prompt", async () => {
        const requestError = new Error("network unavailable");
        mockRequest.mockRejectedValue(requestError);
        const warn = jest.spyOn(console, "warn").mockImplementation(() => undefined);
        const manager = createManager({
            ...DEFAULT_SETTINGS,
            showUpdateAvailableStatusBarItem: true,
        });

        await expect(manager.createStatusBarItems()).resolves.toBeUndefined();

        expect(mockRequest).toHaveBeenCalledTimes(1);
        expect(mockRequest).toHaveBeenCalledWith({ url: ENDPOINT });
        expect(warn).toHaveBeenCalledWith(requestError);
        expect(getUpdateItem().getText()).toBe("");
    });
});
