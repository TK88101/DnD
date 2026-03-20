# 文字版 D&D 跑團遊戲 — 實施計劃

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 創建一套完整的 Markdown/JSON 遊戲數據文件 + 多人中繼系統，讓 Claude 能作為 DM 運行三個戰役的文字版 D&D 跑團遊戲，支持朋友通過瀏覽器加入。

**Architecture:** 遊戲規則和內容以 Markdown/JSON 文件驅動，Claude 作為 DM 參考。多人模式通過 WebSocket 中繼服務器實現，朋友通過偽終端風格的網頁客戶端加入。

**Tech Stack:** Markdown（遊戲內容）、JSON（存檔格式）、Node.js + ws（中繼服務器）、HTML/CSS/JS（偽終端客戶端）、Git（版本控制）

**Spec:** `docs/superpowers/specs/2026-03-20-dnd-text-game-design.md`

---

## 文件總覽

| 文件路徑 | 職責 | Task |
|----------|------|------|
| `game.md` | 遊戲入口、使用說明、DM 指引 | 1 |
| `rules/core.md` | 通用核心規則（屬性、戰鬥、升級、NPC 隊友） | 2 |
| `rules/warcraft.md` | 魔獸戰役專屬規則（陣營、聲望、天賦） | 3 |
| `campaigns/warcraft/world.md` | 艾澤拉斯世界觀、地圖、勢力 | 4 |
| `campaigns/warcraft/races.md` | 8 大種族詳情 | 5 |
| `campaigns/warcraft/classes.md` | 9 大職業詳情、技能表 | 6 |
| `campaigns/warcraft/npcs.md` | 可招募 NPC 隊友 | 7 |
| `campaigns/warcraft/enemies.md` | 敵人資料庫 | 8 |
| `campaigns/warcraft/items.md` | 裝備/物品/消耗品表 | 9 |
| `campaigns/warcraft/quests.md` | 主線與支線任務 | 10 |
| `campaigns/warcraft/dungeons/*.md` | 13 個副本 | 11-14 |
| `saves/_template.json` | 存檔模板 | 15 |
| `server/relay.js` | WebSocket 中繼服務器（房間號+密碼） | 16 |
| `server/public/index.html` | 偽終端網頁客戶端（老闆鍵） | 17 |
| `multiplayer/` | 多人消息收發目錄 | 16 |
| `rules/cthulhu.md` + `campaigns/cthulhu/*` | 克蘇魯戰役 | 18-19 |
| `rules/bloodborne.md` + `campaigns/bloodborne/*` | 血源戰役 | 20-21 |

---

## Phase 1：核心系統

### Task 1: 遊戲入口 game.md

**Files:**
- Create: `game.md`

- [ ] **Step 1: 創建 game.md**

此文件是 Claude 開始遊戲時首先讀取的文件，包含：
1. DM 行為指引（如何叙事、格式規範、掷骰規則）
2. 遊戲啟動流程（新遊戲 vs 繼續遊戲）
3. 三大戰役簡介及選單
4. 存檔管理說明
5. 玩家可用命令列表（開始遊戲、保存退出、查看狀態、查看背包等）

```markdown
# 龍與地下城：無盡冒險

## DM 指引（Claude 閱讀）

你是這場跑團遊戲的地下城主（DM）。遵循以下原則：

### 叙事風格
- 使用繁體中文，沉浸式第二人稱叙事
- 場景描述生動具體，調動五感
- NPC 對話用「」標記，體現個性
- 重要選擇以編號列表呈現

### 格式規範
（場景標題、狀態欄、戰鬥區塊的格式模板——見設計文檔範例）

### 掷骰
- 每次掷骰顯示完整過程：骰子類型(結果) + 加值 = 總計 vs 目標 → 結果
- 使用隨機數模擬，確保公平

### 遊戲啟動
當玩家說「開始遊戲」或「新建角色」：
1. 讀取此文件
2. 展示戰役選單
3. 引導角色創建
4. 創建存檔 JSON

當玩家說「繼續遊戲」或「讀取 [角色名]」：
1. 讀取 saves/{角色名}.json
2. 讀取對應戰役文件
3. 顯示狀態摘要，從中斷處繼續

### 戰役選單
1. 艾澤拉斯征途（魔獸世界風）— 經典奇幻，陣營對立，史詩副本
2. 迷霧深淵（克蘇魯神話風）— 恐怖調查，理智崩潰
3. 血月獵殺（血源詛咒風）— 哥特獵殺，獸化噩夢

### 玩家命令
- 「開始遊戲」/「新建角色」— 創建新角色
- 「繼續遊戲」/「讀取 [名字]」— 載入存檔
- 「查看狀態」— 顯示角色資訊
- 「查看背包」— 顯示物品列表
- 「查看地圖」— 顯示當前區域
- 「保存退出」— 保存進度並結束
- 「查看隊友」— 顯示 NPC 隊友資訊

### 文件索引
讀取規則：rules/core.md + rules/{campaign}.md
讀取戰役：campaigns/{campaign}/world.md 起步
讀取存檔：saves/{name}.json
```

- [ ] **Step 2: 驗證文件結構正確**

Run: `cat game.md | head -5`
Expected: 文件標題顯示正確

- [ ] **Step 3: Commit**

```bash
git add game.md
git commit -m "feat: 新增遊戲入口 game.md — DM 指引與啟動流程"
```

---

### Task 2: 核心規則 rules/core.md

**Files:**
- Create: `rules/core.md`

- [ ] **Step 1: 創建目錄**

```bash
mkdir -p rules
```

- [ ] **Step 2: 編寫核心規則**

此文件包含所有戰役共用的規則：

1. **屬性系統**：六大屬性（STR/DEX/CON/INT/WIS/CHA），範圍 1-20，調整值公式
2. **角色創建**：點數分配法（27 點買），初始 HP 計算
3. **戰鬥系統**：先攻、攻擊、傷害、暴擊、技能檢定、瀕死與死亡
4. **升級系統**：經驗值表（Lv1-20），每級 HP 增量、能力解鎖
5. **NPC 隊友規則**：招募上限（3 名）、AI 行為邏輯、玩家指令、同步升級
6. **物品與裝備**：裝備槽位（武器/護甲/飾品 x2）、背包容量、交易
7. **休息與恢復**：短休（恢復部分 HP）、長休（完全恢復）
8. **難度等級（DC）參考表**：簡單 5 / 普通 10 / 困難 15 / 極難 20 / 近乎不可能 25
9. **副本保存規則**：何時可保存、Boss 戰保存邏輯

關鍵數值表：

```markdown
## 經驗值表
| 等級 | 所需累計 EXP | HP 骰（戰士基準） |
|------|-------------|-----------------|
| 1    | 0           | 10 + CON調整值   |
| 2    | 300         | +1d10 + CON     |
| 3    | 900         | +1d10 + CON     |
| ...  | ...         | ...             |
| 20   | 355000      | +1d10 + CON     |

## 點數購買表
| 屬性值 | 花費點數 |
|--------|---------|
| 8      | 0       |
| 9      | 1       |
| 10     | 2       |
| 11     | 3       |
| 12     | 4       |
| 13     | 5       |
| 14     | 7       |
| 15     | 9       |
```

- [ ] **Step 3: Commit**

```bash
git add rules/core.md
git commit -m "feat: 新增核心規則 — 屬性、戰鬥、升級、NPC 隊友系統"
```

---

### Task 3: 魔獸專屬規則 rules/warcraft.md

**Files:**
- Create: `rules/warcraft.md`

- [ ] **Step 1: 編寫魔獸專屬規則**

此文件包含魔獸戰役獨有的機制：

1. **陣營系統**：聯盟（人類/矮人/暗夜精靈/地精）vs 部落（獸人/牛頭人/巨魔/亡靈/血精靈）
   - 陣營影響可用種族、城鎮、NPC 隊友、部分任務
   - 中立區域雙方皆可進入
2. **聲望系統**：各勢力聲望等級（仇恨→敵對→中立→友好→尊敬→崇敬→崇拜）
   - 影響商店物品、任務解鎖、NPC 態度
3. **天賦樹（簡化版）**：每個職業 3 條天賦路線，每 2 級可選 1 個天賦點
   - 例：戰士 = 武器（攻擊）/ 狂怒（暴擊）/ 防護（坦克）
4. **職業護甲類型**：布甲/皮甲/鎖甲/板甲，各職業可穿戴類型
5. **坐騎系統**：Lv10 解鎖坐騎（加速野外移動，不影響戰鬥）
6. **副本掉落規則**：Boss 掉落表、需求/貪婪骰（多人用）、綁定機制

- [ ] **Step 2: Commit**

```bash
git add rules/warcraft.md
git commit -m "feat: 新增魔獸專屬規則 — 陣營、聲望、天賦樹、裝備系統"
```

---

## Phase 2：魔獸戰役內容

### Task 4: 世界觀 campaigns/warcraft/world.md

**Files:**
- Create: `campaigns/warcraft/world.md`

- [ ] **Step 1: 創建目錄結構**

```bash
mkdir -p campaigns/warcraft/dungeons
```

- [ ] **Step 2: 編寫世界觀**

包含：
1. **艾澤拉斯概述**：兩大陣營的背景故事
2. **主要區域地圖**（文字描述）：
   - **東部王國**：暴風城、洛克莫丹、銀松森林、西瘟疫之地、東瘟疫之地
   - **卡利姆多**：奧格瑞瑪、貧瘠之地、灰谷、雷霆崖
   - **中立區域**：藏寶海灣、加基森
3. **起始區域**：聯盟從暴風城北郡開始，部落從杜隆塔爾開始
4. **主要勢力**：暴風城王國、獸人部落、銀色黎明、黑龍軍團、天災軍團等
5. **世界主線**：天災軍團的威脅逐步升級，最終通往納克薩瑪斯

- [ ] **Step 3: Commit**

```bash
git add campaigns/warcraft/world.md
git commit -m "feat: 新增魔獸世界觀 — 區域地圖、勢力、主線劇情"
```

---

### Task 5: 種族 campaigns/warcraft/races.md

**Files:**
- Create: `campaigns/warcraft/races.md`

- [ ] **Step 1: 編寫 8 大種族**

每個種族包含：
- 名稱、陣營歸屬
- 背景故事（2-3 句）
- 屬性加成（+2 某屬性，+1 另一屬性）
- 種族特長（1 個被動能力）
- 可用職業列表

```markdown
## 人類（聯盟）
- **屬性加成**：+1 全屬性
- **種族特長**：「人類精神」— 聲望獲取 +10%
- **背景**：暴風城的子民，適應力極強的種族...
- **可用職業**：戰士、法師、牧師、盜賊、聖騎士、術士

## 獸人（部落）
- **屬性加成**：+2 STR, +1 CON
- **種族特長**：「血性狂怒」— 每場戰鬥可啟動一次，攻擊 +2 持續 3 回合
- **背景**：來自德拉諾的戰士種族...
- **可用職業**：戰士、獵人、薩滿、術士

（以此類推：暗夜精靈、矮人、血精靈、牛頭人、亡靈、巨魔、地精）
```

- [ ] **Step 2: Commit**

```bash
git add campaigns/warcraft/races.md
git commit -m "feat: 新增魔獸 8 大種族 — 屬性加成、種族特長、可用職業"
```

---

### Task 6: 職業 campaigns/warcraft/classes.md

**Files:**
- Create: `campaigns/warcraft/classes.md`

- [ ] **Step 1: 編寫 9 大職業**

每個職業包含：
- 名稱、角色定位（坦克/治療/DPS）
- HP 骰類型（d6/d8/d10/d12）
- 主屬性
- 可穿護甲類型
- 起始裝備
- **技能表**（每 2 級解鎖一個新技能，共 10 個技能）
- **天賦樹**（3 條路線，每條 5 個天賦點）

```markdown
## 戰士
- **定位**：坦克 / 近戰 DPS
- **HP 骰**：d10
- **主屬性**：STR（武器/狂怒）或 CON（防護）
- **護甲**：板甲
- **起始裝備**：鐵劍(1d8+STR)、鏈甲(AC+4)、木盾(AC+2)、治療藥水 x2

### 技能表
| 等級 | 技能名 | 效果 |
|------|--------|------|
| 1    | 猛擊   | 單體攻擊，傷害 +2 |
| 2    | 戰吼   | 全體隊友攻擊 +1，持續 3 回合 |
| 4    | 旋風斬 | 攻擊所有鄰近敵人 |
| 6    | 盾牌格擋 | 下一次受到的攻擊傷害減半 |
| ...  | ...    | ... |

### 天賦樹
**武器**：強化猛擊 → 致命一擊 → 斬殺 → 劍刃風暴 → 死亡之願
**狂怒**：嗜血 → 狂暴打擊 → 旋風 → 拉姆塞斯之怒 → 泰坦之握
**防護**：強化格擋 → 復仇 → 盾牆 → 震盪波 → 不朽堡壘
```

（以此類推：法師、牧師、盜賊、獵人、聖騎士、薩滿、術士、德魯伊）

- [ ] **Step 2: Commit**

```bash
git add campaigns/warcraft/classes.md
git commit -m "feat: 新增魔獸 9 大職業 — 技能表、天賦樹、裝備類型"
```

---

### Task 7: NPC 隊友 campaigns/warcraft/npcs.md

**Files:**
- Create: `campaigns/warcraft/npcs.md`

- [ ] **Step 1: 編寫可招募 NPC**

設計 12 名 NPC（聯盟 6 名、部落 6 名），確保覆蓋坦克/治療/DPS 角色。
每個 NPC 包含：
- 姓名、種族、職業、所屬陣營
- 性格特徵（2-3 個關鍵詞 + 描述）
- 招募地點與條件
- 初始等級、屬性、技能
- 對話風格範例（3 句典型台詞）
- AI 戰鬥行為偏好

```markdown
## 聯盟 NPC

### 艾琳娜・萊特（人類牧師）
- **性格**：溫和堅定、厭惡亡靈、虔誠信徒
- **招募**：暴風城大教堂，完成「淨化北郡墓地」任務後
- **定位**：治療
- **AI 行為**：優先治療 HP 最低的隊友，HP > 70% 時用神聖懲擊輸出
- **台詞範例**：
  - 「聖光會指引我們的道路。」
  - 「退後！讓我來處理這些不潔之物！」（遇到亡靈時）
  - 「撐住……治療馬上到！」（隊友瀕死時）

### 鋼鬚・銅錘（矮人戰士）
- **性格**：豪爽好酒、忠誠可靠、喜歡講冷笑話
- **招募**：鐵爐堡酒館，請他喝一杯即可
- **定位**：坦克
- ...
```

- [ ] **Step 2: Commit**

```bash
git add campaigns/warcraft/npcs.md
git commit -m "feat: 新增 12 名可招募 NPC 隊友 — 聯盟 6 名、部落 6 名"
```

---

### Task 8: 敵人資料庫 campaigns/warcraft/enemies.md

**Files:**
- Create: `campaigns/warcraft/enemies.md`

- [ ] **Step 1: 編寫敵人資料**

按等級分層，每個敵人包含：
- 名稱、類型（普通/精英/Boss）、等級範圍
- HP、AC、攻擊方式、傷害
- 特殊能力（如有）
- 掉落物品（引用 items.md 中的物品 ID）
- EXP 獎勵

分類：
1. **Lv1-5 敵人**：狗頭人、迪菲亞盜賊、狼、蜘蛛、亡靈
2. **Lv6-10 敵人**：豺狼人、食屍鬼、暗影法師
3. **Lv11-15 敵人**：血色十字軍、野豬人、暗鐵矮人
4. **Lv16-20 敵人**：天災軍團精英、黑龍軍團、上古元素
5. **野外隨機遭遇表**：按區域等級的隨機敵人組合

```markdown
## 普通敵人

### 狗頭人礦工（Lv1-3）
- **HP**: 8-15 | **AC**: 10
- **攻擊**：鎬頭 1d6
- **特殊**：無
- **掉落**：銅幣 1d10、破舊鎬頭（賣 2g）、5% 小型治療藥水
- **EXP**: 25

### 迪菲亞盜賊（Lv2-4）
- **HP**: 12-20 | **AC**: 12
- **攻擊**：匕首 1d6+1，可偷襲（首次攻擊 +1d6）
- **特殊**：閃避（每場戰鬥一次，迴避一次攻擊）
- **掉落**：銅幣 2d10、紅色面罩、10% 盜賊匕首
- **EXP**: 40
```

- [ ] **Step 2: Commit**

```bash
git add campaigns/warcraft/enemies.md
git commit -m "feat: 新增敵人資料庫 — 分等級分類型，含掉落表和 EXP"
```

---

### Task 9: 物品裝備表 campaigns/warcraft/items.md

**Files:**
- Create: `campaigns/warcraft/items.md`

- [ ] **Step 1: 編寫物品系統**

分類：
1. **武器**：按類型（劍/斧/錘/弓/法杖/匕首/拳套），含傷害骰、屬性需求、價格
2. **護甲**：按槽位（頭/胸/腿/手/腳/盾），含 AC 加值、類型（布/皮/鎖/板）
3. **飾品**：戒指、項鍊、披風，提供屬性加成或特殊效果
4. **消耗品**：治療藥水、法力藥水、增益藥水、食物
5. **任務物品**：特定任務所需道具
6. **副本掉落（精品/史詩）**：各副本 Boss 的專屬掉落

品質等級：灰色（垃圾）→ 白色（普通）→ 綠色（優秀）→ 藍色（精良）→ 紫色（史詩）→ 橙色（傳說）

```markdown
## 武器

### 單手劍
| 名稱 | 品質 | 傷害 | 屬性加成 | 等級需求 | 來源 | 價格 |
|------|------|------|---------|---------|------|------|
| 鐵劍 | 白 | 1d8 | — | 1 | 商店 | 10g |
| 迪菲亞切割者 | 綠 | 1d8+1 | DEX+1 | 3 | 死亡礦井 | — |
| 殘忍之刃 | 藍 | 1d8+3 | STR+2 | 8 | 影牙城堡 Boss | — |

## 消耗品
| 名稱 | 效果 | 價格 |
|------|------|------|
| 小型治療藥水 | 恢復 2d4+2 HP | 5g |
| 治療藥水 | 恢復 4d4+4 HP | 20g |
| 強效治療藥水 | 恢復 8d4+8 HP | 80g |
```

- [ ] **Step 2: Commit**

```bash
git add campaigns/warcraft/items.md
git commit -m "feat: 新增物品裝備表 — 武器、護甲、飾品、消耗品、副本掉落"
```

---

### Task 10: 任務系統 campaigns/warcraft/quests.md

**Files:**
- Create: `campaigns/warcraft/quests.md`

- [ ] **Step 1: 編寫任務**

結構：
1. **主線任務鏈**：從新手村到納克薩瑪斯的完整故事線（約 15 個主線任務節點）
2. **支線任務**：每個區域 3-5 個支線任務
3. **副本前置任務**：進入某些副本需要先完成的任務

每個任務包含：
- 任務名、給予者 NPC、地點
- 背景叙述（DM 用）
- 目標（明確的完成條件）
- 獎勵（EXP、金幣、物品、聲望）
- 後續任務（任務鏈連接）

```markdown
## 主線任務

### MQ01: 北郡的威脅（Lv1）
- **給予者**：麥克布萊德元帥（北郡修道院）
- **叙述**：北郡最近狼群異常活躍，農田遭到破壞，元帥需要人手調查。
- **目標**：擊退 5 隻飢餓野狼
- **獎勵**：100 EXP、5g、鐵劍（白）
- **後續**：MQ02

### MQ02: 迪菲亞的陰影（Lv3）
- **給予者**：暴風城衛兵格里菲斯（西部荒野）
- **叙述**：迪菲亞兄弟會在西部荒野活動猖獗...
- **目標**：找到迪菲亞信使，取得密函
- **獎勵**：200 EXP、10g
- **後續**：MQ03（解鎖死亡礦井）
```

- [ ] **Step 2: Commit**

```bash
git add campaigns/warcraft/quests.md
git commit -m "feat: 新增任務系統 — 主線任務鏈、支線任務、副本前置"
```

---

## Phase 3：魔獸副本

### Task 11: 初級副本（Lv1-10）

**Files:**
- Create: `campaigns/warcraft/dungeons/deadmines.md`
- Create: `campaigns/warcraft/dungeons/wailing-caverns.md`

- [ ] **Step 1: 編寫死亡礦井**

副本文件結構：
```markdown
# 死亡礦井

## 概覽
- **等級範圍**：Lv3-6
- **建議隊伍**：4 人（1 坦 1 治 2 DPS）
- **位置**：西部荒野，月溪鎮下方
- **前置任務**：MQ03（迪菲亞的據點）
- **預計時長**：30-45 分鐘

## 背景
迪菲亞兄弟會在廢棄礦井中建立了秘密基地...

## 地圖（房間結構）
入口礦道 → 礦井通道（分岔：左→水道，右→熔爐）→ 地精工坊 → 鋼鐵走廊 → 船塢（最終 Boss）

## 房間詳情

### R1: 入口礦道
- **描述**：昏暗潮濕的礦道，廢棄工具散落...
- **敵人**：狗頭人礦工 x3 (HP:12, AC:10, 1d6)
- **互動**：牆上有採礦工具可搜刮（DC10 察覺 → 找到 5g）
- **事件**：擊敗敵人後，遠處傳來爆炸聲

### R2: 礦井通道（分岔點）
- **描述**：通道在此分為兩條...
- **左路（水道）**：通往隱藏寶箱，有陷阱（DC12 DEX 豁免，失敗受 1d6 傷害）
- **右路（熔爐）**：主要路線，繼續推進

### R3: 地精工坊
- **敵人**：地精技師 x2 (HP:15, AC:11, 1d6+1) + 機械傀儡 x1 (HP:25, AC:14, 1d8)
- **機制**：技師每 2 回合修復傀儡 5 HP，優先擊殺技師

### BOSS1: 監工拉克佐爾
- **HP**: 50 | **AC**: 13
- **攻擊**：重錘 2d6+2
- **技能**：
  - 震地猛擊（每 3 回合）：全體 1d8 傷害，DC13 CON 豁免否則眩暈 1 回合
  - 召喚礦工：HP < 50% 時召喚 2 隻狗頭人
- **掉落**：監工之錘（藍，2d6+1，STR+1）、50g、200 EXP
- **戰前台詞**：「你們不該來這裡！礦井是我們的！」
- **戰敗台詞**：「不……老大會為我報仇的……」

### 最終 BOSS: 艾德溫・范克里夫
- **HP**: 80 | **AC**: 15
- **攻擊**：雙刃 2d8+3
...（完整 Boss 設計）

## 副本獎勵總覽
| Boss | 掉落 |
|------|------|
| 監工拉克佐爾 | 監工之錘（藍） |
| 吉爾尼斯 | ... |
| 艾德溫・范克里夫 | 范克里夫的戰鬥刀（藍）、迪菲亞披風（綠） |

## 完成獎勵
- 500 EXP
- 暴風城聲望 +200
- 解鎖主線 MQ04
```

- [ ] **Step 2: 編寫哀嚎洞穴**

（同樣格式，部落方副本）

- [ ] **Step 3: Commit**

```bash
git add campaigns/warcraft/dungeons/deadmines.md campaigns/warcraft/dungeons/wailing-caverns.md
git commit -m "feat: 新增初級副本 — 死亡礦井、哀嚎洞穴"
```

---

### Task 12: 中級副本（Lv10-20）

**Files:**
- Create: `campaigns/warcraft/dungeons/shadowfang-keep.md`
- Create: `campaigns/warcraft/dungeons/scarlet-monastery.md`
- Create: `campaigns/warcraft/dungeons/razorfen-downs.md`

- [ ] **Step 1: 編寫影牙城堡**

（按 Task 11 的副本文件結構，包含 4-5 個房間 + 2-3 個 Boss）

- [ ] **Step 2: 編寫血色修道院**

血色修道院分四翼：墓地、圖書館、軍械庫、大教堂。每翼作為獨立副本段落。

- [ ] **Step 3: 編寫剃刀沼澤**

- [ ] **Step 4: Commit**

```bash
git add campaigns/warcraft/dungeons/shadowfang-keep.md campaigns/warcraft/dungeons/scarlet-monastery.md campaigns/warcraft/dungeons/razorfen-downs.md
git commit -m "feat: 新增中級副本 — 影牙城堡、血色修道院、剃刀沼澤"
```

---

### Task 13: 高級副本（Lv15-20）

**Files:**
- Create: `campaigns/warcraft/dungeons/blackrock-depths.md`
- Create: `campaigns/warcraft/dungeons/scholomance.md`
- Create: `campaigns/warcraft/dungeons/stratholme.md`

- [ ] **Step 1: 編寫黑石深淵**

大型副本，8+ 房間，5+ Boss，多條路線可選。

- [ ] **Step 2: 編寫通靈學院**

- [ ] **Step 3: 編寫斯坦索姆**

含限時事件（45 分鐘淨化模式，成功額外獎勵）。

- [ ] **Step 4: Commit**

```bash
git add campaigns/warcraft/dungeons/blackrock-depths.md campaigns/warcraft/dungeons/scholomance.md campaigns/warcraft/dungeons/stratholme.md
git commit -m "feat: 新增高級副本 — 黑石深淵、通靈學院、斯坦索姆"
```

---

### Task 14: 終局團本（Lv20）

**Files:**
- Create: `campaigns/warcraft/dungeons/molten-core.md`
- Create: `campaigns/warcraft/dungeons/zulgurub.md`
- Create: `campaigns/warcraft/dungeons/blackwing-lair.md`
- Create: `campaigns/warcraft/dungeons/ahn-qiraj.md`
- Create: `campaigns/warcraft/dungeons/naxxramas.md`

- [ ] **Step 1: 編寫熔火之心**

10 個 Boss（包含拉格納羅斯），團本機制（DPS 檢測、走位、分階段戰鬥）。

- [ ] **Step 2: 編寫祖爾格拉布**

- [ ] **Step 3: 編寫黑翼之巢**

- [ ] **Step 4: 編寫安其拉神殿**

- [ ] **Step 5: 編寫納克薩瑪斯（最終副本）**

NAXX 完整設計：
```markdown
# 納克薩瑪斯

## 概覽
- **等級需求**：Lv20（滿級最高難度）
- **建議隊伍**：4 人滿配 + 高裝等
- **前置**：完成安其拉神殿 + 銀色黎明崇拜聲望
- **預計時長**：2-3 小時（可分段保存）

## 結構
四大區可任意順序挑戰，全部通關後開啟冰龍巢穴 → 克爾蘇加德

### 蜘蛛區
- Boss 1: 阿努布雷坎
- Boss 2: 黑女巫法琳娜
- Boss 3: 邁克斯納

### 瘟疫區
- Boss 4: 骯髒的希爾蓋
- Boss 5: 洛乩布
- Boss 6: 塔迪烏斯

### 軍事區
- Boss 7: 教官拉蘇維奧斯
- Boss 8: 哥特里克
- Boss 9: 四騎士

### 構造區
- Boss 10: 帕奇維克
- Boss 11: 格羅布魯斯
- Boss 12: 格拉斯
- Boss 13: 塔迪烏斯

### 冰龍巢穴
- Boss 14: 薩菲隆

### 最終 Boss
- Boss 15: 克爾蘇加德
（多階段戰鬥，3 個 Phase，召喚小怪、冰霜連鎖、虛空裂隙）
```

- [ ] **Step 6: Commit**

```bash
git add campaigns/warcraft/dungeons/
git commit -m "feat: 新增終局團本 — 熔火之心、祖爾格拉布、黑翼之巢、安其拉、納克薩瑪斯"
```

---

## Phase 4：存檔系統

### Task 15: 存檔模板

**Files:**
- Create: `saves/_template.json`

- [ ] **Step 1: 創建目錄和模板**

```bash
mkdir -p saves
```

創建 `_template.json` 作為存檔格式參考（Claude 創建角色時依此格式生成）：

```json
{
  "meta": {
    "name": "",
    "campaign": "",
    "created_at": "",
    "last_played": "",
    "play_time_minutes": 0
  },
  "character": {
    "race": "",
    "class": "",
    "level": 1,
    "exp": 0,
    "exp_to_next": 300,
    "stats": { "STR": 10, "DEX": 10, "CON": 10, "INT": 10, "WIS": 10, "CHA": 10 },
    "hp": 0,
    "max_hp": 0,
    "ac": 10,
    "abilities": [],
    "talent_tree": { "path": "", "points": [] },
    "inventory": [],
    "equipment": {
      "weapon": null,
      "armor": null,
      "shield": null,
      "trinket_1": null,
      "trinket_2": null
    },
    "gold": 0
  },
  "companions": [],
  "progress": {
    "main_quest": "",
    "side_quests": [],
    "completed_quests": [],
    "completed_dungeons": [],
    "reputation": {},
    "story_flags": [],
    "current_location": ""
  },
  "dungeon_state": null,
  "session_log": []
}
```

- [ ] **Step 2: Commit**

```bash
git add saves/_template.json
git commit -m "feat: 新增存檔模板 — JSON 格式定義"
```

---

## Phase 5：多人中繼系統

### Task 16: WebSocket 中繼服務器

**Files:**
- Create: `server/relay.js`
- Create: `server/package.json`

- [ ] **Step 1: 初始化項目**

```bash
mkdir -p server multiplayer
cd server && npm init -y && npm install ws
```

- [ ] **Step 2: 編寫中繼服務器 relay.js**

功能：
1. 房間管理：創建房間（生成 6 位房間號 + 密碼驗證）
2. WebSocket 連接管理：客戶端加入/離開
3. 消息中繼：客戶端消息 → 寫入 `multiplayer/inbox.json`
4. 輸出廣播：監聽 `multiplayer/outbox.json` 變化 → 推送到所有客戶端
5. 玩家角色綁定：朋友加入時選擇接管哪個 NPC

```javascript
// server/relay.js
const WebSocket = require('ws');
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PORT = process.env.PORT || 8080;
const MULTIPLAYER_DIR = path.join(__dirname, '..', 'multiplayer');
const PUBLIC_DIR = path.join(__dirname, 'public');

// 房間存儲
const rooms = new Map();

// 創建 HTTP 服務器（提供靜態網頁）
const server = http.createServer((req, res) => {
  const filePath = req.url === '/' ? '/index.html' : req.url;
  const fullPath = path.join(PUBLIC_DIR, filePath);
  const ext = path.extname(fullPath);
  const contentType = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' }[ext] || 'text/plain';

  fs.readFile(fullPath, (err, data) => {
    if (err) { res.writeHead(404); res.end('Not Found'); return; }
    res.writeHead(200, { 'Content-Type': contentType });
    res.end(data);
  });
});

const wss = new WebSocket.Server({ server });

// 生成房間號
function generateRoomId() {
  return crypto.randomInt(100000, 999999).toString();
}

wss.on('connection', (ws) => {
  ws.isAlive = true;
  ws.on('pong', () => { ws.isAlive = true; });

  ws.on('message', (data) => {
    const msg = JSON.parse(data);

    switch (msg.type) {
      case 'create_room': {
        const roomId = generateRoomId();
        rooms.set(roomId, {
          password: msg.password,
          host: ws,
          players: new Map(),
          created: Date.now()
        });
        ws.roomId = roomId;
        ws.isHost = true;
        ws.send(JSON.stringify({ type: 'room_created', roomId }));
        console.log(`房間 ${roomId} 已創建`);
        break;
      }

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
        ws.roomId = msg.roomId;
        ws.playerName = msg.playerName;
        room.players.set(msg.playerName, ws);
        ws.send(JSON.stringify({ type: 'joined', roomId: msg.roomId }));
        // 通知主機
        if (room.host.readyState === WebSocket.OPEN) {
          room.host.send(JSON.stringify({
            type: 'player_joined',
            playerName: msg.playerName
          }));
        }
        // 寫入 inbox 通知 Claude
        writeInbox(msg.roomId, {
          from: msg.playerName,
          action: `${msg.playerName} 加入了遊戲，希望接管一個 NPC 隊友。`,
          timestamp: Date.now()
        });
        break;
      }

      case 'player_action': {
        // 玩家發送遊戲行動
        writeInbox(ws.roomId, {
          from: ws.playerName,
          action: msg.action,
          timestamp: Date.now()
        });
        break;
      }

      case 'game_output': {
        // 主機廣播遊戲輸出給所有玩家
        const room = rooms.get(ws.roomId);
        if (room) {
          room.players.forEach((playerWs) => {
            if (playerWs.readyState === WebSocket.OPEN) {
              playerWs.send(JSON.stringify({
                type: 'game_output',
                content: msg.content
              }));
            }
          });
        }
        break;
      }
    }
  });

  ws.on('close', () => {
    if (ws.roomId && !ws.isHost) {
      const room = rooms.get(ws.roomId);
      if (room && ws.playerName) {
        room.players.delete(ws.playerName);
        writeInbox(ws.roomId, {
          from: 'system',
          action: `${ws.playerName} 離開了遊戲，其角色回歸 NPC 控制。`,
          timestamp: Date.now()
        });
      }
    }
  });
});

function writeInbox(roomId, message) {
  const inboxPath = path.join(MULTIPLAYER_DIR, `inbox-${roomId}.json`);
  let inbox = [];
  try { inbox = JSON.parse(fs.readFileSync(inboxPath, 'utf8')); } catch {}
  inbox.push(message);
  fs.writeFileSync(inboxPath, JSON.stringify(inbox, null, 2), 'utf8');
}

// 心跳檢測
setInterval(() => {
  wss.clients.forEach((ws) => {
    if (!ws.isAlive) return ws.terminate();
    ws.isAlive = false;
    ws.ping();
  });
}, 30000);

server.listen(PORT, () => {
  console.log(`D&D 中繼服務器運行中：http://localhost:${PORT}`);
  console.log('等待主機創建房間...');
});
```

- [ ] **Step 3: 驗證服務器啟動**

```bash
cd server && node relay.js &
curl -s http://localhost:8080 | head -5
```

Expected: 服務器啟動，返回 HTML

- [ ] **Step 4: Commit**

```bash
git add server/relay.js server/package.json
git commit -m "feat: 新增 WebSocket 中繼服務器 — 房間創建、玩家加入、消息中繼"
```

---

### Task 17: 偽終端網頁客戶端

**Files:**
- Create: `server/public/index.html`

- [ ] **Step 1: 編寫偽終端客戶端**

視覺要求：
- 黑色背景（#1a1a2e 或 #0d1117）、等寬字體（Cascadia Code / Fira Code / monospace）
- 綠色/白色文字，模擬 CLI 輸出
- 頂部假標題欄：`user@dev-server:~/project$` 或 `node — debug session`
- 底部輸入行帶閃爍光標：`$ ` 提示符
- 首屏偽裝：頁面加載時先顯示幾行假的 npm/node 輸出
- **老闆鍵（Esc）**：按下後切換到假的編譯日誌/代碼review頁面，再按切回

```html
<!DOCTYPE html>
<html lang="zh-TW">
<head>
<meta charset="UTF-8">
<title>node — debug session</title>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body {
    background: #0d1117;
    color: #c9d1d9;
    font-family: 'Cascadia Code', 'Fira Code', 'Courier New', monospace;
    font-size: 14px;
    line-height: 1.6;
    height: 100vh;
    display: flex;
    flex-direction: column;
  }

  /* 假標題欄 */
  .title-bar {
    background: #161b22;
    color: #8b949e;
    padding: 4px 12px;
    font-size: 12px;
    border-bottom: 1px solid #30363d;
    display: flex;
    justify-content: space-between;
  }
  .title-bar .dots span {
    display: inline-block; width: 12px; height: 12px;
    border-radius: 50%; margin-right: 6px;
  }
  .dot-red { background: #ff5f56; }
  .dot-yellow { background: #ffbd2e; }
  .dot-green { background: #27c93f; }

  /* 終端輸出區 */
  #terminal {
    flex: 1;
    overflow-y: auto;
    padding: 12px;
    white-space: pre-wrap;
    word-wrap: break-word;
  }
  #terminal::-webkit-scrollbar { width: 8px; }
  #terminal::-webkit-scrollbar-track { background: #0d1117; }
  #terminal::-webkit-scrollbar-thumb { background: #30363d; border-radius: 4px; }

  /* 輸入行 */
  .input-line {
    display: flex;
    padding: 8px 12px;
    border-top: 1px solid #30363d;
    background: #161b22;
  }
  .prompt { color: #7ee787; margin-right: 8px; }
  #input {
    flex: 1;
    background: transparent;
    border: none;
    color: #c9d1d9;
    font-family: inherit;
    font-size: 14px;
    outline: none;
    caret-color: #7ee787;
  }

  /* 顏色類 */
  .green { color: #7ee787; }
  .yellow { color: #e3b341; }
  .red { color: #f85149; }
  .blue { color: #58a6ff; }
  .dim { color: #484f58; }
  .bold { font-weight: bold; }
  .cyan { color: #39c5cf; }

  /* 老闆鍵：假編譯頁面 */
  #boss-screen {
    display: none;
    position: fixed;
    top: 0; left: 0;
    width: 100%; height: 100%;
    background: #1e1e1e;
    color: #d4d4d4;
    font-family: 'Cascadia Code', monospace;
    font-size: 13px;
    padding: 20px;
    overflow-y: auto;
    z-index: 9999;
  }

  /* 登入畫面 */
  #login-screen {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    height: 100%;
  }
  #login-screen input {
    background: #161b22;
    border: 1px solid #30363d;
    color: #c9d1d9;
    padding: 8px 12px;
    margin: 4px;
    font-family: inherit;
    font-size: 14px;
    width: 240px;
    outline: none;
  }
  #login-screen button {
    background: #238636;
    color: #fff;
    border: none;
    padding: 8px 24px;
    margin-top: 8px;
    cursor: pointer;
    font-family: inherit;
    font-size: 14px;
  }
</style>
</head>
<body>

<div class="title-bar">
  <div class="dots">
    <span class="dot-red"></span>
    <span class="dot-yellow"></span>
    <span class="dot-green"></span>
  </div>
  <span id="title-text">node — debug session</span>
  <span class="dim">bash</span>
</div>

<!-- 遊戲終端 -->
<div id="game-screen" style="display:none; flex:1; flex-direction:column;">
  <div id="terminal"></div>
  <div class="input-line">
    <span class="prompt">$</span>
    <input id="input" type="text" autofocus autocomplete="off"
           placeholder="輸入你的行動..." />
  </div>
</div>

<!-- 登入畫面 -->
<div id="login-screen">
  <div style="margin-bottom:20px; color:#7ee787; font-size:16px;">
    D&D 多人連線（偽裝模式）
  </div>
  <input id="login-name" placeholder="你的名字" />
  <input id="login-room" placeholder="房間號（6位數字）" />
  <input id="login-pass" type="password" placeholder="密碼" />
  <button onclick="joinRoom()">加入房間</button>
  <div id="login-error" style="color:#f85149; margin-top:8px;"></div>
</div>

<!-- 老闆鍵畫面 -->
<div id="boss-screen">
<span class="dim">$ npm run build</span>

<span class="green">> project@2.1.0 build</span>
<span class="green">> webpack --config webpack.prod.js</span>

<span class="dim">asset main.js 245 KiB [emitted] [minimized] (name: main)</span>
<span class="dim">asset vendor.js 892 KiB [emitted] [minimized] (name: vendor)</span>
<span class="dim">asset styles.css 45.2 KiB [emitted] (name: styles)</span>
<span class="dim">runtime modules 2.49 KiB 12 modules</span>
<span class="dim">orphan modules 18.3 KiB 7 modules</span>
<span class="dim">cacheable modules 1.18 MiB</span>
<span class="dim">  ./src/index.tsx 2.34 KiB [built] [code generated]</span>
<span class="dim">  ./src/App.tsx 8.91 KiB [built] [code generated]</span>
<span class="dim">  ./src/components/Dashboard.tsx 12.4 KiB [built] [code generated]</span>
<span class="dim">  ./src/utils/api.ts 3.21 KiB [built] [code generated]</span>
<span class="dim">  ./src/hooks/useAuth.ts 1.87 KiB [built] [code generated]</span>
<span class="yellow">WARNING in ./src/components/Chart.tsx</span>
<span class="yellow">Module Warning: "defaultProps" is deprecated for function components</span>
<span class="dim">webpack 5.91.0 compiled with 1 warning in 4823 ms</span>

<span class="dim">$ node scripts/check-types.js</span>
<span class="green">Type checking... done. No errors found.</span>

<span class="dim">$ eslint src/ --ext .ts,.tsx</span>
<span class="green">All files passed linting.</span>

<span class="dim">$ jest --coverage --silent</span>
<span class="green">Test Suites: 23 passed, 23 total</span>
<span class="green">Tests:       147 passed, 147 total</span>
<span class="green">Coverage:    87.3% Statements | 82.1% Branches | 91.0% Functions</span>

<span class="dim">$ _</span>
</div>

<script>
let ws = null;
let bossMode = false;

// 老闆鍵
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    bossMode = !bossMode;
    document.getElementById('boss-screen').style.display = bossMode ? 'block' : 'none';
    document.getElementById('game-screen').style.display = bossMode ? 'none' : 'flex';
    document.title = bossMode ? 'webpack — build' : 'node — debug session';
  }
});

function appendOutput(html) {
  const terminal = document.getElementById('terminal');
  const div = document.createElement('div');
  div.innerHTML = html;
  terminal.appendChild(div);
  terminal.scrollTop = terminal.scrollHeight;
}

function joinRoom() {
  const name = document.getElementById('login-name').value.trim();
  const roomId = document.getElementById('login-room').value.trim();
  const password = document.getElementById('login-pass').value.trim();
  const errEl = document.getElementById('login-error');

  if (!name || !roomId || !password) {
    errEl.textContent = '請填寫所有欄位';
    return;
  }

  const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
  ws = new WebSocket(`${protocol}//${location.host}`);

  ws.onopen = () => {
    ws.send(JSON.stringify({
      type: 'join_room',
      roomId, password, playerName: name
    }));
  };

  ws.onmessage = (event) => {
    const msg = JSON.parse(event.data);
    switch (msg.type) {
      case 'joined':
        document.getElementById('login-screen').style.display = 'none';
        document.getElementById('game-screen').style.display = 'flex';
        document.getElementById('game-screen').style.flex = '1';
        // 假的啟動輸出
        appendOutput('<span class="dim">$ node --inspect app.js</span>');
        appendOutput('<span class="dim">Debugger listening on ws://127.0.0.1:9229</span>');
        appendOutput('<span class="green">Connected to D&D session [' + roomId + ']</span>');
        appendOutput('<span class="dim">---</span>');
        appendOutput('<span class="cyan">歡迎，' + name + '！等待 DM 分配角色...</span>');
        document.getElementById('input').focus();
        break;
      case 'error':
        errEl.textContent = msg.message;
        break;
      case 'game_output':
        appendOutput(msg.content);
        break;
    }
  };

  ws.onerror = () => { errEl.textContent = '連線失敗'; };
  ws.onclose = () => { appendOutput('<span class="red">連線中斷</span>'); };
}

// 輸入處理
document.getElementById('input').addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && ws && ws.readyState === WebSocket.OPEN) {
    const input = e.target;
    const action = input.value.trim();
    if (!action) return;

    appendOutput('<span class="green">$ </span>' + action);
    ws.send(JSON.stringify({ type: 'player_action', action }));
    input.value = '';
  }
});
</script>
</body>
</html>
```

- [ ] **Step 2: 測試偽終端界面**

```bash
cd server && node relay.js
```

瀏覽器打開 `http://localhost:8080`，確認：
- 看起來像終端
- 登入流程正常
- Esc 鍵切換老闆畫面

- [ ] **Step 3: 更新 game.md 加入多人 DM 指引**

在 game.md 中新增多人模式指引：
- 當 `multiplayer/inbox-{roomId}.json` 存在時，DM 需要讀取並處理所有玩家行動
- 玩家接管 NPC 後，該 NPC 的行動由玩家決定，不再 AI 控制
- 戰鬥回合制：等待所有玩家輸入後才推進回合
- 輸出需要寫入 `multiplayer/outbox-{roomId}.json` 以廣播

- [ ] **Step 4: Commit**

```bash
git add server/public/index.html
git commit -m "feat: 新增偽終端網頁客戶端 — CLI 偽裝、老闆鍵、房間加入"
```

---

## Phase 6：克蘇魯戰役

### Task 18: 克蘇魯規則與世界觀

**Files:**
- Create: `rules/cthulhu.md`
- Create: `campaigns/cthulhu/world.md`
- Create: `campaigns/cthulhu/backgrounds.md`（替代 races.md）
- Create: `campaigns/cthulhu/classes.md`
- Create: `campaigns/cthulhu/npcs.md`
- Create: `campaigns/cthulhu/enemies.md`
- Create: `campaigns/cthulhu/items.md`
- Create: `campaigns/cthulhu/quests.md`

- [ ] **Step 1: 編寫克蘇魯專屬規則**

新增機制：
- **理智值（SAN）**：初始 = WIS x 5，遭遇恐怖事物時擲 WIS 檢定，失敗扣 SAN
- **SAN 閾值**：SAN < 50% 獲得「不安」狀態；< 25% 獲得「瘋狂」（隨機行為）；= 0 永久瘋狂（角色退場）
- **線索系統**：收集線索解鎖新區域/真相
- **恐懼判定**：首次遇到異常存在，DC 取決於存在的恐怖程度

- [ ] **Step 2: 編寫世界觀和所有戰役文件**

- [ ] **Step 3: 創建副本目錄並編寫 3 個副本**

```bash
mkdir -p campaigns/cthulhu/dungeons
```

副本：
- `campaigns/cthulhu/dungeons/manor.md` — 詭異莊園
- `campaigns/cthulhu/dungeons/deep-ruins.md` — 深海遺跡
- `campaigns/cthulhu/dungeons/void-rift.md` — 異界裂隙

- [ ] **Step 4: Commit**

```bash
git add rules/cthulhu.md campaigns/cthulhu/
git commit -m "feat: 新增克蘇魯戰役 — 規則、世界觀、職業、副本"
```

---

## Phase 7：血源戰役

### Task 19: 血源規則與世界觀

**Files:**
- Create: `rules/bloodborne.md`
- Create: `campaigns/bloodborne/world.md`
- Create: `campaigns/bloodborne/classes.md`
- Create: `campaigns/bloodborne/npcs.md`
- Create: `campaigns/bloodborne/enemies.md`
- Create: `campaigns/bloodborne/items.md`
- Create: `campaigns/bloodborne/quests.md`

- [ ] **Step 1: 編寫血源專屬規則**

新增機制：
- **血瓶系統**：取代傳統藥水，每場戰鬥固定 10 瓶血瓶，各恢復 30% HP
- **內臟攻擊（處決）**：敵人被擊暈（特定時機）後可發動處決，造成巨額傷害
- **變身系統**：洞察值 > 40 後可獲得獸化能力，獸化時 STR/DEX 大幅提升但 WIS 降低
- **洞察值**：殺死 Boss、閱讀禁忌知識增加洞察值，影響世界面貌和可見敵人
- **武器變形**：每把武器有兩種形態（如鋸肉刀 ↔ 長鋸），可在戰鬥中切換

- [ ] **Step 2: 編寫世界觀和所有戰役文件**

- [ ] **Step 3: 創建副本目錄並編寫 4 個副本**

```bash
mkdir -p campaigns/bloodborne/dungeons
```

副本：
- `campaigns/bloodborne/dungeons/yharnam-streets.md` — 亞南城區
- `campaigns/bloodborne/dungeons/forbidden-woods.md` — 禁忌森林
- `campaigns/bloodborne/dungeons/nightmare-frontier.md` — 噩夢邊境
- `campaigns/bloodborne/dungeons/great-ones-realm.md` — 上位者領域

- [ ] **Step 4: Commit**

```bash
git add rules/bloodborne.md campaigns/bloodborne/
git commit -m "feat: 新增血源戰役 — 規則、世界觀、職業、副本"
```

---

## Phase 8：驗證與試玩

### Task 20: 整合驗證

- [ ] **Step 1: 文件完整性檢查**

確認所有文件存在且互相引用一致：
- quests.md 引用的副本在 dungeons/ 中存在
- enemies.md 引用的掉落物品在 items.md 中存在
- npcs.md 引用的招募地點在 world.md 中存在
- classes.md 的技能與 core.md 的規則不矛盾

```bash
ls -R rules/ campaigns/ saves/
```

- [ ] **Step 2: 試玩測試**

讀取 game.md，模擬一次完整的新遊戲流程：
1. 創建角色
2. 接第一個任務
3. 進行一場戰鬥
4. 保存退出
5. 讀取存檔繼續

- [ ] **Step 3: 最終 Commit**

```bash
git add -A
git commit -m "feat: 文字版 D&D 跑團遊戲 v1.0 — 三大戰役完成"
```
