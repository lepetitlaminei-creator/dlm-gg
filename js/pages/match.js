/* Détail d'une partie : #/match/{id}?p={compte mis en avant}. */
(function (DL) {
  const { esc, compact, duration, ago, kda, heroImg, itemImg, rankBadge, loading, errorState, empty } = DL.ui;
  const TEAMS = ['Ambre', 'Saphir'];

  /* Dernier relevé de stats d'un joueur (dégâts, soins…), à défaut l'objet vide. */
  const lastStats = (p) => (p.stats && p.stats.length ? p.stats[p.stats.length - 1] : {});

  /* Objets possédés en fin de partie : achats d'objets de boutique, sans ceux revendus, dans l'ordre d'achat. */
  function finalItems(p) {
    return (p.items || [])
      .filter((it) => !it.sold_time_s && DL.assets.itemById.get(it.item_id)?.type === 'upgrade')
      .sort((a, b) => a.game_time_s - b.game_time_s)
      .map((it) => DL.assets.itemById.get(it.item_id));
  }

  /* Écart d'âmes entre les deux équipes au fil de la partie (positif = Ambre devant). */
  function soulDiff(players) {
    const byTime = new Map();
    players.forEach((p) => (p.stats || []).forEach((s) => {
      const t = s.time_stamp_s;
      const row = byTime.get(t) || [0, 0];
      row[p.team === 1 ? 1 : 0] += s.net_worth || 0;
      byTime.set(t, row);
    }));
    return [...byTime.entries()].sort((a, b) => a[0] - b[0]).map(([t, [a, b]]) => ({ t, d: a - b }));
  }

  function diffChart(points) {
    if (points.length < 2) return '';
    const W = 900; const H = 180; const P = 8;
    const maxT = points[points.length - 1].t || 1;
    const maxD = Math.max(1000, ...points.map((p) => Math.abs(p.d)));
    const x = (t) => P + (t / maxT) * (W - 2 * P);
    const y = (d) => H / 2 - (d / maxD) * (H / 2 - P);
    const line = points.map((p) => `${x(p.t).toFixed(1)},${y(p.d).toFixed(1)}`).join(' ');
    const area = `${x(points[0].t)},${H / 2} ${line} ${x(maxT)},${H / 2}`;
    const ticks = [];
    for (let m = 5; m * 60 < maxT; m += 5) ticks.push(m);
    const last = points[points.length - 1].d;
    return `<div class="card"><div class="card-head"><h3>Écart d'âmes entre les équipes</h3>
        <span class="small"><b class="${last >= 0 ? 'team-a' : 'team-b'}">${last >= 0 ? TEAMS[0] : TEAMS[1]} +${compact(Math.abs(last))}</b> <span class="muted">en fin de partie</span></span></div>
      <svg class="md-chart" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" role="img" aria-label="Écart d'âmes au fil de la partie">
        <defs>
          <clipPath id="md-top"><rect x="0" y="0" width="${W}" height="${H / 2}"/></clipPath>
          <clipPath id="md-bot"><rect x="0" y="${H / 2}" width="${W}" height="${H / 2}"/></clipPath>
        </defs>
        ${ticks.map((m) => `<line x1="${x(m * 60)}" x2="${x(m * 60)}" y1="0" y2="${H}" class="md-grid"/>`).join('')}
        <line x1="0" x2="${W}" y1="${H / 2}" y2="${H / 2}" class="md-zero"/>
        <polygon points="${area}" class="md-area-a" clip-path="url(#md-top)"/>
        <polygon points="${area}" class="md-area-b" clip-path="url(#md-bot)"/>
        <polyline points="${line}" class="md-line" vector-effect="non-scaling-stroke"/>
      </svg>
      <div class="md-axis">${ticks.map((m) => `<span style="left:${(x(m * 60) / W) * 100}%">${m} min</span>`).join('')}</div>
      <div class="md-legend small"><span class="team-a">▲ ${TEAMS[0]} devant</span><span class="team-b">▼ ${TEAMS[1]} devant</span></div>
    </div>`;
  }

  function teamTable(team, players, info, focus, names, maxDmg) {
    const won = info.winning_team === team;
    const sum = (k) => players.reduce((s, p) => s + (p[k] || 0), 0);
    const badge = info[`average_badge_team${team}`];
    return `<div class="card md-team ${won ? 'won' : 'lost'} md-${team ? 'b' : 'a'}">
      <div class="card-head"><h3><span class="team-dot"></span>${TEAMS[team]} <span class="md-res">${won ? 'Victoire' : 'Défaite'}</span></h3>
        <span class="muted small">${sum('kills')} / ${sum('deaths')} / ${sum('assists')} · ${compact(sum('net_worth'))} âmes${badge ? ' · ' : ''}</span>${badge ? rankBadge(badge) : ''}</div>
      <div class="md-rows">${players.map((p) => {
        const hero = DL.assets.heroById.get(p.hero_id);
        const st = lastStats(p);
        const dmg = st.player_damage ?? p.player_damage ?? 0;
        const heal = st.player_healing ?? p.player_healing ?? 0;
        const prof = names.get(p.account_id);
        const items = finalItems(p);
        return `<div class="md-row ${p.account_id === focus ? 'focus' : ''}" ${p.account_id ? `data-href="#/player/${p.account_id}"` : ''}>
          <div class="md-who">${heroImg(hero, 'hero-icon lg')}<div><b>${esc(prof?.personaname || (p.account_id ? 'Joueur ' + p.account_id : 'Anonyme'))}</b><span class="muted small">${esc(hero?.name || 'Héros ' + p.hero_id)}${p.level ? ' · niv. ' + p.level : ''}</span></div></div>
          <div class="md-kda"><b>${p.kills} / <span class="wr-bad">${p.deaths}</span> / ${p.assists}</b><span class="muted small">${kda(p.kills, p.deaths, p.assists).toFixed(2)} KDA</span></div>
          <div class="md-num"><b>${compact(p.net_worth)}</b><span class="muted small">âmes</span></div>
          <div class="md-num hide-sm"><b>${p.last_hits ?? '–'} <span class="muted">/ ${p.denies ?? '–'}</span></b><span class="muted small">LH / denies</span></div>
          <div class="md-dmg hide-sm"><b>${compact(dmg)}</b><span class="md-bar"><i style="--w:${maxDmg ? (dmg / maxDmg) * 100 : 0}%"></i></span><span class="muted small">dégâts${heal ? ' · ' + compact(heal) + ' soins' : ''}</span></div>
          <div class="md-items">${items.length ? items.slice(-12).map((it) => itemImg(it)).join('') : '<span class="muted small">Pas d\'objets</span>'}</div>
          <div class="md-pov pov-slot" data-acc="${p.account_id || ''}"></div>
        </div>`;
      }).join('')}</div>
    </div>`;
  }

  async function render(el, params, query) {
    const id = Number(params[0]);
    if (!id) { el.innerHTML = empty('Partie introuvable.'); return; }
    const focus = Number(query.get('p')) || null;
    el.innerHTML = loading('Chargement de la partie…');
    let data;
    try { data = await DL.api.get(`/v1/matches/${id}/metadata`); } catch (err) { el.innerHTML = errorState(err); return; }
    const info = data.match_info || data;
    const players = info.players || [];
    if (!players.length) { el.innerHTML = empty("Les détails de cette partie ne sont pas encore disponibles. Réessaie dans quelques minutes."); return; }

    const ids = players.map((p) => p.account_id).filter(Boolean);
    let names = new Map();
    try { names = new Map((await DL.api.get('/v1/players/steam', { account_ids: ids })).map((p) => [p.account_id, p])); } catch (e) { /* pseudos facultatifs */ }

    const me = focus ? players.find((p) => p.account_id === focus) : null;
    const meWon = me && info.winning_team === me.team;
    const maxDmg = Math.max(0, ...players.map((p) => lastStats(p).player_damage ?? p.player_damage ?? 0));
    const teams = [0, 1].map((t) => players.filter((p) => p.team === t).sort((a, b) => (b.net_worth || 0) - (a.net_worth || 0)));
    const start = info.start_time;
    const backHref = focus ? `#/player/${focus}` : '#/player';

    el.innerHTML = `<a class="md-back muted small" href="${backHref}">← Retour au profil</a>
      <section class="md-head ${me ? (meWon ? 'win' : 'loss') : ''}">
        <div>
          <span class="eyebrow">Partie #${id}</span>
          <h1>${me ? (meWon ? 'Victoire' : 'Défaite') : `Victoire ${TEAMS[info.winning_team] || ''}`}</h1>
          <p class="muted">${duration(info.duration_s || 0)}${start ? ' · ' + ago(start) : ''}${info.match_mode === 4 || info.match_mode === 'Ranked' ? ' · Classée' : ''}</p>
        </div>
        <div class="md-score">
          <div class="team-a"><b>${teams[0].reduce((s, p) => s + (p.kills || 0), 0)}</b><span>${TEAMS[0]}</span></div>
          <span class="muted">–</span>
          <div class="team-b"><b>${teams[1].reduce((s, p) => s + (p.kills || 0), 0)}</b><span>${TEAMS[1]}</span></div>
        </div>
      </section>
      ${diffChart(soulDiff(players))}
      ${teams.map((list, t) => teamTable(t, list, info, focus, names, maxDmg)).join('')}`;

    el.querySelectorAll('.md-row[data-href]').forEach((row) => row.addEventListener('click', (e) => {
      if (e.target.closest('button, a')) return;
      location.hash = row.dataset.href;
    }));
    addPovs(el, id, info, players);
  }

  /* Bouton POV pour chaque streamer enregistré présent dans la partie et en live à ce moment-là. */
  async function addPovs(el, id, info, players) {
    try {
      if (!(await DL.twitch.status()).twitch) return;
      const accounts = await DL.twitch.byAccount();
      const inMatch = players.filter((p) => accounts.has(p.account_id));
      if (!inMatch.length) return;
      const channels = await DL.twitch.vods([...new Set(inMatch.map((p) => accounts.get(p.account_id).twitch))]);
      inMatch.forEach((p) => {
        const s = accounts.get(p.account_id);
        const channel = channels[s.twitch];
        const hit = DL.twitch.vodFor(channel, info.start_time, info.duration_s);
        const slot = el.querySelector(`.md-pov[data-acc="${p.account_id}"]`);
        if (!hit || !slot) return;
        slot.innerHTML = '<button class="btn small-btn primary">▶ POV</button>';
        slot.querySelector('button').addEventListener('click', () => DL.twitch.openPov({
          ...hit, channel,
          hero: DL.assets.heroById.get(p.hero_id),
          player: { kills: p.kills, deaths: p.deaths, assists: p.assists },
          match: { match_id: id, start_time: info.start_time, duration_s: info.duration_s },
          win: info.winning_team === p.team,
        }));
      });
    } catch (e) { /* POV facultatives */ }
  }

  DL.pages.match = render;
})(window.DL);
