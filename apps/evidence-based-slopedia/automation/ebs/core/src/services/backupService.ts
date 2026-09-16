import fs from "node:fs/promises";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";

export interface BackupManifest { id: string; createdAt: string; schemaVersion: 1; files: Array<{ path:string; sha256:string }>; }
export interface BackupRetention { daily: number; weekly: number; monthly: number; }
export interface BackupPruneResult { removed: string[]; kept: string[]; }
export class BackupService {
  private readonly root: string;
  constructor(private readonly vaultRoot: string) { this.root = path.join(vaultRoot, "backups"); }
  async create(): Promise<BackupManifest> { const id=`backup-${new Date().toISOString().replace(/[:.]/g,"-")}-${randomUUID().slice(0,8)}`; const destination=path.join(this.root,id); const roots=["canonical","10_Published","11_Daily","12_Forecasting","50_Assets","config",path.join("automation","discord_bot","data")]; const files:BackupManifest["files"]=[]; for(const root of roots) await copySelected(this.vaultRoot,root,destination,files); const manifest:BackupManifest={id,createdAt:new Date().toISOString(),schemaVersion:1,files}; await fs.writeFile(path.join(destination,"manifest.json"),JSON.stringify(manifest,null,2)); return manifest; }
  async list(): Promise<BackupManifest[]> { const entries=await fs.readdir(this.root,{withFileTypes:true}).catch(()=>[]); const result:BackupManifest[]=[]; for(const entry of entries.filter(x=>x.isDirectory()))try{result.push(JSON.parse(await fs.readFile(path.join(this.root,entry.name,"manifest.json"),"utf8")) as BackupManifest);}catch{} return result.sort((a,b)=>b.createdAt.localeCompare(a.createdAt)); }
  async verify(id:string): Promise<{ valid:boolean; errors:string[] }> { const directory=path.join(this.root,id); const manifest=JSON.parse(await fs.readFile(path.join(directory,"manifest.json"),"utf8")) as BackupManifest; const errors:string[]=[]; for(const item of manifest.files){try{if(await digest(path.join(directory,item.path))!==item.sha256)errors.push(item.path);}catch{errors.push(item.path);}}return{valid:errors.length===0,errors}; }
  async stageRestore(id:string): Promise<string> { const verified=await this.verify(id);if(!verified.valid)throw new Error(`Backup verification failed: ${verified.errors.join(", ")}`); const stage=path.join(this.vaultRoot,"_working","restore_candidates",id); await fs.rm(stage,{recursive:true,force:true}); await copy(path.join(this.root,id),stage); return stage; }
  async prune(retention: BackupRetention): Promise<BackupPruneResult> {
    const limit = (value:number) => Math.max(0, Math.floor(value));
    const manifests = await this.list(); const keep = new Set<string>();
    const weekly = new Set<string>(); const monthly = new Set<string>();
    for (const [index, manifest] of manifests.entries()) {
      const date = new Date(manifest.createdAt); const week = isoWeek(date); const month = `${date.getUTCFullYear()}-${date.getUTCMonth() + 1}`;
      if (index < limit(retention.daily)) keep.add(manifest.id);
      if (weekly.size < limit(retention.weekly) && !weekly.has(week)) { weekly.add(week); keep.add(manifest.id); }
      if (monthly.size < limit(retention.monthly) && !monthly.has(month)) { monthly.add(month); keep.add(manifest.id); }
    }
    const removed:string[]=[]; for (const manifest of manifests) if (!keep.has(manifest.id)) { await fs.rm(path.join(this.root, manifest.id), { recursive:true, force:false }); removed.push(manifest.id); }
    return { removed, kept: manifests.filter((manifest) => keep.has(manifest.id)).map((manifest) => manifest.id) };
  }
}
async function copySelected(root:string,relative:string,destination:string,files:BackupManifest["files"]){const source=path.join(root,relative);if(!await fs.stat(source).then(()=>true).catch(()=>false))return;for(const file of await all(source)){const rel=path.relative(root,file);const target=path.join(destination,rel);await fs.mkdir(path.dirname(target),{recursive:true});await fs.copyFile(file,target);files.push({path:rel.replace(/\\/g,"/"),sha256:await digest(file)});}}
async function copy(source:string,target:string){await fs.mkdir(target,{recursive:true});for(const item of await fs.readdir(source,{withFileTypes:true})){const from=path.join(source,item.name),to=path.join(target,item.name);if(item.isDirectory())await copy(from,to);else await fs.copyFile(from,to);}}
async function all(directory:string):Promise<string[]>{const result:string[]=[];for(const item of await fs.readdir(directory,{withFileTypes:true})){const target=path.join(directory,item.name);if(item.isDirectory())result.push(...await all(target));else result.push(target);}return result;}async function digest(file:string){return createHash("sha256").update(await fs.readFile(file)).digest("hex");}
function isoWeek(date:Date):string { const copy=new Date(Date.UTC(date.getUTCFullYear(),date.getUTCMonth(),date.getUTCDate())); const day=copy.getUTCDay()||7; copy.setUTCDate(copy.getUTCDate()+4-day); const yearStart=new Date(Date.UTC(copy.getUTCFullYear(),0,1)); return `${copy.getUTCFullYear()}-${Math.ceil((((copy.getTime()-yearStart.getTime())/86400000)+1)/7)}`; }
