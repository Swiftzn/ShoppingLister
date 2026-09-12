#!/usr/bin/env bash
# Standalone Proxmox host installer; no community helper framework required.
set -Eeuo pipefail
created=0
on_error() {
  echo "Installation failed at line $1." >&2
  if (( created )); then
    echo "Container $CTID has been retained for inspection. Use: pct enter $CTID" >&2
    echo "To retry app installation: pct exec $CTID -- bash /root/pantry-source/deploy/install.sh" >&2
  fi
}
trap 'on_error "$LINENO"' ERR
die() { echo "$*" >&2; exit 1; }
[[ $EUID -eq 0 ]] || die 'Run this script as root on your Proxmox host.'
for command in pct pveam pvesm pvesh tar; do
  command -v "$command" >/dev/null || die "Missing $command: run on a Proxmox VE host."
done
SOURCE=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)
[[ -f "$SOURCE/server.py" && -f "$SOURCE/deploy/install.sh" ]] || die 'Extract the full app bundle first.'
ask() {
  local variable=$1 label=$2 default=$3 value
  if [[ -t 0 && ${NONINTERACTIVE:-0} != 1 ]]; then
    read -r -p "$label [$default]: " value
    printf -v "$variable" '%s' "${value:-$default}"
  else
    printf -v "$variable" '%s' "$default"
  fi
}
echo 'Pantry · Proxmox LXC installer'
echo 'Available storage:'
pvesm status
ask CTID 'Container ID' "${CTID:-$(pvesh get /cluster/nextid)}"
ask CT_NAME 'Hostname' "${CT_NAME:-pantry}"
ask STORAGE 'Container disk storage' "${STORAGE:-local-lvm}"
ask TEMPLATE_STORAGE 'Template storage' "${TEMPLATE_STORAGE:-local}"
ask BRIDGE 'Network bridge' "${BRIDGE:-vmbr0}"
ask CORES 'CPU cores' "${CORES:-1}"
ask MEMORY 'Memory (MiB)' "${MEMORY:-512}"
ask DISK 'Disk (GiB)' "${DISK:-4}"
ask IP 'IPv4 address (dhcp or CIDR)' "${IP:-dhcp}"
GATEWAY=${GATEWAY:-}
if [[ $IP != dhcp ]]; then ask GATEWAY 'IPv4 gateway' "$GATEWAY"; fi
for value in "$CTID" "$CORES" "$MEMORY" "$DISK"; do
  [[ $value =~ ^[1-9][0-9]*$ ]] || die 'ID and resource values must be positive integers.'
done
[[ $CT_NAME =~ ^[a-zA-Z0-9][a-zA-Z0-9-]*$ ]] || die 'Use a simple hostname with letters, numbers, and hyphens.'
for value in "$STORAGE" "$TEMPLATE_STORAGE" "$BRIDGE"; do
  [[ $value =~ ^[a-zA-Z0-9][a-zA-Z0-9_.-]*$ ]] || die 'Invalid storage or bridge name.'
done
[[ $IP == dhcp || $IP =~ ^[0-9.]+/[0-9]+$ ]] || die 'Use dhcp or an IPv4 CIDR address.'
[[ -z $GATEWAY || $GATEWAY =~ ^[0-9.]+$ ]] || die 'Invalid IPv4 gateway.'
[[ -d /sys/class/net/$BRIDGE ]] || die "Bridge $BRIDGE does not exist."
# This cluster-wide check also catches IDs used by VMs or another node.
pvesh get /cluster/nextid --vmid "$CTID" >/dev/null
pvesm status --content rootdir | awk -v name="$STORAGE" '$1 == name && $3 == "active" {found=1} END {exit !found}' || die 'Choose active storage supporting container disks.'
pvesm status --content vztmpl | awk -v name="$TEMPLATE_STORAGE" '$1 == name && $3 == "active" {found=1} END {exit !found}' || die 'Choose active storage supporting templates.'
echo "Creating $CTID ($CT_NAME): $CORES CPU, $MEMORY MiB RAM, $DISK GiB on $STORAGE; $BRIDGE / $IP."
if [[ -t 0 && ${NONINTERACTIVE:-0} != 1 ]]; then
  read -r -p 'Create and install? [y/N]: ' answer
  [[ $answer == y || $answer == Y ]] || exit 0
elif [[ ${NONINTERACTIVE:-0} != 1 ]]; then
  die 'Use an interactive terminal or set NONINTERACTIVE=1.'
fi
pveam update
TEMPLATE=${TEMPLATE:-$(pveam available --section system | awk '$2 ~ /^debian-13-standard_.*_amd64.tar.(zst|xz|gz)$/ {print $2}' | sort -V | tail -n 1)}
[[ -n $TEMPLATE ]] || die 'No Debian 13 template found. Update Proxmox or set TEMPLATE to a supported Debian template filename.'
pveam download "$TEMPLATE_STORAGE" "$TEMPLATE"
net="name=eth0,bridge=$BRIDGE,ip=$IP,type=veth"
[[ $IP == dhcp || -z $GATEWAY ]] || net+=",gw=$GATEWAY"
pct create "$CTID" "$TEMPLATE_STORAGE:vztmpl/$TEMPLATE" \
  --hostname "$CT_NAME" --ostype debian --unprivileged 1 \
  --cores "$CORES" --memory "$MEMORY" --swap 256 \
  --rootfs "$STORAGE:$DISK" --net0 "$net" --onboot 1
created=1
pct start "$CTID"
ready=0
for attempt in {1..60}; do
  if pct exec "$CTID" -- test -d /run/systemd/system 2>/dev/null; then ready=1; break; fi
  sleep 2
done
[[ $ready == 1 ]] || die "Container $CTID did not start in time; it has been retained."
bundle=$(mktemp /tmp/pantry-install.XXXXXX.tar.gz)
trap 'rm -f -- "$bundle"' EXIT
tar -czf "$bundle" -C "$SOURCE" server.py static deploy
pct push "$CTID" "$bundle" /root/pantry-source.tar.gz
pct exec "$CTID" -- mkdir -p /root/pantry-source
pct exec "$CTID" -- tar -xzf /root/pantry-source.tar.gz -C /root/pantry-source
pct exec "$CTID" -- bash /root/pantry-source/deploy/install.sh
address=$(pct exec "$CTID" -- hostname -I)
address=${address%% *}
echo
echo "Pantry installed in container $CTID."
echo "Open http://${address:-CONTAINER_IP}:8080"
echo "Console: pct enter $CTID"
echo 'Keep this unauthenticated app on your LAN or VPN.'
