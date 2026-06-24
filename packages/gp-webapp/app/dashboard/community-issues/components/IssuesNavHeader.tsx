import { FlagIcon } from '@styleguide/components/ui/icons'

// Full-bleed page header (flag + title), mirroring the nav item. Rendered at the
// top of each Community Issues page; the page passes wrapperClassName="!p-0" so it
// sits flush against the layout edges.
const IssuesNavHeader = (): React.JSX.Element => (
  <div className="flex items-center gap-2 border-b border-border bg-background px-6 py-4">
    <FlagIcon className="size-5 text-foreground" aria-hidden />
    <span className="text-base font-semibold text-foreground">
      Community Issues
    </span>
  </div>
)

export default IssuesNavHeader
