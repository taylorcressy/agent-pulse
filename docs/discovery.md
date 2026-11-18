# Discovery

The collector searches absolute inherited PATH directories and a bounded set of common user-local installer locations. Recognized canonical paths must return a provider-specific version signature. Unfamiliar candidates are shown as unverified. Automatic discovery considers native executables and selected official package layouts. GUI shell-profile recovery, nonstandard launcher registration, and Windows shell shims remain open.

| Provider | Root override | Default | History |
| --- | --- | --- | --- |
| Codex | `CODEX_HOME` | `~/.codex` | `sessions/**/rollout-*.jsonl` |
| Claude | `CLAUDE_CONFIG_DIR` | `~/.claude` | `projects/**/*.jsonl` |
| Grok | `GROK_HOME` | `~/.grok` | `sessions/**/events.jsonl` |

Overrides are single absolute directories. On Linux, matched current-user terminal processes can add provisional rows with an ID derived from environment, PID, and process start tick. Provisional rows are kept independent from historical records because project directory alone cannot establish a match. Other operating systems currently rely on provider sources.

Windows enumerates already-running WSL distributions with `wsl.exe --list --running --quiet`. Start an environment helper explicitly to publish Linux-side telemetry. Other WSL state and native Windows behavior await native verification.

## Connect an environment helper

Build the companion and place `dist/collector/web.cjs` in each participating environment. Run it with Node 24 in the source environment. Where your shell can pipe across the boundary, run this pattern from the receiving host:

```sh
your-environment-launcher node /path/to/web.cjs capture | node dist/collector/web.cjs receive "Gentoo in WSL"
```

Replace `your-environment-launcher` with your own launcher and choose a unique label. A WSL example from a Windows terminal is `wsl.exe -d Ubuntu -- node /path/to/web.cjs capture | node dist/collector/web.cjs receive "WSL Ubuntu"`. The collector shows the named feed in **Connections** while data arrives. Exit the pipeline to disconnect it. Stale registrations age out of the view after seven days.
