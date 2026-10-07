-- One-time backfill: title-case names typed in all lowercase, matching
-- normalizePersonName. Mixed-case and all-caps names are left as typed.
UPDATE "user"
SET first_name = initcap(first_name)
WHERE first_name = lower(first_name)
  AND first_name <> initcap(first_name);

UPDATE "user"
SET last_name = initcap(last_name)
WHERE last_name = lower(last_name)
  AND last_name <> initcap(last_name);

UPDATE "user"
SET name = initcap(name)
WHERE name = lower(name)
  AND name <> initcap(name);

UPDATE campaign
SET data = jsonb_set(data, '{name}', to_jsonb(initcap(data->>'name')))
WHERE data->>'name' = lower(data->>'name')
  AND data->>'name' <> initcap(data->>'name');
