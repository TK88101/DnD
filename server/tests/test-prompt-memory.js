/**
 * 提示詞模組化 + 記憶引擎 + 輸出解析器 測試
 */

const { assemblePrompt, listActiveModules } = require('../prompt-modules');
const { MemoryEngine } = require('../memory-engine');
const { parseOutput, ensureOptions, cleanOutput } = require('../output-parser');

let passed = 0;
let failed = 0;

function assert(condition, name) {
  if (condition) {
    console.log(`  ✅ ${name}`);
    passed++;
  } else {
    console.log(`  ❌ ${name}`);
    failed++;
  }
}

// ==================== 提示詞模組化測試 ====================
console.log('\n=== 提示詞模組化系統 ===\n');

// 測試 1：基礎組裝
{
  const prompt = assemblePrompt({
    campaign: 'warcraft',
    langInstruction: '使用繁體中文回覆。',
    playerCount: 1,
    gameData: '（測試用遊戲資料）'
  });
  assert(prompt.includes('地下城主'), '包含 DM 身份');
  assert(prompt.includes('繁體中文'), '包含語言指令');
  assert(prompt.includes('戰鬥觸發'), '包含戰鬥規則');
  assert(prompt.includes('魔獸戰役'), '包含魔獸專屬規則');
  assert(!prompt.includes('貓車'), '不包含 MH 規則');
  assert(!prompt.includes('理智值'), '不包含克蘇魯規則');
  assert(prompt.includes('測試用遊戲資料'), '包含遊戲資料');
}

// 測試 2：MH 戰役
{
  const prompt = assemblePrompt({
    campaign: 'monsterhunter',
    langInstruction: '使用繁體中文回覆。',
    playerCount: 3,
    gameData: ''
  });
  assert(prompt.includes('貓車'), '包含 MH 專屬規則');
  assert(!prompt.includes('魔獸戰役'), '不包含魔獸規則');
}

// 測試 3：多人難度啟用
{
  const prompt = assemblePrompt({
    campaign: 'warcraft',
    langInstruction: '',
    playerCount: 5,
    gameData: ''
  });
  assert(prompt.includes('動態難度'), '多人時包含難度調整');
  assert(prompt.includes('×1.6'), '5 人 HP 倍率正確');
}

// 測試 4：單人不顯示難度
{
  const prompt = assemblePrompt({
    campaign: 'warcraft',
    langInstruction: '',
    playerCount: 1,
    gameData: ''
  });
  assert(!prompt.includes('動態難度'), '單人不包含難度調整');
}

// 測試 5：模組列表
{
  const modules = listActiveModules({ campaign: 'warcraft', playerCount: 1 });
  assert(modules.length > 5, `啟用模組數量正確 (${modules.length})`);
  assert(modules[0].includes('[10]'), '最高權重在前');
}

// ==================== 記憶引擎測試 ====================
console.log('\n=== 記憶引擎 ===\n');

// 測試 6：記憶提取
{
  const engine = new MemoryEngine();
  engine.extractMemories('攻擊', '💀 **飢餓野狼** 已擊殺！戰鬥結束。獲得 +50 EXP。');
  assert(engine.memories.length >= 1, '提取了戰鬥記憶');
  assert(engine.memories[0].type === 'combat', '類型為 combat');
  assert(engine.memories[0].importance === 5, '戰鬥重要性為 5');
  assert(engine.memories[0].entities.includes('飢餓野狼'), '提取了怪物名');
}

// 測試 7：任務記憶
{
  const engine = new MemoryEngine();
  engine.extractMemories('交任務', '✅ 任務完成！獲得 300 EXP、20g。升級 Lv4→Lv5！');
  const questMem = engine.memories.find(m => m.type === 'quest');
  assert(questMem !== undefined, '提取了任務記憶');
  assert(questMem.importance === 5, '任務重要性為 5');
}

// 測試 8：記憶回憶（相關性）
{
  const engine = new MemoryEngine();
  engine.extractMemories('', '💀 在 **十字路口** 擊殺了 **飢餓野狼**。');
  engine.extractMemories('', '抵達 **棘齒城**，見到了商人 **費茲維克**。');
  engine.extractMemories('', '在 **哀嚎洞穴** 擊殺了 Boss **安娜科德拉**。');

  const recall = engine.recall('我要回十字路口');
  assert(recall.includes('十字路口') || recall.includes('飢餓野狼'), '回憶包含十字路口相關記憶');
}

// 測試 9：記憶序列化
{
  const engine = new MemoryEngine();
  engine.extractMemories('', '✅ 任務完成！獲得 300 EXP。');
  const json = engine.toJSON();
  const restored = MemoryEngine.fromJSON(json);
  assert(restored.memories.length === engine.memories.length, '序列化後記憶數量一致');
  assert(restored.currentTurn === engine.currentTurn, '序列化後回合數一致');
}

// 測試 10：記憶壓縮
{
  const engine = new MemoryEngine();
  engine.maxMemories = 10;
  for (let i = 0; i < 20; i++) {
    engine.extractMemories('', `第 ${i} 輪的普通對話`);
  }
  assert(engine.memories.length <= 15, `壓縮後記憶數量合理 (${engine.memories.length})`);
}

// ==================== 輸出解析器測試 ====================
console.log('\n=== 輸出解析器 ===\n');

// 測試 11：狀態提取
{
  const text = `你走進了酒館。

👤 小馬屁精 [亡靈/術士] Lv5 | HP: 25/30 | AC: 14 | 💰 50g
EXP: 200/500 | 📍 十字路口
裝備：暗影法杖 | 物品：治療藥水x2

1. 跟酒保說話
2. 坐下休息
3. 離開`;

  const result = parseOutput(text);
  assert(result.state.hp === '25', 'HP 正確');
  assert(result.state.maxHp === '30', 'MaxHP 正確');
  assert(result.state.ac === '14', 'AC 正確');
  assert(result.state.gold === '50', '金幣正確');
  assert(result.state.level === '5', '等級正確');
  assert(result.state.location === '十字路口', '位置正確');
  assert(result.options['1'] === '跟酒保說話', '選項 1 正確');
  assert(result.options['3'] === '離開', '選項 3 正確');
  assert(result.battle === null, '無戰鬥標記');
}

// 測試 12：戰鬥觸發
{
  const text = `突然，灌木叢中竄出兩隻野狼！\n\n[BATTLE:飢餓野狼x2]`;
  const result = parseOutput(text);
  assert(result.battle === '飢餓野狼x2', '戰鬥標記正確');
  assert(result.events.combat === true, '檢測到戰鬥事件');
}

// 測試 13：事件檢測
{
  const text = `✅ 任務完成！獲得 300 EXP、20g。\n\n升級 Lv4→Lv5！`;
  const result = parseOutput(text);
  assert(result.events.quest === true, '檢測到任務完成');
  assert(result.events.levelUp === true, '檢測到升級');
}

// 測試 14：ensureOptions
{
  const noOptions = '你走進了酒館。酒保看著你。';
  const withOptions = ensureOptions(noOptions);
  assert(withOptions.includes('1. 繼續'), '自動附加預設選項');

  const hasOptions = '你走進了酒館。\n1. 說話\n2. 離開';
  const unchanged = ensureOptions(hasOptions);
  assert(!unchanged.includes('繼續'), '已有選項時不附加');
}

// 測試 15：cleanOutput
{
  const dirty = '```json\n{"text": "hello"}\n```\n<thinking>hmm</thinking>\n\n\n\nhello world';
  const clean = cleanOutput(dirty);
  assert(!clean.includes('```'), '移除代碼塊');
  assert(!clean.includes('<thinking>'), '移除 thinking 標籤');
  assert(!clean.includes('\n\n\n'), '移除多餘空行');
}

// ==================== 結果 ====================
console.log(`\n${'='.repeat(40)}`);
console.log(`測試結果: ${passed} 通過, ${failed} 失敗`);
console.log(`${'='.repeat(40)}\n`);
process.exit(failed > 0 ? 1 : 0);
