import fs from "fs";
import path from "path";

import { GaokaoEntityRegistry } from "src/gaokao/entity-registry";

const fixtureRoot = path.resolve("tests/vaults/gaokao-task005");

function parseScalar(rawValue: string): string | number {
    return /^\d+$/.test(rawValue) ? Number(rawValue) : rawValue;
}

function readFixture(relativePath: string): { path: string; frontmatter: Record<string, unknown> } {
    const content = fs.readFileSync(path.join(fixtureRoot, relativePath), "utf8");
    const match = content.match(/^---\n([\s\S]*?)\n---/);
    if (!match) throw new Error(`Missing frontmatter in ${relativePath}`);
    const frontmatter: Record<string, unknown> = {};
    let listKey: string | null = null;
    for (const line of match[1].split("\n")) {
        const item = line.match(/^\s+-\s+(.+)$/);
        if (item && listKey) {
            (frontmatter[listKey] as (string | number)[]).push(parseScalar(item[1]));
            continue;
        }
        const field = line.match(/^([a-z0-9_-]+):(?:\s*(.*))$/i);
        if (!field) continue;
        const [, key, rawValue] = field;
        if (rawValue.length === 0) {
            frontmatter[key] = [];
            listKey = key;
        } else {
            frontmatter[key] = parseScalar(rawValue);
            listKey = null;
        }
    }
    expect(content).toMatch(/[\u4e00-\u9fff]/);
    return { path: relativePath, frontmatter };
}

describe("Task 005 small realistic Chinese Vault dataset", () => {
    test("indexes all seven Math/Physics notes and resolves problem linkage", () => {
        const paths = [
            "数学/函数与导数/导数判断单调性.md",
            "数学/函数与导数/含参数函数分类讨论.md",
            "数学/代表题/导数代表题001.md",
            "数学/代表题/导数代表题002.md",
            "物理/电磁感应/导体棒切割磁感线.md",
            "物理/电磁感应/电磁感应中的能量.md",
            "物理/代表题/电磁感应代表题001.md",
        ];
        const registry = new GaokaoEntityRegistry();
        registry.rebuild(paths.map(readFixture));

        expect(paths.map((notePath) => registry.inspect(notePath).status)).toEqual(
            Array.from({ length: 7 }, () => "valid"),
        );
        expect(registry.inspect("数学/代表题/导数代表题001.md").issues).toEqual([]);
        expect(registry.inspect("物理/代表题/电磁感应代表题001.md").issues).toEqual([]);
        expect(registry.getKnowledgePoints()).toHaveLength(4);
    });
});
