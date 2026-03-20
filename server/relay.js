const WebSocket = require('ws');
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PORT = process.env.PORT || 8080;
const MULTIPLAYER_DIR = path.join(__dirname, '..', 'multiplayer');
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

  ws.on('message', (raw) => {
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

        // 主機或玩家都可以發送行動
        const senderName = ws.playerName || msg.playerName || '主機';
        writeInbox(ws.roomId, {
          from: senderName,
          action: msg.action,
          timestamp: Date.now()
        });

        // 如果是玩家發送的，通知主機
        if (!ws.isHost) {
          const actionRoom = rooms.get(ws.roomId);
          if (actionRoom && actionRoom.host && actionRoom.host.readyState === WebSocket.OPEN) {
            actionRoom.host.send(JSON.stringify({
              type: 'player_action',
              from: senderName,
              action: msg.action
            }));
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

    // 廣播給所有玩家
    room.players.forEach((playerWs) => {
      if (playerWs.readyState === WebSocket.OPEN) {
        playerWs.send(JSON.stringify({
          type: 'game_output',
          content: JSON.parse(content)
        }));
      }
    });

    // 清空 outbox
    fs.writeFileSync(outboxPath, '', 'utf8');
    console.log(`[廣播] 向房間 ${roomId} 的 ${room.players.size} 名玩家發送了遊戲輸出`);
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
