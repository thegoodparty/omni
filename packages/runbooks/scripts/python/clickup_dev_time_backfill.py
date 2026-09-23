"""Backfill dev-cycle duration columns on a ClickUp list from status history.

Computes three per-task durations, in days, and writes them to number custom
fields so they can be shown as columns (e.g. the "Dev Retroactive" view on the
Problems Roadmap board):

    Technical Design Time  "Technical Design Complete" date  - entered "in progress"
    Total Dev Time         entered "shipped"                 - entered "in progress"
    Estimated Dev Time     "Shipped Goal" date               - entered "in progress"

The "entered <status>" timestamps come from GET /task/{id}/time_in_status.
ClickUp formula fields cannot reach status history at all, and formula fields
created through the API never compute (they come back with no
calculation_state), so these have to be plain number fields refreshed by
re-running this script.

`time_in_status` reports the MOST RECENT entry into a status, not the first.
A task that moved backward and re-entered "in progress" measures its final
stint, not the whole span. That can put the "in progress" anchor after the end
of the window (re-opened after shipping, or a hand-entered date that predates
dev start), which would yield a negative duration; those are reported and left
empty rather than written.

Usage:
    uv run clickup_dev_time_backfill.py --dry-run
    uv run clickup_dev_time_backfill.py
    uv run clickup_dev_time_backfill.py --list-id 901327608453 --view-id 2ky4jq2q-152413

Reads CLICKUP_API_TOKEN from the environment or ../.env.
"""

import argparse
import os
import sys
import time
from pathlib import Path

import requests
from dotenv import load_dotenv

load_dotenv(Path(__file__).resolve().parents[1] / '.env')

API = 'https://api.clickup.com/api/v2'
TIMEOUT = 30
DAY_MS = 86400000

DEFAULT_LIST_ID = '901327608453'
DEFAULT_VIEW_ID = '2ky4jq2q-152413'

START_STATUS = 'in progress'
SHIPPED_STATUS = 'shipped'

TD_COMPLETE_FIELD = 'Technical Design Complete'
SHIPPED_GOAL_FIELD = 'Shipped Goal'

METRIC_FIELDS = ['Technical Design Time', 'Total Dev Time', 'Estimated Dev Time']


def call(method, path, token, params=None, payload=None):
    retries = 0
    while True:
        r = requests.request(
            method.upper(),
            f'{API}/{path.lstrip("/")}',
            headers={'Authorization': token, 'Content-Type': 'application/json'},
            params=params,
            json=payload,
            timeout=TIMEOUT,
        )
        if r.status_code == 429:
            if retries >= 5:
                raise RuntimeError(f'rate limited after 5 retries: {method} {path}')
            retries += 1
            time.sleep(int(r.headers.get('Retry-After', 10)))
            continue
        r.raise_for_status()
        return r.json() if r.content else None


def fetch_tasks(list_id, token):
    tasks, page = [], 0
    while True:
        body = call(
            'GET',
            f'list/{list_id}/task',
            token,
            params={
                'include_closed': 'true',
                'subtasks': 'false',
                'page': page,
                'limit': 100,
            },
        )
        tasks.extend(body['tasks'])
        if 'last_page' not in body:
            raise RuntimeError('ClickUp task page omitted last_page; refusing to guess')
        if body['last_page']:
            return tasks
        page += 1


def fetch_status_history(task_ids, token):
    history = {}
    for i in range(0, len(task_ids), 100):
        chunk = task_ids[i : i + 100]
        body = call(
            'GET',
            'task/bulk_time_in_status/task_ids',
            token,
            params=[('task_ids', tid) for tid in chunk],
        )
        for tid, entry in body.items():
            history[tid] = {
                s['status']: int(s['total_time']['since'])
                for s in entry.get('status_history', [])
            }
    return history


def ensure_metric_fields(list_id, token):
    existing = {f['name']: f for f in call('GET', f'list/{list_id}/field', token)['fields']}
    ids = {}
    for name in METRIC_FIELDS:
        field = existing.get(name)
        if field is None:
            field = call(
                'POST',
                f'list/{list_id}/field',
                token,
                payload={'name': name, 'type': 'number', 'type_config': {'precision': 1}},
            )['field']
            print(f'created field "{name}" ({field["id"]})')
        elif field['type'] != 'number':
            sys.exit(f'field "{name}" already exists as type {field["type"]}, not number')
        ids[name] = field['id']
    return ids


def days_between(start_ms, end_ms):
    if start_ms is None or end_ms is None:
        return None
    return round((end_ms - start_ms) / DAY_MS, 1)


def date_field_value(task, name):
    for cf in task['custom_fields']:
        if cf['name'] == name and cf.get('value'):
            return int(cf['value'])
    return None


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--list-id', default=DEFAULT_LIST_ID)
    parser.add_argument('--view-id', default=DEFAULT_VIEW_ID)
    parser.add_argument('--dry-run', action='store_true')
    parser.add_argument('--skip-view', action='store_true', help='do not touch view columns')
    args = parser.parse_args()

    token = os.environ.get('CLICKUP_API_TOKEN')
    if not token:
        sys.exit('CLICKUP_API_TOKEN is not set')

    tasks = fetch_tasks(args.list_id, token)
    history = fetch_status_history([t['id'] for t in tasks], token)
    field_ids = {} if args.dry_run else ensure_metric_fields(args.list_id, token)

    writes = 0
    negatives = []
    print(f'\n{"TD":>6} {"Dev":>6} {"Est":>6}  task')
    for task in sorted(tasks, key=lambda t: t['name']):
        entered = history.get(task['id'], {})
        dev_start = entered.get(START_STATUS)
        values = {
            'Technical Design Time': days_between(
                dev_start, date_field_value(task, TD_COMPLETE_FIELD)
            ),
            'Total Dev Time': days_between(dev_start, entered.get(SHIPPED_STATUS)),
            'Estimated Dev Time': days_between(
                dev_start, date_field_value(task, SHIPPED_GOAL_FIELD)
            ),
        }
        for name in METRIC_FIELDS:
            if values[name] is not None and values[name] < 0:
                negatives.append((task['name'], name, values[name]))
                values[name] = None
        cells = ' '.join(
            f'{"-" if values[n] is None else values[n]:>6}' for n in METRIC_FIELDS
        )
        print(f'{cells}  {task["name"][:60]}')
        if args.dry_run:
            continue
        current = {cf['id']: cf.get('value') for cf in task['custom_fields']}
        for name in METRIC_FIELDS:
            field_id = field_ids[name]
            path = f'task/{task["id"]}/field/{field_id}'
            if values[name] is None:
                if current.get(field_id) is None:
                    continue
                call('DELETE', path, token)
            else:
                if current.get(field_id) is not None and float(current[field_id]) == values[name]:
                    continue
                call('POST', path, token, payload={'value': values[name]})
            writes += 1

    measured = sum(
        1 for t in tasks if history.get(t['id'], {}).get(START_STATUS) is not None
    )
    print(f'\n{len(tasks)} tasks, {measured} with a "{START_STATUS}" timestamp')
    for task_name, field_name, value in negatives:
        print(f'left empty: {field_name} was {value}d on "{task_name[:50]}"')

    if args.dry_run:
        print('dry run: nothing written')
        return
    print(f'{writes} field writes')

    if args.skip_view:
        return
    view = call('GET', f'view/{args.view_id}', token)['view']
    columns = view['columns']['fields']
    shown = {c['field'] for c in columns}
    next_idx = max((c['idx'] for c in columns), default=-1) + 1
    added = []
    for name in METRIC_FIELDS:
        key = f'cf_{field_ids[name]}'
        if key in shown:
            continue
        columns.append({'field': key, 'idx': next_idx, 'width': 160, 'hidden': False})
        next_idx += 1
        added.append(name)
    if not added:
        print('view already shows all three columns')
        return
    call(
        'PUT',
        f'view/{args.view_id}',
        token,
        payload={
            'name': view['name'],
            'type': view['type'],
            'grouping': view['grouping'],
            'divide': view['divide'],
            'sorting': view['sorting'],
            'filters': view['filters'],
            'columns': {'fields': columns},
            'team_sidebar': view['team_sidebar'],
            'settings': view['settings'],
        },
    )
    print(f'added columns to view: {", ".join(added)}')


if __name__ == '__main__':
    main()
