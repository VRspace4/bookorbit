#!/usr/bin/env bash
# Installs Dynamic Ray's request-source plugins into a BookOrbit app-data folder, then restart BookOrbit.
# Usage: rtw-plugins/install.sh <APP_DATA_PATH on the host>   (bookorbit-dev: ~/projects/bookorbit/data/app)
# Community plugins are pinned by sha256: they run inside BookOrbit with its database access, so a new
# version is read before its hash goes here. Keep their in-app auto-update off.
set -euo pipefail
dest="${1:?usage: install.sh <APP_DATA_PATH>}/plugins/indexers"
here="$(cd "$(dirname "$0")" && pwd)"

fetch_pinned() { # <dir> <url> <sha256>
  local tmp; tmp="$(mktemp)"
  curl -fsSL "$2" -o "$tmp"
  echo "$3  $tmp" | sha256sum -c --quiet - || { rm -f "$tmp"; echo "sha256 mismatch for $1" >&2; exit 1; }
  mkdir -p "$dest/$1" && install -m 644 "$tmp" "$dest/$1/index.mjs" && rm -f "$tmp"
}

# orbitverse/bookorbit-shadowlib-plugin v0.1.25 (AGPL-3.0): LibGen / open-library search for anna-fast.
fetch_pinned bookorbit-shadowlib-plugin \
  https://github.com/orbitverse/bookorbit-shadowlib-plugin/releases/download/v0.1.25/index.mjs \
  ee536d4fb90ae97e5a15cd90038bb8a28ce1e00554c6283fbfd2e1e0cd61da8b
# nabukado/bookorbit-audiobookbay-plugin 0.1.1 at 188a4a8 (AGPL-3.0): AudiobookBay search for abb-torbox.
fetch_pinned audiobookbay \
  https://raw.githubusercontent.com/nabukado/bookorbit-audiobookbay-plugin/188a4a87ecc57cca9f480cd3a30cba9c0d965466/indexers/audiobookbay/index.mjs \
  d51d08858e36c324eb846e495e1105bc91bb3c4033613791e5c44bfe933ad258
# orbit-plugins/bookorbit-plugins-extra myanonamouse at 138644f (MIT): session, search and grab for mam-guarded.
fetch_pinned myanonamouse \
  https://raw.githubusercontent.com/orbit-plugins/bookorbit-plugins-extra/138644f62198d1a1dc335b427f3d8d1b894ad954/indexers/myanonamouse/index.mjs \
  3d875d4381a3bc817c6add8f02b5877f09a356d0d7c9c07733e66b9ccffa4792

for plugin in anna-fast abb-torbox mam-guarded; do
  mkdir -p "$dest/$plugin" && install -m 644 "$here/indexers/$plugin/index.mjs" "$here/indexers/$plugin/wrap.mjs" "$dest/$plugin/"
done
echo "installed into $dest; restart BookOrbit to load them"
