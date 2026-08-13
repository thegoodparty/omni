"""HubSpot API helper for the segment-event-to-hubspot skill.

Covers the HubSpot half of routing a backend Segment event into HubSpot:
custom event definitions, contact-property similarity search and creation,
on-demand test occurrences, and Automation v4 workflows.

Token selection: reads HUBSPOT_SANDBOX_TOKEN from scripts/.env by default.
Pass --token-env HUBSPOT_MAPPING_PROD_TOKEN (or any var name) to target
another portal. Prod writes require the skill's human approval gate.

Usage:
  uv run hubspot_event_mapping.py list-event-definitions [--search s]
  uv run hubspot_event_mapping.py create-event-definition --file payload.json
  uv run hubspot_event_mapping.py similar-properties <field> [<field> ...]
  uv run hubspot_event_mapping.py create-contact-property --file payload.json
  uv run hubspot_event_mapping.py send-test --event-name <fqn> --email <email> --file props.json
  uv run hubspot_event_mapping.py get-contact <email> --properties a,b,c
  uv run hubspot_event_mapping.py get-flow <flowId>
  uv run hubspot_event_mapping.py create-flow --file payload.json
"""

import argparse
import json
import os
import sys
from typing import Any
from urllib.parse import quote_plus

import requests
from dotenv import load_dotenv
from rapidfuzz import fuzz

load_dotenv(os.path.join(os.path.dirname(__file__), '..', '.env'))

BASE_URL = 'https://api.hubapi.com'
TOKEN_ENV_DEFAULT = 'HUBSPOT_SANDBOX_TOKEN'
_token_env = TOKEN_ENV_DEFAULT


def request(
    method: str,
    path: str,
    body: dict[str, Any] | None = None,
    ok_statuses: tuple[int, ...] = (200, 201, 204),
) -> dict[str, Any]:
    token = os.environ.get(_token_env)
    if not token:
        print(f'ERROR: {_token_env} not set in scripts/.env', file=sys.stderr)
        sys.exit(2)
    response = requests.request(
        method,
        f'{BASE_URL}{path}',
        headers={'Authorization': f'Bearer {token}'},
        json=body,
        timeout=30,
    )
    if response.status_code not in ok_statuses:
        print(
            f'ERROR: {method} {path} -> HTTP {response.status_code}\n'
            f'{response.text[:1000]}',
            file=sys.stderr,
        )
        sys.exit(1)
    return response.json() if response.content else {}


def list_event_definitions(search: str | None) -> None:
    query = f'&searchString={quote_plus(search)}' if search else ''
    data = request('GET', f'/events/v3/event-definitions?limit=100{query}')
    rows = [
        {
            'fullyQualifiedName': d['fullyQualifiedName'],
            'id': d.get('id'),
            'objectTypeId': d.get('objectTypeId'),
            'label': (d.get('labels') or {}).get('singular'),
            'properties': [
                p['name']
                for p in (d.get('properties') or [])
                if not p['name'].startswith('hs_')
            ],
        }
        for d in data.get('results', [])
    ]
    print(json.dumps(rows, indent=2))


def create_event_definition(payload_path: str) -> None:
    with open(payload_path) as f:
        payload = json.load(f)
    request('POST', '/events/v3/event-definitions', payload)
    # the POST 201 body is empty, so fetch by exact name to hand the caller
    # the fullyQualifiedName + objectTypeId the later steps need
    data = request('GET', f"/events/v3/event-definitions/{payload['name']}")
    print(json.dumps(data, indent=2))


def fetch_all_contact_properties() -> list[dict[str, Any]]:
    results: list[dict[str, Any]] = []
    after: str | None = None
    while True:
        path = '/crm/v3/properties/contacts'
        if after:
            path += f'?after={quote_plus(after)}'
        data = request('GET', path)
        results.extend(data.get('results', []))
        after = ((data.get('paging') or {}).get('next') or {}).get('after')
        if not after:
            return results


def similar_properties(fields: list[str], limit: int) -> None:
    existing = fetch_all_contact_properties()
    report = {}
    for field in fields:
        scored = []
        for prop in existing:
            score = max(
                fuzz.token_set_ratio(field.lower(), prop['name'].lower()),
                fuzz.token_set_ratio(field.lower(), (prop.get('label') or '').lower()),
            )
            scored.append((score, prop))
        scored.sort(key=lambda pair: pair[0], reverse=True)
        report[field] = [
            {
                'score': score,
                'name': prop['name'],
                'label': prop.get('label'),
                'type': prop.get('type'),
                'description': (prop.get('description') or '')[:120],
            }
            for score, prop in scored[:limit]
        ]
    print(json.dumps(report, indent=2))


def create_contact_property(payload_path: str) -> None:
    with open(payload_path) as f:
        payload = json.load(f)
    print(json.dumps(request('POST', '/crm/v3/properties/contacts', payload), indent=2))


def send_test(event_name: str, email: str, props_path: str) -> None:
    with open(props_path) as f:
        properties = json.load(f)
    request(
        'POST',
        '/events/v3/send',
        {'eventName': event_name, 'email': email, 'properties': properties},
    )
    print(f'sent {event_name} for {email}: accepted')


def get_contact(email: str, properties: str) -> None:
    data = request(
        'POST',
        '/crm/v3/objects/contacts/search',
        {
            'filterGroups': [
                {
                    'filters': [
                        {
                            'propertyName': 'email',
                            'operator': 'EQ',
                            'value': email,
                        }
                    ]
                }
            ],
            'properties': properties.split(','),
            'limit': 1,
        },
    )
    print(json.dumps(data.get('results', []), indent=2))


def get_flow(flow_id: str) -> None:
    print(json.dumps(request('GET', f'/automation/v4/flows/{flow_id}'), indent=2))


def create_flow(payload_path: str) -> None:
    with open(payload_path) as f:
        payload = json.load(f)
    payload['isEnabled'] = False
    data = request('POST', '/automation/v4/flows', payload)
    print(json.dumps({'id': data.get('id'), 'name': data.get('name')}, indent=2))
    print('Created DISABLED. Enable in the HubSpot UI after review.', file=sys.stderr)


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--token-env', default=TOKEN_ENV_DEFAULT)
    sub = parser.add_subparsers(dest='command', required=True)
    p = sub.add_parser('list-event-definitions')
    p.add_argument('--search')
    p = sub.add_parser('create-event-definition')
    p.add_argument('--file', required=True)
    p = sub.add_parser('similar-properties')
    p.add_argument('fields', nargs='+')
    p.add_argument('--limit', type=int, default=5)
    p = sub.add_parser('create-contact-property')
    p.add_argument('--file', required=True)
    p = sub.add_parser('send-test')
    p.add_argument('--event-name', required=True)
    p.add_argument('--email', required=True)
    p.add_argument('--file', required=True)
    p = sub.add_parser('get-contact')
    p.add_argument('email')
    p.add_argument('--properties', required=True)
    p = sub.add_parser('get-flow')
    p.add_argument('flow_id')
    p = sub.add_parser('create-flow')
    p.add_argument('--file', required=True)

    args = parser.parse_args()
    _token_env = args.token_env
    if args.command == 'list-event-definitions':
        list_event_definitions(args.search)
    elif args.command == 'create-event-definition':
        create_event_definition(args.file)
    elif args.command == 'similar-properties':
        similar_properties(args.fields, args.limit)
    elif args.command == 'create-contact-property':
        create_contact_property(args.file)
    elif args.command == 'send-test':
        send_test(args.event_name, args.email, args.file)
    elif args.command == 'get-contact':
        get_contact(args.email, args.properties)
    elif args.command == 'get-flow':
        get_flow(args.flow_id)
    elif args.command == 'create-flow':
        create_flow(args.file)
