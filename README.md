# 🎬 CineSchedule

CineSchedule is a backend API that tracks upcoming release dates for movies and TV shows.  
Users can add titles to a personal watchlist and view a merged calendar of upcoming theatrical, digital, and streaming events.

---

## 🚀 Tech Stack
- **Backend**: Node.js + Express (TypeScript)
- **Database**: PostgreSQL (via Prisma ORM)
- **Auth**: JWT (access token only)
- **Infrastructure**: Docker + docker-compose
- **Background jobs**: `node-cron` (nightly TMDB refresh)
- **Deployment**: Render (Web Service + Postgres)
- **External API**: [TMDB](https://www.themoviedb.org/documentation/api)

---

## ⚡ Features
- User registration & login (JWT authentication middleware)
- Add TMDB titles to a personal watchlist
- Query watchlist items
- Calendar endpoint merging release events & episodes
- Nightly background job refreshing release data from TMDB
- Render CI/CD pipeline with image builds & deploys
- Custom domain: [https://www.cineschedule.com](https://www.cineschedule.com) (SSL enabled)

---

## 🛠️ Local Development

### Prerequisites
- Node.js 20+
- Docker & Docker Compose
- TMDB API key

### Setup
```bash
# Clone the repo
git clone https://github.com/cineschedule/cineschedule.git
cd cineschedule

# Install dependencies
npm install

# Start services
docker compose up -d

# Run database migrations
npm run migrate
```

### Environment Variables
Create a `.env` file (or use Render Dashboard). Required variables:

```env
DATABASE_URL=postgresql://user:password@localhost:5432/cineschedule
JWT_SECRET=your-secret
TMDB_API_KEY=your-tmdb-key
CRON_SCHEDULE=0 0 * * *   # nightly refresh at midnight UTC
CORS_ORIGIN=https://www.cineschedule.com
```

---

## 🔄 Background Jobs
A nightly cron job runs `refreshNightly` to sync data from TMDB.  
To test locally, you can temporarily set a fast schedule (e.g. `*/10 * * * * *` for every 10 seconds).

---

## 📦 Deployment

1. Push to `main` → GitHub Actions builds & pushes Docker image to GHCR.  
2. Render Web Service pulls the image and deploys automatically.  
3. Database migrations are applied on startup.  
4. Nightly job runs inside the Render service.

---

## 🔒 Security
- JWT auth for protected routes
- Configurable CORS via `CORS_ORIGIN`
- Planned: secret rotation for JWTs

---

## ✅ Smoke Tests
After deploy, verify the following endpoints:

```bash
# Health check
curl https://www.cineschedule.com/health

# Register
curl -X POST https://www.cineschedule.com/auth/register   -H "Content-Type: application/json"   -d '{"email":"test@example.com","password":"password"}'

# Login
curl -X POST https://www.cineschedule.com/auth/login   -H "Content-Type: application/json"   -d '{"email":"test@example.com","password":"password"}'

# Watchlist
curl -H "Authorization: Bearer <token>" https://www.cineschedule.com/watchlist

# Calendar
curl -H "Authorization: Bearer <token>" https://www.cineschedule.com/calendar
```

---

## 📖 License
MIT
