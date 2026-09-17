-- Strip `main.title` from every website.content blob.
--
-- The hero headline and page <title> are now derived from the candidate's name
-- at render time (candidate-sites reads campaign.user), so a stored title is no
-- longer read anywhere. Leaving it in place would keep a second, silently stale
-- copy of the candidate's name on the page: the field was seeded once at site
-- creation as "Vote For <name>" and never revisited, so correcting a name in the
-- profile never reached the website. That divergence blocked two candidates'
-- 10DLC registrations because the live site named someone other than the filing.
--
-- This deletes candidate-authored titles as well as generated ones. At the time
-- of writing 396 rows carried a free-form title (275 published, 203 on campaigns
-- with a future election date) — those headlines are replaced by the derived
-- "Vote For <name>". That trade is deliberate: the field cannot be edited by
-- anyone but an engineer today, so a stale title has no self-service remedy.
UPDATE website
SET content = content #- '{main,title}'
WHERE content -> 'main' ? 'title';
