/**
 * 智能記憶引擎
 * 替代粗暴的「保留最近 20 條」歷史裁剪
 *
 * 設計思路（靈感來源：XianTu 的向量記憶系統，簡化為不需要外部 API 的版本）：
 * - 每條對話提取關鍵實體（人名、地名、物品、事件）
 * - 按重要性分級存儲（戰鬥結果 > 任務進度 > 普通對話）
 * - 當歷史過長時，智能壓縮而非粗暴裁剪
 * - 根據當前上下文，選擇性回憶相關記憶注入
 */

// ==================== 記憶條目 ====================

/**
 * @typedef {Object} MemoryEntry
 * @property {number} turn - 第幾輪對話
 * @property {string} type - 類型：combat|quest|npc|item|location|dialogue|other
 * @property {number} importance - 重要性 1-5
 * @property {string} summary - 摘要（1-2 句話）
 * @property {string[]} entities - 相關實體（人名、地名等）
 * @property {string} rawText - 原始文字（壓縮時可丟棄）
 * @property {number} timestamp - 記錄時間
 */

class MemoryEngine {
  constructor() {
    /** @type {MemoryEntry[]} */
    this.memories = [];
    this.currentTurn = 0;
    this.maxMemories = 200; // 最多存 200 條記憶
  }

  // ==================== 記憶提取 ====================

  /**
   * 從一輪對話中提取記憶
   * @param {string} playerMessage - 玩家說了什麼
   * @param {string} dmResponse - DM 回覆了什麼
   */
  extractMemories(playerMessage, dmResponse) {
    this.currentTurn++;
    const text = dmResponse || '';

    // 戰鬥結果
    if (text.match(/戰鬥結束|勝利|擊殺|💀|戰敗|力盡/)) {
      this._addMemory('combat', 5, text, this._extractEntities(text));
    }

    // 任務進度
    if (text.match(/任務完成|✅|獲得.*EXP|升級|Lv\d+.*→.*Lv\d+/)) {
      this._addMemory('quest', 5, text, this._extractEntities(text));
    }

    // 重要物品獲得/失去
    if (text.match(/獲得：|掉落：|購買|賣出|裝備.*→/)) {
      this._addMemory('item', 4, text, this._extractEntities(text));
    }

    // NPC 互動（有對話的）
    if (text.match(/「.+」/) && text.length > 100) {
      this._addMemory('npc', 3, text, this._extractEntities(text));
    }

    // 位置變化
    if (text.match(/抵達|進入|來到|📍/)) {
      this._addMemory('location', 3, text, this._extractEntities(text));
    }

    // 普通對話（低重要性，只在本輪沒有其他更重要的記憶時才記錄）
    const hasHigherMemoryThisTurn = this.memories.some(m => m.turn === this.currentTurn && m.importance > 1);
    if (!hasHigherMemoryThisTurn) {
      this._addMemory('other', 1, text, this._extractEntities(text));
    }

    // 記憶數量超限時壓縮
    if (this.memories.length > this.maxMemories) {
      this._compress();
    }
  }

  // ==================== 記憶回憶 ====================

  /**
   * 根據當前上下文，生成應該注入的記憶摘要
   * @param {string} currentContext - 當前的對話/場景上下文
   * @param {number} maxTokens - 最多返回多少字符的記憶
   * @returns {string} 格式化的記憶注入文字
   */
  recall(currentContext, maxTokens = 800) {
    if (this.memories.length === 0) return '';

    // 1. 從當前上下文提取關鍵詞
    const contextEntities = this._extractEntities(currentContext);

    // 2. 對每條記憶計算相關性分數
    const scored = this.memories.map(mem => ({
      ...mem,
      relevance: this._calculateRelevance(mem, contextEntities)
    }));

    // 3. 按 (重要性 × 0.4 + 相關性 × 0.4 + 新鮮度 × 0.2) 排序
    const maxTurn = this.currentTurn;
    scored.sort((a, b) => {
      const scoreA = a.importance * 0.4 + a.relevance * 0.4 + (a.turn / maxTurn) * 0.2 * 5;
      const scoreB = b.importance * 0.4 + b.relevance * 0.4 + (b.turn / maxTurn) * 0.2 * 5;
      return scoreB - scoreA;
    });

    // 4. 選取最相關的記憶，直到達到 token 上限
    let result = '[長期記憶 — 過往重要事件回顧]\n';
    let charCount = result.length;

    for (const mem of scored) {
      if (mem.relevance === 0 && mem.importance < 4) continue; // 完全不相關且不重要的跳過
      const line = `• [第${mem.turn}輪/${mem.type}] ${mem.summary}\n`;
      if (charCount + line.length > maxTokens) break;
      result += line;
      charCount += line.length;
    }

    // 5. 附加最近 3 條記憶（無論相關性），但計入 token 預算
    const recent = this.memories.slice(-3);
    if (recent.length > 0) {
      const recentHeader = '\n[最近事件]\n';
      if (charCount + recentHeader.length <= maxTokens) {
        result += recentHeader;
        charCount += recentHeader.length;
        for (const mem of recent) {
          const line = `• ${mem.summary}\n`;
          if (charCount + line.length > maxTokens) break;
          result += line;
          charCount += line.length;
        }
      }
    }

    return result;
  }

  // ==================== 記憶搜索 ====================

  /**
   * 按實體名搜索記憶
   * @param {string} entityName - 要搜索的實體
   * @returns {MemoryEntry[]} 匹配的記憶列表
   */
  search(entityName) {
    const lower = entityName.toLowerCase();
    return this.memories.filter(m =>
      m.entities.some(e => e.toLowerCase().includes(lower)) ||
      m.summary.toLowerCase().includes(lower)
    );
  }

  // ==================== 內部方法 ====================

  /**
   * 添加一條記憶
   */
  _addMemory(type, importance, rawText, entities) {
    const summary = this._summarize(rawText, type);
    this.memories.push({
      turn: this.currentTurn,
      type,
      importance,
      summary,
      entities,
      rawText: rawText.slice(0, 500), // 只保留前 500 字元
      timestamp: Date.now()
    });
  }

  /**
   * 從文本中提取實體（人名、地名、物品名等）
   * 使用正則匹配常見模式，不需要外部 NLP
   */
  _extractEntities(text) {
    if (!text) return [];
    const entities = new Set();

    // **粗體名字**（角色名、NPC 名）
    const boldNames = text.matchAll(/\*\*(.+?)\*\*/g);
    for (const m of boldNames) entities.add(m[1]);

    // [NPC]名字
    const npcNames = text.matchAll(/\[NPC\](\S+)/g);
    for (const m of npcNames) entities.add(m[1]);

    // 📍 地名
    const locations = text.matchAll(/📍\s*(.+?)[\n|]/g);
    for (const m of locations) entities.add(m[1].trim());

    // 任務名（中文引號或書名號）
    const questNames = text.matchAll(/[「《](.+?)[」》]/g);
    for (const m of questNames) entities.add(m[1]);

    // Boss/怪物名（💀 後面的名字）
    const bossNames = text.matchAll(/💀\s*(.+?)[\s已倒]/g);
    for (const m of bossNames) entities.add(m[1].trim());

    // 裝備/物品名（獲得：後面的、🟦🟩🟪 後面的）
    const itemNames = text.matchAll(/[🟦🟩🟪🟧]\s*\*?\*?(.+?)\*?\*?[\s（(|]/g);
    for (const m of itemNames) entities.add(m[1].trim());

    // 純文本：按常見虛詞/動詞分割，提取可能的名詞短語
    // 用於匹配普通玩家輸入如「我要找費茲維克」「回十字路口」
    const SPLIT_WORDS = /[我你他她它們们的了嗎吗呢吧啊在是和與与到去找要回買买賣卖看給给用把被讓让從从跟向對对比但又也都很太可以怎麼么什麼这那有沒没不能會会想购買买出现来來，。！？、\s]+/;
    const segments = text.split(SPLIT_WORDS).filter(s => s.length >= 2 && s.length <= 10);
    for (const seg of segments) {
      entities.add(seg);
    }

    return [...entities].filter(e => e.length > 1 && e.length < 20);
  }

  /**
   * 將長文本摘要為 1-2 句話
   */
  _summarize(text, type) {
    if (!text) return '(空)';

    // 按類型提取關鍵信息
    switch (type) {
      case 'combat': {
        const enemies = text.match(/擊殺.*?[💀。\n]/)?.[0] || '';
        const result = text.match(/戰鬥結束.*?[。\n]/)?.[0] || '';
        const exp = text.match(/\+\d+.*?EXP/)?.[0] || '';
        return `${enemies} ${result} ${exp}`.trim().slice(0, 120) || text.slice(0, 120);
      }
      case 'quest': {
        const quest = text.match(/✅.*?[。\n！]/)?.[0] || '';
        const reward = text.match(/獲得.*?[。\n]/)?.[0] || '';
        const levelUp = text.match(/Lv\.\d+.*?→.*?Lv\.\d+/)?.[0] || '';
        return `${quest} ${reward} ${levelUp}`.trim().slice(0, 120) || text.slice(0, 120);
      }
      case 'item': {
        const items = text.match(/獲得：.+/)?.[0] || text.match(/裝備.*→.+/)?.[0] || '';
        return items.slice(0, 120) || text.slice(0, 120);
      }
      case 'location': {
        const loc = text.match(/抵達.+?[。\n]/)?.[0] || text.match(/進入.+?[。\n]/)?.[0] || '';
        return loc.slice(0, 120) || text.slice(0, 120);
      }
      case 'npc': {
        // 提取第一句對話
        const dialogue = text.match(/「.+?」/)?.[0] || '';
        const speaker = text.match(/\*\*(.+?)\*\*/)?.[1] || '';
        return `${speaker}：${dialogue}`.slice(0, 120) || text.slice(0, 120);
      }
      default:
        return text.slice(0, 120);
    }
  }

  /**
   * 計算一條記憶與當前上下文的相關性（0-5）
   */
  _calculateRelevance(memory, contextEntities) {
    if (contextEntities.length === 0) return 0;
    let score = 0;

    // 實體重疊
    for (const entity of contextEntities) {
      if (memory.entities.some(e => e.includes(entity) || entity.includes(e))) {
        score += 2;
      }
      if (memory.summary.includes(entity)) {
        score += 1;
      }
    }

    return Math.min(score, 5);
  }

  /**
   * 壓縮記憶：移除最不重要的條目
   */
  _compress() {
    // 保留策略：
    // - importance >= 4 的永遠保留（戰鬥結果、任務進度）
    // - 最近 20 條永遠保留
    // - 其餘按 importance 排序，刪除最低的
    const recentCount = Math.min(20, Math.floor(this.maxMemories / 2));
    const keepRecent = this.memories.slice(-recentCount);
    const older = this.memories.slice(0, -recentCount);

    const important = older.filter(m => m.importance >= 4);
    const others = older.filter(m => m.importance < 4);

    // 保留一半的「其他」記憶
    others.sort((a, b) => b.importance - a.importance || b.turn - a.turn);
    const keepOthers = others.slice(0, Math.floor(others.length / 2));

    let merged = [...important, ...keepOthers, ...keepRecent];

    // 如果 important + keepRecent 已經超過 maxMemories，按 importance 降序 + 時間降序裁剪
    if (merged.length > this.maxMemories) {
      merged.sort((a, b) => b.importance - a.importance || b.turn - a.turn);
      merged = merged.slice(0, this.maxMemories);
    }

    merged.sort((a, b) => a.turn - b.turn); // 按時間排序
    this.memories = merged;
  }

  // ==================== 序列化 ====================

  /**
   * 導出記憶（用於存檔）
   */
  toJSON() {
    return {
      memories: this.memories.map(m => ({
        turn: m.turn,
        type: m.type,
        importance: m.importance,
        summary: m.summary,
        entities: m.entities,
        timestamp: m.timestamp
        // rawText 不存入存檔，節省空間
      })),
      currentTurn: this.currentTurn
    };
  }

  /**
   * 從存檔恢復記憶
   */
  static fromJSON(data) {
    const engine = new MemoryEngine();
    if (data && data.memories) {
      engine.memories = data.memories;
      engine.currentTurn = data.currentTurn || 0;
    }
    return engine;
  }
}

module.exports = { MemoryEngine };
