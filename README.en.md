**[中文](README.md)** | **[English](README.en.md)** | **[日本語](README.ja.md)**

# 🎲 DnD Endless Adventure — Multiplayer Text RPG

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![Node.js](https://img.shields.io/badge/Node.js-18+-green.svg)](https://nodejs.org)
[![Gemini](https://img.shields.io/badge/AI-Gemini%202.5%20Flash-blue.svg)](https://ai.google.dev)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](CONTRIBUTING.md)
[![GitHub Issues](https://img.shields.io/github/issues/TK88101/DnD)](https://github.com/TK88101/DnD/issues)

A browser-based multiplayer Dungeons & Dragons text RPG. Powered by Google Gemini AI as the Dungeon Master (DM), supporting 1–8 players simultaneously.

## 🎮 Four Campaigns

| Campaign | Theme | Highlights |
|----------|-------|------------|
| ⚔️ Azeroth Campaign \| World of Warcraft | World of Warcraft | Alliance/Horde factions, 12 races & 10 classes, dungeons & raids |
| 🐙 Abyssal Mist Campaign \| Cthulhu Mythos | Cthulhu Mythos | 1920s investigation, Sanity system |
| 🩸 Blood Moon Hunt Campaign \| Bloodborne | Bloodborne | Gothic horror, trick weapons |
| 🐉 Hunt Hour Campaign \| Monster Hunter | Monster Hunter | Hunt → Materials → Forge, cart mechanic, 10 weapon types |

## ✨ Core Features

- **Real-Time Multiplayer** — WebSocket connections, 1–8 players per room
- **AI Dungeon Master** — Immersive narrative driven by Gemini 2.5 Flash
- **Character Creation** — Race/class/stat allocation (MH simplified to weapon-select-and-play)
- **Code-Controlled Combat Engine** — All dice rolls, damage, and HP handled by server code; Gemini only provides narrative
- **Dual Input Mode** — Number options or free text (Gemini parses intent → code executes)
- **MP Mana System** — Resource management for spellcasting classes
- **9 Classes with Full Skill/Talent Trees** — 11 skills per class (Lv1-20) + 3 talent trees each
- **Summon AI** — Imp, Voidwalker, and other summons act automatically
- **Dynamic Difficulty** — Server code auto-scales monster stats based on party size
- **External Memory** — Persistent game state, automatic conversation trimming, constant token usage
- **Save/Load** — Save progress anytime, load across rooms to continue
- **AFK System** — Auto-AFK after 60 seconds of inactivity; NPC takes over the character
- **Absent Player Handling** — Automatically detects absent players on load; characters are controlled by NPCs
- **BGM Background Music** — YouTube auto-switches scene music (with fallback)
- **Boss Key** — Press Esc to toggle a disguise screen
- **Character Color System** — Each character has a unique color; narration in white, options in cyan

### Monster Hunter Exclusive
- 🐱 **Cart Mechanic** — Faint 3 times and the quest fails; monsters don't recover HP
- ⚔️ **Part Breaks** — Breaking head/tail/wings affects monster abilities
- 🎯 **Capture System** — Limp → Trap → Tranq Bomb; capture rewards are more plentiful
- 🛒 **Code-Controlled Shop** — The general store is handled entirely by server code, bypassing AI
- 📈 **Code-Controlled Leveling** — Auto-level up when EXP threshold is reached; HP calculated by code dice rolls

## 🚀 Quick Start

### Requirements
- Node.js 18+
- Google Gemini API Key

### Installation

```bash
git clone https://github.com/你的用戶名/DnD.git
cd DnD/server
npm install
```

### Start the Server

```bash
export GEMINI_API_KEY="your-api-key"
node relay.js
```

Open `http://localhost:8080` in your browser.

### Remote Play (Cloudflare Tunnel)

```bash
cloudflared tunnel --url http://localhost:8080
```

Share the generated URL with friends to let them join.

## 📁 Project Structure

```
DnD/
├── server/
│   ├── relay.js              # Main server (WebSocket + Gemini + combat routing)
│   ├── game-engine.js        # Character engine (dice/stats/skills/talents data)
│   ├── combat-engine.js      # Combat engine (initiative/turns/AI/loot/encounters)
│   ├── monster-parser.js     # Monster data parser (parses enemies.md)
│   ├── tests/                # Test files
│   └── public/
│       └── index.html         # Browser client (terminal-style UI)
├── rules/
│   ├── core.md               # D&D 5e core rules (combat/leveling/MP system)
│   └── monsterhunter.md      # MH-specific rule overrides (cart/forging/part breaks)
├── campaigns/
│   ├── warcraft/              # World of Warcraft campaign
│   │   ├── classes.md         #   9 classes w/ skills+talents (Classic 1.12 faithful)
│   │   ├── quests.md          #   30 main quests + 8 zone side quest lines + NPC recruitment
│   │   ├── tier-sets.md       #   T1-T3 raid tier sets (36 sets)
│   │   ├── enemies.md         #   Monster data tables
│   │   ├── items.md           #   Equipment & item tables
│   │   └── dungeons/          #   14 dungeon full designs
│   ├── cthulhu/               # Cthulhu Mythos campaign
│   ├── bloodborne/            # Bloodborne campaign
│   └── monsterhunter/         # Monster Hunter campaign
│       ├── world.md           #   Azure Star world lore
│       ├── classes.md         #   10 weapon types
│       ├── enemies.md         #   21 monsters (Jagras → Black Dragon)
│       ├── items.md           #   Equipment/materials/consumables
│       ├── npcs.md            #   Azure Star Settlement NPCs
│       ├── quests.md          #   19 main quests + 6 side quests
│       └── dungeons/          #   Hunting ground maps
├── saves/                     # Player save files (auto-generated)
└── game.md                    # Game overview
```

## 🎮 Game Commands

| Command | Alternative | Description |
|---------|-------------|-------------|
| `開始遊戲` | `start game` | Start a new game |
| `讀取 名字` / `讀檔 名字` | `load <name>` | Load a save file |
| `保存` / `存檔` | `save` | Save the game |
| `結束遊戲` / `退出` | `quit` | Save and exit |
| `雜貨店` / `/shop` | `/shop` | Open the shop (code-controlled) |
| `/fight` | `/fight` | Trigger random combat (code-controlled) |
| `/back` / `回來了` | `/back` | Cancel AFK status |
| `Esc` | `Esc` | Boss key (toggle disguise screen) |

## 🏗️ Technical Highlights

- **Gemini Untrusted Principle** — Leveling, shop, difficulty, and combat resolution are all controlled by code; Gemini only narrates
- **Combat Engine** — Code handles dice/damage/HP/loot; Gemini does intent parsing and narrative wrapping (two API calls)
- **Option Mapping** — Number input → option lookup; free text → Gemini intent parsing → code execution
- **External Memory** — Game state (HP/gold/items) is parsed from AI responses and injected into the next message
- **Dynamic Difficulty** — Code calculates HP multipliers and attack modifiers based on party size
- **Heartbeat Keep-Alive** — 15-second ping prevents Cloudflare's 90-second timeout from dropping the connection
- **Disconnect & Reconnect** — Room is preserved for 5 minutes; host and players can reconnect

## 📄 License

MIT
