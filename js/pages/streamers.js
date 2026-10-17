/* Streamers : relie des chaînes Twitch à des comptes Steam pour afficher leurs POV. */
(function (DL) {
  const { esc, loading, empty, rankBadge } = DL.ui;
  const REGIONS = ['Europe', 'NAmerica', 'SAmerica', 'Asia', 'Oceania'];

  /* Retrouve le compte Steam d'un streamer à partir de sa seule chaîne Twitch :
     1. candidats = comptes Steam et joueurs du classement dont le pseudo ressemble au nom de la chaîne ;
     2. pour chaque candidat, on compte ses parties qui tombent pendant les rediffusions Twitch de la chaîne.
     Le bon compte est celui qui jouait pendant les lives. */
  async function findSteam(twitch) {
    const ch = (await DL.twitch.vods([twitch]))[twitch];
    if (ch === null) throw new Error('Chaîne Twitch introuvable.');
    const names = [...new Set([twitch, ch?.display_name].filter(Boolean).map((n) => n.toLowerCase()))];
    const norm = (n) => String(n || '').toLowerCase().replace(/[^a-z0-9]/g, '');
    const wanted = new Set(names.map(norm));

    const ids = new Set();
    const searches = await Promise.allSettled(names.map((n) => DL.api.get('/v1/players/steam-search', { search_query: n, limit: 15 })));
    searches.forEach((r) => { if (r.status === 'fulfilled') r.value.forEach((p) => ids.add(p.account_id)); });
    const boards = await Promise.allSettled(REGIONS.map((r) => DL.api.get(`/v1/leaderboard/${r}`)));
    boards.forEach((r) => {
      if (r.status !== 'fulfilled') return;
      (r.value.entries || []).forEach((e) => {
        if (!wanted.has(norm(e.account_name))) return;
        (e.possible_account_ids || []).slice(0, 5).forEach((id) => ids.add(id));
      });
    });
    const cands = [...ids].slice(0, 20);
    if (!cands.length) return { ch, list: [] };

    let profiles = new Map();
    try { profiles = new Map((await DL.api.get('/v1/players/steam', { account_ids: cands })).map((p) => [p.account_id, p])); } catch (e) { /* noms facultatifs */ }
    const vods = ch?.vods || [];
    const histories = await Promise.allSettled(cands.map((id) => DL.api.get(`/v1/players/${id}/match-history`)));
    const list = cands.map((id, i) => {
      const matches = histories[i].status === 'fulfilled' ? histories[i].value : [];
      const inVods = vods.length ? matches.filter((m) => DL.twitch.vodFor(ch, m.start_time, m.match_duration_s)) : [];
      const covered = vods.length ? matches.filter((m) => m.start_time >= Math.min(...vods.map((v) => v.start))).length : 0;
      const p = profiles.get(id);
      return { id, profile: p, overlap: inVods.length, covered, sameName: wanted.has(norm(p?.personaname)), badge: matches.find((m) => m.ranked_display_badge)?.ranked_display_badge, last: matches[0]?.start_time };
    }).sort((a, b) => b.overlap - a.overlap || b.sameName - a.sameName || (b.last || 0) - (a.last || 0));
    return { ch, list };
  }

  function addAccount(twitch, acc) {
    const list = DL.twitch.localStreamers();
    const found = list.find((s) => DL.twitch.clean(s).twitch === twitch);
    if (found) found.account_ids = [...new Set([...(found.account_ids || []), acc])];
    else list.push({ twitch, account_ids: [acc] });
    DL.twitch.saveLocal(list);
  }

  const IMPORT_MAX = 30;

  /* Import automatique : chaînes en live sur Deadlock -> compte Steam qui jouait pendant leurs rediffusions. */
  async function importLive(el, btn) {
    const log = el.querySelector('#import-log');
    if (!(await DL.twitch.status()).twitch) { log.innerHTML = '<p class="muted small">Twitch doit être configuré (fichier .env) pour importer des streamers.</p>'; return; }
    btn.disabled = true;
    log.innerHTML = loading('Recherche des chaînes en live sur Deadlock…');
    try {
      const known = new Set((await DL.twitch.streamers()).map((s) => s.twitch));
      const todo = (await DL.twitch.live()).filter((c) => !known.has(c.login)).slice(0, IMPORT_MAX);
      if (!todo.length) { log.innerHTML = '<p class="muted small">Toutes les chaînes en live sont déjà dans ta liste.</p>'; return; }
      const rows = [];
      let added = 0;
      const draw = (i) => {
        log.innerHTML = `<p class="muted small">${i < todo.length ? `Analyse ${i + 1} / ${todo.length}…` : 'Terminé.'} ${added} streamer${added > 1 ? 's' : ''} ajouté${added > 1 ? 's' : ''}.</p><ul class="import-rows">${rows.join('')}</ul>`;
      };
      for (let i = 0; i < todo.length; i++) {
        draw(i);
        const c = todo[i];
        let line;
        try {
          const { list } = await findSteam(c.login);
          const best = list[0];
          const sure = best && best.overlap >= 3 && (list.length < 2 || list[1].overlap <= best.overlap / 3);
          if (sure) { addAccount(c.login, best.id); added++; line = `<span class="wr-great">✓ ajouté</span> · ${best.overlap} parties pendant ses lives`; }
          else line = `<span class="muted">${best?.overlap ? 'plusieurs comptes possibles, à ajouter à la main' : 'compte Deadlock introuvable (pseudo en jeu différent ?)'}</span>`;
        } catch (err) { line = `<span class="muted">${esc(err.message)}</span>`; }
        rows.push(`<li><b>${esc(c.display_name)}</b> <span class="muted small">${c.viewers} spectateurs</span> · ${line}</li>`);
      }
      draw(todo.length);
      if (added) drawList(el);
    } catch (err) {
      log.innerHTML = `<p class="muted small">${esc(err.message)}</p>`;
    } finally { btn.disabled = false; }
  }

  async function render(el) {
    const st = await DL.twitch.status();
    el.innerHTML = `<section class="page-head"><div><h1>Streamers</h1><p class="muted">Relie une chaîne Twitch à un ou plusieurs comptes Steam. Leurs parties apparaîtront avec la POV dans les matchups et sur leur profil.</p></div></section>
      ${!st.server ? `<div class="notice"><b>Serveur non lancé.</b> Ouvre l'app avec <code>node server.js</code> (voir le README) pour activer les POV Twitch.</div>`
        : !st.twitch ? `<div class="notice"><b>Twitch non configuré.</b> Renseigne TWITCH_CLIENT_ID et TWITCH_CLIENT_SECRET dans le fichier .env, puis relance le serveur.</div>` : ''}
      <form class="card add-streamer" id="add-streamer">
        <h3>Ajouter un streamer</h3>
        <div class="filters">
          <label><span>Chaîne Twitch</span><input name="twitch" placeholder="pseudo ou lien twitch.tv/…" required></label>
          <button class="btn primary">Trouver son compte</button>
        </div>
        <p class="muted small" id="add-msg">Donne juste la chaîne : l'app cherche les comptes Deadlock qui portent ce nom et garde celui qui jouait pendant ses lives Twitch.</p>
        <div id="cands"></div>
        <details class="manual"><summary class="muted small">Je connais déjà son SteamID</summary>
          <div class="filters"><label><span>Compte Steam</span><input name="steam" placeholder="SteamID ou lien de profil"></label><button type="button" class="btn" id="add-manual">Ajouter</button></div>
        </details>
      </form>
      <div class="card import-live">
        <div class="card-head"><h3>Importer les streamers Deadlock en live</h3><button class="btn primary small-btn" id="import-live">Importer</button></div>
        <p class="muted small">L'app prend les ${IMPORT_MAX} plus grosses chaînes qui streament Deadlock en ce moment, retrouve pour chacune le compte qui jouait pendant ses lives et l'ajoute si le résultat est sûr. Plus tu cliques à des moments différents, plus la liste grandit.</p>
        <div id="import-log"></div>
      </div>
      <div class="card"><div class="card-head"><h3>Streamers enregistrés</h3><button class="btn small-btn" id="export">Copier pour streamers.json</button></div><div id="st-list">${loading('')}</div></div>`;

    const msg = el.querySelector('#add-msg');
    const form = el.querySelector('#add-streamer');
    const cands = el.querySelector('#cands');
    const readTwitch = () => {
      const twitch = DL.twitch.clean({ twitch: form.twitch.value }).twitch;
      if (!/^[a-z0-9_]{2,25}$/.test(twitch)) { msg.textContent = 'Pseudo Twitch invalide.'; return null; }
      return twitch;
    };
    const added = (twitch, acc) => { addAccount(twitch, acc); msg.textContent = `${twitch} ajouté avec le compte ${acc}. Ses parties pendant ses lives apparaîtront dans les matchups.`; cands.innerHTML = ''; form.reset(); drawList(el); };

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const twitch = readTwitch();
      if (!twitch) return;
      if (!(await DL.twitch.status()).twitch) { msg.textContent = 'Twitch doit être configuré (fichier .env) pour retrouver le compte automatiquement. Utilise « Je connais déjà son SteamID ».'; return; }
      cands.innerHTML = loading('Recherche du compte qui jouait pendant ses lives…');
      let res;
      try { res = await findSteam(twitch); } catch (err) { cands.innerHTML = ''; msg.textContent = err.message; return; }
      const { ch, list } = res;
      if (!list.length) { cands.innerHTML = empty('Aucun compte Deadlock avec ce nom. Son pseudo en jeu est sans doute différent : utilise « Je connais déjà son SteamID ».'); return; }
      const best = list[0];
      const sure = best.overlap >= 3 && (list.length < 2 || list[1].overlap <= best.overlap / 3);
      msg.textContent = !ch?.vods?.length ? `${ch?.display_name || twitch} n'a pas de rediffusion en ligne : impossible de vérifier, choisis le bon compte.`
        : sure ? `Compte trouvé : ${best.overlap} parties jouées pendant ses lives.` : 'Plusieurs comptes possibles, choisis le bon.';
      cands.innerHTML = `<div class="cand-list">${list.slice(0, 8).map((c, i) => `<div class="cand ${i === 0 && sure ? 'best' : ''}">
          ${c.profile?.avatarmedium ? `<img src="${esc(c.profile.avatarmedium)}" alt="">` : '<span class="avatar"></span>'}
          <div><b>${esc(c.profile?.personaname || 'Compte ' + c.id)}</b>
            <span class="small ${c.overlap ? 'wr-great' : 'muted'}">${ch?.vods?.length ? (c.overlap ? `✓ ${c.overlap} partie${c.overlap > 1 ? 's' : ''} pendant ses lives` : 'Aucune partie pendant ses lives') : `SteamID ${c.id}`}</span></div>
          ${c.badge ? rankBadge(c.badge) : ''}
          <button type="button" class="btn ${i === 0 && sure ? 'primary' : ''} small-btn" data-acc="${c.id}">Ajouter</button>
        </div>`).join('')}</div>`;
      cands.querySelectorAll('[data-acc]').forEach((btn) => btn.addEventListener('click', () => added(twitch, Number(btn.dataset.acc))));
    });
    el.querySelector('#add-manual').addEventListener('click', () => {
      const twitch = readTwitch();
      if (!twitch) return;
      const acc = DL.parseAccountId(form.steam.value);
      if (!acc) { msg.textContent = 'SteamID invalide.'; return; }
      added(twitch, acc);
    });
    el.querySelector('#import-live').addEventListener('click', (e) => importLive(el, e.currentTarget));
    el.querySelector('#export').addEventListener('click', async (e) => {
      const all = (await DL.twitch.streamers()).map(({ twitch, account_ids }) => ({ twitch, account_ids }));
      const text = JSON.stringify(all, null, 2);
      try { await navigator.clipboard.writeText(text); e.target.textContent = 'Copié ✓'; } catch (err) { window.prompt('Contenu de streamers.json :', text); }
    });
    drawList(el);
  }

  async function drawList(el) {
    const box = el.querySelector('#st-list');
    const list = await DL.twitch.streamers();
    if (!list.length) { box.innerHTML = empty('Aucun streamer pour l’instant.'); return; }
    const ids = [...new Set(list.flatMap((s) => s.account_ids))];
    let names = new Map();
    try { names = new Map((await DL.api.get('/v1/players/steam', { account_ids: ids })).map((p) => [p.account_id, p])); } catch (e) { /* noms facultatifs */ }
    let channels = {};
    if ((await DL.twitch.status()).twitch) {
      try { channels = await DL.twitch.vods(list.map((s) => s.twitch)); } catch (e) { channels = {}; }
    }
    box.innerHTML = `<div class="player-results">${list.map((s) => {
      const ch = channels[s.twitch];
      return `<div class="player-result streamer">
        ${ch?.profile_image_url ? `<img src="${esc(ch.profile_image_url)}" alt="">` : '<span class="avatar"></span>'}
        <div><b><a href="https://www.twitch.tv/${esc(s.twitch)}" target="_blank" rel="noopener">${esc(ch?.display_name || s.twitch)}</a></b>
          <span class="muted small">${s.account_ids.map((id) => `<a href="#/player/${id}">${esc(names.get(id)?.personaname || id)}</a>`).join(', ')}</span>
          <span class="muted small">${ch === null ? 'Chaîne Twitch introuvable' : ch ? `${ch.vods.length} rediffusion${ch.vods.length > 1 ? 's' : ''} en ligne` : ''}${s.source === 'fichier' ? ' · streamers.json' : ''}</span></div>
        ${s.source === 'navigateur' ? `<button class="modal-x" data-del="${esc(s.twitch)}" title="Retirer">✕</button>` : ''}
      </div>`;
    }).join('')}</div>`;
    box.querySelectorAll('[data-del]').forEach((b) => b.addEventListener('click', () => {
      DL.twitch.saveLocal(DL.twitch.localStreamers().filter((s) => DL.twitch.clean(s).twitch !== b.dataset.del));
      drawList(el);
    }));
  }

  DL.pages.streamers = render;
})(window.DL);
