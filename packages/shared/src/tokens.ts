// Dizajn tokeni (SPEC sekcija 7 „Dizajn"). Vrednosti žive u tokens.json, da ih
// mogu čitati i TypeScript i tailwind-preset.js — jedan izvor za web i telefon.
import tokens from './tokens.json';

export const designTokens = tokens;

export const colors = tokens.color;
export const radius = tokens.radius;
export const font = tokens.font;

/** Najmanji dodirni element: 44 px (SPEC sekcija 7, pravilo iz CLAUDE.md). */
export const MIN_TOUCH_TARGET = 44;

export type ColorScale = typeof tokens.color.primary;
