// The new Home: featured activities, recently opened, Chalk Music, the vote, and notes.
// Kept in its own file so each Study Hall page stays small. Runs after the page's own script
// and uses its helpers (settings, LIST, ART, launch, showPanel, namePicture...).
(() => {
  const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text !== undefined) e.textContent = text; return e; };
  const read = (key, fallback) => { try { const v = JSON.parse(localStorage.getItem(key) || 'null'); return v === null ? fallback : v; } catch (e) { return fallback; } };
  const write = (key, value) => { try { localStorage.setItem(key, JSON.stringify(value)); } catch (e) {} };
  const byPath = (p) => LIST.lessons.find((x) => x.path === p);
  // names are drawn as pictures, like everywhere else on the page
  const nameOf = (item, size) => (coded(item) ? namePicture(shown(item), size) : document.createTextNode(item.name));
  const words = (text, size) => (text ? namePicture(text, size) : document.createTextNode(''));
  const artOf = (item) => (item.img ? { src: item.img } : ART[item.path]);
  function cover(item, cls) {
    const box = el('span', cls);
    const art = artOf(item);
    if (!art) { box.append(el('span', 'hn-initials', initials(shown(item)))); return box; }
    const img = new Image();
    img.alt = '';
    img.decoding = 'async';
    img.src = art.src;
    if (art.fit) img.style.objectFit = art.fit;
    if (art.pos) img.style.objectPosition = art.pos;
    if (art.bg) box.style.background = art.bg;
    img.addEventListener('error', () => { img.remove(); box.append(el('span', 'hn-initials', initials(shown(item)))); });
    box.append(img);
    return box;
  }

  // ---- settings: new people get the new Home; anyone can switch in Settings or setup ----
  const SECTIONS = { featured: 'Featured', recent: 'Recently opened', music: 'Chalk Music', vote: 'Vote', chat: 'Chat preview', notes: 'Notes and to do' };
  if (settings.homeLook !== 'new' && settings.homeLook !== 'classic') settings.homeLook = 'new';
  if (!Array.isArray(settings.homeOrder)) settings.homeOrder = ['featured', 'recent', 'music', 'vote', 'chat'];
  // people who set up Home before these existed get them once (they can remove them)
  if (!settings.homeOnlineAdded) { settings.homeOnlineAdded = true; ['online', 'chat'].forEach((k) => { if (!settings.homeOrder.includes(k)) settings.homeOrder.push(k); }); }
  settings.homeOrder = settings.homeOrder.filter((k, i, a) => SECTIONS[k] && a.indexOf(k) === i);
  saveSettings();

  const css = document.createElement('style');
  css.textContent = `
  body.home-new.on-home .brand { opacity: 0; transform: translateY(-6px); pointer-events: none; }
  .brand { transition: opacity .28s ease, transform .28s cubic-bezier(.22,1,.36,1); }
  .rail-top, .rail-search { transition: padding .28s cubic-bezier(.22,1,.36,1); }
  body.home-new.on-home .rail-top { padding-bottom: .25rem; }
  body.home-new.on-home .rail-search { padding-bottom: 0; }
  .hn, .hn-edit-bar, .hn-tray { display: none; }
  body.home-new #panel-home.active { display: flex; flex-direction: column; justify-content: center; width: 100%; max-width: 1120px; min-height: calc(100vh - 6.4rem); margin: 0 auto; }
  body.home-new .hn { display: grid; }
  body.home-new .hn-edit-bar:not([hidden]), body.home-new .hn-tray:not([hidden]) { display: flex; }
  body.home-new .home-hero { flex-direction: row; flex-wrap: wrap; align-items: center; justify-content: flex-start; gap: .5rem 1.3rem; padding: 0 0 1rem; text-align: left; }
  body.home-new .home-title { font-size: clamp(2.2rem, 4vw, 2.9rem); }
  body.home-new #hero-search-slot { flex: 1 1 340px; max-width: 460px; margin-left: auto; order: 3; }
  body.home-new .hello-meta { order: 2; justify-content: flex-start; font-size: .95rem; }
  body.home-new .home-hero .search-wrap { width: 100%; }
  body.home-new .home-hero .search, body.home-new .home-hero .search:focus { padding: 1rem 1.1rem 1rem 2.8rem; font-size: 1.08rem; }
  /* name | what's happening (wraps in its own column) | search, all on one row */
  @media (min-width: 901px) {
    body.home-new .home-hero { display: grid; grid-template-columns: auto minmax(0, 1fr) minmax(250px, 400px); }
    body.home-new #hero-search-slot { max-width: none; margin-left: 0; }
  }
  .hn { grid-template-columns: repeat(6, minmax(0, 1fr)); grid-auto-flow: dense; gap: .9rem; font-size: 1.04rem; }
  .hn-sec { display: flex; flex-direction: column; min-width: 0; }
  .hn-sec > .hn-panel { flex: 1; }
  .hn-sec[data-key="featured"] { grid-column: span 4; }
  .hn-sec[data-key="recent"] { grid-column: span 2; }
  .hn-sec[data-key="music"], .hn-sec[data-key="vote"] { grid-column: span 3; }
  .hn-sec[data-key="chat"] { grid-column: span 6; }
  .hn-sec[data-key="notes"] { grid-column: 1 / -1; }
  .hn-panel { min-width: 0; padding: 1.05rem 1.15rem; background: var(--card); border: 1px solid var(--edge); border-radius: var(--r); }
  .hn-label { display: flex; align-items: center; justify-content: space-between; gap: .6rem; margin: 0 0 .7rem; font-size: .86rem; font-weight: 700; color: var(--pencil); }
  .hn-muted { color: var(--pencil); font-size: .92rem; }
  .hn-btn { padding: .55rem 1.05rem; background: transparent; border: 1px solid var(--edge); border-radius: var(--r); color: var(--ink); font: inherit; cursor: pointer; white-space: nowrap; }
  .hn-btn:hover { border-color: var(--ink); }
  .hn-btn.primary { background: var(--ink); border-color: var(--ink); color: var(--paper); font-weight: 700; }
  .hn-initials { display: grid; place-items: center; width: 100%; height: 100%; font-weight: 700; color: var(--pencil); }
  .hn-feature { display: grid; grid-template-columns: minmax(0, 1.45fr) minmax(0, 1fr); padding: 0; overflow: hidden; }
  .hn-feature-art { display: block; aspect-ratio: 16 / 10; background: var(--paper-2); border-right: 1px solid var(--edge); overflow: hidden; }
  .hn-cover { display: block; width: 100%; height: 100%; }
  .hn-feature-art img { display: block; width: 100%; height: 100%; object-fit: cover; }
  .hn-feature-text { display: flex; flex-direction: column; gap: .5rem; min-width: 0; padding: 1.1rem; }
  .hn-feature-name { min-height: 1.6em; font-size: 1.45rem; font-weight: 700; line-height: 1.2; overflow-wrap: anywhere; }
  .hn-feature-actions { display: flex; align-items: center; gap: .45rem; margin-top: auto; }
  .hn-pager { display: flex; align-items: center; gap: .3rem; margin-left: auto; }
  .hn-pager button { width: 32px; height: 30px; padding: 0; background: var(--paper-2); border: 1px solid var(--edge); border-radius: var(--r); color: var(--ink); cursor: pointer; }
  .hn-pager button:hover { border-color: var(--ink); }
  .hn-rows { display: flex; flex-direction: column; gap: .15rem; }
  .hn-row { display: grid; grid-template-columns: 50px minmax(0, 1fr); align-items: center; gap: .65rem; width: 100%; padding: .25rem; background: none; border: 1px solid transparent; border-radius: var(--r); color: var(--ink); font: inherit; text-align: left; cursor: pointer; }
  .hn-row:hover { background: var(--paper-2); border-color: var(--edge); }
  .hn-row-art { display: block; width: 50px; height: 31px; background: var(--paper-2); overflow: hidden; }
  .hn-row-art img { display: block; width: 100%; height: 100%; object-fit: cover; }
  .hn-row-name { min-width: 0; font-weight: 700; overflow: hidden; white-space: nowrap; }
  .hn-track { display: flex; align-items: center; gap: .8rem; min-width: 0; }
  .hn-disc { flex: none; display: grid; place-items: center; width: 58px; height: 58px; background: var(--paper-2) center / cover; border: 1px solid var(--edge); border-radius: var(--r); color: var(--pencil); font-size: 1.4rem; }
  .hn-song { min-width: 0; overflow: hidden; }
  .hn-song-title { font-weight: 700; white-space: nowrap; }
  .hn-song-sub { color: var(--pencil); font-size: .9rem; white-space: nowrap; }
  .hn-controls { display: flex; align-items: center; gap: .45rem; margin-top: .85rem; }
  .hn-bar { flex: 1; height: 4px; margin-left: .4rem; background: var(--paper-2); overflow: hidden; }
  .hn-bar i { display: block; height: 100%; width: 0; background: var(--ink); transition: width .4s linear; }
  .hn-vote { position: relative; display: flex; align-items: center; justify-content: space-between; gap: .6rem; width: 100%; margin-bottom: .4rem; padding: .55rem .7rem; background: var(--paper-2); border: 1px solid transparent; border-radius: var(--r); color: var(--ink); font: inherit; text-align: left; cursor: pointer; overflow: hidden; }
  .hn-vote:hover { border-color: var(--pencil); }
  .hn-online { display: none; }
  body.home-new .hn-online { display: inline-flex; flex-wrap: wrap; align-items: center; gap: .3rem 1rem; }
  .hn-online-nums:empty, .hn-online-top:empty { display: none; }
  .hn-online-top, .hn-ask { display: inline-flex; flex-wrap: wrap; align-items: center; gap: .35rem; }
  .hn-online > *, .hn-ask > * { white-space: nowrap; }
  .hn-mini { display: block; width: 26px; height: 26px; padding: 0; overflow: hidden; background: var(--paper-2); border: 1px solid var(--edge); border-radius: var(--r); cursor: pointer; }
  .hn-mini:hover, .hn-mini:focus-visible { border-color: var(--ink); outline: none; }
  .hn-mini-art, .hn-mini-art img { display: block; width: 100%; height: 100%; object-fit: cover; }
  .hn-mini-art .hn-initials { display: grid; place-items: center; height: 100%; font-size: .6rem; }
  .hn-tiny { padding: .12rem .5rem; background: var(--ink); border: 1px solid var(--ink); border-radius: var(--r); color: var(--paper); font: inherit; font-size: .8rem; cursor: pointer; }
  .hn-tiny.ghost { background: none; color: var(--ink); border-color: var(--edge); }
  .hn-btn { padding: .4rem .8rem; background: var(--ink); border: 1px solid var(--ink); border-radius: var(--r); color: var(--paper); font: inherit; cursor: pointer; }
  .hn-btn.ghost { background: none; color: var(--ink); border-color: var(--edge); }
  .hn-btn:hover, .hn-btn:focus-visible { border-color: var(--pencil); outline: none; }
  .hn-link { padding: 0; background: none; border: 0; color: var(--pencil); font: inherit; font-size: .8rem; text-decoration: underline; cursor: pointer; }
  .hn-chat-pick { position: relative; min-width: 0; font-size: .78rem; font-weight: 400; }
  .hn-chat-pick summary { max-width: 22ch; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; cursor: pointer; }
  .hn-chat-pick summary:hover { color: var(--ink); }
  .hn-chat-pick-row { position: absolute; right: 0; top: calc(100% + .3rem); z-index: 5; display: flex; gap: .3rem; padding: .35rem; background: var(--card); border: 1px solid var(--edge); border-radius: var(--r); }
  .hn-chat-pick select { width: 9.5rem; min-width: 0; padding: .2rem .35rem; font-size: .8rem; background: var(--paper-2); border: 1px solid var(--edge); border-radius: var(--r); color: var(--ink); font: inherit; }
  .hn-chat { display: flex; flex-direction: column; gap: .3rem; margin-bottom: .6rem; }
  .hn-chat-row { margin: 0; font-size: .85rem; line-height: 1.4; overflow-wrap: anywhere; }
  .hn-chat-row b { font-weight: 600; }
  .hn-vote.mine { border-color: var(--ink); }
  .hn-vote i { position: absolute; inset: 0 auto 0 0; background: var(--highlight); opacity: .6; transition: width .35s ease; }
  .hn-vote span { position: relative; min-width: 0; overflow: hidden; white-space: nowrap; }
  .hn-vote b { position: relative; flex: none; font-variant-numeric: tabular-nums; }
  .hn-pair { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: .9rem; }
  .hn-pair textarea { display: block; width: 100%; min-height: 130px; padding: .6rem .7rem; background: var(--paper-2); border: 1px solid var(--edge); border-radius: var(--r); color: var(--ink); font: inherit; resize: vertical; }
  .hn-todo li { display: flex; align-items: center; gap: .55rem; padding: .2rem 0; }
  .hn-todo input { width: 16px; height: 16px; margin: 0; }
  .hn-todo .done { color: var(--pencil); text-decoration: line-through; }
  .hn-todo { margin: 0; padding: 0; list-style: none; }
  .hn-todo-add { display: flex; gap: .4rem; margin-top: .6rem; }
  .hn-todo-add input { flex: 1; min-width: 0; padding: .45rem .6rem; background: var(--paper-2); border: 1px solid var(--edge); border-radius: var(--r); color: var(--ink); font: inherit; }
  .hn-sec-bar { display: none; align-items: center; justify-content: space-between; gap: .6rem; margin-bottom: .4rem; padding: .3rem .55rem; border: 1px dashed var(--pencil); border-radius: var(--r); font-size: .86rem; font-weight: 700; }
  .hn.editing .hn-sec-bar { display: flex; }
  .hn-sec-bar span:last-child { display: flex; gap: .2rem; }
  .hn-sec-bar button { width: 30px; height: 26px; padding: 0; background: var(--paper-2); border: 1px solid var(--edge); border-radius: var(--r); color: var(--ink); cursor: pointer; }
  .hn-sec-bar button:disabled { opacity: .35; cursor: default; }
  .hn-edit-bar { align-items: center; justify-content: space-between; gap: 1rem; margin-bottom: .9rem; padding: .7rem 1rem; background: var(--card); border: 1px solid var(--ink); border-radius: var(--r); }
  .hn-tray { flex-direction: column; gap: .6rem; margin-top: .9rem; padding: .9rem 1rem; background: var(--card); border: 1px dashed var(--pencil); border-radius: var(--r); }
  .hn-tray-row { display: flex; flex-wrap: wrap; gap: .5rem; }
  .home-look-pick { display: flex; flex-direction: column; gap: .5rem; }
  @media (max-width: 1100px) {
    .hn-sec[data-key] { grid-column: 1 / -1; }
  }
  @media (max-width: 760px) {
    body.home-new .ver-corner { padding: .15rem .45rem; background: var(--card); border-radius: var(--r); }
    body.home-new #panel-home.active { min-height: 0; padding-bottom: 2rem; }
    body.home-new #hero-search-slot { flex-basis: 100%; max-width: none; margin-left: 0; }
    .hn-feature { grid-template-columns: minmax(0, 1fr); }
    .hn-feature-art { border-right: 0; border-bottom: 1px solid var(--edge); }
    .hn-pair { grid-template-columns: minmax(0, 1fr); }
  }`;
  document.head.append(css);

  // ---- the page parts ----
  const homePanel = $('panel-home');
  const editBar = el('div', 'hn-edit-bar');
  editBar.hidden = true;
  const editText = el('div');
  editText.append(el('b', '', 'Editing Home'), el('p', 'hn-muted', 'Move, remove or add sections.'));
  editText.lastChild.style.margin = '0';
  const editDone = el('button', 'hn-btn primary', 'Done');
  editDone.type = 'button';
  editBar.append(editText, editDone);
  const grid = el('div', 'hn');
  const tray = el('div', 'hn-tray');
  tray.hidden = true;
  const trayRow = el('div', 'hn-tray-row');
  tray.append(el('p', 'hn-label', 'Add to Home'), trayRow);
  homePanel.prepend(editBar);
  homePanel.append(grid, tray);

  const secs = {};
  function section(key, panel) {
    const sec = el('section', 'hn-sec');
    sec.dataset.key = key;
    const bar = el('div', 'hn-sec-bar');
    const tools = el('span');
    [['↑', 'earlier', -1], ['↓', 'later', 1], ['×', '', 0]].forEach(([s, word, dir]) => {
      const b = el('button', '', s);
      b.type = 'button';
      b.dataset.dir = dir;
      b.setAttribute('aria-label', dir ? 'Move ' + SECTIONS[key] + ' ' + word : 'Remove ' + SECTIONS[key]);
      b.addEventListener('click', () => arrange(key, dir));
      tools.append(b);
    });
    bar.append(el('span', '', SECTIONS[key]), tools);
    sec.append(bar, panel);
    secs[key] = sec;
  }

  // ---- featured: a few hand-picked activities ----
  const FEATURED = ['LESSONS/Climb-Physics/index.html', 'LESSONS/Story-Yellow/index.html', 'LESSONS/Ragdoll-Sandbox/index.html', 'LESSONS/Class-Day-1/index.html'].map(byPath).filter(Boolean);
  {
    const panel = el('article', 'hn-panel hn-feature');
    const art = el('span', 'hn-feature-art');
    const text = el('div', 'hn-feature-text');
    const name = el('div', 'hn-feature-name');
    const play = el('button', 'hn-btn primary', 'Open');
    play.type = 'button';
    play.id = 'hn-play';
    const pager = el('span', 'hn-pager');
    const prev = el('button', '', '←');
    const next = el('button', '', '→');
    prev.type = next.type = 'button';
    prev.setAttribute('aria-label', 'Previous featured activity');
    next.setAttribute('aria-label', 'Next featured activity');
    const count = el('span', 'hn-muted');
    pager.append(prev, next);
    const actions = el('div', 'hn-feature-actions');
    actions.append(play, pager);
    text.append(el('p', 'hn-label', 'New this week'), name, count, actions);
    panel.append(art, text);
    let at = 0;
    const paint = () => {
      const item = FEATURED[at];
      if (!item) return;
      art.replaceChildren(cover(item, 'hn-cover'));
      name.replaceChildren(nameOf(item, 1.25));
      count.textContent = (at + 1) + ' of ' + FEATURED.length;
    };
    prev.addEventListener('click', () => { at = (at + FEATURED.length - 1) % FEATURED.length; paint(); });
    next.addEventListener('click', () => { at = (at + 1) % FEATURED.length; paint(); });
    play.addEventListener('click', () => { if (FEATURED[at]) launch(FEATURED[at]); });
    paint();
    section('featured', panel);
  }

  let lastLaunch = null;   // what this page last opened, for the online stats

  // ---- recently opened: kept in this browser ----
  const RECENT = 'cb-recent';
  const recentPanel = el('section', 'hn-panel');
  function paintRecent() {
    const opened = read(RECENT, []).map(byPath).filter(Boolean);
    const list = opened.length ? opened : favs.map(byPath).filter(Boolean);
    const rows = el('div', 'hn-rows');
    list.slice(0, 5).forEach((item) => {
      const b = el('button', 'hn-row');
      b.type = 'button';
      const n = el('span', 'hn-row-name');
      n.append(nameOf(item, 1.1));
      b.append(cover(item, 'hn-row-art'), n);
      b.addEventListener('click', () => launch(item));
      rows.append(b);
    });
    const body = [el('p', 'hn-label', opened.length ? 'Recently opened' : list.length ? 'Your favorites' : 'Recently opened')];
    if (list.length) body.push(rows);
    else {
      const go = el('button', 'hn-btn', 'Browse activities');
      go.type = 'button';
      go.addEventListener('click', () => showPanel('games'));
      body.push(el('p', 'hn-muted', 'What you open shows up here.'), go);
    }
    recentPanel.replaceChildren(...body);
  }
  // every way of opening an activity goes through launch()
  const openActivity = launch;
  window.launch = function (item, mode) {
    if (item && item.path) write(RECENT, [item.path, ...read(RECENT, []).filter((p) => p !== item.path)].slice(0, 12));
    if (item && item.path) lastLaunch = { path: item.path, at: Date.now() };
    paintRecent();
    return openActivity(item, mode);
  };
  paintRecent();
  section('recent', recentPanel);

  // ---- Chalk Music: works the player that lives in the Music tab ----
  {
    const panel = el('section', 'hn-panel');
    const disc = el('span', 'hn-disc', '♫');
    const song = el('div', 'hn-song');
    const title = el('div', 'hn-song-title');
    const sub = el('div', 'hn-song-sub');
    song.append(title, sub);
    const track = el('div', 'hn-track');
    track.append(disc, song);
    const play = el('button', 'hn-btn primary', 'Play');
    const next = el('button', 'hn-btn', 'Next');
    const open = el('button', 'hn-btn', 'Open');
    play.type = next.type = open.type = 'button';
    play.id = 'hn-music-play';
    next.id = 'hn-music-next';
    const bar = el('div', 'hn-bar');
    const fill = el('i');
    bar.append(fill);
    const controls = el('div', 'hn-controls');
    controls.append(play, next, bar, open);
    panel.append(el('p', 'hn-label', 'Chalk Music'), track, controls);

    const playerDoc = () => { try { const d = musicFrame && musicFrame.contentDocument; return d && d.getElementById('play') ? d : null; } catch (e) { return null; } };
    function ensurePlayer() {
      if (!musicFrame) {
        musicFrame = document.createElement('iframe');
        musicFrame.className = 'frame blend';
        musicFrame.title = 'Chalk Music';
        musicFrame.src = 'listening.html';
        musicFrame.setAttribute('allow', 'autoplay; encrypted-media; display-capture');
        $('panel-music').appendChild(musicFrame);
      }
      return new Promise((resolve) => {
        let tries = 0;
        const wait = () => { const d = playerDoc(); if (d || ++tries > 50) resolve(d); else setTimeout(wait, 200); };
        wait();
      });
    }
    let shownTitle = null;
    function paint() {
      const d = playerDoc();
      let t = '', s = '', playing = false, pos = 0;
      if (d) {
        t = d.getElementById('title').textContent;
        s = d.getElementById('sub').textContent;
        playing = d.body.classList.contains('playing');
        const seek = d.getElementById('seek');
        pos = seek ? Number(seek.value) / 10 : 0;
        if (t === 'Nothing playing') t = '';
      } else {
        // not loaded yet: show the last song from Chalk Music's own save
        const saved = read('listening.v1', {});
        const now = saved && saved.now && saved.songs && saved.songs[saved.now.id];
        if (now) { t = now.title || ''; s = now.author || ''; }
      }
      if (t !== shownTitle) {
        shownTitle = t;
        title.replaceChildren(t ? words(t, 1.15) : document.createTextNode('Nothing playing yet'));
        sub.replaceChildren(t ? words(s, 1) : document.createTextNode('Pick songs in Chalk Music'));
      }
      play.textContent = playing ? 'Pause' : 'Play';
      fill.style.width = pos + '%';
    }
    play.addEventListener('click', async () => { const d = await ensurePlayer(); if (d) d.getElementById('play').click(); setTimeout(paint, 300); });
    next.addEventListener('click', async () => { const d = await ensurePlayer(); if (d) d.getElementById('next').click(); setTimeout(paint, 300); });
    open.addEventListener('click', () => showPanel('music'));
    setInterval(() => { if (document.body.classList.contains('on-home') && document.body.classList.contains('home-new') && !document.hidden) paint(); }, 1000);
    paint();
    section('music', panel);
  }

  // ---- the vote: the newest poll in Chalk Chat's Global polls channel ----
  {
    const panel = el('section', 'hn-panel');
    const head = el('p', 'hn-label');
    const total = el('span');
    const title = el('span', '', 'Vote');
    head.append(title, total);
    const question = el('p', 'hn-muted');
    question.style.margin = '0 0 .4rem';
    const box = el('div');
    const note = el('p', 'hn-muted');
    note.style.margin = '.2rem 0 0';
    panel.append(head, question, box, note);
    let busy = false;
    async function load() {
      try {
        const db = await loadOnline();
        const [{ data, error }, { data: who }] = await Promise.all([db.rpc('latest_poll'), db.auth.getUser()]);
        if (error) throw error;
        draw(data && data[0], !!(who && who.user));
      } catch (e) {
        box.replaceChildren();
        total.textContent = '';
        note.textContent = 'Voting isn’t available right now.';
      }
    }
    function draw(poll, signedIn) {
      question.replaceChildren();
      if (!poll) { box.replaceChildren(); total.textContent = ''; note.textContent = 'Nothing to vote on right now.'; return; }
      question.append(words(poll.question, 1.05));
      const sum = poll.counts.reduce((n, c) => n + c, 0);
      total.textContent = sum ? sum + (sum === 1 ? ' vote' : ' votes') : '';
      note.textContent = !signedIn ? 'Sign in to Chalk Chat to vote.' : poll.mine !== null ? 'Tap your pick again to take your vote back.' : 'One vote per account.';
      box.replaceChildren(...poll.options.map((option, i) => {
        const b = el('button', 'hn-vote' + (poll.mine === i ? ' mine' : ''));
        b.type = 'button';
        b.disabled = !signedIn;
        b.setAttribute('aria-pressed', String(poll.mine === i));
        const fill = el('i');
        fill.style.width = (sum ? Math.round(poll.counts[i] / sum * 100) : 0) + '%';
        const label = el('span');
        label.append(words(option, 1.05));
        b.append(fill, label, el('b', '', String(poll.counts[i])));
        b.addEventListener('click', async () => {
          if (busy) return;
          busy = true;
          try {
            const db = await loadOnline();
            const { data, error } = await db.rpc('vote_poll', { p_message: poll.message_id, p_choice: i });
            if (error || data) note.textContent = data || 'That didn’t work. Try again.';
            else await load();
          } catch (e) { note.textContent = 'That didn’t work. Try again.'; }
          busy = false;
        });
        return b;
      }));
    }
    let loaded = false;
    window.addEventListener('chalk-home', (e) => { if (e.detail && settings.homeLook === 'new' && !loaded) { loaded = true; load(); } });
    section('vote', panel);
    secs.vote.load = () => { if (!loaded) { loaded = true; load(); } };
  }

  // ---- online now: counts, the most played, and asking before sharing ----
  // Nothing about what you play or hear leaves this browser until you press Sure.
  const SHARE = 'cb-share-activity';   // 'yes' | 'no' | missing (not asked yet)
  let device = '';
  try { device = localStorage.getItem('chalk-device') || ''; if (!device) { device = crypto.randomUUID(); localStorage.setItem('chalk-device', device); } } catch (e) {}
  function doingNow() {
    if (read(SHARE, '') !== 'yes') return [null, null];
    const viewer = document.getElementById('viewer');
    // shortcut: a game opened in its own tab counts as played for 20 minutes, since this page can't see that tab
    if (lastLaunch && ((viewer && !viewer.hidden) || Date.now() - lastLaunch.at < 20 * 60 * 1000)) return ['play', lastLaunch.path];
    try {
      const music = document.querySelector('#panel-music iframe');
      if (music && music.contentDocument && music.contentDocument.body.classList.contains('playing')) return ['listen', null];
    } catch (e) {}
    return [null, null];
  }
  async function checkIn() {
    if (!device) return;
    try {
      const db = await loadOnline();
      const [doing, item] = doingNow();
      await db.rpc('here_now', { p_device: device, p_doing: doing, p_item: item });
    } catch (e) {}
  }
  checkIn();
  setInterval(checkIn, 30000);

  // the numbers sit next to the ChalkBored title, after "online now"
  let startOnline = () => {};
  {
    const strip = el('span', 'hn-online');
    const nums = el('span', 'hn-online-nums');
    const top = el('span', 'hn-online-top');
    const ask = el('span', 'hn-ask');
    strip.append(nums, top, ask);
    const meta = document.querySelector('#panel-home .hello-meta');
    if (meta) meta.append(strip);
    const tiny = (text, ghost) => { const b = el('button', 'hn-tiny' + (ghost ? ' ghost' : ''), text); b.type = 'button'; return b; };
    function paintAsk() {
      const choice = read(SHARE, '');
      ask.replaceChildren();
      if (choice === 'yes' || choice === 'no') {
        const change = el('button', 'hn-link', choice === 'yes' ? 'Stop sharing' : 'Share what I play');
        change.type = 'button';
        change.addEventListener('click', () => { write(SHARE, choice === 'yes' ? 'no' : 'yes'); paintAsk(); checkIn(); });
        ask.append(change);
        return;
      }
      const yes = tiny('Sure');
      const no = tiny('No I have W opsec', true);
      yes.addEventListener('click', () => { write(SHARE, 'yes'); paintAsk(); checkIn(); });
      no.addEventListener('click', () => { write(SHARE, 'no'); paintAsk(); });
      ask.append(el('span', '', 'Share what you play? No names.'), yes, no);
    }
    async function load() {
      try {
        const db = await loadOnline();
        const { data, error } = await db.rpc('online_stats');
        if (error) throw error;
        const st = data && data[0];
        nums.textContent = st.playing + ' playing · ' + st.listening + ' listening';
        const items = (st.top || []).map((t) => byPath(t.item)).filter(Boolean).slice(0, 3);
        top.replaceChildren(...(items.length ? [el('span', '', 'Most played')].concat(items.map((item) => {
          const b = el('button', 'hn-mini');
          b.type = 'button';
          b.setAttribute('aria-label', 'Open ' + shown(item));
          b.title = shown(item);
          b.append(cover(item, 'hn-mini-art'));
          b.addEventListener('click', () => launch(item));
          return b;
        })) : []));
      } catch (e) {
        nums.textContent = '';
        top.replaceChildren();
      }
    }
    paintAsk();
    let timer = null;
    startOnline = () => { if (timer) return; load(); timer = setInterval(() => { if (!document.hidden && document.body.classList.contains('on-home')) load(); }, 30000); };
    window.addEventListener('chalk-home', (e) => { if (e.detail && settings.homeLook === 'new') startOnline(); });
  }

  // ---- chat preview: the newest messages from one Chalk Chat channel you pick ----
  {
    const PICK = 'cb-chat-preview';   // { room, channel }
    const panel = el('section', 'hn-panel');
    const bar = el('details', 'hn-chat-pick');
    const picked = el('summary', '', 'Pick a channel');
    const roomPick = el('select');
    const chanPick = el('select');
    roomPick.setAttribute('aria-label', 'Class');
    chanPick.setAttribute('aria-label', 'Channel');
    const pickRow = el('div', 'hn-chat-pick-row');
    pickRow.append(roomPick, chanPick);
    bar.append(picked, pickRow);
    const label = el('p', 'hn-label');
    label.append(el('span', '', 'Chat preview'), bar);
    const list = el('div', 'hn-chat');
    panel.append(label, list);
    const paintPicked = () => { const r = rooms.find((x) => x.id === roomPick.value), c = channels.find((x) => x.id === chanPick.value); picked.textContent = r && c ? r.name + ' · # ' + c.name : 'Pick a channel'; };
    let db = null, rooms = [], channels = [], feed = null;
    const pick = () => read(PICK, null);
    async function showChannel(channelId) {
      list.replaceChildren(el('p', 'hn-muted', 'Loading…'));
      const { data, error } = await db.from('messages').select('id, body, created_at, profiles!messages_user_id_fkey(username)')
        .eq('channel_id', channelId).order('id', { ascending: false }).limit(6);
      if (error) { list.replaceChildren(el('p', 'hn-muted', 'Couldn’t load this channel.')); return; }
      const rows = (data || []).reverse();
      list.replaceChildren(...(rows.length ? rows.map((m) => {
        const r = el('p', 'hn-chat-row');
        r.append(el('b', '', ((m.profiles && m.profiles.username) || 'someone') + ' '), document.createTextNode(m.body));
        return r;
      }) : [el('p', 'hn-muted', 'Nothing here yet.')]));
      if (feed) db.removeChannel(feed);
      feed = db.channel('home-chat:' + channelId)
        .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages', filter: 'channel_id=eq.' + channelId }, () => showChannel(channelId))
        .subscribe();
    }
    async function fillChannels(roomId, wanted) {
      const { data } = await db.from('channels').select('id, name, kind').eq('room_id', roomId).eq('kind', 'text').order('position').order('created_at');
      channels = data || [];
      chanPick.replaceChildren(...channels.map((c) => { const o = el('option', '', '# ' + c.name); o.value = c.id; return o; }));
      const chosen = channels.find((c) => c.id === wanted) || channels.find((c) => c.name === 'general') || channels[0];
      if (!chosen) { list.replaceChildren(el('p', 'hn-muted', 'No text channels here.')); return; }
      chanPick.value = chosen.id;
      paintPicked();
      write(PICK, { room: roomId, channel: chosen.id });
      showChannel(chosen.id);
    }
    roomPick.addEventListener('change', () => fillChannels(roomPick.value, null));
    chanPick.addEventListener('change', () => { write(PICK, { room: roomPick.value, channel: chanPick.value }); paintPicked(); bar.open = false; showChannel(chanPick.value); });
    async function load() {
      try {
        db = await loadOnline();
        const { data: { user } } = await db.auth.getUser();
        if (!user) {
          bar.hidden = true;
          list.replaceChildren(el('p', 'hn-muted', 'Sign in to Chalk Chat to see a channel here.'));
          return;
        }
        const { data } = await db.from('rooms').select('id, name, is_global').order('is_global', { ascending: false }).order('name');
        rooms = data || [];
        roomPick.replaceChildren(...rooms.map((r) => { const o = el('option', '', r.name); o.value = r.id; return o; }));
        const p = pick();
        const room = rooms.find((r) => p && r.id === p.room) || rooms.find((r) => r.is_global) || rooms[0];
        if (!room) { list.replaceChildren(el('p', 'hn-muted', 'No classes yet.')); return; }
        roomPick.value = room.id;
        await fillChannels(room.id, p && p.channel);
      } catch (e) {
        list.replaceChildren(el('p', 'hn-muted', 'Chat isn’t available right now.'));
      }
    }
    let loaded = false;
    const start = () => { if (!loaded) { loaded = true; load(); } };
    window.addEventListener('chalk-home', (e) => { if (e.detail && settings.homeLook === 'new') start(); });
    section('chat', panel);
    secs.chat.load = start;
  }

  // ---- notes and to do: stay in this browser ----
  {
    const pair = el('div', 'hn-pair');
    const notes = el('section', 'hn-panel');
    const area = el('textarea');
    area.setAttribute('aria-label', 'Notes');
    area.placeholder = 'Homework, ideas, anything';
    area.value = read('cb-home-notes', '');
    area.addEventListener('input', () => write('cb-home-notes', area.value));
    notes.append(el('p', 'hn-label', 'Notes'), area);
    const todo = el('section', 'hn-panel');
    const list = el('ul', 'hn-todo');
    const form = el('form', 'hn-todo-add');
    const input = el('input');
    input.placeholder = 'Add a task';
    input.setAttribute('aria-label', 'New task');
    const add = el('button', 'hn-btn', 'Add');
    form.append(input, add);
    let items = read('cb-home-todo', []);
    const drawTodo = () => {
      write('cb-home-todo', items);
      list.replaceChildren(...items.map((it, i) => {
        const li = el('li');
        const box = el('input');
        box.type = 'checkbox';
        box.checked = !!it[1];
        box.setAttribute('aria-label', it[0]);
        box.addEventListener('change', () => { items[i][1] = box.checked; drawTodo(); });
        li.append(box, el('span', it[1] ? 'done' : '', it[0]));
        return li;
      }));
    };
    form.addEventListener('submit', (e) => { e.preventDefault(); const t = input.value.trim(); if (!t) return; items.push([t, false]); input.value = ''; drawTodo(); });
    drawTodo();
    todo.append(el('p', 'hn-label', 'To do'), list, form);
    pair.append(notes, todo);
    section('notes', pair);
  }

  // ---- arranging Home (from Settings) ----
  function arrange(key, dir) {
    const order = settings.homeOrder;
    const i = order.indexOf(key);
    if (!dir) order.splice(i, 1);
    else { const j = i + dir; if (j < 0 || j >= order.length) return; [order[i], order[j]] = [order[j], order[i]]; }
    saveSettings();
    layout();
  }
  function layout() {
    const order = settings.homeOrder;
    grid.replaceChildren(...order.map((k) => secs[k]));
    order.forEach((k, i) => {
      secs[k].querySelector('[data-dir="-1"]').disabled = i === 0;
      secs[k].querySelector('[data-dir="1"]').disabled = i === order.length - 1;
    });
    const spare = Object.keys(SECTIONS).filter((k) => !order.includes(k));
    trayRow.replaceChildren(...(spare.length ? spare.map((k) => {
      const b = el('button', 'hn-btn', '+ ' + SECTIONS[k]);
      b.type = 'button';
      b.addEventListener('click', () => { settings.homeOrder.push(k); saveSettings(); layout(); });
      return b;
    }) : [el('p', 'hn-muted', 'Everything is already on Home.')]));
    if (order.includes('vote') && homePanel.classList.contains('active') && settings.homeLook === 'new') secs.vote.load();
    if (order.includes('chat') && homePanel.classList.contains('active') && settings.homeLook === 'new') secs.chat.load();
  }
  function editing(on) { grid.classList.toggle('editing', on); editBar.hidden = !on; tray.hidden = !on; }
  editDone.addEventListener('click', () => editing(false));

  // ---- choosing old or new: Settings, and a step in setup ----
  function setLook(look) {
    settings.homeLook = look;
    saveSettings();
    paintLook();
  }
  function paintLook() {
    const isNew = settings.homeLook === 'new';
    document.body.classList.toggle('home-new', isNew);
    if (!isNew) editing(false);
    lookChoice.querySelectorAll('button').forEach((b) => b.classList.toggle('on', b.dataset.look === settings.homeLook));
    editRow.hidden = !isNew;
    if (isNew && homePanel.classList.contains('active') && settings.homeOrder.includes('vote')) secs.vote.load();
    if (isNew && homePanel.classList.contains('active')) { startOnline(); if (settings.homeOrder.includes('chat')) secs.chat.load(); }
  }
  const group = el('div', 'group');
  group.append(el('h2', '', 'Home'), el('p', '', 'What you see first.'));
  const lookRow = el('div', 'setting');
  const lookText = el('div');
  lookText.append(el('h3', '', 'Home style'), el('p', '', 'The new Home, or the classic one with just the title and search.'));
  const lookChoice = el('div', 'choice');
  [['new', 'New'], ['classic', 'Classic']].forEach(([look, label]) => {
    const b = el('button', '', label);
    b.type = 'button';
    b.dataset.look = look;
    b.addEventListener('click', () => setLook(look));
    lookChoice.append(b);
  });
  lookRow.append(lookText, lookChoice);
  const editRow = el('div', 'setting');
  const editTextRow = el('div');
  editTextRow.append(el('h3', '', 'Edit Home screen'), el('p', '', 'Choose which sections show and put them in order.'));
  const editOpen = el('button', 'btn', 'Edit Home screen');
  editOpen.type = 'button';
  editOpen.id = 'home-edit';
  editOpen.addEventListener('click', () => { showPanel('home'); editing(true); editDone.focus(); });
  editRow.append(editTextRow, editOpen);
  group.append(lookRow, editRow);
  const setupGroup = $('rerun-setup').closest('.group');
  setupGroup.parentNode.insertBefore(group, setupGroup);

  // setup: pick old or new, just before the last step
  function lookPicker() {
    const box = el('div', 'home-look-pick');
    [['new', 'New Home', 'Featured activities, what you opened last, Chalk Music and the vote.'], ['classic', 'Classic Home', 'Just the title and search, like before.']].forEach(([look, title, about]) => {
      const b = el('button', 'way');
      b.type = 'button';
      b.setAttribute('aria-pressed', String(settings.homeLook === look));
      b.append(el('b', '', title), el('span', '', about));
      b.addEventListener('click', () => { setLook(look); box.querySelectorAll('.way').forEach((w) => w.setAttribute('aria-pressed', String(w === b))); });
      box.append(b);
    });
    return box;
  }
  SETUP_STEPS.splice(SETUP_STEPS.length - 1, 0, { step: 'Home', title: 'Pick your Home', text: 'You can switch any time in Settings.', body: lookPicker });
  if (!$('setup').hidden) renderSetup();

  // keep the look right when settings change in another tab
  const applyBefore = applySettings;
  window.applySettings = function () { applyBefore(); paintLook(); };

  layout();
  paintLook();
})();
