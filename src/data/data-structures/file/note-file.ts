import moment, { Moment } from "moment";
import { FileManager, HeadingCache, MetadataCache, TFile, Vault } from "obsidian";

import { ALLOWED_DATE_FORMATS, PREFERRED_DATE_FORMAT } from "src/data/constants";
import { ISRFile, SRTFile } from "src/data/data-structures/file/sr-file";
import { isRoundScheduleReceipt, RoundScheduleReceipt } from "src/gaokao/learning-event";
import { sameRoundData } from "src/gaokao/review-flow";
import { RepItemScheduleInfo } from "src/scheduling/algorithms/base/rep-item-schedule-info";
import { RepItemScheduleInfoOsr } from "src/scheduling/algorithms/osr/rep-item-schedule-info-osr";
import { formatDate } from "src/utils/dates";

/**
 * Represents a file from the Obsidian vault with some additional functionality for scheduling data.
 *
 * IMPORTANT: Lines are zero based, not one based.
 *
 * @interface ISRNoteTFile
 */
export interface ISRNoteTFile extends ISRFile {
    setNoteSchedule(repItemScheduleInfo: RepItemScheduleInfo): Promise<void>;
    getNoteSchedule(): Promise<RepItemScheduleInfo | null>;
    getNoteId(): Promise<string | null>;
    getOrCreateNoteId(): Promise<string>;
    getQuestionContext(cardLine: number): string[];
}

/**
 * Represents a file from the Obsidian vault with some additional functionality for scheduling data.
 *
 * IMPORTANT: Lines are zero based, not one based.
 *
 * @class SRNoteTFile
 * @implements {ISRNoteTFile}
 */
export class SRNoteTFile extends SRTFile implements ISRNoteTFile {
    constructor(vault: Vault, metadataCache: MetadataCache, fileManager: FileManager, file: TFile) {
        super(vault, metadataCache, fileManager, file);
    }

    /**
     * Gets the scheduling information for the note.
     *
     * @returns {Promise<RepItemScheduleInfo>} - A promise that resolves with the scheduling information for the note.
     */
    async getNoteSchedule(): Promise<RepItemScheduleInfo | null> {
        const frontmatter: Map<string, string> = await this.getFrontmatter();
        const srInterval = frontmatter.get("sr-interval");
        const srEase = frontmatter.get("sr-ease");
        const srDue = frontmatter.get("sr-due");

        if (!(srInterval && srEase && srDue)) return null;

        const dueDate: Moment = moment(srDue, ALLOWED_DATE_FORMATS);
        const interval: number = parseFloat(srInterval);
        const ease: number = parseFloat(srEase);

        return new RepItemScheduleInfoOsr(dueDate, interval, ease);
    }

    /**
     * Sets the scheduling information for the note.
     *
     * @param {RepItemScheduleInfo} repItemScheduleInfo - The scheduling information for the note.
     * @returns {Promise<void>} - A promise that resolves when the scheduling information is set.
     */
    async setNoteSchedule(repItemScheduleInfo: RepItemScheduleInfo): Promise<void> {
        const scheduleInfo: RepItemScheduleInfoOsr = repItemScheduleInfo;
        const dueString: string = formatDate(scheduleInfo.dueDateAsUnix, PREFERRED_DATE_FORMAT);
        const interval: number = scheduleInfo.interval;
        const ease: number = scheduleInfo.latestEase;

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await this.fileManager.processFrontMatter(this.tfile, (frontmatter: any) => {
            frontmatter["sr-due"] = dueString;
            frontmatter["sr-interval"] = interval;
            frontmatter["sr-ease"] = ease;
        });
    }

    async readPersistentSchedule(): Promise<RoundScheduleReceipt | null> {
        return readRoundScheduleFrontmatter((await this.readPersistentMetadata()).frontmatter);
    }

    /** Same scheduler-owned frontmatter path, with compare-before-write inside its callback. */
    async compareAndSetRoundSchedule(
        entityId: string, expected: RoundScheduleReceipt | null, after: RoundScheduleReceipt,
        assertIdentity: (frontmatter: Record<string, unknown>) => void,
    ): Promise<void> {
        if (!isRoundScheduleReceipt(after)) throw new Error("候选排期无效。");
        await this.fileManager.processFrontMatter(this.tfile, (frontmatter: Record<string, unknown>) => {
            assertIdentity(frontmatter);
            if (frontmatter.gaokao_id !== entityId) throw new Error("写入当下 gaokao_id 不符。");
            if (!sameRoundData(readRoundScheduleFrontmatter(frontmatter), expected)) {
                throw new Error("写入当下 sr-* 已发生变化；未覆盖。");
            }
            frontmatter["sr-due"] = after.due;
            frontmatter["sr-interval"] = after.interval;
            frontmatter["sr-ease"] = after.ease;
        });
    }

    /**
     * Gets the note ID from the frontmatter.
     *
     * @returns {Promise<string | null>} - A promise that resolves with the note ID from the frontmatter, or null if not found.
     */
    async getNoteId(): Promise<string | null> {
        const frontmatter = await this.getFrontmatter();
        return frontmatter?.get("sr-id") ?? null;
    }

    /**
     * Gets or creates the note ID from the frontmatter.
     *
     * @returns {Promise<string>} - A promise that resolves with the note ID from the frontmatter, or a new one if not found.
     */
    async getOrCreateNoteId(): Promise<string> {
        const existing = await this.getNoteId();
        if (existing) return existing;
        const id = crypto.randomUUID();
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await this.fileManager.processFrontMatter(this.tfile, (frontmatter: any) => {
            frontmatter["sr-id"] = id;
        });
        return id;
    }

    /**
     * Gets the question context for a given line number.
     *
     * @param {number} cardLine - The line number of the card.
     * @returns {string[]} - An array of strings representing the question context.
     */
    getQuestionContext(cardLine: number): string[] {
        const fileCachedData = this.metadataCache.getFileCache(this.file) || {};
        const headings: HeadingCache[] = fileCachedData.headings || [];
        const stack: HeadingCache[] = [];
        for (const heading of headings) {
            if (heading.position.start.line > cardLine) {
                break;
            }

            while (stack.length > 0 && stack[stack.length - 1].level >= heading.level) {
                stack.pop();
            }

            stack.push(heading);
        }

        const result = [];
        for (const headingObj of stack) {
            headingObj.heading = headingObj.heading.replace(/\[\^\d+\]/gm, "").trim();
            result.push(headingObj.heading);
        }
        return result;
    }
}

export function readRoundScheduleFrontmatter(frontmatter: Record<string, unknown>): RoundScheduleReceipt | null {
    const keys = ["sr-due", "sr-interval", "sr-ease"];
    const count = keys.filter((key) => Object.prototype.hasOwnProperty.call(frontmatter, key)).length;
    if (count === 0) return null;
    if (count !== 3) throw new Error("sr-* 字段不完整，不能当作未排期。");
    const rawDue = frontmatter["sr-due"];
    const due = rawDue instanceof Date ? moment(rawDue) : moment(String(rawDue), ALLOWED_DATE_FORMATS, true);
    const numeric = (value: unknown): number =>
        typeof value === "number" ? value : typeof value === "string" && value.trim() !== "" ? Number(value) : Number.NaN;
    const receipt = { due: due.format(PREFERRED_DATE_FORMAT), interval: numeric(frontmatter["sr-interval"]), ease: numeric(frontmatter["sr-ease"]) };
    if (!due.isValid() || !isRoundScheduleReceipt(receipt)) throw new Error("sr-* 内容损坏，不能当作未排期。");
    return receipt;
}

export function scheduleFromReceipt(receipt: RoundScheduleReceipt | null): RepItemScheduleInfoOsr | null {
    return receipt === null ? null : RepItemScheduleInfoOsr.fromDueDateStr(receipt.due, receipt.interval, receipt.ease);
}

export function receiptFromSchedule(schedule: RepItemScheduleInfo): RoundScheduleReceipt {
    const receipt = { due: formatDate(schedule.dueDateAsUnix, PREFERRED_DATE_FORMAT), interval: schedule.interval, ease: schedule.latestEase };
    if (!isRoundScheduleReceipt(receipt)) throw new Error("原 scheduler 未返回有效整笔排期。");
    return receipt;
}
