/* wermyle — shared scripts for every page: scroll-reveal animations and the in-site video player */
window.wm = (function () {
  const still = matchMedia('(prefers-reduced-motion: reduce)').matches;

  /* ---------- scroll reveal ----------
     reveal([[selector, direction, stagger], ...]); direction: 'up' | 'left' | 'right' | 'impact'.
     Elements slide in when their block enters the screen and slide back out when it leaves. */
  function reveal(config) {
    config.forEach(([sel, dir, stagger]) => document.querySelectorAll(sel).forEach((el, i) => {
      el.dataset.from = dir;
      if (stagger) el.style.setProperty('--d', (i * stagger) + 's');
    }));
    if (still || !('IntersectionObserver' in window)) return;
    const vh = innerHeight, groups = new Map();
    // watch each element's parent, which never moves or scales, so an element's own animation
    // (like the impact zoom) can't push it in and out of view and retrigger itself
    document.querySelectorAll('[data-from]').forEach(el => {
      const p = el.parentElement;
      if (!groups.has(p)) groups.set(p, []);
      groups.get(p).push(el);
      if (p.getBoundingClientRect().top >= vh * 0.9) el.classList.add('pre'); // below the fold starts hidden
    });
    const io = new IntersectionObserver(es => es.forEach(e => {
      (groups.get(e.target) || []).forEach(el => {
        const on = e.isIntersecting;
        if (el.dataset.from === 'impact') {
          if (on && !el.classList.contains('hit')) { el.classList.remove('pre'); el.classList.add('hit'); }
          else if (!on) { el.classList.remove('hit'); el.classList.add('pre'); }
        } else el.classList.toggle('pre', !on);
      });
    }), { threshold: .1 });
    groups.forEach((_, p) => io.observe(p));
    // the banner at the top plays once on load
    document.querySelectorAll('.hero [data-from], .mhero [data-from]').forEach(el => {
      el.classList.add('pre');
      requestAnimationFrame(() => requestAnimationFrame(() => el.classList.remove('pre')));
    });
  }

  /* ---------- in-site video player ----------
     Any <a data-video="YOUTUBE_ID" data-title="…" data-short="1"> opens here instead of leaving the site. */
  let box, frame, titleEl, ytLink, lastFocus;
  function build() {
    box = document.createElement('div');
    box.className = 'player';
    box.hidden = true;
    box.innerHTML =
      '<div class="player-bg" data-pclose></div>' +
      '<div class="player-box" role="dialog" aria-modal="true" aria-label="Video player">' +
        '<div class="player-bar"><b class="player-title"></b>' +
        '<a class="player-yt" target="_blank" rel="noopener">Open on YouTube</a>' +
        '<button type="button" class="player-x" data-pclose aria-label="Close player">×</button></div>' +
        '<div class="player-frame"></div>' +
      '</div>';
    document.body.appendChild(box);
    frame = box.querySelector('.player-frame');
    titleEl = box.querySelector('.player-title');
    ytLink = box.querySelector('.player-yt');
    box.addEventListener('click', e => { if (e.target.closest('[data-pclose]')) close(); });
    // capture phase: Esc closes the player first, before any window underneath it
    document.addEventListener('keydown', e => {
      if (e.key === 'Escape' && !box.hidden) { e.stopImmediatePropagation(); close(); }
    }, true);
  }
  function play(id, title, short) {
    if (!/^[\w-]{6,20}$/.test(id)) return;
    if (!box) build();
    lastFocus = document.activeElement;
    box.classList.toggle('vertical', !!short);
    titleEl.textContent = title || 'wermyle';
    ytLink.href = short ? `https://www.youtube.com/shorts/${id}` : `https://www.youtube.com/watch?v=${id}`;
    frame.innerHTML = `<iframe src="https://www.youtube-nocookie.com/embed/${id}?autoplay=1&rel=0&playsinline=1" title="${(title || 'Video').replace(/"/g, '&quot;')}" allow="autoplay; encrypted-media; picture-in-picture; fullscreen" allowfullscreen></iframe>`;
    box.hidden = false;
    document.body.classList.add('lock');
    box.querySelector('.player-x').focus();
  }
  function close() {
    box.hidden = true;
    frame.innerHTML = '';                      // stops the video
    if (!document.querySelector('.modal:not([hidden])')) document.body.classList.remove('lock');
    if (lastFocus) lastFocus.focus();
  }
  document.addEventListener('click', e => {
    const a = e.target.closest('a[data-video]');
    if (!a || e.ctrlKey || e.metaKey || e.shiftKey || e.button) return;   // ctrl/cmd-click still opens YouTube
    e.preventDefault();
    play(a.dataset.video, a.dataset.title, a.dataset.short === '1');
  });

  return { reveal, play };
})();
