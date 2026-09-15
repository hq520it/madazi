import { v4 as uuid } from 'uuid';
import { db } from '../db/init.js';

// ============ 会话 CRUD ============

// 获取项目的所有会话（按更新时间倒序）
// ★ 同时返回每个会话最后一条 AI 消息的状态，供前端 TaskList 显示 ✓/loading
export async function getConversations(projectId) {
  const { rows } = await db.query(
    `SELECT c.id, c.title, c.last_message, c.created_at, c.updated_at,
            c.user_id, u.username AS created_by,
            (SELECT m.status FROM conversation_messages m
             WHERE m.conversation_id = c.id AND m.role = 'ai'
             ORDER BY m.created_at DESC LIMIT 1) AS last_ai_status
     FROM conversations c
     LEFT JOIN users u ON u.id = c.user_id
     WHERE c.project_id = $1
     ORDER BY c.updated_at DESC`,
    [projectId]
  );
  return rows.map(r => ({
    id: r.id,
    title: r.title,
    lastMessage: r.last_message,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    lastAiStatus: r.last_ai_status || 'idle',
    userId: r.user_id,
    createdBy: r.created_by,
  }));
}

// 获取单个会话（含消息列表）
export async function getConversation(projectId, conversationId) {
  const { rows } = await db.query(
    `SELECT id, title, last_message, created_at, updated_at
     FROM conversations
     WHERE id = $1 AND project_id = $2`,
    [conversationId, projectId]
  );
  if (!rows[0]) return null;

  const msgRows = await db.query(
    `SELECT m.id, m.role, m.content, m.task_id, m.status, m.commit_hash, m.modified_files, m.error, m.engine, m.created_at,
            m.user_id, u.username AS user_name
     FROM conversation_messages m
     LEFT JOIN users u ON u.id = m.user_id
     WHERE m.conversation_id = $1
     ORDER BY m.created_at ASC`,
    [conversationId]
  );

  return {
    id: rows[0].id,
    title: rows[0].title,
    lastMessage: rows[0].last_message,
    createdAt: rows[0].created_at,
    updatedAt: rows[0].updated_at,
    messages: msgRows.rows.map(m => ({
      id: m.id,
      role: m.role,
      content: m.content,
      taskId: m.task_id,
      status: m.status,
      commitHash: m.commit_hash,
      modifiedFiles: m.modified_files ? JSON.parse(m.modified_files) : [],
      error: m.error,
      createdAt: m.created_at,
      userId: m.user_id,
      username: m.user_name,
    })),
  };
}

// 创建会话
export async function createConversation(projectId, userId, title) {
  const id = uuid();
  const finalTitle = (title || '新对话').slice(0, 60);
  await db.query(
    `INSERT INTO conversations (id, project_id, user_id, title)
     VALUES ($1, $2, $3, $4)`,
    [id, projectId, userId, finalTitle]
  );
  console.log(`[conversations] Created ${id} for project ${projectId}: ${finalTitle}`);
  return { id, title: finalTitle };
}

// 重命名会话
export async function renameConversation(projectId, conversationId, title) {
  const result = await db.query(
    `UPDATE conversations SET title = $1, updated_at = NOW()
     WHERE id = $2 AND project_id = $3`,
    [title.slice(0, 60), conversationId, projectId]
  );
  return result.rowCount > 0;
}

// 删除会话（消息级联删除由外键 ON DELETE CASCADE 处理）
export async function deleteConversation(projectId, conversationId) {
  const result = await db.query(
    `DELETE FROM conversations WHERE id = $1 AND project_id = $2`,
    [conversationId, projectId]
  );
  return result.rowCount > 0;
}

// ★ Fork 会话：从指定消息处分叉新会话，复制到该点为止的所有消息
export async function forkConversation(projectId, conversationId, forkMessageId, userId) {
  const newId = uuid();
  // 1. 获取原会话信息
  const conv = await db.query(
    `SELECT title FROM conversations WHERE id = $1 AND project_id = $2`,
    [conversationId, projectId]
  );
  if (!conv.rows[0]) throw new Error('会话不存在');
  const baseTitle = conv.rows[0].title || '对话';
  const forkTitle = `${baseTitle} (分支)`.slice(0, 60);

  // 2. 创建新会话，标记为 fork
  await db.query(
    `INSERT INTO conversations (id, project_id, user_id, title, parent_conv_id, fork_msg_id, is_fork)
     VALUES ($1, $2, $3, $4, $5, $6, true)`,
    [newId, projectId, userId, forkTitle, conversationId, forkMessageId]
  );

  // 3. 获取到 fork 点为止的消息（含 forkMessageId 本身）
  const msgs = await db.query(
    `SELECT id, role, content, task_id, status, commit_hash, modified_files, error, engine, created_at, user_id
     FROM conversation_messages
     WHERE conversation_id = $1
       AND created_at <= (SELECT created_at FROM conversation_messages WHERE id = $2)
     ORDER BY created_at ASC`,
    [conversationId, forkMessageId]
  );

  // 4. 复制消息到新会话（新 ID，保留内容和元数据）
  for (const m of msgs.rows) {
    const newMsgId = uuid();
    await db.query(
      `INSERT INTO conversation_messages (id, conversation_id, role, content, task_id, status, commit_hash, modified_files, error, user_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
      [
        newMsgId, newId, m.role, m.content, null, m.status,
        m.commit_hash, m.modified_files, m.error, m.user_id
      ]
    );
  }

  // 5. 更新 last_message
  const lastMsg = msgs.rows[msgs.rows.length - 1];
  if (lastMsg) {
    await db.query(
      `UPDATE conversations SET last_message = $1 WHERE id = $2`,
      [lastMsg.content?.slice(0, 100) || '', newId]
    );
  }

  console.log(`[conversations] Forked ${conversationId} @ msg ${forkMessageId} -> new conv ${newId}, copied ${msgs.rows.length} messages`);
  return { id: newId, title: forkTitle, messageCount: msgs.rows.length };
}

// ============ 消息管理 ============

// ★ 截断指定消息之后的所有消息（用于编辑/重新生成）
export async function truncateMessagesAfter(conversationId, messageId) {
  // 获取该消息的 created_at
  const { rows } = await db.query(
    `SELECT created_at FROM conversation_messages WHERE id = $1 AND conversation_id = $2`,
    [messageId, conversationId]
  );
  if (!rows[0]) throw new Error('消息不存在');

  // 删除该消息之后的所有消息（不含该消息本身）
  await db.query(
    `DELETE FROM conversation_messages
     WHERE conversation_id = $1 AND created_at > $2`,
    [conversationId, rows[0].created_at]
  );

  // 更新 last_message
  const lastMsg = await db.query(
    `SELECT content FROM conversation_messages WHERE conversation_id = $1 ORDER BY created_at DESC LIMIT 1`,
    [conversationId]
  );
  if (lastMsg.rows[0]) {
    await db.query(
      `UPDATE conversations SET last_message = $1, updated_at = NOW() WHERE id = $2`,
      [lastMsg.rows[0].content?.slice(0, 100) || '', conversationId]
    );
  }
}

// ★ 更新用户消息内容（用于编辑后重发）
export async function updateUserMessageContent(messageId, content) {
  const safeContent = content.replace(/\0/g, '');
  await db.query(
    `UPDATE conversation_messages SET content = $1 WHERE id = $2`,
    [safeContent, messageId]
  );
  // 更新会话的 last_message 和标题
  const convRow = await db.query(
    `SELECT conversation_id FROM conversation_messages WHERE id = $1`,
    [messageId]
  );
  if (convRow.rows[0]) {
    const convId = convRow.rows[0].conversation_id;
    await db.query(
      `UPDATE conversations
       SET last_message = $1, updated_at = NOW()
       WHERE id = $2`,
      [safeContent.slice(0, 100), convId]
    );
  }
}

// 添加用户消息
export async function addUserMessage(conversationId, content, userId) {
  // ★ 清除 NULL 字符，PostgreSQL UTF8 不允许 \0
  const safeContent = content.replace(/\0/g, '');
  const id = uuid();
  await db.query(
    `INSERT INTO conversation_messages (id, conversation_id, role, content, user_id)
     VALUES ($1, $2, 'user', $3, $4)`,
    [id, conversationId, safeContent, userId || null]
  );
  // 更新会话的 last_message 和 updated_at，并把标题设为第一条用户消息（如果之前是默认标题）
  await db.query(
    `UPDATE conversations
     SET last_message = $1, updated_at = NOW(),
         title = CASE WHEN title = '新对话' THEN $2 ELSE title END
     WHERE id = $3`,
    [safeContent.slice(0, 100), safeContent.slice(0, 60), conversationId]
  );
  return id;
}

// 添加 AI 消息（占位，后续更新）
export async function addAiMessage(conversationId, taskId) {
  const id = uuid();
  await db.query(
    `INSERT INTO conversation_messages (id, conversation_id, role, content, task_id, status)
     VALUES ($1, $2, 'ai', '', $3, 'pending')`,
    [id, conversationId, taskId]
  );
  await db.query(
    `UPDATE conversations SET updated_at = NOW() WHERE id = $1`,
    [conversationId]
  );
  return id;
}

// 更新 AI 消息（任务完成/失败时）
export async function updateAiMessage(messageId, { status, content, commitHash, modifiedFiles, error, engine }) {
  const fields = [];
  const values = [];
  let idx = 1;
  // 清除 null bytes（AI 输出可能包含 \x00，PG UTF8 不接受）
  const sanitize = (v) => (typeof v === 'string' ? v.replace(/\0/g, '') : v);
  if (status !== undefined) { fields.push(`status = $${idx++}`); values.push(status); }
  if (content !== undefined) { fields.push(`content = $${idx++}`); values.push(sanitize(content)); }
  if (commitHash !== undefined) { fields.push(`commit_hash = $${idx++}`); values.push(commitHash); }
  if (modifiedFiles !== undefined) { fields.push(`modified_files = $${idx++}`); values.push(JSON.stringify(modifiedFiles)); }
  if (error !== undefined) { fields.push(`error = $${idx++}`); values.push(sanitize(error)); }
  if (engine !== undefined) { fields.push(`engine = $${idx++}`); values.push(engine); }
  values.push(messageId);
  await db.query(
    `UPDATE conversation_messages SET ${fields.join(', ')} WHERE id = $${idx}`,
    values
  );
}

// ★ P1：按 task_id 查 AI 消息（SSE 兜底收尾用，不依赖 server 内存任务对象）
export async function getAiMessageByTaskId(taskId) {
  const { rows } = await db.query(
    `SELECT id, status, content, error, commit_hash, modified_files
     FROM conversation_messages WHERE task_id = $1 ORDER BY created_at DESC LIMIT 1`,
    [taskId]
  );
  return rows[0] || null;
}

// ★ P1：按 task_id 更新 AI 消息（幂等兜底：worker/SSE 双写，后到者覆盖同值）
export async function updateAiMessageByTaskId(taskId, fields) {
  const msg = await getAiMessageByTaskId(taskId);
  if (!msg) return false;
  await updateAiMessage(msg.id, fields);
  return true;
}

// 获取会话所有消息（用于给 AI 提供上下文）
export async function getConversationMessages(conversationId) {
  const { rows } = await db.query(
    `SELECT role, content, status, commit_hash, modified_files, error
     FROM conversation_messages
     WHERE conversation_id = $1
     ORDER BY created_at ASC`,
    [conversationId]
  );
  return rows.map(m => ({
    role: m.role,
    content: m.content,
    status: m.status,
    commitHash: m.commit_hash,
    modifiedFiles: m.modified_files ? JSON.parse(m.modified_files) : [],
    error: m.error,
  }));
}

// 更新 AI 消息内容（流式更新时持续追加）
export async function appendAiContent(messageId, chunk) {
  await db.query(
    `UPDATE conversation_messages
     SET content = content || $1
     WHERE id = $2`,
    [typeof chunk === 'string' ? chunk.replace(/\0/g, '') : chunk, messageId]
  );
}
