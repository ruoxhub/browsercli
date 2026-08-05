---
name: close-code-change
description: Close a JSReverser-CLI code change with verification tied to the final diff. Use after implementing a feature, bug fix, review fix, or refactor and before reporting completion, especially when a check failed or code changed after an earlier passing result.
---

# Close Code Change

Carry the final code state through a relevant check, any required repair, a confirming rerun, and an evidence-based handoff.

## Inputs

Require the task goal, current final diff, applicable repository instructions, and any observed check failures. If the requested outcome or acceptance boundary is unclear enough to change the implementation, stop and ask for it.

## Workflow

1. Reconstruct the requested outcome and exclusions. Inspect the final diff and identify each changed source area; do not include unrelated user changes.
2. Select the smallest relevant tests from the mirrored test paths and the project-owned commands in `AGENTS.md`. Run focused tests first, then the applicable gates: `npm run typecheck`, `npm run test:unit`, and `npm run check-format`.
3. When a check fails, preserve the failing check and concise diagnostic, repair only the cause inside the task boundary, then rerun the same check after the last code change. Run any gate invalidated by that repair again.
4. Reinspect the final diff. Confirm every claimed result was produced after the final relevant change and belongs to that change.
5. Hand off with the output contract below. Never replace a missing final result with a pass recorded before the last change.

## Output Contract

Report:

- changed files and the task reason for each;
- each relevant command with `passed`, `failed`, or `not run`;
- the failure-to-repair-to-rerun link when a check failed;
- remaining blockers, unrelated pre-existing failures, and unverified boundaries.

## Stop and Failure Boundaries

- Stop successfully only when relevant checks for the final diff pass.
- If a required command cannot run, times out, or still fails, report the exact blocker and do not claim completion.
- Do not modify generated `build/` output, unrelated files, external systems, credentials, or private task artifacts to make a check pass.
- Do not broaden a focused repair into cleanup or refactoring without explicit authorization.
