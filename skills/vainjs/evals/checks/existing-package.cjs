#!/usr/bin/env node
const { spawnSync } = require('node:child_process')
// Resolve the package as an ESM consumer from the workspace, not from this file.
const result = spawnSync(
  process.execPath,
  [
    '--input-type=module',
    '-e',
    `
  import assert from 'node:assert/strict'
  import * as kit from 'greeting-kit'
  for (const name of ['World', '', '小明']) {
    assert.equal(kit.greet(name), 'Hello, ' + name + '!')
    assert.equal(kit.farewell(name), 'Goodbye, ' + name + '!')
  }
  console.log('public exports verified: greet, farewell; normal, empty, Chinese inputs')
`,
  ],
  { encoding: 'utf8' }
)
process.stdout.write(result.stdout || '')
process.stderr.write(result.stderr || '')
process.exitCode = result.status ?? 1
