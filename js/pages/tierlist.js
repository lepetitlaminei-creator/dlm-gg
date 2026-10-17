/* Tier list : statistiques de tous les héros, triables, avec tiers calculés. */
(function (DL) {
  const { esc, pct, compact, kda, wrClass, heroImg, computeTiers, tierPill, sortableTable, filterBar, loading, errorState } = DL.ui;

  const ROLES = [
    ['all', 'Tous'], ['assassin', 'Assassin'], ['brawler', 'Bagarreur'], ['marksman', 'Tireur'], ['mystic', 'Mystique'],
  ];
  let role = 'all';
  let view = 'table';

  async function fetchHeroStats() {
    const rows = await DL.api.get('/v1/analytics/hero-stats', DL.api.analyticsParams({ bucket: 'no_bucket' }));
    const known = rows.filter((r) => DL.assets.heroById.has(r.hero_id));
    const totalGames = known.reduce((s, r) => s + r.matches, 0) / 12;
    return { tiers: computeTiers(known, totalGames), totalGames };
  }
  DL.fetchHeroStats = fetchHeroStats;

  async function render(el) {
    el.innerHTML = `<section class="page-head">
        <div><h1>Tier list &amp; Builds</h1><p class="muted">Classement des héros selon leur winrate et leur popularité. Clique sur un héros pour voir son build et ses matchups.</p></div>
      </section>
      ${filterBar(() => render(el))}
      <div class="toolbar">
        <div class="tabs" id="role-tabs">${ROLES.map(([k, l]) => `<button data-role="${k}" class="${role === k ? 'active' : ''}">${l}</button>`).join('')}</div>
        <div class="tabs small" id="view-tabs"><button data-view="table" class="${view === 'table' ? 'active' : ''}">Tableau</button><button data-view="grid" class="${view === 'grid' ? 'active' : ''}">Par tier</button></div>
      </div>
      <div id="tier-body">${loading()}</div>`;

    el.querySelector('#role-tabs').addEventListener('click', (e) => {
      const b = e.target.closest('button[data-role]'); if (!b) return; role = b.dataset.role; render(el);
    });
    el.querySelector('#view-tabs').addEventListener('click', (e) => {
      const b = e.target.closest('button[data-view]'); if (!b) return; view = b.dataset.view; render(el);
    });

    const body = el.querySelector('#tier-body');
    let data;
    try { data = await fetchHeroStats(); } catch (err) { body.innerHTML = errorState(err); return; }

    const rows = data.tiers
      .map((r) => ({ ...r, hero: DL.assets.heroById.get(r.hero_id) }))
      .filter((r) => role === 'all' || r.hero.hero_type === role)
      .map((r) => ({
        ...r,
        name: r.hero.name,
        kda: kda(r.total_kills, r.total_deaths, r.total_assists),
        souls: r.total_net_worth / r.matches,
        dmg: r.total_player_damage / r.matches,
        tierRank: { 'S+': 6, S: 5, A: 4, B: 3, C: 2, D: 1 }[r.tier] + r.z / 10,
      }));

    if (!rows.length) { body.innerHTML = DL.ui.empty('Aucune donnée pour ces filtres.'); return; }

    const summary = `<p class="muted small">${compact(data.totalGames)} parties analysées · ${rows.length} héros</p>`;

    if (view === 'grid') {
      const order = ['S+', 'S', 'A', 'B', 'C', 'D'];
      body.innerHTML = summary + `<div class="tier-grid">${order.map((t) => {
        const list = rows.filter((r) => r.tier === t).sort((a, b) => b.score - a.score);
        return `<div class="tier-row">${tierPill(t)}<div class="tier-heroes">${list.map((r) => `<a href="#/hero/${r.hero_id}" class="tier-hero" title="${esc(r.name)} · ${pct(r.wr)}">${heroImg(r.hero, 'hero-icon lg')}<span class="${wrClass(r.wr)}">${pct(r.wr)}</span></a>`).join('') || '<span class="muted small">—</span>'}</div></div>`;
      }).join('')}</div>`;
      return;
    }

    body.innerHTML = summary + sortableTable({
      rows,
      initial: 'tierRank',
      rowAttrs: (r) => `class="clickable" data-href="#/hero/${r.hero_id}"`,
      columns: [
        { key: 'rank', label: '#', nosort: true, cls: 'num muted', render: (_, i) => i + 1 },
        { key: 'tierRank', label: 'Tier', render: (r) => tierPill(r.tier) },
        { key: 'name', label: 'Héros', render: (r) => `<span class="hero-cell">${heroImg(r.hero)}<b>${esc(r.name)}</b></span>` },
        { key: 'wr', label: 'Winrate', cls: 'num', render: (r) => `<span class="${wrClass(r.wr)}">${pct(r.wr)}</span>` },
        { key: 'pickRate', label: 'Pick rate', cls: 'num', render: (r) => `<span class="bar-num"><span class="bar" style="--w:${Math.min(100, r.pickRate * 300)}%"></span>${pct(r.pickRate)}</span>` },
        { key: 'kda', label: 'KDA', cls: 'num', render: (r) => r.kda.toFixed(2) },
        { key: 'souls', label: 'Âmes / partie', cls: 'num hide-sm', render: (r) => compact(r.souls) },
        { key: 'dmg', label: 'Dégâts héros', cls: 'num hide-sm', render: (r) => compact(r.dmg) },
        { key: 'matches', label: 'Parties', cls: 'num', render: (r) => compact(r.matches) },
      ],
    });
    body.querySelectorAll('tr[data-href]').forEach((tr) => tr.addEventListener('click', () => { location.hash = tr.dataset.href; }));
  }

  DL.pages = DL.pages || {};
  DL.pages.tierlist = render;
})(window.DL);
