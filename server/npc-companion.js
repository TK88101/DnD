const { roll, d20, modifier, proficiencyBonus, getSkillsForLevel, CLASSES, RACES, calculateMP } = require('./game-engine');

// NPC 队友双轴性格系统
// 性情轴 (temperament): 0=沉稳冷静 ↔ 10=冲动暴躁
// 立场轴 (stance):      0=务实自利 ↔ 10=重义忘利

const PERSONALITY_LABELS = {
  temperament: [
    { max: 2, label: '冷静沉着', combat: '优先防御/控制', dialogue: '语气平稳，极少情绪波动' },
    { max: 4, label: '稳重内敛', combat: '均衡偏防守', dialogue: '话不多，偶尔评论' },
    { max: 6, label: '普通',     combat: '均衡', dialogue: '正常交流' },
    { max: 8, label: '好斗热血', combat: '偏进攻', dialogue: '语气激动，喜欢挑衅' },
    { max: 10, label: '暴躁冲动', combat: '全力进攻', dialogue: '大吼大叫，容易暴走' },
  ],
  stance: [
    { max: 2, label: '冷血自利', combat: '自保优先', dialogue: '只关心自己的利益' },
    { max: 4, label: '务实谨慎', combat: '偏自保', dialogue: '偶尔帮忙，但不冒险' },
    { max: 6, label: '普通',     combat: '均衡', dialogue: '正常合作' },
    { max: 8, label: '重情重义', combat: '偏保护队友', dialogue: '关心队友，主动帮忙' },
    { max: 10, label: '舍己为人', combat: '优先保护队友', dialogue: '为队友挡伤，不惜代价' },
  ],
};

function getLabel(axis, value) {
  const labels = PERSONALITY_LABELS[axis];
  for (const l of labels) {
    if (value <= l.max) return l;
  }
  return labels[labels.length - 1];
}

class NPCCompanion {
  constructor({ name, race, raceData, className, classData, level, campaign }) {
    this.name = name;
    this.race = race;
    this.raceData = raceData;
    this.className = className;
    this.classData = classData;
    this.campaign = campaign;
    this.level = level || 1;

    // 双轴性格 — 招募时 roll d10
    this.temperament = Math.floor(Math.random() * 11); // 0-10
    this.stance = Math.floor(Math.random() * 11);       // 0-10

    // 属性 — 根据职业主属性自动分配
    this.stats = this._generateStats();
    this.hp = this._calcHP();
    this.maxHp = this.hp;
    this.ac = this._calcAC();
    this.mp = calculateMP ? calculateMP(this.className, this.level, this.stats) : undefined;
    this.maxMp = this.mp;
    this.skills = getSkillsForLevel(this.campaign, this.className, this.level);
    this.equipment = {
      weapon: classData.starter_weapon,
      armor: classData.starter_armor,
    };
    this.isNPC = true;
  }

  _generateStats() {
    const classData = this.classData;
    const primary = (classData.primary || 'STR').split('/');
    const base = { STR: 10, DEX: 10, CON: 12, INT: 10, WIS: 10, CHA: 10 };

    // 主属性拉高
    for (const p of primary) {
      base[p.trim()] = 14;
    }
    // CON 保底
    if (!primary.includes('CON')) base.CON = 12;

    // 种族加成
    if (this.raceData && this.raceData.bonus) {
      for (const [k, v] of Object.entries(this.raceData.bonus)) {
        base[k] = (base[k] || 10) + v;
      }
    }

    return base;
  }

  _calcHP() {
    const hpDie = this.classData.hp_die;
    const conMod = modifier(this.stats.CON);
    // 1级满血 + 每级 roll
    let hp = hpDie + conMod;
    for (let i = 2; i <= this.level; i++) {
      hp += Math.floor(Math.random() * hpDie) + 1 + conMod;
    }
    return Math.max(1, hp);
  }

  _calcAC() {
    return 10 + modifier(this.stats.DEX) + (this.classData.armor === '板甲' ? 6 : this.classData.armor === '鎖甲' ? 4 : this.classData.armor === '皮甲' ? 2 : 1);
  }

  // 获取性格描述（注入 Gemini prompt 用）
  getPersonalityPrompt() {
    const tLabel = getLabel('temperament', this.temperament);
    const sLabel = getLabel('stance', this.stance);
    return `[NPC]${this.name}：${this.race} ${this.className}，` +
      `性情(${this.temperament}/10)${tLabel.label}，立场(${this.stance}/10)${sLabel.label}。` +
      `对话风格：${tLabel.dialogue}，${sLabel.dialogue}。`;
  }

  // 战斗 AI：代码控制行动选择
  chooseCombatAction(combatState) {
    const { allies, enemies } = combatState;
    const availableSkills = (this.skills || []).filter(s => {
      if (this.mp !== undefined && s.mpCost && this.mp < s.mpCost) return false;
      return true;
    });

    const role = this._getRole();
    const allyInDanger = allies.find(a => a.hp > 0 && a.hp / a.maxHp < 0.3);
    const selfLow = this.hp / this.maxHp < 0.3;

    // 立场影响：高立场优先保护队友，低立场优先自保
    if (selfLow && this.stance <= 3) {
      // 自保：尝试治疗自己或防御
      const selfHeal = availableSkills.find(s => s.type === 'heal');
      if (selfHeal) return { type: 'skill', skillName: selfHeal.name, target: this.name };
      const defend = availableSkills.find(s => s.type === 'defend');
      if (defend) return { type: 'skill', skillName: defend.name, target: this.name };
    }

    if (allyInDanger && this.stance >= 7) {
      // 高义气：优先保护/治疗队友
      const healSkill = availableSkills.find(s => s.type === 'heal');
      if (healSkill) return { type: 'skill', skillName: healSkill.name, target: allyInDanger.name };
      const shieldSkill = availableSkills.find(s => s.type === 'shield');
      if (shieldSkill) return { type: 'skill', skillName: shieldSkill.name, target: allyInDanger.name };
    }

    // 职业铁律：按角色定位选择基础行为
    if (role === 'healer') return this._healerAI(availableSkills, allies, enemies);
    if (role === 'tank') return this._tankAI(availableSkills, allies, enemies);
    return this._dpsAI(availableSkills, enemies);
  }

  _getRole() {
    const r = this.classData.role || '';
    if (r.includes('治療') || r.includes('治疗')) return 'healer';
    if (r.includes('坦克')) return 'tank';
    return 'dps';
  }

  _healerAI(skills, allies, enemies) {
    // 治疗职责优先
    const injured = allies.filter(a => a.hp > 0 && a.hp < a.maxHp).sort((a, b) => (a.hp / a.maxHp) - (b.hp / b.maxHp));
    if (injured.length > 0 && injured[0].hp / injured[0].maxHp < 0.6) {
      const healSkill = skills.find(s => s.type === 'heal');
      if (healSkill) return { type: 'skill', skillName: healSkill.name, target: injured[0].name };
      const hotSkill = skills.find(s => s.type === 'hot');
      if (hotSkill) return { type: 'skill', skillName: hotSkill.name, target: injured[0].name };
    }
    // 没人受伤就输出
    return this._dpsAI(skills, enemies);
  }

  _tankAI(skills, allies, enemies) {
    // 嘲讽优先
    const taunt = skills.find(s => s.type === 'taunt');
    if (taunt && enemies.length > 0) {
      return { type: 'skill', skillName: taunt.name, target: enemies[0].name };
    }
    // 有 buff 就用
    if (this.temperament <= 4) {
      const defend = skills.find(s => s.type === 'defend');
      if (defend) return { type: 'skill', skillName: defend.name, target: this.name };
    }
    return this._dpsAI(skills, enemies);
  }

  _dpsAI(skills, enemies) {
    if (enemies.length === 0) return { type: 'melee', target: null };
    const target = this._selectTarget(enemies);
    if (!target) return { type: 'melee', target: null };

    // 性情影响攻击选择：高性情选最强攻击，低性情选控制/DOT
    const attackSkills = skills.filter(s => s.type === 'attack' || s.type === 'drain');
    const controlSkills = skills.filter(s => s.type === 'cc' || s.type === 'dot');

    if (this.temperament >= 7 && attackSkills.length > 0) {
      // 冲动：选最高伤害技能
      const skill = attackSkills[attackSkills.length - 1]; // 通常后面的更强
      return { type: 'skill', skillName: skill.name, target: target.name };
    }

    if (this.temperament <= 3 && controlSkills.length > 0) {
      // 沉稳：优先控制
      const skill = controlSkills[0];
      return { type: 'skill', skillName: skill.name, target: target.name };
    }

    // 中间值：正常攻击
    if (attackSkills.length > 0) {
      const skill = attackSkills[Math.floor(Math.random() * attackSkills.length)];
      return { type: 'skill', skillName: skill.name, target: target.name };
    }

    return { type: 'melee', target: target.name };
  }

  _selectTarget(enemies) {
    if (enemies.length === 0) return null;
    // 冲动型攻击仇恨最高(第一个)，沉稳型集火最低血量
    if (this.temperament >= 7) return enemies[0];
    return enemies.reduce((a, b) => a.hp < b.hp ? a : b);
  }

  // 转为战斗参与者格式（兼容 CombatSession）
  toCombatant() {
    return {
      name: `[NPC]${this.name}`,
      type: 'npc_companion',
      side: 'player',
      isNPC: true,
      hp: this.hp,
      maxHp: this.maxHp,
      ac: this.ac,
      mp: this.mp,
      maxMp: this.maxMp,
      stats: this.stats,
      level: this.level,
      skills: this.skills,
      equipment: this.equipment,
      proficiency: proficiencyBonus(this.level),
      // 性格数据（供叙事引擎使用）
      personality: {
        temperament: this.temperament,
        stance: this.stance,
      },
    };
  }

  // 序列化（存档用）
  toJSON() {
    return {
      name: this.name,
      race: this.race,
      className: this.className,
      campaign: this.campaign,
      level: this.level,
      temperament: this.temperament,
      stance: this.stance,
      hp: this.hp,
      maxHp: this.maxHp,
      ac: this.ac,
      mp: this.mp,
      maxMp: this.maxMp,
      stats: this.stats,
      equipment: this.equipment,
    };
  }

  // 从存档恢复
  static fromJSON(data, campaign) {
    const classData = CLASSES[campaign]?.[data.className];
    const npc = Object.create(NPCCompanion.prototype);
    Object.assign(npc, data);
    npc.classData = classData;
    npc.isNPC = true;
    npc.skills = getSkillsForLevel(campaign, data.className, data.level);
    return npc;
  }

  // 升级
  levelUp() {
    this.level++;
    const hpGain = Math.floor(Math.random() * this.classData.hp_die) + 1 + modifier(this.stats.CON);
    this.maxHp += Math.max(1, hpGain);
    this.hp = this.maxHp;
    this.skills = getSkillsForLevel(this.campaign, this.className, this.level);
    if (calculateMP) {
      this.maxMp = calculateMP(this.className, this.level, this.stats);
      this.mp = this.maxMp;
    }
  }
}

// NPC 名字库（按种族分类）
const NPC_NAMES = {
  '人類': ['马库斯', '艾琳', '杰弗里', '莉莉安', '加雷特', '伊莎贝尔'],
  '矮人': ['布罗尔', '玛格妮', '托林', '赫尔加', '杜拉坦', '奥瑞娜'],
  '暗夜精靈': ['塞纳留斯', '泰兰德', '玛尔法里翁', '希尔瓦娜', '艾兰迪斯', '月影'],
  '侏儒': ['梅格斯', '齿轮', '费兹', '芬妮', '铆钉', '闪光'],
  '德萊尼': ['维伦', '亚拉', '诺玛德', '艾瑞达', '拉希尔', '玛尔卡'],
  '狼人': ['格雷迈恩', '洛娜', '达里安', '贝尔蒂', '库尔德', '艾薇丝'],
  '獸人': ['萨尔加', '德雷克塔尔', '加尔鲁什', '嗥风', '格罗姆', '玛戈拉'],
  '牛頭人': ['凯恩', '曼朵', '陶拉霍', '哈缪尔', '努拉', '磐角'],
  '巨魔': ['沃金', '赞吉', '扎拉', '洛坎', '蛇心', '暗矛'],
  '亡靈': ['纳萨诺斯', '莉亚德琳', '暗影', '腐骨', '枯叶', '亡魂'],
  '血精靈': ['洛瑟玛', '凯尔', '丽亚德琳', '罗曼斯', '奥利尔', '银月'],
  '地精': ['加兹鲁维', '诺格弗格', '热锻', '齿轮妹', '金币', '爆破'],
};

function randomNPCName(race) {
  const names = NPC_NAMES[race] || NPC_NAMES['人類'];
  return names[Math.floor(Math.random() * names.length)];
}

// 为单人玩家生成 NPC 队友
function generateCompanionParty(playerCharacter, campaign, count = 4) {
  const playerClass = playerCharacter.character?.class || playerCharacter.className;
  const playerFaction = playerCharacter.character?.faction || playerCharacter.faction;
  const playerLevel = playerCharacter.character?.level || playerCharacter.level || 1;

  const classInfo = CLASSES[campaign];
  if (!classInfo) return [];

  const races = RACES[campaign];
  if (!races) return [];

  // 找到同阵营的所有种族
  const factionRaces = [];
  for (const [id, r] of Object.entries(races)) {
    if (r.faction === playerFaction) {
      factionRaces.push(r);
    }
  }
  if (factionRaces.length === 0) return [];

  // 决定需要什么角色来补位
  const neededRoles = determineNeededRoles(playerClass, count);

  const companions = [];
  const usedNames = new Set();

  for (const neededClass of neededRoles) {
    // 找一个能用这个职业的种族
    const validRaces = factionRaces.filter(r => r.classes.includes(neededClass));
    if (validRaces.length === 0) continue;

    const raceData = validRaces[Math.floor(Math.random() * validRaces.length)];
    let name = randomNPCName(raceData.name);
    while (usedNames.has(name)) {
      name = randomNPCName(raceData.name);
    }
    usedNames.add(name);

    const npc = new NPCCompanion({
      name,
      race: raceData.name,
      raceData,
      className: neededClass,
      classData: classInfo[neededClass],
      level: playerLevel,
      campaign,
    });
    companions.push(npc);
  }

  return companions;
}

// 根据玩家职业决定需要补位的职业
function determineNeededRoles(playerClass, count) {
  // 基本阵容：1坦克 + 1治疗 + DPS 补满
  const tanks = ['戰士', '聖騎士', '德魯伊'];
  const healers = ['牧師', '聖騎士', '薩滿', '德魯伊'];
  const dps = ['法師', '盜賊', '獵人', '術士', '薩滿', '戰士'];

  const needed = [];
  let hasTank = tanks.includes(playerClass);
  let hasHealer = healers.includes(playerClass);

  // 先补坦克
  if (!hasTank) {
    const tank = tanks[Math.floor(Math.random() * tanks.length)];
    needed.push(tank);
    if (healers.includes(tank)) hasHealer = true;
  }

  // 再补治疗
  if (!hasHealer) {
    const healer = healers.filter(h => h !== playerClass && !needed.includes(h));
    needed.push(healer[Math.floor(Math.random() * healer.length)] || '牧師');
  }

  // 其余补 DPS（不重复玩家职业）
  while (needed.length < count) {
    const available = dps.filter(d => d !== playerClass && !needed.includes(d));
    if (available.length === 0) break;
    needed.push(available[Math.floor(Math.random() * available.length)]);
  }

  return needed;
}

module.exports = { NPCCompanion, generateCompanionParty, randomNPCName, getLabel, PERSONALITY_LABELS };
