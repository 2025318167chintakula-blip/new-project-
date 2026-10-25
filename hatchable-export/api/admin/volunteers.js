import { db } from 'hatchable';
import { isAppAdmin } from '../../lib/app-admin.js';

export const access = 'user';
export const methods = ['GET', 'PUT'];

export default async function (req, res) {
  if (!(await isAppAdmin(req))) return res.status(403).json({ error: 'Admin access required.' });
  if (req.method === 'GET') {
    const result = await db.query("SELECT user_id, selected_role, volunteer_status, created_at, updated_at FROM user_profiles WHERE selected_role = 'volunteer' ORDER BY created_at DESC LIMIT 200");
    return res.json({ volunteers: result.rows });
  }
  const userId = req.body && req.body.user_id;
  const status = req.body && req.body.status;
  if (typeof userId !== 'string' || !userId || !['verified', 'rejected', 'pending_review'].includes(status)) return res.status(400).json({ error: 'A valid user id and verification status are required.' });
  const result = await db.query("UPDATE user_profiles SET volunteer_status = $1, updated_at = NOW() WHERE user_id = $2 AND selected_role = 'volunteer' RETURNING user_id, selected_role, volunteer_status, updated_at", [status, userId]);
  if (!result.rows[0]) return res.status(404).json({ error: 'Volunteer profile not found.' });
  return res.json({ volunteer: result.rows[0] });
}