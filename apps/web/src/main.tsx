import { StrictMode } from "react"
import { createRoot } from "react-dom/client"
import { BrowserRouter, Route, Routes } from "react-router-dom"
import { EngineerPage } from "./pages/EngineerPage.tsx"
import { OrgPage } from "./pages/OrgPage.tsx"
import { RunPage } from "./pages/RunPage.tsx"
import { TeamPage } from "./pages/TeamPage.tsx"
import "./styles/global.css"

// Four screens, one drill path: org -> team -> engineer -> run. See docs/ui.md. Every page fetches
// its own data from the real API (apps/web/src/api/) -- see docs/architecture.md for how this
// talks to apps/api.

const el = document.getElementById("root")
if (!el) throw new Error("no #root in index.html")

createRoot(el).render(
  <StrictMode>
    <BrowserRouter>
      <div className="shell">
        <Routes>
          <Route path="/" element={<OrgPage />} />
          <Route path="/teams/:teamId" element={<TeamPage />} />
          <Route path="/engineers/:engineerId" element={<EngineerPage />} />
          <Route path="/runs/:runId" element={<RunPage />} />
        </Routes>
      </div>
    </BrowserRouter>
  </StrictMode>,
)
