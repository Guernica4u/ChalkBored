// Backup relay switch (set on the launcher page). When it's on, the build gets
// these relays for shared worlds instead of its own list. Load this before the
// page sets its options object.
(function () {
  try { if (localStorage.getItem('cb-backup-relay') !== '1') return; } catch (e) { return; }
  // chalkbored.win is blocked at school, so other copies use the workers.dev address
  var own = /(^|\.)chalkbored\.win$|^chalkbored\.guernica4u\.workers\.dev$/.test(location.hostname)
    ? location.host : 'chalkbored.guernica4u.workers.dev';
  var relays = [
    'wss://' + own + '/lessons-sync',   // the usual main relay, reached through ChalkBored's own address
    'wss://relay.shhnowisnottheti.me/',
    'wss://relay.eaglercraft.net/'
  ].map(function (addr, i) {
    return { addr: addr, name: 'Backup ' + (i + 1), comment: 'Backup ' + (i + 1), primary: i === 0 };
  });
  ['eaglercraftXOpts', 'eaglercraftOpts'].forEach(function (k) {
    var v;
    Object.defineProperty(window, k, {
      configurable: true,
      get: function () { return v; },
      set: function (o) { if (o && typeof o === 'object') o.relays = relays; v = o; }
    });
  });
})();
