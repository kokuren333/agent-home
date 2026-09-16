# Apps directory

Every child directory is an independently registered App Protocol application.
The Gateway discovers `manifest.json` files here and the Launcher renders the
returned manifests; adding an app does not require editing either one.

For existing applications, use the preservation-first adapter process in
[`docs/app-adapter-guide.md`](../docs/app-adapter-guide.md). Keep the original
UI and domain code inside the app, and isolate Connector, storage, and Agent
changes in that app's adapter/runtime boundary.

Minimal app:

```text
apps/my-app/
├─ manifest.json
├─ runtime.js          # omit when the app is static-only
└─ ui/index.html
```

An app with a backend usually adds `schema/`, `prompts/`, and `adapter/`.
Upstream source layouts may be preserved when that makes syncing and testing
safer; the boundary rule is more important than identical filenames.

