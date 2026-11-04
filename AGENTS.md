# AGENTS.md

Code standards skills for AI coding assistants. Skills are distributed via `.claude-plugin/marketplace.json`.

## Structure

```
.claude-plugin/marketplace.json   # Plugin registry
skills/<name>/SKILL.md            # Skill file (YAML frontmatter + Markdown body)
skills/<name>/evals/              # Skill-Up config, cases, fixtures, and behavior checks
evals/                            # Static checks, previous-run comparison, and tests
docs/                             # Project documentation
```

## Commit Convention

Use `feat` type for skill documentation changes (`skills/<name>/SKILL.md`), as they represent functional improvements to the skill.

## Skill Evaluation

When editing a Skill or its references, check which observable behaviors the change affects and review the corresponding evaluation cases in the same task. Keep an existing case fixed if it already tests the intended behavior. Add a focused case for a coverage gap, or update an affected case when the expected behavior intentionally changes. Keep unrelated cases fixed and leave cases as they are for wording changes that preserve behavior. Treat new or changed coverage as a new baseline.

Follow [the evaluation workflow](docs/skill-evaluation.md). When asked to evaluate a Skill, run `pnpm eval:skills <name>` to evaluate only the current Skill and compare its saved result with the immediately preceding report. Do not rerun an old Skill or run `without_skill` by default.

Report improvements, regressions, no observed change, and inconclusive findings with evidence from both runs. Do not present aggregate scores, percentages, or a perfect-score concept. Inspect actual artifacts and transcripts before attributing a change to the Skill; one changed check is only a signal. Matching check outcomes do not prove equal output quality. Keep tasks, criteria, model, reasoning settings, Node.js version and starting fixtures fixed. New coverage, missing evidence, changed conditions and execution errors are inconclusive. Link the comparison and native detail reports. Limit improvement claims to the behaviors actually covered and verified.

## Adding a New Skill

1. Create `skills/<name>/SKILL.md` with `name` and `description` in frontmatter
2. Update `.claude-plugin/marketplace.json` — add skill path to `skills` array
3. Update `README.md` — add skill to Available Skills table
