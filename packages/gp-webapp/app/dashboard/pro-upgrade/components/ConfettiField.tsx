// Design: confettiField — a burst of brand-blue pieces dropping through the
// success card once, with a staggered start so it reads as a shower.
const COLORS = [
  'bg-brand-blue-300',
  'bg-brand-blue-400',
  'bg-primary',
  'bg-brand-midnight-300',
]

export const ConfettiField = (): React.JSX.Element => (
  <div
    aria-hidden
    className="pointer-events-none absolute inset-0 z-0 overflow-hidden rounded-xl"
  >
    {Array.from({ length: 26 }).map((_, i) => (
      <span
        key={i}
        className={`absolute top-0 opacity-0 ${COLORS[i % COLORS.length]} ${
          i % 3 ? 'h-[9px] w-[5px] rounded-[2px]' : 'size-[7px] rounded-full'
        }`}
        style={{
          left: `${2 + i * 3.7}%`,
          animation: `gp-confetti-drop ${(1.7 + (i % 5) * 0.22).toFixed(2)}s linear ${((i % 8) * 0.09).toFixed(2)}s 1 forwards`,
        }}
      />
    ))}
  </div>
)
