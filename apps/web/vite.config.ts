import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

/**
 * Cabeçalhos de segurança do site. O `vite preview` (usado no teste ponta a ponta) já serve
 * com eles, para provar que o app funciona assim; a hospedagem deve repetir os mesmos
 * (docs/operacao/requisitos-de-hospedagem.md).
 */
export const SECURITY_HEADERS: Record<string, string> = {
  'Content-Security-Policy': [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self'",
    "img-src 'self' data:",
    "connect-src 'self'",
    "font-src 'self'",
    "worker-src 'self'",
    "manifest-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ].join('; '),
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'X-Frame-Options': 'DENY',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), payment=()',
};

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
  preview: { headers: SECURITY_HEADERS },
});
