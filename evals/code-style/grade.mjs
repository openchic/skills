import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import vm from 'node:vm'
import { createRequire } from 'node:module'
import { spawnSync } from 'node:child_process'
import { JSDOM } from 'jsdom'
import ts from 'typescript'
import { compileScript, parse, registerTS } from 'vue/compiler-sfc'
import { check as checkFormat } from 'prettier'
import { listFiles } from '../check-skills.mjs'

const require = createRequire(import.meta.url)
registerTS(() => ts)

const getSourceFiles = root =>
  ['src', 'app']
    .flatMap(directory => listFiles(path.join(root, directory)))
    .filter(file => /\.(?:[cm]?js|jsx|ts|tsx|vue)$/.test(file))

/** Load fixture modules with the real framework runtime and TypeScript/SFC compilation.
 * This is a test loader, not a security sandbox; run generated code only in trusted isolated jobs.
 */
export const createLoader = (root, onUtilityCall = () => {}, trackedFiles = []) => {
  const tracked = new Set(trackedFiles.map(file => path.resolve(file)))
  const cache = new Map()
  const resolveFile = target => {
    const candidates = [
      target,
      ...['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.vue'].map(
        ext => target + ext
      ),
      ...[
        'index.ts',
        'index.tsx',
        'index.js',
        'index.jsx',
        'index.mjs',
        'index.cjs',
        'index.vue',
      ].map(file => path.join(target, file)),
    ]
    const file = candidates.find(
      item => fs.existsSync(item) && fs.statSync(item).isFile()
    )
    assert.ok(file, `module not found: ${target}`)
    assert.ok(
      file.startsWith(`${root}${path.sep}`),
      'fixture import escapes workspace'
    )
    return file
  }
  const load = target => {
    const file = resolveFile(target)
    if (cache.has(file)) return cache.get(file).exports
    let source = fs.readFileSync(file, 'utf8')
    if (file.endsWith('.vue')) {
      const { descriptor, errors } = parse(source, { filename: file })
      assert.equal(errors.length, 0, 'invalid Vue SFC')
      source = compileScript(descriptor, {
        id: file,
        inlineTemplate: true,
      }).content
    }
    const compiled = ts.transpileModule(source, {
      fileName: file.endsWith('.vue')
        ? `${file}.ts`
        : file.replace(/\.[cm]js$/, '.js'),
      compilerOptions: {
        target: ts.ScriptTarget.ES2022,
        module: ts.ModuleKind.CommonJS,
        jsx: ts.JsxEmit.ReactJSX,
        esModuleInterop: true,
      },
      reportDiagnostics: true,
    })
    assert.equal(
      compiled.diagnostics?.filter(
        item => item.category === ts.DiagnosticCategory.Error
      ).length,
      0,
      'syntax compilation failed'
    )
    const module = { exports: {} }
    cache.set(file, module)
    const localRequire = specifier => {
      if (['react', 'react/jsx-runtime', 'vue'].includes(specifier))
        return require(specifier)
      assert.ok(
        specifier.startsWith('.'),
        `unsupported fixture dependency: ${specifier}`
      )
      return load(path.resolve(path.dirname(file), specifier))
    }
    vm.runInNewContext(
      compiled.outputText,
      {
        module,
        exports: module.exports,
        require: localRequire,
        console,
        setTimeout,
        clearTimeout,
      },
      { filename: file, timeout: 1000 }
    )
    if (
      file.startsWith(`${path.join(root, 'src/utils')}${path.sep}`) ||
      tracked.has(file)
    ) {
      const wrappers = new Map()
      module.exports = new Proxy(module.exports, {
        get: (object, key) => {
          const value = Reflect.get(object, key)
          if (typeof value !== 'function') return value
          if (!wrappers.has(value))
            wrappers.set(value, (...args) => {
              onUtilityCall()
              return value(...args)
            })
          return wrappers.get(value)
        },
      })
    }
    return module.exports
  }
  return load
}

const ensureDOM = () => {
  if (globalThis.document) return
  const dom = new JSDOM('<!doctype html><html><body></body></html>', {
    url: 'http://localhost/',
  })
  globalThis.window = dom.window
  globalThis.document = dom.window.document
  globalThis.HTMLElement = dom.window.HTMLElement
  globalThis.Element = dom.window.Element
  globalThis.SVGElement = dom.window.SVGElement
  Object.defineProperty(globalThis, 'navigator', {
    value: dom.window.navigator,
    configurable: true,
  })
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
}

const checkTypes = root => {
  const config = ts.readConfigFile(
    path.join(root, 'tsconfig.json'),
    ts.sys.readFile
  )
  assert.ok(!config.error, 'cannot read tsconfig.json')
  const parsed = ts.parseJsonConfigFileContent(config.config, ts.sys, root)
  const program = ts.createProgram(parsed.fileNames, parsed.options)
  const errors = [
    ...parsed.errors,
    ...ts.getPreEmitDiagnostics(program),
  ].filter(item => item.category === ts.DiagnosticCategory.Error)
  assert.equal(
    errors.length,
    0,
    ts.formatDiagnosticsWithColorAndContext(errors, {
      getCanonicalFileName: file => file,
      getCurrentDirectory: () => root,
      getNewLine: () => '\n',
    })
  )
}

/** Verify initial rendering, input interaction, and a changing request-driving prop. */
export const checkPageBehavior = async (root, framework) => {
  ensureDOM()
  const load = createLoader(root)
  const container = document.createElement('div')
  document.body.append(container)
  const names = () =>
    [...container.querySelectorAll('li')].map(item => item.textContent)
  const changeSearch = value => {
    const input = container.querySelector('input[aria-label="Search"]')
    assert.ok(input, 'search control missing')
    Object.getOwnPropertyDescriptor(
      window.HTMLInputElement.prototype,
      'value'
    ).set.call(input, value)
    input.dispatchEvent(new window.Event('input', { bubbles: true }))
    input.dispatchEvent(new window.Event('change', { bubbles: true }))
  }
  if (framework === 'react') {
    const { createElement, act } = require('react')
    const { createRoot } = require('react-dom/client')
    const Component = load(
      path.join(root, 'src/pages/UserList/index.tsx')
    ).default
    const app = createRoot(container)
    try {
      await act(async () => {
        app.render(createElement(Component, { teamId: 'a' }))
      })
      assert.deepEqual(names(), ['Alice', 'Aaron'])
      await act(async () => {
        changeSearch('alice')
      })
      assert.deepEqual(names(), ['Alice'])
      await act(async () => {
        changeSearch('')
      })
      await act(async () => {
        app.render(createElement(Component, { teamId: 'b' }))
      })
      assert.deepEqual(names(), ['Bob'], 'teamId changes must update requests')
    } finally {
      await act(async () => {
        app.unmount()
      })
      container.remove()
    }
  } else {
    const { createApp, h, ref, nextTick } = require('vue')
    const Component = load(
      path.join(root, 'src/pages/UserList/index.vue')
    ).default
    const teamId = ref('a')
    const app = createApp({
      setup: () => () => h(Component, { teamId: teamId.value }),
    })
    const flush = async () => {
      await nextTick()
      await new Promise(resolve => setImmediate(resolve))
      await nextTick()
    }
    try {
      app.mount(container)
      await flush()
      assert.deepEqual(names(), ['Alice', 'Aaron'])
      changeSearch('alice')
      await flush()
      assert.deepEqual(names(), ['Alice'])
      changeSearch('')
      teamId.value = 'b'
      await flush()
      assert.deepEqual(names(), ['Bob'], 'teamId changes must remain reactive')
    } finally {
      app.unmount()
      container.remove()
    }
  }
}

const renderText = (load, file, props = {}) => {
  ensureDOM()
  const { createElement } = require('react')
  const { renderToStaticMarkup } = require('react-dom/server')
  const container = document.createElement('div')
  container.innerHTML = renderToStaticMarkup(
    createElement(load(file).default, props)
  )
  return container.textContent
}

const checkSharedUtils = (root, extension) => {
  const directory = path.join(root, 'src/utils')
  const extensions =
    extension === 'ts'
      ? ['ts', 'tsx', 'js', 'jsx', 'mjs', 'cjs']
      : ['js', 'mjs', 'cjs']
  const entry = extensions
    .map(ext => path.join(directory, `index.${ext}`))
    .find(file => fs.existsSync(file))
  assert.ok(
    entry,
    'shared utils must expose an index entry appropriate to the project language and module system'
  )
  assert.ok(
    listFiles(directory).some(
      file => file !== entry && /\.(?:[cm]?js|jsx|ts|tsx)$/.test(file)
    ),
    'shared utility implementations need a responsibility file, not only a barrel'
  )
  const exports = createLoader(root)(entry)
  assert.ok(!('default' in exports), 'shared utilities use named exports')
  assert.ok(
    Object.values(exports).some(value => typeof value === 'function'),
    'no utility exported'
  )
  for (const file of getSourceFiles(root).filter(
    file => !file.startsWith(`${directory}${path.sep}`)
  )) {
    const source = ts.createSourceFile(
      file,
      fs.readFileSync(file, 'utf8'),
      ts.ScriptTarget.Latest,
      true
    )
    const visit = node => {
      const specifier = ts.isImportDeclaration(node)
        ? node.moduleSpecifier
        : ts.isCallExpression(node) &&
            node.expression.getText(source) === 'require'
          ? node.arguments[0]
          : undefined
      if (
        specifier &&
        ts.isStringLiteral(specifier) &&
        specifier.text.startsWith('.')
      ) {
        const target = path.resolve(path.dirname(file), specifier.text)
        if (
          target === directory ||
          target.startsWith(`${directory}${path.sep}`)
        ) {
          assert.ok(
            target === directory ||
              /^index\.(?:[cm]?js|jsx|ts|tsx)$/.test(path.basename(target)) ||
              path.basename(target) === 'index',
            'consumer bypasses public utils entry'
          )
          if (ts.isImportDeclaration(node)) {
            assert.ok(
              !node.importClause?.name,
              'utility import must be named, not default'
            )
          }
        }
      }
      ts.forEachChild(node, visit)
    }
    visit(source)
  }
  return exports
}

/** Grade artifacts and executable behavior; wording and component counts are not quality scores. */
export const gradeArtifacts = async (testCase, root) => {
  const checks = []
  const check = async (name, action) => {
    try {
      await action()
      checks.push({ name, passed: true })
    } catch (error) {
      checks.push({ name, passed: false, detail: error.message })
    }
  }
  if (testCase.readonly) return checks
  if (getSourceFiles(root).some(file => /\.tsx?$/.test(file))) {
    await check('TypeScript/TSX type check', () => checkTypes(root))
  }
  if (['react-page', 'vue-page'].includes(testCase.id)) {
    const framework = testCase.id === 'react-page' ? 'react' : 'vue'
    await check('private state logic extracted', () => {
      const directory = framework === 'react' ? 'hooks' : 'composables'
      assert.ok(
        listFiles(path.join(root, 'src/pages/UserList', directory)).some(file =>
          /^use[A-Z].*\.[jt]s$/.test(path.basename(file))
        ),
        'no responsibility-specific state unit'
      )
    })
    await check('rendering, search, and changing props', () =>
      checkPageBehavior(root, framework)
    )
  }
  if (testCase.id === 'frontend-utils') {
    await check('shared public utils and private ownership', () => {
      const exports = checkSharedUtils(root, 'ts')
      assert.ok(
        !('formatOrderStatus' in exports),
        'page-private helper exposed as shared'
      )
      assert.ok(
        !listFiles(path.join(root, 'src/utils')).some(file =>
          fs.readFileSync(file, 'utf8').includes('Overdue')
        ),
        'order-only business logic moved to shared utils'
      )
    })
    await check('both page outputs preserved', () => {
      let calls = 0
      const load = createLoader(root, () => {
        calls++
      })
      assert.match(
        renderText(load, path.join(root, 'src/pages/Orders/index.tsx'), {
          amount: 10,
          isOverdue: true,
        }),
        /USD 10\.00.*Overdue/
      )
      assert.ok(calls > 0, 'Orders does not use the shared utility')
      calls = 0
      assert.match(
        renderText(load, path.join(root, 'src/pages/Refunds/index.tsx'), {
          amount: 5,
        }),
        /USD 5\.00/
      )
      assert.ok(calls > 0, 'Refunds does not use the shared utility')
    })
  }
  if (testCase.id === 'node-utils') {
    await check('JavaScript index and private ownership', () => {
      const exports = checkSharedUtils(root, 'js')
      assert.ok(
        !('maskEmail' in exports),
        'private profile logic exposed as shared'
      )
    })
    await check('Node public exports and behavior preserved', () => {
      let calls = 0
      const load = createLoader(root, () => {
        calls++
      })
      const profile = load(
        path.join(root, 'src/user-profile/index.js')
      ).getUserProfile(' Alice@EXAMPLE.COM ')
      assert.deepEqual(JSON.parse(JSON.stringify(profile)), {
        email: 'alice@example.com',
        masked: 'a***@example.com',
      })
      assert.ok(calls > 0, 'user-profile does not use the shared utility')
      calls = 0
      const emails = load(
        path.join(root, 'src/email-report/index.js')
      ).getEmailReport([' A@B.COM ', ' C@D.COM '])
      assert.deepEqual(Array.from(emails), ['a@b.com', 'c@d.com'])
      assert.ok(calls > 0, 'email-report does not use the shared utility')
    })
    await check('native Node ESM resolution and execution', () => {
      const source = `
        const profile = await import(${JSON.stringify(path.join(root, 'src/user-profile/index.js'))})
        const report = await import(${JSON.stringify(path.join(root, 'src/email-report/index.js'))})
        console.log(JSON.stringify([profile.getUserProfile(' Alice@EXAMPLE.COM '),
          report.getEmailReport([' A@B.COM ', ' C@D.COM '])]))
      `
      const result = spawnSync(
        process.execPath,
        ['--input-type=module', '-e', source],
        { cwd: root, encoding: 'utf8', timeout: 10000, env: {} }
      )
      assert.equal(result.status, 0, result.stderr)
      assert.deepEqual(JSON.parse(result.stdout), [
        { email: 'alice@example.com', masked: 'a***@example.com' },
        ['a@b.com', 'c@d.com'],
      ])
    })
  }
  if (testCase.id === 'file-routing') {
    await check('framework routes and page output preserved', () => {
      assert.ok(fs.existsSync(path.join(root, 'app/dashboard/page.tsx')))
      assert.ok(fs.existsSync(path.join(root, 'app/layout.tsx')))
      const text = renderText(
        createLoader(root),
        path.join(root, 'app/dashboard/page.tsx')
      )
      assert.ok(text.includes('Dashboard') && text.includes('Users'))
      assert.ok(
        text.includes('Showing 2 records'),
        'new count is not rendered from records'
      )
    })
  }
  if (testCase.id === 'project-config') {
    await check('native Node CommonJS resolution and execution', () => {
      const result = spawnSync(
        process.execPath,
        [
          '-e',
          `
        const users = require('./src/users.js')
        const reports = require('./src/reports.js')
        console.log(JSON.stringify([users.formatUserName(' alice '), reports.formatReportTitle(' monthly ')]))
      `,
        ],
        { cwd: root, encoding: 'utf8', timeout: 10000, env: {} }
      )
      assert.equal(result.status, 0, result.stderr)
      assert.deepEqual(JSON.parse(result.stdout), ['Alice', 'Monthly'])
    })
    await check('CommonJS interface and behavior preserved', () => {
      checkSharedUtils(root, 'js')
      let calls = 0
      const load = createLoader(root, () => {
        calls++
      })
      assert.equal(
        load(path.join(root, 'src/users.js')).formatUserName(' alice '),
        'Alice'
      )
      assert.ok(calls > 0, 'users does not use the shared utility')
      calls = 0
      assert.equal(
        load(path.join(root, 'src/reports.js')).formatReportTitle(' monthly '),
        'Monthly'
      )
      assert.ok(calls > 0, 'reports does not use the shared utility')
      assert.ok(
        !getSourceFiles(root).some(file => /\.tsx?$/.test(file)),
        'existing JavaScript project converted to TS'
      )
    })
    await check('existing formatter configuration wins', async () => {
      const options = JSON.parse(
        fs.readFileSync(path.join(root, '.prettierrc'), 'utf8')
      )
      for (const file of getSourceFiles(root)) {
        assert.ok(
          await checkFormat(fs.readFileSync(file, 'utf8'), {
            ...options,
            filepath: file,
          }),
          `does not follow project formatter: ${path.relative(root, file)}`
        )
        assert.ok(
          !/\b(?:import|export)\s/.test(fs.readFileSync(file, 'utf8')),
          'CommonJS replaced with ESM'
        )
      }
    })
  }
  return checks
}
