import fs from "node:fs/promises";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import type { DeploymentTarget } from "../ports/deploymentTarget.js";
import { FilesystemMutationLock } from "../infrastructure/filesystemMutationLock.js";
import { spawn } from "node:child_process";

export interface DeploymentRecord { deploymentId: string; startedAt: string; completedAt?: string; target: string; sourceDistHash: string; remoteRevision?: string; result: "succeeded" | "failed"; error?: string; }
export class DeployService {
  private readonly ledger: string; private readonly lock: FilesystemMutationLock;
  constructor(private readonly vaultRoot: string, private readonly target?: DeploymentTarget, runtimeRoot?: string) { this.ledger = path.join(runtimeRoot ?? vaultRoot, "deployments", "ledger.json"); this.lock = new FilesystemMutationLock(runtimeRoot ?? vaultRoot); }
  async status() { return { target: this.target?.name ?? "unconfigured", deployments: await this.records() }; }
  async deploy(dryRun = false): Promise<DeploymentRecord> { if (!this.target && !dryRun) throw new Error("Deployment target is not configured. Set EBS_GITHUB_PAGES_DIR or use --dry-run."); return this.lock.withLock("deploy", async () => { const hash = await treeHash(path.join(this.vaultRoot, "dist")); const record: DeploymentRecord = { deploymentId: `dep-${randomUUID()}`, startedAt: new Date().toISOString(), target: this.target?.name ?? "unconfigured", sourceDistHash: hash, result: "failed" }; if (dryRun) return { ...record, result: "succeeded", completedAt: new Date().toISOString(), error: "dry-run" }; try { const result = await this.target!.deploy(path.join(this.vaultRoot, "dist"), hash); record.result = "succeeded"; record.completedAt = new Date().toISOString(); record.remoteRevision = result.remoteRevision; record.error = result.message.includes("no Pages repository changes") ? `no-op: ${result.message}` : undefined; await this.append(record); return record; } catch (error) { record.completedAt = new Date().toISOString(); record.error = error instanceof Error ? error.message : String(error); await this.append(record); throw error; } }); }
  async rollback(revision: string): Promise<DeploymentRecord> { if (!this.target?.rollback) throw new Error("Deployment target does not support rollback"); const result = await this.target.rollback(revision); const record: DeploymentRecord = { deploymentId: `dep-${randomUUID()}`, startedAt: new Date().toISOString(), completedAt: new Date().toISOString(), target: this.target.name, sourceDistHash: "rollback", remoteRevision: result.remoteRevision ?? revision, result: "succeeded" }; await this.append(record); return record; }
  private async records(): Promise<DeploymentRecord[]> { try { return JSON.parse(await fs.readFile(this.ledger, "utf8")) as DeploymentRecord[]; } catch { return []; } }
  private async append(record: DeploymentRecord) { const records = await this.records(); records.push(record); await fs.mkdir(path.dirname(this.ledger), { recursive: true }); const temp = `${this.ledger}.${randomUUID()}.tmp`; await fs.writeFile(temp, JSON.stringify(records, null, 2)); await fs.rename(temp, this.ledger); }
}

/** Vendor-neutral directory target for shared hosting staging and GitHub Pages clones. */
export class DirectoryDeploymentTarget implements DeploymentTarget {
  readonly name: string = "directory";
  constructor(private readonly directory: string) {}
  async deploy(distDir: string, hash: string) { await validateDeploymentTree(distDir); const isGit = await exists(path.join(this.directory, ".git")); if (isGit) await syncGitDirectory(distDir, this.directory); else await atomicDirectoryCopy(distDir, this.directory); await validateDeploymentTree(this.directory); if (isGit) { await requireGit(this.directory, ["rev-parse", "--is-inside-work-tree"]); const remote = process.env.EBS_PAGES_GIT_REMOTE ?? "origin"; const branch = process.env.EBS_PAGES_GIT_BRANCH ?? "main"; await requireGit(this.directory, ["fetch", remote, branch]); const status = await requireGit(this.directory, ["status", "--porcelain"]); const localHead = (await requireGit(this.directory, ["rev-parse", "HEAD"])).stdout.trim(); const remoteHead = (await requireGit(this.directory, ["rev-parse", `${remote}/${branch}`])).stdout.trim(); if (!status.stdout.trim() && localHead === remoteHead) return { remoteRevision: remoteHead, message: "Copied dist; local and remote Pages trees are identical" }; await requireGit(this.directory, ["add", "-A"]); if (status.stdout.trim()) await requireGit(this.directory, ["-c", `user.name=${process.env.EBS_PAGES_GIT_USER_NAME ?? "ebs-pages-deployer"}`, "-c", `user.email=${process.env.EBS_PAGES_GIT_USER_EMAIL ?? "ebs-pages-deployer@example.invalid"}`, "commit", "-m", process.env.EBS_PAGES_GIT_COMMIT_MESSAGE ?? "deploy: update site"]); await requireGit(this.directory, ["push", remote, branch]); await validateDeploymentTree(this.directory); const pushedHead = (await requireGit(this.directory, ["rev-parse", "HEAD"])).stdout.trim(); const verifiedRemote = (await requireGit(this.directory, ["rev-parse", `${remote}/${branch}`])).stdout.trim(); if (pushedHead !== verifiedRemote) throw new Error(`Pages push verification failed: local=${pushedHead} remote=${verifiedRemote}`); return { remoteRevision: verifiedRemote, message: `Copied dist and pushed ${remote}/${branch}` }; } return { remoteRevision: hash, message: `Copied portable dist to ${this.directory}` }; }
  async status() { return { directory: this.directory, exists: await fs.stat(this.directory).then(() => true).catch(() => false) }; }
}
export class GitHubPagesDeploymentTarget extends DirectoryDeploymentTarget { override readonly name = "github-pages-directory"; }
async function copyTree(source: string, target: string) { await fs.mkdir(target, { recursive: true }); for (const item of await fs.readdir(source, { withFileTypes: true })) { const from = path.join(source, item.name); const to = path.join(target, item.name); if (item.isDirectory()) await copyTree(from, to); else await fs.copyFile(from, to); } }
async function atomicDirectoryCopy(source:string,target:string){const temporary=`${target}.tmp-${randomUUID()}`;await fs.rm(temporary,{recursive:true,force:true});await copyTree(source,temporary);const old=`${target}.previous`;await fs.rm(old,{recursive:true,force:true});if(await exists(target))await fs.rename(target,old);try{await fs.rename(temporary,target);await fs.rm(old,{recursive:true,force:true});}catch(error){if(await exists(old))await fs.rename(old,target);throw error;}}
async function syncGitDirectory(source:string,target:string){const temporary=`${target}.tmp-${randomUUID()}`;await fs.rm(temporary,{recursive:true,force:true});await copyTree(source,temporary);for(const item of await fs.readdir(target)){if(item!==".git")await fs.rm(path.join(target,item),{recursive:true,force:true});}for(const item of await fs.readdir(temporary)){await fs.rename(path.join(temporary,item),path.join(target,item));}await fs.rm(temporary,{recursive:true,force:true});}
async function exists(file:string){return fs.access(file).then(()=>true).catch(()=>false);}
async function requireGit(cwd:string,args:string[]){const result=await runGit(cwd,args);if(result.code!==0)throw new Error(`Pages git ${args.join(" ")} failed (${result.code})\n${result.stderr||result.stdout}`);return result;}
async function runGit(cwd:string,args:string[]){return new Promise<{code:number;stdout:string;stderr:string}>((resolve,reject)=>{const child=spawn("git",args,{cwd,windowsHide:true});let stdout="",stderr="";child.stdout.on("data",x=>stdout+=String(x));child.stderr.on("data",x=>stderr+=String(x));child.on("error",reject);child.on("close",code=>resolve({code:code??1,stdout,stderr}));});}
async function treeHash(root: string) { const hash = createHash("sha256"); for (const file of (await files(root)).sort()) { hash.update(path.relative(root, file).replace(/\\/g, "/")); hash.update(await fs.readFile(file)); } return hash.digest("hex"); }
async function files(directory: string): Promise<string[]> { const result:string[]=[]; for (const item of await fs.readdir(directory, { withFileTypes:true })) { const target=path.join(directory,item.name); if(item.isDirectory())result.push(...await files(target));else result.push(target); } return result; }
async function validateDeploymentTree(root: string): Promise<void> {
  const manifest = JSON.parse(await fs.readFile(path.join(root, "build-manifest.json"), "utf8")) as { article_count?: number; base_path?: string };
  const search = JSON.parse(await fs.readFile(path.join(root, "search-index.json"), "utf8")) as Array<{ url?: string }>;
  if (manifest.article_count !== search.length) throw new Error(`Deployment validation failed: article_count=${manifest.article_count} search-index=${search.length}`);
  const base = manifest.base_path ?? "/";
  const urls = search.map((item) => item.url).filter((url): url is string => Boolean(url));
  const missing = (await Promise.all(urls.map(async (url) => {
    const relative = url.startsWith(base) ? url.slice(base.length) : url.replace(/^\//, "");
    try { await fs.access(path.join(root, ...relative.replace(/\/$/, "").split("/"), "index.html")); return undefined; }
    catch { return url; }
  }))).filter((url): url is string => Boolean(url));
  if (missing.length) throw new Error(`Deployment validation failed: missing article HTML for ${missing.join(", ")}`);
  const sitemap = await fs.readFile(path.join(root, "sitemap.xml"), "utf8");
  for (const item of search) if (item.url && !sitemap.includes(item.url)) throw new Error(`Deployment validation failed: sitemap missing ${item.url}`);
}
