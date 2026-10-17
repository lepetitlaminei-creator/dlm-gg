/* Classement officiel par région, global ou par héros. */
(function (DL) {
  const { esc, heroImg, loading, errorState, empty } = DL.ui;

  const REGIONS = [['Europe', 'Europe'], ['NAmerica', 'Amérique du Nord'], ['SAmerica', 'Amérique du Sud'], ['Asia', 'Asie'], ['Oceania', 'Océanie']];
  const PAGE = 50;

  async function render(el, _params, query) {
    await DL.api.loadAssets();
    const region = REGIONS.some(([k]) => k === query.get('region')) ? query.get('region') : 'Europe';
    const heroId = Number(query.get('hero')) || null;
    const page = Math.max(0, Number(query.get('page')) || 0);
    const search = query.get('q') || '';
    const nav = (next) => {
      const q = new URLSearchParams({ region, ...(heroId ? { hero: heroId } : {}), ...(search ? { q: search } : {}), page: 0, ...next });
      [...q.keys()].forEach((k) => { if (q.get(k) === '' || q.get(k) === 'null' || (k === 'page' && q.get(k) === '0')) q.delete(k); });
      location.hash = '#/leaderboard?' + q;
    };

    el.innerHTML = `<section class="page-head"><div><h1>Classement</h1><p class="muted">Le top officiel de chaque région${heroId ? ', pour un héros' : ''}.</p></div></section>
      <div class="toolbar">
        <div class="tabs" id="lb-regions">${REGIONS.map(([k, l]) => `<button data-region="${k}" class="${k === region ? 'active' : ''}">${l}</button>`).join('')}</div>
        <div class="filters inline">
          <label><span>Héros</span><select id="lb-hero"><option value="">Tous les héros</option>${DL.assets.heroes.map((h) => `<option value="${h.id}" ${h.id === heroId ? 'selected' : ''}>${esc(h.name)}</option>`).join('')}</select></label>
          <label><span>Joueur</span><input id="lb-q" type="search" value="${esc(search)}" placeholder="Pseudo…"></label>
        </div>
      </div>
      <div id="lb-body">${loading()}</div>`;

    el.querySelector('#lb-regions').addEventListener('click', (e) => { const b = e.target.closest('button[data-region]'); if (b) nav({ region: b.dataset.region }); });
    el.querySelector('#lb-hero').addEventListener('change', (e) => nav({ hero: e.target.value }));
    let t;
    el.querySelector('#lb-q').addEventListener('input', (e) => { clearTimeout(t); t = setTimeout(() => nav({ q: e.target.value.trim() }), 400); });

    const body = el.querySelector('#lb-body');
    let data;
    try {
      data = await DL.api.get(heroId ? `/v1/leaderboard/${region}/${heroId}` : `/v1/leaderboard/${region}`);
    } catch (err) { body.innerHTML = errorState(err); return; }

    let entries = (data.entries || []).map((e, i) => ({ ...e, pos: e.rank ?? i + 1 }));
    if (search) entries = entries.filter((e) => (e.account_name || '').toLowerCase().includes(search.toLowerCase()));
    if (!entries.length) { body.innerHTML = empty('Aucun joueur trouvé.'); return; }

    const pages = Math.ceil(entries.length / PAGE);
    const slice = entries.slice(page * PAGE, page * PAGE + PAGE);

    body.innerHTML = `<div class="table-wrap"><table class="table lb">
        <thead><tr><th class="num">#</th><th>Joueur</th><th>Héros favoris</th><th class="hide-sm">Compte Steam</th></tr></thead>
        <tbody>${slice.map((e, i) => {
          const posCls = e.pos <= 3 ? `pos-${e.pos}` : '';
          return `<tr data-i="${i}">
            <td class="num"><span class="pos ${posCls}">${e.pos}</span></td>
            <td><span class="player-cell"><span class="avatar"></span><b>${esc(e.account_name || 'Inconnu')}</b></span></td>
            <td><span class="hero-stack">${(e.top_hero_ids || []).slice(0, 3).map((id) => heroImg(DL.assets.heroById.get(id))).join('')}</span></td>
            <td class="hide-sm lb-acc"><span class="muted small">Recherche…</span></td>
          </tr>`;
        }).join('')}</tbody></table></div>
      <div class="pager">
        <button class="btn" ${page <= 0 ? 'disabled' : ''} data-page="${page - 1}">← Précédent</button>
        <span class="muted">Page ${page + 1} / ${pages}</span>
        <button class="btn" ${page >= pages - 1 ? 'disabled' : ''} data-page="${page + 1}">Suivant →</button>
      </div>`;
    body.querySelectorAll('[data-page]').forEach((b) => b.addEventListener('click', () => nav({ page: b.dataset.page })));
    body.querySelector('tbody').addEventListener('click', (e) => {
      const tr = e.target.closest('tr[data-href]');
      if (tr) location.hash = tr.dataset.href;
    });

    const show = (i, res) => {
      const tr = body.querySelector(`tr[data-i="${i}"]`);
      if (!tr) return;
      const cell = tr.querySelector('.lb-acc');
      if (!res) {
        const name = slice[i].account_name;
        if (name) { tr.dataset.href = `#/player?q=${encodeURIComponent(name)}`; tr.classList.add('clickable'); }
        cell.innerHTML = `<span class="muted small">Non trouvé${name ? ' · chercher ce pseudo' : ''}</span>`;
        return;
      }
      tr.dataset.href = `#/player/${res.id}`;
      tr.classList.add('clickable');
      if (res.profile?.avatarmedium) tr.querySelector('.avatar').innerHTML = `<img src="${esc(res.profile.avatarmedium)}" alt="" loading="lazy">`;
      cell.innerHTML = `<span class="lb-link"><b>${esc(res.profile?.personaname || 'Compte ' + res.id)}</b><span class="acc-tag ${res.sure ? 'ok' : ''}">${res.sure ? 'Vérifié' : 'Probable'}</span></span>`;
    };
    resolveAccounts(slice, show);
  }

  /* ---------- Comptes associés ----------
     Le classement Valve ne donne qu'un pseudo en jeu et parfois une liste de comptes possibles.
     1. un seul compte possible : vérifié ;
     2. plusieurs : celui dont le pseudo Steam correspond au pseudo du classement (vérifié), sinon le premier (probable) ;
     3. aucun : recherche Steam sur le pseudo, en gardant un compte au pseudo identique (probable). */
  const norm = (n) => String(n || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]/g, '');
  const resolved = new Map();

  async function resolveAccounts(entries, show) {
    const key = (e) => `${e.account_name}|${(e.possible_account_ids || []).join(',')}`;
    const todo = [];
    entries.forEach((e, i) => { if (resolved.has(key(e))) show(i, resolved.get(key(e))); else todo.push([e, i]); });
    if (!todo.length) return;

    const ids = [...new Set(todo.flatMap(([e]) => (e.possible_account_ids || []).slice(0, 10)))];
    let profiles = new Map();
    for (let k = 0; k < ids.length; k += 100) {
      try { (await DL.api.get('/v1/players/steam', { account_ids: ids.slice(k, k + 100) })).forEach((p) => profiles.set(p.account_id, p)); } catch (err) { /* noms facultatifs */ }
    }
    const done = (e, i, res) => { resolved.set(key(e), res); show(i, res); };
    const searchLater = [];
    todo.forEach(([e, i]) => {
      const cands = e.possible_account_ids || [];
      if (cands.length === 1) return done(e, i, { id: cands[0], profile: profiles.get(cands[0]), sure: true });
      if (cands.length > 1) {
        const same = cands.find((id) => norm(profiles.get(id)?.personaname) === norm(e.account_name));
        return done(e, i, same ? { id: same, profile: profiles.get(same), sure: true } : { id: cands[0], profile: profiles.get(cands[0]), sure: false });
      }
      if (norm(e.account_name)) searchLater.push([e, i]); else done(e, i, null);
    });

    /* Recherche par pseudo, quelques requêtes à la fois. */
    for (let k = 0; k < searchLater.length; k += 6) {
      await Promise.all(searchLater.slice(k, k + 6).map(async ([e, i]) => {
        let hit = null;
        try {
          const res = await DL.api.get('/v1/players/steam-search', { search_query: e.account_name, limit: 10 });
          const same = res.filter((p) => norm(p.personaname) === norm(e.account_name));
          const best = same.sort((x, y) => (y.matches_played_last_30d || 0) - (x.matches_played_last_30d || 0))[0];
          if (best) hit = { id: best.account_id, profile: best, sure: false };
        } catch (err) { /* recherche facultative */ }
        done(e, i, hit);
      }));
    }
  }

  DL.pages.leaderboard = render;
})(window.DL);
