import {
  empty,
  type Snapshot,
  type Source,
  type Session,
  type Provider,
} from "../../core/src/index";
export function demo(): Snapshot {
  const now = Date.now(),
    hour = 3600000,
    day = 24 * hour;
  const source: Source = {
    contract: "Synthetic demonstration",
    observedAt: now - 35_000,
    collectedAt: now - 35_000,
    coverage: "synthetic",
    quality: "reported",
  };
  const providers: Provider[] = ["claude", "grok", "codex"];
  const sessions: Session[] = [
    {
      id: "session-01",
      provider: "claude",
      project: "atlas-web",
      environment: "demo-host",
      model: "Claude Sonnet",
      state: "working",
      context: 43,
      source,
      startedAt: now - 2 * hour,
    },
    {
      id: "session-02",
      provider: "grok",
      project: "edge-runtime",
      environment: "demo-wsl",
      model: "Grok Build",
      state: "waiting-for-input",
      source,
      startedAt: now - hour,
    },
    {
      id: "session-03",
      provider: "codex",
      project: "agent-pulse",
      environment: "demo-host",
      model: "GPT Codex",
      state: "idle",
      context: 28,
      source,
      startedAt: now - 40 * 60000,
    },
  ];
  const sample = [
    765000, 1055000, 1093000, 1625000, 1680000, 2050000, 2398000,
  ].flatMap((total, index) =>
    sessions.map((session, j) => {
      const tokens =
        j === 2
          ? Math.floor(total / 5)
          : j === 1
            ? Math.floor(total * 0.3)
            : Math.floor(total / 2);
      const observedAt = new Date(now - (6 - index) * day);
      observedAt.setHours(12, 0, 0, 0);
      return {
        id: `${index}-${j}`,
        sessionId: session.id,
        provider: session.provider,
        environment: session.environment,
        project: session.project,
        model: session.model,
        tokens: {
          input: Math.floor(tokens * 0.8),
          output: tokens - Math.floor(tokens * 0.8),
          total: tokens,
        },
        source: {
          ...source,
          observedAt: Math.min(observedAt.getTime(), now - 35_000),
        },
      };
    }),
  );
  return {
    ...empty("demo"),
    updatedAt: now - 35_000,
    sessions,
    usage: sample,
    environments: [
      { id: "demo-host", label: "This computer", status: "Connected" },
      { id: "demo-wsl", label: "WSL · Ubuntu", status: "Connected" },
      {
        id: "demo-chroot",
        label: "Gentoo · chroot",
        status: "Collector connection needed",
      },
    ],
    diagnostics: [
      "All providers, metrics, and environments on this screen are synthetic.",
    ],
    connections: providers.map((provider, i) => ({
      provider,
      environment: i === 1 ? "demo-wsl" : "demo-host",
      profile: "Demo account",
      version: ["2.1.294", "1.0.89", "0.170.0"][i],
      installation: "detected",
      quota: "available",
      history: "available",
      inventory: "available",
      explanation: "Synthetic allowance example.",
      lastSuccessAt: now - 35_000,
      windows: [
        {
          id: `${provider}-main`,
          label: ["5-hour allowance", "Included credits", "5-hour allowance"][
            i
          ],
          used: [55, 36, 58][i],
          resetsAt: now + [2 * hour, 3 * day + 2 * hour, 4 * hour][i],
          source,
        },
        ...(i === 1
          ? []
          : [
              {
                id: `${provider}-weekly`,
                label: "7-day allowance",
                used: i === 0 ? 31 : 42,
                resetsAt: now + 6 * day + 12 * hour,
                source,
              },
            ]),
      ],
    })),
  };
}
