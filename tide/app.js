// Tide's code lives here, not inside index.html: school filters scan a page's own text (site
// names, server addresses, engine words) and block it, but let script files through.
(() => {
'use strict';
const $ = id => document.getElementById(id);
const html = document.documentElement;
const store = {
  get(k, d = null) { try { const v = localStorage.getItem('tide:' + k); return v == null ? d : v; } catch (e) { return d; } },
  set(k, v) { try { if (v == null) localStorage.removeItem('tide:' + k); else localStorage.setItem('tide:' + k, v); } catch (e) {} }
};
const framed = window.top !== window.self;
if (framed) html.classList.add('framed');

/* public servers Tide can send sites through */
const SERVERS = [
  'wss://fern.best/wisp/', 'wss://lichology.com/wisp/', 'wss://wisp.mercurywork.shop/', 'wss://wisp.terbiumon.top/wisp/',
  'wss://gointospace.app/wisp/', 'wss://definitelyscience.com/wisp/', 'wss://anura.pro/', 'wss://motor-cycle-part.org/wisp/'
];
const ENGINES = {
  ddg: ['DuckDuckGo', 'https://duckduckgo.com/?q='], google: ['Google', 'https://www.google.com/search?q='],
  bing: ['Bing', 'https://www.bing.com/search?q='], brave: ['Brave Search', 'https://search.brave.com/search?q=']
};

/* ---- #tide={...}: how the page around Tide wants it.
   open: a site to show first · ui:"tv": Chalk TV, just the site · fresh: nothing from an
   earlier visit comes back · relay: one of SERVERS for this visit */
const CFG = (() => {
  const c = { open: null, tv: false, fresh: false, relay: null };
  const m = /[#&](?:tide|cfg)=([^&]*)/.exec(location.hash);
  if (!m) return c;
  try { history.replaceState(null, '', location.pathname + location.search); } catch (e) {}
  let j; try { j = JSON.parse(decodeURIComponent(m[1])); } catch (e) { return c; }
  if (!j || typeof j !== 'object') return c;
  if (typeof j.open === 'string' && /^https?:\/\//i.test(j.open)) c.open = j.open;
  c.tv = j.ui === 'tv';
  c.fresh = j.fresh === true;
  if (SERVERS.includes(j.relay)) c.relay = j.relay;
  if (typeof j.relayB64 === 'string') {
    try { const r = atob(j.relayB64); if (SERVERS.includes(r)) c.relay = r; } catch (e) {}
  }
  return c;
})();
if (CFG.tv) html.classList.add('tv');

/* "fresh": sites' storage and cookies from earlier visits are gone. The engine keeps a
   site's storage here as "host@key" and its cookies in "__scramjet_controller"; deleting that
   database waits forever while another Tide (Chalk Browser) has it open, so a fresh visit
   gets its own empty one and earlier fresh ones are cleared away. */
if (CFG.fresh) {
  const siteKey = /^[a-z0-9-]+(\.[a-z0-9-]+)+(:\d+)?@/i;
  for (const st of [localStorage, sessionStorage]) {
    try { Object.keys(st).filter(k => siteKey.test(k)).forEach(k => st.removeItem(k)); } catch (e) {}
  }
  const CTL_DB = '__scramjet_controller', FRESH_DB = CTL_DB + '_fresh_';
  try {
    if (indexedDB.databases) indexedDB.databases().then(list => list.forEach(d => {
      if (d.name && d.name.startsWith(FRESH_DB)) indexedDB.deleteDatabase(d.name);
    })).catch(() => {});
    const open = indexedDB.open.bind(indexedDB), mine = FRESH_DB + Date.now().toString(36);
    indexedDB.open = (name, version) => open(name === CTL_DB ? mine : name, version);
  } catch (e) {}
}


/* ---- servers ---- */
function ping(url, ms = 2500) {
  return new Promise(done => {
    const t0 = performance.now(); let ws, timer;
    const finish = v => { clearTimeout(timer); try { ws.close(); } catch (e) {} done(v); };
    try { ws = new WebSocket(url); } catch (e) { return done(null); }
    timer = setTimeout(() => finish(null), ms);
    ws.onopen = () => finish(performance.now() - t0);
    ws.onerror = () => finish(null);
  });
}
/* A server can answer the ping and still fail every site, so it must also reach a real one:
   one tide stream to example.com's https port has to get an answer back. */
function reachesSiteOnce(url, ms = 6000) {
  return new Promise(done => {
    let ws, timer;
    const finish = ok => { clearTimeout(timer); try { ws.close(); } catch (e) {} done(ok); };
    try { ws = new WebSocket(url); } catch (e) { return done(false); }
    ws.binaryType = 'arraybuffer';
    timer = setTimeout(() => finish(false), ms);
    ws.onerror = ws.onclose = () => finish(false);
    ws.onopen = () => {
      const enc = new TextEncoder(), host = enc.encode('example.com'), req = enc.encode('GET / HTTP/1.0\r\nHost: example.com\r\n\r\n');
      const open = new Uint8Array(8 + host.length), data = new Uint8Array(5 + req.length);
      open.set([1, 1, 0, 0, 0, 1, 443 & 255, 443 >> 8]); open.set(host, 8);   // CONNECT: stream 1, TCP, port 443
      data.set([2, 1, 0, 0, 0]); data.set(req, 5);                             // DATA on stream 1
      ws.send(open); ws.send(data);
    };
    ws.onmessage = e => {
      const b = new Uint8Array(e.data);
      if (b[1] === 1 && b[0] === 2) finish(true);         // the site answered
      else if (b[1] === 1 && b[0] === 4) finish(false);   // the server closed the stream
    };
  });
}
const reachesSite = async url => (await reachesSiteOnce(url)) || reachesSiteOnce(url);   // one miss is often just a blip
/* the fastest server that also reaches a real site; remembered for the next start */
async function findFastest() {
  const times = await Promise.all(SERVERS.map(async u => [u, await ping(u)]));
  for (const [u] of times.filter(t => t[1] != null).sort((a, b) => a[1] - b[1])) {
    if (await reachesSite(u)) { store.set('fastest', u); return u; }
  }
  return null;
}
/* the server to start with: Chalk TV's pick, the one chosen in Settings, or the fastest.
   Last time's fastest starts Tide at once and is checked behind it. */
let wisp = null, checkBehind = false;
const startServer = (async () => {
  if (CFG.relay) return CFG.relay;
  const chosen = store.get('server');
  if (SERVERS.includes(chosen)) return chosen;
  const known = store.get('fastest');
  if (SERVERS.includes(known)) { checkBehind = true; return known; }
  showBar(true);
  return (await findFastest()) || SERVERS[0];
})();
function useServer(url) {
  wisp = url;
  if (ctl) ctl.setTransport(new LibcurlTransport.LibcurlClient({ wisp: url }));
  renderServers();
}

/* ---- the engine ---- */
const ENGINE = new URL('engine/', location.href).pathname;
let ctl = null;
const loadScript = src => new Promise((ok, fail) => {
  const s = document.createElement('script');
  s.src = src; s.async = false;   // download together, run in the order added
  s.onload = ok; s.onerror = () => fail(new Error('could not load ' + src));
  document.head.appendChild(s);
});
/* the registration's worker, once it runs (this page sits outside engine/, so serviceWorker.ready never settles) */
function workerActive(reg) {
  if (reg.active) return Promise.resolve(reg.active);
  const w = reg.installing || reg.waiting;
  return new Promise((ok, fail) => {
    const timer = setTimeout(() => fail(new Error('the engine did not start')), 15000);
    w.addEventListener('statechange', () => {
      if (w.state === 'activated') { clearTimeout(timer); ok(reg.active || w); }
      else if (w.state === 'redundant') { clearTimeout(timer); fail(new Error('the engine did not start')); }
    });
  });
}
const engine = (async () => {
  if (!('serviceWorker' in navigator)) throw new Error('no-sw');
  const reg = await navigator.serviceWorker.register(ENGINE + 'sw.js', { scope: ENGINE, updateViaCache: 'none' });
  const [sw] = await Promise.all([workerActive(reg), ...['core.js', 'ctl.js', 'net.js'].map(f => loadScript(ENGINE + f))]);
  wisp = await startServer;
  const c = new $scramjetController.Controller({
    serviceworker: sw,
    transport: new LibcurlTransport.LibcurlClient({ wisp }),
    config: {
      prefix: ENGINE + 'go/',
      // School filters read the site's address in each request and block it, so it's
      // scrambled (reversed, then base64). These are copied as text into sites' workers,
      // so they must not use anything from outside themselves. A "?query" a form adds stays as is.
      codec: {
        encode: u => u && btoa(encodeURIComponent(u).split('').reverse().join('')).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''),
        decode: s => {
          if (!s) return s;
          const [a, ...q] = s.split('?');
          try { return decodeURIComponent(atob(a.replace(/-/g, '+').replace(/_/g, '/')).split('').reverse().join('')) + (q.length ? '?' + q.join('?') : ''); }
          catch (e) { return decodeURIComponent(s); }   // an address from before scrambling
        }
      },
      scramjetPath: ENGINE + 'core.js',
      injectPath: ENGINE + 'ctl-page.js',
      wasmPath: ENGINE + 'core.wasm',
      virtualWasmPath: 'core.wasm.js'
    }
  });
  await c.wait();
  // When a new version of Tide deploys, a new service worker takes over and asks open pages
  // to introduce themselves, but the engine answers the old, retired worker, so the new one
  // never learns about this page ("Tide lost track of this page"). Answer the worker that asked.
  navigator.serviceWorker.addEventListener('message', e => {
    if (!e.data || !e.data.$controller$swrevive || !(e.source instanceof ServiceWorker) || e.source === c.serviceWorkerController) return;
    c.serviceWorkerController = e.source;
    c.setupMessagePort();
  });
  ctl = c;
  showBar(false);
  renderServers();
  if (checkBehind) (async () => {   // last time's fastest: still working? Rank again for next time either way
    const ok = await reachesSite(wisp);
    const best = await findFastest();
    if (!ok && best && best !== wisp) useServer(best);
  })();
  return c;
})();
engine.then(() => { if (framed) try { window.parent.postMessage({ tide: 'ready' }, '*'); } catch (e) {} },
  e => notice("Tide can't open sites here", e.message === 'no-sw'
    ? 'Its engine needs service workers, which private windows and some settings turn off. Open Tide in a normal window.'
    : 'Its engine did not start (' + e.message + '). Reloading usually fixes it.'));
/* Firefox can't hand a stream between pages, so there each answer goes over whole */
const CHUNK = 4 * 1024 * 1024;
const MEDIA_FILE = /\.(mp4|m4v|webm|mov|ogv|mp3|m4a|ogg|oga|wav|flac|opus)$/i;
const moved = new Map();   // a video's address -> where it redirected
const warming = new Set();
/* While the player page sets up, ask for the file's first byte: the connections are open and any
   redirect is known by the time the player asks, so its first part comes straight back. */
async function warm(url) {
  if (warming.has(url)) return;
  warming.add(url);
  setTimeout(() => warming.delete(url), 10000);
  try {
    const t = ctl.transport;
    if (!t.session) await (t.tideInit = t.tideInit || t.init());
    for (let hop = 0; hop < 3; hop++) {
      const r = await t.request(new URL(url), 'GET', null, [['range', 'bytes=0-0']], undefined);
      try { r.body && r.body.cancel(); } catch (e) {}
      const loc = r.status >= 301 && r.status <= 308 && new Headers(r.headers).get('location');
      if (!loc) return;
      const to = new URL(loc, url).href;
      moved.set(url, to);
      url = to;
    }
  } catch (e) {}
}
const canStream =(() => { try { const ch = new MessageChannel(), rs = new ReadableStream(); ch.port1.postMessage(rs, [rs]); return true; } catch (e) { return false; } })();

/* ---- tabs ---- */
const view = $('view');
let tabs = [], active = null, nextId = 1;
function newTab(input, show = true) {
  const t = { id: nextId++, url: '', title: 'New Tab', icon: '', frame: null, loading: false, waiting: false, el: null };
  tabs.push(t);
  if (input && !show) { t.url = toUrl(input) || ''; t.title = hostOf(t.url) || 'New Tab'; t.waiting = !!t.url; }   // loads when first shown
  if (show) showTab(t); else renderTabs();
  if (input && show) open(t, input);
  saveTabs();
  return t;
}
const closed = [];   // recently closed tabs' addresses, for Ctrl+Shift+T
function closeTab(t) {
  const i = tabs.indexOf(t);
  if (i < 0) return;
  if (t.url) closed.push(t.url);
  if (t.frame) t.frame.element.remove();
  const el = t.el, after = el && el.nextSibling;
  tabs.splice(i, 1);
  if (!tabs.length) newTab();
  else if (active === t) showTab(tabs[Math.min(i, tabs.length - 1)]);
  else renderTabs();
  saveTabs();
  // the closed tab stays in its old place just long enough to shrink away
  if (el && !calm.matches) {
    const box = $('tabs');
    box.insertBefore(el, after && after.parentNode === box ? after : null);
    el.classList.add('closing');
    el.addEventListener('animationend', () => el.remove(), { once: true });
    setTimeout(() => el.remove(), 400);   // in case the animation never runs
  }
}
const calm = matchMedia('(prefers-reduced-motion: reduce)');
const LIVE_TABS = 3;
function showTab(t) {
  if (active && active !== t && active.frame) {
    active.frame.element.classList.remove('shown');
    try { active.frame.element.contentDocument.querySelectorAll('video, audio').forEach(m => m.pause()); } catch (e) {}
  }
  active = t;
  t.used = Date.now();
  if (t.waiting) { t.waiting = false; open(t, t.url); }
  // only the 3 most recently used tabs keep their site running; older ones load again when opened
  tabs.filter(o => o.frame && o !== t).sort((a, b) => b.used - a.used).slice(LIVE_TABS - 1).forEach(o => {
    o.frame.element.remove();
    Object.assign(o, { frame: null, loading: false, painted: false, waiting: !!o.url });
  });
  if (t.frame && t.url) t.frame.element.classList.add('shown');
  $('home').hidden = !!t.url;
  showBar(t.loading);
  if (document.activeElement !== $('url')) $('url').value = shown(t.url);
  renderTabs();
  renderStar();
  saveTabs();
  if (!t.url && !CFG.tv) setTimeout(() => $('home-input').focus({ preventScroll: true }), 0);
}
function renderTabs() {
  const box = $('tabs');
  for (const t of tabs) {
    if (!t.el) {
      t.el = document.createElement('div');
      t.el.className = 'tab new';
      t.el.addEventListener('animationend', () => t.el.classList.remove('new'), { once: true });
      t.el.setAttribute('role', 'tab');
      t.el.innerHTML = '<span class="icon"></span><span class="title"></span><span class="close" title="Close tab" role="button" aria-label="Close tab"><svg class="i" viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18"/></svg></span>';
      t.el.addEventListener('click', e => { if (e.target.closest('.close')) closeTab(t); else showTab(t); });
      t.el.addEventListener('auxclick', e => { if (e.button === 1) closeTab(t); });
    }
    t.el.classList.toggle('active', t === active);
    t.el.classList.toggle('loading', t.loading);
    t.el.setAttribute('aria-selected', t === active);
    t.el.title = t.title;
    t.el.querySelector('.title').textContent = t.title;
    const icon = t.el.querySelector('.icon');
    if (icon.dataset.src !== t.icon) {
      icon.dataset.src = t.icon;
      icon.textContent = '';
      if (t.icon) { const img = new Image(); img.src = t.icon; img.alt = ''; img.onerror = () => { icon.textContent = letter(t); }; icon.appendChild(img); }
      else if (!t.url) icon.innerHTML = MOON;
      else icon.textContent = letter(t);
    }
  }
  // moving tab elements mid-click loses the click, so only when tabs were added, closed or moved
  if (box.children.length !== tabs.length || tabs.some((t, i) => box.children[i] !== t.el)) box.replaceChildren(...tabs.map(t => t.el));
  // the logo while the active tab loads its first page; later pages keep the old one on screen with the bar
  $('loader').hidden = !(active && active.url && active.loading && !active.painted);
  if (active && active.el) active.el.scrollIntoView({ block: 'nearest', inline: 'nearest' });
}
const MOON = '<svg viewBox="0 0 64 64" width="14" height="14"><mask id="tm"><rect width="64" height="64" fill="#fff"/><circle cx="40" cy="24" r="20" fill="#000"/></mask><circle cx="28" cy="34" r="22" fill="currentColor" mask="url(#tm)"/><circle cx="48" cy="18" r="6" fill="var(--ac)"/></svg>';
const letter = t => { try { return new URL(t.url).hostname.replace(/^www\./, '')[0].toUpperCase(); } catch (e) { return ''; } };
function saveTabs() {
  if (CFG.fresh || CFG.tv) return;
  store.set('tabs', JSON.stringify({ urls: tabs.map(t => t.url), active: tabs.indexOf(active) }));
}

/* ---- opening sites ---- */
function toUrl(q) {
  q = String(q || '').trim();
  if (!q) return null;
  if (/^https?:\/\//i.test(q)) return q;
  if (!/\s/.test(q) && /^[^\s/]+\.[a-z]{2,}(:\d+)?(\/.*)?$/i.test(q)) return 'https://' + q;
  const e = ENGINES[store.get('engine')] || ENGINES.ddg;
  return e[1] + encodeURIComponent(q);
}
async function open(t, input) {
  const url = toUrl(input);
  if (!url) return;
  t.url = url;
  t.title = hostOf(url);
  t.icon = '';
  t.loading = true;
  if (t === active) { $('url').value = shown(url); $('home').hidden = true; showBar(true); }
  renderTabs();
  saveTabs();
  try { await engine; } catch (e) { return; }
  try { if (MEDIA_FILE.test(new URL(url).pathname)) warm(url); } catch (e) {}   // before the page even starts
  frameFor(t).go(url);
  if (t === active) t.frame.element.classList.add('shown');
}
const hostOf = u => { try { return new URL(u).hostname.replace(/^www\./, ''); } catch (e) { return u; } };
function frameFor(t) {
  if (t.frame) return t.frame;
  const f = ctl.createFrame();
  const { Tap, BareResponse } = $scramjet;
  if (CFG.tv) {
    /* Chalk TV has nowhere to put downloads, so they are dropped */
    Tap.tap(f.hooks.fetch.preresponse, (ctx, props) => {
      const r = props.response;
      const dest = ctx.parsed.destination || ctx.request.rawDestination;
      if (!/^\s*attachment/i.test(r.headers.get('content-disposition') || '') || (dest !== 'document' && dest !== 'iframe')) return;
      try { r.body && r.body.cancel(); } catch (e) {}
      props.response = BareResponse.fromNativeResponse(new Response(null, { status: 204 }));
    });
  }
  /* The engine reads a response as fast as the server sends it, with no way to slow down, so a
     film asked for as "bytes=N-" would pile up in memory far ahead of playback. Ask for 4 MB at
     a time instead; the player asks for the next part when it needs it. */
  Tap.tap(f.hooks.fetch.request, (ctx, props) => {
    const dest = ctx.parsed.destination || ctx.request.rawDestination;
    const url = String(props.url);
    /* A video or song opened as a page: answer with a small player page right here. Otherwise the
       page request downloads the whole file while the player asks for it again on a second connection. */
    if ((dest === 'document' || dest === 'iframe') && MEDIA_FILE.test(new URL(url).pathname)) {
      const src = url.replace(/[&"<>]/g, c => '&#' + c.charCodeAt(0) + ';');
      const name = decodeURIComponent(new URL(url).pathname.split('/').pop()).replace(/[&<>]/g, '');
      props.earlyResponse = new Response('<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>' + name +
        '</title><style>html,body{margin:0;height:100%;background:#000}video{display:block;width:100%;height:100%;object-fit:contain}</style>' +
        '<video src="' + src + '" controls autoplay playsinline></video>', { headers: { 'content-type': 'text/html; charset=utf-8' } });
      warm(url);
      return;
    }
    /* the player's later parts go straight to where the file was redirected, skipping a hop */
    if (dest === 'video' || dest === 'audio') { const to = moved.get(url); if (to) props.url = new URL(to); }
    const h = props.init.headers;
    if (!Array.isArray(h)) return;
    for (const pair of h) {
      const m = /^range$/i.test(pair[0]) && /^bytes=(\d+)-$/.exec(String(pair[1]).trim());
      if (m) pair[1] = 'bytes=' + m[1] + '-' + (+m[1] + CHUNK - 1);
    }
  });
  Tap.tap(f.hooks.fetch.preresponse, (ctx, props) => {
    const dest = ctx.parsed.destination || ctx.request.rawDestination, r = props.response;
    if ((dest !== 'video' && dest !== 'audio') || r.status < 301 || r.status > 308) return;
    const loc = r.headers.get ? r.headers.get('location') : null;
    if (loc) { if (moved.size > 50) moved.clear(); moved.set(String(ctx.parsed.url), new URL(loc, String(ctx.parsed.url)).href); }
  });
  if (!canStream) Tap.tap(f.hooks.fetch.response, async (ctx, props) => {
    const body = props.response.body;
    if (body instanceof ReadableStream) props.response.body = await new Response(body).arrayBuffer();
  });
  const el = f.element;
  el.title = 'Page';
  el.allow = 'fullscreen; autoplay; encrypted-media; picture-in-picture; clipboard-write';
  el.allowFullscreen = true;
  el.setAttribute('sandbox', 'allow-scripts allow-same-origin allow-forms allow-modals allow-pointer-lock allow-presentation allow-orientation-lock' + (CFG.tv ? '' : ' allow-downloads'));
  el.addEventListener('load', () => {
    try { if (el.contentWindow.location.href === 'about:blank') return; } catch (e) {}   // the empty frame, before the site
    t.loading = false; t.painted = true; if (t === active) showBar(false); follow(t); keepInTide(t); renderTabs(); });
  t.frame = f;   // before it joins the page: an empty frame fires "load" right away
  view.appendChild(el);
  return f;
}
/* follow the page: links and redirects inside it update the address bar and the tab */
function follow(t) {
  if (!t.frame) return;
  let href, doc;
  try { href = t.frame.element.contentWindow.location.href; doc = t.frame.element.contentDocument; } catch (e) { return; }
  if (!href.startsWith(t.frame.context.prefix.href)) return;
  let real;
  try { real = $scramjet.unrewriteUrl(href, t.frame.context); } catch (e) { return; }
  let changed = false;
  if (real && /^https?:/i.test(real) && real !== t.url) { t.url = real; changed = true; if (t === active && document.activeElement !== $('url')) $('url').value = shown(real); saveTabs(); }
  const title = (doc && doc.title || '').trim() || hostOf(t.url);
  if (title !== t.title) { t.title = title; changed = true; }
  if (changed) { remember(t.url, t.title); if (t === active) renderStar(); }
  const link = doc && doc.querySelector('link[rel~="icon"][href]');
  const icon = link ? link.href : '';
  if (icon !== t.icon) { t.icon = icon; changed = true; }
  if (changed) renderTabs();
}
setInterval(() => tabs.forEach(follow), 700);
/* a link or window that asks for a new tab opens as a Tide tab (in Chalk TV, right here);
   pop-ups nobody clicked for are dropped */
function keepInTide(t) {
  const f = t.frame;
  const openNew = url => { if (CFG.tv) open(t, url); else newTab(url); };
  const patchWin = win => {
    let doc;
    try { doc = win.document; } catch (e) { return; }
    if (!doc) return;
    try { for (let i = 0; i < win.frames.length; i++) patchWin(win.frames[i]); } catch (e) {}
    if (win.__tideKeep || !String(win.location.href).startsWith(f.context.prefix.href)) return;
    win.__tideKeep = true;
    const realUrl = raw => {
      let u = null;
      try {
        const abs = new URL(String(raw), win.location.href).href;
        u = abs.startsWith(f.context.prefix.href) ? $scramjet.unrewriteUrl(abs, f.context)
          : new URL(String(raw), $scramjet.unrewriteUrl(win.location.href, f.context)).href;
      } catch (e) { return null; }
      return /^https?:/i.test(u) ? u : null;
    };
    const elsewhere = target => !!target && !/^_(self|parent|top)$/i.test(target);
    const targetOf = a => a.getAttribute('target') || (doc.querySelector('base[target]') || { getAttribute: () => '' }).getAttribute('target');
    win.open = function (url) {
      const real = url == null || String(url) === '' ? null : realUrl(url);
      const clicked = !win.navigator.userActivation || win.navigator.userActivation.isActive;
      if (real && clicked) openNew(real);
      return null;
    };
    const onClick = e => {
      const a = e.target && e.target.closest && e.target.closest('a[href], area[href]');
      if (!a) return;
      const extra = e.type === 'auxclick' ? e.button === 1 : (e.ctrlKey || e.metaKey || e.shiftKey);
      if (!extra && !elsewhere(targetOf(a))) return;
      const real = realUrl(a.getAttribute('href'));
      if (!real) return;
      e.preventDefault(); e.stopImmediatePropagation();
      openNew(real);
    };
    doc.addEventListener('click', onClick, true);
    doc.addEventListener('auxclick', onClick, true);
  };
  patchWin(f.element.contentWindow);
}
setInterval(() => tabs.forEach(t => { if (t.frame) keepInTide(t); }), 1500);

/* ---- the bar, the buttons, the keyboard ---- */
function showBar(on) { $('bar').classList.toggle('on', !!on); }
function notice(title, text) {
  $('notice-title').textContent = title;
  $('notice-text').textContent = text;
  $('notice').hidden = false;
}
$('notice-btn').onclick = () => location.reload();
$('addr').onsubmit = e => { e.preventDefault(); const q = $('url').value; open(active, q); $('url').blur(); };
// the bar shows addresses without "https://", and the whole address while you edit it
const shown = u => String(u || '').replace(/^https:\/\//i, '');
$('url').addEventListener('focus', () => { if (active && active.url) $('url').value = active.url; $('url').select(); });
$('url').addEventListener('blur', () => { $('url').value = active ? shown(active.url) : ''; });
$('home-search').onsubmit = e => { e.preventDefault(); const q = $('home-input').value; $('home-input').value = ''; open(active, q); };
$('new-tab').onclick = () => newTab();
$('back').onclick = () => { if (active && active.frame) active.frame.back(); };
$('forward').onclick = () => { if (active && active.frame) active.frame.forward(); };
$('reload').onclick = () => { if (active && active.frame && active.url) { active.loading = true; showBar(true); renderTabs(); active.frame.reload(); } };
document.addEventListener('keydown', e => {
  if (CFG.tv || !(e.ctrlKey || e.metaKey)) return;
  const k = e.key.toLowerCase();
  if (k === 't' && e.shiftKey) { e.preventDefault(); reopen(); }
  else if (k === 't') { e.preventDefault(); newTab(); }
  else if (k === 'w') { e.preventDefault(); closeTab(active); }
  else if (k === 'l') { e.preventDefault(); $('url').focus(); }
  else if (k === 'd') { e.preventDefault(); toggleMark(); }
  else if (e.key === '=' || e.key === '+') { e.preventDefault(); zoomStep(1); }
  else if (e.key === '-') { e.preventDefault(); zoomStep(-1); }
  else if (e.key === '0') { e.preventDefault(); zoomStep(0); }
  else if (e.key === 'Tab' && tabs.length > 1) { e.preventDefault(); showTab(tabs[(tabs.indexOf(active) + (e.shiftKey ? tabs.length - 1 : 1)) % tabs.length]); }
});
function tick() {
  const now = new Date();
  $('clock').textContent = now.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) + '  ·  ' +
    now.toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' });
}
tick(); setInterval(tick, 15000);

/* ---- Settings ---- */
$('settings-close').onclick = () => { $('settings').hidden = true; };
$('settings').addEventListener('click', e => { if (e.target === $('settings')) $('settings').hidden = true; });
document.addEventListener('keydown', e => { if (e.key === 'Escape') { $('settings').hidden = true; closeLists(); $('menu').hidden = true; } });

/* ---- the menu ---- */
$('menu-btn').onclick = e => {
  e.stopPropagation();
  const m = $('menu'), r = $('menu-btn').getBoundingClientRect();
  m.hidden = !m.hidden;
  if (m.hidden) return;
  m.style.top = (r.bottom + 6) + 'px';
  m.style.right = Math.max(8, innerWidth - r.right) + 'px';
  m.querySelector('[data-do="reopen"]').disabled = !closed.length;
  m.querySelector('button').focus();
};
document.addEventListener('click', e => { if (!e.target.closest('#menu')) $('menu').hidden = true; });
$('menu').onclick = e => {
  const b = e.target.closest('button');
  if (!b) return;
  $('menu').hidden = true;
  const d = b.dataset.do;
  if (d === 'zoom-in' || d === 'zoom-out') { $('menu').hidden = false; zoomStep(d === 'zoom-in' ? 1 : -1); return; }
  if (d === 'newtab') newTab();
  else if (d === 'reopen') reopen();
  else if (d === 'bookmarks' || d === 'history') openList(d);
  else if (d === 'settings') { $('settings').hidden = false; renderServers(); }
};
/* ---- zoom: one level for every site, put on each site's page (and again after it navigates) ---- */
const ZOOMS = [25, 33, 50, 67, 75, 80, 90, 100, 110, 125, 150, 175, 200, 250, 300];
let zoom = 100;
function applyZoom() {
  const z = zoom === 100 ? '' : String(zoom / 100);
  for (const t of tabs) { try { const r = t.frame.element.contentDocument.documentElement; if (r.style.zoom !== z) r.style.zoom = z; } catch (e) {} }
  $('zoom-pct').textContent = zoom + '%';
}
function zoomStep(dir) {
  if (dir === 0) zoom = 100;
  else zoom = ZOOMS[Math.max(0, Math.min(ZOOMS.length - 1, (ZOOMS.indexOf(zoom) < 0 ? 7 : ZOOMS.indexOf(zoom)) + dir))];
  applyZoom();
}
setInterval(applyZoom, 700);
function reopen() { if (closed.length) newTab(closed.pop()); }

/* ---- bookmarks and history (kept in this browser only; nothing is kept in fresh visits) ---- */
const load = k => { try { const v = JSON.parse(store.get(k)); return Array.isArray(v) ? v : []; } catch (e) { return []; } };
let marks = load('bookmarks'), visits = load('history');
const hue = s => [...String(s)].reduce((h, c) => (h * 31 + c.charCodeAt(0)) % 360, 7);
function remember(url, title) {
  if (CFG.fresh || !/^https?:/i.test(url)) return;
  if (visits[0] && visits[0].url === url) visits[0].title = title;
  else visits.unshift({ url, title, time: Date.now() });
  visits = visits.slice(0, 300);
  store.set('history', JSON.stringify(visits));
}
function renderStar() {
  const on = !!(active && active.url && marks.some(m => m.url === active.url));
  $('star').disabled = !active || !active.url || CFG.fresh;
  $('star').classList.toggle('on', on);
  $('star').title = on ? 'Remove bookmark (Ctrl+D)' : 'Bookmark this page (Ctrl+D)';
}
function toggleMark() {
  if (!active || !active.url || CFG.fresh) return;
  const i = marks.findIndex(m => m.url === active.url);
  if (i >= 0) marks.splice(i, 1); else marks.push({ url: active.url, title: active.title });
  store.set('bookmarks', JSON.stringify(marks));
  renderStar(); renderMarks();
}
$('star').onclick = toggleMark;
function renderMarks() {
  $('marks').replaceChildren(...marks.slice(0, 12).map(m => {
    const b = document.createElement('button'), host = hostOf(m.url);
    b.innerHTML = '<span class="tile"></span><span class="name"></span>';
    b.querySelector('.tile').textContent = ((m.title || host)[0] || '?').toUpperCase();
    b.querySelector('.name').textContent = m.title || host;
    b.title = m.title || host;
    b.onclick = () => open(active, m.url);
    return b;
  }));
}
function openList(kind) {
  const list = kind === 'bookmarks' ? marks.slice().reverse() : visits;
  $('lists-title').textContent = kind === 'bookmarks' ? 'Bookmarks' : 'History';
  $('clear-history').hidden = kind !== 'history' || !visits.length;
  $('list').replaceChildren(...(list.length ? list.slice(0, 200).map(v => {
    const row = document.createElement('div');
    row.className = 'item';
    row.innerHTML = '<span class="icon"></span><span class="txt"><b></b><small></small></span><button class="x" aria-label="Remove"><svg class="i" viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18"/></svg></button>';
    const host = hostOf(v.url);
    row.querySelector('.icon').textContent = (host[0] || '?').toUpperCase();
    row.querySelector('.icon').style.background = 'hsl(' + hue(host) + ' 45% 30%)';
    row.querySelector('b').textContent = v.title || host;
    row.querySelector('small').textContent = kind === 'history' ? host + ' · ' + new Date(v.time).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : host;
    row.onclick = e => {
      if (e.target.closest('.x')) {
        if (kind === 'bookmarks') { marks = marks.filter(m => m !== v); store.set('bookmarks', JSON.stringify(marks)); renderStar(); renderMarks(); }
        else { visits = visits.filter(m => m !== v); store.set('history', JSON.stringify(visits)); }
        openList(kind);
        return;
      }
      closeLists();
      open(active, v.url);
    };
    return row;
  }) : [Object.assign(document.createElement('div'), { className: 'empty', textContent: kind === 'bookmarks' ? 'No bookmarks yet. Press the star in the address bar to add one.' : 'Nothing here yet.' })]));
  $('lists').hidden = false;
}
// the lists leave the page when closed, so no site names stay in it
function closeLists() { $('lists').hidden = true; $('list').replaceChildren(); }
$('lists-close').onclick = closeLists;
$('lists').addEventListener('click', e => { if (e.target === $('lists')) closeLists(); });
$('clear-history').onclick = () => { visits = []; store.set('history', null); openList('history'); };
renderMarks();
for (const [k, [name]] of Object.entries(ENGINES)) $('engine').add(new Option(name, k));
$('engine').value = ENGINES[store.get('engine')] ? store.get('engine') : 'ddg';
$('engine').onchange = () => store.set('engine', $('engine').value);
const results = {};
function renderServers() {
  const box = $('servers');
  if ($('settings').hidden) return;
  const chosen = store.get('server') || '';
  const row = (url, name, note) => {
    const b = document.createElement('button');
    b.className = 'server' + (url === chosen ? ' on' : '');
    b.innerHTML = '<b></b><span></span>';
    b.querySelector('b').textContent = name;
    const s = b.querySelector('span');
    s.textContent = note || '';
    if (/not working|no answer/.test(note)) s.className = 'bad';
    b.onclick = () => { store.set('server', url || null); useServer(url || store.get('fastest') || wisp); };
    return b;
  };
  const list = [row('', 'Fastest', CFG.relay ? 'Chalk TV picked a server' : 'now ' + hostOf(wisp || '…'))];
  const order = SERVERS.slice().sort((a, b) => (results[a] && results[a].ms || 1e9) - (results[b] && results[b].ms || 1e9));
  for (const u of order) list.push(row(u, hostOf(u), results[u] ? results[u].note : (u === wisp ? 'in use' : '')));
  box.replaceChildren(...list);
}
$('test-servers').onclick = async () => {
  const btn = $('test-servers');
  btn.disabled = true;
  let done = 0;
  $('server-status').textContent = 'Testing… 0 of ' + SERVERS.length;
  await Promise.all(SERVERS.map(async u => {
    const ms = [];
    for (let i = 0; i < 3; i++) { const v = await ping(u); if (v != null) ms.push(v); }
    const avg = ms.length ? Math.round(ms.reduce((a, b) => a + b, 0) / ms.length) : null;
    const works = avg != null && await reachesSite(u);
    results[u] = { ms: works ? avg : null, note: avg == null ? 'no answer' : works ? avg + ' ms' : 'not working' };
    $('server-status').textContent = 'Testing… ' + (++done) + ' of ' + SERVERS.length;
    renderServers();
  }));
  btn.disabled = false;
  const best = SERVERS.filter(u => results[u].ms != null).sort((a, b) => results[a].ms - results[b].ms)[0];
  if (best) store.set('fastest', best);
  $('server-status').textContent = best ? 'Fastest: ' + hostOf(best) : 'No server reached a site. Check the internet connection.';
  if (best && !store.get('server') && !CFG.relay && best !== wisp) useServer(best);
};

/* ---- commands from the page around Tide (Chalk TV, Chalk Browser) ---- */
const PARENTS = ['https://chalkbored.win', 'https://chalkbored-for-students.vercel.app', 'https://chalkbored.guernica4u.workers.dev',
  'https://chalkboredforall.vercel.app', 'https://chalkbored-public.guernica4u.workers.dev', location.origin];
window.addEventListener('message', e => {
  if (!framed || e.source !== window.parent) return;
  const local = /^(127\.0\.0\.1|localhost)$/.test(location.hostname) && /^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(e.origin);
  if (!PARENTS.includes(e.origin) && !local) return;
  const d = e.data;
  if (!d || typeof d.tide !== 'string') return;
  if (d.tide === 'go' && typeof d.url === 'string' && /^https?:\/\//i.test(d.url)) open(active, d.url);
  else if (d.tide === 'back') $('back').click();
  else if (d.tide === 'reload') $('reload').click();
  else if (d.tide === 'stop' && active && active.frame) {   // leave the site, so its page and media are let go
    active.frame.element.remove();
    Object.assign(active, { frame: null, url: '', loading: false, painted: false });
    renderTabs();
  }
  else if (d.tide === 'fetch' && typeof d.url === 'string' && /^https:\/\//i.test(d.url)) {
    // one GET through Tide's server for the page around it (Chalk TV's lists and posters)
    const reply = (m, t) => { try { e.source.postMessage(Object.assign({ tide: 'fetched', id: d.id }, m), e.origin, t); } catch (x) {} };
    engine.then(async c => { const t = c.transport; if (!t.session) await (t.tideInit = t.tideInit || t.init()); return t.request(new URL(d.url), 'GET', null, [], undefined); }).then(async r => {
      const body = await new Response(r.body).arrayBuffer();
      reply({ status: r.status, type: new Headers(r.headers).get('content-type') || '', body }, [body]);
    }).catch(err => reply({ status: 0, error: String(err && err.message || err) }));
  }
});

/* ---- start ---- */
if (CFG.open || CFG.tv || CFG.fresh) newTab(CFG.open);
else {
  let saved = null;
  try { saved = JSON.parse(store.get('tabs')); } catch (e) {}
  const urls = saved && Array.isArray(saved.urls) ? saved.urls.filter(u => u === '' || /^https?:\/\//i.test(u)).slice(0, 30) : [];
  if (!urls.length) newTab();
  else {
    urls.forEach(u => newTab(u, false));
    showTab(tabs[saved.active] || tabs[0]);
  }
}
})();
