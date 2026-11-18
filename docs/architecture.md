# Architecture

The root pnpm workspace contains the Electron host in `apps/desktop`, the browser entry point and loopback companion in `apps/web`, browser-safe schemas in `packages/core`, provider readers and storage in `packages/collector`, and the shared React UI in `packages/ui`. The UI receives a MonitoringClient and consumes versioned snapshots. Independent provider reads publish progress through server-sent events. Clients retrieve snapshots through the same authenticated HTTP transport.

## Desktop and companion

Electron starts a Node-mode child using its existing executable and opens the shared browser UI in a dedicated, sandboxed session. The desktop main process proves that the companion knows the installation's current pairing code before sending it. Chromium receives an HttpOnly cookie. The window restricts navigation, resource requests, new windows, embedded webviews, and permissions. The browser pairs manually with the same service. One fixed loopback listener prevents two desktop/browser collectors from polling the same host under the standard launchers.

The initial implementation uses a bundled companion over loopback for both hosts. This keeps the trust boundary and transport implementation shared and removes the need for renderer IPC, a preload, or a separate application protocol. Build scripts use Vite for the renderer, esbuild for Node and Electron entry points, and electron-builder for packaging. Electron's bundled Node provides SQLite without an external native module rebuild.

## Scheduling and persistence

The collector runs an initial sweep then reconciles every 15 seconds. Each provider updates independently. Per-provider quota polling is slower, with longer idle and repeated-failure delays. Quota results can age independently of the usage cache. Probe processes have bounded output, timeouts, and process-tree cleanup on normal shutdown. Manual refresh is coalesced with collection already in progress.

The SQLite database uses WAL and a schema version. File identity, matched metadata, byte checkpoints, and normalized observations commit together. History scanning prioritizes recent files and rotates through a bounded older batch. A damaged or inaccessible database falls back to in-memory operation. The cache retains up to 90 days of dated rows and applies count limits to records and checkpoints. The shared view receives up to 500 sessions and 5,000 usage observations.

The environment helper emits a versioned stream through stdout and a host-side receiver stores the last normalized frame per registration. The user owns the launcher and pipe. This supports custom chroots without privilege escalation or discovery inside arbitrary environments. Helper frames currently carry sessions and local usage. Quota remains host scoped.
