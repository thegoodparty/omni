# `src/observability/`

Cross-cutting observability concerns. Most of the OTel wiring lives in `src/otel.ts` (top-level) — this directory holds the application-level integrations.

- `logging/` — Pino setup, custom serializers, and the `LoggerExceptionFilter`
- `grafana/` — Grafana-specific helpers (deeplinks, dashboard config refs)
- `blockedState/` — `BlockedStateInterceptor` that records user-blocking failures to New Relic and OTel
- `stallProfiler/` — `StallProfilerService`, on when `STALL_PROFILER_ENABLED=true`: samples the main thread's CPU profile in 30s windows (10ms interval) and, for any window whose event loop stalled over 1.5s, logs `event loop stall profile` with GC time and the top self-time frames and stacks. Find them with `{service_name="gp-api"} |= "event loop stall profile"`. Temporary; remove once stalls are explained.

For alert configuration (provisioned via Pulumi) see `docs/observability.md` and `deploy/components/alerts.ts`.
