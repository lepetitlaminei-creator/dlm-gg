# DLM.gg : contexte pour reprendre le projet

Ce fichier résume tout ce qui a été construit et décidé, pour reprendre le travail dans une nouvelle discussion sans perdre le fil. À donner à Claude au début de la prochaine session.

## L'app en bref

Site compagnon pour **Deadlock**, inspiré de **DPM.lol** (site de stats LoL). Pages :

- **Tier list & Builds** : tier list par rôle (tableau ou grille par tier), puis une page par héros avec objets par phase de jeu, ordre des compétences, objets qui font gagner, builds communautaires, onglet matchups et synergies.
- **Matchups** : choix de deux héros, carte VS, comparaison des stats, objets efficaces contre l'adversaire, **POV Twitch de streamers** sur ce matchup, et liste d'autres parties du matchup (ID de partie à copier).
- **Classement** : leaderboard par région et par héros, recherche par pseudo, avatars Steam.
- **Profil** : recherche par pseudo Steam, SteamID ou lien de profil. Bannière façon DPM (avatar flouté, winrate, KDA, âmes, héros joués, forme), onglets Lens / Historique (avec boutons « POV ») / Héros / Coéquipiers.
- **Streamers** : gestion de la liste des streamers Twitch utilisée pour les POV.
- **Connexion Steam** en haut à droite.

## Lancer l'app

1. Installer Node 18 ou plus récent.
2. Dans le dossier `deadlock-app`, lancer `node server.js`.
3. Ouvrir **http://localhost:8080**. Ne pas double-cliquer sur `index.html` : en fichier local, la connexion Steam et les POV Twitch ne marchent pas.

Configuration dans un fichier `.env` à côté de `server.js` (modèle : `.env.example`) :

- `TWITCH_CLIENT_ID` et `TWITCH_CLIENT_SECRET` : application créée sur dev.twitch.tv, nécessaires pour les POV.
- `PORT` (8080 par défaut).
- `PUBLIC_URL` : seulement si le site est mis en ligne.
- `SESSION_SECRET` : facultatif. Sinon une clé est générée dans `.session-secret`.

`.env` et `.session-secret` sont secrets : ils ne doivent jamais être partagés ni mis dans le zip. Le secret Twitch reste sur l'ordinateur de Mr L, il ne faut jamais le demander dans la discussion.

## Structure des fichiers

- `index.html` : en-tête, navigation, recherche globale (Ctrl K), zone de connexion.
- `server.js` : serveur Node sans dépendance. Il sert les fichiers et expose :
  - `/api/status` et `/api/me` ;
  - `/api/streamers` (lit `streamers.json`) ;
  - `/api/twitch/vods` (token Twitch côté serveur, cache 10 min) ;
  - `/auth/steam`, `/auth/steam/callback`, `/auth/logout`.
- `streamers.json` : liste partagée des streamers, au format `[{ "twitch": "pseudo", "account_ids": [12345678] }]`.
- `js/api.js` : appels à l'API Deadlock avec cache mémoire et sessionStorage (10 min), filtres globaux (rang, période, mode).
- `js/ui.js` : petits composants (icônes héros/objets, rangs, tableaux triables, sélecteur de héros, calcul des tiers).
- `js/auth.js` : bouton Steam et compte connecté.
- `js/twitch.js` : recherche des VOD et fenêtre POV (lecteur Twitch intégré, décalage ±15 s / ±1 min).
- `js/lens.js` : la Lens.
- `js/main.js` : routeur par `#/page`.
- `js/pages/*.js` : une page par fichier (tierlist, hero, matchups, leaderboard, player, streamers).
- `css/style.css` : thème sombre premium.
- `README.md` : mode d'emploi détaillé.

Tout est en JavaScript classique, sans build ni module, dans un namespace global `window.DL`.

## Sources de données et limites

- **API communautaire Deadlock** (https://api.deadlock-api.com) : assets (héros, objets, rangs), analytics (hero-stats, counters, synergies, item-stats, ability-order, player-stats/metrics, lane-soul-curve), builds, leaderboard, joueurs, matchs.
- **Twitch Helix** : VOD archivées des streamers, recalées sur l'heure de début de la partie Deadlock.
- **Steam OpenID** : connexion. La signature est vérifiée auprès de Steam, puis le serveur pose un cookie de session signé, valable 30 jours.
- **Limite importante :** l'environnement de Claude ne peut pas joindre l'API Deadlock ni Twitch. Tout a été testé avec des données simulées (Playwright, bureau et mobile). Le rendu réel doit être vérifié chez Mr L.
- Pour les POV, il faut que les streamers soient dans la liste avec leur SteamID. Les VOD Twitch expirent au bout de 7 à 60 jours selon la chaîne.

## Décisions prises

- Analyse passive des pages publiques de DPM uniquement.
- Demander avant de pousser du code, créer un dépôt GitHub ou ouvrir une PR. Aucun dépôt pour l'instant : le livrable est `deadlock-app.zip` dans les fichiers du projet.
- Pas de lecteur 2D pour les replays : Mr L veut la **POV du joueur via les rediffusions Twitch**, comme DPM.
- DA premium façon DPM : surfaces sobres, or discret, chiffres alignés, jauges circulaires.
- **Lens :**
  - 5 axes : Combat, Objectifs, Survie, Phase de lane, Impact d'équipe ;
  - chaque stat est convertie en percentile (0 à 100) grâce aux quantiles de l'API, puis pondérée par axe ;
  - période fixe de 30 jours ;
  - note globale avec lettre S/A/B/C/D, radar, point fort et point à travailler, tuiles cliquables, tableau de détail (valeur, médiane, barre de position, « Top X % »).
  - Comparaison par défaut contre **tous les joueurs**, pas contre son rang (demande de Mr L).
  - **Clic sur une stat** : moyenne de chaque rang, d'Initié à Eternus, avec ta valeur en repère.
  - **Menu VS** : « Tous les joueurs » ou « Main [héros] » (au singulier, demande de Mr L), pour tous les héros. Un main est un joueur, de n'importe quel rang, avec au moins 15 parties sur ce héros ces 30 derniers jours. Ce n'est pas seulement le top du classement (demande de Mr L).
  - **Menu Rang** : limite la comparaison à un rang précis, par exemple « ma Scopa vs main Scopa Émissaire ».
  - Si on choisit des mains alors qu'on analyse tous ses héros, la Lens passe sur ce héros si on l'a joué.
- **Ajout de streamer simplifié** : on donne seulement la chaîne Twitch. L'app cherche les comptes Deadlock au pseudo proche (recherche Steam et classements), puis compte pour chacun les parties jouées pendant les rediffusions Twitch de la chaîne. Le compte qui jouait pendant les lives est proposé en premier, et l'ajout se fait en un clic. La saisie manuelle du SteamID reste possible.
- **Icônes d'objets** : images officielles de l'API (version boutique en grand en priorité, avec repli automatique si une image ne charge pas).

- **Classement relié aux comptes** : pour chaque ligne visible, un seul compte possible = « Vérifié » ; plusieurs = celui dont le pseudo Steam correspond (« Vérifié »), sinon le premier (« Probable ») ; aucun = recherche Steam sur le pseudo (« Probable »). Clic sur la ligne = profil ; si rien n'est trouvé, clic = recherche du pseudo.
- **App Windows** : dossier `/mnt/project-files/dlm-desktop` (Electron 33). `npm install` puis `npm run build` recopie `deadlock-app` et produit `DLM.gg.exe` portable ; livré dans `DLM.gg-Windows.zip`. Le serveur tourne dans l'app (port 38080), l'onglet Streamers est masqué (variable `DLM_DESKTOP=1` côté serveur, `window.DLM_DESKTOP` côté page), `streamers.json` est inclus. Le `.env` Twitch se met à côté de `DLM.gg.exe` (ou dans `%APPDATA%/DLM.gg`). Exe non signé et sans icône personnalisée (il faudrait Wine ou Windows pour l'ajouter). Après chaque changement de `deadlock-app`, refaire le build.

- **Détail d'une partie** : `#/match/{id}?p={compte}` (`js/pages/match.js`), ouvert au clic sur une partie de l'historique du profil. Score par équipe (Ambre/Saphir), courbe d'écart d'âmes, puis pour chaque joueur : héros, KDA, âmes, LH/denies, dégâts/soins, objets en fin de partie (achats non revendus), bouton POV si c'est un streamer en live. Données : `/v1/matches/{id}/metadata`.
- **Site public** : prêt à déployer sur Render (`render.yaml`, `package.json`) ou via `Dockerfile`. Guide pas à pas dans `DEPLOIEMENT.md`. Variables : `TWITCH_CLIENT_ID`, `TWITCH_CLIENT_SECRET`, `PUBLIC_URL`, `SESSION_SECRET`, `HIDE_STREAMERS=1` (onglet Streamers masqué sur le site public, comme dans l'app). Le serveur ne sert plus les fichiers internes (server.js, notes, streamers.json…). **En ligne sur https://dlm-gg.onrender.com** (Render, offre gratuite, Blueprint exs-db9ttq3bc2fs73d76960). Code sur GitHub `lepetitlaminei-creator/dlm-gg` (branche `main`, ajouté au projet) : chaque push redéploie le site. Pour publier une modif : copier `deadlock-app` dans le dépôt (sans `.env` ni `.session-secret`), commit, push.

## Points à vérifier sur les vraies données

1. **Filtre des mains** : la Lens envoie `min_hero_matches=15` à `/v1/analytics/player-stats/metrics`. La doc de l'API montre ce paramètre sur `hero-stats`, sans confirmation pour `player-stats/metrics`. Test : avec un même héros, la note doit changer entre « Tous les joueurs » et « Mains [héros] ». Si elle ne bouge pas, le filtre est ignoré. Il faudra alors une autre méthode, par exemple récupérer des comptes qui jouent beaucoup ce héros et les passer en `account_ids`, qui accepte jusqu'à 1000 comptes.
2. **Icônes d'objets** : Mr L voulait « les vraies icônes ». Vérifier ce qui s'affiche réellement et, si besoin, choisir le bon champ d'image (`shop_image`, `image`…) d'après une capture.
3. **Connexion Steam** : elle ne marche que depuis http://localhost:8080. Le flux complet n'a pas encore été confirmé de bout en bout avec Steam.
4. **Recherche auto du compte d'un streamer** : marche si son pseudo en jeu ressemble au nom de sa chaîne et s'il a des rediffusions en ligne. Sinon, il faut le SteamID à la main.
5. **App Windows** : construite et testée sous Linux uniquement (mode bureau du serveur vérifié dans un navigateur), jamais lancée sur un vrai Windows.
6. **Détail de partie** : noms de champs supposés (`items[].item_id`, `sold_time_s`, `stats[].player_damage`, `average_badge_team0/1`) à confirmer sur une vraie partie.
7. Les seuils des tiers et des notes Lens (S ≥ 85, A ≥ 70, B ≥ 55, C ≥ 40) sont à ajuster si les résultats paraissent trop durs ou trop généreux.

- **Streamers** : `streamers.json` contient 90 chaînes : 52 mains par héros plus une quarantaine de grosses chaînes multi-héros. L'onglet Streamers a un bouton « Importer les streamers Deadlock en live » (route serveur `/api/twitch/live`, Helix /streams) qui ajoute les chaînes en live dont le compte est retrouvé avec certitude (ajouts stockés dans le navigateur, à copier dans streamers.json avec le bouton d'export). Mains par héros : recherche du 17 octobre 2026 sur les classements tracklock (recherche du 17 octobre 2026 sur les classements tracklock). Le détail par héros, avec rang et fiabilité, est dans `streamers-otp.md` ; `streamers-otp.json` est la liste brute. Pas de streamer trouvé pour Paradox, Lady Geist, Rat King, Baba, Solomon et Deadman Danny.

## Idées pas encore faites

- Mettre le site en ligne (hébergement, `PUBLIC_URL`) et éventuellement créer un dépôt GitHub.
- Suivi de la Lens dans le temps (évolution de la note semaine après semaine).
- Conseils de la Lens plus précis par héros.
- Page de détail d'une partie (build acheté, timeline des âmes).
