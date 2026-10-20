# Discovery-lens experiment

Compares a message-centric lens with an entity-centric lens on the same data, to settle ADR-0008. The design, the decision rule, and the terms are in `docs/research/discovery-multi-app.md`.

- **Nothing here ships.** No code in `experiments/` is imported by `app/` or `nango-integrations/`. It sits outside the pnpm workspace and `pnpm verify`.
- **Python.** Dependencies go in this directory's `pyproject.toml`. pm4py is AGPL-3.0, which is another reason none of this code can ship.
- **No data in git.** Raw content stays on the machine that runs the experiment and is deleted when the experiment ends. `data/` and `out/` are gitignored.
- **Pin Jev.** Use the exact model ID the app pins (e.g. `typesafe-ai/jev-1.14.0`, never `jev-latest`), and record it in the results.
