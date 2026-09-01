import fs from "fs";
import path from "path";

import { GaokaoEntityRegistry } from "src/gaokao/entity-registry";

const fixtureRoot = path.resolve("tests/vaults/gaokao-task004");

function readFixture(relativePath: string): { path: string; frontmatter: Record<string, unknown> } {
    const notePath = path.join(fixtureRoot, relativePath);
    const content = fs.readFileSync(notePath, "utf8");
    const match = content.match(/^---\n([\s\S]*?)\n---/);
    if (!match) throw new Error(`Missing frontmatter in ${relativePath}`);

    const frontmatter: Record<string, unknown> = {};
    let listKey: string | null = null;
    for (const line of match[1].split("\n")) {
        const item = line.match(/^\s+-\s+(.+)$/);
        if (item && listKey) {
            (frontmatter[listKey] as string[]).push(item[1]);
            continue;
        }
        const field = line.match(/^([a-z0-9_-]+):(?:\s*(.*))$/i);
        if (!field) continue;
        const [, key, rawValue] = field;
        if (rawValue.length === 0) {
            frontmatter[key] = [];
            listKey = key;
        } else {
            frontmatter[key] = key === "priority_tier" ? Number(rawValue) : rawValue;
            listKey = null;
        }
    }
    expect(content).toMatch(/[\u4e00-\u9fff]/);
    return { path: relativePath, frontmatter };
}

describe("Task 004 isolated Chinese Vault fixtures", () => {
    test("recognizes the knowledge point, problem case, and resource unit", () => {
        const registry = new GaokaoEntityRegistry();
        const sources = [
            readFixture("数学/函数与导数/导数判断单调性.md"),
            readFixture("数学/测试题/导数代表题001.md"),
            readFixture("数学/资源/导数课程001.md"),
        ];
        registry.rebuild(sources);

        expect(sources.map((source) => registry.inspect(source.path).status)).toEqual([
            "valid",
            "valid",
            "valid",
        ]);
        expect(registry.inspect(sources[1].path).issues).toEqual([]);
        expect(registry.inspect(sources[2].path).issues).toEqual([]);
    });

    test("detects a duplicate fixture without changing either source", () => {
        const original = readFixture("数学/函数与导数/导数判断单调性.md");
        const registry = new GaokaoEntityRegistry();
        registry.rebuild([original, { ...original, path: "数学/重复/同一知识点.md" }]);

        expect(registry.inspect(original.path).status).toBe("duplicate");
        expect(registry.inspect("数学/重复/同一知识点.md").status).toBe("duplicate");
        expect(fs.existsSync(path.join(fixtureRoot, original.path))).toBe(true);
        expect(fs.existsSync(path.join(fixtureRoot, "数学/重复/同一知识点.md"))).toBe(false);
    });
});
