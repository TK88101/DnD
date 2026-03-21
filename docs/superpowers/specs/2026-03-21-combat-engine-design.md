# Combat Engine Design — Code-Controlled Combat System

## Overview

Implement a server-side combat engine that handles all game mechanics (dice rolls, damage calculation, HP tracking, loot drops, skill/talent effects) in code, while delegating narrative description to Gemini AI.

**Core principle:** Gemini only narrates; code decides.

## Architecture

- `server/combat-engine.js` — New file. CombatSession, EncounterGenerator, loot system.
- `server/game-engine.js` — Extend with SKILLS, TALENTS, SUMMONS data tables, MP calculation.
- `server/relay.js` — Modified input routing: number → option lookup, `/command` → code handler, free text → Gemini intent parse → code execute → Gemini narrate.

## CombatSession

State machine: `idle → initiative → combat_round → check_end → ... → loot_phase → idle`

Key methods:
- `initCombat(players, enemies)` — Roll initiative, sort, return order
- `getAvailableActions(participant)` — Generate action list from skills/items
- `executeAction(actor, action)` — Roll dice, calculate damage, return JSON result
- `executeMonsterAI(monster)` — Auto-decide based on AI behavior
- `executeSummonAI(summon)` — Auto-decide based on summon type (dps_ranged, tank)
- `applyDOTs()` — Process ongoing damage/healing effects
- `checkCombatEnd()` — Check win/lose conditions
- `generateLoot(enemies)` — Roll loot tables

executeAction returns structured JSON with actor, action, target, attackRoll, hit, damage, targetHp, effects, summary.

## Monster Data

Parse `enemies.md` at startup via regex. Cache as `Map<name, MonsterTemplate>`.
Template includes: name, type, levelRange, hp (dice expr), ac, attacks[], special[], loot[], exp.

EncounterGenerator:
- `generateRandom(areaLevel, playerCount)` — Filter by level, apply difficulty multiplier
- `generateBoss(campaign, dungeonId, bossName, playerCount)` — Fixed encounters from dungeon MDs
- `aggroCheck(distance)` — d20 roll for pulling extra mobs

Loot: iterate dead enemies' loot tables, roll d100 per item against weight, extra drops per player.

## Skills / Talents / Summons

SKILLS table: per class, per level, with type (attack/dot/summon/drain/cc), damage expression, MP cost, target type.

TALENTS table: per class, 3 trees, 5 tiers each. Effects are modifiers applied during executeAction (damage upgrades, stat bonuses, new abilities).

SUMMONS table: name, hp, ac, attack, ai behavior mode. Applied in executeSummonAI.

MP: base per class + (level-1)*5 + intMod*2. Deducted on skill use, regenerate 5/round out of combat.

## Gemini Integration Protocol

Two separate Gemini calls:

1. **Intent parsing** (combat free text only): Player text → JSON `{actions: [{type, target, skillName}]}`. Strict JSON-only response. Includes current battlefield context.

2. **Narrative generation**: Mechanical results → 2-3 sentence immersive description. No value changes, no options — pure flavor text.

Final output assembled by code: narration + mechanical log + status bar + numbered options.

Non-combat scenes continue using existing Gemini DM flow with enhanced state injection.

## Multiplayer Support

- CombatSession tracks turn order across multiple players
- Only `currentTurn` player can input during combat
- Integrates with existing relay.js turnOrder/advanceTurn
- Summons and monsters auto-act via AI behavior tables
