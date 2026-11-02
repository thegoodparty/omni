# `src/observability/`

Cross-cutting observability concerns. Most of the OTel wiring lives in `src/otel.ts` (top-level) — this directory holds the application-level integrations.

- `logging/` — Pino setup, custom serializers, and the `LoggerExceptionFilter`
- `grafana/` — Grafana-specific helpers (deeplinks, dashboard config refs)
- `blockedState/` — `BlockedStateInterceptor` that records user-blocking failures to New Relic and OTel
- `pyroscope.ts` — continuous CPU (wall time with CPU time) and heap-allocation profiling to Grafana Cloud Profiles (`grafanacloud-profiles`), started from `otel.ts` when `PYROSCOPE_ENABLED=true`. It authenticates with the same Grafana Cloud token as the OTLP export, so that token's access policy needs `profiles:write`. Profiles carry `service_name=gp-api`, `deployment_environment_name` and `service_instance_id`, so one task's flame graph for a given minute is a label filter away. Node.js has no span-to-profile linking in Pyroscope.

For alert configuration (provisioned via Pulumi) see `docs/observability.md` and `deploy/components/alerts.ts`.
