// Cloudflare runs this in front of the static files. Files are served as-is;
// the one extra is /lessons-sync, a websocket passed straight through to the
// shared-world relay, so it can be reached from ChalkBored's own address.
// The Study Hall copies live in study-hall/ but keep their old addresses
// (bookmarks, the page picker), so those are served from there.
const HALLS = new Set(['algebra', 'archive', 'biology', 'calendar', 'chemistry', 'english', 'handbook', 'history', 'notes', 'planner', 'practice', 'reading', 'resources', 'review']);
async function hall(name, request, env) {
  let at = new URL('/study-hall/' + name + '.html', request.url);
  for (let i = 0; i < 3; i++) {
    const res = await env.ASSETS.fetch(new Request(at, request));
    if (res.status < 300 || res.status >= 400 || !res.headers.get('Location')) return res;
    at = new URL(res.headers.get('Location'), at);   // the assets may drop .html; follow that here, not in the browser
  }
  return new Response('Not found', { status: 404 });
}
// /voice-ice: a 2-hour login for the Cloudflare voice relay (TURN), so Chalk Chat calls work on
// networks that block direct connections. Only for signed-in people; the database counts them
// (take_relay_login: 2,000 a month, 10 per person a day) so the relay stays in the free allowance.
// The relay key lives in this worker's secrets (TURN_KEY_ID, TURN_KEY_TOKEN), never in a page.
const SUPABASE_URL = 'https://thrwgeuljtqjfcohzfdt.supabase.co';
const SUPABASE_KEY = 'sb_publishable_0NGQlBRZ08bdTFpT4aRw6Q_T_DBsAby';   // the public key the pages use too
const ORIGINS = /^https:\/\/((?:[a-z0-9-]+\.)?chalkbored\.win|chalkbored-for-students\.vercel\.app)$/;
const STUN = [{ urls: 'stun:stun.cloudflare.com:3478' }];
async function voiceIce(request, env) {
  const origin = request.headers.get('Origin') || '';
  const cors = { 'Access-Control-Allow-Origin': ORIGINS.test(origin) ? origin : 'https://chalkbored.win', 'Access-Control-Allow-Headers': 'authorization, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS', Vary: 'Origin', 'Cache-Control': 'no-store' };
  const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });
  if (request.method === 'OPTIONS') return new Response(null, { headers: cors });
  if (request.method !== 'POST') return json({ error: 'POST only' }, 405);
  const auth = request.headers.get('Authorization') || '';
  if (!/^Bearer [\w.-]{20,}$/.test(auth)) return json({ iceServers: STUN, relay: false }, 401);
  const ok = await fetch(SUPABASE_URL + '/rest/v1/rpc/take_relay_login', {
    method: 'POST', headers: { apikey: SUPABASE_KEY, Authorization: auth, 'Content-Type': 'application/json' }, body: '{}',
  });
  if (!ok.ok || (await ok.json().catch(() => false)) !== true || !env.TURN_KEY_ID || !env.TURN_KEY_TOKEN) return json({ iceServers: STUN, relay: false });
  const r = await fetch(`https://rtc.live.cloudflare.com/v1/turn/keys/${env.TURN_KEY_ID}/credentials/generate-ice-servers`, {
    method: 'POST', headers: { Authorization: 'Bearer ' + env.TURN_KEY_TOKEN, 'Content-Type': 'application/json' }, body: JSON.stringify({ ttl: 7200 }),
  });
  if (!r.ok) return json({ iceServers: STUN, relay: false });
  const list = [].concat((await r.json()).iceServers || []);
  // school filters often allow only 443: make sure the relay is offered there, over TLS and UDP
  const turn = list.find((s) => [].concat(s.urls).some((u) => /^turns?:/.test(u)));
  if (turn) {
    const urls = [].concat(turn.urls);
    for (const u of ['turns:turn.cloudflare.com:443?transport=tcp', 'turn:turn.cloudflare.com:443?transport=udp', 'turn:turn.cloudflare.com:80?transport=tcp']) if (!urls.includes(u)) urls.push(u);
    turn.urls = urls;
  }
  return json({ iceServers: list, relay: !!turn });
}
export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === '/voice-ice') return voiceIce(request, env);
    const name = url.pathname.slice(1).replace(/\.html$/, '');
    if (HALLS.has(name)) return hall(name, request, env);
    if (url.pathname !== '/lessons-sync') return env.ASSETS.fetch(request);
    if (request.headers.get('Upgrade') !== 'websocket') return new Response('websocket only', { status: 426 });
    const up = (await fetch('https://relay.eaglercraft.net/', { headers: { Upgrade: 'websocket', Origin: url.origin, 'User-Agent': request.headers.get('User-Agent') || 'Mozilla/5.0' } })).webSocket;
    if (!up) return new Response('relay unreachable', { status: 502 });
    const [client, server] = Object.values(new WebSocketPair());
    up.accept();
    server.accept();
    const pipe = (from, to) => {
      let queue = Promise.resolve();   // binary can arrive as a Blob; keep the order while it's read
      from.addEventListener('message', (e) => {
        queue = queue.then(async () => to.send(e.data instanceof Blob ? await e.data.arrayBuffer() : e.data)).catch(() => {});
      });
      from.addEventListener('close', () => { queue.then(() => { try { to.close(1000); } catch (_) {} }); });
      from.addEventListener('error', () => { try { to.close(1011); } catch (_) {} });
    };
    pipe(server, up);
    pipe(up, server);
    return new Response(null, { status: 101, webSocket: client });
  }
};
