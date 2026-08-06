-- Strip the dead `filters` array from every campaign.data.customVoterFiles entry.
--
-- Nothing writes customVoterFiles any more, and after this release nothing reads
-- the `filters` field: the only consumer was the RecordCount component's
-- isCustom branch, which was never rendered and is deleted in this change.
-- gp-admin displays only name/channel/purpose/createdAt, and HubSpot's
-- voter_files_created reads the array length, so both are unaffected.
--
-- The arrays still contained `audience_firstTimeVoters`, a value this release
-- retires, in 119320 entries across 874 campaigns. Removing the field rather
-- than the value leaves nothing stale to misread later.
UPDATE campaign c
SET data = jsonb_set(
      c.data,
      '{customVoterFiles}',
      (
        SELECT coalesce(jsonb_agg(entry - 'filters' ORDER BY idx), '[]'::jsonb)
        FROM jsonb_array_elements(c.data->'customVoterFiles')
             WITH ORDINALITY AS t(entry, idx)
      )
    )
WHERE jsonb_typeof(c.data->'customVoterFiles') = 'array'
  AND EXISTS (
        SELECT 1
        FROM jsonb_array_elements(c.data->'customVoterFiles') AS e(entry)
        WHERE entry ? 'filters'
      );
