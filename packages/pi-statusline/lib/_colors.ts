/**
 * pi-statusline - Color gradient utilities
 *
 * Generates ANSI True Color codes interpolating from green (0%) through
 * yellow (50%) to red (100%) using HSL hue rotation.
 */

// HSL → RGB
function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  h = ((h % 360) + 360) % 360;
  s = Math.max(0, Math.min(1, s));
  l = Math.max(0, Math.min(1, l));

  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;

  let r = 0, g = 0, b = 0;
  if (h < 60) { r = c; g = x; }
  else if (h < 120) { r = x; g = c; }
  else if (h < 180) { g = c; b = x; }
  else if (h < 240) { g = x; b = c; }
  else if (h < 300) { r = x; b = c; }
  else { r = c; b = x; }

  return [
    Math.round((r + m) * 255),
    Math.round((g + m) * 255),
    Math.round((b + m) * 255),
  ];
}

// ANSI True Color escape
function trueColor(r: number, g: number, b: number, bg = false): string {
  return `\x1b[${bg ? "48" : "38"};2;${r};${g};${b}m`;
}

/**
 * Return a function that colors text based on a 0–1 value.
 * 0 = green, 0.5 = yellow, 1 = red.
 */
export function gradientColor(value: number): string {
  const clamped = Math.max(0, Math.min(1, value));
  // Hue: 120° (green) → 0° (red)
  const hue = 120 * (1 - clamped);
  const [r, g, b] = hslToRgb(hue, 0.9, 0.48);
  return trueColor(r, g, b);
}

/**
 * Apply gradient color to a string based on 0–1 value.
 */
export function gradient(text: string, value: number): string {
  return `${gradientColor(value)}${text}\x1b[0m`;
}

/**
 * Format token count for display: <1000 as-is, else "N.Nk" or "N.NM"
 */
export function fmtTokens(n: number): string {
  if (n < 1000) return String(n);
  if (n < 1_000_000) return `${(n / 1000).toFixed(0)}k`;
  return `${(n / 1_000_000).toFixed(1)}M`;
}
