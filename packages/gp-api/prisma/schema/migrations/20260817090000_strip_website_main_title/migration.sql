-- Move the site headline out of website.content and derive it from the
-- candidate's name instead, preserving the headline for live Pro campaigns.
--
-- content.main.title was seeded once at site creation as "Vote For <name>" and
-- never revisited, so correcting a name in the profile never reached the
-- website. That divergence blocked two candidates' 10DLC registrations because
-- the live site named someone other than their filing. candidate-sites now
-- derives the hero and page <title> from campaign.user on every render, so the
-- stale copy has no reason to exist and is dropped here.
--
-- Dropping it outright would also erase 396 candidate-authored headlines. User
-- success asked that live Pro campaigns keep theirs, so those are copied into
-- website.legacy_title_override first, which the renderer prefers when set.
-- The exemption is an explicit ID list rather than a predicate on purpose: a
-- predicate like "title <> 'Vote For ' || name" would also have preserved 26
-- Pro sites whose headline names a DIFFERENT PERSON than the account holder
-- (e.g. "Vote For Michael Morrill" on Lefty Morrill's site) — the exact defect
-- this change exists to fix. Those 26 are deliberately left to derive.
--
-- The 47 rows below are the published Pro campaigns with a candidate-authored
-- headline and an election still ahead of them, as of 2026-08-20. Website 100
-- ('ds-test-candidate', headline "Test Title") matched that filter and is
-- deliberately excluded as test data.
ALTER TABLE website ADD COLUMN legacy_title_override TEXT;

UPDATE website
SET legacy_title_override = content -> 'main' ->> 'title'
WHERE id IN (
    496, 1652, 1658, 5413, 15711, 16204, 16567, 19472, 25378, 30262, 30724, 31450,
    32902, 34520, 34552, 34802, 34823, 34883, 34915, 35288, 35300, 35317, 35385, 35410,
    35426, 35555, 35644, 35715, 35872, 36466, 36532, 36697, 36730, 37324, 37918, 38677,
    40789, 41482, 42340, 42406, 42802, 43000, 43264, 43594, 43693, 44042, 44048
  )
  AND content -> 'main' ? 'title';

UPDATE website
SET content = content #- '{main,title}'
WHERE content -> 'main' ? 'title';
