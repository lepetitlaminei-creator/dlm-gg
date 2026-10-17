/* Profil joueur : recherche Steam, rang, forme récente, historique des parties et stats par héros. */
(function (DL) {
  const { esc, pct, compact, duration, ago, kda, wrClass, heroImg, rankBadge, sortableTable, loading, errorState, empty } = DL.ui;

  const STEAM64_BASE = 76561197960265728n;
  let tab = 'history';
  /* player_match_outcome : 1 = victoire, 2 = défaite ; sinon on compare l'équipe gagnante. */
  const isWin = (m) => (m.player_match_outcome === 1 || m.player_match_outcome === 2 ? m.player_match_outcome === 1 : m.match_result === m.player_team);
  let shown = 20;

  /* Accepte un SteamID3, un SteamID64 ou une URL de profil contenant l'un des deux. */
  function parseAccountId(input) {
    const m = String(input).match(/\d{1,20}/);
    if (!m) return null;
    try {
      const n = BigInt(m[0]);
      if (n > STEAM64_BASE) return Number(n - STEAM64_BASE);
      return Number(n);
    } catch (e) { return null; }
  }
  DL.parseAccountId = parseAccountId;

  async function renderSearch(el, query) {
    const q = (query.get('q') || '').trim();
    el.innerHTML = `<section class="page-head"><div><h1>Profil joueur</h1><p class="muted">Cherche un joueur par pseudo Steam, SteamID ou lien de profil.</p></div></section>
      <form class="big-search" id="player-search"><input name="q" type="search" value="${esc(q)}" placeholder="Pseudo Steam, SteamID ou lien de profil…" autofocus><button class="btn primary">Rechercher</button></form>
      <div id="ps-body"></div>`;
    el.querySelector('#player-search').addEventListener('submit', (e) => {
      e.preventDefault();
      const v = e.target.q.value.trim();
      if (v) location.hash = '#/player?q=' + encodeURIComponent(v);
    });
    if (!q) {
      const mine = await DL.auth.me();
      el.querySelector('#ps-body').innerHTML = mine
        ? `<p><a class="btn primary" href="#/player/${mine}">Voir mon profil et ma Lens →</a></p>`
        : (location.protocol === 'file:' ? '' : '<p class="muted">Connecte-toi avec Steam (en haut à droite) pour retrouver ton profil et ta Lens en un clic.</p>');
      return;
    }
    const body = el.querySelector('#ps-body');
    body.innerHTML = loading('Recherche…');
    const direct = /^\d+$/.test(q) || /steamcommunity\.com\/profiles\//.test(q) ? parseAccountId(q) : null;
    try {
      const results = await DL.api.get('/v1/players/steam-search', { search_query: q, limit: 30 });
      const list = results.map((p) => `<a class="player-result" href="#/player/${p.account_id}">
          <img src="${esc(p.avatarmedium || p.avatar)}" alt="" loading="lazy">
          <div><b>${esc(p.personaname)}</b><span class="muted small">${p.countrycode ? esc(p.countrycode) + ' · ' : ''}${p.matches_played_last_30d} parties ces 30 derniers jours</span></div>
          ${p.last_team_avg_badge ? rankBadge(p.last_team_avg_badge) : ''}
        </a>`).join('');
      body.innerHTML = (direct ? `<p><a class="btn" href="#/player/${direct}">Ouvrir le compte ${direct} →</a></p>` : '')
        + (list ? `<div class="player-results">${list}</div>` : empty('Aucun joueur trouvé. Essaie avec le SteamID.'));
    } catch (err) {
      body.innerHTML = direct ? `<p><a class="btn" href="#/player/${direct}">Ouvrir le compte ${direct} →</a></p>` : errorState(err);
    }
  }

  function summary(matches) {
    const recent = matches.slice(0, 20);
    if (!recent.length) return '';
    const wins = recent.filter((m) => isWin(m)).length;
    const k = recent.reduce((s, m) => s + m.player_kills, 0);
    const d = recent.reduce((s, m) => s + m.player_deaths, 0);
    const a = recent.reduce((s, m) => s + m.player_assists, 0);
    const souls = recent.reduce((s, m) => s + m.net_worth, 0) / recent.length;
    const counts = new Map();
    recent.forEach((m) => counts.set(m.hero_id, (counts.get(m.hero_id) || 0) + 1));
    const fav = [...counts.entries()].sort((x, y) => y[1] - x[1]).slice(0, 3);
    const wr = wins / recent.length;
    return `<div class="summary">
      <div class="sum-block"><span class="eyebrow">Winrate · ${recent.length} parties</span><b class="big ${wrClass(wr)}">${pct(wr, 0)}</b><span class="muted small">${wins}V ${recent.length - wins}D</span></div>
      <div class="sum-block"><span class="eyebrow">KDA moyen</span><b class="big">${kda(k, d, a).toFixed(2)}</b><span class="muted small">${(k / recent.length).toFixed(1)} / ${(d / recent.length).toFixed(1)} / ${(a / recent.length).toFixed(1)}</span></div>
      <div class="sum-block"><span class="eyebrow">Âmes moyennes</span><b class="big">${compact(souls)}</b><span class="muted small">par partie</span></div>
      <div class="sum-block"><span class="eyebrow">Héros joués</span><span class="hero-stack">${fav.map(([id, c]) => `<span class="fav">${heroImg(DL.assets.heroById.get(id))}<small>${c}</small></span>`).join('')}</span></div>
      <div class="sum-block sum-form"><span class="eyebrow">Forme</span><div class="form-strip" title="Les plus récentes à droite">${[...recent].reverse().map((m) => `<span class="${isWin(m) ? 'w' : 'l'}"></span>`).join('')}</div></div>
    </div>`;
  }

  function historyTable(matches) {
    if (!matches.length) return empty('Aucune partie enregistrée pour ce joueur.');
    const rows = matches.slice(0, shown).map((m) => {
      const win = isWin(m);
      const hero = DL.assets.heroById.get(m.hero_id);
      const k = kda(m.player_kills, m.player_deaths, m.player_assists);
      return `<div class="match clickable ${win ? 'win' : 'loss'}" data-match="${m.match_id}" title="Voir le détail de la partie">
        <div class="match-res"><b>${win ? 'Victoire' : 'Défaite'}</b><span class="muted small">${m.match_mode === 4 || m.ranked_display_badge ? 'Classée' : 'Normale'}</span><span class="muted small">${ago(m.start_time)}</span></div>
        <div class="match-hero">${heroImg(hero, 'hero-icon lg')}<span>${esc(hero?.name || 'Héros ' + m.hero_id)}<small class="muted">Niv. ${m.hero_level}</small></span></div>
        <div class="match-kda"><b>${m.player_kills} / <span class="wr-bad">${m.player_deaths}</span> / ${m.player_assists}</b><span class="muted small">${k.toFixed(2)} KDA</span></div>
        <div class="match-stats hide-sm"><span><b>${compact(m.net_worth)}</b> âmes</span><span class="muted small">${m.last_hits} LH · ${m.denies} denies</span></div>
        <div class="match-time"><b>${duration(m.match_duration_s)}</b>${Number.isFinite(m.ranked_delta) && m.ranked_delta !== null ? `<span class="small ${m.ranked_delta >= 0 ? 'wr-great' : 'wr-bad'}">${m.ranked_delta >= 0 ? '+' : ''}${m.ranked_delta}</span>` : ''}<span class="muted small">#${m.match_id}</span><span class="pov-slot" data-mid="${m.match_id}"></span></div>
      </div>`;
    }).join('');
    return `<div class="matches">${rows}</div>${matches.length > shown ? '<p class="center"><button class="btn" id="more-matches">Voir plus de parties</button></p>' : ''}`;
  }

  function heroTable(stats) {
    if (!stats.length) return empty('Pas de statistiques par héros.');
    const rows = stats.map((s) => ({
      ...s,
      hero: DL.assets.heroById.get(s.hero_id),
      name: DL.assets.heroById.get(s.hero_id)?.name || 'Héros ' + s.hero_id,
      wr: s.wins / Math.max(1, s.matches_played),
      kda: kda(s.kills, s.deaths, s.assists),
    }));
    return sortableTable({
      rows,
      initial: 'matches_played',
      rowAttrs: (r) => `class="clickable" data-href="#/hero/${r.hero_id}"`,
      columns: [
        { key: 'name', label: 'Héros', render: (r) => `<span class="hero-cell">${heroImg(r.hero)}<b>${esc(r.name)}</b></span>` },
        { key: 'matches_played', label: 'Parties', cls: 'num', render: (r) => r.matches_played },
        { key: 'wr', label: 'Winrate', cls: 'num', render: (r) => `<span class="${wrClass(r.wr)}">${pct(r.wr, 0)}</span>` },
        { key: 'kda', label: 'KDA', cls: 'num', render: (r) => r.kda.toFixed(2) },
        { key: 'networth_per_min', label: 'Âmes/min', cls: 'num hide-sm', render: (r) => compact(r.networth_per_min) },
        { key: 'damage_per_min', label: 'Dégâts/min', cls: 'num hide-sm', render: (r) => compact(r.damage_per_min) },
        { key: 'accuracy', label: 'Précision', cls: 'num hide-sm', render: (r) => pct(r.accuracy, 0) },
        { key: 'last_played', label: 'Dernière partie', cls: 'num hide-sm', render: (r) => ago(r.last_played) },
      ],
    });
  }

  /* Si le joueur est un streamer enregistré, bouton « POV » sur chaque partie couverte par une rediffusion. */
  async function addPovButtons(body, accountId, matches) {
    const st = await DL.twitch.status();
    if (!st.twitch) return;
    let res;
    try { res = await DL.twitch.playerPovs(accountId, matches.slice(0, shown)); } catch (e) { return; }
    if (!res || !res.povs.size) return;
    body.querySelectorAll('.pov-slot[data-mid]').forEach((slot) => {
      const hit = res.povs.get(Number(slot.dataset.mid));
      const m = matches.find((x) => x.match_id === Number(slot.dataset.mid));
      if (!hit || !m) return;
      slot.innerHTML = '<button class="btn small-btn primary">▶ POV</button>';
      slot.querySelector('button').addEventListener('click', () => DL.twitch.openPov({
        ...hit,
        hero: DL.assets.heroById.get(m.hero_id),
        player: { kills: m.player_kills, deaths: m.player_deaths, assists: m.player_assists },
        match: { start_time: m.start_time, duration_s: m.match_duration_s },
        win: isWin(m),
      }));
    });
  }

  async function renderProfile(el, accountId) {
    el.innerHTML = loading('Chargement du profil…');
    const [profile, rank, history, heroStats, mates] = await Promise.allSettled([
      DL.api.get('/v1/players/steam', { account_ids: [accountId] }),
      DL.api.get(`/v1/players/${accountId}/rank`),
      DL.api.get(`/v1/players/${accountId}/match-history`),
      DL.api.get('/v1/players/hero-stats', { account_ids: [accountId] }),
      DL.api.get(`/v1/players/${accountId}/mate-stats`, { min_matches_played: 3 }),
    ]);
    if (history.status === 'rejected' && profile.status === 'rejected') { el.innerHTML = errorState(history.reason); return; }

    const p = profile.status === 'fulfilled' ? profile.value[0] : null;
    const matches = history.status === 'fulfilled' ? [...history.value].sort((a, b) => b.start_time - a.start_time) : [];
    const badge = rank.status === 'fulfilled' ? rank.value.badge : (matches.find((m) => m.ranked_display_badge)?.ranked_display_badge);

    el.innerHTML = `<section class="profile-hero"${p?.avatarfull ? ` style="--pbg:url('${esc(p.avatarfull)}')"` : ''}><div class="profile-head">
        ${p?.avatarfull ? `<img class="avatar-xl" src="${esc(p.avatarfull)}" alt="">` : '<span class="avatar-xl"></span>'}
        <div class="profile-title"><h1>${esc(p?.personaname || 'Joueur ' + accountId)}</h1>
          <p class="muted small">${p?.countrycode ? esc(p.countrycode) + ' · ' : ''}SteamID ${accountId}${p?.profileurl ? ` · <a href="${esc(p.profileurl)}" target="_blank" rel="noopener">Profil Steam</a>` : ''}</p></div>
        <div class="profile-rank">${rankBadge(badge, 'lg')}</div>
      </div>
      ${summary(matches)}</section>
      <div class="tabs" id="pl-tabs">
        <button data-tab="lens" class="${tab === 'lens' ? 'active' : ''}">Lens</button>
        <button data-tab="history" class="${tab === 'history' ? 'active' : ''}">Historique (${matches.length})</button>
        <button data-tab="heroes" class="${tab === 'heroes' ? 'active' : ''}">Héros</button>
        <button data-tab="mates" class="${tab === 'mates' ? 'active' : ''}">Coéquipiers</button>
      </div>
      <div id="pl-body"></div>`;

    const body = el.querySelector('#pl-body');
    const draw = async () => {
      if (tab === 'history') {
        body.innerHTML = history.status === 'fulfilled' ? historyTable(matches) : errorState(history.reason, false);
        const more = body.querySelector('#more-matches');
        if (more) more.addEventListener('click', () => { shown += 20; draw(); });
        body.querySelectorAll('.match[data-match]').forEach((row) => row.addEventListener('click', (e) => {
          if (e.target.closest('button, a')) return;
          location.hash = `#/match/${row.dataset.match}?p=${accountId}`;
        }));
        if (history.status === 'fulfilled') addPovButtons(body, accountId, matches);
      } else if (tab === 'lens') {
        DL.lens.render(body, { accountId, badge, heroStats: heroStats.status === 'fulfilled' ? heroStats.value : [], matches });
      } else if (tab === 'heroes') {
        body.innerHTML = heroStats.status === 'fulfilled' ? `<div class="card">${heroTable(heroStats.value)}</div>` : errorState(heroStats.reason, false);
        body.querySelectorAll('tr[data-href]').forEach((tr) => tr.addEventListener('click', () => { location.hash = tr.dataset.href; }));
      } else {
        if (mates.status === 'rejected') { body.innerHTML = errorState(mates.reason, false); return; }
        const list = [...mates.value].sort((a, b) => b.matches_played - a.matches_played).slice(0, 15);
        if (!list.length) { body.innerHTML = empty('Aucun coéquipier régulier.'); return; }
        let names = new Map();
        try { names = new Map((await DL.api.get('/v1/players/steam', { account_ids: list.map((m) => m.mate_id) })).map((x) => [x.account_id, x])); } catch (e) { /* noms facultatifs */ }
        body.innerHTML = `<div class="player-results">${list.map((m) => {
          const s = names.get(m.mate_id);
          const wr = m.wins / Math.max(1, m.matches_played);
          return `<a class="player-result" href="#/player/${m.mate_id}">${s?.avatarmedium ? `<img src="${esc(s.avatarmedium)}" alt="">` : '<span class="avatar"></span>'}
            <div><b>${esc(s?.personaname || 'Joueur ' + m.mate_id)}</b><span class="muted small">${m.matches_played} parties ensemble</span></div><b class="${wrClass(wr)}">${pct(wr, 0)}</b></a>`;
        }).join('')}</div>`;
      }
    };
    el.querySelector('#pl-tabs').addEventListener('click', (e) => {
      const b = e.target.closest('button[data-tab]'); if (!b) return;
      tab = b.dataset.tab;
      el.querySelectorAll('#pl-tabs button').forEach((x) => x.classList.toggle('active', x === b));
      draw();
    });
    draw();
  }

  async function render(el, params, query) {
    await DL.api.loadAssets();
    shown = 20;
    const id = params[0] ? parseAccountId(params[0]) : null;
    if (!id) return renderSearch(el, query);
    return renderProfile(el, id);
  }

  DL.pages.player = render;
  DL.pages['connexion-echouee'] = (el) => {
    el.innerHTML = DL.ui.empty("La connexion avec Steam a échoué ou a été annulée. Réessaie avec le bouton en haut à droite.");
  };
})(window.DL);
