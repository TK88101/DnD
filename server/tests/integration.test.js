const { CombatSession, EncounterGenerator } = require('../combat-engine');
const { parseEnemiesFile } = require('../monster-parser');
const { getSkillsForLevel, modifier, proficiencyBonus, calculateMP } = require('../game-engine');
const assert = require('assert');

console.log('=== End-to-End Integration Test ===\n');

// === Setup: Load monster DB ===
const monsterDb = parseEnemiesFile('warcraft');
assert.ok(monsterDb.size > 0, 'Monster DB should load');
console.log(`Loaded ${monsterDb.size} monsters`);

// === Setup: Create player (小馬屁精 Lv4 warlock) ===
const gen = new EncounterGenerator(monsterDb);
const intMod = modifier(17);
const player = {
  name: '小馬屁精', type: 'player',
  stats: { STR: 8, DEX: 14, CON: 15, INT: 17, WIS: 10, CHA: 10 },
  hp: 25, maxHp: 25, ac: 13, level: 4,
  className: '術士', campaign: 'warcraft',
  skills: getSkillsForLevel('warcraft', '術士', 4),
  talents: [{ name: '強化小鬼', tree: '惡魔' }],
  equipment: { weapon: { name: '暗影法杖', damage: '1d6', stat: 'INT' } },
  mp: calculateMP('術士', 4, intMod),
  maxMp: calculateMP('術士', 4, intMod),
  proficiency: proficiencyBonus(4),
};
console.log(`Player: ${player.name} Lv${player.level} ${player.className} HP:${player.hp} MP:${player.mp}`);
console.log(`Skills: ${player.skills.map(s => s.name).join(', ')}`);

// === Test 1: Random encounter generation ===
console.log('\n--- Test 1: Random Encounter ---');
const encounter = gen.generateRandom(2, 1);
assert.ok(encounter.length >= 1 && encounter.length <= 3);
console.log(`Generated: ${encounter.map(e => `${e.name}(HP${e.hp})`).join(', ')}`);

// === Test 2: Full combat with skill rotation ===
console.log('\n--- Test 2: Full Combat (Skill Rotation) ---');
const wolfTemplate = monsterDb.get('飢餓野狼');
const enemies = [
  { ...gen.instantiate(wolfTemplate), name: '飢餓野狼A' },
  { ...gen.instantiate(wolfTemplate), name: '飢餓野狼B' },
];

const combat = new CombatSession([{ ...player }], enemies, CombatSession.getDifficulty(1));
const init = combat.initCombat();
console.log(`Initiative: ${init.order.map(p => `${p.name}(${p.initiative})`).join(' > ')}`);

// Simulate skill rotation: 腐蝕術 → 暗影箭 → 暗影箭 ...
let turn = 0;
const skillRotation = ['腐蝕術', '暗影箭', '暗影箭', '暗影箭', '暗影箭'];
while (combat.isActive && turn < 30) {
  const current = combat.getCurrentTurn();
  let result;

  if (current.side === 'player') {
    const target = combat.participants.find(p => p.side === 'enemy' && p.hp > 0);
    if (target) {
      const skillName = skillRotation[Math.min(turn, skillRotation.length - 1)];
      result = combat.executeAction(current, { type: 'skill', skillName, target: target.name });
    }
    turn++;
  } else {
    result = combat.executeMonsterAI(current);
  }
  if (result) console.log(`  ${result.summary}`);

  const end = combat.checkCombatEnd();
  if (end.ended) {
    console.log(`\nResult: ${end.result}`);
    console.log(`EXP: ${end.loot?.exp || 0}`);
    console.log(`Loot: ${(end.loot?.items || []).map(i => i.name).join(', ') || 'none'}`);
    break;
  }
  combat.advanceTurn();
}
assert.ok(!combat.isActive, 'Combat should have ended');

// === Test 3: Available actions list ===
console.log('\n--- Test 3: Available Actions ---');
const combat3 = new CombatSession(
  [{ ...player }],
  [{ ...gen.instantiate(wolfTemplate), name: '測試狼' }],
  CombatSession.getDifficulty(1)
);
combat3.initCombat();
const p3 = combat3.participants.find(p => p.side === 'player');
const actions = combat3.getAvailableActions(p3);
console.log(`Available actions for ${p3.name}:`);
for (const a of actions) {
  const targetsStr = a.targets ? a.targets.join('/') : '';
  console.log(`  [${a.type}] ${a.desc} → ${targetsStr}`);
}
assert.ok(actions.find(a => a.skillName === '暗影箭'));
assert.ok(actions.find(a => a.skillName === '腐蝕術'));
assert.ok(actions.find(a => a.skillName === '召喚小鬼'));
assert.ok(actions.find(a => a.type === 'melee'));
assert.ok(actions.find(a => a.type === 'flee'));

// === Test 4: DOT damage processing ===
console.log('\n--- Test 4: DOT Processing ---');
const combat4 = new CombatSession(
  [{ ...player }],
  [{ ...gen.instantiate(wolfTemplate), name: 'DOT測試狼' }],
  { hpMult: 1, atkMod: 0 }
);
combat4.initCombat();
const p4 = combat4.participants.find(p => p.side === 'player');
const wolf4 = combat4.participants.find(p => p.side === 'enemy');
// Apply DOT
combat4.executeAction(p4, { type: 'skill', skillName: '腐蝕術', target: wolf4.name });
assert.ok(combat4.dots.length > 0, 'Should have active DOT');
console.log(`DOT applied: ${combat4.dots[0].damage} ${combat4.dots[0].damageType} for ${combat4.dots[0].remaining} rounds`);
// Process DOTs
const dotResults = combat4.processDOTs();
assert.ok(dotResults.length > 0, 'Should process DOT tick');
console.log(`DOT tick: ${dotResults[0].summary}`);

// === Test 5: Drain (生命虹吸) - need Lv6 ===
console.log('\n--- Test 5: Life Drain ---');
const lv6Player = { ...player, level: 6, hp: 15, skills: getSkillsForLevel('warcraft', '術士', 6) };
const combat5 = new CombatSession(
  [lv6Player],
  [{ ...gen.instantiate(wolfTemplate), name: '吸血測試狼' }],
  { hpMult: 1, atkMod: 0 }
);
combat5.initCombat();
const p5 = combat5.participants.find(p => p.side === 'player');
const wolf5 = combat5.participants.find(p => p.side === 'enemy');
const drainResult = combat5.executeAction(p5, { type: 'skill', skillName: '生命虹吸', target: wolf5.name });
if (drainResult.hit) {
  console.log(`Drain: dealt ${drainResult.damage.total} damage, healed ${drainResult.effects.find(e => e.type === 'heal')?.amount || 0} HP`);
  assert.ok(p5.hp > 15 || drainResult.effects.length > 0, 'Should heal on drain');
} else {
  console.log('Drain missed (expected sometimes)');
}

// === Test 6: Heal skill ===
console.log('\n--- Test 6: Heal Skill ---');
const priest = {
  name: '測試牧師', type: 'player',
  stats: { STR: 8, DEX: 10, CON: 12, INT: 10, WIS: 16, CHA: 10 },
  hp: 10, maxHp: 20, ac: 11, level: 1,
  className: '牧師', campaign: 'warcraft',
  skills: getSkillsForLevel('warcraft', '牧師', 1),
  equipment: {}, mp: 20, maxMp: 20,
  proficiency: 2,
};
const combat6 = new CombatSession(
  [{ ...priest }],
  [{ ...gen.instantiate(wolfTemplate), name: '不重要的狼' }],
  { hpMult: 1, atkMod: 0 }
);
combat6.initCombat();
const p6 = combat6.participants.find(p => p.name === '測試牧師');
const healResult = combat6.executeAction(p6, { type: 'skill', skillName: '聖光術', target: '測試牧師' });
console.log(`Heal: ${healResult.summary}`);
assert.ok(p6.hp > 10, 'HP should increase after heal');

// === Test 7: MP depletion ===
console.log('\n--- Test 7: MP System ---');
const combat7 = new CombatSession(
  [{ ...player, mp: 3, maxMp: 21 }],
  [{ ...gen.instantiate(wolfTemplate), name: 'MP測試狼' }],
  { hpMult: 1, atkMod: 0 }
);
combat7.initCombat();
const p7 = combat7.participants.find(p => p.side === 'player');
const mpResult = combat7.executeAction(p7, { type: 'skill', skillName: '暗影箭', target: 'MP測試狼' });
if (p7.mp < 3) {
  console.log(`MP deducted: 3 → ${p7.mp}`);
} else if (mpResult.error === 'MP不足') {
  console.log('MP insufficient: correctly rejected');
}

console.log('\n=== All integration tests passed! ===');
