import {
    GaokaoEntity,
    GaokaoSchemaValidation,
    GaokaoValidationIssue,
    isGaokaoSchemaAttempt,
    isValidGaokaoId,
    validateGaokaoFrontmatter,
} from "src/gaokao/schema";

export interface GaokaoEntitySource {
    path: string;
    frontmatter: unknown;
}

export type GaokaoEntityInspectionStatus = "ordinary" | "invalid" | "duplicate" | "valid";

export interface GaokaoEntityInspection {
    path: string;
    status: GaokaoEntityInspectionStatus;
    entity?: GaokaoEntity;
    issues: GaokaoValidationIssue[];
}

function duplicateIssue(id: string, paths: string[]): GaokaoValidationIssue {
    return {
        code: "duplicate_gaokao_id",
        message: `gaokao_id ${id} is duplicated in: ${paths.join(", ")}`,
        severity: "error",
    };
}

function referenceIssue(code: string, message: string): GaokaoValidationIssue {
    return { code, message, severity: "warning" };
}

function getKnowledgeIds(entity: GaokaoEntity): string[] {
    return entity.entity_type === "problem_case" || entity.entity_type === "resource_unit"
        ? (entity.knowledge_ids ?? [])
        : [];
}

export class GaokaoEntityRegistry {
    private readonly sources = new Map<string, unknown>();
    private readonly inspections = new Map<string, GaokaoEntityInspection>();
    private readonly entitiesById = new Map<string, { path: string; entity: GaokaoEntity }>();
    private readonly duplicatePathsById = new Map<string, string[]>();
    private readonly candidatePathsById = new Map<string, string[]>();

    rebuild(sources: GaokaoEntitySource[]): void {
        this.sources.clear();
        for (const source of sources) {
            if (isGaokaoSchemaAttempt(source.frontmatter)) {
                this.sources.set(source.path, source.frontmatter);
            }
        }
        this.reindex();
    }

    upsert(path: string, frontmatter: unknown): void {
        if (isGaokaoSchemaAttempt(frontmatter)) {
            this.sources.set(path, frontmatter);
        } else {
            this.sources.delete(path);
        }
        this.reindex();
    }

    remove(path: string): void {
        if (this.sources.delete(path)) this.reindex();
    }

    rename(oldPath: string, newPath: string): void {
        if (!this.sources.has(oldPath)) return;
        const frontmatter = this.sources.get(oldPath);
        this.sources.delete(oldPath);
        this.sources.set(newPath, frontmatter);
        this.reindex();
    }

    inspect(path: string): GaokaoEntityInspection {
        return (
            this.inspections.get(path) ?? {
                path,
                status: "ordinary",
                issues: [],
            }
        );
    }

    getEntityById(id: string): { path: string; entity: GaokaoEntity } | undefined {
        return this.entitiesById.get(id);
    }

    getDuplicatePaths(id: string): string[] {
        return [...(this.duplicatePathsById.get(id) ?? [])];
    }

    getCandidatePaths(id: string): string[] {
        return [...(this.candidatePathsById.get(id) ?? [])];
    }

    getKnowledgePoints(): {
        path: string;
        entity: GaokaoEntity & { entity_type: "knowledge_point" };
    }[] {
        return [...this.entitiesById.values()]
            .filter(
                (
                    item,
                ): item is {
                    path: string;
                    entity: GaokaoEntity & { entity_type: "knowledge_point" };
                } => item.entity.entity_type === "knowledge_point",
            )
            .sort((left, right) => left.path.localeCompare(right.path, "zh-CN"));
    }

    getEntities(): { path: string; entity: GaokaoEntity }[] {
        return [...this.entitiesById.values()]
            .map(({ path, entity }) => ({ path, entity }))
            .sort((left, right) =>
                left.entity.gaokao_id.localeCompare(right.entity.gaokao_id, "en"),
            );
    }

    getAllInspections(): GaokaoEntityInspection[] {
        return [...this.inspections.values()];
    }

    private reindex(): void {
        this.inspections.clear();
        this.entitiesById.clear();
        this.duplicatePathsById.clear();
        this.candidatePathsById.clear();

        const validations = new Map<string, GaokaoSchemaValidation>();
        const pathsByCandidateId = new Map<string, string[]>();

        for (const [path, frontmatter] of this.sources) {
            const validation = validateGaokaoFrontmatter(frontmatter);
            validations.set(path, validation);
            const candidateId =
                validation.kind === "valid"
                    ? validation.entity.gaokao_id
                    : validation.kind === "invalid"
                      ? validation.candidateId
                      : undefined;
            if (isValidGaokaoId(candidateId)) {
                const paths = pathsByCandidateId.get(candidateId) ?? [];
                paths.push(path);
                pathsByCandidateId.set(candidateId, paths);
            }
        }

        for (const [id, paths] of pathsByCandidateId) {
            this.candidatePathsById.set(id, [...paths].sort());
            if (paths.length > 1) this.duplicatePathsById.set(id, [...paths].sort());
        }

        for (const [path, validation] of validations) {
            if (validation.kind === "ordinary") continue;
            if (validation.kind === "invalid") {
                const duplicatePaths = validation.candidateId
                    ? this.duplicatePathsById.get(validation.candidateId)
                    : undefined;
                this.inspections.set(path, {
                    path,
                    status: "invalid",
                    issues: [
                        ...validation.issues,
                        ...(duplicatePaths
                            ? [duplicateIssue(validation.candidateId, duplicatePaths)]
                            : []),
                    ],
                });
                continue;
            }

            const duplicatePaths = this.duplicatePathsById.get(validation.entity.gaokao_id);
            if (duplicatePaths) {
                this.inspections.set(path, {
                    path,
                    status: "duplicate",
                    entity: validation.entity,
                    issues: [duplicateIssue(validation.entity.gaokao_id, duplicatePaths)],
                });
                continue;
            }

            this.entitiesById.set(validation.entity.gaokao_id, {
                path,
                entity: validation.entity,
            });
            this.inspections.set(path, {
                path,
                status: "valid",
                entity: validation.entity,
                issues: [],
            });
        }

        for (const inspection of this.inspections.values()) {
            if (inspection.status !== "valid" || !inspection.entity) continue;
            for (const knowledgeId of getKnowledgeIds(inspection.entity)) {
                const target = this.entitiesById.get(knowledgeId);
                if (this.duplicatePathsById.has(knowledgeId)) {
                    inspection.issues.push(
                        referenceIssue(
                            "ambiguous_knowledge_id",
                            `knowledge_id ${knowledgeId} resolves to duplicate entities.`,
                        ),
                    );
                } else if (!target) {
                    inspection.issues.push(
                        referenceIssue(
                            "unresolved_knowledge_id",
                            `knowledge_id ${knowledgeId} is not currently resolved.`,
                        ),
                    );
                } else if (target.entity.entity_type !== "knowledge_point") {
                    inspection.issues.push(
                        referenceIssue(
                            "invalid_knowledge_reference_type",
                            `knowledge_id ${knowledgeId} does not reference a knowledge_point.`,
                        ),
                    );
                }
            }
        }
    }
}
