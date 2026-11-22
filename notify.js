// Announcements from Chalk Chat's Global announcements channel pop up on every
// Study Hall page, for everyone, account or not. Each one shows once per browser.
// Next to the version number: a profile button for everyone (it opens Chalk Chat), and a
// notifications bell for people signed in.
// Runs after the page's own script and uses its loadOnline() (the Supabase client).
(() => {
  const SEEN = 'chalk-news-seen';
  const read = () => { try { return Number(localStorage.getItem(SEEN)) || 0; } catch (e) { return 0; } };
  const write = (id) => { try { localStorage.setItem(SEEN, String(id)); } catch (e) {} };

  const style = document.createElement('style');
  style.textContent = `
  .news-pop { position: fixed; top: 18px; left: 50%; z-index: 9000; transform: translateX(-50%); width: min(460px, calc(100vw - 32px));
    padding: 14px 16px 12px; background: var(--card, #131313); color: var(--ink, #f2f2f2); border: 1px solid var(--edge, #2e2e2e);
    border-radius: var(--r, 3px); box-shadow: var(--shadow, none); -webkit-backdrop-filter: blur(14px); backdrop-filter: blur(14px); font: inherit; }
  .news-pop h2 { margin: 0 0 6px; font-size: .7rem; font-weight: 600; letter-spacing: .12em; text-transform: uppercase; color: var(--accent, #9a9a9a); }
  .news-pop p { margin: 0; font-size: .95rem; line-height: 1.45; white-space: pre-wrap; overflow-wrap: anywhere; }
  .news-pop .news-foot { display: flex; align-items: center; justify-content: space-between; gap: 10px; margin-top: 10px; font-size: .75rem; color: var(--pencil, #9a9a9a); }
  .news-pop button { padding: 5px 12px; background: none; border: 1px solid var(--edge, #2e2e2e); border-radius: var(--r, 3px); color: inherit; font: inherit; cursor: pointer; }
  .news-pop button:hover, .news-pop button:focus-visible { border-color: var(--accent, #f2f2f2); outline: none; }`;
  document.head.appendChild(style);

  function show(a) {
    if (!a || a.id <= read()) return;
    write(a.id);
    document.querySelectorAll('.news-pop').forEach((x) => x.remove());
    const box = document.createElement('div');
    box.className = 'news-pop';
    box.setAttribute('role', 'alert');
    const head = document.createElement('h2');
    head.textContent = 'Announcement';
    const text = document.createElement('p');
    text.textContent = a.body;
    const foot = document.createElement('div');
    foot.className = 'news-foot';
    const who = document.createElement('span');
    who.textContent = a.author ? 'From ' + a.author : '';
    const ok = document.createElement('button');
    ok.type = 'button';
    ok.textContent = 'Got it';
    ok.addEventListener('click', () => box.remove());
    foot.append(who, ok);
    box.append(head, text, foot);
    document.body.appendChild(box);
    ok.focus();
  }

  // ---- the bell: @mentions, friend requests, new polls and announcements, for
  // anyone signed in to Chalk Chat in this browser (the page shares its sign-in)
  const bellCss = document.createElement('style');
  bellCss.textContent = `
  .bell-btn { position: relative; }
  .ver-row { position: fixed; left: 1.2rem; bottom: .35rem; z-index: 21; display: flex; align-items: center; gap: .35rem; }
  .ver-row .ver-corner { position: static; }
  .ver-row .icon-btn { width: 28px; height: 28px; }
  .ver-row .icon-btn svg { width: 16px; height: 16px; }
  @media (min-width: 761px) { body.os.rail-mini .ver-row { left: 0; width: 64px; flex-direction: column-reverse; gap: .1rem; } }
  @media (max-width: 760px) { body:not(.on-home) .ver-row { display: none; } }
  .bell-btn svg, .me-btn svg { width: 19px; height: 19px; fill: none; stroke: currentColor; stroke-width: 1.8; stroke-linecap: round; stroke-linejoin: round; }
  .bell-count { position: absolute; top: -4px; right: -6px; min-width: 15px; height: 15px; padding: 0 3px; box-shadow: 0 0 0 2px var(--rail, #080808); background: var(--accent, #f2f2f2); color: var(--card, #111);
    border-radius: 2px; font-size: .62rem; font-weight: 700; line-height: 15px; text-align: center; }
  .bell-list { position: fixed; z-index: 8999; width: min(340px, calc(100vw - 24px)); max-height: 60vh; overflow-y: auto; padding: 6px;
    background: var(--card, #131313); color: var(--ink, #f2f2f2); border: 1px solid var(--edge, #2e2e2e); border-radius: var(--r, 3px); box-shadow: var(--shadow, none); -webkit-backdrop-filter: blur(14px); backdrop-filter: blur(14px); }
  .bell-list h2 { display: flex; justify-content: space-between; align-items: center; margin: 2px 4px 6px; font-size: .78rem; font-weight: 600; }
  .bell-list h2 button { padding: 2px 8px; background: none; border: 1px solid var(--edge, #2e2e2e); border-radius: var(--r, 3px); color: inherit; font: inherit; font-size: .7rem; cursor: pointer; }
  .bell-row { display: block; width: 100%; padding: 7px 6px; background: none; border: 0; border-top: 1px solid var(--edge, #2e2e2e); color: inherit; font: inherit; font-size: .8rem; text-align: left; cursor: pointer; }
  .bell-row:hover, .bell-row:focus-visible { background: var(--paper-2, rgba(255, 255, 255, .06)); outline: none; }
  .bell-row.new { font-weight: 600; }
  .bell-row small { display: block; margin-top: 2px; font-size: .68rem; font-weight: 400; color: var(--pencil, #9a9a9a); }
  .bell-empty { margin: 4px 6px 6px; font-size: .78rem; color: var(--pencil, #9a9a9a); }`;
  document.head.appendChild(bellCss);

  async function bell(db) {
    const { data: { user } } = await db.auth.getUser();
    const ver = document.getElementById('hello-updated');
    if (!ver) return;
    const row = document.createElement('div');
    row.className = 'ver-row';
    ver.parentNode.insertBefore(row, ver);
    const me = document.createElement('button');
    me.type = 'button';
    me.className = 'icon-btn me-btn';
    me.title = user ? 'Your profile' : 'Make an account';
    me.setAttribute('aria-label', me.title);
    me.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="8.5" r="3.5"/><path d="M5 19.5a7 7 0 0 1 14 0"/></svg>';
    // signed in: your profile opens right here (home.js); signed out: Chalk Chat, to make an account
    me.addEventListener('click', () => {
      if (user && typeof window.openProfileCard === 'function') { window.openProfileCard(); return; }
      if (typeof showPanel !== 'function') return;
      showPanel('chat');
      if (!user) return;
      const frame = document.querySelector('#panel-chat iframe');
      let tries = 0;
      const go = () => {
        let name = null;
        try { name = frame.contentDocument.getElementById('me-name'); } catch (e) {}
        if (name && name.textContent !== '\u2014') name.click();
        else if (++tries < 50) setTimeout(go, 150);
      };
      go();
    });
    row.append(ver, me);
    if (!user) return;
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'icon-btn bell-btn';
    btn.setAttribute('aria-haspopup', 'true');
    btn.setAttribute('aria-expanded', 'false');
    btn.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 16V11a6 6 0 0 1 12 0v5l1.5 2h-15z"/><path d="M10 20.5a2 2 0 0 0 4 0"/></svg>';
    const count = document.createElement('span');
    count.className = 'bell-count';
    count.hidden = true;
    btn.appendChild(count);
    row.insertBefore(btn, me);
    const list = document.createElement('div');
    list.className = 'bell-list';
    list.hidden = true;
    list.setAttribute('role', 'region');
    list.setAttribute('aria-label', 'Notifications');
    document.body.appendChild(list);
    let rows = [];

    const paintCount = () => {
      const n = rows.filter((r) => !r.seen).length;
      count.textContent = n > 99 ? '99+' : String(n);
      count.hidden = !n;
      btn.title = n ? 'Notifications, ' + n + ' new' : 'Notifications';
      btn.setAttribute('aria-label', btn.title);
    };
    const load = async () => {
      const { data } = await db.from('notifications').select('id, kind, title, room_id, channel_id, message_id, seen, created_at')
        .order('id', { ascending: false }).limit(30);
      rows = data || [];
      paintCount();
      if (!list.hidden) paintList();
    };
    // opens Chalk Chat on that message (or just the chat, for friend requests)
    const open = (r) => {
      if (typeof showPanel !== 'function') return;
      showPanel('chat');
      const frame = document.querySelector('#panel-chat iframe');
      if (frame && r.room_id && r.channel_id) frame.src = 'class-chat.html?room=' + r.room_id + '&channel=' + r.channel_id + (r.message_id ? '&msg=' + r.message_id : '');
    };
    const clear = (ids) => db.rpc('clear_notifications', { p_ids: ids }).then(load);
    function paintList() {
      list.replaceChildren();
      const head = document.createElement('h2');
      head.append('Notifications');
      if (rows.some((r) => !r.seen)) {
        const all = document.createElement('button');
        all.type = 'button';
        all.textContent = 'Mark all read';
        all.addEventListener('click', () => clear(null));
        head.append(all);
      }
      list.append(head);
      if (!rows.length) { const p = document.createElement('p'); p.className = 'bell-empty'; p.textContent = 'You’re all caught up.'; list.append(p); }
      rows.forEach((r) => {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'bell-row' + (r.seen ? '' : ' new');
        const when = document.createElement('small');
        when.textContent = new Date(r.created_at).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
        b.append(r.title, when);
        b.addEventListener('click', () => { list.hidden = true; btn.setAttribute('aria-expanded', 'false'); if (!r.seen) clear([r.id]); open(r); });
        list.append(b);
      });
    }
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      list.hidden = !list.hidden;
      btn.setAttribute('aria-expanded', String(!list.hidden));
      if (list.hidden) return;
      const at = btn.getBoundingClientRect();
      list.style.bottom = (window.innerHeight - at.top + 6) + 'px';
      list.style.left = Math.max(12, at.left) + 'px';
      paintList();
    });
    document.addEventListener('click', (e) => { if (!list.hidden && !list.contains(e.target)) { list.hidden = true; btn.setAttribute('aria-expanded', 'false'); } });
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !list.hidden) { list.hidden = true; btn.setAttribute('aria-expanded', 'false'); btn.focus(); } });
    await load();
    db.channel('notifications:' + user.id)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'notifications', filter: 'user_id=eq.' + user.id }, load)
      .subscribe();
  }

  async function start() {
    try {
      const db = await loadOnline();
      bell(db).catch(() => {});
      // anything posted in the last 3 days that this browser hasn't seen yet
      const since = new Date(Date.now() - 3 * 864e5).toISOString();
      const { data } = await db.from('announcements').select('id, body, author').gt('created_at', since).order('id', { ascending: false }).limit(1);
      if (data && data[0]) show(data[0]);
      db.channel('announcements')
        .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'announcements' }, ({ new: a }) => show(a))
        .subscribe();
    } catch (e) {}
  }
  start();
})();
