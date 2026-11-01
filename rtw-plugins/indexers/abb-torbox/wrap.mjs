// abb-torbox: AudiobookBay's search, delivered through TorBox's cache instead of a torrent client.
//
// Why: BookOrbit sends every torrent to one preferred client, and that client is MyAnonamouse's
// (seeding rules, its own VPN). AudiobookBay must not join it, so this source never hands BookOrbit a
// torrent: it keeps only releases TorBox already has cached and resolves each grab to a TorBox link,
// which BookOrbit downloads directly (a zip for multi-file books; the importer unpacks it).
//
// Needs the AudiobookBay plugin (nabukado/bookorbit-audiobookbay-plugin, pinned) installed next to
// this directory as `../audiobookbay/index.mjs`. Credential: the TorBox API key. AudiobookBay's own
// search is anonymous, so it is never given that key.
//
// ponytail: grabbed torrents stay in the TorBox account (TorBox Pro has room); prune by age if the
// list ever gets in the way.

const API = "https://api.torbox.app/v1/api/torrents/";
const MAX_LOOKUPS = 6; // detail pages read per search; AudiobookBay paces each at >= 1 s
const READY_TIMEOUT_MS = 90_000;
const BOOK_FILES = /\.(m4b|m4a)$/i;

export function wrap(abb, resolveMagnet, { pollMs = 3000 } = {}) {
  const { update: _update, fetchTorrentFile: _torrent, ...rest } = abb;
  const anonymous = (config) => ({ ...config, credential: null });

  return {
    ...rest,
    apiVersion: 1,
    version: "0.1.0",
    type: "abb-torbox",
    label: "AudiobookBay via TorBox (cached only)",
    requiresCredential: true,
    credentialKind: "apiKey",
    mediaKinds: ["audiobook"],
    seedsBack: false,
    baseUrlHint: "AudiobookBay mirror to search. Put the TorBox API key in the API key field.",
    settingsFields: (abb.settingsFields ?? []).filter((field) => field.key !== "username"),

    async search(query, config, host, signal) {
      const key = keyOf(config, host);
      const found = await abb.search(query, anonymous(config), host, signal);
      const withHash = [];
      for (const release of found.slice(0, MAX_LOOKUPS)) {
        if (signal?.aborted) break;
        try {
          withHash.push({ release, hash: hashOf(await resolveMagnet(release, anonymous(config), host)) });
        } catch (error) {
          host.logger.warn(`abb-torbox: no info hash for a release (${String(error?.message ?? error).slice(0, 80)})`);
        }
      }
      if (withHash.length === 0) return [];
      const cache = await call(host, key, "checkcached?format=object&list_files=true", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ hashes: withHash.map((entry) => entry.hash) }),
      });
      return withHash
        .filter(({ hash }) => cache?.[hash])
        .map(({ release, hash }) => {
          const files = cache[hash].files ?? [];
          const { magnet: _magnet, downloadUrl: _url, ...kept } = release;
          return {
            ...kept,
            infoHash: hash,
            sizeBytes: Number(cache[hash].size) || release.sizeBytes,
            // Each m4b is a whole book; mp3 tracks together are one.
            primaryFileCount: files.filter((file) => BOOK_FILES.test(file.name)).length || 1,
          };
        });
    },

    async resolveFile(release, config, host, signal) {
      const key = keyOf(config, host);
      const hash = release.infoHash ? hashOf(release.infoHash) : hashOf(await resolveMagnet(release, anonymous(config), host));
      const torrent = await addCached(host, key, hash);
      const ready = await waitReady(host, key, torrent, signal, pollMs);
      const files = ready.files ?? [];
      const single = files.length === 1 ? files[0] : null;
      const params = new URLSearchParams({
        token: key,
        torrent_id: String(ready.id),
        ...(single ? { file_id: String(single.id) } : { zip_link: "true" }),
      });
      // The link carries the key as `token`: TorBox's design. BookOrbit keeps it while downloading.
      const url = await call(host, key, `requestdl?${params}`);
      if (typeof url !== "string" || !url.startsWith("https://")) throw host.fail("error", "TorBox returned no download link");
      if (single) {
        const fileName = single.name.split("/").pop();
        return { url, fileName, sizeBytes: Number(single.size) || null, format: (fileName.split(".").pop() || "m4b").toLowerCase() };
      }
      return {
        url,
        fileName: `${safeName(release.title)}.zip`,
        sizeBytes: files.reduce((sum, file) => sum + (Number(file.size) || 0), 0) || null,
        format: "zip",
      };
    },
  };
}

async function addCached(host, key, hash) {
  const boundary = `rtw-${crypto.randomUUID()}`;
  const fields = { magnet: `magnet:?xt=urn:btih:${hash}`, add_only_if_cached: "true", allow_zip: "true", seed: "3" };
  const body =
    Object.entries(fields)
      .map(([name, value]) => `--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`)
      .join("") + `--${boundary}--\r\n`;
  const created = await call(host, key, "createtorrent", {
    method: "POST",
    headers: { "Content-Type": `multipart/form-data; boundary=${boundary}` },
    body,
  });
  if (!Number.isInteger(created?.torrent_id)) throw host.fail("error", "TorBox did not add the torrent");
  return created.torrent_id;
}

async function waitReady(host, key, id, signal, pollMs) {
  const deadline = Date.now() + READY_TIMEOUT_MS;
  for (;;) {
    const item = await call(host, key, `mylist?id=${id}&bypass_cache=true`);
    if (item?.download_finished && item?.download_present && item.files?.length) return item;
    if (Date.now() > deadline || signal?.aborted) throw host.fail("timeout", "TorBox did not have the files ready in time");
    await new Promise((resolve) => setTimeout(resolve, pollMs));
  }
}

async function call(host, key, path, init = {}) {
  let body;
  try {
    const res = await host.fetch(API + path, { ...init, headers: { Authorization: `Bearer ${key}`, ...init.headers } });
    body = await res.json();
  } catch {
    throw host.fail("unreachable", "TorBox did not answer");
  }
  if (body?.success) return body.data;
  const code = String(body?.error ?? "");
  if (/AUTH|TOKEN|API_KEY/i.test(code)) throw host.fail("unauthorized", "TorBox rejected the API key");
  if (/LIMIT|RATE/i.test(code)) throw host.fail("throttled", "TorBox is rate limiting; try again shortly");
  if (/CACHE/i.test(code)) throw host.fail("error", "TorBox no longer has this release cached; search again");
  throw host.fail("error", `TorBox refused the request (${code.slice(0, 60) || "no reason given"})`);
}

function keyOf(config, host) {
  const key = String(config.credential ?? "").trim();
  if (!key) throw host.fail("unauthorized", "Add the TorBox API key in the API key field");
  return key;
}

function hashOf(magnetOrHash) {
  const match = /(?:btih:)?([0-9a-f]{40})/i.exec(String(magnetOrHash));
  if (!match) throw new Error("no v1 info hash");
  return match[1].toLowerCase();
}

function safeName(title) {
  return (
    String(title)
      .replace(/[\\/:*?"<>|\u0000-\u001f]/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 150) || "audiobook"
  );
}
