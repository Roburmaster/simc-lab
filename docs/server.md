# SimC Lab server

One SimC Lab on a Linux server, shared by a group of friends or guilds. Everyone signs in with Discord, joins once with an invite key, sees only their own simulations, and takes turns on the same SimC engine through a shared queue.

## What changes in server mode

Server mode is switched on with `SIMC_LAB_SERVER=1`. Compared with the desktop app:

- **Discord sign-in.** There are no passwords. Members press *Sign in with Discord*; the app learns only their Discord id, name (server nickname first) and avatar, and never keeps Discord's access token. A session lasts a week.
- **Invite keys.** The first sign-in asks for an invite key; after that, Discord alone is enough. Each key names a group (for example *Kaken* and *Crimegang*), and the member list shows who joined through which. Admins add and remove keys under *Account › Invite keys*, or with `scripts/invite-keys.mjs`. Keys are compared without regard to case or surrounding spaces and stored only as salted scrypt hashes. Five wrong keys end a sign-up, and ten from one address lock it out for 15 minutes.
- **Optional Discord server check.** With `SIMC_LAB_DISCORD_GUILD` set, only members of that Discord server get in (and, with `SIMC_LAB_DISCORD_ROLE`, only those with that role), key or not.
- **Admins** are listed in `SIMC_LAB_DISCORD_ADMINS` (Discord user ids) or have `SIMC_LAB_DISCORD_ADMIN_ROLE`; at least one of the two must be set. Admins come in without a key, can promote others, and can remove members, which also blocks that Discord account until an admin lets it back.
- **The queue.** Simulations run one at a time. When one finishes, the next turn goes to the member who has waited longest, so one person's five Weapon Lab runs never hold everyone else up. Each member may have 2 jobs waiting (`SIMC_LAB_QUEUE_PER_USER`), and the server 20 in total (`SIMC_LAB_QUEUE`). The *Queue* page shows the whole queue in the order it will run: whose turn it is (by Discord name), the running job's progress and time left, and Open and Cancel for your own jobs.
- **Privacy between members.** History, results, reports, tier lists and upgrade reports belong to the member who ran them. Others see only the member's name and the mode in the queue, never the character. Admins can open every job.
- **Admins run the engine.** Only admins can update SimC or the game data. With `SIMC_LAB_AUTO_UPDATE=1` the server does it by itself: a minute after start and every six hours, when WoW or SimC has moved on and no simulation is waiting.
- **No WoW addon.** The game runs on each player's own PC, so the WoW addon page is hidden. Players paste their `/simc` export or use the Armory import.
- **SimC is built from source.** Official SimC nightly builds exist only for Windows, so the server compiles SimC itself (20–40 minutes the first time, with networking on so the Armory import works). SimC writes its HTML reports under the `en_US.UTF-8` locale; the install script and the Docker image generate it.

## Encryption

- **The account store** (`server/accounts.enc`: members, groups, sessions, blocked accounts, invite-key hashes) is encrypted with AES-256-GCM. Its key comes from `SIMC_LAB_DATA_KEY` (32 bytes, base64) or, better, `SIMC_LAB_DATA_KEY_FILE`. Without either, a key is generated once into `server/data.key` (mode 600). That is convenient for testing, but it keeps the key beside the data.
- **Inside the store**, sessions are SHA-256 hashes of the cookie and invite keys are salted scrypt hashes. Discord tokens are never stored.
- **Secrets as files:** `DISCORD_CLIENT_SECRET`, `SIMC_LAB_DATA_KEY` and `SIMC_LAB_BLIZZARD_API_KEY` can each be given as a file with the `_FILE` suffix instead of an environment variable.
- **On Ubuntu (recommended)**, those files are systemd credentials encrypted with the machine's own key (`systemd-creds`), so no secret and no store key is ever on disk in clear text. `deploy/set-secret.sh` writes them.
- **Cookies and traffic:** the session cookie is HttpOnly and SameSite=Lax, and Secure behind HTTPS; all traffic goes through the HTTPS proxy.
- **Not encrypted:** simulation inputs and results in `runs/`. They hold WoW character exports, which Blizzard shows publicly anyway. Use disk encryption on the server if you want those covered too.

## Discord application

In the [Discord Developer Portal](https://discord.com/developers/applications), open the application, then under **OAuth2**:

1. Note the **Client ID**. Press **Reset Secret** to get a client secret that has never been shown anywhere else, and store it only with `set-secret.sh` (or the Docker secret file).
2. Under **Redirects**, **add** `https://<your domain>/auth/discord/callback`. An application can have several redirects: leave one used by another site (such as mythicpersona.com's own sign-in) in place.

For admin ids and the optional server and role ids, turn on *Settings › Advanced › Developer Mode* in Discord, then right-click a person, a server or a role and choose **Copy ID**. No bot is needed.

## Install on Ubuntu 24.04 (recommended)

Node.js 22 or newer is needed and Ubuntu's own `nodejs` package is older, so install it from [nodejs.org](https://nodejs.org/en/download) (or NodeSource) first.

```bash
git clone https://github.com/Roburmaster/simc-lab.git
cd simc-lab
sudo ./deploy/install-ubuntu.sh                       # app, tools, service, encrypted store key
sudo nano /etc/simc-lab.env                           # public address, client id, admins
sudo ./deploy/set-secret.sh discord-client-secret     # paste the secret; stored encrypted
sudo ./deploy/set-secret.sh blizzard-api-key          # optional, for the Armory import
sudo systemctl restart simc-lab
```

Then add the invite keys. Either sign in as an admin and use *Account › Invite keys*, or from the shell with the service stopped:

```bash
sudo systemctl stop simc-lab
cd /opt/simc-lab
sudo systemd-run --pipe --wait -p User=simclab -p EnvironmentFile=/etc/simc-lab.env \
  -p LoadCredentialEncrypted=data-key:/etc/simc-lab/data-key.cred -E SIMC_LAB_HOME=/var/lib/simc-lab \
  sh -c 'SIMC_LAB_DATA_KEY_FILE=$CREDENTIALS_DIRECTORY/data-key node /opt/simc-lab/scripts/invite-keys.mjs add' <<< 'kaken'
sudo systemctl start simc-lab
```

Put a reverse proxy with HTTPS in front, for example Caddy:

```
simc.example.com {
	reverse_proxy 127.0.0.1:8642
}
```

Open the site, sign in with Discord as an admin, and press **Install SimC**.

**Updating the app:** `git pull && sudo ./deploy/install-ubuntu.sh`. The store key and secrets are kept.

## Install with Docker

Needs Docker with the compose plugin, and a domain whose DNS points at the server. In `deploy/`:

```bash
mkdir -m 700 secrets
openssl rand -base64 32 > secrets/data_key
read -rs S && printf '%s' "$S" > secrets/discord_client_secret; unset S
sudo chown 1000:1000 secrets/*; chmod 600 secrets/*
nano .env        # SIMC_LAB_DOMAIN, DISCORD_CLIENT_ID, SIMC_LAB_DISCORD_ADMINS
docker compose up -d --build
```

Docker secrets are plain files readable by the container user only; with Docker, rely on disk encryption for them. Caddy (in the same compose file) gets and renews the HTTPS certificate. Accounts, runs, the SimC build and game data live in the `simc-lab-data` volume. Invite keys from the shell: `docker compose stop simc-lab && echo kaken | docker compose run --rm -T simc-lab node scripts/invite-keys.mjs add && docker compose start simc-lab`.

## Settings

| Variable | Default | Meaning |
|---|---|---|
| `SIMC_LAB_SERVER` | off | `1` turns on server mode. |
| `SIMC_LAB_PUBLIC_URL` | required | The address people open, e.g. `https://simc.example.com`. Requests for any other host are refused, and the Discord redirect is built from it. |
| `DISCORD_CLIENT_ID` | required | The Discord application's client id. |
| `DISCORD_CLIENT_SECRET(_FILE)` | required | Its client secret. |
| `SIMC_LAB_DISCORD_ADMINS` | — | Comma-separated Discord user ids that are admins. This or the admin role is required. |
| `SIMC_LAB_DISCORD_ADMIN_ROLE` | — | Members with this role on `SIMC_LAB_DISCORD_GUILD` are admins. |
| `SIMC_LAB_DISCORD_GUILD` | none | Only members of this Discord server may sign in. |
| `SIMC_LAB_DISCORD_ROLE` | none | …and only with this role. |
| `SIMC_LAB_DATA_KEY(_FILE)` | generated | 32 bytes in base64 that encrypt the account store. |
| `SIMC_LAB_TRUST_PROXY` | off | `1` behind a reverse proxy, so the invite-key limit counts the real address. |
| `HOST` / `PORT` | `127.0.0.1` / `8642` | Where the server listens. The Docker image listens on `0.0.0.0`. |
| `SIMC_LAB_HOME` | app folder | Accounts, runs, engine and game data. `/var/lib/simc-lab` with systemd, `/data` in Docker. |
| `SIMC_LAB_AUTO_UPDATE` | off | `1` keeps SimC and game data on the live WoW build without an admin. |
| `SIMC_LAB_QUEUE` / `SIMC_LAB_QUEUE_PER_USER` | 20 / 2 | Waiting and running jobs on the server, and per member. |
| `SIMC_LAB_BUILD_JOBS` | by memory | Compiler jobs for the SimC build; each needs about 1.5 GB of memory. |
| `SIMC_LAB_BLIZZARD_API_KEY(_FILE)` | none | `clientid:secret` of a Blizzard API client ([develop.battle.net](https://develop.battle.net/access/clients)) for the Armory import. A SimC built from source has no key of its own. |

The server refuses to start in server mode when a required setting is missing, and says which.

## Sizing

SimC uses every CPU thread a job asks for, up to all of the server's (a desktop keeps two free). A 4-core VPS with 8 GB of memory works; the first SimC build needs about 8 GB of disk and, with `SIMC_LAB_BUILD_JOBS=2`, about 3 GB of memory. More cores make every turn in the queue shorter.
