// 副本模式分层系统
// 单人5人本：可纯 Solo(×0.5+取消配合机制) 或 NPC 队友(标准难度)
// 满级团本：单人必须带 NPC，多人 5-8 人弹性
// 多人：统一 5-8 人弹性缩放

const DUNGEON_MODES = {
  SOLO: 'solo',           // 纯单人（5人本限定）
  NPC_TEAM: 'npc_team',   // 单人 + NPC 队友
  MULTIPLAYER: 'multiplayer', // 多人
};

const DUNGEON_TYPES = {
  NORMAL: 'normal',  // 5人副本（升级阶段）
  RAID: 'raid',      // 满级团队副本
};

// 副本进入检查
function validateDungeonEntry({ dungeonType, mode, playerCount, playerLevel, requiredLevel }) {
  const errors = [];

  // 满级团本不可纯 Solo
  if (dungeonType === DUNGEON_TYPES.RAID && mode === DUNGEON_MODES.SOLO) {
    errors.push('满级团队副本不可纯 Solo，必须与 NPC 队友组队或多人进入。');
  }

  // 多人模式至少 5 人才能进团本
  if (dungeonType === DUNGEON_TYPES.RAID && mode === DUNGEON_MODES.MULTIPLAYER && playerCount < 5) {
    errors.push(`团队副本至少需要 5 名玩家（当前 ${playerCount} 人）。`);
  }

  // 多人上限 8 人
  if (mode === DUNGEON_MODES.MULTIPLAYER && playerCount > 8) {
    errors.push(`副本最多支持 8 名玩家（当前 ${playerCount} 人）。`);
  }

  // 等级检查
  if (requiredLevel && playerLevel < requiredLevel) {
    errors.push(`等级不足（需要 ${requiredLevel} 级，当前 ${playerLevel} 级）。`);
  }

  return { valid: errors.length === 0, errors };
}

// 副本难度缩放
function getDungeonDifficulty({ dungeonType, mode, playerCount }) {
  // 纯 Solo 5人副本：×0.5 血量，取消配合机制
  if (mode === DUNGEON_MODES.SOLO) {
    return {
      hpMult: 0.5,
      atkMod: -2,
      disableCoopMechanics: true, // 取消需要多人配合的机制
      lootMult: 1.0,              // loot 不缩减
      label: '单人挑战模式',
    };
  }

  // NPC 队友模式：标准难度
  if (mode === DUNGEON_MODES.NPC_TEAM) {
    return {
      hpMult: 1.0,
      atkMod: 0,
      disableCoopMechanics: false,
      lootMult: 1.0,
      label: 'NPC 队友模式',
    };
  }

  // 多人模式：5人基准，6-8人递增缩放
  const scaling = getMultiplayerScaling(playerCount);
  return {
    ...scaling,
    disableCoopMechanics: false,
    label: `${playerCount} 人团队模式`,
  };
}

// 多人缩放表（5人基准）
function getMultiplayerScaling(playerCount) {
  const table = {
    1: { hpMult: 0.5, atkMod: -2, lootMult: 1.0 },
    2: { hpMult: 0.7, atkMod: -1, lootMult: 1.0 },
    3: { hpMult: 0.85, atkMod: 0, lootMult: 1.0 },
    4: { hpMult: 0.95, atkMod: 0, lootMult: 1.0 },
    5: { hpMult: 1.0, atkMod: 0, lootMult: 1.0 },
    6: { hpMult: 1.15, atkMod: 1, lootMult: 1.15 },
    7: { hpMult: 1.30, atkMod: 2, lootMult: 1.25 },
    8: { hpMult: 1.45, atkMod: 3, lootMult: 1.35 },
  };
  const clamped = Math.min(Math.max(playerCount, 1), 8);
  return table[clamped];
}

// 副本模式选择菜单（单人专用）
function dungeonModeMenu(dungeonName, dungeonType, playerLevel) {
  let text = `\n═══════════════════════════════════════\n`;
  text += `  副本：${dungeonName}\n`;
  text += `───────────────────────────────────────\n`;

  if (dungeonType === DUNGEON_TYPES.RAID) {
    text += `  这是满级团队副本，必须与 NPC 队友组队。\n\n`;
    text += `  1. 与 NPC 队友组队进入\n`;
    text += `  0. 返回\n`;
  } else {
    text += `  选择进入方式：\n\n`;
    text += `  1. 纯 Solo 挑战（难度降低，取消配合机制）\n`;
    text += `  2. 与 NPC 队友组队（标准难度）\n`;
    text += `  0. 返回\n`;
  }

  text += `───────────────────────────────────────`;
  return text;
}

// NPC 队友组队信息
function companionPartyInfo(companions) {
  if (!companions || companions.length === 0) return '';

  let text = `\n═══════════════════════════════════════\n`;
  text += `  NPC 队友信息\n`;
  text += `───────────────────────────────────────\n`;

  for (const npc of companions) {
    const tDesc = npc.temperament <= 3 ? '沉稳' : npc.temperament >= 7 ? '冲动' : '普通';
    const sDesc = npc.stance <= 3 ? '自利' : npc.stance >= 7 ? '重义' : '普通';
    text += `  [NPC]${npc.name} — ${npc.race} ${npc.className}\n`;
    text += `    HP: ${npc.hp}/${npc.maxHp} | AC: ${npc.ac}`;
    if (npc.mp !== undefined) text += ` | MP: ${npc.mp}/${npc.maxMp}`;
    text += `\n`;
    text += `    性格：${tDesc}(${npc.temperament}) / ${sDesc}(${npc.stance})\n`;
  }

  text += `───────────────────────────────────────\n`;
  return text;
}

module.exports = {
  DUNGEON_MODES,
  DUNGEON_TYPES,
  validateDungeonEntry,
  getDungeonDifficulty,
  getMultiplayerScaling,
  dungeonModeMenu,
  companionPartyInfo,
};
