import fs from 'node:fs'
import { spawnSync } from 'node:child_process'
import { codexArguments, prepareWorkspace } from './pilot-runtime.mjs'

const args = process.argv.slice(2)
try {
  const binary = process.env.SKILL_EVAL_CODEX_BINARY
  if (!binary) throw new Error('Missing original Codex executable')
  if (args[0] === 'exec') {
    const directory = prepareWorkspace(process.cwd(), process.env.SKILL_EVAL_CASE,
      process.env.SKILL_EVAL_EVIDENCE, args[1] === 'resume')
    const forwarded = codexArguments(args, process.env.SKILL_EVAL_EFFORT,
      process.env.SKILL_EVAL_CASE === 'npm-package')
    fs.appendFileSync(directory + '/invocations.jsonl', JSON.stringify(forwarded) + '\n')
    const result = spawnSync(binary, forwarded, { stdio: 'inherit', maxBuffer: 64 * 1024 * 1024 })
    process.exitCode = result.status ?? 1
  } else {
    const result = spawnSync(binary, args, { stdio: 'inherit' })
    process.exitCode = result.status ?? 1
  }
} catch (error) {
  console.error(error.message)
  process.exitCode = 1
}
