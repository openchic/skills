#!/usr/bin/env node
const assert = require('node:assert/strict')
const { test } = require('node:test')
const { formatUser } = require(process.cwd() + '/src/users.js')
const { formatReport } = require(process.cwd() + '/src/reports.js')

for (const [input, expected] of [
  ['  Ada   Lovelace  ', 'Ada Lovelace'],
  ['\t月度\n\n报告\t', '月度 报告'],
  ['', ''],
  [' \t\n', ''],
  ['a\u00a0b', 'a b'],
]) {
  test(`public formatters preserve ${JSON.stringify(input)}`, () => {
    assert.equal(formatUser(input), expected)
    assert.equal(formatReport(input), expected)
  })
}
