const fs = require('fs');
const path = require('path');

const GAME_DIR = path.join(__dirname, '..');

// === 骰子 ===
function roll(dice) {
  // 解析 "2d6+3" 格式
  const match = dice.match(/^(\d+)d(\d+)([+-]\d+)?$/);
  if (!match) return { rolls: [0], bonus: 0, total: 0, str: dice };
  const count = parseInt(match[1]);
  const sides = parseInt(match[2]);
  const bonus = parseInt(match[3] || '0');
  const rolls = [];
  for (let i = 0; i < count; i++) {
    rolls.push(Math.floor(Math.random() * sides) + 1);
  }
  const total = rolls.reduce((a, b) => a + b, 0) + bonus;
  return { rolls, bonus, total, str: `${count}d${sides}${bonus >= 0 && bonus !== 0 ? '+' + bonus : bonus < 0 ? bonus : ''}` };
}

function d20() { return Math.floor(Math.random() * 20) + 1; }

// === 屬性調整值 ===
function modifier(stat) {
  return Math.floor((stat - 10) / 2);
}

// === 點數購買表 ===
const POINT_COST = { 8: 0, 9: 1, 10: 2, 11: 3, 12: 4, 13: 5, 14: 7, 15: 9 };
const STAT_NAMES = { STR: '力量', DEX: '敏捷', CON: '體質', INT: '智力', WIS: '感知', CHA: '魅力' };
const TOTAL_POINTS = 27;

function validatePointBuy(stats) {
  let spent = 0;
  for (const [key, val] of Object.entries(stats)) {
    if (val < 8 || val > 15) return { valid: false, error: `${key} 必須在 8-15 之間（當前 ${val}）` };
    spent += POINT_COST[val];
  }
  if (spent > TOTAL_POINTS) return { valid: false, error: `點數超支！花了 ${spent} 點，上限 ${TOTAL_POINTS}` };
  return { valid: true, spent, remaining: TOTAL_POINTS - spent };
}

// === 種族資料 ===
const RACES = {
  warcraft: {
    '1':  { name: '人類', faction: '聯盟', bonus: { STR: 1, DEX: 1, CON: 1, INT: 1, WIS: 1, CHA: 1 }, trait: '人類精神 — 聲望+10%，技能檢定每場+1(限2次)', classes: ['戰士','法師','牧師','盜賊','聖騎士','術士'] },
    '2':  { name: '矮人', faction: '聯盟', bonus: { CON: 2, STR: 1 }, trait: '石膚術 — 每場戰鬥一次，2回合物理傷害-3', classes: ['戰士','牧師','獵人','聖騎士'] },
    '3':  { name: '暗夜精靈', faction: '聯盟', bonus: { DEX: 2, WIS: 1 }, trait: '影遁 — 脫戰自動潛行，首次潛行攻擊優勢', classes: ['戰士','獵人','盜賊','德魯伊'] },
    '4':  { name: '侏儒', faction: '聯盟', bonus: { INT: 2, DEX: 1 }, trait: '逃脫大師 — 免疫減速束縛，工程炸彈2d6', classes: ['戰士','法師','盜賊','術士'] },
    '5':  { name: '德萊尼', faction: '聯盟', bonus: { WIS: 2, STR: 1 }, trait: '納魯祝福 — 每場一次群體治療1d8', classes: ['戰士','牧師','聖騎士','薩滿','獵人'] },
    '6':  { name: '狼人', faction: '聯盟', bonus: { STR: 1, DEX: 2 }, trait: '狼人形態 — 3回合攻擊+2暴擊+5%，不可施法', classes: ['戰士','獵人','盜賊','德魯伊'] },
    '7':  { name: '獸人', faction: '部落', bonus: { STR: 2, CON: 1 }, trait: '血性狂怒 — 3回合攻擊+2傷害+2，結束攻擊-1', classes: ['戰士','獵人','薩滿','術士'] },
    '8':  { name: '牛頭人', faction: '部落', bonus: { STR: 1, CON: 1, WIS: 1 }, trait: '戰爭踐踏 — AOE 1d6+DC12眩暈', classes: ['戰士','獵人','薩滿','德魯伊'] },
    '9':  { name: '巨魔', faction: '部落', bonus: { DEX: 2, WIS: 1 }, trait: '再生 — 每回合+1HP，<25%時+3HP', classes: ['戰士','獵人','薩滿','牧師','盜賊'] },
    '10': { name: '亡靈', faction: '部落', bonus: { INT: 2, CON: 1 }, trait: '亡靈意志 — 免疫恐懼，食屍恢復2d8', classes: ['戰士','法師','牧師','盜賊','術士'] },
    '11': { name: '血精靈', faction: '部落', bonus: { INT: 1, CHA: 2 }, trait: '奧術洪流 — 沉默所有敵人1回合+恢復技能', classes: ['法師','牧師','聖騎士','盜賊','獵人'] },
    '12': { name: '地精', faction: '部落', bonus: { INT: 2, CHA: 1 }, trait: '最佳交易 — 商店折扣10%，口袋炸彈2d6', classes: ['戰士','盜賊','法師','術士'] },
  },
  monsterhunter: {
    '1': { name: '獵人', faction: '獵人公會', bonus: { STR: 1, DEX: 1, CON: 1 }, trait: '獵人本能 — 對大型怪物攻擊+1命中，可剝取素材鍛造裝備', classes: ['大劍','太刀','片手劍','雙劍','大錘','狩獵笛','長槍','弓','充能斧','操蟲棍'] },
  }
};

// === 職業資料 ===
const CLASSES = {
  warcraft: {
    '戰士': { hp_die: 10, armor: '板甲', primary: 'STR/CON', role: '坦克/近戰DPS', starter_weapon: '鐵劍(1d8+STR)', starter_armor: '鏈甲(AC+4)', starter_items: ['木盾(AC+2)', '小型治療藥水x3'] },
    '法師': { hp_die: 6, armor: '布甲', primary: 'INT', role: '遠程DPS', starter_weapon: '學徒法杖(1d6+INT)', starter_armor: '布袍(AC+1)', starter_items: ['法力藥水x2', '小型治療藥水x2'] },
    '牧師': { hp_die: 8, armor: '布甲', primary: 'WIS', role: '治療/暗影DPS', starter_weapon: '祈禱手杖(1d6+WIS)', starter_armor: '布袍(AC+1)', starter_items: ['聖水x2', '小型治療藥水x3'] },
    '盜賊': { hp_die: 8, armor: '皮甲', primary: 'DEX', role: '近戰DPS', starter_weapon: '短劍(1d6+DEX)', starter_armor: '皮甲(AC+2)', starter_items: ['飛刀x10(1d4)', '毒藥瓶x2', '小型治療藥水x2'] },
    '獵人': { hp_die: 8, armor: '皮甲', primary: 'DEX', role: '遠程DPS', starter_weapon: '獵弓(1d8+DEX)', starter_armor: '皮甲(AC+2)', starter_items: ['短劍(1d6)', '箭矢x30', '小型治療藥水x2'] },
    '聖騎士': { hp_die: 10, armor: '板甲', primary: 'STR/WIS', role: '坦克/治療/DPS', starter_weapon: '戰錘(1d8+STR)', starter_armor: '鏈甲(AC+4)', starter_items: ['盾牌(AC+2)', '聖水x2', '小型治療藥水x2'] },
    '薩滿': { hp_die: 10, armor: '鎖甲', primary: 'INT/WIS', role: '遠程/近戰/治療', starter_weapon: '石錘(1d8+STR)', starter_armor: '鎖甲(AC+4)', starter_items: ['圖騰x4', '小型治療藥水x2'] },
    '術士': { hp_die: 6, armor: '布甲', primary: 'INT', role: '遠程DPS', starter_weapon: '暗影法杖(1d6+INT)', starter_armor: '布袍(AC+1)', starter_items: ['靈魂碎片x3', '小型治療藥水x2'] },
    '德魯伊': { hp_die: 8, armor: '皮甲', primary: 'WIS', role: '坦克/DPS/治療', starter_weapon: '橡木法杖(1d6+WIS)', starter_armor: '皮甲(AC+2)', starter_items: ['草藥包', '小型治療藥水x3'] },
  },
  monsterhunter: {
    '大劍': { hp_die: 10, armor: '皮甲', primary: 'STR', role: '重擊手', starter_weapon: '鐵大劍(2d6+STR)', starter_armor: '皮製獵裝(AC+2)', starter_items: ['回復藥x5', '攜帶用陷阱x1'], default_stats: { STR: 15, DEX: 10, CON: 14, INT: 8, WIS: 10, CHA: 8 } },
    '太刀': { hp_die: 8, armor: '皮甲', primary: 'DEX', role: '見切反擊', starter_weapon: '鐵刀(1d10+DEX)', starter_armor: '皮製獵裝(AC+2)', starter_items: ['回復藥x5', '攜帶用陷阱x1'], default_stats: { STR: 10, DEX: 15, CON: 12, INT: 8, WIS: 12, CHA: 8 } },
    '片手劍': { hp_die: 8, armor: '皮甲', primary: 'DEX', role: '支援萬能', starter_weapon: '獵人小刀(1d6+DEX)', starter_armor: '皮製獵裝(AC+2)', starter_items: ['回復藥x5', '攜帶用陷阱x1', '生命粉塵x2'], default_stats: { STR: 10, DEX: 14, CON: 12, INT: 10, WIS: 12, CHA: 10 } },
    '雙劍': { hp_die: 6, armor: '皮甲', primary: 'DEX', role: '高速連擊', starter_weapon: '雙鐵刀(2d4+DEX)', starter_armor: '皮製獵裝(AC+2)', starter_items: ['回復藥x5', '強走藥x2'], default_stats: { STR: 8, DEX: 15, CON: 12, INT: 8, WIS: 12, CHA: 10 } },
    '大錘': { hp_die: 10, armor: '皮甲', primary: 'STR', role: '暈眩專家', starter_weapon: '鐵錘(1d12+STR)', starter_armor: '皮製獵裝(AC+2)', starter_items: ['回復藥x5', '攜帶用陷阱x1'], default_stats: { STR: 15, DEX: 8, CON: 14, INT: 8, WIS: 12, CHA: 8 } },
    '狩獵笛': { hp_die: 8, armor: '皮甲', primary: 'CHA', role: '團隊增益', starter_weapon: '金屬風笛(1d8+CHA)', starter_armor: '皮製獵裝(AC+2)', starter_items: ['回復藥x5', '鬼人藥x1'], default_stats: { STR: 10, DEX: 10, CON: 12, INT: 10, WIS: 12, CHA: 14 } },
    '長槍': { hp_die: 10, armor: '皮甲', primary: 'CON', role: '鐵壁防禦', starter_weapon: '鐵槍(1d8+STR)', starter_armor: '皮製獵裝(AC+2)', starter_items: ['回復藥x5', '硬化藥x2'], default_stats: { STR: 12, DEX: 8, CON: 15, INT: 8, WIS: 14, CHA: 8 } },
    '弓': { hp_die: 8, armor: '皮甲', primary: 'DEX', role: '遠程射擊', starter_weapon: '獵弓(1d8+DEX)', starter_armor: '皮製獵裝(AC+2)', starter_items: ['回復藥x5', '強擊瓶x10'], default_stats: { STR: 8, DEX: 15, CON: 10, INT: 12, WIS: 14, CHA: 8 } },
    '充能斧': { hp_die: 10, armor: '皮甲', primary: 'STR', role: '型態變換', starter_weapon: '鐵充能斧(1d10+STR)', starter_armor: '皮製獵裝(AC+2)', starter_items: ['回復藥x5', '攜帶用陷阱x1'], default_stats: { STR: 14, DEX: 10, CON: 14, INT: 10, WIS: 10, CHA: 8 } },
    '操蟲棍': { hp_die: 8, armor: '皮甲', primary: 'DEX', role: '空中突襲', starter_weapon: '鐵蟲棍(1d8+DEX)', starter_armor: '皮製獵裝(AC+2)', starter_items: ['回復藥x5', '獵蟲x1'], default_stats: { STR: 10, DEX: 15, CON: 12, INT: 10, WIS: 10, CHA: 8 } },
  }
};

// === 熟練加值 ===
function proficiencyBonus(level) {
  if (level <= 4) return 2;
  if (level <= 8) return 3;
  if (level <= 12) return 4;
  if (level <= 16) return 5;
  return 6;
}

// === 角色創建狀態機 ===
class CharacterCreator {
  constructor(playerName, campaign, lockedFaction = null) {
    this.playerName = playerName;
    this.campaign = campaign;
    this.lockedFaction = lockedFaction; // 陣營鎖定（第一位玩家選種族後鎖定）
    this.step = 'race'; // race → class → stats → name → done
    this.race = null;
    this.raceData = null;
    this.className = null;
    this.classData = null;
    this.baseStats = { STR: 8, DEX: 8, CON: 8, INT: 8, WIS: 8, CHA: 8 };
    this.charName = null;
  }

  process(input) {
    switch (this.step) {
      case 'race': return this.selectRace(input);
      case 'class': return this.selectClass(input);
      case 'stats': return this.allocateStats(input);
      case 'name': return this.setName(input);
      default: return { done: true };
    }
  }

  selectRace(input) {
    const races = RACES[this.campaign];
    if (!races) return { text: '⚠ 未知戰役', done: false };

    // 根據陣營鎖定過濾可選種族
    let availableRaces = races;
    if (this.lockedFaction) {
      availableRaces = {};
      for (const [id, r] of Object.entries(races)) {
        if (r.faction === this.lockedFaction) {
          availableRaces[id] = r;
        }
      }
    }

    // 只有一個種族時自動選擇（如怪物獵人）
    const raceKeys = Object.keys(availableRaces);
    if (raceKeys.length === 1 && (input === 'show' || input === '1')) {
      input = raceKeys[0];
    }

    const raceData = availableRaces[input.trim()];
    if (!raceData) {
      let list = '═══════════════════════════════════════\n選擇你的種族：\n───────────────────────────────────────\n';
      if (this.lockedFaction) {
        list = `═══════════════════════════════════════\n陣營已鎖定為【${this.lockedFaction}】\n選擇你的種族：\n───────────────────────────────────────\n`;
      }
      const factions = {};
      for (const [id, r] of Object.entries(availableRaces)) {
        if (!factions[r.faction]) factions[r.faction] = [];
        factions[r.faction].push({ id, ...r });
      }
      for (const [faction, members] of Object.entries(factions)) {
        list += `\n  【${faction}】\n`;
        for (const r of members) {
          const bonusStr = Object.entries(r.bonus).map(([k, v]) => `${k}+${v}`).join(', ');
          list += `  ${r.id}. ${r.name}（${bonusStr}）\n     ${r.trait}\n`;
        }
      }
      list += '\n───────────────────────────────────────\n輸入數字選擇：';
      return { text: list, done: false };
    }

    this.race = raceData.name;
    this.raceData = raceData;
    this.step = 'class';

    const bonusStr = Object.entries(raceData.bonus).map(([k, v]) => `${k}+${v}`).join(', ');
    let text = `\n✅ 種族選擇：${raceData.name}（${raceData.faction}）\n`;
    text += `   屬性加成：${bonusStr}\n`;
    text += `   種族特長：${raceData.trait}\n\n`;
    text += `═══════════════════════════════════════\n選擇你的職業：\n───────────────────────────────────────\n`;

    const available = raceData.classes;
    const classInfo = CLASSES[this.campaign];
    let i = 1;
    this._classMap = {};
    for (const cn of available) {
      const c = classInfo[cn];
      if (c) {
        text += `  ${i}. ${cn}（${c.role}）— HP骰 d${c.hp_die}，主屬性 ${c.primary}\n`;
        this._classMap[String(i)] = cn;
        i++;
      }
    }
    text += '\n───────────────────────────────────────\n輸入數字選擇：';
    return { text, done: false };
  }

  selectClass(input) {
    const className = this._classMap[input.trim()];
    if (!className) {
      return { text: '⚠ 無效選擇，請輸入對應的數字。', done: false };
    }

    const classData = CLASSES[this.campaign][className];
    this.className = className;
    this.classData = classData;

    // 有預設屬性時自動分配（如怪物獵人），跳過手動分配
    if (classData.default_stats) {
      this.baseStats = { ...classData.default_stats };
      const finalStats = { ...this.baseStats };
      for (const [k, v] of Object.entries(this.raceData.bonus)) {
        finalStats[k] = (finalStats[k] || 0) + v;
      }
      this.finalStats = finalStats;
      this.step = 'name';

      const keys = ['STR', 'DEX', 'CON', 'INT', 'WIS', 'CHA'];
      let text = `\n✅ 武器選擇：${className}（${classData.role}）\n`;
      text += `   HP骰：d${classData.hp_die} | 護甲：${classData.armor} | 主屬性：${classData.primary}\n\n`;
      text += `───────────────────────────────────────\n`;
      text += `  屬性（自動分配）\n`;
      for (const k of keys) {
        const mod = modifier(finalStats[k]);
        text += `  ${STAT_NAMES[k]} ${String(finalStats[k]).padStart(3)}   ${mod >= 0 ? '+' : ''}${mod}\n`;
      }
      text += `───────────────────────────────────────\n\n`;
      text += `為你的獵人取個名字：`;
      return { text, done: false };
    }

    this.step = 'stats';

    let text = `\n✅ 職業選擇：${className}（${classData.role}）\n`;
    text += `   HP骰：d${classData.hp_die} | 護甲：${classData.armor} | 主屬性：${classData.primary}\n\n`;
    text += `═══════════════════════════════════════\n分配屬性點數（共 27 點）\n───────────────────────────────────────\n`;
    text += `每個屬性初始為 8，花費點數提升：\n`;
    text += `  8→9(1點) 9→10(1點) 10→11(1點) 11→12(1點)\n`;
    text += `  12→13(1點) 13→14(2點) 14→15(2點)\n`;
    text += `  最高只能買到 15，種族加成之後可超過 15\n\n`;
    text += `請用以下格式分配（用空格分隔）：\n`;
    text += `  力量 敏捷 體質 智力 感知 魅力\n`;
    text += `  例如：15 10 14 8 12 10\n`;
    text += `\n建議（${className}主屬性 ${classData.primary}）：把點數集中在主屬性上\n`;
    text += `───────────────────────────────────────`;
    return { text, done: false };
  }

  allocateStats(input) {
    const parts = input.trim().split(/[\s,，]+/).map(Number);
    if (parts.length !== 6 || parts.some(isNaN)) {
      return { text: '⚠ 格式錯誤。請輸入6個數字，用空格分隔。例如：15 10 14 8 12 10', done: false };
    }

    const keys = ['STR', 'DEX', 'CON', 'INT', 'WIS', 'CHA'];
    const stats = {};
    keys.forEach((k, i) => { stats[k] = parts[i]; });

    const result = validatePointBuy(stats);
    if (!result.valid) {
      return { text: `⚠ ${result.error}\n\n請重新分配（每項 8-15，總共 27 點）：`, done: false };
    }

    this.baseStats = stats;

    // 加上種族加成
    const finalStats = { ...stats };
    for (const [k, v] of Object.entries(this.raceData.bonus)) {
      finalStats[k] = (finalStats[k] || 0) + v;
    }

    this.finalStats = finalStats;
    this.step = 'name';

    const bonusStr = Object.entries(this.raceData.bonus).map(([k, v]) => `${STAT_NAMES[k] || k}+${v}`).join(', ');

    let text = `\n✅ 屬性分配完成！（花費 ${result.spent}/${TOTAL_POINTS} 點）\n\n`;
    text += `───────────────────────────────────────\n`;
    text += `  屬性    基礎  種族加成  最終  調整值\n`;
    for (const k of keys) {
      const base = stats[k];
      const bonus = this.raceData.bonus[k] || 0;
      const final = finalStats[k];
      const mod = modifier(final);
      text += `  ${STAT_NAMES[k].padEnd(4)} ${String(base).padStart(4)}  ${bonus > 0 ? '+' + bonus : ' 0'}        ${String(final).padStart(3)}   ${mod >= 0 ? '+' : ''}${mod}\n`;
    }
    text += `───────────────────────────────────────\n\n`;
    text += `最後一步——為你的角色取個名字：`;
    return { text, done: false };
  }

  setName(input) {
    const name = input.trim();
    if (!name || name.length > 20) {
      return { text: '⚠ 請輸入 1-20 個字的名字。', done: false };
    }

    this.charName = name;
    this.step = 'done';

    // 計算初始屬性
    const hp = this.classData.hp_die + modifier(this.finalStats.CON);
    const ac = 10 + modifier(this.finalStats.DEX);

    // 生成角色資料
    const character = {
      meta: {
        name: this.charName,
        playerName: this.playerName,
        campaign: this.campaign,
        created_at: new Date().toISOString(),
        last_played: new Date().toISOString(),
        play_time_minutes: 0
      },
      character: {
        race: this.race,
        faction: this.raceData.faction,
        class: this.className,
        level: 1,
        exp: 0,
        exp_to_next: 300,
        stats: this.finalStats,
        base_stats: this.baseStats,
        hp,
        max_hp: hp,
        ac,
        abilities: [],
        talent_points: 0,
        inventory: [
          this.classData.starter_weapon,
          this.classData.starter_armor,
          ...this.classData.starter_items
        ],
        equipment: {
          weapon: this.classData.starter_weapon,
          armor: this.classData.starter_armor,
        },
        gold: 10,
        racial_trait: this.raceData.trait
      },
      companions: [],
      progress: {
        main_quest: '',
        side_quests: [],
        completed_quests: [],
        completed_dungeons: [],
        reputation: {},
        story_flags: [],
        current_location: this.raceData.faction === '聯盟' ? '北郡修道院' : '杜隆塔爾'
      },
      dungeon_state: null,
      session_log: []
    };

    let text = `\n🎉 角色創建完成！\n`;
    text += `═══════════════════════════════════════\n`;
    text += `  ${this.charName}\n`;
    text += `  ${this.race} · ${this.className}（${this.classData.role}）\n`;
    text += `  ${this.raceData.faction} 陣營\n`;
    text += `───────────────────────────────────────\n`;
    text += `  HP: ${hp}/${hp} | AC: ${ac}\n`;
    text += `  力量: ${this.finalStats.STR}(${modifier(this.finalStats.STR) >= 0 ? '+' : ''}${modifier(this.finalStats.STR)}) `;
    text += `敏捷: ${this.finalStats.DEX}(${modifier(this.finalStats.DEX) >= 0 ? '+' : ''}${modifier(this.finalStats.DEX)}) `;
    text += `體質: ${this.finalStats.CON}(${modifier(this.finalStats.CON) >= 0 ? '+' : ''}${modifier(this.finalStats.CON)})\n`;
    text += `  智力: ${this.finalStats.INT}(${modifier(this.finalStats.INT) >= 0 ? '+' : ''}${modifier(this.finalStats.INT)}) `;
    text += `感知: ${this.finalStats.WIS}(${modifier(this.finalStats.WIS) >= 0 ? '+' : ''}${modifier(this.finalStats.WIS)}) `;
    text += `魅力: ${this.finalStats.CHA}(${modifier(this.finalStats.CHA) >= 0 ? '+' : ''}${modifier(this.finalStats.CHA)})\n`;
    text += `───────────────────────────────────────\n`;
    text += `  種族特長：${this.raceData.trait}\n`;
    text += `  裝備：${this.classData.starter_weapon} | ${this.classData.starter_armor}\n`;
    text += `  物品：${this.classData.starter_items.join('、')}\n`;
    text += `  金幣：10g\n`;
    text += `═══════════════════════════════════════\n\n`;
    text += `冒險即將開始……\n`;

    return { text, done: true, character };
  }
}

// === 戰鬥掷骰 ===
function attackRoll(attackBonus, targetAC) {
  const raw = d20();
  const total = raw + attackBonus;
  const crit = raw === 20;
  const fumble = raw === 1;
  const hit = crit || (!fumble && total >= targetAC);
  return {
    raw, attackBonus, total, targetAC, hit, crit, fumble,
    str: `🎲 攻擊：d20(${raw}) + ${attackBonus} = ${total} vs AC ${targetAC} → ${crit ? '暴擊！！' : fumble ? '大失敗！' : hit ? '命中！' : '未命中'}`
  };
}

function skillCheck(statMod, proficient, level, dc) {
  const raw = d20();
  const prof = proficient ? proficiencyBonus(level) : 0;
  const total = raw + statMod + prof;
  const success = raw === 20 || (raw !== 1 && total >= dc);
  return {
    raw, statMod, prof, total, dc, success,
    str: `🎲 檢定：d20(${raw}) + ${statMod}${prof ? ' + ' + prof : ''} = ${total} vs DC ${dc} → ${raw === 20 ? '大成功！' : raw === 1 ? '大失敗！' : success ? '成功' : '失敗'}`
  };
}

// === 技能數據表 ===
const SKILLS = {
  warcraft: {
    '戰士': [
      { level: 1, name: '猛擊', type: 'attack', target: 'single', damage: '1d8+2', damageType: '物理', mpCost: 0, desc: '單體攻擊，傷害+2' },
      { level: 2, name: '戰吼', type: 'buff', target: 'party', duration: 3, mpCost: 0, desc: '全體攻擊+1，3回合' },
      { level: 4, name: '旋風斬', type: 'attack', target: 'all_enemies', damage: '1d8', damageType: '物理', mpCost: 0, desc: '攻擊所有鄰近敵人' },
      { level: 6, name: '盾牌格擋', type: 'defend', target: 'self', duration: 1, mpCost: 0, desc: '下次傷害減半' },
      { level: 8, name: '衝鋒', type: 'attack', target: 'single', damage: '1d8+2', damageType: '物理', mpCost: 0, desc: '攻擊+2並眩暈1回合' },
      { level: 10, name: '破甲攻擊', type: 'attack', target: 'single', damage: '1d8', damageType: '物理', mpCost: 0, desc: '降低目標AC 2點，3回合' },
      { level: 12, name: '嘲諷', type: 'taunt', target: 'single', duration: 2, mpCost: 0, desc: '強制敵人攻擊自己' },
      { level: 14, name: '拳擊', type: 'interrupt', target: 'single', mpCost: 0, desc: '打斷施法' },
      { level: 16, name: '死亡之願', type: 'buff', target: 'self', duration: 3, mpCost: 0, desc: '攻擊+4，受傷+2' },
      { level: 18, name: '盾牆', type: 'defend', target: 'self', duration: 2, mpCost: 0, desc: '傷害減少50%' },
      { level: 20, name: '大旋風', type: 'attack', target: 'all_enemies', damage: '2d8', damageType: '物理', mpCost: 0, desc: '2倍武器傷害全體' },
    ],
    '法師': [
      { level: 1, name: '火球術', type: 'attack', target: 'single', damage: '2d6', damageType: '火焰', mpCost: 5, desc: '遠程火焰傷害' },
      { level: 2, name: '冰霜新星', type: 'attack', target: 'all_enemies', damage: '1d8', damageType: '冰霜', mpCost: 5, desc: 'AOE+減速2回合' },
      { level: 4, name: '奧術飛彈', type: 'attack', target: 'single', damage: '3d4+3', damageType: '奧術', mpCost: 5, desc: '自動命中3發' },
      { level: 6, name: '變羊術', type: 'cc', target: 'single', duration: 3, mpCost: 8, desc: '控制3回合' },
      { level: 8, name: '閃現', type: 'utility', target: 'self', mpCost: 3, desc: '瞬移脫離近戰' },
      { level: 10, name: '暴風雪', type: 'attack', target: 'all_enemies', damage: '3d6', damageType: '冰霜', mpCost: 10, desc: 'AOE冰霜+減速' },
      { level: 12, name: '法術反制', type: 'interrupt', target: 'single', mpCost: 5, desc: '打斷+沉默1回合' },
      { level: 14, name: '烈焰風暴', type: 'attack', target: 'all_enemies', damage: '4d6', damageType: '火焰', mpCost: 12, desc: 'AOE火焰' },
      { level: 16, name: '寒冰屏障', type: 'defend', target: 'self', duration: 2, mpCost: 10, desc: '免疫傷害但無法行動' },
      { level: 18, name: '奧術強化', type: 'buff', target: 'self', duration: 1, mpCost: 8, desc: '下個法術傷害翻倍' },
      { level: 20, name: '炎爆術', type: 'attack', target: 'single', damage: '8d6', damageType: '火焰', mpCost: 20, desc: '必定暴擊' },
    ],
    '牧師': [
      { level: 1, name: '聖光術', type: 'heal', target: 'single', damage: '2d6', damageType: '神聖', mpCost: 5, desc: '治療2d6+WIS' },
      { level: 2, name: '神聖懲擊', type: 'attack', target: 'single', damage: '2d6', damageType: '神聖', mpCost: 5, desc: '遠程神聖傷害' },
      { level: 4, name: '恢復術', type: 'hot', target: 'single', damage: '1d6', duration: 3, damageType: '神聖', mpCost: 5, desc: '3回合HOT' },
      { level: 6, name: '驅散魔法', type: 'dispel', target: 'single', mpCost: 5, desc: '移除負面狀態' },
      { level: 8, name: '治療禱言', type: 'heal', target: 'party', damage: '1d8', damageType: '神聖', mpCost: 10, desc: '全體治療' },
      { level: 10, name: '暗影之言：痛', type: 'dot', target: 'single', damage: '1d4', duration: 3, damageType: '暗影', mpCost: 8, desc: '1d8傷害+DOT' },
      { level: 12, name: '真言術：盾', type: 'shield', target: 'single', mpCost: 8, desc: '吸收15點傷害' },
      { level: 14, name: '神聖之火', type: 'attack', target: 'single', damage: '3d8', damageType: '神聖', mpCost: 10, desc: '3d8+灼燒' },
      { level: 16, name: '大治療術', type: 'heal', target: 'single', damage: '4d8', damageType: '神聖', mpCost: 15, desc: '強力單體治療' },
      { level: 18, name: '守護靈魂', type: 'resurrect', target: 'single', mpCost: 20, desc: '死亡自動復活50%HP' },
      { level: 20, name: '神聖頌歌', type: 'heal', target: 'party', damage: '4d6', damageType: '神聖', mpCost: 25, desc: '全體大治療+驅散' },
    ],
    '盜賊': [
      { level: 1, name: '背刺', type: 'attack', target: 'single', damage: '1d6+2d6', damageType: '物理', mpCost: 0, desc: '潛行攻擊+2d6' },
      { level: 2, name: '邪惡攻擊', type: 'attack', target: 'single', damage: '1d6+1d6', damageType: '物理', mpCost: 0, desc: '傷害+1d6' },
      { level: 4, name: '潛行', type: 'stealth', target: 'self', mpCost: 0, desc: '進入隱身' },
      { level: 6, name: '毒刃', type: 'buff', target: 'self', duration: 3, mpCost: 0, desc: '附毒1d4/命中' },
      { level: 8, name: '悶棍', type: 'cc', target: 'single', duration: 2, mpCost: 0, desc: '潛行擊暈2回合' },
      { level: 10, name: '切割', type: 'dot', target: 'single', damage: '1d4', duration: 3, damageType: '物理', mpCost: 0, desc: '流血DOT' },
      { level: 12, name: '致盲', type: 'cc', target: 'single', duration: 2, mpCost: 0, desc: '致盲2回合' },
      { level: 14, name: '腎擊', type: 'cc', target: 'single', duration: 2, mpCost: 0, desc: '眩暈2回合' },
      { level: 16, name: '消失', type: 'stealth', target: 'self', mpCost: 0, desc: '戰鬥中潛行' },
      { level: 18, name: '影舞步', type: 'buff', target: 'self', duration: 3, mpCost: 0, desc: '所有攻擊視為潛行' },
      { level: 20, name: '暗影之舞', type: 'attack', target: 'single', damage: '6d8', damageType: '物理', mpCost: 0, desc: '無視護甲' },
    ],
    '獵人': [
      { level: 1, name: '穩固射擊', type: 'attack', target: 'single', damage: '1d8+2', damageType: '物理', mpCost: 0, desc: '遠程攻擊+2' },
      { level: 2, name: '毒蛇釘刺', type: 'dot', target: 'single', damage: '1d4', duration: 3, damageType: '毒素', mpCost: 0, desc: '遠程+DOT' },
      { level: 4, name: '召喚野獸', type: 'summon', summonId: 'hunter_pet', mpCost: 0, persistent: true, desc: '召喚戰鬥寵物' },
      { level: 6, name: '多重射擊', type: 'attack', target: 'multi_3', damage: '1d8', damageType: '物理', mpCost: 0, desc: '攻擊3目標' },
      { level: 8, name: '假死', type: 'utility', target: 'self', mpCost: 0, desc: '脫離戰鬥' },
      { level: 10, name: '瞄準射擊', type: 'attack', target: 'single', damage: '3d8', damageType: '物理', mpCost: 0, desc: '蓄力強攻' },
      { level: 12, name: '冰凍陷阱', type: 'cc', target: 'single', duration: 2, mpCost: 0, desc: '凍結2回合' },
      { level: 14, name: '亂射', type: 'attack', target: 'all_enemies', damage: '1d8', damageType: '物理', mpCost: 0, desc: 'AOE射擊' },
      { level: 16, name: '反擊', type: 'reaction', target: 'single', damage: '1d8', damageType: '物理', mpCost: 0, desc: '被近戰時反射擊' },
      { level: 18, name: '威懾', type: 'cc', target: 'all_enemies', duration: 2, mpCost: 0, desc: '恐懼全體2回合' },
      { level: 20, name: '奇美拉射擊', type: 'attack', target: 'single', damage: '5d10', damageType: '物理', mpCost: 0, desc: '大傷害+自我治療25%' },
    ],
    '聖騎士': [
      { level: 1, name: '聖光審判', type: 'attack', target: 'single', damage: '1d8+1d6', damageType: '神聖', mpCost: 5, desc: '近戰+神聖' },
      { level: 2, name: '聖療術', type: 'heal', target: 'single', damage: '2d6', damageType: '神聖', mpCost: 5, desc: '治療2d6+WIS' },
      { level: 4, name: '奉獻', type: 'dot', target: 'all_enemies', damage: '1d6', duration: 3, damageType: '神聖', mpCost: 5, desc: '周圍AOE DOT' },
      { level: 6, name: '聖盾術', type: 'defend', target: 'self', duration: 2, mpCost: 8, desc: '免疫傷害但無法攻擊' },
      { level: 8, name: '正義之錘', type: 'attack', target: 'single', damage: '2d6', damageType: '神聖', mpCost: 5, desc: '遠程+眩暈1回合' },
      { level: 10, name: '聖光閃現', type: 'heal', target: 'single', damage: '1d8', damageType: '神聖', mpCost: 3, desc: '快速治療' },
      { level: 12, name: '自由祝福', type: 'dispel', target: 'single', mpCost: 5, desc: '移除控制效果' },
      { level: 14, name: '公正之怒', type: 'buff', target: 'self', duration: 3, mpCost: 5, desc: '攻擊+3' },
      { level: 16, name: '聖療術（大）', type: 'heal', target: 'single', damage: '4d8', damageType: '神聖', mpCost: 15, desc: '強力治療' },
      { level: 18, name: '聖光護甲', type: 'shield', target: 'single', duration: 3, mpCost: 10, desc: '傷害減少30%' },
      { level: 20, name: '復仇之怒', type: 'attack', target: 'all_enemies', damage: '4d8', damageType: '神聖', mpCost: 20, desc: 'AOE+眩暈1回合' },
    ],
    '薩滿': [
      { level: 1, name: '閃電箭', type: 'attack', target: 'single', damage: '2d6', damageType: '自然', mpCost: 5, desc: '遠程自然傷害' },
      { level: 2, name: '大地圖騰', type: 'buff', target: 'party', duration: 3, mpCost: 5, desc: '全隊AC+1' },
      { level: 4, name: '火焰震擊', type: 'dot', target: 'single', damage: '1d6', duration: 3, damageType: '火焰', mpCost: 5, desc: '火焰+DOT' },
      { level: 6, name: '治療波', type: 'heal', target: 'single', damage: '2d8', damageType: '自然', mpCost: 5, desc: '治療2d8+WIS' },
      { level: 8, name: '風剪', type: 'interrupt', target: 'single', mpCost: 3, desc: '打斷施法' },
      { level: 10, name: '閃電鏈', type: 'attack', target: 'multi_3', damage: '2d6', damageType: '自然', mpCost: 8, desc: '鏈式攻擊3目標' },
      { level: 12, name: '治療圖騰', type: 'hot', target: 'party', damage: '1d6', duration: 3, damageType: '自然', mpCost: 8, desc: '全隊HOT' },
      { level: 14, name: '熔岩爆裂', type: 'attack', target: 'single', damage: '4d6', damageType: '火焰', mpCost: 10, desc: '強力單體火焰' },
      { level: 16, name: '先祖之魂', type: 'resurrect', target: 'single', mpCost: 15, desc: '復活隊友30%HP' },
      { level: 18, name: '英勇氣概', type: 'buff', target: 'party', duration: 3, mpCost: 10, desc: '全隊攻擊速度翻倍' },
      { level: 20, name: '元素掌握', type: 'attack', target: 'all_enemies', damage: '6d8', damageType: '自然', mpCost: 25, desc: '元素AOE大傷害' },
    ],
    '術士': [
      { level: 1, name: '暗影箭', type: 'attack', target: 'single', damage: '2d6', damageType: '暗影', mpCost: 5, desc: '遠程暗影傷害' },
      { level: 2, name: '腐蝕術', type: 'dot', target: 'single', damage: '1d6', duration: 5, damageType: '暗影', mpCost: 5, desc: '5回合DOT' },
      { level: 4, name: '召喚小鬼', type: 'summon', summonId: 'imp', mpCost: 10, persistent: true, desc: '召喚小鬼助戰' },
      { level: 6, name: '生命虹吸', type: 'drain', target: 'single', damage: '1d8', damageType: '暗影', mpCost: 8, desc: '吸血攻擊' },
      { level: 8, name: '恐懼術', type: 'cc', target: 'single', duration: 3, mpCost: 10, immuneCheck: 'fear', desc: '恐懼3回合' },
      { level: 10, name: '召喚虛空行者', type: 'summon', summonId: 'voidwalker', mpCost: 15, persistent: true, desc: '召喚坦克惡魔' },
      { level: 12, name: '痛苦無常', type: 'attack', target: 'single', damage: '0', damageType: '暗影', mpCost: 8, desc: '引爆所有DOT剩餘傷害' },
      { level: 14, name: '靈魂之火', type: 'attack', target: 'single', damage: '4d6', damageType: '暗影', mpCost: 10, desc: '蓄力大傷害' },
      { level: 16, name: '地獄火', type: 'attack', target: 'all_enemies', damage: '2d8', damageType: '火焰', mpCost: 15, desc: 'AOE含自傷' },
      { level: 18, name: '靈魂石', type: 'resurrect', target: 'single', mpCost: 20, desc: '死亡自動復活30%HP' },
      { level: 20, name: '召喚末日守衛', type: 'summon', summonId: 'doomguard', mpCost: 25, persistent: false, desc: '召喚強力惡魔5回合' },
    ],
    '德魯伊': [
      { level: 1, name: '月火術', type: 'dot', target: 'single', damage: '1d4', duration: 3, damageType: '奧術', mpCost: 5, desc: '1d8+DOT' },
      { level: 2, name: '治療之觸', type: 'heal', target: 'single', damage: '2d6', damageType: '自然', mpCost: 5, desc: '治療2d6+WIS' },
      { level: 4, name: '熊形態', type: 'shapeshift', target: 'self', mpCost: 5, desc: 'HP+50% AC+3 無法施法' },
      { level: 6, name: '豹形態', type: 'shapeshift', target: 'self', mpCost: 5, desc: '攻擊+2 可潛行背刺' },
      { level: 8, name: '糾纏根鬚', type: 'cc', target: 'single', duration: 3, mpCost: 5, desc: '束縛3回合' },
      { level: 10, name: '回春術', type: 'hot', target: 'single', damage: '1d6', duration: 5, damageType: '自然', mpCost: 5, desc: '5回合HOT' },
      { level: 12, name: '梟獸形態', type: 'shapeshift', target: 'self', mpCost: 8, desc: '法傷+30% AC+2' },
      { level: 14, name: '野蠻咆哮', type: 'taunt', target: 'all_enemies', duration: 2, mpCost: 5, desc: '熊形態嘲諷全體' },
      { level: 16, name: '自然之力', type: 'summon', summonId: 'treant', mpCost: 10, persistent: false, desc: '召喚3棵樹人3回合' },
      { level: 18, name: '重生', type: 'resurrect', target: 'single', mpCost: 20, desc: '復活隊友30%HP' },
      { level: 20, name: '生命之樹', type: 'shapeshift', target: 'self', duration: 5, mpCost: 15, desc: '治療效果翻倍5回合' },
    ],
  }
};

// === 天賦數據表 ===
const TALENTS = {
  warcraft: {
    '戰士': {
      '武器': [
        { tier: 1, name: '強化猛擊', effect: { modify: 'skill.猛擊.damage', value: '1d8+3' } },
        { tier: 2, name: '致死打擊', effect: { type: 'active', name: '致死打擊', damage: '2d10', target: 'single' } },
        { tier: 3, name: '利刃風暴', effect: { modify: 'skill.旋風斬.damage_mult', value: 1.5 } },
        { tier: 4, name: '斬殺', effect: { type: 'active', name: '斬殺', damage: '3d10', condition: 'target_hp<20%' } },
        { tier: 5, name: '劍刃風暴', effect: { type: 'active', name: '劍刃風暴', damage: '1d10', duration: 3, target: 'all_enemies' } },
      ],
      '狂怒': [
        { tier: 1, name: '狂暴之怒', effect: { trigger: 'on_crit', bonus_damage: 4 } },
        { tier: 2, name: '狂暴打擊', effect: { type: 'active', name: '狂暴打擊', attacks: 2 } },
        { tier: 3, name: '旋風', effect: { trigger: 'crit_on_whirlwind', bonus: '1d8' } },
        { tier: 4, name: '嗜血', effect: { trigger: 'on_hit', heal: 2 } },
        { tier: 5, name: '泰坦之握', effect: { type: 'passive', dual_wield_2h: true, atk_penalty: -2 } },
      ],
      '防護': [
        { tier: 1, name: '強化格擋', effect: { modify: 'skill.盾牌格擋', full_block: true } },
        { tier: 2, name: '復仇', effect: { trigger: 'on_hit_taken', next_attack_advantage: true } },
        { tier: 3, name: '盾牆強化', effect: { modify: 'skill.盾牆.duration', value: 3 } },
        { tier: 4, name: '震盪波', effect: { type: 'active', name: '震盪波', damage: '2d6', target: 'cone', stun_dc: 13 } },
        { tier: 5, name: '不朽堡壘', effect: { trigger: 'on_death', revive_pct: 20, once_per_combat: true } },
      ],
    },
    '法師': {
      '奧術': [
        { tier: 1, name: '奧術專注', effect: { modify: 'skill.奧術飛彈.missiles', value: 5 } },
        { tier: 2, name: '奧術衝擊', effect: { type: 'active', name: '奧術衝擊', damage: '3d8', knockback: true } },
        { tier: 3, name: '魔力回流', effect: { trigger: 'on_kill', restore_skill: 1 } },
        { tier: 4, name: '奧術彈幕', effect: { modify: 'skill.奧術飛彈.damage', value: '5d6+10' } },
        { tier: 5, name: '奧術之力', effect: { type: 'passive', spell_damage_mult: 1.3 } },
      ],
      '火焰': [
        { tier: 1, name: '強化火球', effect: { modify: 'skill.火球術.dot', damage: '1d4', duration: 2 } },
        { tier: 2, name: '活體炸彈', effect: { type: 'active', name: '活體炸彈', damage: '3d6', delay: 3, target: 'aoe' } },
        { tier: 3, name: '燃燒', effect: { modify: 'fire_dot_damage', value: '1d6' } },
        { tier: 4, name: '龍息術', effect: { type: 'active', name: '龍息術', damage: '4d6', target: 'cone', stun: 1 } },
        { tier: 5, name: '隕石術', effect: { type: 'active', name: '隕石術', damage: '6d8', target: 'all_enemies' } },
      ],
      '冰霜': [
        { tier: 1, name: '強化冰霜新星', effect: { modify: 'skill.冰霜新星.damage', value: '2d8' } },
        { tier: 2, name: '寒冰箭', effect: { type: 'active', name: '寒冰箭', damage: '2d8', freeze_chance: 50 } },
        { tier: 3, name: '冰錐術', effect: { type: 'active', name: '冰錐術', damage: '3d6', target: 'cone' } },
        { tier: 4, name: '寒冰屏障強化', effect: { modify: 'skill.寒冰屏障.on_end_damage', value: '2d8' } },
        { tier: 5, name: '極寒風暴', effect: { modify: 'skill.暴風雪.damage_mult', value: 2, freeze_chance: 50 } },
      ],
    },
    '術士': {
      '痛苦': [
        { tier: 1, name: '強化腐蝕', effect: { modify: 'skill.腐蝕術.damage', value: '1d8' } },
        { tier: 2, name: '痛苦詛咒', effect: { type: 'active', name: '痛苦詛咒', damage: '1d8', duration: 5, stacks: true } },
        { tier: 3, name: '夜幕降臨', effect: { trigger: 'on_shadow_bolt', instant_chance: 25 } },
        { tier: 4, name: '不穩定的痛苦', effect: { type: 'active', name: '不穩定的痛苦', damage: '1d10', duration: 5, on_dispel: '4d8' } },
        { tier: 5, name: '枯萎凋零', effect: { type: 'passive', dot_damage_mult: 1.5 } },
      ],
      '惡魔': [
        { tier: 1, name: '強化小鬼', effect: { modify: 'summon.imp.damage', value: '2d6' } },
        { tier: 2, name: '惡魔之力', effect: { modify: 'summon.all.hp_mult', value: 1.5, atk_bonus: 2 } },
        { tier: 3, name: '惡魔犧牲', effect: { type: 'active', name: '惡魔犧牲', heal_pct: 50, kills_summon: true } },
        { tier: 4, name: '召喚地獄犬', effect: { type: 'unlock_summon', summonId: 'felhound' } },
        { tier: 5, name: '惡魔變身', effect: { type: 'active', name: '惡魔變身', duration: 5, all_stats_bonus: 3 } },
      ],
      '毀滅': [
        { tier: 1, name: '強化暗影箭', effect: { modify: 'skill.暗影箭.damage', value: '3d6' } },
        { tier: 2, name: '混亂箭', effect: { type: 'active', name: '混亂箭', damage: '3d8', damageType: 'shadow_fire' } },
        { tier: 3, name: '暗影灼燒', effect: { type: 'active', name: '暗影灼燒', damage: '2d10', no_cast_time: true } },
        { tier: 4, name: '暗影易傷', effect: { type: 'debuff', name: '暗影易傷', shadow_damage_mult: 1.2, duration: 5 } },
        { tier: 5, name: '暗影烈焰', effect: { type: 'active', name: '暗影烈焰', damage: '5d8', target: 'all_enemies' } },
      ],
    },
    '牧師': {
      '神聖': [
        { tier: 1, name: '強化聖光', effect: { modify: 'skill.聖光術.damage', value: '3d6' } },
        { tier: 2, name: '聖光湧泉', effect: { trigger: 'on_heal', extra_heal_chance: 25, extra_heal_mult: 0.5 } },
        { tier: 3, name: '神聖專注', effect: { modify: 'skill.治療禱言.damage', value: '2d8' } },
        { tier: 4, name: '光明之泉', effect: { type: 'active', name: '光明之泉', heal: '2d6', duration: 3, target: 'zone' } },
        { tier: 5, name: '神聖守護', effect: { trigger: 'on_heal', target_dmg_reduction: 0.15, duration: 2 } },
      ],
      '戒律': [
        { tier: 1, name: '強化護盾', effect: { modify: 'skill.真言術：盾.absorb', value: 25 } },
        { tier: 2, name: '痛苦壓制', effect: { trigger: 'shield_active', target_atk_bonus: 1 } },
        { tier: 3, name: '懺悔', effect: { type: 'active', name: '懺悔', cc_duration: 3, target: 'humanoid' } },
        { tier: 4, name: '靈魂之火', effect: { type: 'passive', damage_to_heal_pct: 50 } },
        { tier: 5, name: '神恩術', effect: { type: 'active', name: '神恩術', next_heal_double: true } },
      ],
      '暗影': [
        { tier: 1, name: '強化暗言痛', effect: { modify: 'skill.暗影之言：痛.damage', value: '1d6' } },
        { tier: 2, name: '吸血鬼之觸', effect: { type: 'active', name: '吸血鬼之觸', damage: '3d6', heal_equal: true } },
        { tier: 3, name: '暗影形態', effect: { type: 'active', name: '暗影形態', shadow_damage_mult: 1.3, no_holy: true } },
        { tier: 4, name: '精神鞭笞', effect: { type: 'active', name: '精神鞭笞', damage: '2d6', duration: 3, channel: true } },
        { tier: 5, name: '暗影之擁', effect: { type: 'passive', shadow_dot_damage_mult: 2 } },
      ],
    },
    '盜賊': {
      '刺殺': [
        { tier: 1, name: '強化毒刃', effect: { modify: 'poison_damage', value: '1d6' } },
        { tier: 2, name: '冷血', effect: { type: 'active', name: '冷血', next_crit: true, once_per_combat: true } },
        { tier: 3, name: '致命毒藥', effect: { modify: 'skill.毒刃.duration', value: 'permanent' } },
        { tier: 4, name: '毒素擴散', effect: { type: 'passive', poison_spread: true } },
        { tier: 5, name: '毒心', effect: { type: 'passive', poison_damage_mult: 2 } },
      ],
      '戰鬥': [
        { tier: 1, name: '雙武器精通', effect: { type: 'passive', dual_wield_penalty: 0 } },
        { tier: 2, name: '劍刃亂舞', effect: { type: 'active', name: '劍刃亂舞', attacks: 3 } },
        { tier: 3, name: '衝動', effect: { trigger: 'on_crit', extra_attack: true } },
        { tier: 4, name: '殺戮盛宴', effect: { trigger: 'on_kill', atk_bonus: 2, dmg_bonus: 2, permanent: true } },
        { tier: 5, name: '疾風連斬', effect: { modify: 'skill.劍刃亂舞.attacks', value: 5 } },
      ],
      '敏銳': [
        { tier: 1, name: '高級潛行', effect: { type: 'passive', stealth_undetectable: true } },
        { tier: 2, name: '伺機待發', effect: { modify: 'stealth_bonus_damage', value: '1d6' } },
        { tier: 3, name: '準備就緒', effect: { modify: 'skill.消失.uses', value: 2 } },
        { tier: 4, name: '暗影步', effect: { type: 'active', name: '暗影步', teleport: true, stealth_attack: true } },
        { tier: 5, name: '影分身', effect: { trigger: 'on_vanish', decoy_duration: 2 } },
      ],
    },
    '獵人': {
      '射擊': [
        { tier: 1, name: '精準射擊', effect: { type: 'passive', ranged_atk_bonus: 2 } },
        { tier: 2, name: '致命瞄準', effect: { modify: 'skill.瞄準射擊.damage', value: '4d8' } },
        { tier: 3, name: '狂射', effect: { type: 'active', name: '狂射', attacks: 2, duration: 3 } },
        { tier: 4, name: '沉默射擊', effect: { type: 'active', name: '沉默射擊', silence: 2 } },
        { tier: 5, name: '真正瞄準', effect: { modify: 'skill.瞄準射擊.no_charge', value: true } },
      ],
      '野獸': [
        { tier: 1, name: '強化寵物', effect: { modify: 'pet.hp_mult', value: 1.5 } },
        { tier: 2, name: '狂野怒火', effect: { trigger: 'pet_attack', extra_attack_chance: 25 } },
        { tier: 3, name: '恐嚇', effect: { type: 'active', name: '恐嚇', pet_taunt: true } },
        { tier: 4, name: '野獸之心', effect: { type: 'active', name: '野獸之心', pet_berserk: 3, atk_mult: 2 } },
        { tier: 5, name: '雙獸共舞', effect: { type: 'passive', dual_pet: true } },
      ],
      '生存': [
        { tier: 1, name: '強化陷阱', effect: { modify: 'skill.冰凍陷阱.duration', value: 3 } },
        { tier: 2, name: '反擊強化', effect: { modify: 'skill.反擊.damage', value: '1d8+1d8' } },
        { tier: 3, name: '爆炸陷阱', effect: { type: 'active', name: '爆炸陷阱', damage: '3d6', target: 'aoe' } },
        { tier: 4, name: '翼龍釘刺', effect: { type: 'active', name: '翼龍釘刺', sleep: 3 } },
        { tier: 5, name: '黑箭', effect: { type: 'active', name: '黑箭', damage: '4d8', on_kill_summon: true } },
      ],
    },
    '聖騎士': {
      '神聖': [
        { tier: 1, name: '強化聖療', effect: { modify: 'skill.聖療術.damage', value: '3d6' } },
        { tier: 2, name: '聖佑術', effect: { type: 'active', name: '聖佑術', auto_heal: '1d4', duration: 5 } },
        { tier: 3, name: '專注光環', effect: { type: 'passive', party_heal_bonus: 0.15 } },
        { tier: 4, name: '聖光信標', effect: { type: 'active', name: '聖光信標', mirror_heal: 0.5 } },
        { tier: 5, name: '神聖震擊', effect: { type: 'active', name: '神聖震擊', heal_or_damage: '3d8' } },
      ],
      '防護': [
        { tier: 1, name: '強化奉獻', effect: { modify: 'skill.奉獻.damage', value: '2d6' } },
        { tier: 2, name: '十字軍打擊', effect: { trigger: 'on_hit_taken', heal: 3 } },
        { tier: 3, name: '神聖之盾', effect: { modify: 'skill.聖盾術.can_attack', value: true, damage_mult: 0.5 } },
        { tier: 4, name: '復仇者之盾', effect: { type: 'active', name: '復仇者之盾', damage: '3d6', bounces: 3 } },
        { tier: 5, name: '堅韌光環', effect: { type: 'passive', party_ac_bonus: 2 } },
      ],
      '懲戒': [
        { tier: 1, name: '強化審判', effect: { modify: 'skill.聖光審判.damage', value: '1d8+2d6' } },
        { tier: 2, name: '公正之劍', effect: { trigger: 'on_attack', extra_attack_chance: 25 } },
        { tier: 3, name: '十字軍之力', effect: { type: 'passive', crit_bonus: 10 } },
        { tier: 4, name: '聖光風暴', effect: { type: 'active', name: '聖光風暴', damage: '3d10', target: 'all_enemies' } },
        { tier: 5, name: '灰燼使者', effect: { type: 'passive', two_hand_damage_mult: 1.5 } },
      ],
    },
    '薩滿': {
      '元素': [
        { tier: 1, name: '強化閃電', effect: { modify: 'skill.閃電箭.damage', value: '3d6' } },
        { tier: 2, name: '元素集中', effect: { trigger: 'on_lightning', overload_chance: 30 } },
        { tier: 3, name: '火焰圖騰', effect: { type: 'active', name: '火焰圖騰', damage: '1d8', duration: 3, auto: true } },
        { tier: 4, name: '雷霆風暴', effect: { type: 'active', name: '雷霆風暴', damage: '4d8', target: 'all_enemies' } },
        { tier: 5, name: '元素之怒', effect: { type: 'passive', elemental_damage_mult: 1.3 } },
      ],
      '增強': [
        { tier: 1, name: '強化武器', effect: { type: 'passive', weapon_damage_bonus: '1d6' } },
        { tier: 2, name: '風怒武器', effect: { trigger: 'on_melee', extra_attacks: 2, chance: 20 } },
        { tier: 3, name: '熔岩猛擊', effect: { type: 'active', name: '熔岩猛擊', damage: '2d8', damageType: '火焰' } },
        { tier: 4, name: '精通圖騰', effect: { type: 'passive', totem_effect_mult: 1.5 } },
        { tier: 5, name: '暴風打擊', effect: { type: 'active', name: '暴風打擊', damage: '4d10', damageType: '自然' } },
      ],
      '恢復': [
        { tier: 1, name: '強化治療波', effect: { modify: 'skill.治療波.damage', value: '3d8' } },
        { tier: 2, name: '潮汐圖騰', effect: { type: 'active', name: '潮汐圖騰', party_heal: '1d8', duration: 3 } },
        { tier: 3, name: '大地之盾', effect: { type: 'active', name: '大地之盾', charges: 6, heal_per_charge: '1d6' } },
        { tier: 4, name: '自然迅捷', effect: { type: 'active', name: '自然迅捷', next_heal_instant: true } },
        { tier: 5, name: '潮汐之力', effect: { type: 'passive', heal_crit_bonus: 50 } },
      ],
    },
    '德魯伊': {
      '平衡': [
        { tier: 1, name: '強化月火', effect: { modify: 'skill.月火術.damage', value: '1d6' } },
        { tier: 2, name: '星火術', effect: { type: 'active', name: '星火術', damage: '3d8', damageType: '奧術' } },
        { tier: 3, name: '自然之握', effect: { modify: 'skill.糾纏根鬚.no_break', value: true } },
        { tier: 4, name: '星湧術', effect: { type: 'active', name: '星湧術', damage: '4d8', slow: true } },
        { tier: 5, name: '日蝕月蝕', effect: { type: 'passive', alternating_damage_bonus: 0.5 } },
      ],
      '野性': [
        { tier: 1, name: '強化熊形態', effect: { modify: 'bear.hp_mult', value: 1.75 } },
        { tier: 2, name: '撕碎', effect: { type: 'active', name: '撕碎', damage: '2d8', cat_only: true } },
        { tier: 3, name: '野性衝鋒', effect: { type: 'active', name: '野性衝鋒', stun: 1, any_form: true } },
        { tier: 4, name: '獸群領袖', effect: { type: 'passive', party_crit_bonus: 5 } },
        { tier: 5, name: '狂暴', effect: { type: 'active', name: '狂暴', cat_attack_mult: 2, duration: 3 } },
      ],
      '恢復': [
        { tier: 1, name: '強化回春', effect: { modify: 'skill.回春術.damage', value: '2d6' } },
        { tier: 2, name: '自然賜福', effect: { trigger: 'on_heal', bonus_heal_chance: 30, bonus: '1d6' } },
        { tier: 3, name: '野性成長', effect: { type: 'active', name: '野性成長', party_hot: '1d4', duration: 5 } },
        { tier: 4, name: '迅癒', effect: { type: 'active', name: '迅癒', instant_heal: '3d8' } },
        { tier: 5, name: '生命之花', effect: { type: 'passive', hot_healing_mult: 1.5 } },
      ],
    },
  }
};

// === 召喚物數據表 ===
const SUMMONS = {
  imp:         { name: '小鬼',     hp: '2d6+4',   ac: 11, attack: { name: '火焰箭',   bonus: 3, damage: '1d6', damageType: '火焰', type: 'ranged' }, ai: 'dps_ranged' },
  voidwalker:  { name: '虛空行者', hp: '4d8+8',   ac: 14, attack: { name: '虛空撕裂', bonus: 4, damage: '1d8', damageType: '暗影', type: 'melee' },  ai: 'tank', abilities: ['taunt'] },
  felhound:    { name: '地獄犬',   hp: '3d8+6',   ac: 13, attack: { name: '魔能撕咬', bonus: 4, damage: '1d8', damageType: '奧術', type: 'melee' },  ai: 'anti_caster', abilities: ['dispel'] },
  doomguard:   { name: '末日守衛', hp: '6d10+12', ac: 16, attack: { name: '末日之劍', bonus: 7, damage: '3d8', damageType: '火焰', type: 'melee' },  ai: 'dps_melee', duration: 5 },
  hunter_pet:  { name: '戰鬥寵物', hp: '3d8+6',   ac: 13, attack: { name: '撕咬',     bonus: 4, damage: '1d6+2', damageType: '物理', type: 'melee' }, ai: 'dps_melee' },
  treant:      { name: '樹人',     hp: '2d8+4',   ac: 12, attack: { name: '樹枝抽打', bonus: 3, damage: '1d6', damageType: '物理', type: 'melee' },   ai: 'dps_melee', duration: 3 },
};

// === MP 計算 ===
function calculateMP(className, level, intMod) {
  const BASE_MP = { '法師': 20, '術士': 15, '牧師': 20, '聖騎士': 10, '薩滿': 15, '德魯伊': 15 };
  const base = BASE_MP[className] || 0;
  if (base === 0) return 0;
  return base + (level - 1) * 5 + intMod * 2;
}

// === 等級技能查詢 ===
function getSkillsForLevel(campaign, className, level) {
  const classSkills = (SKILLS[campaign] || {})[className] || [];
  return classSkills.filter(s => s.level <= level);
}

module.exports = {
  roll, d20, modifier, validatePointBuy, proficiencyBonus,
  attackRoll, skillCheck,
  CharacterCreator,
  RACES, CLASSES, POINT_COST, TOTAL_POINTS,
  SKILLS, TALENTS, SUMMONS, calculateMP, getSkillsForLevel
};
