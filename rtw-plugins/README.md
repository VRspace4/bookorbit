# Dynamic Ray request sources

Plugins that feed BookOrbit's request pipeline for Dynamic Ray's Books. Design: `stremio/docs/architecture/books.md` (Sources).

| Plugin       | Media     | Credential (API key field)                                                   | Delivers                                                         |
| ------------ | --------- | ---------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| `anna-fast`  | ebook     | `{"annas":{"key":"<member key>"}}` (Vaultwarden "Anna's Archive Secret Key") | Anna's member fast download for the md5, else ShadowLib's mirror |
| `abb-torbox` | audiobook | TorBox API key (Vaultwarden "TorBox - API Key")                              | TorBox link (zip for multi-file), cached releases only           |

Both wrap a pinned community plugin (search only) that must sit in the sibling plugin folder; `install.sh` puts all four in place.

- `anna-fast`: set ShadowLib's _Libraries_ to `libgen,memory,liber3`. Anna's search pages are behind DDoS-Guard (plain fetch and TRAWL both refused, 2026-11-01); its `fast_download.json` API is not.
- `abb-torbox`: AudiobookBay never gets a torrent client, so MyAnonamouse stays the only torrent source (BookOrbit sends every torrent to one preferred client).
- Checks: `node --test rtw-plugins/indexers/*/verify.mjs`.
- Install: `rtw-plugins/install.sh ~/projects/bookorbit/data/app`, restart BookOrbit, add the sources under Settings › Requests (or `POST /api/v1/admin/request-indexers`). Changing a source's adapter type clears its saved credential.
