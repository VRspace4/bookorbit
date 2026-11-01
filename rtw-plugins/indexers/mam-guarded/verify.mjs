// Offline checks for mam-guarded. Run: node --test rtw-plugins/indexers/mam-guarded/verify.mjs
import assert from "node:assert/strict";
import { test } from "node:test";

import { SEED_MINUTES, wrap } from "./wrap.mjs";

const TORRENT = new Uint8Array([0x64, 0x65]);
const release = {
  guid: "123",
  title: "Book",
  downloadUrl: "https://www.myanonamouse.net/tor/download.php?tid=123",
  sizeBytes: 1,
  seeders: 5,
  leechers: 0,
};
const config = { id: 4, name: "mam", baseUrl: "https://www.myanonamouse.net", credential: "mam-session", settings: { dynamicSeedbox: true } };

/** The community plugin, reduced to what the wrapper relies on: test() and grabs go through host.fetch. */
function fakeMam(user) {
  const grabs = [];
  return {
    grabs,
    plugin: {
      apiVersion: 1,
      type: "myanonamouse",
      label: "MyAnonaMouse",
      version: "1.4.0",
      update: { manifestUrl: "https://example.invalid/m.json", ed25519PublicKey: "x" },
      requiresCredential: true,
      credentialKind: "sessionId",
      mediaKinds: ["ebook", "audiobook"],
      usesCategories: true,
      seedsBack: true,
      settingsFields: [{ key: "dynamicSeedbox", type: "boolean", label: "seedbox" }],
      search: async () => [{ ...release }, { ...release, guid: "124", seedTimeMinutes: 60 }],
      test: async (_config, host) => {
        const res = await host.fetch("https://www.myanonamouse.net/jsonLoad.php?snatch_summary", { method: "GET" });
        await res.json();
        return { success: true };
      },
      fetchTorrentFile: async (r, _config, host) => {
        await host.fetch(r.downloadUrl, { method: "GET" });
        grabs.push(r.guid);
        return TORRENT;
      },
      keepalive: async () => {},
      forget: () => {},
    },
    host: {
      fetch: async (url) => (url.includes("jsonLoad.php") ? new Response(JSON.stringify(user)) : new Response(TORRENT)),
      logger: { log() {}, warn() {} },
      fail: (failure, message) => Object.assign(new Error(message), { failure }),
    },
  };
}

const healthy = { classname: "User", ratio: 2.4, uploaded_bytes: 24e9, downloaded_bytes: 1e10, snatch_summary: { unsat: { count: 3, limit: 50 } } };

test("declares its own torrent source and keeps the session plugin’s settings", () => {
  const p = wrap(fakeMam(healthy).plugin);
  assert.equal(p.type, "mam-guarded");
  assert.equal(p.update, undefined);
  assert.equal(p.seedsBack, true);
  assert.equal(typeof p.fetchTorrentFile, "function");
  assert.equal(typeof p.keepalive, "function");
  assert.deepEqual(
    p.settingsFields.map((f) => f.key),
    ["dynamicSeedbox"],
  );
});

test("every release asks to seed 73 hours, never a ratio, whatever the tracker suggested", async () => {
  const mam = fakeMam(healthy);
  const results = await wrap(mam.plugin).search({}, config, mam.host, AbortSignal.timeout(1000));
  assert.equal(SEED_MINUTES, 73 * 60);
  for (const r of results) {
    assert.equal(r.seedTimeMinutes, SEED_MINUTES);
    assert.equal(r.seedRatioGoal, undefined);
  }
});

test("a healthy account grabs", async () => {
  const mam = fakeMam(healthy);
  assert.deepEqual(await wrap(mam.plugin).fetchTorrentFile(release, config, mam.host), TORRENT);
  assert.deepEqual(mam.grabs, ["123"]);
});

for (const [why, user] of [
  ["ratio under 1.05", { ...healthy, ratio: 1.04 }],
  ["ratio given as text under 1.05", { ...healthy, ratio: "0.98" }],
  ["unsatisfied within 5 of the limit", { ...healthy, snatch_summary: { unsat: { count: 45, limit: 50 } } }],
  ["no limit stated, so the new-member 20 applies", { ...healthy, snatch_summary: { unsat: { count: 15 } } }],
  ["no unsatisfied count at all", { ...healthy, snatch_summary: {} }],
  ["no ratio at all", { classname: "User", snatch_summary: { unsat: { count: 0, limit: 50 } } }],
]) {
  test(`refuses the grab: ${why}`, async () => {
    const mam = fakeMam(user);
    await assert.rejects(wrap(mam.plugin).fetchTorrentFile(release, config, mam.host), { failure: "throttled" });
    assert.deepEqual(mam.grabs, []);
  });
}

test("refuses a grab that would take the ratio under 1.0, even from 1.05", async () => {
  const user = { ...healthy, ratio: 1.05, uploaded_bytes: 10.5e9, downloaded_bytes: 10e9 };
  const mam = fakeMam(user);
  await assert.rejects(wrap(mam.plugin).fetchTorrentFile({ ...release, sizeBytes: 1e9 }, config, mam.host), { failure: "throttled" });
  assert.deepEqual(mam.grabs, []);
});

test("a new account needs upload credit first, then grabs inside it", async () => {
  const fresh = { classname: "User", ratio: "Inf", downloaded_bytes: 0, snatch_summary: { unsat: { count: 0, limit: 20 } } };
  const none = fakeMam({ ...fresh, uploaded_bytes: 0 });
  await assert.rejects(wrap(none.plugin).fetchTorrentFile({ ...release, sizeBytes: 1e9 }, config, none.host), { failure: "throttled" });
  const credited = fakeMam({ ...fresh, uploaded_bytes: 10 * 2 ** 30 });
  assert.deepEqual(await wrap(credited.plugin).fetchTorrentFile({ ...release, sizeBytes: 1e9 }, config, credited.host), TORRENT);
});

test("nothing that spends freeleech ever reaches MAM", async () => {
  const mam = fakeMam(healthy);
  const p = wrap(mam.plugin);
  for (const url of [
    "https://www.myanonamouse.net/tor/download.php?tid=123&fl",
    "https://www.myanonamouse.net/json/bonusBuy.php?spendtype=personalFL&torrentid=1",
  ]) {
    await assert.rejects(p.fetchTorrentFile({ ...release, downloadUrl: url }, config, mam.host), /freeleech/i);
  }
  assert.deepEqual(mam.grabs, []);
});
