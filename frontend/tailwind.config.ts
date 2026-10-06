import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./src/**/*.{js,ts,jsx,tsx,mdx}"],
  theme: {
    extend: {
      colors: {
        fiducia: {
          bg: "var(--bg)",
          card: "var(--card)",
          ink: "var(--ink)",
          muted: "var(--mut)",
          line: "var(--line)",
          accent: "var(--acc)",
          amber: "var(--acc2)",
          valid: "var(--verdict-valid)",
          warning: "var(--verdict-warning)",
          rejected: "var(--verdict-rejected)",
          focus: "var(--focus)",
        },
      },
      boxShadow: {
        glow: "var(--sh)",
      },
      borderRadius: { panel: "24px" },
    },
  },
  plugins: [],
};

export default config;
