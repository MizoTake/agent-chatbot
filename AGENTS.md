# Repository Guidelines

## Project Structure & Module Organization
- `src/` holds application code in TypeScript.
- `src/adapters/` contains platform adapters (`SlackAdapter`, `DiscordAdapter`).
- `src/services/` contains integration and state services (Git, storage).
- `src/config/` handles config loading and validation.
- `src/utils/` provides shared utilities (logging, retries, progress helpers).
- `config/` stores JSON runtime defaults, `docs/` stores setup/feature guides, and `scripts/` stores operational shell scripts.
- Runtime artifacts are kept in `repositories/`, `channel-repos.json`, and `channel-tools.json` (git-ignored).

## Build, Test, and Development Commands
- `npm install`: install dependencies.
- `npm run dev`: start local development with `nodemon` + `ts-node`.
- `npm run build`: compile TypeScript from `src/` to `dist/`.
- `npm start`: run the compiled app (`dist/index.js`).
- `npm run typecheck`: run static type checks (`tsc --noEmit`).
- `npm test`: build and run Node's built-in test runner against `dist/**/*.test.js`.

### Running a Single Test
1. Build first: `npm run build`
2. Run specific test file with Node: `node dist/path/to/test.js`

Example:
```bash
npm run build && node dist/services/ToolPreferenceService.test.js
```

## Coding Style & Naming Conventions
- TypeScript is configured with `strict: true` and `ES2020` target (`tsconfig.json`).
- Follow existing formatting: 2-space indentation, semicolons, and clear early-return error handling (see `src/index.ts`).
- Use `PascalCase` for classes/interfaces, `camelCase` for functions/variables, and descriptive file names (`StorageService.ts`, `configLoader.ts`).
- Keep platform-specific behavior in adapters; keep cross-platform orchestration in manager/service layers.

### Import Organization
1. Node.js built-ins (`fs`, `path`, `child_process`)
2. Internal modules (relative paths from `src/`)
3. Order alphabetically within groups

Example:
```typescript
import * as fs from 'fs';
import * as path from 'path';
import { spawn } from 'child_process';

import { createLogger } from './utils/logger';
```

### Type Guidelines
- Prefer interfaces over types for object shapes.
- Use explicit return types on all public methods.
- Define error messages in Japanese (the project's locale).
- Use `Promise<T>` for async functions; avoid `any` types.

### Error Handling
- Use early returns for validation errors.
- Wrap external process execution with retry logic (`withRetry`).
- Provide user-friendly Japanese error messages.
- Log errors with context using the structured logger.

## Testing Guidelines
- Tests use Node's built-in runner (`node:test`) with `npm test`.
- Place tests as `*.test.ts` under `src/`; they compile to `dist/**/*.test.js` and run from there.
- Keep one behavior per test case and run `npm run typecheck` with `npm test` before PR.

## Commit & Pull Request Guidelines
- Existing history uses Conventional Commits: `feat:`, `fix:`, `refactor:`, `docs:`, `chore:`.
- Make one logical intent per commit; avoid mixing refactors with feature changes.
- PRs should include: purpose, key changes, verification steps (with command output), related issue links.

## Security & Configuration Tips
- Do not commit secrets or local runtime data (`.env`, `.claude/`, `channel-repos.json`, `repositories/`).
- Start from `.env.example` and `agent-chatbot.yml.example` for local setup.
- Validate token/config changes before deploy; startup fails fast when environment validation fails.

## Platform-Specific Notes
- Windows support: Use `path` module for cross-platform paths; PowerShell wrapper for `vibe-local`.
- Process management: Track active processes in `ToolCLIClient.activeProcesses` for cleanup.
- Output sanitization: Strip ANSI codes and null bytes from CLI output before logging/response.
