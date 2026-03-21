/**
 * 結構化輸出解析器
 * 靈感來源：XianTu 強制 AI 輸出 JSON 的做法
 * 本項目適配：不強制 JSON（會破壞敘事流暢度），而是從自由文本中結構化提取
 *
 * 設計思路：
 * - AI 繼續輸出自然語言敘事（保持沉浸感）
 * - 解析器從回覆中自動提取結構化數據（狀態、選項、事件）
 * - 提取結果用於更新遊戲狀態和記憶引擎
 * - 比 relay.js 原有的 parseState() 更全面、更容錯
 */

/**
 * @typedef {Object} ParsedOutput
 * @property {Object} state - 解析出的狀態數據
 * @property {Object} options - 編號選項 { "1": "攻擊怪物", "2": "使用藥水" }
 * @property {string|null} battle - 戰鬥觸發標記 (如 "飢餓野狼x2")
 * @property {Object} events - 檢測到的事件 { combat, quest, levelUp, death, npcMeet, locationChange }
 * @property {string} narrative - 純敘事文字（去除狀態欄和選項後）
 */

/**
 * 從 AI 回覆中解析所有結構化數據
 * @param {string} text - AI 的原始回覆
 * @returns {ParsedOutput}
 */
function parseOutput(text) {
  if (!text) return { state: {}, options: {}, battle: null, events: {}, narrative: text };

  return {
    state: extractState(text),
    options: extractOptions(text),
    battle: extractBattle(text),
    events: detectEvents(text),
    narrative: extractNarrative(text)
  };
}

// ==================== 狀態提取 ====================

function extractState(text) {
  const state = {};

  // 基礎數值
  const patterns = {
    hp:       /HP:\s*(\d+)\s*\/\s*(\d+)/,
    ac:       /AC:\s*(\d+)/,
    gold:     /💰\s*(\d+)\s*g/,
    exp:      /EXP:\s*([\d,]+)\s*\/\s*([\d,]+)/,
    mp:       /MP:\s*(\d+)\s*\/\s*(\d+)/,
    level:    /Lv\.?(\d+)/,
    location: /📍\s*(.+?)[\n|]/,
  };

  for (const [key, pattern] of Object.entries(patterns)) {
    const match = text.match(pattern);
    if (match) {
      if (key === 'hp') { state.hp = match[1]; state.maxHp = match[2]; }
      else if (key === 'exp') { state.exp = match[1].replace(',', ''); state.expNext = match[2].replace(',', ''); }
      else if (key === 'mp') { state.mp = match[1]; state.maxMp = match[2]; }
      else if (key === 'location') { state.location = match[1].trim(); }
      else { state[key] = match[1]; }
    }
  }

  // 角色名（多種格式容錯）
  const namePatterns = [
    /👤\s*(.+?)\s*[\[【]/,
    /\*\*(.+?)\*\*\s*[\[【]/,
  ];
  for (const p of namePatterns) {
    const m = text.match(p);
    if (m) { state.name = m[1].trim(); break; }
  }

  // 裝備和物品（整行提取）
  const equipMatch = text.match(/裝備[：:]\s*(.+)/);
  if (equipMatch) state.equipment = equipMatch[1].trim();

  const itemMatch = text.match(/物品[：:]\s*(.+)/);
  if (itemMatch) state.items = itemMatch[1].trim();

  // MH 專用：力盡次數
  const cartMatch = text.match(/力盡次數[：:]\s*(\d+)\s*\/\s*3/);
  if (cartMatch) state.cartCount = cartMatch[1];

  // MH 專用：武器
  const weaponMatch = text.match(/\[(.+?)\s+Lv/);
  if (weaponMatch) state.weapon = weaponMatch[1];

  return state;
}

// ==================== 選項提取 ====================

function extractOptions(text) {
  const options = {};
  // 匹配多種選項格式：1. / 1、/ 1) / 1:
  const matches = text.matchAll(/^\s*(\d+)\s*[.、):：]\s*(.+)/gm);
  for (const m of matches) {
    const num = m[1];
    const content = m[2].trim();
    // 過濾掉可能的誤匹配（如日期、數值等）
    if (content.length > 1 && content.length < 100 && !content.match(/^\d+[g金幣%]/)) {
      options[num] = content;
    }
  }
  return options;
}

// ==================== 戰鬥觸發提取 ====================

function extractBattle(text) {
  const match = text.match(/\[BATTLE:(.+?)\]/);
  return match ? match[1] : null;
}

// ==================== 事件檢測 ====================

/**
 * 檢測回覆中發生了哪些重要事件
 * 用於觸發記憶引擎的記錄
 */
function detectEvents(text) {
  return {
    combat: !!(text.match(/\[BATTLE:/) || text.match(/戰鬥結束|擊殺|💀|勝利/)),
    quest: !!text.match(/✅|任務完成|獲得.*EXP/),
    levelUp: !!text.match(/升級|Lv\.?\d+\s*→\s*Lv\.?\d+|LEVEL UP/i),
    death: !!text.match(/你倒下了|力盡|HP.*0\/|陣亡/),
    npcMeet: !!text.match(/\[NPC\]|「.{5,}」/), // NPC 標記或長對話
    locationChange: !!text.match(/抵達|進入|來到|📍/),
    itemGet: !!text.match(/獲得[：:]|掉落[：:]/),
    shop: !!text.match(/購買|賣出|商店|商人/),
  };
}

// ==================== 敘事提取 ====================

/**
 * 從回覆中提取純敘事文字（去除狀態欄、選項、戰鬥標記）
 * 用於記憶引擎的摘要
 */
function extractNarrative(text) {
  let narrative = text;

  // 移除戰鬥標記
  narrative = narrative.replace(/\[BATTLE:.+?\]/g, '');

  // 移除狀態欄（通常在末尾幾行，包含 HP/AC/金幣等）
  narrative = narrative.replace(/👤.+?(?=\n\d+[.、]|\n*$)/gs, '');

  // 移除編號選項
  narrative = narrative.replace(/^\s*\d+[.、]:?\s*.+$/gm, '');

  return narrative.trim();
}

// ==================== 輸出後處理 ====================

/**
 * 確保回覆包含編號選項（Gemini 經常忘記）
 * 從 relay.js 的 ensureOptions 遷移過來
 * @param {string} text - AI 原始回覆
 * @returns {string} 處理後的回覆
 */
function ensureOptions(text) {
  const options = extractOptions(text);
  if (Object.keys(options).length > 0) return text;

  // 沒有選項，根據場景上下文附加合適的選項
  const isBattle = /HP:.*\/|攻擊|傷害|戰鬥|命中/.test(text);
  const isVillage = /村莊|集落|鍛冶|商店|貓飯|旅館|客棧/.test(text);
  const isShop = /雜貨店|購買|商店|💰.*\d+g/.test(text);

  if (isBattle) {
    return text + '\n\n1. 攻擊\n2. 使用技能\n3. 使用物品\n4. 撤退';
  } else if (isShop) {
    return text + '\n\n1. 購買物品\n2. 出售物品\n3. 離開商店';
  } else if (isVillage) {
    return text + '\n\n1. 前往商店\n2. 休息恢復\n3. 接受任務\n4. 查看裝備';
  } else {
    return text + '\n\n1. 繼續前進\n2. 調查周圍\n3. 使用物品\n4. 返回';
  }
}

/**
 * 清理 AI 輸出中的常見問題
 * @param {string} text - AI 原始回覆
 * @returns {string} 清理後的回覆
 */
function cleanOutput(text) {
  if (!text) return '';

  // 移除 Gemini 偶爾產生的 markdown 代碼塊包裹
  text = text.replace(/^```(?:json|markdown)?\n?/gm, '');
  text = text.replace(/\n?```$/gm, '');

  // 移除 <thinking> 標籤（某些模型會產生）
  text = text.replace(/<thinking>[\s\S]*?<\/thinking>/g, '');

  // 移除重複的空行
  text = text.replace(/\n{3,}/g, '\n\n');

  return text.trim();
}

module.exports = {
  parseOutput,
  extractState,
  extractOptions,
  extractBattle,
  detectEvents,
  extractNarrative,
  ensureOptions,
  cleanOutput
};
