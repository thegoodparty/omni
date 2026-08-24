// Built-in Win channel -> people-api row filter + grouping map. The keys mirror
// the `defaultSegments` values the Contacts UI sends as `segment`. Each
// channel's row filter matches the legacy raw-SQL voter-file export so the
// migrated path returns the same population:
//   - texting / digitalAds: only voters with a cell phone (SMS + ad matching).
//   - phoneBanking: any phone number, cell or landline (ENG-10914) — the
//     list builder freezes any phone, cell first, so this must agree with
//     the built list rather than the old landline-only population.
//   - all: no row filter (every voter in the district).
//   - doorKnocking: no row filter, but `groupByHousehold` so people-api
//     de-dupes to one voter per physical residence address — a canvasser walks
//     houses, not registrations, so visiting one address once is the unit of
//     work (ENG-10522). The key is the residence-address composite, not
//     Mailing_Families_FamilyID (which keys mailing households).
//   - directMail: no row filter. The legacy path additionally de-duplicated to
//     one voter per mailing household; that grouping is mailing-keyed and
//     out of scope here.
const defaultSegmentToFiltersMap = {
  all: {
    filters: [],
  },
  texting: {
    filters: ['hasCellPhone'],
  },
  doorKnocking: {
    filters: [],
    groupByHousehold: true,
  },
  directMail: {
    filters: [],
  },
  phoneBanking: {
    filters: ['hasAnyPhone'],
  },
  digitalAds: {
    filters: ['hasCellPhone'],
  },
}

export default defaultSegmentToFiltersMap
