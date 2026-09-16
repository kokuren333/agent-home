# Existing app adapter guide

This is the standard for bringing an existing web app into `agent-home` without
making the Launcher or Gateway app-specific.

## Core rule

Keep the original UI and domain behavior. Replace only the boundaries that
cannot remain browser-local:

```text
original UI / domain code
        |
app adapter (inside the app directory)
        |
agent-home Gateway / App Protocol
```

The Launcher must never parse an app's run payload or know its domain objects.
The Gateway must provide common run/event/storage plumbing, but must not contain
branches such as `if (appId === 'challenge-tree')`.

## Directory convention

Use this layout for a new app or a substantial port:

```text
apps/<app-id>/
├─ manifest.json             # Launcher registration
├─ runtime.js                # Gateway-side app adapter/runtime
├─ adapter/                  # replacements for external app boundaries
│  ├─ gateway-client.*       # optional browser run/event client
│  └─ storage.*              # optional app resource client
├─ schema/                   # app-owned input/output schemas
├─ prompts/                  # app-owned Agent instructions
├─ ui/                       # static UI, or the built entry
└─ src/                      # original source when using a build tool
```

The `adapter/`, `schema/`, and `prompts/` directories are only needed when the
app has those concerns. A static app may contain only `manifest.json`, `ui/`,
and optionally `runtime.js`.

For a port where the upstream repository already has a strong source layout,
keep that layout. Put the adapter next to the relevant boundary if moving files
would make upstream updates or tests harder. Challenge Tree uses this exception:
its upstream `src/` is preserved, with `src/gateway.ts` and `src/db.ts` acting
as its adapters.

## Boundary mapping

| Existing app dependency | Adapter responsibility | Must not move to |
|---|---|---|
| Local Connector / CLI process | call `/api/apps/<id>/runs` and common SSE | Launcher |
| IndexedDB / browser-only database | call `/api/apps/<id>/resources/*` | Gateway common tables |
| Direct LLM/API call | use the runtime `backend` | app UI |
| Per-app model selector | remove or map to a non-model app option | app UI / runtime |
| App-specific settings | keep under that app's resources | global `agent_settings` |
| Original UI and domain rules | preserve in the app | Launcher |

## Runtime shape

Each app runtime exports `createApp()` and owns its payload schemas:

```js
export function createApp({ db, store, imageGenerator }) {
  return {
    async run(input, { backend, signal, emit, db, store }) {
      // Validate input, call backend, validate/normalize output,
      // then emit app-specific progress/result events.
    },
    async resources({ method, path, body, query }) {
      // Optional app-owned persistence API.
    },
  };
}
```

The common event envelope is fixed by App Protocol. The contents of
`progress`, `message.delta`, and `result.completed` remain app-owned. Validate
the app result in the runtime before emitting `result.completed`; a browser UI
may validate again for safety, but it must not be the only validator.

When the Agent needs structured output, pass an operation-specific JSON Schema
to the backend if the adapter supports it. If a repair is needed, send the
failed output and the concrete validation paths to the Agent. A boolean such as
`repair: true` by itself is not a repair protocol.

## Migration procedure

1. Copy or clone the upstream app under `apps/<app-id>/` and record its source
   revision in an app README or port document.
2. Inventory direct network calls, local storage, CLI processes, model settings,
   authentication, and build output. Do not change the UI yet.
3. Add and validate `manifest.json`. Confirm the Launcher discovers it without a
   new Launcher code path.
4. Add `runtime.js` only for the operations that need Gateway execution.
5. Replace direct Agent/Connector calls with the app adapter and the abstract
   `backend` supplied by the Gateway.
6. Replace IndexedDB or other device-local persistence with app-owned Gateway
   resources when data must be shared between phone and PC.
7. Remove provider-specific setup and model controls from the app. The Launcher
   owns the common Agent model and reasoning settings.
8. Preserve the upstream UI, schemas, tests, and build. Run the upstream tests
   before and after the boundary replacement.
9. Add one protocol test covering discovery, the app run, event completion, and
   resource persistence/deletion when applicable.
10. Verify the built entry through the same URL returned by `/api/apps` on both
    desktop and a Tailscale-connected phone.

## Capability selection

Declare only what the app really uses:

- `run`: the app starts Gateway runs
- `stream`: the app consumes incremental events
- `cancel`: the app can cancel an active run
- `storage`: the app persists data through its runtime
- `resources`: the app exposes app-owned resource endpoints

Capabilities describe the contract; they do not cause the Launcher to render
app-specific controls. A future app may add a capability only after the common
protocol behavior and a conformance test are defined.

## Acceptance checklist

- [ ] The Launcher lists the app from its manifest only.
- [ ] No Launcher file imports the app's schema or operation names.
- [ ] No common Gateway file contains an app ID branch.
- [ ] The app's runtime validates its own input and output.
- [ ] Agent/CLI/provider details are absent from the app UI.
- [ ] Required persistence is under the app's resource namespace.
- [ ] Existing app UI and behavior are not silently removed.
- [ ] A mock run works without external credentials.
- [ ] Codex run errors expose the actual validation or backend cause.
- [ ] The app works from its manifest entry URL through Tailscale.

