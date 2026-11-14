# Tide's fast engine

Websites open through these files. They need service workers, and they stream
pages like a normal browser instead of fetching every script before showing anything.

| File | What it is | License |
|------|------------|---------|
| `core.js`, `core.wasm` (Scramjet's `scramjet.js`, `scramjet.wasm`) | [Scramjet](https://github.com/MercuryWorkshop/scramjet) 2 by Mercury Workshop: rewrites pages so they work through the tide | MIT |
| `ctl.js`, `ctl-page.js`, `ctl-worker.js` (the controller's `controller.api.js`, `controller.inject.js`, `controller.sw.js`) | Scramjet's controller (`@mercuryworkshop/scramjet-controller` 0.0.14) by Mercury Workshop | AGPL-3.0 |
| `net.js` (`libcurl-client.js`) | [libcurl-transport](https://github.com/MercuryWorkshop/libcurl-transport) by Mercury Workshop, bundling [libcurl.js](https://github.com/ading2210/libcurl.js) 0.7.4 by ading2210 | AGPL-3.0 (libcurl.js: LGPL-3.0) |
| `sw.js` | Tide's service worker (hands each request to the Tide page) | AGPL-3.0, like Tide |

They are the builds of those projects as published, with one change in
`core.js`: the `$rfs` and `$io` tags it adds to addresses (the previous
page and the site that asked) are scrambled like the addresses themselves
(reversed, base64, marked with `~`), so a school filter can't read site names
from them. Search it for `"~"+btoa` to find the three places and the one that
reads them back.
