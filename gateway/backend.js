import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';

function resolveCodexBin() {
  if (process.env.CODEX_BIN) return process.env.CODEX_BIN;
  if (process.platform !== 'win32') return 'codex';
  const root = process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'OpenAI', 'Codex', 'bin');
  if (root && fs.existsSync(root)) {
    const versions = fs.readdirSync(root, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort()
      .reverse();
    for (const version of versions) {
      const candidate = path.join(root, version, 'codex.exe');
      if (fs.existsSync(candidate)) return candidate;
    }
  }
  return 'codex.exe';
}

export class MockBackend {
  constructor() { this.name = 'mock'; }
  withSettings() { return this; }
  async listModels() { return []; }
  async health() { return { ok: true, backend: this.name, mode: 'safe-development-response' }; }
  async *stream(prompt, { signal } = {}) {
    // Never echo the complete prompt: it contains private persona and
    // character instructions that must not be shown as chat content.
    const userMessages = [...prompt.matchAll(/(?:^|\n)user:\s*(.*)/g)];
    const lastMessage = (userMessages.at(-1)?.[1] || '話題').trim().slice(0, 120);
    const text = `うん、「${lastMessage}」について話そう。`;
    for (const token of text.split(/(\s+)/)) {
      if (signal?.aborted) return;
      await new Promise((resolve) => setTimeout(resolve, 12));
      if (token) yield token;
    }
  }
  async cancel() {}
}

export class CodexCliBackend {
  constructor({ bin = resolveCodexBin(), settings = {} } = {}) { this.name = 'codex-cli'; this.bin = bin; this.settings = settings; }
  withSettings(settings) { return new CodexCliBackend({ bin: this.bin, settings }); }
  async listModels() {
    return await new Promise((resolve, reject) => {
      const child = spawn(this.bin, ['debug', 'models'], { stdio: ['ignore', 'pipe', 'pipe'] });
      let output = '';
      let spawnError = null;
      child.stdout.on('data', (chunk) => { output += chunk; });
      child.on('error', (error) => { spawnError = error; });
      child.on('close', (code) => {
        if (spawnError) return reject(new Error(`Codex CLIを起動できません: ${spawnError.message}`));
        if (code !== 0) return reject(new Error(`Codex CLIのモデル一覧取得に失敗しました (exit ${code})`));
        try {
          const catalog = JSON.parse(output);
          const models = (Array.isArray(catalog.models) ? catalog.models : [])
            .filter((model) => model.visibility === 'list' && model.supported_in_api !== false && model.slug)
            .map((model) => ({
              id: model.slug,
              name: model.display_name || model.slug,
              defaultReasoningEffort: model.default_reasoning_level || 'low',
              reasoningEfforts: (Array.isArray(model.supported_reasoning_levels) ? model.supported_reasoning_levels : [])
                .map((level) => level.effort).filter(Boolean),
            }));
          resolve(models);
        } catch (error) { reject(new Error(`Codex CLIのモデル一覧を解釈できません: ${error.message}`)); }
      });
    });
  }
  async health() {
    return await new Promise((resolve) => {
      const child = spawn(this.bin, ['--version'], { stdio: ['ignore', 'pipe', 'pipe'] });
      let output = '';
      child.stdout.on('data', (chunk) => { output += chunk; });
      child.on('error', () => resolve({ ok: false, backend: this.name, reason: 'Codex CLI not found' }));
      child.on('close', (code) => resolve({ ok: code === 0, backend: this.name, version: output.trim() }));
    });
  }
  async *stream(prompt, { signal } = {}) {
    const args = ['exec', '--json', '--skip-git-repo-check'];
    if (this.settings.model) args.push('--model', this.settings.model);
    if (this.settings.reasoningEffort) args.push('--config', `model_reasoning_effort="${this.settings.reasoningEffort}"`);
    args.push(prompt);
    const child = spawn(this.bin, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stderr = '';
    let spawnError = null;
    child.on('error', (error) => { spawnError = error; });
    const exit = new Promise((resolve) => child.on('close', resolve));
    signal?.addEventListener('abort', () => child.kill());
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    let buffer = '';
    for await (const chunk of child.stdout) {
      buffer += chunk.toString();
      const lines = buffer.split('\n'); buffer = lines.pop() || '';
      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const event = JSON.parse(line);
          const delta = event.delta ?? event.text ?? event.item?.text;
          if (typeof delta === 'string') yield delta;
        } catch { /* Codex output can include non-JSON diagnostic lines. */ }
      }
    }
    if (buffer.trim()) {
      try { const event = JSON.parse(buffer); if (typeof event.text === 'string') yield event.text; } catch {}
    }
    const code = await exit;
    if (spawnError) throw new Error(`Codex CLIを起動できません: ${spawnError.message}`);
    if (code !== 0 && !signal?.aborted) throw new Error(stderr.trim() || `Codex exited with code ${code}`);
  }
  async cancel() {}
}

export function createBackend() {
  return process.env.AGENT_BACKEND === 'codex' ? new CodexCliBackend() : new MockBackend();
}
