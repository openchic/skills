import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'
import { spawnSync } from 'node:child_process'
import { parse } from 'yaml'
import { checkSkills, readMetadata } from './check-skills.mjs'
import { compareRuns, readHistory } from './eval-skills.mjs'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const temporaryDirectory = t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'skill-eval-test-'))
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }))
  return directory
}

test('distributed skills pass static validation', () => {
  assert.deepEqual(checkSkills().errors, [])
})

test('metadata accepts block descriptions and rejects duplicate YAML keys', () => {
  assert.equal(
    readMetadata(
      '---\nname: demo\ndescription: >-\n  First line\n  second line\n---\n'
    ).description,
    'First line second line'
  )
  assert.throws(() =>
    readMetadata('---\nname: one\nname: two\ndescription: test\n---\n')
  )
})

test('static checks catch missing registry paths, broken links and unclosed fences', t => {
  const root = temporaryDirectory(t)
  for (const directory of ['skills', '.claude-plugin'])
    fs.cpSync(path.join(ROOT, directory), path.join(root, directory), {
      recursive: true,
    })
  fs.copyFileSync(path.join(ROOT, 'README.md'), path.join(root, 'README.md'))
  const registryPath = path.join(root, '.claude-plugin/marketplace.json')
  const registry = JSON.parse(fs.readFileSync(registryPath, 'utf8'))
  registry.plugins[0].skills.push('./skills/missing')
  fs.writeFileSync(registryPath, JSON.stringify(registry))
  fs.appendFileSync(
    path.join(root, 'skills/code-style/SKILL.md'),
    '\n[bad](references/missing.md)\n\n```ts\n'
  )
  const errors = checkSkills(root).errors
  for (const message of [
    'missing skill',
    'broken local link',
    'unclosed code fence',
  ])
    assert.ok(
      errors.some(error => error.includes(message)),
      message
    )
})

test('history uses numeric iterations and skips interrupted runs without results', t => {
  const directory = temporaryDirectory(t)
  for (const iteration of [2, 10, 11]) {
    const run = path.join(directory, `iteration-${iteration}`)
    fs.mkdirSync(run)
    if (iteration !== 11) fs.writeFileSync(path.join(run, 'result.json'), '{}')
  }
  assert.equal(
    path.basename(readHistory(directory).at(-1).directory),
    'iteration-10'
  )
})

const run = (directory, passed, skillSHA256) => ({
  directory,
  manifest: {
    skillUp: '0.14.0',
    evaluationSHA256: 'same',
    localCodexConfigSHA256: 'local',
    skillSHA256,
  },
  result: {
    skill_name: 'demo',
    engine_name: 'codex',
    model_name: 'gpt-6-luna',
    requested_configuration: { model: 'gpt-6-luna' },
    applied_configuration: { model: 'gpt-6-luna' },
    observed_configuration: { version: 'test-cli' },
    case_results: [
      {
        case_id: 'reuse',
        configuration: 'with_skill',
        status: passed ? 'PASS' : 'FAIL',
        grading: {
          assertion_results: [
            {
              text: '复用公共类型',
              passed,
              evidence: passed
                ? 'src/user.ts 引用公共类型'
                : 'src/user.ts 重复声明字段',
            },
          ],
        },
      },
    ],
  },
})

test('comparison reports behavior transitions with both evidence records, never aggregate scores', () => {
  const before = run('/tmp/iteration-1', false, 'old')
  const after = run('/tmp/iteration-2', true, 'new')
  const report = compareRuns(after, before)
  assert.match(report, /改善：单轮检查信号/)
  assert.match(report, /src\/user.ts 重复声明字段/)
  assert.match(report, /src\/user.ts 引用公共类型/)
  assert.doesNotMatch(report, /%|百分点|pass_rate/)
  assert.match(compareRuns(before, after), /回归：单轮检查信号/)
  assert.match(
    compareRuns(after, run('/tmp/iteration-1', true, 'old')),
    /未观察到变化/
  )
  assert.match(
    compareRuns(before, run('/tmp/iteration-0', false, 'older')),
    /问题仍存在/
  )
})

test('incomplete evidence, execution errors, configuration changes and unchanged skills cannot establish improvement', () => {
  const before = run('/tmp/iteration-1', false, 'old')
  const after = run('/tmp/iteration-2', true, 'new')
  const variants = [
    r => {
      r.manifest.evaluationSHA256 = 'changed'
    },
    r => {
      r.manifest.localCodexConfigSHA256 = 'changed'
    },
    r => {
      r.manifest.skillSHA256 = 'old'
    },
    r => {
      r.manifest = null
    },
    r => {
      delete r.result.observed_configuration
    },
    r => {
      r.result.case_results[0].status = 'ERROR'
    },
    r => {
      r.result.case_results[0].grading.assertion_results[0].evidence = ''
    },
    r => {
      delete r.result.case_results[0].grading.assertion_results[0].passed
    },
  ]
  for (const mutate of variants) {
    const changed = structuredClone(after)
    mutate(changed)
    const report = compareRuns(changed, before)
    assert.match(report, /无法判断/)
    assert.doesNotMatch(report, /改善：|回归：/)
  }
  const errored = structuredClone(before)
  errored.result.case_results[0].status = 'ERROR'
  assert.match(compareRuns(after, errored), /无法判断：存在执行异常/)
  assert.match(compareRuns(after), /无法判断：首次记录/)
})

test('comparison retains removed coverage, identifies new checks and escapes evidence cells', () => {
  const before = run('/tmp/iteration-1', false, 'old')
  const after = run('/tmp/iteration-2', true, 'new')
  const check = after.result.case_results[0].grading.assertion_results[0]
  check.text = '新增检查'
  check.evidence = 'a|b\nc'
  const report = compareRuns(after, before)
  assert.match(report, /reuse \/ 复用公共类型/)
  assert.match(report, /reuse \/ 新增检查/)
  assert.match(report, /新增或移除覆盖/)
  assert.ok(report.includes('a\\|b c'))
  after.result.case_results = []
  assert.match(compareRuns(after, before), /reuse \/ 复用公共类型/)
  after.result.case_results = [
    { case_id: 'excluded', configuration: 'without_skill' },
  ]
  assert.doesNotMatch(compareRuns(after), /excluded/)
})

test('native judge groups retain individual evidence instead of summary verdicts', () => {
  const before = run('/tmp/iteration-1', false, 'old')
  const after = run('/tmp/iteration-2', true, 'new')
  for (const value of [before, after]) {
    const item = value.result.case_results[0]
    item.judge_results = [
      { id: 'behavior', result: item.grading },
      { id: 'structure', result: item.grading },
    ]
    item.grading = { assertion_results: [{ text: 'aggregate verdict' }] }
  }
  const report = compareRuns(after, before)
  assert.match(report, /behavior \/ 复用公共类型/)
  assert.match(report, /structure \/ 复用公共类型/)
  assert.match(report, /src\/user.ts 重复声明字段/)
  assert.doesNotMatch(report, /aggregate verdict/)
  delete after.result.case_results[0].judge_results[0].result
  assert.match(compareRuns(after, before), /behavior \/ 执行结果/)
})

test('a failed native gate remains comparable when it skips grouped judges', () => {
  const before = run('/tmp/iteration-1', true, 'old')
  const after = run('/tmp/iteration-2', false, 'new')
  const first = before.result.case_results[0]
  const second = after.result.case_results[0]
  first.gates = { passed: true, configured_rules: ['files_exist'] }
  first.judge_results = [{ id: 'structure', result: first.grading }]
  second.gates = {
    passed: false,
    failures: [{ rule: 'files_exist', detail: 'missing package.json' }],
  }
  second.judge_results = [{ id: 'structure', status: 'SKIP' }]
  const report = compareRuns(after, before)
  assert.match(report, /expect .*missing package\.json.*回归：/)
  assert.match(report, /复用公共类型.*无法判断：前置检查未通过/)
  assert.doesNotMatch(report, /新增或移除覆盖/)

  second.status = 'ERROR'
  second.gates = { passed: true, configured_rules: ['files_exist'] }
  assert.match(
    compareRuns(after, before),
    /expect .*满足要求：files_exist.*无法判断：存在执行异常/
  )
})

test('behavior probes accept known working outputs and reject realistic regressions', t => {
  const root = temporaryDirectory(t)
  const environment = { ...process.env }
  delete environment.NODE_TEST_CONTEXT
  const scenarios = [
    {
      skill: 'code-style',
      name: 'config-priority',
      target: 'src/users.js',
      good: 'exports.formatUser = value => value.trim().replace(/\\s+/g, " ")',
      bad: 'exports.formatUser = value => value.trim()',
    },
    {
      skill: 'code-style',
      name: 'shared-contract',
      target: 'src/users.ts',
      good: `export const loadUsers = client => client.get('/users')
export const loadUserOptions = async client => (await loadUsers(client))
  .filter(user => user.isActive).map(({ id, name }) => ({ id, name }))`,
      bad: `export const loadUsers = client => client.get('/users')
export const loadUserOptions = async client => (await loadUsers(client))
  .map(({ id, name }) => ({ id, name }))`,
    },
    {
      skill: 'code-style',
      name: 'local-change',
      target: 'src/receipt.js',
      good: 'exports.formatReceipt = amount => `Total: $${amount.toFixed(2)}`',
      bad: 'exports.formatReceipt = amount => `Total: $${Math.round(amount)}.00`',
    },
    {
      skill: 'vainjs',
      name: 'existing-package',
      target: 'src/index.js',
      good: "export { greet } from './greet.js'\nexport const farewell = name => `Goodbye, ${name}!`",
      bad: "export { greet } from './greet.js'\nexport const farewell = name => `Goodbye, ${name || 'World'}!`",
    },
  ]
  for (const scenario of scenarios) {
    const skill = path.join(ROOT, 'skills', scenario.skill)
    const config = parse(
      fs.readFileSync(
        path.join(skill, 'evals/cases', scenario.name + '.yaml'),
        'utf8'
      )
    )
    const directory = path.join(root, scenario.name)
    fs.mkdirSync(directory)
    if (config.context.repo_fixture)
      fs.cpSync(path.join(skill, config.context.repo_fixture), directory, {
        recursive: true,
      })
    for (const [name, content] of Object.entries(config.context.files || {})) {
      const file = path.join(directory, name)
      fs.mkdirSync(path.dirname(file), { recursive: true })
      fs.writeFileSync(file, content)
    }
    for (const variant of ['good', 'bad']) {
      fs.writeFileSync(path.join(directory, scenario.target), scenario[variant])
      const probe = config.judges.find(judge => judge.type === 'script')
      const result = spawnSync(
        process.execPath,
        ['--experimental-strip-types', path.join(skill, probe.script_path)],
        {
          cwd: directory,
          env: environment,
          encoding: 'utf8',
          timeout: 10_000,
        }
      )
      assert.equal(
        result.status,
        variant === 'good' ? 0 : 1,
        `${scenario.name}/${variant}: ${result.stdout}\n${result.stderr}`
      )
      if (variant === 'bad')
        assert.match(result.stdout + result.stderr, /AssertionError/)
    }
  }
})
