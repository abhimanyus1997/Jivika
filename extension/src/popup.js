/* global extract, clipUrl, CLIP_DEFAULT_APP */
var LABELS = { naukri: 'Naukri', linkedin: 'LinkedIn', indeed: 'Indeed', instahyre: 'Instahyre', wellfound: 'Wellfound', foundit: 'foundit', jsonld: 'Structured data', page: 'Page text' };
var preview = document.getElementById('preview');
var buttons = document.querySelectorAll('button[data-page]');
var job = null;

function show(lines, isError) {
  preview.className = 'card' + (isError ? ' error' : '');
  preview.replaceChildren.apply(preview, lines.map(function (l) {
    var d = document.createElement('div');
    d.className = l[0];
    d.textContent = l[1];
    return d;
  }));
}

document.getElementById('options').addEventListener('click', function (e) {
  e.preventDefault();
  chrome.runtime.openOptionsPage();
});

document.getElementById('open').addEventListener('click', async function (e) {
  e.preventDefault();
  var stored = await chrome.storage.sync.get({ appUrl: CLIP_DEFAULT_APP });
  await chrome.tabs.create({ url: stored.appUrl });
  window.close();
});

// First-run guide: shown until "Got it" is pressed.
var guide = document.getElementById('guide');
chrome.storage.local.get({ guideSeen: false }).then(function (s) { guide.hidden = s.guideSeen; });
document.getElementById('gotit').addEventListener('click', function () {
  guide.hidden = true;
  chrome.storage.local.set({ guideSeen: true });
});

(async function () {
  try {
    var tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    var res = await chrome.scripting.executeScript({ target: { tabId: tabs[0].id }, func: extract });
    job = res && res[0] && res[0].result;
  } catch (e) {
    show([['title', 'This page cannot be read'], ['meta', 'Browser pages and some protected sites do not allow extensions. Open a job posting and try again.']], true);
    return;
  }
  if (!job || (!job.title && !job.description)) {
    job = null;
    show([['title', 'No job found on this page'], ['meta', 'Open a single job posting, then click Jivika Clipper again.']], true);
    return;
  }
  var where = [job.company, job.location].filter(Boolean).join(' · ');
  show([['title', job.title || 'Untitled job'], ['meta', where || 'Company not detected'], ['badge', LABELS[job.source] || job.source]]);
  buttons.forEach(function (b) { b.disabled = false; });
})();

buttons.forEach(function (b) {
  b.addEventListener('click', async function () {
    if (!job) return;
    var stored = await chrome.storage.sync.get({ appUrl: CLIP_DEFAULT_APP });
    // ponytail: always opens a new tab; focusing an existing Jivika tab would need the "tabs" permission.
    await chrome.tabs.create({ url: await clipUrl(stored.appUrl, b.dataset.page, job) });
    window.close();
  });
});
