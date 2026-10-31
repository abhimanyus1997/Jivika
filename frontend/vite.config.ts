import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig, loadEnv, type Plugin } from 'vite'

// Marketing pages, as served paths. Each maps to <dir>/index.html and is listed in sitemap.xml.
const PAGES = ['/', '/pricing/', '/faq/', '/about/', '/contact/', '/privacy/', '/terms/']
const root = import.meta.dirname

/**
 * Replaces <!--partial:name--> with frontend/partials/name.html (recursively; read fresh, so dev edits apply on reload),
 * marks links to the current page with aria-current="page", and emits sitemap.xml and robots.txt at build.
 * Runs before Vite's %VITE_*% env replacement, so partials can use env placeholders too.
 */
function site(siteUrl: string): Plugin {
  return {
    name: 'jivika-site',
    transformIndexHtml: {
      order: 'pre',
      handler(html, ctx) {
        const page = ctx.path.replace(/index\.html$/, '')
        const inject = (src: string): string =>
          src.replace(/<!--partial:([\w-]+)-->/g, (_, name: string) =>
            inject(readFileSync(resolve(root, 'partials', `${name}.html`), 'utf8')),
          )
        return inject(html).replaceAll(`data-nav="${page}"`, `data-nav="${page}" aria-current="page"`)
      },
    },
    generateBundle() {
      const base = siteUrl.replace(/\/$/, '')
      const urls = PAGES.map((p) => `  <url><loc>${base}${p}</loc></url>`).join('\n')
      this.emitFile({
        type: 'asset',
        fileName: 'sitemap.xml',
        source: `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`,
      })
      // Generated rather than kept in public/ so the sitemap URL follows VITE_SITE_URL.
      this.emitFile({ type: 'asset', fileName: 'robots.txt', source: `User-agent: *
Allow: /

Sitemap: ${base}/sitemap.xml
` })
    },
  }
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, root, 'VITE_')
  const html = [...PAGES, '/app/'].map((p) => resolve(root, `.${p}index.html`))
  return {
    appType: 'mpa', // unknown dev routes 404 instead of falling back to the landing page
    plugins: [react(), tailwindcss(), site(env.VITE_SITE_URL || 'https://jivika.app')],
    build: { rollupOptions: { input: [...html, resolve(root, '404.html')] } },
    server: {
      port: 5173,
      proxy: { '/api': 'http://127.0.0.1:8000' },
    },
  }
})
