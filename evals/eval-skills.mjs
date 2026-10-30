import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawn, spawnSync } from 'node:child_process'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { checkSkills } from './check-skills.mjs'
import { gradeArtifacts } from './code-style/grade.mjs'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const CASES = JSON.parse(
  fs.readFileSync(path.join(ROOT, 'evals/code-style/cases.json'), 'utf8')
)
const readJSON = file => JSON.parse(fs.readFileSync(file, 'utf8'))
const writeJSON = (file, data) =>
  fs.writeFileSync(file, `${JSON.stringify(data, null, 2)}\n`)

/** Capture fixture files without following generated symlinks. */
export const snapshot = directory => {
  const files = {}
  const walk = current => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      if (['.git', 'node_modules'].includes(entry.name)) continue
      const target = path.join(current, entry.name)
      if (entry.isSymbolicLink())
        throw new Error(`unsupported workspace symlink: ${target}`)
      if (entry.isDirectory()) walk(target)
      else
        files[path.relative(directory, target).split(path.sep).join('/')] =
          fs.readFileSync(target, 'utf8')
    }
  }
  walk(directory)
  return files
}

const writeSnapshot = (directory, files) => {
  fs.mkdirSync(directory, { recursive: true })
  for (const [relative, contents] of Object.entries(files)) {
    const target = path.resolve(directory, relative)
    if (!target.startsWith(`${directory}${path.sep}`))
      throw new Error('snapshot path escapes directory')
    fs.mkdirSync(path.dirname(target), { recursive: true })
    fs.writeFileSync(target, contents)
  }
}

const git = (...args) => {
  const result = spawnSync('git', args, { cwd: ROOT, encoding: 'utf8' })
  if (result.status !== 0)
    throw new Error(result.stderr || 'git command failed')
  return result.stdout
}

const skillSnapshot = ref => {
  if (!ref) return snapshot(path.join(ROOT, 'skills/code-style'))
  const revision = git('rev-parse', '--verify', `${ref}^{commit}`).trim()
  const files = git(
    'ls-tree',
    '-r',
    '--name-only',
    revision,
    '--',
    'skills/code-style'
  )
    .trim()
    .split('\n')
    .filter(Boolean)
  if (!files.includes('skills/code-style/SKILL.md'))
    throw new Error('baseline has no code-style skill')
  return Object.fromEntries(
    files.map(file => [
      file.slice('skills/code-style/'.length),
      git('show', `${revision}:${file}`),
    ])
  )
}

/** Require an explicit model and bound each task; evaluations never retry automatically. */
export const parseOptions = args => {
  const options = { timeout: 300, effort: 'low' }
  const keys = new Set([
    'model',
    'timeout',
    'effort',
    'case',
    'baseline',
    'out',
  ])
  for (let index = 0; index < args.length; index++) {
    const key = args[index].replace(/^--/, '')
    if (['--help', '--list'].includes(args[index])) options[key] = true
    else {
      if (
        !args[index].startsWith('--') ||
        !keys.has(key) ||
        args[index + 1] === undefined ||
        args[index + 1].startsWith('--')
      )
        throw new Error(`invalid option: ${args[index]}`)
      options[key] = args[++index]
    }
  }
  options.timeout = Number(options.timeout)
  if (
    !Number.isInteger(options.timeout) ||
    options.timeout < 10 ||
    options.timeout > 600
  )
    throw new Error('timeout must be an integer between 10 and 600')
  if (!['low', 'medium', 'high'].includes(options.effort))
    throw new Error('invalid reasoning effort')
  if (options.model && !/^[a-zA-Z0-9_.-]+$/.test(options.model))
    throw new Error('invalid model')
  return options
}

/** Run a bounded process and preserve evidence of connection/process failures. */
export const runCommand = (command, args, cwd, timeout) =>
  new Promise(resolve => {
    const child = spawn(command, args, {
      cwd,
      detached: process.platform !== 'win32',
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    let stdout = ''
    let stderr = ''
    let isTimedOut = false
    child.stdout.on('data', chunk => {
      stdout += chunk
    })
    child.stderr.on('data', chunk => {
      stderr += chunk
    })
    const timer = setTimeout(() => {
      isTimedOut = true
      if (child.pid) {
        try {
          process.kill(
            process.platform === 'win32' ? child.pid : -child.pid,
            'SIGKILL'
          )
        } catch {}
      }
    }, timeout * 1000)
    child.on('error', error => {
      clearTimeout(timer)
      resolve({
        stdout,
        stderr: `${stderr}\n${error.message}`,
        exitCode: null,
        infrastructureError: true,
      })
    })
    child.on('close', exitCode => {
      clearTimeout(timer)
      resolve({
        stdout,
        stderr,
        exitCode,
        isTimedOut,
        infrastructureError: isTimedOut || exitCode !== 0,
      })
    })
  })

/** Read only exec JSONL events; an assistant's success claim is not completion evidence. */
export const parseTrace = source => {
  const commands = []
  const messages = []
  let completed = false
  let failed = false
  for (const line of source.split('\n').filter(Boolean)) {
    const event = JSON.parse(line)
    if (event.type === 'turn.completed') completed = true
    if (event.type === 'turn.failed') failed = true
    if (event.type !== 'item.completed') continue
    const item = event.item
    if (
      item?.type === 'command_execution' &&
      item.status === 'completed' &&
      item.exit_code === 0
    )
      commands.push(item.command)
    if (item?.type === 'agent_message') messages.push(item.text)
  }
  return { commands, completed: completed && !failed, messages }
}

/** Reading evidence is a heuristic; assess reasoning and structure manually. */
export const wasRead = (trace, relative) => {
  const target =
    relative === 'SKILL.md' || relative.startsWith('references/')
      ? `.agents/skills/code-style/${relative}`
      : relative
  return trace.commands.some(command =>
    command.split(/&&|\|\||[;\n]/).some(segment => {
      const normalized = segment.replaceAll('\\', '/')
      if (
        !/\b(?:cat|sed|head|tail|nl|bat|awk|rg|python\d*|node)\b/.test(
          segment
        ) ||
        /\brg\s+--files\b/.test(segment)
      )
        return false
      return (
        normalized.includes(target) ||
        (normalized.includes('.agents/skills/code-style/references/*.md') &&
          relative.startsWith('references/'))
      )
    })
  )
}

const disableExternalSkills = () => {
  const paths = new Set()
  const walk = (directory, depth) => {
    if (!fs.existsSync(directory) || depth > 4) return
    const entry = path.join(directory, 'SKILL.md')
    if (fs.existsSync(entry)) {
      paths.add(entry)
      paths.add(fs.realpathSync(entry))
      return
    }
    for (const item of fs.readdirSync(directory, { withFileTypes: true })) {
      const target = path.join(directory, item.name)
      if (
        item.isDirectory() ||
        (item.isSymbolicLink() &&
          fs.existsSync(target) &&
          fs.statSync(target).isDirectory())
      )
        walk(target, depth + 1)
    }
  }
  for (const directory of [
    path.join(os.homedir(), '.agents/skills'),
    path.join(os.homedir(), '.codex/skills'),
    '/etc/codex/skills',
  ])
    walk(directory, 0)
  return `skills.config=[${[...paths].map(file => `{path=${JSON.stringify(file)},enabled=false}`).join(',')}]`
}

/** Prepare an independent fixture with the skill under test, without changing installed skills. */
export const prepareCase = (testCase, skill, options, out) => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'skill-eval-'))
  fs.cpSync(
    path.join(ROOT, 'evals/code-style/fixtures', testCase.fixture),
    workspace,
    { recursive: true }
  )
  if (!fs.existsSync(path.join(workspace, 'package.json')))
    writeJSON(path.join(workspace, 'package.json'), {
      name: 'skill-eval-fixture',
      private: true,
      type: 'module',
    })
  if (
    Object.keys(snapshot(workspace)).some(file => /\.(?:tsx?|vue)$/.test(file))
  ) {
    writeJSON(path.join(workspace, 'tsconfig.json'), {
      compilerOptions: {
        target: 'ES2022',
        module: 'ESNext',
        moduleResolution: 'Bundler',
        jsx: 'react-jsx',
        strict: true,
        allowJs: true,
        noEmit: true,
        esModuleInterop: true,
        skipLibCheck: true,
        types: ['react', 'react-dom'],
      },
      include: ['src/**/*', 'app/**/*', 'env.d.ts'],
    })
    fs.writeFileSync(
      path.join(workspace, 'env.d.ts'),
      'declare module "*.vue" { const component: any; export default component }\n'
    )
  }
  fs.writeFileSync(path.join(workspace, '.gitignore'), 'node_modules\n')
  writeSnapshot(path.join(workspace, '.agents/skills/code-style'), skill)
  fs.symlinkSync(
    path.join(ROOT, 'node_modules'),
    path.join(workspace, 'node_modules'),
    'dir'
  )
  const initialized = spawnSync('git', ['init', '-q', workspace], {
    encoding: 'utf8',
  })
  if (initialized.status !== 0)
    throw new Error(
      initialized.stderr || 'cannot initialize fixture repository'
    )
  fs.mkdirSync(out, { recursive: true })
  writeSnapshot(path.join(out, 'initial'), snapshot(workspace))
  fs.writeFileSync(
    path.join(out, 'prompt.txt'),
    testCase.prompt +
      (testCase.readonly
        ? ''
        : '\n直接修改当前工程。只改任务相关代码，保留现有对外接口。不要安装依赖、修改工程配置、提交代码或访问工程外的私有文件。')
  )
  const state = {
    id: `${options.variant}-${testCase.id}`,
    caseId: testCase.id,
    variant: options.variant,
    workspace,
    model: options.model,
    effort: options.effort,
    revision: git('rev-parse', 'HEAD').trim(),
    baseline: options.baseline || null,
    cliVersion: options.cliVersion,
  }
  writeJSON(path.join(out, 'state.json'), state)
  return state
}

const collectCase = (state, out, execution) => {
  fs.writeFileSync(path.join(out, 'events.jsonl'), execution.stdout)
  fs.writeFileSync(path.join(out, 'stderr.txt'), execution.stderr)
  const metadata = { ...execution, stdout: undefined, stderr: undefined }
  try {
    writeSnapshot(path.join(out, 'generated'), snapshot(state.workspace))
    const diff = spawnSync(
      'git',
      [
        'diff',
        '--no-index',
        '--no-ext-diff',
        '--',
        path.join(out, 'initial'),
        path.join(out, 'generated'),
      ],
      { encoding: 'utf8', maxBuffer: 10 * 1024 * 1024 }
    )
    if (![0, 1].includes(diff.status))
      throw new Error(diff.stderr || 'cannot capture diff')
    fs.writeFileSync(path.join(out, 'diff.patch'), diff.stdout)
  } catch (error) {
    metadata.infrastructureError = true
    metadata.captureError = error.message
  }
  writeJSON(path.join(out, 'execution.json'), metadata)
}

/** Check artifacts and observable behavior; leave subjective quality to human review. */
export const gradeCase = async out => {
  const state = readJSON(path.join(out, 'state.json'))
  const execution = readJSON(path.join(out, 'execution.json'))
  const testCase = CASES.find(item => item.id === state.caseId)
  if (!testCase) throw new Error(`unknown case: ${state.caseId}`)
  const result = { ...state, artifacts: out, checks: [] }
  let dependencyLink
  try {
    const trace = parseTrace(
      fs.readFileSync(path.join(out, 'events.jsonl'), 'utf8')
    )
    if (execution.infrastructureError || !trace.completed) {
      result.status = 'infrastructure-failed'
      result.detail =
        execution.captureError ||
        'agent did not complete; inspect stderr.txt/events.jsonl'
      return result
    }
    const root = path.join(out, 'generated')
    const before = snapshot(path.join(out, 'initial'))
    const after = snapshot(root)
    const changed = [
      ...new Set([...Object.keys(before), ...Object.keys(after)]),
    ].filter(file => before[file] !== after[file])
    result.checks.push({
      name: 'fixture configuration and skill unchanged',
      passed: changed.every(
        file =>
          !file.startsWith('.agents/') &&
          ![
            'package.json',
            'tsconfig.json',
            'env.d.ts',
            '.gitignore',
            '.prettierrc',
          ].includes(file)
      ),
    })
    result.checks.push({
      name: testCase.readonly
        ? 'review does not modify files'
        : 'task modifies source',
      passed: testCase.readonly
        ? changed.length === 0
        : changed.some(file => /^(?:src|app)\//.test(file)),
    })
    const activated = wasRead(trace, 'SKILL.md')
    result.checks.push({
      name: testCase.negative
        ? 'no normative skill activation'
        : 'implicit skill activation observed',
      passed: testCase.negative ? !activated : activated,
    })
    for (const alternatives of testCase.references) {
      const reference = alternatives.find(
        file =>
          before[`.agents/skills/code-style/references/${file}`] !== undefined
      )
      result.checks.push({
        name: `scenario reference read: ${alternatives.join(' or ')}`,
        passed: Boolean(reference && wasRead(trace, `references/${reference}`)),
      })
    }
    if (testCase.readonly)
      result.checks.push({
        name: 'reviewed actual source and returned feedback',
        passed:
          wasRead(
            trace,
            testCase.negative ? 'docs/proposed-skill.md' : 'src/request.ts'
          ) && trace.messages.some(message => message?.trim()),
      })
    const link = path.join(root, 'node_modules')
    if (!fs.existsSync(link)) {
      fs.symlinkSync(path.join(ROOT, 'node_modules'), link, 'dir')
      dependencyLink = link
    }
    result.checks.push(...(await gradeArtifacts(testCase, root)))
    result.status = result.checks.every(check => check.passed)
      ? 'passed'
      : 'behavior-failed'
    result.manual = Boolean(testCase.manual)
  } catch (error) {
    result.status = 'infrastructure-failed'
    result.detail = error.message
  } finally {
    if (dependencyLink) fs.unlinkSync(dependencyLink)
  }
  return result
}

const writeReport = (out, records) => {
  writeJSON(path.join(out, 'report.json'), {
    createdAt: new Date().toISOString(),
    records: records.map(record => ({
      ...record,
      artifacts: path.relative(out, record.artifacts),
    })),
  })
  const lines = [
    '# Skill 评测报告',
    '',
    '自动通过不等于质量合格；请结合原始记录、代码差异完成下方人工复核。',
    '',
    '| 版本 | 用例 | 自动结果 | 产物 |',
    '| --- | --- | --- | --- |',
    ...records.map(
      record =>
        `| ${record.variant} | ${record.caseId} | ${record.status} | [差异](${path.relative(out, record.artifacts)}/diff.patch) |`
    ),
    '',
  ]
  for (const record of records) {
    for (const check of record.checks.filter(item => !item.passed))
      lines.push(
        `- ${record.id}: ${check.name}${check.detail ? ` — ${check.detail.split('\n')[0]}` : ''}`
      )
    if (record.detail)
      lines.push(`- ${record.id}: ${record.detail.split('\n')[0]}`)
  }
  lines.push(
    '',
    '## 人工复核',
    '',
    '- [ ] React / Vue 页面主体结构清晰，抽离有独立职责，子组件与 hook / composable 的关系易读。',
    '- [ ] 代码 review 指出未等待请求导致读取未初始化数据，并给出可操作的说明。',
    '- [ ] 若运行了旧版对比，逐例检查差异，确认改动符合预期且没有新增问题。',
    '',
    '仅复核本次运行的场景。记录判断依据，不为放行忽略失败；单次结果不代表稳定通过。',
    ''
  )
  fs.writeFileSync(path.join(out, 'report.md'), lines.join('\n'))
}

const main = async () => {
  const options = parseOptions(process.argv.slice(2))
  if (options.help) {
    console.log(
      'Usage: pnpm eval:skills --model MODEL [--case ID] [--baseline REF] [--out DIR] [--timeout 300] [--effort low]\n       pnpm eval:skills --list'
    )
    return
  }
  if (options.list) {
    for (const item of CASES) console.log(`${item.id}: ${item.title}`)
    return
  }
  if (!options.model) throw new Error('--model is required')
  const selected = options.case
    ? CASES.filter(item => item.id === options.case)
    : CASES
  if (!selected.length) throw new Error(`unknown case: ${options.case}`)
  const staticResult = checkSkills()
  if (staticResult.errors.length)
    throw new Error(`static checks failed:\n${staticResult.errors.join('\n')}`)
  const version = spawnSync('codex', ['--version'], { encoding: 'utf8' })
  if (version.status !== 0)
    throw new Error(version.stderr || 'codex CLI is unavailable')
  const skills = {
    candidate: skillSnapshot(),
    ...(options.baseline ? { baseline: skillSnapshot(options.baseline) } : {}),
  }
  const out = path.resolve(
    options.out || path.join(ROOT, 'eval-results', `${Date.now()}`)
  )
  if (fs.existsSync(out))
    throw new Error(
      'output directory already exists; do not overwrite prior runs'
    )
  fs.mkdirSync(out, { recursive: true })
  const disabledSkills = disableExternalSkills()
  const records = []
  for (const [variant, skill] of Object.entries(skills)) {
    for (const testCase of selected) {
      const caseOut = path.join(out, `${variant}-${testCase.id}`)
      const state = prepareCase(
        testCase,
        skill,
        { ...options, variant, cliVersion: version.stdout.trim() },
        caseOut
      )
      console.log(`Running ${state.id} (${options.model})`)
      const execution = await runCommand(
        'codex',
        [
          'exec',
          '--ignore-user-config',
          '--ignore-rules',
          '--ephemeral',
          '--json',
          '--color',
          'never',
          '--sandbox',
          testCase.readonly ? 'read-only' : 'workspace-write',
          '--cd',
          state.workspace,
          '--model',
          options.model,
          '-c',
          'project_doc_max_bytes=0',
          '-c',
          'approval_policy="never"',
          '-c',
          `model_reasoning_effort=${JSON.stringify(options.effort)}`,
          '-c',
          disabledSkills,
          fs.readFileSync(path.join(caseOut, 'prompt.txt'), 'utf8'),
        ],
        state.workspace,
        options.timeout
      )
      collectCase(state, caseOut, execution)
      const record = await gradeCase(caseOut)
      records.push(record)
      console.log(`${state.id}: ${record.status}`)
      writeReport(out, records)
      if (record.status === 'infrastructure-failed') {
        console.error(
          `Stopped after infrastructure failure. Report: ${path.join(out, 'report.md')}`
        )
        process.exitCode = 1
        return
      }
    }
  }
  console.log(
    `Report: ${path.join(out, 'report.md')}; review the manual checklist`
  )
  process.exitCode = records.some(
    record => record.variant === 'candidate' && record.status !== 'passed'
  )
    ? 1
    : 0
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
) {
  main().catch(error => {
    console.error(error.message)
    process.exitCode = 1
  })
}
