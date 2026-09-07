import { MarkdownView, TFile } from "obsidian";
import { planRoundPresentation, RoundPresentation } from "src/gaokao/review-presentation";

jest.mock("obsidian", () => ({ MarkdownView: class MockMarkdownView {}, TFile: class MockTFile {} }));
const text = "---\ngaokao_id: synthetic\n---\n# Synthetic\n\n## Source\nPaper A / Q3\n\n## Prompt\nTry the question on paper.\n\n## Cues\n- object\n- boundary\n- relation\n\n## Core Idea\nHidden model\n\n## Original Evidence\n![[answer-page.png]]\n\n## Detailed Solution\nHidden answer\n";

describe("T22 static semantic presentation readiness", () => {
    test.each(["R2", "R3"] as const)("%s opens only Identity, Source and the required action section", (round) => {
        const result = planRoundPresentation(text, "Synthetic", round);
        if (result.ok === false) throw new Error(result.issue);
        const visible = result.plan.sections.filter((section) => result.plan.openLines.includes(section.line)).map((section) => section.name);
        expect(visible).toEqual(["Source", round === "R2" ? "Prompt" : "Cues"]);
        expect(result.plan.openLines[0]).toBe(result.plan.rootLine);
    });
    test.each([
        text.replace("# Synthetic", "# Synthetic\n![[answer-page.png]]"),
        text.replace("## Source", "## Unknown"),
        text + "\n## Source\nDuplicate\n",
        text.replace("Paper A / Q3", "![[complete-paper.pdf]]"),
        text.replace("Try the question on paper.", ""),
        text.replace("# Synthetic", "# Answer is 42"),
        text + "\n## Original Image\nAmbiguous alias\n",
    ])("T22 unsafe/incomplete content stays concealed %#", (input) => {
        expect(planRoundPresentation(input, "Synthetic", "R2").ok).toBe(false);
    });
    test("R3 rejects two cues or answer paragraphs; does not generate replacement content", () => {
        expect(planRoundPresentation(text.replace("- relation\n", ""), "Synthetic", "R3").ok).toBe(false);
        expect(planRoundPresentation(text.replace("- boundary", "Long answer paragraph"), "Synthetic", "R3").ok).toBe(false);
    });
});

function fakeLeaf() {
    const host = { style: { visibility: "visible" } };
    const calls: (string | number)[] = [];
    const button = { addEventListener: jest.fn() };
    const action = { createSpan: jest.fn(), createEl: () => button, remove: jest.fn() };
    const file = Object.assign(new TFile(), { basename: "Synthetic", path: "synthetic.md" });
    const view = Object.assign(new MarkdownView({} as never), {
        file, getMode: () => "source", containerEl: { parentElement: host, createDiv: () => action },
        editor: { getValue: (): string => text, exec: (command: string) => calls.push(command), setCursor: (position: { line: number }) => calls.push(position.line) },
    });
    const leaf = { view, openFile: jest.fn(async (): Promise<void> => { calls.push(host.style.visibility); }), setViewState: jest.fn(async (): Promise<void> => undefined) };
    const app = { vault: { read: jest.fn(async () => text) }, workspace: { getLeaf: () => leaf, activeLeaf: leaf } };
    return { host, calls, leaf, app, file, action };
}

describe("T23 native fold candidate wiring (mock only, G4 observation still required)", () => {
    test("conceals before opening, unfolds root first, and preserves manual changes within a session", async () => {
        const h = fakeLeaf();
        const other = fakeLeaf();
        const presentation = new RoundPresentation(h.app as never);
        const complete = jest.fn(async (): Promise<void> => undefined);
        await presentation.open(h.file, "synthetic", "root", "R2", complete);
        expect(h.calls[0]).toBe("hidden");
        expect(h.calls[1]).toBe("foldAll");
        expect(h.calls[2]).toBe(3); // root, before opening its children
        expect(h.host.style.visibility).toBe("visible");
        const initial = [...h.calls];
        await presentation.open(h.file, "synthetic", "root", "R2", complete);
        expect(h.calls).toEqual(initial);
        expect(other.calls).toEqual([]);
        expect(complete).not.toHaveBeenCalled();
        presentation.dispose(); expect(h.action.remove).toHaveBeenCalledTimes(1);
    });
    test("changed leaf/content invalidates completion; failed preparation empties concealed view", async () => {
        const h = fakeLeaf(); const presentation = new RoundPresentation(h.app as never);
        await presentation.open(h.file, "synthetic", "root", "R3", async () => undefined);
        h.app.vault.read.mockResolvedValue(text + "changed");
        await expect(presentation.assertReady("synthetic", "root")).rejects.toThrow();
        h.app.vault.read.mockResolvedValue(text);
        h.leaf.view.editor.getValue = () => "stale editor";
        await expect(presentation.open(h.file, "synthetic", "new-cycle", "R3", async () => undefined)).rejects.toThrow();
        expect(h.leaf.setViewState).toHaveBeenCalledWith({ type: "empty" });
        expect(h.host.style.visibility).toBe("visible");
    });
});
