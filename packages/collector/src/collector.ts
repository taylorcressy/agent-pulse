import { EventEmitter } from "node:events";
import { stat, realpath } from "node:fs/promises";
import { hostname, homedir } from "node:os";
import { join } from "node:path";
import {
  empty,
  providers,
  state,
  type Connection,
  type Provider,
  type Session,
  type Snapshot,
} from "../../core/src/index";
import { telemetry } from "./bridge";
import { dataHome } from "./paths";
import { importedHelpers } from "./helper";
import { normalize } from "./history";
import {
  cancelProbes,
  clean,
  date,
  id,
  obj,
  parse,
  probe,
  readLines,
  walk,
} from "./io";
import {
  discover,
  home,
  metric,
  project,
  projectIdentity,
  readQuota,
  versions,
  type Installation,
} from "./providers";
import { linuxTerminals } from "./processes";
import { Store } from "./store";

type ProviderState = {
  installation: Awaited<ReturnType<typeof discover>>;
  nextDiscovery: number;
  nextQuota: number;
  nextAccountUsage?: number;
  lastResetTrigger?: number;
  failures: number;
  cursor: number;
  connection: Connection;
  registry: Session[];
};
const rootName = { claude: "projects", codex: "sessions", grok: "sessions" };
const allowed = {
  claude: (name: string) => name.endsWith(".jsonl"),
  codex: (name: string) =>
    name.startsWith("rollout-") && name.endsWith(".jsonl"),
  grok: (name: string) => name === "events.jsonl",
};
export class Collector extends EventEmitter {
  readonly store: Store;
  readonly environment = id("host", hostname(), homedir());
  snapshot: Snapshot = empty();
  private readonly rows: Map<Provider, ProviderState>;
  private running?: Promise<void>;
  private timer?: ReturnType<typeof setInterval>;
  private hostEnvironments: Snapshot["environments"];
  private lastEnvironmentRead = 0;
  private nextPrune = 0;
  private stopped = false;
  foreground = true;
  private helpers: Awaited<ReturnType<typeof importedHelpers>> = [];
  constructor(
    path = join(dataHome(), "metrics.sqlite"),
    private readonly quotasEnabled = true,
  ) {
    super();
    this.store = new Store(path);
    this.hostEnvironments = [
      {
        id: this.environment,
        label: "This computer",
        status: `${process.platform} · ${process.arch}`,
      },
    ];
    this.snapshot.environments = this.hostEnvironments;
    this.rows = new Map(
      providers.map((provider) => [
        provider,
        {
          installation: null,
          nextDiscovery: 0,
          nextQuota: 0,
          failures: 0,
          cursor: 0,
          registry: [],
          connection: {
            provider,
            environment: this.environment,
            profile: "Local profile",
            installation: "missing",
            quota: "unknown",
            explanation: "Discovering provider sources…",
            windows: [],
            history: "unknown",
            inventory: "unknown",
          },
        },
      ]),
    );
  }
  start() {
    this.stopped = false;
    void this.refresh().catch(() => {});
    this.timer = setInterval(() => void this.refresh().catch(() => {}), 15_000);
    this.timer.unref();
  }
  async stop() {
    this.stopped = true;
    clearInterval(this.timer);
    cancelProbes();
    await this.running?.catch(() => {});
    this.store.db.close();
  }
  refresh(force = false) {
    if (this.stopped) return Promise.resolve();
    if (this.running) return this.running;
    this.running = this.collect(force).finally(() => {
      this.running = undefined;
    });
    return this.running;
  }
  private async collect(force: boolean) {
    const now = Date.now();
    const environmentWork =
      now - this.lastEnvironmentRead > 300_000
        ? this.environments().then((rows) => {
            this.hostEnvironments = rows;
            this.lastEnvironmentRead = now;
          })
        : Promise.resolve();
    await Promise.allSettled(
      [...this.rows].map(async ([provider, row]) => {
        try {
          await this.collectProvider(provider, row, now, force);
        } catch {
          row.connection = {
            ...row.connection,
            history: "temporarily-unavailable",
            explanation: "A collection source could not be read.",
          };
        }
        this.publish(true);
      }),
    );
    await environmentWork;
    this.helpers = await importedHelpers(now);
    if (now >= this.nextPrune) {
      try {
        this.store.prune(now);
      } catch {
        /* Continue serving the existing cache. */
      }
      this.nextPrune = now + 86_400_000;
    }
    this.publish(false);
  }
  private publish(scanning: boolean) {
    const { sessions, usage } = this.store.recent();
    const merged = new Map(
      [...sessions, ...this.helpers.flatMap((row) => row.sessions)].map(
        (row) => [row.id, row],
      ),
    );
    for (const { registry } of this.rows.values()) {
      for (const row of registry) {
        const history = merged.get(row.id);
        merged.set(row.id, {
          ...history,
          ...row,
          model: row.model ?? history?.model,
          effort: row.effort ?? history?.effort,
        });
      }
    }
    const uniqueUsage = new Map(usage.map((row) => [row.id, row]));
    for (const helper of this.helpers)
      for (const row of helper.usage)
        if (!uniqueUsage.has(row.id)) uniqueUsage.set(row.id, row);
    this.snapshot = {
      version: 1,
      mode: "live",
      updatedAt: Date.now(),
      scanning,
      connections: [...this.rows.values()].map((row) => row.connection),
      sessions: [...merged.values()]
        .sort(
          (a, b) =>
            (b.source.observedAt ?? b.source.collectedAt) -
            (a.source.observedAt ?? a.source.collectedAt),
        )
        .slice(0, 500),
      usage: [...uniqueUsage.values()]
        .sort((a, b) => (b.source.observedAt ?? 0) - (a.source.observedAt ?? 0))
        .slice(0, 5000),
      environments: [
        ...this.hostEnvironments,
        ...this.helpers.map((row) => row.environment),
      ],
      diagnostics: [
        "Local history reflects a bounded sample of readable provider logs. Account-reported summaries appear separately.",
        "Historical sessions remain unattributed to current provider accounts.",
        ...(this.store.fallback
          ? ["Persistent cache unavailable. Using an in-memory cache."]
          : []),
      ],
    };
    this.emit("snapshot", this.snapshot);
  }
  private async environments() {
    const rows = this.hostEnvironments.slice(0, 1);
    if (process.platform !== "win32") return rows;
    try {
      const result = await probe(
        "wsl.exe",
        ["--list", "--running", "--quiet"],
        { timeout: 3000, encoding: "utf16le" },
      );
      if (typeof result === "string")
        for (const line of result
          .replace(/\0/g, "")
          .replace(/^\uFEFF+/, "")
          .split(/\r?\n/)
          .slice(0, 32)) {
          const label = clean(line.trim());
          if (label)
            rows.push({
              id: id("wsl", label),
              label: `WSL · ${label}`,
              status: "Running · in-distribution collector required",
            });
        }
    } catch {
      /* WSL not available */
    }
    return rows;
  }
  private async collectProvider(
    provider: Provider,
    row: ProviderState,
    now: number,
    force: boolean,
  ) {
    const root = join(home(provider), rootName[provider]);
    const work = this.history(provider, root, row, now);
    if (force || now >= row.nextDiscovery) {
      const discovered = await discover(provider);
      const prior = row.installation;
      if (
        typeof prior === "object" &&
        prior &&
        (typeof discovered !== "object" ||
          !discovered ||
          prior.file !== discovered.file ||
          prior.version !== discovered.version)
      ) {
        row.connection = {
          ...row.connection,
          windows: [],
          accountUsage: undefined,
          resetCredits: undefined,
          finances: undefined,
          lastSuccessAt: undefined,
        };
        row.nextQuota = 0;
      }
      row.installation = discovered;
      row.nextDiscovery = now + 300_000;
    }
    if (this.stopped) {
      await work;
      return;
    }
    const installed =
      row.installation && row.installation !== "unverified"
        ? row.installation
        : undefined;
    const inventoryWork =
      provider === "claude" && installed?.version === versions.claude
        ? this.registry(installed, now)
        : installed && provider !== "claude"
          ? linuxTerminals(provider, installed, this.environment, now)
          : Promise.resolve(null);
    const due = row.connection.windows
      .map((window) => window.resetsAt)
      .filter((at): at is number => at !== null && at <= now);
    const latestDue = due.length ? Math.max(...due) : undefined;
    const newReset =
      latestDue !== undefined && latestDue > (row.lastResetTrigger ?? 0);
    if (newReset) row.lastResetTrigger = latestDue;
    const includeAccountUsage =
      provider === "codex" && now >= (row.nextAccountUsage ?? 0);
    const quotaWork =
      this.quotasEnabled &&
      installed &&
      (force || newReset || now >= row.nextQuota)
        ? readQuota(provider, installed, includeAccountUsage)
        : Promise.resolve(null);
    const [history, registry, quota] = await Promise.all([
      work,
      inventoryWork,
      quotaWork,
    ]);
    row.registry = registry ?? [];
    let connection = {
      ...row.connection,
      history,
      inventory: registry ? ("available" as const) : history,
      version: installed?.version,
      installation: installed
        ? ("detected" as const)
        : row.installation === "unverified"
          ? ("unverified" as const)
          : ("missing" as const),
    };
    if (quota) {
      if (includeAccountUsage) row.nextAccountUsage = now + 900_000;
      row.failures =
        quota.quota === "temporarily-unavailable" ? row.failures + 1 : 0;
      row.nextQuota =
        now +
        (quota.quota === "auth-required"
          ? 900_000
          : Math.min(
              900_000,
              (this.foreground ? 90_000 : 300_000) * 2 ** row.failures,
            ));
      connection = {
        ...connection,
        ...quota,
        accountUsage:
          quota.accountUsage ??
          (quota.quota === "available" ||
          quota.quota === "temporarily-unavailable"
            ? connection.accountUsage
            : undefined),
        windows:
          quota.quota === "temporarily-unavailable"
            ? connection.windows
            : quota.windows,
        lastSuccessAt: quota.lastSuccessAt ?? connection.lastSuccessAt,
      };
    }
    if (!installed)
      connection = {
        ...connection,
        quota: "unknown",
        windows: [],
        explanation:
          row.installation === "unverified"
            ? "Executable candidate could not be verified. No provider commands were run."
            : "No recognized executable was discovered on this computer.",
      };
    if (provider === "claude") {
      const { windows, values } = await telemetry(now, this.environment);
      if (windows.length)
        connection = {
          ...connection,
          windows,
          quota: "available",
          lastSuccessAt: windows[0].source.observedAt ?? now,
          explanation:
            "Latest status-line allowance. Account identity is unverified.",
        };
      const historySessions = values.length ? this.store.recent().sessions : [];
      for (const value of values) {
        const historyRow = historySessions.find(
          (session) => session.id === value.key,
        );
        const existing = row.registry.find(
          (session) => session.id === value.key,
        );
        const session = existing ?? historyRow;
        if (session && now - value.at < 180_000) {
          const context = {
            context: value.context,
            capacity: value.capacity,
            contextSource: metric("Claude status line", now, value.at),
          };
          if (existing) Object.assign(existing, context);
          else row.registry.push({ ...session, ...context });
        }
      }
    }
    row.connection = connection;
  }
  private async history(
    provider: Provider,
    root: string,
    row: ProviderState,
    now: number,
  ): Promise<Connection["history"]> {
    try {
      const files = await walk(root, allowed[provider], 7, 900);
      const indexed = (
        await Promise.all(
          files.map(async (path) => ({
            path,
            mtime: (await stat(path).catch(() => null))?.mtimeMs ?? 0,
          })),
        )
      ).sort((a, b) => b.mtime - a.mtime);
      const hot = indexed.slice(0, 12);
      const cold = indexed.slice(12);
      const batch = [...hot, ...cold.slice(row.cursor, row.cursor + 20)];
      row.cursor = row.cursor + 20 >= cold.length ? 0 : row.cursor + 20;
      for (const { path } of batch) {
        try {
          const key = id(provider, await realpath(path), "parser-v2");
          const old = this.store.checkpoint(key);
          const { identity, offset, lines } = await readLines(path, old);
          if (
            !lines.length &&
            offset === old?.offset &&
            identity === old?.identity
          )
            continue;
          const previous =
            old?.identity === identity && offset >= old.offset
              ? obj(old.metadata)
              : {};
          const result = normalize(
            provider,
            this.environment,
            path,
            lines,
            previous,
            now,
          );
          this.store.write(
            key,
            identity,
            offset,
            result.metadata,
            result.session,
            result.events,
          );
        } catch {
          /* Other logs can still be collected */
        }
      }
      return files.length ? "available" : "unknown";
    } catch (error) {
      return (error as NodeJS.ErrnoException).code === "EACCES"
        ? "permission-denied"
        : "unknown";
    }
  }
  private async registry(installation: Installation, now: number) {
    try {
      const result = await probe(installation.file, ["agents", "--json"], {
        timeout: 3500,
        cwd: homedir(),
      });
      const rows = typeof result === "string" ? parse(result) : null;
      if (!Array.isArray(rows)) return null;
      return rows.slice(0, 200).flatMap((value) => {
        const r = obj(value);
        const session = clean(r.sessionId) ?? clean(r.id);
        if (!session) return [];
        const waiting =
          r.waitingFor === "permission prompt" ||
          r.waitingFor === "sandbox request"
            ? "waiting-for-approval"
            : r.waitingFor === "input needed"
              ? "waiting-for-input"
              : undefined;
        const mapping: Record<string, Session["state"]> = {
          busy: "working",
          idle: "idle",
          done: "completed",
          failed: "failed",
          stopped: "stopped",
          "waiting-for-input": "waiting-for-input",
          "waiting-for-approval": "waiting-for-approval",
          working: "running-activity-unknown",
          blocked: "unknown",
        };
        return [
          {
            id: id("claude", this.environment, session),
            provider: "claude" as const,
            environment: this.environment,
            project: project(r.cwd),
            ...projectIdentity(r.cwd, this.environment),
            startedAt: date(r.startedAt),
            lifecycle: clean(r.state),
            waitingReason: waiting ? clean(r.waitingFor) : undefined,
            state: state.parse(
              r.status === "waiting"
                ? (waiting ?? "unknown")
                : (mapping[String(r.status)] ??
                    mapping[String(r.state)] ??
                    "unknown"),
            ),
            source: metric(
              "Claude agents JSON registry",
              now,
              null,
              installation.version,
            ),
          },
        ];
      });
    } catch {
      return null;
    }
  }
}
