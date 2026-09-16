# agent-home architecture

## Goal

`agent-home` is a small, single-process personal agent launcher intended for an always-on low-spec PC. A Tailscale HTTPS reverse proxy can expose the single HTTP port to a phone. The server has no local LLM, vector database, Redis, Postgres, or other resident service dependency.

Challenge Tree integration is based on the upstream repository [`kokuren333/ChallengeTree`](https://github.com/kokuren333/ChallengeTree). The upstream React/Vite application is kept as the app source; only its browser persistence and local Connector transport are adapted to agent-home boundaries.

## Boundaries

```text
phone browser / PWA
        |
    Launcher  ---- reads ---->  GET /api/apps
        |
    App UI  ---- App Protocol ---->  Gateway
                                      |  run/job/event/SSE
                                      |  SQLite persistence
                                      |  global model / reasoning settings
                                      |  AgentBackend
                                      +-- mock (development)
                                      +-- Codex CLI adapter

apps/*/manifest.json + runtime.js + app UI source/build
```

- `launcher/`: installable PWA shell, app cards, server state. It knows only manifests and entry URLs.
- `gateway/`: one Node process. It discovers app manifests, owns common runs/events, provides SQLite, and delegates app resources/runs to a runtime. It does not know Character Chat fields.
- `packages/app-protocol/`: protocol version, shared concepts, and error shape.
- `packages/app-sdk/`: tiny helper for future app authors.
- `apps/*/`: app-specific manifest, runtime, adapter, schema, prompts, and UI. Upstream domain/UI source may remain recognizable, but every agent-home boundary replacement belongs under the app's standard `adapter/` directory.
- `data/`: SQLite database and WAL files; ignored by git.

## Directory layout

```text
agent-home/
├─ launcher/                  # shared PWA shell and global Agent settings UI
├─ gateway/                   # one process: protocol routing, runs, SSE, SQLite access
├─ packages/
│  ├─ app-protocol/           # app-neutral types, validation, and error shape
│  └─ app-sdk/                # small helpers for app authors
├─ apps/
│  ├─ character-chat/         # app manifest, runtime, schema, prompts, and UI
│  ├─ demo-app/               # protocol-only smoke-test app
│  └─ challenge-tree/         # cloned source adapted to the same protocol
├─ data/                      # runtime database and generated user assets
├─ docs/                      # architecture and protocol documentation
├─ test/                      # protocol/integration tests
└─ ui/                        # browser-shared UI assets only
```

Browser screenshots and temporary Chrome profiles are verification artifacts, not application data. They are kept outside the project; `.gitignore` also prevents them from accumulating here.

## Request flow

1. Gateway scans `apps/*/manifest.json` during startup and dynamically loads the matching `runtime.js`.
2. Launcher calls `GET /api/apps` and renders every returned manifest, including apps it does not know about.
3. An app starts a generic run with `POST /api/apps/:id/runs`.
4. Gateway creates a run, invokes the app runtime with an abstract `AgentBackend`, stores events, and publishes them through `GET /api/runs/:id/events` using SSE.
5. App-specific resources use the delegated namespace `/api/apps/:id/resources/*`; their schemas remain inside the app.

## Existing app migration boundary

An existing app is integrated by placing a thin adapter inside its own
`apps/<id>/` directory. The adapter replaces direct Connector/LLM calls and
device-local persistence with Gateway calls while preserving the upstream UI
and domain behavior. New apps may use `adapter/`, `schema/`, and `prompts/`
subdirectories; Challenge Tree keeps its upstream domain/UI source and places
its two boundary adapters at `adapter/gateway-client.ts` and
`adapter/storage.ts`.

The common layer is intentionally limited to the outer contract:

```text
manifest → run request → run status → event stream → artifact/resource URL
```

Run payloads, operation names, result schemas, and persistence tables are owned
by the app runtime. This is what lets an existing app be ported without adding
an app-specific Launcher screen or Gateway route.

The Launcher also provides the common model settings screen at `/api/settings/agent`. The Gateway stores these settings in SQLite and creates a per-run Backend view with the selected model and reasoning effort, so app runtimes remain provider-agnostic.

## Responsibility audit

- Launcher does not contain an app ID switch or Character Chat schema. It renders the manifests returned by `GET /api/apps` and links to each manifest's `entry`.
- Gateway does not contain Character Chat routes. It dynamically discovers `apps/*/manifest.json`, delegates app resources to the matching runtime, and owns only the common run/event/settings protocol.
- Character Chat owns its tables, resource paths, prompts, memory rules, and screen under `apps/character-chat/`.
- Challenge Tree owns its learning domain, Zod schemas, core learning logic, React screens, and SQLite resources under `apps/challenge-tree/`. Its original IndexedDB and Connector transport are replaced by `adapter/storage.ts` and `adapter/gateway-client.ts`; no learning-domain UI was reimplemented in Launcher or Gateway.
- `gateway/imagegen.js` is an infrastructure adapter. It exposes an image-generation boundary to apps and keeps Codex CLI invocation out of app code; it must remain app-neutral if more image-capable apps are added.

## Resource-light operations

SQLite uses WAL mode. Runs and events are durable; active in-memory controllers are intentionally process-local. If the process restarts, a client can inspect durable run history. For this personal deployment, authentication is expected to be supplied by the Tailscale/reverse-proxy boundary.

## Adding a second app

Create a directory under `apps/` with `manifest.json`, an entry UI, and a
`runtime.js` exporting `createApp()` when Agent execution or persistence is
needed. Keep any adapter, schema, and prompt changes in that directory. Restart
Gateway. No Launcher code or app-specific Gateway branch is required.
`apps/demo-app` is the protocol smoke-test example and `apps/challenge-tree` is
a larger upstream port using app-owned SQLite resources. See
[`docs/app-adapter-guide.md`](app-adapter-guide.md) for the migration checklist.
