# EBS Phase 5 Implementation Report

Date: 2026-09-02

## 1. Public URL architecture

`PublicUrlService` centrally generates article, topic, news, asset, home, search, recent, and about URLs. Renderers no longer construct public paths independently.

## 2. Fixed routing/404 issues

Public URL segments use percent encoding, while static filesystem directories retain Unicode names. This lets ordinary static servers decode a Japanese URL to the matching directory. Build-time HTML crawling resolves every internal link, image, stylesheet, and script to a real dist target.

## 3. Portal UI

The home page now contains a structured header, search hero, latest articles, News, topics, recent-navigation, and footer. The visual system is editorial: white/off-white surfaces, a single blue accent, borders, compact cards, and responsive information density.

## 4. Article UI

Article pages provide breadcrumbs, category, update/revision/evidence indicator, hero image, summary card, deterministic h2/h3 table of contents, body, and related articles. Metadata is escaped before rendering.

## 5. Topic/Recent/Search

`/topics/`, `/topics/<topic>/`, `/recent/`, and `/search/` are all real static files. Search uses the public search JSON locally with a two-character threshold; content remains usable without JavaScript.

## 6. News 10-genre integration

The existing ten canonical daily-news categories are consolidated in `config/ebs.yml`. Phase 4 Core scheduling continues to enqueue the ten P3 jobs using its existing daily-news semantics.

## 7. News public routing/UI

News source Markdown under `11_Daily/` is rendered when present to `/news/`, `/news/YYYY-MM-DD/`, and `/news/YYYY-MM-DD/<slug>/`. Empty News states render cleanly without dangling links.

## 8. Image policy

Canonical image metadata supports path, alt, width, height, bytes, SHA-256, generated timestamp, and source type. Public output copies only the asset to `/assets/articles/<article-id>.webp` and exposes no canonical path.

## 9. WebP conversion

`ImageService` uses Sharp, resizes within 1200×675, performs bounded quality reduction, writes atomically, updates metadata only after conversion, and preserves the original. `ebs image migrate --dry-run|--apply` writes an audit report.

## 10. Image generation pipeline

Existing evidence/image generation remains the content-generation authority. Phase 5 supplies the deterministic post-generation canonical conversion/validation boundary; missing generated imagery is a warning path rather than article deletion.

## 11. Image validation/Doctor

Doctor now asks `ImageService` to detect missing/corrupt assets, non-WebP canonical images, missing alt text, oversize files, bad aspect ratios, and hash mismatch. `doctor --fix` safely migrates/refreshes images before rebuilding.

## 12. Portable dist design

`dist/` contains HTML, CSS, small search JS, favicon, copied WebP assets, search JSON, sitemap, robots, feed, and build metadata only. It excludes canonical state, actor/job/worktree/candidate information, local paths, and secrets. A leak scan blocks the build when such data is found.

## 13. basePath support

`EBS_SITE_BASE_PATH` is supported by the URL service; `/` and `/ebs/` are tested. Static HTML remains real files without SPA fallback.

## 14. GitHub Pages deployment

`GitHubPagesDeploymentTarget` is a portable directory-target adapter suitable for a checked-out Pages deployment directory specified through `EBS_GITHUB_PAGES_DIR`. Credentials/repository selection remain external runtime configuration. `ebs deploy --dry-run` works without credentials.

## 15. Deployment abstraction

`DeploymentTarget`, `DeployService`, and a private deployment ledger separate deploy from canonical publication. Directory deployment swaps atomically, skips identical dist hashes, preserves local dist on failure, and has a rollback port for capable targets.

## 16. Windows Service architecture

`scripts/windows/` supplies install, uninstall, start, stop, restart, status, and health-check PowerShell scripts. The installer registers an at-startup Windows Scheduled Task with bounded restart recovery. Core retains scheduler cadence; Windows only starts the runtime.

## 17. Startup/recovery

The existing runtime startup reconciliation is retained before worker/scheduler operation. The health command exposes uptime, queue, autonomous state, and deployment state. Operators stop the task before intentional maintenance.

## 18. Backup/restore

`BackupService` creates manifest-hashed directory snapshots of canonical records, article/news source, assets, config, and queue data; generated/dist are excluded. Verify detects corruption. Restore currently stages a verified candidate under `_working/restore_candidates/` and never overwrites canonical state automatically. The Core `ScheduledTaskService` now runs a daily backup and prunes snapshots while retaining configurable daily/weekly/monthly recovery points.

## 19. Secrets/config

Secrets remain private `.env` runtime data and are not logged. `config/ebs.yml` now records site, image, news-ten-category, deployment-batch, and backup-retention policy. Public rendering does not consume `.env` values.

## 20. Public leak scan

Build fails on canonical paths, worktrees, Discord operational information, API-key/token markers, local Windows/Users paths, candidate registry markers, and tombstones. The real dist scan returned no matches.

## 21. Tests added

Five Phase 5 tests cover central base-path/Japanese URL generation, portable portal routes/crawl-safe output, atomic PNG→WebP conversion with original preservation, directory deploy/no-op plus backup verify/stage behavior, and backup retention.

## 22. Total test results

`npm test` completed with 61 passed and 0 failed. `npm run typecheck` and `npm run build` passed.

## 23. Real autonomous E2E

Phase 4 dry-run remains the real-Vault autonomous smoke path. Full paid/credentialed Codex generation, evidence review, worker publish, and human approval have not been triggered from this checkout because the live Discord/Codex runtime credentials and publish authority are not present in this terminal session.

## 24. News E2E

The Core scheduler and ten-category enqueue behavior are covered by prior queue/scheduler tests; the current Vault has no completed daily-news Markdown, so the portal correctly renders an empty News state. A live ten-job News run requires the configured runtime/API environment.

## 25. Real dist portability test

After `ebs rebuild`, `python -m http.server` served `/`, `/articles/`, `/topics/`, `/news/`, `/search/`, `/404.html`, CSS, and the percent-encoded Japanese GPU article path with HTTP 200. The server was not EBS-specific.

## 26. Deployment smoke test

Directory-target deployment is integration-tested using a temporary host directory. Real-Vault `ebs deploy --dry-run --json` succeeded. No GitHub Pages credentials or deployment repository were available for a public push.

## 27. UI visual review

The generated portal was reviewed in a local static HTTP server at 1440×900 and 390×844. Home-page navigation, card content, and image layout have no horizontal overflow; the article page has a deterministic table of contents, summary card, related links, and public WebP hero. The review also corrected the off-screen skip link so it does not create horizontal document overflow. The visual system has no gradients, pills, or SaaS-style hero treatment.

## 28. Remaining warnings

Doctor is healthy with no findings after GPU WebP migration. News has no public records yet, so its portal section is intentionally empty.

## 29. Risks

GitHub Pages adapter currently deploys to a local checked-out target directory; Git commit/push credentials are intentionally not embedded. Restore is staged, not destructive. The scheduler needs a real configured runtime for live generation. Sharp reports one upstream audit advisory in its dependency tree; no automated audit fix was applied.

## 30. Final production checklist

- Configure `.env` with Discord, model, Git, and optional Pages directory credentials.
- Run `scripts/windows/install-service.ps1` as administrator after reviewing Windows power/network settings.
- Confirm `ebs runtime status`, `ebs doctor`, `ebs backup create`, and `ebs deploy --dry-run`.
- Configure `EBS_GITHUB_PAGES_DIR`, then perform a reviewed production deployment.
- Perform the explicit live human, autonomous, and ten-category News workflows when those credentials and publication authority are available.
