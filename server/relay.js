const WebSocket = require('ws');
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const { CharacterCreator, attackRoll, skillCheck, roll, modifier, d20, getSkillsForLevel, proficiencyBonus, calculateMP, SUMMONS } = require('./game-engine');
const { CombatSession, EncounterGenerator } = require('./combat-engine');
const { parseEnemiesFile } = require('./monster-parser');

const PORT = process.env.PORT || 8080;
const MULTIPLAYER_DIR = path.join(__dirname, '..', 'multiplayer');
const GAME_DIR = path.join(__dirname, '..');
const AFK_TIMEOUT = 60000; // 60 秒無操作標記為暫離

// === Gemini AI 初始化 ===
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
if (!GEMINI_API_KEY) {
  console.error('錯誤：未設定 GEMINI_API_KEY 環境變量');
  process.exit(1);
}
const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);

// 載入遊戲規則文件作為系統提示
function loadGameContext(campaign) {
  const files = ['game.md', 'rules/core.md'];
  if (campaign) {
    const ruleFile = `rules/${campaign}.md`;
    if (fs.existsSync(path.join(GAME_DIR, ruleFile))) files.push(ruleFile);

    const campaignDir = `campaigns/${campaign}`;
    const campaignFiles = ['world.md', 'races.md', 'backgrounds.md', 'classes.md',
      'npcs.md', 'enemies.md', 'items.md', 'quests.md'];
    for (const f of campaignFiles) {
      const fp = path.join(GAME_DIR, campaignDir, f);
      if (fs.existsSync(fp)) files.push(`${campaignDir}/${f}`);
    }
  }

  let context = '';
  for (const f of files) {
    const fp = path.join(GAME_DIR, f);
    if (fs.existsSync(fp)) {
      context += `\n\n=== ${f} ===\n` + fs.readFileSync(fp, 'utf8');
    }
  }
  return context;
}

// 載入副本文件
function loadDungeon(campaign, dungeonId) {
  const dungeonDir = path.join(GAME_DIR, 'campaigns', campaign, 'dungeons');
  if (!fs.existsSync(dungeonDir)) return '';
  const files = fs.readdirSync(dungeonDir).filter(f => f.endsWith('.md'));
  for (const f of files) {
    if (f.replace('.md', '') === dungeonId) {
      return '\n\n=== 當前副本 ===\n' + fs.readFileSync(path.join(dungeonDir, f), 'utf8');
    }
  }
  return '';
}

// === 代碼控制的商店系統 ===
const SHOP_ITEMS = {
  monsterhunter: [
    { name: '回復藥', price: 5, desc: '回復 1d8 HP' },
    { name: '大回復藥', price: 15, desc: '回復 2d8+5 HP' },
    { name: '解毒藥', price: 3, desc: '解除中毒' },
    { name: '強走藥', price: 10, desc: '攻擊+2，3回合' },
    { name: '鬼人藥', price: 25, desc: '攻擊+3，5回合' },
    { name: '硬化藥', price: 10, desc: 'AC+2，3回合' },
    { name: '閃光彈', price: 15, desc: '致盲1回合（DC13 CON）' },
    { name: '音爆彈', price: 10, desc: '暈眩飛行/鑽地怪1回合' },
    { name: '陷阱（落穴）', price: 20, desc: '固定大型怪物2回合' },
    { name: '陷阱（麻痺）', price: 25, desc: '麻痺大型怪物1回合' },
    { name: '捕獲用麻醉球', price: 30, desc: '捕獲瀕死怪物（HP≤25%）' },
    { name: '大桶爆彈', price: 30, desc: '3d6火焰傷害' },
    { name: '生命粉塵', price: 20, desc: '全隊回復1d6 HP' },
  ],
  warcraft: [
    { name: '小型治療藥水', price: 5, desc: '回復 1d8 HP' },
    { name: '中型治療藥水', price: 15, desc: '回復 2d8+5 HP' },
    { name: '大型治療藥水', price: 40, desc: '回復 4d8+10 HP' },
    { name: '小型法力藥水', price: 8, desc: '回復 15 MP' },
    { name: '中型法力藥水', price: 20, desc: '回復 30 MP' },
    { name: '大型法力藥水', price: 50, desc: '回復 50 MP' },
    { name: '解毒藥劑', price: 5, desc: '解除中毒' },
    { name: '繃帶', price: 2, desc: '脫戰後回復 1d6 HP' },
  ],
};
// cthulhu 和 bloodborne 可後續補充
SHOP_ITEMS.cthulhu = SHOP_ITEMS.warcraft;
SHOP_ITEMS.bloodborne = SHOP_ITEMS.warcraft;

function shopMenu(campaign, gold) {
  const items = SHOP_ITEMS[campaign] || SHOP_ITEMS.warcraft;
  let text = `\n═══════════════════════════════════════\n  🛒 雜貨店\n  💰 你的金幣：${gold}g\n───────────────────────────────────────\n`;
  items.forEach((item, i) => {
    const affordable = gold >= item.price ? '' : ' ❌';
    text += `  ${i + 1}. ${item.name}（${item.price}g）— ${item.desc}${affordable}\n`;
  });
  text += `  0. 離開商店\n───────────────────────────────────────\n輸入編號購買：`;
  return text;
}

function shopBuy(campaign, itemIdx, gameState) {
  const items = SHOP_ITEMS[campaign] || SHOP_ITEMS.warcraft;
  if (itemIdx < 1 || itemIdx > items.length) return { ok: false, text: '⚠ 無效的編號。' };
  const item = items[itemIdx - 1];
  const gold = parseInt(gameState.gold) || 0;
  if (gold < item.price) return { ok: false, text: `⚠ 金幣不足！${item.name} 需要 ${item.price}g，你只有 ${gold}g。` };

  // 扣錢
  gameState.gold = String(gold - item.price);

  // 更新物品欄
  const itemList = gameState.items || '';
  const regex = new RegExp(`${item.name}x(\\d+)`);
  const match = itemList.match(regex);
  if (match) {
    const newCount = parseInt(match[1]) + 1;
    gameState.items = itemList.replace(regex, `${item.name}x${newCount}`);
  } else {
    gameState.items = itemList ? itemList + `、${item.name}x1` : `${item.name}x1`;
  }

  return { ok: true, text: `✅ 購買了 ${item.name} ×1（-${item.price}g）\n💰 剩餘金幣：${gameState.gold}g` };
}

// 後處理：確保 Gemini 回覆包含編號選項
function ensureOptions(text) {
  const lines = text.trim().split('\n');
  const lastLines = lines.slice(-8);
  const hasOptions = lastLines.some(line => /^\s*\d+[\.\、\s]/.test(line.trim()));
  if (!hasOptions) {
    // Gemini 忘記給選項了，根據內容自動補上
    const isBattle = /HP:.*\/|攻擊|傷害|戰鬥|命中/.test(text);
    const isVillage = /村莊|集落|鍛冶|商店|貓飯/.test(text);
    if (isBattle) {
      text += '\n\n1. 攻擊\n2. 使用技能\n3. 使用物品\n4. 撤退';
    } else if (isVillage) {
      text += '\n\n1. 前往鍛冶屋\n2. 前往雜貨店\n3. 吃貓飯\n4. 接受任務\n5. 查看裝備';
    } else {
      text += '\n\n1. 繼續前進\n2. 調查周圍\n3. 使用物品\n4. 返回村莊';
    }
  }
  return text;
}

// 每個房間的 AI 對話管理
class GameSession {
  constructor(roomId) {
    this.roomId = roomId;
    this.campaign = null;
    this.history = [];
    this.chat = null;
    this.gameState = null; // 外掛記憶體
    this.lastOptions = {};
    this.saveData = null;
    this.lang = 'zh'; // 語言設定
  }

  async init(campaign) {
    this.campaign = campaign;
    const systemPrompt = loadGameContext(campaign);
    const LANG_INSTRUCTION = {
      zh: '使用繁體中文回覆。',
      en: 'Respond in English. All narration, dialogue, options, and status bars must be in English.',
      ja: '日本語で回答してください。ナレーション、会話、選択肢、ステータスバーはすべて日本語で。',
    };
    const langInst = LANG_INSTRUCTION[this.lang] || LANG_INSTRUCTION.zh;
    const model = genAI.getGenerativeModel({
      model: 'gemini-2.5-flash',
      systemInstruction: `你是一個龍與地下城（D&D）的地下城主（DM）。${langInst}

【最重要規則】你必須 100% 嚴格按照下方提供的遊戲資料文件來運行遊戲。絕對不要自行編造種族、職業、技能、敵人、物品等數據。所有數據必須來自下方文件。如果文件中有12個種族，你就必須展示12個種族，一個都不能少，也不能改動屬性加成。

【格式規範】
- 使用繁體中文
- 場景描述用沉浸式第二人稱
- 戰鬥數據用格式化區塊
- NPC對話用「」標記
- 角色名字用 **角色名** 標記（粗體）
- 每次掷骰顯示完整過程：🎲 d20(結果) + 加值 = 總計 vs 目標 → 結果
- 每次回覆結尾顯示狀態欄
- 【絕對規則 — 違反此規則等於系統崩潰】每一次回覆的最後幾行必須是編號選項（1、2、3...），無論任何情境都不例外。回覆的最後一行必須是一個編號選項，不能是描述文字。格式範例：
  1. 攻擊怪物
  2. 使用回復藥
  3. 撤退
  如果你的回覆結尾不是編號選項列表，這個回覆就是錯誤的。重新檢查並補上選項
- 絕對不要擅自修改玩家或角色的名字，「一橋」就是「一橋」，不能寫成「1橋」或其他變體，必須始終使用玩家創建時的原始名字
- NPC隊友的名字前必須加上 [NPC] 標記，例如 [NPC]吉安娜、[NPC]薩爾
- 狀態欄中必須明確區分玩家角色和NPC隊友，NPC名字始終帶 [NPC] 前綴
- 必須精確追蹤金幣、HP、MP、物品的變化，每次交易或戰鬥後狀態欄必須反映正確的數值（例如：花了3g買藥水，原本5g則顯示2g）
- 狀態欄必須始終顯示完整的物品/素材清單（例如：物品：回復藥x3、賊龍鱗片x2、賊龍爪x1），獲得或消耗物品後立即更新，不能省略
- 法術型職業必須顯示 MP，施放技能後 MP 要正確扣除，脫戰後逐漸恢復
- 召喚類技能（如召喚小鬼）是持續性的，可以在戰前施放，不佔戰鬥回合

【戰鬥規則 — 每次戰鬥行動必須嚴格執行】
- 玩家選擇攻擊或使用技能時，你必須立刻執行完整的攻擊判定流程，不能只描述「觀察」或「思考」然後重複給同樣的選項
- 攻擊判定流程（每次必須完整執行）：
  1. 掷攻擊骰：🎲 d20(結果) + 攻擊調整值 = 總計
  2. 對比目標 AC：總計 ≥ AC → 命中，否則未命中
  3. 命中則掷傷害骰：武器/技能傷害骰 + 屬性調整值 = 傷害
  4. 扣除目標 HP，顯示剩餘 HP
  5. 自然20 = 暴擊（傷害骰翻倍），自然1 = 失手
- 怪物的回合也必須執行攻擊判定（掷骰 → 對比玩家 AC → 算傷害 → 扣 HP）
- 禁止跳過攻擊判定！玩家選了攻擊就必須掷骰算傷害，不能用「你仔細觀察」「你思考下一步」之類的描述來拖延
- 【絕對禁止】玩家輸入的數字對應你上一次回覆中同編號的選項。玩家輸入「11」就是執行你列出的第 11 項，不是第 10 項也不是第 12 項。你必須回頭核對自己上次列出的選項內容，嚴格按編號執行對應的那一項。不能替換、不能跳號、不能混淆。如果你給了 11. 捕獲用麻醉球(30g)，玩家輸入 11，你就必須賣捕獲用麻醉球並扣 30g，不能賣別的東西
- 每回合結構：玩家行動 → 執行判定 → 怪物行動 → 執行判定 → 更新狀態欄 → 給出新選項
- 怪物 HP 必須在戰鬥中持續追蹤並顯示（例如：土砂龍 HP: 45/75）
- MH 戰役：獵人 HP 歸零 = 立刻貓車（見 rules/monsterhunter.md），不要進入瀕死狀態
- MH 戰役貓車後：獵人滿血復活，但怪物不回血！怪物 HP 和部位破壞保持貓車前的狀態不變

【任務與升級規則 — 必須嚴格執行】
- 完成任務時必須立即顯示獎勵明細：「✅ 任務完成！獲得 [X] EXP、[Y]g、[物品名]」
- 狀態欄必須顯示當前 EXP / 下一級所需 EXP（例如：EXP: 100/300）
- 當累計 EXP 達到升級門檻時，必須立即觸發升級流程（擲 HP 骰、解鎖技能、天賦點等），不能跳過
- 戰鬥結束後必須給予對應的 EXP（根據 enemies.md 中敵人的 EXP 值）
- 完成當前任務後，必須根據 quests.md 中的「後續」欄位自動引導玩家進入下一個主線任務
- 如果玩家等級不足以接下一個主線任務，引導玩家做支線任務或野外探索來補經驗
- 每次移動到新區域時，按 core.md 的隨機遭遇規則掷 d20 決定是否觸發遭遇
- 野外戰鬥的敵人等級必須與當前區域等級匹配，不能太強也不能太弱

【動態難度調整 — 根據隊伍人數自動縮放】
- 所有怪物/Boss 的數值必須根據當前隊伍人數動態調整：
  - 1 人：HP ×0.5，攻擊 -2（單人友好）
  - 2 人：HP ×0.8，攻擊 -1
  - 3 人：HP ×1.0，攻擊 ±0（標準基準）
  - 4 人：HP ×1.3，攻擊 +1
  - 5 人：HP ×1.6，攻擊 +2
  - 6-8 人（團本）：HP ×2.0-3.0，攻擊 +3-4
- 副本/團本的人數建議標記在任務描述中，但不足人數時怪物自動下調，不會導致無法通關
- 掉落素材數量隨人數增加：每多一人 +1 份基礎素材掉落

【遊戲資料文件（必須嚴格遵循）】
${systemPrompt}`
    });
    this.chat = model.startChat({ history: this.history });

    // Load monster database for this campaign
    if (!monsterDatabases.has(campaign)) {
      const db = parseEnemiesFile(campaign);
      if (db.size > 0) {
        monsterDatabases.set(campaign, db);
        console.log(`[怪物DB] ${campaign}: ${db.size} 種怪物已載入`);
      }
    }
  }

  async send(message) {
    if (!this.chat) {
      // 還沒選戰役，先用基礎模式
      const model = genAI.getGenerativeModel({
        model: 'gemini-2.5-flash',
        systemInstruction: `你是一個龍與地下城遊戲的DM。使用繁體中文。玩家正在選擇戰役。必須嚴格按照下方遊戲資料展示三個戰役選項。不要自行編造內容。\n\n` + loadGameContext(null)
      });
      this.chat = model.startChat({ history: this.history });
    }
    // 玩家輸入數字 → 查表轉換成明確文字指令（防止 Gemini 搞混編號）
    const playerInputMatch = message.match(/\[玩家 .+?\]: (\d+)$/);
    if (playerInputMatch && this.lastOptions[playerInputMatch[1]]) {
      const num = playerInputMatch[1];
      const optionText = this.lastOptions[num];
      message = message.replace(/: \d+$/, `: ${num}（即：${optionText}）`);
      console.log(`[選項轉換] ${num} → ${optionText}`);
    }

    // 注入外掛記憶體（含難度倍率）
    const stateCtx = this.getStateContext(this._playerCount || 1);
    if (stateCtx) message = stateCtx + '\n' + message;

    // 30 秒超時保護
    const timeoutPromise = new Promise((_, reject) =>
      setTimeout(() => reject(new Error('Gemini API 超時（30秒）')), 30000)
    );
    const result = await Promise.race([this.chat.sendMessage(message), timeoutPromise]);
    let text = result.response.text();
    // Gemini SDK 的 sendMessage 已自動將 user/model 追加到 this.history（共享引用）
    // 不需要手動 push，否則會重複

    // 後處理：確保回覆包含編號選項（Gemini 經常忘記）
    text = ensureOptions(text);

    // 從回覆中解析遊戲狀態，更新外掛記憶體
    this.parseState(text);

    // 升級檢測（純代碼，不依賴 Gemini）
    const levelUpText = this.checkLevelUp();
    if (levelUpText) text += '\n\n' + levelUpText;

    // 裁剪歷史：只保留最近 10 輪對話（20 條 message）
    const MAX_MESSAGES = 20;
    if (this.history.length > MAX_MESSAGES + 2) {
      const first = this.history.slice(0, 2); // 角色創建資訊
      const recent = this.history.slice(-MAX_MESSAGES);
      this.history.length = 0;
      this.history.push(...first, ...recent);
    }

    return text;
  }

  // 從 Gemini 回覆中解析狀態欄，更新外掛記憶體
  parseState(text) {
    if (!text) return;
    const state = this.gameState || {};

    const hpMatch = text.match(/HP:\s*(\d+)\/(\d+)/);
    if (hpMatch) { state.hp = hpMatch[1]; state.maxHp = hpMatch[2]; }

    const acMatch = text.match(/AC:\s*(\d+)/);
    if (acMatch) state.ac = acMatch[1];

    const goldMatch = text.match(/💰\s*(\d+)g/);
    if (goldMatch) state.gold = goldMatch[1];

    const expMatch = text.match(/EXP:\s*([\d,]+)\/([\d,]+)/);
    if (expMatch) { state.exp = expMatch[1]; state.expNext = expMatch[2]; }

    const locMatch = text.match(/📍\s*(.+)/);
    if (locMatch) state.location = locMatch[1].trim();

    const itemMatch = text.match(/物品：(.+)/);
    if (itemMatch) state.items = itemMatch[1].trim();

    const equipMatch = text.match(/裝備：(.+)/);
    if (equipMatch) state.equipment = equipMatch[1].trim();

    const cartMatch = text.match(/力盡次數：(\d+)\/3/);
    if (cartMatch) state.cartCount = cartMatch[1];

    const lvMatch = text.match(/Lv(\d+)/);
    if (lvMatch) state.level = lvMatch[1];

    const weaponMatch = text.match(/\[(.+?)\s+Lv/);
    if (weaponMatch) state.weapon = weaponMatch[1];

    const nameMatch = text.match(/👤\s*(.+?)\s*\[/);
    if (nameMatch) state.name = nameMatch[1];

    this.gameState = state;

    // 提取選項列表供下次輸入查表
    const options = {};
    const optionMatches = text.matchAll(/^\s*(\d+)[\.\、]\s*(.+)/gm);
    for (const m of optionMatches) {
      options[m[1]] = m[2].trim();
    }
    if (Object.keys(options).length > 0) {
      this.lastOptions = options;
    }
  }

  // 動態難度計算（代碼強制，不依賴 AI）
  static getDifficulty(playerCount) {
    const table = {
      1: { hpMult: 0.5, atkMod: -2 },
      2: { hpMult: 0.8, atkMod: -1 },
      3: { hpMult: 1.0, atkMod: 0 },
      4: { hpMult: 1.3, atkMod: 1 },
      5: { hpMult: 1.6, atkMod: 2 },
      6: { hpMult: 2.0, atkMod: 3 },
      7: { hpMult: 2.5, atkMod: 3 },
      8: { hpMult: 3.0, atkMod: 4 },
    };
    return table[Math.min(Math.max(playerCount, 1), 8)];
  }

  // 生成記憶體注入文字
  getStateContext(playerCount) {
    const s = this.gameState;
    let ctx = `[系統記憶 — 當前遊戲狀態，以此為準，不可忽略]\n`;

    // 難度注入（代碼計算的具體數字）
    const diff = GameSession.getDifficulty(playerCount || 1);
    ctx += `【難度倍率】當前隊伍 ${playerCount || 1} 人：所有怪物 HP ×${diff.hpMult}，攻擊加值 ${diff.atkMod >= 0 ? '+' : ''}${diff.atkMod}。這是代碼計算的數值，你必須使用這些數字，不能自行調整。\n`;
    ctx += `【素材掉落】每位獵人可剝取 3 次，每多1人額外 +1 份基礎素材。\n`;

    if (s && s.name) {
      ctx += `角色：${s.name}，${s.weapon || '未知'} Lv${s.level || 1}\n`;
      ctx += `HP: ${s.hp || '?'}/${s.maxHp || '?'} | AC: ${s.ac || '?'}\n`;
      ctx += `金幣: ${s.gold || 0}g | EXP: ${s.exp || 0}/${s.expNext || 300}\n`;
      if (s.equipment) ctx += `裝備: ${s.equipment}\n`;
      if (s.items) ctx += `物品: ${s.items}\n`;
      if (s.location) ctx += `位置: ${s.location}\n`;
      if (s.cartCount) ctx += `力盡次數: ${s.cartCount}/3\n`;
    }
    return ctx;
  }

  // 升級檢測（純代碼）
  checkLevelUp() {
    const s = this.gameState;
    if (!s || !s.exp) return null;

    const EXP_TABLE = [0, 0, 300, 900, 2700, 6500, 14000, 23000, 34000, 48000, 64000, 85000, 100000, 120000, 140000, 165000, 195000, 225000, 265000, 305000, 355000];
    const HP_DICE = { '大劍': 10, '太刀': 8, '片手劍': 8, '雙劍': 6, '大錘': 10, '狩獵笛': 8, '長槍': 10, '弓': 8, '充能斧': 10, '操蟲棍': 8, '戰士': 10, '法師': 6, '牧師': 8, '盜賊': 8, '獵人': 8, '聖騎士': 10, '薩滿': 10, '術士': 6, '德魯伊': 8 };

    const currentExp = parseInt(String(s.exp).replace(/,/g, '')) || 0;
    const currentLevel = parseInt(s.level) || 1;
    const nextLevel = currentLevel + 1;
    if (nextLevel > 20) return null;

    const threshold = EXP_TABLE[nextLevel];
    if (!threshold || currentExp < threshold) return null;

    // 升級！代碼計算
    const hpDie = HP_DICE[s.weapon] || 8;
    const hpRoll = Math.floor(Math.random() * hpDie) + 1;
    const conMod = 0; // 從狀態無法精確取得 CON 調整值，預設 0
    const hpGain = Math.max(hpRoll + conMod, 1);
    const oldMaxHp = parseInt(s.maxHp) || 10;
    const newMaxHp = oldMaxHp + hpGain;
    const newExpNext = EXP_TABLE[nextLevel + 1] || '—';

    // 更新 gameState
    s.level = String(nextLevel);
    s.maxHp = String(newMaxHp);
    s.hp = String(newMaxHp); // 升級回滿血
    s.expNext = String(newExpNext);

    let text = `\n🎉 升級！達到等級 ${nextLevel}！\n`;
    text += `───────────────────────────────────────\n`;
    text += `HP 增加：🎲 d${hpDie}(${hpRoll}) + ${conMod} = +${hpGain} HP\n`;
    text += `新 HP：${newMaxHp}/${newMaxHp}\n`;
    text += `下一級所需 EXP：${newExpNext}\n`;
    text += `───────────────────────────────────────`;

    console.log(`[升級] Lv${currentLevel} → Lv${nextLevel}，HP +${hpGain}（${oldMaxHp} → ${newMaxHp}）`);
    return text;
  }

  // 保存遊戲（對話歷史 + 戰役信息 + 外掛記憶體）
  async save(playerName) {
    // 裁剪歷史到合理大小（保留前2條 + 最近20條）
    if (this.history.length > 22) {
      const first = this.history.slice(0, 2);
      const recent = this.history.slice(-20);
      this.history.length = 0;
      this.history.push(...first, ...recent);
    }
    const savePath = path.join(GAME_DIR, 'saves', `${playerName}.json`);
    const data = {
      meta: {
        name: playerName,
        campaign: this.campaign,
        roomId: this.roomId,
        saved_at: new Date().toISOString(),
      },
      history: this.history,
      gameState: this.gameState
    };
    fs.writeFileSync(savePath, JSON.stringify(data, null, 2), 'utf8');
    return savePath;
  }

  // 讀取存檔
  static async load(playerName) {
    const savePath = path.join(GAME_DIR, 'saves', `${playerName}.json`);
    if (!fs.existsSync(savePath)) return null;
    const data = JSON.parse(fs.readFileSync(savePath, 'utf8'));
    const session = new GameSession(data.meta.roomId);
    session.campaign = data.meta.campaign;
    session.history = data.history;
    session.gameState = data.gameState || null; // 讀取外掛記憶體
    // 裁剪舊歷史（如果存檔很大）
    if (session.history.length > 22) {
      const first = session.history.slice(0, 2);
      const recent = session.history.slice(-20);
      session.history = [...first, ...recent];
    }
    await session.init(data.meta.campaign);
    return session;
  }

  loadDungeonContext(dungeonId) {
    if (this.campaign) {
      const extra = loadDungeon(this.campaign, dungeonId);
      if (extra && this.chat) {
        this.chat.sendMessage(`[系統] 載入副本資料：${extra}`);
      }
    }
  }
}

const gameSessions = new Map();
const charCreators = new Map(); // roomId → CharacterCreator
const monsterDatabases = new Map(); // campaign → Map<name, template>
const activeCombats = new Map();    // roomId → CombatSession
const PUBLIC_DIR = path.join(__dirname, 'public');

// 確保 multiplayer 目錄存在
if (!fs.existsSync(MULTIPLAYER_DIR)) {
  fs.mkdirSync(MULTIPLAYER_DIR, { recursive: true });
}

// 房間存儲
const rooms = new Map();

// MIME 類型
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json'
};

// HTTP 服務器（提供靜態網頁）
const server = http.createServer((req, res) => {
  const urlPath = req.url === '/' ? '/index.html' : req.url;
  const fullPath = path.join(PUBLIC_DIR, urlPath);
  const ext = path.extname(fullPath);

  fs.readFile(fullPath, (err, data) => {
    if (err) {
      res.writeHead(404);
      res.end('Not Found');
      return;
    }
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'text/plain' });
    res.end(data);
  });
});

// WebSocket 服務器
const wss = new WebSocket.Server({ server });

function generateRoomId() {
  return crypto.randomInt(100000, 999999).toString();
}

// 廣播消息給房間所有人
function broadcastAll(room, msgObj) {
  const data = JSON.stringify(msgObj);
  if (room.host && room.host.readyState === WebSocket.OPEN) room.host.send(data);
  room.players.forEach(pw => { if (pw.readyState === WebSocket.OPEN) pw.send(data); });
}

// 取得房間所有玩家名
function getAllPlayerNames(room) {
  const names = [];
  if (room.host && room.host.playerName) names.push(room.host.playerName);
  room.players.forEach((pw, name) => names.push(name));
  return names;
}

// 根據名字取得對應的 ws
function getWsByName(room, name) {
  if (room.host && room.host.playerName === name) return room.host;
  return room.players.get(name) || null;
}

// 處理掷骰階段完成（返回排序後的結果）
function resolveRolls(room) {
  let maxRoll = -1;
  let winner = null;
  // 按掷骰結果降序排列
  const sorted = [...room.rolls.entries()].sort((a, b) => b[1] - a[1]);
  if (sorted.length > 0) {
    winner = sorted[0][0];
    maxRoll = sorted[0][1];
  }
  room.rollWinner = winner;
  const sortedNames = sorted.map(([name]) => name);
  room.rolls.clear();
  return { winner, maxRoll, sortedNames };
}

// 廣播回合資訊給所有人
function broadcastTurnInfo(room) {
  if (!room.gameStarted || room.turnOrder.length === 0) return;
  const currentPlayer = room.turnOrder[room.currentTurn % room.turnOrder.length];
  const turnMsg = JSON.stringify({ type: 'turn_info', currentPlayer });
  if (room.host && room.host.readyState === WebSocket.OPEN) room.host.send(turnMsg);
  room.players.forEach(pw => { if (pw.readyState === WebSocket.OPEN) pw.send(turnMsg); });
}

// 開始輪流創建角色
function startTurnBasedCreation(roomId, room) {
  room.phase = 'creating_turns';
  const firstName = room.createOrder[0];
  const firstKey = `${roomId}_${firstName}`;
  const creator = new CharacterCreator(firstName, room.campaign, room.faction);
  charCreators.set(firstKey, creator);
  const result = creator.process('show');
  broadcastAll(room, { type: 'game_output', content: `\n🎭 輪到 ${firstName} 選擇種族和職業！\n${result.text}` });
  broadcastAll(room, { type: 'turn_info', currentPlayer: firstName });
}

// 推進回合
function advanceTurn(room, roomId) {
  room.currentTurn = (room.currentTurn + 1) % room.turnOrder.length;
  broadcastTurnInfo(room);
  // 如果下個玩家暫離，自動 NPC 行動
  if (roomId && room.afkPlayers && room.turnOrder.length > 0) {
    const nextPlayer = room.turnOrder[room.currentTurn % room.turnOrder.length];
    if (room.afkPlayers.has(nextPlayer)) {
      setTimeout(() => handleAfkTurn(roomId, room, nextPlayer), 2000);
    }
  }
}

async function handleAfkTurn(roomId, room, afkPlayerName) {
  const session = gameSessions.get(roomId);
  if (!session || room.phase !== 'playing') return;
  if (!room.afkPlayers.has(afkPlayerName)) return; // 已經回來了

  const char = room.characters.get(afkPlayerName);
  const charName = char ? char.meta.name : afkPlayerName;
  const prompt = `[系統] 玩家 ${afkPlayerName} 暫離中，請為其角色「${charName}」做出合理的 NPC 自動行動。根據角色的性格和當前情境做出適當決定。`;

  try {
    broadcastAll(room, { type: 'game_thinking', from: 'DM' });
    const response = await session.send(prompt);
    broadcastAll(room, { type: 'game_output', content: response });
    advanceTurn(room, roomId);
  } catch (err) {
    console.error(`[AI 錯誤] AFK 自動行動失敗：${err.message}`);
    advanceTurn(room, roomId);
  }
}

function broadcast(room, message, excludeWs) {
  const data = JSON.stringify(message);
  room.players.forEach((ws) => {
    if (ws !== excludeWs && ws.readyState === WebSocket.OPEN) {
      ws.send(data);
    }
  });
}

function writeInbox(roomId, message) {
  const inboxPath = path.join(MULTIPLAYER_DIR, `inbox-${roomId}.json`);
  let inbox = [];
  try {
    inbox = JSON.parse(fs.readFileSync(inboxPath, 'utf8'));
  } catch {
    // 文件不存在或無效，用空陣列
  }
  inbox.push(message);
  fs.writeFileSync(inboxPath, JSON.stringify(inbox, null, 2), 'utf8');
}

function clearInbox(roomId) {
  const inboxPath = path.join(MULTIPLAYER_DIR, `inbox-${roomId}.json`);
  fs.writeFileSync(inboxPath, '[]', 'utf8');
}

// === 戰鬥引擎：Gemini 意圖解析 ===
async function parsePlayerIntent(input, combatContext) {
  const model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash' });
  const prompt = `你是指令解析器。把玩家的自然語言轉成JSON。只返回JSON，不要其他文字。

可用行動類型：
- skill: 使用技能（需要 skillName 和 target）
- melee: 近戰武器攻擊（需要 target）
- item: 使用物品（需要 itemName）
- flee: 逃跑

${combatContext}

玩家輸入：「${input}」`;

  try {
    const result = await model.generateContent(prompt);
    const text = result.response.text().trim();
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (jsonMatch) return JSON.parse(jsonMatch[0]);
  } catch (e) {
    console.error('[意圖解析失敗]', e.message);
  }
  return null;
}

// === 戰鬥引擎：Gemini 敘事生成 ===
async function generateNarrative(mechanicalResults, lang) {
  const model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash' });
  const langInst = lang === 'en' ? 'in English' : lang === 'ja' ? '日本語で' : '用繁體中文';
  const prompt = `你是戰鬥旁白。根據以下機械結果${langInst}寫2-3句沉浸式描述。不要改動數值。不要添加選項。只寫敘事。

${mechanicalResults}`;

  try {
    const result = await model.generateContent(prompt);
    return result.response.text().trim();
  } catch (e) {
    console.error('[敘事生成失敗]', e.message);
    return mechanicalResults;
  }
}

// === 戰鬥引擎：狀態欄 + 選項列表 ===
function buildCombatStatusBar(combat, currentPlayer) {
  const players = combat.participants.filter(p => p.side === 'player');
  const enemies = combat.participants.filter(p => p.side === 'enemy' && p.hp > 0);

  let bar = '\n╔═══════════════════════════════════╗\n';
  for (const p of players) {
    const mpStr = p.mp !== undefined ? ` MP:${p.mp}/${p.maxMp}` : '';
    bar += `║ ${p.name} HP:${p.hp}/${p.maxHp}${mpStr}\n`;
  }
  for (const s of (combat.summons || [])) {
    bar += `║ 👹 ${s.name} HP:${s.hp}/${s.maxHp}\n`;
  }
  bar += '╠═══════════════════════════════════╣\n';
  for (const e of enemies) {
    const pct = Math.round(e.hp / e.maxHp * 100);
    const warn = pct <= 20 ? ' ⚠️' : '';
    bar += `║ ${e.name} HP:${e.hp}/${e.maxHp}${warn}\n`;
  }
  bar += '╠═══════════════════════════════════╣\n';

  const actions = combat.getAvailableActions(currentPlayer);
  let optNum = 1;
  const options = {};
  for (const a of actions) {
    if ((a.type === 'skill' || a.type === 'melee') && a.targets && a.targets.length > 0) {
      for (const t of a.targets) {
        bar += `║ ${optNum}. ${a.desc} → ${t}\n`;
        options[String(optNum)] = { ...a, target: t };
        optNum++;
      }
    } else {
      bar += `║ ${optNum}. ${a.desc}\n`;
      options[String(optNum)] = a;
      optNum++;
    }
  }
  bar += '╚═══════════════════════════════════╝';

  return { bar, options };
}

// === 戰鬥引擎：觸發戰鬥 ===
async function triggerCombat(roomId, room, enemies) {
  const players = [];
  for (const [name, charData] of room.characters) {
    const c = charData.character;
    const intMod = modifier(c.stats?.INT || 10);
    players.push({
      name: charData.meta.name, type: 'player', playerName: name,
      stats: c.stats, hp: parseInt(c.hp) || c.max_hp, maxHp: parseInt(c.max_hp) || c.hp,
      ac: parseInt(c.ac) || 10, level: parseInt(c.level) || 1,
      className: c.class, campaign: room.campaign,
      skills: getSkillsForLevel(room.campaign, c.class, parseInt(c.level) || 1),
      talents: c.talents || [],
      equipment: c.equipment || {},
      mp: calculateMP(c.class, parseInt(c.level) || 1, intMod),
      maxMp: calculateMP(c.class, parseInt(c.level) || 1, intMod),
      proficiency: proficiencyBonus(parseInt(c.level) || 1),
    });
  }

  const playerCount = players.length;
  const difficulty = CombatSession.getDifficulty(playerCount);
  const combat = new CombatSession(players, enemies, difficulty);
  const initResult = combat.initCombat();
  activeCombats.set(roomId, combat);

  const initText = initResult.order.map(p => `${p.name}(${p.initiative})`).join(' > ');
  const lang = room.lang || 'zh';
  const narrative = await generateNarrative(`戰鬥開始！先攻順序：${initText}`, lang);

  // Execute any enemy turns that come before the first player
  const allResults = [];
  let current = combat.getCurrentTurn();
  while (current && current.side === 'enemy' && combat.isActive) {
    allResults.push(combat.executeMonsterAI(current));
    const end = combat.checkCombatEnd();
    if (end.ended) break;
    current = combat.advanceTurn();
  }

  let output = `⚔️ ${narrative}\n`;
  if (allResults.length > 0) {
    const enemyNarrative = await generateNarrative(allResults.map(r => r.summary).join('\n'), lang);
    output += `\n${enemyNarrative}\n`;
  }

  const firstPlayer = combat.getCurrentTurn();
  if (firstPlayer && combat.isActive) {
    const { bar, options } = buildCombatStatusBar(combat, firstPlayer);
    combat._lastOptions = options;
    output += bar;
  }

  broadcastAll(room, { type: 'game_output', content: output });
  console.log(`[戰鬥] 房間 ${roomId}: 戰鬥開始，${enemies.length} 隻怪物`);
}

wss.on('connection', (ws) => {
  ws.isAlive = true;
  ws.on('pong', () => { ws.isAlive = true; });

  ws.on('message', async (raw) => {
    ws.isAlive = true; // 收到任何消息都視為活躍
    let msg;
    try {
      msg = JSON.parse(raw);
    } catch {
      ws.send(JSON.stringify({ type: 'error', message: '無效的消息格式' }));
      return;
    }

    switch (msg.type) {
      // === 主機操作 ===
      case 'create_room': {
        if (!msg.password || msg.password.length < 1) {
          ws.send(JSON.stringify({ type: 'error', message: '請設定密碼' }));
          return;
        }
        const roomId = msg.roomId || generateRoomId();
        const existingRoom = rooms.get(roomId);
        if (existingRoom) {
          // 允許主機重連：房間存在且主機已斷線且密碼正確
          if (existingRoom.hostDisconnected && existingRoom.password === msg.password) {
            existingRoom.host = ws;
            existingRoom.hostDisconnected = false;
            if (existingRoom.hostDisconnectTimer) {
              clearTimeout(existingRoom.hostDisconnectTimer);
              existingRoom.hostDisconnectTimer = null;
            }
            ws.roomId = roomId;
            ws.isHost = true;
            ws.playerName = msg.playerName || null;
            ws.send(JSON.stringify({ type: 'room_created', roomId }));
            console.log(`[房間] ${roomId} 主機重連成功`);
            break;
          }
          ws.send(JSON.stringify({ type: 'error', message: '該房間號已被使用' }));
          return;
        }
        rooms.set(roomId, {
          password: msg.password,
          host: ws,
          players: new Map(),
          created: Date.now(),
          hostDisconnected: false,
          hostDisconnectTimer: null,
          phase: 'lobby',       // lobby → rolling_campaign → picking_campaign → rolling_faction → picking_faction → creating_turns → creating_stats → playing
          campaign: null,
          faction: null,
          characters: new Map(),
          gameStarted: false,
          turnOrder: [],        // 遊戲回合順序
          currentTurn: 0,
          rolls: new Map(),     // 當前掷骰結果
          rollWinner: null,     // 掷骰贏家
          createOrder: [],      // 角色創建順序（掷骰排序）
          currentCreateIdx: 0,  // 當前創建角色的玩家索引
          afkPlayers: new Set(), // 暫離的玩家
          lang: msg.lang || 'zh' // 語言設定
        });
        ws.roomId = roomId;
        ws.isHost = true;
        ws.playerName = msg.playerName || null;
        ws.send(JSON.stringify({ type: 'room_created', roomId }));
        console.log(`[房間] ${roomId} 已創建`);
        break;
      }

      // === 玩家加入 ===
      case 'join_room': {
        const room = rooms.get(msg.roomId);
        if (!room) {
          ws.send(JSON.stringify({ type: 'error', message: '房間不存在' }));
          return;
        }
        if (room.password !== msg.password) {
          ws.send(JSON.stringify({ type: 'error', message: '密碼錯誤' }));
          return;
        }
        const currentCount = (room.host ? 1 : 0) + room.players.size;
        if (currentCount >= 8) {
          ws.send(JSON.stringify({ type: 'error', message: '房間已滿（最多 8 人）' }));
          return;
        }
        if (!msg.playerName || msg.playerName.trim() === '') {
          ws.send(JSON.stringify({ type: 'error', message: '請輸入名字' }));
          return;
        }

        const playerName = msg.playerName.trim();
        ws.roomId = msg.roomId;
        ws.playerName = playerName;
        ws.isHost = false;
        room.players.set(playerName, ws);

        ws.send(JSON.stringify({ type: 'joined', roomId: msg.roomId }));

        // 通知主機
        if (room.host && room.host.readyState === WebSocket.OPEN) {
          room.host.send(JSON.stringify({
            type: 'player_joined',
            playerName
          }));
        }

        // 寫入 inbox 通知 Claude
        writeInbox(msg.roomId, {
          from: playerName,
          action: `${playerName} 加入了遊戲，希望接管一個 NPC 隊友。`,
          timestamp: Date.now()
        });

        // 通知新玩家當前房間狀態
        const phaseMessages = {
          lobby: '歡迎加入！等待開始遊戲。\n任何人輸入「開始遊戲」即可開始。',
          rolling_campaign: '正在掷骰決定誰選戰役，請稍候...',
          picking_campaign: `正在由 ${room.rollWinner} 選擇戰役，請稍候...`,
          rolling_faction: '正在掷骰決定誰選陣營，請稍候...',
          picking_faction: `正在由 ${room.rollWinner} 選擇陣營，請稍候...`,
          creating_turns: '正在輪流選擇種族和職業，請稍候...',
          playing: '遊戲已在進行中，你可以在聊天欄觀戰。'
        };
        if (room.phase === 'creating_stats') {
          // 屬性分配階段，為新加入的玩家啟動角色創建
          const creatorKey = `${msg.roomId}_${playerName}`;
          if (!charCreators.has(creatorKey) && !room.characters.has(playerName)) {
            const creator = new CharacterCreator(playerName, room.campaign, room.faction);
            charCreators.set(creatorKey, creator);
            const raceResult = creator.process('show');
            ws.send(JSON.stringify({ type: 'game_output', content: `⚔️ 請創建你的角色。\n${raceResult.text}` }));
            room.createOrder.push(playerName);
          }
        } else if (phaseMessages[room.phase]) {
          ws.send(JSON.stringify({ type: 'game_output', content: phaseMessages[room.phase] }));
        }

        console.log(`[玩家] ${playerName} 加入房間 ${msg.roomId}`);
        break;
      }

      // === 玩家發送行動 ===
      case 'player_action': {
        if (!ws.roomId) return;
        ws.lastActivity = Date.now();

        const senderName = ws.playerName || msg.playerName || '主機';

        // 暫離回歸處理（任何行動自動解除暫離）
        const afkRoom = rooms.get(ws.roomId);
        if (afkRoom && afkRoom.afkPlayers && afkRoom.afkPlayers.has(senderName)) {
          afkRoom.afkPlayers.delete(senderName);
          broadcastAll(afkRoom, { type: 'back_notice', playerName: senderName, message: `▶ ${senderName} 回來了！角色控制權歸還玩家` });
          if (afkRoom.phase === 'playing') {
            const session = gameSessions.get(ws.roomId);
            if (session) {
              const char = afkRoom.characters.get(senderName);
              const charName = char ? char.meta.name : senderName;
              session.send(`[系統] 玩家 ${senderName} 回歸遊戲，恢復對角色「${charName}」的控制。`).catch(() => {});
            }
          }
          console.log(`[回歸] ${senderName} 在房間 ${ws.roomId} 回歸`);
          if (/^(\/back|\/回來|回來了|我回來了)$/i.test(msg.action.trim())) break;
        } else if (/^(\/back|\/回來|回來了|我回來了)$/i.test(msg.action.trim())) {
          ws.send(JSON.stringify({ type: 'game_output', content: '你沒有在暫離狀態。' }));
          break;
        }
        const isChat = msg.action.startsWith('/say ');
        const actionText = isChat ? msg.action.slice(5) : msg.action;

        // 即時廣播給所有人（隊友聊天）
        const chatRoom = rooms.get(ws.roomId);
        if (chatRoom) {
          const chatMsg = JSON.stringify({
            type: 'chat',
            from: senderName,
            text: isChat ? actionText : msg.action,
            isAction: !isChat
          });
          if (chatRoom.host && chatRoom.host !== ws && chatRoom.host.readyState === WebSocket.OPEN) {
            chatRoom.host.send(chatMsg);
          }
          chatRoom.players.forEach((playerWs, name) => {
            if (playerWs !== ws && playerWs.readyState === WebSocket.OPEN) {
              playerWs.send(chatMsg);
            }
          });
        }

        // 非聊天消息：調用 Gemini AI 處理
        if (!isChat) {
          const roomId = ws.roomId;
          const actionTrimmed = msg.action.trim();

          // === 保存遊戲 ===
          if (/^(保存|存檔|保存遊戲|存檔遊戲|存遊戲|save)$/i.test(actionTrimmed)) {
            const session = gameSessions.get(roomId);
            if (session) {
              const savePath = await session.save(senderName);
              const saveMsg = JSON.stringify({ type: 'game_output', content: `💾 遊戲已保存！存檔：${senderName}\n下次輸入「讀檔 ${senderName}」即可繼續。` });
              if (ws.readyState === WebSocket.OPEN) ws.send(saveMsg);
              console.log(`[存檔] ${senderName} 保存成功 → ${savePath}`);
            } else {
              const noGameMsg = JSON.stringify({ type: 'game_output', content: '⚠ 還沒有進行中的遊戲可保存。' });
              if (ws.readyState === WebSocket.OPEN) ws.send(noGameMsg);
            }
          }
          // === 讀取存檔 ===
          else if (/^(讀取|載入|讀檔|讀取遊戲|載入遊戲|讀取存檔|載入存檔|load)\s+/i.test(actionTrimmed)) {
            const loadName = actionTrimmed.replace(/^(讀取|載入|讀檔|讀取遊戲|載入遊戲|讀取存檔|載入存檔|load)\s+/i, '').trim();
            try {
              const loaded = await GameSession.load(loadName);
              if (loaded) {
                loaded.roomId = roomId;
                gameSessions.set(roomId, loaded);
                // 切換房間狀態為遊戲中
                const loadRoom = rooms.get(roomId);
                if (loadRoom) {
                  loadRoom.phase = 'playing';
                  loadRoom.gameStarted = true;
                  loadRoom.campaign = loaded.campaign;
                  loadRoom.turnOrder = getAllPlayerNames(loadRoom);
                  loadRoom.currentTurn = 0;
                  const loadMsg = JSON.stringify({ type: 'game_output', content: `💾 已載入 ${loadName} 的存檔（${loaded.campaign} 戰役）` });
                  broadcastAll(loadRoom, loadMsg);
                  broadcastTurnInfo(loadRoom);

                  // 從歷史紀錄中提取原始玩家名單，比對當前房間
                  const presentNames = getAllPlayerNames(loadRoom);
                  const savedPlayers = [];
                  const firstMsg = loaded.history.length > 0 ? loaded.history[0].parts[0].text : '';
                  const playerMatches = firstMsg.matchAll(/=== 玩家：(.+?) ===/g);
                  for (const m of playerMatches) savedPlayers.push(m[1]);

                  const absentPlayers = savedPlayers.filter(n => !presentNames.includes(n));
                  let npcNotice = '';
                  if (absentPlayers.length > 0) {
                    npcNotice = `\n以下玩家未在房間中，其角色由 NPC 自動接管：${absentPlayers.join('、')}。這些角色的行動由你（DM）根據角色性格自動決定，名字前加 [NPC] 標記。`;
                    broadcastAll(loadRoom, { type: 'game_output', content: `⚠ 缺席玩家：${absentPlayers.join('、')} — 角色由 NPC 接管` });
                  }

                  // 自動讓 Gemini 恢復遊戲場景
                  loaded._playerCount = presentNames.length;
                  loaded.lang = loadRoom.lang || 'zh';
                  try {
                    broadcastAll(loadRoom, { type: 'game_thinking', from: 'DM' });
                    const resumePrompt = `[系統] 玩家讀取了存檔。當前在線玩家：${presentNames.join('、')}。${npcNotice}\n請簡要總結當前冒險進度（位置、隊伍狀態、正在進行的任務），然後提供編號選項讓玩家選擇下一步行動。`;
                    const resumeResponse = await loaded.send(resumePrompt);
                    broadcastAll(loadRoom, { type: 'game_output', content: resumeResponse });
                  } catch (err) {
                    console.error(`[AI 錯誤] 讀檔恢復失敗：${err.message}`);
                  }
                }
                console.log(`[讀檔] ${loadName} 載入成功（${loaded.campaign}），房間切換為 playing 狀態`);
              } else {
                const notFoundMsg = JSON.stringify({ type: 'game_output', content: `⚠ 找不到 ${loadName} 的存檔。` });
                if (ws.readyState === WebSocket.OPEN) ws.send(notFoundMsg);
              }
            } catch (err) {
              const loadErrMsg = JSON.stringify({ type: 'game_output', content: `⚠ 讀取存檔失敗：${err.message}` });
              if (ws.readyState === WebSocket.OPEN) ws.send(loadErrMsg);
            }
          }
          // === 雜貨店（代碼控制）===
          else if (/^(雜貨店|商店|\/shop)$/i.test(actionTrimmed)) {
            const shopRoom = rooms.get(roomId);
            const session = gameSessions.get(roomId);
            const gold = parseInt(session?.gameState?.gold) || 0;
            ws.shopping = true;
            ws.send(JSON.stringify({ type: 'game_output', content: shopMenu(shopRoom?.campaign || 'warcraft', gold) }));
          }
          else if (ws.shopping) {
            const session = gameSessions.get(roomId);
            if (!session || !session.gameState) { ws.shopping = false; break; }
            const input = parseInt(actionTrimmed);
            if (input === 0 || /^(離開|返回|exit)$/i.test(actionTrimmed)) {
              ws.shopping = false;
              // 通知 Gemini 更新物品狀態
              const state = session.gameState;
              const sysMsg = `[系統] 玩家離開雜貨店。當前金幣：${state.gold}g，物品：${state.items}`;
              try {
                broadcastAll(rooms.get(roomId), { type: 'game_thinking', from: 'DM' });
                const resp = await session.send(sysMsg);
                broadcastAll(rooms.get(roomId), { type: 'game_output', content: resp });
              } catch (err) {
                ws.send(JSON.stringify({ type: 'game_output', content: `📍 回到村莊\n💰 ${state.gold}g\n物品：${state.items}\n\n1. 接受任務\n2. 前往鍛冶屋\n3. 前往雜貨店\n4. 吃貓飯` }));
              }
            } else if (!isNaN(input)) {
              const shopRoom = rooms.get(roomId);
              const result = shopBuy(shopRoom?.campaign || 'warcraft', input, session.gameState);
              const gold = parseInt(session.gameState.gold) || 0;
              let reply = result.text;
              if (result.ok) {
                reply += '\n' + shopMenu(shopRoom?.campaign || 'warcraft', gold);
              } else {
                reply += '\n' + shopMenu(shopRoom?.campaign || 'warcraft', gold);
              }
              ws.send(JSON.stringify({ type: 'game_output', content: reply }));
            } else {
              ws.send(JSON.stringify({ type: 'game_output', content: '⚠ 請輸入商品編號或 0 離開。' }));
            }
          }
          // === 結束遊戲 ===
          else if (/^(結束遊戲|離開遊戲|退出遊戲|退出|quit|exit)$/i.test(actionTrimmed)) {
            const session = gameSessions.get(roomId);
            const endRoom = rooms.get(roomId);
            if (session) {
              await session.save(senderName);
            }
            // 重置房間狀態
            if (endRoom) {
              endRoom.phase = 'lobby';
              endRoom.gameStarted = false;
              endRoom.campaign = null;
              endRoom.turnOrder = [];
              endRoom.currentTurn = 0;
              endRoom.characters.clear();
              endRoom.afkPlayers.clear();
              endRoom.createOrder = [];
              endRoom.currentCreateIdx = 0;
            }
            // 清理遊戲會話
            gameSessions.delete(roomId);
            charCreators.forEach((_, key) => { if (key.startsWith(roomId + '_')) charCreators.delete(key); });

            broadcastAll(endRoom || { host: ws, players: new Map() }, { type: 'game_output', content: `💾 遊戲已自動保存。\n👋 ${senderName} 結束了遊戲。\n\n輸入「讀取 ${senderName}」可繼續上次進度。\n輸入「開始遊戲」可開始新遊戲。` });
            console.log(`[結束] ${senderName} 結束遊戲，房間重置為大廳`);
          }
          // === 正常遊戲行動（階段狀態機）===
          else {
            const creatorKey = `${roomId}_${senderName}`;
            const currentRoom = rooms.get(roomId);
            if (!currentRoom) break;
            const allNames = getAllPlayerNames(currentRoom);
            const totalPlayers = allNames.length;
            const isSolo = totalPlayers <= 1;

            switch (currentRoom.phase) {

              // ========== 大廳 ==========
              case 'lobby': {
                if (/^(開始|開始遊戲|start)/i.test(actionTrimmed)) {
                  if (isSolo) {
                    // 單人直接選戰役
                    currentRoom.phase = 'picking_campaign';
                    currentRoom.rollWinner = senderName;
                    currentRoom.createOrder = [senderName];
                    const menuMsg = { type: 'game_output', content: '═══════════════════════════════════════\n  龍與地下城：無盡冒險\n═══════════════════════════════════════\n\n  1. ⚔️  艾澤拉斯征途（魔獸世界風）\n  2. 🐙 迷霧深淵（克蘇魯神話風）\n  3. 🩸 血月獵殺（血源詛咒風）\n  4. 🐉 狩獵時刻（怪物獵人風）\n\n請輸入 1-4 選擇戰役：' };
                    broadcastAll(currentRoom, menuMsg);
                  } else {
                    // 多人：掷骰決定誰選戰役
                    currentRoom.phase = 'rolling_campaign';
                    currentRoom.rolls.clear();
                    broadcastAll(currentRoom, { type: 'game_output', content: '🎲 掷骰決定誰來選擇戰役！\n所有人請輸入「擲骰」（或任意內容）' });
                    // 通知客戶端全員可輸入
                    broadcastAll(currentRoom, { type: 'turn_info', currentPlayer: '__all__' });
                  }
                } else {
                  ws.send(JSON.stringify({ type: 'game_output', content: '═══════════════════════════════════════\n  龍與地下城：無盡冒險\n═══════════════════════════════════════\n\n輸入「開始遊戲」來開始！\n\n等待所有玩家加入後再開始。' }));
                }
                break;
              }

              // ========== 掷骰選戰役 ==========
              case 'rolling_campaign': {
                if (currentRoom.rolls.has(senderName)) {
                  ws.send(JSON.stringify({ type: 'game_output', content: '你已經擲過了，等待其他人...' }));
                  break;
                }
                const val = d20();
                currentRoom.rolls.set(senderName, val);
                broadcastAll(currentRoom, { type: 'game_output', content: `🎲 ${senderName} 擲出了 ${val}！` });

                if (currentRoom.rolls.size >= totalPlayers) {
                  const { winner, maxRoll, sortedNames } = resolveRolls(currentRoom);
                  currentRoom.createOrder = sortedNames; // 角色創建順序 = 掷骰排名
                  currentRoom.phase = 'picking_campaign';
                  broadcastAll(currentRoom, { type: 'game_output', content: `\n🏆 ${winner} 擲出最高點 (${maxRoll})！由 ${winner} 選擇戰役。\n\n  1. ⚔️  艾澤拉斯征途（魔獸世界風）\n  2. 🐙 迷霧深淵（克蘇魯神話風）\n  3. 🩸 血月獵殺（血源詛咒風）\n  4. 🐉 狩獵時刻（怪物獵人風）\n\n${winner}，請輸入 1-4：` });
                  // 只有贏家可輸入
                  broadcastAll(currentRoom, { type: 'turn_info', currentPlayer: winner });
                }
                break;
              }

              // ========== 選戰役 ==========
              case 'picking_campaign': {
                if (senderName !== currentRoom.rollWinner) {
                  ws.send(JSON.stringify({ type: 'error', message: `現在由 ${currentRoom.rollWinner} 選擇戰役，請等待。` }));
                  break;
                }
                const campaignMap = { '1': 'warcraft', '2': 'cthulhu', '3': 'bloodborne', '4': 'monsterhunter' };
                const campaignNames = { warcraft: '艾澤拉斯征途', cthulhu: '迷霧深淵', bloodborne: '血月獵殺', monsterhunter: '狩獵時刻' };
                const selectedCampaign = campaignMap[actionTrimmed];
                if (!selectedCampaign) {
                  ws.send(JSON.stringify({ type: 'game_output', content: '⚠ 請輸入 1-4 選擇戰役。' }));
                  break;
                }

                if (!gameSessions.has(roomId)) gameSessions.set(roomId, new GameSession(roomId));
                gameSessions.get(roomId).lang = currentRoom.lang || 'zh';
                await gameSessions.get(roomId).init(selectedCampaign);
                currentRoom.campaign = selectedCampaign;
                console.log(`[戰役] 載入 ${selectedCampaign} 戰役文件`);

                broadcastAll(currentRoom, { type: 'game_output', content: `⚔️ 已選擇戰役：${campaignNames[selectedCampaign]}！` });

                // 檢查是否需要選陣營（魔獸有陣營）
                const hasFactionsMap = { warcraft: true, cthulhu: false, bloodborne: false, monsterhunter: false };
                if (hasFactionsMap[selectedCampaign] && !isSolo) {
                  currentRoom.phase = 'rolling_faction';
                  currentRoom.rolls.clear();
                  broadcastAll(currentRoom, { type: 'game_output', content: '\n🎲 掷骰決定誰來選擇陣營！\n所有人請輸入「擲骰」（或任意內容）' });
                  broadcastAll(currentRoom, { type: 'turn_info', currentPlayer: '__all__' });
                } else if (hasFactionsMap[selectedCampaign] && isSolo) {
                  // 單人魔獸直接選陣營
                  currentRoom.phase = 'picking_faction';
                  currentRoom.rollWinner = senderName;
                  ws.send(JSON.stringify({ type: 'game_output', content: '\n選擇你的陣營：\n  1. ⚔️ 聯盟\n  2. 💀 部落\n\n請輸入 1 或 2：' }));
                } else {
                  // 無陣營的戰役，直接進入角色創建
                  currentRoom.currentCreateIdx = 0;
                  startTurnBasedCreation(roomId, currentRoom);
                }
                break;
              }

              // ========== 掷骰選陣營 ==========
              case 'rolling_faction': {
                if (currentRoom.rolls.has(senderName)) {
                  ws.send(JSON.stringify({ type: 'game_output', content: '你已經擲過了，等待其他人...' }));
                  break;
                }
                const fVal = d20();
                currentRoom.rolls.set(senderName, fVal);
                broadcastAll(currentRoom, { type: 'game_output', content: `🎲 ${senderName} 擲出了 ${fVal}！` });

                if (currentRoom.rolls.size >= totalPlayers) {
                  const { winner: fWinner, maxRoll: fMax } = resolveRolls(currentRoom);
                  currentRoom.rollWinner = fWinner;
                  currentRoom.phase = 'picking_faction';
                  broadcastAll(currentRoom, { type: 'game_output', content: `\n🏆 ${fWinner} 擲出最高點 (${fMax})！由 ${fWinner} 選擇陣營。\n\n  1. ⚔️ 聯盟\n  2. 💀 部落\n\n${fWinner}，請輸入 1 或 2：` });
                  broadcastAll(currentRoom, { type: 'turn_info', currentPlayer: fWinner });
                }
                break;
              }

              // ========== 選陣營 ==========
              case 'picking_faction': {
                if (senderName !== currentRoom.rollWinner) {
                  ws.send(JSON.stringify({ type: 'error', message: `現在由 ${currentRoom.rollWinner} 選擇陣營，請等待。` }));
                  break;
                }
                const factionMap = { '1': '聯盟', '2': '部落' };
                const selectedFaction = factionMap[actionTrimmed];
                if (!selectedFaction) {
                  ws.send(JSON.stringify({ type: 'game_output', content: '⚠ 請輸入 1（聯盟）或 2（部落）。' }));
                  break;
                }
                currentRoom.faction = selectedFaction;
                console.log(`[陣營] 房間 ${roomId} 鎖定為 ${selectedFaction}`);
                broadcastAll(currentRoom, { type: 'game_output', content: `⚔️ 陣營已選定：【${selectedFaction}】！` });

                // 進入輪流創建角色
                currentRoom.currentCreateIdx = 0;
                startTurnBasedCreation(roomId, currentRoom);
                break;
              }

              // ========== 輪流選種族和職業 ==========
              case 'creating_turns': {
                const currentCreator = currentRoom.createOrder[currentRoom.currentCreateIdx];
                if (senderName !== currentCreator) {
                  ws.send(JSON.stringify({ type: 'error', message: `現在是 ${currentCreator} 選擇角色，請等待。` }));
                  break;
                }

                const creator = charCreators.get(creatorKey);
                if (!creator) break;

                const result = creator.process(actionTrimmed);
                // 種族/職業選擇結果廣播給所有人（大家都能看到別人選了什麼）
                broadcastAll(currentRoom, { type: 'game_output', content: `【${senderName}】${result.text}` });

                // 選了種族後鎖定陣營（非魔獸戰役時的保護）
                if (creator.raceData && !currentRoom.faction) {
                  currentRoom.faction = creator.raceData.faction;
                }

                // 角色在 creating_turns 階段就完成了（自動屬性分配的戰役如 MH）
                if (result.done && result.character) {
                  const savePath = path.join(GAME_DIR, 'saves', `${senderName}.json`);
                  fs.writeFileSync(savePath, JSON.stringify(result.character, null, 2), 'utf8');
                  console.log(`[角色] ${result.character.character.race} ${result.character.character.class} "${result.character.meta.name}" 創建完成`);
                  charCreators.delete(creatorKey);
                  currentRoom.characters.set(senderName, result.character);
                  broadcastAll(currentRoom, { type: 'game_output', content: `🎮 ${senderName} 的角色「${result.character.meta.name}」（${result.character.character.race} ${result.character.character.class}）已就緒！` });

                  // 推進到下一個玩家或啟動遊戲
                  currentRoom.currentCreateIdx++;
                  if (currentRoom.currentCreateIdx < currentRoom.createOrder.length) {
                    const nextName = currentRoom.createOrder[currentRoom.currentCreateIdx];
                    const nextKey = `${roomId}_${nextName}`;
                    const nextCreator = new CharacterCreator(nextName, currentRoom.campaign, currentRoom.faction);
                    charCreators.set(nextKey, nextCreator);
                    const raceResult = nextCreator.process('show');
                    broadcastAll(currentRoom, { type: 'game_output', content: `\n🎭 輪到 ${nextName} 選擇武器！\n${raceResult.text}` });
                    broadcastAll(currentRoom, { type: 'turn_info', currentPlayer: nextName });
                  } else if (currentRoom.characters.size >= totalPlayers) {
                    // 所有人完成！啟動遊戲
                    currentRoom.phase = 'playing';
                    currentRoom.gameStarted = true;
                    currentRoom.turnOrder = [...currentRoom.createOrder];
                    currentRoom.currentTurn = 0;

                    let charSummary = '[系統] 所有玩家角色創建完成。以下是隊伍成員：\n\n';
                    for (const [pName, char] of currentRoom.characters) {
                      charSummary += `=== 玩家：${pName} ===\n`;
                      charSummary += `角色名：${char.meta.name}\n`;
                      charSummary += `種族：${char.character.race}（${char.character.faction}）\n`;
                      charSummary += `職業：${char.character.class}\n`;
                      charSummary += `等級：1\n`;
                      charSummary += `HP：${char.character.hp}/${char.character.max_hp} | AC：${char.character.ac}\n`;
                      charSummary += `裝備：${char.character.inventory.join('、')}\n\n`;
                    }
                    charSummary += `請展示起始場景，開始冒險！\n`;

                    const session = gameSessions.get(roomId);
                    try {
                      broadcastAll(currentRoom, { type: 'game_thinking', from: 'DM' });
                      const response = await session.send(charSummary);
                      broadcastAll(currentRoom, { type: 'game_output', content: response });
                      broadcastTurnInfo(currentRoom);
                    } catch (err) {
                      console.error(`[AI 錯誤] ${err.message}`);
                    }
                  }
                }
                // 職業選完（step 進入 stats），換下一個人選種族/職業（傳統戰役）
                else if (creator.step === 'stats') {
                  currentRoom.currentCreateIdx++;
                  if (currentRoom.currentCreateIdx < currentRoom.createOrder.length) {
                    const nextName = currentRoom.createOrder[currentRoom.currentCreateIdx];
                    const nextKey = `${roomId}_${nextName}`;
                    const nextCreator = new CharacterCreator(nextName, currentRoom.campaign, currentRoom.faction);
                    charCreators.set(nextKey, nextCreator);
                    const raceResult = nextCreator.process('show');
                    broadcastAll(currentRoom, { type: 'game_output', content: `\n🎭 輪到 ${nextName} 選擇種族和職業！\n${raceResult.text}` });
                    broadcastAll(currentRoom, { type: 'turn_info', currentPlayer: nextName });
                  } else {
                    currentRoom.phase = 'creating_stats';
                    broadcastAll(currentRoom, { type: 'game_output', content: '\n═══════════════════════════════════════\n所有人的種族和職業已選定！\n現在所有人同時分配屬性和命名角色。\n═══════════════════════════════════════' });
                    broadcastAll(currentRoom, { type: 'turn_info', currentPlayer: '__all__' });
                  }
                }
                break;
              }

              // ========== 同時分配屬性和命名 ==========
              case 'creating_stats': {
                const creator = charCreators.get(creatorKey);
                if (!creator) {
                  ws.send(JSON.stringify({ type: 'game_output', content: '你已經完成角色創建了，等待其他人...' }));
                  break;
                }

                const result = creator.process(actionTrimmed);
                // 屬性分配只發給本人
                if (ws.readyState === WebSocket.OPEN) {
                  ws.send(JSON.stringify({ type: 'game_output', content: result.text }));
                }

                if (result.done && result.character) {
                  const savePath = path.join(GAME_DIR, 'saves', `${senderName}.json`);
                  fs.writeFileSync(savePath, JSON.stringify(result.character, null, 2), 'utf8');
                  console.log(`[角色] ${result.character.character.race} ${result.character.character.class} "${result.character.meta.name}" 創建完成`);
                  charCreators.delete(creatorKey);
                  currentRoom.characters.set(senderName, result.character);

                  // 通知所有人
                  broadcastAll(currentRoom, { type: 'game_output', content: `🎮 ${senderName} 的角色「${result.character.meta.name}」（${result.character.character.race} ${result.character.character.class}）已就緒！` });

                  // 檢查是否所有人都完成
                  if (currentRoom.characters.size >= totalPlayers) {
                    // 所有人完成！啟動遊戲
                    currentRoom.phase = 'playing';
                    currentRoom.gameStarted = true;
                    currentRoom.turnOrder = [...currentRoom.createOrder];
                    currentRoom.currentTurn = 0;

                    let charSummary = '[系統] 所有玩家角色創建完成。以下是隊伍成員：\n\n';
                    for (const [pName, char] of currentRoom.characters) {
                      charSummary += `=== 玩家：${pName} ===\n`;
                      charSummary += `角色名：${char.meta.name}\n`;
                      charSummary += `種族：${char.character.race}（${char.character.faction}）\n`;
                      charSummary += `職業：${char.character.class}\n`;
                      charSummary += `等級：1\n`;
                      charSummary += `HP：${char.character.hp}/${char.character.max_hp} | AC：${char.character.ac}\n`;
                      charSummary += `STR:${char.character.stats.STR} DEX:${char.character.stats.DEX} CON:${char.character.stats.CON} INT:${char.character.stats.INT} WIS:${char.character.stats.WIS} CHA:${char.character.stats.CHA}\n`;
                      charSummary += `裝備：${char.character.inventory.join('、')}\n\n`;
                    }
                    charSummary += `起始位置：${[...currentRoom.characters.values()][0].progress.current_location}\n\n`;
                    charSummary += `請展示起始場景，開始冒險！用沉浸式第二人稱叙事。描述每位隊員的位置和外觀。\n`;
                    charSummary += `【重要】這是多人遊戲，每次回覆結尾請指定下一個應該行動的玩家。`;

                    const session = gameSessions.get(roomId);
                    try {
                      broadcastAll(currentRoom, { type: 'game_thinking', from: 'DM' });
                      const response = await session.send(charSummary);
                      broadcastAll(currentRoom, { type: 'game_output', content: response });
                      broadcastTurnInfo(currentRoom);
                    } catch (err) {
                      console.error(`[AI 錯誤] ${err.message}`);
                    }
                  } else {
                    const remaining = totalPlayers - currentRoom.characters.size;
                    broadcastAll(currentRoom, { type: 'game_output', content: `⏳ 等待 ${remaining} 位玩家完成角色創建...` });
                  }
                }
                break;
              }

              // ========== 正常遊戲 ==========
              case 'playing': {
                const session = gameSessions.get(roomId);
                if (!session) break;
                session._playerCount = totalPlayers; // 更新人數供難度計算

                // 回合檢查
                if (currentRoom.turnOrder.length > 0) {
                  const currentPlayer = currentRoom.turnOrder[currentRoom.currentTurn % currentRoom.turnOrder.length];
                  if (senderName !== currentPlayer) {
                    ws.send(JSON.stringify({ type: 'error', message: `現在是 ${currentPlayer} 的回合，請等待。` }));
                    break;
                  }
                }

                // === 戰鬥引擎路由 ===
                const activeCombat = activeCombats.get(roomId);
                if (activeCombat && activeCombat.isActive) {
                  const currentTurnParticipant = activeCombat.getCurrentTurn();

                  let action = null;

                  // Number → lookup option table
                  if (/^\d+$/.test(actionTrimmed) && activeCombat._lastOptions) {
                    action = activeCombat._lastOptions[actionTrimmed];
                  }

                  // Free text → Gemini intent parse
                  if (!action) {
                    const ctx = `敵人：${activeCombat.participants.filter(p=>p.side==='enemy'&&p.hp>0).map(p=>`${p.name}(HP${p.hp}/${p.maxHp})`).join('、')}\n技能：${(currentTurnParticipant.skills||[]).map(s=>s.name).join('、')}\n物品：使用物品\n其他：逃跑`;
                    const intent = await parsePlayerIntent(actionTrimmed, ctx);
                    if (intent && intent.actions) action = intent.actions[0];
                    else if (intent && intent.type) action = intent;
                  }

                  if (!action) {
                    ws.send(JSON.stringify({ type: 'game_output', content: '⚠ 無法理解指令，請選擇數字或描述你的行動。' }));
                    break;
                  }

                  broadcastAll(currentRoom, { type: 'game_thinking', from: 'DM' });
                  const combatResult = activeCombat.executeAction(currentTurnParticipant, action);
                  const allResults = [combatResult];

                  // Execute summon AI
                  for (const summon of (activeCombat.summons || [])) {
                    if (summon.hp > 0) allResults.push(activeCombat.executeSummonAI(summon));
                  }

                  // Advance turn and execute enemy/summon actions
                  let endCheck = activeCombat.checkCombatEnd();
                  if (!endCheck.ended) {
                    let next = activeCombat.advanceTurn();
                    while (next && next.side === 'enemy' && activeCombat.isActive) {
                      allResults.push(activeCombat.executeMonsterAI(next));
                      endCheck = activeCombat.checkCombatEnd();
                      if (endCheck.ended) break;
                      next = activeCombat.advanceTurn();
                    }
                  }

                  // Generate narrative
                  const mechanicalText = allResults.map(r => r.summary).filter(Boolean).join('\n');
                  const lang = currentRoom.lang || 'zh';
                  const narrative = await generateNarrative(mechanicalText, lang);

                  let output = narrative + '\n';
                  if (endCheck.ended) {
                    if (endCheck.result === 'victory') {
                      output += `\n🏆 戰鬥勝利！\nEXP +${endCheck.loot.exp}`;
                      if (endCheck.loot.items.length > 0) output += `\n掉落：${endCheck.loot.items.map(i=>i.name).join('、')}`;
                      output += '\n\n1. 繼續前進\n2. 調查周圍\n3. 使用物品';
                    } else {
                      output += '\n💀 戰鬥失敗...\n\n1. 復活（花費金幣）\n2. 讀取存檔';
                    }
                    activeCombats.delete(roomId);
                    // Update game state
                    if (session && session.gameState && endCheck.loot) {
                      const oldExp = parseInt(session.gameState.exp) || 0;
                      session.gameState.exp = String(oldExp + endCheck.loot.exp);
                    }
                  } else {
                    const nextPlayer = activeCombat.getCurrentTurn();
                    const { bar, options: opts } = buildCombatStatusBar(activeCombat, nextPlayer);
                    activeCombat._lastOptions = opts;
                    output += bar;
                  }

                  broadcastAll(currentRoom, { type: 'game_output', content: output });
                  if (session) session.parseState(output);
                  advanceTurn(currentRoom, roomId);
                  console.log(`[戰鬥] 房間 ${roomId} — ${senderName}: ${actionTrimmed}`);
                  break;
                }
                // === 戰鬥引擎路由結束，以下為正常 Gemini DM 流程 ===

                const prompt = `[玩家 ${senderName}]: ${actionTrimmed}`;
                console.log(`[收到] 房間 ${roomId} — ${senderName}: ${actionTrimmed}`);

                broadcastAll(currentRoom, { type: 'game_thinking', from: 'DM' });

                try {
                  const response = await session.send(prompt);
                  broadcastAll(currentRoom, { type: 'game_output', content: response });
                  advanceTurn(currentRoom, roomId);
                  console.log(`[AI] 房間 ${roomId} — 回覆完成（${response.length}字）`);
                } catch (err) {
                  console.error(`[AI 錯誤] ${err.message}`);
                  ws.send(JSON.stringify({ type: 'game_output', content: `⚠ DM 暫時無法回應：${err.message}` }));
                }
                break;
              }

              default: break;
            }
          }
        }
        break;
      }

      // === 主機廣播遊戲輸出 ===
      case 'game_output': {
        if (!ws.isHost || !ws.roomId) return;
        const outputRoom = rooms.get(ws.roomId);
        if (outputRoom) {
          broadcast(outputRoom, {
            type: 'game_output',
            content: msg.content
          });
        }
        break;
      }

      // === 主機讀取並清除收件箱 ===
      case 'read_inbox': {
        if (!ws.isHost || !ws.roomId) return;
        const inboxPath = path.join(MULTIPLAYER_DIR, `inbox-${ws.roomId}.json`);
        let inbox = [];
        try {
          inbox = JSON.parse(fs.readFileSync(inboxPath, 'utf8'));
        } catch {}
        ws.send(JSON.stringify({ type: 'inbox', messages: inbox }));
        clearInbox(ws.roomId);
        break;
      }

      // === 列出房間內玩家 ===
      case 'list_players': {
        if (!ws.roomId) return;
        const listRoom = rooms.get(ws.roomId);
        if (listRoom) {
          const players = Array.from(listRoom.players.keys());
          ws.send(JSON.stringify({ type: 'player_list', players }));
        }
        break;
      }

      // === 踢出玩家 ===
      case 'kick_player': {
        if (!ws.isHost || !ws.roomId) return;
        const kickRoom = rooms.get(ws.roomId);
        if (kickRoom && msg.playerName) {
          const kickedWs = kickRoom.players.get(msg.playerName);
          if (kickedWs) {
            kickedWs.send(JSON.stringify({ type: 'kicked', message: '你已被踢出房間' }));
            kickedWs.close();
            kickRoom.players.delete(msg.playerName);
            writeInbox(ws.roomId, {
              from: 'system',
              action: `${msg.playerName} 已被踢出遊戲，其角色回歸 NPC 控制。`,
              timestamp: Date.now()
            });
          }
        }
        break;
      }

      // === 客戶端心跳 ===
      case 'ping': {
        ws.isAlive = true; // 同時更新心跳標記，防止被服務器清理
        ws.send(JSON.stringify({ type: 'pong' }));
        break;
      }

      // === 關閉房間 ===
      case 'close_room': {
        if (!ws.isHost || !ws.roomId) return;
        const closeRoom = rooms.get(ws.roomId);
        if (closeRoom) {
          if (closeRoom.hostDisconnectTimer) {
            clearTimeout(closeRoom.hostDisconnectTimer);
          }
          closeRoom.players.forEach((playerWs) => {
            if (playerWs.readyState === WebSocket.OPEN) {
              playerWs.send(JSON.stringify({ type: 'room_closed', message: '房間已關閉' }));
              playerWs.close();
            }
          });
          rooms.delete(ws.roomId);
          console.log(`[房間] ${ws.roomId} 已關閉`);
        }
        break;
      }
    }
  });

  ws.on('close', () => {
    if (!ws.roomId) return;

    if (ws.isHost) {
      // 主機斷開，標記並保留房間 5 分鐘等待重連
      const room = rooms.get(ws.roomId);
      if (room) {
        room.hostDisconnected = true;
        room.host = null;
        console.log(`[房間] ${ws.roomId} 主機斷開，保留房間 5 分鐘等待重連`);
        // 通知玩家主機暫時斷線
        room.players.forEach((playerWs) => {
          if (playerWs.readyState === WebSocket.OPEN) {
            playerWs.send(JSON.stringify({ type: 'host_disconnected', message: '主機暫時斷線，等待重連...' }));
          }
        });
        // 5 分鐘後若主機未重連，刪除房間
        const closingRoomId = ws.roomId;
        room.hostDisconnectTimer = setTimeout(() => {
          const r = rooms.get(closingRoomId);
          if (r && r.hostDisconnected) {
            r.players.forEach((playerWs) => {
              if (playerWs.readyState === WebSocket.OPEN) {
                playerWs.send(JSON.stringify({ type: 'room_closed', message: '主機超時未重連，房間關閉' }));
                playerWs.close();
              }
            });
            rooms.delete(closingRoomId);
            console.log(`[房間] ${closingRoomId} 主機超時未重連，房間已關閉`);
          }
        }, 5 * 60 * 1000);
      }
    } else if (ws.playerName) {
      // 玩家斷開
      const room = rooms.get(ws.roomId);
      if (room) {
        room.players.delete(ws.playerName);
        writeInbox(ws.roomId, {
          from: 'system',
          action: `${ws.playerName} 離開了遊戲，其角色回歸 NPC 控制。`,
          timestamp: Date.now()
        });
        if (room.host && room.host.readyState === WebSocket.OPEN) {
          room.host.send(JSON.stringify({
            type: 'player_left',
            playerName: ws.playerName
          }));
        }
        console.log(`[玩家] ${ws.playerName} 離開房間 ${ws.roomId}`);
      }
    }
  });
});

// 心跳檢測（清理斷線客戶端）
setInterval(() => {
  wss.clients.forEach((ws) => {
    if (!ws.isAlive) return ws.terminate();
    ws.isAlive = false;
    ws.ping();
  });
}, 30000);

// AFK 暫離偵測（每 15 秒檢查一次）
setInterval(() => {
  const now = Date.now();
  rooms.forEach((room, roomId) => {
    if (room.phase !== 'playing') return;
    const checkAfk = (playerWs, playerName) => {
      if (!playerName) return;
      if (!playerWs.lastActivity) { playerWs.lastActivity = now; return; }
      if (room.afkPlayers.has(playerName)) return;
      if (now - playerWs.lastActivity >= AFK_TIMEOUT) {
        room.afkPlayers.add(playerName);
        broadcastAll(room, { type: 'afk_notice', playerName, message: `⏸ ${playerName} 暫離，角色由 NPC 自動接手` });
        console.log(`[暫離] ${playerName} 在房間 ${roomId} 暫離（閒置 ${Math.round((now - playerWs.lastActivity) / 1000)}s）`);
        if (room.turnOrder.length > 0) {
          const currentPlayer = room.turnOrder[room.currentTurn % room.turnOrder.length];
          if (currentPlayer === playerName) {
            setTimeout(() => handleAfkTurn(roomId, room, playerName), 2000);
          }
        }
      }
    };
    if (room.host && room.host.playerName) checkAfk(room.host, room.host.playerName);
    room.players.forEach((pw, name) => checkAfk(pw, name));
  });
}, 15000);

// 監聽 outbox 文件變化，自動廣播給玩家
fs.watch(MULTIPLAYER_DIR, (eventType, filename) => {
  if (!filename || !filename.startsWith('outbox-') || !filename.endsWith('.json')) return;

  const roomId = filename.replace('outbox-', '').replace('.json', '');
  const room = rooms.get(roomId);
  if (!room) return;

  const outboxPath = path.join(MULTIPLAYER_DIR, filename);
  try {
    const content = fs.readFileSync(outboxPath, 'utf8').trim();
    if (!content || content === '""' || content === '') return;

    const parsed = JSON.parse(content);
    const msg = JSON.stringify({ type: 'game_output', content: parsed });

    // 廣播給房主
    if (room.host && room.host.readyState === WebSocket.OPEN) {
      room.host.send(msg);
    }

    // 廣播給所有玩家
    room.players.forEach((playerWs) => {
      if (playerWs.readyState === WebSocket.OPEN) {
        playerWs.send(msg);
      }
    });

    // 清空 outbox
    fs.writeFileSync(outboxPath, '', 'utf8');
    const total = (room.host && room.host.readyState === WebSocket.OPEN ? 1 : 0) + room.players.size;
    console.log(`[廣播] 向房間 ${roomId} 的 ${total} 人發送了遊戲輸出（房主${room.host ? 1 : 0} + 玩家${room.players.size}）`);
  } catch (err) {
    // 文件可能正在被寫入，忽略
  }
});

// 定時清理超過 24 小時的空房間
setInterval(() => {
  const now = Date.now();
  rooms.forEach((room, roomId) => {
    if (room.players.size === 0 && now - room.created > 86400000) {
      rooms.delete(roomId);
      console.log(`[清理] 房間 ${roomId} 已超時刪除`);
    }
  });
}, 3600000);

server.listen(PORT, () => {
  console.log(`\n╔═══════════════════════════════════════╗`);
  console.log(`║  D&D 多人中繼服務器                   ║`);
  console.log(`║  http://localhost:${PORT}               ║`);
  console.log(`╠═══════════════════════════════════════╣`);
  console.log(`║  分享上方網址給朋友                   ║`);
  console.log(`║  他們在瀏覽器打開即可加入             ║`);
  console.log(`╚═══════════════════════════════════════╝\n`);
});
