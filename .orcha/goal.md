# Goal

## Background

agent-chatbot is a multi-platform bot (Slack / Discord) that bridges chat messages to local agent CLIs (Claude, Codex, Gemini, vibe-local, etc.) with per-channel Git repository context awareness.

The project is evolving in two directions:
1. **orcha integration** — agent-chatbot itself uses `.orcha/` for orchestrated multi-agent development. The orcha config needs to accurately reflect this project's tech stack, verification pipeline, and acceptance criteria.
2. **New repository creation feature** — currently the bot only supports cloning existing remote repositories via `/agent-repo <URL>`. A new capability is needed to create fresh local repositories from scratch so that agents can start greenfield projects directly from chat.

TDDで開発を進めるようにしてください。

## Acceptance Criteria

### Existing functionality (regression guard)

- [ ] TypeScript compilation passes without errors
- [ ] All unit tests pass (ToolCLIClient, ToolPreferenceService)
- [ ] Platform adapters (Slack, Discord) initialize and register commands correctly
- [ ] Tool CLI routing works with per-channel tool selection and fallback to default
- [ ] Git repository clone/status/delete operations function for channel-linked repos
- [ ] Conversation resume (`--continue` / `resume` / `--resume`) works per tool

### Feature: orcha integration for agent-chatbot

- [ ] `.orcha/orcha.yml` uses `npm run typecheck` and `npm test` as verification commands
- [ ] `acceptance_criteria` in `orcha.yml` reflect the actual project behaviours (ToolCLIClient, ToolPreferenceService, BotManager routing, etc.)
- [ ] `goal.md` documents the project context, constraints, and verification flow correctly
- [ ] orcha profiles and agent definitions are consistent with the tools used in this project

### Feature: create new repository via command (`/agent-repo create`)

- [ ] `/agent-repo create <name>` creates a new empty Git repository under `repositories/` and links it to the current channel
- [ ] The created repository is initialised with `git init`, an initial empty commit, and a default branch (`main`)
- [ ] `StorageService` records the new repo's channel mapping (channelId, localPath, repositoryUrl = `local://<name>`) so existing flows work transparently
- [ ] After creation, `/agent` commands in the channel execute in the new repository's working directory
- [ ] `/agent-repo status` shows the locally-created repository information (branch, working tree status)
- [ ] Duplicate name detection — if a repo with the same name already exists for the channel, return an error instead of overwriting
- [ ] Name validation — repo name must match `[a-zA-Z0-9._-]` (reject path traversal, spaces, special characters)
- [ ] Conversation state for the channel is cleared upon creation (same as clone flow)
- [ ] Unit tests cover: successful creation, duplicate name rejection, invalid name rejection

## Constraints

- Node.js / TypeScript project (ES2020 target, CommonJS modules)
- No external test framework — uses `node:test` built-in runner
- CLI tools are executed via `child_process.spawn` (no shell by default)
- Must support Windows (MSYS/Git Bash) and Linux environments
- New GitService methods should follow the existing patterns: path validation via `ConfigValidator.validatePath`, Japanese error messages, structured logging
- The `/agent-repo create` subcommand must not conflict with existing subcommands (`status`, `delete`, `reset`, `tool`)

## Verification Commands

Execution commands are defined in `orcha.yml` under:

```yaml
execution:
  verification:
    commands:
      - "npm run typecheck"
      - "npm test"
```

## Quality Priority

cost
