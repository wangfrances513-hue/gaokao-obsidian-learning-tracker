import { Notice, TFile } from "obsidian";

import { OsrCore } from "src/data/core";
import { DataStore, StorageType } from "src/data/data-store/base/data-store";
import { DataStoreAlgorithm } from "src/data/data-store/base/data-store-algorithm";
import { NoteDataFileModifier } from "src/data/data-store/notes-data-store/note-data-file-modifier";
import { NoteDataStoreAlgorithmOsr } from "src/data/data-store/notes-data-store/note-data-store-algorithm-osr";
import { NotesDataStore } from "src/data/data-store/notes-data-store/notes-data-store";
import { QuestionPostponementList } from "src/data/data-structures/card/questions/question-postponement-list";
import { TopicPath } from "src/data/data-structures/deck/topic-path";
import { ISRNoteTFile, SRNoteTFile, readRoundScheduleFrontmatter, receiptFromSchedule, scheduleFromReceipt } from "src/data/data-structures/file/note-file";
import { PluginData } from "src/data/plugin-data";
import { PluginDataManager } from "src/data/plugin-data-manager";
import { SettingsUtil, SRSettings } from "src/data/settings";
import { SettingsManager } from "src/data/settings-manager";
import { GaokaoEntityInspection } from "src/gaokao/entity-registry";
import {
    formatEventConfirmation,
    GaokaoFeedback,
    GaokaoSubmissionGuard,
    getFollowUpGuidance,
    runScheduledReviewWorkflow,
} from "src/gaokao/feedback";
import {
    GaokaoManager,
    RecordLearningEventResult,
    reviewResponseToRating,
    RoundCommitIO, RoundTarget,
} from "src/gaokao/gaokao-manager";
import { LearningEvent, LearningEventInput, ReviewRating } from "src/gaokao/learning-event";
import { GaokaoSubject } from "src/gaokao/schema";
import { RoundCompletionInput, sameRoundData } from "src/gaokao/review-flow";
import { t } from "src/lang/helpers";
import SRPlugin from "src/main";
import { Note } from "src/note/note";
import { NoteFileLoader } from "src/note/note-file-loader";
import { NoteReviewQueue } from "src/note/note-review-queue";
import { SRAlgorithmType } from "src/scheduling/algorithms/base/isr-algorithm";
import { ReviewResponse } from "src/scheduling/algorithms/base/repetition-item";
import { SRAlgorithm } from "src/scheduling/algorithms/base/sr-algorithm";
import { SrsAlgorithmFsrs } from "src/scheduling/algorithms/fsrs/sr-algorithm-fsrs";
import { ObsidianVaultNoteLinkInfoFinder } from "src/scheduling/algorithms/osr/obsidian-vault-notelink-info-finder";
import { SRAlgorithmOsr } from "src/scheduling/algorithms/osr/srs-algorithm-osr";

export interface GaokaoReviewFeedbackRequest {
    notePath: string;
    subject: GaokaoSubject;
    rating: ReviewRating;
    visibleRating: string;
}

export type GaokaoReviewFeedbackProvider = (
    request: GaokaoReviewFeedbackRequest,
) => Promise<GaokaoFeedback | null>;

/**
 * Manages all the data related systems of the Spaced Repetition plugin and exposes them to the other parts of the plugin.
 *
 * This includes the plugin data, the OSR app core, and the scheduling data repository.
 */
export class DataManager {
    private plugin: SRPlugin;
    public pluginDataManager: PluginDataManager; // TODO: Refactor so that the plugin data manager and the settings manager are separate from the data manager
    public settingsManager: SettingsManager; // TODO: Refactor so that the plugin data manager and the settings manager are separate from the data manager
    private _osrCore: OsrCore | null = null;
    private _syncLock = false;
    public readonly gaokaoManager: GaokaoManager;
    private gaokaoReviewFeedbackProvider: GaokaoReviewFeedbackProvider | null = null;
    private readonly gaokaoReviewSubmissionGuard = new GaokaoSubmissionGuard();
    private roundEntry: ((entityId: string, userRating?: ReviewRating) => Promise<void>) | null = null;
    private roundActionValidator: ((target: RoundTarget, input: RoundCompletionInput) => Promise<void>) | null = null;
    private roundScheduleQueue: Promise<void> = Promise.resolve();

    constructor(
        plugin: SRPlugin,
        pluginDataManager: PluginDataManager,
        settingsManager: SettingsManager,
    ) {
        this.plugin = plugin;
        this.pluginDataManager = pluginDataManager;
        this.settingsManager = settingsManager;
        this.gaokaoManager = new GaokaoManager({
            getData: () => this.pluginDataManager.pluginData.gaokao,
            transact: async (operation) => await this.pluginDataManager.withGaokaoTransaction(operation),
        });
    }

    /**
     * Checks if the data has been loaded.
     */
    isDataLoaded(): boolean {
        return this.pluginDataManager.isLoaded;
    }

    /**
     * Checks if the OSR app core has been loaded.
     */
    isOsrCoreLoaded(): boolean {
        return this._osrCore !== null;
    }

    // TODO: Remove once everything is migrated to the settings manager and plugin data manager
    get data(): PluginData {
        return this.pluginDataManager.pluginData;
    }

    set data(data: PluginData) {
        this.pluginDataManager.pluginData = data;
    }

    get osrCore(): OsrCore {
        if (this._osrCore === null) throw new Error("SR plugin or OSR core not initialized!!!");
        return this._osrCore;
    }

    set osrCore(osrCore: OsrCore) {
        this._osrCore = osrCore;
    }

    get syncLock(): boolean {
        return this._syncLock;
    }

    /**
     * Loads the plugin data from the data.json from the plugin's folder.
     */
    loadData(): void {
        this.setupDataStoreAndAlgorithmInstances(this.settingsManager.settings);
    }

    /**
     * Initializes the OSR app core.
     *
     * @param {NoteReviewQueue} noteReviewQueue - The note review queue.
     * @param {() => void} onOsrVaultDataChanged - A callback function that is called when the OSR vault data changes.
     * @returns {Promise<void>} - A promise that resolves when the OSR app core is initialized.
     */
    async initOSRCore(
        noteReviewQueue: NoteReviewQueue,
        onOsrVaultDataChanged: () => Promise<void>,
    ): Promise<void> {
        const questionPostponementList: QuestionPostponementList = new QuestionPostponementList(
            this.pluginDataManager,
            this.settingsManager.settings,
            this.pluginDataManager.pluginData.buryList,
        );
        await questionPostponementList.clearIfNewDay(this.pluginDataManager.pluginData);

        this.osrCore = new OsrCore(
            questionPostponementList,
            new ObsidianVaultNoteLinkInfoFinder(this.plugin.app.metadataCache),
            this.settingsManager.settings,
            onOsrVaultDataChanged,
            noteReviewQueue,
            this.plugin.getObsidianRtlSetting(),
        );
    }

    async loadVault(): Promise<void> {
        if (this._syncLock) {
            return;
        }
        this._syncLock = true;

        try {
            this.osrCore.loadInitialStateOfCore();

            const notes: TFile[] = this.plugin.app.vault.getMarkdownFiles();
            this.rebuildGaokaoIndex(notes);
            for (const noteFile of notes) {
                // Skip files in the note ignore folder
                if (
                    SettingsUtil.isPathInFoldersToIgnore(
                        this.settingsManager.settings,
                        noteFile.path,
                    )
                )
                    continue;

                const file: SRNoteTFile = this.createSRNoteTFile(noteFile);
                await this.osrCore.processFile(file);
            }

            await this.osrCore.finalizeLoad();
        } finally {
            this._syncLock = false;
        }
    }

    /**
     * Creates a SRNoteTFile object from a note file.
     *
     * @param {TFile} note - The note file.
     * @returns {SRNoteTFile} - The SRNoteTFile object.
     */
    createSRNoteTFile(note: TFile): SRNoteTFile {
        return new SRNoteTFile(
            this.plugin.app.vault,
            this.plugin.app.metadataCache,
            this.plugin.app.fileManager,
            note,
        );
    }

    rebuildGaokaoIndex(notes: TFile[] = this.plugin.app.vault.getMarkdownFiles()): void {
        this.gaokaoManager.rebuildIndex(
            notes.map((note) => ({
                path: note.path,
                frontmatter: this.plugin.app.metadataCache.getFileCache(note)?.frontmatter,
            })),
        );
    }

    updateGaokaoFile(note: TFile): void {
        if (note.extension !== "md") return;
        this.gaokaoManager.updateEntitySource(
            note.path,
            this.plugin.app.metadataCache.getFileCache(note)?.frontmatter,
        );
    }

    indexGaokaoFrontmatter(path: string, frontmatter: Record<string, unknown>): void {
        this.gaokaoManager.updateEntitySource(path, frontmatter);
    }

    removeGaokaoFile(path: string): void {
        this.gaokaoManager.removeEntitySource(path);
    }

    renameGaokaoFile(oldPath: string, newPath: string): void {
        this.gaokaoManager.renameEntitySource(oldPath, newPath);
    }

    inspectGaokaoFile(note: TFile): GaokaoEntityInspection {
        this.updateGaokaoFile(note);
        return this.gaokaoManager.inspect(note.path);
    }

    getGaokaoEventHistory(entityId: string): LearningEvent[] {
        return this.gaokaoManager.getHistory(entityId);
    }

    getGaokaoIdPaths(entityId: string): string[] {
        return this.gaokaoManager.getCandidatePaths(entityId);
    }

    getGaokaoKnowledgePoints() {
        return this.gaokaoManager.getKnowledgePoints();
    }

    getGaokaoEntities() {
        return this.gaokaoManager.getEntities();
    }

    getGaokaoInspections(): GaokaoEntityInspection[] {
        return this.gaokaoManager.getInspections();
    }

    resolveGaokaoEntity(entityId: string) {
        return this.gaokaoManager.resolveEntity(entityId);
    }

    setGaokaoReviewFeedbackProvider(provider: GaokaoReviewFeedbackProvider): void {
        this.gaokaoReviewFeedbackProvider = provider;
    }

    setRoundEntry(
        entry: (entityId: string, userRating?: ReviewRating) => Promise<void>,
        validateAction: (target: RoundTarget, input: RoundCompletionInput) => Promise<void>,
    ): void {
        this.roundEntry = entry;
        this.roundActionValidator = validateAction;
    }

    async openRoundEntry(entityId: string, userRating?: ReviewRating): Promise<void> {
        if (!this.roundEntry) throw new Error("流程结果入口尚未就绪。");
        await this.roundEntry(entityId, userRating);
    }

    /** Rebuild the existing identity registry from persistent frontmatter, not stale metadata. */
    async resolveRoundTarget(entityId: string): Promise<RoundTarget> {
        if (!this.isOsrCoreLoaded() || this.syncLock) throw new Error("原调度器尚未就绪或正在刷新。");
        const files = this.plugin.app.vault.getMarkdownFiles();
        const sources = [];
        for (const file of files) {
            const metadata = await this.createSRNoteTFile(file).readPersistentMetadata();
            sources.push({ path: file.path, frontmatter: metadata.frontmatter });
        }
        this.gaokaoManager.rebuildIndex(sources);
        const resolved = this.resolveGaokaoEntity(entityId);
        if (!resolved || this.getGaokaoIdPaths(entityId).length !== 1) throw new Error("gaokao_id 当前不唯一或无效。");
        const file = this.plugin.app.vault.getAbstractFileByPath(resolved.path);
        if (!(file instanceof TFile)) throw new Error("目标文件不可用。");
        const metadata = await this.createSRNoteTFile(file).readPersistentMetadata();
        this.assertRoundEligibility(file, entityId, metadata.frontmatter, metadata.tags);
        return { entityId, path: file.path, schedule: readRoundScheduleFrontmatter(metadata.frontmatter) };
    }

    private assertRoundEligibility(file: TFile, entityId: string, frontmatter: Record<string, unknown>, tags: string[]): void {
        if (this.plugin.app.vault.getAbstractFileByPath(file.path) !== file || frontmatter.gaokao_id !== entityId ||
            this.getGaokaoIdPaths(entityId).length !== 1 || this.resolveGaokaoEntity(entityId)?.path !== file.path) {
            throw new Error("实际写入边界的 Entity 身份或路径不符。");
        }
        if (SettingsUtil.isPathInFoldersToIgnore(this.settingsManager.settings, file.path) ||
            SettingsUtil.isAnyTagIgnoredForNotes(this.settingsManager.settings, tags) ||
            !SettingsUtil.isAnyTagANoteReviewTag(this.settingsManager.settings, tags)) {
            throw new Error("目标已移除复习标签或被忽略，不能当作未排期。");
        }
        if (frontmatter.status !== undefined && frontmatter.status !== "active") throw new Error("目标当前不是 active Entity。");
        if (frontmatter.entity_type === "resource_unit" &&
            (frontmatter.resource_status === "completed" || frontmatter.resource_status === "verified")) throw new Error("资源当前不属于可执行候选。");
    }

    private roundIO(): RoundCommitIO {
        return {
            readTarget: async (id) => await this.resolveRoundTarget(id),
            checkAction: async (target, input) => {
                if (!this.roundActionValidator) throw new Error("行动校验入口尚未就绪。");
                await this.roundActionValidator(target, input);
            },
            prepareSchedule: (target, response) => receiptFromSchedule(this.osrCore.prepareRoundSchedule(
                target.path, scheduleFromReceipt(target.schedule), response,
            )),
            writeSchedule: async (pending) => {
                const target = await this.resolveRoundTarget(pending.event.entity_id);
                if (target.path !== pending.event.source_path || !sameRoundData(target.schedule, pending.schedule_before)) {
                    throw new Error("提交前身份、路径或 expected before 已改变。");
                }
                const file = this.plugin.app.vault.getAbstractFileByPath(target.path);
                if (!(file instanceof TFile) || !pending.event.schedule_after) throw new Error("排期目标不可用。");
                const srFile = this.createSRNoteTFile(file);
                const metadata = await srFile.readPersistentMetadata();
                const beforeIdentity = { ...metadata.frontmatter };
                for (const key of ["sr-due", "sr-interval", "sr-ease"]) delete beforeIdentity[key];
                await srFile.compareAndSetRoundSchedule(target.entityId, pending.schedule_before, pending.event.schedule_after, (frontmatter) => {
                    const currentIdentity = { ...frontmatter };
                    for (const key of ["sr-due", "sr-interval", "sr-ease"]) delete currentIdentity[key];
                    if (!sameRoundData(beforeIdentity, currentIdentity)) throw new Error("提交当下身份或非调度元数据已改变。");
                    this.assertRoundEligibility(file, target.entityId, frontmatter, metadata.tags);
                });
            },
            refresh: async (event) => {
                const target = await this.resolveRoundTarget(event.entity_id);
                if (!sameRoundData(target.schedule, event.schedule_after)) throw new Error("已提交事件的排期发生外部变化。");
                const file = this.plugin.app.vault.getAbstractFileByPath(target.path);
                const schedule = scheduleFromReceipt(target.schedule);
                if (!(file instanceof TFile) || !schedule) throw new Error("派生状态目标不可用。");
                const algorithm = SRAlgorithm.getInstance();
                algorithm.noteStats().setEaseForPath(file.path, schedule.latestEase);
                await this.osrCore.refreshAfterNoteSchedule(this.createSRNoteTFile(file), schedule, schedule, this.settingsManager.settings, true);
            },
        };
    }

    async completeRound(input: RoundCompletionInput) {
        const result = this.roundScheduleQueue.then(async () => await this.gaokaoManager.commitRound(input, this.roundIO()));
        this.roundScheduleQueue = result.then((): void => undefined, (): void => undefined);
        return await result;
    }

    async inspectRoundRecovery() { return await this.gaokaoManager.inspectRoundRecovery(this.roundIO()); }

    async recoverRound(eventId: string, choice: "continue" | "record") {
        const result = this.roundScheduleQueue.then(async () => await this.gaokaoManager.recoverRound(eventId, choice, this.roundIO()));
        this.roundScheduleQueue = result.then((): void => undefined, (): void => undefined);
        return await result;
    }

    async recordGaokaoLearningEvent(
        note: TFile,
        input: Omit<LearningEventInput, "entity_id" | "source_path">,
    ): Promise<RecordLearningEventResult> {
        this.updateGaokaoFile(note);
        return await this.gaokaoManager.recordForPath(note.path, input);
    }

    /**
     * Sets up the data store and algorithm instances based on the settings.
     *
     * @param {SRSettings} settings - The settings object.
     */
    setupDataStoreAndAlgorithmInstances(settings: SRSettings) {
        switch (settings.dataStore) {
            case StorageType.NOTES:
                DataStore.instance = new NotesDataStore(
                    settings,
                    new NoteDataFileModifier(this.plugin),
                );
                DataStoreAlgorithm.instance = new NoteDataStoreAlgorithmOsr(settings);
                break;
        }

        // TODO: Move this to the scheduling manager once it is implemented
        SRAlgorithm.instance =
            settings.algorithm === SRAlgorithmType.FSRS
                ? new SrsAlgorithmFsrs(settings)
                : new SRAlgorithmOsr(settings);
    }

    /**
     * Synchronizes the data with the Obsidian vault.
     *
     * @returns {Promise<void>} - A promise that resolves when the synchronization is complete.
     */
    async sync(): Promise<void> {
        if (this.osrCore === null) throw new Error("OSR app core not initialized!!!");
        if (this.syncLock) {
            return;
        }

        const now = window.moment(Date.now());
        this.osrCore.defaultTextDirection = this.plugin.getObsidianRtlSetting();

        await this.loadVault();

        if (this.settingsManager.settings.showSchedulingDebugMessages) {
            console.log(`SR: ${t("DECKS")}`, this.osrCore.reviewableDeckTree);
            console.log(
                "SR: " +
                    t("SYNC_TIME_TAKEN", {
                        t: Date.now() - now.valueOf(),
                    }),
            );
        }
    }

    /**
     * Loads a note from the Obsidian vault.
     *
     * @param {TFile} noteFile - The note file.
     * @returns {Promise<Note | null>} - A promise that resolves with the loaded note or null if not found.
     */
    async loadNote(noteFile: TFile): Promise<Note | null> {
        const loader: NoteFileLoader = new NoteFileLoader(this.settingsManager.settings);
        const srFile: ISRNoteTFile = this.createSRNoteTFile(noteFile);
        const folderTopicPath: TopicPath = TopicPath.getFolderPathFromFilename(
            srFile,
            this.settingsManager.settings,
        );

        const note: Note | null = await loader.load(
            this.createSRNoteTFile(noteFile),
            this.plugin.getObsidianRtlSetting(),
            folderTopicPath,
        );
        if (note && note.hasChanged) {
            await note.writeNoteFile(this.settingsManager.settings);
        }
        return note;
    }

    /**
     * Saves the review response for a note.
     *
     * @param {TFile} note - The note file.
     * @param {ReviewResponse} response - The review response.
     * @returns {Promise<void>} - A promise that resolves when the review response is saved.
     */
    async saveNoteReviewResponse(note: TFile, response: ReviewResponse): Promise<void> {
        const inspectionAtEntry = this.inspectGaokaoFile(note);
        if (inspectionAtEntry.status === "valid" && inspectionAtEntry.entity) {
            const id = inspectionAtEntry.entity.gaokao_id;
            const state = this.gaokaoManager.getRoundState(id);
            if (state.ok === false) { new Notice(state.issue, 10000); return; }
            if (state.state.cycleRef !== null || this.data.gaokao.pendingRoundCommit?.event.entity_id === id) {
                const userRating = reviewResponseToRating(response);
                if (userRating === null) { new Notice("流程内不能通过 Reset 绕过周期核对。", 10000); return; }
                await this.openRoundEntry(id, userRating);
                return;
            }
        } else if (inspectionAtEntry.status !== "ordinary") {
            new Notice("GAOKAO 身份无效或重复，停止评分。", 10000); return;
        }
        const result = this.roundScheduleQueue.then(async () => await this.saveLegacyNoteReviewResponse(note, response));
        this.roundScheduleQueue = result.then((): void => undefined, (): void => undefined);
        const completed = await result;
        // Release the scheduling queue before navigation can offer pending recovery.
        if (completed && this.settingsManager.settings.autoNextNote) {
            await this.plugin.nextNoteReviewHandler.autoReviewNextNote();
        }
    }

    private async saveLegacyNoteReviewResponse(note: TFile, response: ReviewResponse): Promise<boolean> {
        // Recheck after waiting: a concurrent R1 may have joined this Entity to the flow.
        const current = this.inspectGaokaoFile(note);
        if (current.status !== "ordinary" && current.status !== "valid") {
            new Notice("等待期间 GAOKAO 身份变为无效或重复，停止旧评分。", 10000); return false;
        }
        if ((current.entity && this.data.gaokao.pendingRoundCommit?.event.entity_id === current.entity.gaokao_id) || (current.entity &&
            this.gaokaoManager.getHistory(current.entity.gaokao_id).some((event) => Object.prototype.hasOwnProperty.call(event, "cycle_ref")))) {
            new Notice("当前流程状态已改变，旧评分未执行。", 10000); return false;
        }
        if (this.osrCore === null) throw new Error("OSR app core not initialized!!!");
        if (this.plugin.nextNoteReviewHandler === null)
            throw new Error("Next note review handler not initialized!!!");

        const noteSrTFile: ISRNoteTFile = this.createSRNoteTFile(note);

        if (SettingsUtil.isPathInFoldersToIgnore(this.settingsManager.settings, note.path)) {
            new Notice(t("NOTE_IN_IGNORED_FOLDER"));
            return false;
        }

        const tags = noteSrTFile.getAllTagsFromCache();
        if (!SettingsUtil.isAnyTagANoteReviewTag(this.settingsManager.settings, tags)) {
            new Notice(t("PLEASE_TAG_NOTE"));
            return false;
        }

        const inspection = this.inspectGaokaoFile(note);
        const rating = reviewResponseToRating(response);
        const isValidGaokaoReview =
            rating !== null && inspection.status === "valid" && inspection.entity !== undefined;

        if (isValidGaokaoReview && inspection.entity) {
            const entity = inspection.entity;
            const guarded = await this.gaokaoReviewSubmissionGuard.run(note.path, async () => {
                const workflow = await runScheduledReviewWorkflow({
                    schedule: async () => {
                        await this.osrCore.saveNoteReviewResponse(
                            noteSrTFile,
                            response,
                            this.settingsManager.settings,
                        );
                    },
                    captureFeedback: async () => {
                        if (this.gaokaoReviewFeedbackProvider === null) {
                            return null;
                        }
                        return await this.gaokaoReviewFeedbackProvider({
                            notePath: note.path,
                            subject: entity.subject,
                            rating,
                            visibleRating: this.getVisibleRating(response),
                        });
                    },
                    recordEvent: async (feedback) =>
                        await this.gaokaoManager.recordReviewForPath(note.path, response, feedback),
                });
                if (workflow.captureError !== undefined) {
                    console.warn(
                        "GAOKAO: Optional feedback capture failed; the semantic rating was still recorded.",
                        workflow.captureError,
                    );
                }
                this.showReviewRecordingResult(
                    workflow.recordResult,
                    entity.subject,
                    rating,
                    this.getVisibleRating(response),
                    workflow.feedback,
                );
            });
            if (guarded.status === "duplicate") {
                new Notice("GAOKAO：本次复习正在记录，请勿重复提交。");
                return false;
            }
        } else {
            await this.osrCore.saveNoteReviewResponse(
                noteSrTFile,
                response,
                this.settingsManager.settings,
            );
            const eventResult = await this.gaokaoManager.recordReviewForPath(note.path, response);
            this.reportGaokaoEventResult(eventResult);
            new Notice(t("RESPONSE_RECEIVED"));
        }

        return true;
    }

    private showReviewRecordingResult(
        result: RecordLearningEventResult | null,
        subject: GaokaoSubject,
        rating: ReviewRating,
        visibleRating: string,
        feedback: GaokaoFeedback,
    ): void {
        if (result?.status === "recorded") {
            const confirmation = formatEventConfirmation("review", visibleRating, feedback);
            const guidance = getFollowUpGuidance(subject, rating, feedback.mistake_type);
            new Notice(`${confirmation}\n${guidance}`, 10000);
            return;
        }
        this.reportGaokaoEventResult(result);
        if (result === null || result.status === "ordinary") {
            new Notice(t("RESPONSE_RECEIVED"));
        }
    }

    private getVisibleRating(response: ReviewResponse): string {
        switch (response) {
            case ReviewResponse.Again:
                return this.settingsManager.settings.flashcardAgainText;
            case ReviewResponse.Hard:
                return this.settingsManager.settings.flashcardHardText;
            case ReviewResponse.Good:
                return this.settingsManager.settings.flashcardGoodText;
            case ReviewResponse.Easy:
                return this.settingsManager.settings.flashcardEasyText;
            case ReviewResponse.Reset:
                return "Reset";
        }
    }

    private reportGaokaoEventResult(result: RecordLearningEventResult | null): void {
        if (result === null || result.status === "recorded" || result.status === "ordinary") return;
        if (result.status === "invalid_entity") {
            new Notice(
                `GAOKAO event not recorded: ${result.inspection.issues
                    .map((issue) => issue.message)
                    .join(" ")}`,
                10000,
            );
        } else if (result.status === "invalid_event") {
            new Notice(
                `GAOKAO event not recorded: ${result.issues
                    .map((issue) => issue.message)
                    .join(" ")}`,
                10000,
            );
        } else {
            console.warn("GAOKAO: Review was scheduled, but its learning event was not persisted.");
            new Notice(
                "GAOKAO: Review was scheduled, but its learning event was not persisted.",
                10000,
            );
        }
    }

    /**
     * Saves the plugin data.
     *
     * @returns {Promise<void>} - A promise that resolves when the plugin data is saved.
     */
    async savePluginData(): Promise<void> {
        try {
            await this.pluginDataManager.savePluginData();
        } catch (error) {
            console.warn("DataManager: Error saving plugin data", error);
        }
    }
}
