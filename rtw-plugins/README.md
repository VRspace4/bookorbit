# Dynamic Ray request sources

Plugins that feed BookOrbit's request pipeline for Dynamic Ray's Books. Design: `stremio/docs/architecture/books.md` (Sources).

| Plugin        | Media            | Credential (API key field)                                                           | Delivers                                                                              |
| ------------- | ---------------- | ------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------- |
| `anna-fast`   | ebook            | `{"annas":{"key":"<member key>"}}` (Vaultwarden "Anna's Archive Secret Key")         | Anna's member fast download for the md5, else ShadowLib's mirror                      |
| `mam-guarded` | ebook, audiobook | MyAnonamouse `mam_id` (ASN-locked to the Windscribe tunnel, dynamic seedbox allowed) | `.torrent` to the MAM qBittorrent; ratio, unsatisfied and 73 h seeding rules enforced |
| `abb-torbox`  | audiobook        | TorBox API key (Vaultwarden "TorBox - API Key")                                      | TorBox link (zip for multi-file), cached releases only                                |

Both wrap a pinned community plugin (search only) that must sit in the sibling plugin folder; `install.sh` puts all four in place.

- `anna-fast`: set ShadowLib's _Libraries_ to `libgen,memory,liber3`. Anna's search pages are behind DDoS-Guard (plain fetch and TRAWL both refused, 2026-11-01); its `fast_download.json` API is not.
- `abb-torbox`: AudiobookBay never gets a torrent client, so MyAnonamouse stays the only torrent source (BookOrbit sends every torrent to one preferred client).
- `mam-guarded`: network profile proxy = the MAM tunnel's gluetun HTTP proxy, _dynamic seedbox_ on, seed time 4380 min, no ratio goal. qBittorrent 5.0.1 to 5.2.x only (MAM's allowed clients, 2026-11-01), auto-update off, and set to remove a torrent with its data at the seeding limit (the library keeps a hardlink). It is the only torrent source.
- Checks: `node --test rtw-plugins/indexers/*/verify.mjs`.
- Install: `rtw-plugins/install.sh ~/projects/bookorbit/data/app`, restart BookOrbit, add the sources under Settings › Requests (or `POST /api/v1/admin/request-indexers`). Changing a source's adapter type clears its saved credential.
