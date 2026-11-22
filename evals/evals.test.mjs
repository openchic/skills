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

test('static checks catch missing README listings, broken links and unclosed fences', t => {
  const root = temporaryDirectory(t)
  fs.cpSync(path.join(ROOT, 'skills'), path.join(root, 'skills'), {
    recursive: true,
  })
  fs.writeFileSync(
    path.join(root, 'README.md'),
    '# Available Skills\n\n- [code-style](skills/code-style/SKILL.md)\n- [vainjs](skills/vainjs/SKILL.md)\n'
  )
  fs.appendFileSync(
    path.join(root, 'skills/code-style/SKILL.md'),
    '\n[bad](references/missing.md)\n\n```ts\n'
  )
  const errors = checkSkills(root).errors
  for (const message of [
    'skills/commit/SKILL.md: not listed in README',
    'skills/code-style/SKILL.md: broken local link: references/missing.md',
    'skills/code-style/SKILL.md: unclosed code fence',
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
              text: 'Reuse shared types',
              passed,
              evidence: passed
                ? 'src/user.ts uses a shared type'
                : 'src/user.ts redeclares fields',
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
  assert.match(report, /Improvement — single-run signal/)
  assert.match(report, /src\/user.ts redeclares fields/)
  assert.match(report, /src\/user.ts uses a shared type/)
  assert.doesNotMatch(report, /%|percentage points|pass_rate/)
  assert.match(compareRuns(before, after), /Regression — single-run signal/)
  assert.match(
    compareRuns(after, run('/tmp/iteration-1', true, 'old')),
    /No observed change/
  )
  assert.match(
    compareRuns(before, run('/tmp/iteration-0', false, 'older')),
    /A problem remains/
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
    assert.match(report, /Inconclusive/)
    assert.doesNotMatch(report, /Improvement —|Regression —/)
  }
  const errored = structuredClone(before)
  errored.result.case_results[0].status = 'ERROR'
  assert.match(compareRuns(after, errored), /Inconclusive — execution error/)
  assert.match(compareRuns(after), /Inconclusive — first run/)
})

test('comparison retains removed coverage, identifies new checks and escapes evidence cells', () => {
  const before = run('/tmp/iteration-1', false, 'old')
  const after = run('/tmp/iteration-2', true, 'new')
  const check = after.result.case_results[0].grading.assertion_results[0]
  check.text = 'New check'
  check.evidence = 'a|b\nc'
  const report = compareRuns(after, before)
  assert.match(report, /reuse \/ Reuse shared types/)
  assert.match(report, /reuse \/ New check/)
  assert.match(report, /coverage added or removed/)
  assert.ok(report.includes('a\\|b c'))
  after.result.case_results = []
  assert.match(compareRuns(after, before), /reuse \/ Reuse shared types/)
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
  assert.match(report, /behavior \/ Reuse shared types/)
  assert.match(report, /structure \/ Reuse shared types/)
  assert.match(report, /src\/user.ts redeclares fields/)
  assert.doesNotMatch(report, /aggregate verdict/)
  delete after.result.case_results[0].judge_results[0].result
  assert.match(compareRuns(after, before), /behavior \/ Execution result/)
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
  assert.match(report, /expect .*missing package\.json.*Regression —/)
  assert.match(report, /Reuse shared types.*Inconclusive — judging skipped after a failed pre-check/)
  assert.doesNotMatch(report, /coverage added or removed/)

  second.status = 'ERROR'
  second.gates = { passed: true, configured_rules: ['files_exist'] }
  assert.match(
    compareRuns(after, before),
    /expect .*Passed — files_exist.*Inconclusive — execution error/
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
