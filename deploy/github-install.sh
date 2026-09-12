#!/usr/bin/env bash
# Download the complete source before starting the interactive Proxmox installer.
set -Eeuo pipefail
REPOSITORY=${REPOSITORY:-Swiftzn/ShoppingLister}
REF=${REF:-main}
[[ $REPOSITORY =~ ^[a-zA-Z0-9_.-]+/[a-zA-Z0-9_.-]+$ ]] || { echo 'Invalid repository.' >&2; exit 1; }
[[ $REF =~ ^[a-zA-Z0-9_.-]+$ ]] || { echo 'Use a branch, tag, or commit without slashes.' >&2; exit 1; }
[[ $EUID -eq 0 ]] || { echo 'Run as root on the Proxmox host.' >&2; exit 1; }
command -v pct >/dev/null || { echo 'Run on a Proxmox VE host.' >&2; exit 1; }
command -v curl >/dev/null || { echo 'Install curl first: apt-get install curl' >&2; exit 1; }
source_dir=$(mktemp -d /tmp/pantry-source.XXXXXXXX)
trap 'rm -rf -- "$source_dir"' EXIT
curl --fail --location --show-error --silent --retry 3 \
  "https://api.github.com/repos/$REPOSITORY/tarball/$REF" -o "$source_dir/source.tar.gz"
mkdir "$source_dir/app"
tar -xzf "$source_dir/source.tar.gz" --strip-components=1 -C "$source_dir/app"
bash "$source_dir/app/deploy/proxmox.sh"
