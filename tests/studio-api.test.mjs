import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import { onRequest } from '../functions/api/studio/[[path]].js';

function environment() {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec(readFileSync(new URL('../database/migrations/studio.sql', import.meta.url), 'utf8'));
  const kvData = new Map();
  const objects = new Map();
  const env = {
    img_d1: { prepare(sql) { return { bind(...args) { const statement = sqlite.prepare(sql); return { async first() { return statement.get(...args) || null; }, async all() { return { results: statement.all(...args) }; }, async run() { return { meta: { changes: statement.run(...args).changes } }; } }; } }; } },
    img_url: { async get(key) { return kvData.get(key)?.value ?? null; }, async put(key, value, options = {}) { kvData.set(key, { value, metadata: options.metadata }); }, async delete(key) { kvData.delete(key); }, async getWithMetadata(key) { return kvData.get(key) || null; }, async list() { return { keys: [] }; } },
    img_r2: { async put(key, value) { objects.set(key, value); }, async delete(key) { objects.delete(key); } }
  };
  kvData.set('manage@session@admin-test', { value: JSON.stringify({ authType: 'admin', username: 'owner', expiresAt: Date.now() + 3600000 }) });
  return { env, sqlite, kvData, objects };
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
