import { WebSocketServer } from 'ws';
import * as Y from 'yjs';
import * as syncProtocol from 'y-protocols/sync.js';
import * as awarenessProtocol from 'y-protocols/awareness.js';
import { encoding, decoding } from 'lib0';
import { verifyToken } from '../middleware/auth.js';
import { db } from '../db/init.js';
import fs from 'fs';
import path from 'path';

// 房间管理：roomName -> { doc, awareness, connections, ytext, saveTimer, sourcePath, file }
const rooms = new Map();

const messageSync = 0;
const messageAwareness = 1;
const messageAuth = 2;
const messageQueryAwareness = 3;

/**
 * 初始化 Yjs WebSocket 服务，挂到 http server 的 upgrade 事件
 * URL 格式：/api/projects/:id/collab?file=<path>&token=JWT
 *
 * 房间名：projectId:filePath（每个文件一个 Y.Doc）
 */
export function setupCollabWS(server) {
  const wss = new WebSocketServer({ noServer: true });

  server.on('upgrade', (req, socket, head) => {
    if (!req.url.includes('/collab')) return; // 让其他 upgrade handler 处理
    handleUpgrade(wss, req, socket, head);
  });

  wss.on('connection', (ws, req) => {
    handleConnection(ws, req);
  });
}

async function handleUpgrade(wss, req, socket, head) {
  const url = new URL(req.url, 'http://localhost');
  const token = url.searchParams.get('token');
  const payload = verifyToken(token);
  if (!payload) {
    socket.destroy();
    return;
  }

  const match = url.pathname.match(/\/api\/projects\/([^/]+)\/collab/);
  if (!match) return socket.destroy();
  const projectId = match[1];
  const file = url.searchParams.get('file');
  if (!file) return socket.destroy();

  // 校验项目存在
  const { rows } = await db.query('SELECT source_path FROM projects WHERE id = $1', [projectId]);
  if (!rows[0] || !rows[0].source_path) {
    socket.destroy();
    return;
  }

  // ★ P0-A2 修复：file 路径穿越/符号链接逃逸防护（词法校验 + realpath 双重）
  // 原实现 file 原样进 path.join(sourcePath, file) -> ../../ 可读写项目外任意路径（含 .git/hooks RCE）
  const sourcePath = rows[0].source_path;
  const baseResolved = path.resolve(sourcePath);
  let fileResolved;
  try {
    fileResolved = path.resolve(baseResolved, file);
    const relCheck = path.relative(baseResolved, fileResolved);
    if (relCheck === '' || relCheck.startsWith('..') || path.isAbsolute(relCheck)) {
      socket.destroy();
      return;
    }
    // 已存在文件：realpath 解析符号链接后必须仍在项目内
    if (fs.existsSync(fileResolved)) {
      const realBase = fs.realpathSync(baseResolved);
      const realFile = fs.realpathSync(fileResolved);
      const realRel = path.relative(realBase, realFile);
      if (realRel.startsWith('..') || path.isAbsolute(realRel)) {
        socket.destroy();
        return;
      }
    }
  } catch {
    socket.destroy();
    return;
  }

  req._collabCtx = {
    projectId,
    file,
    sourcePath,
    userId: payload.id,
    username: payload.username,
  };

  wss.handleUpgrade(req, socket, head, (ws) => {
    wss.emit('connection', ws, req);
  });
}

async function handleConnection(ws, req) {
  const { projectId, file, sourcePath, userId, username } = req._collabCtx;
  const roomName = `${projectId}:${file}`;

  // 获取或创建房间
  let room = rooms.get(roomName);
  if (!room) {
    room = await createRoom(roomName, projectId, file, sourcePath);
    rooms.set(roomName, room);
  }

  room.connections.add(ws);
  ws._room = room;
  ws._roomName = roomName;
  ws._userId = userId;
  ws._username = username;

  console.log(`[collab] ${username} joined ${roomName} (${room.connections.size} users)`);

  // 🚨 不主动发 sync step 1！
  // y-websocket client 连接成功后会主动发 sync step 1（见 y-websocket.js:207-211）。
  // 如果 server 也发 sync step 1，会触发 client 回 sync step 2（含 client ydoc 全部内容）。
  // 重连场景：client ydoc 内存里仍有上次 sync 的完整内容，server 重启后房间内存清空，
  // client 把完整 ydoc 作为 update 推回 server -> applyUpdate 后 ytext 爆炸增长（1500+倍）。
  // 正确流程：client 发 step 1 -> server 回 step 2（推内容给 client）。server 永远是响应方。

  // 发送 awareness query（询问其他客户端的 awareness）
  const encoder = encoding.createEncoder();
  encoding.writeVarUint(encoder, messageQueryAwareness);
  send(ws, encoding.toUint8Array(encoder));

  // 处理消息
  ws.on('message', (data) => handleMessage(ws, data, room));

  ws.on('close', () => {
    room.connections.delete(ws);
    console.log(`[collab] ${username} left ${roomName} (${room.connections.size} users)`);

    // 清理该用户的 awareness 状态
    if (room.awareness.states.has(userId)) {
      room.awareness.states.delete(userId);
    }
    broadcastAwareness(room);

    if (room.connections.size === 0) {
      // 最后一个用户离开，保存并清理房间
      saveRoom(room).finally(() => {
        if (room.saveTimer) clearTimeout(room.saveTimer);
        rooms.delete(roomName);
        console.log(`[collab] Room ${roomName} closed and saved`);
      });
    }
  });

  ws.on('error', () => {
    room.connections.delete(ws);
  });
}

// 创建房间：从文件加载内容到 Y.Doc
async function createRoom(roomName, projectId, file, sourcePath) {
  const doc = new Y.Doc();
  // 🚨 固定 server 的 clientID，避免重启后 clientID 变化导致内容追加翻倍。
  // 问题根因：server 每次 new Y.Doc() 会随机生成新 clientID。client 内存里存的旧 server
  // clientID 内容，重连后 server 用新 clientID 推内容，client applyUpdate 认为是"新内容"
  // 直接 insert，和已有内容叠加 -> 每次 sync step 2 都追加完整内容 -> 翻倍（2^n 增长）。
  // 固定 clientID 后，client SV 里就有这个 clientID，encodeStateAsUpdate 不会把内容当"缺失"发给 client。
  doc.clientID = 1;  // 固定值，1 表示 server
  const awareness = new awarenessProtocol.Awareness(doc);
  const ytext = doc.getText('content');

  // 读取文件内容作为初始值
  const fullPath = path.join(sourcePath, file);
  try {
    if (fs.existsSync(fullPath)) {
      const content = fs.readFileSync(fullPath, 'utf-8');
      if (content) ytext.insert(0, content);
    }
  } catch (e) {
    console.error(`[collab] Load file error: ${e.message}`);
  }

  const room = {
    doc,
    awareness,
    ytext,
    connections: new Set(),
    sourcePath,
    file,
    saveTimer: null,
    lastSave: Date.now(),
  };

  // 监听文档变化，debounce 保存
  doc.on('update', () => {
    scheduleSave(room);
  });

  return room;
}

// 处理客户端消息
function handleMessage(ws, data, room) {
  const buf = data instanceof Buffer ? data : Buffer.from(data);
  const decoder = decoding.createDecoder(new Uint8Array(buf));
  const messageType = decoding.readVarUint(decoder);

  switch (messageType) {
    case messageSync: {
      // sync 协议：处理 sync step 1/2 和 update
      const encoder = encoding.createEncoder();
      encoding.writeVarUint(encoder, messageSync);
      const syncMessageType = syncProtocol.readSyncMessage(decoder, encoder, room.doc, ws);
      const respBuf = encoding.toUint8Array(encoder);
      console.log(`[collab] sync msg type=${syncMessageType} respLen=${respBuf.length} ytextLen=${room.ytext.length} room=${room.file}`);

      // 有响应（sync step 2 回复 sync step 1）则发回发送者
      if (respBuf.length > 1) {
        send(ws, respBuf);
      }

      // 仅 update 消息广播给其他客户端（实时协作核心）。
      // sync step 1 是请求、sync step 2 是定向回复，都不应广播。
      // 之前诊断"内容翻倍"问题时误把整段 broadcast 删掉，导致 A 的编辑永远到不了 B。
      // 翻倍根因是 server 每次 new Y.Doc() 随机 clientID，已在 createRoom 固定为 1 解决。
      if (syncMessageType === syncProtocol.messageYjsUpdate) {
        broadcast(buf, ws, room);
      }
      break;
    }
    case messageAwareness: {
      // awareness 更新：应用到本地 awareness，转发给所有客户端
      try {
        const awData = decoding.readVarUint8Array(decoder);
        awarenessProtocol.applyAwarenessUpdate(
          room.awareness,
          awData,
          ws
        );
      } catch (e) {
        console.error('[collab] Awareness apply error:', e.message);
      }
      broadcast(buf, ws, room);
      break;
    }
    case messageQueryAwareness: {
      // 查询 awareness：返回当前状态
      const encoder = encoding.createEncoder();
      encoding.writeVarUint(encoder, messageAwareness);
      encoding.writeVarUint8Array(
        encoder,
        awarenessProtocol.encodeAwarenessUpdate(
          room.awareness,
          Array.from(room.awareness.states.keys())
        )
      );
      send(ws, encoding.toUint8Array(encoder));
      break;
    }
  }
}

// 发送 sync step 1
function sendSyncStep1(ws, doc) {
  const encoder = encoding.createEncoder();
  encoding.writeVarUint(encoder, messageSync);
  syncProtocol.writeSyncStep1(encoder, doc);
  send(ws, encoding.toUint8Array(encoder));
}

// 广播 awareness 给所有连接
function broadcastAwareness(room) {
  const encoder = encoding.createEncoder();
  encoding.writeVarUint(encoder, messageAwareness);
  encoding.writeVarUint8Array(
    encoder,
    awarenessProtocol.encodeAwarenessUpdate(
      room.awareness,
      Array.from(room.awareness.states.keys())
    )
  );
  const data = encoding.toUint8Array(encoder);
  for (const conn of room.connections) {
    send(conn, data);
  }
}

// 广播消息给除 sender 外的所有连接
function broadcast(data, sender, room) {
  for (const conn of room.connections) {
    if (conn !== sender) {
      send(conn, data);
    }
  }
}

// 发送二进制数据
function send(ws, data) {
  if (ws.readyState === 1) {
    // 优化：小数据合并，大数据直接发
    if (data instanceof Uint8Array) {
      ws.send(Buffer.from(data));
    } else {
      ws.send(data);
    }
  }
}

// debounce 保存文档到文件系统
function scheduleSave(room) {
  if (room.saveTimer) clearTimeout(room.saveTimer);
  room.saveTimer = setTimeout(() => {
    saveRoom(room).catch(e => console.error('[collab] Save error:', e.message));
  }, 2000); // 2秒 debounce
}

// 保存 Y.Doc 内容到文件
async function saveRoom(room) {
  try {
    const content = room.ytext.toString();
    const fullPath = path.join(room.sourcePath, room.file);
    const dir = path.dirname(fullPath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(fullPath, content);
    room.lastSave = Date.now();
  } catch (e) {
    console.error(`[collab] Save error: ${e.message}`);
  }
}

/** 获取项目的所有活跃协作房间（用于状态查询） */
export function getProjectRooms(projectId) {
  const result = [];
  for (const [name, room] of rooms) {
    if (name.startsWith(projectId + ':')) {
      result.push({
        file: room.file,
        users: Array.from(room.connections).map(ws => ({
          id: ws._userId,
          name: ws._username,
        })),
      });
    }
  }
  return result;
}

