import type { LucideIcon } from 'lucide-react'
import { Badge } from '@styleguide/components/ui/badge'

export type TimelineStatus = 'done' | 'active' | 'upcoming'

export type TimelineItem = {
  label: string
  title: string
  status?: TimelineStatus
  icon?: LucideIcon
  badge?: string
  description?: string
  items?: string[]
  link?: { label: string; href: string }
  source?: string
}

const bulletColorClass: Record<TimelineStatus, string> = {
  done: 'border-primary bg-primary text-primary-foreground',
  active: 'border-primary bg-background text-primary',
  upcoming: 'border-muted-foreground bg-background text-muted-foreground',
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
        const Icon = item.icon

        return (
          <div key={i} className="relative flex gap-3">
            <div className="flex flex-col items-center">
              <div className="mt-0.5 flex size-5 shrink-0 items-center justify-center">
                <div
                  className={`flex size-5 items-center justify-center rounded-full border-2 ${bulletColorClass[status]}`}
                >
                  {Icon && <Icon className="size-2.5" />}
                </div>
              </div>
              {!isLast && (
                <div className={`w-px flex-1 ${connectorClass[status]}`} />
              )}
            </div>

            <div className={`flex flex-col gap-1 min-w-0 ${isLast ? '' : Icon ? 'pb-5' : 'pb-5'}`}>
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
