---
name: code-style
description: Code style and organization conventions for writing, modifying, refactoring, and reviewing code, including frontend components, Web styles, and backend APIs. Use even when style conventions are not explicitly requested. Covers language-agnostic rules, JavaScript/TypeScript, frontend framework conventions, and Swift for macOS, iOS, and iPadOS apps, including module architecture and the Swift formatter and linter setup.
---

## Usage Principles

This skill defines a personal coding style. Read the project's formatting, lint, and build configuration first; explicit project configuration takes precedence in a conflict. Apply this skill's naming, module organization, and coding conventions wherever explicit configuration does not impose a constraint. Reuse existing shared code, and preserve behavior and public interfaces during style refactoring.

## Shared Conventions

- Create files for actual responsibilities, not empty files just to complete a directory structure.
- Keep private code close to its consumers and cross-module reusable code in shared locations. Avoid depending on sibling modules' private implementations.
- Split modules by independent responsibilities and reuse needs, not mechanically by line count.
- Reuse existing definitions for the same data structure. Derive variants by extending existing definitions or selecting fields instead of redeclaring the same fields.
- For API calls, follow the project's existing convention on whether request wrappers return the full response or only `data`. Do not transform the same data in both the wrapper and the caller. This applies to frontend code and backend code that calls other APIs.
- If the project already uses internationalization, manage user-facing copy through its existing internationalization mechanism and reference it through language resources or a module-level copy entry point. Otherwise, centralized copy extraction and separate copy files are not required.
- Document public interfaces with documentation comments, and explain the reason when marking an interface as deprecated.

## References

Read the references for all scenarios involved in the task. Do not load unrelated references.

- For frontend components, hooks, composables, pages, or Web styling, read [references/frontend.md](references/frontend.md), including the section for the project's framework.
- For backend development, read [references/backend.md](references/backend.md).
- For JavaScript or TypeScript, read [references/javascript-typescript.md](references/javascript-typescript.md); it applies to both frontend applications and Node.js backends.
- For Swift in macOS, iOS, or iPadOS apps and packages, including SwiftUI, AppKit, and UIKit, read [references/swift.md](references/swift.md).
- When setting up or checking a Swift project's formatter, linter, or build wiring, read [references/swift-toolchain.md](references/swift-toolchain.md) in addition to the Swift conventions.
