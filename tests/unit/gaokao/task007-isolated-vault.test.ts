/* eslint-disable camelcase -- Tests exercise persisted GAOKAO field names. */

import crypto from "crypto";
import fs from "fs";
import os from "os";
import path from "path";

import { GaokaoEntitySource } from "src/gaokao/entity-registry";
import { createDefaultGaokaoPluginData, GaokaoManager } from "src/gaokao/gaokao-manager";
import { buildTodayPlan, TodayPlannerCandidate } from "src/gaokao/today-planner";
import { buildGaokaoNote, GAOKAO_NOTE_TEMPLATES, GeneratedGaokaoNote } from "src/gaokao/workflow";

function hashContent(content: string): string {
    return crypto.createHash("sha256").update(content).digest("hex");
}

function parseScalar(value: string): unknown {
    if (value === "[]") return [];
    try {
        return JSON.parse(value) as unknown;
    } catch {
        return value;
    }
}

function parseGeneratedFrontmatter(content: string): Record<string, unknown> {
    const match = content.match(/^---\n([\s\S]*?)\n---/);
    if (!match) throw new Error("Missing generated frontmatter.");
    const result: Record<string, unknown> = {};
    let listKey: string | null = null;
    for (const line of match[1].split("\n")) {
        const listItem = line.match(/^\s+-\s+(.+)$/);
        if (listItem && listKey) {
            (result[listKey] as unknown[]).push(parseScalar(listItem[1]));
            continue;
        }
        const field = line.match(/^([a-z0-9_-]+):(?:\s*(.*))$/i);
        if (!field) continue;
        const [, key, rawValue] = field;
        if (rawValue.length === 0) {
            result[key] = [];
            listKey = key;
        } else {
            result[key] = parseScalar(rawValue);
            listKey = null;
        }
    }
    return result;
}

function listMarkdownFiles(root: string, relativeRoot = ""): string[] {
    const absoluteRoot = path.join(root, relativeRoot);
    const result: string[] = [];
    for (const entry of fs.readdirSync(absoluteRoot, { withFileTypes: true })) {
        const relativePath = path.join(relativeRoot, entry.name);
        if (entry.isDirectory()) result.push(...listMarkdownFiles(root, relativePath));
        else if (entry.isFile() && entry.name.endsWith(".md")) result.push(relativePath);
    }
    return result.sort((left, right) => left.localeCompare(right, "zh-CN"));
}

function readSources(vaultRoot: string): GaokaoEntitySource[] {
    return listMarkdownFiles(vaultRoot).map((relativePath) => {
        const content = fs.readFileSync(path.join(vaultRoot, relativePath), "utf8");
        const frontmatter = content.startsWith("---\n") ? parseGeneratedFrontmatter(content) : {};
        return { path: relativePath, frontmatter };
    });
}

function writeGeneratedNote(vaultRoot: string, note: GeneratedGaokaoNote): void {
    const absolutePath = path.join(vaultRoot, note.path);
    fs.mkdirSync(path.dirname(absolutePath), { recursive: true });
    fs.writeFileSync(absolutePath, note.content, "utf8");
}

describe("Task 007 disposable Vault integration", () => {
    let vaultRoot = "";

    beforeEach(() => {
        vaultRoot = fs.mkdtempSync(path.join(os.tmpdir(), "gaokao-task007-vault-"));
    });

    afterEach(() => {
        fs.rmSync(vaultRoot, { force: true, recursive: true });
    });

    test("isolates ordinary notes and preserves Chinese identity through disk rename, move, edit, and reload", async () => {
        const task007Templates = GAOKAO_NOTE_TEMPLATES.filter(
            (template) => template.workflowKind !== undefined,
        );
        const generatedNotes = task007Templates.map((template, index) =>
            buildGaokaoNote({
                templateId: template.id,
                gaokaoId: `task007-disposable-${template.id}-${index}`,
                title:
                    template.id === "chinese_reading_language"
                        ? "《赤壁赋》语言现象"
                        : `${template.subject}流程 ${index + 1}`,
                ...(template.id === "chinese_reading_language"
                    ? { folder: "语文/Mixed Path/古文与语言" }
                    : {}),
            }),
        );
        for (const note of generatedNotes) writeGeneratedNote(vaultRoot, note);

        const ordinaryPath = "普通笔记/中文随手记录.md";
        const ordinaryContent = "---\naliases:\n  - 普通\n---\n\n这不是 GAOKAO 实体。\n";
        fs.mkdirSync(path.dirname(path.join(vaultRoot, ordinaryPath)), { recursive: true });
        fs.writeFileSync(path.join(vaultRoot, ordinaryPath), ordinaryContent, "utf8");
        const ordinaryFlashcardPath = "英语/普通闪卡.md";
        const ordinaryFlashcardContent = "#flashcards\n\nexisting question::existing answer\n";
        fs.mkdirSync(path.dirname(path.join(vaultRoot, ordinaryFlashcardPath)), {
            recursive: true,
        });
        fs.writeFileSync(
            path.join(vaultRoot, ordinaryFlashcardPath),
            ordinaryFlashcardContent,
            "utf8",
        );
        const ordinaryHashes = new Map([
            [ordinaryPath, hashContent(ordinaryContent)],
            [ordinaryFlashcardPath, hashContent(ordinaryFlashcardContent)],
        ]);

        const data = createDefaultGaokaoPluginData();
        let persistCount = 0;
        const manager = new GaokaoManager({
            getData: () => data,
            transact: async (operation) => await operation({ data, save: async (next) => { Object.assign(data, next); persistCount++; } }),
        });
        manager.rebuildIndex(readSources(vaultRoot));

        expect(generatedNotes).toHaveLength(13);
        expect(generatedNotes.map((note) => manager.inspect(note.path).status)).toEqual(
            Array.from({ length: 13 }, () => "valid"),
        );
        expect(manager.inspect(ordinaryPath).status).toBe("ordinary");
        expect(manager.inspect(ordinaryFlashcardPath).status).toBe("ordinary");
        expect(data.learningEvents).toEqual([]);
        expect(persistCount).toBe(0);

        const chineseNote = generatedNotes.find(
            (note) => note.frontmatter.workflow_kind === "chinese_reading_language",
        );
        if (!chineseNote) throw new Error("Missing Chinese mixed-path note.");
        const originalAbsolutePath = path.join(vaultRoot, chineseNote.path);
        const contentBeforeMove = fs.readFileSync(originalAbsolutePath, "utf8");
        expect(chineseNote.path).toBe("语文/Mixed Path/古文与语言/《赤壁赋》语言现象.md");
        expect(contentBeforeMove).toContain("# 《赤壁赋》语言现象");
        expect(contentBeforeMove).toContain("## 理解与依据");

        const movedPath = "语文/迁移后 Mixed-Path/文言文/《赤壁赋》语言现象（重命名）.md";
        const movedAbsolutePath = path.join(vaultRoot, movedPath);
        fs.mkdirSync(path.dirname(movedAbsolutePath), { recursive: true });
        fs.renameSync(originalAbsolutePath, movedAbsolutePath);
        manager.renameEntitySource(chineseNote.path, movedPath);
        expect(hashContent(fs.readFileSync(movedAbsolutePath, "utf8"))).toBe(
            hashContent(contentBeforeMove),
        );
        expect(manager.inspect(movedPath).entity?.gaokao_id).toBe(chineseNote.entity.gaokao_id);
        expect(data.learningEvents).toEqual([]);

        fs.appendFileSync(movedAbsolutePath, "\n中文补充内容：语境与证据。\n", "utf8");
        manager.updateEntitySource(
            movedPath,
            parseGeneratedFrontmatter(fs.readFileSync(movedAbsolutePath, "utf8")),
        );
        expect(data.learningEvents).toEqual([]);
        expect(persistCount).toBe(0);

        const reloadedManager = new GaokaoManager({
            getData: () => data,
            transact: async (operation) => await operation({ data, save: async (next) => { Object.assign(data, next); persistCount++; } }),
        });
        reloadedManager.rebuildIndex(readSources(vaultRoot));
        expect(reloadedManager.inspect(movedPath).entity?.gaokao_id).toBe(
            chineseNote.entity.gaokao_id,
        );
        expect(reloadedManager.getHistory(chineseNote.entity.gaokao_id)).toEqual([]);

        expect(
            (await reloadedManager.recordForPath(ordinaryPath, { event_type: "study" })).status,
        ).toBe("ordinary");
        expect(data.learningEvents).toEqual([]);
        expect(persistCount).toBe(0);

        const candidates: TodayPlannerCandidate[] = reloadedManager.getEntities().map((item) => ({
            path: item.path,
            title: path.basename(item.path, ".md"),
            entity: item.entity,
            events: reloadedManager.getHistory(item.entity.gaokao_id),
            schedule: { kind: "none" },
        }));
        const beforeToday = JSON.stringify(candidates);
        buildTodayPlan(candidates, { todayUnix: Date.UTC(2026, 7, 8), discretionaryLimit: 20 });
        buildTodayPlan(candidates, { todayUnix: Date.UTC(2026, 7, 8), discretionaryLimit: 20 });
        expect(JSON.stringify(candidates)).toBe(beforeToday);
        expect(data.learningEvents).toEqual([]);

        for (const [relativePath, expectedHash] of ordinaryHashes) {
            expect(hashContent(fs.readFileSync(path.join(vaultRoot, relativePath), "utf8"))).toBe(
                expectedHash,
            );
        }
    });
});
