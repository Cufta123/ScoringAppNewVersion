---
description: Whole-app audit from UI to backend. Read-only — reports all findings, writes no code.
---

Run a complete audit of this app, UI to backend. This is a REPORT-ONLY task:
do NOT edit, write, fix, stage, or commit any code. Your only deliverable is a
findings report. If you are tempted to fix something, record it as a finding
instead.

Work in parallel and fan out widely — spawn as many subagents as the surface
needs, no artificial cap. Cover every layer:

1. MAP the surface first. Use `file-summarizer` (one per file) and `explorer`
   across: the React renderer/UI (`src/renderer`), the preload bridge, the IPC
   handlers (`src/main`), the DB layer (`public/Database` and any SQL), and the
   test suite. Build the list of features, IPC channels, and user flows.

2. WIRING. For every feature/channel/flow found, spawn `integration-auditor`
   (one each, in parallel) to verify renderer → preload → IPC → handler → DB is
   fully connected and the data shapes match. Flag every broken or missing link.

3. DEFECTS. For every meaningful slice (each handler, each hook, each DB module),
   spawn `bug-hunter` in parallel to find real bugs with a concrete failure
   scenario and severity.

4. DOES IT RUN. Spawn `verifier` for each check type in parallel: typecheck,
   lint, unit tests, and the Playwright/E2E or app smoke if present. Capture the
   actual pass/fail and errors.

5. COMPLETENESS PASS. Before finishing, explicitly ask: what did we NOT check?
   Any directory not mapped, any flow with no integration-auditor, any slice with
   no bug-hunter, any check not run? Fan out again to close those gaps. Do not
   declare done until every layer has been covered by an agent.

Then produce ONE consolidated report:

- Grouped by severity: BLOCKER, HIGH, MEDIUM, LOW.
- Each finding: `path:line` — the problem — the concrete failure scenario.
- A "does it run" section: result of each verifier check.
- A "coverage" section: what was checked, and honestly, anything you could not
  reach or verify. Do not claim completeness you can't back with evidence.

Write nothing to disk. End your turn with the report only.

Focus (optional): $ARGUMENTS
