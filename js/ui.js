/* Petits utilitaires d'affichage partagés par toutes les pages. */
(function (DL) {
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  const pct = (v, digits = 1) => (Number.isFinite(v) ? (v * 100).toFixed(digits) + '%' : '–');
  const num = (v) => (Number.isFinite(v) ? Math.round(v).toLocaleString('fr-FR') : '–');
  const compact = (v) => {
    if (!Number.isFinite(v)) return '–';
    if (Math.abs(v) >= 1e6) return (v / 1e6).toFixed(1).replace('.', ',') + ' M';
    if (Math.abs(v) >= 1e3) return (v / 1e3).toFixed(1).replace('.', ',') + ' k';
    return String(Math.round(v));
  };
  const signed = (v, fmt = compact) => (Number.isFinite(v) ? (v > 0 ? '+' : v < 0 ? '−' : '') + fmt(Math.abs(v)) : '–');
  const duration = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
  /* Date en secondes Unix, quel que soit le format renvoyé (nombre, texte numérique, ISO ou « AAAA-MM-JJ hh:mm:ss » en UTC). */
  const toUnix = (v) => {
    if (typeof v === 'number') return v > 1e12 ? Math.floor(v / 1000) : v;
    if (v == null || v === '') return NaN;
    if (/^\d+$/.test(String(v))) return toUnix(Number(v));
    const s = String(v).trim().replace(' ', 'T');
    return Math.floor(Date.parse(/[zZ]|[+-]\d\d:?\d\d$/.test(s) ? s : s + 'Z') / 1000);
  };
  const ago = (t) => {
    const unix = toUnix(t);
    const d = Date.now() / 1000 - unix;
    if (d < 3600) return `il y a ${Math.max(1, Math.round(d / 60))} min`;
    if (d < 86400) return `il y a ${Math.round(d / 3600)} h`;
    if (d < 86400 * 30) return `il y a ${Math.round(d / 86400)} j`;
    return new Date(unix * 1000).toLocaleDateString('fr-FR');
  };
  const kda = (k, d, a) => ((k + a) / Math.max(1, d));

  /* Couleur d'un winrate, comme sur DPM : vert au-dessus de 52 %, rouge sous 48 %. */
  function wrClass(wr) {
    if (!Number.isFinite(wr)) return '';
    if (wr >= 0.53) return 'wr-great';
    if (wr >= 0.51) return 'wr-good';
    if (wr <= 0.47) return 'wr-bad';
    if (wr <= 0.49) return 'wr-meh';
    return 'wr-even';
  }

  function heroImg(hero, cls = 'hero-icon') {
    if (!hero) return `<span class="${cls} hero-missing">?</span>`;
    const src = hero.images?.icon_image_small_webp || hero.images?.icon_image_small || hero.images?.icon_hero_card_webp || hero.images?.icon_hero_card || '';
    return `<img class="${cls}" src="${esc(src)}" alt="${esc(hero.name)}" title="${esc(hero.name)}" loading="lazy">`;
  }

  function heroCard(hero) {
    return hero?.images?.icon_hero_card_webp || hero?.images?.icon_hero_card || hero?.images?.icon_image_small || '';
  }

  const SLOT_LABEL = { weapon: 'Arme', vitality: 'Vitalité', spirit: 'Esprit' };

  function imgFallback(img) {
    const rest = (img.dataset.alt || '').split('|').filter(Boolean);
    if (!rest.length) { img.onerror = null; img.replaceWith(document.createTextNode((img.alt || '?').slice(0, 2))); return; }
    img.src = rest.shift();
    img.dataset.alt = rest.join('|');
  }

  function itemImg(item, extra = '') {
    if (!item) return '<span class="item-icon item-missing">?</span>';
    /* Icônes officielles du jeu fournies par l'API ; si une adresse ne charge pas, on essaie la suivante. */
    const srcs = [...new Set([item.shop_image_webp, item.shop_image, item.shop_image_small_webp, item.shop_image_small, item.image_webp, item.image].filter(Boolean))];
    const src = srcs[0] || '';
    const slot = item.item_slot_type || 'ability';
    const tip = `${item.name}${item.cost ? ' · ' + num(item.cost) + ' âmes' : ''}${SLOT_LABEL[slot] ? ' · ' + SLOT_LABEL[slot] : ''}`;
    return `<span class="item-icon slot-${esc(slot)}" title="${esc(tip)}">${src ? `<img src="${esc(src)}" data-alt="${esc(srcs.slice(1).join('|'))}" alt="${esc(item.name)}" loading="lazy" onerror="DL.ui.imgFallback(this)">` : esc(item.name.slice(0, 2))}${extra}</span>`;
  }

  /* Badge = palier * 10 + sous-rang (ex. 113 = Eternus 3). */
  function rankInfo(badge) {
    if (!Number.isFinite(badge) || badge <= 0) return null;
    const tier = Math.floor(badge / 10);
    const sub = badge % 10;
    const rank = DL.assets?.rankByTier.get(tier);
    if (!rank) return { name: `Palier ${tier}`, sub, img: '', color: '#888' };
    const im = rank.images || {};
    const img = (sub && (im[`small_subrank${sub}_webp`] || im[`small_subrank${sub}`])) || im.small_webp || im.small || '';
    return { name: rank.name, sub, img, color: rank.color || '#888' };
  }

  function rankBadge(badge, size = 'sm') {
    const r = rankInfo(badge);
    if (!r) return '<span class="rank rank-none">Non classé</span>';
    return `<span class="rank rank-${size}" style="--rank:${esc(r.color)}">${r.img ? `<img src="${esc(r.img)}" alt="">` : ''}<span>${esc(r.name)}${r.sub ? ' ' + r.sub : ''}</span></span>`;
  }

  /* ---------- Tiers ---------- */
  /* Score = winrate lissé (bayésien, a priori 50 %) + bonus de popularité, puis découpage par écart-type. */
  function computeTiers(rows, totalGames) {
    const PRIOR = 400;
    const scored = rows.map((r) => {
      const wr = r.wins / Math.max(1, r.matches);
      const smoothWr = (r.wins + PRIOR * 0.5) / (r.matches + PRIOR);
      const pickRate = totalGames ? r.matches / totalGames : 0;
      const score = (smoothWr - 0.5) * 100 + Math.log10(1 + pickRate * 100) * 1.2;
      return { ...r, wr, pickRate, score };
    });
    const mean = scored.reduce((s, r) => s + r.score, 0) / Math.max(1, scored.length);
    const sd = Math.sqrt(scored.reduce((s, r) => s + (r.score - mean) ** 2, 0) / Math.max(1, scored.length)) || 1;
    scored.forEach((r) => {
      const z = (r.score - mean) / sd;
      r.z = z;
      r.tier = z >= 1.4 ? 'S+' : z >= 0.7 ? 'S' : z >= 0.1 ? 'A' : z >= -0.5 ? 'B' : z >= -1.2 ? 'C' : 'D';
    });
    return scored;
  }

  const tierPill = (t) => `<span class="tier tier-${t.replace('+', 'p')}">${t}</span>`;

  /* ---------- États ---------- */
  const loading = (label = 'Chargement des données…') => `<div class="state"><div class="spinner"></div><p>${esc(label)}</p></div>`;
  function errorState(err, retry = true) {
    const net = err && (err.name === 'TypeError' || /fetch/i.test(err.message || ''));
    const msg = net ? "Impossible de joindre l'API Deadlock. Vérifie ta connexion ou réessaie plus tard." : (err?.message || 'Erreur inconnue');
    return `<div class="state state-error"><p>${esc(msg)}</p>${retry ? '<button class="btn" onclick="DL.router.render()">Réessayer</button>' : ''}</div>`;
  }
  const empty = (label) => `<div class="state"><p>${esc(label)}</p></div>`;

  /* ---------- Barre de filtres (rang + période + mode) ---------- */
  function filterBar(onChange, opts = {}) {
    const f = DL.filters();
    const ranks = (DL.assets?.ranks || []).filter((r) => r.tier > 0).sort((a, b) => a.tier - b.tier);
    const rankOpts = ['<option value="0">Tous les rangs</option>']
      .concat(ranks.map((r) => `<option value="${r.tier * 10 + 1}" ${f.minBadge === r.tier * 10 + 1 ? 'selected' : ''}>${esc(r.name)}+</option>`)).join('');
    const id = 'fb' + Math.random().toString(36).slice(2, 7);
    setTimeout(() => {
      const root = document.getElementById(id);
      if (!root) return;
      root.addEventListener('change', () => {
        DL.setFilters({
          minBadge: Number(root.querySelector('[name=badge]').value),
          days: Number(root.querySelector('[name=days]').value),
          mode: root.querySelector('[name=mode]').value,
        });
        onChange();
      });
    });
    return `<div class="filters" id="${id}">
      <label><span>Rang</span><select name="badge">${rankOpts}</select></label>
      <label><span>Période</span><select name="days">
        ${[[3, '3 derniers jours'], [7, '7 derniers jours'], [14, '14 derniers jours'], [30, '30 derniers jours']].map(([v, l]) => `<option value="${v}" ${f.days === v ? 'selected' : ''}>${l}</option>`).join('')}
      </select></label>
      <label><span>Mode</span><select name="mode">
        <option value="all" ${f.mode === 'all' ? 'selected' : ''}>Classé + normal</option>
        <option value="ranked" ${f.mode === 'ranked' ? 'selected' : ''}>Classé uniquement</option>
      </select></label>
      ${opts.extra || ''}
    </div>`;
  }

  /* ---------- Sélecteur de héros (grille d'icônes filtrable) ---------- */
  function heroPicker({ selected, onPick, exclude, placeholder = 'Choisir un héros' }) {
    const id = 'hp' + Math.random().toString(36).slice(2, 7);
    const hero = DL.assets.heroById.get(selected);
    setTimeout(() => {
      const root = document.getElementById(id);
      if (!root) return;
      const btn = root.querySelector('.picker-btn');
      const panel = root.querySelector('.picker-panel');
      const input = root.querySelector('input');
      const grid = root.querySelector('.picker-grid');
      const draw = () => {
        const q = input.value.trim().toLowerCase();
        grid.innerHTML = DL.assets.heroes
          .filter((h) => h.id !== exclude && (!q || h.name.toLowerCase().includes(q)))
          .map((h) => `<button type="button" data-id="${h.id}" class="${h.id === selected ? 'active' : ''}">${heroImg(h)}<span>${esc(h.name)}</span></button>`).join('');
      };
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        document.querySelectorAll('.picker-panel').forEach((p) => { if (p !== panel) p.hidden = true; });
        panel.hidden = !panel.hidden;
        if (!panel.hidden) { draw(); input.focus(); }
      });
      input.addEventListener('input', draw);
      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') { e.preventDefault(); const first = grid.querySelector('button'); if (first) first.click(); }
      });
      grid.addEventListener('click', (e) => {
        const b = e.target.closest('button[data-id]');
        if (!b) return;
        panel.hidden = true;
        onPick(Number(b.dataset.id));
      });
      panel.addEventListener('click', (e) => e.stopPropagation());
    });
    return `<div class="picker" id="${id}">
      <button type="button" class="picker-btn ${hero ? 'has-hero' : ''}">
        ${hero ? `<img src="${esc(heroCard(hero))}" alt="">` : '<span class="picker-q">?</span>'}
        <span>${hero ? esc(hero.name) : esc(placeholder)}</span>
      </button>
      <div class="picker-panel" hidden>
        <input type="search" placeholder="Filtrer…">
        <div class="picker-grid"></div>
      </div>
    </div>`;
  }
  document.addEventListener('click', () => document.querySelectorAll('.picker-panel').forEach((p) => { p.hidden = true; }));

  /* Tableau triable : colonnes [{key, label, render, sort, cls}] */
  function sortableTable({ rows, columns, initial, initialDir = -1, rowAttrs, cls = '' }) {
    const id = 'st' + Math.random().toString(36).slice(2, 7);
    let sortKey = initial;
    let dir = initialDir;
    const body = () => {
      const col = columns.find((c) => c.key === sortKey);
      const getter = col?.sort || ((r) => r[sortKey]);
      const sorted = [...rows].sort((a, b) => {
        const va = getter(a); const vb = getter(b);
        if (typeof va === 'string') return dir * va.localeCompare(vb);
        return dir * ((va ?? -Infinity) - (vb ?? -Infinity));
      });
      return sorted.map((r, i) => `<tr ${rowAttrs ? rowAttrs(r) : ''}>${columns.map((c) => `<td class="${c.cls || ''}">${c.render ? c.render(r, i) : esc(r[c.key])}</td>`).join('')}</tr>`).join('');
    };
    setTimeout(() => {
      const root = document.getElementById(id);
      if (!root) return;
      root.querySelector('thead').addEventListener('click', (e) => {
        const th = e.target.closest('th[data-key]');
        if (!th) return;
        if (th.dataset.key === sortKey) dir = -dir; else { sortKey = th.dataset.key; dir = th.dataset.key === 'name' ? 1 : -1; }
        root.querySelectorAll('th').forEach((t) => t.classList.toggle('sorted', t.dataset.key === sortKey));
        root.querySelectorAll('th').forEach((t) => t.dataset.dir = t.dataset.key === sortKey ? (dir > 0 ? 'asc' : 'desc') : '');
        root.querySelector('tbody').innerHTML = body();
      });
    });
    return `<div class="table-wrap"><table class="table ${cls}" id="${id}">
      <thead><tr>${columns.map((c) => `<th class="${c.cls || ''} ${c.key === sortKey ? 'sorted' : ''}" ${c.nosort ? '' : `data-key="${c.key}"`} data-dir="${c.key === sortKey ? (dir > 0 ? 'asc' : 'desc') : ''}">${c.label}</th>`).join('')}</tr></thead>
      <tbody>${body()}</tbody>
    </table></div>`;
  }

  DL.ui = { esc, pct, num, compact, signed, duration, toUnix, ago, kda, wrClass, heroImg, heroCard, itemImg, imgFallback, rankInfo, rankBadge, computeTiers, tierPill, loading, errorState, empty, filterBar, heroPicker, sortableTable };
})(window.DL);
