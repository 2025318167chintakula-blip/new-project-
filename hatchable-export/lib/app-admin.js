import { db } from 'hatchable';

// Only this app account can grant or revoke administrator permissions.
export const OWNER_EMAIL = String(process.env.OWNER_EMAIL || '').trim().toLowerCase();

export async function isOwner(req) {
  return String(req.user?.email || '').trim().toLowerCase() === OWNER_EMAIL;
}

export async function isAppAdmin(req) {
  if (!req.user?.id) return false;
  if (await isOwner(req)) return true;
  const result = await db.query('SELECT 1 FROM app_admins WHERE admin_user_id = $1 LIMIT 1', [req.user.id]);
  return result.rows.length > 0;
}