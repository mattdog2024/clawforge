# Forge

**Local AI. Remote Control.** — A desktop AI workstation powered by Claude Agent SDK.

Forge gives you a full desktop GUI for Claude agents, with the ability to bridge your agent to messaging platforms (Feishu, Telegram, Discord) and schedule automated tasks — all running locally on your machine.

**[Download Latest Release](https://github.com/feicaiclub/forge/releases/latest)**

## Features

- **Marketplace** — Solution-level template management. Package entire orchestrations (project rules + multiple Agents + multiple Skills + memory templates) as reusable units. One-click save, one-click reuse
- **Desktop Chat** — Real-time conversation with streaming responses, tool call visualization, code syntax highlighting, inline image/file display
- **IM Bridge** — Bridge your agent to Feishu, Telegram, and Discord. Chat with your agent from your phone. Two-way image and file transfer. 14 IM commands for full remote control
- **Growable Project Teams** — Each project has its own Identity, Soul, Memory, Skills, and Agents. These grow richer with every interaction. Switch projects = switch teams
- **Memory System** — MEMORY.md index (first 200 lines auto-loaded) + daily memory (Agent-driven) + topic files (on-demand) + 7-day auto-archive. Aligned with Claude Code's auto memory architecture
- **Scheduled Tasks** — Visual scheduler (once / minutes / hourly / daily / weekly / monthly). Heartbeat monitoring with IM notifications. Each execution creates a reviewable Session
- **Multi-Model** — Claude Opus / Sonnet, MiniMax M2.7, GLM-5 Turbo, Kimi K2 Thinking, Qwen 3.5 Flash, and custom OpenAI-compatible endpoints
- **Skills & Agents** — Global skills/agents shared across projects (`~/.claude/skills/`, `~/.claude/agents/`), compatible with Claude Code
- **`/init` Interview** — Conversational workspace setup: Agent asks questions, then generates personalized config files from templates
- **Bilingual** — Full Chinese and English UI

## Quick Start (User)

### Prerequisites

- macOS (Apple Silicon / Intel)
- **Claude Code CLI** installed ([Install Guide](https://code.claude.com/docs/en/setup))
- Claude Pro / Max / Teams / Enterprise account, or an Anthropic API Key

### Install

1. Download `Forge-1.0.0-arm64.dmg` from [Releases](https://github.com/feicaiclub/forge/releases/latest)
2. Open the DMG and drag Forge to Applications
3. On first launch, right-click the app and select "Open" to bypass Gatekeeper (ad-hoc signed, not notarized)
4. Complete API Key or Claude Code CLI login setup
5. Select a project folder and start using

### Data Storage

All data is stored locally at `~/.forge/`:
- `forge.db` — SQLite database (sessions, messages, settings)
- `uploads/` — Uploaded and agent-generated files
- `marketplace/` — Saved solution templates

No data is sent to any server other than the AI provider APIs you configure.

## Development

### Prerequisites

- Node.js 20+
- pnpm 9+
- Claude Code CLI

### Setup

```bash
git clone https://github.com/feicaiclub/forge.git
cd forge
pnpm install
pnpm dev
```

### Build & Package

```bash
pnpm package
```

The `.dmg` file will be in the `release/` directory.

## Tech Stack

- **Desktop**: Electron + Next.js 15 (Turbopack)
- **Database**: SQLite (better-sqlite3, WAL mode)
- **AI**: Claude Agent SDK (`@anthropic-ai/claude-agent-sdk`)
- **Styling**: Tailwind CSS
- **Package Manager**: pnpm

## Project Structure

```
forge/
├── electron/          # Electron main process + preload
├── src/
│   ├── app/           # Next.js app router (API routes + pages)
│   ├── components/    # React components (layout, views, manage)
│   ├── hooks/         # Custom React hooks
│   └── lib/           # Core logic
│       ├── sdk/       # Claude Agent SDK integration
│       ├── im/        # IM Bridge (adapters, bridge-manager, delivery)
│       ├── cron/      # Scheduled task engine
│       └── ...        # DB, workspace-fs, providers, etc.
├── templates/         # /init config file templates
├── build/             # Electron build resources
└── electron-builder.json
```

## IM Bridge Setup

### Feishu
1. Create an app on [Feishu Open Platform](https://open.feishu.cn/)
2. Enable `im.message.receive_v1` event subscription (WebSocket mode)
3. Paste App ID and App Secret in Forge → IM Channels → Feishu

### Telegram
1. Create a bot via [@BotFather](https://t.me/BotFather)
2. Paste the bot token in Forge → IM Channels → Telegram
3. Send `/start` to your bot, then click Auto Detect

### Discord
1. Create an application on [Discord Developer Portal](https://discord.com/developers)
2. Enable MESSAGE CONTENT privileged intent
3. Paste the bot token in Forge → IM Channels → Discord

## Acknowledgments

Forge is inspired by [OpenClaw](https://openclaw.ai/) by Peter Steinberger. The workspace architecture, memory system, IM bridge, and heartbeat concepts draw from OpenClaw's pioneering design.

Built with the [Claude Agent SDK](https://docs.anthropic.com/en/docs/agents-and-tools) by Anthropic.

## License

[Apache License 2.0](LICENSE)

Copyright 2026 FEICAI
