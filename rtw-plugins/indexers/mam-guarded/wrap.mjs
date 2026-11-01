// mam-guarded: the community MyAnonaMouse plugin with MAM's seeding rules enforced around it.
//
// Rules (rules.php, read 2026-11-01; docs/architecture/books.md in the stremio repo):
//   - seed each torrent 72 h within 30 days, "and no more after" (James): every release asks the
//     client for 73 h (1 h margin), never a ratio; qBittorrent removes the torrent and its data at
//     the limit (the library keeps its hardlinked copy).
//   - global ratio >= 1.0: no grab below 1.05, nor one whose own size would take
//     uploaded / (downloaded + size) under 1.0. A new account therefore needs its starting bonus
//     points traded for upload credit (rule 2.6: don't download past that buffer) before a grab.
//   - unsatisfied torrents under the class limit: no grab within 5 of MAM's stated limit, or of 20
//     (the new-member limit, the strictest) when MAM states none.
//   - never spend freeleech: no request carrying `fl` or a bonus purchase ever reaches MAM.
// The account numbers come from MAM's approved "Load User Data" endpoint, read through the plugin's
// own test() so its rotating session stays the plugin's business. Anything unreadable refuses.
//
// Needs the plugin from orbit-plugins/bookorbit-plugins-extra (MIT, pinned) installed next to this
// directory as `../myanonamouse/index.mjs`. Reach MAM through the Windscribe tunnel's HTTP proxy
// (the source's network profile) so the session, the seedbox registration and qBittorrent share
// one exit address, and turn the plugin's dynamic seedbox setting on.

export const SEED_MINUTES = 73 * 60;
const MIN_RATIO = 1.05;
const UNSAT_MARGIN = 5;
const DEFAULT_UNSAT_LIMIT = 20;

export function wrap(mam) {
  const { update: _update, resolveFile: _file, ...rest } = mam;
  return {
    ...rest,
    apiVersion: 1,
    version: "0.1.0",
    type: "mam-guarded",
    label: "MyAnonaMouse (seeding rules enforced)",

    async search(query, config, host, signal) {
      const found = await mam.search(query, config, guardedHost(host), signal);
      return found.map(({ seedRatioGoal: _ratio, ...release }) => ({ ...release, seedTimeMinutes: SEED_MINUTES }));
    },

    test: (config, host) => mam.test(config, guardedHost(host)),
    keepalive: mam.keepalive && ((config, host) => mam.keepalive(config, guardedHost(host))),

    async fetchTorrentFile(release, config, host) {
      const guarded = guardedHost(host);
      guarded.assertSafe(release.downloadUrl ?? "");
      let user = null;
      const spy = {
        ...guarded,
        fetch: async (url, init) => {
          const res = await guarded.fetch(url, init);
          if (String(url).includes("/jsonLoad.php"))
            user = await res
              .clone()
              .json()
              .catch(() => null);
          return res;
        },
      };
      const checked = await mam.test(config, spy);
      if (!checked?.success || !user) throw host.fail("throttled", `MAM account check failed (${checked?.error ?? "no user data"}); not grabbing`);
      const refusal = refusalFor(user, release.sizeBytes);
      if (refusal) {
        host.logger.warn(`mam-guarded: grab held back: ${refusal}`);
        throw host.fail("throttled", `MAM rules: ${refusal}`);
      }
      return mam.fetchTorrentFile(release, config, guarded);
    },
  };
}

/** Why a grab must wait, or null when the account is inside every limit. Exported for tests. */
export function refusalFor(user, sizeBytes = null) {
  const down = Number(user?.downloaded_bytes);
  const up = Number(user?.uploaded_bytes);
  let ratio = Number(user?.ratio);
  if (!Number.isFinite(ratio) && Number.isFinite(down) && Number.isFinite(up)) ratio = down === 0 ? Infinity : up / down;
  if (Number.isNaN(ratio)) return "ratio unknown";
  if (ratio < MIN_RATIO) return `ratio ${ratio.toFixed(2)} is under ${MIN_RATIO}`;
  if (Number.isFinite(up) && Number.isFinite(down)) {
    const after = up / (down + (Number(sizeBytes) > 0 ? Number(sizeBytes) : 0));
    if (!(after >= 1)) return `this grab would take the ratio to ${Number.isFinite(after) ? after.toFixed(2) : "nothing"}`;
  }
  const unsat = user?.snatch_summary?.unsat;
  const count = Number(unsat?.count);
  if (unsat?.count === undefined || !Number.isFinite(count)) return "unsatisfied count unknown";
  const limit = Number.isFinite(Number(unsat?.limit)) && unsat?.limit !== null ? Number(unsat.limit) : DEFAULT_UNSAT_LIMIT;
  if (count >= limit - UNSAT_MARGIN) return `${count} unsatisfied torrents, limit ${limit}`;
  return null;
}

function guardedHost(host) {
  const assertSafe = (url) => {
    let parsed;
    try {
      parsed = new URL(url);
    } catch {
      return;
    }
    if (parsed.searchParams.has("fl") || /bonusBuy|freeleech/i.test(parsed.pathname + parsed.search)) {
      throw host.fail("error", "refused: that request would spend freeleech");
    }
  };
  return {
    ...host,
    assertSafe,
    fetch: (url, init) => {
      assertSafe(String(url));
      return host.fetch(url, init);
    },
  };
}
