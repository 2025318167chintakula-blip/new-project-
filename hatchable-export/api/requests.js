import { db } from 'hatchable';

export const access = 'user';
export const methods = ['GET', 'POST', 'PUT'];

const clean = (v, max) => typeof v === 'string' ? v.trim().slice(0, max) : '';

export default async function (req, res) {
  if (req.method === 'GET') {
    const view = String((req.query && req.query.view) || 'open');
    if (view === 'mine') {
      const result = await db.query('SELECT id, request_type, title, description, location_label, latitude, longitude, contact_note, status, created_at, updated_at FROM emergency_requests WHERE user_id = $1 ORDER BY created_at DESC LIMIT 100', [req.user.id]);
      return res.json({ requests: result.rows });
    }
    if (view === 'assigned') {
      const result = await db.query('SELECT id, request_type, title, description, location_label, latitude, longitude, contact_note, status, created_at, updated_at FROM emergency_requests WHERE volunteer_user_id = $1 AND status IN (\'accepted\',\'in_progress\',\'completed\') ORDER BY updated_at DESC LIMIT 100', [req.user.id]);
      return res.json({ requests: result.rows });
    }
    const result = await db.query("SELECT id, request_type, title, description, NULL::TEXT AS location_label, NULL::DOUBLE PRECISION AS latitude, NULL::DOUBLE PRECISION AS longitude, status, created_at FROM emergency_requests WHERE status = 'open' AND user_id <> $1 ORDER BY created_at ASC LIMIT 100", [req.user.id]);
    return res.json({ requests: result.rows });
  }

  if (req.method === 'POST') {
    const type = clean(req.body && req.body.request_type, 60);
    const title = clean(req.body && req.body.title, 100);
    const description = clean(req.body && req.body.description, 1200);
    const location = clean(req.body && req.body.location_label, 180) || null;
    const contact = clean(req.body && req.body.contact_note, 180) || null;
    const lat = req.body && req.body.latitude;
    const lng = req.body && req.body.longitude;
    const latitude = Number.isFinite(Number(lat)) && lat !== '' && lat !== null && lat !== undefined ? Number(lat) : null;
    const longitude = Number.isFinite(Number(lng)) && lng !== '' && lng !== null && lng !== undefined ? Number(lng) : null;
    if (!type || !title || !description) return res.status(400).json({ error: 'Type, title, and description are required.' });
    if ((latitude === null) !== (longitude === null)) return res.status(400).json({ error: 'Share both latitude and longitude, or neither.' });
    if (latitude !== null && (latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180)) return res.status(400).json({ error: 'The location coordinates are invalid.' });
    const result = await db.query('INSERT INTO emergency_requests (user_id, request_type, title, description, location_label, latitude, longitude, contact_note) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id, request_type, title, description, location_label, status, created_at', [req.user.id, type, title, description, location, latitude, longitude, contact]);
    await db.query("INSERT INTO user_profiles (user_id, selected_role, updated_at) VALUES ($1, 'victim', NOW()) ON CONFLICT (user_id) DO UPDATE SET selected_role = 'victim', updated_at = NOW()", [req.user.id]);
    return res.status(201).json({ request: result.rows[0] });
  }

  const id = clean(req.body && req.body.id, 60);
  const action = clean(req.body && req.body.action, 30);
  if (!id) return res.status(400).json({ error: 'Request id is required.' });
  if (action === 'accept') {
    const profile = await db.query("SELECT volunteer_status FROM user_profiles WHERE user_id = $1 AND selected_role = 'volunteer'", [req.user.id]);
    if (!profile.rows[0] || profile.rows[0].volunteer_status !== 'verified') return res.status(403).json({ error: 'Your volunteer profile must be verified by an administrator before accepting requests.' });
    const result = await db.query("UPDATE emergency_requests SET status = 'accepted', volunteer_user_id = $1, updated_at = NOW() WHERE id = $2::uuid AND status = 'open' AND user_id <> $1 RETURNING id, request_type, title, description, location_label, latitude, longitude, contact_note, status, created_at, updated_at", [req.user.id, id]);
    if (!result.rows[0]) return res.status(409).json({ error: 'This request is no longer available to accept.' });
    await db.query("INSERT INTO user_profiles (user_id, selected_role, volunteer_status, updated_at) VALUES ($1, 'volunteer', 'unverified', NOW()) ON CONFLICT (user_id) DO UPDATE SET selected_role = 'volunteer', updated_at = NOW()", [req.user.id]);
    return res.json({ request: result.rows[0] });
  }
  if (['in_progress', 'completed'].includes(action)) {
    const result = await db.query('UPDATE emergency_requests SET status = $1, updated_at = NOW() WHERE id = $2::uuid AND volunteer_user_id = $3 AND status IN (\'accepted\',\'in_progress\') RETURNING id, status, updated_at', [action, id, req.user.id]);
    if (!result.rows[0]) return res.status(403).json({ error: 'Only the volunteer assigned to this request can update it.' });
    return res.json({ request: result.rows[0] });
  }
  if (action === 'cancel') {
    const result = await db.query("UPDATE emergency_requests SET status = 'cancelled', updated_at = NOW() WHERE id = $1::uuid AND user_id = $2 AND status = 'open' RETURNING id, status", [id, req.user.id]);
    if (!result.rows[0]) return res.status(403).json({ error: 'Only the request owner can cancel an open request.' });
    return res.json({ request: result.rows[0] });
  }
  return res.status(400).json({ error: 'Unsupported request action.' });
}