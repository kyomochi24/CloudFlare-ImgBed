import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import { reserveStudioQuota, releaseStudioQuota, removeStudioFile, moveStudioFile } from '../functions/utils/studioQuota.js';

const migration = readFileSync(new URL('../database/migrations/studio_quota.sql', import.meta.url), 'utf8');
const month = () => new Date(Date.now() + 8 * 3600000).toISOString().slice(0, 7);
const megabyte = 1024 * 1024;

function fixture(migrate = true) {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec('PRAGMA foreign_keys=ON');
  sqlite.exec(readFileSync(new URL('../database/migrations/studio.sql', import.meta.url), 'utf8'));
  sqlite.prepare("INSERT INTO studio_users(id,account_type) VALUES('owner','local')").run();
  sqlite.prepare("INSERT INTO studio_albums(id,user_id,name) VALUES('album','owner','test')").run();
  if (migrate) sqlite.exec(migration);
  const db = { prepare(sql) { return { bind(...args) { return {
    async run() { return { meta: { changes: sqlite.prepare(sql).run(...args).changes } }; }
  }; } }; } };
  const insert = (id, size, createdAt = new Date().toISOString()) => sqlite.prepare('INSERT INTO studio_files(id,user_id,album_id,file_name,mime_type,size_bytes,created_at) VALUES(?,?,?,?,?,?,?)').run(id, 'owner', 'album', id, 'image/png', size, createdAt);
  const user = () => sqlite.prepare("SELECT * FROM studio_users WHERE id='owner'").get();
  return { sqlite, db, insert, user };
}

test('migration repairs stored totals and preserves deleted-file monthly usage on repeat runs', () => {
  const { sqlite, insert, user } = fixture(false);
  try {
    insert('studio/current.png', 50);
    insert('studio/old.png', 70, '2000-01-01 00:00:00');
    sqlite.prepare("UPDATE studio_users SET stored_bytes=999,month_key=?,month_uploaded_bytes=100 WHERE id='owner'").run(month());
    sqlite.exec(migration);
    assert.equal(user().stored_bytes, 120);
    assert.equal(user().month_uploaded_bytes, 100);
    sqlite.exec(migration);
    assert.equal(user().stored_bytes, 120);
    assert.equal(user().month_uploaded_bytes, 100);
    sqlite.prepare("UPDATE studio_users SET month_uploaded_bytes=0 WHERE id='owner'").run();
    sqlite.exec(migration);
    assert.equal(user().month_uploaded_bytes, 50);
  } finally { sqlite.close(); }
});

test('dondon enforces 500 MiB total, including concurrent pending uploads, then releases failed reservations', async () => {
  const { sqlite, db, insert, user } = fixture();
  try {
    sqlite.prepare("INSERT INTO studio_dondon_users(user_id) VALUES('owner')").run();
    insert('studio/existing.png', 499 * megabyte);
    const results = await Promise.all([
      reserveStudioQuota(db, 'owner', 'studio/first.png', megabyte, month()),
      reserveStudioQuota(db, 'owner', 'studio/second.png', megabyte, month())
    ]);
    assert.deepEqual(results, [true, false]);
    assert.equal(user().stored_bytes, 499 * megabyte);
    assert.equal(user().month_uploaded_bytes, 499 * megabyte);
    await releaseStudioQuota(db, 'studio/first.png');
    assert.equal(await reserveStudioQuota(db, 'owner', 'studio/second.png', megabyte, month()), true);
    insert('studio/second.png', megabyte);
    assert.equal(user().stored_bytes, 500 * megabyte);
    assert.equal(sqlite.prepare('SELECT count(*) total FROM studio_quota_reservations').get().total, 0);
    assert.equal(await reserveStudioQuota(db, 'owner', 'studio/overflow.png', 1, month()), false);
    await removeStudioFile({ img_d1: db }, 'studio/second.png');
    await removeStudioFile({ img_d1: db }, 'studio/second.png');
    assert.equal(user().stored_bytes, 499 * megabyte);
    assert.equal(user().month_uploaded_bytes, 500 * megabyte);
    assert.equal(await reserveStudioQuota(db, 'owner', 'studio/new.png', megabyte, month()), true);
  } finally { sqlite.close(); }
});

test('pichu stays at 200 MiB and pikachu monthly usage survives deletes, upgrades and month changes', async () => {
  const { sqlite, db, insert, user } = fixture();
  try {
    insert('studio/base.png', 200 * megabyte);
    assert.equal(await reserveStudioQuota(db, 'owner', 'studio/overflow.png', 1, month()), false);
    sqlite.prepare("UPDATE studio_users SET tier='pikachu' WHERE id='owner'").run();
    assert.equal(user().month_uploaded_bytes, 200 * megabyte);
    assert.equal(await reserveStudioQuota(db, 'owner', 'studio/creator.png', 824 * megabyte, month()), true);
    insert('studio/creator.png', 824 * megabyte);
    await removeStudioFile({ img_d1: db }, 'studio/creator.png');
    assert.equal(user().stored_bytes, 200 * megabyte);
    assert.equal(user().month_uploaded_bytes, 1024 * megabyte);
    assert.equal(await reserveStudioQuota(db, 'owner', 'studio/full.png', 1, month()), false);
    sqlite.prepare("UPDATE studio_users SET month_key='2000-01',month_uploaded_bytes=9999999999 WHERE id='owner'").run();
    assert.equal(await reserveStudioQuota(db, 'owner', 'studio/newmonth.png', 5, month()), true);
    insert('studio/newmonth.png', 5);
    assert.equal(user().month_uploaded_bytes, 5);
    assert.equal(user().stored_bytes, 200 * megabyte + 5);
  } finally { sqlite.close(); }
});

test('expired reservations do not lock space and failed old uploads cannot refund a newer month', async () => {
  const { sqlite, db, insert, user } = fixture();
  try {
    assert.equal(await reserveStudioQuota(db, 'owner', 'studio/interrupted.png', 200 * megabyte, month()), true);
    sqlite.prepare('UPDATE studio_quota_reservations SET expires_at=0').run();
    assert.equal(await reserveStudioQuota(db, 'owner', 'studio/new.png', 20, month()), true);
    insert('studio/new.png', 20);
    await releaseStudioQuota(db, 'studio/interrupted.png');
    assert.equal(user().stored_bytes, 20);
    assert.equal(user().month_uploaded_bytes, 20);
    assert.equal(await reserveStudioQuota(db, 'owner', 'studio/late.png', 5, '2000-01'), true);
    assert.throws(() => insert('studio/late.png', 5), /reservation expired/);
    assert.equal(user().stored_bytes, 20);
  } finally { sqlite.close(); }
});

test('super has no storage cap, disabled users cannot reserve and duplicate file inserts cannot double count', async () => {
  const { sqlite, db, insert, user } = fixture();
  try {
    sqlite.prepare("INSERT INTO studio_super_users(user_id) VALUES('owner')").run();
    assert.equal(await reserveStudioQuota(db, 'owner', 'studio/large.zip', 5 * 1024 * megabyte, month()), true);
    insert('studio/large.zip', 5 * 1024 * megabyte);
    assert.throws(() => insert('studio/large.zip', 5 * 1024 * megabyte), /UNIQUE/);
    assert.equal(user().stored_bytes, 5 * 1024 * megabyte);
    sqlite.prepare("UPDATE studio_users SET disabled=1 WHERE id='owner'").run();
    assert.equal(await reserveStudioQuota(db, 'owner', 'studio/disabled.png', 1, month()), false);
  } finally { sqlite.close(); }
});

test('management key moves preserve usage and files outside studio still release their owner storage', async () => {
  const { sqlite, db, insert, user } = fixture();
  try {
    insert('studio/old.png', 50);
    await moveStudioFile({ img_d1: db }, 'studio/old.png', 'archive/new.png', 'owner');
    assert.equal(user().stored_bytes, 50);
    assert.equal(user().month_uploaded_bytes, 50);
    assert.equal(sqlite.prepare("SELECT count(*) total FROM studio_files WHERE id='archive/new.png'").get().total, 1);
    await moveStudioFile({ img_d1: db }, 'archive/new.png', 'archive/renamed.png', 'owner');
    await removeStudioFile({ img_d1: db }, 'archive/renamed.png', 'owner');
    assert.equal(user().stored_bytes, 0);
    assert.equal(user().month_uploaded_bytes, 50);
  } finally { sqlite.close(); }
});
