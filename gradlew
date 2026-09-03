#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")" && pwd)"
VERSION="9.5.0"
SHA256="553c78f50dafcd54d65b9a444649057857469edf836431389695608536d6b746"
CACHE="${HOME}/.chefvoice/gradle"
HOME_DIR="${CACHE}/gradle-${VERSION}"
ZIP="${CACHE}/gradle-${VERSION}-bin.zip"
if [[ ! -x "${HOME_DIR}/bin/gradle" ]]; then
  mkdir -p "$CACHE"
  rm -f "$ZIP"
  curl -fL "https://services.gradle.org/distributions/gradle-${VERSION}-bin.zip" -o "$ZIP"
  ACTUAL="$(sha256sum "$ZIP" | awk '{print $1}')"
  [[ "$ACTUAL" == "$SHA256" ]] || { echo "Gradle checksum mismatch" >&2; rm -f "$ZIP"; exit 2; }
  rm -rf "$HOME_DIR"
  unzip -q "$ZIP" -d "$CACHE"
  rm -f "$ZIP"
fi
exec "${HOME_DIR}/bin/gradle" -p "$ROOT" "$@"
