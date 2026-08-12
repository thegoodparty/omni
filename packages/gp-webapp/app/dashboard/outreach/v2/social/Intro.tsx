export const Intro = ({ title, body }: { title: string; body: string }) => (
  <div className="space-y-2">
    <h3 className="text-xl font-semibold text-foreground">{title}</h3>
    <p className="text-base text-muted-foreground">{body}</p>
  </div>
)
