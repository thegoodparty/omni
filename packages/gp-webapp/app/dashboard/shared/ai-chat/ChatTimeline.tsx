import { Badge } from '@styleguide/components/ui/badge'

export type TimelineStatus = 'done' | 'active' | 'upcoming'

export type TimelineItem = {
  label: string
  title: string
  status?: TimelineStatus
  badge?: string
  description?: string
  items?: string[]
  link?: { label: string; href: string }
  source?: string
}

const bulletClass: Record<TimelineStatus, string> = {
  done: 'border-primary bg-primary',
  active: 'border-primary bg-background',
  upcoming: 'border-muted-foreground bg-background',
}

const connectorClass: Record<TimelineStatus, string> = {
  done: 'bg-primary',
  active: 'bg-primary',
  upcoming: 'bg-muted-foreground/30',
}

export default function ChatTimeline({ items }: { items: TimelineItem[] }) {
  return (
    <div className="flex flex-col">
      {items.map((item, i) => {
        const status = item.status ?? 'done'
        const isLast = i === items.length - 1
        return (
          <div key={i} className="relative flex gap-3">
            <div className="flex flex-col items-center">
              <div
                className={`mt-0.5 size-2.5 shrink-0 rounded-full border-2 ${bulletClass[status]}`}
              />
              {!isLast && (
                <div className={`w-px flex-1 ${connectorClass[status]}`} />
              )}
            </div>

            <div className={`flex flex-col gap-1 min-w-0 ${isLast ? '' : 'pb-5'}`}>
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-sm font-semibold text-foreground">{item.label}</span>
                <span className="text-sm text-foreground">{item.title}</span>
                {item.badge && (
                  <Badge variant="soft" shape="pill">{item.badge}</Badge>
                )}
              </div>

              {item.description && (
                <p className="text-sm text-muted-foreground">{item.description}</p>
              )}

              {item.items && item.items.length > 0 && (
                <ul className="flex flex-col gap-0.5 pl-3">
                  {item.items.map((it, j) => (
                    <li key={j} className="flex items-start gap-1.5 text-sm text-muted-foreground">
                      <span className="mt-2 size-1 shrink-0 rounded-full bg-muted-foreground/50" />
                      {it}
                    </li>
                  ))}
                </ul>
              )}

              {item.link && (
                <a
                  href={item.link.href}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="w-fit text-xs text-primary underline-offset-4 hover:underline"
                >
                  {item.link.label}
                </a>
              )}

              {item.source && (
                <p className="text-xs text-muted-foreground">{item.source}</p>
              )}
            </div>
          </div>
        )
      })}
    </div>
  )
}
