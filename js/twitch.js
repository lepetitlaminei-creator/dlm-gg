/* POV Twitch : relie des comptes Steam à des chaînes Twitch, retrouve la rediffusion qui couvre
   une partie et l'affiche dans la page, calée sur le début de la partie. */
(function (DL) {
  const { esc, duration, ago, heroImg, kda } = DL.ui;
  const LOCAL_KEY = 'dl:streamers';
  /* Les VOD Twitch sont gardées 7 à 60 jours selon la chaîne : inutile de chercher plus loin. */
  const VOD_MAX_DAYS = 60;

  let statusPromise = null;
  function status() {
    if (location.protocol === 'file:') return Promise.resolve({ server: false, twitch: false });
    if (!statusPromise) {
      statusPromise = fetch('/api/status').then((r) => (r.ok ? r.json() : Promise.reject()))
        .then((s) => ({ server: true, twitch: !!s.twitch }))
        .catch(() => ({ server: false, twitch: false }));
    }
    return statusPromise;
  }

  function localStreamers() {
    try { return JSON.parse(localStorage.getItem(LOCAL_KEY) || '[]'); } catch (e) { return []; }
  }
  function saveLocal(list) {
    try { localStorage.setItem(LOCAL_KEY, JSON.stringify(list)); } catch (e) { /* stockage indisponible */ }
  }

  const clean = (s) => ({
    twitch: String(s.twitch || '').trim().toLowerCase().replace(/^https?:\/\/(www\.)?twitch\.tv\//, '').replace(/\/.*$/, ''),
    name: s.name || '',
    account_ids: [].concat(s.account_ids || s.account_id || []).map(Number).filter(Boolean),
  });

  /* Liste fusionnée : streamers.json (serveur) + ajouts faits dans le navigateur. */
  async function streamers() {
    let shared = [];
    const st = await status();
    if (st.server) {
      try { shared = await (await fetch('/api/streamers')).json(); } catch (e) { shared = []; }
    }
    const byLogin = new Map();
    [...shared.map((s) => ({ ...clean(s), source: 'fichier' })), ...localStreamers().map((s) => ({ ...clean(s), source: 'navigateur' }))]
      .filter((s) => s.twitch && s.account_ids.length)
      .forEach((s) => {
        const prev = byLogin.get(s.twitch);
        if (prev) prev.account_ids = [...new Set([...prev.account_ids, ...s.account_ids])];
        else byLogin.set(s.twitch, s);
      });
    return [...byLogin.values()];
  }

  async function byAccount() {
    const map = new Map();
    (await streamers()).forEach((s) => s.account_ids.forEach((id) => map.set(id, s)));
    return map;
  }

  const vodCache = new Map();
  async function vods(logins) {
    const need = logins.filter((l) => !vodCache.has(l));
    if (need.length) {
      const res = await fetch('/api/twitch/vods?login=' + encodeURIComponent(need.join(',')));
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Erreur Twitch');
      need.forEach((l) => vodCache.set(l, data[l] || null));
    }
    const out = {};
    logins.forEach((l) => { out[l] = vodCache.get(l); });
    return out;
  }

  /* VOD qui couvre la partie, et position de la partie dans la VOD. */
  const POV_DELAY_S = 30;
  function vodFor(channel, start, matchDuration) {
    if (!channel) return null;
    const startTime = DL.ui.toUnix(start);
    if (!Number.isFinite(startTime)) return null;
    const mid = startTime + Math.min(120, (Number(matchDuration) || 0) / 2);
    const v = channel.vods.find((x) => x.start <= mid && x.start + x.duration >= mid);
    /* On démarre 30 s après le début de la partie, le temps qu'elle se lance (demande de Mr L). */
    return v ? { vod: v, offset: Math.max(0, startTime + POV_DELAY_S - v.start) } : null;
  }

  const twitchTime = (s) => `${Math.floor(s / 3600)}h${Math.floor((s % 3600) / 60)}m${Math.floor(s % 60)}s`;

  /* Chaînes en live sur Deadlock, triées par spectateurs. */
  async function live() {
    const res = await fetch('/api/twitch/live');
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Erreur Twitch');
    return data.sort((a, b) => b.viewers - a.viewers);
  }

  /* ---------- Fenêtre de lecture ---------- */
  function close() {
    const m = document.querySelector('.modal');
    if (m) m.remove();
    document.body.classList.remove('modal-open');
    document.removeEventListener('keydown', onKey);
  }
  function onKey(e) { if (e.key === 'Escape') close(); }

  /* pov : { channel, vod, offset, hero, player, foeHero, foe, match } */
  function openPov(pov) {
    close();
    let offset = pov.offset;
    const parent = location.hostname || 'localhost';
    const src = () => `https://player.twitch.tv/?video=v${pov.vod.id}&time=${twitchTime(offset)}&parent=${encodeURIComponent(parent)}&autoplay=true`;
    const root = document.createElement('div');
    root.className = 'modal';
    root.innerHTML = `<div class="modal-box pov-box" role="dialog" aria-label="POV de ${esc(pov.channel.display_name)}">
      <header class="modal-head">
        <div class="pov-title">${pov.channel.profile_image_url ? `<img class="avatar" src="${esc(pov.channel.profile_image_url)}" alt="">` : ''}
          <div><b>POV de ${esc(pov.channel.display_name)}</b>
          <span class="muted small">${heroImg(pov.hero, 'hero-icon xs')} ${esc(pov.hero?.name || '')}${pov.foeHero ? ` contre ${esc(pov.foeHero.name)}` : ''} · ${pov.win ? '<span class="wr-great">Victoire</span>' : '<span class="wr-bad">Défaite</span>'} · ${pov.player.kills}/${pov.player.deaths}/${pov.player.assists} · ${duration(pov.match.duration_s)} · ${ago(pov.match.start_time)}</span></div></div>
        <button class="modal-x" aria-label="Fermer">✕</button>
      </header>
      <div class="pov-frame"><iframe src="${src()}" allowfullscreen allow="autoplay; fullscreen"></iframe></div>
      <footer class="pov-controls">
        <span class="muted small">Lecture à <b class="pov-at">${twitchTime(offset)}</b> dans la rediffusion (30 s après le lancement de la partie). Si le calage n'est pas parfait :</span>
        <button class="btn small-btn" data-shift="-60">−1 min</button><button class="btn small-btn" data-shift="-15">−15 s</button>
        <button class="btn small-btn" data-shift="15">+15 s</button><button class="btn small-btn" data-shift="60">+1 min</button>
        <a class="btn small-btn pov-open" target="_blank" rel="noopener" href="https://www.twitch.tv/videos/${pov.vod.id}?t=${twitchTime(offset)}">Ouvrir sur Twitch ↗</a>
      </footer>
    </div>`;
    document.body.appendChild(root);
    document.body.classList.add('modal-open');
    document.addEventListener('keydown', onKey);
    root.addEventListener('click', (e) => { if (e.target === root) close(); });
    root.querySelector('.modal-x').addEventListener('click', close);
    root.querySelectorAll('[data-shift]').forEach((b) => b.addEventListener('click', () => {
      offset = Math.max(0, offset + Number(b.dataset.shift));
      root.querySelector('iframe').src = src();
      root.querySelector('.pov-at').textContent = twitchTime(offset);
      root.querySelector('.pov-open').href = `https://www.twitch.tv/videos/${pov.vod.id}?t=${twitchTime(offset)}`;
    }));
  }

  /* ---------- Recherche des POV d'un matchup ---------- */
  async function matchupPovs(A, B, opts) {
    const accounts = await byAccount();
    if (!accounts.size) return { povs: [], noStreamers: true };
    const ids = [...accounts.keys()];
    const f = DL.filters();
    const matches = await DL.api.get('/v1/matches/metadata', {
      account_ids: ids.slice(0, 1000),
      hero_ids: String(A.id),
      include_info: true,
      include_player_kda: true,
      extra_player_columns: 'net_worth,assigned_lane',
      game_mode: 'normal',
      match_mode: f.mode === 'ranked' ? 'ranked' : null,
      min_unix_timestamp: Math.floor(Date.now() / 3600000) * 3600 - VOD_MAX_DAYS * 86400,
      order_by: 'start_time',
      order_direction: 'desc',
      limit: 500,
    });
    const candidates = [];
    for (const m of matches) {
      const players = m.players || [];
      const me = players.find((p) => p.hero_id === A.id);
      const foe = me && players.find((p) => p.hero_id === B.id && p.team !== me.team);
      if (!foe) continue;
      if (opts.sameLane && !(me.assigned_lane != null && me.assigned_lane === foe.assigned_lane)) continue;
      [[me, A, foe, B], [foe, B, me, A]].forEach(([p, hero, other, otherHero]) => {
        const s = accounts.get(p.account_id);
        if (s) candidates.push({ match: m, player: p, hero, foe: other, foeHero: otherHero, streamer: s, win: m.winning_team === p.team, side: hero === A ? 'me' : 'foe' });
      });
    }
    if (!candidates.length) return { povs: [] };
    const channels = await vods([...new Set(candidates.map((c) => c.streamer.twitch))]);
    const povs = [];
    const misses = [];
    candidates.forEach((c) => {
      const channel = channels[c.streamer.twitch];
      const hit = vodFor(channel, c.match.start_time, c.match.duration_s);
      if (hit) { povs.push({ ...c, channel, ...hit }); return; }
      /* Raison affichée pour comprendre pourquoi la partie n'a pas de POV. */
      const start = DL.ui.toUnix(c.match.start_time);
      const vs = channel?.vods || [];
      const reason = channel === null ? 'chaîne Twitch introuvable'
        : !vs.length ? 'aucune rediffusion en ligne sur la chaîne'
        : !Number.isFinite(start) ? 'heure de la partie illisible'
        : start < Math.min(...vs.map((v) => v.start)) ? 'partie plus ancienne que ses rediffusions'
        : 'jouée hors des rediffusions (compte Steam peut-être pas le sien)';
      misses.push({ ...c, channel, reason });
    });
    return { povs, misses, checked: candidates.length };
  }

  /* POV disponibles pour l'historique d'un joueur streamer. */
  async function playerPovs(accountId, matches) {
    const accounts = await byAccount();
    const s = accounts.get(accountId);
    if (!s) return null;
    const channel = (await vods([s.twitch]))[s.twitch];
    const out = new Map();
    matches.forEach((m) => {
      const hit = vodFor(channel, m.start_time, m.match_duration_s);
      if (hit) out.set(m.match_id, { ...hit, channel });
    });
    return { streamer: s, channel, povs: out };
  }

  function povRow(p) {
    return `<div class="replay pov-row ${p.win ? 'win' : 'loss'}">
      <div class="rp-res"><b>${p.win ? 'Victoire' : 'Défaite'}</b><span class="muted small">${duration(p.match.duration_s)} · ${ago(p.match.start_time)}</span>${p.match.average_badge ? DL.ui.rankBadge(p.match.average_badge) : ''}</div>
      <div class="rp-player">${p.channel.profile_image_url ? `<img class="avatar" src="${esc(p.channel.profile_image_url)}" alt="">` : ''}<div><b>${esc(p.channel.display_name)}</b><span class="muted small">${p.side === 'me' ? 'joue' : 'adversaire, joue'} ${esc(p.hero.name)}</span></div></div>
      <div class="rp-player">${heroImg(p.hero)}<div><b>${p.player.kills} / <span class="wr-bad">${p.player.deaths}</span> / ${p.player.assists}</b><span class="muted small">${kda(p.player.kills, p.player.deaths, p.player.assists).toFixed(2)} KDA${p.player.net_worth != null ? ' · ' + DL.ui.compact(p.player.net_worth) + ' âmes' : ''}</span></div></div>
      <div class="rp-actions"><button class="btn small-btn primary" data-pov>▶ Voir la POV</button></div>
    </div>`;
  }

  DL.twitch = { status, live, streamers, localStreamers, saveLocal, clean, byAccount, vods, vodFor, openPov, matchupPovs, playerPovs, povRow, close };
})(window.DL);
