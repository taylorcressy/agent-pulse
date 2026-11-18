import { describe, expect, it } from "vitest";
import { remaining, stale, snapshotSchema } from "../packages/core/src/index";
import {
  codexWindows,
  grokWindows,
  metric,
} from "../packages/collector/src/providers";
import { normalize, ticksToUsd } from "../packages/collector/src/history";
import { demo } from "../packages/ui/src/demo";

const source = metric("test", 10000, 0);
describe("metric normalization", () => {
  it("preserves null and zero allowance", () => {
    expect(remaining(null)).toBeNull();
    expect(remaining(-1)).toBeNull();
    expect(remaining(0)).toBe(100);
    expect(remaining(100)).toBe(0);
    expect(stale(source, 20000, 15000)).toBe(true);
  });
  it("prefers quota bucket maps over the single alias", () => {
    const windows = codexWindows(
      {
        rateLimits: { primary: { usedPercent: 99 } },
        rateLimitsByLimitId: {
          codex: {
            primary: {
              usedPercent: 0,
              resetsAt: 1790000000,
              windowDurationMins: 300,
            },
            secondary: { usedPercent: 50 },
          },
          other: { primary: { usedPercent: -1 } },
        },
      },
      source,
    );
    expect(windows.map((row) => row.used)).toEqual([0, 50, null]);
    expect(windows[0].resetsAt).toBe(1790000000000);
  });
  it("keeps Grok included capacity distinct from prepaid balance", () => {
    expect(
      grokWindows({ config: { prepaidBalance: { val: 100 } } }, source),
    ).toEqual([]);
    expect(
      grokWindows(
        {
          config: {
            creditUsagePercent: 42.7,
            currentPeriod: { type: "USAGE_PERIOD_TYPE_WEEKLY" },
            monthlyLimit: { val: 5000 },
            used: { val: 12 },
          },
        },
        source,
      )[0].used,
    ).toBe(42.7);
    expect(ticksToUsd("90071992547409930001")).toBe("9007199254.7409930001");
    expect(ticksToUsd(9007199254740994)).toBeUndefined();
  });
  it("keeps cache tokens disjoint for Claude and does not export raw text", () => {
    const record = {
      type: "assistant",
      sessionId: "abc",
      cwd: "/home/example/project",
      message: {
        id: "message-1",
        model: "test",
        usage: {
          input_tokens: 2,
          cache_read_input_tokens: 10,
          cache_creation_input_tokens: 4,
          output_tokens: 7,
        },
        content: "sensitive example",
      },
    };
    const rows = normalize(
      "claude",
      "host",
      "file",
      [{ line: JSON.stringify(record), offset: 0 }],
      {},
      1000,
    );
    expect(rows.events[0].tokens).toMatchObject({
      input: 16,
      uncached: 2,
      cacheRead: 10,
      cacheWrite: 4,
      output: 7,
      total: 23,
    });
    expect(JSON.stringify(rows)).not.toContain("sensitive example");
    expect(JSON.stringify(rows)).not.toContain("/home/example");
  });
  it("keeps Grok fork turn IDs stable across paths and sessions", () => {
    const event = (sessionId: string) => ({
      line: JSON.stringify({
        method: "_x.ai/session/update",
        params: {
          sessionId,
          update: {
            sessionUpdate: "turn_completed",
            prompt_id: "turn-1",
            usage: {
              inputTokens: 10,
              cachedReadTokens: 3,
              reasoningTokens: 2,
              outputTokens: 5,
              totalTokens: 15,
              costUsdTicks: 100,
            },
          },
        },
      }),
      offset: 0,
    });
    const a = normalize(
      "grok",
      "host",
      "a/events.jsonl",
      [event("fork-a")],
      {},
      1000,
    );
    const b = normalize(
      "grok",
      "host",
      "b/events.jsonl",
      [event("fork-b")],
      {},
      1000,
    );
    expect(a.events[0].id).toBe(b.events[0].id);
    expect(a.events[0].tokens.total).toBe(15);
  });
  it("validates the synthetic demo snapshot", () => {
    expect(snapshotSchema.parse(demo()).mode).toBe("demo");
  });
});

it("keeps account-level history and separate reported credit amounts", async () => {
  const { codexUsage, grokFinances } =
    await import("../packages/collector/src/providers");
  const summary = codexUsage(
    {
      summary: { lifetimeTokens: 1201 },
      dailyUsageBuckets: [
        { startDate: "2026-11-01", tokens: 88 },
        { startDate: "no", tokens: 75 },
      ],
    },
    source,
  );
  expect(summary).toMatchObject({
    lifetimeTokens: 1201,
    days: [{ day: "2026-11-01", tokens: 88 }],
    source,
  });
  expect(
    grokFinances(
      {
        config: {
          prepaidBalance: { val: 125 },
          onDemandCap: {},
          onDemandUsed: { val: 90 },
        },
      },
      source,
    )?.map(({ classification, amount }) => [classification, amount]),
  ).toEqual([
    ["prepaid-balance", "1.25"],
    ["spend-cap", "0.00"],
    ["provider-reported-usage-cost", "0.90"],
  ]);
});
