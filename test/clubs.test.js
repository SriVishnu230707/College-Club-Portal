import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createApp } from '../src/app.js';
import { migrate, openDatabase } from '../src/db/index.js';

const jwt = {
  accessSecret: 'test-access-secret-0123456789-abcdef',
  refreshSecret: 'test-refresh-secret-0123456789-abcdef',
  accessSeconds: 900,
  refreshSeconds: 604800
};
const photo = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(128)]);

async function withApp(run) {
  const db = openDatabase(':memory:');
  migrate(db);
  const server = createApp({ db, jwt }).listen(0);
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
    return (await (await request('/auth/login', 'POST', null, credentials)).json()).accessToken;
  }
  try { await run({ db, request, account }); }
  finally {
    await new Promise(resolve => server.close(resolve));
    db.close();
  }
}

test('visitors browse published clubs while only current admins manage them', async () => {
  await withApp(async ({ db, request, account }) => {
    const admin = await account('admin', 'admin');
    const member = await account('member');
    assert.equal((await request('/admin/clubs', 'POST', member, { name: 'Robotics', slug: 'robotics' })).status, 403);
    assert.equal((await request('/admin/clubs', 'POST', null, { name: 'Robotics', slug: 'robotics' })).status, 401);
    const created = await request('/admin/clubs', 'POST', admin, {
      name: 'Robotics', slug: 'robotics', description: 'Build robots'
    });
    assert.equal(created.status, 201);
    const club = (await created.json()).club;
    assert.equal(club.status, 'draft');
    assert.deepEqual((await (await request('/clubs')).json()).clubs, []);
    assert.equal((await request(`/clubs/${club.id}`)).status, 404);
    assert.equal((await request('/admin/clubs', 'POST', admin, { name: 'Another', slug: 'robotics' })).status, 409);
    assert.equal((await request(`/admin/clubs/${club.id}`, 'PATCH', admin, { status: 'published' })).status, 200);
    assert.equal((await (await request('/clubs')).json()).clubs.length, 1);
    assert.equal((await request(`/clubs/${club.id}`)).status, 200);
    const adminId = db.prepare("SELECT id FROM users WHERE email = 'admin@example.edu'").get().id;
    db.prepare("UPDATE users SET role = 'member' WHERE id = ?").run(adminId);
    assert.equal((await request(`/admin/clubs/${club.id}`, 'PATCH', admin, { name: 'Changed' })).status, 403);
  });
});

test('ID card requests stay private and approval creates only the applicant membership', async () => {
  await withApp(async ({ db, request, account }) => {
    const admin = await account('admin', 'admin');
    const member = await account('member');
    const other = await account('other');
    const club = (await (await request('/admin/clubs', 'POST', admin,
      { name: 'Robotics', slug: 'robotics', status: 'published' })).json()).club;
    const joinPath = `/clubs/${club.id}/join`;
    assert.equal((await request(joinPath, 'POST', null, photo, 'image/png')).status, 401);
    assert.equal((await request(joinPath, 'POST', member, Buffer.alloc(2 * 1024 * 1024 + 1), 'image/png')).status, 413);
    assert.equal((await request(joinPath, 'POST', member, Buffer.from('<svg></svg>'), 'image/png')).status, 400);
    assert.equal((await request(joinPath, 'POST', member, photo, 'image/jpeg')).status, 400);
    const [first, duplicate] = await Promise.all([
      request(joinPath, 'POST', member, photo, 'image/png'),
      request(joinPath, 'POST', member, photo, 'image/png')
    ]);
    assert.deepEqual([first.status, duplicate.status].sort(), [201, 409]);
    const pending = await (first.status === 201 ? first : duplicate).json();
    const requestId = pending.request.id;
    assert.equal((await request(`/admin/join-requests/${requestId}/id-card`, 'GET', member)).status, 403);
    assert.equal((await request(`/admin/join-requests/${requestId}/id-card`)).status, 401);
    const image = await request(`/admin/join-requests/${requestId}/id-card`, 'GET', admin);
    assert.equal(image.status, 200);
    assert.equal(image.headers.get('cache-control'), 'no-store');
    assert.equal(image.headers.get('x-content-type-options'), 'nosniff');
    assert.deepEqual(Buffer.from(await image.arrayBuffer()), photo);
    const listing = await (await request(`/admin/clubs/${club.id}/requests`, 'GET', admin)).json();
    assert.equal(listing.requests.length, 1);
    assert.equal(JSON.stringify(listing).includes('id_card_photo'), false);
    assert.equal((await request(`/admin/join-requests/${requestId}/approve`, 'POST', admin)).status, 200);
    assert.equal((await request(`/admin/join-requests/${requestId}/approve`, 'POST', admin)).status, 404);
    assert.equal((await request(`/admin/join-requests/${requestId}/id-card`, 'GET', admin)).status, 404);
    assert.equal(db.prepare('SELECT id_card_photo FROM club_join_requests WHERE id = ?').get(requestId).id_card_photo, null);
    assert.equal((await request(joinPath, 'POST', member, photo, 'image/png')).status, 409);
    assert.equal((await (await request('/clubs/mine', 'GET', member)).json()).clubs.length, 1);
    assert.equal((await (await request('/clubs/mine', 'GET', other)).json()).clubs.length, 0);
    assert.equal((await (await request(`/admin/clubs/${club.id}/members`, 'GET', admin)).json()).members.length, 1);
    assert.equal((await request(`/clubs/${club.id}/membership`, 'DELETE', other)).status, 404);
    assert.equal((await request(`/clubs/${club.id}/membership`, 'DELETE', member)).status, 204);
    assert.equal((await (await request('/clubs/mine', 'GET', member)).json()).clubs.length, 0);
  });
});

test('rejected and expired requests erase photos and allow a new application', async () => {
  await withApp(async ({ db, request, account }) => {
    const admin = await account('admin', 'admin');
    const member = await account('member');
    const club = (await (await request('/admin/clubs', 'POST', admin,
      { name: 'Robotics', slug: 'robotics', status: 'published' })).json()).club;
    const path = `/clubs/${club.id}/join`;
    const first = (await (await request(path, 'POST', member, photo, 'image/png')).json()).request.id;
    assert.equal((await request(`/admin/join-requests/${first}/reject`, 'POST', admin)).status, 200);
    assert.equal(db.prepare('SELECT id_card_photo FROM club_join_requests WHERE id = ?').get(first).id_card_photo, null);
    const second = (await (await request(path, 'POST', member, photo, 'image/png')).json()).request.id;
    db.prepare("UPDATE club_join_requests SET expires_at = '2000-01-01T00:00:00.000Z' WHERE id = ?").run(second);
    assert.equal((await request(`/admin/join-requests/${second}/id-card`, 'GET', admin)).status, 404);
    assert.deepEqual(db.prepare('SELECT status, id_card_photo FROM club_join_requests WHERE id = ?').get(second),
      { status: 'expired', id_card_photo: null });
    assert.equal((await request(path, 'POST', member, photo, 'image/png')).status, 201);
  });
});

test('join upload work is limited per signed-in account', async () => {
  await withApp(async ({ request, account }) => {
    const member = await account('member');
    for (let index = 0; index < 10; index += 1) {
      assert.equal((await request('/clubs/missing/join', 'POST', member, photo, 'image/png')).status, 404);
    }
    assert.equal((await request('/clubs/missing/join', 'POST', member, photo, 'image/png')).status, 429);
  });
});
