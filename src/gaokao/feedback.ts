import { LearningEventType, MistakeType, ReviewRating } from "src/gaokao/learning-event";
import { GaokaoSubject } from "src/gaokao/schema";

export const QUICK_DURATIONS = [5, 10, 15, 20, 30, 45, 60] as const;

export interface GaokaoFeedback {
    mistake_type?: MistakeType;
    duration_minutes?: number;
}

export interface DurationParseResult {
    ok: boolean;
    value?: number;
    message?: string;
}

export function parseCustomDuration(value: string): DurationParseResult {
    const trimmed = value.trim();
    if (trimmed.length === 0) {
        return { ok: false, message: "请输入时长，或选择跳过。" };
    }
    const duration = Number(trimmed);
    if (!Number.isFinite(duration) || duration < 0) {
        return { ok: false, message: "时长必须是有限的非负数字。" };
    }
    return { ok: true, value: duration };
}

export function formatEventConfirmation(
    eventType: LearningEventType,
    visibleRating: string | undefined,
    feedback: GaokaoFeedback,
): string {
    const parts = [visibleRating ?? eventType];
    if (feedback.mistake_type) parts.push(feedback.mistake_type);
    if (feedback.duration_minutes !== undefined) {
        parts.push(`${feedback.duration_minutes} min`);
    }
    return `${parts.join(" · ")}\n已记录`;
}

const MATH_AGAIN_GUIDANCE: Record<MistakeType, string> = {
    K: "回到定义、公式与适用条件 → 标准例题 → 短时再验证",
    M: "重学标准模型或解题路径 → 标准例题 → 短时再验证",
    P: "重做关键计算或推导 → 短时再验证",
    C: "重读条件并重新翻译题意 → 短时再验证",
    R: "短暂间隔后闭卷提取 → 再验证",
};

const PHYSICS_AGAIN_GUIDANCE: Record<MistakeType, string> = {
    K: "回到定律、定义和公式条件 → 标准例题 → 短时再验证",
    M: "重新确定研究对象 → 划分过程 → 再选规律",
    P: "检查方向、符号、方程和计算链 → 短时再验证",
    C: "重新提取状态、过程、约束和临界条件",
    R: "闭卷复现模型框架 → 短时再验证",
};

const CHEMISTRY_AGAIN_GUIDANCE: Record<MistakeType, string> = {
    K: "回到物质、反应与条件知识 → 标准实例 → 短时再验证",
    M: "重建反应、实验或解题路径 → 标准实例 → 短时再验证",
    P: "检查方程、步骤、单位与计算链 → 短时再验证",
    C: "重新提取条件、现象、数据与问题要求",
    R: "闭卷提取核心反应或实验框架 → 短时再验证",
};

const BIOLOGY_AGAIN_GUIDANCE: Record<MistakeType, string> = {
    K: "回到概念、事实与适用边界 → 标准实例 → 短时再验证",
    M: "重建机制、实验或答题路径 → 标准实例 → 短时再验证",
    P: "检查机制链、变量、证据与作答步骤 → 短时再验证",
    C: "重新读取材料、图表、条件与设问",
    R: "闭卷提取概念或机制链 → 短时再验证",
};

const ENGLISH_AGAIN_GUIDANCE: Record<MistakeType, string> = {
    K: "回到语法、表达或文本知识 → 语境例句 → 短时再验证",
    M: "重建阅读定位、语法判断或写作路径 → 短时再验证",
    P: "检查定位、句子分析与输出修订步骤 → 短时再验证",
    C: "重新理解文本、语境、选项与任务要求",
    R: "闭卷提取规则或表达 → 在语境中再验证",
};

const CHINESE_AGAIN_GUIDANCE: Record<MistakeType, string> = {
    K: "回到语言、文本或素材知识 → 标准语境 → 短时再验证",
    M: "重建阅读、答题或素材转化方法 → 短时再验证",
    P: "检查证据组织、推理与答案表达步骤 → 短时再验证",
    C: "重新理解文本、题干、语境与作答要求",
    R: "闭卷提取依据、方法或素材 → 短时再验证",
};

const AGAIN_GUIDANCE: Readonly<Record<GaokaoSubject, Record<MistakeType, string>>> = Object.freeze({
    数学: MATH_AGAIN_GUIDANCE,
    物理: PHYSICS_AGAIN_GUIDANCE,
    化学: CHEMISTRY_AGAIN_GUIDANCE,
    生物: BIOLOGY_AGAIN_GUIDANCE,
    英语: ENGLISH_AGAIN_GUIDANCE,
    语文: CHINESE_AGAIN_GUIDANCE,
});

const HARD_GUIDANCE: Readonly<Record<GaokaoSubject, string>> = Object.freeze({
    数学: "定位一个不稳定步骤 → 完成一道同类标准题 → 保持既有调度",
    物理: "定位主要卡点 → 复现研究对象、过程与关键步骤 → 保持既有调度",
    化学: "定位主要卡点 → 复现条件、反应或实验步骤 → 保持既有调度",
    生物: "定位主要卡点 → 复现机制、证据或作答结构 → 保持既有调度",
    英语: "定位主要卡点 → 回到文本依据或完成一次短输出 → 保持既有调度",
    语文: "定位主要卡点 → 回到文本依据或答案结构 → 保持既有调度",
});

export function getFollowUpGuidance(
    subject: GaokaoSubject,
    rating: ReviewRating,
    mistakeType?: MistakeType,
): string {
    if (rating === "again") {
        if (mistakeType) return AGAIN_GUIDANCE[subject][mistakeType];
        return "重新学习核心概念或方法 → 标准例题 → 短时再验证";
    }
    if (rating === "hard") return HARD_GUIDANCE[subject];
    if (rating === "good") return "正常进入下一次计划复习";
    return "无需额外补救 → 继续按既有调度";
}

export interface ScheduledReviewWorkflowOptions<T> {
    schedule: () => Promise<void>;
    captureFeedback: () => Promise<GaokaoFeedback | null>;
    recordEvent: (feedback: GaokaoFeedback) => Promise<T>;
}

export interface ScheduledReviewWorkflowResult<T> {
    feedback: GaokaoFeedback;
    captureError?: unknown;
    recordResult: T;
}

export async function runScheduledReviewWorkflow<T>(
    options: ScheduledReviewWorkflowOptions<T>,
): Promise<ScheduledReviewWorkflowResult<T>> {
    await options.schedule();

    let feedback: GaokaoFeedback = {};
    let captureError: unknown;
    try {
        feedback = (await options.captureFeedback()) ?? {};
    } catch (error: unknown) {
        captureError = error;
    }

    const recordResult = await options.recordEvent(feedback);
    return {
        feedback,
        ...(captureError === undefined ? {} : { captureError }),
        recordResult,
    };
}

export type SubmissionGuardResult<T> = { status: "started"; value: T } | { status: "duplicate" };

export class GaokaoSubmissionGuard {
    private readonly pendingKeys = new Set<string>();

    async run<T>(key: string, operation: () => Promise<T>): Promise<SubmissionGuardResult<T>> {
        if (this.pendingKeys.has(key)) return { status: "duplicate" };
        this.pendingKeys.add(key);
        try {
            return { status: "started", value: await operation() };
        } finally {
            this.pendingKeys.delete(key);
        }
    }
}
