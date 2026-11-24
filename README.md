# ChalkBored

A study-break notebook for students: lessons and games, Chalk Music, Chalk TV,
Chalk Browser, Chalk Chat, a Requests poll, themes and tab cloaks.

- https://chalkbored.win
- https://chalkboredforall.vercel.app

This repo is the ChalkBored source: edit it here.

Chalk TV and Chalk Browser use [Tide](https://github.com/Guernica4u/Tide)
(AGPL-3.0, a fork of [GUST](https://github.com/nautilus-os/GUST)) on its public
servers. Requests, the online count and Chalk Chat (`class-chat.html`) use the
Supabase project set up by `SCRIPTS/public-setup.sql`. Only Chalk Chat has
accounts: Global is for mod news, messages need an accepted friend request,
and classes are invite only.

## Offline copy

The [Releases](https://github.com/Guernica4u/ChalkBored/releases) page has `chalkbored-offline.html`
(Study Hall in one file) and `get-games.mjs`. Put both in one folder, then with Node 18 or newer:

- `node get-games.mjs` downloads every game (about 8 GB) next to them. Run it again to resume.
- `node get-games.mjs serve` opens the offline copy at http://localhost:8130/ with the downloaded games.

Opened on its own, the HTML file loads games from games.chalkbored.win. Music, TV, Browser and Chat need the website.
Rebuild the HTML with `node SCRIPTS/build-offline.mjs`.
