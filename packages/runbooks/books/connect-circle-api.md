Query the Circle (community platform) Admin API v2 to understand how members engage — posts, comments, reactions, spaces.

## Prerequisites

**scripts/.env variables**: `CIRCLE_API_KEY`
**Tools**: `uv` (for Python scripts)

Generate the API token from Circle: Admin Dashboard → Settings → Developers → API tokens. Paste the token into `scripts/.env` as `CIRCLE_API_KEY=...`. Admin API v2 uses `Authorization: Bearer <token>`.

Base URL: `https://app.circle.so/api/admin/v2/`
Docs: https://api.circle.so/

## Steps

1. Add the token to `scripts/.env`:
   ```
   CIRCLE_API_KEY=your_token_here
   ```

2. List spaces (top-level content areas):
   ```bash
   cd scripts/python && uv run circle_query.py spaces
   ```

3. List recent posts across the community:
   ```bash
   cd scripts/python && uv run circle_query.py posts per_page=50 sort=latest
   ```

4. List members:
   ```bash
   cd scripts/python && uv run circle_query.py community_members per_page=100
   ```

5. Filter engagement on a single space (replace `<space_id>`):
   ```bash
   cd scripts/python && uv run circle_query.py posts space_id=<space_id> per_page=50
   cd scripts/python && uv run circle_query.py comments space_id=<space_id>
   ```

### Programmatic use

Import the `get()` helper to pull data into a script or notebook:

```python
from circle_query import get
import os

key = os.environ['CIRCLE_API_KEY']
spaces = get('/spaces', api_key=key, params={'per_page': 100})
posts = get('/posts', api_key=key, params={'per_page': 100, 'sort': 'latest'})
```

Each call returns the decoded JSON response. Paginate with `page` and `per_page` query params (max 100 per page per Circle docs).

## Engagement signals to look at

| Resource | Useful fields | What it tells you |
|----------|---------------|-------------------|
| `posts` | `user_likes_count`, `comments_count`, `user_views_count`, `created_at` | Which content resonates; volume over time |
| `comments` | `body`, `user_likes_count`, `user_id` | Conversation depth, active commenters |
| `community_members` | `last_seen_at`, `posts_count`, `comments_count` | Active vs dormant members |
| `spaces` | `members_count`, `posts_count` | Which spaces are alive vs ghost towns |

## Troubleshooting

| Failure | Fix |
|---------|-----|
| `401 Unauthorized` | Token missing or expired — regenerate in Circle admin |
| `403 Forbidden` | Token belongs to a non-admin; Admin API requires admin-level token |
| `404` on a path | Check endpoint name — use `/api/admin/v2/` base, not `/api/v1/` |
| Empty results | Confirm the token is scoped to the right community (multi-community admins) |
