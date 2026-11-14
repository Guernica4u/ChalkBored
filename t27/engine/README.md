# Tide's fast engine

Websites open through these files when the browser allows service workers;
otherwise Tide uses GUST's own engine. They stream pages like a normal browser
instead of fetching every script before showing anything.

| File | What it is | License |
|------|------------|---------|
| `scramjet.js`, `scramjet.wasm` | [Scramjet](https://github.com/MercuryWorkshop/scramjet) 2 by Mercury Workshop: rewrites pages so they work through the tide | MIT |
| `controller.api.js`, `controller.inject.js`, `controller.sw.js` | Scramjet's controller (`@mercuryworkshop/scramjet-controller` 0.0.14) by Mercury Workshop | AGPL-3.0 |
| `libcurl-client.js` | [libcurl-transport](https://github.com/MercuryWorkshop/libcurl-transport) by Mercury Workshop, bundling [libcurl.js](https://github.com/ading2210/libcurl.js) 0.7.4 by ading2210 | AGPL-3.0 (libcurl.js: LGPL-3.0) |
| `sw.js` | Tide's service worker (hands each request to the Tide page) | AGPL-3.0, like Tide |

They are unchanged builds of those projects, as published.
