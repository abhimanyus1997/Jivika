/*
 * Jivika Clipper extractor. Reads the job posting from the current page.
 * Must stay a single self-contained function: the extension passes it to
 * chrome.scripting.executeScript({ func: extract }), which serialises only the function body,
 * and the bookmarklet inlines it. No imports, no outer-scope references.
 */
function extract() {
  var DESC_MAX = 20000;
  var FIELD_MAX = 300;
  var SKIP = /^(SCRIPT|STYLE|NOSCRIPT|TEMPLATE|SVG|BUTTON|IFRAME|CANVAS|INPUT|SELECT|TEXTAREA)$/;
  var BLOCK = /^(P|DIV|SECTION|ARTICLE|UL|OL|TABLE|TR|H1|H2|H3|H4|H5|H6|BLOCKQUOTE|PRE|HEADER|FOOTER|MAIN|DL|DT|DD|FORM|FIGURE)$/;

  // Text of a node with paragraph, line and bullet breaks preserved (innerText-like, but deterministic).
  function textOf(node) {
    var out = [];
    (function walk(n) {
      if (n.nodeType === 3) { out.push(n.nodeValue.replace(/\s+/g, ' ')); return; }
      if (n.nodeType !== 1 && n.nodeType !== 9 && n.nodeType !== 11) return;
      var tag = (n.tagName || '').toUpperCase();
      if (SKIP.test(tag)) return;
      if (n.nodeType === 1 && (n.hidden || n.getAttribute('aria-hidden') === 'true')) return;
      if (tag === 'BR') { out.push('\n'); return; }
      if (tag === 'LI') out.push('\n- ');
      else if (BLOCK.test(tag)) out.push('\n\n');
      for (var c = n.firstChild; c; c = c.nextSibling) walk(c);
      if (BLOCK.test(tag)) out.push('\n');
    })(node);
    return tidy(out.join(''));
  }
  function tidy(s) {
    return String(s || '')
      .replace(/\u00a0/g, ' ')
      .replace(/[ \t]+/g, ' ')
      .replace(/ *\n */g, '\n')
      .replace(/\n- (?=\n|$)/g, '\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
  }
  function line(s) { return tidy(s).replace(/\s+/g, ' '); }
  function htmlToText(html) {
    if (!/[<&]/.test(html)) return tidy(html);
    var t = textOf(new DOMParser().parseFromString(String(html), 'text/html').body);
    // Some sites entity-encode the HTML twice; decode one more level when tags survive the first pass.
    return /<\/?(p|br|li|ul|ol|b|strong|div)\b[^>]*>/i.test(t) ? textOf(new DOMParser().parseFromString(t, 'text/html').body) : t;
  }
  function first(sels, root) {
    for (var i = 0; i < sels.length; i++) {
      var els = (root || document).querySelectorAll(sels[i]);
      for (var j = 0; j < els.length; j++) { var t = line(textOf(els[j])); if (t) return t; }
    }
    return '';
  }
  function firstBlock(sels) {
    for (var i = 0; i < sels.length; i++) {
      var el = document.querySelector(sels[i]);
      var t = el && textOf(el);
      if (t && t.length > 40) return t;
    }
    return '';
  }
  // Value next to a visible label such as "Role:" or "Employment type".
  function labelled(name) {
    var want = name.toLowerCase();
    var els = document.querySelectorAll('label, span, h3, h4, dt, strong, b, div, li');
    for (var i = 0; i < els.length; i++) {
      var el = els[i];
      if (el.children.length > 1) continue;
      var own = line(el.textContent).replace(/\s*:$/, '').toLowerCase();
      if (own !== want) continue;
      var sib = el.nextElementSibling;
      var v = sib ? line(textOf(sib)) : '';
      if (!v && el.parentElement) v = line(textOf(el.parentElement)).slice(line(el.textContent).length).replace(/^\s*:\s*/, '');
      if (v) return v;
    }
    return '';
  }
  // Text-based fallback: the section that follows a heading like "Job description".
  function afterHeading(re) {
    var hs = document.querySelectorAll('h1, h2, h3, h4, strong, [class*="heading"], [class*="title"]');
    for (var i = 0; i < hs.length; i++) {
      if (!re.test(line(hs[i].textContent))) continue;
      var box = hs[i].parentElement;
      var t = box ? textOf(box).replace(/^[^\n]*\n*/, '') : '';
      if (t.length > 80) return t;
    }
    return '';
  }

  var host = location.hostname.replace(/^www\./, '');
  function on(d) { return host === d || host.slice(-d.length - 1) === '.' + d; }
  var site = on('naukri.com') ? 'naukri' : on('linkedin.com') ? 'linkedin' : /(^|\.)indeed\./.test(host) ? 'indeed'
    : on('instahyre.com') ? 'instahyre' : on('wellfound.com') || on('angel.co') ? 'wellfound'
    : on('foundit.in') || on('foundit.com') || on('monsterindia.com') ? 'foundit' : '';

  // (a) schema.org JobPosting JSON-LD
  function fromJsonLd() {
    var found = null;
    function visit(o) {
      if (!o || typeof o !== 'object' || found) return;
      if (Array.isArray(o)) { o.forEach(visit); return; }
      var t = o['@type'];
      if (t === 'JobPosting' || (Array.isArray(t) && t.indexOf('JobPosting') >= 0)) { found = o; return; }
      if (o['@graph']) visit(o['@graph']);
    }
    var scripts = document.querySelectorAll('script[type="application/ld+json"]');
    for (var i = 0; i < scripts.length && !found; i++) {
      try { visit(JSON.parse(scripts[i].textContent)); } catch (e) { /* malformed JSON-LD: skip */ }
    }
    if (!found) return null;
    var j = found;
    function name(v) { return !v ? '' : typeof v === 'string' ? v : Array.isArray(v) ? name(v[0]) : v.name || ''; }
    var locs = [].concat(j.jobLocation || []).map(function (l) {
      var a = (l && l.address) || l || {};
      if (typeof a === 'string') return a;
      return [a.addressLocality, a.addressRegion, name(a.addressCountry)].filter(Boolean).join(', ');
    }).filter(Boolean);
    if (j.jobLocationType === 'TELECOMMUTE') locs.push('Remote');
    var exp = j.experienceRequirements;
    if (exp && typeof exp === 'object') exp = exp.monthsOfExperience ? Math.round(exp.monthsOfExperience / 12 * 10) / 10 + ' years' : exp.description || '';
    var sal = '';
    var b = j.baseSalary;
    if (b && typeof b === 'object') {
      var v = b.value || {};
      var amt = typeof v === 'object' ? (v.minValue && v.maxValue ? v.minValue + ' - ' + v.maxValue : v.value || v.minValue || v.maxValue || '') : v;
      if (amt) sal = [b.currency, amt, v.unitText ? 'per ' + String(v.unitText).toLowerCase() : ''].filter(Boolean).join(' ');
    } else if (b) sal = String(b);
    return {
      title: name(j.title),
      company: name(j.hiringOrganization),
      location: locs.filter(function (x, k) { return locs.indexOf(x) === k; }).join('; '),
      employment_type: [].concat(j.employmentType || []).join(', ').replace(/_/g, ' ').toLowerCase(),
      experience_required: htmlToText(exp || ''),
      salary: sal,
      description: htmlToText(j.description || ''),
      posted_at: j.datePosted || ''
    };
  }

  // (b) site-specific DOM, with class-substring selectors that survive CSS-module hash changes
  function fromSite() {
    if (site === 'naukri') {
      var labels = ['Role', 'Industry Type', 'Department', 'Employment Type', 'Role Category', 'Education'];
      var extra = [];
      labels.forEach(function (l) { var v = labelled(l); if (v) extra.push(l + ': ' + v); });
      var skills = [];
      document.querySelectorAll('[class*="key-skill"] a, [class*="key-skill"] span, [class*="chip"]').forEach(function (e) {
        var s = line(e.textContent);
        if (s && s.length < 60 && !e.querySelector('a, span') && skills.indexOf(s) < 0) skills.push(s);
      });
      if (skills.length) extra.push('Key Skills: ' + skills.join(', '));
      var jd = firstBlock(['[class*="dang-inner-html"]', '[class*="job-desc"]', '.jd-desc']) || afterHeading(/^job description$/i);
      return {
        title: first(['[class*="jd-header-title"]', 'h1']),
        company: first(['[class*="jd-header-comp-name"] > a', '[class*="jd-header-comp-name"] a', '[class*="jd-header-comp-name"]']),
        experience_required: first(['[class*="jhc__exp__"]', '[class*="exp-wrap"]', '.exp']),
        salary: first(['[class*="jhc__salary__"]', '[class*="salary-wrap"]', '.salary']),
        location: first(['[class*="jhc__location__"] a', '[class*="jhc__location__"]', '[class*="loc-wrap"]', '.location']),
        employment_type: labelled('Employment Type'),
        description: tidy(jd + (extra.length ? '\n\n' + extra.join('\n') : ''))
      };
    }
    if (site === 'linkedin') {
      return {
        title: first(['.job-details-jobs-unified-top-card__job-title', '.jobs-unified-top-card__job-title', '.top-card-layout__title', '.topcard__title', 'h1']),
        company: first(['.job-details-jobs-unified-top-card__company-name', '.jobs-unified-top-card__company-name', '.topcard__org-name-link', '.topcard__flavor']),
        location: first(['.job-details-jobs-unified-top-card__primary-description-container .tvm__text', '.job-details-jobs-unified-top-card__bullet', '.jobs-unified-top-card__bullet', '.topcard__flavor--bullet']),
        employment_type: labelled('Employment type'),
        experience_required: labelled('Seniority level'),
        description: firstBlock(['.jobs-description__content .jobs-box__html-content', '.jobs-description-content__text', '#job-details', '.show-more-less-html__markup', '.description__text']) || afterHeading(/^about the job$/i)
      };
    }
    var map = {
      indeed: {
        title: ['[data-testid="jobsearch-JobInfoHeader-title"]', '.jobsearch-JobInfoHeader-title', 'h1'],
        company: ['[data-testid="inlineHeader-companyName"]', '[data-company-name]', '.jobsearch-CompanyInfoContainer a'],
        location: ['[data-testid="inlineHeader-companyLocation"]', '[data-testid="job-location"]', '.jobsearch-JobInfoHeader-subtitle > div:last-child'],
        salary: ['#salaryInfoAndJobType [class*="salary"]', '#salaryInfoAndJobType'],
        description: ['#jobDescriptionText', '.jobsearch-jobDescriptionText']
      },
      instahyre: {
        title: ['.job-title', '[class*="job-title"]', 'h1'],
        company: ['.company-name', '[class*="company-name"]'],
        location: ['.job-locations', '[class*="location"]'],
        experience_required: ['.job-experience', '[class*="experience"]'],
        description: ['.job-description', '[class*="job-description"]', '[class*="description"]']
      },
      wellfound: {
        title: ['[class*="jobTitle"]', 'h1'],
        company: ['[class*="companyName"]', 'a[href*="/company/"]'],
        location: ['[class*="location"]'],
        salary: ['[class*="compensation"]', '[class*="salary"]'],
        description: ['[class*="description"]', '#job-description']
      },
      foundit: {
        title: ['.job-tittle h1', '.jd-title', '[class*="jobTitle"]', 'h1'],
        company: ['.company-name', '[class*="companyName"]', '.job-tittle a'],
        location: ['.details.location', '[class*="location"]'],
        experience_required: ['.details.experience', '[class*="experience"]'],
        salary: ['.details.package', '[class*="salary"]'],
        description: ['.jd-text', '#jobDescription', '[class*="job-description"]', '[class*="jobDescription"]']
      }
    }[site];
    if (!map) return null;
    var r = {};
    Object.keys(map).forEach(function (k) { r[k] = k === 'description' ? firstBlock(map[k]) : first(map[k]); });
    r.title = (r.title || '').replace(/\s*-\s*job post$/i, '');
    return r;
  }

  // (c) generic: meta tags plus the element holding the most paragraph text, outside page chrome
  function fromPage() {
    function meta(p) { var m = document.querySelector('meta[property="' + p + '"], meta[name="' + p + '"]'); return m ? line(m.getAttribute('content')) : ''; }
    var best = null, bestScore = 0, scores = new Map();
    document.querySelectorAll('p, li, pre, td').forEach(function (p) {
      if (p.closest('nav, header, footer, aside, [role="navigation"], [role="banner"], [role="contentinfo"]')) return;
      var parent = p.parentElement;
      if (p.tagName === 'LI' && parent) parent = parent.parentElement || parent;
      if (!parent) return;
      var s = (scores.get(parent) || 0) + line(p.textContent).length;
      scores.set(parent, s);
      if (s > bestScore) { bestScore = s; best = parent; }
    });
    var h1 = first(['h1']);
    return {
      title: h1 || meta('og:title') || line(document.title),
      company: meta('og:site_name'),
      description: (best && bestScore > 200 ? textOf(best) : '') || meta('og:description') || meta('description')
    };
  }

  function cleanUrl(u) {
    try {
      var x = new URL(u);
      x.hash = '';
      var jobId = x.searchParams.get('currentJobId');
      if (site === 'linkedin' && jobId && /^\d+$/.test(jobId)) return x.origin + '/jobs/view/' + jobId + '/';
      Array.from(x.searchParams.keys()).forEach(function (k) {
        if (/^(utm_|mc_|pk_)/i.test(k) || /^(src|sid|xp|px|ref|refid|trk|trackingid|tracking_id|gclid|fbclid|msclkid|lipi|origin|from|position|pagenum|ebp|tk|vjk|from_|currentjobid|eboost)$/i.test(k)) x.searchParams.delete(k);
      });
      return x.toString();
    } catch (e) { return String(u); }
  }

  var parts = [], ld = null;
  try { parts.push(ld = fromJsonLd()); } catch (e) { /* fall through */ }
  try { parts.push(fromSite()); } catch (e) { /* fall through */ }
  try { parts.push(fromPage()); } catch (e) { /* fall through */ }
  parts = parts.filter(Boolean);
  var job = {};
  ['title', 'company', 'location', 'employment_type', 'experience_required', 'salary', 'description', 'posted_at'].forEach(function (k) {
    for (var i = 0; i < parts.length; i++) {
      var v = parts[i][k];
      if (v) { job[k] = k === 'description' ? tidy(v).slice(0, DESC_MAX) : line(v).slice(0, FIELD_MAX); return; }
    }
    if (k !== 'posted_at') job[k] = '';
  });
  job.url = cleanUrl(location.href).slice(0, 2000);
  job.source = site || (ld && (ld.title || ld.description) ? 'jsonld' : 'page');
  return job;
}

if (typeof module !== 'undefined') module.exports = { extract: extract };
