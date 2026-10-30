# Swift Project Toolchain

This reference covers the formatter, linter, and build wiring that keep Swift code aligned with the conventions in [swift.md](swift.md). Read it when a Swift project has no formatting or linting configuration yet, when that configuration is incomplete, or when a change needs to be checked the way the project checks it. Report what you changed and which layers you verified.

## Detect Before Adding

Look for existing configuration before writing any file:

- `.swiftformat`, `.swiftlint.yml`, `.swift-version`, `.editorconfig`, and any configuration belonging to another Swift formatter or linter already in the tree.
- `Package.swift` plugin entries, and the `Run Build Tool Plug-ins` or `Build Phases` sections of an Xcode target.
- Run Script phases, `Makefile` targets, pre-commit hooks, and CI workflow files that already invoke a Swift tool.

Then:

- When a tool is already configured, extend that file instead of adding a second one for the same tool. Duplicate configuration makes it unclear which file the build actually reads.
- Keep the project's values where they differ from the defaults below.
- Never reformat the whole tree as part of a feature change. Format the files the change touches; when a repository needs a sweep, propose it as its own formatting-only commit first.

## Division of Labor

- The formatter owns layout: indentation, spacing, wrapping, blank lines, imports, and the order of declarations inside a type. Do not relitigate those in review when the formatter applies them.
- The linter owns what a formatter cannot rewrite and what can be detected syntactically: banned APIs, `unowned` captures, implicitly unwrapped optionals, and `@unchecked Sendable`. Force-unwrapping of values from input or the network stays a review rule, because the lint rule cannot tell it from a literal URL.
- The conventions document explains both, and covers what neither can express, such as module roles and naming.

## .swiftformat

Written for SwiftFormat 0.64.4, with the option names checked against that release's `--options` list. Set `--swift-version` to the lowest Swift version the project supports; 100 columns is the guide for new code, and `--max-width 130` is the hard wrap.

```bash
--swift-version 6.0

--exclude .build,Carthage,Pods,DerivedData

--indent 2
--indent-strings true
--max-width 130
--semicolons never

--self remove
--property-types inferred
--some-any disabled
--short-optionals always
--pattern-let inline
--operator-func no-space
--trailing-commas multi-element-lists
--prefer-synthesized-init-for-internal-structs View,ViewModifier

--wrap-arguments before-first
--wrap-parameters before-first
--wrap-collections before-first
--wrap-conditions before-first
--wrap-return-type never
--wrap-ternary before-operators
--closing-paren balanced
--call-site-paren balanced
--allow-partial-wrapping false
--else-position same-line
--guard-else next-line
--func-attributes prev-line
--type-attributes prev-line
--complex-attributes prev-line
--computed-var-attributes prev-line
--stored-var-attributes same-line

--mark-types if-not-empty
--organize-types class,struct,enum,extension,actor,protocol
--visibility-order beforeMarks,instanceLifecycle,open,public,package,internal,fileprivate,private
--type-order nestedType,staticProperty,staticPropertyWithBody,classPropertyWithBody,swiftUIPropertyWrapper,instanceProperty,instancePropertyWithBody,staticMethod,classMethod,instanceMethod
--type-body-marks remove
--mark-struct-threshold 20
--mark-enum-threshold 20
--extension-acl on-declarations
--import-grouping access-control,alpha,attributes-last

--enable organizeDeclarations,singlePropertyPerLine,preferForLoop,preferContains,preferFirstWhere,preferLazyMap,preferSwiftStringAPI,acronyms,preferFinalClasses
```

**`--enable` pins the rules the conventions rely on, so a tool upgrade cannot silently disable them.**

## .swiftlint.yml

```yaml
only_rules:
  - implicitly_unwrapped_optional
  - unowned_variable_capture
  - unused_optional_binding
  - legacy_constructor
  - legacy_constant
  - legacy_cggeometry_functions
  - legacy_nsgeometry_functions
  - superfluous_disable_command
  - invalid_swiftlint_command
  - custom_rules

excluded:
  - Carthage
  - Pods
  - .build

custom_rules:
  no_objc_members:
    name: "@objcMembers is disallowed"
    regex: "@objcMembers"
    message: "Expose members to Objective-C one at a time with @objc"
    severity: error
  no_direct_standard_out_logs:
    name: "Logging to standard out is disallowed"
    regex: "(\\bprint|\\bdebugPrint|\\bdump)\\s*\\("
    match_kinds:
      - identifier
    message: "Write to the project's logger instead, or silence this rule in debug-only code with an inline disable and a reason"
    severity: error
  no_file_literal:
    name: "#file is disallowed"
    regex: "(#file\\b)"
    match_kinds:
      - keyword
    message: "Use #fileID, or #filePath only where the real path is required"
    severity: error
  no_unchecked_sendable:
    name: "@unchecked Sendable is discouraged"
    regex: "@unchecked Sendable"
    match_kinds:
      - attribute.builtin
      - typeidentifier
    message: "Change the type's ownership instead, or disable this rule inline with an explanation of why the type is thread-safe"
    severity: error
```

**`only_rules` replaces the default rule set.** Merge these entries into an existing rule configuration instead of switching a project to it.

## Wiring

Pick the shape that matches the project. A `.xcodeproj` app has no manifest of its own to hold tool dependencies, so plugins arrive as an Xcode Package Dependency, and SwiftFormat needs a small package to host it. Both tools stay pinned through the resolved versions you commit, so a new machine needs Xcode and network access only.

For a SwiftPM package, whose manifest is a `Package.swift` at the project root:

```swift
// swift-tools-version: 6.0
import PackageDescription

let package = Package(
  name: "App",
  platforms: [.macOS(.v14), .iOS(.v17)],
  dependencies: [
    .package(url: "https://github.com/nicklockwood/SwiftFormat", from: "0.64.4"),
    .package(url: "https://github.com/SimplyDanny/SwiftLintPlugins", exact: "0.65.1"),
  ],
  targets: [
    .target(
      name: "AppFeature",
      plugins: [
        .plugin(name: "SwiftLintBuildToolPlugin", package: "SwiftLintPlugins")
      ]
    )
  ]
)
```

Match `platforms` to the project's deployment targets, and commit the generated `Package.resolved`.

- The SwiftLint build tool plugin runs on every target build and reports violations there. It fails the build only on errors, so add `strict: true` to the configuration when warnings should block too. Add the plugin to each target that holds source you want checked.
- SwiftFormat ships a command plugin only, so it never rewrites files during a build. Run it deliberately:

  ```bash
  swift package plugin --allow-writing-to-package-directory swiftformat
  swift package plugin --allow-writing-to-package-directory swiftformat --target AppFeature --lint
  ```

For an Xcode app that is not a Swift package, add the plugins package as an Xcode Package Dependency and put `SwiftLintBuildToolPlugin` in the target's `Run Build Tool Plug-ins` phase; trust and enable the plugin when Xcode prompts on first use. SwiftFormat has no build tool plugin, so it needs a `BuildTools/` package next to the project whose only job is to declare the dependency, plus a Run Script phase placed **above** Compile Sources:

```bash
cd BuildTools
swift run -c release swiftformat "$SRCROOT"
```

`BuildTools/Package.swift` declares only the tool; its target has no sources of its own, which is why the package needs `Empty.swift`:

```swift
// swift-tools-version: 5.9
import PackageDescription

let package = Package(
  name: "BuildTools",
  platforms: [.macOS(.v14)],
  dependencies: [
    .package(url: "https://github.com/nicklockwood/SwiftFormat", from: "0.64.4")
  ],
  targets: [.target(name: "BuildTools", path: "")]
)
```

Set `ENABLE_USER_SCRIPT_SANDBOXING` to `NO` for that target, or the sandboxed script cannot write the formatted files. Check `BuildTools/Package.swift` and `BuildTools/Package.resolved` into version control so every machine resolves the same tool version. On CI, `-skipPackagePluginValidation` and `-skipMacroValidation` bypass the Xcode trust prompts; treat that as an explicit decision to trust the pinned dependencies.

## Commands

```bash
swiftformat .  # rewrite files in place
swiftformat --lint .  # check only; exits non-zero and lists the rules that fired
swiftformat --lint --lenient .  # report violations without failing
swiftformat --options  # list every formatting option and its values
swiftformat . --infer-options --output .swiftformat  # derive options from an existing tree
swiftlint lint  # check only
swiftlint --strict --quiet  # treat warnings as errors, for CI
swiftlint lint --fix  # apply the rewrites the linter supports
```

Run `--infer-options` first on a large existing tree; it reports the settings the code already follows, which sizes the formatting commit.

## Verification

A configured tool that never runs is coverage in name only.

- Run the formatter in `--lint` mode and the linter in strict mode; both must exit cleanly on the current tree.
- Prove each layer can fail: add a temporary file with a 4-space indented body and a `print(...)` call, confirm the formatter reports `indent` and the linter reports `no_direct_standard_out_logs`, then delete the file.

## .gitignore

```gitignore
.DS_Store
.build/
.swiftpm/
DerivedData/
xcuserdata/
```

## Directory Structure

**Modules described by `Package.swift`:**

```text
project/
├── .gitignore
├── .swiftformat
├── .swiftlint.yml
├── Package.resolved
├── Package.swift
├── Sources/
│   └── AppFeature/
└── Tests/
    └── AppFeatureTests/
```

**Xcode app target with a tool-only package:**

```text
project/
├── .gitignore
├── .swiftformat
├── .swiftlint.yml
├── App.xcodeproj/
├── App/
│   └── App.swift
└── BuildTools/
    ├── Empty.swift
    ├── Package.resolved
    └── Package.swift
```

A Swift package describes modules, never an iOS app bundle; the app shell stays in an Xcode target in both shapes. The Xcode shape's `BuildTools/` is a separate package that exists only to pin the formatter and holds no app code. `Empty.swift` is empty because SwiftPM requires a target to contain at least one source file.
