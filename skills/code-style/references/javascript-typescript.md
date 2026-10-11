# JavaScript and TypeScript Conventions

These conventions apply to JavaScript and TypeScript in frontend applications and Node.js backends. TypeScript-specific rules are marked below.

## Formatting

When the project has no formatting configuration, use a 100-column line width, 2-space indentation, single quotes, LF line endings, and no line-ending semicolons. Keep trailing commas wherever valid in multiline structures, including function parameters and calls. Always parenthesize arrow function parameters.

## Module Organization

- Identify the application's or package's source root before organizing shared code.
- Place utility functions reused across modules in a shared `utils/` directory within that source root. Group utility files by responsibility.
- Keep module-private utility functions inside their owning module, such as in `utils.ts` or `utils.js`.
- Aggregate shared modules' public named exports through their directory's `index` entry. Choose its extension according to the project's language, framework, and file responsibilities. This includes `utils/`, frontend hooks and composables, and shared components.

## Naming

- Use camelCase for variables and functions.
- Use UPPER_SNAKE_CASE for constants. In TypeScript, use PascalCase for types and UPPER_SNAKE_CASE for enums and enum members.
- Prefix booleans with `is` / `has` / `can`, and event callbacks with `on`.

## Imports

- Import shared modules through their public `index` entry rather than individual implementation files. Use named imports for utility functions. Follow the project's module system, import paths, and file extensions.
- In TypeScript, use `import type` for type-only imports. When importing values and types together, combine them with inline `type` modifiers if desired.

## TypeScript Types

- Use `strict` as the baseline for new projects; follow the current TypeScript configuration in existing projects.
- Prefer `type` declarations and keep similar declarations consistent.
- Use `T[]` for arrays.
- Prefer explicit types. Use `unknown` for unknown external data and narrow it at the boundary. Limit necessary `any` usage to compatibility boundaries, and use explicit named types for public interfaces.
- Use `T | null`, `Partial<T>`, or similar types for data that has not been fetched or is incomplete. Do not use `as T` to assert such data as a complete object.

## Variables

Prefer `const`; use `let` only when reassignment is needed.

## Control Flow

Use early returns for guard clauses.

## Comments

Use JSDoc for documentation comments and `@deprecated` for deprecation markers.
