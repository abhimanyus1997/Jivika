/* In-page "Fill with Jivika" button. Registered only for sites you turned it on for in the popup; it fills only when pressed. */
(function () {
  if (window.top !== window || document.getElementById('jivika-fill-button')) return;
  var label = 'Fill with Jivika';
  var b = document.createElement('button');
  b.id = 'jivika-fill-button';
  b.type = 'button';
  b.textContent = label;
  b.style.cssText = 'position:fixed;right:16px;bottom:16px;z-index:2147483647;padding:8px 14px;border-radius:999px;border:0;background:#1f7a4d;color:#fff;font:600 13px/1.2 system-ui,sans-serif;box-shadow:0 2px 8px rgba(0,0,0,.25);cursor:pointer';
  b.addEventListener('click', function (e) {
    // Only a real press counts; the page's own scripts cannot trigger a fill with b.click().
    if (!e.isTrusted) return;
    e.preventDefault();
    e.stopPropagation();
    b.disabled = true;
    b.textContent = 'Filling...';
    chrome.runtime.sendMessage({ type: 'jivika.fillTab' }).then(function (r) {
      if (!r || !r.ok) b.textContent = (r && r.error) || 'This page could not be filled.';
      else b.textContent = 'Filled ' + r.summary.filled.length + (r.summary.needs_you.length ? ', ' + r.summary.needs_you.length + ' need you' : '');
    }, function () { b.textContent = 'This page could not be filled.'; }).finally(function () {
      b.disabled = false;
      setTimeout(function () { b.textContent = label; }, 8000);
    });
  });
  document.body.appendChild(b);
})();
