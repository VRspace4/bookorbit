// anna-fast: ShadowLib's search, with Anna's Archive member fast downloads in front of its own mirrors.
//
// Why: Anna's search pages sit behind DDoS-Guard, which neither plain fetch nor our TRAWL helper passes
// from home (2026-11-01), but the member API `/dyn/api/fast_download.json` is not guarded. Anna's
// holds the LibGen / Z-Library files under the same md5, so a search answered by those libraries can
// still be downloaded through the fast API: fast, and no flaky LibGen mirror (one served a stock nginx
// page as the "book" on 2026-11-01).
//
// Needs the ShadowLib plugin (orbitverse/bookorbit-shadowlib-plugin, pinned release) installed next to
// this directory as `../bookorbit-shadowlib-plugin/index.mjs`. Credential: ShadowLib's account JSON,
// `{"annas":{"key":"<member key>"}}` (plus `zlibrary` if used). Use ShadowLib's `libraries` setting
// without `annas`: its Anna's search only burns the search budget on 403s.
const ANNAS_ORIGINS = ["https://annas-archive.gl", "https://annas-archive.pk", "https://annas-archive.gd"];
const MD5 = /^[a-f0-9]{32}$/i;

export function wrap(shadow) {
  const { update: _update, fetchTorrentFile: _torrent, ...rest } = shadow;
  return {
    ...rest,
    apiVersion: 1,
    version: "0.1.0",
    type: "anna-fast",
    label: "Anna's Archive fast downloads (via ShadowLib search)",
    // ponytail: ShadowLib also lists audiobooks, but its libraries hold almost none; ebooks only.
    mediaKinds: ["ebook"],
    async resolveFile(release, config, host, signal) {
      const key = annasKey(config.credential);
      const md5 = md5Of(release.guid);
      if (key && md5) {
        for (const origin of ANNAS_ORIGINS) {
          const url = await fastLink(origin, md5, key, host);
          if (url === "stop") break;
          if (url) {
            const format = (release.format || "epub").toLowerCase();
            return { url, fileName: `${safeName(release.bookTitle || release.title)}.${format}`, sizeBytes: release.sizeBytes ?? null, format };
          }
        }
      }
      return shadow.resolveFile(release, config, host, signal);
    },
  };
}

/** A fast link, null to try the next mirror, or 'stop' when Anna's itself said no (quota, key). */
async function fastLink(origin, md5, key, host) {
  const api = new URL("/dyn/api/fast_download.json", origin);
  api.searchParams.set("md5", md5);
  api.searchParams.set("key", key);
  let body;
  try {
    const res = await host.fetch(api.href, { headers: { Accept: "application/json" }, redirect: "manual" });
    body = await res.json();
  } catch {
    host.logger.warn(`anna-fast: ${origin} did not answer; trying the next mirror.`);
    return null;
  }
  const link = typeof body?.download_url === "string" ? body.download_url : "";
  if (link.startsWith("https://")) return link;
  // Anna's answered with a reason (no downloads left, unknown md5, bad key): another mirror says the same.
  host.logger.warn(`anna-fast: no fast download (${String(body?.error ?? "no link").slice(0, 80)}); using the libraries.`);
  return "stop";
}

function annasKey(credential) {
  try {
    const key = JSON.parse(credential ?? "")?.annas?.key;
    return typeof key === "string" && key.trim() ? key.trim() : null;
  } catch {
    return null;
  }
}

function md5Of(guid) {
  try {
    const ids = (JSON.parse(guid)?.locations ?? []).map((l) => String(l?.id ?? ""));
    return ids.find((id) => MD5.test(id))?.toLowerCase() ?? null;
  } catch {
    return null;
  }
}

function safeName(title) {
  return (
    String(title)
      .replace(/\s*·\s*[^·]*$/, "")
      .replace(/[\\/:*?"<>|\u0000-\u001f]/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 150) || "book"
  );
}
