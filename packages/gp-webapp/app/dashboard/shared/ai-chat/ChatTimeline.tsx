export type TimelineItem = {
  label: string
  title: string
  description?: string
  quote?: { text: string; author: string }
  source?: string
}

export default function ChatTimeline({ items }: { items: TimelineItem[] }) {
  return (
    <div className="flex flex-col">
      {items.map((item, i) => (
        <div key={i} className="relative flex gap-3">
          {/* Left rail */}
          <div className="flex flex-col items-center">
            <div className="mt-0.5 size-2.5 shrink-0 rounded-full border-2 border-primary bg-background" />
            {i < items.length - 1 && (
              <div className="w-px flex-1 bg-border" />
            )}
          </div>

          {/* Content */}
          <div className={`flex flex-col gap-2 pb-5 min-w-0 ${i === items.length - 1 ? 'pb-0' : ''}`}>
            <div className="flex flex-wrap items-baseline gap-2">
              <span className="text-sm font-bold text-foreground">{item.label}</span>
              <span className="text-sm text-foreground">{item.title}</span>
            </div>

            {item.description && (
              <p className="text-sm text-muted-foreground">{item.description}</p>
            )}

            {item.quote && (
              <blockquote className="border-l-2 border-border pl-3">
                <p className="text-sm italic text-foreground">"{item.quote.text}"</p>
                <p className="mt-1 text-xs text-muted-foreground">{item.quote.author}</p>
              </blockquote>
            )}

            {item.source && (
              <p className="text-xs text-muted-foreground">
                <span className="italic">source:</span>{' '}
                <span className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs text-foreground">
                  {item.source}
                </span>
              </p>
            )}
          </div>
        </div>
      ))}
    </div>
  )
}
