/* eslint-disable camelcase -- Tests exercise the persisted snake_case YAML contract. */

import {
    GAOKAO_SUBJECTS,
    isGaokaoSchemaAttempt,
    validateGaokaoFrontmatter,
} from "src/gaokao/schema";

describe("GAOKAO frontmatter schema", () => {
    test("validates a knowledge point with Chinese subject and chapter", () => {
        const result = validateGaokaoFrontmatter({
            gaokao_id: "math-calculus-monotonicity",
            entity_type: "knowledge_point",
            subject: "数学",
            chapter: "函数与导数",
            knowledge_type: "method",
            priority_tier: 1,
            status: "active",
            unrelated_user_field: "preserved by Obsidian",
        });

        expect(result.kind).toBe("valid");
        if (result.kind === "valid") {
            expect(result.entity).toEqual({
                gaokao_id: "math-calculus-monotonicity",
                entity_type: "knowledge_point",
                subject: "数学",
                chapter: "函数与导数",
                knowledge_type: "method",
                priority_tier: 1,
                status: "active",
            });
        }
    });

    test("validates a problem case with zero or more knowledge references", () => {
        const result = validateGaokaoFrontmatter({
            gaokao_id: "problem-math-2026-0001",
            entity_type: "problem_case",
            subject: "数学",
            knowledge_ids: ["math-calculus-monotonicity", "math.derivative-001"],
            source: "甘肃模拟卷",
            difficulty: "medium",
        });

        expect(result.kind).toBe("valid");
        if (result.kind === "valid" && result.entity.entity_type === "problem_case") {
            expect(result.entity.knowledge_ids).toHaveLength(2);
            expect(result.entity.source).toBe("甘肃模拟卷");
        }

        expect(
            validateGaokaoFrontmatter({
                gaokao_id: "problem-math-2026-0002",
                entity_type: "problem_case",
                subject: "数学",
                knowledge_ids: [],
            }).kind,
        ).toBe("valid");
    });

    test("validates a resource unit", () => {
        const result = validateGaokaoFrontmatter({
            gaokao_id: "resource-math-yishu-calculus-001",
            entity_type: "resource_unit",
            subject: "数学",
            resource_url: "https://example.com/resource",
            resource_status: "unstarted",
            knowledge_ids: ["math-calculus-monotonicity"],
        });

        expect(result.kind).toBe("valid");
        if (result.kind === "valid" && result.entity.entity_type === "resource_unit") {
            expect(result.entity.resource_status).toBe("unstarted");
        }
    });

    test("treats ordinary frontmatter and malformed cache values as non-GAOKAO", () => {
        expect(validateGaokaoFrontmatter({ tags: ["diary"], status: "draft" }).kind).toBe(
            "ordinary",
        );
        expect(validateGaokaoFrontmatter(undefined).kind).toBe("ordinary");
        expect(validateGaokaoFrontmatter("malformed YAML").kind).toBe("ordinary");
        expect(isGaokaoSchemaAttempt({ subject: "数学" })).toBe(false);
    });

    test("detects a missing gaokao_id without generating one", () => {
        const result = validateGaokaoFrontmatter({
            entity_type: "knowledge_point",
            subject: "数学",
        });
        expect(result.kind).toBe("invalid");
        expect(result.issues.map((issue) => issue.code)).toContain("missing_gaokao_id");
    });

    test.each(["Math-001", " math-001", "math 001", "数学-001", "", 101])(
        "rejects invalid gaokao_id %p",
        (gaokaoId) => {
            const result = validateGaokaoFrontmatter({
                gaokao_id: gaokaoId,
                entity_type: "knowledge_point",
                subject: "数学",
            });
            expect(result.kind).toBe("invalid");
            expect(result.issues.map((issue) => issue.code)).toContain("invalid_gaokao_id");
        },
    );

    test("detects missing subject and unsupported entity type", () => {
        const missingSubject = validateGaokaoFrontmatter({
            gaokao_id: "math-001",
            entity_type: "knowledge_point",
        });
        expect(missingSubject.issues.map((issue) => issue.code)).toContain("missing_subject");

        const invalidType = validateGaokaoFrontmatter({
            gaokao_id: "math-001",
            entity_type: "dashboard",
            subject: "数学",
        });
        expect(invalidType.issues.map((issue) => issue.code)).toContain("unsupported_entity_type");
    });

    test("detects malformed knowledge_ids", () => {
        for (const knowledgeIds of ["math-001", ["Math-001"], [1]]) {
            const result = validateGaokaoFrontmatter({
                gaokao_id: "problem-001",
                entity_type: "problem_case",
                subject: "数学",
                knowledge_ids: knowledgeIds,
            });
            expect(result.kind).toBe("invalid");
            expect(
                result.issues.some((issue: { code: string }) =>
                    issue.code.includes("knowledge_id"),
                ),
            ).toBe(true);
        }
    });

    test.each(GAOKAO_SUBJECTS)("supports Chinese subject %s", (subject) => {
        expect(
            validateGaokaoFrontmatter({
                gaokao_id: `subject-${GAOKAO_SUBJECTS.indexOf(subject)}`,
                entity_type: "knowledge_point",
                subject,
            }).kind,
        ).toBe("valid");
    });

    test("rejects unsupported subjects without reinterpretation", () => {
        const result = validateGaokaoFrontmatter({
            gaokao_id: "math-001",
            entity_type: "knowledge_point",
            subject: "math",
        });
        expect(result.issues.map((issue) => issue.code)).toContain("unsupported_subject");
    });

    test("validates controlled vocabularies and bounded priority", () => {
        const knowledgePoint = validateGaokaoFrontmatter({
            gaokao_id: "math-001",
            entity_type: "knowledge_point",
            subject: "数学",
            chapter: "",
            knowledge_type: "concept",
            priority_tier: 4,
            status: "done",
        });
        expect(knowledgePoint.issues.map((issue) => issue.code)).toEqual(
            expect.arrayContaining([
                "invalid_chapter",
                "invalid_knowledge_type",
                "invalid_priority_tier",
                "invalid_status",
            ]),
        );

        const problem = validateGaokaoFrontmatter({
            gaokao_id: "problem-001",
            entity_type: "problem_case",
            subject: "数学",
            difficulty: "extreme",
            source: 42,
        });
        expect(problem.issues.map((issue) => issue.code)).toEqual(
            expect.arrayContaining(["invalid_difficulty", "invalid_source"]),
        );

        const resource = validateGaokaoFrontmatter({
            gaokao_id: "resource-001",
            entity_type: "resource_unit",
            subject: "数学",
            resource_status: "watched",
            resource_url: "",
        });
        expect(resource.issues.map((issue) => issue.code)).toEqual(
            expect.arrayContaining(["invalid_resource_status", "invalid_resource_url"]),
        );
    });
});
