import { app, BrowserWindow, dialog, session } from "electron";
import { fork, type ChildProcess } from "node:child_process";
import { createHmac, randomBytes } from "node:crypto";
import { readFile } from "node:fs/promises";
import { dataHome } from "../../../packages/collector/src/paths";
import { join } from "node:path";

const origin = "http://127.0.0.1:43129";
let child: ChildProcess | undefined;
let window: BrowserWindow | undefined;
let closing = false;
let starting = true;
async function startCompanion() {
  child = fork(join(__dirname, "../collector/web.cjs"), [], {
    env: {
      ...process.env,
      ELECTRON_RUN_AS_NODE: "1",
      AGENTPULSE_ELECTRON_CHILD: "1",
    },
    stdio: ["ignore", "ignore", "ignore", "ipc"],
  });
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error("Companion startup timed out")),
      10_000,
    );
    const ready = () => {
      clearTimeout(timer);
      resolve();
    };
    child?.once("message", ready);
    child?.once("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child?.once("exit", (code) => {
      clearTimeout(timer);
      if (code === 98) resolve();
      else reject(new Error("Companion stopped"));
    });
  });
}
async function createWindow() {
  if (window) {
    window.focus();
    return;
  }
  const code = (
    await readFile(join(dataHome(), "pairing-code"), "utf8")
  ).trim();
  if (!/^[\w-]{32}$/.test(code))
    throw new Error("Companion pairing unavailable");
  const nonce = randomBytes(24).toString("hex");
  const proof = await fetch(origin + "/api/prove", {
    method: "POST",
    redirect: "error",
    headers: { Origin: origin, "Content-Type": "application/json" },
    body: JSON.stringify({ nonce }),
    signal: AbortSignal.timeout(3000),
  });
  if (
    !proof.ok ||
    (await proof.text()) !==
      JSON.stringify({
        proof: createHmac("sha256", code).update(nonce).digest("hex"),
      })
  )
    throw new Error("Companion identity could not be verified");
  const response = await fetch(origin + "/api/pair", {
    method: "POST",
    redirect: "error",
    headers: { Origin: origin, "Content-Type": "application/json" },
    body: JSON.stringify({ code }),
    signal: AbortSignal.timeout(5000),
  });
  const cookie = /^agentpulse=([\w-]{32});/.exec(
    response.headers.get("set-cookie") ?? "",
  );
  if (!response.ok || !cookie) throw new Error("Companion pairing unavailable");
  const sandbox = session.fromPartition("agentpulse-local");
  await sandbox.cookies.set({
    url: origin,
    name: "agentpulse",
    value: cookie[1],
    httpOnly: true,
    sameSite: "strict",
  });
  sandbox.setPermissionRequestHandler((_contents, _permission, callback) =>
    callback(false),
  );
  sandbox.setPermissionCheckHandler(() => false);
  sandbox.webRequest.onBeforeRequest((details, callback) => {
    const url = new URL(details.url);
    callback({ cancel: url.origin !== origin && url.protocol !== "blob:" });
  });
  window = new BrowserWindow({
    width: 1460,
    height: 950,
    minWidth: 360,
    minHeight: 500,
    backgroundColor: "#0e1319",
    show: false,
    autoHideMenuBar: true,
    webPreferences: {
      session: sandbox,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      devTools: !app.isPackaged,
    },
  });
  window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  window.webContents.on("will-navigate", (event) => event.preventDefault());
  window.webContents.on("will-attach-webview", (event) =>
    event.preventDefault(),
  );
  window.once("ready-to-show", () => window?.show());
  window.on("closed", () => {
    window = undefined;
  });
  await window.loadURL(origin);
}
function fail() {
  dialog.showErrorBox(
    "AgentPulse",
    "The local companion could not start or pair. Check that port 43129 belongs to AgentPulse.",
  );
  app.quit();
}
if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on("second-instance", () => {
    if (!starting) void createWindow().catch(fail);
  });
  void app
    .whenReady()
    .then(startCompanion)
    .then(createWindow)
    .catch(fail)
    .finally(() => {
      starting = false;
    });
  app.on("activate", () => {
    if (app.isReady() && !starting) void createWindow().catch(fail);
  });
  app.on("window-all-closed", () => {
    if (process.platform !== "darwin") app.quit();
  });
  app.on("before-quit", () => {
    if (closing) return;
    closing = true;
    if (child?.connected) child.disconnect();
  });
}
