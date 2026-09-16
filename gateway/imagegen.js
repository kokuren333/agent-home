import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { resolveCodexCommand } from './backend.js';

/** Gateway-side image generation boundary. Apps receive this abstraction rather than Codex details. */
export class CodexCliImageGenerator {
  constructor({ root, bin, command = bin ? { bin, args: [], shell: false } : resolveCodexCommand() } = {}) { this.root = root; this.command = command; }
  async generate(prompt, options = {}) {
    const filename = options.filename || `${randomUUID()}.png`;
    const outputDir = options.outputDir || (options.outputPath ? path.dirname(options.outputPath) : path.join(this.root, 'data', 'character-icons'));
    const outputPath = options.outputPath || path.join(outputDir, filename);
    fs.mkdirSync(outputDir, { recursive: true });
    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    const instruction = options.purpose === 'infographic'
      ? [
        'Use the imagegen skill to generate one finished Japanese evidence-based infographic.',
        'Use a landscape 16:9 aspect ratio with safe margins. Use only facts and labels present in the supplied brief.',
        'The output must be a real raster PNG. Do not use SVG, HTML, CSS, Mermaid, Canvas, screenshots, or generated code as a substitute.',
        `Save the final PNG image exactly to: ${outputPath}`,
        'Do not return an explanation instead of the file.',
        `Source-grounded infographic brief:\n${prompt}`,
      ].join('\n\n')
      : [
        'Use the imagegen skill to generate one square anime-style character avatar for a mobile character chat app.',
        'Do not include text, logos, watermarks, or extra people.',
        `Save the final PNG image exactly to: ${outputPath}`,
        'The file must be a finished raster PNG, not an explanation.',
        `Character settings:\n${prompt}`
      ].join('\n\n');
    const result = await new Promise((resolve) => {
      const child = spawn(this.command.bin, [...(this.command.args || []), 'exec', '--ephemeral', '--skip-git-repo-check', '--sandbox', 'workspace-write', '-C', this.root, instruction], { cwd: this.root, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true, shell: this.command.shell ?? false });
      let stderr = ''; child.stderr.on('data', (chunk) => { stderr += chunk.toString().slice(-4000); });
      child.on('error', (error) => resolve({ code: -1, error }));
      child.on('close', (code) => resolve({ code, stderr }));
    });
    if (result.code !== 0 || !fs.existsSync(outputPath)) {
      try { if (fs.existsSync(outputPath)) fs.unlinkSync(outputPath); } catch {}
      throw new Error(result.error?.message || result.stderr || 'Codex imagegen did not create an image');
    }
    return { filename: path.basename(outputPath), path: outputPath, url: options.purpose === 'infographic' ? null : `/data/character-icons/${path.basename(outputPath)}` };
  }
  remove(filename) {
    if (!/^[a-f0-9-]+\.png$/i.test(filename)) return false;
    const target = path.resolve(this.root, 'data', 'character-icons', filename);
    if (!target.startsWith(path.resolve(this.root, 'data', 'character-icons') + path.sep)) return false;
    if (fs.existsSync(target)) fs.unlinkSync(target);
    return true;
  }
}

export function createImageGenerator(root) { return new CodexCliImageGenerator({ root }); }
