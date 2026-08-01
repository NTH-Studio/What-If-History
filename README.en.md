# What If: History

[Français](README.md) · **English**

<p align="center">
  <img src="apps/web/public/what-if-history-mark-v2.png" alt="What If: History logo" width="120">
</p>

**Every decision writes history.**

AI-assisted grand strategy and alternate-history game. Lead a nation, start from a historical
date or invent your own world, then face the political, diplomatic, economic and military
consequences of your decisions.

**Status: active development · version 4.0.0**

[![Support on Ko-fi](https://img.shields.io/badge/Support-Ko--fi-FF5E5B?logo=ko-fi&logoColor=white)](https://ko-fi.com/nthstudio)

This game is a personal project built in my spare time. If you enjoy it and want to support
it, you can buy me a Ko-fi: [ko-fi.com/nthstudio](https://ko-fi.com/nthstudio). Thank you!

## Description

What If: History combines a persistent simulation, a strategic map and a configurable AI
engine. The AI proposes and narrates consequences, while the game engine validates and
applies concrete world mutations to the SQLite campaign.

Highlights:

- **Dated historical scenarios**: choose a date and nation from a world whose states,
  leaders, capitals and territorial statuses follow the selected period.
- **Free-form alternate history**: describe a custom premise, select the difficulty and,
  optionally, assign a different AI model to actions, the advisor, diplomacy and turns.
- **Interactive strategic map**: territories, cities, capitals, units, characters, impact
  zones, fronts, wars and intelligence share one map.
- **Persistent decisions**: prepare an action, preview its effects, have it validated by the
  AI and apply its consequences to the world with a revision history.
- **Military simulation**: land, naval and air orders, routes, progress, interceptions,
  battles, supply, morale and intelligence levels.
- **Diplomacy and advice**: contextual conversations with leaders and a strategic advisor,
  both retained in the campaign.
- **Living timeline**: advance time by day, week, month or year, generate events, replay them
  in a cinematic theater and track their consequences.
- **Campaign memory**: restorable snapshots, editable consolidations, world history, AI
  activity and durable strategic state.
- **Scenario studio**: create, duplicate, publish, archive, import and export playable presets
  with rules, prompts, an initial world and available nations.
- **Adaptable interface**: French/English, system/light/dark themes, three desktop layouts and
  three mobile navigation modes, all remembered locally.
- **Local or LAN use**: the server hosts the production API and frontend together, without
  user accounts or an external database service.

## Prerequisites

- Node.js 24 or newer
- npm 11 or newer
- A supported local or remote AI provider
- Windows 10/11 for the `server.bat` / `server.ps1` launcher

SQLite ships with Node.js, so no separate database server is required.

## Installation and development

Install the dependencies and prepare the local configuration:

```powershell
npm install
Copy-Item .env.example .env
```

Run the API and frontend with automatic reload:

```powershell
npm run dev
```

Defaults:

- frontend: `http://localhost:5173`
- API: `http://127.0.0.1:3000/api/v1`
- SQLite database: `data/runtime/what-if-history.sqlite`

Vite automatically proxies frontend `/api` calls to the local server.

## Windows launcher and LAN access

Double-click `server.bat`, or run:

```powershell
.\server.ps1
```

The launcher checks Node.js, installs dependencies when needed, builds the application,
applies SQLite migrations and starts the production server on port `3000`. Available LAN
addresses are printed in the terminal.

> What If: History does not currently provide user accounts. Anyone who can reach the server
> over the network can view and modify campaigns. AI settings can only be changed from the
> server machine, and keys are never returned to the browser.

## AI configuration

Configuration is available under **AI settings** on the home page. The default setup targets
LM Studio at `http://127.0.0.1:1234/v1` with the `qwen/qwen3.5-9b` model.

Supported providers:

- LM Studio
- llama.cpp
- local Ollama or Ollama Cloud
- vLLM
- OpenAI
- Google Gemini
- Anthropic

LM Studio and OpenAI use an OpenAI-compatible Chat Completions API. Ollama, Google and
Anthropic use their native protocols. The deterministic `fake` provider is restricted to
isolated tests.

Settings and the API key are stored server-side in SQLite. A previously saved key remains
available when a connection test is run without entering it again.

## Environment variables

| Variable                       | Default                               | Purpose                              |
| ------------------------------ | ------------------------------------- | ------------------------------------ |
| `HOST`                         | `0.0.0.0`                             | Network interface to listen on       |
| `PORT`                         | `3000`                                | Server port                          |
| `DATABASE_PATH`                | `data/runtime/what-if-history.sqlite` | SQLite database path                 |
| `APP_ORIGINS`                  | `http://localhost:5173`               | Comma-separated allowed CORS origins |
| `LOG_LEVEL`                    | `info`                                | Server log level                     |
| `LLM_TIMEOUT_MS`               | `45000` in `.env.example`             | Maximum duration of an AI request    |
| `GLOBAL_RATE_LIMIT_PER_MINUTE` | `120`                                 | Global request limit                 |
| `LLM_RATE_LIMIT_PER_MINUTE`    | `10`                                  | AI request limit                     |

The `.env` file, SQLite databases, logs and runtime saves are excluded from Git.

## Useful commands

| Command               | Purpose                                           |
| --------------------- | ------------------------------------------------- |
| `npm run dev`         | Development API and frontend                      |
| `npm run build`       | Production server and frontend build              |
| `npm start`           | Production server                                 |
| `npm run db:migrate`  | Explicitly apply SQLite migrations                |
| `npm test`            | Unit and integration tests                        |
| `npm run test:e2e`    | Playwright browser journeys                       |
| `npm run check`       | Quality, types, tests, build and security audit   |
| `npm run verify:task` | Final gate for the exact delivered worktree state |

Browser tests require Playwright Chromium:

```powershell
npx playwright install chromium
```

## Architecture

```text
apps/
  server/       Express 5 API, SQLite, SSE and AI providers
  web/          React, Vite, React-Leaflet and FR/EN interface
packages/
  contracts/    Shared Zod schemas and types
  core/         Pure strategic simulation rules
data/           Versioned historical atlases and catalogs
tests/e2e/      Desktop and mobile Playwright journeys
scripts/        Build, quality guard and final validation
```

The only supported API is prefixed with `/api/v1`. It covers campaigns, actions, turns,
countries, events, units, orders, the timeline, conversations, the advisor, snapshots,
presets, the world and AI settings. Errors use `application/problem+json`, every response
receives an `x-request-id`, and live updates use SSE.

## Tech stack

- **Frontend**: React 19, TypeScript, Vite, React Router, TanStack Query, React-Leaflet,
  i18next, Radix UI and CSS Modules.
- **Backend**: Node.js 24, Express 5, Zod, Pino, SSE and rate limiting.
- **Database**: native SQLite (`node:sqlite`) in WAL mode, with built-in migrations.
- **Simulation**: shared typed contracts and a separate deterministic engine in
  `packages/core`.
- **Testing**: Vitest, Testing Library, Supertest and Playwright.

## License

This project is distributed under the MIT License. See [LICENSE](LICENSE).
