const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { RACES, SKILLS, TALENTS } = require('../game-engine');

const root = path.join(__dirname, '..', '..');
const read = (...parts) => fs.readFileSync(path.join(root, ...parts), 'utf8');

const expectedClasses = {
  '人類': ['戰士', '法師', '牧師', '盜賊', '聖騎士', '術士'],
  '矮人': ['戰士', '聖騎士', '獵人', '盜賊', '牧師'],
  '暗夜精靈': ['戰士', '獵人', '盜賊', '牧師', '德魯伊'],
  '侏儒': ['戰士', '法師', '盜賊', '術士'],
  '獸人': ['戰士', '獵人', '盜賊', '薩滿', '術士'],
  '牛頭人': ['戰士', '獵人', '薩滿', '德魯伊'],
  '巨魔': ['戰士', '獵人', '法師', '牧師', '盜賊', '薩滿'],
  '亡靈': ['戰士', '法師', '牧師', '盜賊', '術士'],
};

assert.strictEqual(Object.keys(RACES.warcraft).length, 8, 'Classic must expose exactly eight races');
for (const race of Object.values(RACES.warcraft)) {
  assert.deepStrictEqual(race.classes, expectedClasses[race.name], `${race.name} class matrix`);
}

const skillNames = Object.values(SKILLS.warcraft).flat().map(skill => skill.name);
const talentNames = Object.values(TALENTS.warcraft)
  .flatMap(tree => Object.values(tree))
  .flat()
  .map(talent => talent.name);
for (const postVanillaName of [
  '劍刃風暴', '泰坦之握', '活體炸彈', '混亂箭', '惡魔變身', '暗影之舞',
  '奇美拉射擊', '復仇之怒', '聖光信標', '復仇者之盾', '熔岩爆裂',
  '英勇氣概', '雷霆風暴', '熔岩猛擊', '大地之盾', '星湧術', '生命之樹',
  '痛苦無常', '野蠻咆哮', '利刃風暴', '野獸之心', '十字軍打擊',
]) {
  assert.ok(!skillNames.includes(postVanillaName), `Post-Vanilla skill leaked into SKILLS: ${postVanillaName}`);
  assert.ok(!talentNames.includes(postVanillaName), `Post-Vanilla talent leaked into TALENTS: ${postVanillaName}`);
}

const dungeonRequirements = {
  'deadmines.md': ['拉克佐', '斯尼德', '基爾尼格', '重拳先生', '艾德溫·范克里夫'],
  'wailing-caverns.md': ['安娜科德拉', '皮薩斯', '考布萊恩', '瑟芬迪斯', '吞噬者穆坦努斯'],
  'shadowfang-keep.md': ['雷希戈爾', '狼王南杜斯', '大法師阿魯高'],
  'scarlet-monastery.md': ['奧法師杜安', '赫洛德', '莫格萊尼', '懷特邁恩'],
  'razorfen-kraul.md': ['卡爾加·刺肋'],
  'razorfen-downs.md': ['圖特卡什', '寒冰之王亞門納爾'],
  'blackrock-depths.md': ['弗萊拉斯大使', '達格蘭·索瑞森大帝'],
  'scholomance.md': ['萊斯·霜語', '黑暗院長加丁'],
  'stratholme.md': ['巴納扎爾', '瑞文戴爾男爵'],
  'molten-core.md': ['瑪格曼達', '基赫納斯', '古雷曼格', '埃克索圖斯', '拉格納羅斯'],
  'blackwing-lair.md': ['勒什雷爾', '費爾默', '埃博諾克', '弗萊格爾', '奈法利安'],
  'zulgurub.md': ['耶克里克', '溫諾希斯', '瑪爾里', '塞卡爾', '婭爾羅', '哈卡'],
  'ahn-qiraj.md': ['預言者斯克拉姆', '其拉三寶', '雙子皇帝', '克蘇恩'],
  'naxxramas.md': ['格拉斯', '洛歐塞布', '大領主亞歷山德羅斯·莫格萊尼', '薩菲隆', '克爾蘇加德'],
};

for (const [file, names] of Object.entries(dungeonRequirements)) {
  const content = read('campaigns', 'warcraft', 'dungeons', file);
  for (const name of names) assert.ok(content.includes(name), `${file} must include ${name}`);
}

const quests = read('campaigns', 'warcraft', 'quests.md');
assert.ok(!quests.includes('給予者**：大領主泰瑞納斯·弗丁'), 'Wrath-era Tirion role leaked into quests');
assert.ok(!quests.includes('摧毀亡靈同盟契約'), 'Invented Scourge/Dark Iron alliance leaked into quests');

const rules = read('rules', 'warcraft.md');
assert.ok(!/\| 聯盟 \|[^\n]*(德萊尼|狼人)/.test(rules), 'Post-Vanilla Alliance race leaked into rules');
assert.ok(!/\| 部落 \|[^\n]*(血精靈|地精)/.test(rules), 'Post-Vanilla Horde race leaked into rules');

const relay = read('server', 'relay.js');
assert.ok(relay.includes("fs.readdirSync(dungeonDir)"), 'Dungeon lore files must be loaded into the DM context');
assert.ok(relay.includes("'tier-sets.md'"), 'Tier set lore must be loaded into the DM context');
assert.ok(relay.includes("/^[a-z0-9-]+\\.md$/"), 'Dungeon loader must reject duplicate or malformed filenames');
assert.ok(relay.includes("room.campaign === 'warcraft'"), 'Warcraft gameplay output must apply the no-emoji policy');

const starts = read('campaigns', 'warcraft', 'starting-zones.md');
assert.ok(starts.includes('MQ01-UD：突然醒來'), 'Undead must start with Rude Awakening');
assert.ok(starts.includes('提瑞斯法林地，喪鐘鎮'), 'Undead start must be Deathknell in Tirisfal Glades');
assert.ok(starts.includes('給予者**：卡爾圖克'), 'Orc and troll opening quest must start with Kaltunk');
assert.ok(starts.includes('關鍵 NPC**：高內克'), 'Orc and troll opening quest must report to Gornek');
assert.ok(starts.includes('給予者**：格魯爾·鷹風'), 'Tauren hunt must be given by Grull Hawkwind');

const classes = read('campaigns', 'warcraft', 'classes.md');
const tierSets = read('campaigns', 'warcraft', 'tier-sets.md');
for (const postVanillaName of ['聖光之環', '殺戮盛宴', '穩固射擊', '大地之盾', '英勇氣概']) {
  assert.ok(!classes.includes(postVanillaName), `Post-Vanilla name leaked into classes.md: ${postVanillaName}`);
  assert.ok(!tierSets.includes(postVanillaName), `Post-Vanilla name leaked into tier-sets.md: ${postVanillaName}`);
}

const duplicateFiles = fs.readdirSync(path.join(root, 'campaigns', 'warcraft', 'dungeons'))
  .filter(name => / 2\.md$/.test(name));
assert.deepStrictEqual(duplicateFiles, [], 'Duplicate Gemini dungeon drafts must not remain');

console.log('Lore consistency tests passed!');
