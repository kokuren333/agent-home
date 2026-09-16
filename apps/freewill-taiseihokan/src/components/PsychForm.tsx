import React, { useMemo } from 'react';
import { allPsychQuestions, psychDimensions, quickPsychQuestions, scorePsychometrics } from '../data/psychometrics';
import type { FreeWillData } from '../types';
import { Panel, ProgressBar } from './Common';

const options = [
  [1, '全く当てはまらない'], [2, 'あまり当てはまらない'], [3, 'どちらともいえない'], [4, 'やや当てはまる'], [5, '非常に当てはまる'],
] as const;

export default function PsychForm({ mode, data, onChange }: { mode: 'quick' | 'detailed'; data: FreeWillData; onChange: (next: FreeWillData) => void }) {
  const questions = mode === 'quick' ? quickPsychQuestions : allPsychQuestions;
  const answered = questions.filter((q) => typeof data.psychometrics.responses[q.id] === 'number').length;
  const byDimension = useMemo(() => psychDimensions.map((d) => ({ ...d, questions: questions.filter((q) => q.dimension === d.id) })).filter((d) => d.questions.length), [questions]);

  const setAnswer = (id: string, value: number | null) => {
    const responses = { ...data.psychometrics.responses, [id]: value };
    const scored = scorePsychometrics(responses);
    onChange({ ...data, updatedAt: new Date().toISOString(), psychometrics: { ...data.psychometrics, responses, ...scored } });
  };

  return <div className="stack-lg">
    <Panel>
      <div className="section-heading"><div><h2>心理測定</h2><p>5件法。診断ではありません。結果は「本アプリ独自の補助評価」として扱います。</p></div><span className="status-chip">{mode === 'quick' ? '60問' : '150問'}</span></div>
      <ProgressBar value={answered} max={questions.length} label={`${answered} / ${questions.length} 回答`} />
      <p className="muted">選択済みの項目をもう一度選択すると、その回答を解除できます。</p>
      <p className="muted">回答一貫性: {data.psychometrics.consistency === 'insufficient' ? '算出保留' : data.psychometrics.consistency === 'high' ? '高' : data.psychometrics.consistency === 'medium' ? '中' : '低'}</p>
    </Panel>

    {byDimension.map((dimension) => <Panel key={dimension.id}>
      <h3>{dimension.label}</h3>
      <div className="question-list">
        {dimension.questions.map((q, index) => {
          const current = data.psychometrics.responses[q.id];
          return <fieldset className="psych-question" key={q.id}>
            <legend>{index + 1}. {q.text}</legend>
            <div className="likert-row">
              {options.map(([value, label]) => <label key={value} className={`likert-option ${current === value ? 'selected' : ''}`}>
                <input
                  type="radio"
                  name={q.id}
                  value={value}
                  checked={current === value}
                  onChange={() => {}}
                  onClick={() => setAnswer(q.id, current === value ? null : value)}
                  aria-label={`${label}${current === value ? '（選択済み。再選択で解除）' : ''}`}
                />
                <span>{value}</span><small>{label}</small>
              </label>)}
            </div>
          </fieldset>;
        })}
      </div>
    </Panel>)}
  </div>;
}
