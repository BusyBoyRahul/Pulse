/**
 * Pulse design system — monochrome.
 *
 * One source of truth for color, type, spacing, radius and elevation. The whole
 * app is true-black and white with greys in between: calm, high-contrast, easy
 * on the eyes at night. The ONLY colour is red, and it is reserved for SOS and
 * destructive actions so an emergency control is unmistakable.
 */

export const palette = {
  // Core surfaces (true black first — OLED friendly, and the Dynamic Island blends in)
  black: '#000000',
  ink900: '#070708',
  ink800: '#101012',
  ink700: '#19191C',
  ink600: '#232327',
  ink500: '#2E2E33',
  line: '#2B2B30',

  // Text
  textPrimary: '#F5F5F7',
  textSecondary: '#A3A3AB',
  textMuted: '#6E6E76',

  // Brand — white is the accent
  pulse: '#FFFFFF',
  pulseBright: '#FFFFFF',
  pulseDim: '#2A2A2E',

  // Semantic — red is for SOS / danger only; everything else is grey-scale
  danger: '#FF4538',
  dangerBright: '#FF6A5E',
  dangerDim: '#3B1511',
  success: '#E9E9ED',
  warning: '#C9C9CF',

  // Mesh presence
  meshOnline: '#FFFFFF',
  meshRelay: '#8E8E96',

  white: '#FFFFFF',
  transparent: 'transparent',
} as const;

export const colors = {
  bg: palette.black,
  surface: palette.ink800,
  surfaceRaised: palette.ink700,
  surfaceHover: palette.ink600,
  border: palette.line,

  text: palette.textPrimary,
  textSecondary: palette.textSecondary,
  textMuted: palette.textMuted,

  primary: palette.pulse,
  primaryBright: palette.pulseBright,
  primaryDim: palette.pulseDim,

  danger: palette.danger,
  dangerBright: palette.dangerBright,
  dangerDim: palette.dangerDim,
  success: palette.success,
  warning: palette.warning,

  meshOnline: palette.meshOnline,
  meshRelay: palette.meshRelay,

  onPrimary: palette.black,
  onDanger: palette.white,

  // The Dynamic Island pill.
  island: '#000000',
  islandBorder: '#1F1F23',
} as const;

export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  xxl: 32,
  xxxl: 48,
} as const;

export const radius = {
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  pill: 999,
} as const;

export const typography = {
  display: {fontSize: 34, lineHeight: 40, fontWeight: '800' as const, letterSpacing: -0.5},
  title: {fontSize: 26, lineHeight: 32, fontWeight: '700' as const, letterSpacing: -0.3},
  heading: {fontSize: 20, lineHeight: 26, fontWeight: '700' as const},
  subtitle: {fontSize: 17, lineHeight: 24, fontWeight: '600' as const},
  body: {fontSize: 15, lineHeight: 22, fontWeight: '400' as const},
  bodyStrong: {fontSize: 15, lineHeight: 22, fontWeight: '600' as const},
  caption: {fontSize: 13, lineHeight: 18, fontWeight: '500' as const},
  label: {fontSize: 12, lineHeight: 16, fontWeight: '700' as const, letterSpacing: 0.6},
  mono: {fontSize: 13, lineHeight: 18, fontWeight: '500' as const},
} as const;

export const elevation = {
  card: {
    shadowColor: '#000000',
    shadowOffset: {width: 0, height: 6},
    shadowOpacity: 0.5,
    shadowRadius: 16,
    elevation: 6,
  },
  floating: {
    shadowColor: '#000000',
    shadowOffset: {width: 0, height: 12},
    shadowOpacity: 0.45,
    shadowRadius: 28,
    elevation: 16,
  },
} as const;

export const theme = {
  palette,
  colors,
  spacing,
  radius,
  typography,
  elevation,
} as const;

export type Theme = typeof theme;
export default theme;
