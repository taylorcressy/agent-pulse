import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdir, rename, stat, unlink, writeFile } from "node:fs/promises";
import { extname, join, resolve, sep } from "node:path";
import { Collector } from "../../../packages/collector/src/collector";
import { bridge } from "../../../packages/collector/src/bridge";
import { dataHome } from "../../../packages/collector/src/paths";
import { obj, parse } from "../../../packages/collector/src/io";
import {
  helperFrame,
  listenForHelper,
} from "../../../packages/collector/src/helper";

const token = () => randomBytes(24).toString("base64url");
const matches = (a: string, b: string) =>
  a.length === b.length &&
  Buffer.byteLength(a) === Buffer.byteLength(b) &&
  timingSafeEqual(Buffer.from(a), Buffer.from(b));
const contentTypes: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".png": "image/png",
  ".woff2": "font/woff2",
};
async function body(req: IncomingMessage) {
  let content = "";
  if (req.headers["content-type"] !== "application/json") return null;
  for await (const chunk of req) {
    content += chunk.toString();
    if (content.length > 2048) return null;
  }
  return parse(content);
}
function json(res: ServerResponse, status: number, data: unknown) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(data));
}
export async function startServer(options: {
  port?: number;
  assets: string;
  database?: string;
  codeFile?: string;
  autostart?: boolean;
}) {
  let collector: Collector;
  let origin = "";
  let code = token(),
    codeExpires = Date.now() + 600_000;
  let failed = 0;
  const sessions = new Map<string, number>();
  const previews = new Map<string, string>();
  const streams = new Set<ServerResponse>();
  const codeFile = options.codeFile;
  let pairingWrite = Promise.resolve();
  let bridgeBusy = false;
  const server = createServer((req, res) => {
    void handle(req, res).catch(() => {
      if (!res.headersSent) json(res, 500, { error: "Local operation failed" });
      else res.end();
    });
  });
  async function rotate() {
    code = token();
    codeExpires = Date.now() + 600_000;
    failed = 0;
    if (codeFile) {
      const file = codeFile;
      const data = code;
      pairingWrite = pairingWrite
        .catch(() => {})
        .then(async () => {
          const temporary = file + "." + token() + ".tmp";
          try {
            await writeFile(temporary, data + "\n", {
              mode: 0o600,
              flag: "wx",
            });
            await rename(temporary, file);
          } finally {
            await unlink(temporary).catch(() => {});
          }
        });
      await pairingWrite;
    }
  }
  async function handle(req: IncomingMessage, res: ServerResponse) {
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Referrer-Policy", "no-referrer");
    res.setHeader("Cross-Origin-Resource-Policy", "same-origin");
    res.setHeader(
      "Content-Security-Policy",
      "default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'self'; img-src 'self' data:; font-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'",
    );
    const host = origin.slice("http://".length);
    const method = req.method ?? "GET";
    if (
      req.headers.host !== host ||
      (req.headers.origin && req.headers.origin !== origin) ||
      (method === "POST" && req.headers.origin !== origin)
    )
      return json(res, 403, { error: "Origin rejected" });
    const path = new URL(req.url ?? "/", origin).pathname;
    if (path === "/api/prove" && method === "POST") {
      const nonce = obj(await body(req)).nonce;
      if (
        typeof nonce !== "string" ||
        !/^[a-f0-9]{48}$/.test(nonce) ||
        Date.now() > codeExpires
      )
        return json(res, 403, { error: "Companion proof unavailable" });
      return json(res, 200, {
        proof: createHmac("sha256", code).update(nonce).digest("hex"),
      });
    }
    if (path === "/api/pair" && method === "POST") {
      const input = obj(await body(req)).code;
      if (
        typeof input !== "string" ||
        Date.now() > codeExpires ||
        failed >= 25 ||
        !matches(input, code)
      ) {
        failed++;
        return json(res, 403, { error: "Pairing code invalid or expired" });
      }
      await rotate();
      const key = token(),
        seconds = 8 * 3600;
      for (const [session, expiry] of sessions)
        if (expiry < Date.now()) {
          sessions.delete(session);
          previews.delete(session);
        }
      if (sessions.size >= 32) {
        const oldest = sessions.keys().next().value ?? "";
        sessions.delete(oldest);
        previews.delete(oldest);
      }
      sessions.set(key, Date.now() + seconds * 1000);
      res.setHeader(
        "Set-Cookie",
        `agentpulse=${key}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${seconds}`,
      );
      return json(res, 200, { ok: true });
    }
    if (path.startsWith("/api/")) {
      const key =
        /(?:^|;\s*)agentpulse=([\w-]+)/.exec(req.headers.cookie ?? "")?.[1] ??
        "";
      const expiry = sessions.get(key) ?? 0;
      if (expiry < Date.now())
        return json(res, 401, { error: "Pair this browser" });
      if (path === "/api/snapshot" && method === "GET")
        return json(res, 200, collector.snapshot);
      if (path === "/api/refresh" && method === "POST") {
        void collector.refresh(true).catch(() => {});
        return json(res, 202, { ok: true });
      }
      if (path === "/api/bridge" && method === "POST") {
        const action = obj(await body(req)).action;
        if (action !== "preview" && action !== "enable" && action !== "disable")
          return json(res, 400, { error: "Invalid bridge action" });
        if (bridgeBusy)
          return json(res, 409, {
            error: "Bridge operation already in progress",
          });
        bridgeBusy = true;
        try {
          const reviewed = previews.get(key);
          previews.delete(key);
          const message = await bridge(action, reviewed);
          if (action === "preview") previews.set(key, message);
          return json(res, 200, { message });
        } catch (error) {
          return json(res, 409, {
            error: (error as NodeJS.ErrnoException).code
              ? "Claude settings could not be updated"
              : (error as Error).message,
          });
        } finally {
          bridgeBusy = false;
        }
      }
      if (path === "/api/events" && method === "GET") {
        if (streams.size >= 32)
          return json(res, 429, { error: "Too many connected views" });
        res.writeHead(200, {
          "Content-Type": "text/event-stream",
          "X-Accel-Buffering": "no",
        });
        res.write("retry: 3000\n\n");
        streams.add(res);
        collector.foreground = true;
        const expiryTimer = setTimeout(() => res.end(), expiry - Date.now());
        res.on("close", () => {
          clearTimeout(expiryTimer);
          streams.delete(res);
          collector.foreground = streams.size > 0;
        });
        return;
      }
      return json(res, 404, { error: "Unknown local API route" });
    }
    if (method !== "GET" && method !== "HEAD")
      return json(res, 405, { error: "Method unavailable" });
    const root = resolve(options.assets);
    const file = resolve(root, "." + (path === "/" ? "/index.html" : path));
    const type = contentTypes[extname(file)];
    if (
      !file.startsWith(root + sep) ||
      !type ||
      !(await stat(file).catch(() => null))?.isFile()
    )
      return json(res, 404, { error: "Asset unavailable" });
    res.writeHead(200, { "Content-Type": type });
    if (method === "HEAD") res.end();
    else {
      const stream = createReadStream(file);
      stream.on("error", () => res.end());
      stream.pipe(res);
    }
  }
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(options.port ?? 0, "127.0.0.1", () => {
      server.removeListener("error", reject);
      resolve();
    });
  });
  const address = server.address();
  if (!address || typeof address === "string")
    throw new Error("Loopback address unavailable");
  origin = `http://127.0.0.1:${address.port}`;
  try {
    collector = new Collector(options.database);
    await rotate();
    collector.on("snapshot", () => {
      for (const stream of streams)
        if (!stream.write("data: update\n\n")) stream.end();
    });
    collector.foreground = false;
    if (options.autostart !== false) collector.start();
  } catch (error) {
    server.close();
    throw error;
  }
  const rotation = setInterval(() => {
    if (Date.now() > codeExpires || failed >= 25) void rotate().catch(() => {});
  }, 15_000);
  rotation.unref();
  return {
    origin,
    pairingCode: () => code,
    collector,
    async close() {
      clearInterval(rotation);
      const stopped = collector.stop();
      for (const stream of streams) stream.end();
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
      await stopped;
      await pairingWrite.catch(() => {});
      if (codeFile) await unlink(codeFile).catch(() => {});
    },
  };
}

if (require.main === module) {
  const run = async () => {
    if (process.argv[2] === "capture") {
      const collector = new Collector(":memory:", false);
      function emit() {
        process.stdout.write(
          JSON.stringify(
            helperFrame(collector.snapshot, collector.environment),
          ) + "\n",
        );
      }
      collector.on("snapshot", (snapshot) => {
        if (!snapshot.scanning) emit();
      });
      process.stdout.on("error", () => process.exit());
      collector.start();
      setInterval(() => {}, 60_000);
      return;
    }
    if (process.argv[2] === "receive") {
      await listenForHelper(process.argv[3] ?? "");
      return;
    }
    const directory = dataHome();
    await mkdir(directory, { recursive: true, mode: 0o700 });
    const codeFile = join(directory, "pairing-code");
    const peer = await startServer({
      port: 43129,
      assets: join(__dirname, "../web"),
      codeFile,
    });
    if (process.send) process.send({ origin: peer.origin });
    else
      console.log(
        `AgentPulse is available at ${peer.origin}\nRead the current one-time pairing code from ${codeFile}`,
      );
    for (const signal of ["SIGTERM", "SIGINT"] as const)
      process.once(
        signal,
        () => void peer.close().finally(() => process.exit()),
      );
    process.once(
      "disconnect",
      () => void peer.close().finally(() => process.exit()),
    );
  };
  void run().catch((error: NodeJS.ErrnoException) => {
    if (!process.send)
      console.error(
        error.code === "EADDRINUSE"
          ? "AgentPulse is already listening on port 43129, or another application owns that port."
          : "AgentPulse companion could not start.",
      );
    process.exitCode = error.code === "EADDRINUSE" ? 98 : 1;
  });
}
