/*
 * controller.js — the phone controller. A join form, then an on-screen
 * joystick + dash button that streams input to the host over WebRTC.
 */
(function () {
  'use strict';

  const joinView = document.getElementById('joinView');
  const padView = document.getElementById('padView');
  const codeInput = document.getElementById('codeInput');
  const nameInput = document.getElementById('nameInput');
  const joinBtn = document.getElementById('joinBtn');
  const msg = document.getElementById('msg');

  const swatch = document.getElementById('swatch');
  const myName = document.getElementById('myName');
  const myScore = document.getElementById('myScore');
  const padStatus = document.getElementById('padStatus');
  const padHint = document.getElementById('padHint');
  const stick = document.getElementById('stick');
  const knob = document.getElementById('knob');
  const actionBtn = document.getElementById('actionBtn');

  const DASH_COOLDOWN_MS = 1800;
  const SEND_INTERVAL_MS = 50;

  const net = new GuestNet();
  let connected = false;
  let lastSent = 0;
  let lastVec = { x: 0, y: 0 };

  /* ---------- Prefill from QR / URL ---------- */
  const params = new URLSearchParams(location.search);
  const preCode = (params.get('code') || '').replace(/\D/g, '').slice(0, 4);
  if (preCode) codeInput.value = preCode;
  try {
    const savedName = localStorage.getItem('arcadeName');
    if (savedName) nameInput.value = savedName;
  } catch (e) {}

  function setMsg(text, kind) {
    msg.textContent = text || '';
    msg.className = 'msg' + (kind ? ' ' + kind : '');
  }

  /* ---------- Join flow ---------- */
  function doJoin() {
    const code = (codeInput.value || '').replace(/\D/g, '').slice(0, 4);
    const name = (nameInput.value || '').trim().slice(0, 12) || 'Player';
    if (code.length !== 4) {
      setMsg('Enter the 4-digit room code shown on the screen.', 'err');
      codeInput.focus();
      return;
    }
    try { localStorage.setItem('arcadeName', name); } catch (e) {}

    joinBtn.disabled = true;
    setMsg('Connecting to room ' + code + '…', 'ok');

    net.onOpen = () => {
      connected = true;
      setMsg('', '');
      myName.textContent = name;
      joinView.style.display = 'none';
      padView.classList.add('active');
    };
    net.onData = handleData;
    net.onClose = () => {
      connected = false;
      backToJoin('Disconnected from the game. Rejoin when you\'re ready.');
    };
    net.onError = (reason) => {
      joinBtn.disabled = false;
      if (reason === 'no-room') {
        setMsg('No game found with code ' + code + '. Double-check the code on the screen.', 'err');
      } else if (reason === 'unsupported') {
        setMsg('This browser can\'t connect. Try Chrome or Safari.', 'err');
      } else {
        setMsg('Connection failed. Check your internet and try again.', 'err');
      }
    };

    net.connect(code, name);
  }

  function backToJoin(text) {
    padView.classList.remove('active');
    joinView.style.display = '';
    joinBtn.disabled = false;
    resetStick();
    setMsg(text || '', text ? 'err' : '');
  }

  function handleData(d) {
    if (!d || typeof d !== 'object') return;
    if (d.type === 'welcome') {
      if (d.color) {
        swatch.style.background = d.color;
        swatch.style.color = d.color;
      }
      if (d.name) myName.textContent = d.name;
      updatePhase(d.phase);
    } else if (d.type === 'phase') {
      updatePhase(d.phase);
    } else if (d.type === 'score') {
      myScore.textContent = d.score;
    }
  }

  function updatePhase(phase) {
    if (phase === 'playing') {
      padStatus.textContent = '● live';
      padHint.innerHTML = 'Grab the coins! Drag to move · tap <b>DASH</b>';
    } else if (phase === 'results') {
      padStatus.textContent = 'round over';
      padHint.textContent = 'Round finished — wait for the next one to start.';
    } else {
      padStatus.textContent = 'in lobby';
      padHint.innerHTML = 'Waiting for the host to start the round…';
    }
  }

  joinBtn.addEventListener('click', doJoin);
  codeInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); nameInput.focus(); } });
  nameInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); doJoin(); } });

  /* ---------- Joystick ---------- */
  let activeId = null;

  function sendVec(x, y, force) {
    lastVec.x = x; lastVec.y = y;
    const now = Date.now();
    if (!force && now - lastSent < SEND_INTERVAL_MS) return;
    lastSent = now;
    net.send({ type: 'input', x: x, y: y });
  }

  function moveKnob(clientX, clientY) {
    const rect = stick.getBoundingClientRect();
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    let dx = clientX - cx;
    let dy = clientY - cy;
    const maxDist = rect.width * 0.42;   // full deflection distance
    const dist = Math.hypot(dx, dy);
    // Vector for the game (magnitude 0..1)
    let vx = dx / maxDist;
    let vy = dy / maxDist;
    const vm = Math.hypot(vx, vy);
    if (vm > 1) { vx /= vm; vy /= vm; }
    // Knob visual position (kept inside the base)
    const knobLimit = rect.width * 0.29;
    let ox = dx, oy = dy;
    if (dist > knobLimit) { ox = dx / dist * knobLimit; oy = dy / dist * knobLimit; }
    knob.style.transform = 'translate(calc(-50% + ' + ox + 'px), calc(-50% + ' + oy + 'px))';
    sendVec(vx, vy, false);
  }

  function resetStick() {
    knob.style.transform = 'translate(-50%, -50%)';
    activeId = null;
    if (connected) sendVec(0, 0, true);
  }

  stick.addEventListener('pointerdown', (e) => {
    if (activeId !== null) return;
    activeId = e.pointerId;
    stick.setPointerCapture(e.pointerId);
    moveKnob(e.clientX, e.clientY);
    e.preventDefault();
  });
  stick.addEventListener('pointermove', (e) => {
    if (e.pointerId !== activeId) return;
    moveKnob(e.clientX, e.clientY);
    e.preventDefault();
  });
  function endStick(e) {
    if (e.pointerId !== activeId) return;
    resetStick();
    e.preventDefault();
  }
  stick.addEventListener('pointerup', endStick);
  stick.addEventListener('pointercancel', endStick);
  stick.addEventListener('lostpointercapture', () => { if (activeId !== null) resetStick(); });

  /* ---------- Dash button ---------- */
  actionBtn.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    if (!connected || actionBtn.disabled) return;
    net.send({ type: 'dash' });
    if (navigator.vibrate) navigator.vibrate(30);
    actionBtn.disabled = true;
    setTimeout(() => { actionBtn.disabled = false; }, DASH_COOLDOWN_MS);
  });

  // Keyboard support for testing the controller on a laptop.
  window.addEventListener('keydown', (e) => {
    if (!connected) return;
    const k = e.key;
    let x = 0, y = 0;
    if (k === 'ArrowLeft' || k === 'a') x = -1;
    else if (k === 'ArrowRight' || k === 'd') x = 1;
    else if (k === 'ArrowUp' || k === 'w') y = -1;
    else if (k === 'ArrowDown' || k === 's') y = 1;
    else if (k === ' ') { net.send({ type: 'dash' }); e.preventDefault(); return; }
    else return;
    e.preventDefault();
    sendVec(x, y, true);
  });
  window.addEventListener('keyup', (e) => {
    if (!connected) return;
    if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'a', 'd', 'w', 's'].includes(e.key)) {
      sendVec(0, 0, true);
    }
  });

  // Guard against the whole page scrolling on touch.
  document.addEventListener('touchmove', (e) => { if (padView.classList.contains('active')) e.preventDefault(); }, { passive: false });

  // Let the host drop us immediately when the phone leaves the page.
  window.addEventListener('pagehide', () => { if (connected) net.close(); });

  if (typeof Peer === 'undefined') {
    setMsg('Could not load the networking library. Check your connection and reload.', 'err');
    joinBtn.disabled = true;
  }
})();
