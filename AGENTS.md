# AgentPulse agent instructions

Follow the [development and delivery workflow](docs/development/workflow.md).

## Approval boundaries

- Validate locally first. Obtain explicit owner approval before triggering, rerunning, or waiting on CI, including any push that would trigger it. Ask first and explain why CI is needed. Deployment approval and CI approval are separate. Keep required release and ticket gates open until their evidence exists.
- Before any action that moves money or can trigger money-moving automation, obtain explicit, action-specific owner approval. This covers live charges, refunds, transfers, provider purchases and renewals, subscription or billing changes, automatic compensation, and provisioning retries, recovery, resume operations, or deployments with financial effects. A spending cap, general repair or deployment permission, and approval for another transaction confer no authority for the proposed action. If the effect is unclear, pause that action, explain the proposed effect, and ask first. Read-only financial inspection may continue.
- Paid overages are prohibited. When included quota runs out, use an authorized alternative within its included limits or wait for quota to reset.
- Workflow setup authorizes local guidance changes. External tracker writes, pushes, deployments, and production mutations require their own applicable authorization.

## Local development

- Install with `pnpm install --frozen-lockfile`. Run `pnpm verify` and task-relevant smoke tests.
- Keep browser-safe contracts in `packages/core`, provider observation in `packages/collector`, and formatting and interaction in `packages/ui`. Application hosts live under `apps`.
- Code and fixtures must preserve reported, derived, estimated, unavailable, and stale states. Keep prompts, tool content, raw credentials, and real provider transcripts out of fixtures.
- Update the provider contract and regression evidence together. Ordinary checking remains credential-free and must never initiate inference.
- Report implementation, local verification, and outstanding native or live gates. See [verification](docs/testing.md).
