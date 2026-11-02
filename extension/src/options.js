/* global CLIP_DEFAULT_APP, CLIPPER_VERSION */
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

document.getElementById('version').textContent = CLIPPER_VERSION;

// Sites with the in-page button (registered from the popup, one content script per origin).
var sites = document.getElementById('sites');
async function listSites() {
  var scripts = (await chrome.scripting.getRegisteredContentScripts()).filter(function (s) { return /^site-/.test(s.id); });
  // Site access granted without a registered button (the popup closed during the prompt) is listed too, so it can be removed.
  var listed = scripts.map(function (s) { return s.matches[0]; });
  ((await chrome.permissions.getAll()).origins || []).forEach(function (o) {
    if (listed.indexOf(o) < 0) scripts.push({ id: '', matches: [o] });
  });
  if (!scripts.length) {
    var none = document.createElement('li');
    none.className = 'hint';
    none.textContent = 'None yet. Turn it on from the popup on an application page.';
    return sites.replaceChildren(none);
  }
  sites.replaceChildren.apply(sites, scripts.map(function (s) {
    var li = document.createElement('li');
    var name = document.createElement('span');
    name.textContent = s.matches[0].replace(/^https:\/\//, '').replace(/\/\*$/, '');
    var remove = document.createElement('button');
    remove.type = 'button';
    remove.textContent = 'Remove';
    remove.setAttribute('aria-label', 'Remove ' + name.textContent);
    remove.addEventListener('click', async function () {
      if (s.id) await chrome.scripting.unregisterContentScripts({ ids: [s.id] });
      await chrome.permissions.remove({ origins: s.matches });
      listSites();
    });
    li.append(name, remove);
    return li;
  }));
}
listSites();

// Connection with the Jivika app (Settings > Jivika Clipper > Connect).
var conn = document.getElementById('conn');
var forget = document.getElementById('forget');
async function showConnection() {
  var s = await chrome.storage.local.get({ profile: null, syncedAt: 0 });
  conn.textContent = s.profile
    ? 'Your profile and application answers are saved in this browser for Fill this application. Last synced ' + new Date(s.syncedAt).toLocaleString() + '.'
    : 'Not connected. In Jivika, open Settings, Jivika Clipper, and press Connect to use Fill this application.';
  forget.hidden = !s.profile;
}
forget.addEventListener('click', async function () {
  await chrome.storage.local.remove(['profile', 'answers', 'syncedAt']);
  showConnection();
});
showConnection();
