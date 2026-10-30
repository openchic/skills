# Swift Conventions for macOS and iOS

These conventions apply to Swift source in macOS, iOS, and iPadOS apps and packages, including SwiftUI, AppKit, and UIKit code. The project's own configuration takes precedence where the two conflict.

## Module Architecture

Read this section first when the project has no established layout, or when a change adds a capability that could land in the wrong place.

- Give each type one role, and let the role decide where it lives.

  | Role | Contains | Depends on |
  | --- | --- | --- |
  | App entry | the `@main` scene or app delegate, and the object graph | every layer, in one place only |
  | Feature | a screen's view, its observable model, and feature-private helpers | service protocols, shared code, domain types |
  | Service | network, storage, and system-framework integration | domain types, third-party packages |
  | Domain | value types and business rules | the standard library only |
  | Shared | components and helpers used by two or more features | domain types, system frameworks |

- Point dependencies inward: a feature depends on a service protocol, a service returns domain types, and domain types reference no other layer.
- Build the object graph once in the app entry point and pass services into feature initializers, so no feature reaches for a global singleton.
- Decode at the service boundary, so wire formats never reach a view.
- Map a service error to a state the view can render, such as loading, empty, failed, or loaded.
- Keep transient interface details in the view, and anything that must survive a redraw on the model.
- Start with folders inside one target; promote a folder to its own target only when a second product needs it or build isolation is proven.
- When the project already has a layout, follow it. Reshaping an existing structure is its own change, justified on its own terms.

## Formatting

When the project has no formatting configuration, use 2-space indentation and a 100-column line width, trim trailing whitespace, and end each file with a newline. Limit consecutive blank lines to one, and separate declarations that contain their own scope from their neighbors with a blank line.

- Do not separate statements with semicolons, and omit `return` when the language does not require it.
- Prefer inferred types on the left-hand side over explicit annotations when the value makes the type obvious.
- Use `self` only where the language requires it or where it prevents ambiguity.
- Add a trailing comma to the last element of a multiline list, and put one property or enum case per line.
- Keep spaces around `->` and infix operators, none inside brackets and parentheses, and no space before a colon that follows a name.
- Prefer the shorthand forms the standard library provides, such as `Avatar?` and `[Avatar]`, and omit an explicit `.init` when the surrounding context names the type.
- Omit `Void` return types, redundant `break` statements, and a `get` clause when a computed property has no other accessor.
- Name unused function and closure parameters `_`.
- Put attributes for functions, types, and computed properties on the line above the declaration; keep a simple attribute for a stored property on the same line.
- For long declarations, break before each argument label and before the closing parenthesis; for chained calls, keep the leading `.` on the continuation line and do not insert blank lines between the links.

## File and Declaration Organization

- Use one primary type per file, and name the file after that type. Feature-private helpers and small views may live in the feature's own files.
- Put each protocol conformance and utility addition in its own extension, in files named `Type+Protocol.swift` or `Type+Feature.swift`.
- Order imports as standard library and framework first, then third-party packages, then project modules, sorted within each group. Drop duplicates and any import the file no longer uses.
- When a type or extension is large enough to need navigation, group its members with `// MARK:` sections ordered by access level, from `Lifecycle` for initializers and deinitializers through `Private`, and declare nested types and type aliases, then static properties, then instance properties, then computed and observed properties, then methods. Enum cases go above the first section marker. Skip these markers on small value types and on types whose members all share one access level.
- Give each extension its own access level per declaration instead of widening the whole extension.
- Name test targets after the targets they cover, and mirror the source structure inside them.
- For Xcode projects without a package manifest, apply the same names to targets and groups, following the project's existing layout.

## Directory Structure Example

The names below illustrate the modules in a Swift package, which a macOS executable or an iOS app's Xcode shell consumes. In an Xcode-only project, the same names apply to groups inside the app target; use the project's existing target names and create directories and files only as needed.

```text
Sources/
├── App/
│   └── App.swift
├── UserProfile/
│   ├── UserProfileView.swift
│   ├── UserProfileModel.swift
│   ├── UserProfileService.swift
│   └── AvatarCard.swift
├── AvatarPicker/
│   └── ...
└── Shared/
    ├── AvatarList.swift
    └── ImageLoading/
        └── ImageLoader.swift
Tests/
└── UserProfileTests/
    └── UserProfileModelTests.swift
```

## Naming

- Use PascalCase for type and protocol names and camelCase for everything else.
- Write acronyms in capitals inside a PascalCase name, such as `missionURL`, and lowercase them at the start of a camelCase name, such as `urlSession`. Avoid legacy Objective-C acronym prefixes on new types.
- Prefix booleans with `is` / `has` / `can`.
- Name event-handling methods as past-tense sentences, such as `didSelectPlanet(_:)`, and keep the SDK's `will` / `did` conventions for lifecycle callbacks.
- Name asynchronous functions after the action, not the mechanism. Keep one base name for the `async` version and any completion-handler or `Result`-based variant.
- Name protocol requirements and members after what they mean rather than their container, so the call site reads as a sentence.
- Name tuple elements instead of using positional access where a tuple is part of an interface.
- Use descriptive names over abbreviations, and follow the platform SDK's terminology for inherited members and delegate methods.

## Declarations and Access Control

- Prefer structures and value semantics. Use a class when identity, shared mutable state, or inheritance is required, and default classes to `final` unless subclassing is intended.
- Prefer `static` over `class` for type-level members.
- Avoid global functions. Group module-level constants and helpers in a caseless enum so they form a namespace.
- Limit visibility to the strictest level that still lets the code compile: `private` for implementation details, the default internal level for module code, and `public` or `package` only at the module boundary. Do not write the `internal` keyword explicitly.
- Prefer composition through protocol extensions over deep inheritance.
- In a closure that captures `self` weakly, bind it once before use rather than repeating optional chaining on it. Avoid `unowned` captures, which turn a lifetime mistake into a crash.

## Values and Mutability

- Prefer `let`, immutable values, and computed or immutable static properties over mutable ones, and keep any necessary `var` in the smallest scope.
- Initialize stored properties when possible instead of deferring with an implicitly unwrapped optional, and keep initializers cheap; do significant or fallible setup in a separate method or asynchronous step.
- Model variants and states as enums with associated values instead of coordinating booleans, and omit the associated-value list in a case declaration when every argument is unlabeled.
- Rely on compiler-synthesized conformance for `Codable`, `Hashable`, `Identifiable`, `Sendable`, and equality comparisons over all properties, instead of writing them by hand.
- Prefer opaque return and parameter types with `some` where a single concrete type backs the value, and reserve `any` for genuinely heterogeneous or runtime-selected types. Avoid `@unchecked Sendable`; if a type cannot be made safely shareable, change its ownership instead.
- Extract complex property observers and callback bodies into methods so the declaration stays readable.

## Statements and Expressions

- Use `guard` for preconditions at the start of a scope so the main path stays at the lowest indentation level, and check for `nil` directly when the unwrapped value is not needed.
- Prefer `if` or `switch` expressions over the ternary operator for assigning or returning one of a few values, and wrap multi-line bodies onto separate lines.
- Separate conditions with commas rather than `&&` in `if`, `guard`, and `while`, and start a new line after the leading keyword when a condition spans lines. In a multiline `guard`, break before `else`.
- Switch exhaustively over project-owned enums without a `default` case, so a new case produces an error at the places that need updating. Use `default` for enums you do not control.
- Prefer `for` loops over `forEach` with a single-expression closure, and omit parentheses around conditions and expressions that do not need them.
- Destructure case values with the binding keyword next to each name, such as `case .planet(let name)`.
- For an unexpected condition that the code can recover from, assert in debug builds and log the state for production; for an unrecoverable one, use a precondition or `fatalError` so the failure is explicit.

## Collection and String Work

- Prefer `isEmpty` over comparing `count` with zero, `contains(where:)` over `first(where:) != nil` or an emptied `filter`, and `first(where:)` over `filter { ... }.first`.
- Use `lazy` on a mapped chain when only one element of the result is consumed, and `flatMap` instead of mapping and then concatenating.
- Prefer standard-library string operations, such as `replacing(_:with:)`, over Foundation equivalents, and use `Date` and `Calendar` or the platform formatting types rather than manual parsing.
- Call platform structure initializers, such as `NSRange(location:length:)`, instead of the legacy `Make`-style helper functions.
- Use `#fileID` in production code and `#filePath` only in tooling or tests, where the full path's instability does not matter.

## Concurrency

- Mark UI-bound types `@MainActor`, and keep view and view-model state mutation on the main actor. Perform network and disk work in `async` functions away from it, and never block the main actor with synchronous heavy work.
- Prefer `async`/`await` over completion handlers for new code, and bridge frameworks that still use callbacks with the checked-continuation APIs.
- Prefer structured concurrency, such as `async let` and task groups, over unstructured detached tasks, so child work is cancelled and awaited with its parent.
- Propagate cancellation: check for it in loops and long-running work, and treat `CancellationError` as an expected outcome rather than a failure to report.
- Use actors for shared mutable state instead of locks or serial queues, and keep values crossing actor boundaries `Sendable`.
- Do not mix per-callback queue hops into code that already uses structured concurrency.

## Views and State

- Observable models hold state and side effects; views compose other views and render state. Keep the entry view's body readable as the structure of the screen, and extract a subview when it owns state or is independently reusable.
- Choose the state source that matches ownership: view-local `@State`, `@Binding` for a value owned elsewhere, a shared model through the project's observation mechanism, and the environment for cross-cutting dependencies. Keep only one source of truth per value.
- For internal views, prefer the synthesized memberwise initializer by declaring the properties they take as internal, while keeping dynamic properties such as `@State` private.
- Follow the project's observation mechanism, and do not mix the newer observable macro and the older published-object style in one module unless the project already does.
- Give `ForEach` elements stable identity so rows keep their state across updates.
- Omit a builder attribute where the context implies it, such as `body`, and on single-expression properties or functions.
- Do not write an `else { EmptyView() }` branch, and drop a container that adds nesting without applying modifiers.
- Add environment values with the entry macro where the toolchain provides it.

## Platform Appearance and Layout

- Prefer semantic colors and text styles, asset-catalog colors, and system symbols for standard actions, so light mode, dark mode, and accessibility settings work without extra code. Reserve explicit values for genuine brand colors.
- Support Dynamic Type and let layouts adapt to the accessibility size and to window resizing on macOS, rather than fixed frames.
- Use platform-standard controls, menus, keyboard navigation, and shortcut handling in macOS apps; users expect the system's behavior there more than a replicated iOS layout.
- In UIKit and AppKit, follow the project's existing interface mechanism, storyboard, XIB, or programmatic, and keep layout constraints with the owning view's code.

## Resources and Localization

- Manage user-facing copy through the project's string mechanism, whether a string catalog or a strings file, and format dates, numbers, and units with the platform's formatting types so they follow the user's locale.
- Keep images and symbols in the asset catalog.
- Change app targets' configuration files, such as the property list and entitlements, only for the requirement at hand, so those diffs stay reviewable.

## Errors

- Declare error types as enums scoped to the module or type that can fail, and add localized descriptions only where the message reaches the user.
- Propagate with `throws` and handle the error at the layer that can act on it; do not swallow it where it is merely observed. Avoid `try?` when the reason for failure matters, since it discards the error, and use `Result` only when a failure must be stored or returned as a value.
- Omit a typed `throws` annotation when it restates what the effect already conveys, and follow the project's typed-throws convention for new code.

## Logging

Use the system logging facility with a named logger per subsystem and category instead of writing to standard output, and keep identifiers, tokens, and personal data out of log messages.

## Testing

- Follow the project's testing framework. For new suites in a project whose toolchain supports it, prefer the Swift testing library over XCTest, and define suites as structures.
- Write test-case names as readable sentences, and name what the test proves rather than the call being made.
- Keep test cases at the default internal level and mark the suite's helpers and stored fixtures `private`.
- Avoid `guard` and force-unwrapping in tests.
- Make failing setup and expectations throw, so a failure reports the line and value that caused it.
- Omit redundant `throws` or `async` effects on test functions that do not use them, and skip assertion messages that only repeat the condition.
- Test business behavior through models and services with injected fakes, and reserve interface-level tests for actual rendering or interaction requirements.

## Documentation Comments

Use `///` documentation comments on public interfaces, with the parameter, return, and throws sections when the signature needs them, placed before attributes and modifiers. Use ordinary `//` for implementation notes inside a body. Mark removals with the availability attribute, including the replacement and the reason, following the shared documentation convention.
