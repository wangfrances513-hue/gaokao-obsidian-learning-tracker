import { DEFAULT_DATA, PluginData } from "src/data/plugin-data";
import { DEFAULT_SETTINGS, SRSettings, upgradeSettings } from "src/data/settings";
import { createDefaultGaokaoPluginData, GaokaoDataTransaction, GaokaoPluginData } from "src/gaokao/gaokao-manager";
import { hasCycleRef, isPendingRoundCommit, sameRoundData } from "src/gaokao/review-flow";
import SRPlugin from "src/main";
import { setDebugParser } from "src/parser";

/**
 * Custom error class for plugin data errors.
 */
export class PluginDataError extends Error {
    constructor(message: string) {
        super(message);
        this.name = "PluginDataError";
    }
}

/**
 * Manages the plugin data.
 */
export class PluginDataManager {
    private plugin: SRPlugin;
    private _pluginData: PluginData | null = null;
    private writeQueue: Promise<void> = Promise.resolve();
    private confirmedDiskGaokao: unknown;
    private confirmedGaokao: GaokaoPluginData = createDefaultGaokaoPluginData();
    private uncertainWrite = false;

    constructor(plugin: SRPlugin) {
        this.plugin = plugin;
    }

    get isLoaded(): boolean {
        return this._pluginData !== null;
    }

    get pluginData(): PluginData {
        if (this._pluginData === null)
            throw new PluginDataError(
                "Cant access the plugin data, as the plugin data is not yet loaded!!",
            );
        return this._pluginData;
    }

    set pluginData(pluginData: PluginData) {
        this._pluginData = pluginData;
        this.confirmedGaokao = cloneData(this.loadGaokaoData(pluginData.gaokao));
        this.confirmedDiskGaokao = cloneData(pluginData.gaokao);
    }

    /**
     * Loads the plugin data from the data.json from the plugin's folder.
     */
    async loadData(): Promise<void> {
        const loadedData: PluginData | null = (await this.plugin.loadData()) as PluginData | null;
        if (loadedData?.settings) upgradeSettings(loadedData.settings);
        this._pluginData = Object.assign({}, DEFAULT_DATA, loadedData);
        this._pluginData.settings = Object.assign({}, DEFAULT_SETTINGS, this._pluginData.settings);
        this._pluginData.gaokao = this.loadGaokaoData(loadedData?.gaokao);
        this.confirmedDiskGaokao = cloneData(loadedData?.gaokao);
        this.confirmedGaokao = cloneData(this._pluginData.gaokao);
        this.uncertainWrite = false;

        setDebugParser(this._pluginData.settings.showParserDebugMessages);
    }

    private loadGaokaoData(raw: unknown): GaokaoPluginData {
        if (raw === undefined) return createDefaultGaokaoPluginData();
        if (!raw || typeof raw !== "object") throw new PluginDataError("GAOKAO 数据结构无法识别，未重置。");
        const value = raw as GaokaoPluginData;
        if (!Array.isArray(value.learningEvents) || (value.version !== 1 && value.version !== 2)) {
            throw new PluginDataError("GAOKAO 数据版本或历史无效，停止写回。");
        }
        if (value.learningEvents.some((event) => !event || typeof event !== "object")) {
            throw new PluginDataError("GAOKAO 历史含无法识别的记录，停止写回。");
        }
        if (value.version === 1 && (value.learningEvents.some((event) => hasCycleRef(event) || event.schedule_after !== undefined || event.evidence !== undefined) || value.pendingRoundCommit !== undefined)) {
            throw new PluginDataError("旧版本出现未识别流程上下文，停止升级。");
        }
        if (value.pendingRoundCommit !== undefined && !isPendingRoundCommit(value.pendingRoundCommit)) {
            throw new PluginDataError("pendingRoundCommit 无效，停止写回。");
        }
        return {
            ...value,
            version: value.version,
            learningEvents: [...value.learningEvents],
        };
    }

    /**
     * Saves the plugin data.
     *
     * @returns {Promise<void>} - A promise that resolves when the plugin data is saved.
     * @throws {Error} - Throws an error if the plugin data is not loaded.
     */
    async savePluginData(): Promise<void> {
        await this.enqueue(async () => {
            await this.assertDiskGaokao();
            await this.saveInsideLock(this.confirmedGaokao);
        });
    }

    /** All event, settings and buryList saves share this queue. No caller saves data.json directly. */
    async withGaokaoTransaction<T>(operation: (transaction: GaokaoDataTransaction) => Promise<T>): Promise<T> {
        return await this.enqueue(async () => {
            await this.assertDiskGaokao();
            const manager = this;
            return await operation({
                get data() { return cloneData(manager.confirmedGaokao); },
                save: async (next) => {
                    await this.assertDiskGaokao();
                    await this.saveInsideLock(this.loadGaokaoData(next));
                },
            });
        });
    }

    private async assertDiskGaokao(): Promise<void> {
        if (this.uncertainWrite) throw new PluginDataError("前一次保存回读不明确；停止后续写入，需重新加载并核对。");
        const disk = await this.plugin.loadData() as PluginData | null;
        if (!sameRoundData(disk?.gaokao, this.confirmedDiskGaokao)) {
            throw new PluginDataError("磁盘 GAOKAO 数据已发生外部变化；未覆盖。");
        }
    }

    private async saveInsideLock(next: GaokaoPluginData): Promise<void> {
        // Take the payload at the actual write boundary, including latest settings/bury mutations.
        const payload = cloneData({ ...this.pluginData, gaokao: next });
        let saveError: unknown;
        try { await this.plugin.saveData(payload); }
        catch (error: unknown) { saveError = error; }
        let disk: PluginData | null;
        try { disk = await this.plugin.loadData() as PluginData | null; }
        catch (error: unknown) {
            this.uncertainWrite = true;
            // Keep the last confirmed history. An uncertain prepare remains visible but cannot advance Round.
            if (next.pendingRoundCommit) this.pluginData.gaokao = cloneData(next);
            throw new PluginDataError(`保存回读失败，状态不明：${String(error)}`);
        }
        if (sameRoundData(disk, payload)) {
            this.confirmedDiskGaokao = cloneData(next);
            this.confirmedGaokao = cloneData(next);
            this.pluginData.gaokao = cloneData(next);
            return; // A reported error after a confirmed durable save is not zero writes.
        }
        if (!sameRoundData(disk?.gaokao, this.confirmedDiskGaokao)) {
            this.uncertainWrite = true;
        }
        throw new PluginDataError(saveError instanceof Error ? saveError.message : "插件数据保存未通过持久回读；未覆盖或重试。");
    }

    private async enqueue<T>(operation: () => Promise<T>): Promise<T> {
        const result = this.writeQueue.then(operation, operation);
        this.writeQueue = result.then((): void => undefined, (): void => undefined);
        return await result;
    }

    /**
     * Writes the settings to the plugin data.
     *
     * @param {SRSettings} settings - The settings to write.
     * @returns {Promise<void>} - A promise that resolves when the settings are written.
     * @throws {Error} - Throws an error if the plugin data is not loaded.
     */
    public async writeSettings(settings: SRSettings): Promise<void> {
        if (this.pluginData === null)
            throw new PluginDataError(
                "Cant write settings, as the plugin data is not yet loaded!!",
            );
        this.pluginData.settings = settings;
        await this.savePluginData();
    }
}

function cloneData<T>(value: T): T {
    return value === undefined ? value : JSON.parse(JSON.stringify(value)) as T;
}
