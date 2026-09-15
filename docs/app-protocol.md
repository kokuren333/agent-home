# App Protocol v0.1

Status: initial implemented contract.

The protocol is deliberately app-neutral. Character, conversation, prompt, and message are not protocol concepts; they belong to `character-chat`.

## App manifest

Every app has `apps/<directory>/manifest.json`:

```json
{
  "id": "demo-app",
  "name": "Hello Agent",
  "description": "A small app",
  "version": "0.1.0",
  "icon": "✨",
  "entry": "/apps/demo-app/ui/index.html",
  "capabilities": ["run", "stream"]
}
```

Required fields are `id`, `name`, `description`, `version`, `icon`, `entry`, and `capabilities`. `id` is the stable URL-safe identifier. `icon` is either a short fallback emoji or a same-origin raster image URL; new apps should use a square PNG under their own `ui/assets/` directory. The Launcher list is generated only from these manifests.

## Capabilities

`run` starts work, `stream` indicates that events may be consumed incrementally, `cancel` indicates cancellation support, `storage` indicates app-owned SQLite persistence, and `resources` indicates app-specific resource endpoints.

## Common API

All responses are JSON unless the events endpoint is requested with `Accept: text/event-stream`.

| Method | Path | Meaning |
|---|---|---|
| GET | `/api/apps` | all discovered manifests |
| GET | `/api/apps/:id` | one manifest |
| POST | `/api/apps/:id/runs` | create a run; body is app-owned input; returns `202` |
| GET | `/api/runs/:id` | current run |
| GET | `/api/runs/:id/events` | event array, or live SSE stream |
| POST | `/api/runs/:id/cancel` | request cancellation |
| GET | `/api/health` | Gateway/backend status |
| GET | `/api/settings/agent` | current Gateway-wide Agent model settings |
| PUT | `/api/settings/agent` | update Gateway-wide Agent model settings |
| GET | `/api/settings/agent/models` | model catalog reported by the active backend (Codex CLI for `codex`) |

App-owned resources, when declared, are delegated under `/api/apps/:id/resources/*`. The Gateway routes them but does not interpret their schema.

## Types

```ts
type RunStatus = 'queued' | 'running' | 'completed' | 'failed' | 'cancelled';
type Capability = 'run' | 'stream' | 'cancel' | 'storage' | 'resources';

interface Run {
  id: string; appId: string; status: RunStatus; input: unknown;
  createdAt: number; startedAt: number | null; finishedAt: number | null;
  error: string | null;
}
interface Event {
  id: string; runId: string; type: string; data: unknown; createdAt: number;
}
interface Artifact {
  id: string; runId: string; kind: string; name: string; uri: string; createdAt: number;
}
interface Error { code: string; message: string; details?: unknown; }
```

The initial event types are `run.started`, `message.delta`, `message.completed`, `run.completed`, `run.failed`, `run.cancelled`, and `artifact.created`. `data` is typed by the emitting app. Apps may add event types without changing the common run model.

## Gateway-wide Agent settings

The Launcher owns the user interface for the default `model` and `reasoningEffort` selection. The initial defaults are `gpt-5.6-luna` and `low`. The settings are stored in the Gateway's SQLite database and are applied to every app run at run start. An app does not need to know which CLI or provider is selected.

`model` is an optional provider model identifier. The Launcher obtains selectable model IDs from `/api/settings/agent/models`; it does not maintain a hardcoded model list. For the Codex adapter, this catalog comes from `codex debug models` and is filtered to models visible in the list and supported by the API. An empty value means use the backend/CLI default. `reasoningEffort` is one of `''`, `low`, `medium`, `high`, `xhigh`, `max`, or `ultra`; an empty value means use the model default. The Codex CLI adapter translates these values to its command-line options. Other adapters may translate or ignore them according to their own capabilities.

## Runtime contract

An app runtime exports `createApp({ db, store })`, returning:

```js
{
  async run(input, { backend, signal, emit, db, store }) { /* app-owned */ },
  async resources({ method, path, body, query }) { /* optional */ }
}
```

`emit(type, data)` is the only way an app publishes run events. `backend` implements `stream(prompt, options)`, `cancel()`, and `health()`. The Gateway may also call the backend's optional `listModels()` for the global settings screen. Current adapters are `mock` and `codex-cli`; app code does not import or call Codex directly.
