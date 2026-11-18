# Metrics and attribution

Quota windows preserve separate provider buckets, nullable usage and reset values, source times, and durations when available. The UI computes percentage left from a valid reported used percentage. A past reset indicates a refresh is due and leaves the prior value visible as stale. The reset display uses your system timezone or UTC, selected in Connections.

Local usage represents recorded processing volume in observed files. A date, provider, model, project, or environment grouping includes the observations that match that grouping. Historical account attribution remains unknown. Cache and reasoning fields retain provider-specific subset semantics. Grok's reported usage cost uses an exact decimal USD string based on integer ticks. Unsafe JSON number precision is rejected. Provider-reported usage cost and allowance belong to separate metrics.

For metrics with upstream timestamps, freshness uses that timestamp. Live inventory and quota use the collection time when the source omits it. File-only session activity is historical. Registry results represent observations and can go stale after disconnect. Context requires an explicit context measurement. Cumulative tokens describe processing volume.

Coverage is bounded because files may be missing, records may be partial, and working sessions may omit final usage. Event IDs deduplicate revisions and replay where available. Mirrored Grok turns share the same prompt ID. One usage record owns attribution when a duplicate turn appears across forks.
