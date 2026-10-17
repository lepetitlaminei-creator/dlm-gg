/* Page héros : build (objets par phase, ordre des compétences, builds communautaires) et matchups. */
(function (DL) {
  const { esc, pct, num, compact, duration, kda, wrClass, heroImg, heroCard, itemImg, tierPill, sortableTable, filterBar, loading, errorState, empty } = DL.ui;

  const ROLE_LABEL = { assassin: 'Assassin', brawler: 'Bagarreur', marksman: 'Tireur', mystic: 'Mystique' };
  const PHASES = [
    { key: 'start', label: 'Départ', max: 300 },
    { key: 'early', label: 'Début de partie', max: 720 },
    { key: 'mid', label: 'Milieu de partie', max: 1500 },
    { key: 'late', label: 'Fin de partie', max: Infinity },
  ];

  /* Matchups et synergies : un seul appel pour tous les héros, mis en cache. */
  function counterStats(sameLane) {
    return DL.api.get('/v1/analytics/hero-counter-stats', DL.api.analyticsParams({ same_lane_filter: sameLane, min_matches: 20 }));
  }
  function synergyStats() {
    return DL.api.get('/v1/analytics/hero-synergy-stats', DL.api.analyticsParams({ min_matches: 20 }));
  }
  DL.counterStats = counterStats;

  function heroAbilities(hero) {
    const items = hero.items || {};
    return ['signature1', 'signature2', 'signature3', 'signature4']
      .map((k) => DL.assets.itemByClass.get(items[k]))
      .filter(Boolean);
  }

  function abilityOrderBlock(hero, orders) {
    const abilities = heroAbilities(hero);
    if (!abilities.length || !orders.length) return empty("Pas assez de données sur l'ordre des compétences.");
    const top = [...orders].sort((a, b) => b.matches - a.matches).slice(0, 3);
    const total = orders.reduce((s, o) => s + o.matches, 0);
    return top.map((o, idx) => {
      const seq = o.abilities.slice(0, 16);
      const wr = o.wins / Math.max(1, o.matches);
      return `<div class="skill-order ${idx ? 'alt' : ''}">
        <div class="skill-meta"><b>${idx === 0 ? 'Le plus joué' : 'Alternative ' + idx}</b>
          <span class="${wrClass(wr)}">${pct(wr)} WR</span><span class="muted">${pct(o.matches / Math.max(1, total))} pick · ${compact(o.matches)} parties</span></div>
        <div class="skill-grid" style="--cols:${seq.length}">
          ${abilities.map((ab, row) => `<div class="skill-row"><span class="skill-ab">${itemImg(ab)}<kbd>${row + 1}</kbd></span>${seq.map((id, i) => `<span class="skill-cell ${id === ab.id ? 'on' : ''}">${id === ab.id ? i + 1 : ''}</span>`).join('')}</div>`).join('')}
        </div>
      </div>`;
    }).join('');
  }

  function itemTile(row) {
    return `<div class="item-tile">${itemImg(row.item)}
      <div class="item-tile-meta"><b class="${wrClass(row.wr)}">${pct(row.wr)}</b><span class="muted">${pct(row.pickRate, 0)} pick</span><span class="muted">${duration(row.avg_buy_time_s)}</span></div></div>`;
  }

  function itemsBlock(itemRows, heroMatches, heroWr) {
    const rows = itemRows
      .map((r) => ({ ...r, item: DL.assets.itemById.get(r.item_id) }))
      .filter((r) => r.item && r.item.item_slot_type && r.item.type === 'upgrade')
      .map((r) => ({ ...r, wr: r.wins / Math.max(1, r.matches), pickRate: r.matches / Math.max(1, heroMatches) }));
    if (!rows.length) return { phases: empty('Pas assez de données sur les objets.'), best: '' };

    const used = new Set();
    const phases = PHASES.map((ph, i) => {
      const min = i ? PHASES[i - 1].max : 0;
      const list = rows.filter((r) => r.avg_buy_time_s >= min && r.avg_buy_time_s < ph.max && r.pickRate >= 0.05 && !used.has(r.item_id))
        .sort((a, b) => b.pickRate - a.pickRate).slice(0, 6)
        .sort((a, b) => a.avg_buy_time_s - b.avg_buy_time_s);
      list.forEach((r) => used.add(r.item_id));
      return `<div class="phase"><h4>${ph.label}</h4><div class="item-row">${list.map(itemTile).join('') || '<span class="muted small">—</span>'}</div></div>`;
    }).join('');

    const best = rows.filter((r) => r.pickRate >= 0.03)
      .map((r) => ({ ...r, delta: r.wr - heroWr }))
      .sort((a, b) => b.delta - a.delta).slice(0, 8)
      .map((r) => `<div class="item-tile">${itemImg(r.item)}<div class="item-tile-meta"><b class="wr-great">${DL.ui.signed(r.delta * 100, (v) => v.toFixed(1))} pts</b><span class="muted">${pct(r.wr)} · ${pct(r.pickRate, 0)}</span></div></div>`).join('');
    return { phases, best };
  }

  function communityBuilds(builds, buildStats) {
    if (!builds.length) return empty('Aucun build communautaire trouvé.');
    const statsById = new Map(buildStats.map((s) => [s.hero_build_id, s]));
    return `<div class="builds">${builds.map((b) => {
      const hb = b.hero_build;
      const st = statsById.get(hb.hero_build_id);
      const cats = (hb.details?.mod_categories || []).filter((c) => c.mods?.length).slice(0, 4);
      return `<article class="build-card">
        <header><b>${esc(hb.name)}</b>
          <span class="muted small">★ ${num(b.num_favorites || 0)}${st ? ` · <span class="${wrClass(st.wins / st.matches)}">${pct(st.wins / st.matches)}</span> sur ${compact(st.matches)} parties` : ''}</span></header>
        ${cats.map((c) => `<div class="build-cat"><span class="muted small">${esc(c.name)}</span><div class="item-row tight">${c.mods.slice(0, 8).map((m) => itemImg(DL.assets.itemById.get(m.ability_id))).join('')}</div></div>`).join('')}
        <footer class="muted small">ID du build : ${hb.hero_build_id} · auteur <a href="#/player/${hb.author_account_id}">profil</a></footer>
      </article>`;
    }).join('')}</div>`;
  }

  function matchupList(rows, title, cls) {
    return `<div class="card"><h3>${title}</h3><ul class="mu-list">${rows.map((r) => `<li><a href="#/matchups?hero=${r.hero_id}&vs=${r.enemy_hero_id}">${heroImg(r.enemy)}<span>${esc(r.enemy.name)}</span><b class="${cls || wrClass(r.wr)}">${pct(r.wr)}</b><small class="muted">${compact(r.matches_played)}</small></a></li>`).join('') || '<li class="muted">—</li>'}</ul></div>`;
  }

  let tab = 'build';
  let sameLane = true;

  async function render(el, params) {
    await DL.api.loadAssets();
    const id = Number(params[0]);
    const hero = DL.assets.heroById.get(id);
    if (!hero) { el.innerHTML = empty('Héros introuvable.'); return; }

    el.innerHTML = `<section class="hero-head" style="--hero-bg:url('${esc(hero.images?.background_image_webp || hero.images?.background_image || '')}')">
        <img class="hero-portrait" src="${esc(heroCard(hero))}" alt="">
        <div class="hero-title"><p class="muted small">${esc(ROLE_LABEL[hero.hero_type] || '')}</p><h1>${esc(hero.name)}</h1>
          <div class="hero-kpis" id="hero-kpis">${loading('')}</div></div>
      </section>
      ${filterBar(() => render(el, params))}
      <div class="tabs" id="hero-tabs">
        <button data-tab="build" class="${tab === 'build' ? 'active' : ''}">Build</button>
        <button data-tab="matchups" class="${tab === 'matchups' ? 'active' : ''}">Matchups &amp; synergies</button>
      </div>
      <div id="hero-body">${loading()}</div>`;
    el.querySelector('#hero-tabs').addEventListener('click', (e) => {
      const b = e.target.closest('button[data-tab]'); if (!b) return; tab = b.dataset.tab; render(el, params);
    });

    const kpis = el.querySelector('#hero-kpis');
    const body = el.querySelector('#hero-body');
    let stat = null;
    try {
      const { tiers } = await DL.fetchHeroStats();
      stat = tiers.find((t) => t.hero_id === id);
      const sameRole = tiers.filter((t) => DL.assets.heroById.get(t.hero_id)?.hero_type === hero.hero_type).sort((a, b) => b.score - a.score);
      kpis.innerHTML = stat ? `
        <div>${tierPill(stat.tier)}<span class="muted">Tier</span></div>
        <div><b class="${wrClass(stat.wr)}">${pct(stat.wr)}</b><span class="muted">Winrate</span></div>
        <div><b>${pct(stat.pickRate)}</b><span class="muted">Pick rate</span></div>
        <div><b>${kda(stat.total_kills, stat.total_deaths, stat.total_assists).toFixed(2)}</b><span class="muted">KDA</span></div>
        <div><b>${compact(stat.matches)}</b><span class="muted">Parties</span></div>
        <div><b>#${sameRole.findIndex((t) => t.hero_id === id) + 1}</b><span class="muted">${esc(ROLE_LABEL[hero.hero_type] || 'Rôle')}</span></div>` : '<span class="muted">Pas de statistiques sur la période.</span>';
    } catch (err) { kpis.innerHTML = ''; }

    if (tab === 'build') return renderBuild(body, hero, stat);
    return renderMatchups(body, hero, el, params);
  }

  async function renderBuild(body, hero, stat) {
    const id = hero.id;
    const [items, orders, builds, buildStats] = await Promise.allSettled([
      DL.api.get('/v1/analytics/item-stats', DL.api.analyticsParams({ bucket: 'no_bucket', hero_ids: String(id), min_matches: 30 })),
      DL.api.get('/v1/analytics/ability-order-stats', DL.api.analyticsParams({ hero_id: id, min_matches: 20 })),
      DL.api.get('/v1/builds', { hero_id: id, sort_by: 'weekly_favorites', sort_direction: 'desc', only_latest: true, limit: 6 }),
      DL.api.get(`/v1/analytics/hero-build-stats/${id}`, { min_unix_timestamp: DL.api.analyticsParams().min_unix_timestamp }),
    ]);
    if (items.status === 'rejected' && orders.status === 'rejected') { body.innerHTML = errorState(items.reason); return; }

    const heroMatches = Math.max(stat?.matches || 1, ...(items.value || []).map((r) => r.matches));
    const heroWr = stat?.wr ?? 0.5;
    const itemsHtml = items.status === 'fulfilled' ? itemsBlock(items.value, heroMatches, heroWr) : { phases: errorState(items.reason, false), best: '' };

    body.innerHTML = `<div class="grid-2">
        <div class="card span-2"><h3>Objets par phase de jeu</h3><p class="muted small">Les objets les plus achetés, avec leur winrate, leur taux d'achat et le moment moyen d'achat.</p>${itemsHtml.phases}</div>
        <div class="card span-2"><h3>Ordre des compétences</h3>${orders.status === 'fulfilled' ? abilityOrderBlock(hero, orders.value) : errorState(orders.reason, false)}</div>
        ${itemsHtml.best ? `<div class="card span-2"><h3>Objets qui font gagner</h3><p class="muted small">Écart de winrate par rapport à la moyenne du héros (objets achetés dans au moins 3 % des parties).</p><div class="item-row">${itemsHtml.best}</div></div>` : ''}
        <div class="card span-2"><h3>Builds communautaires populaires</h3>${builds.status === 'fulfilled' ? communityBuilds(builds.value, buildStats.status === 'fulfilled' ? buildStats.value : []) : errorState(builds.reason, false)}</div>
      </div>`;
  }

  async function renderMatchups(body, hero, el, params) {
    const id = hero.id;
    const [counters, synergies] = await Promise.allSettled([counterStats(sameLane), synergyStats()]);
    if (counters.status === 'rejected') { body.innerHTML = errorState(counters.reason); return; }

    const rows = counters.value
      .filter((r) => r.hero_id === id && DL.assets.heroById.has(r.enemy_hero_id))
      .map((r) => ({
        ...r,
        enemy: DL.assets.heroById.get(r.enemy_hero_id),
        name: DL.assets.heroById.get(r.enemy_hero_id).name,
        wr: r.wins / Math.max(1, r.matches_played),
        nwDiff: (r.networth - r.enemy_networth) / Math.max(1, r.matches_played),
        kdaSelf: kda(r.kills, r.deaths, r.assists),
        lhDiff: (r.last_hits - r.enemy_last_hits) / Math.max(1, r.matches_played),
      }));

    const reliable = rows.filter((r) => r.matches_played >= 50);
    const pool = reliable.length >= 6 ? reliable : rows;
    const strong = [...pool].sort((a, b) => b.wr - a.wr).slice(0, 6);
    const weak = [...pool].sort((a, b) => a.wr - b.wr).slice(0, 6);

    let synHtml = '';
    if (synergies.status === 'fulfilled') {
      const syn = synergies.value
        .filter((r) => r.hero_id1 === id || r.hero_id2 === id)
        .map((r) => {
          const mate = r.hero_id1 === id ? r.hero_id2 : r.hero_id1;
          return { ...r, mate: DL.assets.heroById.get(mate), wr: r.wins / Math.max(1, r.matches_played) };
        })
        .filter((r) => r.mate && r.matches_played >= 30)
        .sort((a, b) => b.wr - a.wr).slice(0, 6);
      synHtml = `<div class="card"><h3>Meilleurs alliés</h3><ul class="mu-list">${syn.map((r) => `<li><span class="mu-static">${heroImg(r.mate)}<span>${esc(r.mate.name)}</span><b class="${wrClass(r.wr)}">${pct(r.wr)}</b><small class="muted">${compact(r.matches_played)}</small></span></li>`).join('') || '<li class="muted">—</li>'}</ul></div>`;
    }

    body.innerHTML = `<div class="toolbar"><label class="switch"><input type="checkbox" id="lane-toggle" ${sameLane ? 'checked' : ''}><span>Même lane uniquement</span></label></div>
      <div class="grid-3">${matchupList(strong, 'Fort contre')}${matchupList(weak, 'Faible contre')}${synHtml}</div>
      <div class="card"><h3>Tous les matchups</h3>${rows.length ? sortableTable({
        rows,
        initial: 'wr',
        rowAttrs: (r) => `class="clickable" data-href="#/matchups?hero=${id}&vs=${r.enemy_hero_id}"`,
        columns: [
          { key: 'name', label: 'Adversaire', render: (r) => `<span class="hero-cell">${heroImg(r.enemy)}<b>${esc(r.name)}</b></span>` },
          { key: 'wr', label: 'Winrate', cls: 'num', render: (r) => `<span class="${wrClass(r.wr)}">${pct(r.wr)}</span>` },
          { key: 'nwDiff', label: 'Écart d\'âmes', cls: 'num', render: (r) => `<span class="${r.nwDiff >= 0 ? 'wr-good' : 'wr-meh'}">${DL.ui.signed(r.nwDiff)}</span>` },
          { key: 'lhDiff', label: 'Écart last hits', cls: 'num hide-sm', render: (r) => DL.ui.signed(r.lhDiff, (v) => v.toFixed(1)) },
          { key: 'kdaSelf', label: 'KDA', cls: 'num hide-sm', render: (r) => r.kdaSelf.toFixed(2) },
          { key: 'matches_played', label: 'Parties', cls: 'num', render: (r) => compact(r.matches_played) },
        ],
      }) : empty('Pas assez de parties pour ce héros.')}</div>`;
    body.querySelector('#lane-toggle').addEventListener('change', (e) => { sameLane = e.target.checked; render(el, params); });
    body.querySelectorAll('tr[data-href]').forEach((tr) => tr.addEventListener('click', () => { location.hash = tr.dataset.href; }));
  }

  DL.pages.hero = render;
})(window.DL);
