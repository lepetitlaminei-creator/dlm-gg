/* Routeur par hash (#/page/param?query) et recherche globale. */
(function (DL) {
  const { esc, heroImg, loading, errorState } = DL.ui;
  const app = document.getElementById('app');
  let token = 0;

  function parse() {
    const raw = location.hash.replace(/^#\/?/, '') || 'tierlist';
    const [path, qs] = raw.split('?');
    const [page, ...params] = path.split('/').filter(Boolean);
    return { page: page || 'tierlist', params, query: new URLSearchParams(qs || '') };
  }

  /* App Windows : pas de page Streamers (la liste fournie avec l'app suffit). */
  if (window.DLM_NO_STREAMERS) delete DL.pages.streamers;

  async function render() {
    const { page, params, query } = parse();
    const fn = DL.pages[page] || DL.pages.tierlist;
    const navKey = page === 'hero' ? 'tierlist' : page === 'match' ? 'player' : page;
    document.querySelectorAll('[data-nav]').forEach((a) => a.classList.toggle('active', a.dataset.nav === navKey));
    const mine = ++token;
    app.innerHTML = loading();
    try {
      await DL.api.loadAssets();
      if (mine !== token) return;
      await fn(app, params, query);
    } catch (err) {
      if (mine === token) app.innerHTML = errorState(err);
      console.error(err);
    }
    if (mine === token) window.scrollTo({ top: 0 });
  }
  DL.router = { render };

  window.addEventListener('hashchange', render);
  render();
  DL.auth.renderHeader();

  /* ---------- Recherche globale ---------- */
  const form = document.getElementById('global-search');
  const input = document.getElementById('global-search-input');
  const pop = document.getElementById('global-search-pop');

  function suggest() {
    const q = input.value.trim().toLowerCase();
    if (!q || !DL.assets) { pop.hidden = true; return; }
    const heroes = DL.assets.heroes.filter((h) => h.name.toLowerCase().includes(q)).slice(0, 6);
    pop.innerHTML = heroes.map((h) => `<a href="#/hero/${h.id}">${heroImg(h)}<span>${esc(h.name)}</span><small class="muted">Héros</small></a>`).join('')
      + `<a href="#/player?q=${encodeURIComponent(input.value.trim())}"><span class="search-ico">⌕</span><span>Chercher le joueur « ${esc(input.value.trim())} »</span></a>`;
    pop.hidden = false;
  }
  input.addEventListener('input', suggest);
  input.addEventListener('focus', suggest);
  pop.addEventListener('click', () => { pop.hidden = true; input.value = ''; input.blur(); });
  document.addEventListener('click', (e) => { if (!form.contains(e.target)) pop.hidden = true; });
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const first = pop.querySelector('a');
    if (first) location.hash = first.getAttribute('href');
    pop.hidden = true; input.value = ''; input.blur();
  });
  document.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); input.focus(); }
    if (e.key === 'Escape') { pop.hidden = true; input.blur(); }
  });
})(window.DL);
