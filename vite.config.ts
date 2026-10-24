import type { Plugin } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';
import { defineConfig } from 'vitest/config';

/** Fetch and compile the boot chunk before the idle callback evaluates it. */
function preloadBoot(): Plugin {
  const base = '/pottery-wheel/';
  return {
    name: 'preload-boot',
    transformIndexHtml: {
      order: 'post',
      handler(html, ctx) {
        if (ctx.server) {
          const link = `<link rel="modulepreload" crossorigin href="${base}src/boot.ts">`;
          return html.includes(link) ? html : html.replace('</head>', `${link}</head>`);
        }
        const bundle = ctx.bundle ?? {};
        const chunks = Object.values(bundle).filter((item) => item.type === 'chunk');
        // The boot chunk's facade is cleared when its CSS is split into a sibling asset.
        const boot = chunks.find((item) => {
          const facade = item.facadeModuleId?.replaceAll('\\', '/') ?? '';
          return facade.endsWith('/src/boot.ts') || /\/boot-[^/]+\.js$/.test(item.fileName);
        });
        if (!boot) return html;
        // Only the boot chunk. Studio and Three.js stay on the dynamic import
        // so they do not compete with the shell on a slow phone.
        const link = `<link rel="modulepreload" crossorigin href="${base}${boot.fileName}">`;
        return html.includes(link) ? html : html.replace('</head>', `${link}</head>`);
      },
    },
  };
}

export default defineConfig({
  base: '/pottery-wheel/',
  plugins: [
    preloadBoot(),
    VitePWA({
      registerType: 'prompt',
      injectRegister: false,
      manifest: {
        name: 'The Wheel',
        short_name: 'The Wheel',
        description: 'Throw a pot on a pottery wheel.',
        theme_color: '#2a211c',
        background_color: '#2a211c',
        display: 'standalone',
        start_url: '/pottery-wheel/',
        scope: '/pottery-wheel/',
        id: '/pottery-wheel/',
        icons: [
          { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
          { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
          { src: 'icons/icon-maskable-192.png', sizes: '192x192', type: 'image/png', purpose: 'maskable' },
          { src: 'icons/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        navigateFallback: 'index.html',
        // Icons and the manifest are added once by the plugin. A broad png/webmanifest
        // glob precaches them a second time. The share image is not a manifest icon.
        globPatterns: ['**/*.{js,css,html,woff2}', 'og-preview.png', 'room-pmrem.bin'],
        cleanupOutdatedCaches: true,
        skipWaiting: false,
        clientsClaim: false,
        maximumFileSizeToCacheInBytes: 4 * 1024 * 1024,
      },
      devOptions: {
        enabled: false,
      },
    }),
  ],
  server: {
    host: '0.0.0.0',
    port: 5173,
  },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
  },
});
