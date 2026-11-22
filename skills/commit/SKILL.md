---
name: commit
description: Plan Conventional Commits for all pending changes and create them only after the user approves the plan. Use when the user asks to commit changes, stage and commit, split changes into commits, or draft a commit message.
---

## Format

```
<type>(<scope>): <description>
[optional body]
[optional footer(s)]
```

## Types

`feat`, `fix`, `docs`, `style`, `refactor`, `perf`, `test`, `build`, `ci`, `chore`, `revert`

## Rules

- **type**: Required, lowercase, from the list above
- **scope**: Optional. Only include when it clearly adds context (e.g. `feat(ui):` vs `feat:`). Lowercase, kebab-case if multi-word.
- **description**: Required, lowercase start, no period at end, imperative mood (what the change does, not what it did), max 72 chars
- **body**: Optional, wrap at 100 chars, explain "what" and "why" (not "how")
- **footer**: Optional, for breaking changes (`BREAKING CHANGE:`) or issue refs (`Closes #123`, `Fixes #456`)

## Breaking Changes

Append `!` to type/scope, or add `BREAKING CHANGE:` footer.

## Examples

```
feat(auth): add OAuth2 login support
fix(ui): resolve button alignment on mobile
docs: update API documentation
refactor(auth): simplify error handling logic
chore(deps): upgrade React to v19
```

## Workflow

1. **Review all pending changes.** Inspect the repository status and review every staged change, unstaged change, and non-ignored untracked file. The plan must account for all of them, including work that predates the request. If the working tree and index are clean, report that there is nothing to commit.
2. **Group by purpose.** Use a single commit when the changes serve one purpose. Split only when groups have distinct purposes and can be reviewed and reverted independently. Keep related implementation, tests, and documentation together across files. Order dependent groups so each commit can stand on its own where possible.
3. **Present the plan and wait for explicit approval.** List every proposed commit in execution order with its Conventional Commits message, included files or hunks, and a short summary. Keep the working tree and index intact while waiting. An initial request to commit starts this workflow. Run `git commit` only after the user explicitly approves the displayed plan. If the user declines, stop and preserve their changes and staging. If the plan changes, show the revised plan and wait for approval again.
4. **Commit one approved group at a time.** Verify the effective Git author and committer identities and use the configured identity, including a configured automation or test identity. Stop if the identity or credentials belong to an AI agent. Do not add an AI author override or a `Co-Authored-By` trailer. Check that the pending changes still match the approved plan. Select the paths or hunks for each group and verify what will be included before committing. Account for pre-staged changes so each one lands in its approved commit. Use the approved messages and order.
5. **Verify and report.** Check that the new commits match the approved plan and that all pending changes were included. Report each commit's hash and subject in order and the working tree status. If any changes remain, report them and explain why. Push only if requested.
