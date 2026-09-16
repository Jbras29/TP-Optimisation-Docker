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

| Étape    | Modification                                                          | Taille de l'image |                                                             Temps de build |
| -------- | --------------------------------------------------------------------- | ----------------: | -------------------------------------------------------------------------: |
| Baseline | Dockerfile initial                                                    |          1,365 Go |                                               21.764s (27.404s avec cache) |
| 1        | Suppression de la copie de `node_modules` et ajout de `.dockerignore` |           1,36 Go | 43s (le temps augmente surement à cause de la connexion internet instable) |
| 2        | Utilisation de `npm ci --omit=dev`                                    |          1,355 Go |                                                                   24,324 s |
| 3        | Suppression des paquets système inutiles                              |          1,270 Go |                                                                    9,114 s |
| 4        | Utilisation d'une image Node Alpine légère                            |          0,175 Go |                                                                    10,27 s |
| 5        | Utilisateur non privilégié et nettoyage final                         |          0,172 Go |                                                                    4,206 s |

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

## Explication des optimisations Docker

### Étape 1 : réduire le contexte Docker

Dans le Dockerfile initial, le répertoire du projet était copié intégralement dans l'image. Cela pouvait inclure `node_modules`, le dossier `.git` et d'autres fichiers inutiles à l'exécution. L'ajout d'un fichier `.dockerignore` permet d'exclure ces éléments et de réduire le contexte envoyé au moteur Docker. La copie explicite de `node_modules` a également été supprimée, car les dépendances doivent être installées dans l'environnement du conteneur.

Cette étape améliore la propreté de l'image et évite les problèmes liés à des dépendances installées sur un autre système ou une autre architecture. L'image reste cependant volumineuse, car elle utilise encore l'image Node Debian et conserve les paquets système de l'ancien Dockerfile.

### Étape 2 : installer uniquement les dépendances de production

La commande `npm install` a été remplacée par `npm ci --omit=dev`. `npm ci` s'appuie strictement sur `package-lock.json`, ce qui rend l'installation reproductible. L'option `--omit=dev` exclut les dépendances de développement, comme `nodemon`, qui ne sont pas nécessaires pour exécuter le serveur en production.

Cette modification limite le contenu de `node_modules` et rend l'image plus adaptée à son usage. Le gain de taille reste modéré dans ce projet, mais la méthode est plus fiable et plus pertinente pour un projet contenant davantage de dépendances.

### Étape 3 : supprimer les paquets système inutiles

L'installation de `build-essential`, `ca-certificates` et `locales` a été supprimée. L'application utilise uniquement Node.js et Express et ne nécessite ni compilation native ni génération de locales pour fonctionner. Ces paquets ajoutaient une couche d'environ 85 Mo à l'image.

Cette étape a réduit la taille de l'image de **1,355 Go à 1,270 Go**. Le temps de build mesuré est également passé à **9,114 s**, même si cette mesure peut varier selon le réseau et le cache Docker.

### Étape 4 : utiliser une image Node Alpine

L'image `node:latest` était basée sur une distribution Debian volumineuse et sa version n'était pas fixe. Elle a été remplacée par `node:22-alpine`, qui utilise une base plus légère et une version LTS explicitement choisie.

Cette optimisation a eu le plus fort impact sur la taille de l'image : elle est passée de **1,270 Go à 0,175 Go**. L'image finale reste compatible avec l'application, comme le montrent les tests des routes `/` et `/big`. Le temps de build dépend davantage du téléchargement initial de l'image Alpine, ce qui explique les variations observées.

### Étape 5 : sécuriser et finaliser l'image

La dernière étape utilise `ENV NODE_ENV=production`, nettoie le cache npm avec `npm cache clean --force` et exécute le serveur avec `USER node` plutôt qu'avec `root`. L'utilisateur non privilégié réduit les conséquences possibles d'une vulnérabilité dans l'application.

Les fichiers `package*.json` sont copiés avant `server.js`. Ainsi, Docker peut réutiliser la couche d'installation des dépendances lorsque seul le code applicatif est modifié. Le port exposé est également limité à `3000`, qui est le seul port utilisé par le serveur.

La taille finale obtenue est de **0,172 Go**, avec un temps de build de **4,206 s**. L'image démarre correctement, `nodemon` n'est pas installé et le serveur fonctionne avec l'utilisateur `node`.

### Bilan

Les optimisations ont réduit l'image d'environ **1,365 Go à 0,172 Go**, soit une réduction d'environ **87 %**. L'image finale est plus légère, plus reproductible et plus sûre, tout en conservant le fonctionnement des routes existantes.
