# Skill Evaluation

Run an evaluation after changing a skill. The project uses [Skill-Up](https://alibaba.github.io/skill-up/) to run the current version, save artifacts and execution records, and compare each check with the preceding run. Base conclusions on specific behaviors and the evidence for them.

## Run an Evaluation

Run these commands from the repository root. You need Node.js 22.21 or later, pnpm, a globally installed Skill-Up CLI on `PATH`, and a signed-in local Codex CLI. The current workflow was verified with Skill-Up 0.14.0. Each skill's `eval.yaml` specifies `gpt-6-luna` and uses the local Codex `max` reasoning setting. Both task execution and model-based judging consume usage quota.

```sh
# Install the project dependencies
pnpm install --frozen-lockfile
skill-up --version

# Validate configuration changes without calling a model
skill-up validate skills/code-style/evals/eval.yaml
skill-up list-cases skills/code-style/evals/eval.yaml

# Run an evaluation
pnpm eval:skills code-style
```

Replace `code-style` with `commit` or `vainjs` to evaluate another skill. The runner calls `skill-up run` for the current version and reads the baseline from saved reports. Run one evaluation at a time per skill. Wait for the report to be saved before editing the skill or its evaluation files.

## Review Reports and Manage History

The command prints report paths when it finishes. Start with the evidence for each check in `comparison.md`, then open the linked HTML reports to verify the underlying artifacts and execution records. Each run is saved under `eval-results/skill-up/<name>/iteration-N/`.

| File            | Purpose                                                                                               |
| --------------- | ----------------------------------------------------------------------------------------------------- |
| `comparison.md` | Side-by-side evidence and conclusions for the two runs                                                |
| `report.html`   | Native Skill-Up report for reviewing execution records and artifacts                                  |
| `result.json`   | Raw results used for comparison                                                                       |
| `manifest.json` | Fingerprints of the skill, evaluation files, and local Codex configuration, plus the Skill-Up version |

The first run establishes the baseline. Each subsequent run compares against the immediately preceding `result.json`. If a case fails or a judge encounters an error, the runner still saves the comparison and preserves the Skill-Up exit status when a new `result.json` exists. The runner skips interrupted directories that lack `result.json` and reports an error if the current run produces no new results.

Git ignores `eval-results/`. Keeping the two most recent runs and their artifacts preserves the links in the latest comparison. Clearing the directory makes the next run a fresh baseline.

## Interpret Changes

The runner matches evidence across the two runs by case ID and check. It records `expect` gates and each judge's findings separately. If a gate fails, the subsequent judges are marked as skipped. Keep tasks, checks, fixtures, tool versions, engine, model, reasoning effort, and Node.js version consistent across runs. The runner compares fingerprints of the evaluation files and local Codex configuration, the Skill-Up version, and the engine and model configuration in the native reports. Verify the Node.js version, external dependencies, and the loaded skill separately.

| Conclusion         | Evidence                                                                                                                             |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------ |
| Improvement        | The skill changed under comparable conditions and the same check changed from failing to passing                                     |
| Regression         | The skill changed under comparable conditions and the same check changed from passing to failing                                     |
| No observed change | The check outcomes match. Review the artifacts from both runs                                                                        |
| Inconclusive       | Missing history, findings, or evidence, changed conditions or coverage, execution errors, or fluctuating results with the same skill |

Treat improvements and regressions as signals from a single run. For example, if a check for filtering inactive users starts passing, inspect the output to verify that the filter was added. Repeat important findings with a clean fixture. Use `--iteration N` with `--output-dir` to save additional samples in a separate directory. [Skill-Up CLI reference](https://alibaba.github.io/skill-up/guide/cli-reference)

When reporting results, describe the specific behavior, cite evidence from both runs, and link to their reports. Limit conclusions to covered behavior you verified. Report problems that appear in both runs. Use individual checks and artifacts to assess improvements.

## Maintain Cases and Checks

When changing a skill or one of its references, review the affected cases. Keep existing cases that already cover the intended behavior. Add a focused case for a coverage gap and register it in `cases.files` in the corresponding `eval.yaml`. Update an existing check only when the expected behavior changes. Changes to evaluation files are reported as a change in conditions and require a new baseline.

Write prompts that describe the actual task and necessary constraints. Cover known failures, regressions in existing behavior, and cases where a rule should not apply. Keep checks independent and reuse native checks and existing tests where possible.

| Skill        | Current coverage                                                                                                                                                | Coverage gaps                                      |
| ------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------- |
| `code-style` | Shared functions, preservation of project configuration, reuse of common types and API contracts, local change scope, and React page and private hook structure | File-based routing, Vue changes, Swift changes     |
| `commit`     | Planning all pending changes, grouping related files, committing after approval, and preserving changes after cancellation                                      | Splitting changes within a single file, clean tree |
| `vainjs`     | Scaffolding an npm library with working build entry points and extending an existing library while preserving its toolchain                                     | Chrome extensions, more toolchain combinations     |

Verify behavior with deterministic tests or actual calls. A `script` judge loads checks from the evaluation directory. Define the starting workspace with fixtures or inline case files. Use `agent_judge` to assess structure, scope, and workflow against diffs, Git history, or per-turn execution records. Test that deterministic checks accept known-good outputs and reject common mistakes. Calibrate model judges with reviewed positive and negative examples, and keep the review read-only.

The configuration follows the [Skill-Up evaluation format](https://alibaba.github.io/skill-up/guide/writing-evals).

| Location                                            | Purpose                                                       |
| --------------------------------------------------- | ------------------------------------------------------------- |
| `skills/<name>/evals/eval.yaml`                     | Engine, model, case list, and report settings                 |
| `skills/<name>/evals/cases/`                        | Tasks, criteria, and artifact collection                      |
| `skills/<name>/evals/fixtures/` and `checks/`       | Starting projects and native script checks                    |
| `evals/eval-skills.mjs`                             | Skill-Up invocation and comparison with the preceding run     |
| `evals/check-skills.mjs` and `evals/evals.test.mjs` | Static validation, comparison tests, and behavior check tests |

## Troubleshoot Evaluations

| Symptom                                                            | Action                                                                                                                         |
| ------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------ |
| No new report                                                      | Check that the CLI is on `PATH`, Codex is signed in, and configuration validation passes                                       |
| Dependency download, session resume, or timeout error              | Inspect the native report and command records. Mark affected cases as inconclusive                                             |
| Unreadable judge output or a verdict that conflicts with artifacts | Inspect the original artifacts and records. Mark the check as inconclusive and establish a new baseline if the criteria change |

## Verify Locally

```sh
pnpm check:skills
pnpm test
```

These commands validate the repository structure, the comparison logic, and the ability of the behavior checks to detect known mistakes without calling a model. TypeScript cases use Node.js `--experimental-strip-types` to verify runtime behavior. Run type checking separately.
