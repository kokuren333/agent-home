# EBS Phase 1 Report

- Completed: 2026-09-02
- Scope: Characterization tests, Core extraction, CLI MVP, Discord job-management migration
- Architecture option: `automation/ebs/core/` + `automation/ebs/cli/` (Option B only)

## 1. Added tests

Characterization and integration coverage was added for:

- Json JobRepository / legacy JobStore compatibility:
  - create, unique IDs, queued status, timestamps, payload persistence
  - createMany ordering
  - get and recent ordering
  - queued/running cancellation behavior
  - retry without source mutation
  - queue pause/resume persistence
  - temporary-file replacement and restart readback
  - interrupted running/waiting_publish/publishing recovery
- WorkerSupervisor:
  - FIFO selection
  - paused queue
  - resource guard block
  - concurrency ceiling
  - success/failure handler sequencing
  - cancellation AbortSignal propagation
- ResourceGuard:
  - healthy, high RAM, high CPU through injected system metrics
- WorktreeManager using temporary Git repositories:
  - sanitized branch/path
  - external worktree creation
  - real commit
  - collision rejection
  - worktree and branch cleanup
  - retained failed-worktree cleanup policy
- SourceIntegrationPublisher using temporary bare remotes and clones:
  - worker commit
  - rebase, `merge --no-ff`, and push
  - forbidden-path rejection
  - dirty-main rejection
  - single-process publish serialization
- CLI:
  - human/JSON output
  - status/list/status/retry/cancel/pause/resume
  - stable success, failure, invalid-argument, and not-found exit codes

## 2. Test count / results

Final verification commands are run from `automation/discord_bot/`:

```text
npm test
npm run typecheck
npm run build
```

The final test suite contains 20 tests. Temporary repositories and worktrees are created under the operating-system temporary directory; tests do not mutate the user's repository.

## 3. New Core modules

```text
automation/ebs/core/src/domain/job.ts
automation/ebs/core/src/ports/jobRepository.ts
automation/ebs/core/src/ports/contentExecutor.ts
automation/ebs/core/src/ports/worktreeManager.ts
automation/ebs/core/src/ports/sourceIntegrationPublisher.ts
automation/ebs/core/src/ports/resourceGuard.ts
automation/ebs/core/src/infrastructure/jsonJobRepository.ts
automation/ebs/core/src/services/jobService.ts
automation/ebs/core/src/services/workerSupervisor.ts
automation/ebs/core/src/application.ts
automation/ebs/core/src/index.ts
```

Minimum future-facing domain types now exist: `JobId`, `JobType`, `JobStatus`, `JobPriority`, `JobOrigin`, and `JobActor`. Existing job types and states remain unchanged.

`JobService` accepts an optional operation logger with service, operation, job ID, origin, result, and duration fields. This is intentionally not a full event ledger.

## 4. Existing modules moved/wrapped

- The JSON queue behavior moved from `discord_bot/src/queue/jobStore.ts` to Core `JsonJobRepository`.
- `JobStore` remains as a configuration-aware compatibility adapter, preserving current imports and ID generation.
- `WorkerPool` delegates queue selection, resource admission, concurrency, active-worker tracking, and cancellation to Core `WorkerSupervisor`; the existing job execution/publish algorithm remains in place.
- `workspaceManager.ts` exposes the existing algorithm as a `WorktreeManager` adapter.
- `gitPublisher.ts` exposes the existing algorithm as a `SourceIntegrationPublisher` adapter.
- `codexRunner.ts` exposes existing Codex behavior as a `ContentExecutor` adapter.
- `resourceGuard.ts` preserves exported legacy functions and adds injected system metrics for tests.
- `types.ts` re-exports Core job types to preserve Bot module compatibility.

## 5. CLI commands implemented

```text
ebs status
ebs job list [--json]
ebs job status <id> [--json]
ebs job retry <id> [--json]
ebs job cancel <id> [--json]
ebs queue pause [--json]
ebs queue resume [--json]
```

Run from `automation/discord_bot/` with:

```text
npm run ebs -- <arguments>
```

Exit codes:

- `0`: success
- `1`: operation failure
- `2`: invalid arguments
- `3`: not found

## 6. Discord commands migrated

These commands now use the shared `JobService`:

- `/article` enqueue
- `/multi_article` enqueueMany
- `/job-status`
- `/job-list`
- `/job-cancel`
- `/job-retry`
- `/queue-pause`
- `/queue-resume`
- `/bot-health` job counts and queue state

Discord still imports the compatibility JobStore because daily/news/forecast/MOC/image helper services have not yet been migrated. The management commands listed above no longer call its methods directly.

## 7. Behavior intentionally unchanged

- JSON persistence and process-local promise locking
- FIFO queue ordering
- current job types and states
- retry and cancellation semantics
- five-second worker polling
- CPU/RAM resource policy thresholds
- worktree branch creation and cleanup algorithm
- Codex prompts and content generation semantics
- durable-prefix check, MOC/image validators, worker commit, rebase, merge, and push algorithms
- single-process publish lock
- failed worktree retention defaults
- daily news and forecasting schedules
- article filesystem layout and bodies

No CRUD, article identity migration, index rebuild, autonomous scheduler, Wikipedia integration, SQLite, Cloudflare deployment, or MOC rewrite was added.

## 8. Remaining direct Discord→infrastructure dependencies

- The Discord adapter still passes JobStore to daily news, daily forecast, MOC maintenance, and image maintenance enqueue helpers.
- `/codex` enqueues through JobService but remains a deprecated root-worktree admin escape hatch. Documentation now states that it is not the canonical EBS management path.
- `/git-status` and `/git-debug` still call Git publisher utility functions directly.
- `/worker-list`, active cancellation, and failed-worktree cleanup still use the WorkerPool compatibility facade.
- Discord notification and administrator checks remain adapter-local by design.

These are explicit post-Phase-1 seams; article lifecycle and index work should not be built into Discord while they remain.

## 9. Files changed

New/updated implementation is limited to:

- `automation/ebs/core/**`
- `automation/ebs/cli/**`
- `automation/discord_bot/src/**` boundary integrations
- `automation/discord_bot/test/**`
- `automation/discord_bot/package.json`
- `automation/discord_bot/package-lock.json`
- `automation/discord_bot/tsconfig.json`
- `automation/discord_bot/README.md`
- `docs/ebs-migration-audit-addendum.md`
- `docs/ebs-phase1-report.md`

Pre-existing unrelated `.obsidian/` and `00_Index/` modifications were not edited or cleaned.

## 10. Commits

No commits were created in this checkout. This avoids accidentally including pre-existing unrelated working-tree modifications. The Phase 1 files can be staged explicitly and split into characterization/core/CLI/Discord commits by the repository owner.

## 11. Risks / TODO for Phase 2

- JSON persistence remains single-process and has no schema version or event ledger.
- The publish lock remains process-local.
- Crash reconciliation cannot yet determine whether merge/push partially completed.
- The runtime publish gate is still broad and content-policy enforcement still relies heavily on the EBE/Codex workflow.
- The public-mirror checkout lacks private runtime data and active GitHub workflows.
- Discord still has the direct dependencies listed above.
- Job origin/actor/priority types exist but are not persisted to legacy jobs yet; behavior was intentionally preserved.
- Operation logging has a port shape but no durable event store.

## Current blockers for Phase 2

1. The private canonical repository and representative `jobs.json` must be inventoried before adding schema migrations.
2. Existing article identity collisions cannot be assessed from the public-mirror-sized article set.
3. A canonical tracking decision is required because this checkout's `.gitignore` excludes article bodies, evidence, images, and logs that EBS expects to version in its private source repository.
4. Phase 2 needs a dry-run article metadata inventory and collision report before writing IDs or slugs.
5. Revision/event storage must define crash reconciliation with Git commit and pushed SHA before deterministic rollback is introduced.
