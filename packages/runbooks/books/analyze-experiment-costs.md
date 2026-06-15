Analyze cost, runtime, and success rate of PMF agent experiments from S3 artifact and log data.

Use this when you need to answer questions like:

- What is the average cost of an X job?
- What is the average runtime of an X job?
- Where does spend happen during a typical X job?
- What is the success rate of an X job?
- Why are some runs much more expensive than others?

This procedure works for any PMF experiment (`meeting_briefing`,
`meeting_schedule`, `district_issue_pulse`, etc.) because every experiment
writes the same S3 file layout.

## Prerequisites

**Tools**: `aws` CLI (v2), `python3` (3.11+), enough local disk for the
artifacts (typically 100MB-2GB depending on burst size).

**books/.env variables**: `$AWS_PROFILE`. Set it to whatever AWS named
profile gives you access to the agent artifacts bucket (e.g. `export
AWS_PROFILE=goodparty` if that is the name you configured locally). The
AWS CLI honors `$AWS_PROFILE` natively, so commands below do not pass
`--profile` explicitly; export the variable once and every command in
this runbook picks it up.

**AWS auth**: `aws sso login`. Token lasts 8-12 hours typically. Verify
with `aws sts get-caller-identity`.

## Data inventory

Every PMF experiment run writes to `s3://gp-agent-artifacts-{env}/<experiment_id>/<run_id>/`.
Environments are `dev`, `qa`, `prod`. The contents per run:

| File | What it contains |
| --- | --- |
| `artifact.json` | The published output. Contains `status`/`briefing_status`, `run_metadata.run_decisions[]`, and the experiment-specific result fields. **Written only on successful completion.** |
| `logs/session.jsonl` | The Anthropic SDK's session log. Every assistant message has a `usage` block with `cache_creation_input_tokens`, `cache_read_input_tokens`, `output_tokens`, `input_tokens`. Has `message.model` (e.g. `claude-opus-4-7`, `claude-sonnet-4-6`). |
| `logs/workspace/conversation.jsonl` | The runner's log. Contains a `{"type":"result","total_cost_usd":X}` entry at the end. **This is the authoritative billing number** (from Anthropic SDK's `ResultMessage`). |
| `logs/workspace/instruction.md` | The instruction the agent executed against. |
| `logs/workspace/output/*` | The artifact files the agent wrote. |
| `logs/workspace/logs/__main___errors.log` | Runner stderr. Useful for diagnosing crashes. |

The experiment definitions (manifests, instructions) live in a separate
bucket: `s3://agent-experiment-metadata-{env}/<experiment_id>/`.

## Setup: pull the data

For one experiment in prod:

```bash
EXPERIMENT_ID=meeting_briefing  # or meeting_schedule, etc.
ENV=prod
mkdir -p /tmp/${EXPERIMENT_ID}_artifacts /tmp/${EXPERIMENT_ID}_sessions /tmp/${EXPERIMENT_ID}_conv

# 1. Artifacts (small, ~10KB each)
aws s3 sync \
  s3://gp-agent-artifacts-${ENV}/${EXPERIMENT_ID}/ \
  /tmp/${EXPERIMENT_ID}_artifacts/ \
  --exclude "*" --include "*/artifact.json" --no-progress

# 2. Session.jsonl files (medium, ~400KB each). Needed for per-step token usage.
aws s3 sync \
  s3://gp-agent-artifacts-${ENV}/${EXPERIMENT_ID}/ \
  /tmp/${EXPERIMENT_ID}_sessions/ \
  --exclude "*" --include "*/logs/session.jsonl" --no-progress

# 3. Conversation.jsonl files (small). Needed for authoritative per-run cost.
aws s3 sync \
  s3://gp-agent-artifacts-${ENV}/${EXPERIMENT_ID}/ \
  /tmp/${EXPERIMENT_ID}_conv/ \
  --exclude "*" --include "*/logs/workspace/conversation.jsonl" --no-progress

# Sanity check
echo "Artifacts:    $(find /tmp/${EXPERIMENT_ID}_artifacts -name artifact.json | wc -l)"
echo "Sessions:     $(find /tmp/${EXPERIMENT_ID}_sessions -name session.jsonl | wc -l)"
echo "Conversations: $(find /tmp/${EXPERIMENT_ID}_conv -name conversation.jsonl | wc -l)"
```

**Pitfall: sync timing.** Runs in progress have a session.jsonl but no
artifact.json yet (artifact is written at run completion). If the session
count exceeds the artifact count significantly, either the runs haven't
finished or they crashed. **Wait until the dispatch queue is empty before
analyzing,** or re-sync to catch late-completers. A reasonable check:

```bash
# Compare sessions WITHOUT artifacts vs WITH (proxy for crashed runs)
python3 -c "
import os
sess = {d for d in os.listdir('/tmp/${EXPERIMENT_ID}_sessions') if os.path.exists(f'/tmp/${EXPERIMENT_ID}_sessions/{d}/logs/session.jsonl')}
arts = set(os.listdir('/tmp/${EXPERIMENT_ID}_artifacts'))
print(f'sessions with artifact: {len(sess & arts)}')
print(f'sessions WITHOUT artifact (crashed or in-progress): {len(sess - arts)}')
"
```

## Question 1: What is the average cost of an X job?

The authoritative per-run cost comes from `total_cost_usd` in
conversation.jsonl. The runner gets this directly from the Anthropic SDK's
`ResultMessage`, so it is what Anthropic actually billed.

```python
# extract_run_costs.py
import json, glob, os, csv

EXPERIMENT_ID = 'meeting_briefing'
out_csv = f'/tmp/{EXPERIMENT_ID}_run_costs.csv'

def extract_runner_cost(path):
    """Read last 8KB to find the result line efficiently."""
    try:
        with open(path, 'rb') as f:
            f.seek(0, 2)
            size = f.tell()
            f.seek(max(0, size - 8192))
            tail = f.read().decode('utf-8', errors='replace')
        for line in reversed(tail.split('\n')):
            line = line.strip()
            if not line: continue
            try: obj = json.loads(line)
            except: continue
            if obj.get('type') == 'result' and obj.get('total_cost_usd') is not None:
                return {'cost': obj['total_cost_usd'], 'turns': obj.get('num_turns')}
    except: pass
    return None

with open(out_csv, 'w', newline='') as f:
    w = csv.writer(f)
    w.writerow(['run_id', 'status', 'cost_usd', 'num_turns'])
    for path in glob.glob(f'/tmp/{EXPERIMENT_ID}_conv/*/logs/workspace/conversation.jsonl'):
        rid = path.split('/')[-4]
        cost_data = extract_runner_cost(path)
        # Get status from artifact if present
        art_path = f'/tmp/{EXPERIMENT_ID}_artifacts/{rid}/artifact.json'
        status = 'crashed_or_no_artifact'
        if os.path.exists(art_path):
            try:
                a = json.load(open(art_path))
                # The status field name varies: meeting_briefing uses briefing_status,
                # meeting_schedule uses status, etc.
                status = a.get('briefing_status') or a.get('status') or '?'
            except: pass
        if cost_data:
            w.writerow([rid, status, f"{cost_data['cost']:.4f}", cost_data['turns']])
        else:
            w.writerow([rid, status, '', ''])

print(f'Wrote {out_csv}')
```

Then aggregate (set `EXPERIMENT_ID` first):

```bash
EXPERIMENT_ID=meeting_briefing  # or whatever you exported above
python3 -c "
import csv, collections, os, statistics
rows = list(csv.DictReader(open(f'/tmp/{os.environ[\"EXPERIMENT_ID\"]}_run_costs.csv')))
by_status = collections.defaultdict(list)
for r in rows:
    if r['cost_usd']:
        by_status[r['status']].append(float(r['cost_usd']))
for status, costs in sorted(by_status.items(), key=lambda x: -len(x[1])):
    n = len(costs)
    cs = sorted(costs)
    # p90 = floor((n-1) * 0.9). Last index is n-1, so 90th percentile of an
    # n-item sorted list lives at index round((n-1)*0.9) under the nearest-rank
    # convention. Don't use int(n*0.9): that's off by one near small n and
    # at the boundary returns out-of-range indices.
    p90_idx = max(0, min(n - 1, int(round((n - 1) * 0.9))))
    print(f'{status:25s} n={n:5d} total=\${sum(costs):8.2f} mean=\${sum(costs)/n:.2f} median=\${cs[n//2]:.2f} p90=\${cs[p90_idx]:.2f}')
"
```

## Question 2: What is the average runtime of an X job?

Two notions of runtime exist:

**Wall-clock duration** (start-to-finish timestamps from session.jsonl):

```python
import json, glob, statistics
from datetime import datetime

EXPERIMENT_ID = 'meeting_briefing'  # change to match what you synced

durations = []
for path in glob.glob(f'/tmp/{EXPERIMENT_ID}_sessions/*/logs/session.jsonl'):
    lines = open(path).readlines()
    first_ts = last_ts = None
    for l in lines:
        try: obj = json.loads(l)
        except: continue
        ts = obj.get('timestamp')
        if not ts: continue
        try:
            t = datetime.fromisoformat(ts.replace('Z', '+00:00'))
            if first_ts is None: first_ts = t
            last_ts = t
        except: continue
    if first_ts and last_ts:
        durations.append((last_ts - first_ts).total_seconds())

print(f'n={len(durations)}, mean={sum(durations)/len(durations):.0f}s, median={statistics.median(durations):.0f}s')
```

**Turn count** (from `num_turns` in conversation.jsonl, already extracted above):

```bash
EXPERIMENT_ID=meeting_briefing
python3 -c "
import csv, os, statistics
turns = [int(r['num_turns']) for r in csv.DictReader(open(f'/tmp/{os.environ[\"EXPERIMENT_ID\"]}_run_costs.csv')) if r['num_turns']]
print(f'n={len(turns)}, mean={sum(turns)/len(turns):.0f} turns, median={statistics.median(turns):.0f}, max={max(turns)}')
"
```

## Question 3: Where does spend happen during a typical X job?

Attribute cost to instruction.md steps. Boundaries are detected via the
agent's `TaskUpdate(status=in_progress)` calls (or `TodoWrite` with an
in_progress todo). Both signals matter because some agents use one, some
the other, and some use neither.

The classifier maps task subjects to step labels via regex. **You will
need to customize the step patterns for each experiment** because the steps
differ per instruction.

```python
# per_step_costs.py
import json, glob, os, collections, re, csv

EXPERIMENT_ID = 'meeting_briefing'

# Customize these patterns to match your experiment's task subjects.
# Run a quick `print` of task subjects first to see what the agent emits.
STEP_PATTERNS = [
    (re.compile(r'(databricks|ping|verify|params)', re.I), 'S1_setup'),
    (re.compile(r'(find.*meeting|target meeting)', re.I), 'S2a_find_meeting'),
    (re.compile(r'(agenda packet|channel|discovery)', re.I), 'S2b_discovery'),
    (re.compile(r'(chunk|raw_context)', re.I), 'S4_chunk'),
    (re.compile(r'(claims|verbatim)', re.I), 'S13_claims'),
    (re.compile(r'(write.*artifact|assemble)', re.I), 'S17_write'),
    (re.compile(r'(validate|qa_checks)', re.I), 'S18_validate'),
]

# Opus 4.7 pricing per https://platform.claude.com/docs/en/about-claude/pricing
# Sonnet 4.6 is 60% of these; Haiku 4.5 is 20%.
PRICING = {
    'claude-opus-4-7': dict(input=5.00, cache_5m=6.25, cache_read=0.50, output=25.00),
    'claude-opus-4-6': dict(input=5.00, cache_5m=6.25, cache_read=0.50, output=25.00),
    'claude-sonnet-4-6': dict(input=3.00, cache_5m=3.75, cache_read=0.30, output=15.00),
    'claude-haiku-4-5-20251001': dict(input=1.00, cache_5m=1.25, cache_read=0.10, output=5.00),
}

def classify(text):
    for pat, name in STEP_PATTERNS:
        if pat.search(text): return name
    return 'OTHER'

def parse_session(path):
    lines = open(path).readlines()
    # Build task_id -> subject map (TaskCreate calls in order get IDs 1, 2, ...)
    task_subjects = {}
    seq = 0
    for l in lines:
        try: obj = json.loads(l)
        except: continue
        msg = obj.get('message', {})
        if not isinstance(msg, dict): continue
        for c in (msg.get('content') or []):
            if isinstance(c, dict) and c.get('type') == 'tool_use' and c.get('name') == 'TaskCreate':
                seq += 1
                task_subjects[str(seq)] = (c.get('input', {}) or {}).get('subject', f'task_{seq}')

    current_step = 'S0_setup'
    per_step = collections.defaultdict(lambda: [0, 0, 0, 0, 0])  # turns, cc, cr, outp, inp
    seen_first_taskcreate = False
    has_step_tracking = False
    for l in lines:
        try: obj = json.loads(l)
        except: continue
        msg = obj.get('message')
        if not isinstance(msg, dict): continue
        usage = msg.get('usage') or {}
        cc, cr, outp, inp = usage.get('cache_creation_input_tokens', 0), usage.get('cache_read_input_tokens', 0), usage.get('output_tokens', 0), usage.get('input_tokens', 0)
        for c in (msg.get('content') or []):
            if not isinstance(c, dict) or c.get('type') != 'tool_use': continue
            name = c.get('name', '')
            inp_dict = c.get('input', {}) or {}
            if name == 'TaskCreate' and not seen_first_taskcreate:
                seen_first_taskcreate = True
                current_step = 'UNCLASSIFIED_work'
            elif name == 'TaskUpdate' and inp_dict.get('status') == 'in_progress':
                tid = str(inp_dict.get('taskId', '') or inp_dict.get('id', ''))
                current_step = classify(task_subjects.get(tid, 'unknown'))
                has_step_tracking = True
            elif name == 'TodoWrite':
                for t in inp_dict.get('todos', []) or []:
                    if isinstance(t, dict) and t.get('status') == 'in_progress':
                        current_step = classify(t.get('content', '') or t.get('activeForm', ''))
                        has_step_tracking = True
                        break
        agg = per_step[current_step]
        agg[0] += 1; agg[1] += cc; agg[2] += cr; agg[3] += outp; agg[4] += inp
    return per_step, has_step_tracking

# Aggregate across all runs
agg = collections.defaultdict(lambda: collections.defaultdict(lambda: [0, 0, 0, 0, 0]))
status_n = collections.Counter()
for path in glob.glob(f'/tmp/{EXPERIMENT_ID}_sessions/*/logs/session.jsonl'):
    rid = path.split('/')[-3]
    art_path = f'/tmp/{EXPERIMENT_ID}_artifacts/{rid}/artifact.json'
    status = 'crashed_or_no_artifact'
    if os.path.exists(art_path):
        try:
            a = json.load(open(art_path))
            status = a.get('briefing_status') or a.get('status') or '?'
        except: pass
    status_n[status] += 1
    per_step, _ = parse_session(path)
    for step, vals in per_step.items():
        for i in range(5):
            agg[status][step][i] += vals[i]

# Print per-step cost per status (using Opus 4.7 default; adjust for your model)
p = PRICING['claude-opus-4-7']
def cost(cc, cr, outp, inp):
    return (cc*p['cache_5m'] + cr*p['cache_read'] + outp*p['output'] + inp*p['input']) / 1_000_000

for status, steps in agg.items():
    n = status_n[status]
    total = sum(cost(*v[1:]) for v in steps.values())
    print(f'\n=== {status} (n={n}, total ${total:.2f}) ===')
    items = [(s, cost(*v[1:])) for s, v in steps.items()]
    items.sort(key=lambda x: -x[1])
    for step, c in items[:10]:
        pct = 100*c/total if total else 0
        print(f'  {step:30s} ${c:8.2f} (${c/n:.3f}/run, {pct:.1f}%)')
```

**Note on pricing accuracy**: the token-derived cost above runs about 33%
higher than the runner-reported authoritative cost (we have not fully
reconciled the discrepancy). For absolute numbers, trust
`conversation.jsonl`'s `total_cost_usd`. For relative per-step shares
(percentages), trust the token math.

To rescale token-derived per-step costs to match authoritative totals:

```python
scale = runner_cost / token_derived_total
rescaled_step_cost = token_step_cost * scale
```

## Question 4: What is the success rate of an X job?

"Success" is experiment-specific. Always check both:

```python
# Status distribution from artifacts
import json, glob, collections, os

EXPERIMENT_ID = 'meeting_briefing'  # change to match what you synced
artifacts_dir = f'/tmp/{EXPERIMENT_ID}_artifacts'
sessions_dir = f'/tmp/{EXPERIMENT_ID}_sessions'

statuses = collections.Counter()
for path in glob.glob(f'{artifacts_dir}/*/artifact.json'):
    try:
        a = json.load(open(path))
        st = a.get('briefing_status') or a.get('status') or '?'
        statuses[st] += 1
    except: statuses['parse_error'] += 1

# Crashed runs = sessions WITHOUT artifacts (the runner's heartbeat failed)
session_rids = {d for d in os.listdir(sessions_dir)
                if os.path.exists(f'{sessions_dir}/{d}/logs/session.jsonl')}
artifact_rids = set(os.listdir(artifacts_dir))
crashed = len(session_rids - artifact_rids)

print('Status distribution:')
for s, c in statuses.most_common():
    print(f'  {s}: {c}')
print(f'  crashed_or_no_artifact: {crashed}')

total = sum(statuses.values()) + crashed
print(f'\nTotal: {total}')
```

For meeting_briefing, "success" usually means `briefing_status =
briefing_ready` (the agent produced a full briefing) versus placeholder
statuses (`awaiting_agenda`, `no_meeting_found`) and `crashed_or_no_artifact`.

For meeting_schedule, "success" means `status = found`.

## Pitfalls and gotchas

**Sync timing.** `aws s3 sync` captures whatever is in the bucket at sync
time. Runs in progress have a session.jsonl (uploaded at start) but no
artifact.json (uploaded at end). If you sync during an active burst, you
will OVER-COUNT crashes. **Wait until the dispatch queue is empty, or
re-sync to pick up late-completers.** This bit us during the meeting_schedule
analysis — initial sync showed 84% crash rate, fresh sync showed 13%.

**Status field naming.** Different experiments use different field names
for status:
- `meeting_briefing` → `briefing_status`
- `meeting_schedule` → `status`
- `district_issue_pulse` → `status`

The example code above uses `a.get('briefing_status') or a.get('status')`
to handle both.

**Model price differences.** Each experiment can use a different model
(`manifest.json` `model` field). Verify by reading `message.model` in any
session.jsonl. Pricing varies 5x between Haiku and Opus.

**Task tracking inconsistency.** Some runs use `TaskUpdate`, some use
`TodoWrite`, some use neither. Runs that use neither dump all their cost
into the "S0_setup" bucket because the classifier has no signal to switch.
Track this with a `has_step_tracking` flag and report cleanly:

```python
# In per_step parser, return whether step tracking was used
runs_with_tracking = sum(1 for r in results if r['has_step_tracking'])
print(f'Step-tracking coverage: {runs_with_tracking}/{len(results)} ({100*runs_with_tracking/len(results):.1f}%)')
```

When coverage is low (<70%), per-step percentages are unreliable for the
untracked subset.

**Cache read dominates.** For Opus-based experiments, ~85% of total spend
is cache_read tokens (the agent re-reads its accumulated context every
turn). Don't be surprised when this dominates the breakdown. The
instruction.md size and the accumulated tool results both contribute.

**Runner-reported vs token-derived cost.** Empirically the
runner-reported `total_cost_usd` is about 73% of the token-derived
calculation at Opus 4.7 rates. This may be due to discounts, tokenizer
differences, or accounting we haven't reverse-engineered. For
presentation, trust runner-reported. For relative comparisons, either
works.

**The `error` status is rare but real.** Some artifacts publish with
`status: error` rather than crashing silently. Treat them as a third
failure mode separate from crashes.

## Reference: Anthropic pricing

Source: https://platform.claude.com/docs/en/about-claude/pricing

Per million tokens (USD):

| Model | Input | 5m cache write | Cache read | Output |
| --- | ---: | ---: | ---: | ---: |
| Opus 4.5/4.6/4.7 | $5 | $6.25 | $0.50 | $25 |
| Sonnet 4.5/4.6 | $3 | $3.75 | $0.30 | $15 |
| Haiku 4.5 | $1 | $1.25 | $0.10 | $5 |

The 1-hour cache write rate is higher (2x base input). The agent SDK
defaults to 5-minute caching.

## Reference: S3 layout

```
gp-agent-artifacts-{env}/
├── <experiment_id>/
│   ├── <run_id>/
│   │   ├── artifact.json                    # published output
│   │   └── logs/
│   │       ├── session.jsonl                # SDK session log (token usage)
│   │       └── workspace/
│   │           ├── conversation.jsonl       # runner log (authoritative cost)
│   │           ├── instruction.md           # what the agent ran against
│   │           ├── output/                  # files the agent wrote
│   │           └── logs/
│   │               ├── __main__.log         # runner stdout
│   │               └── __main___errors.log  # runner stderr (crash investigation)

agent-experiment-metadata-{env}/
├── <experiment_id>/
│   ├── manifest.json                        # input schema, output schema, model
│   ├── instruction.md                       # the agent's playbook
│   └── attachments/                         # supplementary files
└── index.json                               # list of available experiments
```

## See also

- `books/run-pmf-experiment-cloud.md` — how to dispatch test runs in dev
- `books/convert-runbook-to-experiment.md` — how a runbook becomes an
  experiment in the first place
- `books/qa-validate.md` — deterministic validation of artifact JSONs
