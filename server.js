const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PORT = Number(process.env.PORT || 3000);
const ROOT = __dirname;
const DATA_DIR = path.join(ROOT, 'data');
const USERS_FILE = path.join(DATA_DIR, 'users.json');
const codes = new Map();
const sessions = new Map();

fs.mkdirSync(DATA_DIR, { recursive: true });
if (!fs.existsSync(USERS_FILE)) fs.writeFileSync(USERS_FILE, '[]', 'utf8');

const readUsers = () => JSON.parse(fs.readFileSync(USERS_FILE, 'utf8'));
const writeUsers = users => fs.writeFileSync(USERS_FILE, JSON.stringify(users, null, 2), 'utf8');
const sendJson = (res, status, value) => {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(value));
};
const readJson = req => new Promise((resolve, reject) => {
  let body = '';
  req.on('data', chunk => {
    body += chunk;
    if (body.length > 20_000) req.destroy();
  });
  req.on('end', () => {
    try { resolve(JSON.parse(body || '{}')); } catch (error) { reject(error); }
  });
});

async function api(req, res, pathname) {
  if (pathname === '/api/health' && req.method === 'GET') {
    return sendJson(res, 200, { ok: true, users: readUsers().length });
  }
  if (pathname === '/api/auth/code' && req.method === 'POST') {
    const { phone } = await readJson(req);
    if (!/^1\d{10}$/.test(phone || '')) return sendJson(res, 400, { message: '请输入正确的11位手机号' });
    const code = process.env.NODE_ENV === 'production'
      ? String(crypto.randomInt(100000, 1000000))
      : '123456';
    codes.set(phone, { code, expiresAt: Date.now() + 5 * 60_000 });
    // 正式环境应在这里调用已备案的短信服务商，绝不能把验证码返回给浏览器。
    if (process.env.NODE_ENV === 'production') {
      console.log(`待接入短信服务：${phone.slice(0, 3)}****${phone.slice(-4)}`);
      return sendJson(res, 503, { message: '短信服务尚未配置，请联系运营人员' });
    }
    return sendJson(res, 200, { message: '开发验证码已生成', developmentCode: code });
  }
  if (pathname === '/api/auth/verify' && req.method === 'POST') {
    const { phone, code, mode } = await readJson(req);
    const pending = codes.get(phone);
    if (!pending || pending.expiresAt < Date.now() || pending.code !== code) {
      return sendJson(res, 400, { message: '验证码错误或已过期' });
    }
    const users = readUsers();
    let user = users.find(item => item.phone === phone);
    if (mode === 'login' && !user) return sendJson(res, 404, { message: '该手机号尚未注册，请先注册' });
    if (mode === 'register' && user) return sendJson(res, 409, { message: '该手机号已经注册，请直接登录' });
    if (!user) {
      user = { id: crypto.randomUUID(), phone, nickname: `说友${phone.slice(-4)}`, createdAt: new Date().toISOString() };
      users.push(user);
      writeUsers(users);
    }
    codes.delete(phone);
    const token = crypto.randomBytes(32).toString('hex');
    sessions.set(token, { userId: user.id, expiresAt: Date.now() + 7 * 24 * 60 * 60_000 });
    return sendJson(res, 200, { token, user: { id: user.id, nickname: user.nickname } });
  }
  return sendJson(res, 404, { message: '接口不存在' });
}

const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp' };
const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    if (url.pathname.startsWith('/api/')) return await api(req, res, url.pathname);
    const requested = url.pathname === '/' ? 'index.html' : decodeURIComponent(url.pathname.slice(1));
    const file = path.resolve(ROOT, requested);
    if (!file.startsWith(ROOT + path.sep) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
      res.writeHead(404); return res.end('Not found');
    }
    res.writeHead(200, { 'Content-Type': types[path.extname(file).toLowerCase()] || 'application/octet-stream', 'X-Content-Type-Options': 'nosniff' });
    fs.createReadStream(file).pipe(res);
  } catch (error) {
    sendJson(res, 500, { message: '服务器暂时无法处理请求' });
  }
});

server.listen(PORT, '0.0.0.0', () => console.log(`说吧已启动：http://localhost:${PORT}`));
