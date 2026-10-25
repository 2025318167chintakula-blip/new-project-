import { db } from 'hatchable';
import { isAppAdmin } from '../../lib/app-admin.js';

export const access = 'user';
export const methods = ['GET'];

export default async function (req, res) {
  if (!(await isAppAdmin(req))) return res.status(403).json({ error: 'Admin access required.' });
  const [totals, statuses, volunteers, recent, monthly, types, reportRows] = await Promise.all([
    db.query('SELECT COUNT(*)::INT AS total, COUNT(*) FILTER (WHERE created_at >= NOW() - INTERVAL \'24 hours\')::INT AS last_24_hours FROM emergency_requests'),
    db.query('SELECT status, COUNT(*)::INT AS count FROM emergency_requests GROUP BY status ORDER BY status'),
    db.query("SELECT volunteer_status, COUNT(*)::INT AS count FROM user_profiles WHERE selected_role = 'volunteer' GROUP BY volunteer_status ORDER BY volunteer_status"),
    db.query('SELECT id, request_type, title, status, created_at, updated_at FROM emergency_requests ORDER BY created_at DESC LIMIT 12'),
    db.query("SELECT TO_CHAR(month_start, 'Mon YYYY') AS month, total::INT AS total FROM (SELECT DATE_TRUNC('month', created_at) AS month_start, COUNT(*) AS total FROM emergency_requests WHERE created_at >= DATE_TRUNC('month', NOW()) - INTERVAL '5 months' GROUP BY 1) m ORDER BY month_start"),
    db.query('SELECT request_type, COUNT(*)::INT AS count FROM emergency_requests GROUP BY request_type ORDER BY count DESC, request_type'),
    db.query('SELECT id, request_type, title, description, location_label, status, created_at, updated_at FROM emergency_requests ORDER BY created_at DESC')
  ]);
  return res.json({ totals: totals.rows[0], statuses: statuses.rows, volunteers: volunteers.rows, recent: recent.rows, monthly: monthly.rows, types: types.rows, reportRows: reportRows.rows });
}