import { spawn } from "node:child_process";
import type { ShellResult } from "../types.js";

export interface RunOptions {
  cwd: string;
  stdin?: string;
  timeoutMs?: number;
  env?: NodeJS.ProcessEnv;
  signal?: AbortSignal;
}

export function quoteForShell(value: string): string {
  if (process.platform === "win32") {
    return `"${value.replace(/"/g, '\\"')}"`;
  }
  return `'${value.replace(/'/g, "'\\''")}'`;
}

export async function runCommand(command: string, options: RunOptions): Promise<ShellResult> {
  return new Promise((resolve, reject) => {
    const childEnv = { ...process.env, ...options.env };
    // npm/Task Scheduler launches can omit the Windows shell variables even
    // though node itself is available. Preserve the inherited values when
    // present and provide the standard Windows fallbacks for worker commands.
    if (process.platform === "win32") {
      childEnv.ComSpec ||= childEnv.COMSPEC || "C:\\Windows\\System32\\cmd.exe";
      childEnv.COMSPEC ||= childEnv.ComSpec;
      childEnv.SystemRoot ||= "C:\\Windows";
    }
    const child = spawn(command, {
      cwd: options.cwd,
      // Keep Node's standard shell resolution for compatibility with the
      // existing Windows worker launch path.
      shell: true,
      env: childEnv,
      windowsHide: true,
    });
    const abort = () => {
      child.kill();
      reject(new Error(`Command aborted: ${command}`));
    };
    if (options.signal?.aborted) {
      abort();
      return;
    }
    options.signal?.addEventListener("abort", abort, { once: true });

    let stdout = "";
    let stderr = "";
    const timer =
      options.timeoutMs && options.timeoutMs > 0
        ? setTimeout(() => {
            child.kill();
            reject(new Error(`Command timed out after ${options.timeoutMs}ms: ${command}`));
          }, options.timeoutMs)
        : null;

    child.stdout.on("data", (chunk) => {
      stdout += String(chunk);
    });
    child.stderr.on("data", (chunk) => {
      stderr += String(chunk);
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (timer) clearTimeout(timer);
      options.signal?.removeEventListener("abort", abort);
      resolve({ code: code ?? 1, stdout, stderr });
    });

    if (options.stdin !== undefined) {
      child.stdin.write(options.stdin);
    }
    child.stdin.end();
  });
}

export async function runGit(cwd: string, args: string[], timeoutMs = 120_000): Promise<ShellResult> {
  const command = ["git", ...args.map(quoteForShell)].join(" ");
  return runCommand(command, { cwd, timeoutMs });
}

export async function requireOk(result: ShellResult, context: string): Promise<void> {
  if (result.code !== 0) {
    throw new Error(`${context} failed (${result.code})\n${result.stderr || result.stdout}`);
  }
}
