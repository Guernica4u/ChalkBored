# Listening

The music player in Notebook (`listening.html`). Its code is in that page; this
folder holds what it loads.

| File | What it is | License |
|------|------------|---------|
| `libcurl-client.js` | [libcurl-transport](https://github.com/MercuryWorkshop/libcurl-transport) by Mercury Workshop, bundling [libcurl.js](https://github.com/ading2210/libcurl.js) 0.7.4 by ading2210. A copy of `tide/engine/libcurl-client.js`, unchanged. Used only to look songs up and read playlists through a tide server. | AGPL-3.0 (libcurl.js: LGPL-3.0) |

No songs are shipped. Songs come from links people add and from finding them by
name, and are kept in each browser's own storage (`listening.v1`).
