export const ElectionApiRoutes = {
  districts: {
    list: {
      path: 'districts/list',
    },
    types: {
      path: 'districts/types',
    },
    names: {
      path: 'districts/names',
    },
  },
  projectedTurnout: {
    find: {
      path: 'projectedTurnout',
    },
  },
  positions: {
    findByBrId: {
      path: 'positions/by-ballotready-id',
    },
    findById: {
      path: 'positions',
    },
    nextElection: {
      // Full path: /positions/:id/next-election
      path: 'positions',
      suffix: 'next-election',
    },
    zipCodes: {
      path: 'positions/by-ballotready-id',
    },
  },
  races: {
    filingFeeByBrHashId: {
      // Resolves filing fee directly from the Race table by BallotReady
      // race hash. Used when `campaign.details.raceId` is set (the hash
      // gp-webapp persists on every onboarded candidate) — a direct Race
      // lookup with no Position hop.
      // Full path: /races/by-br-hash-id/:brHashId/filing-fee
      path: 'races/by-br-hash-id',
      filingFeeSuffix: 'filing-fee',
    },
    frequencyByBrHashId: {
      // Election cadence (Race.frequency) keyed by the same BR race hash on
      // campaign.details.raceId. Source for elected-office term derivation —
      // Position carries no frequency, and GET /races can't be keyed by the
      // position id we hold at office creation.
      // Full path: /races/by-br-hash-id/:brHashId/frequency
      path: 'races/by-br-hash-id',
      frequencySuffix: 'frequency',
    },
  },
  campaignStrategyContext: {
    // POST /campaign-strategy-context — looks up a Race by br_hash_id and
    // returns voter counts, candidate roster, win-number variants, and
    // election dates. The single source for raceTargetMetrics now that
    // election-api PR #176 widened District with L2-derived voter stats.
    path: 'campaign-strategy-context',
  },
}
