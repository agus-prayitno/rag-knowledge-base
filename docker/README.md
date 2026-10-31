# Container

Build from the repository root: `docker build -f docker/Dockerfile -t rag-app:local .`.
The final stage contains compiled application artifacts and production dependencies only.

Run with `DATABASE_URL` and `GEMINI_API_KEY`; apply migrations first with the same image using `node apps/api/dist/migrate.js`.

Smoke-check the independent liveness probe without requiring PostgreSQL:

```sh
docker run --rm -d --name rag-app-smoke -p 3001:3000 \
  -e DATABASE_URL='postgresql://invalid:invalid@127.0.0.1:1/invalid' \
  rag-app:local
curl -fsS http://localhost:3001/health
docker stop rag-app-smoke
```

To smoke-check the rendered UI, provide a reachable, migrated PostgreSQL URL. From a Docker container, do not use `localhost` for a database that runs on the host; use the reachable address such as `192.168.0.27`.

```sh
export SMOKE_DATABASE_URL='postgresql://user:encoded-password@192.168.0.27:5432/database'
docker run --rm -d --name rag-app-smoke -p 3001:3000 \
  -e DATABASE_URL="$SMOKE_DATABASE_URL" \
  -e GEMINI_API_KEY="$GEMINI_API_KEY" \
  rag-app:local
curl -fsS http://localhost:3001/ready
curl -fsS http://localhost:3001/ | grep -q '<div id="root">'
docker stop rag-app-smoke
```
