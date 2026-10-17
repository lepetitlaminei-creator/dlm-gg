/* Matchups : face-à-face entre deux héros, comparaison de stats et objets efficaces contre l'adversaire. */
(function (DL) {
  const { esc, pct, compact, wrClass, heroImg, heroCard, itemImg, heroPicker, sortableTable, filterBar, loading, errorState, empty } = DL.ui;
  const PRIORITY_STREAMERS = ['eido'];

  let sameLane = true;
  let replayFilter = 'win';

  /* Parties où le héros A affronte le héros B : on récupère les parties de A au plus haut niveau
     (le filtre hero_ids de l'API est un « OU »), puis on garde celles où B est dans l'équipe adverse. */
  async function findReplays(A, B) {
    const f = DL.filters();
    const matches = await DL.api.get('/v1/matches/metadata', {
      hero_ids: String(A.id),
      include_info: true,
      include_player_kda: true,
      extra_player_columns: 'net_worth,assigned_lane,last_hits,denies',
      game_mode: 'normal',
      match_mode: f.mode === 'ranked' ? 'ranked' : null,
      min_unix_timestamp: DL.api.analyticsParams().min_unix_timestamp,
      min_average_badge: f.minBadge || null,
      order_by: 'average_badge',
      order_direction: 'desc',
      limit: 400,
    });
    const out = [];
    for (const m of matches) {
      const players = m.players || [];
      const me = players.find((p) => p.hero_id === A.id);
      const foe = me && players.find((p) => p.hero_id === B.id && p.team !== me.team);
      if (!foe) continue;
      const lane = me.assigned_lane != null && me.assigned_lane === foe.assigned_lane;
      if (sameLane && !lane) continue;
      out.push({ ...m, me, foe, lane, win: m.winning_team === me.team });
    }
    return out;
  }

  function playerLine(p, hero) {
    const name = p.account_id ? `<a href="#/player/${p.account_id}" data-acc="${p.account_id}">Joueur ${p.account_id}</a>` : '<span class="muted">Profil privé</span>';
    return `<div class="rp-player">${heroImg(hero)}<div><b>${p.kills} / <span class="wr-bad">${p.deaths}</span> / ${p.assists}</b>
      <span class="muted small">${p.net_worth != null ? compact(p.net_worth) + ' âmes · ' : ''}${name}</span></div></div>`;
  }

  async function loadReplays(box, A, B) {
    box.innerHTML = loading('Recherche de parties…');
    let list;
    try { list = await findReplays(A, B); } catch (err) { box.innerHTML = errorState(err, false); return; }
    const shown = list.filter((r) => replayFilter === 'all' || r.win).slice(0, 10);
    if (!shown.length) {
      box.innerHTML = empty(list.length ? `Aucune victoire de ${A.name} parmi les parties trouvées. Regarde l'onglet « Toutes ».` : 'Aucune partie trouvée sur cette période. Essaie une période plus longue, un autre rang ou désactive « même lane ».');
      return;
    }
    box.innerHTML = `<div class="replays">${shown.map((r) => `<div class="replay ${r.win ? 'win' : 'loss'}">
        <div class="rp-res"><b>${r.win ? 'Victoire' : 'Défaite'}</b><span class="muted small">${DL.ui.duration(r.duration_s)} · ${DL.ui.ago(r.start_time)}</span>${r.average_badge ? DL.ui.rankBadge(r.average_badge) : ''}</div>
        ${playerLine(r.me, A)}
        <span class="rp-vs">VS</span>
        ${playerLine(r.foe, B)}
        <div class="rp-actions">
          <button class="btn small-btn" data-copy="${r.match_id}" title="Copier l'ID de la partie">ID ${r.match_id}</button>
        </div>
      </div>`).join('')}</div>
      <p class="muted small">${list.length} partie${list.length > 1 ? 's' : ''} trouvée${list.length > 1 ? 's' : ''} parmi les plus haut classées de la période.</p>`;

    box.querySelectorAll('[data-copy]').forEach((b) => b.addEventListener('click', async () => {
      try { await navigator.clipboard.writeText(b.dataset.copy); b.textContent = 'ID copié ✓'; }
      catch (e) { window.prompt("ID de la partie à copier :", b.dataset.copy); }
    }));
    /* Pseudos Steam des joueurs affichés (facultatif). */
    const ids = [...new Set([...box.querySelectorAll('a[data-acc]')].map((a) => Number(a.dataset.acc)))];
    if (!ids.length) return;
    try {
      const profiles = new Map((await DL.api.get('/v1/players/steam', { account_ids: ids })).map((p) => [p.account_id, p]));
      box.querySelectorAll('a[data-acc]').forEach((a) => {
        const p = profiles.get(Number(a.dataset.acc));
        if (p?.personaname) a.textContent = p.personaname;
      });
    } catch (e) { /* on garde les IDs */ }
  }

  /* POV Twitch des streamers connus qui ont joué ce matchup (d'un côté ou de l'autre). */
  async function loadPovs(box, A, B) {
    const st = await DL.twitch.status();
    if (!st.server || !st.twitch) {
      box.innerHTML = `<div class="notice"><b>POV Twitch désactivées.</b> ${st.server
        ? "Le serveur tourne, mais les identifiants Twitch ne sont pas configurés (TWITCH_CLIENT_ID et TWITCH_CLIENT_SECRET dans le fichier .env)."
        : "Lance l'app avec <code>node server.js</code> au lieu d'ouvrir index.html directement : c'est le serveur qui interroge Twitch."} Le README explique comment faire en 2 minutes.</div>`;
      return;
    }
    box.innerHTML = loading('Recherche des rediffusions Twitch…');
    let res;
    try { res = await DL.twitch.matchupPovs(A, B, { sameLane }); } catch (err) { box.innerHTML = errorState(err, false); return; }
    if (res.noStreamers) { box.innerHTML = empty(window.DLM_NO_STREAMERS ? 'Aucun streamer enregistré pour le moment.' : "Aucun streamer enregistré. Ajoute des streamers dans l'onglet Streamers pour voir leurs POV ici."); return; }
    const misses = res.misses || [];
    const why = misses.length ? `<details class="pov-misses"><summary class="muted small">${misses.length} partie${misses.length > 1 ? 's' : ''} de streamers sans POV : voir pourquoi</summary>
      <ul>${misses.slice(0, 30).map((m) => `<li><b>${esc(m.channel?.display_name || m.streamer.twitch)}</b> · ${esc(m.hero.name)} · ${DL.ui.ago(m.match.start_time)} · <span class="muted">${esc(m.reason)}</span></li>`).join('')}</ul></details>` : '';
    if (!res.povs.length) {
      box.innerHTML = (res.checked
        ? empty(`${res.checked} partie${res.checked > 1 ? 's' : ''} de streamers trouvée${res.checked > 1 ? 's' : ''}, mais aucune n'est couverte par une rediffusion Twitch encore en ligne.`)
        : empty(`Aucun streamer enregistré n'a joué ${A.name} contre ${B.name}${sameLane ? ' en lane' : ''} ces 60 derniers jours.`)) + why;
      return;
    }
    const t = (m) => DL.ui.toUnix(m.match.start_time);
    /* Ordre : les POV d'eido d'abord (demande de Mr L), puis les parties au rang moyen le plus haut. */
    const first = (p) => (PRIORITY_STREAMERS.includes(p.streamer.twitch) ? 1 : 0);
    const badge = (p) => p.match.average_badge || Math.max(p.match.average_badge_team0 || 0, p.match.average_badge_team1 || 0);
    const list = res.povs.sort((x, y) => first(y) - first(x) || badge(y) - badge(x) || (y.side === 'me') - (x.side === 'me') || t(y) - t(x)).slice(0, 12);
    box.innerHTML = `<div class="replays">${list.map(DL.twitch.povRow).join('')}</div>${why}`;
    box.querySelectorAll('[data-pov]').forEach((b, i) => b.addEventListener('click', () => DL.twitch.openPov(list[i])));
  }

  function go(hero, vs) {
    const q = new URLSearchParams();
    if (hero) q.set('hero', hero);
    if (vs) q.set('vs', vs);
    location.hash = '#/matchups' + (q.toString() ? '?' + q : '');
  }

  function compareRow(label, a, b, fmt = (v) => v.toFixed(1), higherIsBetter = true) {
    const total = Math.abs(a) + Math.abs(b) || 1;
    const aWins = higherIsBetter ? a >= b : a <= b;
    return `<div class="cmp-row"><span class="cmp-val ${aWins ? 'win' : ''}">${fmt(a)}</span>
      <div class="cmp-bars"><span class="cmp-a" style="--w:${(Math.abs(a) / total) * 100}%"></span><span class="cmp-b" style="--w:${(Math.abs(b) / total) * 100}%"></span></div>
      <span class="cmp-val ${!aWins ? 'win' : ''}">${fmt(b)}</span><span class="cmp-label">${label}</span></div>`;
  }

  async function render(el, _params, query) {
    await DL.api.loadAssets();
    const heroId = Number(query.get('hero')) || null;
    const vsId = Number(query.get('vs')) || null;
    const A = DL.assets.heroById.get(heroId);
    const B = DL.assets.heroById.get(vsId);

    el.innerHTML = `<section class="page-head"><div><h1>Matchups</h1><p class="muted">Choisis ton héros et ton adversaire pour voir qui gagne le face-à-face et quoi acheter.</p></div></section>
      ${filterBar(() => render(el, _params, query), { extra: `<label class="switch"><input type="checkbox" id="mu-lane" ${sameLane ? 'checked' : ''}><span>Même lane uniquement</span></label>` })}
      <div class="vs-pick">
        ${heroPicker({ selected: heroId, exclude: vsId, placeholder: 'Ton héros', onPick: (id) => go(id, vsId) })}
        <button class="vs-swap" id="vs-swap" title="Inverser" ${A && B ? '' : 'disabled'}>VS</button>
        ${heroPicker({ selected: vsId, exclude: heroId, placeholder: 'Adversaire', onPick: (id) => go(heroId, id) })}
      </div>
      <div id="mu-body">${A ? loading() : ''}</div>`;
    el.querySelector('#mu-lane').addEventListener('change', (e) => { sameLane = e.target.checked; render(el, _params, query); });
    el.querySelector('#vs-swap').addEventListener('click', () => go(vsId, heroId));

    const body = el.querySelector('#mu-body');
    if (!A) {
      body.innerHTML = `<div class="card"><h3>Choisis un héros</h3><div class="hero-grid">${DL.assets.heroes.map((h) => `<a href="#/matchups?hero=${h.id}">${heroImg(h, 'hero-icon lg')}<span>${esc(h.name)}</span></a>`).join('')}</div></div>`;
      return;
    }

    let counters;
    try { counters = await DL.counterStats(sameLane); } catch (err) { body.innerHTML = errorState(err); return; }

    if (!B) {
      const rows = counters.filter((r) => r.hero_id === A.id && DL.assets.heroById.has(r.enemy_hero_id))
        .map((r) => ({ ...r, enemy: DL.assets.heroById.get(r.enemy_hero_id), name: DL.assets.heroById.get(r.enemy_hero_id).name, wr: r.wins / Math.max(1, r.matches_played) }));
      body.innerHTML = rows.length ? `<div class="card"><h3>${esc(A.name)} contre chaque héros</h3>${sortableTable({
        rows,
        initial: 'wr',
        rowAttrs: (r) => `class="clickable" data-vs="${r.enemy_hero_id}"`,
        columns: [
          { key: 'name', label: 'Adversaire', render: (r) => `<span class="hero-cell">${heroImg(r.enemy)}<b>${esc(r.name)}</b></span>` },
          { key: 'wr', label: `Winrate de ${esc(A.name)}`, cls: 'num', render: (r) => `<span class="${wrClass(r.wr)}">${pct(r.wr)}</span>` },
          { key: 'matches_played', label: 'Parties', cls: 'num', render: (r) => compact(r.matches_played) },
        ],
      })}</div>` : empty('Pas assez de parties pour ce héros.');
      body.querySelectorAll('tr[data-vs]').forEach((tr) => tr.addEventListener('click', () => go(A.id, Number(tr.dataset.vs))));
      return;
    }

    const row = counters.find((r) => r.hero_id === A.id && r.enemy_hero_id === B.id);
    if (!row) { body.innerHTML = empty(`Pas assez de parties ${A.name} contre ${B.name} avec ces filtres. Essaie une période plus longue ou désactive « même lane ».`); return; }

    const n = Math.max(1, row.matches_played);
    const wrA = row.wins / n;
    const per = (v) => v / n;
    body.innerHTML = `<div class="vs-card">
        <div class="vs-side"><img src="${esc(heroCard(A))}" alt=""><h2>${esc(A.name)}</h2><b class="vs-wr ${wrClass(wrA)}">${pct(wrA)}</b></div>
        <div class="vs-mid"><div class="vs-meter"><span style="--w:${wrA * 100}%"></span></div><p class="muted small">${compact(row.matches_played)} parties analysées${sameLane ? ' en lane' : ''}</p></div>
        <div class="vs-side right"><img src="${esc(heroCard(B))}" alt=""><h2>${esc(B.name)}</h2><b class="vs-wr ${wrClass(1 - wrA)}">${pct(1 - wrA)}</b></div>
      </div>
      <div class="grid-2">
        <div class="card"><h3>Statistiques moyennes par partie</h3>
          ${compareRow('Éliminations', per(row.kills), per(row.enemy_kills))}
          ${compareRow('Morts', per(row.deaths), per(row.enemy_deaths), undefined, false)}
          ${compareRow('Assistances', per(row.assists), per(row.enemy_assists))}
          ${compareRow('Âmes', per(row.networth), per(row.enemy_networth), compact)}
          ${compareRow('Last hits', per(row.last_hits), per(row.enemy_last_hits), (v) => v.toFixed(0))}
          ${compareRow('Denies', per(row.denies), per(row.enemy_denies))}
          ${compareRow('Dégâts objectifs', per(row.obj_damage), per(row.enemy_obj_damage), compact)}
        </div>
        <div class="card"><h3>Objets efficaces contre ${esc(B.name)}</h3><div id="mu-items">${loading('')}</div></div>
      </div>
      <div class="card"><div class="card-head"><h3>POV de streamers</h3>${window.DLM_NO_STREAMERS ? '' : '<a class="btn small-btn" href="#/streamers">Gérer les streamers</a>'}</div>
        <p class="muted small">Rediffusions Twitch de streamers qui ont joué ce matchup, calées sur le début de la partie. Elles s'ouvrent directement ici.</p>
        <div id="mu-povs">${loading('')}</div></div>
      <div class="card"><div class="card-head"><h3>Autres parties du matchup</h3>
        <div class="tabs small" id="rp-tabs"><button data-f="win" class="${replayFilter === 'win' ? 'active' : ''}">Victoires de ${esc(A.name)}</button><button data-f="all" class="${replayFilter === 'all' ? 'active' : ''}">Toutes</button></div></div>
        <p class="muted small">Parties récentes au plus haut niveau où ${esc(A.name)} affronte ${esc(B.name)}${sameLane ? ' dans la même lane' : ''}. Sans POV Twitch : copie l'ID de la partie pour la revoir dans le jeu.</p>
        <div id="mu-replays">${loading('Recherche de parties…')}</div></div>`;

    el.querySelector('#rp-tabs').addEventListener('click', (e) => {
      const b = e.target.closest('button[data-f]'); if (!b) return;
      replayFilter = b.dataset.f;
      el.querySelectorAll('#rp-tabs button').forEach((x) => x.classList.toggle('active', x === b));
      loadReplays(el.querySelector('#mu-replays'), A, B);
    });
    loadReplays(el.querySelector('#mu-replays'), A, B);
    loadPovs(el.querySelector('#mu-povs'), A, B);

    try {
      const items = await DL.api.get('/v1/analytics/item-stats', DL.api.analyticsParams({
        bucket: 'no_bucket', hero_ids: String(A.id), enemy_hero_ids: String(B.id), same_lane_filter: sameLane || null, min_matches: 10,
      }));
      const games = items.reduce((m, r) => Math.max(m, r.matches), 1);
      const list = items
        .map((r) => ({ ...r, item: DL.assets.itemById.get(r.item_id), wr: r.wins / Math.max(1, r.matches), pr: r.matches / Math.max(n, games) }))
        .filter((r) => r.item && r.item.item_slot_type && r.pr >= 0.05)
        .sort((a, b) => b.wr - a.wr).slice(0, 12);
      el.querySelector('#mu-items').innerHTML = list.length
        ? `<div class="item-list">${list.map((r) => `<div class="item-line">${itemImg(r.item)}<span>${esc(r.item.name)}</span><b class="${wrClass(r.wr)}">${pct(r.wr)}</b><small class="muted">${pct(r.pr, 0)} · ${compact(r.matches)}</small></div>`).join('')}</div>`
        : empty('Pas assez de données sur les objets dans ce matchup.');
    } catch (err) {
      el.querySelector('#mu-items').innerHTML = errorState(err, false);
    }
  }

  DL.pages.matchups = render;
})(window.DL);
