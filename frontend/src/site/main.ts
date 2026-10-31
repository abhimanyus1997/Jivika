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
      const res = await fetch('/api/waitlist', {
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
