# Kubernetes configuration

The application connects to the PostgreSQL read/write Service at `{service}.{namespace}.svc.cluster.local:5432`. For integration tests, export `RAG_TEST_ADMIN_URL` with a role that has `CREATEDB`; the test creates and deletes a unique temporary database.

The local overlay exposes `https://rag.localhost` through the installed NGINX Ingress controller. Create the `rag-app-tls` TLS Secret in the `app` namespace with a certificate for `rag.localhost` before applying the overlay.

`k8s/base/configmap.yaml` contains only application-invariant values. The local overlay adds the PostgreSQL Service endpoint, `GEMINI_GENERATION_MODEL`, and `JIRA_BASE_URL` through `configmap-patch.yaml`; change those values in the overlay for a different environment.

Create `rag-app-secrets` in the deployment namespace before applying the overlay. It must contain `DATABASE_URL` and `GEMINI_API_KEY`; never commit their values. `DATABASE_URL` has the form `postgresql://user:encoded-password@postgresql-rw.pgsql.svc.cluster.local:5432/database`.
