export const freeWillSchema = {
  $id: 'https://kokuren.chatgpt.site/schemas/free-will.schema.json',
  type: 'object',
  additionalProperties: true,
  required: ['schemaVersion', 'mode', 'createdAt', 'updatedAt', 'profile', 'lifeHistory', 'psychometrics', 'preferences', 'goals', 'constraints', 'meta'],
  properties: {
    schemaVersion: { const: '1.0.0' },
    mode: { enum: ['quick', 'detailed', 'memory-assisted'] },
    createdAt: { type: 'string' }, updatedAt: { type: 'string' },
    profile: { type: 'object', additionalProperties: { type: 'string' } },
    lifeHistory: { type: 'object', additionalProperties: { type: 'object', additionalProperties: { type: 'string' } } },
    psychometrics: {
      type: 'object', required: ['questionSetVersion', 'responses', 'consistency', 'scores'], additionalProperties: true,
      properties: {
        questionSetVersion: { type: 'string' },
        responses: { type: 'object', additionalProperties: { anyOf: [{ type: 'number', minimum: 1, maximum: 5 }, { type: 'null' }] } },
        consistency: { enum: ['high', 'medium', 'low', 'insufficient'] },
        scores: { type: 'object', additionalProperties: { type: 'number' } }
      }
    },
    preferences: { type: 'object', additionalProperties: { type: 'string' } },
    goals: { type: 'object', additionalProperties: { type: 'string' } },
    constraints: { type: 'object', additionalProperties: { type: 'string' } },
    sources: {
      type: 'object', additionalProperties: false, required: ['urls', 'documents'],
      properties: {
        urls: { type: 'array', items: { type: 'object', required: ['id', 'url'], additionalProperties: true, properties: { id: { type: 'string' }, url: { type: 'string' }, title: { type: 'string' }, purpose: { type: 'string' }, dateContext: { type: 'string' }, notes: { type: 'string' } } } },
        documents: { type: 'array', items: { type: 'object', required: ['id', 'fileName', 'importedAt'], additionalProperties: true, properties: { id: { type: 'string' }, fileName: { type: 'string' }, path: { type: 'string' }, storagePath: { type: 'string' }, mimeType: { type: 'string' }, size: { type: 'number' }, content: { type: 'string' }, importedAt: { type: 'string' } } } }
      }
    },
    meta: {
      type: 'object', required: ['completedSections', 'skippedSections'],
      properties: {
        completedSections: { type: 'array', items: { type: 'string' }, uniqueItems: true },
        skippedSections: { type: 'array', items: { type: 'string' }, uniqueItems: true }
      }
    }
  }
} as const;

const stringArray = { type: 'array', items: { type: 'string' } } as const;

export const taiseihoukanBundleSchema = {
  $id: 'https://kokuren.chatgpt.site/schemas/taiseihoukan.schema.json',
  type: 'object', additionalProperties: true,
  required: ['policy', 'personalModel', 'auditModel'],
  properties: {
    policy: {
      type: 'object', additionalProperties: true,
      required: ['schemaVersion', 'purpose', 'longTermGoal', 'midTermGoals', 'priorities', 'constraints', 'maintenanceConditions', 'changeConditions', 'endConditions'],
      properties: {
        schemaVersion: { const: '1.0.0' }, purpose: { type: 'string' }, longTermGoal: { type: 'string' },
        midTermGoals: stringArray, priorities: stringArray, constraints: stringArray,
        maintenanceConditions: stringArray, changeConditions: stringArray, endConditions: stringArray,
        advice: { type: 'array', items: { type: 'object', required: ['id', 'title', 'trigger', 'actions', 'avoidActions', 'reevaluate'], additionalProperties: true, properties: {
          id: { type: 'string' }, title: { type: 'string' }, trigger: { type: 'string' }, actions: stringArray, avoidActions: stringArray, reevaluate: stringArray,
          flowchart: { type: 'object', required: ['root', 'nodes'], additionalProperties: true, properties: { root: { type: 'string' }, nodes: { type: 'array', items: { type: 'object', required: ['id', 'type', 'label'], additionalProperties: true, properties: { id: { type: 'string' }, type: { enum: ['question', 'action'] }, label: { type: 'string' }, yes: { type: 'string' }, no: { type: 'string' } } } } } }
        } } }
      }
    },
    personalModel: {
      type: 'object', additionalProperties: true,
      required: ['schemaVersion', 'strengths', 'limitations', 'environmentalFit', 'riskFactors', 'uncertainties', 'confidence'],
      properties: {
        schemaVersion: { const: '1.0.0' }, strengths: stringArray, limitations: stringArray,
        environmentalFit: stringArray, riskFactors: stringArray, uncertainties: stringArray,
        confidence: { type: 'object', additionalProperties: { type: 'number', minimum: 0, maximum: 1 } },
        evidence: { type: 'array', items: { type: 'object', required: ['claim', 'basis'], properties: { claim: { type: 'string' }, basis: stringArray } } }
      }
    },
    auditModel: {
      type: 'object', additionalProperties: true, required: ['schemaVersion', 'states', 'questions'],
      properties: {
        schemaVersion: { const: '1.0.0' },
        states: {
          type: 'array', minItems: 2, items: {
            type: 'object', required: ['id', 'label', 'prior', 'recommendedActions', 'avoidActions'], additionalProperties: true,
            properties: { id: { type: 'string', minLength: 1 }, label: { type: 'string', minLength: 1 }, description: { type: 'string' }, prior: { type: 'number', exclusiveMinimum: 0 }, recommendedActions: stringArray, avoidActions: stringArray, reauditConditions: stringArray }
          }
        },
        questions: {
          type: 'array', minItems: 1, items: {
            type: 'object', required: ['id', 'text', 'likelihoods'], additionalProperties: true,
            properties: {
              id: { type: 'string', minLength: 1 }, text: { type: 'string', minLength: 1 },
              likelihoods: {
                type: 'object', additionalProperties: {
                  type: 'array', minItems: 5, maxItems: 5,
                  items: { type: 'number', minimum: 0, maximum: 1 }
                }
              }
            }
          }
        }
      }
    }
  }
} as const;

export const objectionSchema = {
  $id: 'https://kokuren.chatgpt.site/schemas/objection.schema.json',
  type: 'object',
  additionalProperties: true,
  required: ['schemaVersion', 'createdAt', 'updatedAt', 'targetChanges', 'newFacts', 'premiseDifference', 'attemptedResponses', 'continuationProblem', 'additionalContext'],
  properties: {
    schemaVersion: { const: '1.0.0' },
    createdAt: { type: 'string' },
    updatedAt: { type: 'string' },
    targetChanges: {
      type: 'object',
      additionalProperties: false,
      required: ['purpose', 'longTermGoal', 'midTermGoals', 'priorities', 'constraints', 'maintenanceConditions', 'changeConditions', 'endConditions', 'auditModel', 'other'],
      properties: {
        purpose: { type: 'string' },
        longTermGoal: { type: 'string' },
        midTermGoals: { type: 'string' },
        priorities: { type: 'string' },
        constraints: { type: 'string' },
        maintenanceConditions: { type: 'string' },
        changeConditions: { type: 'string' },
        endConditions: { type: 'string' },
        auditModel: { type: 'string' },
        other: { type: 'string' }
      }
    },
    newFacts: { type: 'string' },
    premiseDifference: { type: 'string' },
    attemptedResponses: { type: 'string' },
    continuationProblem: { type: 'string' },
    additionalContext: { type: 'string' }
  }
} as const;

export const auditHistorySchema = {
  $id: 'https://kokuren.chatgpt.site/schemas/audit-history.schema.json',
  type: 'array',
  items: {
    type: 'object',
    additionalProperties: true,
    required: ['id', 'createdAt', 'answers', 'primaryStateId', 'probability', 'confidence', 'reasons'],
    properties: {
      id: { type: 'string', minLength: 1 },
      createdAt: { type: 'string' },
      status: { enum: ['resolved', 'provisional', 'held'] },
      answers: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: true,
          required: ['questionId', 'value'],
          properties: {
            questionId: { type: 'string', minLength: 1 },
            value: { anyOf: [{ type: 'number', minimum: 0, maximum: 4 }, { type: 'null' }] }
          }
        }
      },
      primaryStateId: { type: 'string', minLength: 1 },
      primaryStateLabel: { type: 'string' },
      secondaryStateId: { type: 'string' },
      secondaryStateLabel: { type: 'string' },
      probability: { type: 'number', minimum: 0, maximum: 1 },
      secondaryProbability: { type: 'number', minimum: 0, maximum: 1 },
      confidence: { enum: ['high', 'medium', 'low'] },
      reasons: stringArray,
      taiseihoukanRevision: { type: 'string' }
    }
  }
} as const;
