import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import sharp from "sharp";
import { BuildService } from "../../ebs/core/src/services/buildService.js";
import { IndexService } from "../../ebs/core/src/services/indexService.js";
import { phase3Fixture } from "./phase3Fixture.js";

test("daily news infographic embeds are converted and copied before public URL crawl", async () => {
  const { root, repository } = await phase3Fixture();
  const source = "50_Assets/Infographics/Daily/2026-09-03_business-industry-innovation.png";
  await fs.mkdir(path.join(root, path.dirname(source)), { recursive: true });
  await sharp({ create: { width: 32, height: 18, channels: 3, background: "white" } }).png().toFile(path.join(root, source));
  const newsPath = "11_Daily/09_Business_Industry_Innovation/2026-09/2026-09-03_Business_Industry_Innovation.md";
  await fs.mkdir(path.dirname(path.join(root, newsPath)), { recursive: true });
  await fs.writeFile(path.join(root, newsPath), `---\nstatus: published\ndate: 2026-09-03\ncategory: Business Industry Innovation\n---\n\n![[${source}]]\n\n# Daily\n\nEvidence-backed briefing.\n`);
  const indexes = new IndexService(root, repository);
  await indexes.rebuildAll();
  const result = await new BuildService(root, repository, indexes, { basePath: "/Evidence-Based-Slopedia-Pages/" }).build();
  const asset = path.join(result.distDir, "assets", source.replace(/\.png$/i, ".webp"));
  assert.ok(await fs.stat(asset));
  const html = await fs.readFile(path.join(result.distDir, "news", "2026-09-03", "09_Business_Industry_Innovation", "index.html"), "utf8");
  assert.match(html, /\/Evidence-Based-Slopedia-Pages\/assets\/50_Assets\/Infographics\/Daily\/2026-09-03_business-industry-innovation\.webp/);
});
