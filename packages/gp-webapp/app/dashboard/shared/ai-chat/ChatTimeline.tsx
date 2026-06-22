export type TimelineItem = {
  label: string
  title: string
  description?: string
  source?: string
}

export default function ChatTimeline({ items }: { items: TimelineItem[] }) {
  return (
    <div className="flex flex-col">
      {items.map((item, i) => (
        <div key={i} className="relative flex gap-3">
          <div className="flex flex-col items-center">
            <div className="mt-0.5 size-2.5 shrink-0 rounded-full border-2 border-primary bg-background" />
            {i < items.length - 1 && (
              <div className="w-px flex-1 bg-primary" />
            )}
          </div>

          <div className={`flex flex-col gap-1 min-w-0 ${i < items.length - 1 ? 'pb-5' : ''}`}>
            <div className="flex flex-wrap items-baseline gap-2">
              <span className="text-sm font-semibold text-foreground">{item.label}</span>
              <span className="text-sm text-foreground">{item.title}</span>
            </div>

            {item.description && (
              <p className="text-sm text-muted-foreground">{item.description}</p>
            )}

            {item.source && (
              <p className="text-xs text-muted-foreground">{item.source}</p>
            )}
          </div>
        </div>
      ))}
    </div>
  )
}
