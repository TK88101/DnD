# 貢獻指南

感謝你有興趣為 D&D 無盡冒險做貢獻！以下是參與方式。

## 🎯 我們最需要的貢獻

### 新戰役內容（不需要寫代碼！）
最容易上手的貢獻方式——為現有戰役添加內容或創建全新戰役。

每個戰役是一個 `campaigns/你的戰役名/` 目錄，包含以下 Markdown 文件：

| 文件 | 內容 |
|------|------|
| `world.md` | 世界觀設定、主要區域 |
| `classes.md` | 種族和職業（或武器類型） |
| `enemies.md` | 敵人/怪物數據（HP、AC、攻擊、掉落） |
| `items.md` | 裝備、消耗品、素材 |
| `npcs.md` | NPC 角色 |
| `quests.md` | 任務鏈 |
| `dungeons/` | 副本地圖（可選） |

參考 `campaigns/warcraft/` 或 `campaigns/monsterhunter/` 的格式。

**適合的新戰役主題**：黑暗靈魂、薩爾達傳說、最終幻想、進擊的巨人、鬼滅之刃...

### 代碼改進
- 將更多 Gemini 控制的邏輯改為代碼控制（鍛冶屋、戰鬥判定等）
- UI/UX 改進（手機端適配、更好的終端風格）
- 新功能開發（見 Issues）

### Bug 修復
- 玩遊戲時發現的任何問題
- Gemini 行為異常的 workaround

## 🔧 開發環境設置

```bash
# 克隆項目
git clone https://github.com/TK88101/DnD.git
cd DnD/server
npm install

# 設置 API Key
export GEMINI_API_KEY="你的key"

# 啟動開發服務器
node relay.js
# 瀏覽器打開 http://localhost:8080
```

## 📋 提交 PR 的流程

1. Fork 本倉庫
2. 創建你的分支：`git checkout -b feature/你的功能名`
3. 提交改動：`git commit -m "feat: 描述你的改動"`
4. 推送分支：`git push origin feature/你的功能名`
5. 創建 Pull Request

### Commit 格式

```
feat: 新功能
fix: Bug 修復
docs: 文檔更新
chore: 雜項（配置、依賴等）
```

### PR 要求

- 說明你改了什麼、為什麼要改
- 如果是新戰役，附上你測試過的截圖或遊戲記錄
- 如果是代碼改動，確保不破壞現有功能

## ⚠️ 重要原則

1. **不要信任 Gemini 執行遊戲規則** — 能用代碼控制的就用代碼
2. **MH 戰役不使用 Rise/崛起內容** — 基於 MH World 設定
3. **保持繁體中文** — 遊戲界面和規則文件使用繁體中文
4. **價格平衡** — 新物品/裝備的價格要和現有經濟系統匹配

## 💬 有問題？

開一個 Issue 討論，或在 PR 中留言。
