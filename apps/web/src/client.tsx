import { createRoot } from "react-dom/client";
import { App } from "../../../packages/ui/src/app";
import {
  type MonitoringClient,
  snapshotSchema,
  empty,
} from "../../../packages/core/src/index";
import "./../../../packages/ui/src/styles.css";

const demoMode = import.meta.env.MODE === "demo";
async function request(path: string, body?: unknown) {
  const response = await fetch(
    "/api/" + path,
    body === undefined
      ? {}
      : {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        },
  );
  if (response.status === 401) throw new Error("Pair this browser");
  const value = await response.json();
  if (!response.ok)
    throw new Error(value.error ?? "Local companion unavailable");
  return value;
}
const live: MonitoringClient = {
  async getSnapshot() {
    return snapshotSchema.parse(await request("snapshot"));
  },
  subscribe(listener) {
    const events = new EventSource("/api/events");
    let active = true;
    let requestPending = false;
    let dirty = false;
    async function update() {
      dirty = true;
      if (requestPending) return;
      requestPending = true;
      while (dirty && active) {
        dirty = false;
        try {
          const snapshot = await live.getSnapshot();
          if (active) listener(snapshot);
        } catch (error) {
          const expired = (error as Error).message === "Pair this browser";
          if (expired) events.close();
          if (active)
            window.dispatchEvent(
              new Event(
                expired ? "agentpulse-disconnected" : "agentpulse-offline",
              ),
            );
          break;
        }
      }
      requestPending = false;
    }
    events.onmessage = () => void update();
    events.onopen = () => void update();
    events.onerror = () => void update();
    return () => {
      active = false;
      events.close();
    };
  },
  async refresh() {
    await request("refresh", {});
  },
  async bridge(action) {
    return (await request("bridge", { action })).message;
  },
};
let client = live;
if (demoMode) {
  const fixture = (await import("../../../packages/ui/src/demo")).demo();
  client = {
    getSnapshot: async () => fixture,
    subscribe: () => () => {},
    refresh: async () => {},
  };
}
createRoot(document.getElementById("root")!).render(
  <App
    client={client}
    initial={empty(demoMode ? "demo" : "live")}
    pair={
      demoMode
        ? undefined
        : async (code) => {
            await request("pair", { code });
          }
    }
  />,
);
