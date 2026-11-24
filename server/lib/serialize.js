import { all, get, jsonParse } from '../db.js';

export function publicUser(row) {
  if (!row) return null;
  return {
    id: row.id,
    username: row.username,
    displayName: row.display_name,
    avatarUrl: row.avatar_url || null,
    bannerColor: row.banner_color,
    bio: row.bio,
    status: row.status,
    customStatus: row.custom_status,
    isAdmin: !!row.is_admin,
    createdAt: row.created_at,
  };
}

export function selfUser(row) {
  return {
    ...publicUser(row),
    email: row.email,
    preferences: jsonParse(row.preferences, {}),
    suspended: !!row.suspended,
  };
}

export function userRef(row) {
  if (!row) return null;
  return {
    id: row.id,
    username: row.username,
    displayName: row.display_name,
    avatarUrl: row.avatar_url || null,
  };
}

/** Attach authors and reaction summaries to a list of raw message rows. */
export function serializeMessages(rows, viewerId) {
  if (!rows.length) return [];
  const ids = rows.map((r) => r.id);
  const placeholders = ids.map(() => '?').join(',');
  const reactions = all(
    `SELECT message_id, emoji, user_id FROM reactions WHERE message_id IN (${placeholders})`,
    ...ids,
  );
  const reactionMap = new Map();
  for (const r of reactions) {
    if (!reactionMap.has(r.message_id)) reactionMap.set(r.message_id, new Map());
    const byEmoji = reactionMap.get(r.message_id);
    if (!byEmoji.has(r.emoji)) byEmoji.set(r.emoji, { emoji: r.emoji, count: 0, me: false });
    const entry = byEmoji.get(r.emoji);
    entry.count += 1;
    if (r.user_id === viewerId) entry.me = true;
  }

  const authorIds = [...new Set(rows.map((r) => r.author_id))];
  const authors = new Map(
    all(`SELECT * FROM users WHERE id IN (${authorIds.map(() => '?').join(',')})`, ...authorIds)
      .map((u) => [u.id, u]),
  );

  const replyIds = rows.map((r) => r.reply_to).filter(Boolean);
  const replies = new Map();
  if (replyIds.length) {
    const replyRows = all(
      `SELECT m.id, m.content, m.author_id, u.display_name FROM messages m
       LEFT JOIN users u ON u.id = m.author_id
       WHERE m.id IN (${replyIds.map(() => '?').join(',')})`,
      ...replyIds,
    );
    for (const r of replyRows) {
      replies.set(r.id, {
        id: r.id,
        content: r.content.slice(0, 180),
        authorName: r.display_name || 'Desconhecido',
      });
    }
  }

  return rows.map((row) => {
    const byEmoji = reactionMap.get(row.id);
    const stickers = row.sticker_id
      ? get('SELECT id, name, url FROM stickers WHERE id = ?', row.sticker_id)
      : null;
    return {
      id: row.id,
      scopeType: row.scope_type,
      scopeId: row.scope_id,
      content: row.content,
      attachments: jsonParse(row.attachments, []),
      sticker: stickers || null,
      replyTo: row.reply_to ? replies.get(row.reply_to) || { id: row.reply_to } : null,
      author: userRef(authors.get(row.author_id)) || { id: row.author_id, username: 'desconhecido', displayName: 'Desconhecido', avatarUrl: null },
      reactions: byEmoji ? [...byEmoji.values()] : [],
      pinned: !!row.pinned,
      system: !!row.system,
      editedAt: row.edited_at,
      createdAt: row.created_at,
    };
  });
}

export function serializeMessage(row, viewerId) {
  return serializeMessages([row], viewerId)[0];
}
