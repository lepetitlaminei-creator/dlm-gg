/* Petit serveur sans dépendance : sert l'app et interroge l'API Twitch (Helix) pour retrouver
   les rediffusions des streamers, et gère la connexion avec Steam (OpenID).
   Les identifiants Twitch et la clé de session restent côté serveur.

   Lancement :  node server.js        (Node 18 ou plus récent)
   Config    :  fichier .env à côté de ce script, ou variables d'environnement
                TWITCH_CLIENT_ID=...   TWITCH_CLIENT_SECRET=...   PORT=8080
                PUBLIC_URL=https://mon-site.fr (seulement si l'app est en ligne) */
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = __dirname;
/* Dossiers où chercher le .env (l'app Windows y ajoute le dossier de l'exe et ses données utilisateur),
   et dossier où garder la clé de session. */
const ENV_DIRS = [ROOT, ...String(process.env.DLM_ENV_DIRS || '').split(path.delimiter).filter(Boolean)];
const DATA_DIR = process.env.DLM_DATA_DIR || ROOT;
const DESKTOP = process.env.DLM_DESKTOP === '1';
/* Onglet Streamers masqué : toujours dans l'app Windows, et sur le site public si HIDE_STREAMERS=1. */
/* Fichiers du dossier qui ne sont pas des pages du site. */
const PRIVATE_FILES = new Set(['server.js', 'package.json', 'package-lock.json', 'render.yaml', 'Dockerfile', 'CONTEXTE.md', 'DEPLOIEMENT.md', 'README.md', 'streamers.json', 'streamers-otp.json', 'streamers-otp.md']);
const HIDE_STREAMERS = DESKTOP || process.env.HIDE_STREAMERS === '1';

/* Lecture d'un éventuel fichier .env (CLE=valeur par ligne). */
ENV_DIRS.forEach((dir) => {
  try {
    fs.readFileSync(path.join(dir, '.env'), 'utf8').split(/\r?\n/).forEach((line) => {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
    });
  } catch (e) { /* pas de .env ici */ }
});

const PORT = Number(process.env.PORT) || 8080;
const CLIENT_ID = process.env.TWITCH_CLIENT_ID || '';
const CLIENT_SECRET = process.env.TWITCH_CLIENT_SECRET || '';
const TWITCH_READY = Boolean(CLIENT_ID && CLIENT_SECRET);
const VOD_TTL_MS = 10 * 60 * 1000;

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon',
};

/* ---------- Twitch ---------- */
let token = null;
let tokenExpires = 0;

async function appToken(force) {
  if (!force && token && Date.now() < tokenExpires - 60000) return token;
  const res = await fetch('https://id.twitch.tv/oauth2/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: CLIENT_ID, client_secret: CLIENT_SECRET, grant_type: 'client_credentials' }),
  });
  if (!res.ok) throw new Error(`Twitch a refusé les identifiants (${res.status})`);
  const data = await res.json();
  token = data.access_token;
  tokenExpires = Date.now() + data.expires_in * 1000;
  return token;
}

async function helix(pathname, params, retry = true) {
  const url = new URL('https://api.twitch.tv/helix' + pathname);
  Object.entries(params).forEach(([k, v]) => [].concat(v).forEach((x) => url.searchParams.append(k, x)));
  const res = await fetch(url, { headers: { 'Client-Id': CLIENT_ID, Authorization: `Bearer ${await appToken(false)}` } });
  if (res.status === 401 && retry) { await appToken(true); return helix(pathname, params, false); }
  if (!res.ok) throw new Error(`Erreur Twitch ${res.status}`);
  return res.json();
}

/* "3h2m1s" -> secondes */
const parseDuration = (s) => {
  const m = String(s).match(/(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?/) || [];
  return (Number(m[1]) || 0) * 3600 + (Number(m[2]) || 0) * 60 + (Number(m[3]) || 0);
};

const vodCache = new Map();
async function vodsFor(logins) {
  const out = {};
  const missing = logins.filter((l) => {
    const c = vodCache.get(l);
    if (c && Date.now() - c.t < VOD_TTL_MS) { out[l] = c.v; return false; }
    return true;
  });
  for (let i = 0; i < missing.length; i += 100) {
    const chunk = missing.slice(i, i + 100);
    const users = (await helix('/users', { login: chunk })).data || [];
    const found = new Set();
    await Promise.all(users.map(async (u) => {
      const videos = (await helix('/videos', { user_id: u.id, type: 'archive', first: 100 })).data || [];
      const v = {
        login: u.login, display_name: u.display_name, profile_image_url: u.profile_image_url,
        vods: videos.map((x) => ({
          id: x.id, title: x.title, url: x.url,
          start: Math.floor(Date.parse(x.created_at) / 1000), duration: parseDuration(x.duration),
        })),
      };
      const login = u.login.toLowerCase();
      found.add(login);
      vodCache.set(login, { t: Date.now(), v });
      out[login] = v;
    }));
    chunk.filter((l) => !found.has(l)).forEach((l) => { out[l] = null; vodCache.set(l, { t: Date.now(), v: null }); });
  }
  return out;
}

/* Chaînes qui streament Deadlock en ce moment (pour importer des streamers en un clic). */
let liveCache = null;
async function liveDeadlock() {
  if (liveCache && Date.now() - liveCache.t < 5 * 60000) return liveCache.v;
  const game = ((await helix('/games', { name: 'Deadlock' })).data || [])[0];
  if (!game) return [];
  const out = [];
  let after = null;
  for (let page = 0; page < 3; page++) {
    const res = await helix('/streams', { game_id: game.id, first: 100, ...(after ? { after } : {}) });
    (res.data || []).forEach((x) => out.push({ login: x.user_login.toLowerCase(), display_name: x.user_name, viewers: x.viewer_count, title: x.title, language: x.language }));
    after = res.pagination?.cursor;
    if (!after) break;
  }
  liveCache = { t: Date.now(), v: out };
  return out;
}

/* ---------- Connexion Steam (OpenID 2.0) ---------- */
const STEAM_OPENID = 'https://steamcommunity.com/openid/login';
const STEAM64_BASE = 76561197960265728n;
const SESSION_DAYS = 30;

/* Clé de signature des sessions : SESSION_SECRET, sinon une clé générée une fois et gardée dans .session-secret. */
const SESSION_SECRET = process.env.SESSION_SECRET || (() => {
  const file = path.join(DATA_DIR, '.session-secret');
  try { return fs.readFileSync(file, 'utf8').trim(); } catch (e) { /* à créer */ }
  const key = crypto.randomBytes(32).toString('hex');
  try { fs.writeFileSync(file, key, { mode: 0o600 }); } catch (e) { /* clé en mémoire seulement */ }
  return key;
})();

function origin(req) {
  if (process.env.PUBLIC_URL) return process.env.PUBLIC_URL.replace(/\/$/, '');
  const proto = (req.headers['x-forwarded-proto'] || 'http').split(',')[0].trim();
  return `${proto}://${req.headers.host}`;
}

const sign = (value) => crypto.createHmac('sha256', SESSION_SECRET).update(value).digest('base64url');

function sessionCookie(accountId) {
  const exp = Math.floor(Date.now() / 1000) + SESSION_DAYS * 86400;
  const value = `${accountId}.${exp}`;
  return `dl_session=${value}.${sign(value)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_DAYS * 86400}`;
}

function readSession(req) {
  const m = (req.headers.cookie || '').match(/(?:^|;\s*)dl_session=(\d+)\.(\d+)\.([\w-]+)/);
  if (!m) return null;
  const value = `${m[1]}.${m[2]}`;
  const expected = Buffer.from(sign(value));
  const given = Buffer.from(m[3]);
  if (expected.length !== given.length || !crypto.timingSafeEqual(expected, given)) return null;
  if (Number(m[2]) < Date.now() / 1000) return null;
  return Number(m[1]);
}

function steamLoginUrl(req) {
  const base = origin(req);
  const params = new URLSearchParams({
    'openid.ns': 'http://specs.openid.net/auth/2.0',
    'openid.mode': 'checkid_setup',
    'openid.return_to': `${base}/auth/steam/callback`,
    'openid.realm': base,
    'openid.identity': 'http://specs.openid.net/auth/2.0/identifier_select',
    'openid.claimed_id': 'http://specs.openid.net/auth/2.0/identifier_select',
  });
  return `${STEAM_OPENID}?${params}`;
}

/* Vérifie la réponse de Steam en la renvoyant à Steam (mode check_authentication). */
async function verifySteam(req, query) {
  if (query.get('openid.mode') !== 'id_res') return null;
  if (!String(query.get('openid.return_to') || '').startsWith(`${origin(req)}/auth/steam/callback`)) return null;
  const claimed = String(query.get('openid.claimed_id') || '').match(/^https:\/\/steamcommunity\.com\/openid\/id\/(\d{17})$/);
  if (!claimed) return null;
  const body = new URLSearchParams(query);
  body.set('openid.mode', 'check_authentication');
  const res = await fetch(STEAM_OPENID, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body });
  const text = await res.text();
  if (!/is_valid\s*:\s*true/.test(text)) return null;
  return Number(BigInt(claimed[1]) - STEAM64_BASE);
}

function redirect(res, location, cookie) {
  const headers = { Location: location, 'Cache-Control': 'no-store' };
  if (cookie) headers['Set-Cookie'] = cookie;
  res.writeHead(302, headers);
  res.end();
}

/* ---------- HTTP ---------- */
function send(res, status, body, type = 'application/json; charset=utf-8') {
  res.writeHead(status, { 'Content-Type': type, 'Cache-Control': 'no-store' });
  res.end(typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body));
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  try {
    if (url.pathname === '/robots.txt') return send(res, 200, `User-agent: *\nAllow: /\nDisallow: /api/\nDisallow: /auth/\nSitemap: ${origin(req)}/sitemap.xml\n`, 'text/plain; charset=utf-8');
    if (url.pathname === '/sitemap.xml') return send(res, 200, `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"><url><loc>${origin(req)}/</loc><changefreq>daily</changefreq></url></urlset>\n`, 'application/xml; charset=utf-8');
    if (url.pathname === '/api/status') return send(res, 200, { twitch: TWITCH_READY, steam_login: true });
    if (url.pathname === '/api/me') return send(res, 200, { account_id: readSession(req) });
    if (url.pathname === '/auth/steam') return redirect(res, steamLoginUrl(req));
    if (url.pathname === '/auth/steam/callback') {
      const accountId = await verifySteam(req, url.searchParams);
      if (!accountId) return redirect(res, '/#/connexion-echouee');
      return redirect(res, `/#/player/${accountId}`, sessionCookie(accountId));
    }
    if (url.pathname === '/auth/logout') return redirect(res, '/#/player', 'dl_session=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0');
    if (url.pathname === '/api/streamers') {
      let list = [];
      try { list = JSON.parse(fs.readFileSync(path.join(ROOT, 'streamers.json'), 'utf8')); } catch (e) { /* liste vide */ }
      return send(res, 200, list);
    }
    if (url.pathname === '/api/twitch/live') {
      if (!TWITCH_READY) return send(res, 503, { error: 'TWITCH_CLIENT_ID et TWITCH_CLIENT_SECRET ne sont pas configurés.' });
      return send(res, 200, await liveDeadlock());
    }
    if (url.pathname === '/api/twitch/vods') {
      if (!TWITCH_READY) return send(res, 503, { error: 'TWITCH_CLIENT_ID et TWITCH_CLIENT_SECRET ne sont pas configurés.' });
      const logins = [...new Set((url.searchParams.get('login') || '').toLowerCase().split(',').map((s) => s.trim()).filter((s) => /^[a-z0-9_]{2,25}$/.test(s)))];
      if (!logins.length) return send(res, 400, { error: 'Paramètre login manquant.' });
      return send(res, 200, await vodsFor(logins.slice(0, 300)));
    }

    /* Fichiers statiques */
    let file = path.normalize(path.join(ROOT, decodeURIComponent(url.pathname)));
    if (!file.startsWith(ROOT) || path.basename(file).startsWith('.') || (path.dirname(file) === ROOT && PRIVATE_FILES.has(path.basename(file)))) return send(res, 404, 'Introuvable', 'text/plain');
    if (fs.existsSync(file) && fs.statSync(file).isDirectory()) file = path.join(file, 'index.html');
    if (!fs.existsSync(file)) return send(res, 404, 'Introuvable', 'text/plain');
    /* App Windows ou site public : page d'accueil sans l'onglet Streamers. */
    if (file === path.join(ROOT, 'index.html')) {
      let html = fs.readFileSync(file, 'utf8');
      /* Référencement : adresse canonique, et balise de validation Google Search Console si fournie. */
      const base = origin(req).replace(/["<>\s]/g, '');
      const head = [`<link rel="canonical" href="${base}/">`, `<meta property="og:url" content="${base}/">`];
      if (process.env.GOOGLE_SITE_VERIFICATION) head.push(`<meta name="google-site-verification" content="${String(process.env.GOOGLE_SITE_VERIFICATION).replace(/[^\w-]/g, '')}">`);
      html = html.replace('</head>', `  ${head.join('\n  ')}\n</head>`);
      if (HIDE_STREAMERS) {
        html = html.replace(/\s*<a href="#\/streamers"[^>]*>Streamers<\/a>/, '')
          .replace('<script src="js/api.js"></script>', '<script>window.DLM_NO_STREAMERS = true;</script>\n  <script src="js/api.js"></script>');
      }
      return send(res, 200, html, MIME['.html']);
    }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
    fs.createReadStream(file).pipe(res);
  } catch (err) {
    send(res, 502, { error: err.message });
  }
});

server.listen(PORT, () => {
  console.log(`DLM.gg : http://localhost:${PORT}`);
  console.log(TWITCH_READY ? 'Twitch : configuré, les POV sont actives.' : 'Twitch : non configuré (TWITCH_CLIENT_ID / TWITCH_CLIENT_SECRET), les POV sont désactivées.');
});

module.exports = server;
