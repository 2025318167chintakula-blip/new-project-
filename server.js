require('dotenv').config();
const express = require('express');
const session = require('express-session');
const PgSession = require('connect-pg-simple')(session);
const { Pool } = require('pg');
const nodemailer = require('nodemailer');
const helmet = require('helmet');
const { rateLimit } = require('express-rate-limit');
const crypto = require('crypto');
const path = require('path');

const app = express();
const PORT = Number(process.env.PORT || 3000);
const isProduction = process.env.NODE_ENV === 'production';
if (!process.env.DATABASE_URL) console.warn('DATABASE_URL is not configured; database routes will not work.');
if (isProduction && !process.env.SESSION_SECRET) throw new Error('SESSION_SECRET must be set in production.');
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: process.env.PGSSL === 'true' ? { rejectUnauthorized: process.env.PGSSL_REJECT_UNAUTHORIZED !== 'false' } : undefined, max: 10, idleTimeoutMillis: 30000, connectionTimeoutMillis: 5000 });
pool.on('error', e => console.error('Unexpected PostgreSQL pool error:', e.message));

app.disable('x-powered-by');
app.set('trust proxy', isProduction ? 1 : false);
app.use(helmet({ contentSecurityPolicy: { directives: { defaultSrc: ["'self'"], styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'], fontSrc: ["'self'", 'https://fonts.gstatic.com', 'data:'], scriptSrc: ["'self'", "'unsafe-inline'"], imgSrc: ["'self'", 'data:'], connectSrc: ["'self'"], objectSrc: ["'none'"], frameAncestors: ["'none'"], upgradeInsecureRequests: isProduction ? [] : null } } }));
app.use(express.json({ limit: '32kb' }));
app.use(express.urlencoded({ extended: false, limit: '8kb' }));
app.use(session({
  store: process.env.DATABASE_URL ? new PgSession({ pool, tableName: 'user_sessions', createTableIfMissing: true, pruneSessionInterval: 15 * 60 }) : undefined,
  name: 'dg.sid',
  secret: process.env.SESSION_SECRET || 'local-development-only-change-this-secret',
  resave: false, saveUninitialized: false,
  cookie: { httpOnly: true, secure: isProduction, sameSite: 'lax', maxAge: 1000 * 60 * 60 * 12 }
}));

const authLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 8, standardHeaders: 'draft-7', legacyHeaders: false, message: { error: 'Too many sign-in attempts. Please wait 15 minutes and try again.' } });
const apiLimiter = rateLimit({ windowMs: 60 * 1000, limit: 120, standardHeaders: 'draft-7', legacyHeaders: false });
app.use('/api', apiLimiter);
const clean = (v, max=500) => typeof v === 'string' ? v.trim().slice(0,max) : '';
const normalizeEmail = v => clean(v,254).toLowerCase();
const ownerEmail = normalizeEmail(process.env.OWNER_EMAIL || '');
const codeHash = (email, code) => crypto.createHmac('sha256', process.env.SESSION_SECRET || 'local-development-only-change-this-secret').update(email + ':' + code).digest('hex');
const safeEqual = (a,b) => { const x=Buffer.from(String(a)); const y=Buffer.from(String(b)); return x.length===y.length && crypto.timingSafeEqual(x,y); };
const requireAuth = (req,res,next) => req.session.user ? next() : res.status(401).json({error:'Please sign in to continue.'});
const requireAdmin = async (req,res,next) => {
  if (!req.session.user) return res.status(401).json({error:'Please sign in.'});
  try {
    const result = await pool.query('SELECT is_admin,email FROM users WHERE id=$1',[req.session.user.id]);
    const u=result.rows[0];
    if (!u || (!u.is_admin && !(ownerEmail && normalizeEmail(u.email)===ownerEmail))) return res.status(403).json({error:'Administrator access is required.'});
    req.adminUser=u; next();
  } catch(e) { next(e); }
};
async function audit(actor,action,targetType,targetId,details={}) {
  await pool.query('INSERT INTO audit_logs(actor_user_id,action,target_type,target_id,details) VALUES($1,$2,$3,$4,$5)',[actor||null,action,targetType||null,targetId||null,JSON.stringify(details)]);
}
let mailer = null;
function getMailer() {
  if (mailer) return mailer;
  if (!process.env.SMTP_HOST || !process.env.SMTP_USER || !process.env.SMTP_PASS) return null;
  mailer = nodemailer.createTransport({host:process.env.SMTP_HOST,port:Number(process.env.SMTP_PORT||587),secure:Number(process.env.SMTP_PORT||587)===465,auth:{user:process.env.SMTP_USER,pass:process.env.SMTP_PASS}});
  return mailer;
}
app.get('/api/health', async (req,res) => {
  try { await pool.query('SELECT 1'); res.json({status:'ok',database:'connected',timestamp:new Date().toISOString()}); }
  catch(e) { res.status(503).json({status:'degraded',database:'unavailable'}); }
});
app.post('/api/auth/request-code', authLimiter, async (req,res,next) => {
  try {
    const email=normalizeEmail(req.body.email);
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return res.status(400).json({error:'Enter a valid email address.'});
    const transport=getMailer();
    if (!transport) return res.status(503).json({error:'Email sign-in is not configured yet. Set SMTP_HOST, SMTP_USER, SMTP_PASS and EMAIL_FROM in the hosting environment.'});
    const code=String(crypto.randomInt(0,1000000)).padStart(6,'0');
    await pool.query('INSERT INTO email_otps(email,code_hash,expires_at,attempts,created_at) VALUES($1,$2,NOW()+INTERVAL \'10 minutes\',0,NOW()) ON CONFLICT(email) DO UPDATE SET code_hash=EXCLUDED.code_hash,expires_at=EXCLUDED.expires_at,attempts=0,created_at=NOW()',[email,codeHash(email,code)]);
    try {
      await transport.sendMail({from:process.env.EMAIL_FROM||process.env.SMTP_USER,to:email,subject:'Your DisasterGuard sign-in code',text:'Your DisasterGuard sign-in code is '+code+'. It expires in 10 minutes. If you did not request this code, you can ignore this email.',html:'<div style="font-family:Arial,sans-serif;max-width:520px;margin:auto;padding:24px"><h2 style="color:#0b1f3a">DisasterGuard sign-in</h2><p>Your one-time sign-in code is:</p><p style="font-size:32px;font-weight:bold;letter-spacing:8px;color:#f15b43">'+code+'</p><p>This code expires in 10 minutes. If you did not request it, ignore this message.</p></div>'});
    } catch(mailError) { await pool.query('DELETE FROM email_otps WHERE email=$1',[email]); console.error('Email delivery failed:',mailError.message); return res.status(502).json({error:'Could not send the email code. Check SMTP settings and try again.'}); }
    res.json({ok:true,message:'If the address is valid, a code has been sent.'});
  } catch(e){next(e);}
});
app.post('/api/auth/verify-code', authLimiter, async (req,res,next) => {
  const client=await pool.connect();
  try {
    const email=normalizeEmail(req.body.email), code=clean(req.body.code,6);
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || !/^\d{6}$/.test(code)) return res.status(400).json({error:'Enter the email address and 6-digit code.'});
    await client.query('BEGIN');
    const found=await client.query('SELECT code_hash,expires_at,attempts FROM email_otps WHERE email=$1 FOR UPDATE',[email]);
    const otp=found.rows[0];
    if (!otp || new Date(otp.expires_at)<new Date() || otp.attempts>=5 || !safeEqual(otp.code_hash,codeHash(email,code))) {
      if (otp) await client.query('UPDATE email_otps SET attempts=attempts+1 WHERE email=$1',[email]);
      await client.query('COMMIT');
      return res.status(400).json({error:'The code is invalid or expired. Request a new code and try again.'});
    }
    await client.query('DELETE FROM email_otps WHERE email=$1',[email]);
    const id='email:'+crypto.createHash('sha256').update(email).digest('hex');
    const userResult=await client.query('INSERT INTO users(id,email,is_admin,last_login_at) VALUES($1,$2,$3,NOW()) ON CONFLICT(email) DO UPDATE SET last_login_at=NOW() RETURNING id,email,display_name,is_admin',[id,email,Boolean(ownerEmail && email===ownerEmail)]);
    const user=userResult.rows[0];
    if (ownerEmail && email===ownerEmail && !user.is_admin) await client.query('UPDATE users SET is_admin=TRUE WHERE id=$1',[user.id]);
    await client.query('INSERT INTO user_profiles(user_id,selected_role,volunteer_status) VALUES($1,\'victim\',\'unverified\') ON CONFLICT(user_id) DO NOTHING',[user.id]);
    await client.query('COMMIT');
    await new Promise((resolve,reject)=>req.session.regenerate(err=>err?reject(err):resolve()));
    req.session.user={id:user.id,email:user.email,display_name:user.display_name||null};
    await new Promise((resolve,reject)=>req.session.save(err=>err?reject(err):resolve()));
    res.json({ok:true,user:{id:user.id,email:user.email,display_name:user.display_name||null}});
  } catch(e){try{await client.query('ROLLBACK')}catch(_){}next(e);}
  finally{client.release();}
});
app.get('/api/auth/me', async (req,res,next) => {
  if (!req.session.user) return res.json({user:null});
  try { const r=await pool.query('SELECT u.id,u.email,u.display_name,u.is_admin,p.selected_role,p.volunteer_status FROM users u LEFT JOIN user_profiles p ON p.user_id=u.id WHERE u.id=$1',[req.session.user.id]); if(!r.rows[0]){req.session.destroy(()=>{});return res.json({user:null})} const u=r.rows[0];res.json({user:{id:u.id,email:u.email,display_name:u.display_name,is_admin:Boolean(u.is_admin)||(ownerEmail&&normalizeEmail(u.email)===ownerEmail),selected_role:u.selected_role||'victim',volunteer_status:u.volunteer_status||'unverified'}}); } catch(e){next(e);}
});
app.post('/api/auth/logout',(req,res)=>req.session.destroy(err=>{res.clearCookie('dg.sid',{httpOnly:true,sameSite:'lax',secure:isProduction});if(err)return res.status(500).json({error:'Could not sign out.'});res.json({ok:true})}));
app.get('/api/profile',requireAuth,async(req,res,next)=>{try{const r=await pool.query('SELECT selected_role,volunteer_status,display_name FROM user_profiles WHERE user_id=$1',[req.session.user.id]);res.json({profile:r.rows[0]||{selected_role:'victim',volunteer_status:'unverified'}})}catch(e){next(e)}});
app.post('/api/profile',requireAuth,async(req,res,next)=>{try{const role=req.body.role==='volunteer'?'volunteer':'victim';const r=await pool.query('INSERT INTO user_profiles(user_id,selected_role,volunteer_status,updated_at) VALUES($1,$2,$3,NOW()) ON CONFLICT(user_id) DO UPDATE SET selected_role=EXCLUDED.selected_role,volunteer_status=CASE WHEN EXCLUDED.selected_role=\'volunteer\' AND user_profiles.volunteer_status=\'unverified\' THEN \'pending_review\' ELSE user_profiles.volunteer_status END,updated_at=NOW() RETURNING selected_role,volunteer_status',[req.session.user.id,role,role==='volunteer'?'pending_review':'unverified']);await audit(req.session.user.id,'profile.role_changed','user',req.session.user.id,{role});res.json({profile:r.rows[0]})}catch(e){next(e)}});
app.get('/api/requests',requireAuth,async(req,res,next)=>{try{const view=clean(req.query.view,20)||'open';let r;if(view==='mine')r=await pool.query('SELECT id,request_type,title,description,location_label,status,created_at,updated_at FROM emergency_requests WHERE user_id=$1 ORDER BY created_at DESC LIMIT 100',[req.session.user.id]);else if(view==='assigned')r=await pool.query('SELECT id,request_type,title,description,location_label,contact_note,status,created_at,updated_at FROM emergency_requests WHERE volunteer_user_id=$1 AND status IN (\'accepted\',\'in_progress\',\'completed\') ORDER BY updated_at DESC LIMIT 100',[req.session.user.id]);else r=await pool.query('SELECT id,request_type,title,description,NULL::TEXT AS location_label,NULL::DOUBLE PRECISION AS latitude,NULL::DOUBLE PRECISION AS longitude,status,created_at FROM emergency_requests WHERE status=\'open\' AND user_id<>$1 ORDER BY created_at ASC LIMIT 100',[req.session.user.id]);res.json({requests:r.rows})}catch(e){next(e)}});
app.post('/api/requests',requireAuth,async(req,res,next)=>{try{const type=clean(req.body.request_type,60),title=clean(req.body.title,100),description=clean(req.body.description,1200),location=clean(req.body.location_label,180)||null,contact=clean(req.body.contact_note,180)||null;const lat=req.body.latitude,lng=req.body.longitude;const latitude=lat!==''&&lat!==null&&lat!==undefined&&Number.isFinite(Number(lat))?Number(lat):null,longitude=lng!==''&&lng!==null&&lng!==undefined&&Number.isFinite(Number(lng))?Number(lng):null;if(!type||!title||!description)return res.status(400).json({error:'Type, title, and description are required.'});if((latitude===null)!==(longitude===null))return res.status(400).json({error:'Share both latitude and longitude, or neither.'});if(latitude!==null&&(latitude < -90||latitude>90||longitude < -180||longitude>180))return res.status(400).json({error:'Location coordinates are invalid.'});const r=await pool.query('INSERT INTO emergency_requests(user_id,request_type,title,description,location_label,latitude,longitude,contact_note) VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id,request_type,title,description,location_label,status,created_at',[req.session.user.id,type,title,description,location,latitude,longitude,contact]);await audit(req.session.user.id,'request.created','emergency_request',r.rows[0].id,{request_type:type});res.status(201).json({request:r.rows[0]})}catch(e){next(e)}});
app.put('/api/requests',requireAuth,async(req,res,next)=>{const id=clean(req.body.id,60),action=clean(req.body.action,30);try{if(!id)return res.status(400).json({error:'Request id is required.'});if(action==='accept'){const p=await pool.query('SELECT volunteer_status,selected_role FROM user_profiles WHERE user_id=$1',[req.session.user.id]);if(!p.rows[0]||p.rows[0].selected_role!=='volunteer'||p.rows[0].volunteer_status!=='verified')return res.status(403).json({error:'Your volunteer account must be verified by an administrator before accepting a request.'});const r=await pool.query('UPDATE emergency_requests SET status=\'accepted\',volunteer_user_id=$1,updated_at=NOW() WHERE id=$2::uuid AND status=\'open\' AND user_id<>$1 RETURNING id,status,updated_at',[req.session.user.id,id]);if(!r.rows[0])return res.status(409).json({error:'This request is no longer available.'});await audit(req.session.user.id,'request.accepted','emergency_request',id);return res.json({request:r.rows[0]})}if(['in_progress','completed'].includes(action)){const r=await pool.query('UPDATE emergency_requests SET status=$1,updated_at=NOW() WHERE id=$2::uuid AND volunteer_user_id=$3 AND status IN (\'accepted\',\'in_progress\') RETURNING id,status,updated_at',[action,id,req.session.user.id]);if(!r.rows[0])return res.status(403).json({error:'Only the assigned volunteer can update this request.'});await audit(req.session.user.id,'request.'+action,'emergency_request',id);return res.json({request:r.rows[0]})}if(action==='cancel'){const r=await pool.query('UPDATE emergency_requests SET status=\'cancelled\',updated_at=NOW() WHERE id=$1::uuid AND user_id=$2 AND status=\'open\' RETURNING id,status',[id,req.session.user.id]);if(!r.rows[0])return res.status(403).json({error:'Only the owner can cancel an open request.'});await audit(req.session.user.id,'request.cancelled','emergency_request',id);return res.json({request:r.rows[0]})}return res.status(400).json({error:'Unsupported request action.'})}catch(e){next(e)}});
app.get('/api/admin/overview',requireAdmin,async(req,res,next)=>{try{const [totals,statuses,recent,monthly,types]=await Promise.all([pool.query('SELECT COUNT(*)::int total,COUNT(*) FILTER(WHERE created_at>NOW()-INTERVAL \'24 hours\')::int last_24_hours FROM emergency_requests'),pool.query('SELECT status,COUNT(*)::int count FROM emergency_requests GROUP BY status'),pool.query('SELECT id,request_type,title,description,location_label,status,created_at,updated_at FROM emergency_requests ORDER BY created_at DESC LIMIT 200'),pool.query('SELECT TO_CHAR(date_trunc(\'month\',created_at),\'Mon YY\') month,COUNT(*)::int total FROM emergency_requests WHERE created_at>NOW()-INTERVAL \'6 months\' GROUP BY date_trunc(\'month\',created_at) ORDER BY date_trunc(\'month\',created_at)'),pool.query('SELECT request_type,COUNT(*)::int count FROM emergency_requests GROUP BY request_type ORDER BY count DESC')]);res.json({totals:totals.rows[0],statuses:statuses.rows,recent:recent.rows,reportRows:recent.rows,monthly:monthly.rows,types:types.rows})}catch(e){next(e)}});
app.get('/api/admin/volunteers',requireAdmin,async(req,res,next)=>{try{const r=await pool.query('SELECT p.user_id,p.volunteer_status,p.created_at,u.email,u.display_name FROM user_profiles p JOIN users u ON u.id=p.user_id WHERE p.selected_role=\'volunteer\' ORDER BY p.created_at DESC');res.json({volunteers:r.rows})}catch(e){next(e)}});
app.put('/api/admin/volunteers',requireAdmin,async(req,res,next)=>{try{const id=clean(req.body.user_id,300),status=clean(req.body.status,30);if(!id||!['verified','rejected','pending_review'].includes(status))return res.status(400).json({error:'Valid user and status are required.'});const r=await pool.query('UPDATE user_profiles SET volunteer_status=$1,updated_at=NOW() WHERE user_id=$2 AND selected_role=\'volunteer\' RETURNING user_id,volunteer_status',[status,id]);if(!r.rows[0])return res.status(404).json({error:'Volunteer profile not found.'});await audit(req.session.user.id,'volunteer.status_changed','user',id,{status});res.json({volunteer:r.rows[0]})}catch(e){next(e)}});
app.get('/api/admin/users',requireAdmin,async(req,res,next)=>{try{const r=await pool.query('SELECT u.id AS user_id,u.email,u.display_name,u.is_admin,p.volunteer_status,p.created_at AS joined_at FROM users u LEFT JOIN user_profiles p ON p.user_id=u.id ORDER BY u.created_at DESC LIMIT 500');res.json({users:r.rows})}catch(e){next(e)}});
app.post('/api/admin/users',requireAdmin,async(req,res,next)=>{try{const email=normalizeEmail(req.body.email);if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))return res.status(400).json({error:'Enter a valid registered email.'});if(ownerEmail&&email===ownerEmail)return res.status(400).json({error:'The owner account is already privileged.'});const r=await pool.query('UPDATE users SET is_admin=TRUE WHERE email=$1 RETURNING id,email,is_admin',[email]);if(!r.rows[0])return res.status(404).json({error:'That email has not registered yet.'});await audit(req.session.user.id,'admin.granted','user',r.rows[0].id);res.json({user:r.rows[0]})}catch(e){next(e)}});
app.delete('/api/admin/users',requireAdmin,async(req,res,next)=>{try{const id=clean(req.body.user_id,300);if(!id)return res.status(400).json({error:'User id is required.'});const target=await pool.query('SELECT id,email FROM users WHERE id=$1',[id]);if(!target.rows[0])return res.status(404).json({error:'User not found.'});if(ownerEmail&&normalizeEmail(target.rows[0].email)===ownerEmail)return res.status(403).json({error:'Owner administrator access cannot be removed here.'});await pool.query('UPDATE users SET is_admin=FALSE WHERE id=$1',[id]);await audit(req.session.user.id,'admin.revoked','user',id);res.json({ok:true})}catch(e){next(e)}});
app.get('/api/admin/audit',requireAdmin,async(req,res,next)=>{try{const r=await pool.query('SELECT id,actor_user_id,action,target_type,target_id,details,created_at FROM audit_logs ORDER BY created_at DESC LIMIT 200');res.json({logs:r.rows})}catch(e){next(e)}});
app.use(express.static(path.join(__dirname,'public'),{extensions:['html'],maxAge:isProduction?'1h':0}));
app.get('*',(req,res,next)=>{if(req.path.startsWith('/api/'))return res.status(404).json({error:'API route not found.'});res.sendFile(path.join(__dirname,'public','index.html'))});
app.use((err,req,res,next)=>{console.error('Request failed:',err.message);if(res.headersSent)return next(err);res.status(500).json({error:'An unexpected server error occurred. Please try again.'})});
async function start(){try{if(process.env.DATABASE_URL)await pool.query('SELECT 1');app.listen(PORT,()=>console.log('DisasterGuard listening on port '+PORT));}catch(e){console.error('Startup database check failed:',e.message);process.exit(1)}}
start();
