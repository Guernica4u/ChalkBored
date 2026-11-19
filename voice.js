// Chalk Chat voice: connects your mic to everyone else in the same call, one
// direct link per person (at most 10 people, so at most 9 links). It doesn't
// decide who may talk or carry the messages that set links up: the database
// does that (SCRIPTS/public-setup.sql, voice_*), and the page passes them in
// through send() and signal().
//
// The newest person in a call offers a link to everyone already there. If two
// people join at once and both offer, the one with the smaller id keeps theirs.
export function createVoice({ me, send, iceServers, onChange }) {
  const peers = new Map();   // id -> { pc, audio, waiting: [] }
  const failed = new Set();  // people the network wouldn't let us reach
  let silenced = new Set();  // people this page doesn't play
  let stream = null;
  let muted = false;

  async function start() {
    stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
    });
  }

  function peer(id) {
    if (peers.has(id)) return peers.get(id);
    const pc = new RTCPeerConnection({ iceServers });
    const p = { pc, audio: new Audio(), waiting: [] };
    p.audio.autoplay = true;
    p.audio.muted = silenced.has(id);
    failed.delete(id);
    peers.set(id, p);
    stream.getTracks().forEach((t) => pc.addTrack(t, stream));
    pc.onicecandidate = (e) => { if (e.candidate) send(id, 'ice', e.candidate.toJSON()); };
    pc.ontrack = (e) => { p.audio.srcObject = e.streams[0]; p.audio.play().catch(() => {}); };
    pc.onconnectionstatechange = () => {
      if (pc.connectionState === 'failed') failed.add(id);
      if (pc.connectionState === 'failed' || pc.connectionState === 'closed') drop(id);
      else onChange();
    };
    onChange();
    return p;
  }

  async function call(id) {
    const { pc } = peer(id);
    await pc.setLocalDescription(await pc.createOffer());
    send(id, 'offer', pc.localDescription.toJSON());
  }

  async function signal(from, kind, body) {
    if (kind === 'bye') { failed.delete(from); drop(from); return; }
    if (!stream) return;
    if (kind === 'offer') {
      const { pc } = peer(from);
      // both offered at once: the smaller id keeps its own offer
      if (pc.signalingState === 'have-local-offer' && me < from) return;
      await pc.setRemoteDescription(body);
      await flush(from);
      await pc.setLocalDescription(await pc.createAnswer());
      send(from, 'answer', pc.localDescription.toJSON());
    } else if (kind === 'answer') {
      const p = peers.get(from);
      if (!p || p.pc.signalingState !== 'have-local-offer') return;
      await p.pc.setRemoteDescription(body);
      await flush(from);
    } else if (kind === 'ice') {
      const p = peer(from);
      // candidates can arrive before the offer or answer they belong to
      if (p.pc.remoteDescription) await p.pc.addIceCandidate(body).catch(() => {});
      else p.waiting.push(body);
    }
  }

  async function flush(id) {
    const p = peers.get(id);
    if (!p) return;
    const list = p.waiting.splice(0);
    for (const c of list) await p.pc.addIceCandidate(c).catch(() => {});
  }

  function drop(id) {
    const p = peers.get(id);
    if (!p) return;
    peers.delete(id);
    p.pc.onconnectionstatechange = null;
    p.pc.close();
    p.audio.srcObject = null;
    onChange();
  }

  function stop() {
    [...peers.keys()].forEach(drop);
    if (stream) stream.getTracks().forEach((t) => t.stop());
    stream = null;
  }

  function setMuted(on) {
    muted = !!on;
    if (stream) stream.getAudioTracks().forEach((t) => { t.enabled = !muted; });
    onChange();
  }

  function silence(ids) {
    silenced = new Set(ids);
    peers.forEach((p, id) => { p.audio.muted = silenced.has(id); });
  }

  // people you're actually linked with right now
  const connected = () => [...peers.entries()].filter(([, p]) => p.pc.connectionState === 'connected').map(([id]) => id);

  return { start, call, signal, drop, stop, setMuted, silence, connected, failed: () => [...failed], get muted() { return muted; }, get size() { return peers.size; } };
}
