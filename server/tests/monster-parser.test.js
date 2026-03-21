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

// Integration test
const enemies = parseEnemiesFile('warcraft');
assert.ok(enemies.size > 0, 'Should parse at least one enemy');
assert.ok(enemies.has('飢餓野狼'), 'Should have 飢餓野狼');
assert.ok(enemies.has('狗頭人礦工'), 'Should have 狗頭人礦工');
console.log(`parseEnemiesFile: parsed ${enemies.size} enemies`);
console.log('All monster-parser tests passed!');
