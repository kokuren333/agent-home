export interface DeploymentResult { remoteRevision?: string; message: string; }
export interface DeploymentTarget { name: string; deploy(distDir: string, distHash: string): Promise<DeploymentResult>; status(): Promise<Record<string, unknown>>; rollback?(revision: string): Promise<DeploymentResult>; }
