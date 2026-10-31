# RAG Knowledge Base

A self-hosted Retrieval-Augmented Generation (RAG) knowledge base for Markdown and plain-text documents. It indexes documents in PostgreSQL with pgvector, retrieves relevant excerpts, and streams grounded Gemini answers to a React UI over Server-Sent Events (SSE).

The application is designed for local Kubernetes development. One Node.js container serves the UI, API, SSE stream, and MCP endpoint.

## Features

- Upload `.md`, `.markdown`, `.txt`, and `.text` documents in batches.
- Deterministic document identity, chunking, embeddings, and repeatable replacement.
- Semantic retrieval using PostgreSQL pgvector cosine similarity search.
- Tag, filter, and delete indexed documents.
- Progressive Gemini answers with sources, fallback excerpts, and explicit stream errors.
- MCP tools for search, ingest, tag updates, and deletion.
- Fastify liveness (`/health`) and database-backed readiness (`/ready`) probes.
- Docker and Kustomize manifests for a non-root Kubernetes deployment.

## Architecture

```text
Browser
  │  same-origin REST and POST/SSE
  ▼
Fastify API ────────► PostgreSQL + pgvector
  │                          ▲
  ├── serves React UI        │ document metadata and chunks
  ├── exposes MCP            │
  └── streams Gemini answers ┘
```

The npm workspaces have a one-way dependency structure:

| Workspace | Responsibility |
| --- | --- |
| `apps/api` | Fastify routes, PostgreSQL repository, Gemini adapters, SSE, MCP |
| `apps/ui` | React/Vite UI and browser SSE client |
| `packages/domain` | Runtime-neutral contracts, errors, chunking, path identity, tag rules |

Both applications may import `@rag/domain`; neither imports the other.

## Prerequisites

- Node.js 22.14 or later and npm.
- PostgreSQL with the `vector` extension available. The current schema uses 1536-dimensional vectors.
- A Gemini API key for embeddings. A key is optional only when exercising the extractive fallback path.
- Docker/Colima for the container workflow.
- A local Kubernetes cluster with an NGINX Ingress controller for the supplied local overlay.

The application does not load `.env` automatically. Export runtime variables in your shell or inject them through Docker/Kubernetes secrets. Never commit credentials, certificates, or connection strings containing passwords.

## Quick start: local Node.js process

Install dependencies from the repository root:

```sh
npm ci
```

Set the required runtime values. Passwords in `DATABASE_URL` must be percent-encoded.

```sh
export DATABASE_URL='postgresql://user:encoded-password@192.168.0.27:5432/rag'
export GEMINI_API_KEY='your-gemini-api-key'
export GEMINI_GENERATION_MODEL='gemini-3.5-flash-lite' # optional
```

Apply the schema once for a new database, then build and run the application:

```sh
npm run build
npm run migrate
npm start
```

Open <http://localhost:3000>. For UI-only development, run `npm run dev -w @rag/ui` separately. The Vite server does not define an API proxy, so use the Fastify server for same-origin API behavior.

## Configuration

| Variable | Required | Purpose |
| --- | --- | --- |
| `DATABASE_URL` | Yes | PostgreSQL URL: `postgresql://user:encoded-password@host:5432/database` |
| `GEMINI_API_KEY` | Yes for embeddings/generation | Server-side Gemini credential |
| `GEMINI_GENERATION_MODEL` | No | Generation model; defaults to `gemini-3.5-flash-lite` |
| `JIRA_BASE_URL` | No | Public HTTPS Jira browse URL; ticket links are disabled when absent or invalid |
| `DATABASE_SSL` | No | Set to `false` to disable PostgreSQL TLS; otherwise TLS is enabled |
| `PORT` | No | HTTP port; defaults to `3000` |
| `RAG_TEST_ADMIN_URL` | Integration tests only | PostgreSQL administrator URL with disposable-database privileges |

`DATABASE_HOST`, `DATABASE_USER`, `DATABASE_PASSWORD`, `DATABASE_PORT`, and `DATABASE_NAME` are also supported as a legacy alternative to `DATABASE_URL`. Prefer one complete `DATABASE_URL` in deployments.

## HTTP and MCP interfaces

The UI uses same-origin `/api/rag/*` calls.

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/health` | Process liveness; remains OK during database outages |
| `GET` | `/ready` | Readiness; checks database availability |
| `GET` | `/api/rag/health` | API status and embedding-key presence |
| `GET` | `/api/rag/config` | Public browser configuration, including optional Jira browse URL |
| `GET` | `/api/rag/documents` | Indexed document list |
| `POST` | `/api/rag/ingest` | Batch document registration |
| `POST` | `/api/rag/tag` | Set or clear a document tag |
| `POST` | `/api/rag/delete` | Delete a document and all chunks |
| `POST` | `/api/rag/chat` | SSE response containing sources and answer tokens |
| `POST` | `/mcp` | JSON-RPC MCP endpoint |

The chat endpoint sends `sources`, `token`, `notice`, `error`, and `done` SSE events. When Gemini fails before producing a token, the service reports a notice and returns the retrieved excerpts as an extractive fallback.

## Development and quality checks

| Command | Purpose |
| --- | --- |
| `npm run typecheck` | TypeScript project-reference check |
| `npm run lint` | ESLint, including workspace import boundaries |
| `npm test` | Unit, API, UI, streaming, MCP, and migration tests |
| `npm run test:coverage` | Tests with combined V8 coverage reports |
| `npm run build` | Build domain, API, then UI |
| `npm run verify` | Typecheck, lint, tests, coverage, and build |

Coverage thresholds are 80% for statements, lines, and functions, plus 70% for branches across application source.

### PostgreSQL integration test

The integration suite creates a uniquely named temporary database, applies the pgvector migration, and deletes the database during teardown. Use a privileged test-only role; do not point this variable at the application database.

```sh
export RAG_TEST_ADMIN_URL='postgresql://admin_user:encoded-password@192.168.0.27:5432/postgres'
npm test -- apps/api/src/repository.integration.test.ts
```

The role needs permission to create and drop databases. Installing the `vector` extension may require a PostgreSQL administrator to provision the extension first.

## Docker

Build from the repository root:

```sh
docker build -f docker/Dockerfile -t rag-app:local .
```

The final image contains compiled artifacts and production dependencies only, runs as the non-root `node` user, and listens on port 3000.

An image-start smoke test can use an invalid database URL and check only liveness:

```sh
docker run --rm -d --name rag-app-smoke -p 3001:3000 \
  -e DATABASE_URL='postgresql://invalid:invalid@127.0.0.1:1/invalid' \
  rag-app:local
curl -fsS http://localhost:3001/health
docker stop rag-app-smoke
```

To test readiness and the UI, provide a migrated database URL reachable from the container. Use `192.168.0.27` or another routable address for a host database; `localhost` inside the container refers to the container itself.

```sh
export SMOKE_DATABASE_URL='postgresql://user:encoded-password@192.168.0.27:5432/rag'
docker run --rm -d --name rag-app-smoke -p 3001:3000 \
  -e DATABASE_URL="$SMOKE_DATABASE_URL" \
  -e GEMINI_API_KEY="$GEMINI_API_KEY" \
  rag-app:local
curl -fsS http://localhost:3001/ready
curl -fsS http://localhost:3001/ | grep -q '<div id="root">'
docker stop rag-app-smoke
```

## Kubernetes deployment

The local Kustomize overlay deploys to namespace `app`, exposes `https://rag.localhost`, and expects:

- An installed NGINX Ingress controller.
- PostgreSQL at `postgresql-rw.pgsql.svc.cluster.local:5432`.
- A `rag-app-secrets` Secret containing `DATABASE_URL` and `GEMINI_API_KEY`.
- A `rag-app-tls` TLS Secret for `rag.localhost`.
- The `rag-app:local` image available to the Colima node runtime.

Create or update the application Secret without storing values in a manifest:

```sh
kubectl create namespace app --dry-run=client -o yaml | kubectl apply -f -
kubectl -n app create secret generic rag-app-secrets \
  --from-literal=DATABASE_URL="$DATABASE_URL" \
  --from-literal=GEMINI_API_KEY="$GEMINI_API_KEY" \
  --dry-run=client -o yaml | kubectl apply -f -
```

Create the TLS Secret from a certificate whose Subject Alternative Name includes `rag.localhost`:

```sh
kubectl -n app create secret tls rag-app-tls \
  --cert=rag.localhost.crt \
  --key=rag.localhost.key \
  --dry-run=client -o yaml | kubectl apply -f -
```

Render manifests before applying:

```sh
kubectl kustomize k8s/overlays/local
kubectl kustomize k8s/migrations
```

For an initial deployment or a schema change, run the migration Job before rolling out the app. A completed Job must be deleted before recreating it because Job Pod templates are immutable.

```sh
kubectl delete job rag-migrations -n app --ignore-not-found
kubectl apply -k k8s/migrations
kubectl wait --for=condition=complete job/rag-migrations -n app --timeout=120s
kubectl apply -k k8s/overlays/local
kubectl rollout status deployment/rag-app -n app --timeout=120s
```

For application-only changes with no schema migration:

```sh
docker build -f docker/Dockerfile -t rag-app:local .
kubectl rollout restart deployment/rag-app -n app
kubectl rollout status deployment/rag-app -n app --timeout=120s
```

Check rollout issues with:

```sh
kubectl get pods -n app
kubectl describe pod -n app -l app=rag-app
kubectl logs -n app deployment/rag-app
```

## Security and operational notes

- Credentials remain in Kubernetes Secrets and local environment variables; they are not committed to Git.
- Pods run as numeric UID/GID `1000`, with a read-only root filesystem, dropped Linux capabilities, disabled privilege escalation, RuntimeDefault seccomp, and no mounted ServiceAccount token.
- The NetworkPolicy permits only DNS, PostgreSQL, and HTTPS egress required for Gemini.
- The local deployment has no authentication or authorization. Do not expose it publicly without adding both.
- The current PostgreSQL TLS configuration does not verify the server certificate. Treat verified database TLS and production certificate management as required production hardening.
- SQL migrations are idempotent but do not yet maintain a migration-history table. Run the migration Job only when schema SQL changes.

## Documentation

- [Docker details](docker/README.md)
- [Kubernetes configuration](k8s/README.md)

