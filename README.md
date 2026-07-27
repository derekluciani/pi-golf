# Pi Golf

Pi Golf is a deterministic golf game delivered as a multi-file, project-local Pi extension under `.pi/extensions/golf/`. Pi loads its TypeScript entrypoint directly.

## Requirements

- Node.js `>=22.19.0` (`.nvmrc` pins the minimum supported release)
- npm
- Pi `0.82.1` and Pi TUI `0.82.1` when exercising project-local extension discovery

`npm ci` enforces the declared Node engine. The developer commands also run `npm run check:node` before their main task.

## Developer commands

Run these commands from the repository root:

```bash
npm ci            # install the exact locked dependency set
npm run lint      # run headless static analysis
npm run typecheck # type-check strict ESM TypeScript without emitting files
npm test          # run deterministic headless tests
```

No production build is required or provided. Pure domain simulation and Course validation are headless and do not construct Pi TUI components.

## Project-local Pi loading

Start Pi from this trusted repository on a supported Node runtime. Pi auto-discovers `.pi/extensions/golf/index.ts`; no `-e` flag is needed. Run `/golf` to observe the foundation command, then `/reload` and `/golf` again to verify that Pi reloads the project-local TypeScript extension without a runtime error.
