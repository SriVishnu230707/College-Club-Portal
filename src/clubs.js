import sharp from 'sharp';

export function expireJoinRequests(db) {
  db.prepare(`
    UPDATE club_join_requests
    SET status = 'expired', id_card_photo = NULL, id_card_mime = NULL,
        id_card_iv = NULL, id_card_tag = NULL
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

export function createImageWorkLimit(maxActive = 4) {
  let active = 0;
  return (_req, res, next) => {
    if (active >= maxActive) {
      return res.set('Retry-After', '1').status(503).json({ error: 'Image processing is busy. Try again shortly.' });
    }
    active += 1;
    let released = false;
    const release = () => {
      if (released) return;
      released = true;
      active -= 1;
    };
    res.once('finish', release);
    res.once('close', release);
    return next();
  };
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

export async function sanitizeIdCard(buffer, declaredMime) {
  const formats = { 'image/jpeg': 'jpeg', 'image/png': 'png', 'image/webp': 'webp' };
  if (!Buffer.isBuffer(buffer) || buffer.length === 0 || buffer.length > 2 * 1024 * 1024 ||
      !Object.hasOwn(formats, declaredMime)) return null;
  try {
    const image = sharp(buffer, { limitInputPixels: 20_000_000, failOn: 'error', animated: false });
    const metadata = await image.metadata();
    if (metadata.format !== formats[declaredMime] || (metadata.pages ?? 1) !== 1 ||
        metadata.width < 100 || metadata.height < 100) return null;
    const photo = await image.rotate().flatten({ background: '#fff' })
      .resize({ width: 2500, height: 2500, fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality: 80 }).toBuffer();
    return photo.length <= 2 * 1024 * 1024 ? photo : null;
  } catch {
    return null;
  }
}
