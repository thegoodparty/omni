import { cn } from '@styleguide/lib/utils'

/**
 * Custom GoodParty "AI" icon (three filled sparkles) from the design system's
 * Custom Icons set. Filled glyph — unlike the stroke-based lucide icons — so it
 * uses `fill="currentColor"` and inherits color from the text color. Size it
 * with a `size-*` utility like any other icon (e.g. `<AiIcon className="size-4" />`).
 */
export function AiIcon({ className, ...props }: React.SVGProps<SVGSVGElement>) {
  return (
    <svg
      data-slot="ai-icon"
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={cn('size-6', className)}
      {...props}
    >
      <path
        d="M18.4966 8.60049L19.2119 6.98523L20.7967 6.25606C21.1498 6.08992 21.1498 5.58227 20.7967 5.41613L19.2119 4.68696L18.4966 3.06247C18.3336 2.7025 17.8355 2.7025 17.6725 3.06247L16.9571 4.67773L15.3634 5.4069C15.0102 5.57304 15.0102 6.08069 15.3634 6.24683L16.9481 6.976L17.6635 8.60049C17.8265 8.96046 18.3336 8.96046 18.4966 8.60049ZM11.2884 9.98499L9.84859 6.75448C9.53165 6.03454 8.51744 6.03454 8.2005 6.75448L6.76068 9.98499L3.59127 11.4526C2.88494 11.7848 2.88494 12.8094 3.59127 13.1324L6.76068 14.6L8.2005 17.8305C8.5265 18.5505 9.53165 18.5505 9.84859 17.8305L11.2884 14.6L14.4578 13.1324C15.1642 12.8001 15.1642 11.7756 14.4578 11.4526L11.2884 9.98499ZM17.6635 15.9845L16.9481 17.5998L15.3634 18.3289C15.0102 18.4951 15.0102 19.0027 15.3634 19.1689L16.9481 19.898L17.6635 21.5225C17.8265 21.8825 18.3245 21.8825 18.4875 21.5225L19.2029 19.9073L20.7967 19.1781C21.1498 19.012 21.1498 18.5043 20.7967 18.3382L19.2119 17.609L18.4966 15.9845C18.3336 15.6245 17.8265 15.6245 17.6635 15.9845Z"
        fill="currentColor"
      />
    </svg>
  )
}
