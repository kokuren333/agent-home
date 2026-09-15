import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';

/** Gateway-side image generation boundary. Apps receive this abstraction rather than Codex details. */
export class CodexCliImageGenerator {
  constructor({ root, bin = process.env.CODEX_BIN || 'codex' } = {}) { this.root = root; this.bin = bin; }
  async generate(prompt) {
    const filename = `${randomUUID()}.png`;
    const outputDir = path.join(this.root, 'data', 'character-icons');
    const outputPath = path.join(outputDir, filename);
    fs.mkdirSync(outputDir, { recursive: true });
    const instruction = [
      'Use the imagegen skill to generate one square anime-style character avatar for a mobile character chat app.',
      'Do not include text, logos, watermarks, or extra people.',
      `Save the final PNG image exactly to: ${outputPath}`,
      'The file must be a finished raster PNG, not an explanation.',
      `Character settings:\n${prompt}`
    ].join('\n\n');
    const result = await new Promise((resolve) => {
      const child = spawn(this.bin, ['exec', '--ephemeral', '--skip-git-repo-check', '--sandbox', 'workspace-write', '--approve-for-me', '-C', this.root, instruction], { cwd: this.root, stdio: ['ignore', 'pipe', 'pipe'] });
      let stderr = ''; child.stderr.on('data', (chunk) => { stderr += chunk.toString().slice(-4000); });
      child.on('error', (error) => resolve({ code: -1, error }));
      child.on('close', (code) => resolve({ code, stderr }));
    });
    if (result.code !== 0 || !fs.existsSync(outputPath)) {
      try { if (fs.existsSync(outputPath)) fs.unlinkSync(outputPath); } catch {}
      throw new Error(result.error?.message || result.stderr || 'Codex imagegen did not create an image');
    }
    return { filename, url: `/data/character-icons/${filename}` };
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
