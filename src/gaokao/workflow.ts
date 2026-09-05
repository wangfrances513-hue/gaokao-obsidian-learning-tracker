/* eslint-disable camelcase -- Generated GAOKAO/YAML field names are snake_case by contract. */

import {
    GAOKAO_SUBJECTS,
    GaokaoEntity,
    GaokaoSubject,
    GaokaoWorkflowKind,
    isValidGaokaoId,
    KnowledgeType,
    validateGaokaoFrontmatter,
} from "src/gaokao/schema";

export const GAOKAO_NOTE_TEMPLATE_IDS = [
    "math_concept",
    "math_method",
    "math_problem",
    "physics_model",
    "physics_problem",
    "chemistry_knowledge",
    "chemistry_reaction_experiment",
    "chemistry_problem_error",
    "biology_concept_mechanism",
    "biology_experiment_figure",
    "biology_problem_answer",
    "english_reading_error",
    "english_grammar_writing_expression",
    "english_manual_aim_signal",
    "chinese_reading_language",
    "chinese_method_answer",
    "chinese_essay_material",
    "chinese_error",
] as const;
export type GaokaoNoteTemplateId = (typeof GAOKAO_NOTE_TEMPLATE_IDS)[number];

export interface GaokaoNoteTemplateDefinition {
    id: GaokaoNoteTemplateId;
    label: string;
    subject: GaokaoSubject;
    entityType: "knowledge_point" | "problem_case";
    workflowKind?: GaokaoWorkflowKind;
    knowledgeType?: KnowledgeType;
    defaultFolder: string;
    idPrefix: string;
    bodySections: readonly string[];
}

export const GAOKAO_NOTE_TEMPLATES: readonly GaokaoNoteTemplateDefinition[] = [
    {
        id: "math_concept",
        label: "数学｜知识 / 概念",
        subject: "数学",
        entityType: "knowledge_point",
        knowledgeType: "memory",
        defaultFolder: "数学/知识点",
        idPrefix: "math-knowledge",
        bodySections: [
            "核心结论",
            "适用条件",
            "易错边界",
            "三秒识别",
            "当前问题",
            "关联代表题",
            "学习资源",
        ],
    },
    {
        id: "math_method",
        label: "数学｜方法 / 模型",
        subject: "数学",
        entityType: "knowledge_point",
        knowledgeType: "method",
        defaultFolder: "数学/方法模型",
        idPrefix: "math-method",
        bodySections: [
            "识别信号",
            "标准方法",
            "决策顺序",
            "分类讨论节点",
            "易错点",
            "当前卡点",
            "代表题",
            "变式验证",
        ],
    },
    {
        id: "math_problem",
        label: "数学｜代表题",
        subject: "数学",
        entityType: "problem_case",
        defaultFolder: "数学/代表题",
        idPrefix: "problem-math",
        bodySections: [
            "题面",
            "我的首次思路",
            "关键转折",
            "标准解法",
            "主要错因",
            "为什么错",
            "下次识别信号",
            "关联知识点",
            "再验证",
        ],
    },
    {
        id: "physics_model",
        label: "物理｜模型 / 知识点",
        subject: "物理",
        entityType: "knowledge_point",
        knowledgeType: "method",
        defaultFolder: "物理/模型",
        idPrefix: "physics-model",
        bodySections: [
            "识别信号",
            "研究对象",
            "过程划分",
            "初始状态",
            "受力与方向",
            "使用规律",
            "约束条件",
            "临界条件",
            "常见变式",
            "易错点",
            "当前卡点",
            "代表题",
        ],
    },
    {
        id: "physics_problem",
        label: "物理｜代表题",
        subject: "物理",
        entityType: "problem_case",
        defaultFolder: "物理/代表题",
        idPrefix: "problem-physics",
        bodySections: ["题面", "关键模型与步骤", "当前卡点与下次识别信号", "再验证"],
    },
    {
        id: "chemistry_knowledge",
        label: "化学｜知识",
        subject: "化学",
        entityType: "knowledge_point",
        workflowKind: "chemistry_knowledge",
        knowledgeType: "memory",
        defaultFolder: "化学/知识",
        idPrefix: "chemistry-knowledge",
        bodySections: ["核心知识", "适用条件", "关联现象", "易错边界", "闭卷提取"],
    },
    {
        id: "chemistry_reaction_experiment",
        label: "化学｜反应 / 实验",
        subject: "化学",
        entityType: "knowledge_point",
        workflowKind: "chemistry_reaction_experiment",
        knowledgeType: "method",
        defaultFolder: "化学/反应与实验",
        idPrefix: "chemistry-reaction-experiment",
        bodySections: [
            "反应或实验目标",
            "条件与装置",
            "现象",
            "方程或步骤",
            "结论",
            "风险与误差",
            "再验证",
        ],
    },
    {
        id: "chemistry_problem_error",
        label: "化学｜问题 / 错题",
        subject: "化学",
        entityType: "problem_case",
        workflowKind: "chemistry_problem_error",
        defaultFolder: "化学/问题与错题",
        idPrefix: "problem-chemistry",
        bodySections: [
            "题面摘要",
            "我的思路",
            "关键反应或方法",
            "错因",
            "正确过程",
            "下次识别信号",
            "再验证",
        ],
    },
    {
        id: "biology_concept_mechanism",
        label: "生物｜概念 / 机制",
        subject: "生物",
        entityType: "knowledge_point",
        workflowKind: "biology_concept_mechanism",
        knowledgeType: "memory",
        defaultFolder: "生物/概念与机制",
        idPrefix: "biology-concept-mechanism",
        bodySections: ["核心概念", "机制链", "条件与边界", "图示", "易混点", "闭卷提取"],
    },
    {
        id: "biology_experiment_figure",
        label: "生物｜实验 / 图表",
        subject: "生物",
        entityType: "knowledge_point",
        workflowKind: "biology_experiment_figure",
        knowledgeType: "method",
        defaultFolder: "生物/实验与图表",
        idPrefix: "biology-experiment-figure",
        bodySections: [
            "实验或图表",
            "自变量与因变量",
            "对照与控制",
            "结果",
            "解释",
            "误差",
            "再验证",
        ],
    },
    {
        id: "biology_problem_answer",
        label: "生物｜问题 / 答案",
        subject: "生物",
        entityType: "problem_case",
        workflowKind: "biology_problem_answer",
        defaultFolder: "生物/问题与答案",
        idPrefix: "problem-biology",
        bodySections: ["题目要点", "证据", "答案结构", "我的错误", "标准表达", "再验证"],
    },
    {
        id: "english_reading_error",
        label: "英语｜阅读 / 错题",
        subject: "英语",
        entityType: "problem_case",
        workflowKind: "english_reading_error",
        defaultFolder: "英语/阅读与错题",
        idPrefix: "problem-english-reading",
        bodySections: ["文本或题目", "定位依据", "我的理解", "错因", "正确答案与证据", "再验证"],
    },
    {
        id: "english_grammar_writing_expression",
        label: "英语｜语法 / 写作 / 表达",
        subject: "英语",
        entityType: "knowledge_point",
        workflowKind: "english_grammar_writing_expression",
        knowledgeType: "method",
        defaultFolder: "英语/语法写作表达",
        idPrefix: "english-expression",
        bodySections: ["规则或表达", "适用语境", "正例", "反例", "我的输出", "修订", "闭卷提取"],
    },
    {
        id: "english_manual_aim_signal",
        label: "英语｜单项手动 AIM 信号（可选）",
        subject: "英语",
        entityType: "knowledge_point",
        workflowKind: "english_manual_aim_signal",
        knowledgeType: "memory",
        defaultFolder: "英语/AIM 单项信号",
        idPrefix: "english-aim-signal",
        bodySections: ["手动信号来源", "需要掌握的单项信号", "语境", "我的表达", "再验证"],
    },
    {
        id: "chinese_reading_language",
        label: "语文｜阅读 / 语言",
        subject: "语文",
        entityType: "knowledge_point",
        workflowKind: "chinese_reading_language",
        knowledgeType: "memory",
        defaultFolder: "语文/阅读与语言",
        idPrefix: "chinese-reading-language",
        bodySections: ["文本或语料", "关键信息", "理解与依据", "语言现象", "易错点", "闭卷提取"],
    },
    {
        id: "chinese_method_answer",
        label: "语文｜方法 / 答案",
        subject: "语文",
        entityType: "knowledge_point",
        workflowKind: "chinese_method_answer",
        knowledgeType: "method",
        defaultFolder: "语文/方法与答案",
        idPrefix: "chinese-method-answer",
        bodySections: [
            "题型与要求",
            "识别信号",
            "答题方法",
            "答案结构",
            "我的答案",
            "修订",
            "再验证",
        ],
    },
    {
        id: "chinese_essay_material",
        label: "语文｜作文素材",
        subject: "语文",
        entityType: "knowledge_point",
        workflowKind: "chinese_essay_material",
        knowledgeType: "transfer",
        defaultFolder: "语文/作文素材",
        idPrefix: "chinese-essay-material",
        bodySections: ["素材", "核心立意", "适用主题", "使用边界", "一句话转化", "闭卷提取"],
    },
    {
        id: "chinese_error",
        label: "语文｜错题",
        subject: "语文",
        entityType: "problem_case",
        workflowKind: "chinese_error",
        defaultFolder: "语文/错题",
        idPrefix: "problem-chinese",
        bodySections: [
            "题目摘要",
            "我的答案",
            "错因",
            "正确依据",
            "正确答案",
            "下次识别信号",
            "再验证",
        ],
    },
] as const;

export interface GaokaoTemplateInput {
    templateId: GaokaoNoteTemplateId;
    gaokaoId: string;
    title: string;
    folder?: string;
    chapter?: string;
    source?: string;
    difficulty?: "easy" | "medium" | "hard";
    knowledgeIds?: string[];
    reviewTag?: string;
    existingFrontmatter?: Record<string, unknown>;
    bodyEvidence?: GaokaoImageBodyEvidence;
}

export interface GaokaoImageBodyEvidence {
    readonly attachmentPath: string;
    readonly sha256: string;
}

export interface GeneratedGaokaoNote {
    path: string;
    frontmatter: Record<string, unknown>;
    entity: GaokaoEntity;
    content: string;
}

function getTemplate(templateId: GaokaoNoteTemplateId): GaokaoNoteTemplateDefinition {
    const template = GAOKAO_NOTE_TEMPLATES.find((candidate) => candidate.id === templateId);
    if (!template) throw new Error("不支持的 GAOKAO 模板类型。");
    return template;
}

function trimOptional(value: string | undefined): string | undefined {
    const trimmed = value?.trim();
    return trimmed && trimmed.length > 0 ? trimmed : undefined;
}

export function normalizeReviewTag(value: string | undefined): string {
    const normalized = (trimOptional(value) ?? "review").replace(/^#+/, "");
    if (normalized.length === 0 || /[\s,]/.test(normalized)) {
        throw new Error("复习标签必须是单个非空标签。");
    }
    return normalized;
}

export function validateGaokaoNoteTitle(value: string): string {
    const title = value.trim();
    if (title.length === 0) throw new Error("请输入笔记标题。");
    if (title === "." || title === ".." || /[/\\:\n\r]/.test(title)) {
        throw new Error("标题不能包含路径分隔符、冒号或换行。");
    }
    return title;
}

export function validateVaultFolder(value: string | undefined, fallback: string): string {
    const folder = (trimOptional(value) ?? fallback).replace(/\/{2,}/g, "/");
    if (folder.startsWith("/") || folder.endsWith("/") || folder.includes("\\")) {
        throw new Error("文件夹必须是 Vault 内的相对路径。");
    }
    const segments = folder.split("/");
    if (
        segments.some(
            (segment) =>
                segment.length === 0 ||
                segment === "." ||
                segment === ".." ||
                /[:\n\r]/.test(segment),
        )
    ) {
        throw new Error("文件夹路径包含不安全的片段。");
    }
    return folder;
}

export function generateGaokaoId(
    templateId: GaokaoNoteTemplateId,
    createRandomValue: () => string = () => crypto.randomUUID(),
): string {
    const suffix = createRandomValue()
        .toLowerCase()
        .replace(/[^a-z0-9]/g, "")
        .slice(0, 12);
    if (suffix.length < 8) throw new Error("无法生成稳定的 GAOKAO ID。");
    return `${getTemplate(templateId).idPrefix}-${suffix}`;
}

export function mergeGaokaoTemplateFrontmatter(
    existing: Record<string, unknown>,
    generated: Record<string, unknown>,
): Record<string, unknown> {
    for (const [key, value] of Object.entries(generated)) {
        if (
            Object.prototype.hasOwnProperty.call(existing, key) &&
            JSON.stringify(existing[key]) !== JSON.stringify(value)
        ) {
            throw new Error(`已有 YAML 字段 ${key} 与模板冲突；未覆盖原值。`);
        }
    }
    return { ...existing, ...generated };
}

function yamlScalar(value: string | number | boolean): string {
    return typeof value === "string" ? JSON.stringify(value) : String(value);
}

export function serializeFrontmatter(frontmatter: Record<string, unknown>): string {
    const lines: string[] = ["---"];
    for (const [key, value] of Object.entries(frontmatter)) {
        if (value === undefined) continue;
        if (Array.isArray(value)) {
            if (value.length === 0) {
                lines.push(`${key}: []`);
                continue;
            }
            lines.push(`${key}:`);
            for (const item of value) {
                if (typeof item !== "string" && typeof item !== "number") {
                    throw new Error(`YAML 字段 ${key} 包含不支持的值。`);
                }
                lines.push(`  - ${yamlScalar(item)}`);
            }
        } else if (
            typeof value === "string" ||
            typeof value === "number" ||
            typeof value === "boolean"
        ) {
            lines.push(`${key}: ${yamlScalar(value)}`);
        } else {
            throw new Error(`YAML 字段 ${key} 包含不支持的值。`);
        }
    }
    lines.push("---");
    return lines.join("\n");
}

function validateImageBodyEvidence(
    attachmentPath: string,
    sha256: string,
): GaokaoImageBodyEvidence {
    if (!/^[a-f0-9]{64}$/.test(sha256)) {
        throw new Error("图片证据 SHA-256 必须是 64 位小写十六进制字符串。");
    }
    if (
        attachmentPath.startsWith("/") ||
        attachmentPath.endsWith("/") ||
        attachmentPath.includes("\\") ||
        /[\n\r[\]#|:]/.test(attachmentPath)
    ) {
        throw new Error("图片证据嵌入路径不是安全的 Vault 相对路径。");
    }
    const segments = attachmentPath.split("/");
    if (
        segments.length !== 6 ||
        segments[0] !== "资源" ||
        segments[1] !== "图片" ||
        !GAOKAO_SUBJECTS.some((subject) => subject === segments[2]) ||
        !/^\d{4}$/.test(segments[3]) ||
        !/^(0[1-9]|1[0-2])$/.test(segments[4]) ||
        segments.some((segment) => segment.length === 0 || segment === "." || segment === "..")
    ) {
        throw new Error("图片证据嵌入路径不符合受管目录规范。");
    }
    const fileMatch = /^([a-f0-9]{64})\.(jpg|png)$/.exec(segments[5]);
    if (!fileMatch || fileMatch[1] !== sha256) {
        throw new Error("图片证据嵌入路径与完整 SHA-256 不一致。");
    }
    return Object.freeze({ attachmentPath, sha256 });
}

export function createGaokaoImageBodyEvidence(
    attachmentPath: string,
    sha256: string,
): GaokaoImageBodyEvidence {
    return validateImageBodyEvidence(attachmentPath, sha256);
}

export function buildGaokaoNote(input: GaokaoTemplateInput): GeneratedGaokaoNote {
    const template = getTemplate(input.templateId);
    const title = validateGaokaoNoteTitle(input.title);
    const folder = validateVaultFolder(input.folder, template.defaultFolder);
    if (!isValidGaokaoId(input.gaokaoId)) {
        throw new Error("gaokao_id 必须严格匹配 [a-z0-9][a-z0-9._-]*。");
    }

    const chapter = trimOptional(input.chapter);
    const source = trimOptional(input.source);
    const knowledgeIds = input.knowledgeIds ?? [];
    if (knowledgeIds.some((id) => !isValidGaokaoId(id))) {
        throw new Error("关联知识点包含无效的 gaokao_id。");
    }

    const generated: Record<string, unknown> = {
        gaokao_id: input.gaokaoId,
        entity_type: template.entityType,
        subject: template.subject,
        ...(template.workflowKind === undefined ? {} : { workflow_kind: template.workflowKind }),
        ...(template.entityType === "knowledge_point"
            ? {
                  ...(chapter === undefined ? {} : { chapter }),
                  knowledge_type: template.knowledgeType,
                  priority_tier: 1,
              }
            : {
                  knowledge_ids: [...knowledgeIds],
                  ...(source === undefined ? {} : { source }),
                  difficulty: input.difficulty ?? "medium",
              }),
        status: "active",
        tags: [normalizeReviewTag(input.reviewTag)],
    };
    const frontmatter = mergeGaokaoTemplateFrontmatter(input.existingFrontmatter ?? {}, generated);
    const validation = validateGaokaoFrontmatter(frontmatter);
    if (validation.kind !== "valid") {
        throw new Error(validation.issues.map((issue) => issue.message).join(" "));
    }

    const bodyParts = [`# ${title}`];
    if (input.bodyEvidence !== undefined) {
        if (template.entityType !== "problem_case") {
            throw new Error("图片证据正文扩展仅允许用于 problem_case 模板。");
        }
        const evidence = validateImageBodyEvidence(
            input.bodyEvidence.attachmentPath,
            input.bodyEvidence.sha256,
        );
        bodyParts.push(`![[${evidence.attachmentPath}]]`, `SHA-256: ${evidence.sha256}`);
    }
    for (const section of template.bodySections) {
        bodyParts.push(`## ${section}`);
        if (template.id === "physics_problem" && section === "关键模型与步骤") {
            bodyParts.push(
                "可选提示：研究对象、过程划分、初态与末态、受力、规律、方程链、临界条件与正确模型。",
            );
        }
        if (template.id === "physics_problem" && section === "当前卡点与下次识别信号") {
            bodyParts.push("可选提示：记录我的错误、当前卡点与下次识别信号。");
        }
    }
    const body = bodyParts.join("\n\n");
    return {
        path: `${folder}/${title}.md`,
        frontmatter,
        entity: validation.entity,
        content: `${serializeFrontmatter(frontmatter)}\n\n${body}\n`,
    };
}

export function isMathOrPhysicsSubject(
    subject: GaokaoSubject,
): subject is Extract<GaokaoSubject, "数学" | "物理"> {
    return subject === "数学" || subject === "物理";
}
