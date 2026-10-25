import { db } from 'hatchable';
import { isOwner } from '../../lib/app-admin.js';

export const access = 'user';
export const methods = ['GET', 'POST', 'DELETE'];

export default async function (req, res) {
  if (!(await isOwner(req))) return res.status(403).json({ error: 'Only the application owner can manage admin permissions.' });

  if (req.method === 'GET') {
    const result = await db.query(`
      SELECT u.id AS user_id, u.email, COALESCE(u.name, '') AS name,
             (a.admin_user_id IS NOT NULL) AS is_admin, a.created_at AS admin_since
      FROM users u
      LEFT JOIN app_admins a ON a.admin_user_id = u.id
      ORDER BY (a.admin_user_id IS NOT NULL) DESC, u.email ASC
      LIMIT 300
    `);
    return res.json({ users: result.rows });
  }

  if (req.method === 'POST') {
    const email = String(req.body?.email || '').trim().toLowerCase();
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return res.status(400).json({ error: 'Enter a valid email address.' });
    if (email === String(process.env.OWNER_EMAIL || '').trim().toLowerCase()) return res.status(400).json({ error: 'The application owner already has permanent admin access.' });
    const user = await db.query('SELECT id, email, name FROM users WHERE LOWER(email) = $1 LIMIT 1', [email]);
    if (!user.rows[0]) return res.status(404).json({ error: 'No registered user has this email yet. Ask them to sign in to DisasterGuard first.' });
    await db.query('INSERT INTO app_admins (admin_user_id, granted_by) VALUES ($1, $2) ON CONFLICT (admin_user_id) DO NOTHING', [user.rows[0].id, req.user.id]);
    return res.json({ ok: true, message: 'Admin permission granted.', user: user.rows[0] });
  }

  const userId = String(req.body?.user_id || '').trim();
  if (!userId) return res.status(400).json({ error: 'User ID is required to remove admin permission.' });
  const result = await db.query('DELETE FROM app_admins WHERE admin_user_id = $1 RETURNING admin_user_id', [userId]);
  if (!result.rows[0]) return res.status(404).json({ error: 'Admin permission was not found for that user.' });
  return res.json({ ok: true, message: 'Admin permission removed.' });
}