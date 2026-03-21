# Combat Engine Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement a server-side combat engine where all game mechanics (dice, damage, HP, loot, skills, talents) are code-controlled, and Gemini AI only provides narrative descriptions.

**Architecture:** New `combat-engine.js` handles combat flow, monster data parsing, loot generation, skill/talent effects, and summon AI. Existing `game-engine.js` gains SKILLS/TALENTS/SUMMONS data tables. Existing `relay.js` gains input routing (number→option, free-text→intent-parse→execute→narrate) and Gemini narration calls.

**Tech Stack:** Node.js, existing game-engine.js dice/roll functions, Gemini API (intent parsing + narration), regex-based MD file parsing.

**Spec:** `docs/superpowers/specs/2026-03-21-combat-engine-design.md`

---

### Task 1: Monster Data Parser

Parse `enemies.md` files into structured JavaScript objects at startup.

**Files:**
- Create: `server/monster-parser.js`
- Test: `server/tests/monster-parser.test.js`
- Read: `campaigns/warcraft/enemies.md` (reference format)

- [ ] **Step 1: Write failing test for parseEnemyBlock**

```javascript
// server/tests/monster-parser.test.js
const { parseEnemyBlock, parseEnemiesFile } = require('../monster-parser');
const assert = require('assert');

// Test parsing a single enemy markdown block
const sampleBlock = `### 1. 飢餓野狼

| 項目 | 數據 |
|------|------|
| **名稱** | 飢餓野狼（Starving Wolf） |
| **類型** | 普通 |
| **等級範圍** | Lv1-2 |
| **HP** | 6-10（1d8+2） |
| **AC** | 10 |
| **攻擊方式** | 撕咬（近戰） |
| **攻擊加值** | +2 |
| **傷害** | 1d4 穿刺傷害 |
| **特殊能力** | **群狼戰術**：當有另一隻狼在目標5尺內時，攻擊擲骰獲得優勢。 |
| **掉落物品** | 破損的狼皮（1 銀）、狼肉（1 銀）、10% 機率掉落完整狼皮（5 銀） |
| **EXP 獎勵** | 15 |`;

const enemy = parseEnemyBlock(sampleBlock);
assert.strictEqual(enemy.name, '飢餓野狼');
assert.strictEqual(enemy.type, '普通');
assert.deepStrictEqual(enemy.levelRange, [1, 2]);
assert.strictEqual(enemy.hp, '1d8+2');
assert.strictEqual(enemy.ac, 10);
assert.strictEqual(enemy.attacks[0].bonus, 2);
assert.strictEqual(enemy.attacks[0].damage, '1d4');
assert.strictEqual(enemy.exp, 15);
assert.ok(enemy.loot.length >= 2);
console.log('parseEnemyBlock tests passed');
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /Users/ibridgezhao/Documents/DnD && node server/tests/monster-parser.test.js`
Expected: FAIL — `Cannot find module '../monster-parser'`

- [ ] **Step 3: Implement monster-parser.js**

```javascript
// server/monster-parser.js
const fs = require('fs');
const path = require('path');

function parseEnemyBlock(block) {
  const enemy = { attacks: [], special: [], loot: [] };

  const field = (label) => {
    const re = new RegExp(`\\|\\s*\\*\\*${label}\\*\\*\\s*\\|\\s*(.+?)\\s*\\|`);
    const m = block.match(re);
    return m ? m[1].trim() : null;
  };

  // Name
  const rawName = field('名稱');
  if (rawName) {
    const nameMatch = rawName.match(/^(.+?)（/);
    enemy.name = nameMatch ? nameMatch[1].trim() : rawName;
  }

  // Type
  enemy.type = field('類型') || '普通';

  // Level range
  const lvl = field('等級範圍');
  if (lvl) {
    const lvlMatch = lvl.match(/Lv(\d+)-?(\d+)?/);
    if (lvlMatch) {
      enemy.levelRange = [parseInt(lvlMatch[1]), parseInt(lvlMatch[2] || lvlMatch[1])];
    }
  }

  // HP dice expression
  const hpRaw = field('HP');
  if (hpRaw) {
    const hpMatch = hpRaw.match(/(\d+d\d+[+-]?\d*)/);
    enemy.hp = hpMatch ? hpMatch[1] : hpRaw;
  }

  // AC
  const acRaw = field('AC');
  if (acRaw) {
    const acMatch = acRaw.match(/(\d+)/);
    enemy.ac = acMatch ? parseInt(acMatch[1]) : 10;
  }

  // Attack
  const atkName = field('攻擊方式');
  const atkBonus = field('攻擊加值');
  const atkDmg = field('傷害');
  if (atkName) {
    const attack = { name: atkName.replace(/（.+?）/, '').trim() };
    attack.type = /遠程|射程/.test(atkName) ? 'ranged' : 'melee';
    if (atkBonus) {
      const bonusMatch = atkBonus.match(/\+(\d+)/);
      attack.bonus = bonusMatch ? parseInt(bonusMatch[1]) : 0;
    }
    if (atkDmg) {
      const dmgMatch = atkDmg.match(/(\d+d\d+(?:[+-]\d+)?)/);
      attack.damage = dmgMatch ? dmgMatch[1] : '1d4';
      const typeMatch = atkDmg.match(/(穿刺|揮砍|鈍擊|火焰|冰霜|暗影|神聖|毒素|寒冷|奧術)/);
      attack.damageType = typeMatch ? typeMatch[1] : '物理';
    }
    enemy.attacks.push(attack);
  }

  // Special abilities
  const specRaw = field('特殊能力');
  if (specRaw) {
    const specParts = specRaw.split(/\*\*(.+?)\*\*[：:]/g).filter(Boolean);
    for (let i = 0; i < specParts.length - 1; i += 2) {
      enemy.special.push({ name: specParts[i].trim(), desc: specParts[i + 1].trim() });
    }
  }

  // Loot
  const lootRaw = field('掉落物品');
  if (lootRaw) {
    const lootItems = lootRaw.split(/、/);
    for (const item of lootItems) {
      const lootEntry = { name: '', price: 0, weight: 100 };
      const chanceMatch = item.match(/(\d+)%\s*機率掉落/);
      if (chanceMatch) lootEntry.weight = parseInt(chanceMatch[1]);
      const nameMatch = item.match(/(?:掉落)?(.+?)（/);
      if (nameMatch) lootEntry.name = nameMatch[1].trim();
      const priceMatch = item.match(/(\d+)\s*(金|銀|銅)/);
      if (priceMatch) {
        const val = parseInt(priceMatch[1]);
        const unit = priceMatch[2];
        lootEntry.price = unit === '金' ? val * 100 : unit === '銀' ? val * 10 : val;
      }
      if (lootEntry.name) enemy.loot.push(lootEntry);
    }
  }

  // EXP
  const expRaw = field('EXP 獎勵');
  if (expRaw) {
    const expMatch = expRaw.match(/(\d+)/);
    enemy.exp = expMatch ? parseInt(expMatch[1]) : 0;
  }

  return enemy;
}

function parseEnemiesFile(campaign) {
  const GAME_DIR = path.join(__dirname, '..');
  const filePath = path.join(GAME_DIR, 'campaigns', campaign, 'enemies.md');
  if (!fs.existsSync(filePath)) return new Map();

  const content = fs.readFileSync(filePath, 'utf8');
  const blocks = content.split(/(?=###\s+\d+\.\s)/);
  const enemies = new Map();

  for (const block of blocks) {
    if (!block.trim().startsWith('###')) continue;
    const enemy = parseEnemyBlock(block);
    if (enemy.name) enemies.set(enemy.name, enemy);
  }

  return enemies;
}

module.exports = { parseEnemyBlock, parseEnemiesFile };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd /Users/ibridgezhao/Documents/DnD && node server/tests/monster-parser.test.js`
Expected: `parseEnemyBlock tests passed`

- [ ] **Step 5: Write integration test for parseEnemiesFile**

```javascript
// Append to server/tests/monster-parser.test.js
const enemies = parseEnemiesFile('warcraft');
assert.ok(enemies.size > 0, 'Should parse at least one enemy');
assert.ok(enemies.has('飢餓野狼'), 'Should have 飢餓野狼');
assert.ok(enemies.has('狗頭人礦工'), 'Should have 狗頭人礦工');
console.log(`parseEnemiesFile: parsed ${enemies.size} enemies`);
console.log('All monster-parser tests passed!');
```

- [ ] **Step 6: Run and verify**

Run: `cd /Users/ibridgezhao/Documents/DnD && node server/tests/monster-parser.test.js`
Expected: `All monster-parser tests passed!`

- [ ] **Step 7: Commit**

```bash
git add server/monster-parser.js server/tests/monster-parser.test.js
git commit -m "feat: add monster data parser for enemies.md files"
```

---

### Task 2: Skills, Talents, and Summons Data Tables

Add structured data tables to game-engine.js for warcraft class skills, talent trees, summon definitions, and MP calculation.

**Files:**
- Modify: `server/game-engine.js` (append data tables and MP function)
- Test: `server/tests/game-data.test.js`
- Read: `campaigns/warcraft/classes.md` (reference data)

- [ ] **Step 1: Write failing test**

```javascript
// server/tests/game-data.test.js
const { SKILLS, TALENTS, SUMMONS, calculateMP, getSkillsForLevel } = require('../game-engine');
const assert = require('assert');

// Skills
assert.ok(SKILLS.warcraft['術士'], 'Should have warlock skills');
const warlockSkills = SKILLS.warcraft['術士'];
assert.strictEqual(warlockSkills[0].name, '暗影箭');
assert.strictEqual(warlockSkills[0].level, 1);
assert.strictEqual(warlockSkills[0].damage, '2d6');

// getSkillsForLevel
const lv4Skills = getSkillsForLevel('warcraft', '術士', 4);
assert.ok(lv4Skills.find(s => s.name === '暗影箭'), 'Lv4 should have 暗影箭');
assert.ok(lv4Skills.find(s => s.name === '腐蝕術'), 'Lv4 should have 腐蝕術');
assert.ok(lv4Skills.find(s => s.name === '召喚小鬼'), 'Lv4 should have 召喚小鬼');
assert.ok(!lv4Skills.find(s => s.name === '生命虹吸'), 'Lv4 should NOT have 生命虹吸');

// Talents
assert.ok(TALENTS.warcraft['術士']['惡魔'], 'Should have warlock demon tree');
assert.strictEqual(TALENTS.warcraft['術士']['惡魔'][0].name, '強化小鬼');

// Summons
assert.ok(SUMMONS.imp, 'Should have imp summon');
assert.strictEqual(SUMMONS.imp.ai, 'dps_ranged');

// MP
const mp = calculateMP('術士', 4, 3); // level 4, INT mod +3
assert.strictEqual(mp, 15 + (4-1)*5 + 3*2, 'MP formula check');

console.log('All game-data tests passed!');
```

- [ ] **Step 2: Run to verify failure**

Run: `cd /Users/ibridgezhao/Documents/DnD && node server/tests/game-data.test.js`
Expected: FAIL — `SKILLS is not defined`

- [ ] **Step 3: Add SKILLS table to game-engine.js**

Add all 9 warcraft classes' skill tables (based on classes.md data already read during brainstorming). Each entry: `{ level, name, type, target, damage, damageType, mpCost, duration, desc }`.

- [ ] **Step 4: Add TALENTS table to game-engine.js**

Add all 9 classes × 3 trees × 5 tiers. Each entry: `{ tier, name, effect: { type, modify, value, ... } }`.

- [ ] **Step 5: Add SUMMONS table and calculateMP to game-engine.js**

```javascript
const SUMMONS = {
  imp:         { name: '小鬼',     hp: '2d6+4',  ac: 11, attack: { name: '火焰箭',   bonus: 3, damage: '1d6', damageType: '火焰', type: 'ranged' }, ai: 'dps_ranged' },
  voidwalker:  { name: '虛空行者', hp: '4d8+8',  ac: 14, attack: { name: '虛空撕裂', bonus: 4, damage: '1d8', damageType: '暗影', type: 'melee' },  ai: 'tank', abilities: ['taunt'] },
  felhound:    { name: '地獄犬',   hp: '3d8+6',  ac: 13, attack: { name: '魔能撕咬', bonus: 4, damage: '1d8', damageType: '奧術', type: 'melee' },  ai: 'anti_caster', abilities: ['dispel'] },
  doomguard:   { name: '末日守衛', hp: '6d10+12', ac: 16, attack: { name: '末日之劍', bonus: 7, damage: '3d8', damageType: '火焰', type: 'melee' }, ai: 'dps_melee', duration: 5 },
};

function calculateMP(className, level, intMod) {
  const BASE_MP = { '法師': 20, '術士': 15, '牧師': 20, '聖騎士': 10, '薩滿': 15, '德魯伊': 15 };
  const base = BASE_MP[className] || 0;
  if (base === 0) return 0;
  return base + (level - 1) * 5 + intMod * 2;
}

function getSkillsForLevel(campaign, className, level) {
  const classSkills = (SKILLS[campaign] || {})[className] || [];
  return classSkills.filter(s => s.level <= level);
}
```

- [ ] **Step 6: Update module.exports**

Add `SKILLS, TALENTS, SUMMONS, calculateMP, getSkillsForLevel` to exports.

- [ ] **Step 7: Run tests**

Run: `cd /Users/ibridgezhao/Documents/DnD && node server/tests/game-data.test.js`
Expected: `All game-data tests passed!`

- [ ] **Step 8: Commit**

```bash
git add server/game-engine.js server/tests/game-data.test.js
git commit -m "feat: add skills, talents, summons data tables and MP system"
```

---

### Task 3: CombatSession Core

The combat state machine: initiative, turn management, action execution, DOT processing, death checks.

**Files:**
- Create: `server/combat-engine.js`
- Test: `server/tests/combat-engine.test.js`
- Read: `server/game-engine.js` (use roll, attackRoll, d20, modifier)

- [ ] **Step 1: Write failing test for initCombat**

```javascript
// server/tests/combat-engine.test.js
const { CombatSession } = require('../combat-engine');
const assert = require('assert');

const players = [{
  name: '小馬屁精', type: 'player',
  stats: { STR: 8, DEX: 14, CON: 15, INT: 17, WIS: 10, CHA: 10 },
  hp: 25, maxHp: 25, ac: 13, level: 4,
  className: '術士', campaign: 'warcraft',
  skills: [{ name: '暗影箭', type: 'attack', damage: '2d6', damageType: '暗影', target: 'single', mpCost: 5 }],
  talents: [{ name: '強化小鬼', tree: '惡魔' }],
  equipment: { weapon: { name: '暗影法杖', damage: '1d6', stat: 'INT' } },
  mp: 21, maxMp: 21,
}];

const enemies = [{
  name: '食屍鬼A', type: 'enemy',
  hp: 8, maxHp: 8, ac: 10,
  attacks: [{ name: '爪擊', bonus: 2, damage: '1d4+1', damageType: '揮砍', type: 'melee' }],
  special: [], exp: 15, loot: [],
}];

const combat = new CombatSession(players, enemies, { hpMult: 1, atkMod: 0 });
const initResult = combat.initCombat();

assert.ok(initResult.order.length === 2, 'Should have 2 participants');
assert.ok(initResult.order[0].initiative >= initResult.order[1].initiative, 'Should be sorted by initiative');
assert.strictEqual(combat.round, 1);
assert.strictEqual(combat.isActive, true);
console.log('initCombat tests passed');
```

- [ ] **Step 2: Run to verify failure**

Run: `cd /Users/ibridgezhao/Documents/DnD && node server/tests/combat-engine.test.js`
Expected: FAIL — `Cannot find module '../combat-engine'`

- [ ] **Step 3: Implement CombatSession skeleton**

```javascript
// server/combat-engine.js
const { roll, d20, modifier, attackRoll } = require('./game-engine');

class CombatSession {
  constructor(players, enemies, difficulty) {
    this.players = players;
    this.enemies = enemies;
    this.difficulty = difficulty || { hpMult: 1, atkMod: 0 };
    this.participants = [];
    this.round = 0;
    this.turnIndex = 0;
    this.isActive = false;
    this.log = [];
    this.dots = [];      // active DOTs: { target, damage, damageType, remaining, source }
    this.summons = [];   // active summons
  }

  initCombat() {
    // Apply difficulty multiplier to enemy HP
    for (const e of this.enemies) {
      e.maxHp = Math.floor(e.maxHp * this.difficulty.hpMult);
      e.hp = e.maxHp;
      for (const atk of e.attacks) {
        atk.bonus = (atk.bonus || 0) + this.difficulty.atkMod;
      }
    }

    // Roll initiative for all
    const all = [
      ...this.players.map(p => ({ ...p, side: 'player', initiative: d20() + modifier(p.stats.DEX) })),
      ...this.enemies.map(e => ({ ...e, side: 'enemy', initiative: d20() + 1 })),
    ];

    // Sort descending; players win ties
    all.sort((a, b) => {
      if (b.initiative !== a.initiative) return b.initiative - a.initiative;
      return a.side === 'player' ? -1 : 1;
    });

    this.participants = all;
    this.round = 1;
    this.turnIndex = 0;
    this.isActive = true;

    return { order: all.map(p => ({ name: p.name, initiative: p.initiative, side: p.side })) };
  }

  getCurrentTurn() {
    if (!this.isActive) return null;
    return this.participants[this.turnIndex];
  }

  advanceTurn() {
    this.turnIndex++;
    if (this.turnIndex >= this.participants.length) {
      this.turnIndex = 0;
      this.round++;
      this.processDOTs();
    }
    // Skip dead participants
    let safety = 0;
    while (this.participants[this.turnIndex].hp <= 0 && safety < this.participants.length) {
      this.turnIndex = (this.turnIndex + 1) % this.participants.length;
      safety++;
    }
    this.checkCombatEnd();
    return this.getCurrentTurn();
  }

  // ... (continued in next steps)
}

module.exports = { CombatSession };
```

- [ ] **Step 4: Run test, verify initCombat passes**

Run: `cd /Users/ibridgezhao/Documents/DnD && node server/tests/combat-engine.test.js`
Expected: `initCombat tests passed`

- [ ] **Step 5: Write test for executeAction (attack)**

```javascript
// Append to combat-engine.test.js
const combat2 = new CombatSession([...players], [{...enemies[0]}], { hpMult: 1, atkMod: 0 });
combat2.initCombat();

const result = combat2.executeAction(
  combat2.participants.find(p => p.name === '小馬屁精'),
  { type: 'skill', skillName: '暗影箭', target: '食屍鬼A' }
);

assert.ok(result.actor === '小馬屁精');
assert.ok(result.action === '暗影箭');
assert.ok(typeof result.hit === 'boolean');
if (result.hit) {
  assert.ok(result.damage.total > 0);
  assert.ok(result.targetHp.after < result.targetHp.before || result.targetHp.before === 0);
}
assert.ok(result.summary.length > 0);
console.log('executeAction tests passed');
```

- [ ] **Step 6: Implement executeAction**

```javascript
// Add to CombatSession class
executeAction(actor, action) {
  const result = { actor: actor.name, effects: [] };

  if (action.type === 'skill') {
    const skill = (actor.skills || []).find(s => s.name === action.skillName);
    if (!skill) return { ...result, error: '未知技能', summary: `${actor.name} 嘗試使用未知技能` };

    const target = this.participants.find(p => p.name === action.target && p.hp > 0);
    if (!target) return { ...result, error: '目標不存在', summary: `找不到目標 ${action.target}` };

    result.action = skill.name;
    result.target = target.name;

    if (skill.type === 'attack' || skill.type === 'drain') {
      // Attack roll
      const atkBonus = modifier(actor.stats.INT) + (actor.proficiency || 2);
      const atkResult = attackRoll(atkBonus, target.ac);
      result.attackRoll = atkResult;
      result.hit = atkResult.hit;

      if (atkResult.hit) {
        const dmg = roll(skill.damage);
        if (atkResult.crit) { const extra = roll(skill.damage); dmg.total += extra.total; dmg.rolls.push(...extra.rolls); }
        result.damage = { ...dmg, type: skill.damageType };
        const before = target.hp;
        target.hp = Math.max(0, target.hp - dmg.total);
        result.targetHp = { before, after: target.hp, max: target.maxHp };

        if (skill.type === 'drain') {
          const healAmt = Math.min(dmg.total, actor.maxHp - actor.hp);
          actor.hp += healAmt;
          result.effects.push({ type: 'heal', target: actor.name, amount: healAmt });
        }
      }

      // Deduct MP
      if (actor.mp !== undefined && skill.mpCost) {
        actor.mp = Math.max(0, actor.mp - skill.mpCost);
      }

    } else if (skill.type === 'dot') {
      result.hit = true; // DOTs auto-hit
      this.dots.push({
        source: actor.name, target: target.name,
        damage: skill.damage, damageType: skill.damageType,
        remaining: skill.duration,
      });
      if (actor.mp !== undefined && skill.mpCost) actor.mp = Math.max(0, actor.mp - skill.mpCost);
      result.damage = { total: 0, type: skill.damageType };
      result.targetHp = { before: target.hp, after: target.hp, max: target.maxHp };
    }

    result.summary = this.buildSummary(result);

  } else if (action.type === 'melee') {
    // Basic weapon attack
    const target = this.participants.find(p => p.name === action.target && p.hp > 0);
    if (!target) return { ...result, error: '目標不存在', summary: `找不到目標` };

    result.action = actor.equipment?.weapon?.name || '近戰攻擊';
    result.target = target.name;

    const statMod = modifier(actor.stats[actor.equipment?.weapon?.stat === 'INT' ? 'INT' : 'STR']);
    const atkResult = attackRoll(statMod + (actor.proficiency || 2), target.ac);
    result.attackRoll = atkResult;
    result.hit = atkResult.hit;

    if (atkResult.hit) {
      const weaponDmg = actor.equipment?.weapon?.damage || '1d4';
      const dmg = roll(weaponDmg);
      dmg.total += statMod;
      if (atkResult.crit) { const extra = roll(weaponDmg); dmg.total += extra.total; }
      result.damage = { ...dmg, type: '物理' };
      const before = target.hp;
      target.hp = Math.max(0, target.hp - dmg.total);
      result.targetHp = { before, after: target.hp, max: target.maxHp };
    }

    result.summary = this.buildSummary(result);

  } else if (action.type === 'item') {
    result.action = action.itemName;
    // Item use logic - healing potions etc
    if (/治療藥水/.test(action.itemName)) {
      const healRoll = roll('2d4+2');
      const before = actor.hp;
      actor.hp = Math.min(actor.maxHp, actor.hp + healRoll.total);
      result.effects.push({ type: 'heal', target: actor.name, amount: actor.hp - before });
      result.summary = `${actor.name} 使用 ${action.itemName}，恢復 ${actor.hp - before} HP（${before}→${actor.hp}）`;
    }
  }

  return result;
}

buildSummary(result) {
  if (!result.hit && result.attackRoll) {
    return `${result.actor} 的 ${result.action} 未命中 ${result.target}（${result.attackRoll.str}）`;
  }
  if (result.hit && result.damage) {
    const killText = result.targetHp?.after <= 0 ? '，擊殺！' : '';
    return `${result.actor} 用 ${result.action} 命中 ${result.target}，造成 ${result.damage.total} 點${result.damage.type}傷害（HP ${result.targetHp.before}→${result.targetHp.after}）${killText}`;
  }
  return `${result.actor} 使用了 ${result.action}`;
}
```

- [ ] **Step 7: Run tests**

Run: `cd /Users/ibridgezhao/Documents/DnD && node server/tests/combat-engine.test.js`
Expected: All tests pass

- [ ] **Step 8: Write tests for monster AI, summon AI, DOT processing, combat end check**

```javascript
// Append to test file — test executeMonsterAI
const combat3 = new CombatSession(
  [{ name: 'TestPlayer', type: 'player', stats: { STR:10,DEX:10,CON:10,INT:10,WIS:10,CHA:10 }, hp: 20, maxHp: 20, ac: 12, level: 1, skills: [], equipment: {} }],
  [{ name: 'TestMob', type: 'enemy', hp: 10, maxHp: 10, ac: 10, attacks: [{ name: 'Bite', bonus: 2, damage: '1d4', damageType: '物理', type: 'melee' }], special: [], exp: 10, loot: [] }],
  { hpMult: 1, atkMod: 0 }
);
combat3.initCombat();
const mob = combat3.participants.find(p => p.side === 'enemy');
const aiResult = combat3.executeMonsterAI(mob);
assert.ok(aiResult.actor === 'TestMob');
assert.ok(aiResult.target === 'TestPlayer');
console.log('executeMonsterAI tests passed');

// Test checkCombatEnd
const combat4 = new CombatSession(
  [{ name: 'P', type: 'player', stats: { STR:10,DEX:10,CON:10,INT:10,WIS:10,CHA:10 }, hp: 10, maxHp: 10, ac: 10, level: 1, skills: [], equipment: {} }],
  [{ name: 'M', type: 'enemy', hp: 0, maxHp: 5, ac: 10, attacks: [], special: [], exp: 10, loot: [{ name: 'Bone', price: 5, weight: 100 }] }],
  { hpMult: 1, atkMod: 0 }
);
combat4.initCombat();
const endResult = combat4.checkCombatEnd();
assert.strictEqual(endResult.ended, true);
assert.strictEqual(endResult.result, 'victory');
console.log('checkCombatEnd tests passed');

console.log('All combat-engine tests passed!');
```

- [ ] **Step 9: Implement executeMonsterAI, executeSummonAI, processDOTs, checkCombatEnd, generateLoot**

```javascript
// Add to CombatSession class

executeMonsterAI(monster) {
  // Simple AI: attack the player with lowest HP
  const targets = this.participants.filter(p => p.side === 'player' && p.hp > 0);
  if (targets.length === 0) return { actor: monster.name, summary: '沒有可攻擊的目標' };

  const target = targets.reduce((a, b) => a.hp < b.hp ? a : b);
  const attack = monster.attacks[0];
  if (!attack) return { actor: monster.name, summary: `${monster.name} 無法攻擊` };

  const atkResult = attackRoll(attack.bonus, target.ac);
  const result = { actor: monster.name, action: attack.name, target: target.name, attackRoll: atkResult, hit: atkResult.hit, effects: [] };

  if (atkResult.hit) {
    const dmg = roll(attack.damage);
    if (atkResult.crit) { const extra = roll(attack.damage); dmg.total += extra.total; }
    result.damage = { ...dmg, type: attack.damageType };
    const before = target.hp;
    target.hp = Math.max(0, target.hp - dmg.total);
    result.targetHp = { before, after: target.hp, max: target.maxHp };
  }

  result.summary = this.buildSummary(result);
  return result;
}

executeSummonAI(summon) {
  const enemies = this.participants.filter(p => p.side === 'enemy' && p.hp > 0);
  if (enemies.length === 0) return { actor: summon.name, summary: '沒有敵人' };

  let target;
  if (summon.ai === 'tank') {
    // Taunt the enemy attacking master
    target = enemies[0];
  } else {
    // dps: attack lowest HP enemy
    target = enemies.reduce((a, b) => a.hp < b.hp ? a : b);
  }

  const atk = summon.attack;
  const atkResult = attackRoll(atk.bonus, target.ac);
  const result = { actor: summon.name, action: atk.name, target: target.name, attackRoll: atkResult, hit: atkResult.hit, effects: [] };

  if (atkResult.hit) {
    const dmg = roll(atk.damage);
    if (atkResult.crit) { const extra = roll(atk.damage); dmg.total += extra.total; }
    result.damage = { ...dmg, type: atk.damageType };
    const before = target.hp;
    target.hp = Math.max(0, target.hp - dmg.total);
    result.targetHp = { before, after: target.hp, max: target.maxHp };
  }

  result.summary = this.buildSummary(result);
  return result;
}

processDOTs() {
  const results = [];
  this.dots = this.dots.filter(dot => {
    const target = this.participants.find(p => p.name === dot.target);
    if (!target || target.hp <= 0) return false;
    const dmg = roll(dot.damage);
    const before = target.hp;
    target.hp = Math.max(0, target.hp - dmg.total);
    results.push({ source: dot.source, target: dot.target, damage: dmg.total, type: dot.damageType, hp: { before, after: target.hp } });
    dot.remaining--;
    return dot.remaining > 0;
  });
  return results;
}

checkCombatEnd() {
  const playersAlive = this.participants.filter(p => p.side === 'player' && p.hp > 0);
  const enemiesAlive = this.participants.filter(p => p.side === 'enemy' && p.hp > 0);

  if (enemiesAlive.length === 0) {
    this.isActive = false;
    const loot = this.generateLoot();
    return { ended: true, result: 'victory', loot };
  }
  if (playersAlive.length === 0) {
    this.isActive = false;
    return { ended: true, result: 'defeat' };
  }
  return { ended: false };
}

generateLoot() {
  const deadEnemies = this.participants.filter(p => p.side === 'enemy' && p.hp <= 0);
  const loot = { items: [], gold: 0, exp: 0 };

  for (const enemy of deadEnemies) {
    loot.exp += enemy.exp || 0;
    for (const item of (enemy.loot || [])) {
      const chance = Math.floor(Math.random() * 100) + 1;
      if (chance <= item.weight) {
        loot.items.push({ name: item.name, price: item.price });
      }
    }
  }

  return loot;
}

getAvailableActions(participant) {
  const actions = [];
  // Skills
  for (const skill of (participant.skills || [])) {
    if (participant.mp !== undefined && skill.mpCost > participant.mp) continue;
    const targets = skill.target === 'self' ? [participant.name]
      : this.participants.filter(p => p.side === 'enemy' && p.hp > 0).map(p => p.name);
    actions.push({ type: 'skill', skillName: skill.name, targets, mpCost: skill.mpCost, desc: skill.desc || skill.name });
  }
  // Melee weapon
  const meleeTargets = this.participants.filter(p => p.side === 'enemy' && p.hp > 0).map(p => p.name);
  actions.push({ type: 'melee', targets: meleeTargets, desc: participant.equipment?.weapon?.name || '近戰攻擊' });
  // Items
  actions.push({ type: 'item', desc: '使用物品' });
  // Flee
  actions.push({ type: 'flee', desc: '逃跑' });
  return actions;
}
```

- [ ] **Step 10: Run all tests**

Run: `cd /Users/ibridgezhao/Documents/DnD && node server/tests/combat-engine.test.js`
Expected: `All combat-engine tests passed!`

- [ ] **Step 11: Commit**

```bash
git add server/combat-engine.js server/tests/combat-engine.test.js
git commit -m "feat: implement CombatSession with initiative, actions, AI, DOTs, loot"
```

---

### Task 4: Encounter Generator

Generate random encounters and boss encounters from parsed monster data.

**Files:**
- Modify: `server/combat-engine.js` (add EncounterGenerator class)
- Test: `server/tests/encounter.test.js`

- [ ] **Step 1: Write failing test**

```javascript
// server/tests/encounter.test.js
const { EncounterGenerator } = require('../combat-engine');
const { parseEnemiesFile } = require('../monster-parser');
const assert = require('assert');

const monsterDb = parseEnemiesFile('warcraft');
const gen = new EncounterGenerator(monsterDb);

// Random encounter for level 1-2 area, 1 player
const encounter = gen.generateRandom(1, 1);
assert.ok(encounter.length >= 1, 'Should generate at least 1 enemy');
assert.ok(encounter.length <= 3, 'Should not exceed 3 enemies');
assert.ok(encounter[0].hp > 0, 'Enemy should have HP');
assert.ok(encounter[0].maxHp > 0, 'Enemy should have maxHp');
assert.ok(encounter[0].name, 'Enemy should have name');

// Aggro check
const aggro = gen.aggroCheck();
assert.ok(typeof aggro === 'boolean');

console.log(`Generated ${encounter.length} enemies: ${encounter.map(e => e.name).join(', ')}`);
console.log('All encounter tests passed!');
```

- [ ] **Step 2: Run to verify failure**

- [ ] **Step 3: Implement EncounterGenerator**

```javascript
// Add to combat-engine.js

class EncounterGenerator {
  constructor(monsterDb) {
    this.monsterDb = monsterDb; // Map<name, template>
  }

  generateRandom(areaLevel, playerCount) {
    // Filter monsters matching area level
    const candidates = [];
    for (const [name, template] of this.monsterDb) {
      if (template.levelRange[0] <= areaLevel + 1 && template.levelRange[1] >= areaLevel - 1) {
        candidates.push(template);
      }
    }
    if (candidates.length === 0) return [];

    // Determine count: 1-3 enemies
    const count = Math.min(Math.floor(Math.random() * 3) + 1, candidates.length);
    const enemies = [];
    for (let i = 0; i < count; i++) {
      const template = candidates[Math.floor(Math.random() * candidates.length)];
      const instance = this.instantiate(template, playerCount);
      instance.name = count > 1 ? `${template.name}${String.fromCharCode(65 + i)}` : template.name;
      enemies.push(instance);
    }
    return enemies;
  }

  instantiate(template, playerCount) {
    const { roll: rollDice } = require('./game-engine');
    const diff = CombatSession.getDifficulty ? { hpMult: 1, atkMod: 0 } : { hpMult: 1, atkMod: 0 };
    const hpRoll = rollDice(template.hp);
    return {
      name: template.name,
      type: 'enemy',
      enemyType: template.type,
      hp: hpRoll.total,
      maxHp: hpRoll.total,
      ac: template.ac,
      attacks: template.attacks.map(a => ({ ...a })),
      special: template.special,
      loot: template.loot,
      exp: template.exp,
    };
  }

  aggroCheck() {
    // d20: <=10 no extra aggro, >10 pulls nearby
    const { d20: rollD20 } = require('./game-engine');
    return rollD20() > 10;
  }
}
```

- [ ] **Step 4: Export and run tests**

- [ ] **Step 5: Commit**

```bash
git add server/combat-engine.js server/tests/encounter.test.js
git commit -m "feat: add EncounterGenerator for random and boss encounters"
```

---

### Task 5: Relay.js Input Routing + Gemini Integration

Modify relay.js to route player input through the combat engine, add Gemini intent parsing and narrative generation.

**Files:**
- Modify: `server/relay.js`
- Read: `server/combat-engine.js`, `server/monster-parser.js`

- [ ] **Step 1: Add imports and combat state tracking to relay.js**

At top of relay.js, add:
```javascript
const { CombatSession, EncounterGenerator } = require('./combat-engine');
const { parseEnemiesFile } = require('./monster-parser');

const monsterDatabases = new Map(); // campaign → Map<name, template>
const activeCombats = new Map();    // roomId → CombatSession
```

- [ ] **Step 2: Add monster DB loading in GameSession.init**

After `this.chat = model.startChat(...)`, add:
```javascript
if (!monsterDatabases.has(campaign)) {
  monsterDatabases.set(campaign, parseEnemiesFile(campaign));
}
```

- [ ] **Step 3: Add Gemini intent parser function**

```javascript
async function parsePlayerIntent(genAI, input, combatContext) {
  const model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash' });
  const prompt = `你是指令解析器。把玩家的自然語言轉成JSON。只返回JSON，不要其他文字。

可用行動類型：
- skill: 使用技能（需要 skillName 和 target）
- melee: 近戰武器攻擊（需要 target）
- item: 使用物品（需要 itemName）
- flee: 逃跑

${combatContext}

玩家輸入：「${input}」`;

  try {
    const result = await model.generateContent(prompt);
    const text = result.response.text().trim();
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (jsonMatch) return JSON.parse(jsonMatch[0]);
  } catch (e) {
    console.error('[意圖解析失敗]', e.message);
  }
  return null;
}
```

- [ ] **Step 4: Add Gemini narration function**

```javascript
async function generateNarrative(genAI, mechanicalResults, lang) {
  const model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash' });
  const langInst = lang === 'en' ? 'in English' : lang === 'ja' ? '日本語で' : '用繁體中文';
  const prompt = `你是戰鬥旁白。根據以下機械結果${langInst}寫2-3句沉浸式描述。不要改動數值。不要添加選項。只寫敘事。

${mechanicalResults}`;

  try {
    const result = await model.generateContent(prompt);
    return result.response.text().trim();
  } catch (e) {
    console.error('[敘事生成失敗]', e.message);
    return mechanicalResults; // fallback to mechanical text
  }
}
```

- [ ] **Step 5: Add combat status bar generator**

```javascript
function buildCombatStatusBar(combat, currentPlayer) {
  const players = combat.participants.filter(p => p.side === 'player');
  const enemies = combat.participants.filter(p => p.side === 'enemy' && p.hp > 0);
  const summons = combat.summons || [];

  let bar = '\n╔═══════════════════════════════════╗\n';
  for (const p of players) {
    const mpStr = p.mp !== undefined ? ` MP:${p.mp}/${p.maxMp}` : '';
    bar += `║ ${p.name} HP:${p.hp}/${p.maxHp}${mpStr}\n`;
  }
  for (const s of summons) {
    bar += `║ 👹 ${s.name} HP:${s.hp}/${s.maxHp}\n`;
  }
  bar += '╠═══════════════════════════════════╣\n';
  for (const e of enemies) {
    const pct = Math.round(e.hp / e.maxHp * 100);
    const warn = pct <= 20 ? ' ⚠️' : '';
    bar += `║ ${e.name} HP:${e.hp}/${e.maxHp}${warn}\n`;
  }
  bar += '╠═══════════════════════════════════╣\n';

  // Generate numbered options
  const actions = combat.getAvailableActions(currentPlayer);
  let optNum = 1;
  const options = {};
  for (const a of actions) {
    if (a.type === 'skill' || a.type === 'melee') {
      for (const t of (a.targets || [])) {
        bar += `║ ${optNum}. ${a.desc} → ${t}\n`;
        options[String(optNum)] = { ...a, target: t };
        optNum++;
      }
    } else {
      bar += `║ ${optNum}. ${a.desc}\n`;
      options[String(optNum)] = a;
      optNum++;
    }
  }
  bar += '╚═══════════════════════════════════╝';

  return { bar, options };
}
```

- [ ] **Step 6: Modify player_action handler to route through combat engine**

In the `case 'player_action'` section of relay.js, before the existing Gemini call, add combat routing:

```javascript
// After save/load handlers, before the existing Gemini AI call:

// === Combat Engine Routing ===
const activeCombat = activeCombats.get(roomId);
if (activeCombat && activeCombat.isActive) {
  const currentTurn = activeCombat.getCurrentTurn();
  if (currentTurn && currentTurn.name !== senderName && currentTurn.side === 'player') {
    ws.send(JSON.stringify({ type: 'game_output', content: `⏳ 等待 ${currentTurn.name} 行動...` }));
    break;
  }

  let action = null;
  const session = gameSessions.get(roomId);

  // Number input → lookup option table
  if (/^\d+$/.test(actionTrimmed) && activeCombat._lastOptions) {
    action = activeCombat._lastOptions[actionTrimmed];
  }

  // Free text → Gemini intent parse
  if (!action) {
    const ctx = `敵人：${activeCombat.participants.filter(p=>p.side==='enemy'&&p.hp>0).map(p=>`${p.name}(HP${p.hp}/${p.maxHp})`).join('、')}\n技能：${(currentTurn.skills||[]).map(s=>s.name).join('、')}`;
    const intent = await parsePlayerIntent(genAI, actionTrimmed, ctx);
    if (intent && intent.actions) action = intent.actions[0];
    else if (intent) action = intent;
  }

  if (!action) {
    ws.send(JSON.stringify({ type: 'game_output', content: '⚠ 無法理解指令，請選擇數字或描述你的行動。' }));
    break;
  }

  // Execute player action
  broadcastAll(actionRoom, { type: 'game_thinking', from: 'DM' });
  const result = activeCombat.executeAction(currentTurn, action);
  let allResults = [result];

  // Execute summon AI
  for (const summon of activeCombat.summons) {
    allResults.push(activeCombat.executeSummonAI(summon));
  }

  // Advance turn - execute enemy actions
  let next = activeCombat.advanceTurn();
  while (next && next.side === 'enemy' && activeCombat.isActive) {
    allResults.push(activeCombat.executeMonsterAI(next));
    next = activeCombat.advanceTurn();
  }

  // Check combat end
  const endCheck = activeCombat.checkCombatEnd();

  // Generate narrative
  const mechanicalText = allResults.map(r => r.summary).join('\n');
  const lang = actionRoom.lang || 'zh';
  const narrative = await generateNarrative(genAI, mechanicalText, lang);

  // Build output
  let output = narrative + '\n';
  if (endCheck.ended) {
    if (endCheck.result === 'victory') {
      output += `\n🏆 戰鬥勝利！\n`;
      output += `EXP +${endCheck.loot.exp}`;
      if (endCheck.loot.items.length > 0) output += `\n掉落：${endCheck.loot.items.map(i=>i.name).join('、')}`;
      output += '\n\n1. 繼續前進\n2. 調查周圍\n3. 使用物品';
    } else {
      output += '\n💀 戰鬥失敗...\n\n1. 復活（花費金幣）\n2. 讀取存檔';
    }
    activeCombats.delete(roomId);
  } else {
    // Build status bar + options for next player turn
    const nextPlayer = activeCombat.getCurrentTurn();
    const { bar, options: opts } = buildCombatStatusBar(activeCombat, nextPlayer);
    activeCombat._lastOptions = opts;
    output += bar;
  }

  broadcastAll(actionRoom, { type: 'game_output', content: output });

  // Update external memory
  if (session) session.parseState(output);
  break;
}
// === End Combat Routing ===
```

- [ ] **Step 7: Add combat trigger detection**

When Gemini's non-combat response mentions a battle starting, or when players enter a zone that triggers random encounter, start combat:

```javascript
// Add function to relay.js
async function triggerCombat(roomId, room, enemies, session) {
  const players = [];
  for (const [name, charData] of room.characters) {
    const c = charData.character;
    players.push({
      name: charData.meta.name, type: 'player', playerName: name,
      stats: c.stats, hp: parseInt(c.hp) || c.max_hp, maxHp: parseInt(c.max_hp) || c.hp,
      ac: parseInt(c.ac) || 10, level: parseInt(c.level) || 1,
      className: c.class, campaign: room.campaign,
      skills: getSkillsForLevel(room.campaign, c.class, parseInt(c.level) || 1),
      talents: c.talents || [],
      equipment: c.equipment || {},
      mp: parseInt(c.mp) || 0, maxMp: parseInt(c.maxMp) || 0,
      proficiency: proficiencyBonus(parseInt(c.level) || 1),
    });
  }

  const playerCount = players.length;
  const difficulty = GameSession.getDifficulty(playerCount);
  const combat = new CombatSession(players, enemies, difficulty);
  const initResult = combat.initCombat();
  activeCombats.set(roomId, combat);

  // Generate initiative narrative
  const initText = initResult.order.map(p => `${p.name}: ${p.initiative}`).join(', ');
  const narrative = await generateNarrative(genAI, `戰鬥開始！先攻順序：${initText}`, room.lang || 'zh');

  const firstTurn = combat.getCurrentTurn();
  const { bar, options } = buildCombatStatusBar(combat, firstTurn);
  combat._lastOptions = options;

  broadcastAll(room, { type: 'game_output', content: `⚔️ ${narrative}\n${bar}` });
}
```

- [ ] **Step 8: Manual integration test**

Run: `cd /Users/ibridgezhao/Documents/DnD/server && node relay.js`
- Create a room, start a warcraft game
- Test combat triggers and action routing

- [ ] **Step 9: Commit**

```bash
git add server/relay.js
git commit -m "feat: integrate combat engine with relay.js input routing and Gemini narration"
```

---

### Task 6: End-to-End Integration Test

Verify the full flow works: player action → combat engine → Gemini narration → client output.

**Files:**
- Create: `server/tests/integration.test.js`

- [ ] **Step 1: Write integration test**

```javascript
// server/tests/integration.test.js
const { CombatSession, EncounterGenerator } = require('../combat-engine');
const { parseEnemiesFile } = require('../monster-parser');
const { getSkillsForLevel, modifier, proficiencyBonus } = require('../game-engine');
const assert = require('assert');

// Simulate full combat: 小馬屁精 vs 2 食屍鬼
const monsterDb = parseEnemiesFile('warcraft');
const gen = new EncounterGenerator(monsterDb);

const player = {
  name: '小馬屁精', type: 'player',
  stats: { STR: 8, DEX: 14, CON: 15, INT: 17, WIS: 10, CHA: 10 },
  hp: 25, maxHp: 25, ac: 13, level: 4,
  className: '術士', campaign: 'warcraft',
  skills: getSkillsForLevel('warcraft', '術士', 4),
  talents: [{ name: '強化小鬼', tree: '惡魔' }],
  equipment: { weapon: { name: '暗影法杖', damage: '1d6', stat: 'INT' } },
  mp: 21, maxMp: 21,
  proficiency: proficiencyBonus(4),
};

// Get enemies from database
const wolfTemplate = monsterDb.get('飢餓野狼');
assert.ok(wolfTemplate, 'Should find wolf in database');

const enemies = [
  { ...gen.instantiate(wolfTemplate, 1), name: '飢餓野狼A' },
  { ...gen.instantiate(wolfTemplate, 1), name: '飢餓野狼B' },
];

const combat = new CombatSession([player], enemies, { hpMult: 0.5, atkMod: -2 });
const init = combat.initCombat();
console.log('Initiative:', init.order.map(p => `${p.name}(${p.initiative})`).join(' > '));

// Simulate combat rounds
let rounds = 0;
while (combat.isActive && rounds < 20) {
  const current = combat.getCurrentTurn();
  let result;

  if (current.side === 'player') {
    // Player uses 暗影箭 on first alive enemy
    const target = combat.participants.find(p => p.side === 'enemy' && p.hp > 0);
    if (target) {
      result = combat.executeAction(current, { type: 'skill', skillName: '暗影箭', target: target.name });
    }
  } else {
    result = combat.executeMonsterAI(current);
  }

  if (result) console.log(`  R${combat.round}: ${result.summary}`);

  const endCheck = combat.checkCombatEnd();
  if (endCheck.ended) {
    console.log(`\nCombat ended: ${endCheck.result}`);
    if (endCheck.loot) console.log(`Loot: EXP=${endCheck.loot.exp}, items=${endCheck.loot.items.map(i=>i.name).join(',')}`);
    break;
  }

  combat.advanceTurn();
  rounds++;
}

assert.ok(!combat.isActive, 'Combat should have ended');
console.log('\nFull integration test passed!');
```

- [ ] **Step 2: Run integration test**

Run: `cd /Users/ibridgezhao/Documents/DnD && node server/tests/integration.test.js`
Expected: Combat plays out, ends with victory or defeat, `Full integration test passed!`

- [ ] **Step 3: Commit**

```bash
git add server/tests/integration.test.js
git commit -m "test: add end-to-end combat integration test"
```

---

### Task 7: Final Cleanup and Documentation

- [ ] **Step 1: Update CLAUDE.md with combat engine info**

Add to project CLAUDE.md:
```markdown
## 戰鬥引擎
- `server/combat-engine.js` — CombatSession（戰鬥流程）、EncounterGenerator（遭遇生成）
- `server/monster-parser.js` — 從 enemies.md 解析怪物數據
- 戰鬥中所有擲骰/傷害/HP 由代碼控制，Gemini 只負責敘事描寫
- 玩家輸入數字走選項表，自由文字由 Gemini 解析意圖後代碼執行
```

- [ ] **Step 2: Run all tests**

```bash
cd /Users/ibridgezhao/Documents/DnD
node server/tests/monster-parser.test.js
node server/tests/game-data.test.js
node server/tests/combat-engine.test.js
node server/tests/encounter.test.js
node server/tests/integration.test.js
```

All should pass.

- [ ] **Step 3: Final commit**

```bash
git add -A
git commit -m "docs: update CLAUDE.md with combat engine documentation"
```
