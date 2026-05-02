import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig, loadEnv } from 'vite';
import { createMovieStudioApiMiddleware } from './server/movie-studio-api';

const expandPath = (input: string | null | undefined) => {
  if (!input) return null;
  const withHome = input.startsWith('~/')
    ? path.join(os.homedir(), input.slice(2))
    : input;
  return path.isAbsolute(withHome)
    ? withHome
    : path.resolve(process.cwd(), withHome);
};

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig(({ mode }) => {
  const env = {
    ...loadEnv(mode, process.cwd(), ''),
    ...loadEnv(mode, __dirname, ''),
  };
  const projectRoot = expandPath(
    env.RENKU_MOVIE_STUDIO_ROOT ?? process.env.RENKU_MOVIE_STUDIO_ROOT
  );

  return {
    plugins: [
      react({
        babel: {
          plugins: [['babel-plugin-react-compiler']],
        },
      }),
      tailwindcss(),
      {
        name: 'renku-movie-studio-api',
        apply: 'serve',
        configureServer(server) {
          server.middlewares.use(createMovieStudioApiMiddleware());
        },
      },
    ],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, './src'),
      },
    },
    server: {
      fs: {
        allow: [
          path.resolve(__dirname, '..'),
          ...(projectRoot && fs.existsSync(projectRoot) ? [projectRoot] : []),
        ],
      },
    },
  };
});
