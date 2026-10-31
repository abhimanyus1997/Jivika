// Marketing site behaviour. Loaded as an external module so it works under CSP script-src 'self'.
import '@fontsource-variable/geist'
import './site.css'

// Mobile navigation
const toggle = document.querySelector<HTMLButtonElement>('[data-nav-toggle]')
const panel = document.getElementById('mobile-nav')
if (toggle && panel) {
  const set = (open: boolean) => {
    toggle.setAttribute('aria-expanded', String(open))
    toggle.setAttribute('aria-label', open ? 'Close menu' : 'Open menu')
    panel.hidden = !open
  }
  toggle.addEventListener('click', () => set(toggle.getAttribute('aria-expanded') !== 'true'))
  panel.addEventListener('click', (e) => (e.target as Element).closest('a') && set(false))
  document.addEventListener('keydown', (e) => e.key === 'Escape' && !panel.hidden && (set(false), toggle.focus()))
}

// Theme toggle: cycles light -> dark -> system. State lives in public/theme.js (shared with the app and other tabs).
const themeButton = document.querySelector<HTMLButtonElement>('[data-theme-toggle]')
const themeApi = window.jivikaTheme
if (themeButton && themeApi) {
  const order = ['light', 'dark', 'system'] as const
  const names = { light: 'Light', dark: 'Dark', system: 'System' }
  const sync = () => {
    const mode = themeApi.get()
    const next = order[(order.indexOf(mode) + 1) % order.length]
    themeButton.dataset.mode = mode
    themeButton.setAttribute('aria-label', `Theme: ${names[mode]}. Switch to ${names[next].toLowerCase()}`)
    themeButton.title = `Theme: ${names[mode]}`
  }
  themeButton.addEventListener('click', () => themeApi.set(order[(order.indexOf(themeApi.get()) + 1) % order.length]))
  window.addEventListener('jivika-theme', sync)
  sync()
  themeButton.hidden = false
}

// Footer year
for (const el of document.querySelectorAll('[data-year]')) el.textContent = String(new Date().getFullYear())

// Waitlist forms
for (const form of document.querySelectorAll<HTMLFormElement>('form[data-waitlist]')) {
  const status = form.querySelector<HTMLElement>('[data-status]')!
  const button = form.querySelector<HTMLButtonElement>('button[type="submit"]')!
  const label = button.textContent

  const show = (text: string, ok: boolean) => {
    status.textContent = text
    status.className = `mt-3 text-[13px] empty:hidden ${ok ? 'text-brand-600' : 'text-danger'}`
  }
  const input = form.querySelector<HTMLInputElement>('input[name="email"]')!
  input.addEventListener('input', () => input.removeAttribute('aria-invalid'))

  form.addEventListener('submit', async (e) => {
    e.preventDefault()
    status.textContent = ''
    const data = new FormData(form)
    const email = String(data.get('email') ?? '').trim()
    if (!form.reportValidity() || !email) {
      input.setAttribute('aria-invalid', 'true')
      return
    }
    button.disabled = true
    button.textContent = 'Joining...'
    try {
      const res = await fetch(`${import.meta.env.BASE_URL}api/waitlist`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email,
          plan: data.get('plan') || 'pro',
          source: location.pathname.slice(0, 64),
          website: data.get('website') || '',
        }),
      })
      const body = await res.json().catch(() => ({}))
      if (res.ok && body.ok) {
        form.reset()
        show(body.already ? 'You are already on the list. We will be in touch.' : 'Thanks, you are on the list. We will email you when Pro launches.', true)
      } else if (res.status === 429) {
        show('Too many attempts. Please try again in a few minutes.', false)
      } else if (res.status === 422 || res.status === 400) {
        input.setAttribute('aria-invalid', 'true')
        show('Please enter a valid email address.', false)
      } else if (res.status === 503 && typeof body.detail === 'string') {
        show(body.detail, false)
      } else {
        show('Something went wrong. Please try again later.', false)
      }
    } catch {
      show('Could not reach the server. Check your connection and try again.', false)
    } finally {
      button.disabled = false
      button.textContent = label
    }
  })
}

// Scroll reveal. Content stays visible unless motion is allowed and IntersectionObserver exists (see site.css).
const motion = window.matchMedia('(prefers-reduced-motion: no-preference)')
if (motion.matches && 'IntersectionObserver' in window) {
  for (const group of document.querySelectorAll<HTMLElement>('[data-stagger]')) {
    ;[...group.children].forEach((el, i) => {
      const child = el as HTMLElement
      child.dataset.reveal = ''
      child.style.setProperty('--reveal-i', String(Math.min(i, 8)))
    })
  }
  // Section titles get their own tracking reveal (site.css), on top of any parent [data-reveal] fade.
  for (const h of document.querySelectorAll<HTMLElement>('main h2:not(.sr-only)')) h.dataset.titleReveal = ''
  const observer = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue
        const el = entry.target as HTMLElement
        observer.unobserve(el)
        el.classList.add('is-visible')
        // Hand the element back to its own styles (e.g. card hover transitions) once the reveal has finished.
        setTimeout(() => el.removeAttribute('data-reveal'), 1200)
      }
    },
    { rootMargin: '0px 0px -8% 0px' },
  )
  document.querySelectorAll('[data-reveal], [data-title-reveal]').forEach((el) => observer.observe(el))
  document.documentElement.classList.add('motion-ok')
}

// "Works with" marquee: duplicate the provider list (the copy is hidden from assistive tech) so the CSS loop is seamless.
// Without JS or with reduced motion the original wrapped list stays. Hover or keyboard focus pauses it (site.css).
const marquee = document.querySelector<HTMLElement>('[data-marquee]')
const marqueeList = marquee?.querySelector('ul')
if (marquee && marqueeList && motion.matches) {
  const copy = marqueeList.cloneNode(true) as HTMLElement
  copy.setAttribute('aria-hidden', 'true')
  const track = document.createElement('div')
  track.className = 'marquee-track'
  track.append(marqueeList, copy)
  marquee.append(track)
  marquee.tabIndex = 0
  marquee.classList.add('is-running')
}

// Hero clip: one <video> per theme (index.html), shown by the .theme-*-only CSS. Only the visible one plays,
// and only when motion is allowed; without JS, or with reduced motion, its poster shows instead. No source
// swapping or load() calls, so a theme change cannot race a pending play().
const heroVideos = [...document.querySelectorAll<HTMLVideoElement>('[data-hero-video]')]
if (heroVideos.length) {
  const update = () => {
    const dark = document.documentElement.dataset.theme === 'dark'
    for (const video of heroVideos) {
      const visible = video.classList.contains(dark ? 'theme-dark-only' : 'theme-light-only') || heroVideos.length === 1
      if (visible && motion.matches) video.play().catch(() => undefined)
      else video.pause()
    }
  }
  window.addEventListener('jivika-theme', update)
  motion.addEventListener('change', update)
  update()
}
