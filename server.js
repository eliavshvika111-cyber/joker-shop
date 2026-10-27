// server.js
const http = require('http'), fs = require('fs'), path = require('path'), crypto = require('crypto');

const PORT = process.env.PORT || 3000;
const DB_ITEMS = path.join(__dirname, 'data', 'items.json');
const DB_TICKETS = path.join(__dirname, 'data', 'tickets.json');
const PUB = path.join(__dirname, 'public');
const UPLOADS_DIR = path.join(__dirname, 'data', 'uploads');

// סיסמת מנהל (שנה אותה כאן!)
const ADMIN_PASSWORD = 'joker123'; 

if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR, { recursive: true });
if (!fs.existsSync(DB_TICKETS)) fs.writeFileSync(DB_TICKETS, '[]');

const sessions = new Map(); // כאן נשמור מי מחובר כמנהל

const types = { '.html':'text/html; charset=utf-8','.css':'text/css','.js':'text/javascript','.webp':'image/webp','.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg','.gif':'image/gif' };
const loadItems = () => { try { return JSON.parse(fs.readFileSync(DB_ITEMS, 'utf8')); } catch { return []; } };
const saveItems = d => fs.writeFileSync(DB_ITEMS, JSON.stringify(d, null, 2));
const loadTickets = () => { try { return JSON.parse(fs.readFileSync(DB_TICKETS, 'utf8')); } catch { return []; } };
const saveTickets = d => fs.writeFileSync(DB_TICKETS, JSON.stringify(d, null, 2));
const send = (res, code, obj) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(obj)); };

http.createServer(async (req, res) => {
  const url = decodeURIComponent(req.url.split('?')[0]);
  
  const authHeader = req.headers['authorization'];
  const sessionId = authHeader ? authHeader.replace('Bearer ', '') : null;
  const user = sessionId ? sessions.get(sessionId) : null;

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

  // --- API Items ---
  if (url === '/api/items' && req.method === 'GET') {
    return send(res, 200, loadItems());
  }

  if (url === '/api/items' && req.method === 'POST') {
    if (!user || !user.isAdmin) return send(res, 401, { error: 'אין הרשאה' });
    const d = await new Promise(r => { let b = ''; req.on('data', c => { b += c; if (b.length > 10e6) req.destroy(); }); req.on('end', () => { try { r(JSON.parse(b)); } catch { r({}); } }); });

    if (!d.title || !d.category) return send(res, 400, { error: 'חסרים נתונים' });
    if (!d.link) return send(res, 400, { error: 'חייב לשים קישור להורדה' });
    
    let image = '';
    const m = /^data:image\/(png|jpeg|jpg|webp|gif);base64,(.+)$/.exec(d.image || '');
    if (m) { 
        image = '/uploads/' + crypto.randomBytes(8).toString('hex') + '.' + m[1].replace('jpeg', 'jpg'); 
        fs.writeFileSync(path.join(UPLOADS_DIR, path.basename(image)), Buffer.from(m[2], 'base64')); 
    }

    const items = loadItems();
    items.unshift({ 
        id: crypto.randomBytes(6).toString('hex'), 
        title: String(d.title).slice(0, 80), 
        category: d.category, 
        desc: String(d.desc || '').slice(0, 300), 
        link: d.link, 
        videoLink: d.videoLink || '',
        image, 
        date: Date.now() 
    });
    saveItems(items); return send(res, 200, { ok: true });
  }

  if (url.startsWith('/api/items/') && req.method === 'DELETE') {
    if (!user || !user.isAdmin) return send(res, 401, { error: 'אין הרשאה' });
    const id = url.split('/')[3];
    let items = loadItems();
    const item = items.find(i => i.id === id);
    if (!item) return send(res, 404, { error: 'לא נמצא' });

    if (item.image && item.image.startsWith('/uploads/')) {
        const p = path.join(__dirname, 'data', item.image);
        if (fs.existsSync(p)) fs.unlinkSync(p);
    }
    if (item.filePath && item.filePath.startsWith('/uploads/')) {
        const p = path.join(__dirname, 'data', item.filePath);
        if (fs.existsSync(p)) fs.unlinkSync(p);
    }

    items = items.filter(i => i.id !== id);
    saveItems(items); return send(res, 200, { ok: true });
  }

  if (url.startsWith('/api/items/') && req.method === 'PUT') {
    if (!user || !user.isAdmin) return send(res, 401, { error: 'אין הרשאה' });
    const id = url.split('/')[3];
    const d = await new Promise(r => { let b = ''; req.on('data', c => { b += c; if (b.length > 10e6) req.destroy(); }); req.on('end', () => { try { r(JSON.parse(b)); } catch { r({}); } }); });

    let items = loadItems();
    const itemIndex = items.findIndex(i => i.id === id);
    if (itemIndex === -1) return send(res, 404, { error: 'לא נמצא' });

    let image = items[itemIndex].image; 
    const m = /^data:image\/(png|jpeg|jpg|webp|gif);base64,(.+)$/.exec(d.image || '');
    if (m) {
        if (image && image.startsWith('/uploads/')) {
            const oldP = path.join(__dirname, 'data', image);
            if (fs.existsSync(oldP)) fs.unlinkSync(oldP);
        }
        image = '/uploads/' + crypto.randomBytes(8).toString('hex') + '.' + m[1].replace('jpeg', 'jpg'); 
        fs.writeFileSync(path.join(UPLOADS_DIR, path.basename(image)), Buffer.from(m[2], 'base64')); 
    }

    items[itemIndex] = {
        ...items[itemIndex],
        title: String(d.title).slice(0, 80),
        category: d.category,
        desc: String(d.desc || '').slice(0, 300),
        link: d.link || '',
        videoLink: d.videoLink || '',
        image
    };
    saveItems(items); return send(res, 200, { ok: true });
  }

  // --- API Tickets ---
  if (url === '/api/tickets' && req.method === 'GET') {
    const tickets = loadTickets();
    if (user && user.isAdmin) return send(res, 200, tickets);
    // משתמשים רגילים לא מחוברים, הם לא יכולים לראות פניות (או שהם יכולים לפתוח פניות אנונימיות)
    // כאן נשאיר את האפשרות לפתוח פניות אבל הם לא יראו היסטוריה כי אין להם זיהוי
    return send(res, 200, []); 
  }

  if (url === '/api/tickets' && req.method === 'POST') {
    const d = await new Promise(r => { let b = ''; req.on('data', c => b += c); req.on('end', () => { try { r(JSON.parse(b)); } catch { r({}); } }); });
    if (!d.subject || !d.message) return send(res, 400, { error: 'חסרים נתונים' });
    
    const tickets = loadTickets();
    tickets.unshift({
        id: crypto.randomBytes(4).toString('hex'),
        userId: 'anon',
        username: d.name || 'אורח',
        subject: d.subject,
        messages: [{ sender: d.name || 'אורח', text: d.message, time: Date.now(), isAdmin: false }],
        status: 'open',
        date: Date.now()
    });
    saveTickets(tickets); return send(res, 200, { ok: true });
  }

  if (url.startsWith('/api/tickets/') && req.method === 'POST') {
    const id = url.split('/')[3], action = url.split('/')[4];
    const d = await new Promise(r => { let b = ''; req.on('data', c => b += c); req.on('end', () => { try { r(JSON.parse(b)); } catch { r({}); } }); });
    
    let tickets = loadTickets();
    const tIndex = tickets.findIndex(x => x.id === id);
    if (tIndex === -1) return send(res, 404, { error: 'לא נמצא' });
    const t = tickets[tIndex];
    
    if (!user || !user.isAdmin) return send(res, 403, { error: 'אין הרשאה' });

    if (action === 'reply') {
        if (!d.message) return send(res, 400, { error: 'הודעה ריקה' });
        t.messages.push({ sender: user.username, text: d.message, time: Date.now(), isAdmin: true });
        saveTickets(tickets); return send(res, 200, { ok: true });
    }

    if (action === 'close') {
        t.status = 'closed';
        saveTickets(tickets); return send(res, 200, { ok: true });
    }
  }

  // --- סטטי ---
  let file = path.join(PUB, url === '/' ? 'index.html' : url);
  if (url.startsWith('/uploads/')) file = path.join(__dirname, 'data', url);
  if (!file.startsWith(__dirname) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); return res.end('404'); }
  
  const ext = path.extname(file);
  let headers = { 'Content-Type': types[ext] || 'application/octet-stream' };
  res.writeHead(200, headers);
  fs.createReadStream(file).pipe(res);
}).listen(PORT, () => console.log('🚀 שרת רץ על http://localhost:' + PORT));