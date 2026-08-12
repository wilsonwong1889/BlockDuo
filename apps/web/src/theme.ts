/**
 * The seven block colours.
 *
 * Chosen to stay distinguishable for the common colour-vision deficiencies:
 * they walk around the hue wheel with varying lightness rather than clustering,
 * so neighbouring blocks differ in brightness as well as hue. Colour is never
 * the only signal in the game — nothing about play depends on telling two
 * blocks apart — so this is about looking good, not about legibility of state.
 */
export const BLOCK_COLORS: Record<number, { base: string; light: string; dark: string }> = {
  1: { base: '#f43f5e', light: '#fda4af', dark: '#9f1239' },
  2: { base: '#f97316', light: '#fdba74', dark: '#9a3412' },
  3: { base: '#facc15', light: '#fef08a', dark: '#a16207' },
  4: { base: '#22c55e', light: '#86efac', dark: '#15803d' },
  5: { base: '#06b6d4', light: '#67e8f9', dark: '#0e7490' },
  6: { base: '#6366f1', light: '#a5b4fc', dark: '#3730a3' },
  7: { base: '#a855f7', light: '#d8b4fe', dark: '#6b21a8' },
};

export function colorVars(color: number): React.CSSProperties {
  const c = BLOCK_COLORS[color] ?? BLOCK_COLORS[1];
  return {
    '--block': c.base,
    '--block-light': c.light,
    '--block-dark': c.dark,
  } as React.CSSProperties;
}
