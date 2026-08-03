# CineSchedule

CineSchedule is a backend API for tracking upcoming movie and television release dates. Users can maintain personal watchlists and query a unified calendar of theatrical, digital, streaming, and episode releases.

The project is designed around a practical data problem: release information changes over time and arrives from an external source, so the application has to keep local data current without making every user request depend on TMDB.

## Features

- User registration and login with JWT authentication
- Protected watchlist routes
- TMDB title search and detail ingestion
- Personal watchlist management
- Unified calendar across release events and episodes
- Cursor-based pagination
- Nightly TMDB refresh with bounded concurrency
- Request validation with Zod
- PostgreSQL persistence through Prisma
- Automated tests and GitHub Actions CI/CD
- Docker-based local and production workflows

## Architecture

```text
Client
  |
Express API
  |-- authentication and validation
  |-- titles and watchlists
  |-- calendar queries
  |
PostgreSQL / Prisma
  ^
  |
Nightly refresh service <---- TMDB API
```

The API stores the title and release data needed by the product, then refreshes tracked titles in the background. This separates interactive requests from external synchronization and keeps calendar queries fast and predictable.

## Tech stack

- TypeScript
- Node.js and Express
- PostgreSQL and Prisma
- Zod
- JWT authentication
- TMDB API
- Docker and Docker Compose
- GitHub Actions
- Render

## Frontend

The Next.js client lives in a separate repository:

[github.com/jackcritzer/cineschedule-web](https://github.com/jackcritzer/cineschedule-web)

## Local development

### Requirements

- Node.js 20+
- Docker and Docker Compose
- TMDB API key

### Setup

```bash
git clone https://github.com/jackcritzer/cineschedule.git
cd cineschedule
npm install
docker compose up -d
npm run migrate
```

Create a `.env` file:

```env
DATABASE_URL=postgresql://user:password@localhost:5432/cineschedule
JWT_SECRET=your-secret
TMDB_API_KEY=your-tmdb-key
CRON_SCHEDULE=0 0 * * *
CORS_ORIGIN=http://localhost:3001
```

Start the API using the scripts defined in `package.json`.

## Main API areas

- `/auth` — registration and login
- `/search` — TMDB-backed title search
- `/watchlist` — authenticated watchlist management
- `/calendar` — upcoming release and episode queries
- `/health` — service health check

## Background refresh

A scheduled job refreshes stored title data from TMDB each night. The refresh limits concurrent requests so it can process multiple titles efficiently without sending an uncontrolled burst to the external API.

## Deployment

1. Changes pushed to `main` run through GitHub Actions.
2. The application is built as a Docker image.
3. Render deploys the service and PostgreSQL database.
4. Database migrations run during startup.
5. The scheduled refresh runs within the deployed service.

## Smoke checks

```bash
curl https://www.cineschedule.com/health
```

Authenticated routes can then be exercised by registering, logging in, and sending the returned bearer token to the watchlist and calendar endpoints.

## Engineering focus

CineSchedule demonstrates API design, relational data modeling, external-service integration, background synchronization, authentication, pagination, deployment, and testing in a production-style TypeScript backend.

## License

MIT
