const WebSocket = require('ws');
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const { CharacterCreator, attackRoll, skillCheck, roll, modifier } = require('./game-engine');

const PORT = process.env.PORT || 8080;
const MULTIPLAYER_DIR = path.join(__dirname, '..', 'multiplayer');
const GAME_DIR = path.join(__dirname, '..');

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

// 每個房間的 AI 對話管理
class GameSession {
  constructor(roomId) {
    this.roomId = roomId;
    this.campaign = null;
    this.history = [];
    this.chat = null;
    this.saveData = null;
  }

  async init(campaign) {
    this.campaign = campaign;
    const systemPrompt = loadGameContext(campaign);
    const model = genAI.getGenerativeModel({
      model: 'gemini-2.0-flash',
      systemInstruction: `你是一個龍與地下城（D&D）的地下城主（DM）。

【最重要規則】你必須 100% 嚴格按照下方提供的遊戲資料文件來運行遊戲。絕對不要自行編造種族、職業、技能、敵人、物品等數據。所有數據必須來自下方文件。如果文件中有12個種族，你就必須展示12個種族，一個都不能少，也不能改動屬性加成。

【格式規範】
- 使用繁體中文
- 場景描述用沉浸式第二人稱
- 戰鬥數據用格式化區塊
- NPC對話用「」標記
- 每次掷骰顯示完整過程：🎲 d20(結果) + 加值 = 總計 vs 目標 → 結果
- 每次回覆結尾顯示狀態欄

【遊戲資料文件（必須嚴格遵循）】
${systemPrompt}`
    });
    this.chat = model.startChat({ history: this.history });
  }

  async send(message) {
    if (!this.chat) {
      // 還沒選戰役，先用基礎模式
      const model = genAI.getGenerativeModel({
        model: 'gemini-2.0-flash',
        systemInstruction: `你是一個龍與地下城遊戲的DM。使用繁體中文。玩家正在選擇戰役。必須嚴格按照下方遊戲資料展示三個戰役選項。不要自行編造內容。\n\n` + loadGameContext(null)
      });
      this.chat = model.startChat({ history: this.history });
    }
    const result = await this.chat.sendMessage(message);
    const text = result.response.text();
    this.history.push({ role: 'user', parts: [{ text: message }] });
    this.history.push({ role: 'model', parts: [{ text }] });
    return text;
  }

  // 保存遊戲（對話歷史 + 戰役信息）
  save(playerName) {
    const savePath = path.join(GAME_DIR, 'saves', `${playerName}.json`);
    const data = {
      meta: {
        name: playerName,
        campaign: this.campaign,
        roomId: this.roomId,
        saved_at: new Date().toISOString(),
      },
      history: this.history
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
    await session.init(data.meta.campaign);
    // 用保存的歷史重建對話
    session.chat = genAI.getGenerativeModel({
      model: 'gemini-2.0-flash',
      systemInstruction: session.chat ? undefined : ''
    }).startChat({ history: data.history });
    // 重新初始化帶完整系統提示
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

wss.on('connection', (ws) => {
  ws.isAlive = true;
  ws.on('pong', () => { ws.isAlive = true; });

  ws.on('message', async (raw) => {
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
        if (rooms.has(roomId)) {
          ws.send(JSON.stringify({ type: 'error', message: '該房間號已被使用' }));
          return;
        }
        rooms.set(roomId, {
          password: msg.password,
          host: ws,
          players: new Map(),
          created: Date.now()
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

        console.log(`[玩家] ${playerName} 加入房間 ${msg.roomId}`);
        break;
      }

      // === 玩家發送行動 ===
      case 'player_action': {
        if (!ws.roomId) return;

        const senderName = ws.playerName || msg.playerName || '主機';
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
          if (/^(保存|存檔|保存遊戲|save)$/i.test(actionTrimmed)) {
            const session = gameSessions.get(roomId);
            if (session) {
              const savePath = session.save(senderName);
              const saveMsg = JSON.stringify({ type: 'game_output', content: `💾 遊戲已保存！存檔：${senderName}\n下次輸入「讀取 ${senderName}」即可繼續。` });
              if (ws.readyState === WebSocket.OPEN) ws.send(saveMsg);
              console.log(`[存檔] ${senderName} 保存成功 → ${savePath}`);
            } else {
              const noGameMsg = JSON.stringify({ type: 'game_output', content: '⚠ 還沒有進行中的遊戲可保存。' });
              if (ws.readyState === WebSocket.OPEN) ws.send(noGameMsg);
            }
          }
          // === 讀取存檔 ===
          else if (/^(讀取|載入|load)\s+/i.test(actionTrimmed)) {
            const loadName = actionTrimmed.replace(/^(讀取|載入|load)\s+/i, '').trim();
            try {
              const loaded = await GameSession.load(loadName);
              if (loaded) {
                loaded.roomId = roomId;
                gameSessions.set(roomId, loaded);
                const loadMsg = JSON.stringify({ type: 'game_output', content: `💾 已載入 ${loadName} 的存檔（${loaded.campaign} 戰役）\n\n遊戲繼續——你要做什麼？` });
                const loadRoom = rooms.get(roomId);
                if (loadRoom) {
                  if (loadRoom.host && loadRoom.host.readyState === WebSocket.OPEN) loadRoom.host.send(loadMsg);
                  loadRoom.players.forEach(pw => { if (pw.readyState === WebSocket.OPEN) pw.send(loadMsg); });
                }
                console.log(`[讀檔] ${loadName} 載入成功（${loaded.campaign}）`);
              } else {
                const notFoundMsg = JSON.stringify({ type: 'game_output', content: `⚠ 找不到 ${loadName} 的存檔。` });
                if (ws.readyState === WebSocket.OPEN) ws.send(notFoundMsg);
              }
            } catch (err) {
              const loadErrMsg = JSON.stringify({ type: 'game_output', content: `⚠ 讀取存檔失敗：${err.message}` });
              if (ws.readyState === WebSocket.OPEN) ws.send(loadErrMsg);
            }
          }
          // === 正常遊戲行動 ===
          else {
            const creatorKey = `${roomId}_${senderName}`;

            // --- 戰役選擇 ---
            if (!gameSessions.has(roomId) || !gameSessions.get(roomId).campaign) {
              const campaignMap = { '1': 'warcraft', '2': 'cthulhu', '3': 'bloodborne' };
              const selectedCampaign = campaignMap[actionTrimmed];
              if (selectedCampaign) {
                if (!gameSessions.has(roomId)) gameSessions.set(roomId, new GameSession(roomId));
                await gameSessions.get(roomId).init(selectedCampaign);
                console.log(`[戰役] 載入 ${selectedCampaign} 戰役文件`);

                // 啟動角色創建器
                const creator = new CharacterCreator(senderName, selectedCampaign);
                charCreators.set(creatorKey, creator);
                const result = creator.process('show'); // 顯示種族列表
                const outMsg = JSON.stringify({ type: 'game_output', content: `⚔️ 已選擇戰役！\n${result.text}` });
                const selRoom = rooms.get(roomId);
                if (selRoom) {
                  if (selRoom.host && selRoom.host.readyState === WebSocket.OPEN) selRoom.host.send(outMsg);
                  selRoom.players.forEach(pw => { if (pw.readyState === WebSocket.OPEN) pw.send(outMsg); });
                }
                break;
              }
              // 還沒選戰役，提示選擇
              if (!/^(開始|start)/i.test(actionTrimmed)) {
                const menuMsg = JSON.stringify({ type: 'game_output', content: '═══════════════════════════════════════\n  龍與地下城：無盡冒險\n═══════════════════════════════════════\n\n  1. ⚔️  艾澤拉斯征途（魔獸世界風）\n  2. 🐙 迷霧深淵（克蘇魯神話風）\n  3. 🩸 血月獵殺（血源詛咒風）\n\n請輸入 1、2 或 3 選擇戰役：' });
                if (ws.readyState === WebSocket.OPEN) ws.send(menuMsg);
                break;
              }
            }

            // --- 角色創建流程（服務器處理，不經過 Gemini）---
            if (charCreators.has(creatorKey)) {
              const creator = charCreators.get(creatorKey);
              const result = creator.process(actionTrimmed);
              const createMsg = JSON.stringify({ type: 'game_output', content: result.text });
              const createRoom = rooms.get(roomId);
              if (createRoom) {
                if (createRoom.host && createRoom.host.readyState === WebSocket.OPEN) createRoom.host.send(createMsg);
                createRoom.players.forEach(pw => { if (pw.readyState === WebSocket.OPEN) pw.send(createMsg); });
              }

              if (result.done && result.character) {
                // 角色創建完成，保存並通知 Gemini
                const savePath = path.join(GAME_DIR, 'saves', `${senderName}.json`);
                fs.writeFileSync(savePath, JSON.stringify(result.character, null, 2), 'utf8');
                console.log(`[角色] ${result.character.character.race} ${result.character.character.class} "${result.character.meta.name}" 創建完成`);

                charCreators.delete(creatorKey);

                // 告訴 Gemini 角色資料，讓它開始叙事
                const session = gameSessions.get(roomId);
                const charSummary = `[系統] 角色創建完成。玩家角色資料如下，請根據此資料開始遊戲叙事：
角色名：${result.character.meta.name}
種族：${result.character.character.race}（${result.character.character.faction}）
職業：${result.character.character.class}
等級：1
HP：${result.character.character.hp}/${result.character.character.max_hp}
AC：${result.character.character.ac}
STR:${result.character.character.stats.STR} DEX:${result.character.character.stats.DEX} CON:${result.character.character.stats.CON} INT:${result.character.character.stats.INT} WIS:${result.character.character.stats.WIS} CHA:${result.character.character.stats.CHA}
起始位置：${result.character.progress.current_location}
裝備：${result.character.character.inventory.join('、')}

請展示起始場景，開始冒險！用沉浸式第二人稱叙事。`;

                try {
                  const response = await session.send(charSummary);
                  const storyMsg = JSON.stringify({ type: 'game_output', content: response });
                  if (createRoom) {
                    if (createRoom.host && createRoom.host.readyState === WebSocket.OPEN) createRoom.host.send(storyMsg);
                    createRoom.players.forEach(pw => { if (pw.readyState === WebSocket.OPEN) pw.send(storyMsg); });
                  }
                } catch (err) {
                  console.error(`[AI 錯誤] ${err.message}`);
                }
              }
              break;
            }

            // --- 正常遊戲：調用 Gemini ---
            const session = gameSessions.get(roomId);
            if (!session) break;
            const prompt = `[玩家 ${senderName}]: ${actionTrimmed}`;

            console.log(`[收到] 房間 ${roomId} — ${senderName}: ${actionTrimmed}`);

            // 發送 "思考中" 提示
            const thinkingMsg = JSON.stringify({ type: 'game_thinking', from: 'DM' });
            const thinkRoom = rooms.get(roomId);
            if (thinkRoom) {
              if (thinkRoom.host && thinkRoom.host.readyState === WebSocket.OPEN) thinkRoom.host.send(thinkingMsg);
              thinkRoom.players.forEach(pw => { if (pw.readyState === WebSocket.OPEN) pw.send(thinkingMsg); });
            }

            // 調用 Gemini
            try {
              const response = await session.send(prompt);
              const outputMsg = JSON.stringify({ type: 'game_output', content: response });
              const outRoom = rooms.get(roomId);
              if (outRoom) {
                if (outRoom.host && outRoom.host.readyState === WebSocket.OPEN) outRoom.host.send(outputMsg);
                outRoom.players.forEach(pw => { if (pw.readyState === WebSocket.OPEN) pw.send(outputMsg); });
              }
              console.log(`[AI] 房間 ${roomId} — 回覆完成（${response.length}字）`);
            } catch (err) {
              console.error(`[AI 錯誤] ${err.message}`);
              const aiErrMsg = JSON.stringify({ type: 'game_output', content: `⚠ DM 暫時無法回應：${err.message}` });
              if (ws.readyState === WebSocket.OPEN) ws.send(aiErrMsg);
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

      // === 關閉房間 ===
      case 'close_room': {
        if (!ws.isHost || !ws.roomId) return;
        const closeRoom = rooms.get(ws.roomId);
        if (closeRoom) {
          closeRoom.players.forEach((playerWs) => {
            playerWs.send(JSON.stringify({ type: 'room_closed', message: '房間已關閉' }));
            playerWs.close();
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
      // 主機斷開，關閉房間
      const room = rooms.get(ws.roomId);
      if (room) {
        room.players.forEach((playerWs) => {
          playerWs.send(JSON.stringify({ type: 'room_closed', message: '主機已斷開，房間關閉' }));
          playerWs.close();
        });
        rooms.delete(ws.roomId);
        console.log(`[房間] ${ws.roomId} 主機斷開，房間已關閉`);
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
