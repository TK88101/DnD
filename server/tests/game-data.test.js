const { SKILLS, TALENTS, SUMMONS, calculateMP, getSkillsForLevel } = require('../game-engine');
const assert = require('assert');

// Skills
assert.ok(SKILLS.warcraft['術士'], 'Should have warlock skills');
const warlockSkills = SKILLS.warcraft['術士'];
assert.strictEqual(warlockSkills[0].name, '暗影箭');
assert.strictEqual(warlockSkills[0].level, 1);
assert.strictEqual(warlockSkills[0].damage, '2d6');

assert.ok(SKILLS.warcraft['戰士'], 'Should have warrior skills');
assert.ok(SKILLS.warcraft['法師'], 'Should have mage skills');
assert.ok(SKILLS.warcraft['牧師'], 'Should have priest skills');
assert.ok(SKILLS.warcraft['盜賊'], 'Should have rogue skills');
assert.ok(SKILLS.warcraft['獵人'], 'Should have hunter skills');
assert.ok(SKILLS.warcraft['聖騎士'], 'Should have paladin skills');
assert.ok(SKILLS.warcraft['薩滿'], 'Should have shaman skills');
assert.ok(SKILLS.warcraft['德魯伊'], 'Should have druid skills');
console.log('SKILLS: all 9 classes present');

// getSkillsForLevel
const lv4Skills = getSkillsForLevel('warcraft', '術士', 4);
assert.ok(lv4Skills.find(s => s.name === '暗影箭'), 'Lv4 should have 暗影箭');
assert.ok(lv4Skills.find(s => s.name === '腐蝕術'), 'Lv4 should have 腐蝕術');
assert.ok(lv4Skills.find(s => s.name === '召喚小鬼'), 'Lv4 should have 召喚小鬼');
assert.ok(!lv4Skills.find(s => s.name === '生命虹吸'), 'Lv4 should NOT have 生命虹吸 (Lv6)');
console.log('getSkillsForLevel: correct');

// Talents
assert.ok(TALENTS.warcraft['術士']['惡魔'], 'Should have warlock demon tree');
assert.strictEqual(TALENTS.warcraft['術士']['惡魔'][0].name, '強化小鬼');
assert.ok(TALENTS.warcraft['術士']['痛苦'], 'Should have warlock affliction tree');
assert.ok(TALENTS.warcraft['術士']['毀滅'], 'Should have warlock destruction tree');
console.log('TALENTS: warlock trees present');

// Summons
assert.ok(SUMMONS.imp, 'Should have imp summon');
assert.strictEqual(SUMMONS.imp.ai, 'dps_ranged');
assert.ok(SUMMONS.voidwalker, 'Should have voidwalker');
assert.strictEqual(SUMMONS.voidwalker.ai, 'tank');
console.log('SUMMONS: present');

// MP
const mp = calculateMP('術士', 4, 3);
assert.strictEqual(mp, 15 + (4-1)*5 + 3*2, 'MP formula: base + (lv-1)*5 + intMod*2');
assert.strictEqual(calculateMP('戰士', 5, 0), 0, 'Warriors have no MP');
console.log('calculateMP: correct');

console.log('All game-data tests passed!');
