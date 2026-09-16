import { config } from "../config.js";
import { FilesystemArticleRepository } from "../../../ebs/core/src/infrastructure/filesystemArticleRepository.js";
import { IndexService } from "../../../ebs/core/src/services/indexService.js";

export type MocMaintenanceScope = "all" | "published" | "daily";
export interface MocMaintenanceResult { scope: MocMaintenanceScope; publicArticleCount: number; generatedDir: string; dailyDeferred: boolean; }

export async function rebuildDeterministicMoc(scope: MocMaintenanceScope = "all"): Promise<MocMaintenanceResult> {
  if (scope === "daily") throw new Error("Daily MOC is outside the encyclopedia metadata registry and remains review-only until Daily identity migration.");
  const repository = new FilesystemArticleRepository(config.paths.contentRoot); const service = new IndexService(config.paths.contentRoot, repository); const manifest = await service.rebuildMoc(); return { scope, publicArticleCount: manifest.public_article_count, generatedDir: service.generatedDir, dailyDeferred: scope === "all" };
}
