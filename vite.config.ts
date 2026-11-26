import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import fs from 'fs';
import path from 'path';
import {defineConfig} from 'vite';

const configDir = import.meta.dirname || path.resolve('.');
const pkg = JSON.parse(fs.readFileSync(path.resolve(configDir, 'package.json'), 'utf8')) as {
  version?: string;
};

export default defineConfig(() => {
  return {
    define: {
      __APP_VERSION__: JSON.stringify(pkg.version ?? '1.0.0'),
    },
    plugins: [react(), tailwindcss()],
    resolve: {
      alias: {
        '@': path.resolve(configDir, '.'),
      },
    },
    server: {
      // HMR is disabled in AI Studio via DISABLE_HMR env var.
      // Do not modify—file watching is disabled to prevent flickering during agent edits.
      hmr: process.env.DISABLE_HMR !== 'true',
      // Disable file watching when DISABLE_HMR is true to save CPU during agent edits.
      watch:
        process.env.DISABLE_HMR === 'true'
          ? null
          : {
              ignored: [
                '**/sniper/**',
                '**/data/**',
                '**/*.db',
                '**/*.db-*',
                '**/*.sqlite*',
                '**/.playwright-cli/**',
                '**/.env*',
                '**/CHANGELOG.md',
              ],
            },
    },
  };
});
