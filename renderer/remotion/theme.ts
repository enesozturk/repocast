/**
 * WalletConnect design tokens, resolved for a dark canvas.
 *
 * Values are copied verbatim from the WC UI registry's `globals.css` (dark
 * theme) so a repocast frame and a dashboard screen agree on every colour. When
 * the registry moves, update this file — do not invent shades here.
 */

const hsl = (value: string, alpha = 1) => (alpha === 1 ? `hsl(${value})` : `hsl(${value} / ${alpha})`)

const base = {
  main: '0 0% 12.5%',
  white: '0 0% 100%',
  gray50: '0 0% 96.5%',
  gray100: '0 0% 95.3%',
  gray200: '0 0% 91.4%',
  gray300: '0 0% 81.6%',
  gray400: '0 0% 73.3%',
  gray500: '0 0% 60.4%',
  gray600: '0 0% 42.4%',
  gray700: '0 0% 31%',
  gray800: '0 0% 21.2%',
  gray900: '0 0% 16.5%',
  gray1000: '0 0% 14.5%',
  accent: '207 93% 49%',
  accentSecondary: '44 31% 68%',
  success: '151 55% 42%',
  error: '8 73% 54%',
  warning: '33 88% 60%'
}

export const theme = {
  bg: hsl(base.main),
  /** Page background at partial alpha, for scrims over moving content. */
  scrim: (alpha: number) => hsl(base.main, alpha),
  surface: hsl(base.gray1000),
  surfaceRaised: hsl(base.gray900),
  border: hsl(base.gray800),
  borderStrong: hsl(base.gray700),
  text: hsl(base.white),
  textSecondary: hsl(base.gray500),
  textTertiary: hsl(base.gray400),
  accent: hsl(base.accent),
  accentSoft: hsl(base.accent, 0.16),
  accentGlow: hsl(base.accent, 0.35),
  success: hsl(base.success),
  error: hsl(base.error),
  warning: hsl(base.warning),
  /** WC product brand colours, used to tint node kinds. */
  brand: {
    walletkit: '#FFB800',
    appkit: '#FF573B',
    dashboard: '#0988F0',
    docs: '#008847'
  },
  radius: { node: 16, pill: 9999, group: 24 },
  font: {
    family: '"KH Teka", ui-sans-serif, -apple-system, "Segoe UI", sans-serif',
    mono: 'ui-monospace, "SF Mono", Menlo, monospace'
  },
  /** The registry's single easing curve. Everything in the video uses it. */
  easing: [0.4, 0, 0.2, 1] as const
}

/** One colour per node kind, so shape and hue both carry meaning. */
export const kindColor: Record<string, string> = {
  client: theme.brand.appkit,
  edge: theme.brand.walletkit,
  service: theme.accent,
  job: theme.brand.docs,
  queue: theme.warning,
  datastore: theme.brand.dashboard,
  external: hsl(base.gray500)
}

/** Edge stroke treatment per relationship kind. */
export const edgeStyle: Record<string, { dash?: string; color: string }> = {
  http: { color: hsl(base.gray600) },
  rpc: { color: hsl(base.gray600) },
  db: { color: hsl(base.gray700) },
  event: { dash: '2 10', color: hsl(base.gray600) },
  queue: { dash: '10 8', color: hsl(base.warning, 0.7) },
  cron: { dash: '4 8', color: hsl(base.success, 0.7) }
}
