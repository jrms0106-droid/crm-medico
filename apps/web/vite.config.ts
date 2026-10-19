import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'prompt',
      manifest: {
        name: 'CRM Médico',
        short_name: 'CRM Médico',
        description: 'Gestão de clínica e prontuário eletrônico',
        lang: 'pt-BR',
        start_url: '/',
        display: 'standalone',
        background_color: '#ffffff',
        theme_color: '#0f5f73',
        icons: [{ src: '/icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' }],
      },
      workbox: {
        // Guarda em cache apenas a "casca" do app (HTML, JS, CSS, ícones).
        // Respostas da API nunca são guardadas: dados de pacientes não ficam no aparelho.
        globPatterns: ['**/*.{js,css,html,svg}'],
        navigateFallbackDenylist: [/^\/api\//],
        runtimeCaching: [],
      },
    }),
  ],
  server: {
    port: 5173,
    // Em testes ponta a ponta, a API roda em outra porta (playwright.config.ts).
    proxy: { '/api': process.env['API_URL'] ?? 'http://localhost:3000' },
  },
});
