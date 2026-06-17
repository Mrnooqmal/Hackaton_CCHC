import { createContext, useContext, useState, useCallback } from 'react';
import type { ReactNode } from 'react';

export const DEFAULT_PRIMARY_COLOR = '#006edc';

interface BrandContextType {
  logo: string | null;
  primaryColor: string;
  setLogo: (logo: string | null) => void;
  setPrimaryColor: (color: string) => void;
}

export const BrandContext = createContext<BrandContextType>({
  logo: null,
  primaryColor: DEFAULT_PRIMARY_COLOR,
  setLogo: () => {},
  setPrimaryColor: () => {},
});

function hexToRgb(hex: string): [number, number, number] | null {
  const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex);
  if (!m) return null;
  return [parseInt(m[1], 16), parseInt(m[2], 16), parseInt(m[3], 16)];
}

export function applyPrimaryColor(hex: string) {
  const rgb = hexToRgb(hex);
  if (!rgb) return;
  const [r, g, b] = rgb;

  const clamp = (n: number) => Math.max(0, Math.min(255, Math.round(n)));
  const toHex = (n: number) => clamp(n).toString(16).padStart(2, '0');
  // t in [0,1]: mix toward white;  t > 1 allowed to mix toward black
  const lighten = (t: number) =>
    `#${toHex(255 + (r - 255) * t)}${toHex(255 + (g - 255) * t)}${toHex(255 + (b - 255) * t)}`;
  const darken = (t: number) =>
    `#${toHex(r * t)}${toHex(g * t)}${toHex(b * t)}`;

  // Remove previous injection if any
  document.getElementById('brand-colors')?.remove();

  const style = document.createElement('style');
  style.id = 'brand-colors';
  // Use a <style> tag instead of inline styles so :root and :root.theme-light
  // cascade correctly — both dark-mode and light-mode accent values are covered.
  style.textContent = `
    :root {
      --primary-50:  ${lighten(0.07)};
      --primary-100: ${lighten(0.14)};
      --primary-200: ${lighten(0.30)};
      --primary-300: ${lighten(0.55)};
      --primary-400: ${lighten(0.78)};
      --primary-500: ${hex};
      --primary-600: ${darken(0.75)};
      --primary-700: ${darken(0.55)};
      --primary-800: ${darken(0.38)};
      --primary-900: ${darken(0.22)};
      --cchc-blue:              ${hex};
      --cchc-blue-600:          ${darken(0.75)};
      --cchc-blue-700:          ${darken(0.55)};
      --cchc-blue-tint:         rgba(${r}, ${g}, ${b}, 0.10);
      --cchc-blue-tint-strong:  rgba(${r}, ${g}, ${b}, 0.16);
      --cchc-navy:              ${darken(0.22)};
      --shadow-glow-primary:    0 0 20px rgba(${r}, ${g}, ${b}, 0.3);
      /* Dark-mode accents: lighter variants readable on dark surfaces */
      --accent:      ${lighten(0.82)};
      --accent-text: ${lighten(0.88)};
      --accent-tint: rgba(${r}, ${g}, ${b}, 0.16);
      --brand-ink:   ${lighten(0.93)};
    }
    :root.theme-light {
      /* Light-mode accents: primary itself or darker variants on white */
      --accent:      ${hex};
      --accent-text: ${darken(0.75)};
      --accent-tint: rgba(${r}, ${g}, ${b}, 0.10);
      --brand-ink:   ${darken(0.55)};
    }
  `;
  document.head.appendChild(style);
}

export function BrandProvider({ children }: { children: ReactNode }) {
  const [logo, setLogoState] = useState<string | null>(null);
  const [primaryColor, setPrimaryColorState] = useState(DEFAULT_PRIMARY_COLOR);

  const setLogo = useCallback((newLogo: string | null) => {
    setLogoState(newLogo);
  }, []);

  const setPrimaryColor = useCallback((color: string) => {
    setPrimaryColorState(color);
    applyPrimaryColor(color);
  }, []);

  return (
    <BrandContext.Provider value={{ logo, primaryColor, setLogo, setPrimaryColor }}>
      {children}
    </BrandContext.Provider>
  );
}

export function useBrand() {
  return useContext(BrandContext);
}
