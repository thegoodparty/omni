---
name: add-endpoint
description: Add a new HTTP endpoint to a feature module following the controller/services/schemas convention, PrismaBase pattern, and Zod response validation. Use when adding any new route to gp-api.
---

# Add an endpoint

Reference module: `src/users/`. Conventions enforced by `.cursor/rules/rules.mdc` Rule 7.

## 1. Locate or create the feature module

Layout:

- `<feature>.module.ts` — NestJS module
- `<feature>.controller.ts` — HTTP only, no business logic
- `services/<feature>.service.ts` — extends `createPrismaBase(MODELS.X)`
- `schemas/<action><Entity>.schema.ts` — Zod input + response schemas
- `<feature>.test.ts` — Vitest file (must be `*.test.ts`, not `.spec.ts`)

```
src/<feature>/
├── <feature>.module.ts
├── <feature>.controller.ts
├── services/
│   └── <feature>.service.ts
├── schemas/
│   └── <action><Entity>.schema.ts
└── <feature>.test.ts
```

If the feature doesn't exist yet, create the folder and module, then register it in the parent module's `imports`.

## 2. Define the Zod schemas

`src/<feature>/schemas/<action><Entity>.schema.ts`:

Never call `.passthrough()` on request schemas — unknown keys must be stripped.

```ts
import { z } from 'zod'
// Use zCoerceDate()/zDate() (not z.coerce.date()/z.date()) for Date fields:
// zod v4's JSON Schema generation (nestjs-zod OpenAPI at bootstrap) throws on a
// bare ZodDate; these keep identical runtime parsing but render as date-time.
import { zDate } from '@goodparty_org/contracts'

export const CreateThingSchema = z.object({
  name: z.string().min(1),
})

export type CreateThingInput = z.infer<typeof CreateThingSchema>

export const ThingResponseSchema = z.object({
  id: z.number(),
  name: z.string(),
  createdAt: zDate(),
})
```

## 3. Service: extend PrismaBase if backed by a Prisma model

Inherited members: `this.model`, `this.client`, `this.logger`, `this.findMany`, `this.findFirst`, `this.count`, `this.optimisticLockingUpdate`.

```ts
import { Injectable } from '@nestjs/common'
import { createPrismaBase, MODELS } from '@/prisma/util/prisma.util'

@Injectable()
export class ThingsService extends createPrismaBase(MODELS.Thing) {
  constructor() {
    super()
  }
}
```

ADR: `docs/adr/0001-prisma-base-pattern.md`.

## 4. Controller: HTTP only

```ts
import { Body, Controller, Post } from '@nestjs/common'
import { ZodValidationPipe } from 'nestjs-zod'
import { ResponseSchema } from '@/shared/decorators/ResponseSchema.decorator'
import {
  CreateThingSchema,
  ThingResponseSchema,
} from './schemas/createThing.schema'
import { ThingsService } from './services/things.service'

@Controller('v1/things')
export class ThingsController {
  constructor(private readonly things: ThingsService) {}

  @Post()
  @ResponseSchema(ThingResponseSchema)
  create(
    @Body(new ZodValidationPipe(CreateThingSchema)) input: CreateThingInput,
  ) {
    return this.things.model.create({ data: input })
  }
}
```

`@ResponseSchema` runs through the global `ZodResponseInterceptor` and validates the outgoing payload at runtime.

ADR: `docs/adr/0002-zod-everywhere.md`.

## 5. Auth posture

Two global guards run on every request: `SessionGuard` (also verifies Clerk M2M `mt_*` tokens) and `RolesGuard`.

- `@PublicAccess()` — anonymous OK
- `@Roles(UserRole.ADMIN)` — restrict
- `@ReqUser()` — inject user
- `@UseGuards(M2MOnly)` or `@UseGuards(AdminOrM2MGuard)` — service-to-service

Default (no decorator) requires a logged-in user.

## 6. Test

Integration with real DB (preferred):

```ts
import { useTestService } from '@/test-service'

const service = useTestService()

it('creates a thing', async () => {
  const res = await service.client.post('/v1/things', { name: 'foo' })
  expect(res.status).toBe(201)
  expect(res.data.name).toBe('foo')
})
```

Unit (controllers): direct instantiation with a `Partial<ThingsService>` mock.

See `.claude/skills/run-tests/SKILL.md` for invocation patterns.

## 7. Verify

```bash
npm run verify   # lint + tsc --noEmit + vitest run
```

## 8. Cross-service shape?

If this endpoint's response type is consumed by another service (gp-webapp, etc.), put the schema in `contracts/src/` instead of in this module's `schemas/`. See `.claude/skills/update-contract/SKILL.md`.
