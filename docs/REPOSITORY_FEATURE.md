# Repository Feature

## Overview
This feature allows you to clone Git repositories and link them to specific Slack/Discord channels. When the agent responds in a channel with a linked repository, it will have the context of that repository.

## Usage

### Clone a Repository
Link a repository to the current channel:
```
/agent-repo https://github.com/username/repo.git
```

### Check Repository Status
View the current repository linked to the channel:
```
/agent-repo status
```

### Remove Repository Link
Unlink the repository from the channel:
```
/agent-repo delete
```

### Reset All Repository Links
Remove all repository links from all channels:
```
/agent-repo reset
```

## How It Works

1. When you clone a repository using `/agent-repo`, the bot:
   - Clones the repository to a local directory
   - Saves the channel-repository mapping
   - The selected agent tool will use this repository as the working directory for all commands in this channel

2. The repository context affects all agent interactions:
   - Direct messages to the bot
   - `/agent` commands

3. Repository data is stored in:
   - `channel-repos.json` - Channel to repository mappings
   - `repositories/` directory - Cloned repositories

## Security Notes

- Only clone repositories you trust
- The bot has full read access to cloned repositories
- Repository credentials are not stored
