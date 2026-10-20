# OpenBizCRM

Open-source all-in-one business platform — HRM, CRM, Accounting, Projects, Chat (Kolabo feature-parity clone, original code).

[![CI](https://img.shields.io/github/actions/workflow/status/openbizcrm/openbizcrm/ci.yml?branch=main&label=CI&logo=github)](https://github.com/openbizcrm/openbizcrm/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](./LICENSE)
[![Bun](https://img.shields.io/badge/bun-1.4-f472b6?logo=bun)](https://bun.sh)
[![Next.js](https://img.shields.io/badge/Next.js-16-black?logo=nextdotjs)](https://nextjs.org)
[![TypeScript](https://img.shields.io/badge/TypeScript-5-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org)

OpenBizCRM is a full-stack Indonesian business platform aiming at feature parity with
Kolabo: a single self-hostable app that covers HR, sales, accounting, projects, and
internal collaboration. All code is original — nothing is copied from the proprietary
product.

## Disclaimer

OpenBizCRM is **not affiliated with, endorsed by, or connected to Kolabo or Langit
Solutions**. It is an independent, feature-inspired rebuild written from scratch with
original code. Product names and trademarks belong to their respective owners.

## Features

### HRM

- Attendance with GPS and WiFi verification
- Payroll with PPh21 tax and BPJS contributions
- Leave management and request approval flows
- 360-degree performance feedback
- LMS (learning management system)
- Recruitment / applicant tracking

### CRM + Projects

- Sales pipeline with deal stages
- Kanban boards
- Gantt chart project planning
- Timesheet tracking

### Finance

- Double-entry accounting ledger
- Invoicing
- Point of sale (POS)

### Collaboration

- Team chat
- Cloud drive (file storage)
- Online meetings

### Platform

- Multi-company / multi-tenant support
- PWA (installable, offline-friendly)
- REST API

## Tech Stack

| Layer     | Technology                                      |
| --------- | ----------------------------------------------- |
| Framework | Next.js 16.4.2 (App Router) + React 19.3        |
| Language  | TypeScript (strict), `src/` layout, `@/*` alias |
| UI        | Tailwind CSS v4 + shadcn/ui (radix-nova style)  |
| Database  | PostgreSQL (Neon in prod, Docker in dev)        |
| ORM       | Drizzle ORM                                     |
| Runtime   | Node 22 (Bun as package manager only)           |
| Testing   | Vitest                                          |

## Getting Started

Requires Node 22 and [Bun](https://bun.sh) 1.4+.

```sh
bun install
cp .env.example .env
bun run dev
```

Then open http://localhost:3000. For a local database:

```sh
docker compose up -d   # Postgres on localhost:5432
bun run db:push
bun run db:seed
```

### Scripts

| Command                 | Description                               |
| ----------------------- | ----------------------------------------- |
| `bun run lint`          | Lint the codebase                         |
| `bun run format`        | Format source files                       |
| `bun run format:check`  | Check formatting without writing          |
| `bun run typecheck`     | Run the TypeScript compiler in check mode |
| `bun run test`          | Run unit tests                            |
| `bun run test:coverage` | Run tests with coverage report            |
| `bun run test:e2e:dry`  | Dry-run end-to-end tests                  |
| `bun run db:generate`   | Generate Drizzle migrations               |
| `bun run db:push`       | Push schema to the database               |
| `bun run db:studio`     | Open Drizzle Studio                       |
| `bun run db:seed`       | Seed the database with sample data        |

## Project Structure

```
src/
├── app/              # Next.js App Router: routes, layouts, API handlers
│   ├── (auth)/       #   Sign-in and onboarding routes
│   ├── (dashboard)/  #   Authenticated app shell and module pages
│   └── api/          #   REST endpoints
├── components/
│   ├── ui/           # shadcn/ui primitives (radix-nova style)
│   └── ...           # Feature components
├── db/               # Drizzle schema, migrations, seed scripts
├── lib/              # Shared utilities (auth, env, formatters)
├── hooks/            # React hooks
├── config/           # App and module configuration
└── types/            # Shared TypeScript types
```

> Note: the repository documentation, README, and code comments are in English.
> The application UI itself is in Indonesian.

## Roadmap

- [x] Project skeleton (Next.js 16 + TypeScript + Tailwind v4 + shadcn/ui + Drizzle)
- [x] App shell (auth, navigation, multi-company switcher)
- [x] HRM track (attendance, payroll with PPh 21 TER + BPJS, leave, 360 feedback, LMS, recruitment)
- [x] CRM + Projects track (pipeline, kanban, gantt, timesheet, quotations)
- [x] Finance track (double-entry ledger, invoicing with PPN, AR/AP, budgeting, fixed assets, POS)
- [x] Collaboration track (chat, cloud drive, forms, WhatsApp seam, AI assistant seam, 360 reports)
- [ ] WhatsApp Baileys socket wiring (outbox contract + worker seam ready)
- [ ] Jitsi Meet embed (self-host)
- [ ] Production WhatsApp session + public AI gateway URL

## Contributing

Contributions are welcome. See [CONTRIBUTING.md](./CONTRIBUTING.md) for setup,
commit conventions, and the pull request checklist.

## License

Released under the [MIT License](./LICENSE).
