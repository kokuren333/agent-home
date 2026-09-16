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

## Research-first generation

AI-created learning data uses two Codex CLI runs. The first is a research-only run with `standalone_web_search` enabled and returns verified source URLs. The second receives those URLs as `verifiedResources` and creates the tree, its first challenge, and source links. The Gateway refuses to complete `tree_propose`, `node_create`, or `node_expand` when the research run did not produce both a search event and at least one URL. This prevents an unsourced question from being presented as a completed learning artifact.

The proposal adapter also normalizes model-specific node IDs. If a returned challenge points to a proposal-internal root ID, it is remapped to the concrete `initialNodes` ID before the workspace is saved. Therefore a newly selected tree always contains its initial challenge when the model returned one.

On each app load, the original one-node Transformer sample is ensured by the app client. If that sample is deleted, it is recreated on the next load without replacing the user's other workspaces.

The original app also contains native web-search evidence handling, import/export bundles, detailed research history, and several advanced editing flows. Those remain follow-up work; they do not belong in the Gateway and should be added inside this app if needed.
