# Apps directory

Every child directory is an independently registered App Protocol application.
The Gateway discovers `manifest.json` files here and the Launcher renders the
returned manifests; adding an app does not require editing either one.

For existing applications, use the preservation-first adapter process in
[`docs/agent-porting-guide.md`](../docs/agent-porting-guide.md) and the detailed
boundary guide in [`docs/app-adapter-guide.md`](../docs/app-adapter-guide.md).
Keep the original
UI and domain code inside the app, and isolate Connector, storage, and Agent
changes in that app's adapter/runtime boundary.

Minimal installable app:

```text
apps/my-app/
├─ manifest.json
├─ runtime.js          # required for run/resources apps; omit for static-only apps
└─ ui/index.html
```

An app with a backend usually adds `schema/`, `prompts/`, and `adapter/`.
Upstream source layouts may be preserved when that makes syncing and testing
safer; the boundary rule is more important than identical filenames.

Copying a self-contained app directory into `apps/` and restarting the Gateway
installs it. `apps/demo-app/` is the complete protocol sample, including
streaming, cancellation through the common run API, SQLite storage, and
app-owned resources.
