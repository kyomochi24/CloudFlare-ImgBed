const BASE_LIMIT = 200 * 1024 * 1024;
const DONDON_LIMIT = 500 * 1024 * 1024;
const CREATOR_MONTH_LIMIT = 1024 * 1024 * 1024;

export async function reserveStudioQuota(db, userId, id, size, month) {
  const now = Date.now();
  await db.prepare('DELETE FROM studio_quota_reservations WHERE expires_at<=?').bind(now).run();
  const result = await db.prepare(`INSERT INTO studio_quota_reservations(id,user_id,size_bytes,month_key,expires_at)
    SELECT ?,id,?,?,? FROM studio_users WHERE id=? AND disabled=0 AND (
      EXISTS(SELECT 1 FROM studio_super_users WHERE user_id=studio_users.id)
      OR (tier='pichu' AND stored_bytes+?+COALESCE((SELECT sum(size_bytes) FROM studio_quota_reservations WHERE user_id=studio_users.id),0)
        <=CASE WHEN EXISTS(SELECT 1 FROM studio_dondon_users WHERE user_id=studio_users.id) THEN ? ELSE ? END)
      OR (tier='pikachu' AND CASE WHEN month_key=? THEN month_uploaded_bytes ELSE 0 END+?
        +COALESCE((SELECT sum(size_bytes) FROM studio_quota_reservations WHERE user_id=studio_users.id AND month_key=?),0)<=?))`)
    .bind(id, size, month, now + 3600000, userId, size, DONDON_LIMIT, BASE_LIMIT, month, size, month, CREATOR_MONTH_LIMIT).run();
  return result.meta?.changes === 1;
}

export async function releaseStudioQuota(db, id) {
  await db.prepare('DELETE FROM studio_quota_reservations WHERE id=?').bind(id).run();
}

export async function removeStudioFile(env, id, ownerId) {
  if ((id.startsWith('studio/') || ownerId) && env.img_d1?.prepare) {
    await env.img_d1.prepare('DELETE FROM studio_files WHERE id=?').bind(id).run();
  }
}

export async function moveStudioFile(env, id, newId, ownerId) {
  if ((id.startsWith('studio/') || ownerId) && env.img_d1?.prepare) {
    await env.img_d1.prepare('UPDATE studio_files SET id=? WHERE id=?').bind(newId, id).run();
  }
}
