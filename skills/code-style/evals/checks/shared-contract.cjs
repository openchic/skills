#!/usr/bin/env -S node --experimental-strip-types
const assert = require('node:assert/strict')
const { test } = require('node:test')
const { pathToFileURL } = require('node:url')
const entry = pathToFileURL(process.cwd() + '/src/users.ts').href

test('user options preserve the client contract and do not mutate users', async () => {
  const { loadUsers, loadUserOptions } = await import(entry)
  const users = Object.freeze([
    Object.freeze({ id: 'a', name: '小明', isActive: true, email: 'a@test' }),
    Object.freeze({
      id: 'b',
      name: 'Hidden',
      isActive: false,
      email: 'b@test',
    }),
    Object.freeze({ id: 'c', name: '', isActive: true, email: 'c@test' }),
  ])
  let calls = 0
  const client = {
    get: async path => {
      assert.equal(path, '/users')
      calls++
      return users
    },
  }
  assert.deepEqual(await loadUserOptions(client), [
    { id: 'a', name: '小明' },
    { id: 'c', name: '' },
  ])
  assert.equal(calls, 1)
  assert.equal(await loadUsers(client), users)
})

test('empty and inactive lists produce no options', async () => {
  const { loadUserOptions } = await import(entry)
  assert.deepEqual(await loadUserOptions({ get: async () => [] }), [])
  assert.deepEqual(
    await loadUserOptions({
      get: async () => [
        { id: 'b', name: 'B', isActive: false, email: 'b@test' },
      ],
    }),
    []
  )
})
