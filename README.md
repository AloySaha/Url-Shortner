# URL Shortener

A simple URL shortener built with Express, PostgreSQL, and Redis. Runs containerized with Docker Compose and uses Nginx as a reverse proxy.

## What This Project Is

This is a learning project focused on DevOps tooling. The main application code, frontend, and load tests were generated with AI. The actual work and learning is in the Docker setup: the Dockerfile, Docker Compose, Nginx configuration, and Redis configuration.

If you are looking at this to learn or review, focus on those files.

## Stack

- **Backend:** Node.js + Express
- **Database:** PostgreSQL
- **Cache:** Redis
- **Reverse Proxy:** Nginx
- **Containerization:** Docker + Docker Compose
- **Load Testing:** Node.js scripts + k6

## Project Structure

```
.
├── server.js           # Express app (AI generated)
├── public/             # Frontend files (AI generated)
├── Dockerfile          # Multi-stage build - the learning part
├── compose.yml         # Full stack orchestration - the learning part
├── nginx/              # Reverse proxy config - the learning part
│   └── default.conf
├── redis/              # Redis config - the learning part
│   └── redis.conf
├── load-tests/         # Load testing scripts (AI generated)
│   ├── node/
│   └── k6/
├── .env.example        # Environment variables template
└── package.json
```

## Quick Start

1. Copy the environment file and fill in your values:
   ```bash
   cp .env.example .env
   ```

2. Start everything with Docker Compose:
   ```bash
   docker compose up --d
   ```

3. Open `http://localhost` in your browser.

4. To stop and remove containers:
   ```bash
   docker compose down
   ```

   To also remove volumes (clears database and cache data):
   ```bash
   docker compose down -v
   ```

## Load Testing

Run the built-in load tests:

```bash
# Quick smoke test
npm run load:smoke

# All scenarios
npm run load:all
```

If you have k6 installed:

```bash
npm run load:k6:smoke
npm run load:k6:load
npm run load:k6:stress
npm run load:k6:spike
```

## API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/api/shorten` | Create a short URL |
| `GET` | `/api/stats/:code` | Get stats for a short URL |
| `GET` | `/api/health` | Health check |
| `GET` | `/:code` | Redirect to original URL |

### POST /api/shorten

```bash
curl -X POST http://localhost/api/shorten \
  -H "Content-Type: application/json" \
  -d '{"url": "https://example.com", "title": "Example Site"}'
```

Response:
```json
{
  "shortCode": "abc123",
  "shortUrl": "http://localhost/abc123"
}
```
