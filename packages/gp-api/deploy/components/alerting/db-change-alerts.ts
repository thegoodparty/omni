import { Alert } from './alerts.types'

const STREAM = '{service_name="gp-api", deployment_environment_name="$ENV"}'

/**
 * The change pipeline's own health, from the lines DbChangeHealthService logs
 * on the `dbChangeHealth` schedule (src/dbChanges/dbChangeHealth.service.ts).
 *
 * WHY A RULE OF ITS OWN, when the relay already warns about a backlog and a
 * dead-lettered job already pages. Both of those watch the rows that made it
 * INTO the outbox. A trigger that is missing, disabled, or on a table no
 * handler reads any more writes nothing at all, and a kill switch left off
 * writes nothing either — every downstream signal is silent, because nothing
 * upstream happened. That is the failure this rule exists for, and it is
 * silent by construction rather than by omission.
 *
 * One line per broken invariant per run, so a reader searching the message
 * finds which invariant, and the count tells them whether it is one table or
 * every one. The outbox line also carries `unsent` and `oldestUnsentSeconds`.
 *
 * Dead letters are NOT here: a change job that fails every attempt is the
 * `jobs-dead-letter` rule like any other job (job-alerts.ts).
 */
export const dbChangeAlerts: Alert[] = [
  {
    slug: 'db-change-health-check-failed',
    name: 'Database change capture is not working',
    type: 'log',
    // Every line this context logs at error is one invariant failing, and the
    // check runs every five minutes, so a broken one logs twelve lines an hour
    // until someone fixes it. The `detected_level` filter is what keeps a
    // future info or warn line from this context from paging.
    expr: [
      'sum(count_over_time(',
      STREAM,
      '|= "db change" | context = "DbChangeHealthService"',
      '| detected_level = "error"',
      '[1m])) or vector(0)',
    ].join(' '),
    threshold: 0,
    // An event rule: see EVENT RULES above GLOBAL_ALERTS.
    for: '0m',
    timeRangeSeconds: 60,
    timeRangeOffsetSeconds: 30,
    // The check runs every five minutes, so a window the line misses by a few
    // seconds must not resolve an invariant that is still broken. Half an hour
    // also covers a deploy dropping a run or two.
    keepFiringFor: '30m',
    message: [
      'The database change pipeline is not working, in the 60 seconds ending 30 seconds before this check. A write this repo expects to reach a handler is not reaching it, and nothing else pages for it: a trigger that is absent, disabled or on a table no handler reads, a kill switch that is off, a missing relay row, or an outbox that has stopped draining.',
      'Click *View in Grafana* and search "db change" with `context = "DbChangeHealthService"`. Each line is one broken invariant, and the ones that can name a table do: `db change capture trigger missing, disabled or duplicated` (the registry wants exactly one ENABLED `<table>_db_change_<op>` per operation, so compare `capturedTables()` in src/jobs/changes.registry.ts with `pg_trigger.tgenabled`), `db change capture trigger nothing reads` (a stale or extra trigger: run `npm run migrate:db-change-triggers -w packages/gp-api` and deploy), `db change capture is off: db_change_config row 1 is missing` or `db change capture is off: db_change_config row 1 is disabled` (the kill switch — `UPDATE db_change_config SET enabled = true WHERE id = 1` turns it back on), `db change relay is off: db_change_relay row 1 is missing` (nothing relays the outbox; re-insert the row the migration seeds), `db change outbox is not draining` (its `unsent` count and `oldestUnsentSeconds` say how far behind the relay is).',
      'Writes made while capture was down were never recorded, so nothing will replay them: the handlers missed them. Once the cause is fixed, check `db_change_gap` for the flips and skips that were recorded, and re-sync affected rows by hand. Re-syncing is safe because a change handler reads the row as it is now (src/jobs/AGENTS.md § Change handlers).',
    ].join('\n\n'),
  },
]
