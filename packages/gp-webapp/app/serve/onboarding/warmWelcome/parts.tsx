import type { ButtonHTMLAttributes, CSSProperties, Ref } from 'react'

export const cx = (...parts: (string | false | null | undefined)[]): string =>
  parts.filter(Boolean).join(' ')

export const vars = (values: Record<string, string | number>): CSSProperties =>
  values as CSSProperties

type TapProps = Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'type'> & {
  ref?: Ref<HTMLButtonElement>
}

// Every control in the warm welcome is the design's own, drawn by
// warmWelcome.css: its buttons (44px tall, with a sheen), its breadcrumb
// segments, the words of the date sentence, the menu cells, the day chips
// and the issue cards. None of them is a styleguide Button, so this is the
// one element they all render.
export const Tap = ({ ref, ...props }: TapProps): React.JSX.Element => (
  <button ref={ref} type="button" {...props} />
)

export type BtnKind = 'primary' | 'outline' | 'link' | 'ghost'

const KIND_CLASS: Record<BtnKind, string> = {
  primary: 'btn',
  outline: 'btn ol',
  link: 'btn link',
  ghost: 'btn ghost',
}

export const btnClass = (kind: BtnKind, extra?: string | false): string =>
  cx(KIND_CLASS[kind], extra)

export const Btn = ({
  kind = 'primary',
  className,
  ...props
}: TapProps & { kind?: BtnKind }): React.JSX.Element => (
  <Tap className={btnClass(kind, className)} {...props} />
)

const HEART_OUTLINE =
  'M39.0136 7.92458C33.2045 1.70024 25.7293 -0.973923 18.2992 0.317051C11.2292 1.51581 5.10491 6.17255 2.04277 12.7196C-1.33459 20.0505 -0.524055 28.7185 4.47444 37.1098C10.2835 46.9765 21.4964 56.1978 37.7077 64.2202L39.0136 64.8657L40.3196 64.2202C56.5309 56.1517 67.6987 46.9304 73.5528 37.1098C78.5062 28.7185 79.3619 20.0505 75.9845 12.7196C72.9224 6.12644 66.7981 1.51581 59.7281 0.317051C52.2979 -0.927817 44.8227 1.70024 39.0136 7.92458ZM34.9157 12.5813C30.2775 7.41742 24.6486 5.52706 19.2448 6.44918C14.1112 7.3252 9.65306 10.737 7.49155 15.3938C5.14991 20.4654 5.46513 26.8742 9.60803 33.9285C14.4264 42.0893 24.0181 50.3884 38.9686 57.9959C53.9191 50.3884 63.4658 42.0893 68.3292 33.9285C72.5171 26.8742 72.7873 20.4654 70.4456 15.3938C68.2841 10.6909 63.826 7.3252 58.6924 6.44918C53.2886 5.52706 47.6597 7.41742 43.0214 12.5813L38.9686 17.0997L34.9157 12.5813Z'

const HEART_STAR =
  'M37.3921 39.1847L33.0691 41.49C32.6188 41.7205 32.0784 41.5361 31.8532 41.1211C31.7631 40.9367 31.7181 40.7523 31.7631 40.5218L32.5737 35.6806C32.7539 34.5279 32.3936 33.3753 31.583 32.5915L28.0706 29.1335C27.7103 28.7647 27.7103 28.2114 28.0706 27.8426C28.2057 27.7042 28.3858 27.612 28.6109 27.5659L33.4743 26.8743C34.6001 26.6899 35.5908 25.9983 36.0862 24.9378L38.2477 20.5117C38.4728 20.0506 39.0132 19.8662 39.4635 20.0967C39.6437 20.1889 39.7787 20.3272 39.8688 20.5117L42.0303 24.9378C42.5257 25.9522 43.5164 26.6899 44.6421 26.8743L49.5056 27.5659C50.0009 27.6581 50.3611 28.1192 50.2711 28.5802C50.2711 28.7647 50.136 28.9491 50.0009 29.0874L46.4884 32.5454C45.6779 33.3292 45.2726 34.528 45.4977 35.6345L46.3084 40.4756C46.3984 40.9828 46.0832 41.4439 45.5878 41.5361C45.4077 41.5361 45.1825 41.5361 45.0024 41.4439L40.6794 39.1386C39.6437 38.5853 38.4278 38.5853 37.4371 39.1386L37.3921 39.1847Z'

// The GoodParty.org heart as a foil: the heart's white is a slow rainbow
// under a sweeping sheen, with the outline and star on top. The colors are
// the logo's own.
export const FoilLogo = ({
  width,
  label,
}: {
  width?: number
  // Named for screen readers where it stands for the brand; decorative
  // where it does not.
  label?: string
}): React.JSX.Element => (
  <span
    className="gp"
    style={width ? { width } : undefined}
    role={label ? 'img' : undefined}
    aria-label={label}
    aria-hidden={label ? undefined : true}
  >
    <span className="foil" />
    <svg viewBox="0 0 79 65" aria-hidden>
      <path
        fillRule="evenodd"
        clipRule="evenodd"
        d={HEART_OUTLINE}
        fill="#BA0C2F"
      />
      <path d={HEART_STAR} fill="#0047BB" />
    </svg>
  </span>
)

const BUBBLE =
  'M11 0h24c5 0 9 4 9 9v6c0 5-4 9-9 9H13.5c-2.6 0-5.2 1.4-8.4 4.1 1-1.8 1.3-3.4.7-4.9C3.4 21.9 2 19.6 2 17V9c0-5 4-9 9-9z'

// A text bubble with a tail, in the current color. `lines` draws the two
// white strokes of a message inside it.
export const TextBubble = ({
  lines = true,
  className,
}: {
  lines?: boolean
  className?: string
}): React.JSX.Element => (
  <svg viewBox="0 0 46 30" className={className} aria-hidden>
    <path fill="currentColor" d={BUBBLE} />
    {lines && (
      <>
        <rect
          x="12"
          y="7.5"
          width="22"
          height="3"
          rx="1.5"
          fill="#fff"
          opacity=".92"
        />
        <rect
          x="12"
          y="13.5"
          width="15"
          height="3"
          rx="1.5"
          fill="#fff"
          opacity=".6"
        />
      </>
    )}
  </svg>
)
