# SimC Lab server

One SimC Lab on a Linux server, shared by a group of friends or a guild. Everyone signs in with their own account, sees only their own simulations, and takes turns on the same SimC engine.

## What changes in server mode

Server mode is switched on with `SIMC_LAB_SERVER=1`. Compared with the desktop app:

- **Accounts.** There is no sign-up form. An admin makes invite links (Account › New invite link); each link creates one account and expires after 7 days. On the very first start, with no accounts yet, the server prints an admin invite link in its log.
- **Privacy between accounts.** History, results, reports, tier lists and upgrade reports belong to the account that ran them. Other people's jobs show in the queue only as "Another user". Admins can open every job.
- **A fair queue.** Simulations still run one at a time, but the next job goes to whoever has waited longest, so one person's five Weapon Lab runs do not hold everyone else up. Each account may have 2 jobs waiting (`SIMC_LAB_QUEUE_PER_USER`), and the server 20 in total (`SIMC_LAB_QUEUE`).
- **Admins run the engine.** Only admins can update SimC or the game data. With `SIMC_LAB_AUTO_UPDATE=1` the server does it by itself: a minute after start and every six hours, when WoW or SimC has moved on and no simulation is waiting.
- **No WoW addon.** The game runs on each player's own PC, so the WoW addon page is hidden and its endpoints are off. Players paste their `/simc` export or use the Armory import.
- **SimC is built from source.** Official SimC nightly builds exist only for Windows, so the server compiles SimC itself (20–40 minutes the first time, with networking on so the Armory import works). SimC writes its HTML reports under the `en_US.UTF-8` locale; the Docker image and the install script generate it.

Passwords are stored as scrypt hashes, sessions as SHA-256 hashes of a random cookie (HttpOnly, SameSite=Strict, Secure behind HTTPS). Ten wrong passwords for a name or from an address lock sign-in for 15 minutes. Everything is kept in `$SIMC_LAB_HOME/server/accounts.json`.

## Install with Docker (recommended)

Needs Docker with the compose plugin, and a domain whose DNS points at the server (for the HTTPS certificate).

```bash
git clone https://github.com/Roburmaster/simc-lab.git
cd simc-lab/deploy
echo "SIMC_LAB_DOMAIN=simc.example.com" > .env
docker compose up -d --build
docker compose logs simc-lab
```

The log shows the first admin invite link. Open it, choose a name and a password, then press **Install SimC** in the app. After that, invite the others from **Account**.

Caddy (in the same compose file) gets and renews the HTTPS certificate. Accounts, runs, the SimC build and game data live in the `simc-lab-data` volume, so rebuilding or updating the image keeps them.

**Updating the app:** `git pull && docker compose up -d --build` in `deploy/`.

## Install without Docker (systemd)

Ubuntu 22.04 or 24.04. Node.js 22 or newer is needed and Ubuntu's own `nodejs` package is older, so install it from [nodejs.org](https://nodejs.org/en/download) (or NodeSource) first.

```bash
git clone https://github.com/Roburmaster/simc-lab.git
cd simc-lab
sudo ./deploy/install-ubuntu.sh
sudo nano /etc/simc-lab.env        # set SIMC_LAB_PUBLIC_URL
sudo systemctl restart simc-lab
journalctl -u simc-lab -n 20       # the first admin invite link
```

The script installs Git, CMake, the C++ compiler and libcurl, creates a `simclab` system user, puts the app in `/opt/simc-lab` and its data in `/var/lib/simc-lab`, and starts the `simc-lab` service on 127.0.0.1:8642. Put a reverse proxy with HTTPS in front, for example Caddy:

```
simc.example.com {
	reverse_proxy 127.0.0.1:8642
}
```

**Updating the app:** `git pull && sudo ./deploy/install-ubuntu.sh`.

## Settings

| Variable | Default | Meaning |
|---|---|---|
| `SIMC_LAB_SERVER` | off | `1` turns on server mode. |
| `SIMC_LAB_PUBLIC_URL` | none | The address people open, e.g. `https://simc.example.com`. Requests for any other host are refused. |
| `SIMC_LAB_TRUST_PROXY` | off | `1` when a reverse proxy sits in front, so sign-in limits count the real address from `X-Forwarded-For`. |
| `HOST` / `PORT` | `127.0.0.1` / `8642` | Where the server listens. The Docker image listens on `0.0.0.0`. |
| `SIMC_LAB_HOME` | app folder | Accounts, runs, engine and game data. `/data` in Docker, `/var/lib/simc-lab` with systemd. |
| `SIMC_LAB_AUTO_UPDATE` | off | `1` keeps SimC and game data on the live WoW build without an admin. |
| `SIMC_LAB_QUEUE` | 20 | Waiting and running jobs on the whole server. |
| `SIMC_LAB_QUEUE_PER_USER` | 2 | Waiting and running jobs per account. |
| `SIMC_LAB_BUILD_JOBS` | by memory | Compiler jobs for the SimC build; each needs about 1.5 GB of memory. |
| `SIMC_LAB_BLIZZARD_API_KEY` | none | `clientid:secret` of a Blizzard API client ([develop.battle.net](https://develop.battle.net/access/clients)) for the Armory import. A SimC built from source has no key of its own. |

## Sizing

SimC uses every CPU thread a job asks for, up to all of the server's (a desktop keeps two free). A 4-core VPS with 8 GB of memory works; the first SimC build needs about 8 GB of disk and, with `SIMC_LAB_BUILD_JOBS=2`, about 3 GB of memory. More cores make simulations faster for everyone.

## Lost the last admin?

Stop the server, then make a new admin invite from the data folder:

```bash
sudo systemctl stop simc-lab
sudo -u simclab SIMC_LAB_HOME=/var/lib/simc-lab node /opt/simc-lab/scripts/server-invite.mjs --admin
sudo systemctl start simc-lab
```

With Docker: `docker compose stop simc-lab && docker compose run --rm simc-lab node scripts/server-invite.mjs --admin && docker compose start simc-lab`.
