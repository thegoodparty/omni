"""Segment Public API helper for the segment-event-to-hubspot skill.

Read and write destination subscriptions (Action mappings) — the Segment half
of routing a backend event into HubSpot. Subscriptions are created DISABLED by
default: the Segment workspace is production, so enabling a subscription is an
explicit human step.

Usage:
  uv run segment_destination_mapping.py list-destinations
  uv run segment_destination_mapping.py list-subscriptions <destinationId>
  uv run segment_destination_mapping.py show-subscription <destinationId> <subscriptionId>
  uv run segment_destination_mapping.py create-subscription <destinationId> --file payload.json
  uv run segment_destination_mapping.py update-subscription <destinationId> <subscriptionId> --file payload.json
  uv run segment_destination_mapping.py enable-subscription <destinationId> <subscriptionId>

create-subscription payload shape (see the skill for how to build it):
  {
    "name": "Dispatch Skipped",
    "actionId": "...",            # optional; actionSlug used if omitted
    "actionSlug": "customEvent",
    "trigger": "type = \\"track\\" and event = \\"...\\" and properties.email != null",
    "settings": { "event_name": "...", "properties": { ... }, ... }
  }
"""

import argparse
import json
import os
import sys
from typing import Any

import requests
from dotenv import load_dotenv

load_dotenv(os.path.join(os.path.dirname(__file__), '..', '.env'))

BASE_URL = 'https://api.segmentapis.com'


def request(
    method: str,
    path: str,
    body: dict[str, Any] | None = None,
) -> dict[str, Any]:
    token = os.environ.get('SEGMENT_PUBLIC_API_TOKEN')
    if not token:
        print(
            'ERROR: SEGMENT_PUBLIC_API_TOKEN not set in scripts/.env',
            file=sys.stderr,
        )
        sys.exit(2)
    response = requests.request(
        method,
        f'{BASE_URL}{path}',
        headers={'Authorization': f'Bearer {token}'},
        json=body,
        timeout=30,
    )
    if not response.ok:
        print(
            f'ERROR: {method} {path} -> HTTP {response.status_code}\n'
            f'{response.text[:1000]}',
            file=sys.stderr,
        )
        sys.exit(1)
    return response.json()


def list_destinations() -> None:
    sources = {
        s['id']: s['slug']
        for s in request('GET', '/sources?pagination.count=100')['data']['sources']
    }
    destinations = request('GET', '/destinations?pagination.count=100')
    rows = [
        {
            'id': d['id'],
            'name': d['name'],
            'type': d.get('metadata', {}).get('slug'),
            'sourceSlug': sources.get(d.get('sourceId'), d.get('sourceId')),
            'enabled': d.get('enabled'),
        }
        for d in destinations['data']['destinations']
    ]
    print(json.dumps(rows, indent=2))


def list_subscriptions(destination_id: str) -> None:
    data = request(
        'GET',
        f'/destinations/{destination_id}/subscriptions?pagination.count=100',
    )
    rows = [
        {
            'id': s['id'],
            'name': s.get('name'),
            'actionSlug': s.get('actionSlug'),
            'enabled': s.get('enabled'),
            'trigger': s.get('trigger'),
            'eventName': (s.get('settings') or {}).get('event_name'),
            'mappedFields': sorted((s.get('settings') or {}).get('properties') or {}),
        }
        for s in data['data'].get('subscriptions', [])
    ]
    print(json.dumps(rows, indent=2))


def show_subscription(destination_id: str, subscription_id: str) -> None:
    data = request(
        'GET',
        f'/destinations/{destination_id}/subscriptions/{subscription_id}',
    )
    print(json.dumps(data['data'], indent=2))


def create_subscription(destination_id: str, payload_path: str) -> None:
    with open(payload_path) as f:
        payload = json.load(f)
    payload['enabled'] = False
    data = request(
        'POST',
        f'/destinations/{destination_id}/subscriptions',
        payload,
    )
    print(json.dumps(data['data'], indent=2))
    print(
        'Created DISABLED. Enable with enable-subscription after human review.',
        file=sys.stderr,
    )


def update_subscription(
    destination_id: str,
    subscription_id: str,
    payload_path: str,
) -> None:
    with open(payload_path) as f:
        payload = json.load(f)
    # enabling is reserved for enable-subscription so a payload file can
    # never silently activate a live production subscription
    payload.pop('enabled', None)
    data = request(
        'PATCH',
        f'/destinations/{destination_id}/subscriptions/{subscription_id}',
        payload,
    )
    print(json.dumps(data['data'], indent=2))


def enable_subscription(destination_id: str, subscription_id: str) -> None:
    data = request(
        'PATCH',
        f'/destinations/{destination_id}/subscriptions/{subscription_id}',
        {'enabled': True},
    )
    print(json.dumps(data['data'], indent=2))


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest='command', required=True)
    sub.add_parser('list-destinations')
    p = sub.add_parser('list-subscriptions')
    p.add_argument('destination_id')
    p = sub.add_parser('show-subscription')
    p.add_argument('destination_id')
    p.add_argument('subscription_id')
    p = sub.add_parser('create-subscription')
    p.add_argument('destination_id')
    p.add_argument('--file', required=True)
    p = sub.add_parser('update-subscription')
    p.add_argument('destination_id')
    p.add_argument('subscription_id')
    p.add_argument('--file', required=True)
    p = sub.add_parser('enable-subscription')
    p.add_argument('destination_id')
    p.add_argument('subscription_id')

    args = parser.parse_args()
    if args.command == 'list-destinations':
        list_destinations()
    elif args.command == 'list-subscriptions':
        list_subscriptions(args.destination_id)
    elif args.command == 'show-subscription':
        show_subscription(args.destination_id, args.subscription_id)
    elif args.command == 'create-subscription':
        create_subscription(args.destination_id, args.file)
    elif args.command == 'update-subscription':
        update_subscription(args.destination_id, args.subscription_id, args.file)
    elif args.command == 'enable-subscription':
        enable_subscription(args.destination_id, args.subscription_id)
