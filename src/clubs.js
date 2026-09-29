export function expireJoinRequests(db) {
  db.prepare(`
    UPDATE club_join_requests
    SET status = 'expired', id_card_photo = NULL, id_card_mime = NULL
    WHERE status = 'pending' AND expires_at <= ?
  `).run(new Date().toISOString());
}

export function pagination(query) {
  const limit = query.limit === undefined ? 50 : Number(query.limit);
  const cursor = query.cursor === undefined ? '' : query.cursor;
  if (!Number.isInteger(limit) || limit < 1 || limit > 100 ||
      typeof cursor !== 'string' || cursor.length > 128) return null;
  return { limit, cursor };
}

export function page(rows, limit, key = 'id') {
  const items = rows.slice(0, limit);
  return { items, nextCursor: rows.length > limit ? items.at(-1)[key] : null };
}

export function clubInput(body, partial = false) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return null;
  if (partial && !['name', 'slug', 'description', 'status'].some(key => key in body)) return null;
  const name = typeof body.name === 'string' ? body.name.trim() : '';
  const slug = typeof body.slug === 'string' ? body.slug.trim().toLowerCase() : '';
  const description = typeof body.description === 'string' ? body.description.trim() : '';
  const status = body.status ?? 'draft';
  if ((!partial || 'name' in body) && (name.length < 2 || name.length > 100)) return null;
  if ((!partial || 'slug' in body) && !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) return null;
  if ((!partial || 'slug' in body) && slug.length > 80) return null;
  if ('description' in body && typeof body.description !== 'string') return null;
  if ((!partial || 'description' in body) && description.length > 2000) return null;
  if ((!partial || 'status' in body) && !['draft', 'published', 'archived'].includes(status)) return null;
  return partial
    ? Object.fromEntries(['name', 'slug', 'description', 'status'].filter(key => key in body)
      .map(key => [key, { name, slug, description, status }[key]]))
    : { name, slug, description, status };
}

export function imageMime(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 12 || buffer.length > 2 * 1024 * 1024) return null;
  if (buffer.subarray(0, 3).equals(Buffer.from([0xff, 0xd8, 0xff]))) return 'image/jpeg';
  if (buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
  if (buffer.toString('ascii', 0, 4) === 'RIFF' && buffer.toString('ascii', 8, 12) === 'WEBP') return 'image/webp';
  return null;
}
