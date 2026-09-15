export type Capability = 'run' | 'stream' | 'cancel' | 'storage' | 'resources';
export type RunStatus = 'queued' | 'running' | 'completed' | 'failed' | 'cancelled';
export interface App { id: string; name: string; description: string; version: string; icon: string; entry: string; capabilities: Capability[]; }
export interface Run { id: string; appId: string; status: RunStatus; input: unknown; createdAt: number; startedAt: number | null; finishedAt: number | null; error: string | null; }
export interface Event { id: string; runId: string; type: string; data: unknown; createdAt: number; }
export interface Artifact { id: string; runId: string; kind: string; name: string; uri: string; createdAt: number; }
export interface ProtocolError { code: string; message: string; details?: unknown; }
export const PROTOCOL_VERSION: '0.1';
export function errorPayload(code: string, message: string, details?: unknown): { error: ProtocolError };
export function isValidManifest(manifest: unknown): boolean;
