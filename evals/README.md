# Skill 评测

每次修改 skill 后，重跑相关用例并查看自动结果与上次运行的差异。当前使用 skill-up 调用本地 Codex，默认模型和推理强度见 [settings.yaml](settings.yaml)。

## 运行

首次运行按 skill-up 官方说明安装 CLI：

```sh
curl -fsSL https://raw.githubusercontent.com/alibaba/skill-up/main/install.sh | bash
```

查看可用用例并评一个场景：

```sh
pnpm eval:pilot --list
pnpm eval:pilot --case config-priority
```

不指定 `--case` 会运行全部用例并消耗模型额度。`pnpm eval:pilot --validate` 只检查配置，不调用模型。

## 查看结果

每次运行生成独立目录 `eval-results/pilot-*/`：

- `report.md` 显示本次自动结果、上次结果和条件可比性，并链接 HTML 报告。
- 各用例的 `results/iteration-1/report.html` 展示 skill-up 详情。
- `evidence/*/grading.json` 保存确定性判分项和失败证据。

只在 skill-up 版本、模型、推理强度、用例、夹具、判分代码及运行器条件一致时，将状态变化归因于 skill 修改。首次运行会建立对照；旧格式报告仍保留，但无法核对评测输入指纹时会标记为不可直接比较。每次只运行当前 skill，不额外发起 `without_skill` 模型调用。

## 本地检查和旧入口

`pnpm test` 运行不调用模型的用例与判分器测试，`pnpm check:skills` 检查 skill 文件结构。日常真实评测使用 `pnpm eval:pilot`。

旧入口 `pnpm eval:skills`、其 `cases.json` 和历史报告继续保留，方便复查旧结果；它不参与新入口的上次结果比较。当前真实运行只验证了 Codex，其他引擎尚未接入隔离和鉴权。

## 当前试点用例

- `config-priority`：整理共享实现，同时保留项目已有格式配置与行为。
- `commit-confirmation`：遵守用户确认边界后再提交。
- `npm-package`：按仓库规范初始化并验证 npm 包。
