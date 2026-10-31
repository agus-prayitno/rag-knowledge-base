# Fastify RAG migration record

Status: implemented for local Kubernetes use.

This document records the completed migration from the former Supabase-based application to a Fastify, PostgreSQL/pgvector, React, and Kubernetes deployment. It is also the checklist for production-oriented follow-up work.

## Scope and architecture

The application is a TypeScript npm-workspace monorepo with three modules:

```text
apps/api/         Fastify routes, PostgreSQL repository, Gemini adapters, MCP
apps/ui/          React/Vite UI and browser SSE client
packages/domain/  Shared runtime-neutral contracts and pure rules
```

The API and UI depend only on `@rag/domain`; they do not import each other. One Node.js container serves the compiled React UI, Fastify REST API, chat SSE stream, and MCP endpoint.

PostgreSQL with pgvector stores document metadata and chunks. Gemini remains an external provider: `gemini-embedding-2` produces 1536-dimensional embeddings and the configured generation model streams chat answers. Documents are registered as Markdown or text, then may be searched, tagged, and deleted. Existing Supabase data and vectors are not migrated; documents are re-registered into PostgreSQL.

## Completed implementation

- Replaced Supabase runtime paths with Fastify, `pg`, and parameterized PostgreSQL queries.
- Added idempotent pgvector schema creation in `migrations/001_rag.sql`.
- Added deterministic document and chunk identity, path/tag normalization, chunking, batch ingestion, replacement transactions, retrieval, tags, and deletion.
- Added same-origin `/api/rag/*` endpoints plus the existing four MCP tool names: `search_knowledge_base`, `ingest_document`, `set_document_tag`, and `delete_document`.
- Added SSE event streaming with `sources`, `token`, `notice`, `error`, and `done` events, heartbeat comments, backpressure handling, disconnect cancellation, CRLF-safe provider parsing, and extractive fallback before the first generated token.
- Added strict REST body validation and strict MCP tool argument schemas.
- Added process liveness at `/health` and PostgreSQL-backed readiness at `/ready`. Liveness remains available during a database outage; readiness removes an unhealthy Pod from traffic.
- Added graceful SIGTERM/SIGINT shutdown through Fastify close handling.
- Added a multi-stage Docker image that builds all workspaces and installs only production dependencies in the runtime stage.
- Added Kustomize Deployment, Service, Ingress, ServiceAccount, NetworkPolicy, ConfigMap, and separate migration Job manifests. The migration Job shares the Deployment image selection and non-root security posture.
- Removed application use of Supabase and legacy split client/server deployment paths.

## Quality gates and validation

Run these commands from the repository root:

```sh
npm run typecheck
npm run lint
npm test
npm run test:coverage
npm run build
npm run verify
```

Vitest enforces 80% statements, lines, and functions and 70% branches across application source. ESLint prevents API-to-UI, UI-to-API, and runtime-specific domain imports.

Unit, API, UI, streaming, MCP, migration, and runtime lifecycle tests are part of the normal suite. The opt-in pgvector test creates a unique disposable database, applies the schema, and drops it during teardown. It requires `RAG_TEST_ADMIN_URL` with create/drop database privileges:

```sh
export RAG_TEST_ADMIN_URL='postgresql://admin_user:encoded_password@192.168.0.27:5432/postgres'
npm test -- apps/api/src/repository.integration.test.ts
```

The local integration suite has passed against the local PostgreSQL instance. It covers replacement, vector search, tags, transaction rollback, and dimension mismatch handling.

## Container and Kubernetes workflow

Build the image from the repository root:

```sh
docker build -f docker/Dockerfile -t rag-app:local .
```

For an independent image-start smoke test, use an invalid database URL and check only liveness. For UI and readiness smoke tests, use a reachable migrated database; a Docker container must not use `localhost` to reach a host database. Details are in `docker/README.md`.

The local overlay deploys into namespace `app` with image `rag-app:local`. It expects the image to be present in the Colima node runtime and references the existing `rag-app-secrets` Secret for `DATABASE_URL` and `GEMINI_API_KEY`. PostgreSQL is reached through `postgresql-rw.pgsql.svc.cluster.local:5432`. TLS is terminated by the installed NGINX Ingress controller using `rag-app-tls` for `rag.localhost`.

Render before applying:

```sh
kubectl kustomize k8s/overlays/local
kubectl kustomize k8s/migrations
```

Run the migration Job only when schema SQL changes. For normal UI, API, or provider configuration changes, rebuild the image and restart the Deployment. If an old `rag-migrations` Job exists, delete the Job before creating a replacement because Kubernetes Job Pod templates are immutable.

## Remaining follow-up work

- Add authentication and authorization before exposing the service outside local use.
- Publish images to a registry with immutable version tags or digests instead of `rag-app:local`.
- Add migration-history tracking if schema changes become frequent; the current runner safely reruns idempotent SQL but does not record applied versions.
- Enable PostgreSQL TLS certificate verification and establish production certificate/secret management.
- Perform server-side Kubernetes validation and rollout checks from a terminal that can access the Colima API server.

