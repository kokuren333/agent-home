# EBS Phase 2 Report

- Completed: 2026-09-02
- Scope: Article Identity + Deterministic Lifecycle
- Architecture: `automation/ebs/core/` and `automation/ebs/cli/`
- Non-goals preserved: indexes, sitemap, doctor, scheduler, Wikipedia, static build/deploy, ResearchOS, SQLite

## 1. Inventory result

`scripts/ebs/inventory-articles.ts` recursively inventories `10_Published/`, `11_Daily/`, and `12_Forecasting/` using filesystem APIs. `_MOC.md` is excluded. Encyclopedia, daily, and forecast records retain distinct article types; Phase 2 migration applies only to encyclopedia records.

Final inventory:

| Item | Count |
|---|---:|
| All article records | 1 |
| Encyclopedia | 1 |
| Daily | 0 |
| Forecast | 0 |
| Existing IDs in frontmatter | 0 |
| Proposed IDs | 1 |

Each record contains path, filename, title, parsed frontmatter, status, category, subfield, created/updated values, aliases, existing slug/ID, SHA-256 content hash, normalized title, proposed stable ID, and proposed slug. JSON and Markdown reports are written under `_working/migration_reports/`.

## 2. Collision result

| Collision class | Groups |
|---|---:|
| Duplicate title | 0 |
| Duplicate normalized title | 0 |
| Duplicate proposed slug | 0 |
| Duplicate existing ID | 0 |
| Same content hash candidate | 0 |
| Case-insensitive path | 0 |
| Unicode-normalized path | 0 |
| Canonical registry conflict | 0 |
| Unresolved/invalid metadata | 0 |

Title duplicates and same-content candidates are reported but never merged automatically. Apply is blocked by duplicate IDs, final slug collisions, case/Unicode path ambiguity, unsafe IDs, invalid supplied status, unresolved identity data, or conflict with an existing canonical registry record.

## 3. Metadata schema

Canonical article records are stored at `canonical/metadata/articles/<article-id>.yml`. The files use JSON syntax, which is a YAML 1.2 subset, to keep parsing deterministic without adding a YAML dependency.

Runtime validation requires a safe stable ID, one of the four article types, valid lifecycle status, title, slug, source path, timestamps, aliases, and a non-negative current revision. Optional metadata includes category, subfield, image, references, archive reason, content hash, last job ID, and last Git SHA.

Article body files remain at their existing Markdown paths. Metadata is the identity source; title, slug, and source path are mutable attributes and never act as identity.

## 4. Article domain model

`domain/article.ts` defines `ArticleId`, `ArticleType`, `ArticleStatus`, `ArticleMetadata`, `ArticleImage`, and `ArticleReference`. Types are `encyclopedia | news | daily | forecast`; statuses are `draft | review | published | unpublished | archived | deleted`.

Runtime IDs are `art_` plus a fixed-width time component and random component. They are safe for filenames, unique-shaped, and lexically time-sortable. Migration IDs are deterministic hashes of normalized source path plus content hash, preserving repeatability. Existing valid IDs are retained.

Slug generation is deterministic as `<normalized-category>/<normalized-topic>`. Existing slugs are retained. Migration records a slug without renaming the body. NFKC title normalization removes whitespace, symbols, and punctuation for collision reporting.

## 5. Lifecycle transitions

Transition validation is centralized in the domain layer:

```text
draft       -> review | unpublished
review      -> draft | published | unpublished
published   -> unpublished
unpublished -> review | published | archived | deleted
archived    -> unpublished
deleted     -> unpublished (through restore)
```

Same-state publish/unpublish is a no-op. Delete on an already deleted article and rename with unchanged title/slug are no-ops. Restore of a non-deleted article is a safe error. A published article cannot be archived or deleted directly.

## 6. Revision/event design

Storage:

```text
canonical/revisions/<article-id>/<zero-padded-revision>.json
canonical/events/management-events.jsonl
canonical/metadata/tombstones/<article-id>.yml
canonical/metadata/redirects.yml
```

Revision files contain article ID, revision number, timestamp, operation, operation ID, actor, origin, optional job ID, previous/new hashes, optional Git SHA, summary, metadata snapshot, and article-body snapshot. Creation uses exclusive-write semantics, so an existing revision cannot be overwritten.

Each mutating operation writes started/completed or started/failed events. A completed event and its revision share the same operation ID. Job ID and Git SHA are copied to both revision and completion event when the generator supplies them. This schema supports later crash reconciliation without implementing full cross-process recovery in Phase 2.

Delete is tombstone-first and does not remove the body. Restore removes the tombstone only after restoring metadata to `unpublished`. Rollback restores only the selected article metadata/body snapshot and creates a new revision; repository-wide Git checkout is never used.

## 7. CLI commands

Implemented commands:

```text
ebs article list
ebs article show <id|slug|path>
ebs article create --title <title> [options]
ebs article edit <target> [options]
ebs article regenerate <target> [--prompt ...]
ebs article research-update <target> [--prompt ...]
ebs article publish <target>
ebs article unpublish <target>
ebs article archive <target> [--reason ...]
ebs article delete <target> --yes
ebs article restore <target>
ebs article rename <target> [--title ...] [--slug ... --yes]
ebs article history <target>
ebs article rollback <target> --revision <n> --yes
```

All commands support machine-readable `--json`, including structured error responses. Resolver lookup accepts exact ID, current slug, old redirected slug, or normalized exact path. It does not use fuzzy title matching. Multiple resolver matches are rejected. Delete, rollback, and slug rename require explicit `--yes`; the service layer has no interactive concerns.

The CLI default queue directory is resolved from the Vault root rather than the current shell directory, preventing accidental nested queues on Windows. Direct executable detection uses `pathToFileURL` and was verified through `npm run ebs`.

## 8. Migration result

`scripts/ebs/migrate-article-metadata.ts` defaults to dry-run. Only `--apply` writes canonical records. The generated report is `_working/migration_reports/ebs-v0.1-article-migration.md`.

After the zero-collision dry-run, one encyclopedia article was migrated:

```text
ID: art_FA3A6B44A79B112D6F95006B73
Title: GPUとは何か――グラフィックボードとの定義の違い
Revision: 1
Status: published
```

The initial revision includes the metadata and complete body snapshot, linked to paired migration events by one operation ID. A subsequent `--apply` was verified idempotent: event count remained 2 before and after, and the article SHA-256 remained unchanged. No article frontmatter, body, filename, or directory was rewritten.

## 9. Tests added

Phase 2 adds coverage for:

- safe/time-sortable runtime ID shape and deterministic migration IDs;
- lifecycle transitions and invalid transitions;
- title/slug normalization and duplicate-slug rejection;
- inventory exclusion and collision detection;
- metadata save/load/list and ID/slug/path/redirect resolution;
- append-only revision overwrite rejection;
- tombstone creation/removal and redirects;
- create identity reservation before generator failure;
- deterministic metadata edit;
- create/publish/unpublish/archive/delete/restore/rename/history/rollback;
- regenerate versus research-update operation separation;
- before/after hashes, job IDs, and real temporary-Git SHAs;
- event/revision operation-ID correspondence;
- idempotent no-ops and safe invalid restore;
- CLI JSON/human output, resolver behavior, exit codes, and `--yes` protection.

Lifecycle generator fixtures use temporary Git repositories and temporary Vaults. They create real commits and record actual commit SHAs. Existing Phase 1 worktree/publisher integration tests remain unchanged.

## 10. Total test result

Final verification from `automation/discord_bot/`:

```text
npm test          # 33 passed, 0 failed
npm run typecheck # passed
npm run build     # passed
```

The original 20 Phase 1 tests remain present and passing. Thirteen Phase 2 tests are present. The complete suite includes real temporary repositories, worktrees, merge/push behavior, article lifecycle, repository, inventory, and CLI checks.

## 11. Existing article compatibility

Existing Markdown locations and EBE frontmatter are preserved. The registry points to existing paths and does not require an `ebs_id` or slug backfill. MOCs are excluded from article identity. Daily and forecasting files are inventoried as separate types and are not passed through encyclopedia CRUD migration.

Legacy Discord `/article mode:update` behavior remains available through the Phase 1 JobService compatibility path. No new lifecycle rules were placed in Discord. New CLI regenerate/research-update operations use the same Phase 1 article job queue through the `ArticleGenerator` port and preserve the operation type in the revision ledger.

## 12. Git tracking implications

`git check-ignore` reports no ignore rule for `canonical/metadata/**`, `canonical/events/**`, or `canonical/revisions/**`. These canonical records therefore appear as untracked files in this checkout and are eligible for repository-specific tracking. No global or repository `.gitignore` policy was changed. `_working/migration_reports/` remains governed by the existing working-artifact policy.

In a private canonical repository, metadata/events/revisions should be included deliberately in the same review/backup policy as other canonical state; a public mirror may need an explicit allowlist decision.

## 13. Remaining Discord compatibility paths

Discord article creation/update still submits legacy `new|update` jobs. Full article CRUD slash commands and interactive Discord confirmations are intentionally not part of Phase 2. The adapter continues to call JobService and does not duplicate ContentService lifecycle validation.

The CLI ArticleGenerator adapter enqueues the existing asynchronous article pipeline and records its job ID. ContentService itself treats a generator result as completion and is integration-tested with real source changes and Git commits. Automatic post-worker reconciliation of asynchronous Discord/CLI job completion back into a second metadata revision is not implemented; the recorded job ID and event/Git fields provide the schema needed for that reconciliation.

## 14. Risks

- Canonical metadata and event files are not yet committed in this checkout; private/public tracking policy must be chosen deliberately.
- Filesystem writes are atomic and revisions are exclusive-create, but there is no cross-process transaction or lock. Multiple concurrent EBS management processes should not mutate the same article in Phase 2.
- An asynchronous queued generation records the queue-side management operation; automatic worker-completion reconciliation is still a compatibility gap. Synchronous ContentService generators record final hashes and Git SHAs correctly.
- Event append and metadata/revision writes are separate filesystem operations. A process crash can leave a started event or a revision/metadata mismatch; identifiers make this detectable but Phase 2 does not auto-repair it.
- JSON-as-YAML is standards-valid, but tooling that assumes human-style YAML formatting may need adaptation.
- The current public-mirror-shaped checkout may not contain private runtime jobs or workflows described by older documentation.

## 15. Phase 3 blockers

Before deterministic public build/index work, Phase 3 must decide or implement:

1. canonical metadata/event Git tracking and private/public mirror policy;
2. worker-completion reconciliation for queued article operations;
3. crash reconciliation using operation ID, job ID, revision, and Git SHA;
4. cross-process mutation locking or a later transactional repository;
5. deterministic MOC/search/category/related/backlink/sitemap generation;
6. published-only build exclusion for draft, review, unpublished, archived, deleted, and tombstoned records;
7. static build and deployment boundaries.

No Phase 3 index, doctor, scheduler, static-site, Cloudflare, Wikipedia, ResearchOS, vector database, or Web Admin implementation was introduced during Phase 2.
