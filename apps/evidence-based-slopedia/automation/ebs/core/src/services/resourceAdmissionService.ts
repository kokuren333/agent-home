import fs from "node:fs/promises";
import path from "node:path";
import type { Dirent } from "node:fs";
import type { ResourceGuard, ResourceGuardResult } from "../ports/resourceGuard.js";

export interface ResourceAdmissionLimits { minDiskFreeGb: number; maxRepositorySizeGb: number; maxAssetsSizeGb: number; maxActiveWorkers: number; maxQueueDepth: number; maxRecentFailureRate: number; }
export interface ResourceAdmissionContext { activeWorkers: number; queueDepth: number; recentFailureRate: number; }
export class ResourceAdmissionService {
  constructor(private readonly vaultRoot: string, private readonly base: ResourceGuard, private readonly limits: ResourceAdmissionLimits) {}
  async canStartAuto(context: ResourceAdmissionContext): Promise<ResourceGuardResult> {
    const base = await this.base.canStart(); if (!base.ok) return base;
    const stat = await fs.statfs(this.vaultRoot); const diskFreeGb = stat.bavail * stat.bsize / 1024 ** 3; if (diskFreeGb < this.limits.minDiskFreeGb) return { ok: false, reason: "disk_low" };
    if (context.activeWorkers >= this.limits.maxActiveWorkers) return { ok: false, reason: "worker_busy" };
    if (context.queueDepth >= this.limits.maxQueueDepth) return { ok: false, reason: "queue_depth" };
    if (context.recentFailureRate >= this.limits.maxRecentFailureRate) return { ok: false, reason: "high_failure_rate" };
    const [repositoryBytes, assetsBytes] = await Promise.all([directorySize(this.vaultRoot, new Set([".git", "node_modules", "dist", "generated"])), directorySize(path.join(this.vaultRoot, "50_Assets"), new Set())]);
    if (repositoryBytes / 1024 ** 3 > this.limits.maxRepositorySizeGb) return { ok: false, reason: "repository_size" };
    if (assetsBytes / 1024 ** 3 > this.limits.maxAssetsSizeGb) return { ok: false, reason: "assets_size" };
    return { ok: true };
  }
}
async function directorySize(root: string, excluded: Set<string>): Promise<number> { let total = 0; let entries: Dirent[]; try { entries = await fs.readdir(root, { withFileTypes: true }); } catch { return 0; } for (const entry of entries) { if (excluded.has(entry.name)) continue; const target = path.join(root, entry.name); if (entry.isDirectory()) total += await directorySize(target, excluded); else if (entry.isFile()) total += (await fs.stat(target)).size; } return total; }
