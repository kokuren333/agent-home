import type { Settings, Workspace } from './types'
import { createSampleWorkspace } from './sample'

/**
 * Challenge Tree keeps its rich workspace model, but persistence is owned by
 * the agent-home Gateway. This preserves the original app API while making
 * data available to every device on the private Tailscale network.
 */
interface Snapshot { id: string; projectId: string; reason: string; createdAt: string; workspace: Workspace }

const base = '/api/apps/challenge-tree/resources'
async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(`${base}${path}`, { ...init, headers: { Accept: 'application/json', ...(init.body ? { 'Content-Type': 'application/json' } : {}), ...(init.headers || {}) } })
  if (!response.ok) {
    let message = `Gateway storage request failed (${response.status})`
    try { const payload = await response.json() as { error?: { message?: string } }; message = payload.error?.message || message } catch {}
    throw new Error(message)
  }
  if (response.status === 204) return undefined as T
  return await response.json() as T
}

export async function openDatabase(): Promise<null> { return null }
export async function listWorkspaces(): Promise<Workspace[]> { return await request<Workspace[]>('/workspaces') }
export async function saveWorkspace(workspace: Workspace): Promise<void> { await request(`/workspaces/${encodeURIComponent(workspace.project.id)}`, { method: 'PUT', body: JSON.stringify(workspace) }) }
export async function saveWorkspaces(workspaces: Workspace[]): Promise<void> { await Promise.all(workspaces.map(saveWorkspace)) }
export async function deleteWorkspace(projectId: string): Promise<void> { await request(`/workspaces/${encodeURIComponent(projectId)}`, { method: 'DELETE' }) }
export async function getWorkspace(projectId: string): Promise<Workspace | undefined> { return await request<Workspace>(`/workspaces/${encodeURIComponent(projectId)}`) }
export async function saveSnapshot(workspace: Workspace, reason: string): Promise<void> { await request(`/workspaces/${encodeURIComponent(workspace.project.id)}/snapshots`, { method: 'POST', body: JSON.stringify({ workspace, reason }) }) }
export async function readSettings(): Promise<Settings | undefined> { return await request<Settings | undefined>('/settings') }
export async function writeSettings(settings: Settings): Promise<void> { await request('/settings', { method: 'PUT', body: JSON.stringify(settings) }) }

export async function ensureSampleWorkspace(uiLanguage: 'ja' | 'en'): Promise<Workspace[]> {
  const existing = await listWorkspaces()
  const legacySample = existing.find((item) => ['sample-transformer', 'sample-transformer-v2'].includes(item.project.id))
  if (legacySample) await deleteWorkspace(legacySample.project.id)
  const remaining = existing.filter((item) => item !== legacySample)
  const currentSample = remaining.find((item) => item.project.id === 'sample-transformer-v3')
  if (currentSample) return remaining
  const sample = createSampleWorkspace(uiLanguage)
  await saveWorkspace(sample)
  return [...remaining, sample].sort((a, b) => b.project.updatedAt.localeCompare(a.project.updatedAt))
}

export type { Snapshot }
