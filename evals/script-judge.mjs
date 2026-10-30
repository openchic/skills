import fs from 'node:fs'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'

// The worker contains generated-code execution. A process deadline also covers calls made
// after module loading, which a VM's module-evaluation timeout cannot bound.
const result = await new Promise((resolve) => {
  const child = spawn(process.execPath, [path.join(path.dirname(fileURLToPath(import.meta.url)), 'pilot-grade.mjs')], {
    cwd: process.cwd(), env: process.env, detached: true, stdio: ['ignore', 'pipe', 'pipe'],
  })
  let stdout = ''
  let stderr = ''
  let failure
  const stop = (reason) => {
    failure = reason
    if (child.pid) {
      try { process.kill(-child.pid, 'SIGKILL') } catch {}
    }
  }
  const interrupted = () => stop(new Error('Judge interrupted'))
  process.once('SIGTERM', interrupted)
  process.once('SIGINT', interrupted)
  const timer = setTimeout(() => stop(new Error('Judge execution timed out')),
    Number(process.env.SKILL_EVAL_JUDGE_TIMEOUT_MS || 25000))
  child.stdout.on('data', (chunk) => {
    stdout += chunk
    if (stdout.length > 4 * 1024 * 1024) stop(new Error('Judge output limit exceeded'))
  })
  child.stderr.on('data', (chunk) => { stderr = (stderr + chunk).slice(-4000) })
  const complete = () => {
    clearTimeout(timer)
    process.removeListener('SIGTERM', interrupted)
    process.removeListener('SIGINT', interrupted)
    resolve({ stdout, stderr, error: failure })
  }
  child.on('error', (error) => { failure = error; complete() })
  child.on('close', complete)
})
let grading
try {
  if (result.error) throw result.error
  grading = JSON.parse(result.stdout)
} catch (error) {
  grading = { status: 'infrastructure-failed', checks: [], detail: error.message,
    stderr: result.stderr.slice(-4000) }
}
process.stdout.write(JSON.stringify(grading) + '\n')
process.exitCode = grading.status === 'passed' ? 0 : 1
