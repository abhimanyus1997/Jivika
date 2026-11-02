/* global extract, extractProfile, fillTab, clipUrl, clipBase, clipTooBig, isLinkedInProfile, CLIP_DEFAULT_APP, CLIPPER_VERSION */
var LABELS = { naukri: 'Naukri', linkedin: 'LinkedIn', indeed: 'Indeed', instahyre: 'Instahyre', wellfound: 'Wellfound', foundit: 'foundit', jsonld: 'Structured data', page: 'Page text' };
var SECTION_LABELS = { summary: 'About', experience: 'Experience', education: 'Education', skills: 'Skills', certifications: 'Licenses and certifications', projects: 'Projects', languages: 'Languages', honors: 'Honors and awards', volunteering: 'Volunteering', publications: 'Publications', courses: 'Courses' };
var SHORT_DESCRIPTION = 300;
var preview = document.getElementById('preview');
var checklist = document.getElementById('checklist');
var warning = document.getElementById('warning');
var fillBox = document.getElementById('fill');
var fillStatus = document.getElementById('fill-status');
var tab = null, job = null, profile = null;

document.getElementById('version').textContent = CLIPPER_VERSION;

function show(lines, isError) {
  preview.className = 'card' + (isError ? ' error' : '');
  preview.replaceChildren.apply(preview, lines.map(function (l) {
    var d = document.createElement('div');
    d.className = l[0];
    d.textContent = l[1];
    return d;
  }));
}

// rows: [label, found]. Check and dash marks are decorative; each row also says found / not found.
function showChecklist(rows) {
  checklist.replaceChildren.apply(checklist, rows.map(function (r) {
    var li = document.createElement('li');
    li.className = r[1] ? 'ok' : 'missing';
    li.setAttribute('aria-label', r[0] + (r[1] ? ': found' : ': not found'));
    var mark = document.createElement('span');
    mark.className = 'mark';
    mark.setAttribute('aria-hidden', 'true');
    mark.textContent = r[1] ? '✓' : '–';
    li.append(mark, r[0]);
    return li;
  }));
  checklist.hidden = !rows.length;
}

function warn(text) { warning.textContent = text || ''; warning.hidden = !text; }

async function appUrl() {
  var s = await chrome.storage.sync.get({ appUrl: '' });
  var l = await chrome.storage.local.get({ appUrl: '' });
  // The address saved by Connect counts only for the production app; a local app must be saved in Options.
  var connected = l.appUrl && l.appUrl.indexOf('https://jivika.abhimanyu.fyi/') === 0 ? l.appUrl : '';
  return s.appUrl || connected || CLIP_DEFAULT_APP;
}

// Same as the bookmarklet: run in the page's own world, falling back to the isolated world where MAIN is refused.
async function run(func) {
  var target = { tabId: tab.id };
  try {
    var r = await chrome.scripting.executeScript({ target: target, world: 'MAIN', func: func });
    if (r && r[0] && r[0].result != null) return r[0].result;
  } catch (e) { /* fall back below */ }
  var d = await chrome.scripting.executeScript({ target: target, func: func });
  return d && d[0] && d[0].result;
}

async function open(url) {
  await chrome.tabs.create({ url: url });
  window.close();
}

document.getElementById('options').addEventListener('click', function (e) {
  e.preventDefault();
  chrome.runtime.openOptionsPage();
});

document.getElementById('open').addEventListener('click', async function (e) {
  e.preventDefault();
  await open(await appUrl());
});

// First-run guide: shown until "Got it" is pressed.
var guide = document.getElementById('guide');
chrome.storage.local.get({ guideSeen: false }).then(function (s) { guide.hidden = s.guideSeen; });
document.getElementById('gotit').addEventListener('click', function () {
  guide.hidden = true;
  chrome.storage.local.set({ guideSeen: true });
});

async function readProfile() {
  document.getElementById('job-actions').hidden = true;
  document.getElementById('profile-actions').hidden = false;
  show([['title', 'Loading profile sections…'], ['meta', 'Scrolling through the profile so every section loads. This takes a few seconds.']]);
  var why = 'Reload the profile page and try again.';
  try {
    // If the page navigates while loading, the injected script never answers; give up after 25 s instead of spinning.
    profile = await Promise.race([
      run(extractProfile),
      new Promise(function (_, fail) { setTimeout(function () { fail(new Error('Loading took too long. Reload the profile page and try again.')); }, 25000); })
    ]);
  } catch (e) {
    profile = null;
    if (e && /page changed|took too long/i.test(e.message)) why = e.message.replace(/^.*?(The page changed|Loading took)/, '$1');
  }
  if (!profile || (!profile.basics.name && !profile.sections_found.length && !profile.raw_text)) {
    profile = null;
    show([['title', 'This profile could not be read'], ['meta', why]], true);
    return;
  }
  show([['title', profile.basics.name || 'LinkedIn profile'], ['meta', profile.basics.headline || 'Headline not detected'], ['badge', 'LinkedIn profile']]);
  var rows = [['Name', profile.basics.name], ['Headline', profile.basics.headline], ['Location', profile.basics.location]];
  Object.keys(SECTION_LABELS).forEach(function (k) {
    var n = k === 'summary' ? (profile.basics.summary ? 1 : 0) : k === 'skills' ? (profile.skills[0] ? profile.skills[0].items.length : 0) : profile[k].length;
    if (n || /^(summary|experience|education|skills)$/.test(k)) rows.push([SECTION_LABELS[k] + (n && k !== 'summary' ? ' (' + n + ')' : ''), n]);
  });
  showChecklist(rows);
  warn(profile.sections_found.length < 2 ? 'Only part of this profile could be read. Jivika will structure the page text for you; check the result before saving.' : '');
  document.querySelectorAll('#profile-actions button').forEach(function (b) { b.disabled = false; });
}

async function readJob() {
  try {
    job = await run(extract);
  } catch (e) {
    show([['title', 'This page cannot be read'], ['meta', 'Browser pages and some protected sites do not allow extensions. Open a job posting and try again.']], true);
    return false;
  }
  if (!job || (!job.title && !job.description)) {
    job = null;
    show([['title', 'No job found on this page'], ['meta', 'Open a single job posting, then click Jivika Clipper again. On an application form, use Fill this application below.']], true);
    return true;
  }
  var where = [job.company, job.location].filter(Boolean).join(' · ');
  show([['title', job.title || 'Untitled job'], ['meta', where || 'Company not detected'], ['badge', LABELS[job.source] || job.source]]);
  var n = (job.description || '').length;
  var rows = [['Title', job.title], ['Company', job.company], ['Location', job.location], ['Experience', job.experience_required], ['Salary', job.salary],
    ['Employment type', job.employment_type], ['Description (' + n.toLocaleString('en') + ' characters)', n]];
  if (/(^|\n)(key skills|must have skills|skills)\s*:/i.test(job.description || '')) rows.push(['Key skills', true]);
  showChecklist(rows);
  warn(n < SHORT_DESCRIPTION ? 'The description looks short. Scroll the job details into view or expand them, then clip again.' : '');
  document.querySelectorAll('#job-actions button').forEach(function (b) { b.disabled = false; });
  return true;
}

(async function () {
  tab = (await chrome.tabs.query({ active: true, currentWindow: true }))[0];
  var url = (tab && tab.url) || '';
  if (isLinkedInProfile(url)) return readProfile();
  if (await readJob() && /^https?:/.test(url)) {
    fillBox.hidden = false;
    // Optional host permissions cover https only.
    document.getElementById('fill-site').hidden = !/^https:/.test(url);
  }
})();

// Job and profile hand-offs. Profile clips too large for the URL go through the app bridge when connected.
document.querySelectorAll('button[data-page]').forEach(function (b) {
  b.addEventListener('click', async function () {
    var page = b.dataset.page;
    var data = page === 'profile' || page === 'linkedin' ? profile : page === 'track' ? job && Object.assign({}, job, { status: 'Applied' }) : job;
    if (!data) return;
    var app = await appUrl();
    var url = await clipUrl(app, page, data, true);
    if (clipTooBig(url)) {
      var s = await chrome.storage.local.get({ profile: null });
      if (s.profile && data === profile) {
        var id = crypto.randomUUID();
        var stash = {};
        stash['clip:' + id] = Object.assign({}, data, { clipper_version: CLIPPER_VERSION });
        await chrome.storage.session.set(stash);
        url = clipBase(app, page) + '?clipRef=' + id;
      } else url = await clipUrl(app, page, data);
    }
    // ponytail: always opens a new tab; focusing an existing Jivika tab would need the "tabs" permission.
    await open(url);
  });
});

function fillMessage(text, linkText, linkUrl) {
  fillStatus.replaceChildren(text);
  if (linkText) {
    var a = document.createElement('a');
    a.href = '#';
    a.textContent = linkText;
    a.addEventListener('click', function (e) { e.preventDefault(); linkUrl().then(open); });
    fillStatus.append(' ', a);
  }
}

document.getElementById('fill-run').addEventListener('click', async function () {
  var btn = this;
  btn.disabled = true;
  fillMessage('Filling...');
  var r;
  try {
    r = await fillTab(tab.id);
  } catch (e) {
    r = { ok: false, error: 'This page cannot be filled. Browser pages and some protected sites do not allow extensions.' };
  }
  btn.disabled = false;
  if (!r.ok) {
    if (/Connect/.test(r.error)) return fillMessage(r.error, 'Open Jivika settings', async function () { return (await appUrl()) + '#settings'; });
    return fillMessage(r.error);
  }
  var s = r.summary;
  var parts = ['Filled ' + s.filled.length + (s.filled.length === 1 ? ' field.' : ' fields.')];
  if (s.needs_you.length) parts.push(s.needs_you.length + ' need you: ' + s.needs_you.slice(0, 6).join(', ') + (s.needs_you.length > 6 ? ', ...' : '') + '.');
  if (s.skipped.length) parts.push(s.skipped.length + ' left as they were.');
  if (s.note) parts.push(s.note);
  if (s.frames.length) parts.push('Part of this form is inside a frame from ' + s.frames.map(function (o) { return o.replace(/^https?:\/\//, ''); }).join(', ') + ', which Jivika Clipper cannot reach. Open the form on its own page to fill it.');
  parts.push('Nothing was submitted; review the form before you send it.');
  fillMessage(parts.join(' '));
});

// In-page button: asks for access to this site only, then registers button.js for it.
document.getElementById('fill-site').addEventListener('click', async function () {
  var origin = new URL(tab.url).origin;
  // If the popup closes while the prompt is open, the service worker finishes this (permissions.onAdded).
  // Not awaited: permissions.request must run in the click's user gesture.
  chrome.storage.session.set({ pendingButton: origin });
  var granted = await chrome.permissions.request({ origins: [origin + '/*'] });
  if (!granted) return fillMessage('The button needs access to this site. Nothing was changed.');
  await registerButton(origin);
  chrome.storage.session.remove('pendingButton');
  await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['button.js'] });
  fillMessage('The Fill with Jivika button is on for ' + origin.replace(/^https:\/\//, '') + '. Remove it any time in Options.');
});
