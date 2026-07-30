# What If: History

**Chaque décision écrit l’Histoire.**

What If: History est un jeu de grande stratégie et d’uchronie. Dirigez une nation, partez
d’un contexte historique ou inventez votre propre monde, puis observez les conséquences
politiques, diplomatiques, économiques et militaires de vos décisions. L’application associe
une interface React bilingue, une API TypeScript et une simulation assistée par une IA locale
ou distante.

## Prérequis

- Windows 10/11
- Node.js 24 ou plus récent
- npm 11 ou plus récent
- Un fournisseur IA compatible, par exemple LM Studio sur la machine serveur

## Installation

```powershell
npm install
Copy-Item .env.example .env
npm run dev
```

Le frontend de développement est accessible sur `http://localhost:5173`. Les appels
`/api/v1` sont redirigés vers le serveur sur le port 3000.

## Lancement Windows/LAN

Double-cliquer sur `server.bat`, ou lancer :

```powershell
.\server.ps1
```

Le script construit l’application, applique les migrations SQLite et affiche les adresses
locales. Le serveur écoute sur toutes les interfaces par défaut afin d’être accessible sur le
réseau local.

> What If: History ne fournit pas de comptes utilisateurs. Toute personne présente sur le LAN peut
> consulter et modifier les campagnes. Les clés IA ne sont jamais renvoyées au navigateur et
> les réglages IA ne sont modifiables que depuis la machine serveur.

## Commandes

| Commande             | Rôle                                  |
| -------------------- | ------------------------------------- |
| `npm run dev`        | Serveur et frontend avec rechargement |
| `npm run build`      | Build de production                   |
| `npm start`          | Serveur de production                 |
| `npm run db:migrate` | Migrations SQLite                     |
| `npm test`           | Tests unitaires et d’intégration      |
| `npm run test:e2e`   | Tests navigateur Playwright           |
| `npm run check`      | Garde complète avant publication      |

## Architecture

```text
apps/
  server/       API Express 5, SQLite, SSE et fournisseurs IA
  web/          React, Vite, React-Leaflet et interface FR/EN
packages/
  contracts/    Schémas Zod et types partagés
  core/         Règles de simulation pures
data/           Catalogues historiques versionnés
```

Les campagnes, conversations, unités, événements et réglages sont stockés dans
`data/runtime/what-if-history.sqlite`. Ce fichier, les clés, journaux et anciennes sauvegardes JSON
sont exclus de Git.

## API

La seule API prise en charge est `/api/v1` :

- `/health`, `/catalog/nations`, `/map/regions`, `/map/cities`
- `/games` et les ressources imbriquées `turns`, `actions`, `events`, `units`, `chats`, `advisor`
- `/llm/settings` et `/llm/settings/test`
- `/stream?gameId=…` pour les notifications SSE

Les erreurs utilisent `application/problem+json` et chaque réponse comporte un
en-tête `x-request-id`.

## Fournisseurs IA

- LM Studio
- llama.cpp
- Ollama
- vLLM
- OpenAI
- Google Gemini
- Anthropic

Les moteurs locaux et OpenAI utilisent l’interface Chat Completions compatible OpenAI. Google
et Anthropic utilisent leurs protocoles natifs. Un fournisseur déterministe `fake` est réservé
aux tests.
