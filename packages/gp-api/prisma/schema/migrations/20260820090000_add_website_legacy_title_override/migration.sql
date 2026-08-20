-- Preserve the candidate-authored hero headline for live Pro campaigns.
--
-- The preceding migration (20260817090000_strip_website_main_title) removes
-- content.main.title now that candidate-sites derives the headline from the
-- campaign owner's name. Stripping it outright would also erase 396
-- candidate-authored headlines, so user success asked that campaigns already
-- live and paying keep theirs.
--
-- The 47 rows below are the published Pro campaigns with a candidate-authored
-- headline and an election still ahead of them, verified against prod on
-- 2026-08-20. Website 100 ('ds-test-candidate', headline "Test Title") matched
-- that filter and is deliberately excluded as test data.
--
-- The exemption is an explicit list rather than a predicate on purpose: a
-- predicate like "title <> 'Vote For ' || name" would also have preserved 26
-- Pro sites whose headline names a DIFFERENT PERSON than the account holder
-- (e.g. "Vote For Michael Morrill" on Lefty Morrill's site) — the exact defect
-- the derivation exists to fix. Those 26 are deliberately left to derive.
--
-- The headlines are embedded as literals rather than copied from
-- content -> 'main' ->> 'title'. Reading the JSONB would make this migration
-- depend on running BEFORE the strip above, which is true on a fresh database
-- but not on one that already applied the strip — the carve-out would silently
-- come out empty. Literals make the result identical in either order, and they
-- double as an auditable record of exactly what was preserved.
ALTER TABLE website ADD COLUMN legacy_title_override TEXT;

UPDATE website AS w
SET legacy_title_override = v.title
FROM (
    VALUES
      (496, 'Ronald Burnette Jr. for Governor of Alabama (Independent)'),
      (1652, 'Monica Shintani for Cape Coral District 1'),
      (1658, 'David for Katy ISD'),
      (5413, 'Rylee Peak for Mayor 2026'),
      (15711, 'Vote Jed Hresko for Brockton City Council At-Large'),
      (16204, 'Jason LaForest for State Senate LD5'),
      (16567, 'Matt Simons'),
      (19472, 'Taj Smith'),
      (25378, 'Greg Ketcham for Jeffco Assessor 2026!'),
      (30262, 'Andy Brown, Independent Candidate, House District 32'),
      (30724, 'Karen Ortiz for Congress'),
      (31450, 'Vote Aida for L.A. City Attorney'),
      (32902, 'Elect Monet S. Wilson'),
      (34520, 'Fred Crawford for Swain'),
      (34552, 'Kelly O’Brien for Fairfax City Council'),
      (34802, 'Federal Congressional District 12, No Party Affiliation Candidate'),
      (34823, 'Vote Sandra Kay for San Diego District 2'),
      (34883, 'Dylan Thompson for Horry County'),
      (34915, 'Brian Jordan for Congress'),
      (35288, 'CHIRAG KATHRANI FOR STATE ASSEMBLY 2026'),
      (35300, 'Welcome to Wolfe4District 3!'),
      (35317, 'Taylor For Congress'),
      (35385, 'A Candidate for Us'),
      (35410, 'Adam Rueda for NJ-5'),
      (35426, 'Sirico for School Board'),
      (35555, 'Support Andrew Cottingham'),
      (35644, 'Cameron Chick for Senate 2026'),
      (35715, 'Dustin Calvo for Josephine County Treasurer'),
      (35872, 'Concerned Citizens of Oakland Park'),
      (36466, 'Sheila Worthy-Williams for Judge'),
      (36532, 'Vote 4 Kristi Burch'),
      (36697, 'Jason O''Dell'),
      (36730, 'Nathan Polsky'),
      (37324, 'Stephen POST for West Hollywood City Council'),
      (37918, 'Dave for Tennessee'),
      (38677, 'Rick Robb for State Senate'),
      (40789, 'Vote Colonel Pratt for Ward 7'),
      (41482, 'Vote Esmeralda Hurtado for State Senate District 14'),
      (42340, 'Fill in the Oval.'),
      (42406, 'Matt Mills for IGH City Council'),
      (42802, 'Kenneth Blevins for District 66'),
      (43000, 'CHRIS SWEENEY FOR LONG BEACH MAYOR 2026'),
      (43264, 'Heather-Marie Wilson for State Senator, LD43'),
      (43594, 'Pranger for Madison Township Advisory Board'),
      (43693, 'Dowling For WI Assembly'),
      (44042, 'Jake Tjapkes for Lowell School Board'),
      (44048, 'Jim Shaw for E''town City Council')
  ) AS v(id, title)
WHERE w.id = v.id;
