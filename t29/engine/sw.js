/* Tide's fast engine: the service worker.
 *
 * Every request a website opened in Tide makes - its scripts, its pictures,
 * the things it asks for later on its own - comes through here. Scramjet does
 * the actual work in the Tide page: this worker only hands each request over
 * to that page, which sends it out over the tide connection instead of
 * straight to the site. Anything it does not recognise passes through untouched.
 */
importScripts("controller.sw.js");

const TIDE_GO = new URL("go/", self.registration.scope).pathname;

/* A browser stops an idle service worker after a while and starts it again on
   the next request, having forgotten which pages run the engine. Those pages
   are told to introduce themselves again (below), so a request that arrives in
   that moment waits for them instead of failing. */
async function routeWhenReady(event) {
  for (let i = 0; i < 50; i++) {
    await new Promise(done => setTimeout(done, 100));
    if ($scramjetController.shouldRoute(event)) return $scramjetController.route(event);
  }
  return new Response("Tide lost track of this page. Reload it.", {
    status: 503, headers: { "Content-Type": "text/plain; charset=utf-8" }
  });
}

/* A page opened on its own in a new browser tab has no Tide behind it and
   would only show an error, so say so plainly. Tide opens links that ask for a
   new tab as its own tabs; this catches the rest. */
const ESCAPED = `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Opened in a new tab</title>
<style>body{margin:0;min-height:100vh;display:grid;place-items:center;background:#000;color:#eee;font:15px system-ui,sans-serif;text-align:center;padding:16px}
button{margin-top:16px;padding:10px 24px;background:#fff;color:#000;border:0;border-radius:4px;font-size:14px;cursor:pointer}p{color:#aaa;max-width:36ch}</style>
<div><h2>This opened in a new tab</h2><p>Pages opened through Tide only work inside Tide. Go back to that tab - this one can be closed.</p>
<button onclick="window.close()">Close this tab</button></div>`;

/* Scramjet's controller sends a request's body on as request.body, which
   Firefox doesn't have: there every POST went out empty, so YouTube's video
   requests failed (411) and many sites' forms and searches broke. In Firefox
   the body is read first and handed over whole. */
const NO_BODY_STREAM = !("body" in Request.prototype);
async function routeWithBody(event) {
  const req = event.request;
  const body = await req.arrayBuffer();
  const request = new Proxy(req, {
    get(target, key) {
      if (key === "body") return body.byteLength ? body : null;
      const value = target[key];
      return typeof value === "function" ? value.bind(target) : value;
    }
  });
  return $scramjetController.route({ request, clientId: event.clientId, resultingClientId: event.resultingClientId });
}

addEventListener("fetch", event => {
  const req = event.request;
  if (req.mode === "navigate" && req.destination === "document" && new URL(req.url).pathname.startsWith(TIDE_GO))
    event.respondWith(new Response(ESCAPED, { headers: { "Content-Type": "text/html; charset=utf-8" } }));
  else if ($scramjetController.shouldRoute(event))
    event.respondWith(NO_BODY_STREAM && req.method !== "GET" && req.method !== "HEAD" ? routeWithBody(event) : $scramjetController.route(event));
  else if (new URL(event.request.url).pathname.startsWith(TIDE_GO)) event.respondWith(routeWhenReady(event));
});

/* Scramjet only tells the pages this worker controls to introduce themselves
   again. Tide runs the engine from outside this folder, so tell every other
   page of the site as well. */
setTimeout(async () => {
  const mine = new Set((await clients.matchAll({ type: "window" })).map(c => c.id));
  for (const client of await clients.matchAll({ type: "window", includeUncontrolled: true }))
    if (!mine.has(client.id)) client.postMessage({ $controller$swrevive: {} });
}, 100);
