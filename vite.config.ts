/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';
import { fileURLToPath, URL } from 'node:url';
import type { Plugin } from 'vite';

/** Strict Content-Security-Policy, added to production builds only (dev needs inline HMR scripts). */
const CSP = "default-src 'self'; script-src 'self' 'sha256-NuA+yGkYnD31TIrxjD662lGGLF0uXKytZowgl+I94u4='; style-src 'self' 'unsafe-inline'; img-src 'self' blob: data:; font-src 'self'; connect-src 'self'; worker-src 'self'; manifest-src 'self'; object-src 'none'; base-uri 'self'; form-action 'none'";
function csp(): Plugin {
  // the optional push Worker is the only other origin the app may talk to
  const pushApi = process.env.VITE_PUSH_API;
  const policy = pushApi ? CSP.replace("connect-src 'self'", `connect-src 'self' ${new URL(pushApi).origin}`) : CSP;
  return {
    name: 'forma-csp',
    apply: 'build',
    transformIndexHtml: (html) => html.replace('<meta charset="UTF-8" />', `<meta charset="UTF-8" />
    <meta http-equiv="Content-Security-Policy" content="${policy}" />`),
  };
}

export default defineConfig({
  base: './',
  define: { __APP_VERSION__: JSON.stringify(process.env.npm_package_version ?? '1.0.0') },
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
  plugins: [
    react(),
    csp(),
    VitePWA({
      strategies: 'injectManifest',
      srcDir: 'src',
      filename: 'sw.ts',
      registerType: 'prompt',
      injectRegister: false,
      manifest: false,
      injectManifest: {
        globPatterns: ['**/*.{js,css,html,svg,png,woff,woff2,webmanifest,txt}'],
        globIgnores: ['splash/**'],
        maximumFileSizeToCacheInBytes: 4 * 1024 * 1024,
      },
      devOptions: { enabled: false },
    }),
  ],
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 700,
  },
  test: {
    environment: 'jsdom',
    include: ['tests/unit/**/*.test.ts', 'tests/unit/**/*.test.tsx'],
    setupFiles: ['tests/unit/setup.ts'],
  },
});
