/*
 * Jivika Clipper service worker.
 * - Messages from the Jivika app (externally_connectable): ping, sync, disconnect, fetchClip. Origins are checked again here.
 * - Messages from the in-page "Fill with Jivika" button (button.js), on sites you turned it on for.
 * The profile and answers stay in chrome.storage.local in this browser; nothing is sent to a server.
 */
if (typeof importScripts === 'function' && typeof fillTab === 'undefined') importScripts('fill.js');

var MAX_MESSAGE = 200 * 1024;
var ANSWER_KEYS = ['notice_period', 'expected_salary', 'current_salary', 'work_authorization', 'sponsorship_needed', 'willing_to_relocate', 'earliest_start',
  'pronouns', 'gender', 'ethnicity', 'veteran', 'disability', 'linkedin', 'github', 'portfolio', 'how_heard'];

function allowedOrigin(o) { return o === 'https://jivika.abhimanyu.fyi' || /^http:\/\/(localhost|127\.0\.0\.1)(:\d{1,5})?$/.test(String(o)); }
function isObject(v) { return !!v && typeof v === 'object' && !Array.isArray(v); }
var PROD = 'https://jivika.abhimanyu.fyi';

// Only the fields Fill uses, only as strings (booleans for "current"), capped, so odd input never reaches a form.
function pick(src, keys, max) {
  var out = {};
  if (!isObject(src)) return out;
  keys.forEach(function (k) {
    var v = src[k];
    if (typeof v === 'string') out[k] = v.slice(0, (max && max[k]) || 500);
    else if (k === 'current' && typeof v === 'boolean') out[k] = v;
  });
  return out;
}
function cleanProfile(p) {
  var list = function (v, n, keys) { return (Array.isArray(v) ? v : []).filter(isObject).slice(0, n).map(function (e) { return pick(e, keys); }); };
  return {
    basics: pick(p.basics, ['name', 'headline', 'email', 'phone', 'location', 'linkedin', 'website', 'summary'], { summary: 5000 }),
    experience: list(p.experience, 50, ['company', 'title', 'location', 'start', 'end', 'current']),
    education: list(p.education, 20, ['institution', 'degree', 'field', 'start', 'end', 'grade']),
  };
}
// Local development origins may connect only when Options points at that same local app.
async function trustedOrigin(origin) {
  if (origin === PROD) return true;
  var opt = (await chrome.storage.sync.get({ appUrl: '' })).appUrl;
  try { return !!opt && new URL(opt).origin === origin; } catch (e) { return false; }
}

async function external(msg, sender) {
  var origin = sender.origin || '';
  if (!origin && sender.url) { try { origin = new URL(sender.url).origin; } catch (e) { /* no origin */ } }
  if (!allowedOrigin(origin)) return { ok: false, error: 'This site may not talk to Jivika Clipper.' };
  if (!isObject(msg) || typeof msg.type !== 'string') return { ok: false, error: 'Unknown message.' };
  var size = 0;
  try { size = new TextEncoder().encode(JSON.stringify(msg)).length; } catch (e) { return { ok: false, error: 'Unreadable message.' }; }
  if (size > MAX_MESSAGE) return { ok: false, error: 'This is too large for Jivika Clipper (over 200 KB).' };

  if (msg.type === 'jivika.ping') {
    var s = await chrome.storage.local.get({ profile: null, syncedAt: 0 });
    return { ok: true, version: chrome.runtime.getManifest().version, connected: !!s.profile, syncedAt: s.syncedAt || null };
  }
  if ((msg.type === 'jivika.sync' || msg.type === 'jivika.disconnect') && !(await trustedOrigin(origin))) {
    return { ok: false, error: 'To connect from a local copy of Jivika, save its address in Jivika Clipper options first.' };
  }
  if (msg.type === 'jivika.sync') {
    if (!isObject(msg.profile) || !isObject(msg.profile.basics)) return { ok: false, error: 'The profile is missing.' };
    if (msg.answers != null && !isObject(msg.answers)) return { ok: false, error: 'The answers are not readable.' };
    var answers = {};
    ANSWER_KEYS.forEach(function (k) {
      var v = msg.answers && msg.answers[k];
      if (typeof v === 'string' && v.trim()) answers[k] = v.trim().slice(0, 500);
    });
    var save = { profile: cleanProfile(msg.profile), answers: answers, syncedAt: Date.now() };
    // Hand-offs open the app the user connected from; only an address on the sender's own (trusted) origin is accepted.
    try { var u = new URL(msg.appUrl); if (u.origin === origin) save.appUrl = u.origin + u.pathname; } catch (e) { /* keep the previous app URL */ }
    await chrome.storage.local.set(save);
    return { ok: true, syncedAt: save.syncedAt };
  }
  if (msg.type === 'jivika.disconnect') {
    await chrome.storage.local.remove(['profile', 'answers', 'syncedAt']);
    return { ok: true };
  }
  if (msg.type === 'jivika.fetchClip') {
    if (typeof msg.id !== 'string' || !/^[\w-]{1,64}$/.test(msg.id)) return { ok: false, error: 'Unknown clip.' };
    var key = 'clip:' + msg.id;
    var got = await chrome.storage.session.get(key);
    await chrome.storage.session.remove(key);
    return got[key] ? { ok: true, payload: got[key] } : { ok: false, error: 'This clip is no longer available. Clip the page again.' };
  }
  return { ok: false, error: 'Unknown message.' };
}

chrome.runtime.onMessageExternal.addListener(function (msg, sender, respond) {
  external(msg, sender).then(respond, function () { respond({ ok: false, error: 'Jivika Clipper could not handle this request.' }); });
  return true;
});

// The in-page button: only from the top frame of a site the user turned the button on for.
async function buttonFill(sender) {
  var origin = sender.origin || '';
  if (!origin && sender.url) { try { origin = new URL(sender.url).origin; } catch (e) { /* no origin */ } }
  if (sender.frameId !== 0 || !origin) return { ok: false, error: 'This page could not be filled.' };
  var on = await chrome.scripting.getRegisteredContentScripts({ ids: [buttonScriptId(origin)] });
  if (!on.length) return { ok: false, error: 'The Fill with Jivika button is not on for this site.' };
  return fillTab(sender.tab.id);
}

chrome.runtime.onMessage.addListener(function (msg, sender, respond) {
  if (sender.id !== chrome.runtime.id || !sender.tab || !isObject(msg) || msg.type !== 'jivika.fillTab') return false;
  buttonFill(sender).then(respond, function () { respond({ ok: false, error: 'This page could not be filled.' }); });
  return true;
});

// Finishes turning the button on when the popup closed while the permission prompt was open.
chrome.permissions.onAdded.addListener(async function (p) {
  var pending = (await chrome.storage.session.get('pendingButton')).pendingButton;
  if (!pending || (p.origins || []).indexOf(pending + '/*') < 0) return;
  await registerButton(pending);
  await chrome.storage.session.remove('pendingButton');
});
