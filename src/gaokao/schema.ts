/* eslint-disable camelcase -- Persisted GAOKAO/YAML field names are snake_case by contract. */

export const GAOKAO_ENTITY_TYPES = ["knowledge_point", "problem_case", "resource_unit"] as const;
export type GaokaoEntityType = (typeof GAOKAO_ENTITY_TYPES)[number];

export const GAOKAO_SUBJECTS = ["语文", "数学", "英语", "物理", "化学", "生物"] as const;
export type GaokaoSubject = (typeof GAOKAO_SUBJECTS)[number];

export const GAOKAO_WORKFLOW_KINDS = [
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
export type GaokaoWorkflowKind = (typeof GAOKAO_WORKFLOW_KINDS)[number];

export interface GaokaoWorkflowKindDefinition {
    subject: Extract<GaokaoSubject, "化学" | "生物" | "英语" | "语文">;
    entityType: Extract<GaokaoEntityType, "knowledge_point" | "problem_case">;
}

export const GAOKAO_WORKFLOW_KIND_DEFINITIONS: Readonly<
    Record<GaokaoWorkflowKind, GaokaoWorkflowKindDefinition>
> = Object.freeze({
    chemistry_knowledge: { subject: "化学", entityType: "knowledge_point" },
    chemistry_reaction_experiment: { subject: "化学", entityType: "knowledge_point" },
    chemistry_problem_error: { subject: "化学", entityType: "problem_case" },
    biology_concept_mechanism: { subject: "生物", entityType: "knowledge_point" },
    biology_experiment_figure: { subject: "生物", entityType: "knowledge_point" },
    biology_problem_answer: { subject: "生物", entityType: "problem_case" },
    english_reading_error: { subject: "英语", entityType: "problem_case" },
    english_grammar_writing_expression: { subject: "英语", entityType: "knowledge_point" },
    english_manual_aim_signal: { subject: "英语", entityType: "knowledge_point" },
    chinese_reading_language: { subject: "语文", entityType: "knowledge_point" },
    chinese_method_answer: { subject: "语文", entityType: "knowledge_point" },
    chinese_essay_material: { subject: "语文", entityType: "knowledge_point" },
    chinese_error: { subject: "语文", entityType: "problem_case" },
});

export const GAOKAO_STATUSES = ["active", "paused", "mastered", "archived"] as const;
export type GaokaoStatus = (typeof GAOKAO_STATUSES)[number];

export const KNOWLEDGE_TYPES = ["memory", "method", "transfer"] as const;
export type KnowledgeType = (typeof KNOWLEDGE_TYPES)[number];

export const PROBLEM_DIFFICULTIES = ["easy", "medium", "hard"] as const;
export type ProblemDifficulty = (typeof PROBLEM_DIFFICULTIES)[number];

export const RESOURCE_STATUSES = ["unstarted", "in_progress", "completed", "verified"] as const;
export type ResourceStatus = (typeof RESOURCE_STATUSES)[number];

export const GAOKAO_ID_PATTERN = /^[a-z0-9][a-z0-9._-]*$/;

export type ValidationSeverity = "error" | "warning";

export interface GaokaoValidationIssue {
    code: string;
    message: string;
    severity: ValidationSeverity;
}

interface GaokaoEntityBase {
    gaokao_id: string;
    entity_type: GaokaoEntityType;
    subject: GaokaoSubject;
    workflow_kind?: GaokaoWorkflowKind;
    status?: GaokaoStatus;
}

export interface KnowledgePointEntity extends GaokaoEntityBase {
    entity_type: "knowledge_point";
    chapter?: string;
    knowledge_type?: KnowledgeType;
    priority_tier?: 1 | 2 | 3;
}

export interface ProblemCaseEntity extends GaokaoEntityBase {
    entity_type: "problem_case";
    knowledge_ids?: string[];
    source?: string;
    difficulty?: ProblemDifficulty;
}

export interface ResourceUnitEntity extends GaokaoEntityBase {
    entity_type: "resource_unit";
    knowledge_ids?: string[];
    resource_url?: string;
    resource_status?: ResourceStatus;
}

export type GaokaoEntity = KnowledgePointEntity | ProblemCaseEntity | ResourceUnitEntity;

export interface OrdinaryNoteValidation {
    kind: "ordinary";
    issues: [];
}

export interface InvalidGaokaoValidation {
    kind: "invalid";
    candidateId?: string;
    issues: GaokaoValidationIssue[];
}

export interface ValidGaokaoValidation {
    kind: "valid";
    entity: GaokaoEntity;
    issues: GaokaoValidationIssue[];
}

export type GaokaoSchemaValidation =
    | OrdinaryNoteValidation
    | InvalidGaokaoValidation
    | ValidGaokaoValidation;

const GAOKAO_SENTINEL_FIELDS = [
    "gaokao_id",
    "entity_type",
    "workflow_kind",
    "knowledge_type",
    "priority_tier",
    "knowledge_ids",
    "difficulty",
    "resource_url",
    "resource_status",
] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasOwn(record: Record<string, unknown>, key: string): boolean {
    return Boolean(Object.prototype.hasOwnProperty.call(record, key));
}

function isOneOf<T extends string>(value: unknown, allowed: readonly T[]): value is T {
    return typeof value === "string" && allowed.includes(value as T);
}

function addIssue(issues: GaokaoValidationIssue[], code: string, message: string): void {
    issues.push({ code, message, severity: "error" });
}

function validateOptionalNonEmptyString(
    frontmatter: Record<string, unknown>,
    field: string,
    issues: GaokaoValidationIssue[],
): string | undefined {
    if (!hasOwn(frontmatter, field)) return undefined;
    const value = frontmatter[field];
    if (typeof value !== "string" || value.trim().length === 0) {
        addIssue(issues, `invalid_${field}`, `${field} must be a non-empty string.`);
        return undefined;
    }
    return value;
}

function validateKnowledgeIds(
    frontmatter: Record<string, unknown>,
    issues: GaokaoValidationIssue[],
): string[] | undefined {
    if (!hasOwn(frontmatter, "knowledge_ids")) return undefined;
    const value = frontmatter.knowledge_ids;
    if (!Array.isArray(value)) {
        addIssue(issues, "malformed_knowledge_ids", "knowledge_ids must be a YAML list.");
        return undefined;
    }

    const result: string[] = [];
    for (const item of value) {
        if (typeof item !== "string" || !isValidGaokaoId(item)) {
            addIssue(
                issues,
                "invalid_knowledge_id",
                "Every knowledge_ids item must follow the gaokao_id format.",
            );
            return undefined;
        }
        result.push(item);
    }
    return result;
}

export function isValidGaokaoId(value: unknown): value is string {
    return typeof value === "string" && GAOKAO_ID_PATTERN.test(value);
}

export function isGaokaoSchemaAttempt(frontmatter: unknown): boolean {
    if (!isRecord(frontmatter)) return false;
    return GAOKAO_SENTINEL_FIELDS.some((field) => hasOwn(frontmatter, field));
}

export function validateGaokaoFrontmatter(frontmatter: unknown): GaokaoSchemaValidation {
    if (!isRecord(frontmatter) || !isGaokaoSchemaAttempt(frontmatter)) {
        return { kind: "ordinary", issues: [] };
    }

    const issues: GaokaoValidationIssue[] = [];
    const candidateId =
        typeof frontmatter.gaokao_id === "string" ? frontmatter.gaokao_id : undefined;

    if (!hasOwn(frontmatter, "gaokao_id")) {
        addIssue(issues, "missing_gaokao_id", "gaokao_id is required.");
    } else if (!isValidGaokaoId(frontmatter.gaokao_id)) {
        addIssue(issues, "invalid_gaokao_id", "gaokao_id must match [a-z0-9][a-z0-9._-]* exactly.");
    }

    let entityType: GaokaoEntityType | undefined;
    if (!hasOwn(frontmatter, "entity_type")) {
        addIssue(issues, "missing_entity_type", "entity_type is required.");
    } else if (!isOneOf(frontmatter.entity_type, GAOKAO_ENTITY_TYPES)) {
        addIssue(issues, "unsupported_entity_type", "entity_type is not supported by Task 004.");
    } else {
        entityType = frontmatter.entity_type;
    }

    let subject: GaokaoSubject | undefined;
    if (!hasOwn(frontmatter, "subject")) {
        addIssue(issues, "missing_subject", "subject is required.");
    } else if (!isOneOf(frontmatter.subject, GAOKAO_SUBJECTS)) {
        addIssue(
            issues,
            "unsupported_subject",
            "subject must be one of the six supported subjects.",
        );
    } else {
        subject = frontmatter.subject;
    }

    let status: GaokaoStatus | undefined;
    if (hasOwn(frontmatter, "status")) {
        if (!isOneOf(frontmatter.status, GAOKAO_STATUSES)) {
            addIssue(issues, "invalid_status", "status is not supported.");
        } else {
            status = frontmatter.status;
        }
    }

    let workflowKind: GaokaoWorkflowKind | undefined;
    if (hasOwn(frontmatter, "workflow_kind")) {
        if (!isOneOf(frontmatter.workflow_kind, GAOKAO_WORKFLOW_KINDS)) {
            addIssue(issues, "invalid_workflow_kind", "workflow_kind is not supported.");
        } else {
            workflowKind = frontmatter.workflow_kind;
            const definition = GAOKAO_WORKFLOW_KIND_DEFINITIONS[workflowKind];
            if (subject !== undefined && definition.subject !== subject) {
                addIssue(
                    issues,
                    "workflow_kind_subject_mismatch",
                    "workflow_kind does not match the authoritative subject.",
                );
            }
            if (entityType !== undefined && definition.entityType !== entityType) {
                addIssue(
                    issues,
                    "workflow_kind_entity_type_mismatch",
                    "workflow_kind does not match the authoritative entity_type.",
                );
            }
        }
    }

    let entitySpecificFields: Partial<GaokaoEntity> = {};
    if (entityType === "knowledge_point") {
        const chapter = validateOptionalNonEmptyString(frontmatter, "chapter", issues);
        let knowledgeType: KnowledgeType | undefined;
        if (hasOwn(frontmatter, "knowledge_type")) {
            if (!isOneOf(frontmatter.knowledge_type, KNOWLEDGE_TYPES)) {
                addIssue(issues, "invalid_knowledge_type", "knowledge_type is not supported.");
            } else {
                knowledgeType = frontmatter.knowledge_type;
            }
        }

        let priorityTier: 1 | 2 | 3 | undefined;
        if (hasOwn(frontmatter, "priority_tier")) {
            const value = frontmatter.priority_tier;
            if (value !== 1 && value !== 2 && value !== 3) {
                addIssue(issues, "invalid_priority_tier", "priority_tier must be 1, 2, or 3.");
            } else {
                priorityTier = value;
            }
        }
        entitySpecificFields = {
            ...(chapter === undefined ? {} : { chapter }),
            ...(knowledgeType === undefined ? {} : { knowledge_type: knowledgeType }),
            ...(priorityTier === undefined ? {} : { priority_tier: priorityTier }),
        };
    } else if (entityType === "problem_case") {
        const knowledgeIds = validateKnowledgeIds(frontmatter, issues);
        const source = validateOptionalNonEmptyString(frontmatter, "source", issues);
        let difficulty: ProblemDifficulty | undefined;
        if (hasOwn(frontmatter, "difficulty")) {
            if (!isOneOf(frontmatter.difficulty, PROBLEM_DIFFICULTIES)) {
                addIssue(issues, "invalid_difficulty", "difficulty is not supported.");
            } else {
                difficulty = frontmatter.difficulty;
            }
        }
        entitySpecificFields = {
            ...(knowledgeIds === undefined ? {} : { knowledge_ids: knowledgeIds }),
            ...(source === undefined ? {} : { source }),
            ...(difficulty === undefined ? {} : { difficulty }),
        };
    } else if (entityType === "resource_unit") {
        const knowledgeIds = validateKnowledgeIds(frontmatter, issues);
        const resourceUrl = validateOptionalNonEmptyString(frontmatter, "resource_url", issues);
        let resourceStatus: ResourceStatus | undefined;
        if (hasOwn(frontmatter, "resource_status")) {
            if (!isOneOf(frontmatter.resource_status, RESOURCE_STATUSES)) {
                addIssue(issues, "invalid_resource_status", "resource_status is not supported.");
            } else {
                resourceStatus = frontmatter.resource_status;
            }
        }
        entitySpecificFields = {
            ...(knowledgeIds === undefined ? {} : { knowledge_ids: knowledgeIds }),
            ...(resourceUrl === undefined ? {} : { resource_url: resourceUrl }),
            ...(resourceStatus === undefined ? {} : { resource_status: resourceStatus }),
        };
    }

    if (issues.some((issue) => issue.severity === "error")) {
        return { kind: "invalid", ...(candidateId === undefined ? {} : { candidateId }), issues };
    }

    if (candidateId === undefined || entityType === undefined || subject === undefined) {
        return {
            kind: "invalid",
            ...(candidateId === undefined ? {} : { candidateId }),
            issues: [
                ...issues,
                {
                    code: "invalid_entity_state",
                    message: "Required entity fields could not be normalized.",
                    severity: "error",
                },
            ],
        };
    }

    const entity = {
        gaokao_id: candidateId,
        entity_type: entityType,
        subject,
        ...(workflowKind === undefined ? {} : { workflow_kind: workflowKind }),
        ...(status === undefined ? {} : { status }),
        ...entitySpecificFields,
    };
    return { kind: "valid", entity, issues };
}
