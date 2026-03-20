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
    this.step = 'stats';

    let text = `\n✅ 職業選擇：${className}（${classData.role}）\n`;
    text += `   HP骰：d${classData.hp_die} | 護甲：${classData.armor} | 主屬性：${classData.primary}\n\n`;
    text += `═══════════════════════════════════════\n分配屬性點數（共 27 點）\n───────────────────────────────────────\n`;
    text += `每個屬性初始為 8，花費點數提升：\n`;
    text += `  8→9(1點) 9→10(1點) 10→11(1點) 11→12(1點)\n`;
    text += `  12→13(1點) 13→14(2點) 14→15(2點)\n`;
    text += `  最高只能買到 15，種族加成之後可超過 15\n\n`;
    text += `請用以下格式分配（用空格分隔）：\n`;
    text += `  STR DEX CON INT WIS CHA\n`;
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

    const bonusStr = Object.entries(this.raceData.bonus).map(([k, v]) => `${k}+${v}`).join(', ');

    let text = `\n✅ 屬性分配完成！（花費 ${result.spent}/${TOTAL_POINTS} 點）\n\n`;
    text += `───────────────────────────────────────\n`;
    text += `  屬性    基礎  種族加成  最終  調整值\n`;
    for (const k of keys) {
      const base = stats[k];
      const bonus = this.raceData.bonus[k] || 0;
      const final = finalStats[k];
      const mod = modifier(final);
      text += `  ${k.padEnd(6)} ${String(base).padStart(4)}  ${bonus > 0 ? '+' + bonus : ' 0'}        ${String(final).padStart(3)}   ${mod >= 0 ? '+' : ''}${mod}\n`;
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
    text += `  STR: ${this.finalStats.STR}(${modifier(this.finalStats.STR) >= 0 ? '+' : ''}${modifier(this.finalStats.STR)}) `;
    text += `DEX: ${this.finalStats.DEX}(${modifier(this.finalStats.DEX) >= 0 ? '+' : ''}${modifier(this.finalStats.DEX)}) `;
    text += `CON: ${this.finalStats.CON}(${modifier(this.finalStats.CON) >= 0 ? '+' : ''}${modifier(this.finalStats.CON)})\n`;
    text += `  INT: ${this.finalStats.INT}(${modifier(this.finalStats.INT) >= 0 ? '+' : ''}${modifier(this.finalStats.INT)}) `;
    text += `WIS: ${this.finalStats.WIS}(${modifier(this.finalStats.WIS) >= 0 ? '+' : ''}${modifier(this.finalStats.WIS)}) `;
    text += `CHA: ${this.finalStats.CHA}(${modifier(this.finalStats.CHA) >= 0 ? '+' : ''}${modifier(this.finalStats.CHA)})\n`;
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

module.exports = {
  roll, d20, modifier, validatePointBuy, proficiencyBonus,
  attackRoll, skillCheck,
  CharacterCreator,
  RACES, CLASSES, POINT_COST, TOTAL_POINTS
};
