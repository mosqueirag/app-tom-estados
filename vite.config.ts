import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { VitePWA } from 'vite-plugin-pwa';
import { fileURLToPath, URL } from 'node:url';

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      // La app avisa cuando hay versión nueva (no se recarga sola en medio de una lectura).
      registerType: 'prompt',
      includeAssets: ['icons/icono.svg', 'icons/apple-touch-icon.png'],
      manifest: {
        name: 'Lecturas de medidores',
        short_name: 'Lecturas',
        description: 'Toma de lecturas de medidores, también sin conexión.',
        lang: 'es-AR',
        start_url: '/',
        scope: '/',
        display: 'standalone',
        orientation: 'portrait',
        theme_color: '#0f766e',
        background_color: '#f8fafc',
        icons: [
          { src: '/icons/icono-192.png', sizes: '192x192', type: 'image/png' },
          { src: '/icons/icono-512.png', sizes: '512x512', type: 'image/png' },
          { src: '/icons/icono-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        // Se guarda la app completa (incluido el módulo de Excel del admin) para abrir sin señal.
        globPatterns: ['**/*.{js,css,html,svg,png,ico,webmanifest}'],
        maximumFileSizeToCacheInBytes: 5 * 1024 * 1024,
        navigateFallback: '/index.html',
        cleanupOutdatedCaches: true,
        // Las llamadas a Supabase NUNCA se cachean: van siempre a la red.
        navigateFallbackDenylist: [/^\/functions\//, /^\/rest\//, /^\/auth\//],
        // Avisos push: public/push-sw.js muestra la notificación y abre la app al tocarla.
        importScripts: ['/push-sw.js'],
      },
      devOptions: { enabled: false },
    }),
  ],
  // El módulo de Excel (xlsx) va en un archivo aparte y solo lo usa el admin.
  build: { chunkSizeWarningLimit: 800 },
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
});
