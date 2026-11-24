import { cn } from '@styleguide/lib/utils'

interface TeamBadgeProps {
  className?: string
  /**
   * Visual size of the badge. Native artwork is 62.5 × 22.
   * – small  : 34 × 12
   * – default: 45 × 16
   * – large  : 57 × 20
   */
  size?: 'small' | 'default' | 'large'
}

const sizeClasses = {
  small: 'w-[34px] h-[12px]',
  default: 'w-[45px] h-[16px]',
  large: 'w-[57px] h-[20px]',
} as const

/**
 * @summary Use to mark a feature, plan or account as the paid Team plan. For the Pro plan use ProBadge; for any other tag or count, use Badge.
 */
export const TeamBadge = ({ className, size = 'default' }: TeamBadgeProps) => (
  <svg
    data-slot="team-badge"
    className={cn(sizeClasses[size], className)}
    viewBox="0 0 62.5 22"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
    role="img"
    aria-label="TEAM"
  >
    <path
      d="M3.38822 3.26285C3.74295 1.37096 5.39485 0 7.31971 0H57.6803C60.1848 0 62.0733 2.2755 61.6118 4.73715L59.1118 18.0705C58.7570 19.9624 57.1052 21.3333 55.1803 21.3333H4.81971C2.31516 21.3333 0.426656 19.0578 0.888216 16.5962L3.38822 3.26285Z"
      className="fill-primary"
    />
    <path
      d="M15.723 15.655H13.507L15.314 7.049H12.477L12.864 5.205H20.755L20.368 7.049H17.530ZM26.187 15.655H20.169L22.363 5.205H28.382L28.000 7.021H24.198L23.716 9.315H27.254L26.873 11.131H23.335L22.769 13.825H26.572ZM34.765 15.655 34.529 13.168H30.719L29.439 15.655H27.052L32.944 5.162H35.653L37.152 15.655ZM34.391 11.309 34.143 8.879Q34.123 8.636 34.085 8.254Q34.048 7.871 34.013 7.475Q33.978 7.078 33.968 6.785Q33.835 7.078 33.619 7.510Q33.404 7.943 33.208 8.329Q33.013 8.715 32.928 8.879L31.667 11.309ZM42.892 15.655 42.097 7.457H42.033Q41.986 7.750 41.894 8.339Q41.802 8.929 41.691 9.594Q41.580 10.259 41.468 10.795L40.447 15.655H38.467L40.662 5.205H43.678L44.473 13.196H44.516L48.817 5.205H51.833L49.639 15.655H47.573L48.612 10.709Q48.716 10.216 48.869 9.572Q49.022 8.929 49.172 8.347Q49.323 7.764 49.399 7.471H49.335L44.921 15.655Z"
      className="fill-primary-foreground"
    />
  </svg>
)
