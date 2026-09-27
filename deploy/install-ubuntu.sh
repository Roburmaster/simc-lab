#!/usr/bin/env bash
# Installs or updates the SimC Lab server on Ubuntu 24.04 without Docker: sudo ./deploy/install-ubuntu.sh
# Run it from a checkout of the repository. It needs Node.js 22 or newer already installed (Ubuntu's own
# nodejs package is too old; see docs/server.md). Put the reverse proxy (Caddy, nginx) in front for HTTPS.
# Secrets never go in /etc/simc-lab.env: they are encrypted systemd credentials, written by set-secret.sh.
set -euo pipefail

if [ "$(id -u)" -ne 0 ]; then echo "Run with sudo." >&2; exit 1; fi
here="$(cd "$(dirname "$0")/.." && pwd)"

node_major=$(node -p 'process.versions.node.split(".")[0]' 2>/dev/null || echo 0)
if [ "$node_major" -lt 22 ]; then
  echo "SimC Lab needs Node.js 22 or newer (found: $(node -v 2>/dev/null || echo none)). See docs/server.md." >&2
  exit 1
fi
command -v systemd-creds >/dev/null || { echo "systemd-creds is missing; Ubuntu 24.04 or newer is needed." >&2; exit 1; }

# Git, CMake, a C++ compiler and libcurl build SimC from the web interface later. SimC writes its HTML reports
# (and the Armory import reads one) under the en_US.UTF-8 locale.
apt-get update
apt-get install -y --no-install-recommends git cmake build-essential libcurl4-openssl-dev ca-certificates locales
locale-gen en_US.UTF-8

id simclab >/dev/null 2>&1 || useradd --system --home-dir /var/lib/simc-lab --shell /usr/sbin/nologin simclab
install -d -o simclab -g simclab -m 750 /var/lib/simc-lab

# The app is replaced as a whole; accounts, runs and the engine live in /var/lib/simc-lab and are kept.
rm -rf /opt/simc-lab.new
install -d /opt/simc-lab.new
cp -r "$here/package.json" "$here/server.mjs" "$here/LICENSE" "$here/lib" "$here/public" "$here/profiles" /opt/simc-lab.new/
install -D -m 644 "$here/scripts/invite-keys.mjs" /opt/simc-lab.new/scripts/invite-keys.mjs
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
# Discord sign-in: the application's client id (the secret is an encrypted credential: set-secret.sh).
# Add https://<your domain>/auth/discord/callback to the application's OAuth2 redirects.
DISCORD_CLIENT_ID=
# Admins, as Discord user ids (comma-separated) and/or a role on the Discord server below.
SIMC_LAB_DISCORD_ADMINS=
#SIMC_LAB_DISCORD_ADMIN_ROLE=
# Optional: only members of this Discord server (and with this role) may sign in.
#SIMC_LAB_DISCORD_GUILD=
#SIMC_LAB_DISCORD_ROLE=
# Build SimC and fetch game data on its own when WoW patches.
SIMC_LAB_AUTO_UPDATE=1
# Optional: compiler jobs for the SimC build (about 1.5 GB of memory each).
#SIMC_LAB_BUILD_JOBS=2
ENV
  chmod 640 /etc/simc-lab.env
  chgrp simclab /etc/simc-lab.env
fi

# The key that encrypts the account store is made once and kept as an encrypted credential.
[ -f /etc/simc-lab/data-key.cred ] || "$here/deploy/set-secret.sh" data-key

systemctl daemon-reload
systemctl enable simc-lab
if [ ! -f /etc/simc-lab/discord-client-secret.cred ]; then
  echo
  echo "Next: fill in /etc/simc-lab.env, then store the Discord client secret:"
  echo "  sudo ./deploy/set-secret.sh discord-client-secret"
  echo "and start the server: sudo systemctl restart simc-lab"
  exit 0
fi
systemctl restart simc-lab
sleep 2
echo
journalctl -u simc-lab -n 5 --no-pager
