import { z } from 'zod'

// Colors come from the designer's "E-mail colors" file, which maps the
// GoodParty palette onto the same roles in every theme so any layout can take
// any theme. A shipped theme key is never edited in place: sends store only
// the key, so a changed theme gets a new key.
export interface EmailThemeColors {
  bg: string
  card: string
  header: string
  headerText: string
  // The line under a light header. Themes with a solid header use the
  // header color. Also the strip at the top of a short email.
  rule: string
  // The band behind a short email's button, when it isn't the rule color.
  band?: string
  // Subheading text, when it isn't the rule color: a theme with no visible
  // lines sets rule to its card color and keeps subheadings readable here.
  subheading?: string
  headline: string
  body: string
  meta: string
  cta: string
  ctaText: string
  accent: string
  accentText: string
  divider: string
}

const WHITE = '#FFFFFF'

export const EMAIL_THEMES = {
  // The default: black text on white with blue links, for an email whose
  // author hasn't picked colors.
  neutral: {
    label: 'Neutral',
    colors: {
      bg: '#F4F4F5',
      card: WHITE,
      header: WHITE,
      headerText: '#111111',
      rule: WHITE,
      subheading: '#111111',
      band: '#FAFAFA',
      headline: '#111111',
      body: '#111111',
      meta: '#5F6368',
      cta: '#1E63EC',
      ctaText: WHITE,
      accent: '#1E63EC',
      accentText: WHITE,
      divider: '#E4E4E7',
    },
  },
  classic_blue: {
    label: 'Classic blue',
    colors: {
      bg: '#EFF5FF',
      card: WHITE,
      header: '#1E63EC',
      headerText: WHITE,
      rule: '#1E63EC',
      headline: '#0B1529',
      body: '#1D305C',
      meta: '#1D305C',
      cta: '#1E63EC',
      ctaText: WHITE,
      accent: '#DC1438',
      accentText: WHITE,
      divider: '#D6E7FF',
    },
  },
  fresh_green: {
    label: 'Fresh green',
    colors: {
      bg: '#DDF2E8',
      card: WHITE,
      header: '#16695C',
      headerText: WHITE,
      rule: '#16695C',
      headline: '#043630',
      body: '#115449',
      meta: '#115449',
      cta: '#257F68',
      ctaText: WHITE,
      accent: '#FFE06C',
      accentText: '#043630',
      divider: '#B2E1CC',
    },
  },
  warm_sunset: {
    label: 'Warm sunset',
    colors: {
      bg: '#FFEBD8',
      card: WHITE,
      header: '#B74932',
      headerText: WHITE,
      rule: '#B74932',
      headline: '#2E030A',
      body: '#511508',
      meta: '#511508',
      cta: '#B80F2E',
      ctaText: WHITE,
      accent: '#FFE291',
      accentText: '#511508',
      divider: '#FFCAA2',
    },
  },
  bold_red: {
    label: 'Bold red',
    colors: {
      bg: '#FFF1F2',
      card: WHITE,
      header: '#DC1438',
      headerText: WHITE,
      rule: '#DC1438',
      headline: '#0B1529',
      body: '#1D305C',
      meta: '#1D305C',
      cta: '#0048C2',
      ctaText: WHITE,
      accent: '#FFC523',
      accentText: '#060B17',
      divider: '#FFD9DC',
    },
  },
  cream_and_forest: {
    label: 'Cream and forest',
    colors: {
      bg: '#FCF8F3',
      card: WHITE,
      header: WHITE,
      headerText: '#115449',
      rule: '#16695C',
      headline: '#1E1F20',
      body: '#595C5F',
      meta: '#70757A',
      cta: '#16695C',
      ctaText: WHITE,
      accent: '#DDF2E8',
      accentText: '#115449',
      divider: '#E0E6EC',
    },
  },
} as const satisfies Record<string, { label: string; colors: EmailThemeColors }>

export type EmailThemeKey = keyof typeof EMAIL_THEMES

export const EmailThemeKeySchema = z.enum([
  'neutral',
  'classic_blue',
  'fresh_green',
  'warm_sunset',
  'bold_red',
  'cream_and_forest',
]) satisfies z.ZodType<EmailThemeKey>

export const EMAIL_LAYOUTS = {
  newsletter: {
    label: 'Newsletter',
    defaultTheme: 'classic_blue',
    requiresButton: false,
  },
  reminder: {
    label: 'Reminder',
    defaultTheme: 'fresh_green',
    requiresButton: false,
  },
  call_to_action: {
    label: 'Call to action',
    defaultTheme: 'cream_and_forest',
    requiresButton: true,
  },
} as const satisfies Record<
  string,
  { label: string; defaultTheme: EmailThemeKey; requiresButton: boolean }
>

export type EmailLayoutKey = keyof typeof EMAIL_LAYOUTS

export const EmailLayoutKeySchema = z.enum([
  'newsletter',
  'reminder',
  'call_to_action',
]) satisfies z.ZodType<EmailLayoutKey>
