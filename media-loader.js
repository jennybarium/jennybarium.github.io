/* =========================================================
   media-loader.js
   Central media resolver for static topic pages.

   Usage in any page's HTML:
     <img data-media="pyrite-1" alt="Pyrite specimen" loading="lazy">
     <audio data-media="cover-track-1" controls></audio>
     <video data-media="site-demo-clip" controls></video>

   This script fetches /media.json once, then fills in the real
   src for every element with a [data-media] attribute. Keeps
   media.json as the single place to update when a file moves —
   edit one line there instead of hunting through every page.
   ========================================================= */
(function(){
  function resolveAll(media){
    document.querySelectorAll('[data-media]').forEach(function(el){
      var key = el.getAttribute('data-media');
      var path = media[key];
      if(!path){
        console.warn('media.json has no entry for key "' + key + '"');
        el.insertAdjacentHTML('afterend', '<p class="hint">Missing media: ' + key + '</p>');
        return;
      }
      // Root-relative so it resolves correctly from any /slug/ subfolder.
      el.src = path.startsWith('/') ? path : '/' + path;
    });
  }

  document.addEventListener('DOMContentLoaded', function(){
    fetch('/media.json')
      .then(function(res){ return res.json(); })
      .then(resolveAll)
      .catch(function(err){
        console.error('Failed to load media.json', err);
      });
  });
})();