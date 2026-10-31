// Theme bootstrap. Loaded synchronously in <head> (external file, so CSP script-src 'self' allows it) to set
// html[data-theme] before first paint. Preference: 'system' | 'light' | 'dark' in localStorage 'jivika.theme'.
// Exposes window.jivikaTheme { get, set } and fires a 'jivika-theme' event on window whenever the theme changes
// (own tab, other tabs via the storage event, or the OS setting while on 'system').
;(function () {
  var KEY = 'jivika.theme'
  var COLORS = { light: '#F7F7F5', dark: '#121211' }
  var media = window.matchMedia('(prefers-color-scheme: dark)')
  var memo = 'system' // used only when storage is blocked

  function get() {
    try {
      var v = localStorage.getItem(KEY)
      return v === 'light' || v === 'dark' ? v : 'system'
    } catch (e) {
      return memo
    }
  }

  function apply() {
    var pref = get()
    var theme = pref === 'system' ? (media.matches ? 'dark' : 'light') : pref
    var root = document.documentElement
    root.setAttribute('data-theme', theme)
    root.style.colorScheme = theme
    var metas = document.querySelectorAll('meta[name="theme-color"]')
    for (var i = 0; i < metas.length; i++) metas[i].setAttribute('content', COLORS[theme])
    window.dispatchEvent(new CustomEvent('jivika-theme', { detail: { preference: pref, theme: theme } }))
  }

  function set(pref) {
    memo = pref === 'light' || pref === 'dark' ? pref : 'system'
    try {
      if (pref === 'light' || pref === 'dark') localStorage.setItem(KEY, pref)
      else localStorage.removeItem(KEY)
    } catch (e) {
      /* storage blocked: memo keeps the choice for this page */
    }
    apply()
  }

  window.jivikaTheme = { get: get, set: set }
  media.addEventListener('change', function () {
    if (get() === 'system') apply()
  })
  window.addEventListener('storage', function (e) {
    if (e.key === KEY || e.key === null) apply()
  })
  apply()
  // The theme-color meta tags may come after this script in <head>; update them once parsed.
  document.addEventListener('DOMContentLoaded', apply)
})()
