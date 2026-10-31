import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, resolve } from 'node:path'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig, loadEnv, type Plugin } from 'vite'

// Marketing pages, as served paths. Each maps to <dir>/index.html and is listed in sitemap.xml.
const PAGES = ['/', '/pricing/', '/faq/', '/about/', '/contact/', '/privacy/', '/terms/']
const root = import.meta.dirname

/**
 * Replaces <!--partial:name--> with frontend/partials/name.html (recursively; read fresh, so dev edits apply on reload),
 * replaces %BASE% with the base path minus its trailing slash (links are written href="%BASE%/pricing/"),
 * marks links to the current page with aria-current="page", and emits sitemap.xml and robots.txt at build.
 * Runs before Vite's %VITE_*% env replacement, so partials can use env placeholders too.
 * Vite itself adds the base to script, stylesheet, image and icon URLs.
 */
function site(siteUrl: string, base: string): Plugin {
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
        return inject(html)
          .replaceAll('%BASE%', base.slice(0, -1))
          .replaceAll(`data-nav="${page}"`, `data-nav="${page}" aria-current="page"`)
      },
    },
    generateBundle() {
      // VITE_SITE_URL already includes any sub-path (https://abhimanyu.fyi/jivika), so the base is not added again.
      const site = siteUrl.replace(/\/$/, '')
      const urls = PAGES.map((p) => `  <url><loc>${site}${p}</loc></url>`).join('\n')
      this.emitFile({
        type: 'asset',
        fileName: 'sitemap.xml',
        source: `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`,
      })
      // Generated rather than kept in public/ so the sitemap URL follows VITE_SITE_URL.
      this.emitFile({ type: 'asset', fileName: 'robots.txt', source: `User-agent: *
Allow: /

Sitemap: ${site}/sitemap.xml
` })
    },
  }
}

/**
 * Self-hosts the Pyodide runtime (the coding playground's Python) at <base>assets/pyodide-<version>/, so no CDN is
 * needed. The worker passes that directory as indexURL. Served from node_modules in dev and emitted at build;
 * the version in the path keeps the immutable asset cache correct across upgrades.
 */
const PYODIDE_FILES = ['pyodide.asm.mjs', 'pyodide.asm.wasm', 'python_stdlib.zip', 'pyodide-lock.json']
const pyodideDir = dirname(createRequire(import.meta.url).resolve('pyodide/package.json'))
const PYODIDE_PATH = `assets/pyodide-${JSON.parse(readFileSync(resolve(pyodideDir, 'package.json'), 'utf8')).version}/`

function pyodide(base: string): Plugin {
  const types: Record<string, string> = { mjs: 'text/javascript', wasm: 'application/wasm', zip: 'application/zip', json: 'application/json' }
  return {
    name: 'jivika-pyodide',
    configureServer(server) {
      server.middlewares.use(`${base}${PYODIDE_PATH}`, (req, res, next) => {
        const file = (req.url ?? '').split('?')[0].replace(/^\//, '')
        if (!PYODIDE_FILES.includes(file)) return next()
        res.setHeader('Content-Type', types[file.split('.').pop()!])
        res.end(readFileSync(resolve(pyodideDir, file)))
      })
    },
    generateBundle() {
      for (const file of PYODIDE_FILES)
        this.emitFile({ type: 'asset', fileName: PYODIDE_PATH + file, source: readFileSync(resolve(pyodideDir, file)) })
    },
  }
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, root, 'VITE_')
  // Sub-path to serve from, e.g. /jivika/ (pair with JIVIKA_BASE_PATH=/jivika on the server). Normalised to '/x/' or '/'.
  const segment = (env.VITE_BASE_PATH || '').replace(/^\/+|\/+$/g, '')
  const base = segment ? `/${segment}/` : '/'
  const html = [...PAGES, '/app/'].map((p) => resolve(root, `.${p}index.html`))
  return {
    base,
    appType: 'mpa', // unknown dev routes 404 instead of falling back to the landing page
    plugins: [react(), tailwindcss(), site(env.VITE_SITE_URL || 'https://jivika.app', base), pyodide(base)],
    define: { __PYODIDE_PATH__: JSON.stringify(PYODIDE_PATH) },
    // Playground workers are ES modules named *.worker-<hash>.js; main.py gives only those files a CSP that allows eval.
    worker: { format: 'es' },
    build: { rollupOptions: { input: [...html, resolve(root, '404.html')] } },
    server: {
      port: 5173,
      // Strip the sub-path so a plain `npm run api` (served at root) answers; run the API without JIVIKA_BASE_PATH in dev.
      proxy: { [`${base}api`]: { target: 'http://127.0.0.1:8000', rewrite: (p) => p.slice(base.length - 1) } },
    },
  }
})
