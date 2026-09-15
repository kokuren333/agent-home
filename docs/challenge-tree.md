# Challenge Tree integration

ChallengeTree was originally a Vite/React frontend with browser IndexedDB and a local Connector that started Codex App Server. The agent-home adapter keeps the learning workflow but changes the boundary:

```text
Challenge Tree UI
    -> POST /api/apps/challenge-tree/runs + SSE
    -> agent-home Gateway
    -> AgentBackend (mock or Codex CLI)
```

Workspace data is stored in the app-owned `challenge_tree_workspaces` SQLite table. The Gateway only sees a generic run and delegates `/api/apps/challenge-tree/resources/*` to `apps/challenge-tree/runtime.js`.

The first vertical slice includes workspace create/list/delete, AI tree generation, node expansion, challenge display, answer grading, SQLite persistence, mock development responses, Codex CLI execution, and a mobile-first UI. The original Connector, IndexedDB implementation, Vite build chain, and portable Connector binaries are intentionally not copied into agent-home. Challenge Tree only shows the shared Gateway connection state; model/reasoning and connector setup are configured in the Launcher.

On each app load, the original one-node Transformer sample is ensured by the app client. If that sample is deleted, it is recreated on the next load without replacing the user's other workspaces.

The original app also contains native web-search evidence handling, import/export bundles, detailed research history, and several advanced editing flows. Those remain follow-up work; they do not belong in the Gateway and should be added inside this app if needed.
