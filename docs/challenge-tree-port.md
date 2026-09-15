# Challenge Tree port

## Source of truth

The UI and learning-domain implementation is imported from [`kokuren333/ChallengeTree`](https://github.com/kokuren333/ChallengeTree). The upstream React/Vite source is kept under `apps/challenge-tree/src/`, including:

- `App.tsx` and `styles.css` for the full responsive UI
- `core.ts` for tree progression, XP, unlocks, and migrations
- `types.ts` and `schemas.ts` for the upstream domain contract
- `sample.ts`, `i18n.ts`, and both locale files

The app is built with `npm run build:challenge-tree`. The manifest points at the resulting `dist/index.html`, so the Launcher does not contain Challenge Tree UI or routing logic.

## Boundary replacements

| Upstream dependency | agent-home replacement |
|---|---|
| `src/connector.ts` and local Connector server | `src/gateway.ts` calling `/api/apps/challenge-tree/runs` and the common SSE run endpoint |
| Browser IndexedDB in `src/db.ts` | `src/db.ts` calling `/api/apps/challenge-tree/resources/*` |
| Connector model selection | Launcher-owned `/api/settings/agent`; Gateway applies it to every run |
| Connector-owned persistence | `apps/challenge-tree/runtime.js` tables in the single Gateway SQLite database |

The original app operations remain named `tree_propose`, `node_expand`, `node_create`, `challenge_create`, and `answer_grade`. Their validation and client-side tree mutation remain inside Challenge Tree. The Gateway only creates the run, streams events, and supplies the abstract `AgentBackend`.

## Storage contract

Challenge Tree stores complete workspaces in `challenge_tree_workspaces`, settings in `challenge_tree_settings`, and the latest three per-workspace snapshots in `challenge_tree_snapshots`. Deleting a workspace removes its snapshots in the same app runtime. No Challenge Tree data is stored in browser IndexedDB.

## Verification

The protocol test asserts that the app is discovered from its manifest, its built entry is served, a workspace can be created and deleted through app resources, and its tree proposal completes through the generic run/event protocol. The upstream source also has its own `core.test.ts`, which is retained under the app source and can be run with the app's Vitest setup.
