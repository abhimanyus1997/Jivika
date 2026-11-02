/*
 * Jivika Clipper LinkedIn profile reader (linkedin.com/in/<slug>/ and /in/<slug>/details/<section>/).
 * Self-contained like extract.js: the popup passes it to chrome.scripting.executeScript and the bookmarklet inlines it.
 * Reads by meaning, not by class names: the top card (componentkey/id containing "Topcard"), then sections found by
 * their h2 heading, then the list items inside each section.
 * opts.prepare (default true): scroll through the page so lazy sections render and expand "see more" first.
 */
async function extractProfile(opts) {
  opts = opts || {};
  var RAW_MAX = 40000;
  var SKIP = /^(SCRIPT|STYLE|NOSCRIPT|TEMPLATE|SVG|BUTTON|IFRAME|CANVAS|INPUT|SELECT|TEXTAREA)$/;
  var BLOCK = /^(P|DIV|SECTION|ARTICLE|UL|OL|LI|TABLE|TR|H1|H2|H3|H4|H5|H6|BLOCKQUOTE|PRE|HEADER|FOOTER|MAIN|DL|DT|DD|FIGURE)$/;
  var NOISE = /^((…|\.\.\.)\s*)?(see|show) (more|less)$|^(…|\.\.\.)\s*more$|^show all\b|^endorse$|^\d+ endorsements?$|^contact info$|^show (project|publication|credential)$/i;
  var TYPES = /^(full[- ]time|part[- ]time|self[- ]employed|freelance|contract|internship|apprenticeship|seasonal|permanent|temporary|trainee)$/i;
  var DURATION = /^(\d+\s+(yrs?|years?|mos?|months?)\s*)+$/i;
  var SECTIONS = [
    ['summary', /^about$/i], ['experience', /^(work )?experience$/i], ['education', /^education$/i], ['skills', /^skills$/i],
    ['certifications', /^(licen[cs]es? (&|and) )?certifications$/i], ['projects', /^projects$/i], ['languages', /^languages$/i],
    ['honors', /^honou?rs? (&|and) awards$/i], ['volunteering', /^volunteer(ing| experience)?$/i], ['publications', /^publications$/i],
    ['courses', /^courses$/i]
  ];

  function tidy(s) {
    return String(s || '').replace(/\u00a0/g, ' ').replace(/[ \t]+/g, ' ').replace(/ *\n */g, '\n').replace(/\n{3,}/g, '\n\n').trim();
  }
  function line(s) { return tidy(s).replace(/\s+/g, ' '); }
  function textOf(node) {
    var out = [];
    (function walk(n) {
      if (n.nodeType === 3) { out.push(n.nodeValue.replace(/\s+/g, ' ')); return; }
      if (n.nodeType !== 1 && n.nodeType !== 9 && n.nodeType !== 11) return;
      var tag = (n.tagName || '').toUpperCase();
      if (SKIP.test(tag)) return;
      if (n.nodeType === 1 && (n.hidden || n.getAttribute('aria-hidden') === 'true')) return;
      if (tag === 'BR' || BLOCK.test(tag)) out.push('\n');
      for (var c = n.firstChild; c; c = c.nextSibling) walk(c);
      if (BLOCK.test(tag)) out.push('\n');
    })(node);
    return tidy(out.join(''));
  }
  // Visible lines of an element, without UI noise, consecutive duplicates or bullet marks.
  function linesOf(el) {
    return textOf(el).split('\n').map(function (s) { return s.replace(/^[-•*·]\s*/, '').trim(); })
      .filter(function (s, i, a) { return s && !NOISE.test(s) && s !== a[i - 1]; });
  }
  function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }
  function visible(el) { return !!(el.offsetWidth || el.offsetHeight || el.getClientRects().length); }

  // Resolves after 800 ms without DOM mutations, or after maxMs.
  function settle(maxMs) {
    return new Promise(function (done) {
      var quiet, end;
      var mo = new MutationObserver(function () { clearTimeout(quiet); quiet = setTimeout(finish, 800); });
      function finish() { mo.disconnect(); clearTimeout(quiet); clearTimeout(end); done(); }
      mo.observe(document.documentElement, { childList: true, subtree: true, characterData: true });
      quiet = setTimeout(finish, 800);
      end = setTimeout(finish, maxMs);
    });
  }

  // Profile cards whose "see more" may be expanded. Activity, Featured, Recommendations and suggestion cards are left
  // alone: their "more" controls open posts and navigate away from the profile.
  var CARD_OK = /(Topcard|About|Experience|Education|Certification|Projects?|Skills|Publication|Language|Volunteer|Honors|Course|Organizations|Patents|TestScores)[A-Za-z]*$/;
  function profileCards() {
    var cards = Array.prototype.slice.call(document.querySelectorAll('[componentkey^="com.linkedin.sdui.profile.card.ref"]'))
      .filter(function (c) { return CARD_OK.test(c.getAttribute('componentkey')); });
    // Plus sections identified by their heading (older layouts, or cards keyed differently).
    Array.prototype.forEach.call(document.querySelectorAll('section'), function (s) {
      var h = s.querySelector('h2');
      if (h && cards.indexOf(s) < 0 && SECTIONS.some(function (p) { return p[1].test(line(h.textContent).replace(/\s*\(\d+\)$/, '')); })) cards.push(s);
    });
    return cards;
  }

  async function prepare() {
    var began = Date.now(), x = scrollX, y = scrollY, start = location.href;
    function stillHere() {
      if (location.href !== start) throw new Error('The page changed while loading. Open your profile and try again.');
    }
    for (var i = 0; i < 25 && Date.now() - began < 9000; i++) {
      if (innerHeight + scrollY >= document.documentElement.scrollHeight - 2) break;
      scrollBy(0, innerHeight);
      await sleep(300);
      stillHere();
    }
    profileCards().forEach(function (card) {
      card.querySelectorAll('button').forEach(function (b) {
        // Only in-place expanders: never links, carousels or anything that could navigate.
        if (b.closest('a, form, [data-testid="carousel"]')) return;
        var expander = b.getAttribute('data-testid') === 'expandable-text-button' ||
          /see more|show more|^(…|\.\.\.)\s*more\b/i.test(line(b.textContent + ' ' + (b.getAttribute('aria-label') || '')));
        if (expander && visible(b) && b.getAttribute('aria-expanded') !== 'true') b.click();
      });
    });
    await settle(Math.max(1000, 12000 - (Date.now() - began)));
    stillHere();
    scrollTo(x, y);
  }

  function dates(s) {
    var m = String(s).match(/^((?:[A-Za-z]{3,9}\.?\s+)?\d{4})(?:\s*[-–—]\s*((?:[A-Za-z]{3,9}\.?\s+)?\d{4}|Present|Current|Now))?(?:\s*·\s*(.+))?$/i);
    if (!m) return null;
    var now = /^(present|current|now)$/i.test(m[2] || '');
    return { start: m[1], end: now ? '' : m[2] || '', current: now, duration: m[3] || '' };
  }
  function looksLikeLocation(s) {
    return s.length < 100 && !/[.!?]$/.test(s) && (/,/.test(s) || /^(remote|hybrid|on-site)$/i.test(s) || /·\s*(remote|hybrid|on-site)$/i.test(s));
  }
  function bullets(lines) {
    return lines.filter(function (l) {
      return !/^skills:/i.test(l) && !/^associated with\b/i.test(l) && !/\band \+\d+ skills?$/i.test(l) && !/^show all \d+/i.test(l);
    });
  }
  // 2026 layout: entries are componentkey="entity-collection-item--<hash>" blocks instead of <li>.
  var ITEM = '[componentkey^="entity-collection-item"]';
  function headerLines(li) {
    var c = li.cloneNode(true);
    c.querySelectorAll('li, ' + ITEM).forEach(function (n) { n.remove(); });
    return linesOf(c);
  }

  function role(lines, company, companyLocation) {
    var e = { company: company || '', title: '', location: '', start: '', end: '', current: false, employment_type: '', duration: '', bullets: [] };
    var di = -1;
    for (var i = 0; i < lines.length && di < 0; i++) if (dates(lines[i])) di = i;
    var head = di >= 0 ? lines.slice(0, di) : lines.slice(0, 2);
    var rest = di >= 0 ? lines.slice(di + 1) : lines.slice(2);
    if (di >= 0) { var d = dates(lines[di]); e.start = d.start; e.end = d.end; e.current = d.current; e.duration = d.duration; }
    e.title = head[0] || '';
    head.slice(1).forEach(function (h) {
      h.split(/\s+·\s+/).forEach(function (p) {
        if (TYPES.test(p)) e.employment_type = p;
        else if (!e.company && !DURATION.test(p)) e.company = p;
      });
    });
    if (rest[0] && looksLikeLocation(rest[0])) e.location = rest.shift().replace(/\s*·\s*/g, ', ');
    if (!e.location && companyLocation) e.location = companyLocation;
    e.bullets = bullets(rest);
    return e;
  }

  function experience(li) {
    var nested = li.querySelectorAll('li, ' + ITEM);
    if (!nested.length) return [role(linesOf(li))];
    // Several positions under one company: the header names the company, each nested item is a role.
    var head = headerLines(li);
    var company = head[0] || '';
    var loc = '';
    head.slice(1).forEach(function (h) { if (!loc && looksLikeLocation(h) && !TYPES.test(h.split(/\s+·\s+/)[0])) loc = h.replace(/\s*·\s*/g, ', '); });
    return Array.prototype.map.call(nested, function (n) { return role(linesOf(n), company, loc); });
  }

  function education(lines) {
    var e = { institution: lines[0] || '', degree: '', field: '', start: '', end: '', grade: '', description: '' };
    var rest = lines.slice(1);
    if (rest[0] && !dates(rest[0]) && !/^grade\b/i.test(rest[0])) {
      var dl = rest.shift();
      var cut = dl.indexOf(', ');
      e.degree = cut > 0 ? dl.slice(0, cut) : dl;
      e.field = cut > 0 ? dl.slice(cut + 2) : '';
    }
    var other = [];
    rest.forEach(function (l) {
      var d = dates(l);
      var g = l.match(/^grade:?\s*(.+)$/i);
      if (d && !e.start) { e.start = d.start; e.end = d.current ? 'Present' : d.end; }
      else if (g) e.grade = g[1];
      else other.push(l);
    });
    e.description = other.join('\n');
    return e;
  }

  function externalLink(li) {
    var links = li.querySelectorAll('a[href^="http"]');
    for (var i = 0; i < links.length; i++) if (!/(^|\.)linkedin\.com$/i.test(links[i].hostname)) return links[i].href;
    return '';
  }

  var out = {
    source: 'linkedin_profile',
    basics: { name: '', headline: '', location: '', summary: '', linkedin: '' },
    experience: [], education: [], skills: [], languages: [], certifications: [], projects: [], publications: [],
    honors: [], volunteering: [], courses: [], sections_found: [], raw_text: '', url: ''
  };

  if (opts.prepare !== false) { try { await prepare(); } catch (e) { /* read what is there */ } }

  var main = document.querySelector('main') || document.body;
  var slug = location.pathname.match(/\/in\/([^/?#]+)/);
  out.basics.linkedin = slug ? location.origin + '/in/' + slug[1] + '/' : '';
  out.url = String(location.href).split('#')[0].slice(0, 2000);

  // Top card: name, then pronouns / connection degree, then headline, then location.
  var top = document.querySelector('[componentkey*="topcard" i], [id*="topcard" i], [data-view-name*="top-card" i], .pv-top-card');
  var nameEl = (top && top.querySelector('h1')) || main.querySelector('h1') || (top && top.querySelector('h2, h3'));
  if (nameEl) {
    out.basics.name = line(textOf(nameEl));
    var tl = linesOf(top || nameEl.parentElement);
    var at = tl.indexOf(out.basics.name);
    tl = tl.slice(at + 1).filter(function (l) { return !/^\(?[a-z]+\/[a-z]+\)?$/i.test(l) && !/^·?\s*(1st|2nd|3rd\+?)$/i.test(l) && l !== '·'; });
    if (tl[0] && tl[0].length <= 220) out.basics.headline = tl.shift();
    var rawTop = textOf(top || nameEl.parentElement).split('\n').map(function (s) { return s.trim(); }).filter(function (s) { return s && s !== '·'; });
    var ci = -1;
    for (var r = 0; r < rawTop.length; r++) if (/^(·\s*)?contact info$/i.test(rawTop[r])) { ci = r; break; }
    if (ci > 0 && rawTop[ci - 1].length < 100 && rawTop[ci - 1] !== out.basics.headline) out.basics.location = rawTop[ci - 1];
    for (var t = 0; t < tl.length && !out.basics.location; t++) {
      var cand = tl[t].replace(/\s*·\s*contact info$/i, '').replace(/\s*·$/, '');
      if (/connections|followers|mutual/i.test(cand)) continue;
      if (/,/.test(cand) && !/\s·\s/.test(cand) && cand.length < 100) { out.basics.location = cand; break; }
    }
  }

  // Entries with no marker at all (newer education, certification, project and language cards): the element whose
  // children are the entries is the one with the most children carrying at least minLines lines of real text.
  function repeated(box, heading, key) {
    // What one entry of each section always carries, so a single entry's inner blocks are never mistaken for entries.
    var marker = {
      languages: function (ls) { return ls.some(function (l) { return /proficiency|native|bilingual|fluent|elementary/i.test(l); }); },
      certifications: function (ls) { return ls.some(function (l) { return /^issued\b/i.test(l) || dates(l); }); },
      publications: function (ls) { return ls.length >= 1 && ls.some(function (l) { return /\b(19|20)\d{2}\b/.test(l); }); }
    }[key] || function (ls) { return ls.some(function (l) { return dates(l.replace(/\s*·\s*[^·]+$/, '')) || dates(l); }); };
    var best = [], bestScore = 0;
    box.querySelectorAll('*').forEach(function (el) {
      if (el.contains(heading)) return;
      var kids = Array.prototype.filter.call(el.children, function (k) {
        if (k.querySelector('h2')) return false;
        return marker(linesOf(k));
      });
      // More entries wins; on a tie the outer container is kept (ancestors come first).
      if (kids.length > bestScore) { best = kids; bestScore = kids.length; }
    });
    return best;
  }

  var seen = {};
  document.querySelectorAll('h2').forEach(function (h2) {
    if (top && top.contains(h2)) return;
    var heading = line(textOf(h2)).replace(/\s*\(\d+\)$/, '');
    var key = '';
    SECTIONS.forEach(function (s) { if (!key && s[1].test(heading)) key = s[0]; });
    if (!key || seen[key]) return;
    var box = h2.closest('[componentkey^="com.linkedin.sdui.profile.card.ref"]') || h2.closest('section') ||
      (h2.parentElement && h2.parentElement.parentElement) || h2.parentElement;
    if (!box) return;
    seen[key] = true;
    if (key === 'summary') {
      var lines = linesOf(box);
      if (lines[0] === heading) lines.shift();
      out.basics.summary = lines.join('\n');
      if (out.basics.summary) out.sections_found.push(key);
      return;
    }
    var sel = key === 'skills' && box.querySelector('[componentkey^="com.linkedin.sdui.profile.skill("]')
      ? '[componentkey^="com.linkedin.sdui.profile.skill("]:not([componentkey$="-divider"]):not([componentkey$="-maxSkillsCallout"])'
      : box.querySelector(ITEM) ? ITEM : box.querySelector('li') ? 'li' : '';
    var items = sel ? Array.prototype.filter.call(box.querySelectorAll(sel), function (li) {
      var outer = li.parentElement && li.parentElement.closest(sel);
      return !outer || !box.contains(outer);
    }) : repeated(box, h2, key);
    if (!items.length) { seen[key] = false; return; }
    items.forEach(function (li) {
      var lines = linesOf(li);
      if (!lines.length) return;
      if (key === 'experience') out.experience = out.experience.concat(experience(li));
      else if (key === 'volunteering') out.volunteering.push(role(lines));
      else if (key === 'education') out.education.push(education(lines));
      else if (key === 'skills') { if (out.skills.indexOf(lines[0]) < 0) out.skills.push(lines[0]); }
      else if (key === 'languages') out.languages.push({ name: lines[0], level: lines[1] && /proficiency|native|fluent|basic|intermediate|advanced/i.test(lines[1]) ? lines[1] : '' });
      else if (key === 'certifications') {
        var issued = lines.filter(function (l) { return /^issued\b/i.test(l); })[0] || '';
        var y = issued.match(/\b(19|20)\d{2}\b/);
        out.certifications.push({ name: lines[0], issuer: lines[1] && !/^issued\b/i.test(lines[1]) ? lines[1] : '', year: y ? y[0] : '' });
      } else if (key === 'projects') {
        var desc = lines.slice(1).filter(function (l) { return !dates(l); });
        out.projects.push({ name: lines[0], role: '', link: externalLink(li), description: bullets(desc).join('\n'), bullets: [] });
      } else if (key === 'publications') out.publications.push({ citation: lines.slice(0, 2).join('. ') });
      else if (key === 'honors') out.honors.push(lines.slice(0, 2).join(' · '));
      else if (key === 'courses') out.courses.push(lines[0]);
    });
    var count = key === 'skills' ? out.skills.length : out[key].length;
    if (count) out.sections_found.push(key);
  });
  out.experience.forEach(function (e) { delete e.duration; });
  out.volunteering.forEach(function (e) { delete e.duration; });
  out.skills = out.skills.length ? [{ group: 'Skills', items: out.skills }] : [];
  out.raw_text = textOf(main).slice(0, RAW_MAX);
  return out;
}

if (typeof module !== 'undefined') module.exports = { extractProfile: extractProfile };
