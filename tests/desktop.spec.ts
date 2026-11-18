import { _electron as electron, expect, test } from "@playwright/test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { delimiter, dirname, join } from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
test("Electron starts and pairs a sandboxed window with the companion", async () => {
  test.skip(
    process.env.AGENTPULSE_TEST_DESKTOP !== "1",
    "Run after building the Electron app on a graphical desktop",
  );
  const path = await mkdtemp(join(tmpdir(), "agentpulse-desktop-"));
  const isolated = {
    ...process.env,
    HOME: path,
    PATH: [
      dirname(process.execPath),
      ...(process.platform === "win32"
        ? [join(process.env.SystemRoot ?? "C:\\Windows", "System32")]
        : ["/usr/bin", "/bin"]),
    ].join(delimiter),
    USERPROFILE: path,
    AGENTPULSE_DATA_DIR: join(path, "data"),
    CODEX_HOME: join(path, "codex"),
    CLAUDE_CONFIG_DIR: join(path, "claude"),
    GROK_HOME: join(path, "grok"),
  };
  let desktop: Awaited<ReturnType<typeof electron.launch>> | undefined;
  try {
    const packaged = process.env.AGENTPULSE_DESKTOP_EXE;
    desktop = await electron.launch({
      args: packaged ? [] : ["."],
      executablePath: packaged ?? require("electron"),
      env: isolated,
    });
    const page = await desktop.firstWindow();
    await expect(
      page.getByRole("heading", { name: "Your AI coding agents" }),
    ).toBeVisible();
    await expect(
      page.getByText("Agent allowance", { exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "Pair this browser" }),
    ).toHaveCount(0);
    expect(
      await page.evaluate(() => ({
        require: typeof globalThis.require,
        process: typeof globalThis.process,
      })),
    ).toEqual({ require: "undefined", process: "undefined" });
  } finally {
    await desktop?.close();
    await rm(path, { recursive: true, force: true });
  }
});
