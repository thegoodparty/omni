// Step intro: title + body. The channel identity now lives in the shell's
// header row (persistent across steps), so a step body no longer restates
// it. `channel` is accepted-but-ignored so callers can be updated later.
export const Intro = ({
  title,
  body,
}: {
  title: string
  body: string
  channel?: string
}) => (
  <div className="space-y-2">
    <h3 className="text-xl font-semibold text-foreground">{title}</h3>
    <p className="text-base text-muted-foreground">{body}</p>
  </div>
)
