import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        ink: "#111827",
        mist: "#eef4f3",
        lagoon: "#0f766e",
        coral: "#ef6f6c",
        gold: "#f6c453"
      },
      boxShadow: {
        panel: "0 18px 45px rgba(17, 24, 39, 0.10)"
      }
    }
  },
  plugins: []
};

export default config;
