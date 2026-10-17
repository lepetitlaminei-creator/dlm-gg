/* Lens : note un joueur sur 5 axes (combat, objectifs, survie, phase de lane, impact d'équipe)
   en le comparant aux joueurs de son rang sur les 30 derniers jours.
   Chaque statistique devient un percentile grâce aux quantiles renvoyés par l'API. */
(function (DL) {
  const { esc, pct, compact, heroImg, loading, errorState, empty } = DL.ui;
  const DAYS = 30;
  const LANE_TIME_S = 720;

  const fmt = {
    pct: (v) => pct(v, 0),
    dec1: (v) => (Number.isFinite(v) ? v.toFixed(1).replace('.', ',') : '–'),
    dec2: (v) => (Number.isFinite(v) ? v.toFixed(2).replace('.', ',') : '–'),
    big: (v) => compact(v),
    souls: (v) => (Number.isFinite(v) ? (v >= 0 ? '+' : '−') + compact(Math.abs(v)) : '–'),
  };

  /* Axes et statistiques qui les composent. inv = plus bas est meilleur. */
  const AXES = [
    { key: 'combat', label: 'Combat', tip: 'Cherche les combats où tu as l\'avantage et vise la tête : dégâts et précision font la différence.', metrics: [
      { key: 'player_damage_per_min', label: 'Dégâts aux héros / min', w: 1.5, f: fmt.big },
      { key: 'kills', label: 'Éliminations', w: 1, f: fmt.dec1 },
      { key: 'kd', label: 'Ratio K/D', w: 1, f: fmt.dec2 },
      { key: 'accuracy', label: 'Précision', w: 0.5, f: fmt.pct },
    ] },
    { key: 'objectives', label: 'Objectifs', tip: 'Transforme tes avantages en dégâts sur les Gardiens, Marcheurs et le Patron, et prends les bonus d\'urne.', metrics: [
      { key: 'boss_damage_per_min', label: 'Dégâts aux objectifs / min', w: 2, f: fmt.big },
      { key: 'neutral_damage_per_min', label: 'Dégâts aux camps neutres / min', w: 0.5, f: fmt.big },
      { key: 'permanent_buffs_per_min', label: 'Bonus permanents / min', w: 0.5, f: fmt.dec2 },
    ] },
    { key: 'survival', label: 'Survie', tip: 'Meurs moins : chaque mort coûte des âmes et laisse ton équipe à 5. Garde un objet de survie et recule plus tôt.', metrics: [
      { key: 'deaths', label: 'Morts', w: 2, f: fmt.dec1, inv: true },
      { key: 'self_healing_per_min', label: 'Soins sur soi / min', w: 0.5, f: fmt.big },
    ] },
    { key: 'laning', label: 'Phase de lane', tip: 'Sécurise les last hits et les denies, et punis ton adversaire quand il vient farmer.', metrics: [
      { key: '__lane', label: `Écart d'âmes en lane à ${LANE_TIME_S / 60} min`, w: 2, f: fmt.souls },
      { key: 'denies', label: 'Denies', w: 1, f: fmt.dec1 },
      { key: 'last_hits', label: 'Last hits', w: 0.5, f: fmt.dec1 },
    ] },
    { key: 'team', label: "Impact d'équipe", tip: 'Joue avec ton équipe : arrive aux combats à temps et aide sur les assistances, les soins et les boucliers.', metrics: [
      { key: 'assists', label: 'Assistances', w: 1, f: fmt.dec1 },
      { key: 'kills_plus_assists', label: 'Participations aux kills', w: 1, f: fmt.dec1 },
      { key: 'teammate_healing', label: 'Soins aux alliés', w: 0.5, f: fmt.big },
      { key: 'teammate_barriering', label: 'Boucliers aux alliés', w: 0.5, f: fmt.big },
    ] },
  ];

  const LEVELS = [1, 5, 10, 25, 50, 75, 90, 95, 99];

  /* Percentile (0-100) d'une valeur d'après les quantiles de la population. */
  function percentileOf(v, m) {
    const q = LEVELS.map((l) => m[`percentile${l}`]);
    if (!Number.isFinite(v) || q.some((x) => !Number.isFinite(x)) || q[0] === q[8]) return null;
    if (v <= q[0]) return q[0] === 0 && v === 0 ? 0.5 : Math.max(0.5, (v / (q[0] || 1)) * 1);
    if (v >= q[8]) return 99.5;
    let below = 0; let above = 100;
    for (let i = 0; i < 8; i++) {
      if (q[i] <= v && v <= q[i + 1]) {
        if (q[i + 1] === q[i]) continue;
        return LEVELS[i] + ((v - q[i]) / (q[i + 1] - q[i])) * (LEVELS[i + 1] - LEVELS[i]);
      }
    }
    /* Valeur pile sur un palier plat (ex. 0 soin pour la plupart des joueurs) : milieu du palier. */
    LEVELS.forEach((l, i) => { if (q[i] < v) below = l; if (q[i] > v && above === 100) above = l; });
    return (below + above) / 2;
  }

  /* Fonction de répartition de la loi normale (approximation d'Abramowitz-Stegun). */
  function normCdf(z) {
    const t = 1 / (1 + 0.2316419 * Math.abs(z));
    const d = 0.3989423 * Math.exp(-z * z / 2);
    const p = d * t * (0.3193815 + t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274))));
    return z > 0 ? 1 - p : p;
  }

  /* Écart d'âmes moyen de la lane au temps voulu, pondéré par le nombre de parties. */
  function laneAt(rows) {
    let sum = 0; let std = 0; let n = 0;
    (rows || []).forEach((r) => {
      const times = r.sample_times_s || [];
      let i = times.indexOf(LANE_TIME_S);
      if (i < 0) i = times.reduce((best, t, k) => (t <= LANE_TIME_S ? k : best), -1);
      if (i < 0) return;
      const w = (r.sample_matches || [])[i] || r.matches_played || 0;
      if (!w) return;
      sum += r.net_worth_diff[i] * w;
      std += ((r.net_worth_diff_std || [])[i] || 0) * w;
      n += w;
    });
    return n ? { diff: sum / n, std: std / n, n } : null;
  }

  const GRADES = [[85, 'S', 'Exceptionnel'], [70, 'A', 'Excellent'], [55, 'B', 'Solide'], [40, 'C', 'Dans la moyenne'], [0, 'D', 'À améliorer']];
  function grade(score) { return GRADES.find(([min]) => score >= min)[1]; }
  function gradeLabel(score) { return GRADES.find(([min]) => score >= min)[2]; }

  function scoreColor(s) {
    if (s >= 70) return 'var(--great)';
    if (s >= 55) return 'var(--good)';
    if (s >= 40) return 'var(--accent)';
    return 'var(--bad)';
  }

  const top = (p) => `Top ${Math.max(1, Math.round(100 - p))} %`;

  /* Jauge circulaire : arc proportionnel au score, contenu libre au centre. */
  function ring(score, size, stroke, inner) {
    const r = (size - stroke) / 2; const c = 2 * Math.PI * r;
    const v = Math.max(0, Math.min(100, score ?? 0));
    return `<div class="ring" style="width:${size}px;height:${size}px">
      <svg viewBox="0 0 ${size} ${size}" aria-hidden="true">
        <circle cx="${size / 2}" cy="${size / 2}" r="${r}" class="ring-track" stroke-width="${stroke}"/>
        <circle cx="${size / 2}" cy="${size / 2}" r="${r}" class="ring-val" stroke-width="${stroke}" stroke="${score == null ? 'transparent' : scoreColor(score)}"
          stroke-dasharray="${(c * v) / 100} ${c}" transform="rotate(-90 ${size / 2} ${size / 2})"/>
      </svg><div class="ring-in">${inner}</div></div>`;
  }

  const ICONS = {
    combat: '<circle cx="12" cy="12" r="7"/><circle cx="12" cy="12" r="2.5"/><path d="M12 2v4M12 18v4M2 12h4M18 12h4"/>',
    objectives: '<path d="M5 21V4h12l-2.5 4L17 12H5"/>',
    survival: '<path d="M12 3l7 3v5.5c0 4.6-3 7.9-7 9.5-4-1.6-7-4.9-7-9.5V6z"/><path d="M9 12l2 2 4-4"/>',
    laning: '<path d="M5 21L9 3M19 21L15 3"/><path d="M12 5v2M12 11v2M12 17v2"/>',
    team: '<circle cx="9" cy="8" r="3.2"/><path d="M3 20c0-3.3 2.7-6 6-6s6 2.7 6 6"/><circle cx="17" cy="9" r="2.5"/><path d="M16 14.2c2.9.3 5 2.6 5 5.8"/>',
  };
  const icon = (k) => `<svg class="ico" viewBox="0 0 24 24" aria-hidden="true">${ICONS[k] || ''}</svg>`;

  function radar(axes) {
    const size = 300; const c = size / 2; const r = 112;
    const pt = (i, v) => {
      const a = -Math.PI / 2 + (i * 2 * Math.PI) / axes.length;
      return [c + Math.cos(a) * r * v, c + Math.sin(a) * r * v];
    };
    const ring = (v) => axes.map((_, i) => pt(i, v).join(',')).join(' ');
    const poly = axes.map((a, i) => pt(i, (a.score ?? 0) / 100).join(',')).join(' ');
    return `<svg class="lens-radar" viewBox="-70 -10 ${size + 140} ${size + 20}" role="img" aria-label="Radar des 5 axes">
      <defs><radialGradient id="lrg" cx="50%" cy="50%" r="60%"><stop offset="0" style="stop-color:var(--accent);stop-opacity:.04"/><stop offset="1" style="stop-color:var(--accent);stop-opacity:.32"/></radialGradient></defs>
      ${[0.25, 0.5, 0.75, 1].map((v) => `<polygon points="${ring(v)}" class="lr-ring ${v === 0.5 ? 'mid' : ''}"/>`).join('')}
      ${axes.map((_, i) => { const [x, y] = pt(i, 1); return `<line x1="${c}" y1="${c}" x2="${x}" y2="${y}" class="lr-axis"/>`; }).join('')}
      <polygon points="${poly}" class="lr-player"/>
      ${axes.map((a, i) => { const [x, y] = pt(i, (a.score ?? 0) / 100); return `<circle cx="${x}" cy="${y}" r="3.5" class="lr-dot"/>`; }).join('')}
      ${axes.map((a, i) => {
        const [x, y] = pt(i, 1.2);
        const anchor = x < c - 10 ? 'end' : x > c + 10 ? 'start' : 'middle';
        return `<text x="${x}" y="${y}" text-anchor="${anchor}" class="lr-label">${esc(a.label)}</text><text x="${x}" y="${y + 15}" text-anchor="${anchor}" class="lr-score" style="fill:${a.score == null ? 'var(--muted)' : scoreColor(a.score)}">${a.score == null ? '–' : Math.round(a.score)}</text>`;
      }).join('')}
    </svg>`;
  }

  function badgeRange(badge) {
    const tier = Math.floor(badge / 10);
    return { min_average_badge: tier * 10 + 1, max_average_badge: tier * 10 + 6 };
  }

  let heroFilter = 0;
  let vsMains = 0;

  let vsRank = 0;
  /* « Mains » d'un héros : joueurs de tous niveaux avec au moins MAIN_MIN_MATCHES parties sur ce héros pendant la période. */
  const MAIN_MIN_MATCHES = 15;
  let selected = 'combat';
  let openMetric = null;

  /* Moyenne de chaque statistique par rang (Initié à Eternus), chargée au premier clic puis gardée. */
  const rankCache = new Map();
  function rankAverages(common) {
    const key = JSON.stringify(common);
    if (!rankCache.has(key)) {
      const tiers = DL.assets.ranks.filter((r) => r.tier > 0).sort((a, b) => a.tier - b.tier);
      rankCache.set(key, Promise.allSettled(tiers.map((r) => DL.api.get('/v1/analytics/player-stats/metrics', { ...common, ...badgeRange(r.tier * 10 + 1), include_buff_metrics: true })))
        .then((res) => tiers.map((r, i) => ({ rank: r, data: res[i].status === 'fulfilled' ? res[i].value : null }))));
    }
    return rankCache.get(key);
  }

  function rankPanel(r, list, badge, who) {
    if (r.key === '__lane') return '<p class="muted small">Par rang, l\'écart d\'âmes moyen en lane est proche de 0 : les deux duos sont du même niveau. Cette stat se compare donc seulement à ton adversaire direct.</p>';
    const rows = list.map(({ rank, data }) => ({ rank, v: data?.[r.key]?.avg })).filter((x) => Number.isFinite(x.v));
    if (!rows.length) return '<p class="muted small">Pas de données par rang pour cette statistique.</p>';
    const myTier = badge ? Math.floor(badge / 10) : -1;
    const max = Math.max(...rows.map((x) => x.v), r.value || 0) || 1;
    const im = (rank) => { const i = rank.images || {}; return i.small_webp || i.small || ''; };
    return `<div class="rk-head"><span class="eyebrow">Moyenne par rang${who ? ' · ' + esc(who) : ''}</span>${r.value == null ? '' : `<span class="rk-you"><i></i>Toi : ${esc(r.f(r.value))}</span>`}</div>
      <div class="rk-list" style="--you:${r.value == null ? -1 : (r.value / max) * 100}%">${rows.map((x) => `<div class="rk-rank ${x.rank.tier === myTier ? 'mine' : ''}">
        <span class="rk-name">${im(x.rank) ? `<img src="${esc(im(x.rank))}" alt="">` : ''}<span style="color:${esc(x.rank.color || 'var(--text)')}">${esc(x.rank.name)}</span></span>
        <span class="rk-track"><i style="--w:${(x.v / max) * 100}%"></i></span>
        <b class="num">${esc(r.f(x.v))}</b>
      </div>`).join('')}</div>`;
  }

  function detail(a) {
    return `<div class="ld-head">
        <span class="ld-ico" style="color:${a.score == null ? 'var(--muted)' : scoreColor(a.score)}">${icon(a.key)}</span>
        <div><h4 class="eyebrow">Détail</h4><h3>${esc(a.label)}</h3></div>
        <div class="ld-score"><b style="color:${a.score == null ? 'var(--muted)' : scoreColor(a.score)}">${a.score == null ? '–' : Math.round(a.score)}</b><span>${a.score == null ? 'pas de données' : top(a.score)}</span></div>
      </div>
      <div class="ld-rows">
        <div class="ld-row ld-legend"><span>Statistique</span><span class="num">Toi</span><span>Position <i class="ld-mtick"></i> médiane</span><span class="num">Rang</span></div>
        ${a.rows.map((r) => `<div class="ld-row ${openMetric === r.key ? 'open' : ''}" data-m="${r.key}" role="button" tabindex="0" title="Voir la moyenne de chaque rang">
          <span class="ld-label">${esc(r.label)}</span>
          <b class="num">${r.value == null ? '–' : r.f(r.value)}</b>
          <span class="ld-bar" title="${r.median == null ? '' : 'Médiane : ' + esc(r.f(r.median))}"><i style="--w:${r.p ?? 0}%;background:${r.p == null ? 'transparent' : scoreColor(r.p)}"></i><em></em></span>
          <span class="num ld-top" style="color:${r.p == null ? 'var(--muted)' : scoreColor(r.p)}">${r.p == null ? '–' : top(r.p)}</span>
          <small class="ld-med">médiane ${r.median == null ? '–' : esc(r.f(r.median))}</small>
        </div>${openMetric === r.key ? `<div class="ld-ranks" data-for="${r.key}">${loading('Moyennes par rang…')}</div>` : ''}`).join('')}
      </div>
      <p class="ld-hint">Clique sur une statistique pour voir la moyenne de chaque rang.</p>
      <p class="ld-tip">${icon(a.key)}<span><b>Conseil.</b> ${esc(a.tip)}</span></p>`;
  }

  async function render(box, { accountId, badge, heroStats, matches }) {
    const args = { accountId, badge, heroStats, matches };
    const played = (heroStats || []).filter((h) => DL.assets.heroById.has(h.hero_id)).sort((a, b) => b.matches_played - a.matches_played);
    box.innerHTML = `<section class="lens">
      <div class="lens-bar">
        <div><span class="eyebrow">DLM Lens</span><h2>Analyse de tes performances</h2></div>
        <div class="lens-controls">
          <select data-l="hero" aria-label="Mes parties"><option value="0">Tous mes héros</option>${played.map((h) => `<option value="${h.hero_id}" ${h.hero_id === heroFilter ? 'selected' : ''}>${esc(DL.assets.heroById.get(h.hero_id).name)} (${h.matches_played})</option>`).join('')}</select>
          <label class="vs-select ${vsMains ? 'on' : ''}"><span>VS</span><select data-l="vs" aria-label="Comparer à">
            <option value="0">Tous les joueurs</option>
            <optgroup label="Main d'un héros">${[...DL.assets.heroes].sort((a, b) => a.name.localeCompare(b.name)).map((h) => `<option value="${h.id}" ${h.id === vsMains ? 'selected' : ''}>Main ${esc(h.name)}</option>`).join('')}</optgroup>
          </select></label>
          <select data-l="rank" aria-label="Rang comparé"><option value="0">Tous les rangs</option>${DL.assets.ranks.filter((r) => r.tier > 0).sort((a, b) => a.tier - b.tier).map((r) => `<option value="${r.tier}" ${r.tier === vsRank ? 'selected' : ''}>${esc(r.name)}${badge && Math.floor(badge / 10) === r.tier ? ' (ton rang)' : ''}</option>`).join('')}</select>
        </div>
      </div>
      <div class="lens-body">${loading('Analyse de tes parties…')}</div>
    </section>`;
    box.querySelector('[data-l=hero]').addEventListener('change', (e) => { heroFilter = Number(e.target.value); render(box, args); });
    box.querySelector('[data-l=rank]').addEventListener('change', (e) => { vsRank = Number(e.target.value); render(box, args); });
    box.querySelector('[data-l=vs]').addEventListener('change', (e) => {
      vsMains = Number(e.target.value);
      /* Contre les mains d'un héros, on regarde par défaut tes parties sur ce même héros si tu l'as joué. */
      if (vsMains && !heroFilter && played.some((h) => h.hero_id === vsMains)) heroFilter = vsMains;
      render(box, args);
    });

    const body = box.querySelector('.lens-body');
    const since = Math.floor(Date.now() / 3600000) * 3600 - DAYS * 86400;
    const recent = (matches || []).filter((m) => m.start_time >= since && (!heroFilter || m.hero_id === heroFilter)).length;
    const common = { game_mode: 'normal', min_unix_timestamp: since, hero_ids: heroFilter ? String(heroFilter) : null };
    let bench = {};
    let laneBench = {};
    const vsHero = vsMains ? DL.assets.heroById.get(vsMains) : null;
    if (vsHero) {
      bench = { hero_ids: String(vsMains), min_hero_matches: MAIN_MIN_MATCHES };
      laneBench = { hero_ids: [vsMains], min_hero_matches: MAIN_MIN_MATCHES };
    }
    if (vsRank) {
      const range = badgeRange(vsRank * 10 + 1);
      bench = { ...bench, ...range };
      laneBench = { ...laneBench, ...range };
    }
    const laneCommon = { game_mode: 'normal', min_unix_timestamp: since, hero_ids: heroFilter ? [heroFilter] : null, max_time_s: LANE_TIME_S, group_by: 'assigned_lane' };

    const [mine, pop, myLane, popLane] = await Promise.allSettled([
      DL.api.get('/v1/analytics/player-stats/metrics', { ...common, account_ids: [accountId], include_buff_metrics: true }),
      DL.api.get('/v1/analytics/player-stats/metrics', { ...common, ...bench, include_buff_metrics: true }),
      DL.api.get('/v1/analytics/lane-soul-curve', { ...laneCommon, account_ids: [accountId], min_matches: 1 }),
      DL.api.get('/v1/analytics/lane-soul-curve', { ...laneCommon, ...laneBench }),
    ]);
    if (mine.status === 'rejected' || pop.status === 'rejected') { body.innerHTML = errorState(mine.reason || pop.reason, false); return; }
    const me = mine.value || {};
    const ref = pop.value || {};
    if (!Object.keys(me).length || !Number.isFinite(me.kills?.avg)) { body.innerHTML = empty(`Pas assez de parties ces ${DAYS} derniers jours pour analyser ce joueur.`); return; }

    const lane = myLane.status === 'fulfilled' ? laneAt(myLane.value) : null;
    const laneRef = popLane.status === 'fulfilled' ? laneAt(popLane.value) : null;

    const axes = AXES.map((axis) => {
      const rows = axis.metrics.map((m) => {
        if (m.key === '__lane') {
          if (!lane) return { ...m, value: null, p: null };
          const sd = laneRef?.std || lane.std || 1;
          return { ...m, value: lane.diff, median: 0, p: normCdf((lane.diff / sd) * 2) * 100, n: lane.n };
        }
        const mv = me[m.key]; const rv = ref[m.key];
        if (!mv || !rv) return { ...m, value: null, p: null };
        let p = percentileOf(mv.avg, rv);
        if (p != null && m.inv) p = 100 - p;
        return { ...m, value: mv.avg, median: rv.percentile50, p };
      });
      const valid = rows.filter((r) => r.p != null);
      const wsum = valid.reduce((s, r) => s + r.w, 0);
      const score = wsum ? valid.reduce((s, r) => s + r.p * r.w, 0) / wsum : null;
      return { ...axis, rows, score };
    });
    const scored = axes.filter((a) => a.score != null);
    const overall = scored.reduce((s, a) => s + a.score, 0) / Math.max(1, scored.length);
    const best = [...scored].sort((a, b) => b.score - a.score)[0];
    const worst = [...scored].sort((a, b) => a.score - b.score)[0];
    const hero = heroFilter ? DL.assets.heroById.get(heroFilter) : null;
    const vsRankName = vsRank ? DL.assets.rankByTier.get(vsRank)?.name : '';
    const cmpLabel = (vsHero ? `main ${vsHero.name}` : 'tous les joueurs') + (vsRankName ? ` ${vsRankName}` : '');

    const vsNote = vsHero ? `<div class="notice small vs-note">${heroImg(vsHero, 'hero-icon xs')} Comparaison avec les joueurs main <b>${esc(vsHero.name)}</b>${vsRankName ? ` en <b>${esc(vsRankName)}</b>` : ', tous rangs confondus'} : les joueurs avec au moins ${MAIN_MIN_MATCHES} parties sur ${esc(vsHero.name)} ces ${DAYS} derniers jours, sur leurs parties avec ce héros.${hero && hero.id !== vsHero.id ? ` Attention, tu compares tes parties avec ${esc(hero.name)}.` : !hero ? ' Tu compares toutes tes parties, choisis ce héros à gauche pour une comparaison directe.' : ''}</div>` : '';
    body.innerHTML = `${vsNote}${recent < 5 ? `<div class="notice small">Seulement ${recent} partie${recent > 1 ? 's' : ''} enregistrée${recent > 1 ? 's' : ''} sur la période${hero ? ' avec ' + esc(hero.name) : ''} : les notes sont encore peu fiables.</div>` : ''}
      <div class="lens-hero">
        <div class="lens-overall">
          ${ring(overall, 148, 10, `<b class="lens-grade" style="color:${scoreColor(overall)}">${grade(overall)}</b><span class="lens-num">${Math.round(overall)}<small>/100</small></span>`)}
          <div class="lens-meta">
            <span class="eyebrow">Note globale</span>
            <b class="lens-verdict">${gradeLabel(overall)}</b>
            <span class="chip">${hero ? heroImg(hero, 'hero-icon xs') + ' ' + esc(hero.name) + ' · ' : ''}vs ${esc(cmpLabel)} · ${DAYS} j · ${recent} partie${recent > 1 ? 's' : ''}</span>
          </div>
        </div>
        ${radar(axes)}
        <div class="lens-insights">
          ${best ? `<div class="insight up"><span class="eyebrow">Point fort</span><b>${esc(best.label)}</b><span>${top(best.score)} · ${Math.round(best.score)}/100</span></div>` : ''}
          ${worst && worst !== best ? `<div class="insight down"><span class="eyebrow">À travailler</span><b>${esc(worst.label)}</b><span>${top(worst.score)} · ${Math.round(worst.score)}/100</span></div>` : ''}
        </div>
      </div>
      <div class="lens-tiles" role="tablist">${axes.map((a) => `<button class="lens-tile ${a.key === selected ? 'active' : ''}" data-axis="${a.key}" role="tab" aria-selected="${a.key === selected}">
          <span class="lt-top">${icon(a.key)}<span>${esc(a.label)}</span></span>
          ${ring(a.score, 64, 6, `<b style="color:${a.score == null ? 'var(--muted)' : scoreColor(a.score)}">${a.score == null ? '–' : Math.round(a.score)}</b>`)}
          <span class="lt-sub">${a.score == null ? 'pas de données' : top(a.score)}</span>
        </button>`).join('')}</div>
      <div class="lens-detail"></div>
      <p class="lens-foot">Chaque note de 0 à 100 est ton percentile parmi ${esc(cmpLabel)} : 50 = dans la moyenne, 80 = meilleur que 80 % d'entre eux. L'écart d'âmes en lane compare ton duo de lane au duo adverse.</p>`;

    const panel = body.querySelector('.lens-detail');
    const drawDetail = () => {
      const axis = axes.find((a) => a.key === selected) || axes[0];
      panel.innerHTML = detail(axis);
      const slot = panel.querySelector('.ld-ranks');
      if (!slot) return;
      const row = axis.rows.find((r) => r.key === openMetric);
      const rankBase = vsHero ? { ...common, hero_ids: String(vsMains), min_hero_matches: MAIN_MIN_MATCHES } : common;
      rankAverages(rankBase).then((list) => { if (slot.isConnected) slot.innerHTML = rankPanel(row, list, badge, vsHero ? `main ${vsHero.name}` : ''); });
    };
    if (!axes.find((a) => a.key === selected)?.rows.some((r) => r.key === openMetric)) openMetric = null;
    drawDetail();
    body.querySelectorAll('.lens-tile').forEach((t) => t.addEventListener('click', () => {
      selected = t.dataset.axis; openMetric = null;
      body.querySelectorAll('.lens-tile').forEach((x) => { x.classList.toggle('active', x === t); x.setAttribute('aria-selected', x === t); });
      drawDetail();
    }));
    const toggle = (row) => { openMetric = openMetric === row.dataset.m ? null : row.dataset.m; drawDetail(); };
    panel.addEventListener('click', (e) => { const row = e.target.closest('.ld-row[data-m]'); if (row) toggle(row); });
    panel.addEventListener('keydown', (e) => { const row = e.target.closest('.ld-row[data-m]'); if (row && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); toggle(row); } });
  }

  DL.lens = { render, percentileOf, AXES };
})(window.DL);
