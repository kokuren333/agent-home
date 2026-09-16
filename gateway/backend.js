import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';

function nodeCommand(script) { return { bin: process.execPath, args: [script], shell: false }; }

function commandForCandidate(candidate) {
  if (!candidate) return null;
  const normalized = candidate.toLowerCase();
  if (process.platform === 'win32' && (normalized.endsWith('.cmd') || normalized.endsWith('.ps1') || normalized.endsWith('\\codex'))) {
    const npmRoot = path.dirname(candidate);
    const script = path.join(npmRoot, 'node_modules', '@openai', 'codex', 'bin', 'codex.js');
    if (fs.existsSync(script)) return nodeCommand(script);
  }
  return { bin: candidate, args: [], shell: false };
}

function findOnPath(names) {
  for (const directory of String(process.env.PATH || '').split(path.delimiter)) {
    if (!directory) continue;
    for (const name of names) {
      const candidate = path.join(directory, name);
      if (fs.existsSync(candidate)) return candidate;
    }
  }
  return null;
}

export function resolveCodexCommand() {
  if (process.env.CODEX_BIN) return commandForCandidate(process.env.CODEX_BIN);
  if (process.platform !== 'win32') return commandForCandidate(findOnPath(['codex']) || 'codex');
  const root = process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'OpenAI', 'Codex', 'bin');
  if (root && fs.existsSync(root)) {
    const versions = fs.readdirSync(root, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort()
      .reverse();
    for (const version of versions) {
      const candidate = path.join(root, version, 'codex.exe');
      if (fs.existsSync(candidate)) return commandForCandidate(candidate);
    }
  }
  const pathCandidate = findOnPath(['codex.exe', 'codex.cmd', 'codex.ps1', 'codex']);
  if (pathCandidate) return commandForCandidate(pathCandidate);
  const npmRoot = process.env.APPDATA && path.join(process.env.APPDATA, 'npm');
  const globalScript = npmRoot && path.join(npmRoot, 'node_modules', '@openai', 'codex', 'bin', 'codex.js');
  if (globalScript && fs.existsSync(globalScript)) return nodeCommand(globalScript);
  return commandForCandidate('codex.exe');
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
  constructor({ bin, command = bin ? commandForCandidate(bin) : resolveCodexCommand(), settings = {} } = {}) { this.name = 'codex-cli'; this.command = command; this.bin = command.bin; this.commandArgs = command.args || []; this.settings = settings; this.lastResearch = { searchCalls: 0, searches: [], sources: [], logs: [] }; }
  withSettings(settings) { return new CodexCliBackend({ command: this.command, settings }); }
  spawn(args, options) { return spawn(this.bin, [...this.commandArgs, ...args], { ...options, windowsHide: true, shell: this.command.shell ?? false }); }
  async run(prompt, options = {}) {
    let output = '';
    for await (const delta of this.stream(prompt, options)) output += delta;
    return output;
  }
  async listModels() {
    return await new Promise((resolve, reject) => {
      const child = this.spawn(['debug', 'models'], { stdio: ['ignore', 'pipe', 'pipe'] });
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
      const child = this.spawn(['--version'], { stdio: ['ignore', 'pipe', 'pipe'] });
      let output = '';
      let spawnError = null;
      child.stdout.on('data', (chunk) => { output += chunk; });
      child.on('error', (error) => { spawnError = error; });
      child.on('close', (code) => resolve(spawnError
        ? { ok: false, backend: this.name, reason: `Codex CLIを起動できません: ${spawnError.message}` }
        : { ok: code === 0, backend: this.name, version: output.trim(), ...(code === 0 ? {} : { reason: `exit ${code}` }) }));
    });
  }
  getLastResearch() { return this.lastResearch; }
  async *stream(prompt, { signal, webSearch = false, cwd, write = false } = {}) {
    const args = ['exec', '--json', '--skip-git-repo-check', '--ephemeral'];
    if (cwd) args.push('--cd', cwd);
    if (write) args.push('--sandbox', 'workspace-write');
    if (this.settings.model) args.push('--model', this.settings.model);
    if (this.settings.reasoningEffort) args.push('--config', `model_reasoning_effort="${this.settings.reasoningEffort}"`);
    // Current Codex CLI exposes web search as a feature flag. The old
    // tools.web_search config was accepted by neither the current CLI nor
    // its event stream, so the model could answer from memory instead.
    if (webSearch) args.push('--enable', 'standalone_web_search');
    this.lastResearch = { searchCalls: 0, searches: [], sources: [], logs: [] };
    const inspectResearch = (event) => {
      const serialized = JSON.stringify(event);
      if (!/web[_-]?search|search[_-]?call|search[_-]?query|search(?:ing|ed)?\s+(?:the\s+)?(?:web|sources?|results?)/i.test(serialized)) return;
      this.lastResearch.searchCalls += 1;
      const urls = [...serialized.matchAll(/https?:\/\/[^"\\\s]+/g)].map((match) => match[0].replace(/[),.]+$/, ''));
      for (const url of urls) if (!this.lastResearch.sources.some((source) => source.url === url)) this.lastResearch.sources.push({ title: url, url });
      const query = event.query || event.search_query || event.item?.query || event.item?.search_query || event.item?.action?.query;
      if (typeof query === 'string' && query.trim() && !this.lastResearch.searches.includes(query.trim())) this.lastResearch.searches.push(query.trim());
    };
    args.push(prompt);
    const child = this.spawn(args, { stdio: ['ignore', 'pipe', 'pipe'] });
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
          inspectResearch(event);
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
