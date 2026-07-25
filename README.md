# Pi Golf

Pi Golf is a deterministic golf game delivered as a project-local Pi extension. The Version 1 foundation lives in `.pi/extensions/golf/` and is loaded directly by Pi's TypeScript loader; no production build is required.

## Requirements

- Node.js 20 or newer
- npm
- Pi when exercising project-local extension discovery

## Developer commands

Run these commands from the repository root:

```bash
npm ci            # install the exact locked dependency set
npm run lint      # run headless static analysis
npm run typecheck # type-check strict ESM TypeScript without emitting files
npm test          # run deterministic headless tests
```

After trusting this project in Pi, use `/reload` to reload `.pi/extensions/golf/index.ts` directly.
