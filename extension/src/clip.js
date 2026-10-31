/*
 * Builds the hand-off URL: <appUrl>#<page>?clip=<payload>.
 * payload = base64url(UTF-8 JSON), or 'z.' + base64url(deflate-raw(UTF-8 JSON)) when CompressionStream exists.
 * The job travels in the URL fragment, which browsers never send to a server.
 */
var CLIP_DEFAULT_APP = 'https://jivika.abhimanyu.fyi/app/';
var CLIP_PAGES = { match: 'match', ats: 'ats', cover: 'cover-letter', interview: 'interview' };

async function clipUrl(appUrl, page, job) {
  var bytes = new TextEncoder().encode(JSON.stringify(job));
  var prefix = '';
  if (typeof CompressionStream === 'function') {
    var stream = new Blob([bytes]).stream().pipeThrough(new CompressionStream('deflate-raw'));
    bytes = new Uint8Array(await new Response(stream).arrayBuffer());
    prefix = 'z.';
  }
  var bin = '';
  for (var i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  var b64 = btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  return String(appUrl || CLIP_DEFAULT_APP).replace(/#.*$/, '') + '#' + (CLIP_PAGES[page] || 'match') + '?clip=' + prefix + b64;
}

if (typeof module !== 'undefined') module.exports = { clipUrl: clipUrl, CLIP_DEFAULT_APP: CLIP_DEFAULT_APP, CLIP_PAGES: CLIP_PAGES };
