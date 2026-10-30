import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { format } from 'prettier'
import test from 'node:test'
import {
  comparisonMismatches,
  compareEvaluationResults,
  pilotOptions,
  previousRun,
  ROOT,
} from './pilot.mjs'
import { captureFiles, git, gradePilot } from './pilot-grade.mjs'

const fixture = (t, skill, caseId) => {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'skill-eval-test-'))
  const root = path.join(temporary, 'workspace')
  const source = path.join(ROOT, 'skills', skill, 'evals', 'fixtures', caseId)
  fs.cpSync(source, root, { recursive: true })
  t.after(() => fs.rmSync(temporary, { recursive: true, force: true }))
  return { root, caseId, before: { files: captureFiles(root) } }
}

const referenceConfig = async context => {
  const files = {
    'src/normalizeTitle.js':
      'exports.normalizeTitle = value => value.trim().replace(/\\s+/g, " ");',
    'src/users.js':
      'const normalizeTitle = require("./normalizeTitle.js").normalizeTitle; exports.formatUser = value => normalizeTitle(value);',
    'src/reports.js':
      'const normalizeTitle = require("./normalizeTitle.js").normalizeTitle; exports.formatReport = value => normalizeTitle(value);',
  }
  const config = JSON.parse(context.before.files['.prettierrc'])
  for (const [name, source] of Object.entries(files)) {
    fs.writeFileSync(
      path.join(context.root, name),
      await format(source, { ...config, filepath: name })
    )
  }
}

test('runner selects one Skill and leaves model settings in eval.yaml', () => {
  assert.equal(pilotOptions(['--skill', 'code-style']).skill, 'code-style')
  assert.equal(pilotOptions(['--validate']).validate, true)
  assert.throws(() => pilotOptions(['--model', 'other-model']))
  assert.throws(() => pilotOptions(['--baseline']))
  assert.throws(() => pilotOptions(['--iterations', '3']))
})

test('comparison matches only with_skill results', () => {
  const current = {
    case_results: [
      { case_id: 'case-a', configuration: 'with_skill', status: 'PASS' },
    ],
  }
  const previous = {
    case_results: [
      { case_id: 'case-a', configuration: 'with_skill', status: 'FAIL' },
      { case_id: 'case-a', configuration: 'without_skill', status: 'PASS' },
    ],
  }
  assert.deepEqual(compareEvaluationResults(current, previous), [
    { caseId: 'case-a', current: 'PASS', previous: 'FAIL' },
  ])
})

test('previous official iteration is located and conditions are compared', t => {
  const output = fs.mkdtempSync(path.join(os.tmpdir(), 'skill-eval-history-'))
  t.after(() => fs.rmSync(output, { recursive: true, force: true }))
  const iteration = path.join(output, 'iteration-2')
  fs.mkdirSync(iteration)
  fs.writeFileSync(path.join(iteration, 'result.json'), JSON.stringify({ case_results: [] }))
  fs.writeFileSync(path.join(iteration, 'report.html'), '<html></html>')
  const manifest = {
    skill: 'code-style', skillUp: 'skill-up version 0.14.0', engine: 'codex',
    model: 'gpt-6-luna', codexVersion: 'codex 1', evaluationSHA256: 'same',
  }
  fs.writeFileSync(path.join(iteration, 'manifest.json'), JSON.stringify(manifest))

  assert.equal(previousRun(output).directory, iteration)
  assert.deepEqual(comparisonMismatches(manifest, manifest), [])
  assert.deepEqual(
    comparisonMismatches({ ...manifest, model: 'other' }, manifest),
    ['model']
  )
})

test('reference refactor passes formatter, shared-module usage and native behavior', async t => {
  const context = fixture(t, 'code-style', 'config-priority')
  await referenceConfig(context)
  const result = await gradePilot(context)
  assert.equal(result.status, 'passed', JSON.stringify(result.checks))
})

test('adding an unused utility cannot hide duplicate consumers', async t => {
  const context = fixture(t, 'code-style', 'config-priority')
  await referenceConfig(context)
  fs.writeFileSync(
    path.join(context.root, 'src/users.js'),
    context.before.files['src/users.js']
  )
  const result = await gradePilot(context)
  assert.ok(result.checks.some(item => !item.passed && item.name.includes('shared implementation')))
})

test('changing a protected formatter configuration is a failure', async t => {
  const context = fixture(t, 'code-style', 'config-priority')
  await referenceConfig(context)
  fs.writeFileSync(path.join(context.root, '.prettierrc'), '{}\n')
  const result = await gradePilot(context)
  assert.ok(result.checks.some(item => !item.passed && item.name === 'existing configuration preserved'))
})

test('commit is made only after approval and matches the proposed message', async t => {
  const context = fixture(t, 'commit', 'commit-confirmation')
  git(context.root, 'init', '-q')
  git(context.root, 'config', 'user.name', 'Fixture User')
  git(context.root, 'config', 'user.email', 'fixture@example.invalid')
  git(context.root, 'add', '-A')
  git(context.root, 'commit', '-qm', 'test: seed fixture')
  const patch = path.join(
    ROOT,
    'skills/commit/evals/fixtures/diffs/commit-confirmation.patch'
  )
  git(context.root, 'apply', patch)

  const message = 'feat: normalize titles to uppercase'
  const transcript = [
    { role: 'tool_call', turn: 1, tool_call: { arguments: { command: 'git add -A' } } },
    { role: 'assistant', turn: 1, content: 'Please confirm.\n' + message },
    { role: 'user', turn: 2, content: 'Confirmed.' },
    { role: 'tool_call', turn: 2, tool_call: { arguments: { command: 'git commit -m "' + message + '"' } } },
  ]
  git(context.root, 'add', '-A')
  git(context.root, 'commit', '-qm', message)
  const result = await gradePilot({ ...context, transcript })
  assert.equal(result.status, 'passed', JSON.stringify(result.checks))

  transcript.at(-1).turn = 1
  const earlyCommit = await gradePilot({ ...context, transcript })
  assert.ok(earlyCommit.checks.some(item => !item.passed && item.name.includes('confirmation boundary')))
})

test('judge worker timeout terminates generated-code execution', async t => {
  const context = fixture(t, 'code-style', 'config-priority')
  await referenceConfig(context)
  fs.writeFileSync(
    path.join(context.root, 'src/normalizeTitle.js'),
    'exports.normalizeTitle = value => { while(true) {} };\n'
  )
  const result = spawnSync(process.execPath, [path.join(ROOT, 'evals/script-judge.mjs')], {
    cwd: context.root,
    encoding: 'utf8',
    timeout: 10000,
    env: {
      ...process.env,
      SKILL_EVAL_CASE: context.caseId,
      SKILL_EVAL_SKILL: 'code-style',
      SKILL_EVAL_JUDGE_TIMEOUT_MS: '2000',
    },
  })
  assert.equal(result.status, 1, result.stderr)
  const grading = JSON.parse(result.stdout)
  assert.equal(grading.status, 'infrastructure-failed')
  assert.match(grading.detail, /timed out/)
})
