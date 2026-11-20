// Announcements from Chalk Chat's Global announcements channel pop up on every
// Study Hall page, for everyone, account or not. Each one shows once per browser.
// Runs after the page's own script and uses its loadOnline() (the Supabase client).
(() => {
  const SEEN = 'chalk-news-seen';
  const read = () => { try { return Number(localStorage.getItem(SEEN)) || 0; } catch (e) { return 0; } };
  const write = (id) => { try { localStorage.setItem(SEEN, String(id)); } catch (e) {} };

  const style = document.createElement('style');
  style.textContent = `
  .news-pop { position: fixed; top: 18px; left: 50%; z-index: 9000; transform: translateX(-50%); width: min(460px, calc(100vw - 32px));
    padding: 14px 16px 12px; background: var(--paper, #131313); color: var(--ink, #f2f2f2); border: 1px solid var(--pencil, #6b6b6b);
    border-radius: var(--r, 3px); box-shadow: 0 10px 30px rgba(0, 0, 0, .35); font: inherit; }
  .news-pop h2 { margin: 0 0 6px; font-size: .7rem; font-weight: 600; letter-spacing: .12em; text-transform: uppercase; color: var(--pencil, #9a9a9a); }
  .news-pop p { margin: 0; font-size: .95rem; line-height: 1.45; white-space: pre-wrap; overflow-wrap: anywhere; }
  .news-pop .news-foot { display: flex; align-items: center; justify-content: space-between; gap: 10px; margin-top: 10px; font-size: .75rem; color: var(--pencil, #9a9a9a); }
  .news-pop button { padding: 5px 12px; background: none; border: 1px solid var(--pencil, #6b6b6b); border-radius: var(--r, 3px); color: inherit; font: inherit; cursor: pointer; }
  .news-pop button:hover, .news-pop button:focus-visible { border-color: var(--ink, #f2f2f2); outline: none; }`;
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

  async function start() {
    try {
      const db = await loadOnline();
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
