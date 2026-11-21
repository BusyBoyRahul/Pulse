/**
 * Pulse design system.
 *
 * One source of truth for colour, type, spacing, radius and elevation.
 *
 * THEMES: System (follows the phone), Light, Dark — each with a choice of accent
 * colour and, in dark, a background style. Colours are resolved ONCE at startup
 * (see Boot.tsx → applyTheme) and written into the `colors` object below BEFORE
 * any screen is loaded, so every StyleSheet picks up the chosen theme. Changing
 * the theme restarts the app so every screen redraws cleanly.
 *
 * Red is reserved for danger (and SOS when you open it). Everything else is
 * driven by the accent.
 */
import {Appearance} from 'react-native';
import {bumpTheme} from './themed';
import {storage} from '@/services/storage';

// ---------------------------------------------------------------------------
// choices
// ---------------------------------------------------------------------------

export type ThemeMode = 'system' | 'light' | 'dark';
export type DarkStyle = 'midnight' | 'graphite' | 'amoled';

export type AccentKey = 'violet' | 'ocean' | 'emerald' | 'coral' | 'amber' | 'rose' | 'teal' | 'custom';

/** [main, second hue used for gradients]. */
export const ACCENTS: Record<Exclude<AccentKey, 'custom'>, {label: string; a: string; b: string}> = {
  violet: {label: 'Violet', a: '#7C5CFF', b: '#C25BFF'},
  ocean: {label: 'Ocean', a: '#2F8BFF', b: '#27D3F5'},
  emerald: {label: 'Emerald', a: '#12B981', b: '#7BE495'},
  coral: {label: 'Coral', a: '#FF6B5B', b: '#FFA85B'},
  amber: {label: 'Amber', a: '#F5A524', b: '#FFD36B'},
  rose: {label: 'Rose', a: '#F0457E', b: '#FF8FB1'},
  teal: {label: 'Teal', a: '#14B8C6', b: '#5EE2B5'},
};

export type ThemePrefs = {
  mode: ThemeMode;
  accent: AccentKey;
  /** #RRGGBB when accent === 'custom'. */
  custom?: string;
  dark: DarkStyle;
};

export const DEFAULT_THEME: ThemePrefs = {mode: 'system', accent: 'ocean', dark: 'midnight'};
export const THEME_STORAGE_KEY = 'settings.theme';

export function readThemePrefs(): ThemePrefs {
  try {
    const raw = storage.getString(THEME_STORAGE_KEY);
    return raw ? {...DEFAULT_THEME, ...(JSON.parse(raw) as Partial<ThemePrefs>)} : DEFAULT_THEME;
  } catch {
    return DEFAULT_THEME;
  }
}

export function saveThemePrefs(p: ThemePrefs): void {
  storage.set(THEME_STORAGE_KEY, JSON.stringify(p));
}

// ---------------------------------------------------------------------------
// colour maths (no dependency)
// ---------------------------------------------------------------------------

const clamp = (n: number) => Math.max(0, Math.min(255, Math.round(n)));

function parse(hex: string): [number, number, number] {
  const h = hex.replace('#', '');
  const f = h.length === 3 ? h.split('').map(c => c + c).join('') : h.padEnd(6, '0');
  return [parseInt(f.slice(0, 2), 16), parseInt(f.slice(2, 4), 16), parseInt(f.slice(4, 6), 16)];
}
const toHex = (r: number, g: number, b: number) => '#' + [r, g, b].map(v => clamp(v).toString(16).padStart(2, '0')).join('');

/** Blend `a` over `b` by `t` (0 = b, 1 = a). */
export function mix(a: string, b: string, t: number): string {
  const [ar, ag, ab] = parse(a);
  const [br, bg, bb] = parse(b);
  return toHex(br + (ar - br) * t, bg + (ag - bg) * t, bb + (ab - bb) * t);
}

export function alpha(hex: string, a: number): string {
  const [r, g, b] = parse(hex);
  return `rgba(${r},${g},${b},${a})`;
}

/** Perceived brightness 0..1. */
const luma = (hex: string) => {
  const [r, g, b] = parse(hex);
  return (0.299 * r + 0.587 * g + 0.114 * b) / 255;
};

// ---------------------------------------------------------------------------
// the colour tokens (names unchanged from earlier versions)
// ---------------------------------------------------------------------------

export type Colors = {
  bg: string;
  surface: string;
  surfaceRaised: string;
  surfaceHover: string;
  border: string;

  text: string;
  textSecondary: string;
  textMuted: string;

  primary: string;
  primaryBright: string;
  primaryDim: string;
  /** Second hue of the accent gradient. */
  accent2: string;

  danger: string;
  dangerBright: string;
  dangerDim: string;
  success: string;
  warning: string;

  meshOnline: string;
  meshRelay: string;

  onPrimary: string;
  onDanger: string;

  /** Frosted-glass layers (translucent white/black over whatever is behind). */
  glass: string;
  glassStrong: string;
  glassBorder: string;
  /** Soft coloured glow behind accent elements. */
  glow: string;
  /** Dim layer drawn over photos so text stays readable. */
  scrim: string;
  /** Chat bubbles. */
  bubbleMine: string;
  bubbleMine2: string;
  bubbleTheirs: string;
  onBubbleMine: string;
};

const DARK_BASES: Record<DarkStyle, {bg: string; s1: string; s2: string; s3: string; line: string}> = {
  midnight: {bg: '#070813', s1: '#0E1020', s2: '#151832', s3: '#1D2140', line: '#262B4D'},
  graphite: {bg: '#0B0B0D', s1: '#131316', s2: '#1B1B20', s3: '#24242B', line: '#2E2E36'},
  amoled: {bg: '#000000', s1: '#0A0A0C', s2: '#121215', s3: '#1B1B1F', line: '#26262B'},
};

export const colors: Colors = {} as Colors;
export const themeInfo = {
  isDark: true,
  mode: 'dark' as 'light' | 'dark',
  accentA: ACCENTS.violet.a,
  accentB: ACCENTS.violet.b,
  prefs: DEFAULT_THEME,
};

export function resolveColors(prefs: ThemePrefs, systemScheme: 'light' | 'dark'): {colors: Colors; isDark: boolean; a: string; b: string} {
  const isDark = prefs.mode === 'system' ? systemScheme === 'dark' : prefs.mode === 'dark';
  let a: string;
  let b: string;
  if (prefs.accent === 'custom' && prefs.custom && /^#[0-9a-fA-F]{6}$/.test(prefs.custom)) {
    a = prefs.custom;
    b = mix('#FFFFFF', a, 0.28);
  } else {
    const p = ACCENTS[(prefs.accent === 'custom' ? 'violet' : prefs.accent) as keyof typeof ACCENTS] ?? ACCENTS.violet;
    a = p.a;
    b = p.b;
  }
  const onAccent = luma(a) > 0.72 ? '#12131C' : '#FFFFFF';

  if (isDark) {
    const d = DARK_BASES[prefs.dark] ?? DARK_BASES.midnight;
    return {
      isDark,
      a,
      b,
      colors: {
        bg: d.bg,
        surface: d.s1,
        surfaceRaised: d.s2,
        surfaceHover: d.s3,
        border: d.line,
        text: '#F4F5FC',
        textSecondary: '#A9ADC6',
        textMuted: '#6F7491',
        primary: a,
        primaryBright: mix('#FFFFFF', a, 0.32),
        primaryDim: mix(a, d.bg, 0.2),
        accent2: b,
        danger: '#FF4D5E',
        dangerBright: '#FF7480',
        dangerDim: '#3A141B',
        success: '#3DDC97',
        warning: '#FFB84D',
        meshOnline: '#3DDC97',
        meshRelay: '#5BB8FF',
        onPrimary: onAccent,
        onDanger: '#FFFFFF',
        glass: 'rgba(255,255,255,0.07)',
        glassStrong: 'rgba(255,255,255,0.12)',
        glassBorder: 'rgba(255,255,255,0.13)',
        glow: alpha(a, 0.45),
        scrim: 'rgba(5,6,16,0.55)',
        bubbleMine: a,
        bubbleMine2: b,
        bubbleTheirs: d.s2,
        onBubbleMine: onAccent,
      },
    };
  }

  const bg = '#F4F5FB';
  return {
    isDark,
    a,
    b,
    colors: {
      bg,
      surface: '#FFFFFF',
      surfaceRaised: '#ECEEF8',
      surfaceHover: '#E2E5F3',
      border: '#DADDEE',
      text: '#12131D',
      textSecondary: '#555A75',
      textMuted: '#8A8FA9',
      primary: a,
      primaryBright: mix('#000000', a, 0.15), // the accent, a touch darker, for text on light backgrounds
      primaryDim: mix(a, '#FFFFFF', 0.14),
      accent2: b,
      danger: '#E5334A',
      dangerBright: '#D12A41',
      dangerDim: '#FDE3E7',
      success: '#10A66B',
      warning: '#D98A0B',
      meshOnline: '#10A66B',
      meshRelay: '#2B7FD6',
      onPrimary: onAccent,
      onDanger: '#FFFFFF',
      glass: 'rgba(255,255,255,0.62)',
      glassStrong: 'rgba(255,255,255,0.85)',
      glassBorder: 'rgba(255,255,255,0.9)',
      glow: alpha(a, 0.3),
      scrim: 'rgba(255,255,255,0.35)',
      bubbleMine: a,
      bubbleMine2: b,
      bubbleTheirs: '#FFFFFF',
      onBubbleMine: onAccent,
    },
  };
}

/** Resolve the saved choice and write it into `colors`. Call once, before the app loads. */
export function applyTheme(prefs: ThemePrefs = readThemePrefs()): void {
  const scheme = Appearance.getColorScheme() === 'light' ? 'light' : 'dark';
  const r = resolveColors(prefs, scheme);
  Object.assign(colors, r.colors);
  themeInfo.isDark = r.isDark;
  themeInfo.mode = r.isDark ? 'dark' : 'light';
  themeInfo.accentA = r.a;
  themeInfo.accentB = r.b;
  themeInfo.prefs = prefs;
}

/** Apply a theme to the RUNNING app: new colours, every style rebuilt, the whole screen repainted. No restart. */
export function applyThemeLive(prefs: ThemePrefs = readThemePrefs()): void {
  applyTheme(prefs);
  bumpTheme();
}

// Safe defaults so anything that reads `colors` before Boot (tests, tooling) still works.
applyTheme(DEFAULT_THEME);

// ---------------------------------------------------------------------------
// the rest of the system
// ---------------------------------------------------------------------------

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
  sm: 10,
  md: 16,
  lg: 22,
  xl: 30,
  pill: 999,
} as const;

export const typography = {
  display: {fontSize: 36, lineHeight: 42, fontWeight: '800' as const, letterSpacing: -0.8},
  title: {fontSize: 27, lineHeight: 33, fontWeight: '800' as const, letterSpacing: -0.5},
  heading: {fontSize: 20, lineHeight: 26, fontWeight: '700' as const, letterSpacing: -0.2},
  subtitle: {fontSize: 17, lineHeight: 24, fontWeight: '600' as const},
  body: {fontSize: 15, lineHeight: 22, fontWeight: '400' as const},
  bodyStrong: {fontSize: 15, lineHeight: 22, fontWeight: '600' as const},
  caption: {fontSize: 13, lineHeight: 18, fontWeight: '500' as const},
  label: {fontSize: 12, lineHeight: 16, fontWeight: '700' as const, letterSpacing: 0.7},
  mono: {fontSize: 13, lineHeight: 18, fontWeight: '500' as const},
} as const;

/**
 * The colour of shadows. Soft blue-grey on a light page; pure black on a dark one, because a pale shadow on a dark page
 * shows up as a light smudge instead of depth. Read when used, so it follows a live theme change.
 */
export const shadowTone = (): string => (themeInfo.isDark ? '#000000' : '#9AA5CC');

export const elevation = {
  get card() {
    return {shadowColor: shadowTone(), shadowOffset: {width: 0, height: 4}, shadowOpacity: themeInfo.isDark ? 0.35 : 0.1, shadowRadius: 12, elevation: 2};
  },
  get floating() {
    return {shadowColor: shadowTone(), shadowOffset: {width: 0, height: 8}, shadowOpacity: themeInfo.isDark ? 0.45 : 0.14, shadowRadius: 20, elevation: 6};
  },
  /** For the round action button: a soft glow in the accent colour. */
  get button() {
    return {shadowColor: colors.primary, shadowOffset: {width: 0, height: 6}, shadowOpacity: themeInfo.isDark ? 0.3 : 0.35, shadowRadius: 14, elevation: 5};
  },
};

/** A coloured glow shadow (iOS-style; on Android it falls back to elevation). */
export const glow = (color: string, strength = 1) => ({
  shadowColor: color,
  shadowOffset: {width: 0, height: 2},
  shadowOpacity: 0.2 * strength,
  shadowRadius: 8 * strength,
  elevation: 0,
});

/** Standard motion timings so the whole app moves the same way. */
export const motion = {
  fast: 140,
  base: 240,
  slow: 420,
  spring: {damping: 16, stiffness: 220, mass: 0.7},
} as const;

export const theme = {
  colors,
  spacing,
  radius,
  typography,
  elevation,
  motion,
} as const;

export type Theme = typeof theme;
export default theme;
