// The door sheet is a stack of bordered cards whose headers were text alone,
// so scrolling it meant reading three near-identical bars to find the one
// holding the phone number. The demo pairs each with the glyph for what the
// card is about, set at the far end of the row where it reads as a marker for
// the section rather than as a bullet on the word. Decorative — the heading
// beside it already names the card, and a screen reader announcing "house"
// before "Household" adds nothing.
//
// The measurements are `panelCard`'s: a 16px semibold heading, the glyph at 20
// and in the heading's own ink rather than muted (`this.icon(icon,20)` passes
// no colour, so it inherits), and the rule between the header and the card body
// drawn once. Both had drifted small — a 14px heading under a 16px card title
// elsewhere in the panel read as a subsection of the card above it.
export default function SheetSectionHeader({
  icon: Icon,
  title,
}: {
  icon: React.ComponentType<{ size?: number; className?: string }>
  title: string
}) {
  return (
    <h3 className="flex items-center justify-between gap-2 border-b border-border px-4 py-3 text-base font-semibold">
      {title}
      <Icon size={20} aria-hidden="true" className="shrink-0" />
    </h3>
  )
}
