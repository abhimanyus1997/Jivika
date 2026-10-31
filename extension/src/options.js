/* global CLIP_DEFAULT_APP */
var input = document.getElementById('appUrl');
var statusEl = document.getElementById('status');

// Only https, or plain http on this machine (localhost / 127.0.0.1) for local development.
function normalise(v) {
  var u = new URL(v.trim());
  var local = u.hostname === 'localhost' || u.hostname === '127.0.0.1' || u.hostname === '[::1]';
  if (!(u.protocol === 'https:' || (u.protocol === 'http:' && local))) throw new Error('scheme');
  u.hash = '';
  u.search = '';
  if (!u.pathname.endsWith('/')) u.pathname += '/';
  return u.toString();
}

chrome.storage.sync.get({ appUrl: CLIP_DEFAULT_APP }).then(function (s) { input.value = s.appUrl; });

document.getElementById('form').addEventListener('submit', async function (e) {
  e.preventDefault();
  try {
    input.value = normalise(input.value);
  } catch (err) {
    statusEl.textContent = 'Enter an https:// address, or http://localhost for local development.';
    return;
  }
  await chrome.storage.sync.set({ appUrl: input.value });
  statusEl.textContent = 'Saved.';
});

document.getElementById('reset').addEventListener('click', async function () {
  input.value = CLIP_DEFAULT_APP;
  await chrome.storage.sync.set({ appUrl: CLIP_DEFAULT_APP });
  statusEl.textContent = 'Reset to the default.';
});
