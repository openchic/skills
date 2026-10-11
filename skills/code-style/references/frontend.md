# Frontend Conventions

These conventions apply across frontend frameworks. React and Vue 3 have separate sections for framework-specific rules.

## Module Organization

- Use PascalCase for component names and directories, including page components, shared components, and module-private components. Each standalone component's directory name must match its component name.
- Use `index` as the base name for module and component public entry files. Choose the extension according to the project's language, framework, and file responsibilities, such as `index.ts`, `index.tsx`, `index.js`, `index.jsx`, or `index.vue`.
- For file-based routing, follow the framework's required route directory names and page entry filenames. These requirements take precedence over this document's PascalCase directory naming and `index` entry naming.
- Place shared components in the shared `components/` directory and page-private components in the page module's own `components/` directory. Keep page-private code inside the page module; do not create detached sibling directories for it.
- Keep component styles in the same directory as the component.

## Directory Structure Example

The filenames below illustrate a TypeScript React Web project; the same directory organization applies to Vue and other frontend projects. Use the project's existing source root and create directories and files only as needed.

```text
src/
├── components/
│   ├── index.ts              # Public shared-component exports
│   └── UserCard/
│       ├── index.tsx
│       └── index.module.less
├── hooks/
│   ├── index.ts              # Public shared-hook exports
│   └── usePagination.ts      # Shared reusable logic
├── utils/
│   ├── index.ts              # Public shared-utility exports
│   └── formatDate.ts         # Utility reused across modules
└── pages/
    └── UserList/
        ├── index.tsx         # Page component entry
        ├── api.ts            # Page requests
        ├── components/
        │   └── UserFilter/
        │       └── index.tsx
        └── hooks/
            └── useUserList.ts
```

Match style extensions to the project's preprocessor, and use the corresponding framework's `hooks/` or `composables/` directory for reusable logic.

## Request Wrappers

- Frontend request wrappers send requests and pass parameters. The caller handles business data transformations, page state updates, and rendering logic.
- Follow the project's existing convention for request file locations. For centralized organization, use `services/` and split files by business domain. For page-level organization, place the request entry at the page module root, alongside the page component entry.

## Application Module Files

These file responsibilities apply to page and business modules. In `index.<ext>`, `<ext>` follows the entry-file convention above. The other examples use TypeScript filenames; use the corresponding project extensions for other languages.

| File | Responsibility |
| --- | --- |
| `index.<ext>` | Public module entry; export the entry component or aggregate public exports as appropriate |
| `api.ts` | Page-level request entry; prefer this filename in TypeScript projects |
| `type.ts` | Module types |
| `enum.ts` | Enums and their associated `*_MAP` display mappings |
| `text.ts` | Optional module-level copy entry for internationalized projects, referenced as `TEXT` |
| `utils.ts` | Module-private pure functions and data transformations |

## Components

- Keep the page component's JSX or template structure intact. Avoid breaking it into overly granular child components; extract a child component only when it is sufficiently complex to justify being separated. Prefer hooks or composables to separate logic by responsibility. Keep the page component as the entry point so the page structure and the relationships among its child components and hooks or composables remain clear.
- When declaring component exports in JavaScript or TypeScript, use default exports for page and business-module entry components. Expose shared components as named exports through their public `index` entry, following the JS/TS module conventions. Preserve export interfaces used by existing consumers.
- Keep component-specific pure functions and constants close to their consumers. Extract reusable code into files with the corresponding responsibilities.
- Expose imperative component interfaces through the framework's ref or component-exposure mechanism, following the project's convention.
- In TypeScript, name props and ref-handle types `XProps` and `XRef`.

## JSX

These rules apply when using JSX or TSX with any frontend framework.

- Use double quotes for JSX string attributes. For multiline, non-self-closing tags, place `>` on the last attribute's line. Let the formatter handle `/>` for self-closing tags.
- For single-branch conditional rendering, use an explicit boolean condition with `&&`.

## Hooks and Composables

- Hooks and composables encapsulate state and side effects; components handle composition and rendering.
- Prefix hook and composable names with `use`, match each filename to its function name, and keep one hook or composable per file.
- In TypeScript, name hook and composable configuration types `UseXxxOptions`; local private configuration types may use `Options`.
- Prefer existing project hooks, composables, and utilities. If no suitable implementation exists, use the framework's built-in primitives for the current need; do not introduce dependencies merely to satisfy style requirements.
- Use an options object for multiple configuration fields; positional parameters are acceptable for a small, fixed set of inputs. Return an object, or a readonly tuple for paired values and operations. Preserve the framework's reactivity when exposing state.
- Track inputs that drive recomputation or requests with the framework's dependency or reactive tracking mechanisms. Keep changes to those inputs observable.
- When mount-time or deep-comparison logic is needed, prefer existing project implementations.
- Prefer the project's existing no-op function for default callbacks. Use a no-op error handler only when ignoring errors is explicitly allowed.

## Import Order

In frontend application modules, order the groups that are actually present.

Types only → framework → utility libraries → platform/UI libraries → request modules → local utilities and components → enums → internationalized copy, if any → styles.

## Web Page Layout

Prefer HTML elements that match the content's semantics. Use `div` for layout-only containers.

## Web Styles

- Use kebab-case for selectors. Use `&-` to append suffixes when the preprocessor supports nesting.
- Prefer existing design tokens for colors, spacing, and font sizes, with type-compatible fallback values such as `var(--color-text, #333)` or `var(--spacing, 16px)`.
- Keep third-party style overrides scoped to the current component, using the mechanism supported by the project's framework and styling tools. Avoid unscoped global overrides.
- Inline styles are acceptable for one-off dynamic dimensions. Extract repeated styles into style files or shared constants.
- Keep conditional class-name expressions consistent within a module.

### External CSS Modules

Apply these rules when importing CSS Modules from separate stylesheet files.

- Import them as `styles` and use `index.module.less` as the filename. Change only the extension when using another preprocessor or plain CSS.
- When overriding third-party component classes in a CSS Module, place `:global(...)` under a local selector in that module.

## React-Specific Conventions

- Use `index.tsx` or `index.jsx` for component entries, matching the project's language.
- Place shared hooks in the shared `hooks/` directory and module-private hooks in their owning module's `hooks/` directory.
- Declare components as arrow functions assigned to named variables.
- Receive props as an object, then destructure props and set defaults in the function body.
- Set `displayName` on every component, matching its component name.
- Place pure functions and constants related to the current component above its definition.
- Call Hooks such as `useState` and `useEffect` at the top level, before any conditional early returns. Do not place these calls in conditions or loops.
- Keep inputs that drive recomputation or requests in dependency lists. Do not hide updates by freezing those inputs, stringifying dependencies, or using inappropriate empty dependency lists.
- Initialization-only configuration may be stored in a ref. When callbacks need the latest values, prefer the project's existing latest-value ref utility.
- Do not use `React.memo` by default. Use `useMemo` and `useCallback` based on actual computation costs and dependency-stability needs.

## Vue 3-Specific Conventions

- Use `index.vue` for component entries built as single-file components. For Composition API components, follow the project's `<script setup>` or `setup()` convention. In TypeScript projects, use `lang="ts"` on the script block.
- Place shared composables in the shared `composables/` directory and module-private composables in their owning module's `composables/` directory.
- In `<script setup>`, declare props and emitted events with `defineProps` and `defineEmits`. Set prop defaults using syntax supported by the project's Vue version.
- For inputs that must drive reactive computations or requests, pass refs or getters into composables and track them with `watch` or `watchEffect`.
- When consumers destructure composable state, return a plain object containing refs so the state remains reactive.
- In `<script setup>`, use `defineExpose` to publish the intended imperative component interface.
- For `<style scoped>`, place `:deep(...)` overrides under a local selector when targeting child-component internals.
- For `<style module>`, use the project's `$style`, named-module, or `useCssModule` access convention.
