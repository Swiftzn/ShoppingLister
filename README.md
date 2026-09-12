# Pantry — household grocery list

A small SPA with a Python standard-library server and SQLite storage. No pip packages, Node, build step, authentication, or external services. Requires Python 3.10 or newer. Everyone using the server shares one list; open pages refresh every 15 seconds. Supports adding items and free-text quantities, checking off, editing (click the item name), and deleting.

## Run locally

```sh
python3 server.py
```

Open http://localhost:8080. On another device, use `http://<server-ip>:8080`. Data defaults to `data/shopping.db`. Configure `HOST`, `PORT`, and `DATA_DIR` with environment variables if needed. Writes commit to SQLite before the server reports success.

## Debian / Ubuntu LXC

### Scripted Proxmox installation (recommended)

For a public GitHub repository, download the bootstrap script then run it in the **Proxmox host shell**:

```sh
curl -fsSL https://raw.githubusercontent.com/Swiftzn/ShoppingLister/main/deploy/github-install.sh -o /root/pantry-install.sh && REPOSITORY=Swiftzn/ShoppingLister bash /root/pantry-install.sh
```

The bootstrap downloads the full app from GitHub and starts the interactive installer below. `REF` defaults to `main`; set it to a tag or commit to choose a specific source version. This download method requires a public repository. Private repositories can use the local bundle method instead.

The standalone helper creates an unprivileged Debian 13 LXC, installs Python and Pantry, enables the service on boot, checks the API, and prints its address. Defaults: 1 CPU, 512 MiB RAM, 4 GiB disk, DHCP, bridge `vmbr0`. It prompts for settings and confirmation before creating anything. It does not depend on or belong to the Proxmox community helper scripts project.

On your Windows machine, package and upload it (replace `PROXMOX_IP` with the **host's** address):

```powershell
cd E:\Projects\ShoppingLister
powershell -ExecutionPolicy Bypass -File .\deploy\package.ps1
scp .\pantry.tar.gz root@PROXMOX_IP:/root/
```

In the **Proxmox host shell**, run:

```sh
mkdir -p /root/pantry
tar -xzf /root/pantry.tar.gz -C /root/pantry
bash /root/pantry/deploy/proxmox.sh
```

Requires a Proxmox version supporting Debian 13 containers, active template/disk storage, and outbound internet/DNS for downloading the template and Python packages. No SSH server or root password is needed inside the new container: use `pct enter <CTID>` from the host. Allow LAN access to port 8080 if your firewall restricts it.

For unattended installation, explicitly opt in and override defaults as needed:

```sh
NONINTERACTIVE=1 CTID=120 STORAGE=local-lvm TEMPLATE_STORAGE=local BRIDGE=vmbr0 bash /root/pantry/deploy/proxmox.sh
```

Other variables: `CT_NAME`, `CORES`, `MEMORY`, `DISK`, `IP` (DHCP or IPv4 CIDR), `GATEWAY`, and `TEMPLATE` (Debian template filename). Existing VM/container IDs are rejected. Failed containers are retained for troubleshooting; nothing is automatically destroyed. After fixing a package/network failure, rerun the in-container installer using the command printed by the helper.

### Existing LXC / updates

Upload and extract the same bundle **inside your existing Debian/Ubuntu LXC**, then run `bash /path/to/extracted/deploy/install.sh` as root. This installs or updates the app and restarts its service while preserving `/var/lib/shopping-list/shopping.db`. Back up that database before updates. Existing systemd service settings are replaced by the bundled defaults; put custom settings in a systemd drop-in.

### Manual installation

Copy this project to `/opt/shopping-list`, then run these commands as root inside your container:

```sh
apt update
apt install -y python3
useradd --system --user-group --home-dir /var/lib/shopping-list --shell /usr/sbin/nologin shopping
cp /opt/shopping-list/deploy/shopping-list.service /etc/systemd/system/
systemctl daemon-reload
systemctl enable --now shopping-list
```

Open `http://<container-ip>:8080`. Systemd creates `/var/lib/shopping-list` with the correct ownership. Check logs with `journalctl -u shopping-list`. To update, replace the source files and run `systemctl restart shopping-list`.

This is an unauthenticated home-network app: anyone who can reach it can change the list. Keep it on your LAN or VPN. The bundled HTTP server is intended for this small trusted-network use.

## Backup

The service database is `/var/lib/shopping-list/shopping.db`. Stop the service, copy that file to your backup location, and start the service again. Restore with the service stopped, ensuring the file is owned by `shopping:shopping`. For a local run, back up `data/shopping.db` instead.

## Tests

```sh
python3 -m unittest discover -s tests -v
```

Tesco basket integration is deliberately left for a future version. The `/api/items` JSON endpoint provides the list for future integrations.
