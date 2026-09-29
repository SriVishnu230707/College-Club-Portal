export const eventColumns = `
  e.id, e.club_id AS clubId, e.title, e.description, e.location,
  e.starts_at AS startsAt, e.ends_at AS endsAt, e.capacity, e.audience, e.status,
  e.created_at AS createdAt, e.updated_at AS updatedAt,
  (SELECT COUNT(*) FROM event_registrations r WHERE r.event_id = e.id) AS registeredCount
`;

const editable = ['clubId', 'title', 'description', 'location', 'startsAt', 'endsAt',
  'capacity', 'audience', 'status'];

function isoUtc(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)) {
    return false;
  }
  const date = new Date(value);
  return Number.isFinite(date.getTime()) && date.toISOString() === value;
}

export function eventInput(body, current = null) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return null;
  const keys = Object.keys(body);
  if ((current && keys.length === 0) || keys.some(key => !editable.includes(key))) return null;
  const event = {
    clubId: body.clubId ?? current?.clubId,
    title: body.title ?? current?.title,
    description: body.description ?? current?.description ?? '',
    location: body.location ?? current?.location,
    startsAt: body.startsAt ?? current?.startsAt,
    endsAt: body.endsAt ?? current?.endsAt,
    capacity: body.capacity ?? current?.capacity,
    audience: body.audience ?? current?.audience ?? 'club_members',
    status: body.status ?? current?.status ?? 'draft'
  };
  if (keys.some(key => body[key] === null)) return null;
  if (typeof event.clubId !== 'string' || !/^[0-9a-f-]{36}$/.test(event.clubId)) return null;
  if (typeof event.title !== 'string' || event.title.trim().length < 2 || event.title.trim().length > 150) return null;
  if (typeof event.description !== 'string' || event.description.trim().length > 5000) return null;
  if (typeof event.location !== 'string' || event.location.trim().length < 2 || event.location.trim().length > 200) return null;
  if (!isoUtc(event.startsAt) || !isoUtc(event.endsAt) || event.endsAt <= event.startsAt) return null;
  if (!Number.isInteger(event.capacity) || event.capacity < 1 || event.capacity > 10000) return null;
  if (!['club_members', 'all_members'].includes(event.audience)) return null;
  if (!['draft', 'published', 'cancelled'].includes(event.status)) return null;
  return { ...event, title: event.title.trim(), description: event.description.trim(), location: event.location.trim() };
}
