**[中文](README.md)** | **[English](README.en.md)** | **[日本語](README.ja.md)**

# 🎲 DnD Endless Adventure — Multiplayer Text RPG

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
- **D&D 5e Combat** — Full dice resolution, attack/skill/critical hit system
- **MP Mana System** — Resource management for spellcasting classes
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
│   ├── relay.js              # Main server (WebSocket + Gemini + game logic)
│   ├── game-engine.js        # Character creation engine (dice/stats/class data)
│   └── public/
│       └── index.html         # Browser client (terminal-style UI)
├── rules/
│   ├── core.md               # D&D 5e core rules (combat/leveling/MP system)
│   └── monsterhunter.md      # MH-specific rule overrides (cart/forging/part breaks)
├── campaigns/
│   ├── warcraft/              # World of Warcraft campaign
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
| `/back` / `回來了` | `/back` | Cancel AFK status |
| `Esc` | `Esc` | Boss key (toggle disguise screen) |

## 🏗️ Technical Highlights

- **Gemini Untrusted Principle** — Leveling, shop, difficulty, and option numbering are all controlled by code, not AI
- **Option Mapping** — Players input a number; code looks it up and sends the corresponding text command to Gemini
- **External Memory** — Game state (HP/gold/items) is parsed from AI responses and injected into the next message
- **Dynamic Difficulty** — Code calculates HP multipliers and attack modifiers based on party size
- **Heartbeat Keep-Alive** — 15-second ping prevents Cloudflare's 90-second timeout from dropping the connection
- **Disconnect & Reconnect** — Room is preserved for 5 minutes; host and players can reconnect

## 📄 License

MIT
