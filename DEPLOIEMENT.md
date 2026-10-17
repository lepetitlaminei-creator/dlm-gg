# Mettre DLM.gg en ligne

Le site a besoin d'un petit serveur Node (pour garder les clés Twitch secrètes et gérer la connexion Steam). Tout est prêt pour **Render**, qui a une offre gratuite. Un `Dockerfile` est aussi fourni pour Railway, Fly.io ou un VPS.

## Ce qu'il te faut

- Un compte **GitHub** (gratuit) pour y mettre le code.
- Un compte **Render** (gratuit, connexion avec GitHub) : https://render.com
- Tes identifiants Twitch (les mêmes que dans ton `.env`).

## Étapes

1. **Créer le dépôt GitHub.** Crée un dépôt (privé ou public) nommé par exemple `dlm-gg`, et mets-y le **contenu** du dossier `deadlock-app` (pas le dossier lui-même). Le fichier `.gitignore` empêche d'envoyer `.env` et `.session-secret`.
   - Le plus simple : ajoute le dépôt au projet Claude (Paramètres du projet > Ressources), et Claude y poussera le code après ton accord.
2. **Créer le service sur Render.** Dans Render : *New* > *Blueprint*, choisis le dépôt. Render lit `render.yaml` et crée le service `dlm-gg`.
3. **Renseigner les variables** demandées par Render :
   - `TWITCH_CLIENT_ID` et `TWITCH_CLIENT_SECRET` : tes identifiants Twitch ;
   - `PUBLIC_URL` : l'adresse du site donnée par Render, par exemple `https://dlm-gg.onrender.com` (sans `/` à la fin) ;
   - `SESSION_SECRET` est généré automatiquement, `HIDE_STREAMERS=1` masque l'onglet Streamers sur le site public.
4. **Déployer.** Render installe et lance `node server.js`. Le site est en ligne à l'adresse `PUBLIC_URL`.
5. **Twitch.** Dans la console Twitch (dev.twitch.tv), rien à changer pour les POV. Le lecteur Twitch accepte automatiquement le domaine du site.

Chaque fois que le code change sur GitHub, Render redéploie tout seul.

## Bon à savoir

- **Offre gratuite Render :** le site s'endort après 15 minutes sans visite et met environ 30 secondes à se réveiller. Les offres payantes (environ 7 $/mois) évitent ça.
- **Liste des streamers :** sur le site public, elle vient de `streamers.json` dans le dépôt. Pour en ajouter, modifie ce fichier (ou demande à Claude), et le site se met à jour au prochain déploiement.
- **Nom de domaine :** tu peux brancher ton propre domaine (par exemple `dlm.gg`) dans Render > *Settings* > *Custom Domains*, puis mettre à jour `PUBLIC_URL`.
- **Autres hébergeurs :** avec le `Dockerfile`, il suffit de définir les mêmes variables (`TWITCH_CLIENT_ID`, `TWITCH_CLIENT_SECRET`, `PUBLIC_URL`, `SESSION_SECRET`).
- **Sans Twitch :** le site marche sans les clés Twitch, seules les POV sont désactivées.
