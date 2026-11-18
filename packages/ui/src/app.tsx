import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
} from "react";
import {
  Activity,
  ArrowRight,
  BarChart3,
  CalendarDays,
  ChevronRight,
  Code2,
  Command,
  Download,
  House,
  Layers3,
  Moon,
  Plug,
  RefreshCw,
  Settings2,
  Sparkles,
  Sun,
  Terminal,
  Upload,
  X,
} from "lucide-react";
import {
  aggregate,
  localDay,
  names,
  remaining,
  snapshotSchema,
  stale,
  type Connection,
  type MonitoringClient,
  type Provider,
  type QuotaWindow,
  type Session,
  type Snapshot,
  type Usage,
} from "../../core/src/index";

const nav = [
  { name: "Overview", icon: House },
  { name: "Sessions", icon: Terminal },
  { name: "Usage", icon: BarChart3 },
  { name: "Connections", icon: Plug },
] as const;
type Page = (typeof nav)[number]["name"];
const labels: Record<string, string> = {
  working: "Working",
  idle: "Idle",
  "waiting-for-input": "Waiting for input",
  "waiting-for-approval": "Waiting for approval",
  "recently-active": "Recent activity",
  "running-activity-unknown": "Running, activity unknown",
  completed: "Completed",
  failed: "Failed",
  stopped: "Stopped",
  unknown: "Unknown",
};
const number = new Intl.NumberFormat("en", {
  notation: "compact",
  maximumFractionDigits: 1,
});
const exact = new Intl.NumberFormat("en");
const stamp = (time: number, zone = "system") =>
  new Date(time).toLocaleString(
    undefined,
    zone === "UTC" ? { timeZone: "UTC", timeZoneName: "short" } : undefined,
  );
const costScale = 10_000_000_000n;
function exactUsd(values: string[]) {
  const ticks = values.reduce((sum, value) => {
    const [whole, decimals = ""] = value.split(".");
    return sum + BigInt(whole) * costScale + BigInt(decimals.padEnd(10, "0"));
  }, 0n);
  const decimals = String(ticks % costScale)
    .padStart(10, "0")
    .replace(/0+$/, "")
    .padEnd(2, "0");
  return `$${ticks / costScale}.${decimals}`;
}
const short = (time: number) =>
  new Date(time).toLocaleDateString(undefined, { weekday: "short" });
const format = (n: number | undefined) =>
  n === undefined ? "—" : exact.format(n);
const describe = (value: string) => value.replaceAll("-", " ");
function duration(timestamp: number, now: number) {
  const mins = Math.max(1, Math.ceil((timestamp - now) / 60000));
  return timestamp <= now
    ? "Refresh due"
    : mins >= 1440
      ? `${Math.floor(mins / 1440)}d ${Math.floor((mins % 1440) / 60)}h`
      : mins >= 60
        ? `${Math.floor(mins / 60)}h ${mins % 60}m`
        : `${mins}m`;
}
function Glyph({ provider }: { provider: Provider }) {
  const Icon =
    provider === "claude" ? Sparkles : provider === "grok" ? X : Command;
  return (
    <span className={`glyph ${provider}`}>
      <Icon size={24} strokeWidth={2.15} />
    </span>
  );
}
function SessionStatus({ session }: { session: Session }) {
  return (
    <span className={`state ${session.state}`}>
      <i />
      {labels[session.state]}
    </span>
  );
}
function Quota({
  window,
  now,
  zone,
  unavailable,
}: {
  window: QuotaWindow;
  now: number;
  zone: string;
  unavailable: boolean;
}) {
  const value = remaining(window.used);
  const isStale =
    unavailable ||
    stale(window.source, now) ||
    (window.resetsAt !== null && window.resetsAt <= now);
  return (
    <div className="quota-row">
      <div className="quota-meta">
        <span>{window.label}</span>
        <strong>
          {window.unlimited
            ? "Unlimited"
            : value === null
              ? "Unknown"
              : `${Math.round(value * 10) / 10}% left`}
        </strong>
      </div>
      {value !== null && (
        <progress
          max={100}
          value={value}
          aria-label={window.label + " remaining"}
        />
      )}
      <div className="quota-footer">
        <span>
          {isStale
            ? "Stale allowance"
            : window.reason
              ? describe(window.reason)
              : "Remaining allowance"}
        </span>
        {window.resetsAt !== null ? (
          <time
            title={stamp(window.resetsAt, zone)}
            dateTime={new Date(window.resetsAt).toISOString()}
          >
            {duration(window.resetsAt, now)}
          </time>
        ) : (
          <span>Reset unknown</span>
        )}
      </div>
    </div>
  );
}
function Trend({
  usage,
  days,
  now,
}: {
  usage: Usage[];
  days: number;
  now: number;
}) {
  const range = Array.from({ length: days }, (_, i) => {
    const d = new Date(now);
    d.setDate(d.getDate() - (days - i - 1));
    return d.getTime();
  });
  const totals = new Map(aggregate(usage, "day"));
  const vals = range.map((day) => totals.get(localDay(day)));
  if (vals.every((value) => value === undefined))
    return (
      <div className="chart-empty">
        <Activity size={26} />
        <p>No observed usage for this period.</p>
      </div>
    );
  const maximum = Math.max(1, ...vals.map((v) => v ?? 0));
  const gridMax =
    Math.ceil(maximum / Math.pow(10, Math.floor(Math.log10(maximum)))) *
    Math.pow(10, Math.floor(Math.log10(maximum)));
  const x = (i: number) => 59 + (i / (days - 1)) * 463;
  const y = (n: number) => 206 - (n / gridMax) * 169;
  const segments: { x: number; y: number; value: number; date: number }[][] =
    [];
  let segment: (typeof segments)[number] = [];
  vals.forEach((value, i) => {
    if (value === undefined) {
      if (segment.length) segments.push(segment);
      segment = [];
      return;
    }
    segment.push({ x: x(i), y: y(value), value, date: range[i] });
  });
  if (segment.length) segments.push(segment);
  return (
    <svg
      className="trend"
      viewBox="0 0 540 240"
      role="img"
      aria-label={`Observed token activity across the last ${days} days. Missing days appear as gaps.`}
    >
      <defs>
        <linearGradient id="trend-fill" x1="0" x2="0" y1="0" y2="1">
          <stop stopColor="#46a7ff" stopOpacity=".38" />
          <stop offset="1" stopColor="#46a7ff" stopOpacity=".02" />
        </linearGradient>
      </defs>
      {[0, 1, 2, 3, 4].map((i) => (
        <g key={i}>
          <line
            x1="59"
            x2="522"
            y1={y((gridMax * i) / 4)}
            y2={y((gridMax * i) / 4)}
          />
          <text x="49" y={y((gridMax * i) / 4) + 4} textAnchor="end">
            {number.format((gridMax * i) / 4)}
          </text>
        </g>
      ))}
      {segments.map((points, index) => {
        const path = points
          .map((p, i) => `${i ? "L" : "M"}${p.x},${p.y}`)
          .join(" ");
        return (
          <g key={index}>
            <path
              fill="url(#trend-fill)"
              d={`${path} L${points.at(-1)!.x},206 L${points[0].x},206 Z`}
            />
            <path
              fill="none"
              d={path}
              stroke="#47aaff"
              strokeWidth="3"
              strokeLinejoin="round"
            />
            {points.map((p, i) => (
              <circle
                key={i}
                cx={p.x}
                cy={p.y}
                r={i === points.length - 1 ? 5 : 2.8}
                fill="#55b4ff"
              >
                <title>
                  {stamp(p.date).split(",")[0]} · {format(p.value)} tokens
                </title>
              </circle>
            ))}
          </g>
        );
      })}
      {range.map(
        (day, i) =>
          (days === 7 || i % 7 === 0 || i === days - 1) && (
            <text x={x(i)} y="231" textAnchor="middle" key={day}>
              {days === 7 ? short(day) : new Date(day).getDate()}
            </text>
          ),
      )}
    </svg>
  );
}
function Modal({
  title,
  children,
  close,
}: {
  title: string;
  children: ReactNode;
  close: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    ref.current?.showModal();
  }, []);
  return (
    <dialog ref={ref} onCancel={close} className="drawer">
      <div className="drawer-title">
        <h2>{title}</h2>
        <button className="icon" aria-label="Close details" onClick={close}>
          <X size={20} />
        </button>
      </div>
      {children}
    </dialog>
  );
}
function SessionList({
  sessions,
  snapshot,
  now,
  detail,
}: {
  sessions: Session[];
  snapshot: Snapshot;
  now: number;
  detail: (row: Session) => void;
}) {
  return sessions.length ? (
    <div className="session-list">
      {sessions.map((row) => {
        const when = row.source.observedAt ?? row.source.collectedAt;
        const environment =
          snapshot.environments.find((env) => env.id === row.environment)
            ?.label ?? row.environment;
        return (
          <button
            className="session-row"
            key={row.id}
            onClick={() => detail(row)}
          >
            <Glyph provider={row.provider} />
            <span className="session-name">
              <strong>{row.project}</strong>
              <small>
                {names[row.provider]}
                {row.model ? ` · ${row.model}` : ""}
              </small>
            </span>
            <SessionStatus session={row} />
            <span className="session-environment">{environment}</span>
            <span className="session-context">
              {row.context === undefined
                ? "Context unknown"
                : `${row.context}% context`}
            </span>
            <time title={stamp(when)}>
              {now - when < 60000
                ? "Just now"
                : duration(now + (now - when), now) + " ago"}
            </time>
            <ChevronRight className="session-arrow" size={16} />
          </button>
        );
      })}
    </div>
  ) : (
    <p className="empty">No sessions match this view.</p>
  );
}
export function App({
  client,
  initial,
  pair,
}: {
  client: MonitoringClient;
  initial: Snapshot;
  pair?: (code: string) => Promise<void>;
}) {
  const [snapshot, setSnapshot] = useState(initial);
  const [page, setPage] = useState<Page>("Overview");
  const [now, setNow] = useState(Date.now());
  const [error, setError] = useState("");
  const [needsPair, setNeedsPair] = useState(false);
  const [alerts, setAlerts] = useState(
    () => localStorage.getItem("agentpulse-alerts") === "1",
  );
  const [notice, setNotice] = useState("");
  const seenAlerts = useRef(new Set<string>());
  const [offline, setOffline] = useState(false);
  const [pairCode, setPairCode] = useState("");
  const [status, setStatus] = useState("");
  const [days, setDays] = useState(7);
  const [filter, setFilter] = useState("all");
  const [query, setQuery] = useState("");
  const [group, setGroup] = useState<
    "provider" | "model" | "project" | "environment" | "day"
  >("provider");
  const [details, setDetails] = useState<Session>();
  const [selectedConnection, setConnection] = useState<Connection>();
  const connection = selectedConnection
    ? snapshot.connections.find(
        (row) =>
          row.provider === selectedConnection.provider &&
          row.environment === selectedConnection.environment,
      )
    : undefined;
  const [exporting, setExporting] = useState(false);
  const [bridgePreview, setBridgePreview] = useState("");
  const [theme, setTheme] = useState(
    () => localStorage.getItem("agentpulse-theme") ?? "dark",
  );
  const [zone, setZone] = useState(() =>
    localStorage.getItem("agentpulse-zone") === "UTC" ? "UTC" : "system",
  );
  const [revision, setRevision] = useState(0);
  const [imported, setImported] = useState(false);
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem("agentpulse-theme", theme);
  }, [theme]);
  useEffect(() => {
    localStorage.setItem("agentpulse-zone", zone);
  }, [zone]);
  useEffect(() => {
    localStorage.setItem("agentpulse-alerts", alerts ? "1" : "0");
    if (!alerts || snapshot.mode !== "live" || offline) {
      setNotice("");
      return;
    }
    const next: string[] = [];
    for (const row of snapshot.connections)
      for (const window of row.windows) {
        if (window.resetsAt === null || window.unlimited) continue;
        const due = window.resetsAt <= now;
        const low =
          window.used !== null &&
          window.used >= 90 &&
          row.quota === "available" &&
          !stale(window.source, now);
        if (!due && !low) continue;
        const key = [
          row.provider,
          row.environment,
          window.id,
          window.resetsAt,
          due ? "reset" : "low",
        ].join(":");
        if (seenAlerts.current.has(key)) continue;
        if (seenAlerts.current.size >= 1000)
          seenAlerts.current.delete(
            seenAlerts.current.values().next().value ?? "",
          );
        seenAlerts.current.add(key);
        next.push(
          `${names[row.provider]} ${window.label}: ${due ? "reset due" : "10% or less remaining"}`,
        );
      }
    if (next.length) setNotice(next.join(" · "));
  }, [alerts, snapshot, now, offline]);
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 15000);
    return () => clearInterval(timer);
  }, []);
  useEffect(() => {
    if (imported) return;
    let active = true;
    let unsubscribe: undefined | (() => void);
    const disconnect = () => {
      if (active) {
        setSnapshot(initial);
        setNeedsPair(true);
      }
    };
    const markOffline = () => {
      if (active) setOffline(true);
    };
    const receive = (value: Snapshot) => {
      setSnapshot(value);
      setOffline(false);
    };
    window.addEventListener("agentpulse-disconnected", disconnect);
    window.addEventListener("agentpulse-offline", markOffline);
    void client
      .getSnapshot()
      .then((value) => {
        if (!active) return;
        receive(value);
        setNeedsPair(false);
        unsubscribe = client.subscribe(receive);
      })
      .catch((err) => {
        if (active) {
          setNeedsPair(Boolean(pair && err.message === "Pair this browser"));
          if (err.message !== "Pair this browser")
            setError("The local companion is unavailable.");
        }
      });
    return () => {
      active = false;
      unsubscribe?.();
      window.removeEventListener("agentpulse-disconnected", disconnect);
      window.removeEventListener("agentpulse-offline", markOffline);
    };
  }, [client, initial, pair, revision, imported]);
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!pair) return;
    try {
      await pair(pairCode.trim());
      setPairCode("");
      setError("");
      setRevision((i) => i + 1);
    } catch (err) {
      setError((err as Error).message);
    }
  }
  async function refresh() {
    if (imported || snapshot.mode === "demo") return;
    try {
      await client.refresh();
      setStatus("Refresh requested");
    } catch {
      setError("The companion could not refresh.");
      setRevision((i) => i + 1);
    }
  }
  async function importSnapshot(file: File | undefined) {
    if (!file) return;
    try {
      if (file.size > 15 * 1024 * 1024) throw new Error("large");
      const value = snapshotSchema.parse(JSON.parse(await file.text()));
      setImported(true);
      setSnapshot({ ...value, mode: "import", scanning: false });
      setNeedsPair(false);
      setError("");
      setPage("Overview");
    } catch {
      setError("Choose a valid AgentPulse export under 15 MB.");
    }
  }
  const usage = useMemo(
    () =>
      snapshot.usage.filter((row) => {
        const at = row.source.observedAt ?? row.source.collectedAt;
        const cutoff = new Date(now);
        cutoff.setDate(cutoff.getDate() - days + 1);
        cutoff.setHours(0, 0, 0, 0);
        return (
          at >= cutoff.getTime() &&
          at <= now + 60000 &&
          (page !== "Usage" || filter === "all" || row.provider === filter)
        );
      }),
    [snapshot, now, days, page, filter],
  );
  const observedSessions = snapshot.sessions.map((row) =>
    snapshot.mode === "live" &&
    (row.state === "working" ||
      row.state === "running-activity-unknown" ||
      row.state === "waiting-for-input" ||
      row.state === "waiting-for-approval" ||
      row.state === "idle") &&
    stale(row.source, now, 60000)
      ? { ...row, state: "unknown" as const }
      : row,
  );
  const detailUsage = details
    ? snapshot.usage.filter((row) => row.sessionId === details.id)
    : [];
  const detailCosts = detailUsage.flatMap((row) =>
    row.costUsd === undefined ? [] : [row.costUsd],
  );
  const filtered = observedSessions.filter(
    (row) =>
      (filter === "all" || row.provider === filter) &&
      [row.project, row.model, names[row.provider], labels[row.state]].some(
        (value) => value?.toLowerCase().includes(query.toLowerCase()),
      ),
  );
  const validResets = snapshot.connections
    .flatMap((row) => row.windows.map((win) => win.resetsAt))
    .filter((at): at is number => at !== null);
  const nextReset = validResets.length ? Math.min(...validResets) : null;
  const total = usage.reduce((sum, row) => sum + (row.tokens.total ?? 0), 0);
  const active = observedSessions.filter((row) =>
    [
      "working",
      "idle",
      "waiting-for-input",
      "waiting-for-approval",
      "running-activity-unknown",
    ].includes(row.state),
  ).length;
  const projects = new Map(
    usage.map((row) => [row.projectKey ?? row.project, row.project]),
  );
  const projectCounts = new Map<string, number>();
  for (const label of projects.values())
    projectCounts.set(label, (projectCounts.get(label) ?? 0) + 1);
  const projectLabel = (key: string) => {
    const label = projects.get(key) ?? key;
    return (projectCounts.get(label) ?? 0) > 1
      ? `${label} · ${key.slice(0, 6)}`
      : label;
  };
  const attention = snapshot.connections.filter(
    (row) =>
      row.quota !== "available" ||
      row.windows.some(
        (win) =>
          stale(win.source, now) ||
          (win.resetsAt !== null && win.resetsAt <= now),
      ),
  );
  const navigate = (value: Page) => {
    setPage(value);
    setFilter("all");
    setQuery("");
  };
  function download() {
    const url = URL.createObjectURL(
      new Blob([JSON.stringify(snapshot, null, 2)], {
        type: "application/json",
      }),
    );
    const a = document.createElement("a");
    a.href = url;
    a.download = "agentpulse-snapshot.json";
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    setExporting(false);
  }
  const filterMenu = (
    <select
      aria-label="Provider"
      value={filter}
      onChange={(event) => setFilter(event.target.value)}
    >
      <option value="all">All providers</option>
      {Object.entries(names).map(([key, name]) => (
        <option key={key} value={key}>
          {name}
        </option>
      ))}
    </select>
  );
  const period = (
    <select
      aria-label="Time range"
      value={days}
      onChange={(event) => setDays(Number(event.target.value))}
    >
      <option value={7}>Last 7 days</option>
      <option value={30}>Last 30 days</option>
    </select>
  );
  const subtitle = {
    Overview: "Monitor usage, limits, and activity across your coding agents.",
    Sessions: "Review active and recently observed coding sessions.",
    Usage: "Explore locally observed token usage across providers.",
    Connections:
      "Review installations, telemetry sources, and local environments.",
  };
  return (
    <div className="shell">
      <a className="skip" href="#main">
        Skip to content
      </a>
      <aside className="rail">
        <div className="wordmark">
          <Activity size={31} />
          <strong>
            Agent<span>Pulse</span>
          </strong>
        </div>
        <nav aria-label="Main navigation">
          {nav.map(({ name, icon: Icon }) => (
            <button
              aria-current={page === name ? "page" : undefined}
              key={name}
              onClick={() => navigate(name)}
            >
              <Icon size={20} />
              <span>{name}</span>
            </button>
          ))}
        </nav>
        <div className="rail-footer">
          <span className="state">
            <i />
            {snapshot.mode === "demo"
              ? "Demo mode"
              : snapshot.mode === "import"
                ? "Offline import"
                : needsPair
                  ? "Pairing required"
                  : "Local monitoring"}
          </span>
        </div>
      </aside>
      <main id="main">
        <div className="topbar">
          <div className="breadcrumb">
            Command center <ChevronRight size={13} /> <span>{page}</span>
          </div>
          <div className="top-actions">
            <button
              className="icon"
              title="Switch theme"
              aria-label="Switch theme"
              onClick={() =>
                setTheme(
                  theme === "dark"
                    ? "light"
                    : theme === "light"
                      ? "system"
                      : "dark",
                )
              }
            >
              {theme === "dark" ? (
                <Moon size={17} />
              ) : theme === "light" ? (
                <Sun size={17} />
              ) : (
                <Settings2 size={17} />
              )}
            </button>
            <button
              className="icon"
              title="Export preview"
              aria-label="Export preview"
              onClick={() => setExporting(true)}
            >
              <Download size={17} />
            </button>
          </div>
        </div>
        <div className="content">
          <header className="page-header">
            <div>
              <h1>{page === "Overview" ? "Your AI coding agents" : page}</h1>
              <p>{subtitle[page]}</p>
            </div>
            {snapshot.mode === "live" && !needsPair && (
              <button className="refresh" onClick={() => void refresh()}>
                <RefreshCw size={17} />
                {snapshot.scanning
                  ? "Discovering agents…"
                  : snapshot.updatedAt
                    ? "Refresh data"
                    : "Refresh"}
              </button>
            )}
          </header>
          <span className="sr-only" role="status">
            {status}
          </span>
          {snapshot.mode !== "live" && (
            <div className="banner">
              <span className="badge">
                {snapshot.mode === "demo" ? "Demo data" : "Offline import"}
              </span>
              {snapshot.mode === "demo"
                ? "Synthetic sessions and allowance for exploring AgentPulse."
                : "Snapshot data from a saved export."}
            </div>
          )}
          {error && (
            <p className="banner" role="alert">
              {error}
            </p>
          )}
          {offline && !needsPair && !imported && (
            <p className="banner" role="status">
              Companion disconnected. Showing the last snapshot.
            </p>
          )}
          {notice && !needsPair && (
            <div className="banner" role="status">
              {notice}
              <button onClick={() => setNotice("")}>Dismiss</button>
            </div>
          )}
          {needsPair ? (
            <section className="panel pairing">
              <h2>Pair this browser</h2>
              <p>
                Open the one-time pairing code file shown by the local
                companion.
              </p>
              <form onSubmit={submit}>
                <label htmlFor="pair-code">Pairing code</label>
                <input
                  autoComplete="off"
                  id="pair-code"
                  value={pairCode}
                  onChange={(event) => setPairCode(event.target.value)}
                  required
                />
                <button className="primary">Pair browser</button>
              </form>
              <label className="upload">
                <Upload size={16} /> Import an offline snapshot
                <input
                  type="file"
                  accept="application/json,.json"
                  onChange={(event) =>
                    void importSnapshot(event.target.files?.[0])
                  }
                />
              </label>
            </section>
          ) : (
            <>
              {page === "Overview" && (
                <>
                  <div className="summary">
                    {[
                      {
                        icon: Code2,
                        value: snapshot.updatedAt ? String(active) : "—",
                        label: "Live sessions",
                        note: "Observed running activity",
                      },
                      {
                        icon: Layers3,
                        value: usage.some(
                          (row) => row.tokens.total !== undefined,
                        )
                          ? number.format(total)
                          : "—",
                        label: "Observed tokens",
                        note: `Last ${days} days`,
                      },
                      {
                        icon: Activity,
                        value: snapshot.updatedAt
                          ? String(
                              snapshot.connections.filter(
                                (row) => row.installation === "detected",
                              ).length,
                            )
                          : "—",
                        label: "Detected agents",
                        note: "Verified installations",
                      },
                      {
                        icon: CalendarDays,
                        value:
                          nextReset === null ? "—" : duration(nextReset, now),
                        label: "Next quota reset",
                        note:
                          nextReset === null
                            ? "No reset reported"
                            : stamp(nextReset, zone),
                      },
                    ].map(({ icon: Icon, value, label, note }) => (
                      <div className="summary-card" key={label}>
                        <span className="summary-icon">
                          <Icon size={23} />
                        </span>
                        <div>
                          <strong>{value}</strong>
                          <span>{label}</span>
                          <small>{note}</small>
                        </div>
                      </div>
                    ))}
                  </div>
                  <div className="overview-grid">
                    <section className="panel">
                      <div className="section-heading">
                        <h2>Agent allowance</h2>
                        <button
                          className="text-button"
                          onClick={() => navigate("Connections")}
                        >
                          Connections <ArrowRight size={15} />
                        </button>
                      </div>
                      <div className="allowance-list">
                        {snapshot.connections.length ? (
                          snapshot.connections.map((row) => (
                            <article
                              className="allowance"
                              key={row.provider + row.environment}
                            >
                              <button
                                className="provider-heading"
                                onClick={() => setConnection(row)}
                              >
                                <Glyph provider={row.provider} />
                                <span>
                                  <strong>{names[row.provider]}</strong>
                                  <small>{row.profile}</small>
                                </span>
                                <ChevronRight
                                  size={16}
                                  className="provider-arrow"
                                />
                              </button>
                              {row.windows.length ? (
                                <div className="windows">
                                  {row.windows.map((window) => (
                                    <Quota
                                      window={window}
                                      now={now}
                                      zone={zone}
                                      unavailable={
                                        offline || row.quota !== "available"
                                      }
                                      key={window.id}
                                    />
                                  ))}
                                </div>
                              ) : (
                                <div className="no-quota">
                                  <span className="badge">
                                    {describe(row.quota)}
                                  </span>
                                  <p>{row.explanation}</p>
                                </div>
                              )}
                            </article>
                          ))
                        ) : (
                          <p className="empty">
                            {snapshot.scanning
                              ? "Looking for coding agents and local telemetry."
                              : "No providers discovered."}
                          </p>
                        )}
                      </div>
                    </section>
                    <div className="overview-right">
                      <section className="panel">
                        <div className="section-heading">
                          <h2>Usage trend</h2>
                          {period}
                        </div>
                        <div className="chart-caption">
                          Locally observed tokens per day
                        </div>
                        <Trend usage={usage} days={days} now={now} />
                      </section>
                      {attention.length > 0 && (
                        <section className="panel attention">
                          <div className="section-heading">
                            <h2>Needs attention</h2>
                          </div>
                          {attention.map((row) => (
                            <button
                              key={row.provider + row.environment}
                              onClick={() => setConnection(row)}
                            >
                              <span>
                                <strong>{names[row.provider]}</strong>
                                <small>
                                  {row.quota === "available"
                                    ? "Allowance refresh due"
                                    : row.explanation}
                                </small>
                              </span>
                              <ChevronRight size={15} />
                            </button>
                          ))}
                        </section>
                      )}
                    </div>
                  </div>
                  <section className="panel recent">
                    <div className="section-heading">
                      <h2>Recent sessions</h2>
                      <button
                        className="text-button"
                        onClick={() => navigate("Sessions")}
                      >
                        View sessions <ArrowRight size={15} />
                      </button>
                    </div>
                    <SessionList
                      sessions={observedSessions.slice(0, 5)}
                      snapshot={snapshot}
                      now={now}
                      detail={setDetails}
                    />
                  </section>
                </>
              )}
              {page === "Sessions" && (
                <section className="panel">
                  <div className="section-heading">
                    <h2>Session inventory</h2>
                    <div className="controls">
                      <input
                        aria-label="Search sessions"
                        placeholder="Search sessions"
                        value={query}
                        onChange={(event) => setQuery(event.target.value)}
                      />
                      {filterMenu}
                    </div>
                  </div>
                  <SessionList
                    sessions={filtered}
                    snapshot={snapshot}
                    now={now}
                    detail={setDetails}
                  />
                </section>
              )}
              {page === "Usage" && (
                <>
                  <section className="panel">
                    <div className="section-heading">
                      <h2>Observed token activity</h2>
                      <div className="controls">
                        {filterMenu}
                        {period}
                      </div>
                    </div>
                    <Trend usage={usage} days={days} now={now} />
                  </section>
                  <section className="panel recent">
                    <div className="section-heading">
                      <h2>Usage breakdown</h2>
                      <select
                        aria-label="Group usage by"
                        value={group}
                        onChange={(event) =>
                          setGroup(event.target.value as typeof group)
                        }
                      >
                        {[
                          "provider",
                          "model",
                          "project",
                          "environment",
                          "day",
                        ].map((value) => (
                          <option key={value}>{value}</option>
                        ))}
                      </select>
                    </div>
                    <div className="breakdown">
                      {aggregate(usage, group)
                        .sort((a, b) => b[1] - a[1])
                        .map(([key, value]) => (
                          <div key={key}>
                            <span>
                              {group === "provider"
                                ? names[key as Provider]
                                : group === "environment"
                                  ? (snapshot.environments.find(
                                      (row) => row.id === key,
                                    )?.label ?? key)
                                  : group === "project"
                                    ? projectLabel(key)
                                    : key}
                            </span>
                            <strong>{format(value)}</strong>
                          </div>
                        ))}
                    </div>
                    <p className="muted">
                      Observed processing volume. Historical account attribution
                      is unavailable.
                    </p>
                  </section>
                </>
              )}
              {page === "Usage" && (
                <section className="panel recent">
                  <div className="section-heading">
                    <h2>Account-reported usage</h2>
                  </div>
                  {snapshot.connections.some(
                    (row) =>
                      row.accountUsage &&
                      (filter === "all" || row.provider === filter),
                  ) ? (
                    snapshot.connections
                      .filter(
                        (row) =>
                          row.accountUsage &&
                          (filter === "all" || row.provider === filter),
                      )
                      .map((row) => {
                        const account = row.accountUsage!;
                        return (
                          <details
                            key={row.provider + row.environment}
                            className="account-summary"
                            open
                          >
                            <summary>
                              {names[row.provider]} · {row.profile}
                            </summary>
                            <p className="muted">
                              {account.source.contract} ·{" "}
                              {stamp(account.source.collectedAt, zone)}
                              {stale(account.source, now, 1_800_000)
                                ? " · Stale"
                                : ""}
                            </p>
                            <div className="breakdown">
                              {Object.entries({
                                "Lifetime tokens": account.lifetimeTokens,
                                "Peak daily tokens": account.peakDailyTokens,
                                "Longest turn (seconds)":
                                  account.longestRunningTurnSec,
                                "Current streak (days)":
                                  account.currentStreakDays,
                                "Longest streak (days)":
                                  account.longestStreakDays,
                              }).flatMap(([label, value]) =>
                                value === undefined
                                  ? []
                                  : [
                                      <div key={label}>
                                        <span>{label}</span>
                                        <strong>{format(value)}</strong>
                                      </div>,
                                    ],
                              )}
                              {account.days
                                .slice()
                                .sort((a, b) => b.day.localeCompare(a.day))
                                .slice(0, days)
                                .map((bucket) => (
                                  <div key={bucket.day}>
                                    <span>{bucket.day}</span>
                                    <strong>
                                      {format(bucket.tokens)} tokens
                                    </strong>
                                  </div>
                                ))}
                            </div>
                          </details>
                        );
                      })
                  ) : (
                    <p className="empty">
                      No account usage summary was returned.
                    </p>
                  )}
                </section>
              )}
              {page === "Connections" && (
                <>
                  <section className="panel">
                    <div className="section-heading">
                      <h2>Providers</h2>
                    </div>
                    {snapshot.connections.map((row) => (
                      <button
                        className="connection-row"
                        key={row.provider + row.environment}
                        onClick={() => setConnection(row)}
                      >
                        <Glyph provider={row.provider} />
                        <span>
                          <strong>{names[row.provider]}</strong>
                          <small>
                            {row.version ?? "Version unknown"} ·{" "}
                            {row.installation}
                          </small>
                        </span>
                        <span className="badge">{describe(row.quota)}</span>
                        <ChevronRight size={16} />
                      </button>
                    ))}
                  </section>
                  <section className="panel recent">
                    <div className="section-heading">
                      <h2>Environments</h2>
                    </div>
                    <div className="breakdown">
                      {snapshot.environments.map((row) => (
                        <div key={row.id}>
                          <strong>{row.label}</strong>
                          <span>{row.status}</span>
                        </div>
                      ))}
                    </div>
                  </section>
                  <section className="panel recent">
                    <div className="section-heading">
                      <h2>Settings</h2>
                    </div>
                    <div className="controls">
                      <label>
                        Appearance{" "}
                        <select
                          value={theme}
                          onChange={(event) => setTheme(event.target.value)}
                        >
                          <option value="dark">Dark</option>
                          <option value="light">Light</option>
                          <option value="system">System</option>
                        </select>
                      </label>
                      <label>
                        Reset timezone{" "}
                        <select
                          value={zone}
                          onChange={(event) =>
                            setZone(
                              event.target.value === "UTC" ? "UTC" : "system",
                            )
                          }
                        >
                          <option value="system">System</option>
                          <option value="UTC">UTC</option>
                        </select>
                      </label>
                      <label>
                        <input
                          type="checkbox"
                          checked={alerts}
                          onChange={(event) => setAlerts(event.target.checked)}
                        />{" "}
                        Quota alerts
                      </label>
                      <label className="upload">
                        <Upload size={16} /> Import snapshot
                        <input
                          type="file"
                          accept=".json,application/json"
                          onChange={(event) =>
                            void importSnapshot(event.target.files?.[0])
                          }
                        />
                      </label>
                      {imported && (
                        <button
                          onClick={() => {
                            setImported(false);
                            setSnapshot(initial);
                          }}
                        >
                          Close imported snapshot
                        </button>
                      )}
                    </div>
                  </section>
                </>
              )}
              <footer className="foot">
                {snapshot.updatedAt && (
                  <>
                    Updated{" "}
                    <time title={stamp(snapshot.updatedAt)}>
                      {stamp(snapshot.updatedAt)}
                    </time>
                  </>
                )}
                <span>Local telemetry</span>
              </footer>
            </>
          )}
        </div>
      </main>
      {details && (
        <Modal title={details.project} close={() => setDetails(undefined)}>
          <p>
            <SessionStatus session={details} />
          </p>
          <dl>
            <dt>Provider</dt>
            <dd>{names[details.provider]}</dd>
            <dt>Model</dt>
            <dd>{details.model ?? "Unknown"}</dd>
            <dt>Lifecycle</dt>
            <dd>{details.lifecycle ?? "Unknown"}</dd>
            {details.waitingReason && (
              <>
                <dt>Waiting for</dt>
                <dd>{details.waitingReason}</dd>
              </>
            )}
            <dt>Effort</dt>
            <dd>{details.effort ?? "Unknown"}</dd>
            <dt>Context</dt>
            <dd>
              {details.context === undefined
                ? "Unknown"
                : `${details.context}% used`}
              {details.capacity !== undefined
                ? ` of ${format(details.capacity)} tokens`
                : ""}
            </dd>
            <dt>Started</dt>
            <dd>{details.startedAt ? stamp(details.startedAt) : "Unknown"}</dd>
            <dt>Last activity</dt>
            <dd>
              {stamp(details.source.observedAt ?? details.source.collectedAt)}
              {details.source.observedAt === null ? " (collection time)" : ""}
            </dd>
            <dt>Source</dt>
            <dd>{details.source.contract}</dd>
          </dl>
          <h3>Observed token breakdown</h3>
          <dl>
            {Object.entries({
              input: "Inclusive input",
              uncached: "Uncached input",
              cacheRead: "Cache-read input",
              cacheWrite: "Cache-write input",
              output: "Output",
              reasoning: "Reasoning within output",
              total: "Total",
            }).map(([key, label]) => {
              const values = detailUsage
                .map((row) => row.tokens[key as keyof Usage["tokens"]])
                .filter((value): value is number => value !== undefined);
              return (
                <div key={key}>
                  <dt>{label}</dt>
                  <dd>
                    {format(
                      values.length
                        ? values.reduce((a, b) => a + b, 0)
                        : undefined,
                    )}
                  </dd>
                </div>
              );
            })}
          </dl>
          {detailCosts.length > 0 && (
            <dl>
              <dt>Provider-reported usage cost (USD)</dt>
              <dd>{exactUsd(detailCosts)}</dd>
            </dl>
          )}
        </Modal>
      )}
      {connection && (
        <Modal
          title={names[connection.provider]}
          close={() => {
            setConnection(undefined);
            setBridgePreview("");
          }}
        >
          <dl>
            <dt>Profile</dt>
            <dd>{connection.profile}</dd>
            <dt>CLI version</dt>
            <dd>{connection.version ?? "Unknown"}</dd>
            <dt>Installation</dt>
            <dd>{connection.installation}</dd>
            <dt>Quota</dt>
            <dd>{describe(connection.quota)}</dd>
            <dt>Local history</dt>
            <dd>{describe(connection.history)}</dd>
            <dt>Session inventory</dt>
            <dd>{describe(connection.inventory)}</dd>
          </dl>
          <p>{connection.explanation}</p>
          {(connection.resetCredits || connection.finances?.length) && (
            <dl>
              {connection.resetCredits && (
                <div>
                  <dt>Available reset credits</dt>
                  <dd>{format(connection.resetCredits.available)}</dd>
                  <dd className="muted">
                    {connection.resetCredits.source.contract}
                  </dd>
                </div>
              )}
              {connection.finances?.map((row) => (
                <div key={row.label}>
                  <dt>{row.label}</dt>
                  <dd>{exactUsd([row.amount])} USD</dd>
                  <dd className="muted">{row.source.contract}</dd>
                </div>
              ))}
            </dl>
          )}
          {connection.windows.map((window) => (
            <div className="detail-quota" key={window.id}>
              <Quota
                window={window}
                now={now}
                zone={zone}
                unavailable={offline || connection.quota !== "available"}
              />
              <p className="muted">
                {window.source.contract} ·{" "}
                {stamp(window.source.observedAt ?? window.source.collectedAt)}
                {window.source.observedAt === null ? " (collection time)" : ""}
              </p>
            </div>
          ))}
          {snapshot.mode === "live" &&
            connection.provider === "claude" &&
            client.bridge && (
              <div className="bridge">
                <h3>Claude status line</h3>
                <button
                  onClick={() =>
                    void client
                      .bridge?.("preview")
                      .then(setBridgePreview)
                      .catch((error) => setBridgePreview(error.message))
                  }
                >
                  Preview bridge change
                </button>
                {bridgePreview && (
                  <>
                    <pre>{bridgePreview}</pre>
                    {bridgePreview.includes("\n→\n") && (
                      <button
                        className="primary"
                        onClick={() =>
                          void client
                            .bridge?.(
                              bridgePreview.startsWith("Remove")
                                ? "disable"
                                : "enable",
                            )
                            .then((message) => {
                              setBridgePreview(message);
                              void refresh();
                            })
                            .catch((error) => setBridgePreview(error.message))
                        }
                      >
                        Apply previewed change
                      </button>
                    )}
                  </>
                )}
              </div>
            )}
        </Modal>
      )}
      {exporting && (
        <Modal title="Export preview" close={() => setExporting(false)}>
          <p>Export normalized telemetry and collection diagnostics as JSON.</p>
          <ul>
            {snapshot.diagnostics.map((text) => (
              <li key={text}>{text}</li>
            ))}
          </ul>
          <p>
            {snapshot.connections.length} provider records,{" "}
            {snapshot.sessions.length} sessions, {snapshot.usage.length} usage
            records.
          </p>
          <details>
            <summary>Preview snapshot JSON</summary>
            <pre>{JSON.stringify(snapshot, null, 2)}</pre>
          </details>
          <button className="primary" onClick={download}>
            <Download size={16} /> Download snapshot
          </button>
        </Modal>
      )}
    </div>
  );
}
