/* eslint-disable camelcase -- Tests exercise generated snake_case YAML contracts. */

import { GaokaoEntityRegistry } from "src/gaokao/entity-registry";
import {
    buildGaokaoNote,
    createGaokaoImageBodyEvidence,
    GAOKAO_NOTE_TEMPLATE_IDS,
    GaokaoNoteTemplateId,
    generateGaokaoId,
    mergeGaokaoTemplateFrontmatter,
    validateVaultFolder,
} from "src/gaokao/workflow";

const stableRandom = () => "123e4567-e89b-42d3-a456-426614174000";

function idFor(templateId: GaokaoNoteTemplateId): string {
    return generateGaokaoId(templateId, stableRandom);
}

describe("Task 005 Math/Physics note templates", () => {
    test("generates the compact Math concept note", () => {
        const note = buildGaokaoNote({
            templateId: "math_concept",
            gaokaoId: idFor("math_concept"),
            title: "导数定义",
            folder: "数学/函数与导数",
            chapter: "函数与导数",
        });

        expect(note.path).toBe("数学/函数与导数/导数定义.md");
        expect(note.frontmatter).toMatchObject({
            entity_type: "knowledge_point",
            subject: "数学",
            knowledge_type: "memory",
            priority_tier: 1,
            status: "active",
            tags: ["review"],
        });
        expect(note.content).toContain("## 核心结论");
        expect(note.content).toContain("## 三秒识别");
    });

    test("generates the procedural Math method note", () => {
        const note = buildGaokaoNote({
            templateId: "math_method",
            gaokaoId: idFor("math_method"),
            title: "导数判断单调性",
            chapter: "函数与导数",
        });

        expect(note.path).toBe("数学/方法模型/导数判断单调性.md");
        expect(note.frontmatter.knowledge_type).toBe("method");
        expect(note.content).toContain("## 决策顺序");
        expect(note.content).toContain("## 变式验证");
    });

    test("generates the linked Math representative-problem note", () => {
        const note = buildGaokaoNote({
            templateId: "math_problem",
            gaokaoId: idFor("math_problem"),
            title: "导数代表题 001",
            source: "测试卷",
            knowledgeIds: ["math-method-123e4567e89b"],
        });

        expect(note.frontmatter).toMatchObject({
            entity_type: "problem_case",
            subject: "数学",
            knowledge_ids: ["math-method-123e4567e89b"],
            source: "测试卷",
            difficulty: "medium",
        });
        expect(note.content).toContain("## 我的首次思路");
        expect(note.content).toContain("## 再验证");
    });

    test("generates the model-centered Physics knowledge note", () => {
        const note = buildGaokaoNote({
            templateId: "physics_model",
            gaokaoId: idFor("physics_model"),
            title: "导体棒切割磁感线模型",
            folder: "物理/电磁感应",
            chapter: "电磁感应",
        });

        expect(note.frontmatter).toMatchObject({
            entity_type: "knowledge_point",
            subject: "物理",
            knowledge_type: "method",
        });
        expect(note.content).toContain("## 研究对象");
        expect(note.content).toContain("## 过程划分");
        expect(note.content).toContain("## 临界条件");
    });

    test("generates the compact four-part Physics representative-problem note", () => {
        const note = buildGaokaoNote({
            templateId: "physics_problem",
            gaokaoId: idFor("physics_problem"),
            title: "电磁感应代表题 001",
            knowledgeIds: ["physics-model-123e4567e89b"],
        });

        expect(note.frontmatter).toMatchObject({
            entity_type: "problem_case",
            subject: "物理",
            knowledge_ids: ["physics-model-123e4567e89b"],
            difficulty: "medium",
            status: "active",
            tags: ["review"],
        });
        expect(note.content.match(/^## .+$/gm)).toEqual([
            "## 题面",
            "## 关键模型与步骤",
            "## 当前卡点与下次识别信号",
            "## 再验证",
        ]);
        expect(note.content).toContain(
            "## 关键模型与步骤\n\n可选提示：研究对象、过程划分、初态与末态、受力、规律、方程链、临界条件与正确模型。",
        );
        expect(note.content).toContain(
            "## 当前卡点与下次识别信号\n\n可选提示：记录我的错误、当前卡点与下次识别信号。",
        );
        expect(note.content).not.toContain("## 研究对象");
        expect(note.content).not.toContain("## 我的错误");
    });

    test.each(GAOKAO_NOTE_TEMPLATE_IDS)("generates a valid stable ID for %s", (templateId) => {
        const first = generateGaokaoId(templateId, stableRandom);
        const second = generateGaokaoId(templateId, stableRandom);
        expect(first).toBe(second);
        expect(first).toMatch(/^[a-z0-9][a-z0-9._-]*$/);
        expect(first).not.toContain("导数");
    });

    test("preserves unrelated YAML and refuses destructive controlled-field replacement", () => {
        const note = buildGaokaoNote({
            templateId: "math_concept",
            gaokaoId: idFor("math_concept"),
            title: "函数概念",
            existingFrontmatter: {
                custom_unknown: "必须保留",
                aliases: "自定义别名",
            },
        });
        expect(note.frontmatter.custom_unknown).toBe("必须保留");
        expect(note.frontmatter.aliases).toBe("自定义别名");

        expect(() =>
            mergeGaokaoTemplateFrontmatter(
                { gaokao_id: "existing-id", custom_unknown: "保留" },
                { gaokao_id: "new-id" },
            ),
        ).toThrow(/未覆盖原值/);
    });

    test("supports Chinese paths and rejects traversal or title path injection", () => {
        expect(validateVaultFolder("物理/电磁感应/重点", "物理/模型")).toBe("物理/电磁感应/重点");
        expect(() => validateVaultFolder("物理/../生产 Vault", "物理/模型")).toThrow(/不安全/);
        expect(() =>
            buildGaokaoNote({
                templateId: "math_concept",
                gaokaoId: idFor("math_concept"),
                title: "../覆盖",
            }),
        ).toThrow(/标题/);
    });

    test("duplicate generated IDs remain diagnostic and cannot silently resolve", () => {
        const id = idFor("math_concept");
        const registry = new GaokaoEntityRegistry();
        registry.rebuild([
            {
                path: "数学/A.md",
                frontmatter: {
                    gaokao_id: id,
                    entity_type: "knowledge_point",
                    subject: "数学",
                },
            },
            {
                path: "数学/B.md",
                frontmatter: {
                    gaokao_id: id,
                    entity_type: "knowledge_point",
                    subject: "数学",
                },
            },
        ]);

        expect(registry.getCandidatePaths(id)).toEqual(["数学/A.md", "数学/B.md"]);
        expect(registry.getEntityById(id)).toBeUndefined();
    });
});

describe("Task 011 image evidence body extension", () => {
    const sha256 = "a".repeat(64);
    const mathPath = `资源/图片/数学/2026/08/${sha256}.jpg`;
    const biologyPath = `资源/图片/生物/2026/08/${sha256}.png`;

    test.each(["数学", "生物", "化学", "物理", "英语", "语文"])(
        "accepts the managed image path for %s",
        (subject) => {
            expect(
                createGaokaoImageBodyEvidence(`资源/图片/${subject}/2026/08/${sha256}.jpg`, sha256)
                    .attachmentPath,
            ).toBe(`资源/图片/${subject}/2026/08/${sha256}.jpg`);
        },
    );

    test("preserves the established output and final newline without bodyEvidence", () => {
        const note = buildGaokaoNote({
            templateId: "math_problem",
            gaokaoId: idFor("math_problem"),
            title: "无图片证据代表题",
            knowledgeIds: ["math-method-123e4567e89b"],
        });

        expect(note.content).toBe(
            [
                "---",
                'gaokao_id: "problem-math-123e4567e89b"',
                'entity_type: "problem_case"',
                'subject: "数学"',
                "knowledge_ids:",
                '  - "math-method-123e4567e89b"',
                'difficulty: "medium"',
                'status: "active"',
                "tags:",
                '  - "review"',
                "---",
                "",
                "# 无图片证据代表题",
                "",
                "## 题面",
                "",
                "## 我的首次思路",
                "",
                "## 关键转折",
                "",
                "## 标准解法",
                "",
                "## 主要错因",
                "",
                "## 为什么错",
                "",
                "## 下次识别信号",
                "",
                "## 关联知识点",
                "",
                "## 再验证",
                "",
            ].join("\n"),
        );
        expect(note.content).not.toContain("![[");
        expect(note.content).not.toContain("SHA-256:");
        expect(note.content.endsWith("\n")).toBe(true);
    });

    test.each([
        ["math_problem", "数学", mathPath, "## 题面"],
        ["biology_problem_answer", "生物", biologyPath, "## 题目要点"],
    ] as const)(
        "adds one controlled body-only evidence block for %s",
        (templateId, subject, attachmentPath, firstSection) => {
            const withoutEvidence = buildGaokaoNote({
                templateId,
                gaokaoId: idFor(templateId),
                title: `${subject}图片问题`,
                knowledgeIds: [`${subject === "数学" ? "math" : "biology"}-knowledge-001`],
            });
            const withEvidence = buildGaokaoNote({
                templateId,
                gaokaoId: idFor(templateId),
                title: `${subject}图片问题`,
                knowledgeIds: [`${subject === "数学" ? "math" : "biology"}-knowledge-001`],
                bodyEvidence: createGaokaoImageBodyEvidence(attachmentPath, sha256),
            });

            expect(withEvidence.frontmatter).toEqual(withoutEvidence.frontmatter);
            expect(withEvidence.frontmatter).not.toHaveProperty("evidence_assets");
            expect(withEvidence.frontmatter).not.toHaveProperty("primary_knowledge_id");
            expect(withEvidence.content.match(/!\[\[/g)).toHaveLength(1);
            expect(withEvidence.content.match(/^SHA-256: [a-f0-9]{64}$/gm)).toHaveLength(1);
            expect(withEvidence.content.indexOf(`# ${subject}图片问题`)).toBeLessThan(
                withEvidence.content.indexOf(`![[${attachmentPath}]]`),
            );
            expect(withEvidence.content.indexOf(`![[${attachmentPath}]]`)).toBeLessThan(
                withEvidence.content.indexOf(firstSection),
            );
            expect(withEvidence.content.endsWith("\n")).toBe(true);
        },
    );

    test("rejects evidence on a knowledge_point template", () => {
        expect(() =>
            buildGaokaoNote({
                templateId: "math_concept",
                gaokaoId: idFor("math_concept"),
                title: "不允许图片正文扩展",
                bodyEvidence: createGaokaoImageBodyEvidence(mathPath, sha256),
            }),
        ).toThrow(/仅允许用于 problem_case/);
    });

    test.each(["A".repeat(64), "a".repeat(63), "a".repeat(65), `${"a".repeat(63)}g`])(
        "rejects malformed hash %s",
        (hash) => {
            expect(() => createGaokaoImageBodyEvidence(mathPath, hash)).toThrow(/SHA-256/);
        },
    );

    test.each([
        `/资源/图片/数学/2026/08/${sha256}.jpg`,
        `资源/图片/数学/../08/${sha256}.jpg`,
        `资源\\图片\\数学\\2026\\08\\${sha256}.jpg`,
        `资源/图片/数学/2026/08/${sha256}.jpg\n注入`,
        `资源/图片/数学/2026/08/[${sha256}].jpg`,
        `资源/图片/数学/2026/08/${sha256}.jpg#片段`,
        `资源/图片/数学/2026/08/${sha256}.jpg|别名`,
        `资源/图片/数学/2026/08/${sha256}:jpg`,
        `附件/数学/2026/08/${sha256}.jpg`,
        `资源/图片/历史/2026/08/${sha256}.jpg`,
    ])("rejects unsafe or unsupported evidence path %s", (attachmentPath) => {
        expect(() => createGaokaoImageBodyEvidence(attachmentPath, sha256)).toThrow();
    });

    test("rejects a path whose filename hash differs from the supplied hash", () => {
        const mismatchedPath = `资源/图片/数学/2026/08/${"b".repeat(64)}.jpg`;
        expect(() => createGaokaoImageBodyEvidence(mismatchedPath, sha256)).toThrow(/不一致/);
    });
});
