# TP Docker Optimisation

**Étudiant :** Julien BRAS  
**Formation :** M2 MIAGE IPM  
**Université :** Université Toulouse Capitole

## Etat initial de l'application et de l'image Docker

### Image

Sans toucher à rien, l'image de l'application fait 1.37GB, ce qui semble excessif pour la taille du projet.

### Application

Une requête sur "/" affiche "Hello world — serveur volontairement non optimisé mais fonctionnel"
Une requête sur "/big" affiche "Fichier introuvable"

## Problèmes identifiés

### Image Docker

- `node:latest` est utilisé comme image de base, mais son utilisation n'est pas prévisible : l'image peut récupérer une nouvelle version de Node.js sans modification du Dockerfile. Il est préférable de choisir une version fixe, idéalement une version LTS, comme `node:22-alpine`.
- On copie les "node_modules" de l'environnement locale, ce qui est inutile et peut provoquer des erreurs (pour du CI, dans le repo on n'enregistre pas les node_modules car lourd et inutile, on doit récupérer les libraries sur le registry npm)
  - `node_modules` est copié deux fois au total : une première fois explicitement, puis potentiellement une seconde fois avec `COPY . /app`.
  - `npm install` est exécuté malgré la copie précédente. Il faut laisser l'image installer les dépendances à partir de `package-lock.json`, avec `npm ci`.
- Aucun fichier `.dockerignore` n'est présent. Le contexte Docker contient donc des fichiers inutiles comme `node_modules` et `.git`.
- Les fichiers `package*.json` devraient être copiés avant le reste du code afin de profiter du cache Docker : une modification de `server.js` ne doit pas provoquer une nouvelle installation des dépendances.
- `npm ci --omit=dev` permet de ne pas installer les dépendances de développement, notamment `nodemon`, dans l'image de production.
- `build-essential` et `locales` sont installés alors qu'ils ne sont pas nécessaires au fonctionnement actuel de l'application. Cette couche ajoute environ 85 Mo à l'image. `ca-certificates` doit être conservé uniquement si une fonctionnalité de l'application en a besoin.
- L'image Debian utilisée par `node:latest` est volumineuse. Une image `node:<version>-alpine` ou `node:<version>-slim` devrait réduire significativement la taille finale.
- L'application ne possède pas de véritable étape de build : le script `npm run build` affiche seulement un message comme démontré dans package.json. Il est donc inutile de prendre une image node large comme spécifié au dessus et de faire un build.
- `USER root` est risqué et inutile pour exécuter cette application. Il faut utiliser l'utilisateur non privilégié fourni par l'image Node avec `USER node`.
- `ENV NODE_ENV=development` n'est pas adapté à l'image de production. Il faut utiliser `ENV NODE_ENV=production`, tout en conservant la possibilité de surcharger cette valeur au lancement du conteneur.
- `EXPOSE 3000 4000 5000` est inutilement large : seul le port `3000` est utilisé par l'application.

### Application

- La librairie MongoDB est inutilisée.
- Les statuts HTTP ne sont pas spécifiés clairement : lorsque le fichier est introuvable, la route renvoie actuellement `200` au lieu de `404`.
- La gestion des exceptions est quasi inexistante pour la lecture du fichier : le code ne gère pas réellement les erreurs de lecture.
- La lecture du fichier et sa conversion en HTML peuvent être améliorées car l'implémentation actuelle n'a pas l'air très robuste.

La dépendance `mongodb` est déclarée dans `package.json`, mais elle n'est jamais utilisée dans `server.js`. Elle doit être supprimée avec `npm uninstall mongodb`, ce qui mettra également à jour `package-lock.json`.

La route `/big` utilise `fs.existsSync` puis `fs.readFileSync`. Ces deux appels sont synchrones et bloquent la boucle événementielle Node.js. Une lecture asynchrone avec `fs.promises.readFile` est préférable. Il faut également gérer les erreurs inattendues avec un middleware Express dédié.

Le contenu du fichier est actuellement envoyé comme HTML après un simple remplacement des retours à la ligne. Si le fichier contient du HTML ou du JavaScript, cela peut provoquer une injection. Pour afficher du texte, il est plus sûr de renvoyer le contenu avec le type `text`. Une librairie n'est pas nécessaire pour lire le fichier : l'API native `fs.promises` suffit.

Le comportement actuellement observé sur `/big` est `HTTP 200` avec le texte `Fichier introuvable`. Ce comportement doit devenir `HTTP 404 Not Found` lorsque le fichier n'existe pas. Les autres erreurs de lecture doivent renvoyer `HTTP 500 Internal Server Error`.

Le middleware de journalisation peut être conservé pour les besoins du TP, mais une application de production devrait utiliser un logger structuré et éviter d'exposer des informations sensibles dans les URL.

Un `HEALTHCHECK` peut également être ajouté pour permettre à Docker de vérifier que le serveur répond. Cette amélioration est optionnelle et doit être adaptée à l'image choisie :

```dockerfile
HEALTHCHECK --interval=30s --timeout=3s \
  CMD wget --no-verbose --tries=1 --spider http://localhost:3000/ || exit 1
```

## Mesures et comparaison des étapes

Le baseline mesuré avec l'image initiale est d'environ **1,365 Go**.

Les valeurs suivantes doivent être complétées après chaque construction :

| Étape    | Modification                                                          | Taille de l'image |               Temps de build |
| -------- | --------------------------------------------------------------------- | ----------------: | ---------------------------: |
| Baseline | Dockerfile initial                                                    |          1,365 Go | 21.764s (27.404s avec cache) |
| 1        | Suppression de la copie de `node_modules` et ajout de `.dockerignore` |         à mesurer |                    à mesurer |
| 2        | Utilisation de `npm ci --omit=dev`                                    |         à mesurer |                    à mesurer |
| 3        | Suppression des paquets système inutiles                              |         à mesurer |                    à mesurer |
| 4        | Utilisation d'une image Node Alpine ou Slim                           |         à mesurer |                    à mesurer |
| 5        | Utilisateur non privilégié et nettoyage final                         |         à mesurer |                    à mesurer |

Commandes utiles pour les mesures :

```bash
docker build -t docker-opti .
docker image inspect docker-opti --format '{{.Size}} bytes'
docker history docker-opti
docker run --rm -p 3000:3000 --name docker-opti-test docker-opti
curl -i http://localhost:3000/
curl -i http://localhost:3000/big
```

Temps de build :

```bash
time docker build --no-cache -t docker-opti .
time docker build -t docker-opti .
```
