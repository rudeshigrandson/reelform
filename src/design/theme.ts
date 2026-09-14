/**
 * Typed mirror of the Organic tokens in `tokens.css`. React components should
 * prefer the CSS custom properties; this module exists for contexts that can't
 * read CSS variables — chiefly PixiJS, which needs concrete numeric colors.
 */

export const colors = {
  bg: "#f5ead8",
  surface: "#ebddc5",
  text: "#201e1d",
  accent: "#c67139",
  accent2: "#7a8a5e",
  neutral: {
    100: "#f9f4ed",
    200: "#eee7db",
    300: "#dcd3c4",
    400: "#c0b6a5",
    500: "#a19786",
    600: "#82796a",
    700: "#645c50",
    800: "#474238",
    900: "#2e2b25",
  },
  accentRamp: {
    100: "#fff2eb",
    200: "#ffe1d0",
    300: "#ffc6a5",
    400: "#f6a06b",
    500: "#d67f48",
    600: "#b2622d",
    700: "#8c491a",
    800: "#643312",
    900: "#402310",
  },
} as const;

/** Convert a "#rrggbb" string to the 0xRRGGBB number PixiJS expects. */
export function hexToPixi(hex: string): number {
  return Number.parseInt(hex.replace("#", ""), 16);
}

export const fonts = {
  heading: '"Caprasimo", system-ui, sans-serif',
  body: '"Figtree", system-ui, sans-serif',
} as const;

export const radius = { sm: 8, md: 16, lg: 28 } as const;
