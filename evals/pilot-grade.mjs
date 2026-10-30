import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { check as checkFormat } from 'prettier'
import { createLoader } from './code-style/grade.mjs'

const readJSON = file => JSON.parse(fs.readFileSync(file, 'utf8'))
const PROJECT_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..'
)
const sourceFiles = root =>
  Object.keys(captureFiles(root)).filter(file => /\.[cm]?js$/.test(file))

export const captureFiles = directory => {
  const files = {}
  const walk = current => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      if (['.git', 'node_modules', 'dist'].includes(entry.name)) continue
      const target = path.join(current, entry.name)
      if (entry.isSymbolicLink()) throw new Error('Unexpected symlink: ' + target)
      if (entry.isDirectory()) walk(target)
      else files[path.relative(directory, target).split(path.sep).join('/')] = fs.readFileSync(target, 'utf8')
    }
  }
  walk(directory)
  return files
}

export const git = (workspace, ...args) => {
  const result = spawnSync('git', args, { cwd: workspace, encoding: 'utf8', timeout: 10000 })
  if (result.status !== 0) throw new Error(result.stderr || 'git failed')
  return result.stdout.trim()
}

/** Evaluate final artifacts and observable workflow; return each check with its evidence. */
export const gradePilot = async ({
  root,
  caseId,
  before,
  transcript = [],
}) => {
  const checks = []
  const check = async (name, action) => {
    try {
      await action()
      checks.push({ name, passed: true })
    } catch (error) {
      checks.push({ name, passed: false, detail: error.message })
    }
  }
  const files = captureFiles(root)
  if (caseId === 'config-priority') {
    await check('existing configuration preserved', () => {
      for (const name of ['package.json', '.prettierrc'])
        assert.equal(files[name], before.files[name], name)
      assert.ok(
        !Object.keys(files).some(file => /\.tsx?$/.test(file)),
        'JavaScript was converted to TypeScript'
      )
    })
    await check('project formatter takes precedence', async () => {
      const options = readJSON(path.join(root, '.prettierrc'))
      for (const file of sourceFiles(root))
        assert.ok(
          await checkFormat(files[file], { ...options, filepath: file }),
          file
        )
    })
    await check('shared implementation is used by both consumers', () => {
      const resolveLocal = (fromFile, specifier) => {
        const target = path.resolve(path.dirname(fromFile), specifier)
        const candidates = [
          target,
          ...['.js', '.cjs', '.mjs'].map(ext => target + ext),
          ...['index.js', 'index.cjs', 'index.mjs'].map(name =>
            path.join(target, name)
          ),
        ]
        return candidates.find(
          file => fs.existsSync(file) && fs.statSync(file).isFile()
        )
      }
      const imports = ['users', 'reports'].map(moduleName => {
        const source = files['src/' + moduleName + '.js']
        const specifiers = [
          ...source.matchAll(/require\(\s*(['"])(\.\.?\/[^'"]+)\1\s*\)/g),
        ].map(match => match[2])
        const resolved = specifiers
          .map(specifier =>
            resolveLocal(path.join(root, 'src', moduleName + '.js'), specifier)
          )
          .filter(Boolean)
        return { moduleName, source, resolved }
      })
      const [users, reports] = imports
      const shared = users.resolved.find(file =>
        reports.resolved.includes(file)
      )
      assert.ok(shared, 'consumers do not import the same local module')
      assert.ok(
        shared.startsWith(path.join(root, 'src') + path.sep),
        'shared module is outside src'
      )
      assert.ok(
        !Object.hasOwn(before.files, path.relative(root, shared)),
        'shared logic was not extracted'
      )
      let calls = 0
      const load = createLoader(root, () => {
        calls++
      }, [shared])
      const sharedExports = load(shared)
      assert.ok(
        Object.values(sharedExports).some(value => typeof value === 'function'),
        'shared module has no callable export'
      )
      for (const [moduleName, exportName] of [
        ['users', 'formatUser'],
        ['reports', 'formatReport'],
      ]) {
        const fn = load(path.join(root, 'src', moduleName + '.js'))[exportName]
        for (const input of [' alice ', ' month   end ', '', '  你好\t世界 ']) {
          calls = 0
          assert.equal(fn(input), input.trim().replace(/\s+/g, ' '))
          assert.ok(
            calls > 0,
            moduleName + ' does not call shared implementation'
          )
        }
      }
    })
    await check(
      'native CommonJS execution preserves exports and outputs',
      () => {
        const result = spawnSync(
          process.execPath,
          [
            '-e',
            'const a=require("./src/users.js"),b=require("./src/reports.js");console.log(JSON.stringify([a.formatUser(" a  b "),b.formatReport(" x\\ty ")]))',
          ],
          { cwd: root, encoding: 'utf8', timeout: 5000, env: {} }
        )
        assert.equal(result.status, 0, result.stderr)
        assert.deepEqual(JSON.parse(result.stdout), ['a b', 'x y'])
      }
    )
  } else if (caseId === 'commit-confirmation') {
    await check('confirmation boundary has no premature commit', () => {
      const commits = transcript.filter(
        message =>
          message.role === 'tool_call' &&
          /\bgit\s+commit\b/.test(message.tool_call?.arguments?.command || '')
      )
      assert.equal(commits.length, 1, 'expected exactly one commit command')
      assert.ok(commits[0].turn > 1, 'commit happened before approval')
    })
    await check('exactly one commit preserves the requested changes', () => {
      assert.equal(git(root, 'status', '--porcelain'), '')
      assert.deepEqual(files, {
        'README.md': '# Title utility\n\nA small title helper.\n\nTitles are normalized to uppercase.\n',
        'src/title.js': 'export const title = value => value.trim().toUpperCase()\n',
        'src/version.js': 'export const version = "1.0.0"\n',
      })
    })
    await check('first Git operation stages all changes', () => {
      const commands = transcript
        .filter(message => message.role === 'tool_call')
        .map(message => message.tool_call?.arguments?.command || '')
      const first = commands.find(command => /\bgit\s/.test(command))
      assert.ok(first, 'no Git command evidence')
      assert.match(first, /\bgit\s+add\s+-A(?:\s|[;'"&]|$)/)
    })
    await check(
      'approved message is Conventional Commits and matches the commit',
      async () => {
        const message =
          transcript
            .filter(item => item.role === 'assistant' && item.turn === 1)
            .at(-1)?.content || ''
        const proposal = message.trim().split('\n').at(-1)
        const committed = git(root, 'log', '-1', '--format=%B')
        assert.equal(
          committed,
          proposal,
          'committed message differs from the proposed final line'
        )
        const linted = spawnSync(
          path.join(PROJECT_ROOT, 'node_modules/.bin/commitlint'),
          ['--config', path.join(PROJECT_ROOT, 'package.json')],
          {
            cwd: root,
            input: committed,
            encoding: 'utf8',
            timeout: 10000,
          }
        )
        assert.equal(linted.status, 0, linted.stderr + linted.stdout)
        assert.ok(!/Co-Authored-By:/i.test(committed), 'unexpected co-author')
      }
    )
  } else if (caseId === 'npm-package') {
    await check('npm template and pinned dependency resolutions', () => {
      const pkg = readJSON(path.join(root, 'package.json'))
      assert.equal(pkg.name, 'greeting-kit')
      assert.equal(pkg.type, 'module')
      assert.match(pkg.scripts.build, /rolldown/)
      assert.match(pkg.packageManager, /^pnpm@\d+\.\d+\.\d+/)
      for (const dependency of [
        'rolldown',
        'typescript',
        '@types/node',
        '@vainjs/eslint-config',
        'husky',
        'lint-staged',
        '@commitlint/cli',
        '@commitlint/config-conventional',
        'prettier',
        'eslint',
        'conventional-changelog-cli',
      ]) {
        assert.match(
          pkg.devDependencies[dependency],
          /^\^?\d+\.\d+\.\d+/,
          dependency
        )
      }
      for (const file of [
        'tsconfig.json',
        'eslint.config.mjs',
        'rolldown.config.ts',
        '.prettierrc',
        '.vscode/settings.json',
        '.vscode/extensions.json',
        '.github/workflows/publish.yml',
        'pnpm-lock.yaml',
      ]) {
        assert.ok(fs.existsSync(path.join(root, file)), file)
      }
      for (const file of ['.husky/pre-commit', '.husky/commit-msg']) {
        assert.ok(
          fs.statSync(path.join(root, file)).mode & 0o111,
          file + ' must be executable'
        )
      }
      const commits = transcript.filter(
        message =>
          message.role === 'tool_call' &&
          /\bgit\s+commit\b/.test(message.tool_call?.arguments?.command || '')
      )
      assert.equal(commits.length, 0, 'scaffold created a commit')
    })
    await check('build and declared runtime/type entry points work', () => {
      assert.ok(
        fs.existsSync(path.join(root, 'node_modules')),
        'dependencies not installed'
      )
      const result = spawnSync('pnpm', ['build'], {
        cwd: root,
        encoding: 'utf8',
        timeout: 45000,
      })
      assert.equal(result.status, 0, result.stderr + result.stdout)
      const pkg = readJSON(path.join(root, 'package.json'))
      for (const field of ['main', 'types']) {
        assert.equal(typeof pkg[field], 'string', field)
        const target = path.resolve(root, pkg[field])
        assert.ok(
          target.startsWith(root + path.sep),
          field + ' escapes workspace'
        )
        assert.ok(fs.existsSync(target), field + ' does not exist')
      }
      const probe =
        'const m=await import(' +
        JSON.stringify(pathToFileURL(path.resolve(root, pkg.main)).href) +
        ');console.log(JSON.stringify([m.greet("World"),m.greet("")]))'
      const executed = spawnSync(
        process.execPath,
        ['--input-type=module', '-e', probe],
        { cwd: root, encoding: 'utf8', timeout: 5000, env: {} }
      )
      assert.equal(executed.status, 0, executed.stderr)
      assert.deepEqual(JSON.parse(executed.stdout), [
        'Hello, World!',
        'Hello, !',
      ])
    })
  } else throw new Error('Unknown pilot case: ' + caseId)
  return {
    status: checks.every(check => check.passed) ? 'passed' : 'behavior-failed',
    checks,
  }
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
) {
  try {
    const root = process.cwd()
    const skill = process.env.SKILL_EVAL_SKILL
    const caseId = process.env.SKILL_EVAL_CASE
    if (!skill || !caseId) throw new Error('Missing eval case metadata')
    const fixture = path.join(PROJECT_ROOT, 'skills', skill, 'evals', 'fixtures', caseId)
    const result = await gradePilot({
      root,
      caseId,
      before: { files: captureFiles(fixture) },
      transcript: process.env.EVAL_TRANSCRIPT_PATH
        ? readJSON(process.env.EVAL_TRANSCRIPT_PATH)
        : [],
    })
    process.stdout.write(JSON.stringify(result) + '\n')
  } catch (error) {
    process.stdout.write(
      JSON.stringify({
        status: 'infrastructure-failed',
        checks: [],
        detail: error.message,
      }) + '\n'
    )
  }
}
