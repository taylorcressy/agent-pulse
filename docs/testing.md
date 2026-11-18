# Validation matrix

Local host was Gentoo 2.18 x64 with glibc 2.43 and Node 26.3.0. Electron 45.3.4 reported Node 24.22.3 and SQLite 3.54.1.

| Contract | Installed version | Gentoo Linux x64 | macOS | Windows / WSL |
| --- | --- | --- | --- | --- |
| Codex executable, rollout records, rate-limit polling | 0.170.0 | Live reads verified. Account response supplied one allowance window and 114 daily usage buckets. | Unrun | Unrun |
| Claude executable, transcripts, JSON registry | 2.1.294 | Live reads verified. Registry and local history returned records. | Unrun | Unrun |
| Claude status-line bridge | 2.1.294 input contract | Synthetic configuration round trip. Live Claude status-line verification pending. | Unrun | Installer disabled on Windows |
| Grok official executable and completed-turn events | 1.0.89 | Live inventory discovery and local history verified. | Unrun | Unrun |
| Grok ACP billing | 1.0.89 gate | Synthetic parser coverage. Live probe disabled by default and unrun. | Unrun | Unrun |
| Registered helper and WSL reporting | AgentPulse protocol v1 | Synthetic versioned stream and stale registration verified. Native boundary check pending. | Unrun | Unrun |

The Linux live smoke captured 103 sessions and 973 normalized usage records from an initial bounded pass that completed in approximately four seconds. The collector reported approximately 166 MiB resident memory after that pass. This is a point measurement. Idle CPU, steady-state memory, and representative performance benchmarks remain open.

```sh
pnpm verify
pnpm exec playwright install chromium
pnpm test:e2e
AGENTPULSE_TEST_DESKTOP=1 pnpm test:e2e
```

Playwright can use a locally installed Chromium-based browser through `AGENTPULSE_CHROME`. On Linux a graphical display or Xvfb is required for Electron. Integration tests exercise the SQLite record transaction, log boundaries, HTTP pairing, and hung-probe deadline with credential-free fixtures. The platform workflow waits for manual dispatch and has no push trigger.

## Release gaps

The local smoke provides Linux x64 evidence. Native Windows and macOS launch, package installation and removal, and WSL and chroot end-to-end checks remain open. No verified account identifier was available for cross-environment quota pooling. The helper exchanges session and usage telemetry, while quota stays with the host connection. Full GUI PATH recovery, additional provider versions, and richer provider-specific tool, subagent and error metrics remain future work.

## Local build results

The frozen install and `pnpm verify` passed, including lint, formatting, strict type checking, seven unit tests, six integration tests, and the desktop, live web, and demo builds. Three Playwright checks passed on Gentoo x64, including a smoke test of the unpacked Electron distribution and browser checks for keyboard interaction and the 360px layout. The Linux portable archive passed gzip integrity verification.
