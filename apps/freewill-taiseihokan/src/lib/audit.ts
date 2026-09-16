import type { AuditAnswer, AuditModel, AuditQuestion } from '../types';

export type Distribution = Record<string, number>;

const EPS = 1e-12;

// audit-model.json の likelihood は個人向けにAI生成されたヒューリスティック値であり、
// 実測で十分に校正された確率とは限らない。1回答で事後確率が過度に尖らないよう、
// 条件付き確率を tempering してから利用する。
const EVIDENCE_POWER = 0.68;
const NOVELTY_WEIGHT = 0.30;
const TIE_BREAK_WEIGHT = 0.08;

// 質問数を固定せず、候補が十分に絞れた時点で終了する。
// ただし1〜2問の偶然の偏りだけで終了しないための安全ガードは残す。
// 早期判定は残しつつ、曖昧なモデルでも質問が無限に続かないよう上限を設ける。
// 通常は6〜8問を目標にし、12問目で必ず判定する。
export const AUDIT_MIN_QUESTIONS = 4;
export const AUDIT_MIN_INFORMATIVE_ANSWERS = 4;
export const AUDIT_MAX_QUESTIONS = 12;
export const AUDIT_PRIMARY_PROBABILITY_THRESHOLD = 0.40;
export const AUDIT_PRIMARY_GAP_THRESHOLD = 0.10;
export const AUDIT_WINNER_RETENTION_THRESHOLD = 0.70;
export const AUDIT_CANDIDATE_DISPLAY_THRESHOLD = 0.08;

export function normalize(dist: Distribution): Distribution {
  const total = Object.values(dist).reduce((a, b) => a + Math.max(0, b), 0);
  if (total <= 0) {
    const keys = Object.keys(dist);
    return Object.fromEntries(keys.map((k) => [k, 1 / Math.max(keys.length, 1)]));
  }
  return Object.fromEntries(Object.entries(dist).map(([k, v]) => [k, Math.max(0, v) / total]));
}

export function initialDistribution(model: AuditModel): Distribution {
  return normalize(Object.fromEntries(model.states.map((s) => [s.id, s.prior])));
}

export function entropy(dist: Distribution): number {
  return -Object.values(dist).reduce((acc, p) => p > 0 ? acc + p * Math.log2(p) : acc, 0);
}

function temperedWeights(question: AuditQuestion, stateId: string): number[] {
  const weights = question.likelihoods[stateId] ?? [1, 1, 1, 1, 1];
  const total = weights.reduce((a, b) => a + Math.max(0, b), 0) || 1;
  const raw = weights.map((w) => Math.max(w, EPS) / total);
  const tempered = raw.map((p) => Math.pow(p, EVIDENCE_POWER));
  const temperedTotal = tempered.reduce((a, b) => a + b, 0) || 1;
  return tempered.map((p) => p / temperedTotal);
}

function conditional(question: AuditQuestion, stateId: string, answerIndex: number): number {
  return temperedWeights(question, stateId)[answerIndex] ?? EPS;
}

function answerProbability(question: AuditQuestion, dist: Distribution, answerIndex: number): number {
  return Object.entries(dist).reduce((sum, [stateId, pState]) => sum + pState * conditional(question, stateId, answerIndex), 0);
}

export function updateDistribution(dist: Distribution, question: AuditQuestion, answerIndex: number | null): Distribution {
  if (answerIndex === null) return dist;
  const posterior: Distribution = {};
  for (const [stateId, pState] of Object.entries(dist)) {
    posterior[stateId] = pState * conditional(question, stateId, answerIndex);
  }
  return normalize(posterior);
}

export function distributionAfterAnswers(model: AuditModel, answers: AuditAnswer[]): Distribution {
  let dist = initialDistribution(model);
  for (const answer of answers) {
    const question = model.questions.find((q) => q.id === answer.questionId);
    if (question) dist = updateDistribution(dist, question, answer.value);
  }
  return dist;
}

export function expectedInformationGain(question: AuditQuestion, dist: Distribution): number {
  const before = entropy(dist);
  let expectedAfter = 0;
  for (let answerIndex = 0; answerIndex < 5; answerIndex += 1) {
    const pAnswer = answerProbability(question, dist, answerIndex);
    if (pAnswer <= EPS) continue;
    const posterior = updateDistribution(dist, question, answerIndex);
    expectedAfter += pAnswer * entropy(posterior);
  }
  return Math.max(0, before - expectedAfter);
}

function questionFingerprint(model: AuditModel, question: AuditQuestion): number[] {
  return model.states.map((state) => {
    const probs = temperedWeights(question, state.id);
    return probs.reduce((sum, p, index) => sum + p * index, 0);
  });
}

function correlationSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length || a.length < 2) return 0;
  const meanA = a.reduce((x, y) => x + y, 0) / a.length;
  const meanB = b.reduce((x, y) => x + y, 0) / b.length;
  let num = 0;
  let denA = 0;
  let denB = 0;
  for (let i = 0; i < a.length; i += 1) {
    const da = a[i] - meanA;
    const db = b[i] - meanB;
    num += da * db;
    denA += da * da;
    denB += db * db;
  }
  const denom = Math.sqrt(denA * denB);
  if (denom <= EPS) return 0;
  return Math.min(1, Math.abs(num / denom));
}

function noveltyFor(model: AuditModel, question: AuditQuestion, askedIds: Set<string>): number {
  if (!askedIds.size) return 1;
  const fingerprint = questionFingerprint(model, question);
  let maxSimilarity = 0;
  for (const askedId of askedIds) {
    const asked = model.questions.find((q) => q.id === askedId);
    if (!asked) continue;
    maxSimilarity = Math.max(maxSimilarity, correlationSimilarity(fingerprint, questionFingerprint(model, asked)));
  }
  return Math.max(0, 1 - maxSimilarity);
}

function currentnessFor(question: AuditQuestion): number {
  if (question.text.includes('今この瞬間')) return 1.18;
  if (question.text.includes('今日')) return 1.12;
  if (question.text.includes('直近24時間')) return 1.08;
  if (question.text.includes('直近72時間')) return 0.98;
  if (question.text.includes('今週')) return 0.90;
  return 0.82;
}

function pairwiseDiscrimination(question: AuditQuestion, stateA: string, stateB: string): number {
  const a = temperedWeights(question, stateA);
  const b = temperedWeights(question, stateB);
  // total variation distance: 0=識別不能, 1=完全分離
  return 0.5 * a.reduce((sum, p, index) => sum + Math.abs(p - (b[index] ?? 0)), 0);
}

/**
 * 次の質問を出した場合にも、現在の1位が維持される期待確率。
 * 情報量が大きい質問でも、現在の候補を覆す可能性が高いなら追加で尋ねる。
 */
export function expectedWinnerRetention(question: AuditQuestion, dist: Distribution, leaderId: string): number {
  let retention = 0;
  for (let answerIndex = 0; answerIndex < 5; answerIndex += 1) {
    const pAnswer = answerProbability(question, dist, answerIndex);
    if (pAnswer <= EPS) continue;
    const posterior = updateDistribution(dist, question, answerIndex);
    if (rankedStates(posterior)[0]?.[0] === leaderId) retention += pAnswer;
  }
  return retention;
}

export function chooseNextQuestion(model: AuditModel, dist: Distribution, askedIds: Set<string>) {
  const candidates = model.questions.filter((q) => !askedIds.has(q.id));
  if (!candidates.length) return null;
  const leaders = rankedStates(dist).slice(0, 2);
  const leaderA = leaders[0]?.[0];
  const leaderB = leaders[1]?.[0];
  const leaderMass = (leaders[0]?.[1] ?? 0) + (leaders[1]?.[1] ?? 0);
  return candidates
    .map((question) => {
      const informationGain = expectedInformationGain(question, dist);
      const novelty = noveltyFor(model, question, askedIds);
      const tieBreaker = leaderA && leaderB && askedIds.size >= 6 ? pairwiseDiscrimination(question, leaderA, leaderB) : 0;
      // 情報量を主軸にしつつ、同型質問を抑え、探索後半では上位2状態を直接識別できる質問を少し優先する。
      const selectionScore = informationGain * currentnessFor(question) * ((1 - NOVELTY_WEIGHT) + NOVELTY_WEIGHT * novelty)
        + TIE_BREAK_WEIGHT * leaderMass * tieBreaker;
      return { question, informationGain, novelty, tieBreaker, selectionScore };
    })
    .sort((a, b) => b.selectionScore - a.selectionScore || b.informationGain - a.informationGain)[0];
}

export function rankedStates(dist: Distribution) {
  return Object.entries(dist).sort((a, b) => b[1] - a[1]);
}

function leaderWasStable(model: AuditModel, dist: Distribution, answers: AuditAnswer[]): boolean {
  if (answers.length < AUDIT_MIN_QUESTIONS) return false;
  const leader = rankedStates(dist)[0]?.[0];
  const previous = distributionAfterAnswers(model, answers.slice(0, -1));
  return Boolean(leader && rankedStates(previous)[0]?.[0] === leader);
}

export function decisionQuality(model: AuditModel, dist: Distribution, askedIds: Set<string>, answers: AuditAnswer[]) {
  const ranked = rankedStates(dist);
  const leaderId = ranked[0]?.[0] ?? '';
  const top = ranked[0]?.[1] ?? 0;
  const second = ranked[1]?.[1] ?? 0;
  const gap = top - second;
  const informativeCount = answers.filter((a) => a.value !== null).length;
  const leaderStable = leaderWasStable(model, dist, answers);
  const next = chooseNextQuestion(model, dist, askedIds);
  const winnerRetention = leaderId && next
    ? expectedWinnerRetention(next.question, dist, leaderId)
    : 1;
  const actionable = answers.length >= AUDIT_MIN_QUESTIONS
    && informativeCount >= AUDIT_MIN_INFORMATIVE_ANSWERS
    && top >= AUDIT_PRIMARY_PROBABILITY_THRESHOLD
    && gap >= AUDIT_PRIMARY_GAP_THRESHOLD
    && leaderStable
    && winnerRetention >= AUDIT_WINNER_RETENTION_THRESHOLD;
  return { actionable, leaderId, top, second, gap, informativeCount, leaderStable, winnerRetention, next };
}

export function secondaryCandidate(dist: Distribution) {
  const ranked = rankedStates(dist);
  const [primaryId, primaryProbability] = ranked[0] ?? ['', 0];
  const [secondaryId, secondaryProbability] = ranked[1] ?? ['', 0];
  if (!secondaryId || primaryProbability <= 0) return null;
  const relative = secondaryProbability / primaryProbability;
  // 状態数を8〜12へ絞ったため、主状態に近い有力候補も参考副状態として残す。
  if (secondaryProbability >= 0.10 || (secondaryProbability >= 0.07 && relative >= 0.30)) {
    return { primaryId, primaryProbability, secondaryId, secondaryProbability };
  }
  return null;
}

export function shouldStop(model: AuditModel, dist: Distribution, askedIds: Set<string>, answers: AuditAnswer[]) {
  const quality = decisionQuality(model, dist, askedIds, answers);
  if (answers.length >= AUDIT_MAX_QUESTIONS) return { stop: true, reason: 'max-questions' as const };
  if (!quality.next) return { stop: true, reason: 'no-questions' as const };
  if (quality.actionable) return { stop: true, reason: 'confidence' as const };
  // 固定問数では打ち切らず、追加質問から得られる情報がほぼなくなったら
  // 最上位候補を暫定ルートとして採用する。これにより必ず判定へ到達する。
  if (answers.length >= AUDIT_MIN_QUESTIONS
    && quality.next.informationGain < 0.005
    && quality.winnerRetention >= 0.95
    && quality.leaderStable) {
    return { stop: true, reason: 'no-progress' as const };
  }
  return { stop: false, reason: null, next: quality.next };
}

export function confidenceFor(dist: Distribution, informativeCount = AUDIT_MIN_INFORMATIVE_ANSWERS): 'high' | 'medium' | 'low' {
  const ranked = rankedStates(dist);
  const top = ranked[0]?.[1] ?? 0;
  const second = ranked[1]?.[1] ?? 0;
  const gap = top - second;
  if (informativeCount >= AUDIT_MIN_INFORMATIVE_ANSWERS && top >= 0.65 && gap >= 0.25) return 'high';
  if (informativeCount >= AUDIT_MIN_INFORMATIVE_ANSWERS && top >= AUDIT_PRIMARY_PROBABILITY_THRESHOLD && gap >= AUDIT_PRIMARY_GAP_THRESHOLD) return 'medium';
  return 'low';
}

export function influentialAnswers(model: AuditModel, answers: AuditAnswer[], finalDist: Distribution, limit = 4): string[] {
  const topId = rankedStates(finalDist)[0]?.[0];
  if (!topId) return [];
  const initial = initialDistribution(model);
  return answers
    .filter((a) => a.value !== null)
    .map((a) => {
      const q = model.questions.find((item) => item.id === a.questionId);
      if (!q || a.value === null) return null;
      const idx = a.value;
      const pTop = conditional(q, topId, idx);
      const pMarginal = Math.max(answerProbability(q, initial, idx), EPS);
      return { text: q.text, score: Math.abs(Math.log(pTop / pMarginal)) };
    })
    .filter((x): x is { text: string; score: number } => Boolean(x))
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((x) => x.text);
}
