export interface ResourceGuardResult {
  ok: boolean;
  reason?: string;
}

export interface ResourceSnapshot extends ResourceGuardResult {
  enabled: boolean;
  memoryPercent: number;
  cpuPercent: number;
}

export interface ResourceGuard {
  canStart(): Promise<ResourceGuardResult>;
  snapshot(): Promise<ResourceSnapshot>;
}
