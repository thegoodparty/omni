"""Detect flatlines / hard drops in key Amplitude events (DATA-1952).

Detection stage. Reads a curated watchlist, queries the Amplitude events synced to
Databricks for daily volume, and emits a structured report of flagged events +
candidate replacements + newly-instrumented events in the watched families. As a
convenience it also runs a best-effort `git log -S` to note when each event string
was introduced (commit date + PR), which makes the flagged ↔ replacement timeline
legible. It never posts anywhere and never writes to Amplitude — the deeper
classification (reading the actual diffs) is the runbook agent's job (see
books/monitor-event-health.md), which consumes the JSON report this writes.

Why two windows: a break that has been silent for weeks looks like a permanently
dead event under a short trailing window (the registration event was zero for
~6 weeks before anyone noticed). So we compare a short RECENT window against a
longer BASELINE window and key flatlines off "did it fire recently", not off the
single latest day.

Usage:
    uv run analytics_event_health.py
    uv run analytics_event_health.py --window-days 90 --recent-days 7
    uv run analytics_event_health.py --end-date 2026-06-03   # backfill / replay
"""

import argparse
import json
import os
import re
import subprocess
import sys
from datetime import date, datetime, timedelta

import yaml
from databricks.sql import connect
from dotenv import load_dotenv

load_dotenv(os.path.join(os.path.dirname(__file__), '..', '.env'))

EVENTS_TABLE = 'mart_analytics.amplitude_events'
TAXONOMY_TABLE = 'dbt.int__amplitude_event_taxonomy'

DEFAULTS = {
    'window_days': 90,
    'recent_days': 7,
    'lag_days': 1,            # exclude trailing days as incomplete (today is partial)
    'drop_fraction': 0.25,    # hard-drop if recent rate < this * baseline rate
    'min_active_volume': 10,  # baseline must have ≥ this many events to be "active"
}


# --------------------------------------------------------------------------- #
# Pure functions (no DB, no IO) — unit-tested in test_analytics_event_health.py
# --------------------------------------------------------------------------- #

def build_daily_series(counts_by_day, start, end):
    """Dense day-by-day [(date, count)] over [start, end] inclusive, zero-filled."""
    series = []
    day = start
    while day <= end:
        series.append((day, int(counts_by_day.get(day, 0))))
        day += timedelta(days=1)
    return series


def last_nonzero_date(series):
    """Most recent date in the series with a non-zero count, else None."""
    for day, count in reversed(series):
        if count > 0:
            return day
    return None


def evaluate_event(series, recent_days, floor, drop_fraction, min_active_volume):
    """Classify one event's daily series.

    Splits the series into a trailing RECENT window (recent_days) and the
    BASELINE before it, and compares average daily RATES (events/day). Rates are
    used rather than medians because a short recent window with a single spike
    day medians to zero and would falsely read as a 100% drop. An event must have
    fired at least `min_active_volume` times in the baseline to be eligible for
    flatline/hard-drop flags — this suppresses naturally-sparse events.
    """
    recent = series[-recent_days:] if recent_days < len(series) else series
    baseline = series[:-recent_days] if recent_days < len(series) else []

    recent_sum = sum(c for _, c in recent)
    baseline_sum = sum(c for _, c in baseline)
    recent_rate = recent_sum / len(recent) if recent else 0.0
    baseline_rate = baseline_sum / len(baseline) if baseline else 0.0

    last_seen = last_nonzero_date(series)
    last_day = series[-1][0] if series else None
    days_since_last = (last_day - last_seen).days if (last_seen and last_day) else None

    active = baseline_sum >= min_active_volume
    flags = []
    if active and recent_sum == 0:
        flags.append('flatline')
    elif active and recent_sum > 0 and baseline_rate > 0 \
            and recent_rate < drop_fraction * baseline_rate:
        flags.append('hard_drop')
    if floor is not None and recent_rate < floor:
        flags.append('below_floor')

    if baseline_rate > 0:
        drop_pct = max(0.0, round(100.0 * (1 - recent_rate / baseline_rate), 1))
    else:
        drop_pct = 100.0 if recent_sum == 0 and active else 0.0

    # Drop started the day after the event was last seen (flatline), or at the
    # start of the recent window when volume degraded but kept firing (hard_drop).
    if last_seen and recent_sum == 0:
        drop_start = last_seen + timedelta(days=1)
    elif recent and 'hard_drop' in flags:
        drop_start = recent[0][0]
    else:
        drop_start = None

    return {
        'flagged': bool(flags),
        'flags': flags,
        'recent_sum': recent_sum,
        'recent_rate': round(recent_rate, 2),
        'baseline_sum': baseline_sum,
        'baseline_rate': round(baseline_rate, 2),
        'drop_pct': drop_pct,
        'last_seen': last_seen.isoformat() if last_seen else None,
        'days_since_last_event': days_since_last,
        'drop_start_date': drop_start.isoformat() if drop_start else None,
    }


def parse_pr_number(subject):
    """Pull a squash-merge PR number like '… (#1234)' from a commit subject, else None."""
    match = re.search(r'\(#(\d+)\)', subject or '')
    return match.group(1) if match else None


# --------------------------------------------------------------------------- #
# Git enrichment (best-effort, never raises)
# --------------------------------------------------------------------------- #

def repo_root():
    """Walk up from this script to the omni repo root (the dir holding .git)."""
    path = os.path.dirname(os.path.abspath(__file__))
    while path != os.path.dirname(path):
        if os.path.isdir(os.path.join(path, '.git')):
            return path
        path = os.path.dirname(path)
    return None


INSTRUMENTATION_PATHS = ['packages/gp-webapp', 'packages/gp-api']


def classify_code_status(present_in_head, has_history):
    """Pure: map (grep-at-HEAD result, whether the string has any git history) to a
    status. Separated out so it can be unit-tested without invoking git."""
    if present_in_head is None:
        return 'unknown'           # git unavailable / errored
    if present_in_head:
        return 'present'           # instrumentation still in the codebase
    if has_history:
        return 'removed'           # was there, now gone → deprecated/renamed in code
    return 'not_found_in_code'     # literal never appeared in the instrumentation paths


def git_pickaxe_history(root, code_string, timeout):
    """All commits that changed the occurrence count of `code_string` in the
    instrumentation packages, newest-first. [{commit, date, pr, subject}], [] on error.
    One pass yields both the introduction (oldest) and the last change (newest)."""
    if not root:
        return []
    try:
        proc = subprocess.run(
            ['git', '-C', root, 'log', '--date=short',
             '--format=%h\x1f%ad\x1f%s', '-S', code_string, '--', *INSTRUMENTATION_PATHS],
            capture_output=True, text=True, timeout=timeout,
        )
    except (OSError, subprocess.SubprocessError):
        return []
    history = []
    for line in proc.stdout.splitlines():
        parts = line.split('\x1f')
        if len(parts) == 3:
            history.append({'commit': parts[0], 'date': parts[1],
                            'pr': parse_pr_number(parts[2]), 'subject': parts[2]})
    return history


def git_present_in_head(root, code_string, timeout):
    """Whether `code_string` literally exists in the instrumentation paths at HEAD.
    True/False, or None if git is unavailable."""
    if not root:
        return None
    try:
        proc = subprocess.run(
            ['git', '-C', root, 'grep', '-F', '-q', '-e', code_string,
             'HEAD', '--', *INSTRUMENTATION_PATHS],
            capture_output=True, text=True, timeout=timeout,
        )
    except (OSError, subprocess.SubprocessError):
        return None
    return proc.returncode == 0


# --------------------------------------------------------------------------- #
# Databricks access
# --------------------------------------------------------------------------- #

def _sql_str_list(values):
    """Render a Python list of strings as a SQL IN-list literal, escaping quotes.

    Values come from the committed watchlist, not user input, but we still double
    single quotes so event names like "Hover \"Upload\"" or apostrophes are safe.
    """
    return ', '.join("'" + v.replace("'", "''") + "'" for v in values)


def fetch_daily_counts(cursor, events, start, end):
    """{event_type: {date: count}} for the given events over [start, end]."""
    if not events:
        return {}
    query = f"""
        SELECT event_type, date(event_time) AS d, count(*) AS c
        FROM {EVENTS_TABLE}
        WHERE event_type IN ({_sql_str_list(events)})
          AND event_time >= DATE'{start.isoformat()}'
          AND event_time < DATE'{(end + timedelta(days=1)).isoformat()}'
        GROUP BY event_type, date(event_time)
    """
    cursor.execute(query)
    out = {}
    for event_type, d, c in cursor.fetchall():
        # Databricks returns date as datetime.date already
        out.setdefault(event_type, {})[d] = int(c)
    return out


def fetch_taxonomy_meta(cursor, events):
    """{event_type: {first_seen_date, event_count}} for the given events."""
    if not events:
        return {}
    query = f"""
        SELECT event_type, first_seen_date, event_count
        FROM {TAXONOMY_TABLE}
        WHERE event_type IN ({_sql_str_list(events)})
    """
    cursor.execute(query)
    return {
        et: {
            'first_seen_date': fsd.isoformat() if fsd else None,
            'event_count': int(ec) if ec is not None else None,
        }
        for et, fsd, ec in cursor.fetchall()
    }


def fetch_new_events(cursor, families, since):
    """Events in the watched families first seen on/after `since`."""
    if not families:
        return []
    query = f"""
        SELECT event_type, family, first_seen_date, event_count
        FROM {TAXONOMY_TABLE}
        WHERE family IN ({_sql_str_list(families)})
          AND first_seen_date >= DATE'{since.isoformat()}'
        ORDER BY family, first_seen_date DESC
    """
    cursor.execute(query)
    return [
        {
            'event': et,
            'family': fam,
            'first_seen_date': fsd.isoformat() if fsd else None,
            'event_count': int(ec) if ec is not None else None,
        }
        for et, fam, fsd, ec in cursor.fetchall()
    ]


# --------------------------------------------------------------------------- #
# Orchestration
# --------------------------------------------------------------------------- #

def load_watchlist(path):
    with open(path) as f:
        doc = yaml.safe_load(f)
    return doc.get('watched_families', []), doc.get('events', [])


def run(watchlist_path, end_date, opts, with_git=True, git_timeout=20):
    watched_families, rows = load_watchlist(watchlist_path)
    last_complete_day = end_date - timedelta(days=opts['lag_days'])
    window_start = last_complete_day - timedelta(days=opts['window_days'] - 1)

    events = [r['event'] for r in rows]

    hostname = os.environ.get('DATABRICKS_SERVER_HOSTNAME')
    http_path = os.environ.get('DATABRICKS_HTTP_PATH')
    access_token = os.environ.get('DATABRICKS_API_KEY')
    if not hostname or not http_path or not access_token:
        print('ERROR: Databricks env vars not set (see scripts/.env)', file=sys.stderr)
        sys.exit(2)
    conn = connect(
        server_hostname=hostname,
        http_path=http_path,
        access_token=access_token,
    )
    try:
        with conn.cursor() as cursor:
            print(f'Querying {len(events)} events over '
                  f'{window_start} .. {last_complete_day} ...', file=sys.stderr)
            counts = fetch_daily_counts(cursor, events, window_start, last_complete_day)
            meta = fetch_taxonomy_meta(cursor, events)
            new_events = fetch_new_events(
                cursor, watched_families,
                last_complete_day - timedelta(days=opts['window_days']),
            )
    finally:
        conn.close()

    # Best-effort git enrichment, cached per code string.
    root = repo_root() if with_git else None
    history_cache, present_cache = {}, {}

    def history(code_string):
        if code_string not in history_cache:
            history_cache[code_string] = (
                git_pickaxe_history(root, code_string, git_timeout) if root else [])
        return history_cache[code_string]

    def instrumented(code_string):
        h = history(code_string)
        return h[-1] if h else None      # oldest commit that touched the string

    def code_status(code_string):
        """Full code-presence picture for a flagged event: is the instrumentation still
        in the codebase, and if not, when/where was it removed?"""
        h = history(code_string)
        if code_string not in present_cache:
            present_cache[code_string] = (
                git_present_in_head(root, code_string, git_timeout) if root else None)
        present = present_cache[code_string]
        return {
            'still_in_code': present,
            'code_status': classify_code_status(present, bool(h)),
            'instrumented': h[-1] if h else None,
            'last_code_change': h[0] if h else None,   # newest; the removal if now absent
        }

    watched_set = set(events)
    new_in_families = [e for e in new_events if e['event'] not in watched_set]
    new_in_families.sort(key=lambda e: (e['first_seen_date'] or ''), reverse=True)
    new_by_family = {}
    for e in new_in_families:
        new_by_family.setdefault(e['family'], []).append(e)

    if with_git:
        print(f'Resolving instrumentation commits via git '
              f'({"found repo" if root else "no repo — skipping"}) ...', file=sys.stderr)
        for e in new_in_families:
            e['instrumented'] = instrumented(e['event'])

    flagged, healthy = [], []
    for row in rows:
        series = build_daily_series(
            counts.get(row['event'], {}), window_start, last_complete_day,
        )
        verdict = evaluate_event(
            series, opts['recent_days'], row.get('floor'),
            opts['drop_fraction'], opts['min_active_volume'],
        )
        event_meta = meta.get(row['event'], {})
        code_string = row.get('code_string', row['event'])
        record = {
            'event': row['event'],
            'product': row.get('product'),
            'family': row.get('family'),
            'code_string': code_string,
            'first_seen_date': event_meta.get('first_seen_date'),
            'lifetime_volume': event_meta.get('event_count'),
            **verdict,
        }
        if verdict['flagged']:
            record.update(code_status(code_string))
            record['candidate_replacements'] = new_by_family.get(row.get('family'), [])
            record['daily_series'] = [
                {'date': d.isoformat(), 'count': c} for d, c in series
            ]
            flagged.append(record)
        else:
            healthy.append({k: record[k] for k in
                            ('event', 'recent_rate', 'baseline_rate')})

    return {
        'run': {
            'end_date': end_date.isoformat(),
            'last_complete_day': last_complete_day.isoformat(),
            'window_start': window_start.isoformat(),
            **opts,
            'git_enrichment': bool(with_git and root),
            'watchlist_size': len(rows),
            'watched_families': watched_families,
        },
        'flagged': sorted(flagged, key=lambda r: r['drop_pct'], reverse=True),
        'healthy': healthy,
        'new_events_in_watched_families': new_in_families,
    }


def _fmt_instrumented(info):
    """Render an introducing-commit dict as 'YYYY-MM-DD (#PR)' / 'YYYY-MM-DD' / '—'."""
    if not info:
        return '—'
    return f"{info['date']} (#{info['pr']})" if info.get('pr') else info['date']


def _fmt_code_status(record):
    """Render the in-code status: 'present', 'removed <date> (#PR)', 'not in code', '?'."""
    status = record.get('code_status')
    if status == 'present':
        return 'present'
    if status == 'removed':
        return f"removed {_fmt_instrumented(record.get('last_code_change'))}"
    if status == 'not_found_in_code':
        return 'not in code'
    return '?'


def render_markdown(report):
    run = report['run']
    gen = f" · generated {run['generated_at']}" if run.get('generated_at') else ''
    lines = [
        '# Analytics event-health report',
        '',
        f"As of **{run['last_complete_day']}** "
        f"(window {run['window_start']} → {run['last_complete_day']}, "
        f"recent {run['recent_days']}d){gen}. "
        f"{len(report['flagged'])} flagged / {run['watchlist_size']} watched.",
        '',
    ]
    if report['flagged']:
        lines += ['## Flagged events', '',
                  '| event | product | flags | recent/day | baseline/day | drop% | first seen | last seen | instrumented | in code? |',
                  '| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |']
        for f in report['flagged']:
            lines.append(
                f"| {f['event']} | {f['product']} | {', '.join(f['flags'])} | "
                f"{f['recent_rate']:g} | {f['baseline_rate']:g} | {f['drop_pct']:g}% | "
                f"{f['first_seen_date'] or '?'} | {f['last_seen'] or 'never'} | "
                f"{_fmt_instrumented(f.get('instrumented'))} | {_fmt_code_status(f)} |"
            )
        lines += ['',
                  '`in code?` = is the event\'s `trackEvent` string still in gp-webapp/gp-api '
                  'at HEAD. **removed** → instrumentation was deleted/renamed (drop is '
                  'explained — check the removal PR); **present** + flatline → call site '
                  'still there but not firing (likely a real break).', '']

        # Per-event replacement timeline: the key signal is the flagged event's last
        # fired date vs. each same-family new event's first-seen / instrumented date.
        timelines = [f for f in report['flagged'] if f.get('candidate_replacements')]
        if timelines:
            lines += ['## Candidate replacements (timeline)', '',
                      'Same-family events that appeared recently. Compare the flagged '
                      "event's **last fired** date with each candidate's **first seen** "
                      'date to judge whether it is a rename/replacement.', '']
            for f in timelines:
                lines.append(f"**{f['event']}** — last fired "
                             f"{f['last_seen'] or 'never'}:")
                for c in f['candidate_replacements']:
                    lines.append(
                        f"- {c['event']} · first seen {c['first_seen_date']} · "
                        f"instrumented {_fmt_instrumented(c.get('instrumented'))} · "
                        f"lifetime vol {c['event_count']}"
                    )
                lines.append('')
    else:
        lines += ['No flatlines or hard drops detected.', '']

    new_events = report['new_events_in_watched_families']
    if new_events:
        lines += ['## New events in watched families (review for watchlist)', '',
                  'Newest first. Add the ones that are real funnel/activation milestones; '
                  'skip pure UI micro-interactions (individual hovers/clicks).', '',
                  '| event | family | first seen | instrumented | lifetime vol |',
                  '| --- | --- | --- | --- | --- |']
        for e in new_events:
            lines.append(f"| {e['event']} | {e['family']} | {e['first_seen_date']} | "
                         f"{_fmt_instrumented(e.get('instrumented'))} | {e['event_count']} |")
        lines += ['', '### Ready-to-paste watchlist rows', '',
                   'Copy the rows you agree on into `monitored_events.yaml` under `events:`.',
                   '', '```yaml']
        for e in new_events:
            product = 'win' if str(e['family']).startswith('win') else 'serve'
            lines.append(f"  - {{event: \"{e['event']}\", product: {product}, "
                         f"family: {e['family']}, floor: null, owner: TBD}}")
        lines += ['```', '']
    return '\n'.join(lines)


def parse_args(argv):
    p = argparse.ArgumentParser(description=__doc__,
                                formatter_class=argparse.RawDescriptionHelpFormatter)
    here = os.path.dirname(__file__)
    p.add_argument('--watchlist', default=os.path.join(here, 'monitored_events.yaml'))
    p.add_argument('--out', default=os.path.join(here, 'analytics_event_health_report.json'),
                   help='Path for the JSON report (overwritten each run).')
    p.add_argument('--log', default=os.path.join(here, 'event-health-log.md'),
                   help='Markdown log appended to on every run (a growing history).')
    p.add_argument('--no-log', action='store_true', help='Do not append to the markdown log.')
    p.add_argument('--no-git', action='store_true',
                   help='Skip the git lookup for when each event was instrumented.')
    p.add_argument('--git-timeout', type=int, default=20,
                   help='Per-lookup timeout (seconds) for the git instrumentation check.')
    p.add_argument('--end-date', default=None,
                   help='YYYY-MM-DD run "as of" date (default: today). Use for replay.')
    p.add_argument('--window-days', type=int, default=DEFAULTS['window_days'])
    p.add_argument('--recent-days', type=int, default=DEFAULTS['recent_days'])
    p.add_argument('--lag-days', type=int, default=DEFAULTS['lag_days'])
    p.add_argument('--drop-fraction', type=float, default=DEFAULTS['drop_fraction'])
    p.add_argument('--min-active-volume', type=int, default=DEFAULTS['min_active_volume'])
    return p.parse_args(argv)


def append_log(log_path, markdown, generated_at):
    """Append this run's markdown to a single growing log file."""
    parent = os.path.dirname(log_path)
    if parent:
        os.makedirs(parent, exist_ok=True)
    with open(log_path, 'a') as f:
        f.write(f'\n\n<!-- ===== run {generated_at} ===== -->\n\n')
        f.write(markdown)
        f.write('\n')


def main(argv=None):
    args = parse_args(argv if argv is not None else sys.argv[1:])
    end_date = (datetime.strptime(args.end_date, '%Y-%m-%d').date()
                if args.end_date else date.today())
    opts = {
        'window_days': args.window_days,
        'recent_days': args.recent_days,
        'lag_days': args.lag_days,
        'drop_fraction': args.drop_fraction,
        'min_active_volume': args.min_active_volume,
    }
    report = run(args.watchlist, end_date, opts,
                 with_git=not args.no_git, git_timeout=args.git_timeout)
    report['run']['generated_at'] = datetime.now().isoformat(timespec='seconds')

    markdown = render_markdown(report)
    with open(args.out, 'w') as f:
        json.dump(report, f, indent=2)
    print(markdown)
    print(f'\nJSON report written to {args.out}', file=sys.stderr)
    if not args.no_log:
        append_log(args.log, markdown, report['run']['generated_at'])
        print(f'Markdown appended to {args.log}', file=sys.stderr)


if __name__ == '__main__':
    main()
