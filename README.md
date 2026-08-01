# What If: History

**Français** · [English](README.en.md)

<p align="center">
  <img src="apps/web/public/what-if-history-mark-v2.png" alt="Logo What If: History" width="120">
</p>

**Chaque décision écrit l’Histoire.**

Jeu de grande stratégie et d’uchronie assisté par IA. Prenez la tête d’une nation,
partez d’une date historique ou inventez votre propre monde, puis mesurez les
conséquences politiques, diplomatiques, économiques et militaires de vos décisions.

**Statut : développement actif · version 4.0.0**

[![Soutenir sur Ko-fi](https://img.shields.io/badge/Soutenir-Ko--fi-FF5E5B?logo=ko-fi&logoColor=white)](https://ko-fi.com/nthstudio)

Ce jeu est un projet personnel développé sur mon temps libre. Si le jeu vous plaît et que vous
souhaitez le soutenir, vous pouvez m’offrir un Ko-fi :
[ko-fi.com/nthstudio](https://ko-fi.com/nthstudio). Merci !

## Description

What If: History combine une simulation persistante, une carte stratégique et un moteur IA
configurable. L’IA propose et raconte les conséquences, tandis que le moteur valide puis
applique les mutations concrètes du monde à la campagne SQLite.

Points clés :

- **Scénarios historiques datés** : choisissez une date et une nation à partir d’un monde
  dont les États, dirigeants, capitales et statuts territoriaux suivent la période sélectionnée.
- **Uchronies libres** : décrivez une prémisse personnalisée, choisissez la difficulté et
  attribuez éventuellement un modèle IA différent aux actions, au conseiller, à la diplomatie
  et aux tours.
- **Carte stratégique interactive** : territoires, villes, capitales, unités, personnages,
  zones d’impact, fronts, guerres et renseignements sont réunis sur une même carte.
- **Décisions persistantes** : préparez une action, prévisualisez ses effets, faites-la valider
  par l’IA et appliquez ses conséquences au monde avec un historique de révisions.
- **Simulation militaire** : ordres terrestres, navals et aériens, itinéraires, progression,
  interceptions, batailles, ravitaillement, moral et niveaux de renseignement.
- **Diplomatie et conseil** : conversations avec les dirigeants, réponses contextualisées et
  conseiller stratégique conservés dans la campagne.
- **Chronologie vivante** : avance du temps par jour, semaine, mois ou année, génération
  d’événements, théâtre cinématique et suivi des conséquences.
- **Mémoire de campagne** : sauvegardes restaurables, consolidations éditables, historique du
  monde, activité IA et état stratégique durable.
- **Studio de scénarios** : créez, dupliquez, publiez, archivez, importez et exportez des
  presets jouables avec règles, prompts, monde initial et nations disponibles.
- **Interface adaptable** : français/anglais, thème système/clair/sombre, trois compositions
  bureau et trois navigations mobiles, toutes mémorisées localement.
- **Usage local ou sur le LAN** : le serveur regroupe l’API et le frontend de production, sans
  compte utilisateur ni service de base de données externe.

## Prérequis

- Node.js 24 ou plus récent
- npm 11 ou plus récent
- Un fournisseur IA pris en charge, local ou distant
- Windows 10/11 pour le lanceur `server.bat` / `server.ps1`

SQLite est fourni par Node.js : aucun serveur de base de données séparé n’est nécessaire.

## Installation et développement

Installer les dépendances et préparer la configuration locale :

```powershell
npm install
Copy-Item .env.example .env
```

Lancer l’API et le frontend avec rechargement automatique :

```powershell
npm run dev
```

Par défaut :

- frontend : `http://localhost:5173`
- API : `http://127.0.0.1:3000/api/v1`
- base SQLite : `data/runtime/what-if-history.sqlite`

Vite redirige automatiquement les appels `/api` du frontend vers le serveur local.

## Lancement Windows et accès LAN

Double-cliquez sur `server.bat`, ou lancez :

```powershell
.\server.ps1
```

Le lanceur vérifie Node.js, installe les dépendances si nécessaire, construit l’application,
applique les migrations SQLite et démarre le serveur de production sur le port `3000`. Les
adresses LAN disponibles sont affichées dans le terminal.

> What If: History ne fournit actuellement aucun compte utilisateur. Toute personne pouvant
> joindre le serveur sur le réseau peut consulter et modifier les campagnes. Les réglages IA
> ne sont modifiables que depuis la machine serveur et les clés ne sont jamais renvoyées au
> navigateur.

## Configuration IA

La configuration se fait depuis **Configuration IA** sur la page d’accueil. Le réglage par
défaut cible LM Studio sur `http://127.0.0.1:1234/v1` avec le modèle
`qwen/qwen3.5-9b`.

Fournisseurs pris en charge :

- LM Studio
- llama.cpp
- Ollama local ou Ollama Cloud
- vLLM
- OpenAI
- Google Gemini
- Anthropic

LM Studio et OpenAI utilisent une API Chat Completions compatible OpenAI. Ollama, Google et
Anthropic utilisent leurs protocoles natifs. Le fournisseur déterministe `fake` est réservé
aux tests isolés.

Les réglages et la clé sont enregistrés côté serveur dans SQLite. Une clé déjà enregistrée
reste conservée lorsqu’un test de connexion est relancé sans la saisir à nouveau.

## Variables d’environnement

| Variable                       | Valeur par défaut                     | Rôle                                       |
| ------------------------------ | ------------------------------------- | ------------------------------------------ |
| `HOST`                         | `0.0.0.0`                             | Interface réseau écoutée                   |
| `PORT`                         | `3000`                                | Port du serveur                            |
| `DATABASE_PATH`                | `data/runtime/what-if-history.sqlite` | Chemin de la base SQLite                   |
| `APP_ORIGINS`                  | `http://localhost:5173`               | Origines CORS autorisées, séparées par `,` |
| `LOG_LEVEL`                    | `info`                                | Niveau des journaux serveur                |
| `LLM_TIMEOUT_MS`               | `45000` dans `.env.example`           | Délai maximal d’un appel IA                |
| `GLOBAL_RATE_LIMIT_PER_MINUTE` | `120`                                 | Limite globale de requêtes                 |
| `LLM_RATE_LIMIT_PER_MINUTE`    | `10`                                  | Limite des requêtes IA                     |

Les fichiers `.env`, les bases SQLite, les journaux et les sauvegardes d’exécution sont exclus
de Git.

## Commandes utiles

| Commande              | Rôle                                                 |
| --------------------- | ---------------------------------------------------- |
| `npm run dev`         | API et frontend en développement                     |
| `npm run build`       | Build serveur et frontend de production              |
| `npm start`           | Serveur de production                                |
| `npm run db:migrate`  | Application explicite des migrations SQLite          |
| `npm test`            | Tests unitaires et d’intégration                     |
| `npm run test:e2e`    | Parcours navigateur Playwright                       |
| `npm run check`       | Qualité, types, tests, build et audit de sécurité    |
| `npm run verify:task` | Porte finale adaptée à l’empreinte du worktree livré |

Les tests navigateur nécessitent Chromium Playwright :

```powershell
npx playwright install chromium
```

## Architecture

```text
apps/
  server/       API Express 5, SQLite, SSE et fournisseurs IA
  web/          React, Vite, React-Leaflet et interface FR/EN
packages/
  contracts/    Schémas Zod et types partagés
  core/         Règles pures de simulation stratégique
data/           Atlas et catalogues historiques versionnés
tests/e2e/      Parcours Playwright bureau et mobile
scripts/        Build, garde qualité et validation finale
```

La seule API prise en charge est préfixée par `/api/v1`. Elle expose notamment les campagnes,
actions, tours, pays, événements, unités, ordres, chronologie, conversations, conseiller,
sauvegardes, presets, monde et réglages IA. Les erreurs utilisent
`application/problem+json`, chaque réponse reçoit un identifiant `x-request-id` et les mises
à jour en direct utilisent SSE.

## Stack technique

- **Frontend** : React 19, TypeScript, Vite, React Router, TanStack Query, React-Leaflet,
  i18next, Radix UI et CSS Modules.
- **Backend** : Node.js 24, Express 5, Zod, Pino, SSE et limitation de débit.
- **Base de données** : SQLite natif (`node:sqlite`) en mode WAL, avec migrations intégrées.
- **Simulation** : contrats typés partagés et moteur déterministe séparé dans
  `packages/core`.
- **Tests** : Vitest, Testing Library, Supertest et Playwright.

## Licence

Ce projet est distribué sous licence MIT. Voir [LICENSE](LICENSE).
