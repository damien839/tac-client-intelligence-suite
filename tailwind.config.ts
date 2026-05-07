import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        tac: {
          bg: "#1A2A35",
          "bg-light": "#243544",
          "bg-card": "#1F3040",
          accent: "#F5B36B",
          "accent-hover": "#F7C48A",
          text: "#FFFFFF",
          muted: "#A0AEB8",
          border: "#2D4050",
          success: "#4ADE80",
          warning: "#FBBF24",
          danger: "#F87171",
        },
      },
      fontFamily: {
        poppins: ["Poppins", "sans-serif"],
      },
      keyframes: {
        "tac-bounce": {
          "0%, 80%, 100%": { transform: "translateY(0)", opacity: "0.4" },
          "40%": { transform: "translateY(-4px)", opacity: "1" },
        },
      },
      animation: {
        "tac-bounce": "tac-bounce 1.2s ease-in-out infinite",
      },
    },
  },
  plugins: [],
};
export default config;
