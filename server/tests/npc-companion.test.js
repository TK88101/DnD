const assert = require('assert');
const { NPCCompanion, generateCompanionParty, getLabel } = require('../npc-companion');
const { DUNGEON_MODES, DUNGEON_TYPES, validateDungeonEntry, getDungeonDifficulty, getMultiplayerScaling } = require('../dungeon-mode');
const { CombatSession } = require('../combat-engine');
const { getSkillsForLevel, CLASSES, RACES } = require('../game-engine');

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    console.log(`  ✅ ${name}`);
    passed++;
  } catch (e) {
    console.log(`  ❌ ${name}: ${e.message}`);
    failed++;
  }
}

// === NPC 性格系统 ===
console.log('\n=== NPC 双轴性格系统 ===');

test('创建 NPC 队友时自动 roll 性格双轴', () => {
  const npc = new NPCCompanion({
    name: '测试NPC',
    race: '獸人',
    raceData: RACES.warcraft['7'],
    className: '戰士',
    classData: CLASSES.warcraft['戰士'],
    level: 5,
    campaign: 'warcraft',
  });
  assert.ok(npc.temperament >= 0 && npc.temperament <= 10, `性情值 ${npc.temperament} 在 0-10 范围内`);
  assert.ok(npc.stance >= 0 && npc.stance <= 10, `立场值 ${npc.stance} 在 0-10 范围内`);
});

test('NPC 属性根据职业和种族正确生成', () => {
  const npc = new NPCCompanion({
    name: '测试战士',
    race: '獸人',
    raceData: RACES.warcraft['7'],
    className: '戰士',
    classData: CLASSES.warcraft['戰士'],
    level: 5,
    campaign: 'warcraft',
  });
  // 兽人 STR+2 CON+1，战士主属性 STR/CON
  assert.ok(npc.stats.STR >= 14, `战士 STR 应该高 (${npc.stats.STR})`);
  assert.ok(npc.hp > 0, `HP > 0 (${npc.hp})`);
  assert.ok(npc.ac > 0, `AC > 0 (${npc.ac})`);
});

test('NPC 性格描述正确生成（用于 Gemini prompt 注入）', () => {
  const npc = new NPCCompanion({
    name: '萨尔加',
    race: '獸人',
    raceData: RACES.warcraft['7'],
    className: '戰士',
    classData: CLASSES.warcraft['戰士'],
    level: 5,
    campaign: 'warcraft',
  });
  const prompt = npc.getPersonalityPrompt();
  assert.ok(prompt.includes('[NPC]萨尔加'), `包含 NPC 标记名称`);
  assert.ok(prompt.includes('性情'), `包含性情描述`);
  assert.ok(prompt.includes('立场'), `包含立场描述`);
});

test('性格标签正确映射', () => {
  assert.strictEqual(getLabel('temperament', 1).label, '冷静沉着');
  assert.strictEqual(getLabel('temperament', 9).label, '暴躁冲动');
  assert.strictEqual(getLabel('stance', 1).label, '冷血自利');
  assert.strictEqual(getLabel('stance', 9).label, '舍己为人');
});

test('NPC 技能按等级正确加载', () => {
  const npc = new NPCCompanion({
    name: '测试法师',
    race: '亡靈',
    raceData: RACES.warcraft['10'],
    className: '法師',
    classData: CLASSES.warcraft['法師'],
    level: 10,
    campaign: 'warcraft',
  });
  assert.ok(npc.skills.length > 0, `有技能`);
  assert.ok(npc.skills.some(s => s.name === '火球術'), `有 1 级技能`);
  assert.ok(npc.skills.some(s => s.name === '暴風雪'), `有 10 级技能`);
  assert.ok(!npc.skills.some(s => s.level > 10), `没有超过 10 级的技能`);
});

// === 战斗 AI ===
console.log('\n=== NPC 战斗 AI（代码控制） ===');

test('高性情 NPC 选择攻击技能', () => {
  const npc = new NPCCompanion({
    name: '暴躁战士',
    race: '獸人',
    raceData: RACES.warcraft['7'],
    className: '戰士',
    classData: CLASSES.warcraft['戰士'],
    level: 5,
    campaign: 'warcraft',
  });
  npc.temperament = 9;
  npc.stance = 5;

  const action = npc.chooseCombatAction({
    allies: [{ name: '玩家', hp: 50, maxHp: 50, side: 'player' }],
    enemies: [{ name: '哥布林', hp: 10, maxHp: 10, side: 'enemy' }],
  });
  assert.ok(action.type === 'skill' || action.type === 'melee', `选择攻击行动 (${action.type})`);
});

test('高立场 NPC 在队友受伤时优先治疗', () => {
  const npc = new NPCCompanion({
    name: '义气牧师',
    race: '人類',
    raceData: RACES.warcraft['1'],
    className: '牧師',
    classData: CLASSES.warcraft['牧師'],
    level: 5,
    campaign: 'warcraft',
  });
  npc.temperament = 3;
  npc.stance = 9;
  npc.mp = 50; // 确保有 MP

  const action = npc.chooseCombatAction({
    allies: [
      { name: '受伤玩家', hp: 5, maxHp: 50, side: 'player' },
      { name: npc.name, hp: 30, maxHp: 30, side: 'player' },
    ],
    enemies: [{ name: '哥布林', hp: 10, maxHp: 10, side: 'enemy' }],
  });
  assert.ok(action.type === 'skill', `选择技能 (${action.type})`);
  assert.strictEqual(action.target, '受伤玩家', `目标是受伤队友`);
});

test('低立场低 HP 的 NPC 优先自保', () => {
  const npc = new NPCCompanion({
    name: '自私牧师',
    race: '人類',
    raceData: RACES.warcraft['1'],
    className: '牧師',
    classData: CLASSES.warcraft['牧師'],
    level: 5,
    campaign: 'warcraft',
  });
  npc.temperament = 3;
  npc.stance = 1;
  npc.hp = 3;
  npc.maxHp = 30;
  npc.mp = 50;

  const action = npc.chooseCombatAction({
    allies: [
      { name: '受伤玩家', hp: 5, maxHp: 50, side: 'player' },
      { name: npc.name, hp: 3, maxHp: 30, side: 'player' },
    ],
    enemies: [{ name: '哥布林', hp: 10, maxHp: 10, side: 'enemy' }],
  });
  assert.strictEqual(action.target, npc.combatName, `目标是自己（带 [NPC] 前缀）`);
});

// === 副本分层系统 ===
console.log('\n=== 副本模式分层 ===');

test('满级团本不可纯 Solo', () => {
  const result = validateDungeonEntry({
    dungeonType: DUNGEON_TYPES.RAID,
    mode: DUNGEON_MODES.SOLO,
    playerCount: 1,
    playerLevel: 60,
  });
  assert.strictEqual(result.valid, false);
  assert.ok(result.errors[0].includes('不可纯 Solo'));
});

test('满级团本允许 NPC 队友模式', () => {
  const result = validateDungeonEntry({
    dungeonType: DUNGEON_TYPES.RAID,
    mode: DUNGEON_MODES.NPC_TEAM,
    playerCount: 1,
    playerLevel: 60,
  });
  assert.strictEqual(result.valid, true);
});

test('5人副本允许纯 Solo', () => {
  const result = validateDungeonEntry({
    dungeonType: DUNGEON_TYPES.NORMAL,
    mode: DUNGEON_MODES.SOLO,
    playerCount: 1,
    playerLevel: 10,
  });
  assert.strictEqual(result.valid, true);
});

test('多人团本至少 5 人', () => {
  const result = validateDungeonEntry({
    dungeonType: DUNGEON_TYPES.RAID,
    mode: DUNGEON_MODES.MULTIPLAYER,
    playerCount: 3,
    playerLevel: 60,
  });
  assert.strictEqual(result.valid, false);
  assert.ok(result.errors[0].includes('至少需要 5'));
});

test('多人上限 8 人', () => {
  const result = validateDungeonEntry({
    dungeonType: DUNGEON_TYPES.NORMAL,
    mode: DUNGEON_MODES.MULTIPLAYER,
    playerCount: 9,
    playerLevel: 10,
  });
  assert.strictEqual(result.valid, false);
  assert.ok(result.errors[0].includes('最多支持 8'));
});

// === 难度缩放 ===
console.log('\n=== 难度缩放系统 ===');

test('纯 Solo 难度 ×0.5 且取消配合机制', () => {
  const diff = getDungeonDifficulty({
    dungeonType: DUNGEON_TYPES.NORMAL,
    mode: DUNGEON_MODES.SOLO,
    playerCount: 1,
  });
  assert.strictEqual(diff.hpMult, 0.5);
  assert.strictEqual(diff.disableCoopMechanics, true);
});

test('NPC 队友模式标准难度', () => {
  const diff = getDungeonDifficulty({
    dungeonType: DUNGEON_TYPES.NORMAL,
    mode: DUNGEON_MODES.NPC_TEAM,
    playerCount: 1,
  });
  assert.strictEqual(diff.hpMult, 1.0);
  assert.strictEqual(diff.disableCoopMechanics, false);
});

test('多人 5 人基准 ×1.0', () => {
  const scaling = getMultiplayerScaling(5);
  assert.strictEqual(scaling.hpMult, 1.0);
  assert.strictEqual(scaling.atkMod, 0);
});

test('多人 6 人 ×1.15', () => {
  const scaling = getMultiplayerScaling(6);
  assert.strictEqual(scaling.hpMult, 1.15);
  assert.strictEqual(scaling.atkMod, 1);
});

test('多人 7 人 ×1.30', () => {
  const scaling = getMultiplayerScaling(7);
  assert.strictEqual(scaling.hpMult, 1.30);
  assert.strictEqual(scaling.atkMod, 2);
});

test('多人 8 人 ×1.45', () => {
  const scaling = getMultiplayerScaling(8);
  assert.strictEqual(scaling.hpMult, 1.45);
  assert.strictEqual(scaling.atkMod, 3);
});

// === CombatSession 副本难度 ===
console.log('\n=== CombatSession 副本难度 ===');

test('CombatSession.getDungeonDifficulty solo 模式', () => {
  const diff = CombatSession.getDungeonDifficulty('solo', 1);
  assert.strictEqual(diff.hpMult, 0.5);
  assert.strictEqual(diff.disableCoopMechanics, true);
});

test('CombatSession.getDungeonDifficulty npc_team 模式', () => {
  const diff = CombatSession.getDungeonDifficulty('npc_team', 1);
  assert.strictEqual(diff.hpMult, 1.0);
  assert.strictEqual(diff.disableCoopMechanics, false);
});

test('CombatSession.getDungeonDifficulty multiplayer 6人', () => {
  const diff = CombatSession.getDungeonDifficulty('multiplayer', 6);
  assert.strictEqual(diff.hpMult, 1.15);
});

// === 队友生成 ===
console.log('\n=== NPC 队友自动生成 ===');

test('为部落法师生成 4 个 NPC 队友', () => {
  const playerChar = {
    character: { class: '法師', faction: '部落', level: 10 },
  };
  const companions = generateCompanionParty(playerChar, 'warcraft', 4);
  assert.strictEqual(companions.length, 4, `生成 4 个队友 (实际 ${companions.length})`);
  // 应该有坦克和治疗
  const hasHealer = companions.some(c => ['牧師', '聖騎士', '薩滿', '德魯伊'].includes(c.className));
  const hasTank = companions.some(c => ['戰士', '聖騎士', '德魯伊'].includes(c.className));
  assert.ok(hasTank, '队伍中有坦克');
  assert.ok(hasHealer, '队伍中有治疗');
});

test('NPC 队友与玩家同等级', () => {
  const playerChar = {
    character: { class: '戰士', faction: '聯盟', level: 15 },
  };
  const companions = generateCompanionParty(playerChar, 'warcraft', 4);
  for (const c of companions) {
    assert.strictEqual(c.level, 15, `${c.name} 等级应为 15`);
  }
});

test('NPC 序列化和反序列化', () => {
  const npc = new NPCCompanion({
    name: '测试存档',
    race: '獸人',
    raceData: RACES.warcraft['7'],
    className: '戰士',
    classData: CLASSES.warcraft['戰士'],
    level: 5,
    campaign: 'warcraft',
  });
  const json = npc.toJSON();
  const restored = NPCCompanion.fromJSON(json, 'warcraft');
  assert.strictEqual(restored.name, npc.name);
  assert.strictEqual(restored.temperament, npc.temperament);
  assert.strictEqual(restored.stance, npc.stance);
  assert.strictEqual(restored.level, npc.level);
  assert.ok(restored.skills.length > 0, '恢复后有技能');
});

test('NPC 升级正确', () => {
  const npc = new NPCCompanion({
    name: '升级测试',
    race: '人類',
    raceData: RACES.warcraft['1'],
    className: '法師',
    classData: CLASSES.warcraft['法師'],
    level: 5,
    campaign: 'warcraft',
  });
  const oldMaxHp = npc.maxHp;
  const oldSkillCount = npc.skills.length;
  npc.levelUp();
  assert.strictEqual(npc.level, 6);
  assert.ok(npc.maxHp >= oldMaxHp, `升级后 maxHp 增加 (${oldMaxHp} → ${npc.maxHp})`);
  assert.ok(npc.skills.length >= oldSkillCount, `升级后技能不减少`);
});

// === NPC 战斗集成 ===
console.log('\n=== NPC 战斗集成测试 ===');

test('NPC 队友参与战斗并自动行动', () => {
  const npc = new NPCCompanion({
    name: '战斗NPC',
    race: '獸人',
    raceData: RACES.warcraft['7'],
    className: '戰士',
    classData: CLASSES.warcraft['戰士'],
    level: 5,
    campaign: 'warcraft',
  });

  const player = {
    name: '玩家',
    type: 'player',
    stats: { STR: 14, DEX: 10, CON: 14, INT: 10, WIS: 10, CHA: 10 },
    hp: 40, maxHp: 40, ac: 16, level: 5,
    skills: getSkillsForLevel('warcraft', '戰士', 5),
    equipment: { weapon: { name: '铁剑', damage: '1d8', stat: 'STR' } },
    proficiency: 3,
  };

  const enemies = [{
    name: '测试怪物', type: 'enemy',
    hp: 20, maxHp: 20, ac: 12,
    attacks: [{ name: '爪击', bonus: 2, damage: '1d6', damageType: '物理' }],
    exp: 50, loot: [],
  }];

  const combatant = npc.toCombatant();
  const combat = new CombatSession(
    [player, combatant],
    JSON.parse(JSON.stringify(enemies)),
    { hpMult: 1, atkMod: 0 },
    { npcCompanions: [npc] }
  );
  combat.initCombat();

  // 找到 NPC 的回合
  const npcParticipant = combat.participants.find(p => p.name === `[NPC]战斗NPC`);
  assert.ok(npcParticipant, 'NPC 在参与者列表中');

  // 执行 NPC 自动回合
  const result = combat.executeNPCCompanionAI(npcParticipant);
  assert.ok(result, 'NPC 自动行动有结果');
  assert.ok(result.actor === '[NPC]战斗NPC', `行动者是 NPC (${result.actor})`);
});

// === Codex Review 回归测试 ===
console.log('\n=== Codex Review Bug Fixes ===');

test('[P1] 法师 NPC 的 MP 是数字而非 NaN', () => {
  const npc = new NPCCompanion({
    name: 'MP测试',
    race: '亡靈',
    raceData: RACES.warcraft['10'],
    className: '法師',
    classData: CLASSES.warcraft['法師'],
    level: 10,
    campaign: 'warcraft',
  });
  assert.ok(!isNaN(npc.mp), `MP 不是 NaN (${npc.mp})`);
  assert.ok(npc.mp > 0, `法师 MP > 0 (${npc.mp})`);
  assert.ok(!isNaN(npc.maxMp), `maxMp 不是 NaN (${npc.maxMp})`);
});

test('[P1] executeAction 后 HP/MP 正确同步到 companion', () => {
  const npc = new NPCCompanion({
    name: '同步测试',
    race: '亡靈',
    raceData: RACES.warcraft['10'],
    className: '法師',
    classData: CLASSES.warcraft['法師'],
    level: 10,
    campaign: 'warcraft',
  });
  const origMp = npc.mp;

  const combatant = npc.toCombatant();
  const enemies = [{
    name: '测试怪', type: 'enemy', hp: 50, maxHp: 50, ac: 10,
    attacks: [{ name: '爪击', bonus: 2, damage: '1d6', damageType: '物理' }],
    exp: 10, loot: [],
  }];

  const combat = new CombatSession(
    [combatant], JSON.parse(JSON.stringify(enemies)),
    { hpMult: 1, atkMod: 0 }, { npcCompanions: [npc] }
  );
  combat.initCombat();

  const npcP = combat.participants.find(p => p.name === '[NPC]同步测试');
  combat.executeNPCCompanionAI(npcP);

  // 如果施放了技能，MP 应该减少且 companion 和 participant 同步
  assert.strictEqual(npc.mp, npcP.mp, `companion.mp (${npc.mp}) === participant.mp (${npcP.mp})`);
});

test('[P2] 自我治疗目标名使用 combatName', () => {
  const npc = new NPCCompanion({
    name: '治疗自己',
    race: '人類',
    raceData: RACES.warcraft['1'],
    className: '牧師',
    classData: CLASSES.warcraft['牧師'],
    level: 5,
    campaign: 'warcraft',
  });
  npc.temperament = 2;
  npc.stance = 1;
  npc.hp = 3;
  npc.maxHp = 30;
  npc.mp = 50;

  const action = npc.chooseCombatAction({
    allies: [{ name: '[NPC]治疗自己', hp: 3, maxHp: 30, side: 'player' }],
    enemies: [{ name: '怪', hp: 10, maxHp: 10, side: 'enemy' }],
  });
  assert.strictEqual(action.target, '[NPC]治疗自己', `目标应带 [NPC] 前缀 (${action.target})`);
});

test('[P2] generateCompanionParty 尊重 count=1', () => {
  const companions = generateCompanionParty(
    { character: { class: '法師', faction: '部落', level: 10 } },
    'warcraft', 1
  );
  assert.strictEqual(companions.length, 1, `count=1 时只生成 1 个 (实际 ${companions.length})`);
});

test('[P2] generateCompanionParty 尊重 count=0', () => {
  const companions = generateCompanionParty(
    { character: { class: '法師', faction: '部落', level: 10 } },
    'warcraft', 0
  );
  assert.strictEqual(companions.length, 0, `count=0 时不生成 (实际 ${companions.length})`);
});

// === 结果 ===
console.log(`\n═══════════════════════════════════════`);
console.log(`  测试结果：${passed} 通过，${failed} 失败`);
console.log(`═══════════════════════════════════════\n`);
process.exit(failed > 0 ? 1 : 0);
