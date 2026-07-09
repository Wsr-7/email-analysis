import * as cp from "node:child_process";
import * as fs from "node:fs";

export function runProcess(
  command: string,
  args: string[],
  timeoutMs = 30000,
  onEvent?: (event: string, data: Record<string, unknown>) => void
): Promise<void> {
  return new Promise((resolve, reject) => {
    const startedAt = Date.now();
    onEvent?.("start", { command, args: sanitizeProcessArgs(args), timeoutMs });
    const child = cp.spawn(command, args, { windowsHide: true });
    let stdout = "";
    let stderr = "";
    let settled = false;
    const timeout = setTimeout(() => {
      if (settled) {
        return;
      }
      settled = true;
      child.kill();
      onEvent?.("timeout", processEvent(command, startedAt, stdout, stderr));
      reject(new Error(`${command} timed out after ${String(timeoutMs)}ms. ${stderr || stdout}`.trim()));
    }, timeoutMs);
    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });
    child.on("error", (error) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timeout);
      onEvent?.("error", { ...processEvent(command, startedAt, stdout, stderr), error: formatError(error) });
      reject(error);
    });
    child.on("close", (code) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timeout);
      onEvent?.("close", { ...processEvent(command, startedAt, stdout, stderr), code });
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(stderr || stdout || `${command} exited with code ${String(code)}`));
      }
    });
  });
}

function processEvent(command: string, startedAt: number, stdout: string, stderr: string): Record<string, unknown> {
  return {
    command,
    elapsedMs: Date.now() - startedAt,
    stdoutLength: stdout.length,
    stderrLength: stderr.length,
    ...snippetField("stdout", stdout),
    ...snippetField("stderr", stderr)
  };
}

function snippetField(name: string, value: string): Record<string, string> {
  const snippet = summarizeProcessOutput(value);
  return snippet ? { [name]: snippet } : {};
}

function summarizeProcessOutput(value: string): string {
  const normalized = value.replace(/\r\n/g, "\n").replace(/\r/g, "\n").trim();
  if (!normalized) {
    return "";
  }
  return normalized.length > 2000 ? `${normalized.slice(0, 2000)}...` : normalized;
}

export function formatElapsedSeconds(elapsedMs: number): string {
  const seconds = Math.max(0, elapsedMs) / 1000;
  return `${seconds.toFixed(seconds >= 10 ? 0 : 1)}s`;
}

export function formatError(error: unknown): string {
  return error instanceof Error ? `${error.name}: ${error.message}` : String(error);
}

export async function deleteFileIfExists(filePath: string): Promise<void> {
  await fs.promises.unlink(filePath).catch((error: NodeJS.ErrnoException) => {
    if (error.code !== "ENOENT") {
      throw error;
    }
  });
}

export function sanitizeProcessArgs(args: string[]): string[] {
  return args.map((arg) => {
    if (arg.length > 180) {
      return `${arg.slice(0, 180)}...`;
    }
    return arg;
  });
}
