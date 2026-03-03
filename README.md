# discord-claude-bridge

A Discord bot that bridges messages to [Claude Code](https://docs.anthropic.com/en/docs/claude-code) sessions. Send a message in Discord, and Claude Code edits files, runs commands, and pushes code on your server. Responses stream back into the channel in real time.

## What it does

Every message in a Discord channel gets piped into a Claude Code subprocess. The bot streams back:

- Tool calls (file edits, bash commands, searches)
- Thinking blocks
- Tool results
- Final response

Sessions persist per channel, so Claude remembers context across messages.

## Prerequisites

- Node.js 18+
- [Claude Code CLI](https://docs.anthropic.com/en/docs/claude-code) installed and authenticated
- A Discord bot token ([create one here](https://discord.com/developers/applications))

### Discord bot setup

1. Create a new application at https://discord.com/developers/applications
2. Go to **Bot** and click **Reset Token** to get your bot token
3. Enable **Message Content Intent** under **Privileged Gateway Intents**
4. Go to **OAuth2 > URL Generator**, select `bot` scope with permissions: Send Messages, Read Message History, Read Messages/View Channels
5. Open the generated URL to invite the bot to your server

## Setup

```bash
git clone https://github.com/meng2468/discord-claude-bridge.git
cd discord-claude-bridge
npm install
```

Copy the example env file and fill in your values:

```bash
cp .env.example .env
```

```
DISCORD_TOKEN=your-discord-bot-token
CLAUDE_PATH=claude              # path to claude CLI, defaults to "claude"
WORK_DIR=/path/to/project       # working directory for Claude Code, defaults to cwd
GENERAL_CHANNEL_ID=123456789    # optional: channel ID where messages auto-create threads
```

## Run

```bash
DISCORD_TOKEN=your-token node bot.js
```

Or with a `.env` loader:

```bash
node -r dotenv/config bot.js
```

### As a systemd service

```ini
[Unit]
Description=Discord Claude Code Bridge Bot
After=network.target

[Service]
Type=simple
ExecStart=/usr/bin/node /path/to/bot.js
Environment=DISCORD_TOKEN=your-token
Environment=CLAUDE_PATH=/usr/local/bin/claude
Environment=WORK_DIR=/home/user/project
Restart=on-failure
RestartSec=5

[Install]
WantedBy=multi-user.target
```

## How it works

1. User sends a message in Discord (optionally with file attachments)
2. Attachments are downloaded and saved locally so Claude can read them
3. Bot spawns `claude -p --output-format stream-json --verbose` with the message as input
4. Claude Code runs with access to: Bash, Read, Edit, Write, Glob, Grep, WebSearch, WebFetch, NotebookEdit, Task
5. Stream events (thinking, tool calls, results) are forwarded to the Discord channel
6. Session ID is stored per channel so follow-up messages carry context
7. If `GENERAL_CHANNEL_ID` is set and the message is in that channel, the bot auto-creates a thread for the conversation

## Allowed tools

The bot grants Claude Code access to these tools by default:

```
Bash, Read, Edit, Write, Glob, Grep, WebSearch, WebFetch, NotebookEdit, Task
```

Edit the `--allowedTools` array in `bot.js` to restrict or expand access.

## Limitations

- Discord messages are capped at 2000 characters, so long outputs get chunked
- One Claude Code process runs per message (no concurrent requests per channel)
- No authentication beyond Discord's own permissions — anyone who can post in the channel can trigger Claude Code
- Sessions are stored in memory and lost on restart
- Attachments are saved to a `discord-attachments/` directory in the working directory
