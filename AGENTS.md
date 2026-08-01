# Agent Guide

Read [`README.md`](README.md) first for the project overview, installation, controls, configuration, and behavior constraints.

## Project layout

- `extensions/index.ts` is the extension entry point registered by `package.json`. It wires Pi lifecycle events, commands, the footer, and sidebar.
- `src/sidebar.ts` renders the sidebar and manages its overlay/split-pane lifecycle.
- `src/footer.ts` renders the footer.
- `src/state.ts`, `src/metrics.ts`, `src/run-activity.ts`, and `src/workspace-pulse.ts` collect and maintain displayed state.
- `src/config.ts` loads, validates, and merges configuration.
- `src/display.ts`, `src/palette.ts`, and `src/types.ts` define display settings, colors, and shared types.

## Editing guidance

- Keep the project small and personal. Do not add linting, test suites, CI, release automation, or process documentation unless explicitly asked.
- Use TypeScript and ESM-style `.js` relative import specifiers.
- Prefer direct, small changes over new abstractions or dependencies.
- Preserve defensive lifecycle cleanup: overlays, timers, subscriptions, and runtime state must be disposed on shutdown or replacement.
- There are intentionally no npm scripts, linting, tests, or CI checks. Manually load the extension in Pi when a behavior change needs verification.
