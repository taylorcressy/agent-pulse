# AgentPulse development and delivery workflow

Apply the [repository approval rules](../../AGENTS.md) throughout delivery.

## Deliver a change

1. **Define scope.** State the problem, intended behavior, and acceptance criteria. If a ticket exists, read its dependencies and history and check whether the change already landed. Keep each integration cycle focused on one ticket or one coherent change.
2. **Establish a baseline.** Inspect the normal entry points and available tests. Reproduce the problem or verify the riskiest assumption. Record the expected behavior and how it can be checked.
3. **Implement and verify locally.** Make the smallest coherent change. Update affected contracts and documentation alongside the implementation. Run focused checks during development and relevant local gates on the integrated change. Add regression coverage when existing tests leave a meaningful gap.
4. **Review and hand off.** Review the complete diff and keep unrelated work separate. Record the scope, acceptance evidence, checks and results, affected revisions if available, and any outstanding gate or next action and its owner. Make a coherent local commit when committing is in scope.
5. **Integrate and close.** Once integration targets and required gates are established, verify that the delivered revisions are reachable from the target branches and that required checks passed. Obtain the applicable authorization before external updates. Leave tickets and release gates open while required evidence is pending.

## Worktree handoff

If using a Git worktree, record its purpose, repository, path, branch, base, owner, and integration target before creating it. At handoff, inspect working changes, commits unique to the branch, integration status, and verification. Verify ancestry before reporting integration and preserve dirty or unmerged work until its disposition is agreed. After integration and validation, remove clean, reconciled worktrees through Git and check the remaining worktrees.

## Open decisions

| Decision | To establish |
| --- | --- |
| Repository and integration | Version control initialization, remote, target branches, and review process |
| Issue tracking | Whether to use a tracker, its project, and who can update or close issues |
| Local verification | Language, build and test entry points, and required local checks |
| CI and releases | Whether CI or deployment applies, required gates, and evidence owners |
| Delegation | Approved tools, data access, and fallback. If already authorized and available, consider Grok for scoped frontend work and Claude for bounded implementation or review. The primary agent owns integration and verification. |
