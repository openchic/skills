# Vainjs Skills

A collection of [Agent Skills](https://agentskills.io/what-are-skills) based on personal best practices from real-world projects. Reflects my own coding style — use it if you find it helpful.

## Quick Start

```bash
pnpx skills add openchic/skills
```

## Available Skills

| Skill                                    | Description                                 |
| ---------------------------------------- | ------------------------------------------- |
| [code-style](skills/code-style/SKILL.md) | Language-agnostic code style conventions    |
| [commit](skills/commit/SKILL.md)         | Conventional Commits (commitlint)           |
| [vainjs](skills/vainjs/SKILL.md)         | Scaffold npm packages and Chrome extensions |

## Contributing

1. Fork the repository
2. Add your skill under `skills/`
3. Add the skill to the Available Skills table
4. Submit a pull request

## Quality Checks

Install the project dependencies, then run the static checks and evaluation runner tests.

```bash
pnpm install --frozen-lockfile
pnpm check:skills
pnpm test
```

Skill evaluations use the globally installed [Skill-Up CLI](https://alibaba.github.io/skill-up/). Each skill keeps its configuration, cases, and fixtures in its own `evals/` directory. A run evaluates the current version of one skill, saves the results, and compares each check with its previous result. The report shows both runs' evidence and classifies each change as an improvement, regression, no observed change, or inconclusive.

```bash
pnpm eval:skills code-style
```

Replace `code-style` with `commit` or `vainjs` to evaluate another skill. The first run establishes a baseline. Later runs compare against the immediately preceding report. Reports are saved under `eval-results/skill-up/<skill>/iteration-N/`. When reporting results, describe the observed behavior and link to the detailed reports. Model evaluations consume usage quota. See [Skill Evaluation](docs/skill-evaluation.md) for the workflow, evidence requirements, and coverage.

## License

MIT
