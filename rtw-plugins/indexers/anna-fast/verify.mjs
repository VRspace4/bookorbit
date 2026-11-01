// Offline checks for anna-fast. Run: node --test rtw-plugins/indexers/anna-fast/verify.mjs
import assert from "node:assert/strict";
import { test } from "node:test";

import { wrap } from "./wrap.mjs";

const MD5 = "f21ef754f3c4b986f3896807d80a6ce1";
const release = {
  guid: JSON.stringify({ locations: [{ family: "libgen", origin: "https://libgen.bz", id: MD5 }] }),
  title: "Project Hail Mary · LibGen",
  bookTitle: "Project Hail Mary",
  format: "epub",
  sizeBytes: 9823309,
  seeders: null,
  leechers: null,
};
const config = (credential = JSON.stringify({ annas: { key: "k".repeat(32) } })) => ({
  id: 7,
  name: "a",
  baseUrl: "https://open-slum.org",
  credential,
  settings: {},
});

function fakeShadow() {
  const calls = [];
  return {
    calls,
    plugin: {
      apiVersion: 1,
      type: "bookorbit-shadowlib-plugin",
      label: "ShadowLib",
      version: "0.1.25",
      update: { manifestUrl: "https://example.invalid/m.json", ed25519PublicKey: "x" },
      requiresCredential: false,
      credentialKind: "apiKey",
      mediaKinds: ["ebook", "audiobook"],
      usesCategories: false,
      seedsBack: false,
      settingsFields: [],
      search: async () => [release],
      test: async () => ({ success: true }),
      resolveFile: async (r) => {
        calls.push(r.guid);
        return { url: "https://libgen.example/file.epub", fileName: "x.epub", sizeBytes: null, format: "epub" };
      },
    },
  };
}

function host(answer) {
  const urls = [];
  return {
    urls,
    fetch: async (url) => {
      urls.push(url);
      const body = typeof answer === "function" ? answer(url) : answer;
      return new Response(JSON.stringify(body), { status: body.download_url ? 200 : 403, headers: { "Content-Type": "text/json" } });
    },
    logger: { log() {}, warn() {} },
    fail: (failure, message) => Object.assign(new Error(message), { failure }),
  };
}

test("declares itself as its own ebook-only source with no update channel", () => {
  const plugin = wrap(fakeShadow().plugin);
  assert.equal(plugin.type, "anna-fast");
  assert.deepEqual(plugin.mediaKinds, ["ebook"]);
  assert.equal(plugin.update, undefined);
  assert.equal(typeof plugin.resolveFile, "function");
  assert.equal(plugin.fetchTorrentFile, undefined);
});

test("a release's md5 goes to Anna's fast download first", async () => {
  const shadow = fakeShadow();
  const h = host({ download_url: "https://fast.example/abc/Project.epub", account_fast_download_info: { downloads_left: 24 } });
  const file = await wrap(shadow.plugin).resolveFile(release, config(), h, AbortSignal.timeout(5000));
  assert.equal(file.url, "https://fast.example/abc/Project.epub");
  assert.equal(file.format, "epub");
  assert.equal(file.fileName, "Project Hail Mary.epub");
  assert.equal(file.sizeBytes, 9823309);
  assert.match(h.urls[0], new RegExp(`/dyn/api/fast_download\\.json\\?md5=${MD5}&key=k{32}$`));
  assert.equal(shadow.calls.length, 0);
});

test("falls back to the libraries when the day’s fast downloads are used up", async () => {
  const shadow = fakeShadow();
  const h = host({ download_url: null, error: "No downloads left" });
  const file = await wrap(shadow.plugin).resolveFile(release, config(), h, AbortSignal.timeout(5000));
  assert.equal(file.url, "https://libgen.example/file.epub");
  assert.equal(shadow.calls.length, 1);
});

test("tries the next Anna’s mirror when one is down", async () => {
  const h = host((url) =>
    url.startsWith("https://annas-archive.gl") ? { download_url: null, error: "down" } : { download_url: "https://fast.example/b.epub" },
  );
  h.fetch = ((inner) => async (url) => (url.startsWith("https://annas-archive.gl") ? Promise.reject(new Error("ECONNRESET")) : inner(url)))(h.fetch);
  const file = await wrap(fakeShadow().plugin).resolveFile(release, config(), h, AbortSignal.timeout(5000));
  assert.equal(file.url, "https://fast.example/b.epub");
});

test("without an Anna’s key, or without an md5, it goes straight to the libraries", async () => {
  for (const [r, c] of [
    [release, config(JSON.stringify({}))],
    [release, config(null)],
    [{ ...release, guid: JSON.stringify({ locations: [{ family: "liber3", id: "QmYwAPJzv5CZsnA625s3Xf2nemtYgPpHdWEz79ojWnPbdG" }] }) }, config()],
  ]) {
    const shadow = fakeShadow();
    const h = host({ download_url: "https://fast.example/never" });
    const file = await wrap(shadow.plugin).resolveFile(r, c, h, AbortSignal.timeout(5000));
    assert.equal(file.url, "https://libgen.example/file.epub");
    assert.equal(h.urls.length, 0);
  }
});

test("never follows a fast link that is not https", async () => {
  const shadow = fakeShadow();
  const file = await wrap(shadow.plugin).resolveFile(
    release,
    config(),
    host({ download_url: "http://fast.example/a.epub" }),
    AbortSignal.timeout(5000),
  );
  assert.equal(file.url, "https://libgen.example/file.epub");
});
