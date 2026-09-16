import type { AppState } from '../src/types';

const endpoint = '/api/apps/freewill-taiseihokan/resources/state';

type WireBlob = { __agentHomeBlob: true; type: string; data: string };

function isBlob(value: unknown): value is Blob {
  return typeof Blob !== 'undefined' && value instanceof Blob;
}

function base64FromBytes(bytes: Uint8Array) {
  let binary = '';
  const chunkSize = 0x8000;
  for (let index = 0; index < bytes.length; index += chunkSize) binary += String.fromCharCode(...bytes.subarray(index, index + chunkSize));
  return btoa(binary);
}

function bytesFromBase64(value: string) {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

async function toWire(value: unknown): Promise<unknown> {
  if (isBlob(value)) return { __agentHomeBlob: true, type: value.type, data: base64FromBytes(new Uint8Array(await value.arrayBuffer())) } satisfies WireBlob;
  if (Array.isArray(value)) return await Promise.all(value.map(toWire));
  if (value && typeof value === 'object') return Object.fromEntries(await Promise.all(Object.entries(value).map(async ([key, child]) => [key, await toWire(child)])));
  return value;
}

function fromWire(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(fromWire);
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    if (record.__agentHomeBlob === true && typeof record.data === 'string') return new Blob([bytesFromBase64(record.data)], { type: typeof record.type === 'string' ? record.type : 'application/octet-stream' });
    return Object.fromEntries(Object.entries(record).map(([key, child]) => [key, fromWire(child)]));
  }
  return value;
}

async function request<T>(init: RequestInit = {}): Promise<T> {
  const response = await fetch(endpoint, {
    ...init,
    headers: {
      Accept: 'application/json',
      ...(init.body ? { 'Content-Type': 'application/json' } : {}),
      ...(init.headers || {}),
    },
  });
  if (!response.ok) {
    let message = `Gateway storage request failed (${response.status})`;
    try {
      const payload = await response.json() as { error?: { message?: string } };
      message = payload.error?.message || message;
    } catch {}
    throw new Error(message);
  }
  if (response.status === 204) return undefined as T;
  return await response.json() as T;
}

export async function loadAppState(): Promise<AppState | null> {
  return (fromWire(await request<unknown>()) as AppState | undefined) ?? null;
}

export async function saveAppState(state: AppState): Promise<void> {
  await request<AppState>({ method: 'PUT', body: JSON.stringify(await toWire(state)) });
}

export async function clearAppState(): Promise<void> {
  await request<void>({ method: 'DELETE' });
}
