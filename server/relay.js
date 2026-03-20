const WebSocket = require('ws');
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const { CharacterCreator, attackRoll, skillCheck, roll, modifier, d20 } = require('./game-engine');

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
function advanceTurn(room) {
  room.currentTurn = (room.currentTurn + 1) % room.turnOrder.length;
  broadcastTurnInfo(room);
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
          currentCreateIdx: 0   // 當前創建角色的玩家索引
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

        // 通知新玩家當前房間狀態
        if (room.phase === 'lobby') {
          ws.send(JSON.stringify({ type: 'game_output', content: '歡迎加入！等待開始遊戲。\n任何人輸入「開始遊戲」即可開始。' }));
        } else if (room.phase === 'creating_stats') {
          // 屬性分配階段，為新加入的玩家啟動角色創建
          const creatorKey = `${msg.roomId}_${playerName}`;
          if (!charCreators.has(creatorKey) && !room.characters.has(playerName)) {
            const creator = new CharacterCreator(playerName, room.campaign, room.faction);
            charCreators.set(creatorKey, creator);
            const raceResult = creator.process('show');
            ws.send(JSON.stringify({ type: 'game_output', content: `⚔️ 請創建你的角色。\n${raceResult.text}` }));
            room.createOrder.push(playerName);
          }
        } else if (room.phase === 'playing') {
          ws.send(JSON.stringify({ type: 'game_output', content: '遊戲已在進行中，你可以在聊天欄觀戰。' }));
        }

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
                    const menuMsg = { type: 'game_output', content: '═══════════════════════════════════════\n  龍與地下城：無盡冒險\n═══════════════════════════════════════\n\n  1. ⚔️  艾澤拉斯征途（魔獸世界風）\n  2. 🐙 迷霧深淵（克蘇魯神話風）\n  3. 🩸 血月獵殺（血源詛咒風）\n\n請輸入 1、2 或 3 選擇戰役：' };
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
                  broadcastAll(currentRoom, { type: 'game_output', content: `\n🏆 ${winner} 擲出最高點 (${maxRoll})！由 ${winner} 選擇戰役。\n\n  1. ⚔️  艾澤拉斯征途（魔獸世界風）\n  2. 🐙 迷霧深淵（克蘇魯神話風）\n  3. 🩸 血月獵殺（血源詛咒風）\n\n${winner}，請輸入 1、2 或 3：` });
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
                const campaignMap = { '1': 'warcraft', '2': 'cthulhu', '3': 'bloodborne' };
                const campaignNames = { warcraft: '艾澤拉斯征途', cthulhu: '迷霧深淵', bloodborne: '血月獵殺' };
                const selectedCampaign = campaignMap[actionTrimmed];
                if (!selectedCampaign) {
                  ws.send(JSON.stringify({ type: 'game_output', content: '⚠ 請輸入 1、2 或 3。' }));
                  break;
                }

                if (!gameSessions.has(roomId)) gameSessions.set(roomId, new GameSession(roomId));
                await gameSessions.get(roomId).init(selectedCampaign);
                currentRoom.campaign = selectedCampaign;
                console.log(`[戰役] 載入 ${selectedCampaign} 戰役文件`);

                broadcastAll(currentRoom, { type: 'game_output', content: `⚔️ 已選擇戰役：${campaignNames[selectedCampaign]}！` });

                // 檢查是否需要選陣營（魔獸有陣營）
                const hasFactionsMap = { warcraft: true, cthulhu: false, bloodborne: false };
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

                // 職業選完（step 進入 stats），換下一個人選種族/職業
                if (creator.step === 'stats') {
                  currentRoom.currentCreateIdx++;
                  if (currentRoom.currentCreateIdx < currentRoom.createOrder.length) {
                    // 下一個人開始選
                    const nextName = currentRoom.createOrder[currentRoom.currentCreateIdx];
                    const nextKey = `${roomId}_${nextName}`;
                    const nextCreator = new CharacterCreator(nextName, currentRoom.campaign, currentRoom.faction);
                    charCreators.set(nextKey, nextCreator);
                    const raceResult = nextCreator.process('show');
                    broadcastAll(currentRoom, { type: 'game_output', content: `\n🎭 輪到 ${nextName} 選擇種族和職業！\n${raceResult.text}` });
                    broadcastAll(currentRoom, { type: 'turn_info', currentPlayer: nextName });
                  } else {
                    // 所有人都選完種族和職業，進入同時分配屬性
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

                // 回合檢查
                if (currentRoom.turnOrder.length > 0) {
                  const currentPlayer = currentRoom.turnOrder[currentRoom.currentTurn % currentRoom.turnOrder.length];
                  if (senderName !== currentPlayer) {
                    ws.send(JSON.stringify({ type: 'error', message: `現在是 ${currentPlayer} 的回合，請等待。` }));
                    break;
                  }
                }

                const prompt = `[玩家 ${senderName}]: ${actionTrimmed}`;
                console.log(`[收到] 房間 ${roomId} — ${senderName}: ${actionTrimmed}`);

                broadcastAll(currentRoom, { type: 'game_thinking', from: 'DM' });

                try {
                  const response = await session.send(prompt);
                  broadcastAll(currentRoom, { type: 'game_output', content: response });
                  advanceTurn(currentRoom);
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
