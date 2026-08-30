import { defineConfig } from "vite"
import react from "@vitejs/plugin-react"

export default defineConfig({
  plugins: [react()],
  server: {
    // The web app talks to the API on 3001. One place to change it.
    proxy: { "/api": "http://localhost:3001" },
  },
})
