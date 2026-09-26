#!/usr/bin/env bash
# Installs or updates the SimC Lab server on Ubuntu without Docker: sudo ./deploy/install-ubuntu.sh
# Run it from a checkout of the repository. It needs Node.js 22 or newer already installed (Ubuntu's own
# nodejs package is too old; see docs/server.md). Put the reverse proxy (Caddy, nginx) in front for HTTPS.
set -euo pipefail

if [ "$(id -u)" -ne 0 ]; then echo "Run with sudo." >&2; exit 1; fi
here="$(cd "$(dirname "$0")/.." && pwd)"

node_major=$(node -p 'process.versions.node.split(".")[0]' 2>/dev/null || echo 0)
if [ "$node_major" -lt 22 ]; then
  echo "SimC Lab needs Node.js 22 or newer (found: $(node -v 2>/dev/null || echo none)). See docs/server.md." >&2
  exit 1
fi

# Git, CMake, a C++ compiler and libcurl build SimC from the web interface later.
apt-get update
apt-get install -y --no-install-recommends git cmake build-essential libcurl4-openssl-dev ca-certificates

id simclab >/dev/null 2>&1 || useradd --system --home-dir /var/lib/simc-lab --shell /usr/sbin/nologin simclab
install -d -o simclab -g simclab -m 750 /var/lib/simc-lab

# The app is replaced as a whole; accounts, runs and the engine live in /var/lib/simc-lab and are kept.
rm -rf /opt/simc-lab.new
install -d /opt/simc-lab.new
cp -r "$here/package.json" "$here/server.mjs" "$here/LICENSE" "$here/lib" "$here/public" "$here/profiles" /opt/simc-lab.new/
install -D -m 644 "$here/scripts/server-invite.mjs" /opt/simc-lab.new/scripts/server-invite.mjs
rm -rf /opt/simc-lab.old
[ -d /opt/simc-lab ] && mv /opt/simc-lab /opt/simc-lab.old
mv /opt/simc-lab.new /opt/simc-lab
rm -rf /opt/simc-lab.old

install -m 644 "$here/deploy/simc-lab.service" /etc/systemd/system/simc-lab.service
if [ ! -f /etc/simc-lab.env ]; then
  cat > /etc/simc-lab.env <<'ENV'
# The address people open, with https:// when a reverse proxy adds it.
SIMC_LAB_PUBLIC_URL=https://simc.example.com
SIMC_LAB_TRUST_PROXY=1
# Build SimC and fetch game data on its own when WoW patches.
SIMC_LAB_AUTO_UPDATE=1
# Optional: Blizzard API client (clientid:secret) for the Armory import.
#SIMC_LAB_BLIZZARD_API_KEY=
# Optional: compiler jobs for the SimC build (about 1.5 GB of memory each).
#SIMC_LAB_BUILD_JOBS=2
ENV
  chmod 640 /etc/simc-lab.env
  echo "Edit /etc/simc-lab.env (at least SIMC_LAB_PUBLIC_URL), then: sudo systemctl restart simc-lab"
fi

systemctl daemon-reload
systemctl enable simc-lab
systemctl restart simc-lab
sleep 2
echo
journalctl -u simc-lab -n 5 --no-pager
echo
echo "The first admin invite link is in the log above (journalctl -u simc-lab)."
