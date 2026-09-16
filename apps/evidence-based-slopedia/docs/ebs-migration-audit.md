# Evidence Based Slopedia v0.1 Migration Audit（完了済みの移植記録）

> この文書は移植前の監査記録です。冒頭の「未実装」「追加予定」は現在のagent-home実装を示しません。現行仕様は [EBS README](../README.md) を参照してください。

- Audit date: 2026-09-02 (Asia/Tokyo)
- Inspected repository: `Evidence-Based-Everything`
- Branch: `main`
- Scope: repository inspection only; no EBS implementation has been added
- Requested target: Evidence Based Slopedia (EBS), with CLI / Service API / Management Core as canonical interfaces and Discord as an adapter

## Executive summary

The repository already contains a useful isolated execution spine: a JSON-backed job store, a polling worker pool, Git worktree creation, Codex execution, lightweight validation, serialized main-branch publication, retry/cancel, resource checks, MOC/image maintenance jobs, daily news scheduling, and daily forecasting scheduling. These implementations are concentrated under `automation/discord_bot/src/`.

The principal architectural problem is not the absence of all infrastructure; it is ownership. Queue, worker, publishing, and maintenance logic live in a package named and bootstrapped as a Discord Bot. Discord command handlers directly construct jobs and call the store or worker. There is no canonical EBS ContentService, IndexService, JobService, Publisher facade, CLI, stable article identity registry, deterministic article lifecycle, revision ledger, generated index tree, doctor command, autonomous encyclopedia scheduler, or static-site build pipeline.

The safest migration is therefore extraction and extension:

1. Move reusable queue/worktree/publisher primitives behind an EBS core package without changing their behavior first.
2. Introduce stable article metadata and a migration inventory before changing filenames or article bodies.
3. Implement deterministic lifecycle transactions and rebuildable indexes in the core.
4. Add the CLI as the first canonical adapter.
5. Refactor Discord to call the same application services.
6. Add autonomous scheduling only after lifecycle, deduplication, doctor, and index rebuilding are reliable.

No parallel queue, publisher, article writer, or index writer should be introduced beside the existing implementations.

## Inspection boundary and repository-state caveat

The inspected checkout appears to be a public-mirror-shaped repository rather than the complete private runtime repository described by the README:

- `.github/` is absent, although `README.md` refers to `.github/workflows/sync-public-mirror.yml` and `.github/workflows/sync-public-articles.yml`.
- Reference workflow copies exist only under `config/public-mirror/`.
- `.gitignore` excludes generated article Markdown, durable evidence, images, logs, runtime job data, and worktree artifacts.
- The current Git history is dominated by commits named `Sync public mirror from private vault`.
- Only three Markdown files are currently present under `10_Published/`; none contains an `id:` or `slug:` field.
- `automation/discord_bot/data/`, runtime logs, and external worktrees are intentionally absent.
- Existing unrelated working-tree modifications were observed in `.obsidian/` and `00_Index/` and were not changed by this audit.

Consequently, this document distinguishes between code that was verified in this checkout and private/runtime behavior described but not directly inspectable here. Before Phase 1 implementation, the same audit commands should be run against the canonical private repository and a representative runtime data snapshot.

## 1. Current EBE architecture

### Runtime composition

`automation/discord_bot/src/index.ts` is the composition root. It:

1. loads environment-backed configuration;
2. creates runtime data, log, and worktree directories;
3. initializes `JobStore`;
4. marks interrupted jobs `failed_review_required`;
5. creates the Discord client and notifier;
6. creates and starts `WorkerPool`;
7. starts daily-news and daily-forecast timers;
8. handles process shutdown.

The effective dependency flow is:

```text
Discord commands / daily timers
  -> JobStore (JSON queue)
  -> WorkerPool
  -> ResourceGuard
  -> WorkspaceManager (Git worktree)
  -> CodexRunner (LLM content/maintenance execution)
  -> MOC/Image/Durable-change checks
  -> GitPublisher (commit, rebase, merge, push)
  -> Notifier
```

### Configuration

- `automation/discord_bot/src/config.ts` reads `.env` directly and exports a single global `config` object.
- `config/ebe.config.yml` describes Vault/content policy but is not consumed by the TypeScript runtime.
- Runtime and content configuration are therefore split across environment variables, YAML policy files, and hard-coded constants.
- Default worker concurrency is 4, while EBS targets a low-resource default of 1 for article generation.

### Content architecture

- `_working/` contains provisional artifacts.
- `10_Published/`, `11_Daily/`, and `12_Forecasting/` contain user-facing Markdown according to policy.
- `20_EvidencePackets/`, `30_Sources/`, and `40_Claims/` are durable evidence stores after publication.
- `50_Assets/` contains generated media.
- `60_MOCs/` and `_MOC.md` files are navigation artifacts.
- `70_Logs/` contains audit and operation logs.
- Article generation and many maintenance actions are executed by Codex prompts assembled in `codexRunner.ts`, not by deterministic management code.

### Missing EBS layers

There is no independent application/core package, no service API, no CLI executable, no static site generator, no `canonical/` versus `generated/` boundary, and no database or metadata registry that separates article identity from path.

## 2. Discord Bot command map

Commands are registered in `automation/discord_bot/src/discord/registerCommands.ts` and implemented as a single conditional chain in `discord/client.ts`.

| Discord command | Current implementation | Core behavior reached | EBS migration disposition |
|---|---|---|---|
| `/article` | `JobStore.create` | generic `article` Codex job | Map to `ContentService.create` / `JobService.enqueue` |
| `/multi_article` | local prompt expansion + `createMany` | multiple generic article jobs | Keep as adapter helper; enqueue typed jobs through service |
| `/codex` | generic root Codex job | direct main-worktree LLM changes | Deprecate as management path; retain tightly restricted diagnostics only |
| `/job-status` | `JobStore.get` | reads JSON job | Map to `JobService.status` |
| `/job-list` | `JobStore.recent` | reads JSON jobs | Map to `JobService.list` |
| `/job-cancel` | `JobStore.cancel` + active abort | cancel flag / AbortController | Map to `JobService.cancel` |
| `/job-retry` | `JobStore.retry` | creates cloned queued job | Map to `JobService.retry` with source-job relation |
| `/daily-news` | `enqueueDailyNewsJobs` | typed Codex news jobs | Move scheduling/job creation into NewsService |
| `/daily_forecast` | `enqueueDailyForecastJobs` | typed Codex forecast jobs | Preserve as separate pipeline, outside core encyclopedia articles |
| `/moc-maintenance` | `enqueueMocMaintenanceJob` | LLM-driven MOC rebuild | Replace write path with deterministic `IndexService.rebuildMoc` |
| `/image_maintenance` | `enqueueImageMaintenanceJob` | LLM-driven path repair | Split deterministic validation/repair from optional content generation |
| `/job-cleanup` | `WorkerPool.cleanupFailedWorktrees` | removes old failed worktrees/branches | Move to MaintenanceService; preserve dry-run |
| `/worker-list` | `WorkerPool.listActiveWorkers` | in-memory worker list | Map to JobService/WorkerSupervisor status |
| `/queue-pause` | `JobStore.setQueuePaused(true)` | global queue pause | Map to JobService queue control |
| `/queue-resume` | `JobStore.setQueuePaused(false)` | global queue resume | Map to JobService queue control |
| `/git-status` | `gitStatus` | repository inspection | Move to Doctor/Status service |
| `/git-debug` | `debugSyncMain` | direct add/commit/push on main | Deprecate from normal operation; dangerous admin-only escape hatch |
| `/bot-health` | store counts + resource snapshot | operational health | Map to `ebs status` / `ebs doctor` |

The Bot currently bypasses an application service layer. It knows `JobStore`, `WorkerPool`, resource configuration, and Git publisher functions directly. This is the primary extraction seam.

## 3. Current article lifecycle

### Represented lifecycle

The article job accepts only `mode: new | update`. Codex is instructed to create or update an EBE article and to write into policy-defined Vault roots. The TypeScript runtime does not parse article frontmatter to implement a state machine.

Published article frontmatter requires `status`, `draft`, `publish_ready`, and review metadata, but it does not currently require stable `id` or `slug`. The inspected published Markdown files have neither field.

### Actual lifecycle control

```text
query
  -> Codex prompt
  -> files created/changed in isolated worktree
  -> image path check (selected job types)
  -> broad durable-prefix change check
  -> Git commit
  -> merge/push
```

There are no deterministic primitives for edit, regenerate, research-update, publish, unpublish, archive, delete, restore, rename, history, or rollback. Update behavior is content-prompt semantics, not a management transaction.

### Gate weakness

`publishGateChecker.ts` only verifies that at least one changed path starts with a durable prefix. It does not prove that:

- frontmatter is valid;
- all required audits passed;
- the target article exists exactly once;
- unpublished/deleted content is absent from public artifacts;
- MOCs/indexes are current;
- article and evidence records agree;
- image format/dimensions/size/alt policy is satisfied.

The EBE skill workflow may perform stronger checks, but the runtime gate does not independently enforce them.

## 4. Current job lifecycle

### Types

Current job types are:

```text
article
daily_news
daily_forecast
moc_maintenance
image_maintenance
codex
```

Current states are:

```text
queued
running
waiting_publish
publishing
succeeded
failed
failed_review_required
cancelled
```

These are defined in `src/types.ts` and persisted by `queue/jobStore.ts`.

### Persistence and locking

- Jobs and queue pause state are stored in `automation/discord_bot/data/jobs.json` by default.
- Writes use a temporary file followed by rename, giving process-local atomic replacement.
- A promise chain serializes operations inside one Node process.
- There is no cross-process lock, database transaction, schema version, priority field, idempotency key, dependency graph, attempt table, or event log.
- Multiple Bot processes would race on the same JSON file; the README explicitly advises running only one.

### Retry and cancel

- Queued cancellation immediately sets `cancelled`.
- Running/publishing cancellation sets `cancelRequested`; active Codex execution also receives an AbortController signal.
- Retry clones a failed/cancelled job into a new queued job and stores a human-readable `Retry of ...` summary.
- No explicit parent/attempt relation, retry policy, cooldown, or maximum-attempt policy exists.

### Crash recovery

On startup, jobs left in `running`, `waiting_publish`, or `publishing` become `failed_review_required`. This avoids silently declaring success but does not inspect Git/worktree/push state to determine whether a publish partially completed.

## 5. Current worktree lifecycle

`runners/workspaceManager.ts` is the canonical worktree implementation.

1. Fetch configured remote/branch.
2. Create an external worktree and a job-specific branch from `origin/main` (or configured equivalents).
3. Run Codex and validators in that worktree.
4. Commit worker changes.
5. Rebase the worker branch onto the latest remote main.
6. Merge into main with `--no-ff` under a process-local publish lock.
7. Push main.
8. Remove successful worktree/branch unless configured to retain it.
9. Retain failed worktrees by default; cleanup is an explicit operation.

Strengths:

- Failed content generation normally does not modify main.
- Publish is serialized in one process.
- Main must be clean before publication.
- Obvious secret/runtime paths are rejected before commit.

Risks:

- Branch/worktree names are derived from job IDs but there is no startup reconciliation with `git worktree list`.
- Cleanup uses forced worktree removal and branch deletion; safety depends on stored paths and helper sanitization.
- Publish lock is in memory and does not coordinate multiple processes or hosts.
- MOC-only conflicts are resolved by choosing the rebased branch's `ours` side and then invoking Codex to repair MOCs. This is not deterministic.
- A crash after merge but before job persistence can leave state ambiguous.
- Root `/codex` jobs bypass worktree isolation entirely.

## 6. Existing queue implementation

`queue/jobStore.ts` plus `queue/workerPool.ts` form the canonical queue.

- Selection is FIFO by `createdAt`.
- There is one global pause flag.
- Worker polling occurs every five seconds.
- Resource checks occur before dequeuing each job.
- Concurrency is global, not per job class.
- There is no P0–P4 priority, reservation for human work, deduplication, scheduled-at time, rate limit, or low-priority auto queue.
- `maxPublishers` exists in configuration but is not used; publication is effectively limited by the module-level promise lock.

Reuse recommendation: retain its public behavior initially, but extract a `JobRepository` interface and move orchestration to `JobService`/`WorkerSupervisor`. Replace JSON only after contract tests exist; SQLite is the best fit for a single low-resource host requiring transactions, indexes, priorities, event history, cooldowns, and crash recovery.

## 7. Existing indexing/MOC implementation

Current indexing is Obsidian-MOC oriented:

- MOC content is stored as Markdown under category/subfield roots, `00_Index/`, and `60_MOCs/`.
- `services/mocMaintenance.ts` creates an LLM maintenance job.
- `codexRunner.ts` prompts Codex to scan and rewrite MOCs.
- `mocIntegrityChecker.ts` checks only suspected mojibake across selected roots.
- Rebase conflict repair also delegates MOC reconstruction to Codex.

There is no deterministic search index, category index, related-article index, backlink index, sitemap generator, freshness manifest, or index hash. No `generated/` directory or static-site `dist/` exists.

MOCs are currently treated operationally as editable content even though EBS requires them to be rebuildable derived artifacts. The future canonical inputs should be article metadata and explicit category metadata; MOC Markdown should be generated from those inputs.

## 8. Existing image management

### Current policy

EBE requires a top-of-article imagegen raster PNG and an infographic generation log. Daily and forecasting assets use separate locations. The repository ignores generated media by default in this public-mirror-shaped checkout.

### Runtime validation

`runners/imagePathChecker.ts`:

- scans article Markdown for Obsidian and Markdown image syntax;
- accepts PNG, JPEG, GIF, SVG, WebP, and AVIF extensions;
- verifies local resolution or accepts external-scheme targets;
- rejects ambiguous basename-only local references;
- does not validate image decoding, WebP-only policy, dimensions, byte size, aspect ratio, alt text, metadata ownership, or one-image-per-article.

`services/imageMaintenance.ts` delegates repairs to Codex. This can be retained for semantic recovery but must not remain the canonical path validator or deterministic repair implementation.

### EBS gap

EBS requires article metadata such as:

```yaml
image:
  path: assets/articles/art_....webp
  alt: ...
```

and deterministic checks for file existence, WebP decoding, approximate 1200×675 dimensions, size target, valid path, and alt text. Existing PNG infographics must be migrated non-destructively; conversion should create WebP siblings and update metadata only after validation.

## 9. Current publishing path

### Private repository path

`runners/gitPublisher.ts` is the verified canonical Git publisher:

```text
worker changes
  -> forbidden-path checks
  -> worker commit
  -> clean-main assertion
  -> pull --rebase
  -> worker rebase
  -> merge --no-ff
  -> push main
```

### Public mirror path

The checkout includes reference workflow files under `config/public-mirror/`, but no active `.github/workflows/` directory. The reference workflows describe:

- an allowlisted infrastructure/policy mirror; and
- a public-articles repository containing selected indexes, published/daily Markdown, MOCs, and referenced assets.

No static-site build, `dist/`, Cloudflare deployment, deployment manifest, cache invalidation, or transaction tying article state to public deployment is present in the inspected tree.

### EBS requirement

Split publishing into:

```text
canonical source commit
  -> deterministic build into dist/
  -> global validation
  -> atomic/declarative deploy adapter
  -> publish event record
```

The Git publisher should remain one adapter for source integration, not the definition of whether an article is publicly published.

## 10. Existing tests

No test/spec files were found. `package.json` provides `build` and `typecheck` scripts only; it has no test script or test framework dependency. `node_modules` is absent in this checkout, so compilation was not used as evidence in this audit.

There are standalone Python utilities under `.agents/skills/**/scripts/`, including Vault structure, citation, taxonomy inventory, subfield stub, and stale-article helpers. They are operational scripts, not an integrated regression suite.

Required test layers before behavioral refactoring:

- unit tests for metadata parsing, lifecycle transitions, slug normalization, duplicate detection, index generation, image validation, and resource decisions;
- contract tests for the extracted JobRepository and Publisher interfaces;
- integration tests using temporary Git repositories/worktrees;
- CLI tests for exit codes and JSON/human output;
- Discord adapter mapping tests;
- crash-window and idempotency tests;
- golden tests proving full index rebuild is stable and deleted/unpublished articles are excluded.

## 11. Components reusable without changes

“Without changes” here means behavior can be preserved behind an interface during initial extraction; imports and package location may still change.

- `utils/shell.ts`: command execution and Git invocation wrappers.
- `utils/paths.ts`: job/branch/worktree path sanitization, after dedicated safety tests.
- `runners/workspaceManager.ts`: basic external worktree creation/removal flow.
- `services/resourceGuard.ts`: CPU and RAM sampling as an initial guard.
- `services/accessControl.ts`: Discord administrator check, remaining adapter-local.
- `services/notifier.ts`: Discord notification formatting, remaining adapter-local.
- EBE article-generation skills and shared publish-quality policies.
- Daily news and forecasting prompt content as separate pipeline inputs.
- Git forbidden-path checks in `gitPublisher.ts`.
- Existing `_working → durable evidence → published` artifact policy as migration input.

## 12. Components needing extraction/refactor

### Extract first

- `queue/jobStore.ts` → `JobRepository` implementation under core/infrastructure.
- `queue/workerPool.ts` → `WorkerSupervisor` using `JobService` and typed job handlers.
- `runners/gitPublisher.ts` → `SourceIntegrationPublisher` behind a Publisher interface.
- `runners/workspaceManager.ts` → reusable WorktreeManager infrastructure.
- `runners/codexRunner.ts` → content-generation executor; remove management primitives from its prompt router.
- `services/resourceGuard.ts` → ResourceGuard port with CPU, RAM, disk, repository size, queue size, and active-worker checks.

### Replace or deepen

- `publishGateChecker.ts`: replace broad path-prefix detection with article/global validators and build verification.
- `mocIntegrityChecker.ts`: replace mojibake-only check with deterministic link/index validation.
- `imagePathChecker.ts`: add metadata-based WebP, dimensions, size, alt, and ownership validation.
- `mocMaintenance.ts`: route to deterministic IndexService rather than Codex.
- `imageMaintenance.ts`: split deterministic fixable cases from review-required semantic work.
- `dailyNews.ts` / `dailyForecast.ts`: separate scheduler policy from job construction and Discord notification.
- `config.ts`: load validated unified EBS config and allow dependency injection in tests.
- `discord/client.ts`: reduce to input parsing, authorization, confirmation, service calls, and output rendering.

## 13. Components to deprecate

- `/codex` as a canonical management operation.
- `/git-debug action:all` as a routine sync/publish path.
- LLM-authored MOC rebuilds as canonical index maintenance.
- LLM-authored filesystem CRUD for unpublish/delete/restore/rename/rollback.
- Filename or path as implicit article identity.
- Generic `article` + `mode` as the only content-management job model.
- Broad “durable path changed” as the publish gate.
- Single-process JSON locking as the final persistence model.
- Discord channel/user fields as mandatory fields on every core job; actor/origin should be adapter-neutral.
- Direct global configuration imports throughout core code.

## 14. Migration risks

| Risk | Evidence | Impact | Mitigation |
|---|---|---|---|
| Public mirror differs from private canonical repository | Missing `.github/`, ignored content/runtime data, mirror-style Git history | Audit may miss private workflows and real article scale | Repeat inventory on private repo before implementation merge |
| Existing articles have no stable IDs/slugs | 0 of 3 inspected published Markdown files contain either field | Rename/delete/restore can target the wrong file | Dry-run migration registry; deterministic IDs; collision report |
| Dirty main blocks current publisher | Existing tracked modifications are present | Worker publication fails at clean-main check | Do not modify unrelated files; document operational precondition |
| MOC repair is nondeterministic | Codex invoked after selected rebase conflicts | Rebuilds may vary and hide missing links | Build MOCs from metadata; golden/idempotency tests |
| Publish gate is too weak | Only durable prefix checked | Invalid or half-managed content may merge | Typed validators plus staged build and global audit |
| JSON queue is single-process | Promise lock only | Corruption/races under multi-process recovery | SQLite transaction layer and schema migration |
| Crash window around merge/push | Startup only changes job state | Duplicate or ambiguous publication | Operation/event ledger; reconcile Git SHA and deployment state |
| No rollback metadata | Git history only, no article revision ledger | User cannot safely target revision | ArticleRevision table with hashes and Git SHA |
| Delete spans derived artifacts | No deterministic indexes or transaction | Half-deleted article/index states | Tombstone-first transaction, rebuild indexes, atomic dist switch |
| Image policy changes PNG→WebP | Current policy and validators allow multiple formats | Broken embeds or quality loss during migration | Non-destructive conversion, metadata backfill, decode/dimension tests |
| Auto generation can starve users | Queue has FIFO only | Low-priority work occupies limited host | P0–P4 priority and admission checks before P4 starts |
| Resource guard is incomplete | CPU/RAM only | Disk/repository exhaustion | Add disk, repo/assets size, queue, worker checks |
| Duplicate detection absent | No canonical topic/aliases registry | Autonomous article duplication | Registry plus normalized title/slug/aliases; semantic hook optional |
| No integrated tests | No test files/framework | Refactor regressions likely | Characterization tests before extraction |
| Tracked-content policy conflicts with EBS | `.gitignore` excludes generated articles/assets/logs | EBS requirement for source/image Git history cannot hold | Decide private canonical tracking policy before migration |

## 15. Proposed exact file/module changes

The paths below are the proposed Phase 1–10 target. Existing implementations should be moved or wrapped, not duplicated.

### Package and composition

```text
package.json                         # root workspace scripts: ebs, test, build, typecheck
tsconfig.base.json                   # shared strict compiler options
packages/ebs-core/package.json
packages/ebs-core/src/index.ts
packages/ebs-cli/package.json
packages/ebs-cli/src/main.ts
automation/discord_bot/package.json  # depend on @ebs/core; no core implementation
```

If introducing a workspace is too disruptive for the current deployment, use the same boundaries initially under `automation/ebs/`; do not create both layouts.

### Domain model

```text
packages/ebs-core/src/domain/article.ts
  ArticleId, ArticleStatus, ArticleMetadata, ArticleImage, lifecycle transition rules

packages/ebs-core/src/domain/job.ts
  EBS job types/states/priorities, actor/origin, attempts, idempotency keys

packages/ebs-core/src/domain/revision.ts
  revision number, operation, job ID, hashes, Git SHA, diff summary

packages/ebs-core/src/domain/events.ts
  append-only management event definitions
```

### Application services

```text
packages/ebs-core/src/services/contentService.ts
  create/edit/regenerate/research-update/publish/unpublish/archive/delete/restore/rename/history/rollback

packages/ebs-core/src/services/jobService.ts
  enqueue/list/status/retry/cancel/pause/resume/priority/idempotency

packages/ebs-core/src/services/indexService.ts
  search/MOC/category/related/backlink/sitemap/all rebuild

packages/ebs-core/src/services/buildService.ts
  canonical source -> dist, per-article and full build

packages/ebs-core/src/services/doctorService.ts
  inspection findings, safe fixes, machine-readable report

packages/ebs-core/src/services/autoGenerationService.ts
  tick/admission/source mix/caps/cooldown/candidate registry

packages/ebs-core/src/services/newsService.ts
  separate news fetch/generate lifecycle

packages/ebs-core/src/services/maintenanceService.ts
  stale worktree, failed-job residue, scheduled doctor/index work
```

### Ports and infrastructure

```text
packages/ebs-core/src/ports/articleRepository.ts
packages/ebs-core/src/ports/jobRepository.ts
packages/ebs-core/src/ports/eventRepository.ts
packages/ebs-core/src/ports/publisher.ts
packages/ebs-core/src/ports/contentGenerator.ts
packages/ebs-core/src/ports/topicSource.ts
packages/ebs-core/src/ports/clock.ts

packages/ebs-core/src/infrastructure/sqlite/schema.sql
packages/ebs-core/src/infrastructure/sqlite/jobRepository.ts
packages/ebs-core/src/infrastructure/sqlite/articleRepository.ts
packages/ebs-core/src/infrastructure/sqlite/eventRepository.ts
packages/ebs-core/src/infrastructure/git/worktreeManager.ts
packages/ebs-core/src/infrastructure/git/sourceIntegrationPublisher.ts
packages/ebs-core/src/infrastructure/codex/contentGenerator.ts
packages/ebs-core/src/infrastructure/filesystem/articleFiles.ts
packages/ebs-core/src/infrastructure/filesystem/atomicDirectorySwap.ts
```

Move behavior from the current files as follows:

| Current file | Target owner |
|---|---|
| `queue/jobStore.ts` | SQLite JobRepository adapter after characterization tests |
| `queue/workerPool.ts` | JobService + WorkerSupervisor |
| `runners/workspaceManager.ts` | Git WorktreeManager adapter |
| `runners/gitPublisher.ts` | SourceIntegrationPublisher + MOC rebuild hook through IndexService |
| `runners/codexRunner.ts` | Codex ContentGenerator; content jobs only |
| `services/resourceGuard.ts` | core ResourceGuard service/port |
| `services/dailyNews.ts` | NewsService plus scheduler adapter |
| `services/dailyForecast.ts` | separate ForecastService plus scheduler adapter |
| `discord/client.ts` | Discord adapter calling application services |

### Canonical and generated data

Preserve existing Markdown locations during v0.1 migration, but introduce a machine-owned registry:

```text
canonical/metadata/articles/<article-id>.yml
canonical/metadata/tombstones/<article-id>.yml
canonical/metadata/redirects.yml
canonical/categories.yml
canonical/auto-topic-state.sqlite   # or same EBS SQLite DB

generated/search-index.json
generated/category-index.json
generated/related.json
generated/backlink-index.json
generated/sitemap.xml
generated/index-manifest.json
dist/
```

Do not move or rewrite all existing article bodies in the identity migration. The registry should initially point to current Markdown paths.

### CLI commands

```text
packages/ebs-cli/src/commands/article/*.ts
packages/ebs-cli/src/commands/index/*.ts
packages/ebs-cli/src/commands/job/*.ts
packages/ebs-cli/src/commands/queue/*.ts
packages/ebs-cli/src/commands/auto/*.ts
packages/ebs-cli/src/commands/build.ts
packages/ebs-cli/src/commands/validate.ts
packages/ebs-cli/src/commands/doctor.ts
packages/ebs-cli/src/commands/status.ts
```

Every command should call an application service and support stable nonzero exit codes plus optional JSON output for Discord and future APIs.

### Migration tooling

```text
scripts/ebs/inventory-articles.ts
scripts/ebs/migrate-article-metadata.ts
scripts/ebs/convert-article-images.ts
scripts/ebs/verify-migration.ts
_working/migration_reports/ebs-v0.1-*.md
```

Migration must default to dry-run, report duplicate titles/slugs/aliases, preserve article bodies, and avoid overwriting existing metadata.

### Configuration

```text
config/ebs.yml
config/ebs.schema.json
```

Consolidate auto interval/jitter, caps, source weights, worker concurrency, image policy, resource thresholds, maintenance cadence, paths, and deployment adapter settings. Secrets remain environment-only. `config/ebe.config.yml` should be read and migrated rather than silently ignored.

### Tests

```text
packages/ebs-core/test/unit/**
packages/ebs-core/test/integration/git-worktree.test.ts
packages/ebs-core/test/integration/lifecycle.test.ts
packages/ebs-core/test/integration/index-rebuild.test.ts
packages/ebs-core/test/integration/crash-recovery.test.ts
packages/ebs-cli/test/commands.test.ts
automation/discord_bot/test/command-mapping.test.ts
test/fixtures/vault/**
```

## 16. Implementation order

### Phase 0 — complete this audit, then verify private repository parity

1. Commit this audit separately.
2. Run inventory against the private canonical repository and runtime job/worktree data.
3. Record discrepancies as an addendum before code extraction.

### Phase 1 — characterization and core extraction

1. Add tests around current JobStore, WorkerPool sequencing, worktree flow, forbidden-path checks, publish lock behavior, and crash recovery.
2. Define domain types and ports.
3. Wrap current JSON store, worktree manager, Codex runner, and Git publisher behind those ports without behavior changes.
4. Introduce a non-Discord composition root.
5. Implement `ebs status`, job list/status/retry/cancel, and queue pause/resume through JobService.

Exit condition: Bot and CLI exercise the same JobService; Discord contains no queue/publisher implementation.

### Phase 2 — article identity and deterministic lifecycle

1. Inventory existing articles and generate dry-run ID/slug proposals.
2. Resolve collisions without rewriting bodies.
3. Write article metadata registry and revision/event ledger.
4. Implement lifecycle transitions and transaction plans.
5. Add create/edit/regenerate/research-update/publish/unpublish/archive/delete/restore/rename/history/rollback CLI commands.

Exit condition: ID remains stable across rename/slug change; unpublish/delete/restore/rollback are idempotent and tested.

### Phase 3 — rebuildable indexes and build boundary

1. Generate search, category/MOC, related, backlink, sitemap, and manifest outputs from canonical metadata/content.
2. Add per-index and `--all` CLI rebuilds.
3. Add deterministic MOC generation.
4. Build into `dist/`; never edit `dist/` as source.
5. Validate exclusion of draft/unpublished/archived/deleted articles.

Exit condition: two full rebuilds are byte-stable (except documented timestamps), and deletion leaves no public stale entry.

### Phase 4 — doctor and global validation

Implement all required findings, then safe `--fix` operations. Semantic changes must remain review-required.

Exit condition: broken links, duplicates, orphan articles, stale indexes, invalid statuses/frontmatter, job/worktree residue, accidental publication, and image failures are test-covered.

### Phase 5 — Discord adapter refactor

Replace direct Store/Worker/Git calls with service calls. Add confirmations for destructive operations. Restrict or remove `/codex` and `/git-debug all` from normal management.

### Phase 6 — autonomous scheduler and priority queue

1. Add P0–P4 priorities and admission policy.
2. Set article-generation concurrency default to 1.
3. Add interval jitter, hourly/daily caps, queue-empty check, and resource guard.
4. Add disk/repository/assets growth checks and automatic pause reason.
5. Add maintenance slots.

### Phase 7 — topic discovery and deduplication

Add existing-article and Wikipedia-random topic sources, normalization, rejection reasons, candidate registry, duplicate checks, and failure cooldown. Wikipedia output must feed independent evidence discovery.

### Phase 8 — auto article generation integration

Route accepted candidates into the same article-create and quality/build/publish pipeline as human requests. No reduced quality gate is allowed.

### Phase 9 — image migration

Add one-image metadata, validated WebP conversion, 1200×675 policy, size/alt checks, and shared hero/thumbnail build behavior. Convert non-destructively and retain rollback information.

### Phase 10 — deployment and regression documentation

1. Add the actual private-repository workflow or deployment adapter.
2. Document Ubuntu/systemd operation, backup, restore, crash recovery, SQLite migration, and Cloudflare/static-host deployment.
3. Run the complete acceptance matrix on a temporary clone and a staging deployment.

## EBS v0.1 acceptance-gap matrix

| Area | Current evidence | Status before implementation |
|---|---|---|
| Create article | Generic Codex article job exists | Partial; no stable ID/service primitive |
| Edit/regenerate separation | Only `mode: update` prompt semantics | Missing |
| Unpublish/delete/restore/rollback | No deterministic operations | Missing |
| Full index rebuild | MOC maintenance prompt only | Missing |
| Search/related/backlink/sitemap | No generators found | Missing |
| Failed job isolation | External worktree for non-`codex` jobs | Present with caveats |
| Retry/cancel | Implemented in JobStore/WorkerPool | Present, needs core extraction |
| Doctor | Bot health/resource snapshot only | Missing |
| Broken-link detection | Image links only; no general internal-link scan | Partial |
| Queue-empty autonomous generation | Daily fixed-time schedulers only | Missing |
| Existing/Wikipedia topic discovery | No implementation found | Missing |
| Duplicate prevention | Daily target-path checks only | Missing for encyclopedia articles |
| Hour/day caps and priority | FIFO queue only | Missing |
| Resource pressure skip | CPU/RAM before worker dequeue | Partial |
| Same quality gate for auto | No auto article pipeline | Missing |
| One WebP per article | Current policy favors PNG infographic | Missing; migration required |
| Static build/dist/publish | Git merge/push only | Missing |

## Recommended immediate next action

Do not begin CRUD or scheduler implementation yet. First, obtain/inspect the private canonical repository state corresponding to the runtime described in the README, then add characterization tests around the verified queue/worktree/publisher path. The first production code change should be an application-service boundary around the existing implementations, not a replacement queue or a second publisher.
