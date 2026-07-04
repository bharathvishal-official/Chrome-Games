/*
 * host.js — the big-screen game. Runs the authoritative simulation for
 * "Coin Rush Arena" and renders it. Phones connect as controllers via net.js.
 */
(function () {
  'use strict';

  const canvas = document.getElementById('gameCanvas');
  const ctx = canvas.getContext('2d');
  const scoreRows = document.getElementById('scoreRows');
  const codeEl = document.getElementById('code');
  const qrEl = document.getElementById('qr');
  const joinUrlEl = document.getElementById('joinurl');
  const timerEl = document.getElementById('timer');
  const overlay = document.getElementById('overlay');
  const ovTitle = document.getElementById('ovTitle');
  const ovSub = document.getElementById('ovSub');
  const ovResults = document.getElementById('ovResults');
  const startBtn = document.getElementById('startBtn');
  const soloBtn = document.getElementById('soloBtn');

  // ---- Tunables ----
  const ROUND_SECONDS = 90;
  const PLAYER_R = 22;
  const COIN_R = 14;
  const BASE_SPEED = 320;        // px / second
  const DASH_SPEED = 720;
  const DASH_TIME = 0.22;        // seconds of boost
  const DASH_COOLDOWN = 1.8;     // seconds
  const FRICTION = 0.86;

  const PALETTE = [
    '#37e6c9', '#ff5da2', '#ffd166', '#6a8cff',
    '#b78bff', '#7CFC7C', '#ff8b3d', '#57d1ff',
  ];

  let W = 0, H = 0;
  let phase = 'lobby'; // 'lobby' | 'playing' | 'results'
  let roundEndsAt = 0;
  let lastScoreSync = 0;
  const players = new Map(); // peerId -> player
  let coins = [];
  let colorCursor = 0;
  let soloId = null;          // id of the local keyboard player (single-player)
  const keysDown = {};        // currently-held keys for the solo player

  // Optional debug hook (only with ?dbg=1) for automated testing.
  if (location.search.indexOf('dbg=1') !== -1) {
    window.__arcade = { players, keysDown, get soloId() { return soloId; }, get phase() { return phase; }, get coins() { return coins; } };
  }

  /* ---------------- Canvas sizing ---------------- */
  function resize() {
    W = window.innerWidth;
    H = window.innerHeight;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.floor(W * dpr);
    canvas.height = Math.floor(H * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    // Keep everyone inside the new bounds.
    players.forEach((p) => {
      p.x = clamp(p.x, PLAYER_R, W - PLAYER_R);
      p.y = clamp(p.y, PLAYER_R, H - PLAYER_R);
    });
  }
  window.addEventListener('resize', resize);

  function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }
  function rand(a, b) { return a + Math.random() * (b - a); }

  /* ---------------- Networking ---------------- */
  const net = new HostNet();

  net.onError = (message) => {
    // Online multiplayer is unavailable, but solo play still works — so we
    // just note it in the join box instead of blocking the whole screen.
    codeEl.textContent = '—';
    const hint = document.querySelector('.joinbox .hint');
    if (hint) hint.textContent = message;
  };

  net.onReady = (code) => {
    codeEl.textContent = code;
    const joinUrl = new URL('play.html?code=' + code, location.href).href;
    const displayUrl = new URL('play.html', location.href).href.replace(/^https?:\/\//, '');
    joinUrlEl.textContent = displayUrl;
    renderQR(joinUrl);
  };

  net.onJoin = (peerId, name) => {
    let p = players.get(peerId);
    if (!p) {
      p = makePlayer(peerId, name);
      players.set(peerId, p);
    } else {
      p.name = name;
    }
    net.send(peerId, {
      type: 'welcome',
      color: p.color,
      name: p.name,
      phase: phase,
    });
    net.send(peerId, { type: 'score', score: p.score });
    refreshScoreboard();
    refreshStartButton();
  };

  net.onLeave = (peerId) => {
    players.delete(peerId);
    refreshScoreboard();
    refreshStartButton();
  };

  net.onInput = (peerId, msg) => {
    const p = players.get(peerId);
    if (!p) return;
    if (msg.type === 'input') {
      let x = Number(msg.x) || 0;
      let y = Number(msg.y) || 0;
      const m = Math.hypot(x, y);
      if (m > 1) { x /= m; y /= m; }
      p.dir.x = x;
      p.dir.y = y;
    } else if (msg.type === 'dash') {
      const now = performance.now() / 1000;
      if (now >= p.dashReadyAt && phase === 'playing') {
        p.dashUntil = now + DASH_TIME;
        p.dashReadyAt = now + DASH_COOLDOWN;
      }
    }
  };

  function makePlayer(peerId, name) {
    const color = PALETTE[colorCursor % PALETTE.length];
    colorCursor++;
    return {
      id: peerId,
      name: name,
      color: color,
      x: rand(W * 0.3, W * 0.7),
      y: rand(H * 0.35, H * 0.7),
      vx: 0, vy: 0,
      dir: { x: 0, y: 0 },
      score: 0,
      dashUntil: 0,
      dashReadyAt: 0,
      pop: 0, // grow animation when scoring
    };
  }

  function renderQR(url) {
    qrEl.innerHTML = '';
    try {
      const qr = qrcode(0, 'M');   // type 0 = auto-size, error correction level M
      qr.addData(url);
      qr.make();
      const img = document.createElement('img');
      img.src = qr.createDataURL(6, 8); // cellSize, quiet-zone margin (px)
      img.width = 128;
      img.height = 128;
      img.alt = 'Scan to join';
      qrEl.appendChild(img);
    } catch (e) {
      // Fallback: just show the link if QR generation failed for any reason.
      qrEl.innerHTML = '<div style="font-size:11px;color:#333;padding:8px;word-break:break-all">' + url + '</div>';
    }
  }

  /* ---------------- Scoreboard / overlay UI ---------------- */
  function sortedPlayers() {
    return [...players.values()].sort((a, b) => b.score - a.score);
  }

  function refreshScoreboard() {
    const list = sortedPlayers();
    if (list.length === 0) {
      scoreRows.innerHTML = '<div class="empty">Waiting for players…</div>';
      return;
    }
    scoreRows.innerHTML = list.map((p) =>
      '<div class="row">' +
      '<span class="swatch" style="background:' + p.color + '"></span>' +
      '<span class="nm">' + escapeHtml(p.name) + '</span>' +
      '<span class="sc">' + p.score + '</span>' +
      '</div>'
    ).join('');
  }

  function refreshStartButton() {
    if (phase === 'playing') return;
    const n = players.size;
    if (n === 0) {
      startBtn.disabled = true;
      startBtn.textContent = 'Waiting for players…';
    } else {
      startBtn.disabled = false;
      startBtn.textContent = phase === 'results'
        ? 'Play again (' + n + ' ' + (n === 1 ? 'player' : 'players') + ')'
        : 'Start round (' + n + ' ' + (n === 1 ? 'player' : 'players') + ')';
    }
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, (c) => (
      { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
    ));
  }

  /* ---------------- Round flow ---------------- */
  function startRound() {
    if (players.size === 0) return;
    phase = 'playing';
    roundEndsAt = performance.now() / 1000 + ROUND_SECONDS;
    players.forEach((p) => {
      p.score = 0;
      p.dashUntil = 0;
      p.dashReadyAt = 0;
      p.x = rand(W * 0.2, W * 0.8);
      p.y = rand(H * 0.3, H * 0.8);
    });
    coins = [];
    ensureCoins();
    overlay.classList.add('hidden');
    ovResults.style.display = 'none';
    timerEl.style.display = 'block';
    refreshScoreboard();
    net.broadcast({ type: 'phase', phase: 'playing' });
    players.forEach((p) => net.send(p.id, { type: 'score', score: 0 }));
  }

  function endRound() {
    phase = 'results';
    timerEl.style.display = 'none';
    const list = sortedPlayers();
    ovResults.innerHTML = list.map((p, i) =>
      '<li>' +
      '<span class="rank">' + (i === 0 ? '🏆' : '#' + (i + 1)) + '</span>' +
      '<span class="swatch" style="background:' + p.color + '"></span>' +
      '<span>' + escapeHtml(p.name) + '</span>' +
      '<span class="sc">' + p.score + '</span>' +
      '</li>'
    ).join('');
    ovResults.style.display = 'block';
    const winner = list[0];
    ovTitle.textContent = winner ? (escapeHtml(winner.name) + ' wins! 🎉') : 'Round over';
    ovSub.textContent = winner
      ? 'Grabbed ' + winner.score + ' coin' + (winner.score === 1 ? '' : 's') + '. Ready for a rematch?'
      : 'Nobody scored — try again!';
    overlay.classList.remove('hidden');
    startBtn.style.display = '';
    refreshStartButton();
    net.broadcast({ type: 'phase', phase: 'results' });
  }

  startBtn.addEventListener('click', startRound);

  // ---- Single-player: a local avatar driven by this screen's keyboard ----
  function ensureSoloPlayer() {
    if (soloId && players.has(soloId)) return;
    soloId = 'solo-local';
    players.set(soloId, makePlayer(soloId, 'You'));
    refreshScoreboard();
    refreshStartButton();
  }
  soloBtn.addEventListener('click', () => {
    ensureSoloPlayer();
    startRound();
  });

  const MOVE_KEYS = ['arrowup', 'arrowdown', 'arrowleft', 'arrowright', 'w', 'a', 's', 'd'];
  window.addEventListener('keydown', (e) => {
    // Enter starts (or restarts) a round from the lobby / results screen.
    if (e.key === 'Enter' && phase !== 'playing') {
      e.preventDefault();
      if (players.size === 0) ensureSoloPlayer();
      startRound();
      return;
    }
    const k = e.key.toLowerCase();
    if (e.key === ' ') {
      // Space = dash for the solo player (once we have one).
      if (!soloId) return;
      e.preventDefault();
      const p = players.get(soloId);
      if (p && phase === 'playing') {
        const now = performance.now() / 1000;
        if (now >= p.dashReadyAt) { p.dashUntil = now + DASH_TIME; p.dashReadyAt = now + DASH_COOLDOWN; }
      }
      return;
    }
    if (MOVE_KEYS.includes(k)) {
      keysDown[k] = true;
      if (soloId) e.preventDefault();
    }
  });
  window.addEventListener('keyup', (e) => {
    const k = e.key.toLowerCase();
    if (MOVE_KEYS.includes(k)) { keysDown[k] = false; if (soloId) e.preventDefault(); }
  });

  /* ---------------- Coins ---------------- */
  function targetCoinCount() {
    return Math.max(5, players.size * 2);
  }
  function spawnCoin() {
    coins.push({
      x: rand(70, W - 70),
      y: rand(140, H - 70),
      born: performance.now() / 1000,
    });
  }
  function ensureCoins() {
    const target = targetCoinCount();
    while (coins.length < target) spawnCoin();
    if (coins.length > target) coins.length = target;
  }

  /* ---------------- Simulation ---------------- */
  function update(dt, nowSec) {
    if (phase === 'playing') {
      ensureCoins();

      // Drive the local solo player from the held keys.
      if (soloId && players.has(soloId)) {
        let x = 0, y = 0;
        if (keysDown['arrowleft'] || keysDown['a']) x -= 1;
        if (keysDown['arrowright'] || keysDown['d']) x += 1;
        if (keysDown['arrowup'] || keysDown['w']) y -= 1;
        if (keysDown['arrowdown'] || keysDown['s']) y += 1;
        const m = Math.hypot(x, y);
        if (m > 1) { x /= m; y /= m; }
        const sp = players.get(soloId);
        sp.dir.x = x;
        sp.dir.y = y;
      }

      players.forEach((p) => {
        const dashing = nowSec < p.dashUntil;
        const speed = dashing ? DASH_SPEED : BASE_SPEED;
        p.vx = p.dir.x * speed;
        p.vy = p.dir.y * speed;
        if (p.dir.x === 0 && p.dir.y === 0) {
          p.vx *= FRICTION;
          p.vy *= FRICTION;
        }
        p.x = clamp(p.x + p.vx * dt, PLAYER_R, W - PLAYER_R);
        p.y = clamp(p.y + p.vy * dt, PLAYER_R, H - PLAYER_R);
        if (p.pop > 0) p.pop = Math.max(0, p.pop - dt * 3);

        // Coin pickups
        for (let i = coins.length - 1; i >= 0; i--) {
          const c = coins[i];
          if (Math.hypot(p.x - c.x, p.y - c.y) < PLAYER_R + COIN_R) {
            coins.splice(i, 1);
            p.score++;
            p.pop = 1;
            spawnCoin();
          }
        }
      });

      // Timer + score sync
      if (nowSec - lastScoreSync > 0.4) {
        lastScoreSync = nowSec;
        players.forEach((p) => net.send(p.id, { type: 'score', score: p.score }));
        refreshScoreboard();
      }
      const remain = roundEndsAt - nowSec;
      updateTimer(remain);
      if (remain <= 0) endRound();
    }
  }

  function updateTimer(remain) {
    remain = Math.max(0, remain);
    const m = Math.floor(remain / 60);
    const s = Math.floor(remain % 60);
    timerEl.textContent = m + ':' + String(s).padStart(2, '0');
    timerEl.classList.toggle('low', remain <= 10);
  }

  /* ---------------- Rendering ---------------- */
  function draw(nowSec) {
    ctx.clearRect(0, 0, W, H);

    // Backdrop grid
    ctx.save();
    ctx.strokeStyle = 'rgba(255,255,255,0.04)';
    ctx.lineWidth = 1;
    const grid = 48;
    for (let x = 0; x < W; x += grid) {
      ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke();
    }
    for (let y = 0; y < H; y += grid) {
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke();
    }
    ctx.restore();

    // Coins
    for (const c of coins) {
      const pulse = 1 + 0.12 * Math.sin((nowSec - c.born) * 5);
      ctx.save();
      ctx.translate(c.x, c.y);
      ctx.scale(pulse, pulse);
      ctx.shadowColor = '#ffd166';
      ctx.shadowBlur = 18;
      ctx.beginPath();
      ctx.arc(0, 0, COIN_R, 0, Math.PI * 2);
      ctx.fillStyle = '#ffd166';
      ctx.fill();
      ctx.beginPath();
      ctx.arc(-COIN_R * 0.28, -COIN_R * 0.28, COIN_R * 0.32, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(255,255,255,0.75)';
      ctx.shadowBlur = 0;
      ctx.fill();
      ctx.restore();
    }

    // Players
    players.forEach((p) => {
      const dashing = nowSec < p.dashUntil;
      const r = PLAYER_R * (1 + p.pop * 0.25);
      ctx.save();
      ctx.shadowColor = p.color;
      ctx.shadowBlur = dashing ? 34 : 16;
      ctx.beginPath();
      ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
      ctx.fillStyle = p.color;
      ctx.fill();
      // inner highlight
      ctx.shadowBlur = 0;
      ctx.beginPath();
      ctx.arc(p.x - r * 0.3, p.y - r * 0.3, r * 0.35, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(255,255,255,0.35)';
      ctx.fill();
      ctx.restore();

      // Name + score label
      ctx.save();
      ctx.font = '700 15px "Segoe UI", system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'bottom';
      const label = p.name + '  ' + p.score;
      ctx.lineWidth = 4;
      ctx.strokeStyle = 'rgba(0,0,0,0.55)';
      ctx.strokeText(label, p.x, p.y - r - 6);
      ctx.fillStyle = '#fff';
      ctx.fillText(label, p.x, p.y - r - 6);
      ctx.restore();
    });
  }

  /* ---------------- Main loop ---------------- */
  let last = performance.now();
  function frame(now) {
    const nowSec = now / 1000;
    let dt = (now - last) / 1000;
    last = now;
    if (dt > 0.05) dt = 0.05; // clamp big gaps (tab switch)
    update(dt, nowSec);
    draw(nowSec);
    requestAnimationFrame(frame);
  }

  /* ---------------- Boot ---------------- */
  function boot() {
    resize();
    requestAnimationFrame(frame);
    if (typeof Peer === 'undefined') {
      // Networking library missing: online join is off, solo still available.
      net.onError('Online join unavailable — you can still play solo below.');
      return;
    }
    net.start();
  }
  boot();
})();
