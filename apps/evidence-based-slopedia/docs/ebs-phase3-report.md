# EBS Phase 3 Implementation Report

Date: 2026-09-02  
Scope: Site Integrity / Rebuildable Indexes / Static Build / Doctor

## 1. Canonical/publication rule

`publicationPolicy.ts` is the single publication boundary used by indexes, MOCs, sitemap, related/backlink calculation, and static builds. An article is public only when its canonical metadata has `status: published`, it has no tombstone, its source path is safe and exists, required metadata is valid, and the current body hash equals the canonical hash. Draft, archived, deleted, failed, missing, unsafe, and hash-mismatched records are excluded.

## 2. Reconciliation implementation

Queued article operations carry the article ID, operation type, source path, and operation ID. Worker completion resolves the produced source, then records the final source hash, Git SHA, lifecycle state, revision, and terminal management event. Failed jobs receive a failure terminal event. `ReconciliationService` repairs safely inferable revision counters and completed jobs, is idempotent, and reports ambiguous started/running operations as review-required. Startup reconciliation and `ebs reconcile` use the same service.

## 3. Locking strategy

Filesystem lock files under `canonical/.locks/` provide cross-process exclusion. Creation uses exclusive file creation, bounded retry/timeout, stale-lock recovery, and token-checked release. Global rebuild/create operations and per-article mutations use scoped locks. Revisions are additionally created with exclusive writes, preventing overwrite even if callers race.

## 4. Index formats

Generated artifacts include `search-index.json`, `category-index.json`, `backlink-index.json`, `related.json`, `sitemap.xml`, deterministic MOC Markdown, and `manifest.json`. Entries are stably sorted. The manifest records per-index hashes, canonical source revision hash, generated date, and public article count. A partial rebuild is marked stale until every required index was rebuilt from the same canonical state.

## 5. MOC migration result

MOC generation is deterministic and no longer delegates maintenance to an LLM. It generates title-sorted category/subfield views with stable article-ID comments under `generated/moc/`. Existing human-authored MOCs are preserved; compatibility differences are written to `_working/migration_reports/moc-diff.md`. Discord's all/published MOC maintenance path now invokes the Core generator directly; daily generation remains review-only.

## 6. Related algorithm

Candidate scores are: same subfield +5, same category +3, direct outbound link +4, backlink +2, and shared alias +1. Results are sorted by descending score and then stable identity, with a maximum of ten results. Only public candidates are eligible.

## 7. Backlink algorithm

Obsidian wikilinks and Markdown links are parsed while images, assets, and external URLs are excluded. Targets resolve through canonical ID, slug, source path/basename, title, and aliases. Missing and ambiguous targets are reported. Outbound and backlink sets are deduplicated and deterministically sorted.

## 8. Sitemap

The sitemap is generated exclusively from the shared public set. It contains stable article URLs and no canonical filesystem paths, job metadata, actors, events, worktree data, or private lifecycle records.

## 9. Static build layout

The static site contains a home page, `articles/<encoded-slug>/index.html`, category pages, public search data, sitemap, CSS assets, and a build manifest. Article pages contain metadata, summary, image metadata/placeholder, body, references already present in the body, related articles, and revision/update information. Internal links become public article URLs. Mermaid fences render as safe non-SPA Mermaid blocks.

## 10. Global validation

Before atomic publication, validation checks exact public article/page membership, duplicate or orphan pages, search/category/MOC membership, related and backlink visibility, broken internal links, sitemap URL equality, and build/index source hashes. Any failure discards the temporary build and retains the previous `dist` unchanged.

## 11. Doctor checks

Doctor covers duplicate IDs/slugs, unsafe or missing sources, hash mismatch, metadata gaps, lifecycle/tombstone contradictions, revision/event drift, broken or ambiguous links, invalid redirects/loops, missing or stale indexes, private indexed records, orphan generated artifacts, MOC omissions/duplicates/private entries, global build validity, interrupted/failed runtime residue, and image metadata/path/extension/alt issues. Findings use INFO, WARNING, ERROR, and CRITICAL severities and support JSON output.

## 12. Doctor fixes

`doctor --fix` performs only deterministic safe repairs: reconciliation and revision-counter repair, complete index/MOC regeneration, stale derived-artifact cleanup, and static rebuild when validation permits. Semantic link retargeting, ambiguous runtime recovery, and missing editorial image metadata remain review-required.

## 13. CLI additions

Added `ebs reconcile`, `ebs index rebuild --search|--category|--moc|--related|--backlinks|--sitemap|--all`, `ebs build [--article <target>]`, `ebs doctor [--fix]`, and `ebs rebuild`. Commands provide structured JSON and stable failure behavior. `ebs rebuild` runs reconciliation, full index regeneration, global validation, and atomic site build.

## 14. Test additions

Phase 3 tests cover public-only index behavior, deterministic rebuilds, Windows separators, MOC/backlink/related/sitemap generation, atomic build retention, internal-link and Mermaid rendering, Doctor detection/fixes, queued completion and crash reconciliation, cross-instance mutation locking, duplicate-revision protection, concurrent article mutation, every new CLI route, and canonical-management Git publication.

## 15. Total tests/results

On 2026-09-02:

- `npm test`: 49 passed, 0 failed.
- `npm run typecheck`: passed.
- `npm run build`: passed.
- Real-Vault `ebs rebuild`: passed with 1/1 canonical article public.
- Two consecutive real rebuilds: 14 generated/dist files, byte-stable, 0 differences.
- `ebs doctor --json`: healthy; one review-only WARNING for missing image metadata on the migrated GPU article.
- Public `dist` leak scan for canonical paths, source paths, worktrees, jobs, actors, failed state, and tombstones: no matches.

## 16. Performance characteristics

Indexes and validation currently scan the canonical article set in memory. Stable sorting and hashing are linearithmic in article count; related scoring is pair-oriented and may become quadratic at large scale. Filesystem locks use bounded polling. Atomic builds require temporary disk capacity approximately equal to `dist`. This is appropriate for the current Vault and remains measurable before Phase 4 scale work.

## 17. Remaining Discord legacy paths

Discord job execution still hosts the existing worker pool, Codex adapter, worktree manager, and Git publisher behind Core ports. Legacy already-queued `moc_maintenance` jobs remain executable for backward compatibility, while new all/published MOC requests use deterministic Core generation. Legacy image maintenance remains outside the Phase 3 deterministic publication path.

## 18. Git/public mirror policy

Canonical metadata, revisions, and events are tracked private management state and are committed before worker publication. `canonical/.locks/`, `generated/`, temporary/final `dist`, and generated runtime artifacts are ignored and rebuildable. Public output is produced only through the publication policy and strips source paths and operational metadata. Existing unrelated working-tree changes were preserved and were not reverted or cleaned.

## 19. Risks

The existing GPU article lacks public image metadata and therefore retains a Doctor warning. Ambiguous crashed operations intentionally require review. Lock staleness depends on a conservative timeout. Existing hand-maintained MOC semantics may differ from generated ordering and are reported rather than overwritten. Related scoring is lexical/structural rather than semantic. Cross-machine distributed locking is not provided.

## 20. Phase 4 blockers

Before autonomous discovery/generation, Phase 4 should define scheduler ownership and idempotency, queue-idle coordination, source/research quality gates, rate and resource budgets, semantic related-search scaling, distributed deployment locking, public deployment credentials and rollback, and a policy for resolving review-required crashes. Cloud deployment, autonomous scheduling, Wikipedia/topic discovery, embeddings, and Web Admin were intentionally not implemented in Phase 3.
