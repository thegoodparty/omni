# alert-filter

Sits between Grafana and Slack. Every alert Grafana sends reaches a human; this
decides **which channel** and **whether it pings**.

## If alerts look wrong, read this first

**To restore plain unfiltered alerting, immediately, from the Grafana UI:**
repoint the notification policy from the `gpbot-alert-filter` contact point back
to the plain Slack contact point. Alerts resume exactly as they behaved before
this existed. This is always safe, needs no deploy, and is the correct first
move for any suspected filter problem — diagnose afterwards.

## The four outcomes

| Outcome | Filtered channel | Pings | When |
|---|---|---|---|
| `URGENT` | yes, prefixed `:rotating_light: *URGENT*`, mirrored to `#bot-urgent` | yes | the model judged it urgent, or the alert is labelled urgent |
| `NOTIFY` | yes | no | default — nothing confirmed a known cause |
| `ANNOTATE` | yes, with the known cause named | no | a known cause was confirmed and it is one we still want to see |
| `SUPPRESS` | no | no | a known cause was confirmed and it is one we have decided not to show |

`SUPPRESS` is the only outcome that removes something from the filtered channel,
and even then the alert is posted in full to `#dev-alerts-raw`, with a threaded
reply saying which cause matched and why. **There is no outcome in which an
alert Grafana delivered reaches nobody.** That invariant is what makes the rest
of this safe to run, and it is worth preserving over any feature.

## Shadow mode

Ships in `shadow`: the filtered channel behaves exactly as it does today,
mentions and all, while the raw channel's threads and the `GPALERT_METRIC` log
lines record what the filter *would* have done. The suppress list is a decision
about what nobody gets told, so it should be reviewed against a week of real
firings before it takes effect.

Flip with `mode = "enforce"` in
`infrastructure/environments/prod/alert-filter/main.tf`.

## Adding a known cause

Known causes live next to the alert they explain, in
`gp-api/deploy/components/alerts.ts`, and are serialised into a `known_causes`
annotation at provision time — so the filter reads the registry out of the
notification itself and never needs its own copy.

```ts
knownCauses: [
  {
    id: 'people-db-statement-timeout',
    summary: 'The people DB statement timed out on a district too large for the current query plan.',
    evidence: '{service_name="gp-api", deployment_environment_name="$ENV"} |= "DoorKnockingPackBuildFailed" | json | elapsedMs > 25000',
    confirmedBy: 'the log line shows elapsedMs above 25000 and a districtId',
    action: 'suppress',
    ticket: 'https://app.clickup.com/t/...',
  },
]
```

- `evidence` is the LogQL that would show the cause if it were the cause. `$ENV`
  is substituted with the firing environment. **Narrow it** — a query matching
  every line in the service confirms nothing.
- `confirmedBy` is the condition a reader could check by eye against those log
  lines. The model is asked whether it holds, not whether the cause "seems
  right", so vague wording here produces vague suppression.
- `action: 'suppress'` requires `evidence`; the tests enforce it. Suppressing on
  a hunch is the one failure this design cannot recover from.
- `ticket` is where the real fix is tracked. A suppressed cause without one is a
  bug being hidden rather than deferred, and the weekly digest calls those out
  by name.

## Where things are

| | |
|---|---|
| Decision logic (pure, no I/O) | `classify.py`, `payload.py`, `render.py`, `metrics.py` |
| Loki evidence | `evidence.py` |
| Model call | `classifier.py` |
| Orchestration | `lambda/handler.py` |
| Infrastructure | `../infrastructure/modules/alert-filter/` |
| Registry + contact point | `gp-api/deploy/components/alerts.ts`, `.../grafana.ts` |
| Logs | `/aws/lambda/alert-filter-prod` |
| Weekly summary | `clickup_bot/weekly_digest.py`, from `GPALERT_METRIC` lines |

## Things that will look like bugs

**An alert appears in `#dev-alerts-raw` but not `#dev-alerts`.** Working as
intended — read the threaded reply for the cause that matched.

**Everything is `NOTIFY` and nothing is suppressed.** Usually the evidence
gather is failing: no Loki credentials, or a query erroring. A decision made
without evidence deliberately degrades to `NOTIFY` rather than guessing. Check
the log group.

**`alert-filter-no-deliveries` fired.** Either genuinely nothing alerted for two
weeks, or Grafana is no longer routing here. Check `#dev-alerts-raw` for traffic
— if it has some, the routing is fine and the alarm is wrong. The second case is
the dangerous one because it looks exactly like the filter working perfectly.
