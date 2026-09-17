// Geoapify's published cost model, transcribed from its own calculator at
// https://www.geoapify.com/pricing-details/ (retrieved 2026-09-01). Creating a
// list is the only paid call in the product, so every credit the route row,
// the spend log line, the metric and the quota ledger carry is priced here —
// one edit when the vendor reprices, rather than four places that can quietly
// disagree about what a route cost.

// Where the Route Planner's quadratic branch gives way to the flat one. The
// two branches meet exactly here (10 x 10 either way), so the curve is
// continuous and the crossover needs no special case — but they are separate
// constants because their equality is Geoapify's coincidence, not a rule.
const ROUTE_PLANNER_LINEAR_FROM_LOCATIONS = 10
const ROUTE_PLANNER_CREDITS_PER_LOCATION = 10

/**
 * Route Planner cost, verbatim from the calculator:
 *
 *   When number of locations < 10:  REQUEST_COST = NUMBER_OF_LOCATIONS * NUMBER_OF_LOCATIONS
 *   When number of locations >= 10: REQUEST_COST = NUMBER_OF_LOCATIONS * 10
 *
 * The sub-ten branch is why a flat per-stop rate is wrong in both directions:
 * a two-stop walk costs 4 credits, a 150-stop one costs 1,500.
 *
 * "Locations" is every location slot in the request — the page enumerates
 * them as "Agent Start & End locations, Shipment Pickup & Delivery locations,
 * Job locations" and its worked example sums them raw (7 agents with a start
 * and an end, plus 30 jobs, is 7*2 + 30 = 44 locations). Neither the page nor
 * the SDK's request builder de-duplicates coincident coordinates, and the SDK
 * sends the agent's anchors as their own fields, so our anchors are billed as
 * their own locations even though both of them sit on a stop the route
 * already visits. If Geoapify does silently collapse them we over-state a walk
 * by one location (open) or two (loop); only a metered comparison against the
 * billing console would settle it, and over-stating is the safe direction for
 * a number the budget alerts read.
 */
export const routePlannerCredits = (locations: number): number => {
  if (locations <= 0) return 0
  return locations < ROUTE_PLANNER_LINEAR_FROM_LOCATIONS
    ? locations * locations
    : locations * ROUTE_PLANNER_CREDITS_PER_LOCATION
}

// "1 additional credit is counted for each 500 km of result route length if
// route length > 500 km." Unreachable on a walking turf and cheap to keep
// honest, which is the point: the surcharge is the vendor's, not ours to
// decide is impossible.
const ROUTING_SURCHARGE_METERS = 500_000

/**
 * Routing cost, verbatim from the calculator:
 *
 *   1 credit per each pair of waypoints: NUMBER_OF_CREDITS = WAYPOINTS - 1
 *   1 additional credit is counted for each 500 km of result route length if route length > 500 km
 *
 * `waypoints` must be what the request actually carried, which for us is the
 * plan's own waypoint array rather than the stop count — the anchors are in
 * it. Fewer than two waypoints is not a pair and cannot owe anything; the SDK
 * declines to make the call at all with none, so the floor at zero is a real
 * case and not just defensive arithmetic.
 */
export const routingCredits = (waypoints: number, meters = 0): number => {
  if (waypoints < 2) return 0
  const surcharge =
    meters > ROUTING_SURCHARGE_METERS
      ? Math.floor(meters / ROUTING_SURCHARGE_METERS)
      : 0
  return waypoints - 1 + surcharge
}
