/* eslint-disable camelcase -- Synthetic plugin JSON; no disk or Vault access. */
import { PluginDataManager } from "src/data/plugin-data-manager";
import { DEFAULT_DATA } from "src/data/plugin-data";
import { GaokaoManager } from "src/gaokao/gaokao-manager";
import { PendingRoundCommit } from "src/gaokao/review-flow";

jest.mock("src/parser", () => ({ setDebugParser: jest.fn() }));
const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
const pending: PendingRoundCommit = { schedule_before: null, event: {
    event_id: "fixed-synthetic", entity_id: "synthetic", event_type: "study", timestamp: "2026-09-06T10:00:00Z",
    source_path: "synthetic.md", cycle_ref: null, schedule_after: { due: "2026-09-07", interval: 1, ease: 250 },
} };
async function harness() {
    let disk = clone(DEFAULT_DATA);
    let failReads = false;
    const plugin = {
        loadData: jest.fn(async () => { if (failReads) throw new Error("unreadable"); return clone(disk); }),
        saveData: jest.fn(async (payload: typeof DEFAULT_DATA) => { disk = clone(payload); }),
    };
    const store = new PluginDataManager(plugin as never);
    await store.loadData();
    return { plugin, store, get disk() { return disk; }, replaceDisk: (next: typeof DEFAULT_DATA) => { disk = clone(next); },
        failReads: () => { failReads = true; } };
}

describe("T12 T14 shared save/readback boundary", () => {
    test("settings/bury saves cannot overwrite a newly prepared pending or committed event", async () => {
        const h = await harness();
        const prepare = h.store.withGaokaoTransaction(async (tx) => {
            await tx.save({ ...tx.data, version: 2, pendingRoundCommit: pending });
        });
        h.store.pluginData.buryList.push("synthetic-card");
        await Promise.all([prepare, h.store.writeSettings({ ...h.store.pluginData.settings, autoNextNote: true }), h.store.savePluginData()]);
        expect(h.disk.gaokao.pendingRoundCommit).toEqual(pending);
        expect(h.disk.buryList).toEqual(["synthetic-card"]);
        expect(h.disk.settings.autoNextNote).toBe(true);
        const finish = h.store.withGaokaoTransaction(async (tx) => {
            const next = { ...tx.data, learningEvents: [pending.event] }; delete next.pendingRoundCommit;
            await tx.save(next);
        });
        await Promise.all([finish, h.store.savePluginData()]);
        expect(h.disk.gaokao.learningEvents).toEqual([pending.event]);
        expect(h.disk.gaokao).not.toHaveProperty("pendingRoundCommit");
    });

    test("ordinary events serialize with pending and preserve fixed IDs", async () => {
        const h = await harness();
        const manager = new GaokaoManager({ getData: () => h.store.pluginData.gaokao,
            transact: async (operation) => await h.store.withGaokaoTransaction(operation),
            eventFactory: { createId: () => "ordinary", now: () => new Date("2026-09-06T12:00:00Z") } });
        manager.updateEntitySource("synthetic.md", { gaokao_id: "synthetic", entity_type: "knowledge_point", subject: "数学" });
        await Promise.all([
            h.store.withGaokaoTransaction(async (tx) => await tx.save({ ...tx.data, pendingRoundCommit: pending })),
            manager.recordForPath("synthetic.md", { event_type: "practice" }),
            h.store.savePluginData(),
        ]);
        expect(h.disk.gaokao.pendingRoundCommit).toEqual(pending);
        expect(h.disk.gaokao.learningEvents.map((event) => event.event_id)).toEqual(["ordinary"]);
        expect(h.disk.gaokao.learningEvents[0]).not.toHaveProperty("cycle_ref");
    });

    test("save throws after landing: durable readback confirms it once", async () => {
        const h = await harness();
        h.plugin.saveData.mockImplementation(async (payload) => { h.replaceDisk(payload); throw new Error("after write"); });
        await expect(h.store.withGaokaoTransaction(async (tx) => await tx.save({ ...tx.data, pendingRoundCommit: pending }))).resolves.toBeUndefined();
        expect(h.store.pluginData.gaokao.pendingRoundCommit).toEqual(pending);
        expect(h.plugin.saveData).toHaveBeenCalledTimes(1);
    });

    test("save before landing does not expose the candidate as history", async () => {
        const h = await harness();
        h.plugin.saveData.mockRejectedValue(new Error("before write"));
        await expect(h.store.withGaokaoTransaction(async (tx) => await tx.save({ ...tx.data, learningEvents: [pending.event] }))).rejects.toThrow();
        expect(h.store.pluginData.gaokao.learningEvents).toEqual([]);
        expect(h.disk.gaokao.learningEvents).toEqual([]);
    });

    test("unknown readback freezes subsequent saves and keeps pending visible", async () => {
        const h = await harness();
        h.plugin.saveData.mockImplementation(async (payload) => { h.replaceDisk(payload); h.failReads(); });
        await expect(h.store.withGaokaoTransaction(async (tx) => await tx.save({ ...tx.data, pendingRoundCommit: pending }))).rejects.toThrow();
        expect(h.store.pluginData.gaokao.pendingRoundCommit).toEqual(pending);
        expect(h.store.pluginData.gaokao.learningEvents).toEqual([]);
        await expect(h.store.savePluginData()).rejects.toThrow(/停止/);
        expect(h.plugin.saveData).toHaveBeenCalledTimes(1);
    });

    test("external event change is detected before a settings overwrite", async () => {
        const h = await harness();
        h.replaceDisk({ ...h.disk, gaokao: { ...h.disk.gaokao, learningEvents: [pending.event] } });
        await expect(h.store.savePluginData()).rejects.toThrow(/外部变化/);
        expect(h.plugin.saveData).not.toHaveBeenCalled();
    });
});

describe("T07 T10 T28 loader preservation and restart", () => {
    test("preserves old events, duration and unknown fields without writing or upgrading history", async () => {
        const h = await harness();
        const old = { event_id: "old", entity_id: "synthetic", event_type: "review" as const,
            timestamp: "2026-08-01T12:00:00Z", rating: "hard" as const, duration_minutes: 14, extension_fact: { retain: true } };
        h.replaceDisk({ ...h.disk, gaokao: { version: 1, learningEvents: [old], custom: { untouched: "yes" } } });
        const bytes = JSON.stringify(h.disk.gaokao);
        await h.store.loadData();
        expect(JSON.stringify(h.store.pluginData.gaokao)).toBe(bytes);
        expect(h.plugin.saveData).not.toHaveBeenCalled();
    });
    test("restart retains full pending but performs no recovery writes", async () => {
        const h = await harness();
        h.replaceDisk({ ...h.disk, gaokao: { version: 2, learningEvents: [], pendingRoundCommit: pending, extension: 7 } });
        await h.store.loadData();
        expect(h.store.pluginData.gaokao).toEqual(h.disk.gaokao);
        expect(h.plugin.saveData).not.toHaveBeenCalled();
    });
    test.each([
        { version: 3, learningEvents: [] },
        { version: 1, learningEvents: [pending.event] },
        { version: 2, learningEvents: [], pendingRoundCommit: { event: {} } },
    ])("unknown or inconsistent data is rejected, never replaced %#", async (gaokao) => {
        const h = await harness();
        h.plugin.loadData.mockResolvedValue({ ...h.disk, gaokao } as never);
        await expect(h.store.loadData()).rejects.toThrow();
        expect(h.plugin.saveData).not.toHaveBeenCalled();
    });
});
