# Contributing

Install Node and pnpm from the versions in `.node-version` and `package.json`. Run `pnpm install --frozen-lockfile`, `pnpm verify`, and the relevant local browser or desktop smoke test. See [testing](docs/testing.md) and the [development workflow](docs/development/workflow.md).

For an adapter change, record the upstream contract, tested CLI version, OS and architecture, field semantics, and side effects. Keep regression fixtures synthetic and include failure and partial-coverage cases. Keep provider decoding in the collector and UI formatting in the renderer.

A report should include OS and architecture, app and CLI versions, the affected capability, reproduction steps, and a reviewed diagnostic export if relevant.
