import { basename, dirname, sep } from "node:path";
import {
  type Provider,
  type Session,
  type Usage,
  type Snapshot,
  sessionSchema,
  usageSchema,
} from "../../core/src/index";
import { contracts, metric, projectIdentity } from "./providers";
import { clean, date, id, integer, obj, parse } from "./io";

type FileState = {
  native?: string;
  project?: string;
  projectKey?: string;
  model?: string;
  version?: string;
  effort?: string;
  startedAt?: number;
  updatedAt?: number;
};
const validId = (value: unknown) =>
  typeof value === "string" && /^[\w.-]{1,180}$/.test(value)
    ? value
    : undefined;
const safeSum = (...values: (number | undefined)[]) =>
  values.every((value) => value !== undefined)
    ? integer(values.reduce<number>((total, value) => total + (value ?? 0), 0))
    : undefined;
export function ticksToUsd(value: unknown) {
  const raw =
    typeof value === "string" && /^\d{1,32}$/.test(value)
      ? value
      : integer(value)?.toString();
  if (raw === undefined) return undefined;
  const ticks = BigInt(raw);
  return `${ticks / 10_000_000_000n}.${String(ticks % 10_000_000_000n).padStart(10, "0")}`;
}
export function normalize(
  provider: Provider,
  environment: string,
  path: string,
  lines: { line: string; offset: number }[],
  old: FileState,
  now: number,
) {
  const metadata = { ...old };
  const events: Usage[] = [];
  for (const { line } of lines) {
    const row = obj(parse(line));
    const at = date(row.timestamp);
    if (at !== undefined)
      metadata.updatedAt = Math.max(metadata.updatedAt ?? 0, at);
    const payload = obj(row.payload);
    let tokens: Usage["tokens"] | undefined,
      event: string | undefined,
      costUsd: string | undefined;
    if (provider === "codex") {
      if (row.type === "session_meta") {
        metadata.native = validId(payload.id);
        Object.assign(metadata, projectIdentity(payload.cwd, environment));
        metadata.version = clean(payload.cli_version);
        metadata.startedAt = date(payload.timestamp) ?? at;
      }
      if (row.type === "turn_context") {
        metadata.model = clean(payload.model);
        metadata.effort = clean(payload.effort);
      }
      if (row.type === "token_usage_record") {
        const usage = obj(payload.usage);
        event = validId(payload.response_id);
        const input = integer(usage.input_tokens),
          cacheRead = integer(usage.cached_input_tokens);
        tokens = {
          input,
          uncached:
            input !== undefined && cacheRead !== undefined && cacheRead <= input
              ? input - cacheRead
              : undefined,
          cacheRead,
          cacheWrite: integer(usage.cache_write_input_tokens),
          output: integer(usage.output_tokens),
          reasoning: integer(usage.reasoning_output_tokens),
          total: integer(usage.total_tokens),
        };
      }
    } else if (provider === "claude") {
      metadata.native = validId(row.sessionId) ?? metadata.native;
      Object.assign(metadata, projectIdentity(row.cwd, environment));
      metadata.version = clean(row.version) ?? metadata.version;
      metadata.effort = clean(row.effort) ?? metadata.effort;
      if (at !== undefined) metadata.startedAt ??= at;
      if (row.type === "assistant") {
        const message = obj(row.message),
          usage = obj(message.usage);
        metadata.model = clean(message.model) ?? metadata.model;
        event = validId(message.id) ?? validId(row.requestId);
        const uncached = integer(usage.input_tokens),
          cacheRead = integer(usage.cache_read_input_tokens),
          cacheWrite = integer(usage.cache_creation_input_tokens),
          output = integer(usage.output_tokens);
        const input = safeSum(uncached, cacheRead, cacheWrite);
        tokens = {
          uncached,
          cacheRead,
          cacheWrite,
          output,
          input,
          total: safeSum(input, output),
        };
      }
    } else {
      const params = obj(row.params),
        update = obj(params.update);
      const folder = dirname(path).split(sep);
      metadata.native = validId(params.sessionId) ?? metadata.native;
      metadata.startedAt ??= at;
      try {
        Object.assign(
          metadata,
          projectIdentity(decodeURIComponent(folder.at(-2) ?? ""), environment),
        );
      } catch {
        /* Unknown project */
      }
      if (
        update.sessionUpdate === "turn_completed" &&
        row.method === "_x.ai/session/update"
      ) {
        const usage = obj(update.usage);
        event = validId(update.prompt_id);
        const modelKeys = Object.keys(obj(usage.modelUsage));
        const model = Array.isArray(usage.modelUsage)
          ? obj(usage.modelUsage[0]).model
          : modelKeys.length === 1
            ? modelKeys[0]
            : undefined;
        metadata.model = clean(model) ?? metadata.model;
        const input = integer(usage.inputTokens),
          cacheRead = integer(usage.cachedReadTokens);
        tokens = {
          input,
          cacheRead,
          cacheWrite: integer(usage.cacheCreationTokens),
          output: integer(usage.outputTokens),
          reasoning: integer(usage.reasoningTokens),
          total: integer(usage.totalTokens),
        };
        costUsd = ticksToUsd(usage.costUsdTicks);
      }
    }
    if (
      !tokens ||
      !event ||
      !metadata.native ||
      !Object.values(tokens).some((value) => value !== undefined)
    )
      continue;
    const key = id(provider, environment, metadata.native);
    const checked = usageSchema.safeParse({
      id: id(provider, event),
      sessionId: key,
      provider,
      environment,
      project: metadata.project ?? "Unknown project",
      projectKey: metadata.projectKey,
      model: metadata.model,
      tokens,
      costUsd,
      source: metric(contracts[provider], now, at ?? null, metadata.version),
    });
    if (checked.success) events.push(checked.data);
  }
  if (!metadata.native && provider === "grok" && lines.length)
    metadata.native = validId(basename(dirname(path)));
  let session: Session | undefined;
  if (metadata.native && lines.length) {
    const checked = sessionSchema.safeParse({
      id: id(provider, environment, metadata.native),
      provider,
      environment,
      project: metadata.project ?? "Unknown project",
      projectKey: metadata.projectKey,
      model: metadata.model,
      effort: metadata.effort,
      startedAt: metadata.startedAt,
      state: "recently-active",
      source: metric(
        contracts[provider],
        now,
        metadata.updatedAt ?? null,
        metadata.version,
      ),
    });
    if (checked.success) session = checked.data;
  }
  return { metadata, events, session };
}
export type HelperPayload = Pick<Snapshot, "sessions" | "usage">;
