import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { listFiles } from './check-skills.mjs'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const readJSON = file => JSON.parse(fs.readFileSync(file, 'utf8'))
const fingerprint = (root, files) => {
  const hash = createHash('sha256')
  for (const file of files) {
    hash
      .update(path.relative(root, file))
      .update('\0')
      .update(fs.readFileSync(file))
      .update('\0')
  }
  return hash.digest('hex')
}

/** Read completed native Skill-Up iterations in numeric order. */
export const readHistory = directory => {
  if (!fs.existsSync(directory)) return []
  return fs
    .readdirSync(directory)
    .filter(name => /^iteration-\d+$/.test(name))
    .sort((a, b) => Number(a.slice(10)) - Number(b.slice(10)))
    .map(name => path.join(directory, name))
    .filter(dir => fs.existsSync(path.join(dir, 'result.json')))
    .map(dir => ({
      directory: dir,
      result: readJSON(path.join(dir, 'result.json')),
      manifest: fs.existsSync(path.join(dir, 'manifest.json'))
        ? readJSON(path.join(dir, 'manifest.json'))
        : null,
    }))
}

const cell = value =>
  String(value ?? '无证据记录')
    .replace(/\|/g, '\\|')
    .replace(/[\r\n]+/g, ' ')

/** Compare recorded checks and evidence; never infer quality from aggregate scores. */
export const compareRuns = (current, previous) => {
  const sameConditions =
    current.manifest?.skillSHA256 &&
    previous?.manifest?.skillSHA256 &&
    ['skillUp', 'evaluationSHA256', 'localCodexConfigSHA256'].every(
      key =>
        typeof current.manifest[key] === 'string' &&
        current.manifest[key] === previous.manifest[key]
    ) &&
    [
      'engine_name',
      'model_name',
      'requested_configuration',
      'applied_configuration',
      'observed_configuration',
    ].every(
      key =>
        current.result[key] != null &&
        JSON.stringify(current.result[key]) ===
          JSON.stringify(previous.result[key])
    )
  const cases = run =>
    new Map(
      (run?.result.case_results || [])
        .filter(item => item.configuration === 'with_skill')
        .map(item => [item.case_id, item])
    )
  const old = cases(previous)
  const currentCases = cases(current)
  const skillChanged =
    current.manifest?.skillSHA256 !== previous?.manifest?.skillSHA256
  const checks = item => {
    const assertions = item?.judge_results?.length
      ? item.judge_results.flatMap(judge =>
          (judge.result?.assertion_results || [{ text: '执行结果' }]).map(
            check => ({ ...check, text: `${judge.id} / ${check.text}` })
          )
        )
      : item?.grading?.assertion_results || []
    const gates = item?.gates
    if (typeof gates?.passed !== 'boolean')
      return new Map(assertions.map(check => [check.text, check]))
    const gate = {
      passed: gates.passed,
      evidence: gates.passed
        ? gates.configured_rules?.join('、')
        : gates.failures?.map(failure => failure.detail ?? failure).join('；'),
    }
    return new Map([
      ['expect', gate],
      ...assertions
        .filter(check => !check.text.startsWith('expect.'))
        .map(check => [check.text, check]),
    ])
  }
  const label = (item, check) => {
    if (typeof check?.passed !== 'boolean') {
      if (item?.status === 'ERROR') return '执行异常'
      if (item?.gates?.passed === false) return '未执行：前置检查未通过'
      return '无检查结论'
    }
    return `${check.passed ? '满足要求' : '未满足要求'}：${cell(check.evidence)}`
  }
  const rows = [...new Set([...old.keys(), ...currentCases.keys()])].flatMap(
    id => {
      const item = currentCases.get(id)
      const prior = old.get(id)
      const before = checks(prior)
      const after = checks(item)
      const names = [...new Set([...before.keys(), ...after.keys()])]
      if (!names.length) names.push('执行结果')
      return names.map(name => {
        const a = before.get(name)
        const b = after.get(name)
        let change = '无法判断'
        if (!previous) change += '：首次记录'
        else if (prior?.status === 'ERROR' || item?.status === 'ERROR')
          change += '：存在执行异常'
        else if (
          name !== 'expect' &&
          (prior?.gates?.passed === false || item?.gates?.passed === false)
        )
          change += '：前置检查未通过，评审未执行'
        else if (!prior || !item || !a || !b) change += '：新增或移除覆盖'
        else if (!sameConditions) change += '：条件变化或记录不完整'
        else if (
          typeof a.passed !== 'boolean' ||
          typeof b.passed !== 'boolean' ||
          !a.evidence?.trim() ||
          !b.evidence?.trim()
        )
          change += '：缺少结论或证据'
        else if (a.passed === b.passed)
          change = '未观察到变化：检查结论一致，仍需核对产物'
        else if (!skillChanged) change += '：Skill 未变，检查结果波动'
        else change = `${b.passed ? '改善' : '回归'}：单轮检查信号，需复核证据`
        return `| ${cell(id)} / ${cell(name)} | ${label(prior, a)} | ${label(item, b)} | ${change} |`
      })
    }
  )
  const link = run => {
    const file = fs.existsSync(path.join(run.directory, 'report.html'))
      ? 'report.html'
      : 'result.json'
    return path
      .relative(current.directory, path.join(run.directory, file))
      .split(path.sep)
      .join('/')
  }
  return [
    `# ${current.result.skill_name} 评测对比`,
    '',
    `[本次报告](${link(current)})${previous ? ` · [上次报告](${link(previous)})` : ''}`,
    '',
    previous
      ? `已记录的评测条件${sameConditions ? '一致' : '变化或不完整，本次差异不能直接归因于 Skill 修改'}。`
      : '首次记录，尚无上次结果可供比较；有执行异常的项目不能作为有效基准。',
    '',
    current.manifest?.skillSHA256 && previous?.manifest?.skillSHA256
      ? `Skill 内容${current.manifest.skillSHA256 === previous.manifest.skillSHA256 ? '未变化' : '已变化'}。`
      : '',
    '',
    '| 场景 / 检查项 | 上次证据 | 本次证据 | 变化 |',
    '| --- | --- | --- | --- |',
    ...rows,
    '',
    '结论来自 Skill-Up 的逐项检查，不使用汇总分数。单轮变化仅为信号；检查结论相同不代表产物相同，均未满足要求时问题仍存在。',
    '复核两份报告中的代码差异、执行记录和实际产物；确认加载被测 Skill，排除其他同名 Skill 与环境变化的干扰。模型波动需要重复验证。',
    '',
  ].join('\n')
}

/** Delegate execution to the global CLI and add the previous-run comparison. */
export const runEvaluation = (skillDirectory, outputDirectory) => {
  const config = path.join(skillDirectory, 'evals/eval.yaml')
  if (!fs.existsSync(config)) throw new Error('Missing eval config: ' + config)
  const version = spawnSync('skill-up', ['--version'], { encoding: 'utf8' })
  if (version.status !== 0) throw new Error('请先全局安装 skill-up 并加入 PATH')
  const history = readHistory(outputDirectory)
  const lastDirectory = history.at(-1)?.directory
  const previous = history.at(-1)
  const evalDirectory = path.join(skillDirectory, 'evals')
  const localConfig = path.join(
    process.env.CODEX_HOME || path.join(os.homedir(), '.codex'),
    'config.toml'
  )
  const manifest = {
    skillUp: version.stdout.trim(),
    localCodexConfigSHA256: fs.existsSync(localConfig)
      ? fingerprint(path.dirname(localConfig), [localConfig])
      : null,
    skillSHA256: fingerprint(
      skillDirectory,
      listFiles(skillDirectory).filter(
        file => !file.startsWith(evalDirectory + path.sep)
      )
    ),
    evaluationSHA256: fingerprint(evalDirectory, listFiles(evalDirectory)),
  }
  const executed = spawnSync(
    'skill-up',
    ['run', config, '--output-dir', outputDirectory],
    { stdio: 'inherit' }
  )
  if (executed.error) throw executed.error
  const current = readHistory(outputDirectory).at(-1)
  if (!current || current.directory === lastDirectory) {
    throw new Error('Skill-Up 没有生成新的 result.json')
  }
  current.manifest = manifest
  fs.writeFileSync(
    path.join(current.directory, 'manifest.json'),
    JSON.stringify(manifest, null, 2) + '\n'
  )
  const comparison = path.join(current.directory, 'comparison.md')
  const summary = compareRuns(current, previous)
  fs.writeFileSync(comparison, summary)
  console.log('\n' + summary)
  console.log('对比结果：' + comparison)
  console.log('详细报告：' + path.join(current.directory, 'report.html'))
  return executed.status ?? 1
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
) {
  try {
    const skill = process.argv[2]
    if (process.argv.length !== 3 || !/^[a-z0-9-]+$/.test(skill || ''))
      throw new Error(
        '用法：pnpm eval:skills <skill>，例如 pnpm eval:skills code-style'
      )
    process.exitCode = runEvaluation(
      path.join(ROOT, 'skills', skill),
      path.join(ROOT, 'eval-results', 'skill-up', skill)
    )
  } catch (error) {
    console.error(error.message)
    process.exitCode = 1
  }
}
