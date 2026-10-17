/* Connexion avec Steam : le serveur gère l'OpenID Steam et garde la session dans un cookie. */
(function (DL) {
  const { esc } = DL.ui;
  let mePromise = null;

  /* Compte connecté (SteamID3) ou null. */
  function me() {
    if (location.protocol === 'file:') return Promise.resolve(null);
    if (!mePromise) {
      mePromise = fetch('/api/me', { credentials: 'same-origin' })
        .then((r) => (r.ok ? r.json() : null))
        .then((d) => (d && d.account_id) || null)
        .catch(() => null);
    }
    return mePromise;
  }

  async function renderHeader() {
    const box = document.getElementById('auth');
    if (!box) return;
    if (location.protocol === 'file:') {
      /* Ouverte en fichier local, l'app ne peut pas parler au serveur : on renvoie vers la version servie par node server.js. */
      box.innerHTML = '<a class="btn steam-btn" href="http://localhost:8080/auth/steam" title="Nécessite node server.js lancé (http://localhost:8080)"><span class="steam-ico">⬢</span>Se connecter avec Steam</a>';
      return;
    }
    const id = await me();
    if (!id) {
      box.innerHTML = '<a class="btn steam-btn" href="/auth/steam"><span class="steam-ico">⬢</span>Se connecter avec Steam</a>';
      return;
    }
    box.innerHTML = `<a class="me-link" href="#/player/${id}" title="Mon profil"><span class="avatar"></span><span class="me-name">Mon profil</span></a><a class="btn small-btn" href="/auth/logout">Déconnexion</a>`;
    try {
      const [p] = await DL.api.get('/v1/players/steam', { account_ids: [id] });
      if (p) {
        box.querySelector('.avatar').innerHTML = `<img src="${esc(p.avatarmedium || p.avatar)}" alt="">`;
        box.querySelector('.me-name').textContent = p.personaname;
      }
    } catch (e) { /* le lien « Mon profil » suffit */ }
  }

  DL.auth = { me, renderHeader };
})(window.DL);
