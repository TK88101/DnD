const { CombatSession, EncounterGenerator } = require('../combat-engine');
const { parseEnemiesFile } = require('../monster-parser');
const { getSkillsForLevel, proficiencyBonus } = require('../game-engine');
const assert = require('assert');

// === Test 1: initCombat ===
const players = [{
  name: '小馬屁精', type: 'player',
  stats: { STR: 8, DEX: 14, CON: 15, INT: 17, WIS: 10, CHA: 10 },
  hp: 25, maxHp: 25, ac: 13, level: 4,
  className: '術士', campaign: 'warcraft',
  skills: getSkillsForLevel('warcraft', '術士', 4),
  talents: [],
  equipment: { weapon: { name: '暗影法杖', damage: '1d6', stat: 'INT' } },
  mp: 21, maxMp: 21,
  proficiency: proficiencyBonus(4),
}];

const enemies = [{
  name: '食屍鬼A', type: 'enemy',
  hp: 8, maxHp: 8, ac: 10,
  attacks: [{ name: '爪擊', bonus: 2, damage: '1d4+1', damageType: '揮砍', type: 'melee' }],
  special: [], exp: 15, loot: [{ name: '碎骨', price: 5, weight: 100 }],
}];

const combat = new CombatSession(JSON.parse(JSON.stringify(players)), JSON.parse(JSON.stringify(enemies)), { hpMult: 1, atkMod: 0 });
const initResult = combat.initCombat();
assert.ok(initResult.order.length === 2, 'Should have 2 participants');
assert.ok(initResult.order[0].initiative >= initResult.order[1].initiative, 'Sorted by initiative');
assert.strictEqual(combat.round, 1);
assert.strictEqual(combat.isActive, true);
console.log('initCombat tests passed');

// === Test 2: executeAction (skill attack) ===
const combat2 = new CombatSession(JSON.parse(JSON.stringify(players)), JSON.parse(JSON.stringify(enemies)), { hpMult: 1, atkMod: 0 });
combat2.initCombat();
const player2 = combat2.participants.find(p => p.name === '小馬屁精');
const result = combat2.executeAction(player2, { type: 'skill', skillName: '暗影箭', target: '食屍鬼A' });
assert.strictEqual(result.actor, '小馬屁精');
assert.strictEqual(result.action, '暗影箭');
assert.ok(typeof result.hit === 'boolean');
if (result.hit) {
  assert.ok(result.damage.total > 0);
}
assert.ok(result.summary.length > 0);
console.log('executeAction (skill) tests passed');

// === Test 3: executeAction (melee) ===
const combat2b = new CombatSession(JSON.parse(JSON.stringify(players)), JSON.parse(JSON.stringify(enemies)), { hpMult: 1, atkMod: 0 });
combat2b.initCombat();
const player2b = combat2b.participants.find(p => p.name === '小馬屁精');
const meleeResult = combat2b.executeAction(player2b, { type: 'melee', target: '食屍鬼A' });
assert.strictEqual(meleeResult.actor, '小馬屁精');
assert.ok(meleeResult.action.includes('暗影法杖') || meleeResult.action === '近戰攻擊');
console.log('executeAction (melee) tests passed');

// === Test 4: executeMonsterAI ===
const combat3 = new CombatSession(
  [{ name: 'TestPlayer', type: 'player', stats: { STR:10,DEX:10,CON:10,INT:10,WIS:10,CHA:10 }, hp: 20, maxHp: 20, ac: 12, level: 1, skills: [], equipment: {}, proficiency: 2 }],
  [{ name: 'TestMob', type: 'enemy', hp: 10, maxHp: 10, ac: 10, attacks: [{ name: 'Bite', bonus: 2, damage: '1d4', damageType: '物理', type: 'melee' }], special: [], exp: 10, loot: [] }],
  { hpMult: 1, atkMod: 0 }
);
combat3.initCombat();
const mob = combat3.participants.find(p => p.side === 'enemy');
const aiResult = combat3.executeMonsterAI(mob);
assert.strictEqual(aiResult.actor, 'TestMob');
assert.strictEqual(aiResult.target, 'TestPlayer');
console.log('executeMonsterAI tests passed');

// === Test 5: checkCombatEnd ===
const combat4 = new CombatSession(
  [{ name: 'P', type: 'player', stats: { STR:10,DEX:10,CON:10,INT:10,WIS:10,CHA:10 }, hp: 10, maxHp: 10, ac: 10, level: 1, skills: [], equipment: {} }],
  [{ name: 'M', type: 'enemy', hp: 5, maxHp: 5, ac: 10, attacks: [], special: [], exp: 10, loot: [{ name: 'Bone', price: 5, weight: 100 }] }],
  { hpMult: 1, atkMod: 0 }
);
combat4.initCombat();
// Manually kill the enemy to test combat end
combat4.participants.find(p => p.name === 'M').hp = 0;
const endResult = combat4.checkCombatEnd();
assert.strictEqual(endResult.ended, true);
assert.strictEqual(endResult.result, 'victory');
assert.ok(endResult.loot.exp === 10);
console.log('checkCombatEnd tests passed');

// === Test 6: getAvailableActions ===
const combat5 = new CombatSession(JSON.parse(JSON.stringify(players)), JSON.parse(JSON.stringify(enemies)), { hpMult: 1, atkMod: 0 });
combat5.initCombat();
const p5 = combat5.participants.find(p => p.name === '小馬屁精');
const actions = combat5.getAvailableActions(p5);
assert.ok(actions.length > 0, 'Should have available actions');
assert.ok(actions.find(a => a.skillName === '暗影箭'), 'Should include 暗影箭');
assert.ok(actions.find(a => a.type === 'melee'), 'Should include melee');
assert.ok(actions.find(a => a.type === 'flee'), 'Should include flee');
console.log('getAvailableActions tests passed');

// === Test 7: EncounterGenerator ===
const monsterDb = parseEnemiesFile('warcraft');
const gen = new EncounterGenerator(monsterDb);
const encounter = gen.generateRandom(1, 1);
assert.ok(encounter.length >= 1, 'Should generate at least 1 enemy');
assert.ok(encounter.length <= 3, 'Should not exceed 3');
assert.ok(encounter[0].hp > 0, 'Enemy should have HP');
assert.ok(encounter[0].name, 'Enemy should have name');
const aggro = gen.aggroCheck();
assert.ok(typeof aggro === 'boolean');
console.log(`EncounterGenerator: ${encounter.length} enemies (${encounter.map(e => e.name).join(', ')})`);
console.log('EncounterGenerator tests passed');

// === Test 8: Full combat simulation ===
const simPlayer = JSON.parse(JSON.stringify(players[0]));
const wolfTemplate = monsterDb.get('飢餓野狼');
const simEnemies = [
  gen.instantiate(wolfTemplate),
  gen.instantiate(wolfTemplate),
];
simEnemies[0].name = '飢餓野狼A';
simEnemies[1].name = '飢餓野狼B';

const sim = new CombatSession([simPlayer], simEnemies, CombatSession.getDifficulty(1));
const simInit = sim.initCombat();
console.log('\n--- Full Combat Sim ---');
console.log('Initiative:', simInit.order.map(p => `${p.name}(${p.initiative})`).join(' > '));

let rounds = 0;
while (sim.isActive && rounds < 30) {
  const current = sim.getCurrentTurn();
  let r;
  if (current.side === 'player') {
    const target = sim.participants.find(p => p.side === 'enemy' && p.hp > 0);
    if (target) r = sim.executeAction(current, { type: 'skill', skillName: '暗影箭', target: target.name });
  } else {
    r = sim.executeMonsterAI(current);
  }
  if (r) console.log(`  ${r.summary}`);

  const end = sim.checkCombatEnd();
  if (end.ended) {
    console.log(`Combat: ${end.result} | EXP: ${end.loot?.exp || 0} | Items: ${(end.loot?.items || []).map(i=>i.name).join(',') || 'none'}`);
    break;
  }
  sim.advanceTurn();
  rounds++;
}
assert.ok(!sim.isActive, 'Combat should have ended');
console.log('Full combat simulation passed!');

console.log('\n=== All combat-engine tests passed! ===');
