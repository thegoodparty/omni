Query Grafana Cloud for traces, metrics, and alert history via the API.

## Prerequisites

**Tools**: `curl`, `jq`, `aws` CLI (with SSM access)
**Access**: AWS SSM parameter `grafana-shared-service-account-token`

## Auth

```bash
TOKEN=$(AWS_PROFILE=work aws ssm get-parameter --name "grafana-shared-service-account-token" --with-decryption --query "Parameter.Value" --output text)
```

All commands below assume `$TOKEN` is set.

## Instance

| Component | Value |
|-----------|-------|
| Grafana | `https://goodparty.grafana.net` |
| OTLP gateway | `otlp-gateway-prod-us-east-3.grafana.net/otlp` |
| Cluster | prod-us-east-3 |

## Datasource UIDs

| UID | Type | Use |
|-----|------|-----|
| `grafanacloud-traces` | Tempo | Distributed traces |
| `grafanacloud-prom` | Prometheus | Metrics (histograms, counters, gauges) |
| `grafanacloud-logs` | Loki | Structured logs |

## Traces (Tempo)

### Search traces

```bash
# All services, last hour
curl -s -H "Authorization: Bearer $TOKEN" \
  "https://goodparty.grafana.net/api/datasources/proxy/uid/grafanacloud-traces/api/search?limit=20&start=$(date -v-1H +%s)&end=$(date +%s)" | jq .
```

### Filter by service

```bash
curl -s -H "Authorization: Bearer $TOKEN" \
  "https://goodparty.grafana.net/api/datasources/proxy/uid/grafanacloud-traces/api/search?q=%7Bresource.service.name%3D%22gp-api%22%7D&limit=20&start=$(date -v-1H +%s)&end=$(date +%s)" | jq .
```

Available services: `gp-api`, `election-api`, `people-api`

### Filter by environment

```bash
# prod only
curl -s -H "Authorization: Bearer $TOKEN" \
  "https://goodparty.grafana.net/api/datasources/proxy/uid/grafanacloud-traces/api/search?q=%7Bresource.service.name%3D%22gp-api%22+%26%26+resource.deployment.environment.name%3D%22prod%22%7D&limit=20&start=$(date -v-1H +%s)&end=$(date +%s)" | jq .
```

Environments: `prod`, `dev`, `qa`, `preview`, `local`

### Filter by endpoint

```bash
curl -s -H "Authorization: Bearer $TOKEN" \
  "https://goodparty.grafana.net/api/datasources/proxy/uid/grafanacloud-traces/api/search?q=%7Bresource.service.name%3D%22gp-api%22+%26%26+name%3D%22GET+%2Fv1%2Fcampaigns%2Fmine%22%7D&limit=20&start=$(date -v-1H +%s)&end=$(date +%s)" | jq .
```

### Filter by duration (slow traces)

```bash
# Traces > 1 second
curl -s -H "Authorization: Bearer $TOKEN" \
  "https://goodparty.grafana.net/api/datasources/proxy/uid/grafanacloud-traces/api/search?q=%7Bresource.service.name%3D%22gp-api%22+%26%26+duration+%3E+1s%7D&limit=20&start=$(date -v-1H +%s)&end=$(date +%s)" | jq .
```

### Filter by span name and duration

```bash
# Prisma connection spans > 150ms
curl -s -H "Authorization: Bearer $TOKEN" \
  "https://goodparty.grafana.net/api/datasources/proxy/uid/grafanacloud-traces/api/search?q=%7Bresource.service.name%3D%22gp-api%22+%26%26+resource.deployment.environment.name%3D%22prod%22+%26%26+name%3D%22prisma%3Aengine%3Aconnection%22+%26%26+duration+%3E+150ms%7D&limit=50&start=$(date -v-1H +%s)&end=$(date +%s)" | jq .
```

### Custom time window

```bash
START=$(date -j -u -f "%Y-%m-%dT%H:%M:%S" "2026-03-23T00:00:00" +%s)
END=$(date -j -u -f "%Y-%m-%dT%H:%M:%S" "2026-03-23T01:00:00" +%s)
curl -s -H "Authorization: Bearer $TOKEN" \
  "https://goodparty.grafana.net/api/datasources/proxy/uid/grafanacloud-traces/api/search?q=%7Bresource.service.name%3D%22gp-api%22%7D&limit=20&start=$START&end=$END" | jq .
```

### Get full trace by ID

```bash
curl -s -H "Authorization: Bearer $TOKEN" \
  "https://goodparty.grafana.net/api/datasources/proxy/uid/grafanacloud-traces/api/traces/TRACE_ID_HERE" | jq .
```

### Parse trace spans (sorted by duration)

```bash
curl -s -H "Authorization: Bearer $TOKEN" \
  "https://goodparty.grafana.net/api/datasources/proxy/uid/grafanacloud-traces/api/traces/TRACE_ID_HERE" | jq '[.batches[].scopeSpans[].spans[] | {
    name: .name,
    durationMs: (((.endTimeUnixNano | tonumber) - (.startTimeUnixNano | tonumber)) / 1e6 | round),
    attrs: ([.attributes[]? | {(.key): (.value.stringValue // (.value.intValue | tostring) // null)}] | add // {})
  }] | sort_by(.durationMs) | reverse'
```

### Parse search results into summary

```bash
# Group by endpoint with counts
curl -s ... | jq '[.traces[]? | .rootTraceName] | group_by(.) | map({endpoint: .[0], count: length}) | sort_by(.count) | reverse'

# Extract timestamps and durations
curl -s ... | jq '[.traces[]? | {time: (.startTimeUnixNano | tonumber / 1e9 | todate), name: .rootTraceName, ms: .durationMs}] | sort_by(.time)'
```

## Metrics (Prometheus)

### List available metrics

```bash
# All metric names
curl -s -H "Authorization: Bearer $TOKEN" \
  "https://goodparty.grafana.net/api/datasources/proxy/uid/grafanacloud-prom/api/v1/label/__name__/values" | jq '.data'

# Filter by keyword
curl -s -H "Authorization: Bearer $TOKEN" \
  "https://goodparty.grafana.net/api/datasources/proxy/uid/grafanacloud-prom/api/v1/label/__name__/values" | jq '[.data[] | select(test("prisma|cpu|memory"; "i"))]'
```

### List label values

```bash
# Available environments
curl -s -H "Authorization: Bearer $TOKEN" \
  "https://goodparty.grafana.net/api/datasources/proxy/uid/grafanacloud-prom/api/v1/label/deployment_environment_name/values" | jq '.data'
```

### Instant query (current value)

```bash
curl -s -H "Authorization: Bearer $TOKEN" \
  "https://goodparty.grafana.net/api/datasources/proxy/uid/grafanacloud-prom/api/v1/query" \
  --data-urlencode 'query=process_cpu_utilization{service_name="gp-api", deployment_environment_name="prod"}' | jq '.data.result'
```

### Range query (time series)

```bash
curl -s -H "Authorization: Bearer $TOKEN" \
  "https://goodparty.grafana.net/api/datasources/proxy/uid/grafanacloud-prom/api/v1/query_range" \
  --data-urlencode 'query=avg(process_cpu_utilization{service_name="gp-api", deployment_environment_name="prod"}) * 100' \
  --data-urlencode "start=$(date -v-6H +%s)" \
  --data-urlencode "end=$(date +%s)" \
  --data-urlencode "step=300" | jq '.data.result[0].values | map({time: (.[0] | todate), value: .[1]})'
```

### Histogram bucket inspection

Useful for debugging `histogram_quantile` issues — check what's actually in each bucket.

```bash
# Snapshot of bucket counts at a specific time
curl -s -H "Authorization: Bearer $TOKEN" \
  "https://goodparty.grafana.net/api/datasources/proxy/uid/grafanacloud-prom/api/v1/query" \
  --data-urlencode 'query=prisma_connection_duration_milliseconds_bucket{service_name="gp-api", deployment_environment_name="prod"}' \
  --data-urlencode "time=$(date +%s)" | jq '[.data.result[] | {le: .metric.le, count: (.value[1] | tonumber)}] | sort_by(if .le == "+Inf" then 99999 else (.le | tonumber) end)'
```

To find how many connections fell in each bucket, subtract consecutive cumulative counts.

## Alert Rules

### List alert rules

```bash
curl -s -H "Authorization: Bearer $TOKEN" \
  "https://goodparty.grafana.net/api/v1/provisioning/alert-rules" | jq '[.[] | {title, uid, labels}]'
```

### Get alert rule detail

```bash
curl -s -H "Authorization: Bearer $TOKEN" \
  "https://goodparty.grafana.net/api/v1/provisioning/alert-rules/RULE_UID_HERE" | jq '.'
```

### Alert state history

```bash
# State transitions for a specific alert rule (last 30 days)
curl -s -H "Authorization: Bearer $TOKEN" \
  "https://goodparty.grafana.net/api/v1/rules/history?ruleUID=RULE_UID_HERE&from=$(date -v-30d +%s)&to=$(date +%s)&limit=500" | jq -r '
    [.data.values[0], .data.values[1]] as [$times, $lines] |
    [range($times | length)] | map({
      time: ($times[.] / 1000 | todate),
      prev: ($lines[.] | .previous),
      curr: ($lines[.] | .current)
    }) | sort_by(.time) | .[] | "\(.time)  \(.prev) -> \(.curr)"'
```

States: `Normal` → `Pending` (threshold crossed) → `Alerting` (sustained for `for` duration, Slack notified) → `Normal` (resolved)

## TraceQL Quick Reference

TraceQL queries are URL-encoded in the `q` parameter. Common patterns:

| Query | URL-encoded `q` value |
|-------|----------------------|
| `{resource.service.name="gp-api"}` | `%7Bresource.service.name%3D%22gp-api%22%7D` |
| `{... && duration > 1s}` | append `+%26%26+duration+%3E+1s` |
| `{... && name="GET /v1/health"}` | append `+%26%26+name%3D%22GET+%2Fv1%2Fhealth%22` |
| `{... && resource.deployment.environment.name="prod"}` | append `+%26%26+resource.deployment.environment.name%3D%22prod%22` |

Key URL encodings: `{` = `%7B`, `}` = `%7D`, `=` = `%3D`, `"` = `%22`, `&&` = `%26%26`, `>` = `%3E`, `/` = `%2F`, ` ` = `+`

## Troubleshooting

**403 Forbidden from Python urllib** — The service account token works with `curl` but not Python's `urllib`. Use `subprocess` with `curl` or the `requests` library instead.

**Trace search returns max 50 results** — The `limit` parameter caps at 50 per search. Use narrower time windows or more specific TraceQL filters to find what you need. For authoritative counts, use the Prometheus histogram metrics instead of counting traces.

**`histogram_quantile` returns unrealistic values** — This happens when the distribution is heavily skewed (e.g., 99% of values in the lowest bucket). The function linearly interpolates across wide, sparse buckets and can produce phantom values. Use histogram bucket inspection (above) to verify what's actually in the data, and prefer count-based alerting over percentile-based alerting for skewed distributions.
