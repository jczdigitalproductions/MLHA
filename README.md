# Civic Lens Remediation Lab

**An Argon-assisted 3D scenario generation and verification workbench for municipal accessibility reviewers.** The focused question: can a synthetic wheelchair traverse a proposed dry bypass around standing water at a curb crossing?

The core deliverable is executable scene code, traversal evidence, and a reviewable critique-and-repair loop. The original 2D intake, map, graph and dispatch prototype remains available as supporting history, outside the main demo.

## Focused scope

- **User:** a municipal accessibility reviewer exploring a temporary curb-access bypass before field assessment.
- **Input:** a street reference photo (`img-2.png`) and a scenario brief with explicitly synthetic geometry.
- **Argon work:** generate Three.js/Cannon-es scene code; review a Playwright recording, source and telemetry; propose fixes and retest them.
- **Output:** an interactive scene, downloadable local traversal evidence, and saved model critiques when a live generation run has completed.
- **Human decision:** inspect assumptions and evidence; commission field measurements or engineering review. No automatic municipal action.

See [PROJECT_SCOPE.md](PROJECT_SCOPE.md) for acceptance criteria, exclusions and a judging walkthrough aligned with the supplied builder guide.

## Run the main demo

Use Node.js 22.9 or later:

```sh
npm install
npm run dev
```

Open the URL printed by Vite. The landing page embeds the Mission scene, provides a **Run traversal check** button, exports evidence JSON, and reads an existing Argon audit if one exists. This local path needs no API key or database. Internet access and WebGL are needed for the scene's CDN imports. A missing saved audit is shown honestly; no successful model review is invented.

For Flask hosting instead:

```sh
python -m pip install -r requirements.txt
python backend_server.py
```

Open http://127.0.0.1:5001/. Both entry points open the remediation workbench. `/civic-lens.html` opens the legacy prototype. FalkorDB configuration is needed only for its graph action features: copy `setenv.bat.example` to a private `setenv.bat`, fill the values, and run `call setenv.bat` in the same Command Prompt before starting Flask. The React development server forwards `/api` to Flask on port 5001.

## Generate, record, critique and revise

Put your private `GEMINI_API_KEY` in `.env`; use `.env.example` as a starting point without overwriting existing credentials. Preview-model access is required.

```sh
npm run simulate -- mission_ramp --iterations 2
```

The script configures `gemini-4-argon` through the Interactions API, with `thinking_level` rather than legacy sampling controls. It generates a scene, records an eight-second browser rollout, submits the video/source/telemetry for critique, and retests proposed patches in subsequent iterations. The final untested proposed patch is not applied. Outputs:

- `public/simulations/mission_ramp.html`: generated scene.
- `public/simulations/mission_ramp_audit.json`: recorded telemetry and model critiques.
- `artifacts/videos/`: recorded rollouts.

Use **Refresh saved audit** in the workbench after generation. Generation may take longer than three minutes; prepare the scene and audit before judging and show a local traversal live. Model access and successful hosted execution have not been verified by local tests. A saved audit is historical evidence, not proof that the current scene is unchanged.

## Verification boundaries

The browser check observes advancing frames, goal coordinates `x > 4 m` and `y > 0.25 m`, maximum tilt below 8°, zero reported obstacle collisions, and no reported scene errors. It exports the observed state and distinguishes the local check from a model call.

The included scene uses guided motion, including constrained position and orientation. Its slope and water depth are illustrative. A passing local check does **not** establish independent physics correctness, a safe real-world route, measured dimensions, or accessibility compliance.

The pothole page is a separate illustrative mesh with scenario values, not image-derived depth or thermal analysis. The SOMA mattress scene is not included. Open311/PostGIS integration, measured performance improvement, WCAG AAA certification, and a million-token benchmark are outside the current deliverable.

## Run Argon inside Managed Agents (Antigravity)

The optional `managed-agent` command implements section 4 of the hackathon builder guide: it calls the Interactions API with agent `antigravity-preview-09-2026`, agent configuration `{ type: "antigravity", model: "gemini-4-argon" }`, and a remote environment. Antigravity can inspect source, run checks, and make changes inside its Google-hosted Linux workspace.

1. Use Node.js 22.9 or later and install dependencies with `npm install`.
2. Add `GEMINI_API_KEY` to your existing local `.env`, or copy `.env.example` if you do not have one. Your account needs access to the preview agent and model.
3. Preview the selected files and task without an API request:

```sh
npm run managed-agent -- --dry-run
```

Start a hosted review, or request fixes in the hosted copy:

```sh
npm run managed-agent
npm run managed-agent -- --task repair --prompt "Fix the 2D-to-3D navigation and verify the available scenes."
```

Review mode asks for findings without source edits. Repair mode asks the agent to record a baseline, fix concrete defects, and repeat relevant checks. Both request frontend tests, a production build, and Python backend tests. These commands make billable API calls. `ARGON_AGENT_MAX_TOKENS` sets the agent's total token cap (default `65536`); it is not a fixed monetary budget.

Only selected root files and code under `src/`, `scripts/`, `tests/`, and `public/` are mounted. Hidden files, `.env`, `setenv.bat`, dependency directories, media, local databases, and generated artifacts are excluded. This is a source-only snapshot; visual checks can report missing image assets. Inspect the dry-run file list before running with your own source. Network access is restricted to the package registries and frontend/browser CDNs listed in `scripts/argon-managed-agent.mjs`. No local database or third-party credentials are sent to the hosted agent. If you later add authenticated external tools, use Google's Credentials API and a narrow network allowlist rather than putting tokens in prompts or environment sources.

Each run saves `run.json` (interaction/environment IDs, status, usage) and `report.md` under `artifacts/managed-agent/run-*`. The report requests findings, exact test outcomes, and a unified diff for changes. Hosted source changes are **not automatically copied into this project**. Review the report and hosted files before applying them. See Google's documentation for downloading files from the hosted environment.

If local polling is interrupted, inspect the saved interaction again without starting another agent:

```sh
npm run managed-agent -- --resume YOUR_INTERACTION_ID
```

The runner polls for up to 20 minutes, requests cancellation on timeout, and treats failed, incomplete, cancelled, or action-required runs as unsuccessful. A failed poll or interruption can leave the hosted run active; use the saved ID to check it. Completed API access has not been verified by the local dry run and mocked tests.

References: [Managed Agents quickstart](https://ai.google.dev/gemini-api/docs/managed-agents-quickstart), [Antigravity agent](https://ai.google.dev/gemini-api/docs/antigravity-agent), [Agent environments](https://ai.google.dev/gemini-api/docs/agent-environment).

## Supporting code and checks

```sh
npm test
npm run build
python -m unittest discover -s tests -p "test_*.py"
```

`npm run migrate` remains an experimental multi-file candidate generator; it stages output for review and is not the main product or a completed migration benchmark.

The legacy HTML copies (`sf_civic_lens_web_application.html` and `public/civic-lens.html`) should stay synchronized. Its graph records include `(:Person)-[:PERFORMED]->(:Incident)` and `(:Incident)-[:IN_DISTRICT]->(:District)`. These record application actions, not proof of real municipal dispatch. Visit counts are local page loads, not unique people. Local credentials and `page_visits.json` are ignored by Git.
