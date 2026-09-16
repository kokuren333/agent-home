import fs from "node:fs/promises";
import path from "node:path";
import { inventoryArticles, renderInventoryMarkdown } from "../../automation/ebs/core/src/migration/articleInventory.js";

const vaultRoot = path.resolve(process.env.EBS_VAULT_ROOT ?? await findVaultRoot(process.cwd()));
const reportDir = path.join(vaultRoot, "_working", "migration_reports");
const inventory = await inventoryArticles(vaultRoot);
await fs.mkdir(reportDir, { recursive: true });
await fs.writeFile(path.join(reportDir, "ebs-article-inventory.json"), `${JSON.stringify(inventory, null, 2)}\n`, "utf8");
await fs.writeFile(path.join(reportDir, "ebs-article-inventory.md"), renderInventoryMarkdown(inventory), "utf8");
console.log(JSON.stringify({ total: inventory.articles.length, reports: ["_working/migration_reports/ebs-article-inventory.json", "_working/migration_reports/ebs-article-inventory.md"] }, null, 2));

async function findVaultRoot(start: string): Promise<string> {
  let current = path.resolve(start);
  while (true) {
    try { await fs.access(path.join(current, "AGENTS.md")); await fs.access(path.join(current, "10_Published")); return current; } catch { /* continue */ }
    const parent = path.dirname(current); if (parent === current) throw new Error("Could not locate EBS Vault root. Set EBS_VAULT_ROOT."); current = parent;
  }
}
