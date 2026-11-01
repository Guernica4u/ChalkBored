// stand-in for the ad kit: every call does nothing and succeeds
window.PokiSDK = new Proxy({}, {
  get: function (t, name) {
    if (name === 'rewardedBreak') return function () { return Promise.resolve(true); };
    return function () { return Promise.resolve(); };
  }
});
