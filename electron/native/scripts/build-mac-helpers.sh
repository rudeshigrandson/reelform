#!/usr/bin/env bash
# Build the macOS helpers and stage them where main verifies them (§5.5):
#   electron/native/bin/darwin-<node arch>/{reelform-sck,reelform-cursor-monitor,manifest.json}
#
#   ARCHS="arm64 x86_64" electron/native/scripts/build-mac-helpers.sh
#
# Release builds must be signed (Developer ID + hardened runtime, see mac/README.md)
# BEFORE this script hashes them: set CODESIGN_IDENTITY to sign in place.
set -euo pipefail

here="$(cd "$(dirname "$0")" && pwd)"
native="$(cd "$here/.." && pwd)"
repo="$(cd "$native/../.." && pwd)"
archs="${ARCHS:-$(uname -m)}"
version="${REELFORM_HELPER_VERSION:-$(node -p "JSON.parse(require('fs').readFileSync('$repo/package.json','utf8')).version")}"
helpers=(reelform-sck reelform-cursor-monitor)

cd "$native/mac"
for arch in $archs; do
  case "$arch" in
    arm64) node_arch=arm64 ;;
    x86_64) node_arch=x64 ;;
    *) echo "unsupported arch $arch" >&2; exit 2 ;;
  esac
  swift build -c release --arch "$arch"
  bin_path="$(swift build -c release --arch "$arch" --show-bin-path)"
  out="$native/bin/darwin-$node_arch"
  mkdir -p "$out"
  for h in "${helpers[@]}"; do
    install -m 0755 "$bin_path/$h" "$out/$h"
    if [[ -n "${CODESIGN_IDENTITY:-}" ]]; then
      codesign --force --options runtime --timestamp \
        --entitlements "$native/mac/helper.entitlements.plist" \
        --sign "$CODESIGN_IDENTITY" "$out/$h"
    fi
  done
  node "$here/write-manifest.mjs" "$out" "$version" "${helpers[@]}"
  echo "staged $out"
done
