/* eslint-disable camelcase -- Tests exercise persisted GAOKAO and scheduler field names. */

import { runScheduledReviewWorkflow } from "src/gaokao/feedback";
import { createDefaultGaokaoPluginData, GaokaoManager } from "src/gaokao/gaokao-manager";
import { LearningEventType } from "src/gaokao/learning-event";
import {
    GAOKAO_SUBJECTS,
    GAOKAO_WORKFLOW_KIND_DEFINITIONS,
    GAOKAO_WORKFLOW_KINDS,
    GaokaoEntity,
    GaokaoSubject,
    validateGaokaoFrontmatter,
} from "src/gaokao/schema";
import { buildTodayPlan, TodayPlannerCandidate } from "src/gaokao/today-planner";
import {
    buildGaokaoNote,
    GAOKAO_NOTE_TEMPLATES,
    GaokaoNoteTemplateId,
    generateGaokaoId,
} from "src/gaokao/workflow";
import { ReviewResponse } from "src/scheduling/algorithms/base/repetition-item";

const DAY = 24 * 60 * 60 * 1000;
const TODAY = Date.UTC(2026, 7, 8);
const stableRandom = () => "123e4567-e89b-42d3-a456-426614174000";

const EXPECTED_TASK007_TEMPLATE_IDS = [
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

const SUBJECT_REPRESENTATIVES: readonly [GaokaoSubject, GaokaoNoteTemplateId][] = [
    ["化学", "chemistry_problem_error"],
    ["生物", "biology_concept_mechanism"],
    ["英语", "english_reading_error"],
    ["语文", "chinese_method_answer"],
];

function idFor(templateId: GaokaoNoteTemplateId, suffix = "001"): string {
    return `task007-${templateId}-${suffix}`;
}

function withoutWorkflowKind(entity: GaokaoEntity): GaokaoEntity {
    const result = { ...entity };
    delete result.workflow_kind;
    return result;
}

function createManagerHarness() {
    const data = createDefaultGaokaoPluginData();
    const persistedEventCounts: number[] = [];
    let sequence = 0;
    const eventFactory = {
        createId: () => `task007-event-${sequence++}`,
        now: () => new Date("2026-08-08T08:00:00.000Z"),
    };
    const createManager = () =>
        new GaokaoManager({
            getData: () => data,
            transact: async (operation) => await operation({ data, save: async (next) => {
                Object.assign(data, next); persistedEventCounts.push(data.learningEvents.length);
            } }),
            eventFactory,
        });
    return { createManager, data, persistedEventCounts };
}

describe("Task 007 centralized grouped workflow contract", () => {
    test("keeps one canonical six-subject vocabulary and one central workflow-kind mapping", () => {
        expect(GAOKAO_SUBJECTS).toEqual(["语文", "数学", "英语", "物理", "化学", "生物"]);
        expect(GAOKAO_WORKFLOW_KINDS).toEqual(EXPECTED_TASK007_TEMPLATE_IDS);

        const task007Templates = GAOKAO_NOTE_TEMPLATES.filter(
            (template) => template.workflowKind !== undefined,
        );
        expect(task007Templates.map((template) => template.id)).toEqual(
            EXPECTED_TASK007_TEMPLATE_IDS,
        );
        expect(new Set(GAOKAO_NOTE_TEMPLATES.map((template) => template.subject))).toEqual(
            new Set(GAOKAO_SUBJECTS),
        );

        for (const template of task007Templates) {
            if (template.workflowKind === undefined) throw new Error("Missing workflow kind.");
            expect(GAOKAO_WORKFLOW_KIND_DEFINITIONS[template.workflowKind]).toEqual({
                subject: template.subject,
                entityType: template.entityType,
            });
        }
    });

    test.each(EXPECTED_TASK007_TEMPLATE_IDS)(
        "creates title-only grouped workflow %s through the shared builder",
        (templateId) => {
            const template = GAOKAO_NOTE_TEMPLATES.find((candidate) => candidate.id === templateId);
            if (!template || template.workflowKind === undefined) {
                throw new Error(`Missing Task 007 template ${templateId}.`);
            }
            const note = buildGaokaoNote({
                templateId,
                gaokaoId: generateGaokaoId(templateId, stableRandom),
                title: `验证 ${templateId}`,
            });

            expect(note.path).toBe(`${template.defaultFolder}/验证 ${templateId}.md`);
            expect(note.frontmatter).toMatchObject({
                gaokao_id: note.entity.gaokao_id,
                entity_type: template.entityType,
                subject: template.subject,
                workflow_kind: template.workflowKind,
                status: "active",
                tags: ["review"],
            });
            expect(note.frontmatter).not.toHaveProperty("sr-due");
            expect(note.frontmatter).not.toHaveProperty("schedule");
            expect(note.frontmatter).not.toHaveProperty("due_date");
            expect(note.content).toContain(`# 验证 ${templateId}`);
            const sectionOffsets = template.bodySections.map((section) => {
                expect(note.content).toContain(`## ${section}`);
                return note.content.indexOf(`## ${section}`);
            });
            expect(sectionOffsets).toEqual([...sectionOffsets].sort((left, right) => left - right));
            expect(validateGaokaoFrontmatter(note.frontmatter)).toMatchObject({
                kind: "valid",
                entity: { workflow_kind: template.workflowKind },
            });
        },
    );

    test("keeps legacy entities valid and treats workflow_kind as consistency metadata only", () => {
        const legacy = {
            gaokao_id: "legacy-chemistry-note",
            entity_type: "knowledge_point",
            subject: "化学",
        };
        expect(validateGaokaoFrontmatter(legacy)).toMatchObject({ kind: "valid", entity: legacy });

        expect(
            validateGaokaoFrontmatter({ ...legacy, workflow_kind: "unsupported_kind" }).issues.map(
                (issue) => issue.code,
            ),
        ).toContain("invalid_workflow_kind");
        expect(
            validateGaokaoFrontmatter({
                ...legacy,
                workflow_kind: "biology_concept_mechanism",
            }).issues.map((issue) => issue.code),
        ).toContain("workflow_kind_subject_mismatch");
        expect(
            validateGaokaoFrontmatter({
                ...legacy,
                workflow_kind: "chemistry_problem_error",
            }).issues.map((issue) => issue.code),
        ).toContain("workflow_kind_entity_type_mismatch");
    });

    test("keeps the optional AIM signal manual, single-entity, and free of word-level SRS", () => {
        const note = buildGaokaoNote({
            templateId: "english_manual_aim_signal",
            gaokaoId: idFor("english_manual_aim_signal"),
            title: "手动记录一个表达信号",
        });

        expect(note.entity).toMatchObject({
            entity_type: "knowledge_point",
            subject: "英语",
            workflow_kind: "english_manual_aim_signal",
        });
        expect(Object.keys(note.frontmatter)).not.toEqual(
            expect.arrayContaining([
                "word_id",
                "word_due",
                "word_interval",
                "mastery_state",
                "vocabulary_database",
            ]),
        );
        expect(note.content).not.toContain("#flashcards");
    });
});

describe("Task 007 review, events, identity, and reload", () => {
    test.each(SUBJECT_REPRESENTATIVES)(
        "%s reuses the scheduler transaction and stable entity history",
        async (subject, templateId) => {
            const note = buildGaokaoNote({
                templateId,
                gaokaoId: idFor(templateId),
                title: `${subject}完整流程`,
            });
            const originalPath = note.path;
            const renamedPath = originalPath.replace("完整流程", "重命名流程");
            const movedPath = `${subject}/Mixed Path 混合目录/重命名流程.md`;
            const { createManager, data, persistedEventCounts } = createManagerHarness();
            const manager = createManager();
            manager.updateEntitySource(originalPath, note.frontmatter);

            const schedulerFields: Record<string, string | number> = {
                "sr-due": "2026-08-08",
                "sr-interval": 1,
                "sr-ease": 250,
            };
            const sequence: string[] = [];
            const review = await runScheduledReviewWorkflow({
                schedule: () => {
                    sequence.push("scheduler");
                    schedulerFields["sr-due"] = "2026-08-12";
                    schedulerFields["sr-interval"] = 4;
                    schedulerFields["sr-ease"] = 250;
                    return Promise.resolve();
                },
                captureFeedback: () => {
                    sequence.push("feedback-cancelled");
                    return Promise.resolve(null);
                },
                recordEvent: async (feedback) => {
                    sequence.push("review-event");
                    return await manager.recordReviewForPath(
                        originalPath,
                        ReviewResponse.Good,
                        feedback,
                    );
                },
            });

            expect(sequence).toEqual(["scheduler", "feedback-cancelled", "review-event"]);
            expect(schedulerFields).toEqual({
                "sr-due": "2026-08-12",
                "sr-interval": 4,
                "sr-ease": 250,
            });
            expect(review.feedback).toEqual({});
            expect(review.recordResult?.status).toBe("recorded");
            expect(data.learningEvents).toHaveLength(1);
            expect(data.learningEvents[0]).toMatchObject({
                entity_id: note.entity.gaokao_id,
                event_type: "review",
                rating: "good",
                source_path: originalPath,
            });
            expect(data.learningEvents[0]).not.toHaveProperty("mistake_type");
            expect(data.learningEvents[0]).not.toHaveProperty("duration_minutes");

            manager.renameEntitySource(originalPath, renamedPath);
            expect(data.learningEvents).toHaveLength(1);
            expect(
                (
                    await manager.recordForPath(renamedPath, {
                        event_type: "study",
                        duration_minutes: 10,
                    })
                ).status,
            ).toBe("recorded");
            expect(data.learningEvents).toHaveLength(2);

            manager.renameEntitySource(renamedPath, movedPath);
            expect(data.learningEvents).toHaveLength(2);
            expect(
                (
                    await manager.recordForPath(movedPath, {
                        event_type: "practice",
                        mistake_type: "P",
                    })
                ).status,
            ).toBe("recorded");
            expect(data.learningEvents).toHaveLength(3);

            manager.updateEntitySource(movedPath, {
                ...note.frontmatter,
                custom_edit: "普通编辑不创建事件",
            });
            manager.inspect(movedPath);
            manager.getHistory(note.entity.gaokao_id);
            expect(data.learningEvents).toHaveLength(3);

            const reloadedManager = createManager();
            reloadedManager.rebuildIndex([{ path: movedPath, frontmatter: note.frontmatter }]);
            expect(reloadedManager.getHistory(note.entity.gaokao_id)).toHaveLength(3);
            expect(
                (
                    await reloadedManager.recordForPath(movedPath, {
                        event_type: "verification",
                    })
                ).status,
            ).toBe("recorded");
            expect(data.learningEvents).toHaveLength(4);
            expect(data.learningEvents.map((event) => event.event_type)).toEqual([
                "review",
                "study",
                "practice",
                "verification",
            ] satisfies LearningEventType[]);
            expect(data.learningEvents.map((event) => event.source_path)).toEqual([
                originalPath,
                renamedPath,
                movedPath,
                movedPath,
            ]);
            expect(reloadedManager.inspect(movedPath).entity?.gaokao_id).toBe(
                note.entity.gaokao_id,
            );
            expect(persistedEventCounts).toEqual([1, 2, 3, 4]);
        },
    );
});

describe("Task 007 Today remains a read-only generic consumer", () => {
    test("all four subjects enter existing due, overdue, future, and discretionary semantics", () => {
        const candidates: TodayPlannerCandidate[] = [];
        for (const [subject, templateId] of SUBJECT_REPRESENTATIVES) {
            const createCandidate = (
                suffix: string,
                schedule: TodayPlannerCandidate["schedule"],
            ): TodayPlannerCandidate => {
                const note = buildGaokaoNote({
                    templateId,
                    gaokaoId: idFor(templateId, suffix),
                    title: `${subject}-${suffix}`,
                });
                return {
                    path: note.path,
                    title: `${subject}-${suffix}`,
                    entity: note.entity,
                    events: [],
                    schedule,
                };
            };
            candidates.push(
                createCandidate("overdue", { kind: "scheduled", dueUnix: TODAY - DAY }),
                createCandidate("due", { kind: "scheduled", dueUnix: TODAY }),
                createCandidate("future", { kind: "scheduled", dueUnix: TODAY + DAY }),
                createCandidate("new", { kind: "none" }),
            );
        }

        const before = JSON.stringify(candidates);
        const first = buildTodayPlan(candidates, {
            todayUnix: TODAY,
            minimumReviewLimit: 20,
            discretionaryLimit: 20,
        });
        const second = buildTodayPlan(candidates, {
            todayUnix: TODAY,
            minimumReviewLimit: 20,
            discretionaryLimit: 20,
        });

        expect(first).toEqual(second);
        expect(JSON.stringify(candidates)).toBe(before);
        expect(first.protectedReviews).toHaveLength(8);
        expect(first.protectedReviews.filter((item) => item.dueStatus === "overdue")).toHaveLength(
            4,
        );
        expect(
            first.protectedReviews.filter((item) => item.dueStatus === "due_today"),
        ).toHaveLength(4);
        expect(new Set(first.protectedReviews.map((item) => item.subject))).toEqual(
            new Set(["化学", "生物", "英语", "语文"]),
        );
        expect(first.discretionaryWork).toHaveLength(4);
        expect(first.protectedReviews.some((item) => item.entityId.endsWith("future"))).toBe(false);

        const legacyShapeCandidates = candidates.map((candidate) => ({
            ...candidate,
            entity: withoutWorkflowKind(candidate.entity),
        }));
        expect(
            buildTodayPlan(legacyShapeCandidates, {
                todayUnix: TODAY,
                minimumReviewLimit: 20,
                discretionaryLimit: 20,
            }),
        ).toEqual(first);
    });
});
