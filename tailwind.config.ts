import type { Config } from "tailwindcss";
import plugin from "tailwindcss/plugin";
import twColors from "tailwindcss/colors";

// ─── Paleta de estados que funciona en claro y oscuro ──────────────────────
// Las pantallas usan clases como text-emerald-300 o bg-amber-500/10, pensadas
// para fondo oscuro. Cada tono pasa a una variable CSS: en oscuro vale lo de
// siempre; en claro la escala se invierte (50↔950, 100↔900 … 400↔600, 500
// igual), así un texto claro sobre fondo oscuro pasa a texto oscuro sobre
// fondo claro sin tocar cada pantalla.
const FAMILIAS = [
  "slate", "gray", "zinc", "neutral", "stone", "red", "orange", "amber",
  "yellow", "lime", "green", "emerald", "teal", "cyan", "sky", "blue",
  "indigo", "violet", "purple", "fuchsia", "pink", "rose",
] as const;
const TONOS = ["50", "100", "200", "300", "400", "500", "600", "700", "800", "900", "950"] as const;
const INVERSO: Record<string, string> = Object.fromEntries(
  TONOS.map((t, i) => [t, TONOS[TONOS.length - 1 - i]]),
);
const rgb = (hex: string) => {
  const h = hex.replace("#", "");
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16)).join(" ");
};
type Escala = Record<(typeof TONOS)[number], string>;
const escala = (f: (typeof FAMILIAS)[number]) =>
  (twColors as unknown as Record<string, Escala>)[f];
const paletaVariable = Object.fromEntries(
  FAMILIAS.map((f) => [
    f,
    Object.fromEntries(
      TONOS.map((t) => [t, `rgb(var(--tw-${f}-${t}) / <alpha-value>)`]),
    ),
  ]),
);
const variables = (invertir: boolean) =>
  Object.fromEntries(
    FAMILIAS.flatMap((f) =>
      TONOS.map((t) => [
        `--tw-${f}-${t}`,
        rgb(escala(f)[(invertir ? INVERSO[t] : t) as (typeof TONOS)[number]]),
      ]),
    ),
  );
const paletaEstados = plugin(({ addBase }) => {
  addBase({ ":root": variables(true), ".dark": variables(false) });
});

const config: Config = {
  darkMode: ["class"],
  content: [
    "./pages/**/*.{ts,tsx}",
    "./components/**/*.{ts,tsx}",
    "./app/**/*.{ts,tsx}",
    "./agents/**/*.{ts,tsx}",
    "./lib/**/*.{ts,tsx}",
  ],
  theme: {
    container: {
      center: true,
      padding: "2rem",
      screens: {
        "2xl": "1400px",
      },
    },
    extend: {
      fontFamily: {
        // Toda la app en Inter. "mono" (montos, teléfonos, ids) también es
        // Inter: con cifras tabulares (globals.css) las columnas siguen
        // alineadas sin cambiar de letra, como en los paneles tipo Stripe.
        mono: [
          '"Inter Variable"',
          "Inter",
          "ui-sans-serif",
          "system-ui",
          "sans-serif",
        ],
        sans: [
          '"Inter Variable"',
          "Inter",
          "ui-sans-serif",
          "system-ui",
          "-apple-system",
          '"Segoe UI"',
          "sans-serif",
        ],
      },
      colors: {
        ...paletaVariable,
        border: "hsl(var(--border))",
        input: "hsl(var(--input))",
        ring: "hsl(var(--ring))",
        background: "hsl(var(--background))",
        foreground: "hsl(var(--foreground))",
        primary: {
          DEFAULT: "hsl(var(--primary))",
          foreground: "hsl(var(--primary-foreground))",
        },
        secondary: {
          DEFAULT: "hsl(var(--secondary))",
          foreground: "hsl(var(--secondary-foreground))",
        },
        muted: {
          DEFAULT: "hsl(var(--muted))",
          foreground: "hsl(var(--muted-foreground))",
        },
        accent: {
          DEFAULT: "hsl(var(--accent))",
          foreground: "hsl(var(--accent-foreground))",
        },
        destructive: {
          DEFAULT: "hsl(var(--destructive))",
          foreground: "hsl(var(--destructive-foreground))",
        },
        card: {
          DEFAULT: "hsl(var(--card))",
          foreground: "hsl(var(--card-foreground))",
        },
        seleccion: "hsl(var(--seleccion))",
      },
      borderRadius: {
        lg: "var(--radius)",
        md: "calc(var(--radius) - 2px)",
        sm: "calc(var(--radius) - 4px)",
      },
      keyframes: {
        "accordion-down": {
          from: { height: "0" },
          to: { height: "var(--radix-accordion-content-height)" },
        },
        "accordion-up": {
          from: { height: "var(--radix-accordion-content-height)" },
          to: { height: "0" },
        },
        pulse: {
          "0%, 100%": { opacity: "1" },
          "50%": { opacity: "0.5" },
        },
      },
      animation: {
        "accordion-down": "accordion-down 0.2s ease-out",
        "accordion-up": "accordion-up 0.2s ease-out",
        pulse: "pulse 2s cubic-bezier(0.4, 0, 0.6, 1) infinite",
      },
    },
  },
  plugins: [paletaEstados],
};

export default config;
