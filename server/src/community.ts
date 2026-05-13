/**
 * Community & Forums Module — Phase 15
 * Manages communities, threads, replies, and votes.
 * Each book auto-gets a discussion forum. Users can create custom communities.
 */

import { getPgPool } from './pgDatabase.js';
import { llmComplete } from './hermes.js';

// ── Helpers ──

function slugify(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .substring(0, 80);
}

// ── Communities ──

export async function getCommunities(limit = 50, offset = 0) {
  const pool = getPgPool();
  const res = await pool.query(`
    SELECT c.*, u.display_name as creator_name,
           (SELECT COUNT(*) FROM threads t WHERE t.community_id = c.id) as thread_count
    FROM communities c
    LEFT JOIN users u ON u.id = c.created_by
    WHERE c.type != 'private'
    ORDER BY c.member_count DESC, c.created_at DESC
    LIMIT $1 OFFSET $2
  `, [limit, offset]);
  return res.rows;
}

export async function getCommunityBySlug(slug: string) {
  const pool = getPgPool();
  const res = await pool.query(`
    SELECT c.*, u.display_name as creator_name,
           (SELECT COUNT(*) FROM threads t WHERE t.community_id = c.id) as thread_count
    FROM communities c
    LEFT JOIN users u ON u.id = c.created_by
    WHERE c.slug = $1
  `, [slug]);
  return res.rows[0] || null;
}

export async function getCommunityById(id: number) {
  const pool = getPgPool();
  const res = await pool.query('SELECT * FROM communities WHERE id = $1', [id]);
  return res.rows[0] || null;
}

export async function getBookCommunity(bookId: number) {
  const pool = getPgPool();
  const res = await pool.query('SELECT * FROM communities WHERE book_id = $1', [bookId]);
  return res.rows[0] || null;
}

/** Auto-create a community for a book if it doesn't exist */
export async function getOrCreateBookCommunity(bookId: number, bookTitle: string) {
  let community = await getBookCommunity(bookId);
  if (community) return community;

  const pool = getPgPool();
  const slug = `libro-${bookId}-${slugify(bookTitle)}`;
  
  const res = await pool.query(`
    INSERT INTO communities (name, slug, description, type, book_id, created_by)
    VALUES ($1, $2, $3, 'public', $4, '00000000-0000-0000-0000-000000000001')
    ON CONFLICT (slug) DO NOTHING
    RETURNING *
  `, [
    bookTitle,
    slug,
    `Espacio de discusión para "${bookTitle}"`,
    bookId,
  ]);

  return res.rows[0] || await getBookCommunity(bookId);
}

export async function createCommunity(
  name: string, description: string, rules: string,
  type: string, createdBy: string,
) {
  const pool = getPgPool();
  const slug = slugify(name) + '-' + Date.now().toString(36);

  const res = await pool.query(`
    INSERT INTO communities (name, slug, description, rules, type, created_by, member_count)
    VALUES ($1, $2, $3, $4, $5, $6, 1)
    RETURNING *
  `, [name, slug, description, rules, type, createdBy]);

  // Creator is automatically a member with 'creator' role
  await pool.query(`
    INSERT INTO community_members (community_id, user_id, role)
    VALUES ($1, $2, 'creator')
  `, [res.rows[0].id, createdBy]);

  return res.rows[0];
}

export async function updateCommunity(id: number, updates: Record<string, string>) {
  const pool = getPgPool();
  const keys = Object.keys(updates).filter(k => ['name', 'description', 'rules', 'avatar_url', 'banner_url'].includes(k));
  if (keys.length === 0) return;
  const setClauses = keys.map((k, i) => `${k} = $${i + 1}`).join(', ');
  const values = keys.map(k => updates[k]);
  values.push(String(id));
  await pool.query(`UPDATE communities SET ${setClauses} WHERE id = $${values.length}`, values);
}

export async function joinCommunity(communityId: number, userId: string) {
  const pool = getPgPool();
  await pool.query(`
    INSERT INTO community_members (community_id, user_id, role)
    VALUES ($1, $2, 'member')
    ON CONFLICT DO NOTHING
  `, [communityId, userId]);
  await pool.query('UPDATE communities SET member_count = member_count + 1 WHERE id = $1', [communityId]);
}

export async function leaveCommunity(communityId: number, userId: string) {
  const pool = getPgPool();
  const res = await pool.query(
    'DELETE FROM community_members WHERE community_id = $1 AND user_id = $2 AND role != $3 RETURNING *',
    [communityId, userId, 'creator'],
  );
  if (res.rowCount && res.rowCount > 0) {
    await pool.query('UPDATE communities SET member_count = GREATEST(member_count - 1, 0) WHERE id = $1', [communityId]);
  }
  return (res.rowCount ?? 0) > 0;
}

export async function getCommunityMembers(communityId: number) {
  const pool = getPgPool();
  const res = await pool.query(`
    SELECT cm.*, u.display_name, u.avatar_url
    FROM community_members cm
    JOIN users u ON u.id = cm.user_id
    WHERE cm.community_id = $1
    ORDER BY cm.role ASC, cm.joined_at ASC
  `, [communityId]);
  return res.rows;
}

export async function isMember(communityId: number, userId: string): Promise<boolean> {
  const pool = getPgPool();
  const res = await pool.query(
    'SELECT 1 FROM community_members WHERE community_id = $1 AND user_id = $2',
    [communityId, userId],
  );
  return res.rows.length > 0;
}

export async function getMemberRole(communityId: number, userId: string): Promise<string | null> {
  const pool = getPgPool();
  const res = await pool.query(
    'SELECT role FROM community_members WHERE community_id = $1 AND user_id = $2',
    [communityId, userId],
  );
  return res.rows[0]?.role || null;
}

export async function getUserCommunities(userId: string) {
  const pool = getPgPool();
  const res = await pool.query(`
    SELECT c.*, cm.role,
           (SELECT COUNT(*) FROM threads t WHERE t.community_id = c.id) as thread_count
    FROM community_members cm
    JOIN communities c ON c.id = cm.community_id
    WHERE cm.user_id = $1
    ORDER BY c.name ASC
  `, [userId]);
  return res.rows;
}

// ── Threads ──

export async function getThreads(communityId: number, sort: string = 'recent', limit = 30, offset = 0) {
  const pool = getPgPool();
  const orderBy = sort === 'popular' ? 'upvotes DESC, last_activity DESC'
    : sort === 'pinned' ? 'pinned DESC, last_activity DESC'
    : 'last_activity DESC';

  const res = await pool.query(`
    SELECT t.*, u.display_name as author_name, u.avatar_url as author_avatar
    FROM threads t
    JOIN users u ON u.id = t.user_id
    WHERE t.community_id = $1
    ORDER BY t.pinned DESC, ${orderBy}
    LIMIT $2 OFFSET $3
  `, [communityId, limit, offset]);
  return res.rows;
}

export async function getThread(threadId: number) {
  const pool = getPgPool();
  const res = await pool.query(`
    SELECT t.*, u.display_name as author_name, u.avatar_url as author_avatar,
           c.name as community_name, c.slug as community_slug
    FROM threads t
    JOIN users u ON u.id = t.user_id
    JOIN communities c ON c.id = t.community_id
    WHERE t.id = $1
  `, [threadId]);
  return res.rows[0] || null;
}

export async function createThread(
  communityId: number, userId: string, title: string, content: string,
  hasSpoilers = false,
) {
  const pool = getPgPool();

  // AI Moderation — check content with Hermes
  const modResult = await moderateContent(title + ' ' + content);
  if (modResult.blocked) {
    throw new Error(`Contenido bloqueado: ${modResult.reason}`);
  }

  const res = await pool.query(`
    INSERT INTO threads (community_id, user_id, title, content, has_spoilers)
    VALUES ($1, $2, $3, $4, $5)
    RETURNING *
  `, [communityId, userId, title, content, hasSpoilers]);

  // Update last_activity on community
  await pool.query('UPDATE threads SET last_activity = NOW() WHERE id = $1', [res.rows[0].id]);

  return res.rows[0];
}

export async function updateThread(threadId: number, updates: { title?: string; content?: string; pinned?: boolean; locked?: boolean }) {
  const pool = getPgPool();
  const fields: string[] = [];
  const values: unknown[] = [];
  let idx = 1;

  if (updates.title !== undefined) { fields.push(`title = $${idx++}`); values.push(updates.title); }
  if (updates.content !== undefined) { fields.push(`content = $${idx++}`); values.push(updates.content); }
  if (updates.pinned !== undefined) { fields.push(`pinned = $${idx++}`); values.push(updates.pinned); }
  if (updates.locked !== undefined) { fields.push(`locked = $${idx++}`); values.push(updates.locked); }

  if (fields.length === 0) return;
  values.push(threadId);
  await pool.query(`UPDATE threads SET ${fields.join(', ')} WHERE id = $${idx}`, values);
}

export async function deleteThread(threadId: number) {
  const pool = getPgPool();
  await pool.query('DELETE FROM threads WHERE id = $1', [threadId]);
}

// ── Replies ──

export async function getReplies(threadId: number) {
  const pool = getPgPool();
  const res = await pool.query(`
    SELECT r.*, u.display_name as author_name, u.avatar_url as author_avatar
    FROM replies r
    JOIN users u ON u.id = r.user_id
    WHERE r.thread_id = $1
    ORDER BY r.created_at ASC
  `, [threadId]);
  return res.rows;
}

export async function createReply(
  threadId: number, userId: string, content: string, parentReplyId?: number,
) {
  const pool = getPgPool();

  // AI Moderation
  const modResult = await moderateContent(content);
  if (modResult.blocked) {
    throw new Error(`Contenido bloqueado: ${modResult.reason}`);
  }

  const res = await pool.query(`
    INSERT INTO replies (thread_id, user_id, content, parent_reply_id)
    VALUES ($1, $2, $3, $4)
    RETURNING *
  `, [threadId, userId, content, parentReplyId || null]);

  // Update reply count and last_activity
  await pool.query(`
    UPDATE threads SET reply_count = reply_count + 1, last_activity = NOW()
    WHERE id = $1
  `, [threadId]);

  return res.rows[0];
}

export async function deleteReply(replyId: number, threadId: number) {
  const pool = getPgPool();
  await pool.query('DELETE FROM replies WHERE id = $1', [replyId]);
  await pool.query('UPDATE threads SET reply_count = GREATEST(reply_count - 1, 0) WHERE id = $1', [threadId]);
}

// ── Votes ──

export async function vote(userId: string, targetType: 'thread' | 'reply', targetId: number, value: 1 | -1) {
  const pool = getPgPool();

  // Check existing vote
  const existing = await pool.query(
    'SELECT value FROM votes WHERE user_id = $1 AND target_type = $2 AND target_id = $3',
    [userId, targetType, targetId],
  );

  const table = targetType === 'thread' ? 'threads' : 'replies';

  if (existing.rows.length > 0) {
    const oldValue = existing.rows[0].value;
    if (oldValue === value) {
      // Remove vote (toggle off)
      await pool.query('DELETE FROM votes WHERE user_id = $1 AND target_type = $2 AND target_id = $3', [userId, targetType, targetId]);
      await pool.query(`UPDATE ${table} SET upvotes = upvotes - $1 WHERE id = $2`, [value, targetId]);
      return { action: 'removed', newValue: 0 };
    } else {
      // Change vote
      await pool.query('UPDATE votes SET value = $1 WHERE user_id = $2 AND target_type = $3 AND target_id = $4', [value, userId, targetType, targetId]);
      await pool.query(`UPDATE ${table} SET upvotes = upvotes + $1 WHERE id = $2`, [value * 2, targetId]); // remove old + add new
      return { action: 'changed', newValue: value };
    }
  } else {
    // New vote
    await pool.query(
      'INSERT INTO votes (user_id, target_type, target_id, value) VALUES ($1, $2, $3, $4)',
      [userId, targetType, targetId, value],
    );
    await pool.query(`UPDATE ${table} SET upvotes = upvotes + $1 WHERE id = $2`, [value, targetId]);
    return { action: 'voted', newValue: value };
  }
}

export async function getUserVotes(userId: string, targetType: string, targetIds: number[]) {
  if (targetIds.length === 0) return {};
  const pool = getPgPool();
  const res = await pool.query(
    `SELECT target_id, value FROM votes WHERE user_id = $1 AND target_type = $2 AND target_id = ANY($3)`,
    [userId, targetType, targetIds],
  );
  return Object.fromEntries(res.rows.map((r: any) => [r.target_id, r.value]));
}

// ── AI Moderation (Hermes) ──

async function moderateContent(content: string): Promise<{ blocked: boolean; reason: string }> {
  try {
    const result = await llmComplete(
      `Eres un moderador de contenido para un club de lectura esotérica.
Analiza el siguiente texto y determina si debe ser bloqueado.
Bloquea SOLO si contiene: insultos graves, spam, contenido ilegal, o discurso de odio.
Permite: opiniones fuertes, debates, desacuerdos, contenido esotérico/espiritual.
Responde SOLO con JSON: {"blocked": false, "reason": ""} o {"blocked": true, "reason": "motivo"}`,
      content.substring(0, 500),
      200,
    );
    
    if (!result) return { blocked: false, reason: '' };
    
    try {
      const parsed = JSON.parse(result);
      return { blocked: !!parsed.blocked, reason: parsed.reason || '' };
    } catch {
      return { blocked: false, reason: '' };
    }
  } catch {
    // If AI is unavailable, allow content
    return { blocked: false, reason: '' };
  }
}

// ── Forum Hub Queries ──

/** List all book forums (communities with book_id) that have at least 1 thread or were explicitly created */
export async function getBookCommunities(limit = 50, offset = 0) {
  const pool = getPgPool();
  const res = await pool.query(`
    SELECT c.*, u.display_name as creator_name,
           b.title as book_title, b.author as book_author,
           (SELECT COUNT(*) FROM threads t WHERE t.community_id = c.id) as thread_count
    FROM communities c
    LEFT JOIN users u ON u.id = c.created_by
    LEFT JOIN books b ON b.id = c.book_id
    WHERE c.book_id IS NOT NULL
    ORDER BY (SELECT COUNT(*) FROM threads t WHERE t.community_id = c.id) DESC, c.created_at DESC
    LIMIT $1 OFFSET $2
  `, [limit, offset]);
  return res.rows;
}

/** List official forums only */
export async function getOfficialCommunities() {
  const pool = getPgPool();
  const res = await pool.query(`
    SELECT c.*, u.display_name as creator_name,
           (SELECT COUNT(*) FROM threads t WHERE t.community_id = c.id) as thread_count
    FROM communities c
    LEFT JOIN users u ON u.id = c.created_by
    WHERE c.type = 'official'
    ORDER BY c.created_at ASC
  `);
  return res.rows;
}

/** Global activity feed — recent threads from ALL communities */
export async function getRecentThreadsGlobal(limit = 30) {
  const pool = getPgPool();
  const res = await pool.query(`
    SELECT t.*, u.display_name as author_name, u.avatar_url as author_avatar,
           c.name as community_name, c.slug as community_slug, c.book_id,
           c.type as community_type
    FROM threads t
    JOIN users u ON u.id = t.user_id
    JOIN communities c ON c.id = t.community_id
    ORDER BY t.last_activity DESC
    LIMIT $1
  `, [limit]);
  return res.rows;
}

// ── Seed Official Forums ──

export async function seedOfficialForums() {
  const pool = getPgPool();
  const forums = [
    { name: 'Novedades', slug: 'novedades', description: 'Anuncios y actualizaciones de la plataforma', type: 'official' },
    { name: 'Recomendaciones', slug: 'recomendaciones', description: '¿Qué libro me recomiendan sobre X?', type: 'official' },
    { name: 'Lecturas del Mes', slug: 'lecturas-del-mes', description: 'Club de lectura oficial — libro del mes', type: 'official' },
    { name: 'Feedback', slug: 'feedback', description: 'Reporta bugs o sugiere mejoras', type: 'official' },
    { name: 'General', slug: 'general', description: 'Cualquier tema de conversación', type: 'official' },
  ];

  for (const forum of forums) {
    await pool.query(`
      INSERT INTO communities (name, slug, description, type, created_by)
      VALUES ($1, $2, $3, $4, '00000000-0000-0000-0000-000000000001')
      ON CONFLICT (slug) DO NOTHING
    `, [forum.name, forum.slug, forum.description, forum.type]);
  }
  
  console.log('Community official forums seeded');
}
