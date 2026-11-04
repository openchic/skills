# Vainjs Skills

A collection of [Agent Skills](https://agentskills.io/what-are-skills) based on personal best practices from real-world projects. Reflects my own coding style — use it if you find it helpful.

## Quick Start

```bash
pnpx skills add vainjs/skills
```

Or add marketplace to Claude Code:

```bash
/plugin marketplace add vainjs/skills

/plugin install code-skills@vainjs-skills
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
3. Update `.claude-plugin/marketplace.json`
4. Submit a pull request

## 质量校验

安装项目依赖后，可以运行静态检查和评测入口测试：

```bash
pnpm install --frozen-lockfile
pnpm check:skills
pnpm test
```

Skill 评测使用全局安装的 [Skill-Up CLI](https://alibaba.github.io/skill-up/zh/)，配置、用例和夹具位于各 Skill 的 `evals/` 中。每次只评测当前 Skill，保存结果并自动与上一次报告逐项比较，展示改善、回归、未观察到变化或无法判断，以及两次检查的证据：

```bash
pnpm eval:skills code-style
```

将 `code-style` 替换为 `commit` 或 `vainjs` 即可评测其他 Skill。首次运行没有历史对照；之后直接比较最近一份报告。报告保存在 `eval-results/skill-up/<skill>/iteration-N/`，在对话中展示变化并链接详情。结论限于实际覆盖的行为。模型评测会消耗额度，完整方案、证据要求和覆盖计划见 [Skill 评测](docs/skill-evaluation.md)。

## License

MIT
