// Built-in Win channel -> people-api boolean filter map. The keys mirror the
// `defaultSegments` values the Contacts UI sends as `segment`. Each channel's
// row filter matches the legacy raw-SQL voter-file export so the migrated path
// returns the same population:
//   - texting / digitalAds: only voters with a cell phone (SMS + ad matching).
//   - phoneBanking: only voters with a landline.
//   - all / doorKnocking: no row filter (every voter in the district).
//   - directMail: no row filter. The legacy path additionally de-duplicated to
//     one voter per mailing household, but people-api exposes no household
//     filter; the mailing-address columns are present in every download row, so
//     a future household-dedup filter would belong in people-api, not here.
const defaultSegmentToFiltersMap = {
  all: {
    filters: [],
  },
  texting: {
    filters: ['hasCellPhone'],
  },
  doorKnocking: {
    filters: [],
  },
  directMail: {
    filters: [],
  },
  phoneBanking: {
    filters: ['hasLandline'],
  },
  digitalAds: {
    filters: ['hasCellPhone'],
  },
}

export default defaultSegmentToFiltersMap
