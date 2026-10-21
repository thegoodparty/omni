import { z } from 'zod'

// [lng, lat] GeoJSON coordinate order
const LngLatSchema = z.tuple([z.number(), z.number()])

// ── Routing API ──────────────────────────────────────────────────────────────

const RoutingLegSchema = z.object({
  time: z.number(),
  distance: z.number(),
})

const RoutingFeatureSchema = z.object({
  type: z.literal('Feature'),
  geometry: z
    .union([
      z.object({
        type: z.literal('LineString'),
        coordinates: z.array(LngLatSchema),
      }),
      z.object({
        type: z.literal('MultiLineString'),
        coordinates: z.array(z.array(LngLatSchema)),
      }),
    ])
    .nullable(),
  properties: z
    .object({
      legs: z.array(RoutingLegSchema).optional(),
    })
    .passthrough(),
})

export const RoutingResponseSchema = z.object({
  type: z.literal('FeatureCollection'),
  features: z.array(RoutingFeatureSchema),
})

export type RoutingResponse = z.infer<typeof RoutingResponseSchema>

// ── Route Planner API ────────────────────────────────────────────────────────

const RoutePlannerActionSchema = z.object({
  type: z.string(),
  job_index: z.number().optional(),
  job_id: z.string().optional(),
  start_time: z.number().optional(),
  duration: z.number().optional(),
  waypoint_index: z.number().optional(),
})

const RoutePlannerLegSchema = z.object({
  time: z.number(),
  distance: z.number(),
})

const RoutePlannerWaypointSchema = z
  .object({
    location: LngLatSchema.optional(),
    original_location: LngLatSchema,
    original_location_index: z.number().optional(),
    start_time: z.number().optional(),
    duration: z.number().optional(),
    actions: z.array(RoutePlannerActionSchema).optional(),
    prev_leg_index: z.number().optional(),
    next_leg_index: z.number().optional(),
  })
  .passthrough()

const AgentPlanPropertiesSchema = z
  .object({
    agent_index: z.number(),
    time: z.number().optional(),
    distance: z.number().optional(),
    start_time: z.number().optional(),
    end_time: z.number().optional(),
    mode: z.string().optional(),
    legs: z.array(RoutePlannerLegSchema),
    actions: z.array(RoutePlannerActionSchema),
    waypoints: z.array(RoutePlannerWaypointSchema),
  })
  .passthrough()

const RoutePlannerFeatureSchema = z.object({
  type: z.literal('Feature'),
  geometry: z.unknown().nullable(),
  properties: AgentPlanPropertiesSchema,
})

const RoutePlannerIssuesSchema = z.object({
  unassigned_jobs: z.array(z.number()).optional(),
  unassigned_agents: z.array(z.number()).optional(),
})

const RoutePlannerJobSchema = z.object({
  id: z.string().optional(),
  location: LngLatSchema,
})

const RoutePlannerAgentSchema = z.object({
  start_location: LngLatSchema.optional(),
  end_location: LngLatSchema.optional(),
})

export const RoutePlannerRequestSchema = z.object({
  mode: z.string().optional(),
  agents: z.array(RoutePlannerAgentSchema).optional(),
  jobs: z.array(RoutePlannerJobSchema).optional(),
})

export type RoutePlannerRequest = z.infer<typeof RoutePlannerRequestSchema>

export const RoutePlannerResponseSchema = z.object({
  type: z.literal('FeatureCollection'),
  features: z.array(RoutePlannerFeatureSchema),
  properties: z
    .object({
      mode: z.string().optional(),
      params: z
        .object({
          agents: z.array(RoutePlannerAgentSchema).optional(),
          jobs: z.array(RoutePlannerJobSchema).optional(),
        })
        .passthrough(),
      issues: RoutePlannerIssuesSchema.optional(),
    })
    .passthrough(),
})

export type RoutePlannerResponse = z.infer<typeof RoutePlannerResponseSchema>
