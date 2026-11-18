import { z } from "zod";

export const providers = ["claude", "grok", "codex"] as const;
export type Provider = (typeof providers)[number];
export const names = {
  claude: "Claude Code",
  grok: "Grok Build",
  codex: "Codex",
};
export const availability = z.enum([
  "available",
  "unsupported",
  "needs-integration",
  "permission-denied",
  "auth-required",
  "temporarily-unavailable",
  "unknown",
]);
const str = z.string().max(256);
const time = z.number().int().nonnegative().max(8.64e15);
const count = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
export const percentage = z.number().min(0).max(100);
export const state = z.enum([
  "working",
  "waiting-for-input",
  "waiting-for-approval",
  "idle",
  "completed",
  "failed",
  "stopped",
  "running-activity-unknown",
  "recently-active",
  "unknown",
]);
export const source = z.object({
  contract: str,
  version: str.optional(),
  observedAt: time.nullable(),
  collectedAt: time,
  coverage: z.enum(["local-observed", "account-reported", "synthetic"]),
  quality: z.enum(["reported", "derived", "estimated"]),
});
export const windowSchema = z.object({
  id: str,
  label: str,
  used: percentage.nullable(),
  resetsAt: time.nullable(),
  startsAt: time.optional(),
  minutes: count.optional(),
  unlimited: z.boolean().optional(),
  reason: str.optional(),
  source,
});
export const sessionSchema = z.object({
  id: str,
  provider: z.enum(providers),
  project: str,
  projectKey: str.optional(),
  environment: str,
  model: str.optional(),
  startedAt: time.optional(),
  state,
  lifecycle: str.optional(),
  waitingReason: str.optional(),
  source,
  context: percentage.optional(),
  capacity: count.optional(),
  contextSource: source.optional(),
  effort: str.optional(),
});
export const tokensSchema = z.object({
  input: count.optional(),
  uncached: count.optional(),
  cacheRead: count.optional(),
  cacheWrite: count.optional(),
  output: count.optional(),
  reasoning: count.optional(),
  total: count.optional(),
});
export const usageSchema = z.object({
  id: str,
  sessionId: str,
  provider: z.enum(providers),
  project: str,
  projectKey: str.optional(),
  environment: str,
  model: str.optional(),
  tokens: tokensSchema,
  costUsd: z
    .string()
    .regex(/^\d{1,24}(\.\d{1,10})?$/)
    .optional(),
  source,
});
const accountUsageSchema = z.object({
  lifetimeTokens: count.optional(),
  peakDailyTokens: count.optional(),
  longestRunningTurnSec: count.optional(),
  currentStreakDays: count.optional(),
  longestStreakDays: count.optional(),
  days: z
    .array(
      z.object({ day: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), tokens: count }),
    )
    .max(400),
  source,
});
const financialDatum = z.object({
  label: str,
  amount: z.string().regex(/^\d{1,24}(\.\d{1,10})?$/),
  currency: z.literal("USD"),
  classification: z.enum([
    "prepaid-balance",
    "spend-cap",
    "provider-reported-usage-cost",
  ]),
  source,
});
export const connectionSchema = z.object({
  provider: z.enum(providers),
  environment: str,
  profile: str,
  version: str.optional(),
  installation: z.enum(["detected", "unverified", "missing"]),
  quota: availability,
  explanation: str,
  windows: z.array(windowSchema).max(128),
  history: availability,
  inventory: availability,
  lastSuccessAt: time.optional(),
  accountUsage: accountUsageSchema.optional(),
  resetCredits: z.object({ available: count, source }).optional(),
  finances: z.array(financialDatum).max(8).optional(),
  bridge: z.enum(["off", "on", "blocked"]).optional(),
});
export const snapshotSchema = z.object({
  version: z.literal(1),
  mode: z.enum(["live", "demo", "import"]),
  updatedAt: time.nullable(),
  scanning: z.boolean(),
  connections: z.array(connectionSchema).max(128),
  sessions: z.array(sessionSchema).max(1000),
  usage: z.array(usageSchema).max(10000),
  environments: z
    .array(z.object({ id: str, label: str, status: str }))
    .max(128),
  diagnostics: z.array(str).max(128),
});
export type Snapshot = z.infer<typeof snapshotSchema>;
export type Connection = z.infer<typeof connectionSchema>;
export type Session = z.infer<typeof sessionSchema>;
export type Usage = z.infer<typeof usageSchema>;
export type Source = z.infer<typeof source>;
export type QuotaWindow = z.infer<typeof windowSchema>;
export const empty = (mode: Snapshot["mode"] = "live"): Snapshot => ({
  version: 1,
  mode,
  scanning: mode === "live",
  updatedAt: null,
  connections: [],
  sessions: [],
  usage: [],
  environments: [],
  diagnostics: [],
});
export const remaining = (used: number | null) =>
  percentage.safeParse(used).success && used !== null ? 100 - used : null;
export const stale = (source: Source, now: number, ttl = 180_000) =>
  now - (source.observedAt ?? source.collectedAt) > ttl;
export const localDay = (timestamp: number) =>
  new Date(timestamp).toLocaleDateString("en-CA");
export function aggregate(
  usage: Usage[],
  field: "provider" | "model" | "project" | "environment" | "day",
) {
  const totals = new Map<string, number>();
  for (const row of usage) {
    if (row.tokens.total === undefined) continue;
    const key =
      field === "day"
        ? localDay(row.source.observedAt ?? row.source.collectedAt)
        : field === "project"
          ? (row.projectKey ?? row.project)
          : (row[field] ?? "Unknown");
    totals.set(key, (totals.get(key) ?? 0) + row.tokens.total);
  }
  return [...totals];
}
export interface MonitoringClient {
  getSnapshot(): Promise<Snapshot>;
  subscribe(listener: (snapshot: Snapshot) => void): () => void;
  refresh(): Promise<void>;
  bridge?(action: "preview" | "enable" | "disable"): Promise<string>;
}
