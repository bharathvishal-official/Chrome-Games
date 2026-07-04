# 🎮 Browser Arcade — Coin Rush Arena

A tiny **party arcade game that runs entirely in the browser**. Put the game on
a big screen (TV, laptop, projector), and everyone joins from their phone by
**scanning a QR code** or typing a **4-digit room code**. Each phone becomes a
game controller. Grab the most coins before the timer runs out and win.

No app to install. **No game server** — phones talk to the screen directly over
WebRTC. It's just static HTML/CSS/JS, so it hosts anywhere (including GitHub
Pages).

## Play

1. **On the big screen** open `index.html` → **Host a game**. A room code and a
   QR code appear.
2. **On each phone** either:
   - point the camera at the QR code on the screen (it opens the controller with
     the code pre-filled), **or**
   - open the same site → **Join** and type the 4-digit code.
3. The host presses **Start** (or the space/enter key). Move with the on-screen
   joystick, tap **DASH** for a speed burst, and race to collect coins.

## How it works

| Page | Role |
|------|------|
| `index.html` | Landing page — choose Host or Join |
| `host.html` / `js/host.js` | The big screen. Runs the authoritative game loop and rendering, shows the QR + room code and the live scoreboard. |
| `play.html` / `js/controller.js` | The phone. Join form, then a joystick + dash button that streams input to the host. |
| `js/net.js` | Thin WebRTC layer. The 4-digit code maps to the host's peer id, so a phone that knows the code can dial the host directly. |

Networking uses [PeerJS](https://peerjs.com/) (its free public broker is used
only to introduce peers; gameplay data flows peer-to-peer) and
[qrcode](https://www.npmjs.com/package/qrcode) for the join QR — both loaded
from a CDN.

### Notes

- Modern browser required (Chrome, Safari, Edge, Firefox) — WebRTC must be
  available. Serve over **HTTPS** (or `localhost`) so WebRTC works.
- The public broker is best for casual play. For a production deployment you can
  point PeerJS at your own [peer server](https://github.com/peers/peerjs-server)
  by passing a config in `js/net.js`.

## Run locally

Any static file server works, for example:

```bash
python3 -m http.server 8000
# then open http://localhost:8000 on the big screen,
# and http://<your-computer-ip>:8000 on phones on the same network
```

## Deploy on GitHub Pages

Enable Pages for this repo (Settings → Pages → deploy from branch). The site is
plain static files at the repo root, so it works as-is.
