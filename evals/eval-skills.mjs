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
  String(value ?? 'No evidence recorded')
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
          (judge.result?.assertion_results || [{ text: 'Execution result' }]).map(
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
        ? gates.configured_rules?.join(', ')
        : gates.failures?.map(failure => failure.detail ?? failure).join(' · '),
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
      if (item?.status === 'ERROR') return 'Execution error'
      if (item?.gates?.passed === false) return 'Skipped after a failed pre-check'
      return 'No check result'
    }
    return `${check.passed ? 'Passed' : 'Failed'} — ${cell(check.evidence)}`
  }
  const rows = [...new Set([...old.keys(), ...currentCases.keys()])].flatMap(
    id => {
      const item = currentCases.get(id)
      const prior = old.get(id)
      const before = checks(prior)
      const after = checks(item)
      const names = [...new Set([...before.keys(), ...after.keys()])]
      if (!names.length) names.push('Execution result')
      return names.map(name => {
        const a = before.get(name)
        const b = after.get(name)
        let change = 'Inconclusive'
        if (!previous) change += ' — first run'
        else if (prior?.status === 'ERROR' || item?.status === 'ERROR')
          change += ' — execution error'
        else if (
          name !== 'expect' &&
          (prior?.gates?.passed === false || item?.gates?.passed === false)
        )
          change += ' — judging skipped after a failed pre-check'
        else if (!prior || !item || !a || !b) change += ' — coverage added or removed'
        else if (!sameConditions) change += ' — conditions changed or records are incomplete'
        else if (
          typeof a.passed !== 'boolean' ||
          typeof b.passed !== 'boolean' ||
          !a.evidence?.trim() ||
          !b.evidence?.trim()
        )
          change += ' — missing result or evidence'
        else if (a.passed === b.passed)
          change = 'No observed change — outcomes match, review the artifacts'
        else if (!skillChanged) change += ' — outcomes differ with the same skill'
        else change = `${b.passed ? 'Improvement' : 'Regression'} — single-run signal, verify the evidence`
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
    `# ${current.result.skill_name} evaluation comparison`,
    '',
    `[Current report](${link(current)})${previous ? ` · [Previous report](${link(previous)})` : ''}`,
    '',
    previous
      ? sameConditions
        ? 'The recorded evaluation conditions match.'
        : 'Evaluation conditions changed or records are incomplete. Attribution to the skill change is inconclusive.'
      : 'This is the first recorded run. Treat checks with execution errors as inconclusive when establishing a baseline.',
    '',
    current.manifest?.skillSHA256 && previous?.manifest?.skillSHA256
      ? `The skill content ${current.manifest.skillSHA256 === previous.manifest.skillSHA256 ? 'is unchanged' : 'has changed'}.`
      : '',
    '',
    '| Case / check | Previous evidence | Current evidence | Change |',
    '| --- | --- | --- | --- |',
    ...rows,
    '',
    'Conclusions use individual Skill-Up checks. Treat changes from a single run as signals. Compare artifacts even when outcomes match. A problem remains if the check fails in both runs.',
    'Review the diffs, execution records, and artifacts from both runs. Verify which skill was loaded and check for environment differences or other skills with the same name. Repeat checks when model results fluctuate.',
    '',
  ].join('\n')
}

/** Delegate execution to the global CLI and add the previous-run comparison. */
export const runEvaluation = (skillDirectory, outputDirectory) => {
  const config = path.join(skillDirectory, 'evals/eval.yaml')
  if (!fs.existsSync(config)) throw new Error('Missing eval config: ' + config)
  const version = spawnSync('skill-up', ['--version'], { encoding: 'utf8' })
  if (version.status !== 0)
    throw new Error('Install Skill-Up globally and make sure skill-up is on PATH')
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
    throw new Error('Skill-Up did not produce a new result.json')
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
  console.log('Comparison report saved to ' + comparison)
  console.log('Detailed report saved to ' + path.join(current.directory, 'report.html'))
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
        'Run pnpm eval:skills <skill>. For example, pnpm eval:skills code-style.'
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
