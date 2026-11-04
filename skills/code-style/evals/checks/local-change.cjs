#!/usr/bin/env node
const assert = require('node:assert/strict')
const { formatReceipt } = require(process.cwd() + '/src/receipt.js')
for (const [amount, expected] of [
  [3, 'Total: $3.00'],
  [0, 'Total: $0.00'],
  [1.25, 'Total: $1.25'],
]) {
  assert.equal(formatReceipt(amount), expected, `amount=${amount}`)
}
console.log('receipt cases verified: integer, zero, decimal')
