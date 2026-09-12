#!/usr/bin/env bash
# Run as root inside a Debian/Ubuntu container, from an extracted app bundle.
set -Eeuo pipefail
trap 'echo "Installation failed at line $LINENO. Check the output above; fix the issue and rerun this installer." >&2' ERR
[[ $EUID -eq 0 ]] || { echo 'Run as root.' >&2; exit 1; }
SOURCE=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)
for file in server.py static/index.html static/app.js static/style.css static/favicon.svg deploy/shopping-list.service; do
  [[ -f "$SOURCE/$file" ]] || { echo "Missing source file: $file" >&2; exit 1; }
done
command -v apt-get >/dev/null || { echo 'Debian or Ubuntu is required.' >&2; exit 1; }
export DEBIAN_FRONTEND=noninteractive
apt-get update
apt-get install -y python3
python3 -c 'import sys; assert sys.version_info >= (3,10), "Python 3.10+ required"'
getent group shopping >/dev/null || groupadd --system shopping
id shopping >/dev/null 2>&1 || useradd --system --gid shopping --home-dir /var/lib/shopping-list --shell /usr/sbin/nologin shopping
install -d -m 755 /opt/shopping-list/static
if [[ "$SOURCE" != /opt/shopping-list ]]; then
  install -m 644 "$SOURCE/server.py" /opt/shopping-list/server.py
  for file in index.html app.js style.css favicon.svg; do
    install -m 644 "$SOURCE/static/$file" "/opt/shopping-list/static/$file"
  done
fi
install -m 644 "$SOURCE/deploy/shopping-list.service" /etc/systemd/system/shopping-list.service
systemctl daemon-reload
systemctl enable shopping-list
systemctl restart shopping-list
for attempt in {1..30}; do
  if python3 -c 'import urllib.request; urllib.request.urlopen("http://127.0.0.1:8080/api/items", timeout=2)' 2>/dev/null; then
    echo 'Pantry is ready on port 8080. Data: /var/lib/shopping-list/shopping.db'
    exit 0
  fi
  sleep 1
done
journalctl -u shopping-list -n 30 --no-pager
echo 'The service did not become healthy.' >&2
exit 1
