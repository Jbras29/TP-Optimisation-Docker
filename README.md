# TP Docker Optimisation

**Étudiant :** Julien BRAS  
**Formation :** M2 MIAGE IPM  
**Université :** Université Toulouse Capitole

## 1. Objectif et état initial

Ce TP consiste à optimiser progressivement une application Node.js et son image Docker, puis à mesurer l'impact de chaque modification.

L'application expose deux routes :

- `/` retourne un message de bienvenue ;
- `/big` lit le fichier `maybe-big-file.txt` lorsqu'il existe.

L'image initiale, basée sur `node:latest`, mesurait environ **1,365 Go**. La route `/big` retournait alors un statut `200 OK` même lorsque le fichier était absent.

## 2. Mesures comparatives

| Étape    | Modification principale                                      | Taille de l'image | Temps de build |
| -------- | ------------------------------------------------------------ | ----------------: | -------------: |
| Baseline | Dockerfile initial                                           |          1,365 Go |       21,764 s |
| 1        | `.dockerignore` et suppression de la copie de `node_modules` |          1,360 Go |           43 s |
| 2        | Installation avec `npm ci --omit=dev`                        |          1,355 Go |       24,324 s |
| 3        | Suppression des paquets système inutiles                     |          1,270 Go |        9,114 s |
| 4        | Passage à `node:22-alpine`                                   |          0,175 Go |       10,270 s |
| 5        | Utilisateur non privilégié et nettoyage du cache npm         |          0,172 Go |        4,206 s |

Les temps dépendent du réseau (celle de l'université est plutôt instable ce qui fausse les temps de build lors de téléchargement de librairies), de la machine et du cache Docker.

## 3. Optimisations Docker

### Étape 1 : réduire le contexte

Un fichier `.dockerignore` exclut notamment `node_modules`, `.git` et les fichiers inutiles. Les dépendances ne sont plus copiées depuis la machine locale : elles sont installées directement dans l'image.

### Étape 2 : installer les dépendances de production

`npm ci --omit=dev` utilise strictement le fichier `package-lock.json` et exclut les dépendances de développement comme `nodemon`. L'installation est ainsi reproductible et adaptée à la production.

### Étape 3 : supprimer les paquets inutiles

Les paquets système qui normalement devrait servir à build l'application ont été supprimés. La commande build était inutile comme montré sur le package.json initial, donc il ne sera pas nécessaire de créer une image de build apart et donc les paquets systèmes n'ont pas d'utilités. Cette modification a réduit l'image de **1,355 Go à 1,270 Go**.

### Étape 4 : utiliser une image Alpine

`node:latest` a été remplacée par `node:22-alpine`. La version de Node.js est fixée pour être prédictible et l'image de base est beaucoup plus légère. La taille est passée de **1,270 Go à 0,175 Go**.

### Étape 5 : finaliser et sécuriser l'image

Le Dockerfile final :

- copie les fichiers `package*.json` avant le code afin de préserver le cache Docker ;
- définit `NODE_ENV=production` ;
- nettoie le cache npm ;
- expose uniquement le port `3000` ;
- enlève la commande `npm run build` qui n'avait aucune utilité dans le cadre de l'application
- exécute l'application avec l'utilisateur non privilégié `node`.

## 4. Optimisations de l'application Node.js

Les modifications applicatives sont les suivantes :

- suppression de la dépendance `mongodb`, qui n'était pas utilisée par server.js ;
- remplacement de la lecture synchrone par `fs.promises.readFile()` (cela permets de ne pas bloquer le processus lors de la lecture du fichier, ce qui peut être dangereux surtout si le fichier est gros car le serveur ne pourra pas répondre durant ce temps) ;
- status HTTP `404 Not Found` lorsque `maybe-big-file.txt` n'existe pas ;
- transmission des autres erreurs au middleware Express, avec une réponse `500 Internal Server Error` ;
- activation du logging détaillé uniquement hors production.

## 5. Vérifications

Résultats attendus :

- `/` retourne `HTTP 200` ;
- `/big` retourne `HTTP 404` si le fichier est absent ;
- les erreurs inattendues retournent `HTTP 500` ;
- l'image finale utilise l'utilisateur `node` et le mode `production`;
- l'image Docker est moins lourde, le container prends moins de temps à démarrer et utilise moins de ressources systèmes

## 6. Bilan

L'image est passée d'environ **1,365 Go à 0,172 Go**, soit une réduction d'environ **87 %**. Elle est également plus reproductible, plus rapide à reconstruire avec le cache Docker et plus sûre.

Les étapes peuvent être retrouvés sur les commits du repos avec un commit pour chaque étape.

## 7. Commandes utilisés

Construction et mesure de l'image :

```bash
docker build -f dockerfile -t docker-opti .
docker image inspect docker-opti --format '{{.Size}} bytes'
docker history docker-opti
```

Mesure du temps de build :

```bash
time docker build -f dockerfile --no-cache -t docker-opti .
time docker build -f dockerfile -t docker-opti .
```

Test de l'application :

```bash
docker run --rm -p 3000:3000 --name docker-opti-test docker-opti
curl -i http://localhost:3000/
curl -i http://localhost:3000/big
```
