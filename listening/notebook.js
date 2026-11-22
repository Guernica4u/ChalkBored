// Chalk Music's part of Notebook: a plain fade when the Music tab opens, and a small
// player above the version number on the other tabs (not Home, which has its own).
// It works the player that lives in the Music tab, the way Home's music box does.
(() => {
  'use strict';
  const css = document.createElement('style');
  css.textContent = `
  #panel-music.active { animation: cm-in 0.18s ease-out; }
  @keyframes cm-in { from { opacity: 0; } }
  .cm-mini { position: fixed; left: 1.2rem; bottom: 2.2rem; z-index: 21; display: flex; align-items: center; gap: 6px; width: 190px; padding: 6px;
    border-radius: 10px; border: 1px solid var(--edge, #333); background: var(--card, #1a1a1a); color: var(--ink, #eee); box-shadow: 0 6px 18px rgba(0, 0, 0, 0.25); font-size: 0.8rem; }
  .cm-mini[hidden] { display: none; }
  .cm-mini .cm-open { flex: 1; min-width: 0; display: flex; align-items: center; gap: 8px; padding: 0; border: 0; background: none; color: inherit; font: inherit; text-align: left; cursor: pointer; }
  .cm-mini .cm-pic { flex: none; width: 36px; height: 36px; border-radius: 6px; background: var(--paper-2, #222) center/cover; }
  .cm-mini .cm-t { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .cm-mini .cm-b { flex: none; width: 30px; height: 30px; display: flex; align-items: center; justify-content: center; padding: 0; border: 0; border-radius: 50%; background: none; color: inherit; cursor: pointer; }
  .cm-mini .cm-b:hover { background: var(--paper-2, #222); }
  .cm-mini svg { width: 14px; height: 14px; fill: currentColor; }
  @media (prefers-reduced-motion: reduce) { #panel-music.active { animation: none; } }`;
  document.head.appendChild(css);

  const PLAY = '<svg viewBox="0 0 16 16"><path d="M5 3l8 5-8 5z"/></svg>';
  const PAUSE = '<svg viewBox="0 0 16 16"><path d="M4 3h3v10H4zM9 3h3v10H9z"/></svg>';
  const box = document.createElement('div');
  box.className = 'cm-mini';
  box.hidden = true;
  box.innerHTML = '<button class="cm-open" type="button" title="Open Chalk Music"><span class="cm-pic"></span><span class="cm-t"></span></button>' +
    '<button class="cm-b cm-play" type="button" title="Play or pause"></button>' +
    '<button class="cm-b cm-next" type="button" title="Next"><svg viewBox="0 0 16 16"><path d="M3 3l7 5-7 5zM11 3h2v10h-2z"/></svg></button>';
  document.body.appendChild(box);
  const [open, play, next] = box.querySelectorAll('button');

  const player = () => {
    try { const f = document.querySelector('#panel-music iframe'), d = f && f.contentDocument; return d && d.getElementById('play') ? d : null; } catch (e) { return null; }
  };
  open.onclick = () => { const b = document.querySelector('.nav-btn[data-panel="music"]'); if (b) b.click(); };
  play.onclick = () => { const d = player(); if (d) d.getElementById('play').click(); update(); };
  next.onclick = () => { const d = player(); if (d) d.getElementById('next').click(); setTimeout(update, 400); };

  let shown = '';
  function update() {
    const d = player();
    const onMusic = document.querySelector('#panel-music.active');
    const title = d && d.getElementById('title') ? d.getElementById('title').textContent : '';
    const off = !d || onMusic || document.body.classList.contains('on-home') || !title || title === 'Nothing playing';
    box.hidden = !!off;
    if (off) return;
    const playing = d.body.classList.contains('playing');
    const key = title + '|' + playing;
    if (key !== shown) {
      shown = key;
      box.querySelector('.cm-t').textContent = title;
      box.querySelector('.cm-pic').style.backgroundImage = d.getElementById('art').style.backgroundImage || '';
      play.innerHTML = playing ? PAUSE : PLAY;
    }
    // sits right above the version number, wherever the theme puts it
    const ver = document.querySelector('.ver-corner');
    const r = ver && ver.getBoundingClientRect();
    if (r && r.width) { box.style.left = r.left + 'px'; box.style.bottom = (innerHeight - r.top + 8) + 'px'; }
    else { box.style.left = ''; box.style.bottom = '0.7rem'; }
  }
  setInterval(update, 1000);
  window.addEventListener('chalk-home', () => setTimeout(update, 0));
})();
