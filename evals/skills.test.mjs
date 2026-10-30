import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import test from 'node:test'
import { checkSkills, readMetadata } from './check-skills.mjs'
import {
  parseOptions,
  parseTrace,
  prepareCase,
  runCommand,
  snapshot,
  wasRead,
  gradeCase,
} from './eval-skills.mjs'
import {
  checkPageBehavior,
  gradeArtifacts,
} from './code-style/grade.mjs'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const CASES = JSON.parse(
  fs.readFileSync(path.join(ROOT, 'evals/code-style/cases.json'), 'utf8')
)

const temporaryDirectory = t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'skill-eval-test-'))
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }))
  return directory
}

const fixture = (t, id) => {
  const out = temporaryDirectory(t)
  const testCase = CASES.find(item => item.id === id)
  const state = prepareCase(
    testCase,
    { 'SKILL.md': '---\nname: code-style\ndescription: Test skill\n---\n' },
    { model: 'test-model', variant: 'candidate', effort: 'low' },
    out
  )
  t.after(() => fs.rmSync(state.workspace, { recursive: true, force: true }))
  return { root: state.workspace, testCase, out }
}

test('current distributed skills pass static validation', () => {
  assert.deepEqual(checkSkills().errors, [])
})

test('metadata parser supports block descriptions and rejects duplicate YAML keys', () => {
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

test('static check catches missing registry paths, broken references, and unclosed fences', t => {
  const root = temporaryDirectory(t)
  fs.cpSync(path.join(ROOT, 'skills'), path.join(root, 'skills'), {
    recursive: true,
  })
  fs.cpSync(
    path.join(ROOT, '.claude-plugin'),
    path.join(root, '.claude-plugin'),
    { recursive: true }
  )
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
  assert.ok(errors.some(error => error.includes('missing skill')))
  assert.ok(errors.some(error => error.includes('broken local link')))
  assert.ok(errors.some(error => error.includes('unclosed code fence')))
})

test('only bounded explicit eval options are accepted', () => {
  assert.equal(
    parseOptions(['--model', 'test-model', '--timeout', '60']).timeout,
    60
  )
  assert.throws(() => parseOptions(['--repeat', '3']))
  assert.throws(() => parseOptions(['--verify', 'report']))
  assert.throws(() => parseOptions(['--ci-matrix']))
  assert.throws(() => parseOptions(['--timeout', '1.5']))
  assert.throws(() => parseOptions(['--timeout', '0']))
  assert.throws(() => parseOptions(['--unknown', 'x']))
})

test('trace completion is not inferred from an agent saying it succeeded', () => {
  const trace = parseTrace(
    JSON.stringify({
      type: 'item.completed',
      item: { type: 'agent_message', text: 'All passed' },
    })
  )
  assert.equal(trace.completed, false)
  const completed = parseTrace(
    [
      {
        type: 'item.completed',
        item: {
          type: 'command_execution',
          command: 'cat src/request.ts',
          status: 'completed',
          exit_code: 0,
        },
      },
      { type: 'error', message: 'Reconnecting' },
      { type: 'turn.completed' },
    ]
      .map(item => JSON.stringify(item))
      .join('\n')
  )
  assert.equal(completed.completed, true)
  assert.deepEqual(completed.commands, ['cat src/request.ts'])
})

test('a real read is recognized even when the same shell command also lists files', () => {
  const trace = {
    commands: [
      'sed -n "1,240p" .agents/skills/code-style/SKILL.md && rg --files',
    ],
  }
  assert.equal(wasRead(trace, 'SKILL.md'), true)
  assert.equal(
    wasRead(
      { commands: ['rg --files .agents/skills/code-style/SKILL.md'] },
      'SKILL.md'
    ),
    false
  )
  assert.equal(
    wasRead({ commands: ['cat other-skill/SKILL.md'] }, 'SKILL.md'),
    false
  )
})

test('numbered source reads are recognized', () => {
  assert.equal(
    wasRead(
      { commands: ['rtk proxy nl -ba src/request.ts'] },
      'src/request.ts'
    ),
    true
  )
})

test('process failures are infrastructure failures', async () => {
  const result = await runCommand(
    process.execPath,
    ['-e', 'process.exit(7)'],
    ROOT,
    10
  )
  assert.equal(result.infrastructureError, true)
  assert.equal(result.exitCode, 7)
})

test('fixture snapshot rejects generated symlinks', t => {
  const root = temporaryDirectory(t)
  fs.symlinkSync(ROOT, path.join(root, 'escape'), 'dir')
  assert.throws(() => snapshot(root), /symlink/)
})

test('React seed preserves rendering, search, and changing request input', async t => {
  const { root } = fixture(t, 'react-page')
  await checkPageBehavior(root, 'react')
})

test('React behavioral check detects a frozen request dependency', async t => {
  const { root } = fixture(t, 'react-page')
  const file = path.join(root, 'src/pages/UserList/index.tsx')
  fs.writeFileSync(
    file,
    fs.readFileSync(file, 'utf8').replace('[teamId]', '[]')
  )
  await assert.rejects(checkPageBehavior(root, 'react'), /teamId changes/)
})

test('Vue seed preserves rendering, search, and prop reactivity', async t => {
  const { root } = fixture(t, 'vue-page')
  await checkPageBehavior(root, 'vue')
})

test('Vue behavioral check detects lost prop reactivity', async t => {
  const { root } = fixture(t, 'vue-page')
  const file = path.join(root, 'src/pages/UserList/index.vue')
  fs.writeFileSync(
    file,
    fs.readFileSync(file, 'utf8').replace('() => props.teamId', '() => "a"')
  )
  await assert.rejects(checkPageBehavior(root, 'vue'), /teamId changes/)
})

test('unused shared utility files cannot make duplicate consumers pass', async t => {
  const { root, testCase } = fixture(t, 'node-utils')
  const utils = path.join(root, 'src/utils')
  fs.mkdirSync(utils)
  fs.writeFileSync(
    path.join(utils, 'normalizeEmail.js'),
    'export const normalizeEmail = value => value.trim().toLowerCase()\n'
  )
  fs.writeFileSync(
    path.join(utils, 'index.js'),
    'export { normalizeEmail } from "./normalizeEmail.js"\n'
  )
  const checks = await gradeArtifacts(testCase, root)
  assert.ok(
    checks.some(
      check =>
        !check.passed &&
        check.detail?.includes('does not use the shared utility')
    )
  )
})

test('Node accepts an index entry with the module-appropriate suffix, but not unresolved ESM imports', async t => {
  const { root, testCase } = fixture(t, 'node-utils')
  const utils = path.join(root, 'src/utils')
  fs.mkdirSync(utils)
  fs.writeFileSync(
    path.join(utils, 'normalizeEmail.js'),
    'export const normalizeEmail = value => value.trim().toLowerCase()\n'
  )
  fs.writeFileSync(
    path.join(utils, 'index.mjs'),
    'export { normalizeEmail } from "./normalizeEmail.js"\n'
  )
  for (const directory of ['user-profile', 'email-report']) {
    const file = path.join(root, 'src', directory, 'index.js')
    fs.writeFileSync(
      file,
      fs
        .readFileSync(file, 'utf8')
        .replace(
          'const normalizeEmail = value => value.trim().toLowerCase()',
          'import { normalizeEmail } from "../utils/index.mjs"'
        )
    )
  }
  const checks = await gradeArtifacts(testCase, root)
  assert.ok(
    checks.every(check => check.passed),
    JSON.stringify(checks)
  )
  const consumer = path.join(root, 'src/user-profile/index.js')
  fs.writeFileSync(
    consumer,
    fs
      .readFileSync(consumer, 'utf8')
      .replace('../utils/index.mjs', '../utils/index')
  )
  const broken = await gradeArtifacts(testCase, root)
  assert.ok(
    broken.some(
      check =>
        !check.passed &&
        check.name === 'native Node ESM resolution and execution'
    )
  )
})

test('the lightweight CLI lists exactly eight cases without running a model', () => {
  const result = spawnSync(
    process.execPath,
    [path.join(ROOT, 'evals/eval-skills.mjs'), '--list'],
    { cwd: ROOT, encoding: 'utf8' }
  )
  assert.equal(result.status, 0, result.stderr)
  assert.equal(result.stdout.trim().split('\n').length, 8)
})

test('stored exec evidence distinguishes review success, unauthorized edits, and infrastructure failure', async t => {
  const { out } = fixture(t, 'skill-document')
  fs.cpSync(path.join(out, 'initial'), path.join(out, 'generated'), {
    recursive: true,
  })
  const events = [
    {
      type: 'item.completed',
      item: {
        type: 'command_execution',
        command: 'cat docs/proposed-skill.md',
        status: 'completed',
        exit_code: 0,
      },
    },
    {
      type: 'item.completed',
      item: {
        type: 'agent_message',
        text: 'The scope is too broad and rewriting all files exceeds the task.',
      },
    },
    { type: 'turn.completed' },
  ]
  fs.writeFileSync(
    path.join(out, 'events.jsonl'),
    events.map(item => JSON.stringify(item)).join('\n')
  )
  fs.writeFileSync(
    path.join(out, 'execution.json'),
    JSON.stringify({ infrastructureError: false })
  )
  const result = await gradeCase(out)
  assert.equal(result.status, 'passed', JSON.stringify(result.checks))
  assert.ok(!fs.existsSync(path.join(out, 'generated/node_modules')))
  fs.appendFileSync(
    path.join(out, 'generated/docs/proposed-skill.md'),
    '\nUnexpected edit\n'
  )
  const changed = await gradeCase(out)
  assert.equal(changed.status, 'behavior-failed')
  assert.ok(
    changed.checks.some(
      check => check.name === 'review does not modify files' && !check.passed
    )
  )
  fs.writeFileSync(
    path.join(out, 'execution.json'),
    JSON.stringify({ infrastructureError: true })
  )
  assert.equal((await gradeCase(out)).status, 'infrastructure-failed')
})
