import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { open, opendir } from "node:fs/promises";
import { join } from "node:path";

export const obj = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
export const clean = (value: unknown) =>
  typeof value === "string"
    ? value.replace(/[\p{C}]/gu, "").slice(0, 240)
    : undefined;
export const id = (...values: string[]) =>
  createHash("sha256")
    .update(JSON.stringify(values))
    .digest("hex")
    .slice(0, 32);
export const integer = (value: unknown) =>
  typeof value === "number" && Number.isSafeInteger(value) && value >= 0
    ? value
    : undefined;
export const date = (value: unknown) => {
  const stamp =
    typeof value === "string"
      ? Date.parse(value)
      : typeof value === "number"
        ? value * (value < 1e11 ? 1000 : 1)
        : NaN;
  return Number.isSafeInteger(stamp) && stamp >= 0 && stamp <= 8.64e15
    ? stamp
    : undefined;
};
export function parse(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

const ownedProbes = new Set<() => void>();
export function cancelProbes() {
  for (const cancel of ownedProbes) cancel();
}
export function probe<T>(
  file: string,
  args: string[],
  options: {
    encoding?: "utf8" | "utf16le";
    cwd?: string;
    env?: NodeJS.ProcessEnv;
    timeout?: number;
    exchange?: (
      line: string,
      send: (value: unknown) => void,
      done: (value: T) => void,
    ) => void;
  } = {},
): Promise<T | string> {
  return new Promise((resolve, reject) => {
    const child = spawn(file, args, {
      cwd: options.cwd,
      env: options.env,
      windowsHide: true,
      detached: process.platform !== "win32",
      stdio: ["pipe", "pipe", "ignore"],
    });
    let bytes = 0,
      buffer = "",
      settled = false;
    const cancel = () => finish(new Error("Probe canceled"));
    ownedProbes.add(cancel);
    const timer = setTimeout(
      () => finish(new Error("Probe timed out")),
      options.timeout ?? 5000,
    );
    function finish(error?: Error, value?: T | string) {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      ownedProbes.delete(cancel);
      child.stdin.destroy();
      if (child.pid && process.platform !== "win32") {
        try {
          process.kill(-child.pid, "SIGKILL");
        } catch {
          /* Already exited */
        }
      } else if (child.pid && child.exitCode === null) {
        const taskkill = spawn(
          join(
            process.env.SystemRoot ?? "C:\\Windows",
            "System32",
            "taskkill.exe",
          ),
          ["/PID", String(child.pid), "/T", "/F"],
          { windowsHide: true, stdio: "ignore" },
        );
        taskkill.on("error", () => child.kill());
        taskkill.unref();
      }
      if (error) reject(error);
      else resolve(value ?? "");
    }
    child.on("error", () => finish(new Error("Probe could not start")));
    child.stdin.on("error", () => finish(new Error("Probe input closed")));
    child.stdout.setEncoding(options.encoding ?? "utf8");
    child.stdout.on("data", (chunk: string) => {
      bytes += Buffer.byteLength(chunk);
      if (bytes > 2 * 1024 * 1024) {
        finish(new Error("Probe output exceeded limit"));
        return;
      }
      buffer += chunk;
      if (!options.exchange) return;
      let newline = buffer.indexOf("\n");
      while (newline >= 0 && !settled) {
        const line = buffer.slice(0, newline);
        buffer = buffer.slice(newline + 1);
        try {
          options.exchange(
            line,
            (value) => child.stdin.write(JSON.stringify(value) + "\n"),
            (value) => finish(undefined, value),
          );
        } catch (error) {
          finish(
            error instanceof Error
              ? error
              : new Error("Provider protocol rejected the read"),
          );
        }
        newline = buffer.indexOf("\n");
      }
    });
    child.on("close", (code) =>
      code === 0 && !options.exchange
        ? finish(undefined, buffer)
        : finish(new Error("Provider read unavailable")),
    );
    if (options.exchange)
      options.exchange(
        "",
        (value) => child.stdin.write(JSON.stringify(value) + "\n"),
        (value) => finish(undefined, value),
      );
    else child.stdin.end();
  });
}
export async function walk(
  root: string,
  accept: (name: string) => boolean,
  depth = 6,
  limit = 800,
) {
  const files: string[] = [];
  let visited = 0;
  async function visit(dir: string, left: number) {
    const listing = await opendir(dir);
    for await (const item of listing) {
      if (++visited > limit * 8 || files.length >= limit) break;
      const path = join(dir, item.name);
      if (item.isDirectory() && left > 0)
        await visit(path, left - 1).catch(() => {});
      else if (item.isFile() && accept(item.name)) files.push(path);
    }
  }
  await visit(root, depth);
  return files;
}

export async function readLines(
  path: string,
  previous?: { identity: string; offset: number },
  budget = 1024 * 1024,
) {
  const file = await open(path, "r");
  try {
    const stat = await file.stat();
    if (!stat.isFile()) throw new Error("Expected a regular file");
    const identity = [stat.dev, stat.ino, stat.birthtimeMs].join(":");
    const offset =
      previous?.identity === identity && previous.offset <= stat.size
        ? previous.offset
        : 0;
    const data = Buffer.alloc(Math.min(stat.size - offset, budget));
    const { bytesRead } = await file.read(data, 0, data.length, offset);
    const lines: { line: string; offset: number }[] = [];
    let start = 0;
    for (let pos = 0; pos < bytesRead; pos++) {
      if (data[pos] !== 10) continue;
      if (pos - start <= 512 * 1024)
        lines.push({
          line: data.toString("utf8", start, pos),
          offset: offset + start,
        });
      start = pos + 1;
    }
    if (start === 0 && bytesRead === budget) start = bytesRead;
    return {
      identity,
      offset: offset + start,
      lines,
      modified: Math.trunc(stat.mtimeMs),
    };
  } finally {
    await file.close();
  }
}
