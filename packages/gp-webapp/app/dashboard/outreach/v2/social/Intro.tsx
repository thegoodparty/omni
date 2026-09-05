// Step intro block: title + body copy. The channel identity used to sit
// here as a `ChannelBadge` and has moved to the shell's header row, so a
// step body no longer restates the channel — `channel` is retained as an
// accepted-but-ignored prop only so callers can be updated in a follow-up
// sweep rather than every step file at once.
export const Intro = ({
  title,
  body,
}: {
  title: string
  body: string
  channel?: string
}) => (
  <div className="space-y-2">
    <h3 className="text-2xl font-semibold text-foreground">{title}</h3>
    <p className="text-base text-muted-foreground">{body}</p>
  </div>
)
