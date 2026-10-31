/* Bookmarklet entry: extract the job from this page and open it in Jivika (default app URL, Job match page). */
(async function () {
  var job = extract();
  if (!job.title && !job.description) { alert('Jivika Clipper could not find a job description on this page.'); return; }
  var url = await clipUrl(CLIP_DEFAULT_APP, 'match', job);
  var w = window.open(url, '_blank');
  if (w) w.opener = null; else location.assign(url);
})();
