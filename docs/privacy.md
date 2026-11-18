# Local data and privacy

AgentPulse reads provider-owned telemetry on the machine where the collector runs. The default private directory is `~/.agentpulse`. It contains normalized SQLite records, a rotating one-time pairing file, and optional Claude settings backup and telemetry. A paired browser session uses an eight-hour same-origin, HttpOnly, SameSite cookie. The companion binds to IPv4 loopback and validates Host and Origin. Its local routes provide snapshots, refresh, and an explicit Claude status-line operation.

The database and export contain normalized IDs, provider and model labels, project basenames, usage, provenance, and capability diagnostics. Project names can be sensitive, so review an export before sharing. Provider transcript fields for prompts, model output, source code, tool input/output and credentials are discarded. The collector does not read other processes' environment variables or preserve their command lines. Provider credentials remain with the provider CLI.

The optional Claude status-line backup contains the prior user configuration for that entry. It stays in the local data directory. Claude may continue invoking a bridge from an existing session until it reloads settings. Before resetting local AgentPulse storage, restore the original status line if the bridge was installed. Remove the private data directory only when the collector is closed and you no longer need the cache or registrations.

Any same-user process with access to the data directory can pair. Host and browser protection target cross-origin and unauthenticated loopback requests. Protect access to the OS account when sharing a machine.
