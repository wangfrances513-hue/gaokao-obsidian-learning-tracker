import { App, MarkdownView, TFile, WorkspaceLeaf } from "obsidian";

import { ReviewRound } from "src/gaokao/review-flow";

export const ROUND_SECTIONS = [
    "Source", "Prompt", "Cues", "Core Idea", "Error Boundaries", "Solution Skeleton",
    "Original Evidence", "Detailed Solution", "Deep Dive", "Variant Pool",
] as const;

export interface RoundSection { name: string; line: number; content: string }
export interface RoundPresentationPlan {
    rootLine: number;
    sections: RoundSection[];
    openLines: number[];
}
export type PresentationPlanResult = { ok: true; plan: RoundPresentationPlan } | { ok: false; issue: string };

export function inspectR1Text(text: string) {
    const body = text.replace(/^---\r?\n[\s\S]*?\r?\n(?:---|\.\.\.)\r?\n/, "");
    const section = (name: string) => new RegExp(`^## (?:${name})\\s*\\r?\\n([\\s\\S]*?)(?=^## |$(?![\\s\\S]))`, "m").exec(body)?.[1]?.trim() ?? "";
    const source = section("Source|来源");
    const prompt = section("Prompt|题面");
    const images = [...body.matchAll(/!\[\[([^\]\n]+)\]\]/g)].map((match) => match[1]);
    return { body, source, prompt, images, hasMaterial: !!(source || prompt || images.length), variantPool: section("Variant Pool") };
}

/** Parse only; an unsafe body is never rendered as a fallback. */
export function planRoundPresentation(text: string, title: string, round: "R2" | "R3"): PresentationPlanResult {
    const fail = (issue: string): PresentationPlanResult => ({ ok: false, issue });
    const lines = text.split(/\r?\n/);
    let start = 0;
    if (lines[0] === "---") {
        const end = lines.findIndex((line, index) => index > 0 && (line === "---" || line === "..."));
        if (end < 0) return fail("YAML 边界不完整。");
        start = end + 1;
    }
    let rootLine = -1;
    const sections: RoundSection[] = [];
    let current: RoundSection | undefined;
    for (let line = start; line < lines.length; line++) {
        const value = lines[line];
        if (/^# /.test(value)) {
            if (rootLine !== -1 || sections.length || value.slice(2).trim() !== title) return fail("一级标题与当前 Identity 不符或重复。");
            rootLine = line;
            continue;
        }
        if (/^## /.test(value)) {
            const rawName = value.slice(3).trim();
            const name = rawName === "Original Image" ? "Original Evidence" : rawName;
            if (!ROUND_SECTIONS.some((known) => known === name)) return fail(`存在未知区块：${rawName}。请人工准备后再复习。`);
            if (sections.some((section) => section.name === name)) return fail(`区块 ${name} 重复或存在证据别名冲突。`);
            current = { name, line, content: "" };
            sections.push(current);
            continue;
        }
        if (/^\s{0,3}#{1,6}\s/.test(value)) return fail("存在未识别的标题层级，请人工核对。");
        if (!current && value.trim()) return fail("标题外存在正文或图片，无法安全折叠。");
        if (current) current.content += `${value}\n`;
    }
    if (rootLine < 0) return fail("缺少明确的 Identity 一级标题。");
    const source = sections.find((section) => section.name === "Source");
    if (!source?.content.trim()) return fail("Source 缺失，请先补充现实材料位置。");
    if (/!\[|<|>/.test(source.content)) return fail("Source 含嵌入或不明确标记，不能默认展开。");
    const shown = sections.find((section) => section.name === (round === "R2" ? "Prompt" : "Cues"));
    if (!shown?.content.trim()) return fail(`${round === "R2" ? "无答案 Prompt" : "Cues"} 缺失。`);
    if (round === "R3") {
        const cues = shown.content.trim().split(/\r?\n/).filter((line) => line.trim());
        if (cues.length < 3 || cues.length > 5 || cues.some((line) => !/^\s*[-*]\s+\S/.test(line) || line.length > 80)) {
            return fail("Cues 需要 3–5 行短关键词列表；请人工补充，不自动生成答案。");
        }
        if (/!\[|<|>/.test(shown.content)) return fail("Cues 含不明确嵌入。");
    }
    if (round === "R2" && /<\/?(?:iframe|script|img|video|audio|details)|```/.test(shown.content)) return fail("Prompt 含不能确认安全的动态或代码区块。");
    return { ok: true, plan: { rootLine, sections, openLines: [rootLine, source.line, shown.line] } };
}

interface PresentationSession {
    entityId: string;
    cycleRef: string;
    round: ReviewRound;
    file: TFile;
    text: string;
    action: HTMLElement;
}

/** Native folding candidate. First-frame/image/leaf behavior still requires G4 observation. */
export class RoundPresentation {
    private readonly sessions = new Map<WorkspaceLeaf, PresentationSession>();

    constructor(private readonly app: App) {}

    async open(
        file: TFile, entityId: string, cycleRef: string, round: "R2" | "R3",
        onComplete: () => Promise<void>,
    ): Promise<void> {
        const text = await this.app.vault.read(file);
        const parsed = planRoundPresentation(text, file.basename, round);
        if (parsed.ok === false) throw new Error(parsed.issue);
        const leaf = this.app.workspace.getLeaf();
        const previous = this.sessions.get(leaf);
        if (previous?.entityId === entityId && previous.cycleRef === cycleRef &&
            previous.text === text && leaf.view instanceof MarkdownView && leaf.view.file === file) return;
        // Conceal the leaf's existing view host before openFile can render a different MarkdownView.
        const host = leaf.view.containerEl.parentElement;
        if (!host) throw new Error("无法隔离当前 leaf 的显示容器，未打开正文。");
        const visibility = host.style.visibility;
        host.style.visibility = "hidden";
        let ready = false;
        try {
            previous?.action.remove();
            this.sessions.delete(leaf);
            await leaf.openFile(file, { active: true, state: { mode: "source", source: false } });
            const view = leaf.view;
            if (!(view instanceof MarkdownView) || view.file !== file || view.getMode() !== "source" ||
                view.containerEl.parentElement !== host || this.app.workspace.activeLeaf !== leaf || view.editor.getValue() !== text) {
                throw new Error("Markdown 编辑视图、active leaf 或正文状态不符，停止展示。");
            }
            view.editor.exec("foldAll");
            for (const line of parsed.plan.openLines) {
                view.editor.setCursor({ line, ch: 0 });
                view.editor.exec("toggleFold");
            }
            view.editor.setCursor({ line: parsed.plan.rootLine, ch: 0 });
            const action = view.containerEl.createDiv("gaokao-round-action");
            action.createSpan({ text: `${round} · ${entityId}｜实际尝试后记录；展开正文不自动完成。` });
            const button = action.createEl("button", { text: "完成本轮" });
            button.addEventListener("click", () => { void onComplete(); });
            this.sessions.set(leaf, { entityId, cycleRef, round, file, text, action });
            ready = true;
        } finally {
            if (!ready) await leaf.setViewState({ type: "empty" });
            host.style.visibility = visibility;
        }
    }

    async assertReady(entityId: string, cycleRef: string | null): Promise<void> {
        const leaf = this.app.workspace.activeLeaf;
        const session = leaf && this.sessions.get(leaf);
        if (!session || session.entityId !== entityId || session.cycleRef !== cycleRef ||
            !(leaf.view instanceof MarkdownView) || leaf.view.file !== session.file ||
            leaf.view.getMode() !== "source" || leaf.view.editor.getValue() !== session.text ||
            await this.app.vault.read(session.file) !== session.text) {
            throw new Error("本轮展示会话已失效或窗格/内容改变，请重新准备展示。");
        }
    }

    clear(entityId: string): void {
        for (const [leaf, session] of this.sessions) {
            if (session.entityId === entityId) { session.action.remove(); this.sessions.delete(leaf); }
        }
    }

    dispose(): void {
        for (const session of this.sessions.values()) session.action.remove();
        this.sessions.clear();
    }
}
