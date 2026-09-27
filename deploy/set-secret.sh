#!/usr/bin/env bash
# Stores a SimC Lab secret as an encrypted systemd credential (systemd-creds, sealed to this machine):
#   sudo ./deploy/set-secret.sh discord-client-secret      (then paste the secret and press Enter)
#   sudo ./deploy/set-secret.sh data-key                    (makes a new random key; only for a new store)
#   sudo ./deploy/set-secret.sh blizzard-api-key            (optional, for the Armory import)
# The secret is read from the terminal without echo and never written anywhere in clear text.
set -euo pipefail
if [ "$(id -u)" -ne 0 ]; then echo "Run with sudo." >&2; exit 1; fi
command -v systemd-creds >/dev/null || { echo "systemd-creds is missing; Ubuntu 24.04 or newer is needed." >&2; exit 1; }
name="${1:-}"
install -d -m 700 /etc/simc-lab
case "$name" in
  discord-client-secret)
    read -r -s -p "Discord client secret: " value; echo
    [ -n "$value" ] || { echo "Nothing entered." >&2; exit 1; }
    printf '%s' "$value" | systemd-creds encrypt --name="$name" - "/etc/simc-lab/$name.cred"
    unset value ;;
  data-key)
    if [ -f "/etc/simc-lab/$name.cred" ] && [ "${2:-}" != "--replace" ]; then
      echo "A data key exists. Replacing it makes the account store unreadable; add --replace if that is what you want." >&2; exit 1
    fi
    head -c 32 /dev/urandom | base64 | tr -d '\n' | systemd-creds encrypt --name="$name" - "/etc/simc-lab/$name.cred" ;;
  blizzard-api-key)
    # Optional, for the Armory import: clientid:secret from develop.battle.net. A drop-in hands it to the service.
    read -r -s -p "Blizzard API client (clientid:secret): " value; echo
    [ -n "$value" ] || { echo "Nothing entered." >&2; exit 1; }
    printf '%s' "$value" | systemd-creds encrypt --name="$name" - "/etc/simc-lab/$name.cred"
    unset value
    install -d /etc/systemd/system/simc-lab.service.d
    printf '[Service]\nLoadCredentialEncrypted=%s:/etc/simc-lab/%s.cred\nEnvironment=SIMC_LAB_BLIZZARD_API_KEY_FILE=%%d/%s\n' "$name" "$name" "$name" > /etc/systemd/system/simc-lab.service.d/blizzard.conf
    systemctl daemon-reload ;;
  *) echo "Usage: sudo $0 discord-client-secret | data-key | blizzard-api-key" >&2; exit 1 ;;
esac
chmod 600 "/etc/simc-lab/$name.cred"
echo "Stored /etc/simc-lab/$name.cred (encrypted). Restart the service: sudo systemctl restart simc-lab"
