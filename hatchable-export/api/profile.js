import { db } from 'hatchable';

export const access = 'user';
export const methods = ['GET', 'POST'];

export default async function (req, res) {
  if (req.method === 'GET') {
    const result = await db.query('SELECT selected_role, volunteer_status, display_name, created_at FROM user_profiles WHERE user_id = $1', [req.user.id]);
    return res.json({ profile: result.rows[0] || null });
  }
  const action = req.body && req.body.action;
  if (action === 'request_verification') {
    const result = await db.query("INSERT INTO user_profiles (user_id, selected_role, volunteer_status, updated_at) VALUES ($1, 'volunteer', 'pending_review', NOW()) ON CONFLICT (user_id) DO UPDATE SET selected_role = 'volunteer', volunteer_status = CASE WHEN user_profiles.volunteer_status = 'verified' THEN 'verified' ELSE 'pending_review' END, updated_at = NOW() RETURNING selected_role, volunteer_status, display_name, created_at", [req.user.id]);
    return res.json({ profile: result.rows[0] });
  }
  const role = req.body && req.body.role;
  if (!['victim', 'volunteer'].includes(role)) return res.status(400).json({ error: 'Choose a valid role.' });
  const result = await db.query('INSERT INTO user_profiles (user_id, selected_role, updated_at) VALUES ($1, $2, NOW()) ON CONFLICT (user_id) DO UPDATE SET selected_role = EXCLUDED.selected_role, updated_at = NOW() RETURNING selected_role, volunteer_status, display_name, created_at', [req.user.id, role]);
  return res.json({ profile: result.rows[0] });
}