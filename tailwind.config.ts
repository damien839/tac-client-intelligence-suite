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
    },
  },
  plugins: [],
};
export default config;
