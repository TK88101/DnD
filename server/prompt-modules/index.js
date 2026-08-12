/**
 * 提示詞模組化管理系統
 * 靈感來源：XianTu 的模組化 prompt 架構
 * 適配本項目：代碼控制規則，AI 只做敘事
 *
 * 設計原則：
 * - 每個模組是一個獨立的規則單元，有權重、類別、啟用條件
 * - assemblePrompt() 根據當前上下文動態組裝最終 system prompt
 * - 修改規則不需要碰 relay.js，只需改模組文件
 */

const fs = require('fs');
const path = require('path');

// ==================== 提示詞模組定義 ====================

/**
 * 所有提示詞模組
 * weight: 1-10，越高越靠前（AI 更重視靠前的指令）
 * category: core | format | combat | narrative | campaign
 * condition: (context) => boolean，決定此模組是否啟用
 */
const PROMPT_MODULES = [

  // ===== 核心規則（weight 10，永遠啟用）=====
  {
    id: 'core-identity',
    category: 'core',
    weight: 10,
    condition: () => true,
    content: (ctx) => `你是一個龍與地下城（D&D）的地下城主（DM）。${ctx.langInstruction}
你必須 100% 嚴格按照遊戲資料文件運行遊戲。絕對不要自行編造種族、職業、技能、敵人、物品等數據。`
  },

  {
    id: 'core-combat-delegation',
    category: 'core',
    weight: 10,
    condition: () => true,
    content: () => `【戰鬥觸發規則 — 最重要】
- 你不再負責執行戰鬥判定！所有骰子、傷害、HP 由服務器代碼處理
- 當劇情中出現戰鬥遭遇時，你必須在回覆最後一行加上：[BATTLE:怪物名x數量,怪物名x數量]
- 怪物名必須與 enemies.md 中的名稱完全一致
- 觸發標記前正常寫劇情描述，但不要寫戰鬥過程
- 【絕對禁止】自己模擬擲骰或計算傷害`
  },

  // ===== 格式規則（weight 9）=====
  {
    id: 'format-output',
    category: 'format',
    weight: 9,
    condition: () => true,
    content: () => `【輸出格式規範】
- 場景描述用沉浸式第二人稱
- NPC 對話用「」標記
- 角色名字用 **角色名** 粗體標記
- NPC 隊友名字前加 [NPC] 前綴
- 絕對不要擅自修改玩家的名字`
  },

  {
    id: 'format-options',
    category: 'format',
    weight: 9,
    condition: () => true,
    content: () => `【選項規則 — 每次回覆必須遵守】
- 每次回覆結尾必須是編號選項（1、2、3...）
- 回覆的最後一行必須是編號選項，不能是描述文字
- 玩家輸入的數字對應你上次回覆中同編號的選項
- 不能替換、不能跳號、不能混淆`
  },

  {
    id: 'format-status-bar',
    category: 'format',
    weight: 8,
    condition: () => true,
    content: () => `【狀態欄規則】
- 每次回覆結尾（選項之前）顯示狀態欄
- 必須精確追蹤金幣、HP、MP、物品的變化
- 狀態欄必須顯示完整的物品清單，獲得或消耗後立即更新
- 法術型職業必須顯示 MP
- 格式範例：
  👤 角色名 [種族/職業] Lv5 | HP: 25/30 | AC: 14 | 💰 50g
  EXP: 200/500 | 📍 十字路口
  裝備：鐵劍(1d8) | 物品：治療藥水x2`
  },

  // ===== 敘事規則（weight 7）=====
  {
    id: 'narrative-immersion',
    category: 'narrative',
    weight: 7,
    condition: () => true,
    content: () => `【敘事品質要求】
- 場景描述要有感官細節（視覺、聽覺、嗅覺）
- NPC 要有個性化的說話方式
- 戰鬥描述要有動態感和緊張感
- 世界不以玩家為中心——NPC 有自己的事務和動機`
  },

  // ===== 任務與升級（weight 8）=====
  {
    id: 'quest-progression',
    category: 'core',
    weight: 8,
    condition: () => true,
    content: () => `【任務與升級規則】
- 完成任務時立即顯示獎勵明細：✅ 任務完成！獲得 [X] EXP、[Y]g、[物品名]
- 狀態欄顯示 EXP / 下一級所需 EXP
- EXP 達標時立即觸發升級流程（擲 HP 骰、解鎖技能、天賦點）
- 完成任務後根據 quests.md 的「後續」欄位引導下一任務
- 每次移動到新區域按隨機遭遇規則擲骰`
  },

  // ===== 動態難度（weight 8，多人時啟用）=====
  {
    id: 'difficulty-scaling',
    category: 'core',
    weight: 8,
    condition: (ctx) => ctx.playerCount > 1,
    content: (ctx) => {
      const table = {
        1: { hp: 0.5, atk: -2 }, 2: { hp: 0.8, atk: -1 },
        3: { hp: 1.0, atk: 0 },  4: { hp: 1.3, atk: 1 },
        5: { hp: 1.6, atk: 2 },  6: { hp: 2.0, atk: 3 },
        7: { hp: 2.5, atk: 3 },  8: { hp: 3.0, atk: 4 },
      };
      const d = table[Math.min(Math.max(ctx.playerCount, 1), 8)];
      return `【動態難度】隊伍 ${ctx.playerCount} 人：怪物 HP ×${d.hp}，攻擊 ${d.atk >= 0 ? '+' : ''}${d.atk}。代碼計算值，不可自行調整。`;
    }
  },

  // ===== 戰役專屬（按戰役條件啟用）=====
  {
    id: 'campaign-warcraft',
    category: 'campaign',
    weight: 6,
    condition: (ctx) => ctx.campaign === 'warcraft',
    content: () => `【魔獸戰役專屬規則】
- 職業技能和天賦嚴格按 classes.md 執行，基於經典舊世 1.12 版本
- 召喚物（小鬼/虛空行者等）在玩家回合自動行動，不佔玩家動作
- 套裝效果按 tier-sets.md 中的件數觸發
- Boss 設計必須有反制機制（驅散 DOT、集火召喚物、法術免疫階段等）`
  },

  {
    id: 'campaign-monsterhunter',
    category: 'campaign',
    weight: 6,
    condition: (ctx) => ctx.campaign === 'monsterhunter',
    content: () => `【怪物獵人戰役專屬規則】
- 使用貓車機制，不使用 D&D 瀕死豁免
- 力盡 3 次 = 任務失敗
- 戰鬥為狩獵模式：弱點破壞、陷阱捕獲、素材剝取
- 沒有等級制度，裝備決定戰力`
  },

  {
    id: 'campaign-cthulhu',
    category: 'campaign',
    weight: 6,
    condition: (ctx) => ctx.campaign === 'cthulhu',
    content: () => `【克蘇魯戰役專屬規則】
- 理智值（SAN）系統：遭遇超自然事件消耗 SAN
- SAN 歸零 = 永久瘋狂
- 戰鬥是最後手段，調查和推理為主
- 1920 年代背景，沒有魔法`
  },

  {
    id: 'campaign-bloodborne',
    category: 'campaign',
    weight: 6,
    condition: (ctx) => ctx.campaign === 'bloodborne',
    content: () => `【血源戰役專屬規則】
- 哥特恐怖氛圍
- 變形武器系統
- 血瓶回復機制
- 死亡 = 在夢境中醒來，不永久死亡但有代價`
  },
];

// ==================== 組裝引擎 ====================

/**
 * 組裝最終的 system prompt
 * @param {Object} context - 當前上下文
 * @param {string} context.campaign - 戰役名 (warcraft/monsterhunter/cthulhu/bloodborne)
 * @param {string} context.langInstruction - 語言指令
 * @param {number} context.playerCount - 玩家人數
 * @param {string} context.gameData - 載入的遊戲資料文件內容
 * @returns {string} 組裝後的完整 system prompt
 */
function assemblePrompt(context) {
  // 1. 過濾：只保留條件滿足的模組
  const active = PROMPT_MODULES.filter(m => m.condition(context));

  // 2. 排序：weight 高的在前
  active.sort((a, b) => b.weight - a.weight);

  // 3. 組裝：每個模組生成內容，用分隔線連接
  const sections = active.map(m => {
    const content = typeof m.content === 'function' ? m.content(context) : m.content;
    return content;
  });

  // 4. 附加遊戲資料
  if (context.gameData) {
    sections.push(`【遊戲資料文件（必須嚴格遵循）】\n${context.gameData}`);
  }

  return sections.join('\n\n');
}

/**
 * 列出當前啟用的模組（用於調試）
 */
function listActiveModules(context) {
  return PROMPT_MODULES
    .filter(m => m.condition(context))
    .sort((a, b) => b.weight - a.weight)
    .map(m => `[${m.weight}] ${m.id} (${m.category})`);
}

/**
 * 取得特定模組的內容（用於單獨查看/測試）
 */
function getModuleContent(moduleId, context) {
  const mod = PROMPT_MODULES.find(m => m.id === moduleId);
  if (!mod) return null;
  return typeof mod.content === 'function' ? mod.content(context) : mod.content;
}

module.exports = { assemblePrompt, listActiveModules, getModuleContent, PROMPT_MODULES };
