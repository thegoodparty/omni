# callhubBigquery

Read-only BigQuery foundation for pulling CallHub voice-broadcast **results**
ourselves. CallHub's voice API cannot return per-campaign connected-call
dispositions; CallHub instead exports call data to a BigQuery dataset and grants
our service account read access. If that data carries per-campaign connected
dispositions, we stay on CallHub and bill on actual connected calls (hold +
capture-actual).

**Verify-first status.** This module ships **inert**: it is NOT imported by
`OutreachModule` or any billing/completion path, and its config is asserted at
use, so a missing env never affects boot. We have not yet seen CallHub's schema
or confirmed access. Everything here is schema-INDEPENDENT infrastructure plus a
discovery probe. The schema-dependent results reader is a deliberate stub.

## Key files

| File | Role |
|------|------|
| `callhubBigquery.module.ts` | Registers/exports the services; imported nowhere yet (inert) |
| `config/callhubBigqueryConfig.ts` | Lazy, asserted-at-use project/dataset + credentials; pure readers reused by the probe |
| `errors/bigqueryPermanentError.ts` | `BigqueryPermanentError extends BadGatewayException` — the permanent-vs-transient signal |
| `services/bigqueryErrorHandling.service.ts` | `isPermanentBigqueryError` + `handleQueryError` — maps failures to a 502 family |
| `services/callhubBigqueryClient.service.ts` | Lazy `BigQuery` client + one read-only parameterized `query<T>()`; bounded transient retry |
| `services/callhubBigqueryResults.service.ts` | **STUB** `getConnectedCount()` — throws; blocked on the confirmed schema |
| `scripts/redactRow.ts` | Pure phone/contact-column redaction used by the probe |
| `scripts/probeBigquery.ts` | Standalone read-only discovery probe (run via `tsx`) |

## Config (env)

| Var | Meaning |
|-----|---------|
| `CALLHUB_BQ_PROJECT_ID` | GCP project that holds CallHub's dataset (unknown until CallHub tells us) |
| `CALLHUB_BQ_DATASET` | The dataset name (unknown until we probe) |
| `GOOGLE_APPLICATION_CREDENTIALS` | Standard ADC: path to the SA key JSON. **Preferred** when set |
| `CALLHUB_BQ_SA_KEY_JSON` | Fallback: the SA key JSON as a single string (our secrets blob) |

All read-only. The service account needs **BigQuery Job User** in the billing
project and **BigQuery Data Viewer** on CallHub's dataset (the latter granted by
CallHub). Never commit a real key.

## Error taxonomy

`query()` classifies failures and maps both to a 502 family so callers can
branch:

- **Permanent** (`BigqueryPermanentError`): 400 (bad SQL / invalid), 401 / 403
  (auth / access not granted), 404 (dataset or table not found). Never retried.
- **Transient** (plain `BadGatewayException`): 429, 5xx, network errno. Retried
  a bounded number of times — safe because reads have no side effect.

## Running the probe

Once CallHub grants access, from `packages/gp-api`:

```bash
CALLHUB_BQ_PROJECT_ID=<callhub-project> \
CALLHUB_BQ_DATASET=<dataset> \
GOOGLE_APPLICATION_CREDENTIALS=/abs/path/to/key.json \
  npx tsx src/vendors/callhubBigquery/scripts/probeBigquery.ts
```

`--project`, `--dataset`, `--table` CLI args override the env; `--table` inspects
one table. It lists datasets/tables, prints each table's columns + row count, and
prints up to 5 sample rows with phone/contact columns redacted. On a permission
error it prints a clear "access not granted yet" line, not a stack trace — so
it doubles as the check for whether CallHub's grant is live.

## Blocked on the confirmed schema

`getConnectedCount()` cannot be written until the probe confirms: the per-call
table, the campaign-id column (and whether it matches our `pk_str`), the
disposition/connected column + its "connected" value, and the timestamp column
bounding a run. **Money-safety contract for the real reader:** a missing /
ambiguous / null count MUST throw permanent — never return 0 (a wrong 0
under-bills). Also unconfirmed: whether query jobs bill to a separate project
(the config exposes one project id today).
