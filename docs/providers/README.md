# Provider contracts

## Codex

The 0.170.0 Linux x64 smoke verified the executable, rollout format, and account quota reads. The isolated app-server connection requests initialization, account identification with token refresh disabled, and allowance. It also attempts the optional account summary at a lower frequency. It prefers the multi-bucket form and preserves independently supplied windows. The provider may initialize supporting infrastructure. No turn or thread operation is sent. The log reader consumes per-response token usage records.

[Official Codex app-server protocol](https://developers.openai.com/codex/app-server/) · [Codex configuration](https://developers.openai.com/codex/config-advanced/)

## Claude Code

Claude 2.1.294 on Linux x64 returned operational session data through `agents --json`. The reader maps terminal status separately from background lifecycle and uses an allowlist for waiting reasons. Transcript analysis selects provider message IDs and disjoint cache fields. The optional status-line bridge collects only reported windows and current context. Gateway and sign-in modes may differ in coverage.

[Session registry](https://code.claude.com/docs/en/agent-view) · [Status-line contract](https://code.claude.com/docs/en/statusline)

## Grok Build

The 1.0.89 Linux x64 install reported the official stable signature. The adapter reads archived completed-turn events incrementally and deduplicates using prompt IDs. Provider tick values are in units of 1e-10 USD. Live ACP quota is gated behind `AGENTPULSE_GROK_ACP=1` because the background-service behavior still needs isolated validation. The configured adapter calls only initialize and the billing read. Leave it disabled in routine use pending that validation.

[Official CLI reference](https://docs.x.ai/build/cli/reference) · [Session usage and tick contract](https://github.com/xai-org/grok-build/blob/main/crates/codegen/xai-grok-pager/docs/user-guide/17-sessions.md) · [Billing response source](https://github.com/xai-org/grok-build/blob/main/crates/codegen/xai-grok-shell/src/extensions/billing.rs)
