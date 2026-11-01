// Offline checks for abb-torbox. Run: node --test rtw-plugins/indexers/abb-torbox/verify.mjs
import assert from "node:assert/strict";
import { test } from "node:test";

import { wrap } from "./wrap.mjs";

const KEY = "tb-key-123";
const H1 = "1f3e48ed68a55d53700fb62894d277eeda7fd978";
const H2 = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const page = (slug) => `https://audiobookbay.lu/abss/${slug}/`;
const abbReleases = [
  {
    guid: page("phm-m4b"),
    title: "Project Hail Mary - Andy Weir",
    bookTitle: "Project Hail Mary",
    format: "m4b",
    sizeBytes: 1,
    seeders: null,
    leechers: null,
    primaryFileCount: 1,
  },
  {
    guid: page("phm-mp3"),
    title: "Project Hail Mary - Andy Weir",
    bookTitle: "Project Hail Mary",
    format: "mp3",
    sizeBytes: 2,
    seeders: null,
    leechers: null,
    primaryFileCount: 1,
  },
];
const hashes = { [page("phm-m4b")]: H1.toUpperCase(), [page("phm-mp3")]: H2.toUpperCase() };

function fakeAbb() {
  const seen = [];
  const plugin = {
    apiVersion: 1,
    type: "audiobookbay",
    label: "AudiobookBay",
    version: "0.1.1",
    update: { manifestUrl: "https://example.invalid/m.json", ed25519PublicKey: "x" },
    requiresCredential: true,
    credentialKind: "apiKey",
    mediaKinds: ["audiobook"],
    usesCategories: false,
    seedsBack: true,
    defaultBaseUrl: "https://audiobookbay.lu",
    settingsFields: [
      { key: "username", type: "string", label: "AudiobookBay username" },
      { key: "maxPages", type: "number", label: "Max search pages", default: 1 },
    ],
    search: async (_q, config) => {
      seen.push(config.credential);
      return abbReleases;
    },
    test: async () => ({ success: true, indexerName: "AudiobookBay" }),
    fetchTorrentFile: async () => {
      throw new Error("never used");
    },
  };
  const resolveMagnet = async (release, config) => {
    seen.push(config.credential);
    return `magnet:?xt=urn:btih:${hashes[release.guid]}&tr=udp%3A%2F%2Ft`;
  };
  return { plugin, resolveMagnet, seen };
}

/** TorBox stand-in: H1 is cached as a 2-file m4b torrent, H2 is not cached. */
function torbox({
  files = [
    { id: 0, name: "PHM/Project Hail Mary.m4b", size: 900 },
    { id: 1, name: "PHM/cover.jpg", size: 9 },
  ],
  readyAfter = 0,
  cached = [H1],
} = {}) {
  const calls = [];
  let polls = 0;
  const ok = (data) => new Response(JSON.stringify({ success: true, error: null, data }), { headers: { "Content-Type": "application/json" } });
  const host = {
    calls,
    fetch: async (url, init = {}) => {
      const u = new URL(url);
      calls.push({ path: u.pathname.split("/").pop(), url, init });
      assert.equal(u.origin, "https://api.torbox.app");
      const path = u.pathname.split("/").pop();
      if (path === "requestdl") return ok(`https://store.tb-cdn.st/zip/1?token=${u.searchParams.get("token")}`);
      assert.equal(init.headers?.Authorization, `Bearer ${KEY}`);
      if (path === "checkcached") {
        const wanted = JSON.parse(init.body).hashes;
        return ok(Object.fromEntries(wanted.filter((h) => cached.includes(h)).map((h) => [h, { hash: h, name: "PHM", size: 909, files }])));
      }
      if (path === "createtorrent") {
        if (!/name="add_only_if_cached"\r\n\r\ntrue/.test(init.body)) throw new Error("must add cached only");
        const hash = /btih:([0-9a-f]+)/i.exec(init.body)[1].toLowerCase();
        if (!cached.includes(hash)) return new Response(JSON.stringify({ success: false, error: "DOWNLOAD_NOT_CACHED", data: null }));
        return ok({ torrent_id: 42, hash });
      }
      if (path === "mylist") {
        polls += 1;
        return ok({ id: 42, hash: H1, download_finished: polls > readyAfter, download_present: polls > readyAfter, files });
      }
      throw new Error(`unexpected ${url}`);
    },
    logger: { log() {}, warn() {} },
    fail: (failure, message) => Object.assign(new Error(message), { failure }),
  };
  return host;
}

const config = (credential = KEY) => ({
  id: 3,
  name: "abb",
  baseUrl: "https://audiobookbay.lu",
  credential,
  allowPrivateAddress: false,
  settings: { maxPages: 1 },
});
const query = { title: "Project Hail Mary", author: "Andy Weir", isbn13: null, isbn13s: [], mediaKind: "audiobook", language: "en", limit: 20 };

test("declares a TorBox direct-file source, not a torrent one", () => {
  const { plugin, resolveMagnet } = fakeAbb();
  const p = wrap(plugin, resolveMagnet);
  assert.equal(p.type, "abb-torbox");
  assert.equal(p.seedsBack, false);
  assert.equal(p.requiresCredential, true);
  assert.equal(p.fetchTorrentFile, undefined);
  assert.equal(typeof p.resolveFile, "function");
  assert.equal(p.update, undefined);
  assert.deepEqual(p.mediaKinds, ["audiobook"]);
  assert.deepEqual(
    p.settingsFields.map((f) => f.key),
    ["maxPages"],
  );
});

test("search keeps only what TorBox has cached, and AudiobookBay never sees the TorBox key", async () => {
  const abb = fakeAbb();
  const results = await wrap(abb.plugin, abb.resolveMagnet).search(query, config(), torbox(), AbortSignal.timeout(5000));
  assert.equal(results.length, 1);
  assert.equal(results[0].guid, page("phm-m4b"));
  assert.equal(results[0].infoHash, H1);
  assert.equal(results[0].sizeBytes, 909);
  assert.equal(results[0].primaryFileCount, 1);
  assert.equal(results[0].magnet, undefined);
  assert.ok(abb.seen.length >= 3 && abb.seen.every((c) => c === null));
});

test("search without a TorBox key is refused as unauthorized", async () => {
  const abb = fakeAbb();
  await assert.rejects(wrap(abb.plugin, abb.resolveMagnet).search(query, config(null), torbox(), AbortSignal.timeout(5000)), {
    failure: "unauthorized",
  });
});

test("a multi-file release becomes one zip link from TorBox", async () => {
  const abb = fakeAbb();
  const tb = torbox();
  const p = wrap(abb.plugin, abb.resolveMagnet, { pollMs: 1 });
  const [release] = await p.search(query, config(), tb, AbortSignal.timeout(5000));
  const file = await p.resolveFile(release, config(), tb, AbortSignal.timeout(5000));
  assert.equal(file.format, "zip");
  assert.equal(file.fileName, "Project Hail Mary - Andy Weir.zip");
  assert.match(file.url, /^https:\/\/store\.tb-cdn\.st\//);
  const dl = new URL(tb.calls.find((c) => c.path === "requestdl").url);
  assert.equal(dl.searchParams.get("torrent_id"), "42");
  assert.equal(dl.searchParams.get("zip_link"), "true");
});

test("a single-file release links the file itself and waits until TorBox has it ready", async () => {
  const abb = fakeAbb();
  const tb = torbox({ files: [{ id: 7, name: "PHM/Project Hail Mary.m4b", size: 900 }], readyAfter: 2 });
  const p = wrap(abb.plugin, abb.resolveMagnet, { pollMs: 1 });
  const [release] = await p.search(query, config(), tb, AbortSignal.timeout(5000));
  const file = await p.resolveFile(release, config(), tb, AbortSignal.timeout(5000));
  assert.equal(file.format, "m4b");
  assert.equal(file.fileName, "Project Hail Mary.m4b");
  assert.equal(new URL(tb.calls.find((c) => c.path === "requestdl").url).searchParams.get("file_id"), "7");
  assert.ok(tb.calls.filter((c) => c.path === "mylist").length >= 3);
});

test("a release TorBox no longer has cached fails instead of downloading from the swarm", async () => {
  const abb = fakeAbb();
  const p = wrap(abb.plugin, abb.resolveMagnet, { pollMs: 1 });
  const tb = torbox({ cached: [] });
  await assert.rejects(p.resolveFile({ ...abbReleases[1], infoHash: H2 }, config(), tb, AbortSignal.timeout(5000)), /cached/i);
  assert.equal(
    tb.calls.some((c) => c.path === "requestdl"),
    false,
  );
});
