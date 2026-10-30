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

安装依赖后，先运行不调用模型的检查。静态检查覆盖所有发布的 skill，测试验证评测器本身能发现错误。

```bash
pnpm install --frozen-lockfile
pnpm check:skills
pnpm test
```

评测脚本、用例、夹具和测试集中在 `evals/`。运行说明见 [Skill 评测](evals/README.md)，以下命令对应当前实现。

skill-up 第一阶段试点已提供独立入口，覆盖项目配置优先、提交确认和 npm 包初始化。本地使用 Codex、`gpt-6-luna`、`max`，可修改 `evals/settings.yaml`。旧入口在试点验收前继续保留。

```bash
curl -fsSL https://raw.githubusercontent.com/alibaba/skill-up/main/install.sh | bash
pnpm eval:pilot --list
pnpm eval:pilot --validate
pnpm eval:pilot --case config-priority
pnpm eval:pilot --case commit-confirmation
```

`--validate` 不调用模型；真实运行会消耗所选模型额度。每次只运行当前 skill，汇总页会链接同一用例的上次报告、比较自动结果，并标注评测条件是否一致。浏览器报告位于各用例的 `results/iteration-1/report.html`。本地 Codex 使用独立状态目录，登录凭据临时复制后清理，不写入结果目录；报告记录 skill-up 版本，版本变化时不将结果直接归因于 skill 修改。其他引擎尚未完成本项目的隔离和鉴权验证，真实试跑会明确拒绝，避免误报支持。

以下是保留的旧 runner 用法。

行为评测只覆盖 code-style 的 8 个代表场景，使用已安装并登录的 Codex CLI。模型必须明确指定，运行会消耗对应额度；默认每例只跑一次，不自动重试。

```bash
pnpm eval:skills --list
pnpm eval:skills --model gpt-5.6-luna
pnpm eval:skills --model gpt-5.6-luna --case react-page
# 需要对比时再指定包含旧版 code-style 的 Git 提交
pnpm eval:skills --model gpt-5.6-luna --baseline 93338f3
```

`--baseline` 会额外运行一轮旧版，以上提交仅是本次规范调整的对比示例。比较时保持模型与推理强度一致；默认强度为 `low`，可用 `--effort medium` 或 `--effort high` 调整。每例默认限时 300 秒，可用 `--timeout` 调整到 10–600 秒。每次使用独立临时工程、会话和完整 skill 快照，禁用本机其他技能，不修改全局安装或配置。连接、进程或产物采集失败会停止运行；行为失败保留并继续其他用例。

结果保存在忽略提交的 `eval-results/<run>/`，包含 JSON/Markdown 报告、原始日志、代码差异与产物。`passed` 只表示自动检查通过。检查覆盖技能与参考文件的读取记录、入口与工具归属、共享函数的实际调用、TS/TSX 类型，以及 React/Vue 的渲染、搜索和输入变化。Vue SFC 进行编译和运行验证，不包含完整的模板类型检查；文件读取记录只是技能触发的线索，不能证明规则被正确理解。

发布前运行静态检查，再按改动选择相关用例；涉及通用规则时运行全部 8 例。查看 `report.md` 中的失败和人工清单，结合代码差异判断页面结构、职责划分及 review 内容是否符合预期。只复核实际运行的场景，并记录判断依据。出现真实失败时先修正规则，再重跑相关用例；单次通过不能证明稳定性，有疑问再复跑。

生成代码会在本机测试进程中执行，只评测可信 skill 和用例。当前不接入 CI、不设置强制重复次数或自动发布门禁，也不自动修改 skill。新增真实问题时优先补回归用例。

## License

MIT
