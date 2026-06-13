Generate a full engagement snapshot for the Circle community — DAU/WAU/MAU, stickiness, contribution mix, content rate, top spaces, top contributors, and cohort retention.

## Prerequisites

**scripts/.env variables**: `CIRCLE_API_KEY`
**Tools**: `uv`
**Companion book**: `books/connect-circle-api.md` (token setup)

## Steps

1. Confirm the token is set in `scripts/.env` (see `books/connect-circle-api.md`).

2. Run the report:
   ```bash
   cd scripts/python && uv run circle_engagement.py
   ```

   The script paginates `/community_members` and `/posts` (Admin API v2), then prints a plain-text report. Takes ~10–30s depending on community size. Report is written to stdout; progress lines go to stderr.

3. (Optional) Save to a timestamped file for comparison:
   ```bash
   cd scripts/python && uv run circle_engagement.py > /tmp/circle-$(date +%Y-%m-%d).txt
   ```

## What the report contains

| Section | What it measures | Data source |
|---------|------------------|-------------|
| Community size | Total members; signed-up-but-never-seen | `community_members.last_seen_at` |
| Activity | DAU (1d), WAU (7d), MAU (30d), stickiness ratios | `last_seen_at` windowed against `now` |
| Contribution | Creators (posted ≥1), commenters only, lurkers; % of MAU who posted last 30d | `posts_count`, `comments_count` (lifetime); post authors (30d) |
| Content rate | Posts/day, likes/post, comments/post, unique authors (7d + 30d) | `/posts` sorted latest |
| Top spaces | Posts / likes / comments per space, last 30d | `space_name` on recent posts |
| Top contributors | Highest posts × 3 + comments, lifetime | `community_members` sorted |
| Cohort retention | Signup month → % active in last 30d | `created_at` bucketed by month |

## How to read it

| Metric | Healthy range | What it means |
|---|---|---|
| **DAU/MAU stickiness** | >20% = sticky, >50% = habit | Daily habit vs. monthly drop-in. Low = community is a destination, not a routine. |
| WAU/MAU | >40% | Members who come back multiple times per month |
| Creator-of-MAU (% of MAU who posted 30d) | Trend matters more than level | If most active members only consume, engagement is shallow |
| Creators/Commenters/Lurkers | Typical: 1/9/90 (1% rule). Healthy communities: 5/15/80+ | Lurker-heavy is normal; creator-share above 5% is strong |
| Cohort 30d retention | Improving recent cohorts = product/onboarding wins | Declining = growth is leaky |
| Top-10 contributor share | Flag if >50% of content | Concentration risk — power-user churn hurts visibly |
| Likes/post and comments/post trend | Rising = deeper engagement | Falling while volume rises = promotional/drive-by posting |

## Troubleshooting

| Failure | Fix |
|---------|-----|
| `CIRCLE_API_KEY not set` | See `books/connect-circle-api.md` to generate and place the token |
| `401 Unauthorized` | Token expired — regenerate in Circle admin |
| Script hangs | Community likely >10k members; let pagination finish (1 page/sec) or reduce by editing `paginate()` filters |
| Zero posts in "Last 7d" | Confirm with `uv run circle_query.py posts per_page=5 sort=latest` — may be a genuinely quiet week |

## Extending the report

The pure metric functions in `scripts/python/circle_engagement.py` are independently testable and importable:

```python
from circle_engagement import active_within, stickiness, contribution_buckets, cohort_retention, paginate
```

Add new metrics by writing a failing test in `test_circle_engagement.py` first, then implementing. See that file for the existing test pattern.
