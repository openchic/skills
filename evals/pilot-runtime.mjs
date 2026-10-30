import fs from 'node:fs'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'

export const writeJSON = (file, value) => {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, JSON.stringify(value, null, 2) + '\n')
}

/** Record source files, rejecting links other than the dependency directory. */
export const captureFiles = (directory) => {
  const files = {}
  const walk = (current) => {
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

export const evidenceDirectory = (root, workspace) => path.join(root,
  createHash('sha256').update(fs.realpathSync(workspace)).digest('hex').slice(0, 16))

export const git = (workspace, ...args) => {
  const result = spawnSync('git', args, { cwd: workspace, encoding: 'utf8', timeout: 10000 })
  if (result.status !== 0) throw new Error(result.stderr || 'git failed')
  return result.stdout.trim()
}

/** Prepare an isolated fixture before the agent starts; setup is excluded from agent traces. */
export const prepareWorkspace = (workspace, caseId, evidenceRoot, resume = false) => {
  const directory = evidenceDirectory(evidenceRoot, workspace)
  const beforeFile = path.join(directory, 'before.json')
  fs.mkdirSync(directory, { recursive: true })
  if (!fs.existsSync(beforeFile)) {
    git(workspace, 'init', '-q')
    git(workspace, 'config', 'user.name', 'Fixture User')
    git(workspace, 'config', 'user.email', 'fixture@example.invalid')
    git(workspace, 'config', 'commit.gpgsign', 'false')
    fs.appendFileSync(path.join(workspace, '.git/info/exclude'), '\n.agents/\n.codex/\nnode_modules/\ndist/\n')
    git(workspace, 'add', '-A')
    git(workspace, 'commit', '-qm', 'test: seed fixture')
    const initialHead = git(workspace, 'rev-parse', 'HEAD')
    if (caseId === 'commit-confirmation') {
      fs.writeFileSync(path.join(workspace, 'src/title.js'), 'export const title = value => value.trim().toUpperCase()\n')
      fs.writeFileSync(path.join(workspace, 'src/version.js'), 'export const version = "1.0.0"\n')
      fs.appendFileSync(path.join(workspace, 'README.md'), '\nTitles are normalized to uppercase.\n')
    }
    writeJSON(beforeFile, { caseId, workspace, initialHead, files: captureFiles(workspace) })
  }
  const event = { resume, head: git(workspace, 'rev-parse', 'HEAD'), status: git(workspace, 'status', '--porcelain') }
  fs.appendFileSync(path.join(directory, 'boundaries.jsonl'), JSON.stringify(event) + '\n')
  return directory
}

/** Keep resumed Codex runs sandboxed and apply the requested reasoning setting explicitly. */
export const codexArguments = (args, effort, network = false) => {
  if (args[0] !== 'exec') return args
  const forwarded = args.slice(1).filter((value) => value !== '--dangerously-bypass-approvals-and-sandbox')
  return ['exec', '--ignore-user-config', '--ignore-rules',
    '-c', 'model_reasoning_effort=' + JSON.stringify(effort),
    '-c', 'approval_policy="never"', '-c', 'sandbox_mode="workspace-write"',
    '-c', 'sandbox_workspace_write.network_access=' + Boolean(network), ...forwarded]
}
