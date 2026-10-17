/* Client de l'API communautaire Deadlock (https://api.deadlock-api.com). */
window.DL = window.DL || {};

(function (DL) {
  const BASE = 'https://api.deadlock-api.com';
  const TTL_MS = 10 * 60 * 1000;
  const memory = new Map();
  const inflight = new Map();

  function buildUrl(path, params) {
    const url = new URL(BASE + path);
    Object.entries(params || {}).forEach(([key, value]) => {
      if (value === null || value === undefined || value === '') return;
      url.searchParams.set(key, Array.isArray(value) ? value.join(',') : String(value));
    });
    return url.toString();
  }

  function readStore(url) {
    try {
      const raw = sessionStorage.getItem('dl:' + url);
      if (!raw) return null;
      const entry = JSON.parse(raw);
      return Date.now() - entry.t < TTL_MS ? entry.v : null;
    } catch (e) { return null; }
  }

  function writeStore(url, value) {
    try { sessionStorage.setItem('dl:' + url, JSON.stringify({ t: Date.now(), v: value })); }
    catch (e) { /* stockage plein ou indisponible : le cache mémoire suffit */ }
  }

  async function get(path, params, opts) {
    const url = buildUrl(path, params);
    const cache = !(opts && opts.noCache);
    if (cache && memory.has(url)) return memory.get(url);
    if (cache) {
      const stored = readStore(url);
      if (stored !== null) { memory.set(url, stored); return stored; }
    }
    if (inflight.has(url)) return inflight.get(url);
    const p = fetch(url, { headers: { Accept: 'application/json' } }).then(async (res) => {
      if (!res.ok) {
        let detail = '';
        try { detail = (await res.text()).slice(0, 200); } catch (e) { /* rien */ }
        const err = new Error(res.status === 429 ? 'Trop de requêtes, réessaie dans une minute.' : `Erreur API ${res.status}`);
        err.status = res.status; err.detail = detail;
        throw err;
      }
      return res.json();
    }).then((data) => {
      memory.set(url, data);
      if (cache) writeStore(url, data);
      return data;
    }).finally(() => inflight.delete(url));
    inflight.set(url, p);
    return p;
  }

  /* ---------- Filtres partagés (rang, période) ---------- */
  const FILTER_KEY = 'dl:filters';
  const defaults = { minBadge: 0, days: 14, mode: 'all' };
  let filters = { ...defaults };
  try { filters = { ...defaults, ...JSON.parse(localStorage.getItem(FILTER_KEY) || '{}') }; } catch (e) { /* défauts */ }

  function setFilters(next) {
    filters = { ...filters, ...next };
    try { localStorage.setItem(FILTER_KEY, JSON.stringify(filters)); } catch (e) { /* ignoré */ }
  }

  /* Paramètres communs aux endpoints analytics. Timestamp arrondi à l'heure pour profiter du cache. */
  function analyticsParams(extra) {
    const hour = Math.floor(Date.now() / 3600000) * 3600;
    return {
      game_mode: 'normal',
      match_mode: filters.mode === 'ranked' ? 'ranked' : null,
      min_unix_timestamp: hour - filters.days * 86400,
      min_average_badge: filters.minBadge || null,
      ...extra,
    };
  }

  /* ---------- Assets (héros, objets, rangs) ---------- */
  let assetsPromise = null;
  function loadAssets() {
    if (assetsPromise) return assetsPromise;
    assetsPromise = Promise.all([
      get('/v1/assets/heroes', { only_active: true, language: 'french' }).catch(() => get('/v1/assets/heroes', { only_active: true })),
      get('/v1/assets/items', { language: 'french' }).catch(() => get('/v1/assets/items')),
      get('/v1/assets/ranks', { language: 'french' }).catch(() => get('/v1/assets/ranks')),
    ]).then(([heroes, items, ranks]) => {
      const playable = heroes.filter((h) => h.player_selectable !== false && !h.disabled && !h.in_development);
      playable.sort((a, b) => a.name.localeCompare(b.name));
      const heroById = new Map(playable.map((h) => [h.id, h]));
      const itemById = new Map(items.map((i) => [i.id, i]));
      const itemByClass = new Map(items.map((i) => [i.class_name, i]));
      const rankByTier = new Map(ranks.map((r) => [r.tier, r]));
      DL.assets = { heroes: playable, heroById, items, itemById, itemByClass, ranks, rankByTier };
      return DL.assets;
    }).catch((err) => { assetsPromise = null; throw err; });
    return assetsPromise;
  }

  DL.api = { get, buildUrl, analyticsParams, loadAssets, BASE };
  DL.filters = () => filters;
  DL.setFilters = setFilters;
})(window.DL);
