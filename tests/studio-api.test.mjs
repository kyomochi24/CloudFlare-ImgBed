import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import { onRequest } from '../functions/api/studio/[[path]].js';

function environment() {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec(readFileSync(new URL('../database/migrations/studio.sql', import.meta.url), 'utf8'));
  sqlite.exec(readFileSync(new URL('../database/migrations/studio-candy.sql', import.meta.url), 'utf8'));
  const kvData = new Map();
  const objects = new Map();
  const multipartUploads = new Map();
  const multipart = (key, uploadId) => ({
    async uploadPart(number, bytes) { const entry = multipartUploads.get(uploadId); entry.parts.set(number, Buffer.from(bytes)); return { etag: `part-${number}` }; },
    async complete(parts) { const entry = multipartUploads.get(uploadId); objects.set(key, Buffer.concat(parts.map(part => entry.parts.get(part.partNumber)))); multipartUploads.delete(uploadId); },
    async abort() { multipartUploads.delete(uploadId); }
  });
  const env = {
    img_d1: { prepare(sql) { return { bind(...args) { const statement = sqlite.prepare(sql); return { async first() { return statement.get(...args) || null; }, async all() { return { results: statement.all(...args) }; }, async run() { return { meta: { changes: statement.run(...args).changes } }; } }; } }; } },
    img_url: { async get(key) { return kvData.get(key)?.value ?? null; }, async put(key, value, options = {}) { kvData.set(key, { value, metadata: options.metadata }); }, async delete(key) { kvData.delete(key); }, async getWithMetadata(key) { return kvData.get(key) || null; }, async list() { return { keys: [] }; } },
    img_r2: { async put(key, value) { objects.set(key, value); }, async delete(key) { objects.delete(key); }, async createMultipartUpload(key) { const uploadId = crypto.randomUUID(); multipartUploads.set(uploadId, { key, parts: new Map() }); return { uploadId, ...multipart(key, uploadId) }; }, resumeMultipartUpload: multipart }
  };
  kvData.set('manage@session@admin-test', { value: JSON.stringify({ authType: 'admin', username: 'owner', expiresAt: Date.now() + 3600000 }) });
  return { env, sqlite, kvData, objects, multipartUploads };
}

async function call(env, path, method = 'GET', body, cookie = '') {
  const headers = { Cookie: cookie };
  if (method !== 'GET') headers.Origin = 'https://example.test';
  if (body && !(body instanceof FormData)) headers['Content-Type'] = 'application/json';
  const request = new Request(`https://example.test/api/studio/${path}`, { method, headers, body: body instanceof FormData ? body : body ? JSON.stringify(body) : undefined });
  const response = await onRequest({ env, request, waitUntil(promise) { promise.catch(() => {}); } });
  const data = await response.json().catch(() => null);
  return { response, data };
}

test('local account, album, original upload, application review, and delete', async () => {
  const { env, sqlite, objects } = environment();
  const adminCookie = 'admin_session=admin-test';
  const created = await call(env, 'admin/users', 'POST', { username: 'artist_1', password: 'very-long-password-123' }, adminCookie);
  assert.equal(created.response.status, 201);
  const login = await call(env, 'login', 'POST', { username: 'artist_1', password: 'very-long-password-123' });
  assert.equal(login.response.status, 200);
  const userCookie = login.response.headers.get('Set-Cookie').split(';')[0];
  const albums = await call(env, 'albums', 'GET', null, userCookie);
  assert.equal(albums.data.albums.length, 1);
  const albumId = albums.data.albums[0].id;
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScL/nwAAAABJRU5ErkJggg==', 'base64');
  const form = new FormData(); form.set('albumId', albumId); form.set('file', new Blob([png], { type: 'image/png' }), 'test.png');
  const uploaded = await call(env, 'files', 'POST', form, userCookie);
  assert.equal(uploaded.response.status, 200);
  assert.equal(objects.get(uploaded.data.id).byteLength, png.byteLength);
  const files = await call(env, `files?album=${albumId}`, 'GET', null, userCookie);
  assert.equal(files.data.files.length, 1);
  const profile = await call(env, 'me', 'GET', null, userCookie);
  assert.equal(profile.data.user.storedBytes, png.byteLength);
  const application = await call(env, 'applications', 'POST', { discordId: '7', workTitle: '像素甜点屋', workUrl: '作品还没发布网址' }, userCookie);
  assert.equal(application.response.status, 201);
  assert.equal(sqlite.prepare('SELECT discord_id,work_title,work_url FROM studio_applications').get().discord_id, '7');
  assert.equal(sqlite.prepare('SELECT work_url FROM studio_applications').get().work_url, '作品还没发布网址');
  const approved = await call(env, `admin/applications/${application.data.id}`, 'POST', { decision: 'approved' }, adminCookie);
  assert.equal(approved.response.status, 200);
  const upgraded = await call(env, 'me', 'GET', null, userCookie);
  assert.equal(upgraded.data.user.tier, 'pikachu');
  const deleted = await call(env, `files/${encodeURIComponent(uploaded.data.id)}`, 'DELETE', null, userCookie);
  assert.equal(deleted.response.status, 200);
  assert.equal(objects.has(uploaded.data.id), false);
  const after = await call(env, 'me', 'GET', null, userCookie);
  assert.equal(after.data.user.storedBytes, 0);
  assert.equal(sqlite.prepare('SELECT count(*) n FROM studio_files').get().n, 0);
  sqlite.close();
});

test('rejects invalid origin and fake image content', async () => {
  const { env, sqlite } = environment();
  const bad = await call(env, 'login', 'POST', { username: 'x', password: 'x' });
  assert.equal(bad.response.status, 401);
  const request = new Request('https://example.test/api/studio/login', { method: 'POST', headers: { Origin: 'https://evil.test', 'Content-Type': 'application/json' }, body: '{}' });
  const response = await onRequest({ env, request, waitUntil() {} });
  assert.equal(response.status, 403);
  await call(env, 'admin/users', 'POST', { username: 'artist_2', password: 'very-long-password-123' }, 'admin_session=admin-test');
  const login = await call(env, 'login', 'POST', { username: 'artist_2', password: 'very-long-password-123' });
  const cookie = login.response.headers.get('Set-Cookie').split(';')[0];
  const albums = await call(env, 'albums', 'GET', null, cookie);
  const form = new FormData(); form.set('albumId', albums.data.albums[0].id); form.set('file', new Blob(['<script>bad()</script>'], { type: 'image/png' }), 'fake.png');
  const upload = await call(env, 'files', 'POST', form, cookie);
  assert.equal(upload.response.status, 400);
  sqlite.close();
});

test('Discord login only admits members of a configured guild', async () => {
  const { env, sqlite } = environment();
  Object.assign(env, { DISCORD_CLIENT_ID: 'client', DISCORD_CLIENT_SECRET: 'secret' });
  const start = await call(env, 'oauth/start');
  assert.equal(start.response.status, 302);
  const state = new URL(start.response.headers.get('Location')).searchParams.get('state');
  const previousFetch = globalThis.fetch;
  let guildId = '222222222222222222';
  globalThis.fetch = async url => {
    if (String(url).endsWith('/oauth2/token')) return Response.json({ access_token: 'access' });
    if (String(url).endsWith('/users/@me/guilds')) return Response.json([{ id: guildId }]);
    if (String(url).endsWith('/users/@me')) return Response.json({ id: '333333333333333333', username: 'Artist' });
    throw new Error('unexpected Discord URL');
  };
  try {
    const cookie = `studio_oauth_state=${state}`;
    const denied = await call(env, `oauth/callback?state=${state}&code=code`, 'GET', null, cookie);
    assert.equal(denied.response.status, 302);
    assert.equal(denied.response.headers.get('Location'), '/studio/?error=not_member');
    assert.equal(sqlite.prepare('SELECT count(*) n FROM studio_users').get().n, 0);
    guildId = '1291925535324110879';
    const allowed = await call(env, `oauth/callback?state=${state}&code=code`, 'GET', null, cookie);
    assert.equal(allowed.response.status, 302);
    assert.equal(allowed.response.headers.get('Location'), '/studio/');
    assert.equal(sqlite.prepare('SELECT tier FROM studio_users').get().tier, 'pichu');
    guildId = '1379304008157499423';
    const secondGuild = await call(env, `oauth/callback?state=${state}&code=code`, 'GET', null, cookie);
    assert.equal(secondGuild.response.status, 302);
  } finally { globalThis.fetch = previousFetch; sqlite.close(); }
});

test('album deletion clears all batches, objects, metadata, and stored bytes for its owner', async () => {
  const { env, sqlite, kvData, objects, multipartUploads } = environment();
  const admin = 'admin_session=admin-test';
  await call(env, 'admin/users', 'POST', { username: 'album_owner', password: 'very-long-password-123' }, admin);
  await call(env, 'admin/users', 'POST', { username: 'album_neighbor', password: 'very-long-password-123' }, admin);
  const owner = await call(env, 'login', 'POST', { username: 'album_owner', password: 'very-long-password-123' });
  const neighbor = await call(env, 'login', 'POST', { username: 'album_neighbor', password: 'very-long-password-123' });
  const ownerCookie = owner.response.headers.get('Set-Cookie').split(';')[0];
  const neighborCookie = neighbor.response.headers.get('Set-Cookie').split(';')[0];
  const albumId = (await call(env, 'albums', 'GET', null, ownerCookie)).data.albums[0].id;
  const ownerId = sqlite.prepare("SELECT id FROM studio_users WHERE username='album_owner'").get().id;
  const neighborId = sqlite.prepare("SELECT id FROM studio_users WHERE username='album_neighbor'").get().id;
  assert.equal((await call(env, `albums/${albumId}`, 'DELETE', null, neighborCookie)).response.status, 404);
  for (let index = 0; index < 31; index++) {
    const key = `studio/album-test-${index}.png`;
    sqlite.prepare('INSERT INTO studio_files(id,user_id,album_id,file_name,mime_type,size_bytes) VALUES(?,?,?,?,?,?)').run(key, ownerId, albumId, `${index}.png`, 'image/png', 10);
    objects.set(key, Buffer.from('image'));
    kvData.set(key, { value: '', metadata: { OwnerId: ownerId } });
  }
  sqlite.prepare('UPDATE studio_users SET stored_bytes=310 WHERE id=?').run(ownerId);
  sqlite.prepare('INSERT INTO studio_uploads(id,user_id,album_id,object_key,r2_upload_id,file_name,mime_type,size_bytes,part_size,part_count) VALUES(?,?,?,?,?,?,?,?,?,?)').run('pending-id', ownerId, albumId, 'studio/pending.png', 'pending-r2-id', 'pending.png', 'image/png', 10, 10, 1);
  sqlite.prepare('INSERT INTO studio_upload_parts(upload_id,part_number,etag) VALUES(?,?,?)').run('pending-id', 1, 'etag');
  multipartUploads.set('pending-r2-id', { key: 'studio/pending.png', parts: new Map() });
  const first = await call(env, `albums/${albumId}`, 'DELETE', null, ownerCookie);
  assert.equal(first.data.done, false);
  assert.equal(first.data.remaining, 25);
  assert.equal(multipartUploads.size, 0);
  assert.equal(sqlite.prepare('SELECT count(*) n FROM studio_uploads WHERE album_id=?').get(albumId).n, 0);
  assert.equal(sqlite.prepare('SELECT count(*) n FROM studio_upload_parts').get().n, 0);
  assert.equal((await call(env, 'albums', 'GET', null, ownerCookie)).data.albums[0].file_count, 25);
  let result = first;
  for (let attempt = 0; attempt < 6 && !result.data.done; attempt++) result = await call(env, `albums/${albumId}`, 'DELETE', null, ownerCookie);
  assert.equal(result.data.done, true);
  assert.equal((await call(env, 'albums', 'GET', null, ownerCookie)).data.albums.length, 0);
  assert.equal((await call(env, 'albums', 'GET', null, neighborCookie)).data.albums.length, 1);
  assert.equal(sqlite.prepare('SELECT stored_bytes FROM studio_users WHERE id=?').get(ownerId).stored_bytes, 0);
  assert.equal(sqlite.prepare('SELECT stored_bytes FROM studio_users WHERE id=?').get(neighborId).stored_bytes, 0);
  assert.equal(sqlite.prepare('SELECT count(*) n FROM studio_files WHERE album_id=?').get(albumId).n, 0);
  assert.equal(objects.size, 0);
  assert.equal([...kvData.keys()].filter(key => key.startsWith('studio/album-test-')).length, 0);
  sqlite.close();
});

test('album deletion leaves the album and remaining files available after storage failure', async () => {
  const { env, sqlite, objects } = environment();
  await call(env, 'admin/users', 'POST', { username: 'album_retry', password: 'very-long-password-123' }, 'admin_session=admin-test');
  const login = await call(env, 'login', 'POST', { username: 'album_retry', password: 'very-long-password-123' });
  const cookie = login.response.headers.get('Set-Cookie').split(';')[0];
  const id = (await call(env, 'albums', 'GET', null, cookie)).data.albums[0].id;
  const owner = sqlite.prepare("SELECT id FROM studio_users WHERE username='album_retry'").get().id;
  sqlite.prepare('INSERT INTO studio_files(id,user_id,album_id,file_name,mime_type,size_bytes) VALUES(?,?,?,?,?,?)').run('studio/retry.png', owner, id, 'retry.png', 'image/png', 10);
  sqlite.prepare('UPDATE studio_users SET stored_bytes=10 WHERE id=?').run(owner);
  objects.set('studio/retry.png', Buffer.from('image'));
  const originalDelete = env.img_r2.delete;
  env.img_r2.delete = async () => { throw new Error('storage temporarily unavailable'); };
  assert.equal((await call(env, `albums/${id}`, 'DELETE', null, cookie)).response.status, 503);
  assert.equal((await call(env, 'albums', 'GET', null, cookie)).data.albums[0].file_count, 1);
  assert.equal(sqlite.prepare('SELECT stored_bytes FROM studio_users WHERE id=?').get(owner).stored_bytes, 10);
  env.img_r2.delete = originalDelete;
  assert.equal((await call(env, `albums/${id}`, 'DELETE', null, cookie)).data.done, true);
  sqlite.close();
});

test('BG0 model is session-gated, allowlisted, and cached in R2', async () => {
  const { env, sqlite, objects } = environment();
  const revision = '4a3c40c36c94093cc1e724d9ea428b8fa4b57dc7';
  const path = `bg0-model/studioludens/birefnet-lite-512/resolve/${revision}/config.json`;
  const noSession = await call(env, path);
  assert.equal(noSession.response.status, 401);
  await call(env, 'admin/users', 'POST', { username: 'model_user', password: 'very-long-password-123' }, 'admin_session=admin-test');
  const login = await call(env, 'login', 'POST', { username: 'model_user', password: 'very-long-password-123' });
  const cookie = login.response.headers.get('Set-Cookie').split(';')[0];
  assert.equal((await call(env, `${path}/unexpected`, 'GET', null, cookie)).response.status, 404);

  env.img_r2.get = async key => objects.has(key) ? { body: new Blob([objects.get(key)]).stream(), size: objects.get(key).byteLength } : null;
  env.img_r2.put = async (key, stream) => { objects.set(key, new Uint8Array(await new Response(stream).arrayBuffer())); };
  const upstreamFetch = globalThis.fetch;
  let fetches = 0;
  globalThis.fetch = async url => {
    fetches++;
    assert.equal(String(url), `https://huggingface.co/studioludens/birefnet-lite-512/resolve/${revision}/config.json`);
    return new Response('{"model_type":"birefnet"}', { headers: { 'Content-Length': '25' } });
  };
  try {
    const request = new Request(`https://example.test/api/studio/${path}`, { headers: { Cookie: cookie } });
    const cacheTasks = [];
    const context = { env, request, waitUntil(promise) { cacheTasks.push(promise); } };
    const first = await onRequest(context);
    assert.equal(first.status, 200);
    assert.match(await first.text(), /birefnet/);
    await Promise.all(cacheTasks);
    const second = await onRequest(context);
    assert.equal(second.status, 200);
    assert.match(await second.text(), /birefnet/);
    assert.equal(fetches, 1);
  } finally { globalThis.fetch = upstreamFetch; sqlite.close(); }
});

test('candy export quota counts each project once and resets by day', async () => {
  const { env, sqlite } = environment();
  assert.equal((await call(env, 'candy/quota')).response.status, 401);
  const admin = 'admin_session=admin-test';
  const created = await call(env, 'admin/users', 'POST', { username: 'candy_artist', password: 'very-long-password-123' }, admin);
  const login = await call(env, 'login', 'POST', { username: 'candy_artist', password: 'very-long-password-123' });
  const cookie = login.response.headers.get('Set-Cookie').split(';')[0];
  assert.equal((await call(env, 'candy/quota', 'GET', null, cookie)).data.dailyLimit, 2);
  const first = crypto.randomUUID(), second = crypto.randomUUID(), third = crypto.randomUUID();
  assert.equal((await call(env, 'candy/claim', 'POST', { projectId: first }, cookie)).response.status, 200);
  assert.equal((await call(env, 'candy/claim', 'POST', { projectId: first }, cookie)).data.alreadyClaimed, true);
  assert.equal((await call(env, 'candy/claim', 'POST', { projectId: second }, cookie)).response.status, 200);
  assert.equal((await call(env, 'candy/claim', 'POST', { projectId: third }, cookie)).response.status, 429);
  assert.equal((await call(env, 'candy/quota', 'GET', null, cookie)).data.used, 2);
  const upgrade = await call(env, `admin/users/${created.data.id}`, 'PATCH', { tier: 'pikachu' }, admin);
  assert.equal(upgrade.response.status, 200);
  assert.equal((await call(env, 'candy/quota', 'GET', null, cookie)).data.dailyLimit, 10);
  assert.equal((await call(env, 'candy/claim', 'POST', { projectId: third }, cookie)).response.status, 200);
  sqlite.close();
});

test('candy image preview requires a session and an approved image host', async () => {
  const { env, sqlite } = environment();
  assert.equal((await call(env, 'candy/source', 'POST', { url: 'https://iili.io/a.png' })).response.status, 401);
  await call(env, 'admin/users', 'POST', { username: 'preview_user', password: 'very-long-password-123' }, 'admin_session=admin-test');
  const login = await call(env, 'login', 'POST', { username: 'preview_user', password: 'very-long-password-123' });
  const cookie = login.response.headers.get('Set-Cookie').split(';')[0];
  const rejected = await call(env, 'candy/source', 'POST', { url: 'https://127.0.0.1/private.png' }, cookie);
  assert.equal(rejected.response.status, 422);
  assert.match(rejected.data.error, /HTTPS/);
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async url => {
    assert.equal(String(url), 'https://img.baibai.cv/f/example/test.png');
    return new Response(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScL/nwAAAABJRU5ErkJggg==', 'base64'));
  };
  try {
    const allowed = await call(env, 'candy/source', 'POST', { url: 'https://img.baibai.cv/f/example/test.png' }, cookie);
    assert.equal(allowed.response.status, 200);
    assert.equal(allowed.response.headers.get('Content-Type'), 'image/png');
  } finally { globalThis.fetch = originalFetch; }
  sqlite.close();
});

test('only admin can grant unlimited tier; arbitrary file uses R2 multipart and remains accounted for', async () => {
  const { env, sqlite, objects, kvData } = environment();
  const adminCookie = 'admin_session=admin-test';
  const created = await call(env, 'admin/users', 'POST', { username: 'maker_1', password: 'very-long-password-123' }, adminCookie);
  const login = await call(env, 'login', 'POST', { username: 'maker_1', password: 'very-long-password-123' });
  const userCookie = login.response.headers.get('Set-Cookie').split(';')[0];
  const albumId = (await call(env, 'albums', 'GET', null, userCookie)).data.albums[0].id;
  const denied = await call(env, 'multipart/start', 'POST', { albumId, name: 'work.zip', type: 'application/zip', size: 9 * 1048576 }, userCookie);
  assert.equal(denied.response.status, 403);
  const selfGrant = await call(env, `admin/users/${created.data.id}`, 'PATCH', { tier: 'super' }, userCookie);
  assert.equal(selfGrant.response.status, 401);
  const grant = await call(env, `admin/users/${created.data.id}`, 'PATCH', { tier: 'super' }, adminCookie);
  assert.equal(grant.response.status, 200);
  assert.equal((await call(env, 'me', 'GET', null, userCookie)).data.user.tier, 'super');
  const size = 9 * 1048576;
  const started = await call(env, 'multipart/start', 'POST', { albumId, name: 'work.zip', type: 'application/zip', size }, userCookie);
  assert.equal(started.response.status, 201);
  assert.equal(started.data.partCount, 2);
  for (let number = 1; number <= 2; number++) {
    const partSize = number === 1 ? 8 * 1048576 : 1048576;
    const request = new Request(`https://example.test/api/studio/multipart/${started.data.id}/parts/${number}`, { method: 'PUT', headers: { Origin: 'https://example.test', Cookie: userCookie }, body: Buffer.alloc(partSize, number) });
    const response = await onRequest({ env, request, waitUntil(promise) { promise.catch(() => {}); } });
    assert.equal(response.status, 200);
  }
  const finished = await call(env, `multipart/${started.data.id}/complete`, 'POST', null, userCookie);
  assert.equal(finished.response.status, 200);
  assert.equal(objects.get(finished.data.id).length, size);
  assert.equal(kvData.get(finished.data.id).metadata.FileType, 'application/zip');
  assert.equal((await call(env, 'me', 'GET', null, userCookie)).data.user.storedBytes, size);
  const downgraded = await call(env, `admin/users/${created.data.id}`, 'PATCH', { tier: 'pichu' }, adminCookie);
  assert.equal(downgraded.response.status, 200);
  assert.equal((await call(env, 'me', 'GET', null, userCookie)).data.user.tier, 'pichu');
  sqlite.close();
});
