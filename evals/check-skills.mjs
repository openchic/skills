import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { parseDocument } from 'yaml'

const REPO_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..'
)

/** Read YAML frontmatter without evaluating custom tags or accepting duplicate keys. */
export const readMetadata = source => {
  const match = source.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/)
  if (!match) throw new Error('missing YAML frontmatter')
  const document = parseDocument(match[1], { uniqueKeys: true })
  if (document.errors.length || document.warnings.length) {
    throw new Error(
      [...document.errors, ...document.warnings]
        .map(item => item.message)
        .join('; ')
    )
  }
  const metadata = document.toJS()
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) {
    throw new Error('frontmatter must be an object')
  }
  return metadata
}

/** List regular files, rejecting symlinks so published resources cannot escape the repository. */
export const listFiles = directory => {
  if (!fs.existsSync(directory)) return []
  return fs
    .readdirSync(directory, { withFileTypes: true })
    .flatMap(entry => {
      const target = path.join(directory, entry.name)
      if (entry.isSymbolicLink())
        throw new Error(`symlink is not supported: ${target}`)
      return entry.isDirectory() ? listFiles(target) : [target]
    })
    .sort()
}

/** Validate skill metadata, local documentation links, and README coverage. */
export const checkSkills = (root = REPO_ROOT) => {
  const errors = []
  const names = new Set()
  const report = (file, message) =>
    errors.push(`${path.relative(root, file)}: ${message}`)
  const insideRoot = target =>
    target === root || target.startsWith(`${root}${path.sep}`)
  const skillRoot = path.join(root, 'skills')
  const skillFiles = listFiles(skillRoot)
  const entries = skillFiles.filter(file => path.basename(file) === 'SKILL.md')
  if (!entries.length) errors.push('no skills found')

  for (const file of entries) {
    try {
      const metadata = readMetadata(fs.readFileSync(file, 'utf8'))
      if (
        typeof metadata.name !== 'string' ||
        !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(metadata.name) ||
        metadata.name.length > 64
      ) {
        report(
          file,
          'name must be a lowercase hyphenated identifier, at most 64 characters'
        )
      } else {
        if (names.has(metadata.name))
          report(file, `duplicate name: ${metadata.name}`)
        names.add(metadata.name)
        if (path.basename(path.dirname(file)) !== metadata.name)
          report(file, 'folder must match name')
      }
      if (
        typeof metadata.description !== 'string' ||
        !metadata.description.trim() ||
        metadata.description.length > 1024
      ) {
        report(
          file,
          'description must be a nonempty string, at most 1024 characters'
        )
      }
    } catch (error) {
      report(file, error.message)
    }
  }

  const readme = path.join(root, 'README.md')
  for (const file of [
    ...skillFiles.filter(file => file.endsWith('.md')),
    readme,
  ]) {
    if (!fs.existsSync(file)) {
      report(file, 'missing file')
      continue
    }
    let fence = null
    const prose = []
    for (const [index, line] of fs
      .readFileSync(file, 'utf8')
      .split(/\r?\n/)
      .entries()) {
      if (/\s+$/.test(line))
        report(file, `trailing whitespace on line ${index + 1}`)
      const marker = line.match(/^ {0,3}(`{3,}|~{3,})(.*)$/)
      if (marker) {
        if (!fence)
          fence = {
            character: marker[1][0],
            length: marker[1].length,
            line: index + 1,
          }
        else if (
          marker[1][0] === fence.character &&
          marker[1].length >= fence.length &&
          !marker[2].trim()
        )
          fence = null
      } else if (!fence) prose.push(line)
    }
    if (fence) report(file, `unclosed code fence on line ${fence.line}`)
    const links = [
      ...prose
        .join('\n')
        .matchAll(/\[[^\]]*\]\((?:<([^>]+)>|([^\s)]+))(?:\s+"[^"]*")?\)/g),
    ]
    for (const match of links) {
      const href = match[1] ?? match[2]
      if (/^(?:[a-z][a-z\d+.-]*:|#|\/)/i.test(href)) continue
      try {
        const target = path.resolve(
          path.dirname(file),
          decodeURIComponent(href.split(/[?#]/)[0])
        )
        if (!insideRoot(target) || !fs.existsSync(target))
          report(file, `broken local link: ${href}`)
      } catch {
        report(file, `invalid local link: ${href}`)
      }
    }
  }

  const readmeSource = fs.existsSync(readme)
    ? fs.readFileSync(readme, 'utf8')
    : ''
  const documented = new Set(
    [...readmeSource.matchAll(/\]\((skills\/[^\s)]+\/SKILL\.md)\)/g)].map(
      match => path.resolve(root, match[1])
    )
  )
  for (const file of entries) {
    if (!documented.has(file)) report(file, 'not listed in README')
  }
  return { skills: entries.length, errors }
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
) {
  try {
    const result = checkSkills()
    for (const error of result.errors) console.error(error)
    console.log(
      `${result.skills} skills checked; ${result.errors.length} errors`
    )
    process.exitCode = result.errors.length ? 1 : 0
  } catch (error) {
    console.error(error.message)
    process.exitCode = 1
  }
}
