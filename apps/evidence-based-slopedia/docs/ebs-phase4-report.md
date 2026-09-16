# EBS Phase 4 Implementation Report

Date: 2026-09-02

## 1. Scheduler architecture

Core now owns `SchedulerService`, `AutoGenerationService`, and the generic `ScheduledTaskService`. The bot and CLI are adapters. Autonomous ticks choose their next 5–10 minute interval after completion; daily news and forecast callbacks are scheduled by the Core calendar service.

## 2. Priority queue design

Jobs support P0–P4, `scheduledAt`, and `idempotencyKey`. Selection is priority first and FIFO within a priority. Legacy jobs default safely to P1; news/forecast use P3 and autonomous encyclopedia jobs use P4. A queued human request therefore precedes autonomous work.

## 3. Scheduler ownership/locking

`canonical/.locks/scheduler.lock` uses the Phase 3 filesystem-lock implementation. Tick IDs are stable hashes of the scheduled minute. The persistent tick ledger stores scheduled, started, completed, result, and next-tick data. Registry mutation also uses the same cross-process lock.

## 4. Resource admission

Autonomous admission checks queue pause, higher-priority queued/active work, worker availability through the existing resource guard, and machine-readable reasons. `ResourceAdmissionService` additionally supports disk free space, repository/assets size, active workers, queue depth, and recent failure rate. Human jobs are not blocked by auto-specific admission.

## 5. Rate/cap system

Successful autonomous articles are counted separately from attempts. Configured hourly/daily caps default to 6/50. Candidate attempt timestamps support audit and cap calculation.

## 6. Candidate registry

`canonical/autonomous/registry.json` is a schema-versioned, atomic, cross-process-locked private registry. It stores every required candidate identity, source, status, attempts, cooldown, article/job relation, rejection reason, and similarity result, plus scheduler state and ticks.

## 7. Existing article discovery

A stable public seed is expanded into prerequisite, application, and comparison candidates. Candidate generation is bounded and one accepted candidate is admitted per tick. Seed article ID/category are retained privately.

## 8. Wikipedia discovery

The REST client uses Japanese then English fallback, bounded timeout, two retries, exponential backoff, and a descriptive user-agent. Only title, URL/page identity, short summary, type, and retrieval context are used. Disambiguation/list/year/stub seeds are rejected and recorded. Wikipedia failure falls back to existing-article discovery and never bypasses normal evidence research.

## 9. Topic normalization

NFKC normalization removes instructional wrappers such as “初心者向けに…詳しく説明” and emits canonical topic, preferred title, aliases, category, and seed reference.

## 10. Duplicate detection

Deterministic checks cover exact title, normalized title, generated slug, aliases, redirects through article resolution data, and active candidate-registry entries. Duplicates are persisted with target and reason before any semantic call.

## 11. Semantic dedup design

Semantic comparison is an optional port, so startup does not depend on embeddings or a vector database. Scores at or above 0.90 are duplicate; 0.80–0.90 may invoke the optional structured judge. Flat comparison is replaceable by an ANN implementation later.

## 12. Auto generation pipeline

Accepted topics invoke the normal `ContentService.create()` and existing article generator/job/worker/worktree/evidence/publish/reconciliation pipeline. Private article metadata records autonomous origin, topic source, seed, candidate ID, discovery time, and job relation. Successful reconciliation marks the candidate generated and runs full index/static rebuild. No autonomous quality shortcut exists.

## 13. Failure cooldown

Failures use 1 hour, 6 hours, 24 hours, then 7 days/review-required semantics. Attempt counts and timestamps remain auditable. Worker failures update the linked candidate without affecting human work.

## 14. Circuit breaker

The most recent ten autonomous attempts are inspected; five failures stop new auto admission with `high_failure_rate`. Manual pause, resource, queue, caps, and runtime reasons remain machine-readable.

## 15. Maintenance scheduling

The scheduler exposes a periodic maintenance callback boundary every twelve autonomous ticks. The existing reconciliation, Doctor, deterministic indexes, and build services remain the safe maintenance primitives. Successful autonomous articles always rebuild immediately.

## 16. News migration

Daily news and forecast timer ownership moved from Discord-specific timer functions to Core `ScheduledTaskService`. Existing enqueue/prompt behavior is retained. Jobs are P3 and date/field keyed for idempotency.

## 17. CLI/Discord controls

CLI: `ebs auto status|pause|resume|run-once|candidates|retry` and `ebs scheduler tick`, with `--json` and `--dry-run`. Discord: `/auto-status`, `/auto-pause`, `/auto-resume`, `/auto-run`; handlers only call Core services.

## 18. Persistence changes/SQLite if used

SQLite was not introduced. The existing JobRepository contract and rollback-friendly JSON queue remain canonical; priority fields are backward-compatible. Autonomous state is isolated in a schema-versioned atomic JSON registry. Existing JSON is neither deleted nor destructively migrated.

## 19. Test additions

Seven Phase 4 tests cover P1/P3-before-P4, FIFO, legacy priority, idempotent enqueue, normalization, deterministic candidate/article dedup, Wikipedia rejection/fallback, cross-process scheduler ownership, duplicate ticks, dry-run, busy/manual/resource admission, normal ContentService enqueue, private autonomous metadata, and increasing cooldown.

## 20. Total test results

- `npm test`: 56 passed, 0 failed (all prior 49 retained).
- `npm run typecheck`: passed.
- `npm run build`: passed.

## 21. Real Vault smoke test

`ebs auto status --json` succeeded. `ebs auto run-once --dry-run --json` selected the existing GPU article, produced and normalized an accepted prerequisite-concept candidate, ran deterministic dedup, recorded the tick/candidate, and enqueued no article job. A concurrent status/dry-run test exposed and then verified the repair of registry cross-process locking. A repeated same-minute run correctly returned `duplicate_tick`.

## 22. Performance

JSON registry operations are whole-file and semantic comparison is O(n); this suits a single low-resource host and the current Vault. Related and semantic flat scans should be replaced behind existing ports near 10,000 articles. Directory-size admission scans exclude `.git`, `node_modules`, generated, and dist trees.

## 23. Risks

The built-in existing-article expansion is deterministic and conservative rather than LLM-rich. Semantic embeddings/judge are optional and not configured by default. JSON persistence is single-host only. Automatic scheduling is enabled by default in runtime configuration and should be manually paused during operational review. The migrated GPU article still has the Phase 3 image-metadata warning.

## 24. Phase 5 blockers

Phase 5 must address production service installation, Cloudflare deployment/rollback, backup automation, secrets, full image generation/validation, distributed ownership, large-registry/ANN migration, richer topic-worthiness models, operational metrics/alerts, and Web Admin. Multi-machine workers remain intentionally unsupported.
