import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { parse } from 'yaml'

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
export const SKILLS = ['code-style', 'commit', 'vainjs']
const outputRoot = path.join(ROOT, 'eval-results', 'skill-up')
const loadYAML = file => parse(fs.readFileSync(file, 'utf8'), { uniqueKeys: true })
const evalPath = skill => path.join(ROOT, 'skills', skill, 'evals', 'eval.yaml')

const filesUnder = (directory, prefix = '') => {
  const files = {}
  if (!fs.existsSync(directory)) return files
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if (['.git', 'node_modules', 'dist'].includes(entry.name)) continue
    const absolute = path.join(directory, entry.name)
    const relative = path.posix.join(prefix, entry.name)
    if (entry.isSymbolicLink()) throw new Error('Unexpected symlink: ' + absolute)
    if (entry.isDirectory()) Object.assign(files, filesUnder(absolute, relative))
    else files[relative] = fs.readFileSync(absolute, 'utf8')
  }
  return files
}

const hashFiles = files =>
  createHash('sha256')
    .update(
      Object.entries(files)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([name, contents]) => name + '\0' + contents + '\0')
        .join('')
    )
    .digest('hex')

const iterations = directory =>
  (fs.existsSync(directory)
    ? fs.readdirSync(directory, { withFileTypes: true })
    : []
  )
    .filter(entry => entry.isDirectory() && /^iteration-\d+$/.test(entry.name))
    .map(entry => path.join(directory, entry.name))
    .sort((a, b) => Number(path.basename(a).slice(10)) - Number(path.basename(b).slice(10)))

const resultPath = directory => {
  for (const name of ['result.json', 'report.json']) {
    const file = path.join(directory, name)
    if (fs.existsSync(file)) return file
  }
  return null
}

const readRun = directory => {
  if (!directory) return null
  const result = resultPath(directory)
  if (!result) return null
  return {
    directory,
    report: JSON.parse(fs.readFileSync(result, 'utf8')),
    manifest: fs.existsSync(path.join(directory, 'manifest.json'))
      ? JSON.parse(fs.readFileSync(path.join(directory, 'manifest.json'), 'utf8'))
      : null,
  }
}

export const previousRun = output => readRun(iterations(output).at(-1))

export const pilotOptions = args => {
  const options = { skill: null, list: false, validate: false, help: false }
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--list') options.list = true
    else if (args[i] === '--validate') options.validate = true
    else if (args[i] === '--help' || args[i] === '-h') options.help = true
    else if (args[i] === '--skill' && args[i + 1]) options.skill = args[++i]
    else throw new Error('Unknown or incomplete option: ' + args[i])
  }
  if (options.skill && !SKILLS.includes(options.skill))
    throw new Error('Unknown skill: ' + options.skill)
  return options
}

export const comparisonMismatches = (current, previous) =>
  [
    ['skill-up', current.skillUp, previous?.skillUp],
    ['engine', current.engine, previous?.engine],
    ['model', current.model, previous?.model],
    ['Codex CLI', current.codexVersion, previous?.codexVersion],
    ['评测配置、用例或判分器', current.evaluationSHA256, previous?.evaluationSHA256],
  ]
    .filter(([, a, b]) => a === undefined || b === undefined || a !== b)
    .map(([name]) => name)

export const compareEvaluationResults = (current, previous) => {
  const key = item => (item.case_id || '') + ':' + (item.configuration || 'with_skill')
  const old = new Map((previous?.case_results || []).map(item => [key(item), item.status]))
  return (current?.case_results || [])
    .filter(item => (item.configuration || 'with_skill') === 'with_skill')
    .map(item => ({
      caseId: item.case_id,
      current: item.status || 'UNKNOWN',
      previous: old.get(key(item)) || 'MISSING',
    }))
}

const makeManifest = (skill, skillUp) => {
  const skillDir = path.join(ROOT, 'skills', skill)
  const evaluationFiles = {
    ...filesUnder(path.join(skillDir, 'evals')),
    ...filesUnder(path.join(ROOT, 'evals'), 'shared'),
    'pnpm-lock.yaml': fs.readFileSync(path.join(ROOT, 'pnpm-lock.yaml'), 'utf8'),
  }
  const skillFiles = Object.fromEntries(
    Object.entries(filesUnder(skillDir)).filter(([name]) => !name.startsWith('evals/'))
  )
  const codex = spawnSync('codex', ['--version'], { encoding: 'utf8' })
  return {
    skill,
    skillSHA256: hashFiles(skillFiles),
    evaluationSHA256: hashFiles(evaluationFiles),
    skillUp,
    engine: 'codex',
    model: loadYAML(evalPath(skill)).engine.model.name,
    codexVersion: codex.status === 0 ? codex.stdout.trim() : 'unknown',
  }
}

const markdownReport = (skill, current, previous, currentRun, previousRun) => {
  const mismatches = previous
    ? comparisonMismatches(current, previous.manifest)
    : []
  const rows = previous
    ? compareEvaluationResults(currentRun.report, previousRun.report).map(item => {
        const change =
          item.previous === 'MISSING' ? '无历史项'
            : item.current === item.previous ? '无变化'
              : mismatches.length ? '条件不同，无法归因'
                : item.current === 'PASS' ? '改善'
                  : item.previous === 'PASS' ? '退步' : '状态变化'
        return `- ${item.caseId}: ${item.previous} → ${item.current}（${change}）`
      })
    : []
  const previousLink = previousRun
    ? `../${path.basename(previousRun.directory)}/report.html`
    : null
  return [
    `# ${skill} 评测`,
    '',
    `- 当前报告：[report.html](./report.html)`,
    previousLink ? `- 上次报告：[report.html](${previousLink})` : '- 首次运行，建立后续对照。',
    previous ? `- Skill 内容变化：${current.skillSHA256 !== previous.manifest?.skillSHA256 ? '是' : '否'}` : null,
    previous
      ? `- 可比性：${mismatches.length ? '有限；条件不同：' + mismatches.join('、') : '评测条件一致'}`
      : null,
    ...rows,
    '',
    'skill-up HTML 报告包含逐项判分和产物。',
    '',
  ]
    .filter(Boolean)
    .join('\n')
}

const runSkillUp = (args, options = {}) => {
  const result = spawnSync('skill-up', args, {
    cwd: ROOT,
    stdio: 'inherit',
    timeout: options.timeout || 1800000,
  })
  if (result.error) throw result.error
  return result.status ?? 1
}

const main = () => {
  const options = pilotOptions(process.argv.slice(2))
  if (options.help) {
    console.log('pnpm eval:pilot --skill <code-style|commit|vainjs> [--validate] | --list')
    return
  }
  if (options.list) {
    for (const skill of SKILLS) {
      const config = loadYAML(evalPath(skill))
      for (const file of config.cases.files) {
        const testCase = loadYAML(path.join(ROOT, 'skills', skill, file))
        console.log(`${skill}/${testCase.id}: ${testCase.title}`)
      }
    }
    return
  }
  const selected = options.skill ? [options.skill] : SKILLS
  if (!options.validate && !options.skill)
    throw new Error('Choose one skill to run: ' + SKILLS.join(', '))
  const version = spawnSync('skill-up', ['--version'], { encoding: 'utf8' })
  if (version.status !== 0)
    throw new Error('Install skill-up and ensure it is available on PATH')

  let exitCode = 0
  for (const skill of selected) {
    const config = evalPath(skill)
    if (options.validate) {
      exitCode = Math.max(exitCode, runSkillUp(['validate', config]))
      continue
    }

    const output = path.join(outputRoot, skill)
    const previous = previousRun(output)
    const args = ['run', config, '--format', 'html', '--iteration', '0', '--output-dir', output]
    const runExitCode = runSkillUp(args)
    exitCode = Math.max(exitCode, runExitCode)
    const currentDirectory = iterations(output).at(-1)
    const currentRun = readRun(currentDirectory)
    if (!currentRun || currentDirectory === previous?.directory) {
      console.error(`No skill-up result was created for ${skill}`)
      exitCode = 1
      continue
    }
    const manifest = makeManifest(skill, version.stdout.trim())
    fs.writeFileSync(path.join(currentDirectory, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n')
    const previousManifest = previous?.manifest
    const report = markdownReport(
      skill,
      manifest,
      previousManifest ? { ...previousManifest, ...previous.manifest } : null,
      currentRun,
      previous
    )
    fs.writeFileSync(path.join(currentDirectory, 'comparison.md'), report)
    console.log('Comparison: ' + path.join(currentDirectory, 'comparison.md'))
  }
  process.exitCode = exitCode
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    main()
  } catch (error) {
    console.error(error.message)
    process.exitCode = 1
  }
}
