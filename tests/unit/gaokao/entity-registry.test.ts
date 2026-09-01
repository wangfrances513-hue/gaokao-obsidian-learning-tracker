/* eslint-disable camelcase -- Tests exercise the persisted snake_case YAML contract. */

import { GaokaoEntityRegistry } from "src/gaokao/entity-registry";

const knowledgePoint = {
    gaokao_id: "math-calculus-monotonicity",
    entity_type: "knowledge_point",
    subject: "数学",
};

describe("GAOKAO entity registry", () => {
    test("detects duplicate IDs without resolving or merging either entity", () => {
        const registry = new GaokaoEntityRegistry();
        registry.rebuild([
            { path: "数学/A.md", frontmatter: knowledgePoint },
            { path: "数学/B.md", frontmatter: { ...knowledgePoint } },
        ]);

        expect(registry.inspect("数学/A.md").status).toBe("duplicate");
        expect(registry.inspect("数学/B.md").status).toBe("duplicate");
        expect(registry.getEntityById(knowledgePoint.gaokao_id)).toBeUndefined();
        expect(registry.getDuplicatePaths(knowledgePoint.gaokao_id)).toEqual([
            "数学/A.md",
            "数学/B.md",
        ]);
    });

    test("an invalid duplicate candidate blocks silent linkage to the valid entity", () => {
        const registry = new GaokaoEntityRegistry();
        registry.rebuild([
            { path: "valid.md", frontmatter: knowledgePoint },
            {
                path: "invalid.md",
                frontmatter: { gaokao_id: knowledgePoint.gaokao_id, entity_type: "problem_case" },
            },
        ]);

        expect(registry.inspect("valid.md").status).toBe("duplicate");
        expect(registry.inspect("invalid.md").status).toBe("invalid");
        expect(registry.inspect("invalid.md").issues.map((issue) => issue.code)).toContain(
            "duplicate_gaokao_id",
        );
    });

    test("reports unresolved, ambiguous, and wrong-type knowledge references as warnings", () => {
        const registry = new GaokaoEntityRegistry();
        registry.rebuild([
            { path: "知识点.md", frontmatter: knowledgePoint },
            {
                path: "资源A.md",
                frontmatter: {
                    gaokao_id: "resource-duplicate",
                    entity_type: "resource_unit",
                    subject: "数学",
                },
            },
            {
                path: "资源B.md",
                frontmatter: {
                    gaokao_id: "resource-duplicate",
                    entity_type: "resource_unit",
                    subject: "数学",
                },
            },
            {
                path: "题目.md",
                frontmatter: {
                    gaokao_id: "problem-001",
                    entity_type: "problem_case",
                    subject: "数学",
                    knowledge_ids: [
                        "missing-knowledge",
                        "resource-duplicate",
                        "problem-wrong-type",
                    ],
                },
            },
            {
                path: "错误类型.md",
                frontmatter: {
                    gaokao_id: "problem-wrong-type",
                    entity_type: "problem_case",
                    subject: "数学",
                },
            },
        ]);

        expect(registry.inspect("题目.md").issues.map((issue) => issue.code)).toEqual(
            expect.arrayContaining([
                "unresolved_knowledge_id",
                "ambiguous_knowledge_id",
                "invalid_knowledge_reference_type",
            ]),
        );
        expect(registry.inspect("题目.md").status).toBe("valid");
    });

    test("keeps identity valid across an in-memory rename and move", () => {
        const registry = new GaokaoEntityRegistry();
        registry.rebuild([
            { path: "数学/函数与导数/导数判断单调性.md", frontmatter: knowledgePoint },
        ]);

        registry.rename("数学/函数与导数/导数判断单调性.md", "数学/函数与导数/导数单调性判断.md");
        registry.rename("数学/函数与导数/导数单调性判断.md", "数学/重点/导数单调性判断.md");

        expect(registry.inspect("数学/函数与导数/导数判断单调性.md").status).toBe("ordinary");
        expect(registry.inspect("数学/重点/导数单调性判断.md").entity?.gaokao_id).toBe(
            knowledgePoint.gaokao_id,
        );
        expect(registry.getEntityById(knowledgePoint.gaokao_id)?.path).toBe(
            "数学/重点/导数单调性判断.md",
        );
    });

    test("updates and removes sources without scanning note content", () => {
        const registry = new GaokaoEntityRegistry();
        registry.upsert("note.md", knowledgePoint);
        expect(registry.inspect("note.md").status).toBe("valid");

        registry.upsert("note.md", { tags: ["diary"] });
        expect(registry.inspect("note.md").status).toBe("ordinary");

        registry.upsert("note.md", knowledgePoint);
        registry.remove("note.md");
        registry.remove("missing.md");
        expect(registry.getAllInspections()).toEqual([]);
    });
});
