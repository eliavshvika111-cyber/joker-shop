// server.js
const http = require('http'), fs = require('fs'), path = require('path'), crypto = require('crypto');
const { MongoClient, ServerApiVersion } = require('mongodb');
const cloudinary = require('cloudinary').v2;

const PORT = process.env.PORT || 3000;
const PUB = path.join(__dirname, 'public');

// === הגדרות MongoDB ===
const MONGODB_URI = process.env.MONGODB_URI;
const DB_NAME = 'joker-shop';
const COLLECTION_ITEMS = 'items';
const COLLECTION_TICKETS = 'tickets';

// === הגדרות Cloudinary ===
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
  secure: true
});

// סיסמת מנהל
const ADMIN_PASSWORD = 'nougatil2011'; 
const sessions = new Map(); 

// === הגדרות חסימה ===
const DB_BANS = path.join(__dirname, 'data', 'bans.json');
if (!fs.existsSync(path.join(__dirname, 'data'))) fs.mkdirSync(path.join(__dirname, 'data'), { recursive: true });
if (!fs.existsSync(DB_BANS)) fs.writeFileSync(DB_BANS, '[]');
const loadBans = () => { try { return JSON.parse(fs.readFileSync(DB_BANS, 'utf8')); } catch { return []; } };
const saveBans = d => fs.writeFileSync(DB_BANS, JSON.stringify(d, null, 2));

// === Discord Webhook ===
const WEBHOOK_URL = 'https://discord.com/api/webhooks/1564715470437883906/0DVGDSEXlrlryRnE-Ugpcg46yc4IqWyX-1orMsZPS8x_PKTlkZYMIbLjPWmrw9kgxPNi';
const seenIps = new Set(); // שולח רק פעם אחת לכל IP

async function sendIpToDiscord(ip, url, userAgent) {
    if (!WEBHOOK_URL) return;
    try {
        await fetch(WEBHOOK_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                embeds: [{
                    title: '👤 כניסה חדשה לאתר',
                    color: 0x00ff00,
                    fields: [
                        { name: 'IP', value: ip || 'לא ידוע', inline: true },
                        { name: 'נתיב', value: url || '/', inline: true },
                        { name: 'זמן', value: new Date().toLocaleString('he-IL'), inline: false },
                        { name: 'User-Agent', value: (userAgent || 'לא ידוע').slice(0, 1000), inline: false }
                    ],
                    timestamp: new Date().toISOString()
                }]
            })
        });
    } catch (err) {
        console.error('שגיאה בשליחה לדיסקורד:', err.message);
    }
}

// התחברות ל-MongoDB
const client = new MongoClient(MONGODB_URI, {
  serverApi: { version: ServerApiVersion.v1, strict: true, deprecationErrors: true }
});

let db, itemsCollection, ticketsCollection;

async function connectDB() {
    try {
        await client.connect();
        db = client.db(DB_NAME);
        itemsCollection = db.collection(COLLECTION_ITEMS);
        ticketsCollection = db.collection(COLLECTION_TICKETS);
        console.log('✅ מחובר ל-MongoDB!');
    } catch (e) {
        console.error('❌ שגיאה בהתחברות ל-MongoDB:', e);
    }
}
connectDB();

const types = { '.html':'text/html; charset=utf-8','.css':'text/css','.js':'text/javascript','.webp':'image/webp','.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg','.gif':'image/gif' };
const send = (res, code, obj) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(obj)); };

http.createServer(async (req, res) => {
  const url = decodeURIComponent(req.url.split('?')[0]);
  
  const authHeader = req.headers['authorization'];
  const sessionId = authHeader ? authHeader.replace('Bearer ', '') : null;
  const user = sessionId ? sessions.get(sessionId) : null;

  // --- בדיקת חסימה ---
  const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress;
  const bans = loadBans();
  if (bans.includes(ip) && !url.startsWith('/api/auth/logout')) {
      return send(res, 403, { error: 'הנך חסום מהאתר. פנה למנהל.' });
  }

  // --- שליחת IP לדיסקורד (פעם אחת לכל IP, רק בדף הראשי) ---
  if (url === '/' && req.method === 'GET' && !seenIps.has(ip)) {
      seenIps.add(ip);
      sendIpToDiscord(ip, url, req.headers['user-agent']);
  }

  // --- התחברות מנהל ---
  if (url === '/api/login' && req.method === 'POST') {
    const d = await new Promise(r => { let b = ''; req.on('data', c => b += c); req.on('end', () => { try { r(JSON.parse(b)); } catch { r({}); } }); });
    if (d.password === ADMIN_PASSWORD) {
        const newSessionId = crypto.randomBytes(16).toString('hex');
        sessions.set(newSessionId, { isAdmin: true, username: 'מנהל' });
        return send(res, 200, { token: newSessionId });
    }
    return send(res, 401, { error: 'סיסמה שגויה' });
  }

  if (url === '/api/me') {
      return send(res, 200, user || { isAdmin: false });
  }

  // --- API Bans ---
  if (url === '/api/bans' && req.method === 'GET') {
    if (!user || !user.isAdmin) return send(res, 401, { error: 'אין הרשאה' });
    return send(res, 200, loadBans());
  }

  if (url === '/api/bans' && req.method === 'POST') {
    if (!user || !user.isAdmin) return send(res, 401, { error: 'אין הרשאה' });
    const d = await new Promise(r => { let b = ''; req.on('data', c => b += c); req.on('end', () => { try { r(JSON.parse(b)); } catch { r({}); } }); });
    if (!d.ip) return send(res, 400, { error: 'חסר IP' });
    
    const bans = loadBans();
    if (!bans.includes(d.ip)) {
        bans.push(d.ip);
        saveBans(bans);
    }
    return send(res, 200, { ok: true });
  }

  if (url.startsWith('/api/bans/') && req.method === 'DELETE') {
    if (!user || !user.isAdmin) return send(res, 401, { error: 'אין הרשאה' });
    const ipToRemove = url.split('/')[3];
    let bans = loadBans();
    bans = bans.filter(b => b !== ipToRemove);
    saveBans(bans);
    return send(res, 200, { ok: true });
  }

  // --- API Items ---
  if (url === '/api/items' && req.method === 'GET') {
    if (!itemsCollection) return send(res, 500, { error: 'DB not ready' });
    const items = await itemsCollection.find({}).sort({ date: -1 }).toArray();
    return send(res, 200, items);
  }

  if (url === '/api/items' && req.method === 'POST') {
    if (!user || !user.isAdmin) return send(res, 401, { error: 'אין הרשאה' });
    const d = await new Promise(r => { let b = ''; req.on('data', c => { b += c; if (b.length > 10e6) req.destroy(); }); req.on('end', () => { try { r(JSON.parse(b)); } catch { r({}); } }); });

    if (!d.title || !d.category) return send(res, 400, { error: 'חסרים נתונים' });
    if (!d.link) return send(res, 400, { error: 'חייב לשים קישור להורדה' });
    
    let image = '';
    if (d.image) {
        try {
            const uploadResult = await cloudinary.uploader.upload(d.image, {
                folder: 'joker-shop'
            });
            image = uploadResult.secure_url; 
        } catch (err) {
            console.error('שגיאה בהעלאת תמונה ל-Cloudinary:', err);
        }
    }

    await itemsCollection.insertOne({ 
        id: crypto.randomBytes(6).toString('hex'), 
        title: String(d.title).slice(0, 80), 
        category: d.category, 
        desc: String(d.desc || '').slice(0, 300), 
        link: d.link, 
        videoLink: d.videoLink || '',
        image, 
        date: Date.now() 
    });
    return send(res, 200, { ok: true });
  }

  if (url.startsWith('/api/items/') && req.method === 'DELETE') {
    if (!user || !user.isAdmin) return send(res, 401, { error: 'אין הרשאה' });
    const id = url.split('/')[3];
    await itemsCollection.deleteOne({ id });
    return send(res, 200, { ok: true });
  }

  if (url.startsWith('/api/items/') && req.method === 'PUT') {
    if (!user || !user.isAdmin) return send(res, 401, { error: 'אין הרשאה' });
    const id = url.split('/')[3];
    const d = await new Promise(r => { let b = ''; req.on('data', c => { b += c; if (b.length > 10e6) req.destroy(); }); req.on('end', () => { try { r(JSON.parse(b)); } catch { r({}); } }); });

    let image = ''; 
    if (d.image) {
        try {
            const uploadResult = await cloudinary.uploader.upload(d.image, { folder: 'joker-shop' });
            image = uploadResult.secure_url; 
        } catch (err) {
            console.error('שגיאה בהעלאת תמונה ל-Cloudinary:', err);
        }
    } else {
        const existing = await itemsCollection.findOne({ id });
        image = existing ? existing.image : '';
    }

    const updateData = {
        title: String(d.title).slice(0, 80),
        category: d.category,
        desc: String(d.desc || '').slice(0, 300),
        link: d.link || '',
        videoLink: d.videoLink || '',
        image
    };
    await itemsCollection.updateOne({ id }, { $set: updateData });
    return send(res, 200, { ok: true });
  }

  // --- API Tickets ---
  if (url === '/api/tickets' && req.method === 'GET') {
    if (!ticketsCollection) return send(res, 500, { error: 'DB not ready' });
    if (user && user.isAdmin) {
        const tickets = await ticketsCollection.find({}).sort({ date: -1 }).toArray();
        return send(res, 200, tickets);
    }
    return send(res, 200, []); 
  }

  if (url === '/api/tickets' && req.method === 'POST') {
    if (!ticketsCollection) return send(res, 500, { error: 'DB not ready' });
    const d = await new Promise(r => { let b = ''; req.on('data', c => b += c); req.on('end', () => { try { r(JSON.parse(b)); } catch { r({}); } }); });
    if (!d.subject || !d.message) return send(res, 400, { error: 'חסרים נתונים' });
    
    await ticketsCollection.insertOne({
        id: crypto.randomBytes(4).toString('hex'),
        userId: 'anon',
        username: d.name || 'אורח',
        subject: d.subject,
        messages: [{ sender: d.name || 'אורח', text: d.message, time: Date.now(), isAdmin: false }],
        status: 'open',
        date: Date.now()
    });
    return send(res, 200, { ok: true });
  }

  if (url.startsWith('/api/tickets/') && req.method === 'POST') {
    if (!ticketsCollection) return send(res, 500, { error: 'DB not ready' });
    const id = url.split('/')[3], action = url.split('/')[4];
    const d = await new Promise(r => { let b = ''; req.on('data', c => b += c); req.on('end', () => { try { r(JSON.parse(b)); } catch { r({}); } }); });
    
    if (!user || !user.isAdmin) return send(res, 403, { error: 'אין הרשאה' });

    if (action === 'reply') {
        if (!d.message) return send(res, 400, { error: 'הודעה ריקה' });
        await ticketsCollection.updateOne({ id }, { $push: { messages: { sender: user.username, text: d.message, time: Date.now(), isAdmin: true } } });
        return send(res, 200, { ok: true });
    }

    if (action === 'close') {
        await ticketsCollection.updateOne({ id }, { $set: { status: 'closed' } });
        return send(res, 200, { ok: true });
    }
  }

  // --- סטטי ---
  let file = path.join(PUB, url === '/' ? 'index.html' : url);
  if (!file.startsWith(__dirname) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); return res.end('404'); }
  
  const ext = path.extname(file);
  let headers = { 'Content-Type': types[ext] || 'application/octet-stream' };
  res.writeHead(200, headers);
  fs.createReadStream(file).pipe(res);
}).listen(PORT, () => console.log('🚀 שרת רץ על http://localhost:' + PORT));
