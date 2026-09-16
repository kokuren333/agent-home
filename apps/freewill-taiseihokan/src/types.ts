export type InputMode = 'quick' | 'detailed' | 'memory-assisted';

export interface WebSource {
  id: string;
  url: string;
  title?: string;
  purpose?: string;
  dateContext?: string;
  notes?: string;
}

export interface DocumentSource {
  id: string;
  fileName: string;
  path?: string;
  storagePath?: string;
  mimeType?: string;
  data?: Blob;
  size?: number;
  content?: string;
  dateContext?: string;
  importedAt: string;
}

export interface FreeWillData {
  schemaVersion: '1.0.0';
  mode: InputMode;
  createdAt: string;
  updatedAt: string;
  profile: Record<string, string>;
  lifeHistory: Record<string, Record<string, string>>;
  psychometrics: {
    questionSetVersion: string;
    responses: Record<string, number | null>;
    consistency: 'high' | 'medium' | 'low' | 'insufficient';
    scores: Record<string, number>;
  };
  preferences: Record<string, string>;
  goals: Record<string, string>;
  constraints: Record<string, string>;
  sources?: {
    urls: WebSource[];
    documents: DocumentSource[];
  };
  meta: {
    completedSections: string[];
    skippedSections: string[];
  };
}

export interface PolicyData {
  schemaVersion: '1.0.0';
  purpose: string;
  longTermGoal: string;
  midTermGoals: string[];
  priorities: string[];
  constraints: string[];
  maintenanceConditions: string[];
  changeConditions: string[];
  endConditions: string[];
  advice?: AdviceRule[];
}

export interface AdviceFlowNode {
  id: string;
  type: 'question' | 'action';
  label: string;
  yes?: string;
  no?: string;
}

export interface AdviceRule {
  id: string;
  title: string;
  trigger: string;
  actions: string[];
  avoidActions: string[];
  reevaluate: string[];
  flowchart?: {
    root: string;
    nodes: AdviceFlowNode[];
  };
}

export interface PersonalModel {
  schemaVersion: '1.0.0';
  strengths: string[];
  limitations: string[];
  environmentalFit: string[];
  riskFactors: string[];
  uncertainties: string[];
  confidence: Record<string, number>;
  evidence?: Array<{ claim: string; basis: string[] }>;
}

export interface AuditState {
  id: string;
  label: string;
  description?: string;
  prior: number;
  recommendedActions: string[];
  avoidActions: string[];
  reauditConditions?: string[];
}

export interface AuditQuestion {
  id: string;
  text: string;
  likelihoods: Record<string, [number, number, number, number, number]>;
}

export interface AuditModel {
  schemaVersion: '1.0.0';
  states: AuditState[];
  questions: AuditQuestion[];
}

export type ObjectionTargetKey =
  | 'purpose'
  | 'longTermGoal'
  | 'midTermGoals'
  | 'priorities'
  | 'constraints'
  | 'maintenanceConditions'
  | 'changeConditions'
  | 'endConditions'
  | 'auditModel'
  | 'other';

export interface ObjectionDraft {
  schemaVersion: '1.0.0';
  createdAt: string;
  updatedAt: string;
  targetChanges: Record<ObjectionTargetKey, string>;
  newFacts: string;
  premiseDifference: string;
  attemptedResponses: string;
  continuationProblem: string;
  additionalContext: string;
}

export interface TaiseihoukanData {
  manifest: Record<string, unknown>;
  policy: PolicyData;
  personalModel: PersonalModel;
  auditModel: AuditModel;
  analysis: string;
}

export interface AuditAnswer {
  questionId: string;
  value: number | null;
}

export interface AuditHistoryEntry {
  id: string;
  createdAt: string;
  answers: AuditAnswer[];
  /** Provisional audits are still actionable, but did not meet the normal confidence threshold. */
  status?: 'resolved' | 'provisional' | 'held';
  primaryStateId: string;
  primaryStateLabel?: string;
  secondaryStateId?: string;
  secondaryStateLabel?: string;
  probability: number;
  secondaryProbability?: number;
  confidence: 'high' | 'medium' | 'low';
  reasons: string[];
  /** Snapshot identifier of the taiseihoukan/audit model used for this audit. */
  taiseihoukanRevision?: string;
}

export interface TaiseihoukanArchive {
  fileName: string;
  importedAt: string;
  blob: Blob;
  sourceType?: 'original-import' | 'normalized-import' | 'backup-import';
}

export interface AppState {
  initialized: boolean;
  freeWill: FreeWillData;
  taiseihoukan: TaiseihoukanData | null;
  /** Original imported taiseihoukan.zip when available. Stored as a Blob in IndexedDB. */
  taiseihoukanArchive: TaiseihoukanArchive | null;
  auditHistory: AuditHistoryEntry[];
}
