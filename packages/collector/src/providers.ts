import { access, realpath } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, delimiter, isAbsolute, join, sep } from "node:path";
import {
  type Connection,
  type Provider,
  type QuotaWindow,
  type Source,
  percentage,
} from "../../core/src/index";
import { clean, date, id, integer, obj, parse, probe } from "./io";

export const contracts = {
  claude: "Claude Code transcript",
  codex: "Codex rollout JSONL",
  grok: "Grok Build completed-turn events",
};
export const versions = { codex: "0.170.0", claude: "2.1.294", grok: "1.0.89" };
export function home(provider: Provider) {
  const configured =
    process.env[
      { codex: "CODEX_HOME", claude: "CLAUDE_CONFIG_DIR", grok: "GROK_HOME" }[
        provider
      ]
    ];
  return configured && isAbsolute(configured)
    ? configured
    : join(homedir(), "." + provider);
}
export function metric(
  contract: string,
  collectedAt: number,
  observedAt: number | null = null,
  version?: string,
  coverage: Source["coverage"] = "local-observed",
): Source {
  return {
    contract,
    collectedAt,
    observedAt,
    version,
    coverage,
    quality: "reported",
  };
}
export type Installation = { file: string; version: string };
export async function discover(
  provider: Provider,
): Promise<Installation | "unverified" | null> {
  const exe = provider + (process.platform === "win32" ? ".exe" : "");
  const user = homedir();
  const paths = [
    ...(process.env.PATH ?? "").split(delimiter),
    join(user, ".local", "bin"),
    join(home(provider), "bin"),
    "/opt/homebrew/bin",
    "/usr/local/bin",
    join(user, "scoop", "shims"),
  ]
    .filter(isAbsolute)
    .slice(0, 80);
  const candidates = paths.map((path) => join(path, exe));
  if (provider === "claude")
    candidates.push(
      join(user, ".local", "share", "claude", "versions", versions.claude),
    );
  let unfamiliar = false;
  for (const path of new Set(candidates)) {
    try {
      await access(path);
      const file = await realpath(path);
      const normalized = file.split(sep).join("/");
      const recognized =
        provider === "grok"
          ? /\/\.grok\/downloads\/grok-[\w.-]+$/.test(normalized)
          : provider === "claude"
            ? /\/\.local\/share\/claude\/versions\/[\d.]+(?:\.exe)?$|\/node_modules\/@anthropic-ai\/claude-code\//.test(
                normalized,
              )
            : /\/\.codex\/packages\/standalone\/releases\/.+\/bin\/codex(?:\.exe)?$|\/node_modules\/@openai\/codex\/|\/Cellar\/codex\//.test(
                normalized,
              );
      if (!recognized) {
        unfamiliar = true;
        continue;
      }
      const output = await probe(
        file,
        provider === "grok" ? ["--no-auto-update", "--version"] : ["--version"],
        { timeout: 2500 },
      );
      const pattern = {
        codex: /^codex-cli ([\d.]+(?:-[\w.]+)?)/,
        claude: /^([\d.]+) \(Claude Code\)/,
        grok: /^grok ([\d.]+) \([a-f0-9]+\) \[stable\]/,
      }[provider];
      const version =
        typeof output === "string"
          ? pattern.exec(output.trim())?.[1]
          : undefined;
      if (version) return { file, version };
      unfamiliar = true;
    } catch {
      /* Missing or unavailable candidate */
    }
  }
  return unfamiliar ? "unverified" : null;
}

function rpc(
  file: string,
  args: string[],
  requests: { method: string; params?: unknown; optional?: boolean }[],
  codex = false,
) {
  let index = 0;
  const results: Record<string, unknown>[] = [];
  return probe<Record<string, unknown>[]>(file, args, {
    cwd: homedir(),
    timeout: 7000,
    exchange(line, send, done) {
      if (!line) {
        send({
          id: 1,
          method: "initialize",
          ...(codex ? {} : { jsonrpc: "2.0" }),
          params: codex
            ? { clientInfo: { name: "agentpulse", version: "0.1.0" } }
            : {
                protocolVersion: 1,
                clientCapabilities: {
                  fs: { readTextFile: false, writeTextFile: false },
                  terminal: false,
                },
                clientInfo: { name: "agentpulse", version: "0.1.0" },
              },
        });
        return;
      }
      const response = obj(parse(line));
      if (response.method === "account/updated" && index >= 2)
        throw new Error("Account changed during collection");
      if (response.id !== index + 1) return;
      if (response.error) {
        if (requests[index - 1]?.optional) {
          done(results);
          return;
        }
        throw new Error("RPC unavailable");
      }
      if (index === 0 && codex) send({ method: "initialized" });
      if (index > 0) results.push(obj(response.result));
      if (codex && index === 1 && obj(results[0].account).type !== "chatgpt") {
        done(results);
        return;
      }
      if (index === requests.length) {
        done(results);
        return;
      }
      send({
        method: requests[index].method,
        params: requests[index].params,
        id: ++index + 1,
        ...(codex ? {} : { jsonrpc: "2.0" }),
      });
    },
  }).catch((error: Error) => {
    if (requests[index - 1]?.optional && error.message === "Probe timed out")
      return results;
    throw error;
  });
}
export function quotaWindow(
  bucket: string,
  label: string,
  used: unknown,
  reset: unknown,
  source: Source,
  minutes?: number,
): QuotaWindow {
  return {
    id: bucket,
    label,
    used: percentage.safeParse(used).data ?? null,
    resetsAt: date(reset) ?? null,
    source,
    minutes,
  };
}
export function codexWindows(value: unknown, source: Source) {
  const result = obj(value);
  const multi = Object.entries(obj(result.rateLimitsByLimitId));
  const buckets = multi.length
    ? multi
    : [["codex", result.rateLimits] as const];
  return buckets.slice(0, 64).flatMap(([key, data]) => {
    const bucket = obj(data);
    const label =
      clean(bucket.limitName) ?? clean(bucket.limitId) ?? clean(key) ?? "Codex";
    return (["primary", "secondary"] as const).flatMap((kind) => {
      const win = obj(bucket[kind]);
      if (!Object.keys(win).length) return [];
      const minutes = integer(win.windowDurationMins);
      const duration =
        minutes === undefined
          ? kind
          : minutes % 1440 === 0
            ? `${minutes / 1440}d`
            : minutes % 60 === 0
              ? `${minutes / 60}h`
              : `${minutes}m`;
      return [
        {
          ...quotaWindow(
            id(key, kind),
            `${label} · ${duration}`,
            win.usedPercent,
            win.resetsAt,
            source,
            minutes,
          ),
          reason: clean(bucket.rateLimitReachedType),
        },
      ];
    });
  });
}
export function grokWindows(value: unknown, source: Source) {
  const config = obj(obj(value).config);
  if (!Object.keys(config).length) return [];
  const period = obj(config.currentPeriod);
  const label = clean(period.type)
    ?.replace("USAGE_PERIOD_TYPE_", "")
    .toLowerCase();
  const limit = integer(obj(config.monthlyLimit).val);
  const used = integer(obj(config.used).val);
  const percent =
    config.creditUsagePercent ??
    (limit && used !== undefined ? (used / limit) * 100 : undefined);
  if (percent === undefined && !Object.keys(period).length) return [];
  return [
    {
      ...quotaWindow(
        "included",
        label ? `Included · ${label}` : "Included credits",
        percent,
        period.end ?? config.billingPeriodEnd,
        source,
      ),
      startsAt: date(period.start ?? config.billingPeriodStart),
    },
  ];
}
export function codexUsage(
  value: unknown,
  source: Source,
): Connection["accountUsage"] {
  const account = obj(value),
    summary = obj(account.summary);
  const days = Array.isArray(account.dailyUsageBuckets)
    ? account.dailyUsageBuckets.slice(0, 400).flatMap((entry) => {
        const row = obj(entry),
          tokens = integer(row.tokens);
        return typeof row.startDate === "string" &&
          /^\d{4}-\d{2}-\d{2}$/.test(row.startDate) &&
          tokens !== undefined
          ? [{ day: row.startDate, tokens }]
          : [];
      })
    : [];
  const totals = {
    lifetimeTokens: integer(summary.lifetimeTokens),
    peakDailyTokens: integer(summary.peakDailyTokens),
    longestRunningTurnSec: integer(summary.longestRunningTurnSec),
    currentStreakDays: integer(summary.currentStreakDays),
    longestStreakDays: integer(summary.longestStreakDays),
  };
  if (days.length || Object.values(totals).some((value) => value !== undefined))
    return { ...totals, days, source };
}

export function grokFinances(
  value: unknown,
  source: Source,
): Connection["finances"] {
  const config = obj(obj(value).config);
  const fields = [
    ["prepaidBalance", "Prepaid balance", "prepaid-balance"],
    ["onDemandCap", "On-demand spend cap", "spend-cap"],
    ["onDemandUsed", "On-demand usage cost", "provider-reported-usage-cost"],
  ] as const;
  const rows = fields.flatMap(([key, label, classification]) => {
    if (
      config[key] === null ||
      typeof config[key] !== "object" ||
      Array.isArray(config[key])
    )
      return [];
    const cents = integer(obj(config[key]).val ?? 0);
    if (cents === undefined) return [];
    const exact = BigInt(cents);
    return [
      {
        label,
        amount: `${exact / 100n}.${String(exact % 100n).padStart(2, "0")}`,
        currency: "USD" as const,
        classification,
        source,
      },
    ];
  });
  if (rows.length) return rows;
}

export async function readQuota(
  provider: Provider,
  installation: Installation,
  includeAccountUsage = false,
): Promise<
  Pick<
    Connection,
    | "windows"
    | "quota"
    | "explanation"
    | "lastSuccessAt"
    | "accountUsage"
    | "resetCredits"
    | "finances"
  >
> {
  if (provider === "claude")
    return {
      windows: [],
      quota: "needs-integration",
      explanation:
        "Enable the optional Claude status-line bridge for live allowance.",
    };
  if (installation.version !== versions[provider])
    return {
      windows: [],
      quota: "unsupported",
      explanation:
        "The live quota probe has no verified contract for this version.",
    };
  try {
    if (provider === "grok" && process.env.AGENTPULSE_GROK_ACP !== "1")
      return {
        windows: [],
        quota: "needs-integration",
        explanation:
          "The optional Grok ACP read is disabled until its background-service behavior is verified.",
      };
    const results =
      provider === "codex"
        ? await rpc(
            installation.file,
            [
              "-s",
              "read-only",
              "-a",
              "never",
              "-c",
              "analytics.enabled=false",
              "app-server",
              "--listen",
              "stdio://",
            ],
            [
              { method: "account/read", params: { refreshToken: false } },
              { method: "account/rateLimits/read" },
              ...(includeAccountUsage
                ? [{ method: "account/usage/read", optional: true }]
                : []),
            ],
            true,
          )
        : await rpc(
            installation.file,
            ["--no-auto-update", "agent", "stdio"],
            [{ method: "_x.ai/billing", params: {} }],
          );
    if (typeof results === "string") throw new Error("Unexpected output");
    if (provider === "codex" && results.length < 2) {
      return {
        windows: [],
        quota: results[0]?.account ? "unsupported" : "auth-required",
        explanation: results[0]?.account
          ? "This authentication mode does not expose ChatGPT quota."
          : "Sign in with the Codex CLI to read account allowance.",
      };
    }
    const now = Date.now();
    const source = metric(
      provider === "codex"
        ? "Codex app-server account/rateLimits/read"
        : "Grok ACP billing read",
      now,
      null,
      installation.version,
      "account-reported",
    );
    const windows =
      provider === "codex"
        ? codexWindows(results[1], source)
        : grokWindows(results[0], source);
    const resetCount =
      provider === "codex"
        ? integer(obj(results[1].rateLimitResetCredits).availableCount)
        : undefined;
    return {
      windows,
      accountUsage:
        provider === "codex"
          ? codexUsage(results[2], {
              ...source,
              contract: "Codex app-server account/usage/read",
            })
          : undefined,
      resetCredits:
        resetCount === undefined
          ? undefined
          : { available: resetCount, source },
      finances:
        provider === "grok" ? grokFinances(results[0], source) : undefined,
      quota: windows.length ? "available" : "unknown",
      explanation: windows.length
        ? "Allowance reported by the provider."
        : "The provider returned no supported allowance window.",
      lastSuccessAt: now,
    };
  } catch (error) {
    if ((error as Error).message === "Account changed during collection")
      return {
        windows: [],
        quota: "unknown",
        explanation:
          "The provider account changed during collection. Refresh to read the current allowance.",
      };
    return {
      windows: [],
      quota: "temporarily-unavailable",
      explanation: "The read-only provider probe failed or timed out.",
    };
  }
}
export const project = (path: unknown) => {
  const safe = clean(path);
  return safe
    ? basename(safe.replaceAll("\\", "/")) || "Unknown project"
    : "Unknown project";
};

export function projectIdentity(value: unknown, environment: string) {
  if (typeof value !== "string" || !value || value.length > 2048) return {};
  const path = value.replaceAll("\\", "/").replace(/\/+$|\/\.$/g, "") || "/";
  return {
    project: project(path),
    projectKey: id(
      "project",
      environment,
      process.platform === "win32" ? path.toLowerCase() : path,
    ),
  };
}
