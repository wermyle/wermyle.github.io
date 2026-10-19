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
     Any <a data-video="YOUTUBE_ID" data-title="…" data-short="1"> opens here instead of leaving the site.
     YouTube's own buttons are turned off; the site draws its own controls, which hide after HIDE_MS. */
  const HIDE_MS = 1500;
  let box, stage, titleEl, ytLink, lastFocus, yt = null, tick = 0, hideT = 0, dragging = false;
  let apiReady = null;
  function loadApi() {
    if (apiReady) return apiReady;
    apiReady = new Promise((res, rej) => {
      if (window.YT && YT.Player) return res();
      const prev = window.onYouTubeIframeAPIReady;
      window.onYouTubeIframeAPIReady = () => { if (prev) prev(); res(); };
      const s = document.createElement('script');
      s.src = 'https://www.youtube.com/iframe_api';
      s.onerror = rej;
      document.head.appendChild(s);
      setTimeout(rej, 8000);
    });
    return apiReady;
  }
  const ICON = {
    play: '<svg viewBox="0 0 24 24"><path d="M8 5.5v13l11-6.5z"/></svg>',
    pause: '<svg viewBox="0 0 24 24"><path d="M7 5h3.5v14H7zM13.5 5H17v14h-3.5z"/></svg>',
    vol: '<svg viewBox="0 0 24 24"><path d="M4 9h4l5-4v14l-5-4H4zM16 8.5a5 5 0 0 1 0 7M18.5 6a8.5 8.5 0 0 1 0 12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><path d="M4 9h4l5-4v14l-5-4H4z"/></svg>',
    mute: '<svg viewBox="0 0 24 24"><path d="M4 9h4l5-4v14l-5-4H4z"/><path d="M16.5 9.5l5 5m0-5l-5 5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>',
    full: '<svg viewBox="0 0 24 24"><path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/></svg>'
  };
  const fmt = t => { t = Math.max(0, Math.floor(t || 0)); return Math.floor(t / 60) + ':' + String(t % 60).padStart(2, '0'); };
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
        '<div class="player-frame">' +
          '<div class="player-stage"></div>' +
          '<div class="player-hit" aria-hidden="true"></div>' +
          '<div class="player-flash" aria-hidden="true"></div>' +
          '<div class="player-ctl">' +
            '<button type="button" class="pc-play" aria-label="Pause">' + ICON.pause + '</button>' +
            '<span class="pc-time">0:00 / 0:00</span>' +
            '<input class="pc-seek" type="range" min="0" max="1000" value="0" aria-label="Seek">' +
            '<button type="button" class="pc-mute" aria-label="Mute">' + ICON.vol + '</button>' +
            '<input class="pc-vol" type="range" min="0" max="100" value="100" aria-label="Volume">' +
            '<button type="button" class="pc-full" aria-label="Full screen">' + ICON.full + '</button>' +
          '</div>' +
        '</div>' +
      '</div>';
    document.body.appendChild(box);
    stage = box.querySelector('.player-stage');
    titleEl = box.querySelector('.player-title');
    ytLink = box.querySelector('.player-yt');
    const frame = box.querySelector('.player-frame'), q = c => box.querySelector(c);
    box.addEventListener('click', e => { if (e.target.closest('[data-pclose]')) close(); });
    q('.player-hit').addEventListener('click', toggle);
    q('.player-hit').addEventListener('dblclick', full);
    q('.pc-play').addEventListener('click', toggle);
    q('.pc-full').addEventListener('click', full);
    q('.pc-mute').addEventListener('click', () => { if (!yt) return; yt.isMuted() ? yt.unMute() : yt.mute(); setTimeout(sync, 60); });
    q('.pc-vol').addEventListener('input', e => { if (!yt) return; yt.setVolume(+e.target.value); if (+e.target.value > 0) yt.unMute(); sync(); });
    const seek = q('.pc-seek');
    seek.addEventListener('input', () => { dragging = true; const d = yt && yt.getDuration(); q('.pc-time').textContent = fmt(d * seek.value / 1000) + ' / ' + fmt(d); });
    seek.addEventListener('change', () => { dragging = false; if (yt) yt.seekTo(yt.getDuration() * seek.value / 1000, true); });
    ['mousemove', 'touchstart', 'focusin'].forEach(ev => frame.addEventListener(ev, wake, { passive: true }));
    frame.addEventListener('mouseleave', () => { if (playing()) hideSoon(0); });
    // capture phase: Esc closes the player first, before any window underneath it
    document.addEventListener('keydown', e => {
      if (box.hidden) return;
      if (e.key === 'Escape') { e.stopImmediatePropagation(); if (document.fullscreenElement) document.exitFullscreen(); else close(); return; }
      if (e.target.matches('input[type=range]') && /Arrow/.test(e.key)) return;
      if (e.key === ' ' || e.key === 'k') { e.preventDefault(); toggle(); }
      else if (e.key === 'ArrowRight' && yt) { yt.seekTo(yt.getCurrentTime() + 5, true); wake(); }
      else if (e.key === 'ArrowLeft' && yt) { yt.seekTo(yt.getCurrentTime() - 5, true); wake(); }
      else if (e.key === 'm' && yt) { yt.isMuted() ? yt.unMute() : yt.mute(); setTimeout(sync, 60); }
      else if (e.key === 'f') full();
    }, true);
  }
  const playing = () => yt && yt.getPlayerState && yt.getPlayerState() === 1;
  function toggle() {
    if (!yt) return;
    playing() ? yt.pauseVideo() : yt.playVideo();
    const f = box.querySelector('.player-flash');
    f.innerHTML = playing() ? ICON.pause : ICON.play;
    f.classList.remove('go'); void f.offsetWidth; f.classList.add('go');
    wake();
  }
  function full() {
    const b = box.querySelector('.player-box');
    if (document.fullscreenElement) document.exitFullscreen();
    else if (b.requestFullscreen) b.requestFullscreen().catch(() => {});
  }
  function wake() { box.classList.remove('idle'); hideSoon(HIDE_MS); }
  function hideSoon(ms) { clearTimeout(hideT); hideT = setTimeout(() => { if (playing() && !dragging) box.classList.add('idle'); }, ms); }
  function sync() {
    if (!yt || !yt.getDuration) return;
    const d = yt.getDuration(), t = yt.getCurrentTime(), q = c => box.querySelector(c);
    if (!dragging) { q('.pc-seek').value = d ? Math.round(t / d * 1000) : 0; q('.pc-time').textContent = fmt(t) + ' / ' + fmt(d); }
    q('.pc-seek').style.setProperty('--p', (q('.pc-seek').value / 10) + '%');
    const on = playing();
    q('.pc-play').innerHTML = on ? ICON.pause : ICON.play;
    q('.pc-play').setAttribute('aria-label', on ? 'Pause' : 'Play');
    const muted = yt.isMuted() || yt.getVolume() === 0;
    q('.pc-mute').innerHTML = muted ? ICON.mute : ICON.vol;
    q('.pc-mute').setAttribute('aria-label', muted ? 'Unmute' : 'Mute');
    if (!muted) q('.pc-vol').value = yt.getVolume();
    if (!on) box.classList.remove('idle');
  }
  function fallback(id) {   // the normal YouTube player: for Shorts, or if the YouTube API can't load
    box.classList.add('native');
    stage.innerHTML = `<iframe src="https://www.youtube-nocookie.com/embed/${id}?autoplay=1&rel=0&playsinline=1" allow="autoplay; encrypted-media; picture-in-picture; fullscreen" allowfullscreen title="Video"></iframe>`;
  }
  function play(id, title, short) {
    if (!/^[\w-]{6,20}$/.test(id)) return;
    if (!box) build();
    lastFocus = document.activeElement;
    box.classList.toggle('vertical', !!short);
    box.classList.remove('native', 'idle');
    titleEl.textContent = title || 'wermyle';
    ytLink.href = short ? `https://www.youtube.com/shorts/${id}` : `https://www.youtube.com/watch?v=${id}`;
    stage.innerHTML = '<div></div>';
    box.hidden = false;
    document.body.classList.add('lock');
    box.querySelector('.player-x').focus();
    if (short) return fallback(id);   // Shorts use YouTube's own player and buttons
    loadApi().then(() => {
      if (box.hidden) return;
      yt = new YT.Player(stage.firstChild, {
        videoId: id,
        host: 'https://www.youtube-nocookie.com',
        playerVars: { autoplay: 1, controls: 0, rel: 0, playsinline: 1, modestbranding: 1, iv_load_policy: 3, disablekb: 1, fs: 0 },
        events: {
          onReady: () => { yt.playVideo(); sync(); wake(); },
          onStateChange: e => { sync(); if (e.data === 1) wake(); else box.classList.remove('idle'); }
        }
      });
      clearInterval(tick); tick = setInterval(sync, 250);
    }).catch(() => { if (!box.hidden) fallback(id); });
  }
  function close() {
    box.hidden = true;
    clearInterval(tick); clearTimeout(hideT);
    if (yt && yt.destroy) yt.destroy();
    yt = null; stage.innerHTML = '';           // stops the video
    if (!document.querySelector('.modal:not([hidden])')) document.body.classList.remove('lock');
    if (lastFocus) lastFocus.focus();
  }
  document.addEventListener('click', e => {
    const a = e.target.closest('a[data-video]');
    if (!a || e.ctrlKey || e.metaKey || e.shiftKey || e.button) return;   // ctrl/cmd-click still opens YouTube
    e.preventDefault();
    play(a.dataset.video, a.dataset.title, a.dataset.short === '1');
  });

  /* ---------- polls + notifications ----------
     The home page lists polls in #poll-list. Every page shows a small "New poll" note
     until you vote or close it. Polls are created on admin.html. */
  const SB_URL = 'https://jhktsfthhmgshvzwbjmn.supabase.co';
  const SB_KEY = 'sb_publishable_av74U9zcHh30VMarvBjZ-g_rasiFST_';   // publishable key, public by design
  const store = {
    get: k => { try { return localStorage.getItem(k); } catch (_) { return null; } },
    set: (k, v) => { try { localStorage.setItem(k, v); } catch (_) {} }
  };
  const esc = t => String(t == null ? '' : t).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  async function rpc(fn, args) {
    const r = await fetch(`${SB_URL}/rest/v1/rpc/${fn}`, {
      method: 'POST',
      headers: { apikey: SB_KEY, Authorization: 'Bearer ' + SB_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify(args || {})
    });
    const out = await r.json().catch(() => null);
    if (!r.ok) throw new Error((out && out.message) || 'Something went wrong, try again');
    return out;
  }
  // the same random browser key the chat uses
  function device() {
    let d = store.get('chat-device') || '';
    if (d.length < 16) {
      d = [...crypto.getRandomValues(new Uint8Array(16))].map(b => b.toString(16).padStart(2, '0')).join('');
      store.set('chat-device', d);
    }
    return d;
  }
  function timeLeft(iso) {
    const s = (new Date(iso) - Date.now()) / 1000;
    if (s < 3600) return Math.max(1, Math.round(s / 60)) + ' min left';
    if (s < 86400 * 2) return Math.round(s / 3600) + ' h left';
    return Math.round(s / 86400) + ' days left';
  }
  const BELL = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3a6 6 0 0 0-6 6v3.5L4.5 16h15L18 12.5V9a6 6 0 0 0-6-6zM9.5 18a2.5 2.5 0 0 0 5 0z"/></svg>';

  function pollCard(p, mine) {
    const total = p.counts.reduce((a, b) => a + b, 0), voted = mine != null, best = Math.max(...p.counts);
    const meta = total + (total === 1 ? ' vote' : ' votes') + (p.open && p.ends_at ? ' · ' + timeLeft(p.ends_at) : '');
    const opts = p.options.map((o, i) => {
      if (p.open && !voted) return `<button type="button" class="poll-opt" data-i="${i + 1}">${esc(o)}</button>`;
      const n = p.counts[i], pct = total ? Math.round(n / total * 100) : 0;
      const cls = (mine === i + 1 ? ' mine' : '') + (!p.open && n === best && n > 0 ? ' win' : '');
      return `<div class="poll-res${cls}" style="--w:${pct}%"><b>${esc(o)}${mine === i + 1 ? ' <i>your vote</i>' : ''}</b><span>${pct}%</span></div>`;
    }).join('');
    return `<article class="poll" data-id="${p.id}">
      <div class="poll-top"><span class="poll-tag${p.open ? ' open' : ''}">${p.open ? 'Open' : 'Closed'}</span><span class="poll-meta">${meta}</span></div>
      <h3>${esc(p.question)}</h3><div class="poll-opts">${opts}</div><p class="poll-err" role="status"></p></article>`;
  }

  const pushOk = 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
  const iOS = /iP(hone|ad|od)/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const standalone = matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
  const unb64 = s => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - s.length % 4) % 4)), c => c.charCodeAt(0));
  async function currentSub() {
    if (!pushOk) return null;
    const reg = await navigator.serviceWorker.getRegistration();
    return reg ? reg.pushManager.getSubscription() : null;
  }
  async function subscribe(key) {
    const reg = await navigator.serviceWorker.register('sw.js');
    await navigator.serviceWorker.ready;
    if (await Notification.requestPermission() !== 'granted') throw new Error('Notifications are blocked. Allow them for this site in your browser settings.');
    const old = await reg.pushManager.getSubscription();
    if (old) await old.unsubscribe();
    const sub = (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: unb64(key) })).toJSON();
    await rpc('push_subscribe', { p_endpoint: sub.endpoint, p_p256dh: sub.keys.p256dh, p_auth: sub.keys.auth });
  }
  async function unsubscribe() {
    const s = await currentSub();
    if (!s) return;
    await rpc('push_unsubscribe', { p_endpoint: s.endpoint }).catch(() => {});
    await s.unsubscribe();
  }

  async function notifyButton(btn, note) {
    const key = await rpc('push_public_key').catch(() => null);
    if (!key) return;                                   // not turned on in the admin page yet
    btn.hidden = false;
    if (!pushOk && !iOS) { btn.disabled = true; note.textContent = "This browser can't show notifications."; return; }
    let on = !!(await currentSub().catch(() => null)) && Notification.permission === 'granted';
    const draw = () => {
      btn.innerHTML = BELL + (on ? 'Notifications on' : 'Notify me about new polls');
      btn.classList.toggle('on', on);
      btn.setAttribute('aria-pressed', on);
      note.textContent = on ? "You'll get a notification when a new poll starts. Click again to turn it off." : '';
    };
    draw();
    btn.addEventListener('click', async () => {
      if (iOS && !standalone) { note.textContent = 'On iPhone and iPad: tap Share, then "Add to Home Screen", open the site from your home screen and tap this button there.'; return; }
      btn.disabled = true;
      try { on ? await unsubscribe() : await subscribe(key); on = !on; draw(); }
      catch (e) { note.textContent = e.message || 'Could not turn on notifications'; }
      btn.disabled = false;
    });
  }

  async function polls() {
    const list = document.getElementById('poll-list');
    let rows, mine;
    try { [rows, mine] = await Promise.all([rpc('poll_list'), rpc('poll_mine', { p_device: device() })]); }
    catch (_) { if (list) list.innerHTML = '<p class="poll-empty">Polls could not load. Try refreshing the page.</p>'; return; }
    const fresh = rows.find(p => p.open && mine[p.id] == null);

    // a dot in the menu and a small note in the corner while there is a poll you haven't answered
    const navLink = document.querySelector('.top nav a[href$="#polls"]');
    if (navLink) navLink.classList.toggle('has-dot', !!fresh);
    if (fresh && store.get('poll-dismissed') !== String(fresh.id) && !document.body.hasAttribute('data-no-toast')) {
      const t = document.createElement('div');
      t.className = 'poll-toast';
      t.setAttribute('role', 'status');
      t.innerHTML = `<span class="pt-ico">${BELL}</span><div><b>New poll</b><span>${esc(fresh.question)}</span></div>` +
        `<a class="btn" href="${list ? '#polls' : './#polls'}">Vote</a><button type="button" aria-label="Close">×</button>`;
      const hide = () => { store.set('poll-dismissed', fresh.id); t.classList.add('out'); setTimeout(() => t.remove(), 300); };
      t.querySelector('button').addEventListener('click', hide);
      t.querySelector('a').addEventListener('click', hide);
      document.body.appendChild(t);
    }

    if (!list) return;
    const draw = () => {
      list.innerHTML = rows.length ? rows.map(p => pollCard(p, mine[p.id])).join('')
        : '<p class="poll-empty">No polls yet. Turn on notifications to know when the first one starts.</p>';
    };
    draw();
    list.addEventListener('click', async e => {
      const b = e.target.closest('.poll-opt');
      if (!b) return;
      const card = b.closest('.poll'), id = +card.dataset.id;
      card.querySelectorAll('.poll-opt').forEach(x => x.disabled = true);
      try {
        const row = await rpc('poll_vote', { p_poll: id, p_choice: +b.dataset.i, p_device: device() });
        rows = rows.map(p => p.id === id ? row : p);
        mine[id] = +b.dataset.i;
        draw();
        if (navLink && !rows.some(p => p.open && mine[p.id] == null)) navLink.classList.remove('has-dot');
        const t = document.querySelector('.poll-toast');
        if (t && !rows.some(p => p.open && mine[p.id] == null)) t.remove();
      } catch (err) {
        card.querySelector('.poll-err').textContent = err.message;
        card.querySelectorAll('.poll-opt').forEach(x => x.disabled = false);
      }
    });
    const btn = document.getElementById('poll-notify');
    if (btn) notifyButton(btn, document.getElementById('poll-note'));
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', polls); else polls();

  return { reveal, play, rpc };
})();
