import {
  mkdir,
  readFile,
  rename,
  stat,
  unlink,
  writeFile,
} from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import type { Readable } from "node:stream";
import { z } from "zod";
import {
  sessionSchema,
  usageSchema,
  type Snapshot,
} from "../../core/src/index";
import { dataHome } from "./paths";
import { id, parse, walk } from "./io";

const localId = z.string().regex(/^[a-f0-9]{32}$/);
const labelSchema = z.string().regex(/^[\p{L}\p{N} .:_-]{1,60}$/u);
const frameSchema = z.object({
  protocol: z.literal(1),
  environment: localId,
  observedAt: z.number().int().nonnegative().max(8.64e15),
  sessions: z.array(sessionSchema).max(500),
  usage: z.array(usageSchema).max(5000),
});
const fileSchema = z.object({ label: labelSchema, frame: frameSchema });
const maximum = 8 * 1024 * 1024;
const inbox = () => join(dataHome(), "environments");
export function helperFrame(snapshot: Snapshot, environment: string) {
  return frameSchema.parse({
    protocol: 1,
    environment,
    observedAt: Date.now(),
    sessions: snapshot.sessions,
    usage: snapshot.usage,
  });
}
async function* boundedFrames(input: Readable) {
  let line = "";
  let discarded = false;
  input.setEncoding("utf8");
  for await (const chunk of input as AsyncIterable<string>) {
    const segments = chunk.split("\n");
    for (const [index, segment] of segments.entries()) {
      if (index > 0) {
        if (!discarded && line) yield line;
        line = "";
        discarded = false;
      }
      if (discarded) continue;
      if (line.length + segment.length > maximum) {
        line = "";
        discarded = true;
        continue;
      }
      line += segment;
    }
  }
  if (!discarded && line) yield line;
}
export async function listenForHelper(
  labelValue: string,
  input = process.stdin as Readable,
) {
  const label = labelSchema.parse(labelValue);
  const root = inbox();
  await mkdir(root, { recursive: true, mode: 0o700 });
  for await (const line of boundedFrames(input)) {
    if (Buffer.byteLength(line) > maximum) continue;
    const checked = frameSchema.safeParse(parse(line));
    if (!checked.success) continue;
    const frame = checked.data;
    const file = join(root, id(label, frame.environment) + ".json");
    const tmp = file + "." + randomUUID() + ".tmp";
    try {
      await writeFile(tmp, JSON.stringify({ label, frame }), {
        mode: 0o600,
        flag: "wx",
      });
      await rename(tmp, file);
    } finally {
      await unlink(tmp).catch(() => {});
    }
  }
}
export async function importedHelpers(now: number) {
  const paths = await walk(
    inbox(),
    (name) => /^[a-f0-9]{32}\.json$/.test(name),
    0,
    12,
  ).catch(() => []);
  return (
    await Promise.all(
      paths.map(async (path) => {
        try {
          const info = await stat(path);
          if (
            info.size > maximum ||
            now - info.mtimeMs > 7 * 86400000 ||
            !info.isFile()
          )
            return;
          const { label, frame } = fileSchema.parse(
            parse(await readFile(path, "utf8")),
          );
          if (frame.observedAt > now + 60000) return;
          const environment = id("helper", label, frame.environment);
          const connected = now - info.mtimeMs < 90000;
          return {
            environment: {
              id: environment,
              label,
              status: connected ? "Collector connected" : "Collector stale",
            },
            sessions: frame.sessions.map((row) => ({
              ...row,
              id: id(environment, row.id),
              environment,
              state: connected ? row.state : ("recently-active" as const),
            })),
            usage: frame.usage.map((row) => ({
              ...row,
              environment,
              sessionId: id(environment, row.sessionId),
            })),
          };
        } catch {
          return;
        }
      }),
    )
  ).filter((row) => row !== undefined);
}
