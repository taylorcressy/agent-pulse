import { mkdtemp, writeFile, appendFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { startServer } from "../apps/web/src/server";
import { probe, readLines } from "../packages/collector/src/io";
import { Store } from "../packages/collector/src/store";
import { demo } from "../packages/ui/src/demo";

it("buffers partial JSONL records and recognizes truncation", async () => {
  const dir = await mkdtemp(join(tmpdir(), "pulse-"));
  try {
    const file = join(dir, "history.jsonl");
    await writeFile(file, '{"one":1}\n{"two":');
    const first = await readLines(file);
    expect(first.lines).toHaveLength(1);
    await appendFile(file, "2}\n");
    const next = await readLines(file, first);
    expect(next.lines[0].line).toBe('{"two":2}');
    await writeFile(file, "{}\n");
    expect((await readLines(file, next)).lines[0].offset).toBe(0);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
it("kills a bounded hanging probe", async () => {
  await expect(
    probe(process.execPath, ["-e", "setInterval(()=>{},1000)"], {
      timeout: 100,
    }),
  ).rejects.toThrow("timed out");
});
it("upserts usage revisions transactionally", () => {
  const store = new Store(":memory:");
  const snapshot = demo();
  const row = snapshot.usage[0];
  store.write("file", "identity", 99, {}, snapshot.sessions[0], [row]);
  store.write("file", "identity", 199, {}, snapshot.sessions[0], [
    { ...row, tokens: { total: 12 } },
  ]);
  expect(store.recent().usage).toHaveLength(1);
  expect(store.recent().usage[0].tokens.total).toBe(12);
  expect(store.checkpoint("file")?.offset).toBe(199);
  store.db.close();
});
it("requires same-origin authentication and rotates one-time codes", async () => {
  const server = await startServer({
    assets: ".",
    database: ":memory:",
    autostart: false,
  });
  try {
    const path = server.origin + "/api/";
    const headers = {
      Origin: server.origin,
      "Content-Type": "application/json",
    };
    const code = server.pairingCode();
    const attempt = (origin: string) =>
      fetch(path + "pair", {
        method: "POST",
        headers: { ...headers, Origin: origin },
        body: JSON.stringify({ code }),
      });
    expect((await fetch(path + "snapshot")).status).toBe(401);
    expect((await attempt("https://example.com")).status).toBe(403);
    const paired = await attempt(server.origin);
    expect(paired.status).toBe(200);
    expect((await attempt(server.origin)).status).toBe(403);
    const cookie = paired.headers.get("set-cookie")?.split(";")[0] ?? "";
    expect(
      (await fetch(path + "snapshot", { headers: { cookie } })).status,
    ).toBe(200);
    expect(
      (await fetch(path + "refresh", { method: "POST", headers: { cookie } }))
        .status,
    ).toBe(403);
    expect(
      (
        await fetch(path + "bridge", {
          method: "POST",
          headers: { ...headers, cookie },
          body: JSON.stringify({ action: "unexpected" }),
        })
      ).status,
    ).toBe(400);
  } finally {
    await server.close();
  }
});

it.skipIf(process.platform === "win32")(
  "previews, instruments, and restores a custom Claude status line",
  async () => {
    const dir = await mkdtemp(join(tmpdir(), "pulse-bridge-"));
    const { bridge, telemetry } =
      await import("../packages/collector/src/bridge");
    const { vi } = await import("vitest");
    vi.stubEnv("CLAUDE_CONFIG_DIR", dir);
    vi.stubEnv("AGENTPULSE_DATA_DIR", join(dir, "pulse"));
    const settings = join(dir, "settings.json");
    const original = {
      theme: "dark",
      statusLine: { type: "command", command: "cat", padding: 1 },
    };
    try {
      await writeFile(settings, JSON.stringify(original));
      const review = await bridge("preview");
      expect(review).toContain('"command": "cat"');
      await expect(bridge("enable", "wrong preview")).rejects.toThrow(
        "preview expired",
      );
      expect(await bridge("enable", review)).toContain("Bridge enabled");
      const input = {
        session_id: "synthetic",
        rate_limits: {
          five_hour: { used_percentage: 22, resets_at: 1900000000 },
        },
        context_window: { used_percentage: 12, context_window_size: 200000 },
        private: "never persist",
      };
      const { spawnSync } = await import("node:child_process");
      const output = spawnSync(
        process.execPath,
        [join(dir, "pulse", "statusline.cjs")],
        { input: JSON.stringify(input), encoding: "utf8", timeout: 2000 },
      );
      expect(output.stdout).toBe(JSON.stringify(input));
      const normalized = await telemetry(Date.now(), "host");
      expect(normalized.windows[0].used).toBe(22);
      expect(normalized.values[0].context).toBe(12);
      expect(JSON.stringify(normalized)).not.toContain(input.private);
      const restore = await bridge("preview");
      expect(await bridge("disable", restore)).toContain(
        "Previous Claude status line restored",
      );
      expect(await telemetry(Date.now(), "host")).toEqual({
        windows: [],
        values: [],
      });
      const { readFile } = await import("node:fs/promises");
      expect(JSON.parse(await readFile(settings, "utf8"))).toEqual(original);
    } finally {
      vi.unstubAllEnvs();
      await rm(dir, { recursive: true, force: true });
    }
  },
);

it("imports a normalized versioned environment stream", async () => {
  const { Readable } = await import("node:stream");
  const { helperFrame, listenForHelper, importedHelpers } =
    await import("../packages/collector/src/helper");
  const { vi } = await import("vitest");
  const dir = await mkdtemp(join(tmpdir(), "pulse-helper-"));
  vi.stubEnv("AGENTPULSE_DATA_DIR", dir);
  try {
    const frame = helperFrame(demo(), "a".repeat(32));
    const record = JSON.stringify(frame);
    await listenForHelper(
      "Gentoo in WSL",
      Readable.from([
        "ignored\n",
        record.slice(0, 20),
        record.slice(20) + "\n",
      ]),
    );
    const helpers = await importedHelpers(Date.now());
    expect(helpers).toHaveLength(1);
    expect(helpers[0].environment.status).toBe("Collector connected");
    expect(helpers[0].usage[0].sessionId).toBe(helpers[0].sessions[0].id);
    expect(
      (await importedHelpers(Date.now() + 120000))[0].environment.status,
    ).toBe("Collector stale");
  } finally {
    vi.unstubAllEnvs();
    await rm(dir, { recursive: true, force: true });
  }
});
