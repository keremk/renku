import fs from "node:fs"
import os from "node:os"
import path from "path"
import { fileURLToPath } from "node:url"
import tailwindcss from "@tailwindcss/vite"
import react from "@vitejs/plugin-react"
import { defineConfig, loadEnv } from "vite"
import { createViewerApiMiddleware } from "./server/viewer-api"

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
    env.TUTOPANDA_VIEWER_ROOT ??
    env.VITE_TUTOPANDA_ROOT ??
    process.env.TUTOPANDA_VIEWER_ROOT ??
    process.env.VITE_TUTOPANDA_ROOT ??
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
        name: "tutopanda-viewer-api",
        apply: "serve",
        configureServer(server) {
          if (!viewerRoot) {
            throw new Error(
              '[viewer] TUTOPANDA_VIEWER_ROOT is not set. Set it in viewer/.env or run "tutopanda init" so the config exists.',
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
    process.env.TUTOPANDA_CLI_CONFIG ??
    path.join(os.homedir(), ".tutopanda", "cli-config.json")
  try {
    const data = JSON.parse(fs.readFileSync(configPath, "utf8")) as {
      storage?: { root?: string }
    }
    return data.storage?.root ?? null
  } catch {
    return null
  }
}
