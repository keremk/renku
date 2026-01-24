import fs from "node:fs"
import os from "node:os"
import path from "path"
import { fileURLToPath } from "node:url"
import { config as dotenvConfig } from "dotenv"
import tailwindcss from "@tailwindcss/vite"
import react from "@vitejs/plugin-react"
import { defineConfig, loadEnv } from "vite"
import { createViewerApiMiddleware } from "./server/viewer-api"

// Load .env files for the API middleware (providers need API keys)
// These need to be loaded into process.env for the server-side code
const __dirnameForEnv = path.dirname(fileURLToPath(import.meta.url))
const envPaths = [
  path.resolve(process.cwd(), ".env"),
  path.resolve(process.cwd(), "..", ".env"),
  path.resolve(process.cwd(), "cli", ".env"),
  path.resolve(__dirnameForEnv, "..", "cli", ".env"),
  path.resolve(__dirnameForEnv, "..", ".env"),
]
for (const envPath of envPaths) {
  const result = dotenvConfig({ path: envPath, override: false })
  if (result.parsed) {
    console.log(`[viewer] Loaded env from: ${envPath}`)
  }
}

const expandPath = (input: string | null | undefined) => {
  if (!input) return null
  const withHome = input.startsWith("~/") ? path.join(os.homedir(), input.slice(2)) : input
  return path.isAbsolute(withHome) ? withHome : path.resolve(process.cwd(), withHome)
}

const __dirname = path.dirname(fileURLToPath(import.meta.url))

export default defineConfig(({ mode }) => {
  const env = {
    ...loadEnv(mode, process.cwd(), ""),
    ...loadEnv(mode, __dirname, ""),
  }
  const candidate =
    env.RENKU_VIEWER_ROOT ??
    env.VITE_RENKU_ROOT ??
    process.env.RENKU_VIEWER_ROOT ??
    process.env.VITE_RENKU_ROOT ??
    resolveCliRootFromConfig()
  const viewerRoot = expandPath(candidate)

  return {
    plugins: [
      react({
        babel: {
          plugins: [["babel-plugin-react-compiler"]],
        },
      }),
      tailwindcss(),
      {
        name: "renku-viewer-api",
        apply: "serve",
        configureServer(server) {
          if (!viewerRoot) {
            throw new Error(
              '[viewer] RENKU_VIEWER_ROOT is not set. Set it in viewer/.env or run "renku init" so the config exists.',
            )
          }
          console.log(`[viewer] Using builds root: ${viewerRoot}`)
          server.middlewares.use(createViewerApiMiddleware(viewerRoot))
        },
      },
    ],
    resolve: {
      alias: {
        "@": path.resolve(__dirname, "./src"),
      },
    },
    server: {
      fs: {
        allow: [path.resolve(__dirname, ".."), ...(viewerRoot ? [viewerRoot] : [])],
      },
    },
  }
})

function resolveCliRootFromConfig(): string | null {
  const configPath =
    process.env.RENKU_CLI_CONFIG ??
    path.join(os.homedir(), ".renku", "cli-config.json")
  try {
    const data = JSON.parse(fs.readFileSync(configPath, "utf8")) as {
      storage?: { root?: string }
    }
    return data.storage?.root ?? null
  } catch {
    return null
  }
}
