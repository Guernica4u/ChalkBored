// Cloudflare runs this in front of the static files. Files are served as-is;
// the one extra is /lessons-sync, a websocket passed straight through to the
// shared-world relay, so it can be reached from ChalkBored's own address.
export default {
  async fetch(request, env) {
    const url = new URL(request.url);
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
