# DLM.gg — stats Deadlock façon DPM

App web (HTML/CSS/JS sans build) inspirée de dpm.lol, adaptée à Deadlock.

## Sections
- **Tier list & Builds** (`#/tierlist`) : tous les héros avec tier (S+ à D), winrate, pick rate, KDA, âmes, dégâts, filtrables par rôle, rang, période et mode. Vue tableau ou par tier.
- **Page héros** (`#/hero/<id>`) : objets par phase de jeu, ordre des compétences, objets qui font gagner, builds communautaires populaires, matchups (fort/faible contre), meilleurs alliés.
- **Matchups** (`#/matchups?hero=<id>&vs=<id>`) : face-à-face entre deux héros, stats comparées et objets efficaces contre l'adversaire. Option « même lane ». Liste de replays : parties récentes au plus haut rang où ce matchup a eu lieu, avec le K/D/A et les âmes des deux joueurs, l'ID de la partie à copier pour la regarder dans le jeu et un lien vers la démo quand elle est disponible.
- **Classement** (`#/leaderboard`) : top officiel par région, global ou par héros, avec recherche de pseudo.
- **POV Twitch** : dans Matchups, les parties jouées par des streamers enregistrés s'affichent avec leur rediffusion Twitch, lue directement dans la page et calée sur le début de la partie (boutons ±15 s / ±1 min pour ajuster). Même bouton « POV » dans l'historique du profil d'un streamer.
- **Streamers** (`#/streamers`) : relie une chaîne Twitch à un ou plusieurs comptes Steam.
- **Connexion Steam** : bouton en haut à droite, via la connexion officielle de Steam (OpenID). L'app ne voit jamais ton mot de passe, seulement ton SteamID ; la session dure 30 jours.
- **Lens** (onglet du profil) : note de 0 à 100 sur 5 axes (combat, objectifs, survie, phase de lane, impact d'équipe), avec radar, note globale (S à D), point fort / point à travailler et le détail de chaque stat. Filtrable par héros, comparaison avec les joueurs du même rang ou tous les joueurs.
- **Profil** (`#/player/<steamid>`) : recherche par pseudo / SteamID / lien Steam, rang, forme récente, historique des parties, stats par héros, coéquipiers.

## Lancer
Avec Node 18 ou plus récent :

```
node server.js
# puis http://localhost:8080
```

Ouvrir `index.html` directement marche aussi, mais sans les POV Twitch.

## Activer les POV Twitch (2 minutes)
1. Va sur https://dev.twitch.tv/console/apps, connecte-toi et clique « Register Your Application ».
   Nom au choix, OAuth Redirect URL : `http://localhost`, catégorie : Website Integration, client : Confidential.
2. Copie le **Client ID**, puis génère un **Client Secret**.
3. Copie `.env.example` en `.env` et remplis :
   ```
   TWITCH_CLIENT_ID=...
   TWITCH_CLIENT_SECRET=...
   ```
4. Relance `node server.js`. Le secret reste sur le serveur, il n'est jamais envoyé au navigateur.

### Liste des streamers
L'API Deadlock ne sait pas quel compte Steam appartient à quel streamer : il faut les relier.
- depuis l'app, onglet **Streamers** (enregistré dans ton navigateur) ;
- ou dans `streamers.json`, partagé par tout le monde qui utilise ton serveur :
  ```json
  [{ "twitch": "pseudo_twitch", "account_ids": [12345678] }]
  ```
  Le bouton « Copier pour streamers.json » de l'onglet Streamers génère ce contenu.

Twitch garde les rediffusions 7 à 60 jours selon la chaîne : seules les parties encore couvertes par une rediffusion en ligne apparaissent.
Le lecteur Twitch intégré exige que la page soit servie depuis un nom de domaine (localhost ou ton site), d'où le serveur.

Pour mettre l'app en ligne : n'importe quel hébergeur qui fait tourner Node (Render, Railway, Fly.io, un VPS…), avec les deux variables Twitch.

## Lens : comment les notes sont calculées
Pour chaque stat, l'app récupère tes moyennes des 30 derniers jours et la distribution (percentiles 1 à 99) des joueurs comparés via `/v1/analytics/player-stats/metrics`, puis calcule ton percentile. La note d'un axe est la moyenne pondérée de ses stats :
- **Combat** : dégâts aux héros/min (×1,5), éliminations, K/D, précision (×0,5)
- **Objectifs** : dégâts aux objectifs/min (×2), dégâts aux camps neutres/min, bonus permanents/min (×0,5)
- **Survie** : morts (×2, moins = mieux), soins sur soi/min (×0,5)
- **Phase de lane** : écart d'âmes de ton duo de lane à 12 min (×2, via `/v1/analytics/lane-soul-curve`), denies, last hits (×0,5)
- **Impact d'équipe** : assistances, participations aux kills, soins et boucliers aux alliés (×0,5)

Les poids sont dans `AXES`, en haut de `js/lens.js`.

## Connexion Steam
Rien à configurer en local. Le serveur crée tout seul une clé de session dans `.session-secret` (ne la partage pas). Si l'app est mise en ligne, renseigne `PUBLIC_URL` dans `.env` avec l'adresse du site.

## Données
Toutes les données viennent de l'API communautaire gratuite [Deadlock API](https://api.deadlock-api.com/docs) (pas de clé nécessaire).
Limite : 200 requêtes/min pour les endpoints analytics ; l'app met les réponses en cache 10 min.

## Calcul des tiers
Winrate lissé (a priori bayésien de 50 % sur 400 parties) + petit bonus de popularité, puis découpage en écarts-types :
S+ ≥ 1,4σ, S ≥ 0,7σ, A ≥ 0,1σ, B ≥ −0,5σ, C ≥ −1,2σ, D sinon. Voir `computeTiers` dans `js/ui.js`.

## Structure
```
index.html
css/style.css
js/api.js           client API + cache + filtres
js/ui.js            composants (tableaux triables, sélecteur de héros, rangs, tiers)
js/pages/*.js       une page par section
js/auth.js          connexion Steam (bouton, session)
js/lens.js          onglet Lens du profil
js/twitch.js        POV Twitch (liste des streamers, recherche des rediffusions, lecteur)
js/main.js          routeur et recherche globale (Ctrl K)
server.js           serveur local + appels à l'API Twitch
streamers.json      liste partagée des streamers
```
