import { GradeResponseSchema, ProposalResponseSchema, ChallengeSchema, NodeCreateSchema, NodeSchema, ResourceSchema } from '../src/schemas'
import type { Challenge, ConnectorModel, ConnectorStatus, Edge, GradeResponse, NodeRecord, Proposal, Resource, ResourceLocator } from '../src/types'

export interface ResearchEvidence {
  searchCalls: number
  searches: string[]
  sources: Array<{ title: string; url: string; query?: string }>
  logs?: string[]
}

export type GatewayOperation = 'tree_propose' | 'node_expand' | 'node_create' | 'challenge_create' | 'answer_grade'

type JsonRecord = Record<string, unknown>

const asRecord = (value: unknown): JsonRecord => value && typeof value === 'object' && !Array.isArray(value) ? value as JsonRecord : {}
const asString = (value: unknown, fallback = '') => typeof value === 'string' && value.trim() ? value.trim() : fallback
const asStringArray = (value: unknown) => Array.isArray(value) ? value.map((item) => asString(item)).filter(Boolean) : []
const isoNow = () => new Date().toISOString()

function normalizeDate(value: unknown, fallback = isoNow()) {
  const text = asString(value)
  if (!text) return fallback
  const date = new Date(text)
  return Number.isNaN(date.valueOf()) ? fallback : date.toISOString()
}

function normalizeStatus(value: unknown): 'hidden' | 'unlocked' | 'cleared' {
  const status = asString(value).toLowerCase()
  if (['cleared', 'completed', 'complete', 'mastered'].includes(status)) return 'cleared'
  if (['hidden', 'locked'].includes(status)) return 'hidden'
  return 'unlocked'
}

function normalizePromptStyle(value: unknown): Challenge['promptStyle'] {
  const style = asString(value).toLowerCase()
  if (['definition', 'why', 'mechanism', 'compare', 'scenario', 'critique', 'synthesis'].includes(style)) return style as Challenge['promptStyle']
  if (style === 'true_false' || style === 'concept') return 'definition'
  return 'why'
}

function normalizeDifficulty(value: unknown): 1 | 2 | 3 | 4 {
  if (typeof value === 'number' && Number.isFinite(value)) return Math.max(1, Math.min(4, Math.round(value))) as 1 | 2 | 3 | 4
  const text = asString(value).toLowerCase()
  if (text === 'advanced' || text === 'expert') return 3
  if (text === 'intermediate' || text === 'medium') return 2
  return 1
}

function normalizeResource(value: unknown, index: number, fallbackNodeId?: string): Resource | null {
  const source = asRecord(value)
  const url = asString(source.url)
  if (!/^https?:\/\//i.test(url)) return null
  const typeMap: Record<string, Resource['type']> = { paper: 'primary_paper', documentation: 'official_docs', docs: 'technical_docs', course: 'course', video: 'video', article: 'article' }
  const rawType = asString(source.type).toLowerCase()
  const type = typeMap[rawType] || (['primary_paper', 'official_docs', 'government', 'university', 'textbook', 'course', 'technical_docs', 'article', 'video', 'community', 'other'].includes(rawType) ? rawType as Resource['type'] : 'other')
  const locator = asRecord(source.locator)
  const locatorKind = asString(locator.kind)
  const locatorValue = asString(locator.value)
  const hasLocator = ['section', 'page', 'heading', 'chapter', 'timestamp', 'other'].includes(locatorKind) && locatorValue
  return {
    id: asString(source.id, `resource-${index + 1}`), title: asString(source.title, url), url,
    language: asString(source.language, 'ja'), type,
    authorityTier: ['A', 'B', 'C', 'D'].includes(asString(source.authorityTier)) ? asString(source.authorityTier) as Resource['authorityTier'] : 'B',
    ...(hasLocator ? { locator: { kind: locatorKind as ResourceLocator['kind'], value: locatorValue } } : {}),
    guidance: asString(source.guidance, '概要と一次情報を確認してください.'), supports: asStringArray(source.supports).length ? asStringArray(source.supports) : (fallbackNodeId ? [fallbackNodeId] : []),
    ...(source.verifiedAt ? { verifiedAt: normalizeDate(source.verifiedAt) } : {}),
  }
}

function normalizeChallenge(value: unknown, index: number, fallbackNodeId?: string): Challenge {
  const source = asRecord(value)
  const nodeId = asString(source.nodeId, fallbackNodeId || `node-${index + 1}`)
  const prompt = asString(source.prompt, asString(source.question, 'このノードの重要な点を説明してください。'))
  const modeValue = asString(source.mode || source.challengeMode || source.type).toLowerCase()
  const mode = ['explain', 'short_answer', 'true_false'].includes(modeValue) ? modeValue as Challenge['mode'] : undefined
  const concepts = asStringArray(source.expectedConcepts).length ? asStringArray(source.expectedConcepts) : asStringArray(source.skills)
  const rubricSource = Array.isArray(source.rubric) ? source.rubric : []
  const rubric = rubricSource.map((item) => {
    const record = asRecord(item)
    return { criterion: asString(record.criterion, asString(record.text, '要点を説明する')), required: record.required !== false }
  })
  const finalRubric = rubric.length ? rubric : (concepts.length ? concepts.map((criterion) => ({ criterion, required: true })) : [{ criterion: '中心概念を説明する', required: true }])
  const questions = Array.isArray(source.questions) ? source.questions.map((item, questionIndex) => {
    const question = asRecord(item)
    return { id: asString(question.id, `${asString(source.id, `challenge-${index + 1}`)}-q${questionIndex + 1}`), prompt: asString(question.prompt, prompt), modelAnswer: asString(question.modelAnswer, asString(source.modelAnswer, '要点と理由を説明する。')), expectedConcepts: asStringArray(question.expectedConcepts).length ? asStringArray(question.expectedConcepts) : concepts, explanation: asString(question.explanation, asString(source.explanation)) }
  }) : undefined
  return {
    id: asString(source.id, `challenge-${index + 1}`), nodeId, promptStyle: normalizePromptStyle(source.promptStyle || source.type), difficulty: normalizeDifficulty(source.difficulty), prompt,
    expectedConcepts: concepts, modelAnswer: asString(source.modelAnswer, typeof source.answer === 'boolean' ? (source.answer ? '正しい。' : '誤り。') : '要点と理由を説明する。'),
    explanation: asString(source.explanation, '要点だけでなく、なぜそうなるかまで確認します。'), rubric: finalRubric, commonMisconceptions: asStringArray(source.commonMisconceptions), resourceIds: asStringArray(source.resourceIds), createdAt: normalizeDate(source.createdAt),
    ...(mode ? { mode } : {}), ...(questions?.length ? { questions } : {}),
  }
}

function normalizeNode(value: unknown, index: number, fallbackId?: string): NodeRecord {
  const source = asRecord(value)
  const id = asString(source.id, fallbackId || `node-${index + 1}`)
  const description = asString(source.description, asString(source.objective, asString(source.title, '学習内容を整理するノードです。')))
  const goal = asString(source.goal, asString(source.objective, asString(source.successCriteria, description)))
  const position = asRecord(source.position)
  const rawMastery = asString(source.masteryState).toLowerCase()
  const masteryState = ['familiar', 'developing', 'mastered'].includes(rawMastery) ? rawMastery as NodeRecord['masteryState'] : 'familiar'
  return {
    id, title: asString(source.title, id), description, goal, status: normalizeStatus(source.status), xp: typeof source.xp === 'number' && source.xp >= 0 ? Math.round(source.xp) : 0, masteryState,
    prerequisites: asStringArray(source.prerequisites), children: asStringArray(source.children || source.nextNodeIds), resourceIds: asStringArray(source.resourceIds), challengeIds: asStringArray(source.challengeIds),
    position: { x: typeof position.x === 'number' ? position.x : 70 + index * 260, y: typeof position.y === 'number' ? position.y : 20 + (index % 5) * 110 }, createdAt: normalizeDate(source.createdAt), updatedAt: normalizeDate(source.updatedAt, normalizeDate(source.createdAt)),
    ...(typeof source.archived === 'boolean' ? { archived: source.archived } : {}),
  }
}

function normalizeEdges(value: unknown): Edge[] {
  if (!Array.isArray(value)) return []
  return value.map((item) => {
    const source = asRecord(item); const rawType = asString(source.type).toLowerCase()
    const type: Edge['type'] = rawType === 'related' ? 'related' : rawType === 'recommended' ? 'recommended' : 'dependency'
    return { from: asString(source.from), to: asString(source.to), type }
  }).filter((edge) => edge.from && edge.to)
}

function normalizeProposal(value: unknown, index: number): Proposal {
  const source = asRecord(value)
  const rawNodes = Array.isArray(source.initialNodes) ? source.initialNodes : []
  const nodes = rawNodes.map((item, nodeIndex) => normalizeNode(item, nodeIndex))
  const rawRoot = asRecord(source.root)
  const requestedRootId = asString(rawRoot.id)
  const rootNode = nodes.find((node) => node.id === requestedRootId) || nodes[0] || normalizeNode(rawRoot, 0, requestedRootId || `root-${index + 1}`)
  const rawChallenges = Array.isArray(source.challenges) ? source.challenges : []
  const challengeNodeIds = new Set(rawChallenges.map((item) => asString(asRecord(item).nodeId)))
  // Some Codex versions place the first question on the node and return an
  // empty top-level challenges array. Promote that question to the app's
  // Challenge type so the newly created tree remains immediately usable.
  const derivedChallenges = rawNodes.map((item, nodeIndex) => {
    const node = asRecord(item); const nodeId = asString(node.id, nodes[nodeIndex]?.id)
    if (!nodeId || challengeNodeIds.has(nodeId) || !asString(node.question)) return null
    return { id: `challenge-${nodeId}`, nodeId, prompt: node.question, answer: node.answer, explanation: node.explanation, type: node.challengeMode }
  }).filter(Boolean)
  const knownNodeIds = new Set(nodes.map((node) => node.id))
  const challenges = [...rawChallenges, ...derivedChallenges].map((item, challengeIndex) => {
    const challenge = normalizeChallenge(item, challengeIndex, rootNode.id)
    // Codex may refer to the proposal's conceptual root id instead of the
    // concrete initialNodes id. Once the proposal is normalized, every
    // initial challenge must point at a node that the app can actually save.
    return knownNodeIds.has(challenge.nodeId) ? challenge : { ...challenge, nodeId: rootNode.id }
  })
  const resources = (Array.isArray(source.resources) ? source.resources : []).map((item, resourceIndex) => normalizeResource(item, resourceIndex, rootNode.id)).filter((item): item is Resource => Boolean(item))
  const challengeIdsByNode = new Map<string, string[]>()
  for (const challenge of challenges) challengeIdsByNode.set(challenge.nodeId, [...(challengeIdsByNode.get(challenge.nodeId) || []), challenge.id])
  const initialNodes = nodes.length ? nodes : [rootNode]
  const normalizedNodes = initialNodes.map((node) => ({ ...node, challengeIds: [...new Set([...node.challengeIds, ...(challengeIdsByNode.get(node.id) || [])])] }))
  const normalizedRoot = normalizedNodes.find((node) => node.id === rootNode.id) || normalizedNodes[0]
  return {
    id: asString(source.id, `proposal-${index + 1}`), title: asString(source.title, normalizedRoot.title), philosophy: asString(source.philosophy, '概念を段階的に整理して理解します.'), learnerProfile: asString(source.learnerProfile, '自分の言葉で体系的に理解したい学習者.'),
    branches: asStringArray(source.branches), advantages: asStringArray(source.advantages), tradeoffs: asString(source.tradeoffs, '詳細な応用は後半で扱います.'), root: normalizedRoot, initialNodes: normalizedNodes, initialEdges: normalizeEdges(source.initialEdges), resources, challenges,
  }
}

function normalizeOperationResult(operation: GatewayOperation, value: unknown): unknown {
  const source = asRecord(value)
  if (operation === 'tree_propose') return { proposals: Array.isArray(source.proposals) ? source.proposals.map((item, index) => normalizeProposal(item, index)) : [] }
  if (operation === 'node_expand') {
    const nodes = (Array.isArray(source.nodes) ? source.nodes : []).map((item, index) => normalizeNode(item, index))
    const challenges = (Array.isArray(source.challenges) ? source.challenges : []).map((item, index) => normalizeChallenge(item, index, nodes[index]?.id))
    const challengeIdsByNode = new Map<string, string[]>()
    for (const challenge of challenges) challengeIdsByNode.set(challenge.nodeId, [...(challengeIdsByNode.get(challenge.nodeId) || []), challenge.id])
    return { ...source, nodes: nodes.map((node) => ({ ...node, challengeIds: [...new Set([...node.challengeIds, ...(challengeIdsByNode.get(node.id) || [])])] })), edges: normalizeEdges(source.edges), resources: (Array.isArray(source.resources) ? source.resources : []).map((item, index) => normalizeResource(item, index)).filter((item): item is Resource => Boolean(item)), challenges }
  }
  if (operation === 'node_create') {
    const node = normalizeNode(source.node, 0)
    return { ...source, node: { id: node.id, title: node.title, description: node.description, goal: node.goal }, resources: (Array.isArray(source.resources) ? source.resources : []).map((item, index) => normalizeResource(item, index, node.id)).filter((item): item is Resource => Boolean(item)), challenges: (Array.isArray(source.challenges) ? source.challenges : []).map((item, index) => normalizeChallenge(item, index, node.id)) }
  }
  if (operation === 'challenge_create') return normalizeChallenge(value, 0)
  if (operation === 'answer_grade') {
    const grade = asString(source.grade, 'B').toUpperCase()
    const action = asString(source.recommendedAction, 'deepen')
    return { ...source, grade: ['C', 'B', 'A', 'S'].includes(grade) ? grade : 'B', summary: asString(source.summary, '要点を確認しました.'), correct: asStringArray(source.correct), missing: asStringArray(source.missing), misconceptions: asStringArray(source.misconceptions), nuance: asStringArray(source.nuance), recommendedAction: ['retry', 'deepen', 'repair', 'branch'].includes(action) ? action : 'deepen', recommendedNodeIds: asStringArray(source.recommendedNodeIds), nextStep: asString(source.nextStep, '具体例を一つ加えて説明してみてください.') }
  }
  return value
}

export class GatewayError extends Error {
  constructor(message: string, public readonly code = 'connector_error') {
    super(message)
    this.name = 'GatewayError'
  }
}

export class GatewayClient {

  async status(): Promise<ConnectorStatus> {
    try {
      const response = await fetch('/api/health', { headers: { Accept: 'application/json' } })
      if (!response.ok) throw new GatewayError('Gateway returned an error', 'http_error')
      const data = await response.json() as { ok?: boolean; backend?: { ok?: boolean; version?: string }; agentSettings?: { model?: string; reasoningEffort?: string } }
      const backendOk = Boolean(data.backend?.ok)
      return { connected: Boolean(data.ok), authenticated: backendOk, codexFound: backendOk, appServerRunning: backendOk, modelAvailable: Boolean(data.agentSettings?.model), model: data.agentSettings?.model, reasoningEffort: data.agentSettings?.reasoningEffort || null, codexVersion: data.backend?.version || null, message: backendOk ? 'Gateway is ready.' : 'Agent backend is not ready.' }
    } catch (error) {
      return { connected: false, authenticated: false, appServerRunning: false, modelAvailable: false, message: 'Gateway is not reachable.', error: { code: 'offline', message: error instanceof Error ? error.message : 'Gateway is not reachable.' } }
    }
  }

  async listModels(): Promise<ConnectorModel[]> {
    const response = await fetch('/api/settings/agent/models', { headers: { Accept: 'application/json' } })
    if (!response.ok) throw await this.readError(response, 'Could not load the model list.')
    const data = await response.json() as { models?: Array<{ id: string; name?: string; defaultReasoningEffort?: string; reasoningEfforts?: string[] }> }
    return (Array.isArray(data.models) ? data.models : []).map((item) => ({ id: item.id, model: item.id, displayName: item.name || item.id, description: '', defaultReasoningEffort: item.defaultReasoningEffort || null, supportedReasoningEfforts: (item.reasoningEfforts || []).map((reasoningEffort) => ({ reasoningEffort, description: '' })) }))
  }

  async selectModel(model: string, reasoningEffort?: string): Promise<ConnectorStatus> {
    const response = await fetch('/api/settings/agent', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ model, ...(reasoningEffort ? { reasoningEffort } : {}) })
    })
    if (!response.ok) throw await this.readError(response, 'The selected model could not be applied.')
    return this.status()
  }

  async treePropose(input: { topic: string; goal: string; researchMode: 'ja' | 'global'; challengeMode: 'explain' | 'short_answer' | 'true_false'; priorKnowledge: string }, onProgress?: (message: string) => void, onResearch?: (evidence: ResearchEvidence) => void): Promise<Proposal[]> {
    const parsed = await this.runValidated('tree_propose', input, (value) => ProposalResponseSchema.safeParse(value), onProgress, onResearch)
    return parsed.proposals as Proposal[]
  }

  async nodeExpand(input: unknown, onProgress?: (message: string) => void, onResearch?: (evidence: ResearchEvidence) => void): Promise<{ nodes: unknown[]; edges: unknown[]; resources: unknown[]; challenges: unknown[] }> {
    const data = await this.runValidated<{ nodes: unknown[]; edges: unknown[]; resources: unknown[]; challenges: unknown[] }>('node_expand', input, (value: unknown) => {
      const item = value as Record<string, unknown>
      const requestedCount = Number((input as Record<string, unknown>)?.branchCount ?? 3)
      const expectedCount = Number.isInteger(requestedCount) ? Math.max(1, Math.min(10, requestedCount)) : 3
      const edges = Array.isArray(item?.edges) ? item.edges : []
      const validEdges = Array.isArray(item?.edges) && edges.every((edge) => {
        const value = edge as Record<string, unknown>
        return typeof value?.from === 'string' && typeof value?.to === 'string' && ['dependency', 'recommended', 'related'].includes(String(value?.type))
      })
      const nodes = Array.isArray(item?.nodes) ? item.nodes : []
      const resources = Array.isArray(item?.resources) ? item.resources : []
      const challenges = Array.isArray(item?.challenges) ? item.challenges : []
      const normalizedItem = { ...item, nodes, edges, resources, challenges }
      return Array.isArray(item?.nodes) && nodes.length === expectedCount && nodes.every((node) => NodeSchema.safeParse(node).success) && validEdges && edges.length === expectedCount && Array.isArray(item?.resources) && resources.every((resource) => ResourceSchema.safeParse(resource).success) && Array.isArray(item?.challenges) && challenges.length === expectedCount && challenges.every((challenge) => ChallengeSchema.safeParse(challenge).success)
        ? { success: true as const, data: normalizedItem } : { success: false as const, error: 'invalid' }
    }, onProgress, onResearch)
    return { nodes: data.nodes as unknown[], edges: data.edges as unknown[], resources: data.resources as unknown[], challenges: data.challenges as unknown[] }
  }

  async nodeCreate(input: unknown, onProgress?: (message: string) => void, onResearch?: (evidence: ResearchEvidence) => void): Promise<{ node: unknown; resources: unknown[]; challenges: unknown[] }> {
    const data = await this.runValidated<{ node: unknown; resources: unknown[]; challenges: unknown[] }>('node_create', input, (value: unknown) => {
      const item = value as Record<string, unknown>
      const resources = Array.isArray(item?.resources) ? item.resources : []
      const challenges = Array.isArray(item?.challenges) ? item.challenges : []
      const node = item?.node
      return node && NodeCreateSchema.safeParse(node).success && resources.every((resource) => ResourceSchema.safeParse(resource).success) && challenges.length === 1 && challenges.every((challenge) => ChallengeSchema.safeParse(challenge).success)
        ? { success: true as const, data: { ...item, node, resources, challenges } } : { success: false as const, error: 'invalid' }
    }, onProgress, onResearch)
    return { node: data.node, resources: data.resources as unknown[], challenges: data.challenges as unknown[] }
  }

  async challengeCreate(input: unknown, onProgress?: (message: string) => void, onResearch?: (evidence: ResearchEvidence) => void): Promise<Challenge> {
    return await this.runValidated('challenge_create', input, (value) => ChallengeSchema.safeParse(value), onProgress, onResearch) as Challenge
  }

  async answerGrade(input: unknown, onProgress?: (message: string) => void, onResearch?: (evidence: ResearchEvidence) => void): Promise<GradeResponse> {
    return await this.runValidated('answer_grade', input, (value) => GradeResponseSchema.safeParse(value), onProgress, onResearch) as GradeResponse
  }

  private async runValidated<T>(operation: GatewayOperation, input: unknown, validator: (value: unknown) => { success: boolean; data?: T }, onProgress?: (message: string) => void, onResearch?: (evidence: ResearchEvidence) => void): Promise<T> {
    let runResult = await this.run(operation, input, onProgress)
    let parsed = validator(normalizeOperationResult(operation, runResult.data))
    if (!parsed.success) {
      const repairInput = input && typeof input === 'object' ? { ...(input as Record<string, unknown>), repair: true } : { input, repair: true }
      runResult = await this.run(operation, repairInput, onProgress)
      parsed = validator(normalizeOperationResult(operation, runResult.data))
    }
    if (!parsed.success || parsed.data === undefined) throw new GatewayError(`${operation.toUpperCase()} returned invalid structured data`, 'invalid_output')
    onResearch?.(runResult.research)
    return parsed.data
  }

  private async run(operation: GatewayOperation, input: unknown, onProgress?: (message: string) => void): Promise<{ data: unknown; research: ResearchEvidence }> {
    const response = await fetch('/api/apps/challenge-tree/runs', {
      method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ operation, payload: input }),
    }).catch(() => { throw new GatewayError('Gateway is not reachable.', 'offline') })
    if (!response.ok) throw await this.readError(response, `Gateway request failed (${response.status})`)
    const body = await response.json() as Record<string, unknown>
    if ('result' in body) return this.unwrapRunResult(body.result)
    if (body.id) return this.readRunEvents(String(body.id), onProgress)
    throw new GatewayError('Gateway returned no run', 'invalid_response')
  }

  private async readError(response: Response, fallback: string): Promise<GatewayError> {
    let message = fallback
    try {
      const body = await response.json() as { error?: { message?: string } }
      if (body.error?.message) message = body.error.message
    } catch {
      // Keep the local fallback when the connector response is not JSON.
    }
    return new GatewayError(message, response.status === 401 ? 'unauthorized' : 'http_error')
  }

  private unwrapRunResult(value: unknown): { data: unknown; research: ResearchEvidence } {
    if (value && typeof value === 'object' && !Array.isArray(value) && 'data' in value) {
      const envelope = value as { data?: unknown; research?: ResearchEvidence }
      return { data: envelope.data, research: envelope.research || { searchCalls: 0, searches: [], sources: [], logs: [] } }
    }
    return { data: value, research: { searchCalls: 0, searches: [], sources: [], logs: [] } }
  }

  private async readRunEvents(runId: string, onProgress?: (message: string) => void): Promise<{ data: unknown; research: ResearchEvidence }> {
    const response = await fetch(`/api/runs/${encodeURIComponent(runId)}/events`, { headers: { Accept: 'text/event-stream' } }).catch(() => { throw new GatewayError('Could not read Gateway run events.', 'stream_error') })
    if (!response.ok || !response.body) throw new GatewayError('Gateway event stream failed.', 'stream_error')
    let result: unknown = undefined
    let sawEvent = false
    let buffer = ''
    const processBlock = (block: string) => {
      const eventName = block.match(/^event:\s*(.+)$/m)?.[1]
      const dataLine = block.match(/^data:\s*(.+)$/m)?.[1]
      if (!eventName || !dataLine) return
      sawEvent = true
      try {
        const data = JSON.parse(dataLine) as Record<string, unknown>
        if (eventName === 'progress' && typeof data.message === 'string') onProgress?.(data.message)
        if (eventName === 'result.completed') result = data.result
        if (eventName === 'run.failed') throw new GatewayError(String(data.message ?? 'Agent operation failed.'), typeof data.code === 'string' ? data.code : 'run_error')
        if (eventName === 'run.cancelled') throw new GatewayError('Agent operation was cancelled.', 'run_cancelled')
      } catch (error) {
        if (error instanceof GatewayError) throw error
        throw new GatewayError('Gateway returned malformed event data.', 'invalid_output')
      }
    }
    const reader = response.body.getReader()
    const decoder = new TextDecoder()
    while (true) {
      const chunk = await reader.read()
      if (chunk.done) break
      buffer += decoder.decode(chunk.value, { stream: true })
      const blocks = buffer.split(/\r?\n\r?\n/)
      buffer = blocks.pop() || ''
      for (const block of blocks) processBlock(block)
    }
    buffer += decoder.decode()
    if (buffer.trim()) processBlock(buffer)
    if (!sawEvent) throw new GatewayError('Gateway returned an empty event stream.', 'empty_stream')
    if (result === undefined) throw new GatewayError('Gateway completed without a result.', 'empty_result')
    return this.unwrapRunResult(result)
  }
}
