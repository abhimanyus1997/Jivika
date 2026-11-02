/* Bookmarklet entry: on a LinkedIn profile, import it to the Jivika profile; otherwise clip the job for Job match. */
(async function () {
  var url;
  if (isLinkedInProfile(location.href)) {
    var profile = await extractProfile();
    url = await clipUrl(CLIP_DEFAULT_APP, 'profile', profile);
  } else {
    var job = extract();
    if (!job.title && !job.description) { alert('Jivika Clipper could not find a job description on this page.'); return; }
    url = await clipUrl(CLIP_DEFAULT_APP, 'match', job);
  }
  var w = window.open(url, '_blank');
  if (w) w.opener = null; else location.assign(url);
})();
