# Security policy

SimC Lab runs a local web server, downloads and starts SimulationCraft, and can install build tools. Please report anything that could let a web page, a profile import or a download do more than that.

## Reporting a vulnerability

Use **Report a vulnerability** on the repository's Security tab (private vulnerability reporting). Please do not open a public issue for security problems. You will get a reply within a few days.

## What is in scope

- The local server: host and origin checks, the per-session token, profile import validation and report downloads.
- The updater: what it downloads, from where, and what it runs.
- The desktop app: the preload bridge, navigation rules and app updates.

Only the latest release is supported.
