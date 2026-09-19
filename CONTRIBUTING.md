# Contributing

Thanks for helping. Changes arrive as pull requests from a fork; nobody else can push to this repository.

1. Open an issue first for anything larger than a small fix, so the approach can be agreed.
2. Keep user-facing text in English.
3. Run `npm ci` and `npm run test:ci` for standalone app and addon tests without an engine. On your PC, run `npm run install-engine` once, then `npm test` for the full suite, including `profile.test.mjs` and `talents.test.mjs`, which require real engine/game data. GitHub CI and releases must never install or compile SimC. If you changed the simulation pipeline, also run the integration tests in `tests/` against a running server.
4. Every pull request needs the owner's review and a passing CI run before it can be merged.

By contributing you agree that your contribution is licensed under the GPL-3.0-or-later, like the rest of the project.
