/*
 * Jivika Clipper form filler. Runs only when you press "Fill this application" (or the in-page button you turned on).
 * Self-contained: passed to chrome.scripting.executeScript({ allFrames: true, func: fill, args: [profile, answers] }).
 * Fills empty, visible fields of the current page or step only. Never submits, never presses Next, never touches
 * file inputs (it highlights them instead). Returns { filled, needs_you, skipped, ats, note, frames, origin }.
 */
function fill(profile, answers) {
  profile = profile || {};
  answers = answers || {};
  var GREEN = '#1f7a4d', AMBER = '#b54708';
  var LIST_MAX = 50;
  var DECLINE = /decline|prefer not|not (wish|want) to|don.?t (wish|want) to|rather not|choose not to|not to (say|answer|disclose)|not specified/i;

  // Label text -> field key. Order matters: the first match wins, so specific phrases come before generic ones.
  var DICT = [
    ['phone_country', /country code|dial(l?ing)? code|phone (country|code)|calling code/],
    ['first_name', /\b(first|given|fore) ?name\b|^first$|\bfname\b/],
    ['last_name', /\b(last|family|sur) ?name\b|^last$|\blname\b|^surname$/],
    ['email', /e-?mail/],
    ['phone', /phone|mobile|\bcell\b|telephone|contact number|whats ?app/],
    ['linkedin', /linked ?in/],
    ['github', /git ?hub/],
    ['portfolio', /portfolio|website|personal (site|page)|home ?page|\bblog\b|^url$|other (link|url|website)/],
    ['sponsorship', /sponsor/],
    ['work_authorization', /authori[sz](ed|ation)|right to work|eligible to work|legally (able|allowed|permitted)|work permit|visa status/],
    ['relocation', /relocat/],
    ['notice_period', /notice period|\bnotice\b/],
    ['expected_salary', /expected (salary|ctc|pay|compensation)|salary expectation|desired (salary|pay|compensation)|compensation expectation|expected annual/],
    ['current_salary', /current (salary|ctc|pay|compensation)|present (salary|ctc)/],
    ['start_date', /start date|earliest start|available to start|when can you (start|join)|joining date|date available/],
    ['how_heard', /how did you (hear|find|learn)|where did you (hear|find|learn)|referral source|^source$/],
    ['pronouns', /pronoun/],
    ['gender', /gender|^sex$/],
    ['ethnicity', /\brace\b|ethnic/],
    ['veteran', /veteran/],
    ['disability', /disabilit/],
    ['years_experience', /years? of (relevant |total |professional |work )?experience|total experience|experience \(?in years\)?/],
    ['current_company', /current (company|employer|organi[sz]ation)|most recent (company|employer)|^(company|employer|organi[sz]ation)( name)?$/],
    ['current_title', /current (job )?(title|role|position|designation)|most recent (job )?(title|role)|^(job )?title$|^headline$|^designation$/],
    ['school', /school|university|college|institution/],
    ['degree', /degree|qualification/],
    ['field', /field of study|\bmajor\b|discipline|speciali[sz]ation/],
    ['grad_year', /graduat(ion|ed)|year of (passing|completion)|passing year/],
    ['country', /^country( of residence)?$|country of residence|^country ?\/ ?region$/],
    ['city', /\bcity\b|\btown\b/],
    ['location', /location|where are you (based|located)|current address|^address$|based in/],
    ['full_name', /^(full |legal |your |complete )?name$|full (legal )?name/]
  ];
  var CHOICE = { sponsorship: 1, work_authorization: 1, relocation: 1, gender: 1, ethnicity: 1, veteran: 1, disability: 1, pronouns: 1, how_heard: 1 };
  var AUTOCOMPLETE = {
    'given-name': 'first_name', 'family-name': 'last_name', name: 'full_name', email: 'email', tel: 'phone', 'tel-national': 'phone',
    'tel-country-code': 'phone_country', 'address-level2': 'city', country: 'country', 'country-name': 'country',
    organization: 'current_company', 'organization-title': 'current_title', url: 'portfolio'
  };
  // ATS adapters: their stable field ids, names and data attributes.
  var ADAPTERS = {
    greenhouse: { first_name: 'first_name', last_name: 'last_name', email: 'email', phone: 'phone', 'job_application[location]': 'location', 'candidate-location': 'location' },
    lever: { name: 'full_name', email: 'email', phone: 'phone', org: 'current_company', location: 'location', 'urls[LinkedIn]': 'linkedin', 'urls[GitHub]': 'github', 'urls[Portfolio]': 'portfolio', 'urls[Other]': 'portfolio', 'eeo[gender]': 'gender', 'eeo[race]': 'ethnicity', 'eeo[veteran]': 'veteran', 'eeo[disability]': 'disability' },
    ashby: { _systemfield_name: 'full_name', _systemfield_email: 'email', _systemfield_phone: 'phone', _systemfield_location: 'location' },
    workday: {
      legalNameSection_firstName: 'first_name', legalNameSection_lastName: 'last_name', 'legalName--firstName': 'first_name', 'legalName--lastName': 'last_name',
      email: 'email', 'phone-number': 'phone', 'phoneNumber--phoneNumber': 'phone', addressSection_city: 'city', 'address--city': 'city',
      'countryPhoneCode': 'phone_country', 'phoneNumber--countryPhoneCode': 'phone_country'
    },
    smartrecruiters: { 'first-name-input': 'first_name', 'last-name-input': 'last_name', 'email-input': 'email', 'confirm-email-input': 'email', 'linkedin-input': 'linkedin', 'phone-number-input': 'phone', 'city-input': 'city', 'location-input': 'location' },
    workable: { firstname: 'first_name', lastname: 'last_name', email: 'email', phone: 'phone', address: 'location', headline: 'current_title' }
  };

  var host = location.hostname;
  var ats = /(^|\.)greenhouse\.io$/.test(host) || document.querySelector('#application_form, form#application-form[action*="greenhouse"], #grnhse_app') ? 'greenhouse'
    : /(^|\.)lever\.co$/.test(host) ? 'lever'
    : /(^|\.)ashbyhq\.com$/.test(host) ? 'ashby'
    : /(^|\.)(myworkdayjobs|workday)\.com$/.test(host) || document.querySelector('[data-automation-id="applyFlowPage"]') ? 'workday'
    : /(^|\.)smartrecruiters\.com$/.test(host) ? 'smartrecruiters'
    : /(^|\.)workable\.com$/.test(host) ? 'workable' : '';
  var adapter = ADAPTERS[ats] || {};

  // ---- values from the connected profile and answers ----
  function clean(s) { return String(s == null ? '' : s).replace(/\s+/g, ' ').trim(); }
  var b = profile.basics || {};
  var exp = Array.isArray(profile.experience) ? profile.experience : [];
  var cur = exp.filter(function (e) { return e && e.current; })[0] || exp[0] || {};
  var edu = (Array.isArray(profile.education) ? profile.education : [])[0] || {};
  var name = clean(b.name);
  var phone = clean(b.phone);
  var cc = (phone.match(/^\+(\d{1,3})/) || [])[1] || '';
  var loc = clean(b.location);
  var locParts = loc.split(',').map(clean).filter(Boolean);
  var site = clean(b.website);
  // ponytail: years from the earliest start year to today; overlapping or gap years are not subtracted.
  var startYears = exp.map(function (e) { var m = String((e && e.start) || '').match(/\b(19|20)\d{2}\b/); return m ? +m[0] : 0; }).filter(Boolean);
  var V = {
    first_name: name.split(' ')[0] || '', last_name: name.split(' ').slice(1).join(' '), full_name: name,
    email: clean(b.email), phone: phone, phone_country: cc,
    location: loc, city: locParts[0] || '', country: locParts.length > 1 ? locParts[locParts.length - 1] : '',
    linkedin: clean(answers.linkedin || b.linkedin), github: clean(answers.github || (/github\.com/i.test(site) ? site : '')),
    portfolio: clean(answers.portfolio || (/github\.com/i.test(site) ? '' : site)),
    current_company: clean(cur.company), current_title: clean(cur.title),
    years_experience: startYears.length ? String(Math.max(0, new Date().getFullYear() - Math.min.apply(null, startYears))) : '',
    school: clean(edu.institution), degree: clean(edu.degree), field: clean(edu.field), grad_year: (String(edu.end || '').match(/\b(19|20)\d{2}\b/) || [''])[0],
    notice_period: clean(answers.notice_period), expected_salary: clean(answers.expected_salary), current_salary: clean(answers.current_salary),
    work_authorization: clean(answers.work_authorization), sponsorship: clean(answers.sponsorship_needed), relocation: clean(answers.willing_to_relocate),
    start_date: clean(answers.earliest_start), how_heard: clean(answers.how_heard), pronouns: clean(answers.pronouns),
    gender: clean(answers.gender) || 'Prefer not to say', ethnicity: clean(answers.ethnicity) || 'Decline to answer',
    veteran: clean(answers.veteran) || 'Decline to answer', disability: clean(answers.disability) || 'Decline to answer'
  };

  // ---- reading fields ----
  function norm(s) { return clean(String(s || '').toLowerCase().replace(/\((required|optional)\)/g, ' ').replace(/[*:?]/g, ' ')); }
  function tokens(s) { return norm(String(s || '').replace(/([a-z])([A-Z])/g, '$1 $2').replace(/[_\-[\].]+/g, ' ')); }
  function lookup(text, long) {
    var t = norm(text);
    if (!t) return '';
    for (var i = 0; i < DICT.length; i++) {
      if (DICT[i][1].test(t)) return t.length > 120 && !CHOICE[DICT[i][0]] && !long ? '' : DICT[i][0];
    }
    return '';
  }
  function byId(root, id) { return (root.getElementById ? root.getElementById(id) : null) || document.getElementById(id); }
  function labelText(el) {
    var root = el.getRootNode();
    var parts = [];
    // A label wrapping a select would otherwise include every option's text.
    if (el.labels) Array.prototype.forEach.call(el.labels, function (l) {
      var c = l.cloneNode(true);
      c.querySelectorAll('select, textarea, option').forEach(function (n) { n.remove(); });
      parts.push(c.textContent);
    });
    var by = el.getAttribute('aria-labelledby');
    if (by) by.split(/\s+/).forEach(function (id) { var n = byId(root, id); if (n) parts.push(n.textContent); });
    if (!parts.length && el.getAttribute('aria-label')) parts.push(el.getAttribute('aria-label'));
    return clean(parts.join(' '));
  }
  // Text just before the field: a previous sibling of the field or of one of its three nearest ancestors.
  function nearbyText(el) {
    for (var n = el, depth = 0; n && depth < 4; n = n.parentElement, depth++) {
      for (var s = n.previousElementSibling; s; s = s.previousElementSibling) {
        // Stop at another field (or its wrapper): its text belongs to that field.
        if (s.matches('input, select, textarea, button') || s.querySelector('input, select, textarea')) return '';
        var t = clean(s.textContent);
        if (t) return t.length < 200 ? t : '';
      }
    }
    return '';
  }
  // The question for a radio group: fieldset legend, radiogroup label, or the text before the group.
  function groupText(el) {
    var fs = el.closest('fieldset');
    var lg = fs && fs.querySelector('legend');
    if (lg) return clean(lg.textContent);
    var rg = el.closest('[role="radiogroup"]');
    if (rg) { var l = labelText(rg); if (l) return l; return nearbyText(rg); }
    var sameName = el.name ? 'input[type="radio"][name="' + CSS.escape(el.name) + '"]' : 'input[type="radio"]';
    var box = el.parentElement;
    for (var d = 0; box && box.parentElement && d < 5 && box.querySelectorAll(sameName).length < 2; d++) box = box.parentElement;
    return box ? nearbyText(box) : '';
  }
  function adapterKey(el) {
    var ids = [el.getAttribute('data-automation-id'), el.name, el.id, el.getAttribute('data-ui'), el.getAttribute('data-qa')];
    var wrap = el.closest('[data-automation-id^="formField-"]');
    if (wrap) ids.push(wrap.getAttribute('data-automation-id').replace(/^formField-/, ''));
    for (var i = 0; i < ids.length; i++) if (ids[i] && Object.prototype.hasOwnProperty.call(adapter, ids[i])) return adapter[ids[i]];
    return '';
  }
  function keyOf(el, label) {
    return adapterKey(el) || AUTOCOMPLETE[(el.getAttribute('autocomplete') || '').toLowerCase().split(/\s+/).pop()] ||
      lookup(label) || lookup(el.getAttribute('placeholder')) || lookup(tokens(el.name)) || lookup(tokens(el.id)) || (label ? '' : lookup(nearbyText(el)));
  }
  // Only fields the user can see: no tiny, transparent or off-screen inputs a page could plant to collect answers.
  function seen(el) {
    var r = el.getBoundingClientRect();
    if (r.width < 4 || r.height < 4) return false;
    var cs = getComputedStyle(el);
    if (cs.visibility === 'hidden' || cs.display === 'none') return false;
    for (var n = el; n && n.nodeType === 1; n = n.parentElement || (n.getRootNode() && n.getRootNode().host)) {
      if (+getComputedStyle(n).opacity < 0.1) return false;
    }
    return r.right + scrollX > 0 && r.bottom + scrollY > 0 && r.left + scrollX < document.documentElement.scrollWidth;
  }
  // Styled radios and checkboxes often hide the native input behind a visible label; the label is what the user sees.
  function visible(el) {
    if (seen(el)) return true;
    return /^(radio|checkbox)$/i.test(el.type || '') && !!el.labels && Array.prototype.some.call(el.labels, seen);
  }
  function required(el, label) { return el.required || el.getAttribute('aria-required') === 'true' || /\*\s*$/.test(label); }
  function display(el, label) {
    var t = label || clean(el.getAttribute('placeholder')) || nearbyText(el) || tokens(el.name || el.id) || 'Field';
    return t.replace(/\s*\*\s*$/, '').slice(0, 80);
  }
  function collect(root, out) {
    root.querySelectorAll('input, select, textarea').forEach(function (e) { out.push(e); });
    root.querySelectorAll('*').forEach(function (e) { if (e.shadowRoot) collect(e.shadowRoot, out); });
    return out;
  }

  // ---- writing ----
  function mark(el, color) {
    el.style.setProperty('outline', '2px solid ' + color, 'important');
    el.style.setProperty('outline-offset', '1px', 'important');
  }
  function setValue(el, v) {
    var proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : el instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
    // The native setter, so React and Vue see a real change instead of their own tracked value.
    Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, v);
    ['input', 'change', 'blur'].forEach(function (t) { el.dispatchEvent(new Event(t, { bubbles: true })); });
  }
  function yesNo(v) { return /^(y|yes|true)\b/i.test(v) ? 'yes' : /^(n|no|false)\b/i.test(v) ? 'no' : ''; }
  function placeholderOption(text, value) { return value === '' || /^(select|choose|please|--|—)/i.test(clean(text)); }
  // Best choice among [text, value] pairs for an answer; -1 when nothing fits well.
  function bestChoice(choices, v, key) {
    var want = norm(v), yn = yesNo(v), decline = DECLINE.test(v), best = -1, top = 0;
    choices.forEach(function (c, i) {
      var t = norm(c[0]), val = norm(c[1]), s = 0;
      if (!t && !val) return;
      if (key === 'phone_country' && v) s = new RegExp('\\+\\s*' + v + '\\b').test(t) || val === v || val === '+' + v ? 3 : 0;
      else if (t === want || val === want) s = 3;
      else if (decline && DECLINE.test(t)) s = 3;
      else if (yn && yesNo(t) === yn) s = 2;
      else if (want.length > 2 && t.length > 2 && (t.indexOf(want) === 0 || want.indexOf(t) === 0)) s = 2;
      else if (want.length > 3 && t.indexOf(want) >= 0) s = 1;
      if (s > top) { top = s; best = i; }
    });
    return best;
  }
  function typed(el, v, key) {
    var type = (el.type || '').toLowerCase();
    if (type === 'number') { var n = String(v).match(/\d+(\.\d+)?/); return n ? n[0] : ''; }
    if (type === 'date') return /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : '';
    if (type === 'month' || type === 'week' || type === 'time' || type === 'range' || type === 'color') return '';
    if (type === 'email' && key !== 'email') return '';
    return v;
  }

  var out = { filled: [], needs_you: [], skipped: [], ats: ats, note: '', frames: [], origin: location.origin };
  function push(list, text) { if (out[list].length < LIST_MAX && out[list].indexOf(text) < 0) out[list].push(text); }

  var fields = collect(document, []).filter(function (el) {
    var type = (el.type || '').toLowerCase();
    if (/^(hidden|submit|button|reset|image)$/.test(type) || el.disabled) return false;
    return type === 'file' || visible(el);
  });
  var keyed = fields.map(function (el) {
    var label = el.type === 'radio' ? groupText(el) : labelText(el);
    return { el: el, label: label, key: el.type === 'file' ? '' : keyOf(el, label) };
  });
  // A separate country-code field means the phone field wants the national number only.
  if (keyed.some(function (f) { return f.key === 'phone_country'; }) && cc) V.phone = phone.replace(/^\+\d{1,3}[\s-]*/, '');

  var groups = {};
  keyed.forEach(function (f) {
    var el = f.el, label = f.label, key = f.key, type = (el.type || '').toLowerCase();
    var shown = display(el, label);
    if (type === 'file') {
      if (el.files && el.files.length) return;
      var target = visible(el) ? el : el.closest('label, [class*="upload" i], [class*="drop" i], div') || el;
      mark(target, AMBER);
      if (!target.parentNode || !target.parentNode.querySelector || !target.parentNode.querySelector('[data-jivika-note]')) {
        var note = document.createElement('div');
        note.setAttribute('data-jivika-note', '');
        note.textContent = 'Attach your resume here';
        note.style.cssText = 'color:' + AMBER + ';font:600 12px/1.4 system-ui,sans-serif;margin:4px 0';
        target.insertAdjacentElement('afterend', note);
      }
      push('needs_you', shown === 'Field' ? 'Resume' : shown);
      return;
    }
    if (type === 'radio') {
      var gname = el.name || label;
      if (groups[gname]) return;
      var radios = keyed.filter(function (g) { return g.el.type === 'radio' && (g.el.name || g.label) === gname; }).map(function (g) { return g.el; });
      groups[gname] = true;
      var groupShown = (label || shown).slice(0, 80);
      if (radios.some(function (r) { return r.checked; })) return push('skipped', groupShown);
      var v = key && V[key];
      var pick = v ? bestChoice(radios.map(function (r) { return [labelText(r) || r.value, r.value]; }), v, key) : -1;
      if (pick >= 0) {
        radios[pick].click();
        mark(radios[pick].closest('label') || radios[pick], GREEN);
        return push('filled', groupShown);
      }
      if (radios.some(function (r) { return required(r, label); })) { radios.forEach(function (r) { mark(r, AMBER); }); return push('needs_you', groupShown); }
      return push('skipped', groupShown);
    }
    if (type === 'checkbox') {
      // Only yes/no questions with a known answer; consent boxes are left to you.
      var cv = key && CHOICE[key] && yesNo(V[key]);
      if (cv === 'yes' && !el.checked) { el.click(); mark(el, GREEN); return push('filled', shown); }
      if (cv) return push('skipped', shown);
      if (required(el, label) && !el.checked) { mark(el, AMBER); return push('needs_you', shown); }
      return push('skipped', shown);
    }
    if (el instanceof HTMLSelectElement) {
      var sel = el.options[el.selectedIndex];
      if (sel && !placeholderOption(sel.text, sel.value)) return push('skipped', shown);
      var sv = key && V[key];
      var opts = Array.prototype.filter.call(el.options, function (o) { return !o.disabled && !placeholderOption(o.text, o.value); });
      var i = sv ? bestChoice(opts.map(function (o) { return [o.text, o.value]; }), sv, key) : -1;
      if (i >= 0) { setValue(el, opts[i].value); mark(el, GREEN); return push('filled', shown); }
    } else {
      if (el.readOnly) return;
      if (clean(el.value)) return push('skipped', shown);
      var tv = key && V[key] ? typed(el, V[key], key) : '';
      if (tv) {
        setValue(el, tv);
        if (el.value === tv) { mark(el, GREEN); return push('filled', shown); }
      }
    }
    if (required(el, label)) { mark(el, AMBER); return push('needs_you', shown); }
    push('skipped', shown);
  });

  // Custom dropdowns (Workday, React Select) are not native fields: point them out when required.
  document.querySelectorAll('[role="combobox"][aria-required="true"], button[aria-haspopup="listbox"][aria-required="true"]').forEach(function (el) {
    if (el.matches('input, select, textarea') || !visible(el)) return;
    mark(el, AMBER);
    push('needs_you', display(el, labelText(el)));
  });

  if (ats === 'workday' && document.querySelector('[data-automation-id="pageFooterNextButton"], [data-automation-id="bottom-navigation-next-button"]')) {
    out.note = 'Workday shows one step at a time. This step is filled; check it, press Save and Continue yourself, then run Fill again.';
  }
  if (window.top === window) {
    document.querySelectorAll('iframe[src]').forEach(function (f) {
      try { var o = new URL(f.src, location.href).origin; if (o !== location.origin && /^https?:/.test(o) && out.frames.indexOf(o) < 0) out.frames.push(o); } catch (e) { /* bad src */ }
    });
  }
  return out;
}

// Combines the per-frame results of fill(). Frames that answered are dropped from the "could not reach" list.
function mergeFills(results) {
  var all = { filled: [], needs_you: [], skipped: [], ats: '', note: '', frames: [] };
  var reached = [];
  (results || []).forEach(function (r) {
    var x = r && r.result;
    if (!x) return;
    reached.push(x.origin);
    ['filled', 'needs_you', 'skipped'].forEach(function (k) { all[k] = all[k].concat(x[k] || []); });
    all.ats = all.ats || x.ats;
    all.note = all.note || x.note;
    all.frames = all.frames.concat(x.frames || []);
  });
  all.frames = all.frames.filter(function (o, i, a) { return reached.indexOf(o) < 0 && a.indexOf(o) === i; });
  return all;
}

// Fills every frame of the tab the extension may reach, with the profile and answers saved by Connect.
async function fillTab(tabId) {
  var s = await chrome.storage.local.get({ profile: null, answers: {} });
  if (!s.profile) return { ok: false, error: 'Connect your Jivika profile first: open Jivika, go to Settings, Jivika Clipper, and press Connect.' };
  var res = await chrome.scripting.executeScript({ target: { tabId: tabId, allFrames: true }, func: fill, args: [s.profile, s.answers || {}] });
  return { ok: true, summary: mergeFills(res) };
}

// The in-page button: one registered content script per origin. Used by the popup and the service worker.
function buttonScriptId(origin) { return 'site-' + origin.replace(/[^a-z0-9]/gi, '_'); }
async function registerButton(origin) {
  var id = buttonScriptId(origin);
  if ((await chrome.scripting.getRegisteredContentScripts({ ids: [id] })).length) return;
  try {
    await chrome.scripting.registerContentScripts([{ id: id, matches: [origin + '/*'], js: ['button.js'], runAt: 'document_idle', persistAcrossSessions: true }]);
  } catch (e) {
    // The popup and the service worker can race to register the same site; a duplicate id is fine.
    if (!(await chrome.scripting.getRegisteredContentScripts({ ids: [id] })).length) throw e;
  }
}

if (typeof module !== 'undefined') module.exports = { fill: fill, mergeFills: mergeFills };
