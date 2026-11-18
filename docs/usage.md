# Use AgentPulse

**Overview** shows detected installations, session activity, available allowance windows, and a local token trend. Each allowance window shows its own remaining percentage and reset. Hover the reset time for its exact timestamp.

**Sessions** filters by provider and search text. Open a row to see source, model, observed token breakdown, and current context where available.

**Usage** groups observed token counts by day, provider, project, environment, or model. Date ranges use local calendar days. When a provider returns an account summary, it appears in its own section.

**Connections** shows installation and capability states, environments, theme and reset timezone settings, optional in-app quota alerts, and offline import. The toolbar's export button previews the normalized JSON before download. The static demo is labeled and includes synthetic sessions and quota. It can also open a file exported by AgentPulse.

## Enable Claude live metrics

From **Connections**, open Claude Code and preview its status-line change. Apply the reviewed change to enable the bridge. On supported POSIX installations, the bridge forwards the same stdin to an existing command and collects allowlisted quota and context fields. The collector reads the saved copy after Claude emits a status-line update. Some accounts or sessions omit rate limits.

To remove it, preview and apply the corresponding restore operation. AgentPulse restores the saved status-line entry if the current bridge still matches the reviewed state. Other settings are preserved. If necessary, open a fresh Claude session to load the changed configuration. For AppImage builds, run the standalone companion to manage the bridge.
