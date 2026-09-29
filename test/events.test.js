import assert from 'node:assert/strict';
import { test } from 'node:test';
import sharp from 'sharp';
import { createApp } from '../src/app.js';
import { migrate, openDatabase } from '../src/db/index.js';

const jwt = {
  accessSecret: 'test-access-secret-0123456789-abcdef',
  refreshSecret: 'test-refresh-secret-0123456789-abcdef',
  accessSeconds: 900,
  refreshSeconds: 604800
};
const photo = await sharp({ create: { width: 400, height: 250, channels: 3, background: '#336699' } })
  .png().toBuffer();
const future = days => new Date(Date.now() + days * 86400000).toISOString();

async function withApp(run) {
  const db = openDatabase(':memory:');
  migrate(db);
  const server = createApp({ db, jwt, idCardSecret: 'test-id-card-secret-0123456789-abcdef' }).listen(0);
  const base = `http://127.0.0.1:${server.address().port}`;
  const request = (path, method = 'GET', token, body, contentType = 'application/json') => fetch(`${base}${path}`, {
    method,
    headers: {
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(body !== undefined ? { 'content-type': contentType } : {})
    },
    ...(body !== undefined ? { body: Buffer.isBuffer(body) ? body : JSON.stringify(body) } : {})
  });
  async function account(name, role = 'member') {
    const email = `${name}@example.edu`;
    const credentials = { email, password: 'a-long-private-password' };
    assert.equal((await request('/auth/register', 'POST', null, { ...credentials, name })).status, 201);
    if (role === 'admin') db.prepare("UPDATE users SET role = 'admin' WHERE email = ?").run(email);
    const login = await (await request('/auth/login', 'POST', null, credentials)).json();
    return login;
  }
  async function club(admin, status = 'published') {
    const response = await request('/admin/clubs', 'POST', admin, { name: 'Robotics', slug: 'robotics', status });
    assert.equal(response.status, 201);
    return (await response.json()).club;
  }
  async function event(admin, clubId, overrides = {}) {
    const response = await request('/admin/events', 'POST', admin, {
      clubId, title: 'Robot Workshop', description: 'Build a robot', location: 'Lab 1',
      startsAt: future(7), endsAt: future(8), capacity: 20, status: 'published', ...overrides
    });
    assert.equal(response.status, 201);
    return (await response.json()).event;
  }
  try { await run({ db, request, account, club, event }); }
  finally {
    await new Promise(resolve => server.close(resolve));
    db.close();
  }
}

test('visitors see only published events from published clubs; admins manage events', async () => {
  await withApp(async ({ db, request, account, club, event }) => {
    const admin = (await account('admin', 'admin')).accessToken;
    const member = (await account('member')).accessToken;
    const publishedClub = await club(admin);
    assert.equal((await request('/admin/events', 'POST', member, {})).status, 403);
    assert.equal((await request('/admin/events', 'POST', null, {})).status, 401);
    const draft = await event(admin, publishedClub.id, { status: 'draft' });
    assert.equal((await request(`/events/${draft.id}`)).status, 404);
    assert.deepEqual((await (await request('/events')).json()).events, []);
    assert.equal((await request(`/admin/events/${draft.id}`, 'GET', admin)).status, 200);
    assert.equal((await request(`/admin/events/${draft.id}`, 'PATCH', member, { status: 'published' })).status, 403);
    assert.equal((await request(`/admin/events/${draft.id}`, 'PATCH', admin, { status: 'published' })).status, 200);
    assert.equal((await request(`/events/${draft.id}`)).status, 200);
    assert.equal((await (await request('/events')).json()).events.length, 1);
    const hiddenClub = (await (await request('/admin/clubs', 'POST', admin,
      { name: 'Chess', slug: 'chess' })).json()).club;
    assert.equal((await request('/admin/events', 'POST', admin, {
      clubId: hiddenClub.id, title: 'Chess Night', location: 'Hall', startsAt: future(7),
      endsAt: future(8), capacity: 10, status: 'published'
    })).status, 409);
    db.prepare("UPDATE clubs SET status = 'archived' WHERE id = ?").run(publishedClub.id);
    assert.equal((await request(`/events/${draft.id}`)).status, 404);
    assert.deepEqual((await (await request('/events')).json()).events, []);
  });
});

test('club-only events require approved membership and leaving removes future registrations', async () => {
  await withApp(async ({ db, request, account, club, event }) => {
    const admin = (await account('admin', 'admin')).accessToken;
    const member = (await account('member')).accessToken;
    const other = (await account('other')).accessToken;
    const host = await club(admin);
    const workshop = await event(admin, host.id);
    assert.equal(workshop.audience, 'club_members');
    assert.equal((await request(`/events/${workshop.id}/register`, 'POST')).status, 401);
    assert.equal((await request(`/events/${workshop.id}/register`, 'POST', admin)).status, 403);
    assert.equal((await request(`/events/${workshop.id}/register`, 'POST', member)).status, 403);
    const join = await request(`/clubs/${host.id}/join`, 'POST', member, photo, 'image/png');
    assert.equal(join.status, 201);
    assert.equal((await request(`/events/${workshop.id}/register`, 'POST', member)).status, 403);
    const requestId = (await join.json()).request.id;
    assert.equal((await request(`/admin/join-requests/${requestId}/approve`, 'POST', admin)).status, 200);
    assert.equal((await request(`/events/${workshop.id}/register`, 'POST', member, { userId: 'somebody-else' })).status, 201);
    assert.equal((await request(`/events/${workshop.id}/register`, 'POST', member)).status, 409);
    assert.equal((await (await request('/events/mine', 'GET', member)).json()).events.length, 1);
    assert.equal((await (await request('/events/mine', 'GET', other)).json()).events.length, 0);
    assert.equal(db.prepare('SELECT COUNT(*) AS count FROM event_registrations').get().count, 1);
    assert.equal((await request(`/clubs/${host.id}/membership`, 'DELETE', member)).status, 204);
    assert.equal(db.prepare('SELECT COUNT(*) AS count FROM event_registrations').get().count, 0);
  });
});

test('the last seat is assigned once and cancellation frees capacity', async () => {
  await withApp(async ({ db, request, account, club, event }) => {
    const admin = (await account('admin', 'admin')).accessToken;
    const first = (await account('first')).accessToken;
    const second = (await account('second')).accessToken;
    const host = await club(admin);
    const workshop = await event(admin, host.id, { audience: 'all_members', capacity: 1 });
    const path = `/events/${workshop.id}/register`;
    const responses = await Promise.all([request(path, 'POST', first), request(path, 'POST', second)]);
    assert.deepEqual(responses.map(response => response.status).sort(), [201, 409]);
    assert.equal(db.prepare('SELECT COUNT(*) AS count FROM event_registrations').get().count, 1);
    const winner = responses[0].status === 201 ? first : second;
    const loser = responses[0].status === 201 ? second : first;
    assert.equal((await request(path, 'POST', winner)).status, 409);
    assert.equal((await request(`/events/${workshop.id}/registration`, 'DELETE', loser)).status, 404);
    assert.equal((await request(`/events/${workshop.id}/registration`, 'DELETE', winner)).status, 204);
    assert.equal((await request(path, 'POST', loser)).status, 201);
    const attendees = await (await request(`/admin/events/${workshop.id}/attendees`, 'GET', admin)).json();
    assert.equal(attendees.attendees.length, 1);
    assert.equal('password_hash' in attendees.attendees[0], false);
    assert.equal((await request(`/admin/events/${workshop.id}/attendees`, 'GET', first)).status, 403);
  });
});

test('edits preserve registration eligibility, capacity, and cancellation history', async () => {
  await withApp(async ({ db, request, account, club, event }) => {
    const admin = (await account('admin', 'admin')).accessToken;
    const member = (await account('member')).accessToken;
    const other = (await account('other')).accessToken;
    const host = await club(admin);
    const workshop = await event(admin, host.id, { audience: 'all_members', capacity: 2 });
    assert.equal((await request(`/events/${workshop.id}/register`, 'POST', member)).status, 201);
    assert.equal((await request(`/events/${workshop.id}/register`, 'POST', other)).status, 201);
    assert.equal((await request(`/admin/events/${workshop.id}`, 'PATCH', admin, { audience: 'club_members' })).status, 409);
    assert.equal((await request(`/admin/events/${workshop.id}`, 'PATCH', admin, { capacity: 0 })).status, 400);
    assert.equal((await request(`/admin/events/${workshop.id}`, 'PATCH', admin, { capacity: 1 })).status, 409);
    assert.equal((await request(`/admin/events/${workshop.id}`, 'PATCH', admin, { capacity: 2 })).status, 200);
    assert.equal((await request(`/admin/events/${workshop.id}`, 'PATCH', admin, { status: 'cancelled' })).status, 200);
    assert.equal((await request(`/events/${workshop.id}`)).status, 404);
    assert.equal((await request(`/events/${workshop.id}/register`, 'POST', member)).status, 404);
    assert.equal((await (await request('/events/mine', 'GET', member)).json()).events[0].status, 'cancelled');
    assert.equal((await request(`/admin/events/${workshop.id}`, 'PATCH', admin, { status: 'published' })).status, 409);
    assert.equal(db.prepare('SELECT COUNT(*) AS count FROM event_registrations').get().count, 2);
  });
});

test('invalid dates and started events cannot receive registrations', async () => {
  await withApp(async ({ db, request, account, club, event }) => {
    const admin = (await account('admin', 'admin')).accessToken;
    const member = (await account('member')).accessToken;
    const host = await club(admin);
    assert.equal((await request('/admin/events', 'POST', admin, {
      clubId: host.id, title: 'Bad Date', location: 'Lab', startsAt: '2030-02-30T10:00:00.000Z',
      endsAt: '2030-03-01T10:00:00.000Z', capacity: 2
    })).status, 400);
    const workshop = await event(admin, host.id, { audience: 'all_members' });
    db.prepare('UPDATE events SET starts_at = ?, ends_at = ? WHERE id = ?')
      .run('2000-01-01T10:00:00.000Z', '2000-01-01T11:00:00.000Z', workshop.id);
    assert.equal((await request(`/events/${workshop.id}/register`, 'POST', member)).status, 409);
    assert.equal((await request(`/events/${workshop.id}/registration`, 'DELETE', member)).status, 404);
    assert.equal((await request(`/admin/events/${workshop.id}`, 'PATCH', admin, { title: 'Changed' })).status, 409);
  });
});
