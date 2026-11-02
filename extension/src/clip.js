/*
 * Builds the hand-off URL: <appUrl>#<page>?clip=<payload>.
 * payload = base64url(UTF-8 JSON), or 'z.' + base64url(deflate-raw(UTF-8 JSON)) when CompressionStream exists.
 * The job travels in the URL fragment, which browsers never send to a server.
 */
// Must match manifest.json "version" (build.mjs checks). The app compares it with its LATEST_CLIPPER_VERSION.
var CLIPPER_VERSION = '0.2.0';
var CLIP_DEFAULT_APP = 'https://jivika.abhimanyu.fyi/app/';
var CLIP_PAGES = { match: 'match', ats: 'ats', cover: 'cover-letter', interview: 'interview', profile: 'profile', linkedin: 'linkedin', track: 'new-application' };
// The app refuses clip parameters over 64000 characters; stay under it.
var CLIP_MAX = 60000;

async function clipEncode(data) {
  var bytes = new TextEncoder().encode(JSON.stringify(data));
  var prefix = '';
  if (typeof CompressionStream === 'function') {
    var stream = new Blob([bytes]).stream().pipeThrough(new CompressionStream('deflate-raw'));
    bytes = new Uint8Array(await new Response(stream).arrayBuffer());
    prefix = 'z.';
  }
  var bin = '';
  for (var i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return prefix + btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function clipBase(appUrl, page) {
  return String(appUrl || CLIP_DEFAULT_APP).replace(/#.*$/, '') + '#' + (CLIP_PAGES[page] || 'match');
}

// Adds clipper_version. Unless noFit, halves raw_text (profile clips) until the payload fits CLIP_MAX.
async function clipUrl(appUrl, page, data, noFit) {
  var payload = Object.assign({}, data, { clipper_version: CLIPPER_VERSION });
  var enc = await clipEncode(payload);
  while (!noFit && enc.length > CLIP_MAX && payload.raw_text) {
    payload.raw_text = payload.raw_text.length > 2000 ? payload.raw_text.slice(0, payload.raw_text.length >> 1) : '';
    enc = await clipEncode(payload);
  }
  // ponytail: a payload still over CLIP_MAX without raw_text is sent as is; the app shows its "too large" notice.
  return clipBase(appUrl, page) + '?clip=' + enc;
}

function clipTooBig(url) { return url.length - url.indexOf('?clip=') - 6 > CLIP_MAX; }

function isLinkedInProfile(url) { return /^https:\/\/([\w-]+\.)?linkedin\.com\/in\/[^/?#]+/i.test(String(url)); }

if (typeof module !== 'undefined') module.exports = { clipUrl: clipUrl, clipEncode: clipEncode, clipTooBig: clipTooBig, isLinkedInProfile: isLinkedInProfile, CLIP_DEFAULT_APP: CLIP_DEFAULT_APP, CLIP_PAGES: CLIP_PAGES, CLIPPER_VERSION: CLIPPER_VERSION };
