/*
 * net.js — tiny WebRTC networking layer for the arcade.
 *
 * No game server is required. Peers connect directly to each other over
 * WebRTC data channels, using the free public PeerJS broker only to find
 * one another. The 4-digit room code is turned into a deterministic peer id
 * so a phone that knows the code can dial the host directly.
 */

// Namespace prefix so our room ids don't collide with other apps that use
// the shared public PeerJS broker.
const ARCADE_PREFIX = 'bva-arcade-';

function hostPeerId(code) {
  return ARCADE_PREFIX + code;
}

/* ------------------------------------------------------------------ */
/* Host side (the TV / laptop screen)                                  */
/* ------------------------------------------------------------------ */
class HostNet {
  constructor() {
    this.peer = null;
    this.code = null;
    this.conns = new Map(); // peerId -> DataConnection

    // Callbacks, wired up by host.js
    this.onReady = () => {};             // (code) => void
    this.onJoin = () => {};              // (peerId, name) => void
    this.onInput = () => {};             // (peerId, msg) => void
    this.onLeave = () => {};             // (peerId) => void
    this.onError = () => {};             // (message) => void
  }

  start() {
    this._tryCode(0);
  }

  _randomCode() {
    return String(Math.floor(1000 + Math.random() * 9000));
  }

  _tryCode(attempt) {
    if (attempt > 8) {
      this.onError('Could not create a room — please reload and try again.');
      return;
    }
    const code = this._randomCode();
    const peer = new Peer(hostPeerId(code), { debug: 1 });

    peer.on('open', () => {
      this.peer = peer;
      this.code = code;
      this._wire();
      this.onReady(code);
    });

    peer.on('error', (err) => {
      if (err && err.type === 'unavailable-id') {
        // Someone already owns this code — pick another one.
        try { peer.destroy(); } catch (e) {}
        this._tryCode(attempt + 1);
      } else if (err && (err.type === 'network' || err.type === 'server-error' || err.type === 'socket-error')) {
        this.onError('Network problem reaching the matchmaking service. Check your connection and reload.');
      }
      // Ignore transient per-connection errors once we are open.
    });
  }

  _wire() {
    this.peer.on('connection', (conn) => {
      conn.on('open', () => {
        this.conns.set(conn.peer, conn);
      });
      conn.on('data', (d) => {
        if (!d || typeof d !== 'object') return;
        if (d.type === 'join') {
          this.onJoin(conn.peer, String(d.name || 'Player').slice(0, 12));
        } else if (d.type === 'input' || d.type === 'dash') {
          this.onInput(conn.peer, d);
        }
      });
      conn.on('close', () => {
        this.conns.delete(conn.peer);
        this.onLeave(conn.peer);
      });
      conn.on('error', () => {
        this.conns.delete(conn.peer);
        this.onLeave(conn.peer);
      });
    });
  }

  send(peerId, msg) {
    const c = this.conns.get(peerId);
    if (c && c.open) {
      try { c.send(msg); } catch (e) {}
    }
  }

  broadcast(msg) {
    this.conns.forEach((c) => {
      if (c.open) {
        try { c.send(msg); } catch (e) {}
      }
    });
  }
}

/* ------------------------------------------------------------------ */
/* Guest side (the phone controller)                                   */
/* ------------------------------------------------------------------ */
class GuestNet {
  constructor() {
    this.peer = null;
    this.conn = null;

    this.onOpen = () => {};   // () => void
    this.onData = () => {};   // (msg) => void
    this.onClose = () => {};  // () => void
    this.onError = () => {};  // (reason) => void
  }

  connect(code, name) {
    this.peer = new Peer({ debug: 1 });

    this.peer.on('open', () => {
      const conn = this.peer.connect(hostPeerId(code), {
        serialization: 'json',
        metadata: { name },
      });
      this.conn = conn;

      conn.on('open', () => {
        conn.send({ type: 'join', name });
        this.onOpen();
      });
      conn.on('data', (d) => this.onData(d));
      conn.on('close', () => this.onClose());
      conn.on('error', () => this.onError('lost'));

      // If the host never answers, surface a friendly timeout.
      setTimeout(() => {
        if (!conn.open) this.onError('no-room');
      }, 12000);
    });

    this.peer.on('error', (err) => {
      if (err && err.type === 'peer-unavailable') this.onError('no-room');
      else if (err && err.type === 'browser-incompatible') this.onError('unsupported');
      else this.onError('network');
    });
  }

  send(msg) {
    if (this.conn && this.conn.open) {
      try { this.conn.send(msg); } catch (e) {}
    }
  }

  close() {
    try { if (this.conn) this.conn.close(); } catch (e) {}
    try { if (this.peer) this.peer.destroy(); } catch (e) {}
  }
}
