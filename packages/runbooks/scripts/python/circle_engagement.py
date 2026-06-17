import os
import sys
from collections import defaultdict
from datetime import datetime, timezone
from typing import Iterable

from dotenv import load_dotenv

from circle_query import get

load_dotenv(os.path.join(os.path.dirname(__file__), '..', '.env'))


def _parse(ts: str | None) -> datetime | None:
    if not ts:
        return None
    return datetime.fromisoformat(ts.replace('Z', '+00:00'))


def active_within(members: Iterable[dict], now: datetime, days: int) -> int:
    count = 0
    for m in members:
        ts = _parse(m.get('last_seen_at'))
        if ts and (now - ts).total_seconds() <= days * 86400:
            count += 1
    return count


def stickiness(dau: int, mau: int) -> float:
    return dau / mau if mau else 0.0


def contribution_buckets(members: Iterable[dict]) -> dict:
    buckets = {"lurkers": 0, "commenters": 0, "creators": 0}
    for m in members:
        posts = m.get('posts_count') or 0
        comments = m.get('comments_count') or 0
        if posts > 0:
            buckets["creators"] += 1
        elif comments > 0:
            buckets["commenters"] += 1
        else:
            buckets["lurkers"] += 1
    return buckets


def cohort_retention(members: Iterable[dict], now: datetime) -> dict:
    cohorts: dict[str, list[dict]] = defaultdict(list)
    for m in members:
        created = _parse(m.get('created_at'))
        if not created:
            continue
        key = f"{created.year:04d}-{created.month:02d}"
        cohorts[key].append(m)
    out = {}
    for key, ms in cohorts.items():
        joined = len(ms)
        active = active_within(ms, now, days=30)
        out[key] = {
            "joined": joined,
            "active_30d": active,
            "rate": round(active / joined, 4) if joined else 0.0,
        }
    return out


def paginate(path: str, api_key: str, params: dict | None = None) -> list[dict]:
    records = []
    page = 1
    while True:
        p = dict(params or {})
        p.update({'page': page, 'per_page': 100})
        resp = get(path, api_key=api_key, params=p)
        records.extend(resp.get('records', []))
        if not resp.get('has_next_page'):
            break
        page += 1
    return records


def _content_rate(posts: list[dict], now: datetime, days: int) -> dict:
    cutoff = now.timestamp() - days * 86400
    recent = [p for p in posts if _parse(p.get('created_at')) and _parse(p['created_at']).timestamp() >= cutoff]
    total_likes = sum(p.get('likes_count') or 0 for p in recent)
    total_comments = sum(p.get('comments_count') or 0 for p in recent)
    return {
        "posts": len(recent),
        "posts_per_day": round(len(recent) / days, 2),
        "likes": total_likes,
        "comments": total_comments,
        "likes_per_post": round(total_likes / len(recent), 2) if recent else 0,
        "comments_per_post": round(total_comments / len(recent), 2) if recent else 0,
        "unique_authors": len({p.get('user_id') for p in recent if p.get('user_id')}),
    }


def _top_spaces(posts: list[dict], now: datetime, days: int, n: int = 5) -> list[tuple[str, int, int, int]]:
    cutoff = now.timestamp() - days * 86400
    recent = [p for p in posts if _parse(p.get('created_at')) and _parse(p['created_at']).timestamp() >= cutoff]
    by_space: dict[str, dict] = defaultdict(lambda: {"posts": 0, "likes": 0, "comments": 0})
    for p in recent:
        s = p.get('space_name') or 'unknown'
        by_space[s]["posts"] += 1
        by_space[s]["likes"] += p.get('likes_count') or 0
        by_space[s]["comments"] += p.get('comments_count') or 0
    ranked = sorted(
        by_space.items(),
        key=lambda kv: kv[1]["posts"] + kv[1]["comments"] + kv[1]["likes"],
        reverse=True,
    )
    return [(name, v["posts"], v["likes"], v["comments"]) for name, v in ranked[:n]]


def _top_contributors(members: list[dict], n: int = 10) -> list[tuple[str, int, int, int]]:
    ranked = sorted(
        members,
        key=lambda m: (m.get('posts_count') or 0) * 3 + (m.get('comments_count') or 0),
        reverse=True,
    )
    return [
        (
            m.get('name') or 'unknown',
            m.get('posts_count') or 0,
            m.get('comments_count') or 0,
            (m.get('gamification_stats') or {}).get('total_points') or 0,
        )
        for m in ranked[:n]
    ]


def report(members: list[dict], posts: list[dict], now: datetime) -> str:
    total = len(members)
    dau = active_within(members, now, 1)
    wau = active_within(members, now, 7)
    mau = active_within(members, now, 30)
    never_seen = sum(1 for m in members if not m.get('last_seen_at'))
    buckets = contribution_buckets(members)
    posters_30d = {p.get('user_id') for p in posts if p.get('user_id') and _parse(p.get('created_at')) and (now - _parse(p['created_at'])).days <= 30}

    c30 = _content_rate(posts, now, 30)
    c7 = _content_rate(posts, now, 7)

    def pct(num: int, denom: int) -> str:
        return f"{num / denom:.1%}" if denom else "n/a"

    lines = []
    lines.append(f"Report window: now = {now.isoformat()}")
    lines.append("")
    lines.append("=== Community size ===")
    lines.append(f"  Total members:        {total:,}")
    lines.append(f"  Never seen (signup only): {never_seen:,} ({pct(never_seen, total)})")
    lines.append("")
    lines.append("=== Activity (by last_seen_at) ===")
    lines.append(f"  DAU (1d):  {dau:,} ({pct(dau, total)} of total)")
    lines.append(f"  WAU (7d):  {wau:,} ({pct(wau, total)} of total)")
    lines.append(f"  MAU (30d): {mau:,} ({pct(mau, total)} of total)")
    lines.append(f"  Stickiness (DAU/MAU): {stickiness(dau, mau):.1%}  [industry rule-of-thumb: >20% = sticky]")
    lines.append(f"  Stickiness (WAU/MAU): {stickiness(wau, mau):.1%}")
    lines.append("")
    lines.append("=== Contribution (1% rule check, lifetime) ===")
    lines.append(f"  Creators (posted):    {buckets['creators']:,} ({pct(buckets['creators'], total)})")
    lines.append(f"  Commenters only:      {buckets['commenters']:,} ({pct(buckets['commenters'], total)})")
    lines.append(f"  Lurkers (never posted or commented): {buckets['lurkers']:,} ({pct(buckets['lurkers'], total)})")
    lines.append(f"  Active posters last 30d: {len(posters_30d):,} ({pct(len(posters_30d), mau)} of MAU)")
    lines.append("")
    lines.append("=== Content rate ===")
    lines.append(f"  Last 7d:  {c7['posts']} posts ({c7['posts_per_day']}/day) · {c7['likes_per_post']} likes/post · {c7['comments_per_post']} comments/post · {c7['unique_authors']} unique authors")
    lines.append(f"  Last 30d: {c30['posts']} posts ({c30['posts_per_day']}/day) · {c30['likes_per_post']} likes/post · {c30['comments_per_post']} comments/post · {c30['unique_authors']} unique authors")
    lines.append("")
    lines.append("=== Top spaces, last 30d (posts / likes / comments) ===")
    for name, p, l, c in _top_spaces(posts, now, 30, 8):
        lines.append(f"  {p:>4} posts  {l:>4} likes  {c:>4} comments   {name}")
    lines.append("")
    lines.append("=== Top contributors (lifetime, posts weighted 3x) ===")
    for name, p, c, pts in _top_contributors(members, 10):
        lines.append(f"  {p:>3} posts  {c:>4} comments  {pts:>5} pts   {name}")
    lines.append("")
    lines.append("=== Cohort retention (% of signup month still active in last 30d) ===")
    cohorts = cohort_retention(members, now)
    for key in sorted(cohorts.keys())[-12:]:
        row = cohorts[key]
        lines.append(f"  {key}  joined={row['joined']:>4}  active_30d={row['active_30d']:>4}  retention={row['rate']:.1%}")
    return "\n".join(lines)


if __name__ == '__main__':
    api_key = os.environ.get('CIRCLE_API_KEY')
    if not api_key:
        print('ERROR: CIRCLE_API_KEY not set in scripts/.env', file=sys.stderr)
        sys.exit(2)
    now = datetime.now(tz=timezone.utc)
    print('Fetching members...', file=sys.stderr)
    members = paginate('community_members', api_key)
    print(f'  got {len(members):,} members', file=sys.stderr)
    print('Fetching posts...', file=sys.stderr)
    posts = paginate('posts', api_key, params={'sort': 'latest'})
    print(f'  got {len(posts):,} posts', file=sys.stderr)
    print()
    print(report(members, posts, now))
