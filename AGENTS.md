# Project instructions

- Create all UI text, errors, documentation and other deliverables in English unless the user explicitly requests another language.
- New selectable gear, gems, enchants and consumables must come only from the current expansion. Use explicit source expansion metadata, not names or numeric ID thresholds. Preserve imported baseline data.
- Exception: Upgrade Finder may offer older-expansion items only when they are in the active season's raid or Mythic+ loot tables, as named by the season data. Never widen this to the item browser, Gear Compare or other sources.
- Talent Search must validate legal trees before simulation: specialization, dependencies, gates, ranks, choices, hero trees, budgets and locks. Fail clearly when legality cannot be established. Never describe bounded search as globally optimal.
- Keep engine, catalog and talent data pinned to the installed live WoW build. Test real SimC runs after simulation pipeline changes.

- GitHub CI and releases must never install or compile SimC. Use `npm run test:ci` for standalone app/addon tests and package only the app/addon. Engine installation, source builds and live-data integration tests run locally on the PC.
