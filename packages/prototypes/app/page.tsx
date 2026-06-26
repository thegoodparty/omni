import fs from 'fs'
import path from 'path'
import Link from 'next/link'
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
  Badge,
} from '@goodparty_org/styleguide'
import { sortPrototypes, type PrototypeMeta } from '@/shared/prototypeMeta'

// Discover prototypes from the filesystem on each request rather than baking the
// list in at build time. next.config.ts traces app/p into the deployed bundle so
// the readdir below resolves at runtime.
export const dynamic = 'force-dynamic'

const STATUS_STYLES: Record<
  PrototypeMeta['status'],
  { variant: 'default' | 'secondary' | 'outline'; label: string }
> = {
  draft: { variant: 'secondary', label: 'Draft' },
  'handoff-ready': { variant: 'default', label: 'Handoff ready' },
  shipped: { variant: 'outline', label: 'Shipped' },
}

const loadPrototypes = async (): Promise<PrototypeMeta[]> => {
  const pDir = path.join(process.cwd(), 'app', 'p')

  if (!fs.existsSync(pDir)) return []

  const slugs = fs
    .readdirSync(pDir, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name)

  const results: PrototypeMeta[] = []

  for (const slug of slugs) {
    try {
      const mod = await import(`./p/${slug}/meta`)
      const raw = mod.default
      results.push({ slug, ...raw })
    } catch {
      // skip folders without a valid meta.ts
    }
  }

  return results
}

const Page = async () => {
  const all = await loadPrototypes()
  const prototypes = sortPrototypes(all)

  if (prototypes.length === 0) {
    return (
      <main className="flex min-h-screen items-center justify-center p-8">
        <div className="text-center">
          <h1 className="mb-2 text-2xl font-semibold">No prototypes yet</h1>
          <p className="text-muted-foreground">
            Run the <code className="font-mono text-sm">new-prototype</code>{' '}
            skill to scaffold your first prototype.
          </p>
        </div>
      </main>
    )
  }

  return (
    <main className="p-8">
      <h1 className="mb-6 text-2xl font-semibold">Prototypes</h1>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {prototypes.map((proto) => {
          const badge = STATUS_STYLES[proto.status]
          if (!badge) return null
          return (
            <Link key={proto.slug} href={`/p/${proto.slug}`}>
              <Card className="h-full transition-shadow hover:shadow-md">
                <CardHeader>
                  <div className="flex items-start justify-between gap-2">
                    <CardTitle>{proto.title}</CardTitle>
                    <Badge variant={badge.variant}>{badge.label}</Badge>
                  </div>
                  <CardDescription>{proto.description}</CardDescription>
                </CardHeader>
                <CardContent>
                  <p className="text-muted-foreground text-xs">
                    {proto.author} &middot; {proto.createdAt}
                  </p>
                </CardContent>
              </Card>
            </Link>
          )
        })}
      </div>
    </main>
  )
}

export default Page
