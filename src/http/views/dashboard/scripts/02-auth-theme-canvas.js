// ============================================================================
// HỆ THỐNG XÁC THỰC & PHÂN QUYỀN ĐA NGƯỜI DÙNG (CLIENT RBAC)
// ============================================================================

const kbotReducedMotionQuery = typeof window.matchMedia === 'function'
  ? window.matchMedia('(prefers-reduced-motion: reduce)')
  : { matches: false };

let _cachedDashboardTheme = null;
let _cachedBgEffectsDisabled = null;

function isDashboardBgEffectsDisabled() {
  if (_cachedBgEffectsDisabled !== null) return _cachedBgEffectsDisabled;
  try {
    _cachedBgEffectsDisabled = localStorage.getItem('kbot_bg_effects_off') === '1';
  } catch (_) {
    _cachedBgEffectsDisabled = false;
  }
  return _cachedBgEffectsDisabled;
}

function toggleDashboardBgEffects() {
  const nextDisabled = !isDashboardBgEffectsDisabled();
  _cachedBgEffectsDisabled = nextDisabled;
  try { localStorage.setItem('kbot_bg_effects_off', nextDisabled ? '1' : '0'); } catch (_) {}
  document.body.classList.toggle('cosmic-mode-off', nextDisabled);
  const btn = document.getElementById('bgEffectsToggleBtn');
  if (btn) {
    btn.textContent = nextDisabled ? 'Bật hiệu ứng nền' : 'Tắt hiệu ứng nền';
    btn.setAttribute('aria-pressed', nextDisabled ? 'true' : 'false');
  }
  if (typeof window.__kbotRefreshAppCosmicEngine === 'function') {
    window.__kbotRefreshAppCosmicEngine();
  }
  if (typeof showToast === 'function') {
    showToast(nextDisabled ? 'Đã tắt hiệu ứng nền để tiết kiệm pin và GPU.' : 'Đã bật lại hiệu ứng nền.', 'info');
  }
}
window.toggleDashboardBgEffects = toggleDashboardBgEffects;

function showLoginGate() {
  document.getElementById('loginGate')?.classList.remove('hidden');
  document.body.classList.add('cosmic-mode-login');
  const closeBtn = document.getElementById('loginGateCloseBtn');
  if (closeBtn) closeBtn.style.display = currentUser ? 'block' : 'none';
}

function normalizeDashboardTheme(mode) {
  var m = String(mode || '').trim();
  var map = {
    'deep-galaxy': 'deep-galaxy',
    'galaxy': 'deep-galaxy',
    'vivid': 'deep-galaxy',
    'ocean-abyss': 'ocean-abyss',
    'ocean': 'ocean-abyss',
    'blue': 'ocean-abyss',
    'deep-ocean': 'ocean-abyss',
    'oceanic': 'ocean-abyss',
    'violet-dusk': 'violet-dusk',
    'sunset': 'violet-dusk',
    'subtle': 'violet-dusk',
    'off': 'violet-dusk',
    'moonlight': 'moonlight',
    'morning': 'moonlight',
    'light': 'moonlight'
  };
  return map[m] || 'deep-galaxy';
}

function getSavedDashboardTheme() {
  if (_cachedDashboardTheme) return _cachedDashboardTheme;
  try {
    _cachedDashboardTheme = normalizeDashboardTheme(
      localStorage.getItem('kbot_theme') ||
      localStorage.getItem('kbot_dashboard_theme') ||
      localStorage.getItem('kbot_cosmic_mode') ||
      'deep-galaxy'
    );
    return _cachedDashboardTheme;
  } catch (_) {
    _cachedDashboardTheme = 'deep-galaxy';
    return _cachedDashboardTheme;
  }
}

function hideLoginGate() {
  if (!currentUser) return;
  document.getElementById('loginGate')?.classList.add('hidden');
  document.body.classList.remove('cosmic-mode-login');
  applyDashboardCosmicMode(getSavedDashboardTheme());
}

function applyDashboardCosmicMode(mode) {
  var theme = normalizeDashboardTheme(mode);
  _cachedDashboardTheme = theme;

  try {
    localStorage.setItem('kbot_theme', theme);
    localStorage.setItem('kbot_dashboard_theme', theme);
    localStorage.setItem('kbot_cosmic_mode', theme);
  } catch (_) {}

  if (document.documentElement) {
    document.documentElement.setAttribute('data-theme', theme);
    document.documentElement.style.colorScheme = theme === 'moonlight' ? 'light' : 'dark';
  }

  document.body.classList.remove(
    'theme-galaxy', 'theme-sunset', 'theme-morning', 'theme-off',
    'theme-deep-galaxy', 'theme-ocean-abyss', 'theme-violet-dusk', 'theme-moonlight',
    'cosmic-mode-vivid', 'cosmic-mode-subtle'
  );
  document.body.classList.add('theme-' + theme);
  const bgOff = typeof isDashboardBgEffectsDisabled === 'function' ? isDashboardBgEffectsDisabled() : false;
  if (bgOff) document.body.classList.add('cosmic-mode-off');
  else document.body.classList.remove('cosmic-mode-off');
  const bgBtn = document.getElementById('bgEffectsToggleBtn');
  if (bgBtn) {
    bgBtn.textContent = bgOff ? 'Bật hiệu ứng nền' : 'Tắt hiệu ứng nền';
    bgBtn.setAttribute('aria-pressed', bgOff ? 'true' : 'false');
  }

  var themeBtns = document.querySelectorAll('[data-theme-choice]');
  themeBtns.forEach(function(el) {
    var active = el.getAttribute('data-theme-choice') === theme;
    el.classList.toggle('active', active);
    el.setAttribute('aria-pressed', active ? 'true' : 'false');
  });

  var btn = document.getElementById('cosmicModeToggleBtn');
  if (btn) {
    if (theme === 'deep-galaxy') {
      btn.textContent = 'Deep Galaxy';
      btn.title = 'Theme: Deep Galaxy — Bấm để chuyển sang Ocean Abyss';
    } else if (theme === 'ocean-abyss') {
      btn.textContent = 'Ocean Abyss';
      btn.title = 'Theme: Ocean Abyss — Bấm để chuyển sang Violet Dusk';
    } else if (theme === 'violet-dusk') {
      btn.textContent = 'Violet Dusk';
      btn.title = 'Theme: Violet Dusk — Bấm để chuyển sang Moonlight';
    } else {
      btn.textContent = 'Moonlight';
      btn.title = 'Theme: Moonlight — Bấm để chuyển sang Deep Galaxy';
    }
  }

  if (typeof window.__kbotRefreshAppCosmicEngine === 'function') {
    window.__kbotRefreshAppCosmicEngine();
  }
}

function cycleDashboardCosmicMode() {
  var current = getSavedDashboardTheme();
  var themeOrder = ['deep-galaxy', 'ocean-abyss', 'violet-dusk', 'moonlight'];
  var idx = themeOrder.indexOf(current);
  var next = idx >= 0 ? themeOrder[(idx + 1) % themeOrder.length] : 'ocean-abyss';
  applyDashboardCosmicMode(next);
  if (typeof showToast === 'function') {
    var toastMap = {
      'deep-galaxy': 'Đã chuyển sang Deep Galaxy (Tối tiêu chuẩn)',
      'ocean-abyss': 'Đã chuyển sang Ocean Abyss (Xanh biển sâu)',
      'violet-dusk': 'Đã chuyển sang Violet Dusk (Tím trầm dịu mắt)',
      'moonlight': 'Đã chuyển sang Moonlight (Giao diện sáng)'
    };
    showToast(toastMap[next] || 'Đã chuyển đổi giao diện', 'info');
  }
}
window.cycleDashboardCosmicMode = cycleDashboardCosmicMode;
window.applyDashboardCosmicMode = applyDashboardCosmicMode;

function toggleSidebarCollapse() {
  var collapsed = document.body.classList.toggle('sidebar-collapsed');
  try { localStorage.setItem('kbot_sidebar_collapsed', collapsed ? '1' : '0'); } catch (_) {}
}
window.toggleSidebarCollapse = toggleSidebarCollapse;

function toggleMobileSidebar() {
  var sidebar = document.getElementById('appSidebar');
  var backdrop = document.getElementById('appSidebarBackdrop');
  if (!sidebar) return;
  var open = sidebar.classList.toggle('is-open');
  if (backdrop) backdrop.classList.toggle('hidden', !open);
}
window.toggleMobileSidebar = toggleMobileSidebar;

function closeMobileSidebar() {
  var sidebar = document.getElementById('appSidebar');
  var backdrop = document.getElementById('appSidebarBackdrop');
  if (sidebar) sidebar.classList.remove('is-open');
  if (backdrop) backdrop.classList.add('hidden');
}
window.closeMobileSidebar = closeMobileSidebar;

try {
  if (localStorage.getItem('kbot_sidebar_collapsed') === '1' && window.innerWidth > 1024) {
    document.body.classList.add('sidebar-collapsed');
  }
} catch (_) {}

function getOceanEntities() {
  var root = (typeof window !== 'undefined') ? window : (typeof globalThis !== 'undefined' ? globalThis : {});
  if (!root._kbotOceanEntities) {
    var fish = [];
    var fCount = 8;
    for (var f = 0; f < fCount; f++) {
      fish.push({
        x: Math.random() * (root.innerWidth || 800),
        y: Math.random() * (root.innerHeight || 600),
        baseY: Math.random() * (root.innerHeight || 600),
        speed: 1.6 + Math.random() * 1.6,
        freq: 0.03 + Math.random() * 0.04,
        amp: 10 + Math.random() * 14,
        phase: Math.random() * Math.PI * 2,
        size: 10 + Math.random() * 6,
        color: f % 2 === 0 ? 'rgba(56, 189, 248, 0.92)' : 'rgba(52, 211, 153, 0.90)',
        tailColor: f % 2 === 0 ? 'rgba(14, 165, 233, 0.85)' : 'rgba(16, 185, 129, 0.85)'
      });
    }
    var jellyfish = [];
    var jCount = 3;
    for (var j = 0; j < jCount; j++) {
      jellyfish.push({
        x: Math.random() * (root.innerWidth || 800),
        y: Math.random() * (root.innerHeight || 600),
        scale: 0.85 + Math.random() * 0.35,
        pulsePhase: Math.random() * Math.PI * 2,
        tentacles: 5,
        speed: 0.35 + Math.random() * 0.35
      });
    }
    root._kbotOceanEntities = { fish: fish, jellyfish: jellyfish };
  }
  return root._kbotOceanEntities;
}
if (typeof window !== 'undefined') window.getOceanEntities = getOceanEntities;

function drawAquariumFish(ctx, f) {
  ctx.save();
  ctx.translate(f.x, f.y);
  var angle = Math.atan2(Math.cos(f.phase) * ((f.amp || 12) * (f.freq || 0.04)), f.speed || 1.8);
  ctx.rotate(angle);
  var sz = f.size || 12;

  // Fish Body (smooth ellipse)
  ctx.beginPath();
  ctx.ellipse(0, 0, sz, sz * 0.45, 0, 0, Math.PI * 2);
  ctx.fillStyle = f.color || 'rgba(56, 189, 248, 0.9)';
  ctx.fill();

  // Waving Tail Fin
  var wag = Math.sin(f.phase * 3.2) * (sz * 0.28);
  ctx.beginPath();
  ctx.moveTo(-sz * 0.8, 0);
  ctx.lineTo(-sz * 1.55, -sz * 0.42 + wag);
  ctx.lineTo(-sz * 1.3, wag * 0.5);
  ctx.lineTo(-sz * 1.55, sz * 0.42 + wag);
  ctx.closePath();
  ctx.fillStyle = f.tailColor || 'rgba(14, 165, 233, 0.8)';
  ctx.fill();

  // Little Eye
  ctx.beginPath();
  ctx.arc(sz * 0.55, -sz * 0.12, Math.max(1, sz * 0.14), 0, Math.PI * 2);
  ctx.fillStyle = '#ffffff';
  ctx.fill();
  ctx.beginPath();
  ctx.arc(sz * 0.6, -sz * 0.12, Math.max(0.6, sz * 0.08), 0, Math.PI * 2);
  ctx.fillStyle = '#0f172a';
  ctx.fill();

  ctx.restore();
}
window.drawAquariumFish = drawAquariumFish;

function drawAquariumJellyfish(ctx, jf) {
  ctx.save();
  ctx.translate(jf.x, jf.y);
  var scale = jf.scale || 1;
  var r = 16 * scale;

  // Bell Dome
  ctx.beginPath();
  ctx.arc(0, 0, r, Math.PI, 0, false);
  ctx.quadraticCurveTo(0, r * 0.22, -r, 0);
  ctx.fillStyle = 'rgba(192, 132, 252, 0.45)';
  ctx.fill();
  ctx.strokeStyle = 'rgba(232, 121, 249, 0.65)';
  ctx.lineWidth = 1.2;
  ctx.stroke();

  // Trailing Tentacles
  ctx.strokeStyle = 'rgba(216, 180, 254, 0.45)';
  ctx.lineWidth = 1;
  for (var k = -2; k <= 2; k++) {
    var tx = k * (r * 0.35);
    var wave = Math.sin(jf.pulsePhase + k * 1.1) * (r * 0.32);
    ctx.beginPath();
    ctx.moveTo(tx, r * 0.1);
    ctx.quadraticCurveTo(tx + wave, r * 0.85, tx - wave * 0.4, r * 1.7);
    ctx.stroke();
  }
  ctx.restore();
}
window.drawAquariumJellyfish = drawAquariumJellyfish;

function updateFishSchool(fish, w, h, dt) {
  if (!fish || !Array.isArray(fish)) return;
  var delta = typeof dt === 'number' ? dt / 16.667 : 1;
  for (var i = 0; i < fish.length; i++) {
    var f = fish[i];
    f.phase = (f.phase || 0) + (f.freq || 0.05) * delta;
    f.y = (f.baseY !== undefined ? f.baseY : f.y) + Math.sin(f.phase) * (f.amp || 15);
    f.x += (f.speed || 2) * delta;
    if (f.x > (w || 800) + 50) {
      f.x = -50;
      f.baseY = Math.random() * (h || 600);
      f.y = f.baseY;
    }
  }
}
window.updateFishSchool = updateFishSchool;

function updateJellyfish(jellyfish, w, h, dt) {
  if (!jellyfish || !Array.isArray(jellyfish)) return;
  var delta = typeof dt === 'number' ? dt / 16.667 : 1;
  for (var i = 0; i < jellyfish.length; i++) {
    var j = jellyfish[i];
    j.pulsePhase = (j.pulsePhase || 0) + 0.04 * delta;
    j.scale = 1 + Math.sin(j.pulsePhase) * 0.25;
    j.y -= (j.speed || 0.5) * delta;
    if (j.y < -60) {
      j.y = (h || 600) + 60;
      j.x = Math.random() * (w || 800);
    }
  }
}
window.updateJellyfish = updateJellyfish;

function drawCartoonCrescentMoon(ctx, w, h) {
  if (!ctx) return;
  var mx = w ? w * 0.82 : 650;
  var my = h ? Math.min(h * 0.20, 160) : 120;
  var mr = Math.min(w || 800, h || 600) * 0.065;
  if (mr < 28) mr = 28;
  if (mr > 48) mr = 48;

  ctx.save();
  // Outer celestial aura
  ctx.beginPath();
  ctx.arc(mx, my, mr * 1.8, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(254, 240, 138, 0.12)';
  ctx.fill();

  // Crescent shape
  ctx.beginPath();
  ctx.arc(mx, my, mr, -0.42 * Math.PI, 0.62 * Math.PI, false);
  ctx.bezierCurveTo(mx + mr * 0.32, my + mr * 0.48, mx + mr * 0.32, my - mr * 0.48, mx + mr * Math.cos(-0.42 * Math.PI), my + mr * Math.sin(-0.42 * Math.PI));
  ctx.fillStyle = '#fef08a';
  ctx.fill();

  // Cute cartoon sleeping face on crescent
  var eyeX = mx - mr * 0.15;
  var eyeY = my - mr * 0.10;
  ctx.strokeStyle = '#854d0e';
  ctx.lineWidth = 1.6;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.arc(eyeX, eyeY, 3.2, Math.PI * 0.9, Math.PI * 2.1, false);
  ctx.stroke();
  // Cute blush
  ctx.fillStyle = 'rgba(248, 113, 113, 0.45)';
  ctx.beginPath();
  ctx.arc(eyeX - 3, eyeY + 6, 2.5, 0, Math.PI * 2);
  ctx.fill();

  ctx.restore();
}
window.drawCartoonCrescentMoon = drawCartoonCrescentMoon;

function drawAnimeClouds(ctx, w, h, dt) {
  if (!ctx) return;
  var root = (typeof window !== 'undefined') ? window : (typeof globalThis !== 'undefined' ? globalThis : {});
  if (!root._kbotAnimeClouds) {
    root._kbotAnimeClouds = [
      { x: (w || 800) * 0.1, y: (h || 600) * 0.15, r: 40, speed: 0.2 },
      { x: (w || 800) * 0.55, y: (h || 600) * 0.28, r: 55, speed: 0.15 },
      { x: (w || 800) * 0.85, y: (h || 600) * 0.12, r: 35, speed: 0.25 }
    ];
  }
  var clouds = root._kbotAnimeClouds;
  var delta = typeof dt === 'number' ? dt / 16.667 : 1;
  ctx.save();
  for (var i = 0; i < clouds.length; i++) {
    var c = clouds[i];
    c.x += c.speed * delta;
    if (c.x > (w || 800) + 120) c.x = -120;
    ctx.fillStyle = 'rgba(255, 255, 255, 0.18)';
    ctx.beginPath();
    ctx.arc(c.x, c.y, c.r, 0, Math.PI * 2);
    ctx.arc(c.x + c.r * 0.7, c.y - c.r * 0.2, c.r * 0.8, 0, Math.PI * 2);
    ctx.arc(c.x - c.r * 0.7, c.y, c.r * 0.7, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}
if (typeof window !== 'undefined') window.drawAnimeClouds = drawAnimeClouds;

function drawSparkleStar(ctx, x, y, r, alpha) {
  if (!ctx) return;
  ctx.save();
  ctx.fillStyle = 'rgba(254, 240, 138, ' + (alpha || 0.8) + ')';
  ctx.beginPath();
  ctx.moveTo(x, y - r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.quadraticCurveTo(x, y, x, y + r);
  ctx.quadraticCurveTo(x, y, x - r, y);
  ctx.quadraticCurveTo(x, y, x, y - r);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}
window.drawSparkleStar = drawSparkleStar;

(function initAppGalaxyEngine() {
  var savedTheme = getSavedDashboardTheme();
  setTimeout(function() { applyDashboardCosmicMode(savedTheme); }, 10);

  var canvas = document.getElementById('appStarfieldCanvas');
  if (!canvas) return;
  var ctx = canvas.getContext('2d');
  var w = 0, h = 0;
  var rafId = null;
  var isMobile = /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent) || (window.innerWidth <= 768);

  function resize() {
    var prevW = w;
    var prevH = h;
    w = canvas.width = window.innerWidth;
    h = canvas.height = window.innerHeight;
    isMobile = /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent) || (window.innerWidth <= 768);
    if ((prevW === 0 || prevH === 0 || rafId === null) && w > 0 && h > 0 && stars && stars.length) {
      startCosmicLoop();
    }
  }
  window.addEventListener('resize', resize, { passive: true });
  resize();

  var stars = [];
  var starCount = isMobile ? 32 : 56;
function initCosmicStars() {
  stars = [];
  starCount = isMobile ? 32 : 56;
  for (var i = 0; i < starCount; i++) {
    stars.push({
      x: Math.random() * (w || 1920),
      y: Math.random() * (h || 1080),
      z: Math.random() * 1.2 + 0.4,
      r: Math.random() * 0.8 + 0.4,
      a: Math.random() * 0.45 + 0.15,
      da: (Math.random() * 0.005 + 0.002) * (Math.random() < 0.5 ? 1 : -1),
      rgb: Math.random() < 0.7 ? '226,232,240' : '196,181,253',
      seed: Math.random() * 100,
      phase: Math.random() * Math.PI * 2,
      isAnchor: i < 5
    });
  }
}
  initCosmicStars();

  var fpsTimerId = null;
  if (typeof window !== 'undefined' && !window.__kbotLastActivityAt) {
    window.__kbotLastActivityAt = Date.now();
  }

  function shouldRunCosmicLoop() {
    var isOff = isDashboardBgEffectsDisabled() || document.body.classList.contains('cosmic-mode-off') || document.body.classList.contains('theme-off');
    if (document.hidden || isOff || kbotReducedMotionQuery.matches) return false;
    if (typeof document.querySelector === 'function' && document.querySelector('.modal:not(.hidden)')) return false;
    var lastAct = typeof window !== 'undefined' ? Number(window.__kbotLastActivityAt || 0) : 0;
    if (!lastAct) {
      try { if (typeof lastUserActivityAt === 'number') lastAct = lastUserActivityAt; } catch (_) {}
    }
    if (lastAct > 0 && (Date.now() - lastAct > 90000)) return false;
    return true;
  }

  function stopCosmicLoop() {
    if (fpsTimerId !== null) {
      clearTimeout(fpsTimerId);
      fpsTimerId = null;
    }
    if (rafId !== null) {
      cancelAnimationFrame(rafId);
      rafId = null;
    }
    if (ctx) ctx.clearRect(0, 0, w, h);
  }

  function scheduleNextCosmicFrame() {
    if (fpsTimerId !== null || rafId !== null) return;
    fpsTimerId = setTimeout(function() {
      fpsTimerId = null;
      if (!shouldRunCosmicLoop()) {
        stopCosmicLoop();
        return;
      }
      rafId = requestAnimationFrame(render);
    }, 50);
  }

  function startCosmicLoop() {
    if (!shouldRunCosmicLoop()) {
      stopCosmicLoop();
      return;
    }
    if (rafId === null && fpsTimerId === null) {
      rafId = requestAnimationFrame(render);
    }
  }

  window.__kbotRefreshAppCosmicEngine = startCosmicLoop;

  document.addEventListener('visibilitychange', function() {
    if (document.hidden) {
      stopCosmicLoop();
    } else {
      startCosmicLoop();
    }
  });

  var onReducedMotionChange = function(ev) {
    if (ev.matches) {
      stopCosmicLoop();
    } else {
      applyDashboardCosmicMode(getSavedDashboardTheme());
      startCosmicLoop();
    }
  };
  if (typeof kbotReducedMotionQuery.addEventListener === 'function') {
    kbotReducedMotionQuery.addEventListener('change', onReducedMotionChange);
  } else if (typeof kbotReducedMotionQuery.addListener === 'function') {
    kbotReducedMotionQuery.addListener(onReducedMotionChange);
  }

  var lastTime = 0;
  var frameInterval = 1000 / 20;

  function render(timestamp) {
    rafId = null;
    if (!shouldRunCosmicLoop()) {
      stopCosmicLoop();
      return;
    }
    if (!w || !h) return;

    var dt = timestamp && lastTime ? Math.min((timestamp - lastTime) / 16.667, 3.0) : 1;
    if (timestamp && (timestamp - lastTime < frameInterval)) {
      if (typeof scheduleNextCosmicFrame === 'function') scheduleNextCosmicFrame();
      else rafId = requestAnimationFrame(render);
      return;
    }
    lastTime = timestamp || (typeof performance !== 'undefined' ? performance.now() : Date.now());

    ctx.clearRect(0, 0, w, h);

    var curTheme = getSavedDashboardTheme();
    var dotRgb = '203, 213, 225';
    var lineRgba = 'rgba(148, 163, 184, 0.06)';
    var alphaScale = 0.6;

    if (curTheme === 'ocean-abyss') {
      dotRgb = '125, 211, 252';
      lineRgba = 'rgba(56, 189, 248, 0.07)';
      alphaScale = 0.65;
    } else if (curTheme === 'violet-dusk') {
      dotRgb = '196, 181, 253';
      lineRgba = 'rgba(167, 139, 250, 0.05)';
      alphaScale = 0.5;
    } else if (curTheme === 'moonlight') {
      dotRgb = '79, 70, 229';
      lineRgba = 'rgba(79, 70, 229, 0.045)';
      alphaScale = 0.35;
    }

    var maxDist = isMobile ? 65 : 90;
    var maxDistSq = maxDist * maxDist;
    ctx.lineWidth = 0.75;
    ctx.strokeStyle = lineRgba;
    ctx.beginPath();
    var connectLimit = Math.min(stars.length, isMobile ? 16 : 26);
    for (var c1 = 0; c1 < connectLimit; c1++) {
      var s1 = stars[c1];
      for (var c2 = c1 + 1; c2 < connectLimit; c2++) {
        var s2 = stars[c2];
        var dx = s1.x - s2.x;
        var dy = s1.y - s2.y;
        if (dx * dx + dy * dy < maxDistSq) {
          ctx.moveTo(s1.x | 0, s1.y | 0);
          ctx.lineTo(s2.x | 0, s2.y | 0);
        }
      }
    }
    ctx.stroke();

    for (var i = 0; i < stars.length; i++) {
      var s = stars[i];
      s.y -= 0.14 * s.z * dt;
      s.x += Math.sin(s.seed + s.y * 0.008) * 0.14 * dt;
      s.a += s.da * dt;
      if (s.a > 0.65 || s.a < 0.12) s.da = -s.da;
      if (s.y < -12) {
        s.y = h + 12;
        s.x = Math.random() * w;
      }
      if (s.x < -12) s.x = w + 10;
      else if (s.x > w + 12) s.x = -10;
      s._b = s.a < 0.28 ? 0 : (s.a < 0.46 ? 1 : 2);
    }

    var bucketAlphas = [0.20, 0.38, 0.56];
    for (var b = 0; b < 3; b++) {
      var hasStar = false;
      ctx.beginPath();
      for (var j = 0; j < stars.length; j++) {
        var st = stars[j];
        if (st._b !== b) continue;
        var sr = Math.max(0.9, st.r * st.z * 0.75);
        var sx = st.x | 0;
        var sy = st.y | 0;
        ctx.moveTo(sx + sr, sy);
        ctx.arc(sx, sy, sr, 0, Math.PI * 2);
        hasStar = true;
      }
      if (hasStar) {
        ctx.fillStyle = 'rgba(' + dotRgb + ', ' + (bucketAlphas[b] * alphaScale).toFixed(2) + ')';
        ctx.fill();
      }
    }

    if (typeof scheduleNextCosmicFrame === 'function') {
      scheduleNextCosmicFrame();
    } else {
      rafId = requestAnimationFrame(render);
    }
  }
  startCosmicLoop();
})();

function togglePasswordVisibility(inputId, btn) {
  const input = document.getElementById(inputId);
  if (!input) return;
  if (input.type === 'password') {
    input.type = 'text';
    if (btn) {
      btn.textContent = 'Ẩn';
      btn.setAttribute('aria-pressed', 'true');
      btn.setAttribute('aria-label', 'Ẩn mật khẩu');
    }
  } else {
    input.type = 'password';
    if (btn) {
      btn.textContent = 'Hiện';
      btn.setAttribute('aria-pressed', 'false');
      btn.setAttribute('aria-label', 'Hiện mật khẩu');
    }
  }
}

async function handleLoginSubmit(event) {
  if (event) event.preventDefault();
  const uInput = document.getElementById('loginUsername');
  const pInput = document.getElementById('loginPassword');
  const alertEl = document.getElementById('loginAlert');
  const btn = document.getElementById('loginSubmitBtn');

  const username = String(uInput?.value || '').trim();
  const password = pInput?.value ?? '';

  if (!username || !password) {
    if (alertEl) {
      alertEl.textContent = 'Vui lòng nhập đầy đủ tên đăng nhập và mật khẩu.';
      alertEl.className = 'login-alert error';
    }
    return;
  }

  if (alertEl) alertEl.className = 'login-alert hidden';
  if (btn) {
    btn.disabled = true;
    btn.textContent = '⏳ Đang xác thực...';
  }

  const licenseKey = String(document.getElementById('loginLicenseKey')?.value || '').trim().toUpperCase();
  const rememberMe = !!document.getElementById('loginRememberMe')?.checked;
  let lockoutHandled = false;

  try {
    const res = await requestJson('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password, key: licenseKey, licenseKey, rememberMe })
    });

    if (res.status === 429 && Number(res.data?.retryAfterSeconds) > 0) {
      lockoutHandled = true;
      let rem = Math.max(1, Math.ceil(Number(res.data.retryAfterSeconds)));
      const baseErr = res.data?.error || 'Quá nhiều lần đăng nhập sai.';
      if (window._gateLoginLockoutTimer) clearInterval(window._gateLoginLockoutTimer);
      const tick = () => {
        const label = rem >= 3600
          ? (Math.floor(rem / 3600) + ' giờ ' + Math.floor((rem % 3600) / 60) + ' phút')
          : (rem >= 60 ? (Math.floor(rem / 60) + ' phút ' + (rem % 60) + ' giây') : (rem + ' giây'));
        if (alertEl) {
          alertEl.textContent = '⚠️ ' + baseErr + ' (Mở khóa sau ' + label + ')';
          alertEl.className = 'login-alert error';
        }
        if (btn) {
          btn.disabled = true;
          btn.textContent = '⏳ Tạm khóa (' + label + ')';
        }
      };
      tick();
      window._gateLoginLockoutTimer = setInterval(() => {
        rem -= 1;
        if (rem <= 0) {
          clearInterval(window._gateLoginLockoutTimer);
          window._gateLoginLockoutTimer = null;
          if (btn) {
            btn.disabled = false;
            btn.textContent = '🚀 ĐĂNG NHẬP VÀO HỆ THỐNG';
          }
          if (alertEl) {
            alertEl.textContent = 'Đã hết thời gian tạm khóa. Bạn có thể thử lại.';
            alertEl.className = 'login-alert';
          }
          return;
        }
        tick();
      }, 1000);
      return;
    }

    if (!res.ok) {
      throw new Error(res.data?.error || 'Tên đăng nhập hoặc mật khẩu không chính xác.');
    }

    if (window._gateLoginLockoutTimer) {
      clearInterval(window._gateLoginLockoutTimer);
      window._gateLoginLockoutTimer = null;
    }

    const data = res.data || {};
    currentUser = data.user || null;
    if (data.maintenance && typeof syncSystemMaintenanceState === 'function') {
      syncSystemMaintenanceState(data.maintenance, { rerender: false });
    }
    if (typeof normalizeCurrentUserMaintenanceExpiry === 'function') {
      normalizeCurrentUserMaintenanceExpiry(currentUser, data.maintenance);
    }
    if (alertEl) {
      alertEl.textContent = (data.partial ? '⚠️ ' : '✅ ') + (data.warning || data.message || 'Đăng nhập thành công!');
      alertEl.className = 'login-alert ' + (data.partial ? 'error' : 'success');
    }

    setTimeout(async () => {
      hideLoginGate();
      applyUserRoleUI();
      await refreshHome();
      scheduleNextManagerPoll();
      checkAndShowAnnouncement();
      loadDiscordLinkStatus({ silent: true });
      if (typeof checkRewardQueryParams === 'function') checkRewardQueryParams();
    }, 350);

  } catch (err) {
    if (alertEl) {
      alertEl.textContent = '⚠️ ' + err.message;
      alertEl.className = 'login-alert error';
    }
  } finally {
    if (btn && !lockoutHandled) {
      btn.disabled = false;
      btn.textContent = '🚀 ĐĂNG NHẬP VÀO HỆ THỐNG';
    }
  }
}

async function logout() {
  invalidateDetailReads();
  if (typeof managerPollTimerId !== 'undefined' && managerPollTimerId) {
    clearTimeout(managerPollTimerId);
    managerPollTimerId = null;
  }
  try {
    localStorage.removeItem('kingmc_session');
    sessionStorage.removeItem('kingmc_session');
    document.cookie = 'kingmc_mgr_session=; Path=/; Expires=Thu, 01 Jan 1970 00:00:01 GMT; Max-Age=0; SameSite=Lax';
  } catch (_) {}

  try {
    await requestJson('/api/auth/logout', { method: 'POST', timeoutMs: 3000 });
  } catch (_) {}

  currentUser = null;
  bots = [];
  selectedBotId = null;
  detailBot = null;

  const dChat = document.getElementById('detailChatLogs'); if (dChat) dChat.innerHTML = '';
  const dLog = document.getElementById('detailEventLogs'); if (dLog) dLog.innerHTML = '';
  const uInput = document.getElementById('detailUsernameInput'); if (uInput) uInput.value = '';
  const pInput = document.getElementById('detailPasswordInput'); if (pInput) pInput.value = '';

  document.getElementById('detailPage')?.classList.add('hidden');
  document.getElementById('homePage')?.classList.remove('hidden');

  applyUserRoleUI();
  renderHome();
  showLoginGate();

  window.location.replace('/');
}

function applyUserRoleUI() {
  const appEl = document.getElementById('mainApp');
  const badgeEl = document.getElementById('userRoleBadge');
  const detailBadgeEl = document.getElementById('detailUserRoleBadge');
  const globalBadgeEl = document.getElementById('globalUserRoleBadge');
  const badges = [badgeEl, detailBadgeEl, globalBadgeEl].filter(Boolean);
  const lockedOverlay = document.getElementById('accountLockedOverlay');
  const expiredOverlay = document.getElementById('accountExpiredOverlay');

  if (!currentUser) {
    appEl?.classList.add('user-mode');
    document.body?.classList?.add('user-mode');
    appEl?.classList.remove('account-restricted-blur');
    lockedOverlay?.classList.add('hidden');
    expiredOverlay?.classList.add('hidden');
    badges.forEach(b => {
      b.innerHTML = '🔒 <strong>CHƯA ĐĂNG NHẬP</strong>';
      b.style.background = 'rgba(148,163,184,0.15)';
      b.style.color = '#94a3b8';
      b.style.borderColor = 'rgba(148,163,184,0.3)';
    });
    ['userProfileName', 'detailUserProfileName', 'globalUserProfileName'].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.textContent = 'Đăng nhập';
    });
    ['userAvatarBadge', 'detailUserAvatarBadge', 'globalUserAvatarBadge', 'dropdownAvatar', 'detailDropdownAvatar', 'globalDropdownAvatar'].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.textContent = 'K';
    });
    return;
  }

  const username = currentUser.username || (currentUser.role === 'admin' ? 'admin' : 'User');
  const isAdmin = currentUser.role === 'admin';
  const avatar = isAdmin ? 'A' : String(username.charAt(0) || 'U').toUpperCase();
  const roleText = isAdmin ? 'Quản trị viên (Toàn quyền)' : 'Người vận hành (' + (Array.isArray(currentUser.assignedBotIds) ? currentUser.assignedBotIds.length : 0) + ' Bot)';

  // Kiểm tra hạn thuê và tạm khóa cho tài khoản User
  if (!isAdmin) {
    const isLocked = currentUser.status === 'disabled';

    if (isLocked) {
      appEl?.classList.add('account-restricted-blur');
      if (lockedOverlay) {
        lockedOverlay.classList.remove('hidden');
        const reasonEl = document.getElementById('lockedReasonMessage');
        if (reasonEl) reasonEl.textContent = currentUser.lockReason || 'Tài khoản của bạn đang bị tạm khóa. Vui lòng liên hệ Admin để được hỗ trợ.';
      }
      if (expiredOverlay) expiredOverlay.classList.add('hidden');
    } else {
      // Hết hạn / Ân hạn: Bỏ làm mờ toàn màn hình và ẩn popup che khuất, chuyển sang làm mờ trực tiếp từng thẻ bot
      appEl?.classList.remove('account-restricted-blur');
      if (lockedOverlay) lockedOverlay.classList.add('hidden');
      if (expiredOverlay) expiredOverlay.classList.add('hidden');
    }
  } else {
    appEl?.classList.remove('account-restricted-blur');
    if (lockedOverlay) lockedOverlay.classList.add('hidden');
    if (expiredOverlay) expiredOverlay.classList.add('hidden');
  }

  if (isAdmin) {
    appEl?.classList.remove('user-mode');
    document.body?.classList?.remove('user-mode');
    badges.forEach(b => {
      b.innerHTML = '<strong>ADMIN (Toàn quyền)</strong>';
      b.style.background = 'rgba(229, 153, 52, 0.14)';
      b.style.color = 'var(--yellow)';
      b.style.borderColor = 'rgba(229, 153, 52, 0.34)';
    });
  } else {
    appEl?.classList.add('user-mode');
    document.body?.classList?.add('user-mode');
    badges.forEach(b => {
      b.innerHTML = '<strong>USER: ' + escapeHtml(currentUser.username) + '</strong>';
      b.style.background = 'var(--accent-soft)';
      b.style.color = 'var(--accent-text)';
      b.style.borderColor = 'var(--border-strong)';
    });
  }

  // Cập nhật Profile Buttons & Dropdowns góc trên bên phải
  ['userProfileName', 'detailUserProfileName', 'globalUserProfileName'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.textContent = username;
  });
  ['userAvatarBadge', 'detailUserAvatarBadge', 'globalUserAvatarBadge', 'dropdownAvatar', 'detailDropdownAvatar', 'globalDropdownAvatar'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.textContent = avatar;
  });
  ['dropdownUsername', 'detailDropdownUsername', 'globalDropdownUsername'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.textContent = username;
  });
  ['dropdownRole', 'detailDropdownRole', 'globalDropdownRole'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.textContent = roleText;
  });

  const expEl = document.getElementById('globalDropdownExpires');
  const isPermanentUser = !isAdmin && currentUser.isPermanent === true;
  if (expEl) {
    if (isAdmin) {
      expEl.style.display = 'none';
    } else {
      expEl.style.display = 'block';
      if (isPermanentUser) {
        expEl.textContent = 'VIP Vĩnh viễn';
        expEl.style.color = 'var(--yellow)';
      } else if (!currentUser.expiresAt) {
        expEl.textContent = 'Chưa kích hoạt gói';
        expEl.style.color = 'var(--text-muted)';
      } else {
        const expDate = new Date(currentUser.expiresAt);
        const isExp = Date.now() > expDate.getTime();
        expEl.textContent = (isExp ? 'Đã hết hạn: ' : 'Hạn dùng: ') + expDate.toLocaleDateString('vi-VN');
        expEl.style.color = isExp ? 'var(--red)' : 'var(--accent-text)';
      }
    }
  }

  // Ẩn nút nhập mã key chỉ đối với Admin hoặc tài khoản VIP Vĩnh Viễn thực sự (isPermanent === true)
  const renewBtnTop = document.getElementById('btnUserRenewKey');
  const renewBtnDropdown = document.getElementById('globalRenewKeyBtn');
  if (renewBtnTop) renewBtnTop.style.display = (isAdmin || isPermanentUser) ? 'none' : '';
  if (renewBtnDropdown) renewBtnDropdown.style.display = (isAdmin || isPermanentUser) ? 'none' : '';

  if (typeof loadLink4mAdminSetting === 'function' && isAdmin) {
    void loadLink4mAdminSetting();
  } else if (typeof loadLink4mStatus === 'function' && !isAdmin) {
    void loadLink4mStatus();
  }
  if (isAdmin && typeof loadMaintenanceAdminSetting === 'function') {
    void loadMaintenanceAdminSetting();
  }
  if (typeof renderSystemMaintenanceBanner === 'function') {
    renderSystemMaintenanceBanner();
  }
}

function toggleUserProfileDropdown(event) {
  return toggleGlobalProfileDropdown(event);
}

function closeUserProfileDropdown() {
  closeGlobalProfileDropdown();
}

function openChangePasswordModal() {
  closeUserProfileDropdown();
  const modal = document.getElementById('changePasswordModal');
  const uInput = document.getElementById('changePassUsernameDisplay');
  const oldInput = document.getElementById('changePassOld');
  const newInput = document.getElementById('changePassNew');
  const confirmInput = document.getElementById('changePassConfirm');
  const alertEl = document.getElementById('changePassAlert');

  if (uInput) uInput.value = currentUser ? currentUser.username : '';
  if (oldInput) oldInput.value = '';
  if (newInput) newInput.value = '';
  if (confirmInput) confirmInput.value = '';
  if (alertEl) { alertEl.className = 'login-alert hidden'; alertEl.textContent = ''; }

  modal?.classList.remove('hidden');
  setTimeout(() => oldInput?.focus(), 50);
}

function closeChangePasswordModal() {
  document.getElementById('changePasswordModal')?.classList.add('hidden');
}

let currentDiscordLinkState = { linked: false, discordNotifyEnabled: true, loaded: false };
let discordNotifyToggleInFlight = false;

function renderDiscordNotifyControls() {
  const enabled = currentDiscordLinkState.discordNotifyEnabled !== false;
  const linked = currentDiscordLinkState.linked === true;
  const isAdmin = currentUser?.role === 'admin';

  const toolbarBtn = document.getElementById('discordDmNotifyBtn');
  if (toolbarBtn) {
    if (!linked && currentDiscordLinkState.loaded && !isAdmin) {
      toolbarBtn.textContent = 'TB Discord: Chưa liên kết';
      toolbarBtn.title = 'Hãy liên kết tài khoản Web với Discord để bật nhận tin nhắn riêng (DM)';
    } else {
      toolbarBtn.textContent = enabled ? 'TB Discord: BẬT' : 'TB Discord: TẮT';
      toolbarBtn.title = enabled
        ? 'Đang BẬT nhận thông báo riêng qua Discord (DM) — bấm để tắt'
        : 'Đang TẮT nhận thông báo riêng qua Discord (DM) — bấm để bật lại';
    }
    toolbarBtn.classList.toggle('active', enabled && (linked || isAdmin));
    toolbarBtn.setAttribute('aria-pressed', (enabled && (linked || isAdmin)) ? 'true' : 'false');
  }

  const statusText = document.getElementById('discordNotifyStatusText');
  const toggleBtn = document.getElementById('discordNotifyToggleBtn');
  const hint = document.getElementById('discordNotifyHint');
  if (statusText) {
    statusText.style.color = enabled ? 'var(--green)' : 'var(--yellow)';
    statusText.textContent = enabled ? 'Đang bật' : 'Đang tắt';
  }
  if (toggleBtn) {
    toggleBtn.textContent = enabled ? 'Tắt thông báo Discord' : 'Bật thông báo Discord';
    toggleBtn.className = enabled ? 'small danger' : 'small primary';
  }
  if (hint) {
    if (!linked && !isAdmin) {
      hint.textContent = '⚠️ Tài khoản Web của bạn chưa liên kết Discord. Chỉ tài khoản Web đã liên kết Discord (dùng lệnh /login trên Discord) mới nhận được tin nhắn riêng (DM) khi bot die, đang AFK bị kick/văng hoặc reconnect.';
    } else {
      hint.textContent = 'Tự động nhắn riêng (DM) tới tài khoản Discord đang liên kết với tài khoản Web này khi bot được gán bị die, đang AFK bị kick/văng, kết nối lại AFK thành công hoặc dừng do reconnect thất bại.';
    }
  }
}

async function loadDiscordLinkStatus({ silent = false } = {}) {
  const statusText = document.getElementById('discordLinkStatusText');
  const details = document.getElementById('discordLinkDetails');
  const linkedId = document.getElementById('discordLinkedId');
  const linkedDate = document.getElementById('discordLinkedDate');
  const unlinkBtn = document.getElementById('discordUnlinkBtn');
  try {
    const res = await requestJson('/api/user/discord-link');
    const data = res.data || {};
    if (res.ok && data.ok) {
      currentDiscordLinkState = {
        linked: Boolean(data.linked),
        discordNotifyEnabled: data.discordNotifyEnabled !== false,
        loaded: true
      };
      renderDiscordNotifyControls();
      if (data.linked) {
        if (statusText) { statusText.style.color = '#10b981'; statusText.textContent = '✅ Đã liên kết với Discord'; }
        if (details) details.style.display = 'block';
        if (linkedId) linkedId.textContent = data.discordUserId || '---';
        if (linkedDate) linkedDate.textContent = data.linkedAt ? new Date(data.linkedAt).toLocaleString('vi-VN') : 'Không rõ';
        if (unlinkBtn) unlinkBtn.classList.remove('hidden');
      } else {
        if (statusText) { statusText.style.color = '#f59e0b'; statusText.textContent = '⚠️ Chưa liên kết Discord'; }
        if (details) details.style.display = 'none';
        if (unlinkBtn) unlinkBtn.classList.add('hidden');
      }
    } else if (!silent) {
      throw new Error(data.error || 'Không thể kiểm tra trạng thái liên kết.');
    }
  } catch (e) {
    if (silent) return;
    if (statusText) {
      statusText.style.color = '#ef4444';
      statusText.textContent = '❌ ' + (e && e.message ? e.message : 'Lỗi kiểm tra trạng thái');
    }
    if (details) details.style.display = 'none';
    if (unlinkBtn) unlinkBtn.classList.add('hidden');
  }
}

async function toggleDiscordNotifications() {
  if (discordNotifyToggleInFlight) return;
  if (!currentDiscordLinkState.loaded) {
    await loadDiscordLinkStatus({ silent: true });
  }
  const isAdmin = currentUser?.role === 'admin';
  const nextEnabled = !(currentDiscordLinkState.discordNotifyEnabled !== false);
  if (!currentDiscordLinkState.linked && !isAdmin && nextEnabled) {
    openDiscordLinkModal();
    showToast('Vui lòng liên kết tài khoản Web với Discord (/login trên Discord) để nhận thông báo DM!', 'warning', 4500);
    return;
  }

  discordNotifyToggleInFlight = true;
  const toolbarBtn = document.getElementById('discordDmNotifyBtn');
  const modalBtn = document.getElementById('discordNotifyToggleBtn');
  if (toolbarBtn) toolbarBtn.disabled = true;
  if (modalBtn) modalBtn.disabled = true;
  try {
    const res = await requestJson('/api/user/discord-notify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabled: nextEnabled })
    });
    const data = res.data || {};
    if (res.ok && data.ok) {
      currentDiscordLinkState.discordNotifyEnabled = data.discordNotifyEnabled !== false;
      renderDiscordNotifyControls();
      showToast(data.message || (currentDiscordLinkState.discordNotifyEnabled ? 'Đã BẬT thông báo Discord.' : 'Đã TẮT thông báo Discord.'), 'success');
    } else {
      showToast(data.error || 'Không thể cập nhật cài đặt thông báo Discord.', 'error');
    }
  } catch (err) {
    showToast('Lỗi kết nối: ' + (err && err.message ? err.message : 'Thất bại'), 'error');
  } finally {
    discordNotifyToggleInFlight = false;
    if (toolbarBtn) toolbarBtn.disabled = false;
    if (modalBtn) modalBtn.disabled = false;
  }
}

function openDiscordLinkModal() {
  closeUserProfileDropdown();
  const modal = document.getElementById('discordLinkModal');
  modal?.classList.remove('hidden');
  loadDiscordLinkStatus();
}

function closeDiscordLinkModal() {
  document.getElementById('discordLinkModal')?.classList.add('hidden');
}

async function unlinkDiscordAccount() {
  if (!confirm('Bạn có chắc chắn muốn hủy liên kết tài khoản Discord này? Sau khi hủy, bạn sẽ không thể dùng Discord để điều khiển bot.')) {
    return;
  }
  const btn = document.getElementById('discordUnlinkBtn');
  if (btn) btn.disabled = true;
  try {
    const res = await requestJson('/api/user/discord-unlink', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }
    });
    const data = res.data || {};
    if (res.ok && data.ok) {
      showToast(data.message || 'Đã hủy liên kết Discord thành công!');
      await loadDiscordLinkStatus();
    } else {
      showToast('Hủy liên kết thất bại: ' + (data.error || 'Lỗi không xác định'), 'error');
    }
  } catch (err) {
    showToast('Lỗi kết nối: ' + (err && err.message ? err.message : 'Thất bại'), 'error');
  } finally {
    if (btn) btn.disabled = false;
  }
}

function openChangelogModal() {
  closeUserProfileDropdown();
  document.getElementById('changelogModal')?.classList.remove('hidden');
}

function closeChangelogModal() {
  document.getElementById('changelogModal')?.classList.add('hidden');
}

let cachedAuditLogs = [];
let auditLogCurrentPage = 1;
let auditLogTotalPages = 1;
let auditLogTotalRecords = 0;
let auditFilterDebounceTimer = null;
let auditLogType = 'SYSTEM';

function switchAuditLogType(logType) {
  const requestedType = String(logType || '').trim().toUpperCase();
  auditLogType = requestedType === 'SYSTEM' || requestedType === 'BOT'
    ? requestedType
    : '';

  const tabs = [
    ['auditTabSystem', 'SYSTEM'],
    ['auditTabBot', 'BOT'],
    ['auditTabAll', '']
  ];
  for (const [id, type] of tabs) {
    const el = document.getElementById(id);
    if (el) {
      el.classList.toggle('active', auditLogType === type);
      el.setAttribute('aria-selected', auditLogType === type ? 'true' : 'false');
    }
  }

  refreshAuditLogs(1);
}

async function openAuditLogModal() {
  closeUserProfileDropdown();
  if (currentUser?.role !== 'admin') {
    showToast('Chỉ Quản trị viên mới có quyền xem Audit Logs.');
    return;
  }
  navigateTo('audit');
}

function closeAuditLogModal() {
  navigateTo('dashboard');
}

function debounceAuditFilter() {
  if (auditFilterDebounceTimer) clearTimeout(auditFilterDebounceTimer);
  auditFilterDebounceTimer = setTimeout(() => {
    refreshAuditLogs(1);
  }, 280);
}

async function refreshAuditLogs(page) {
  if (!page || page < 1) page = 1;
  const tbody = document.getElementById('auditLogTableBody');
  if (tbody) tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;padding:24px;color:var(--muted);">Đang tải nhật ký hoạt động...</td></tr>';

  const q = encodeURIComponent((document.getElementById('auditLogSearchInput')?.value || '').trim());
  const category = encodeURIComponent((document.getElementById('auditLogCategoryFilter')?.value || '').trim());
  const status = encodeURIComponent((document.getElementById('auditLogStatusFilter')?.value || '').trim());
  const logType = encodeURIComponent(auditLogType);
  const limit = Math.max(10, Math.min(200, Number(document.getElementById('auditLogLimitSelect')?.value || 50)));

  try {
    const url = '/api/manager/audit-logs?page=' + page + '&limit=' + limit + '&q=' + q + '&category=' + category + '&status=' + status + '&logType=' + logType;
    const res = await requestJson(url);
    if (!res.ok) throw new Error(res.data?.error || 'Không thể tải nhật ký.');

    cachedAuditLogs = Array.isArray(res.data?.logs) ? res.data.logs : [];
    auditLogCurrentPage = Number(res.data?.page || 1);
    auditLogTotalPages = Number(res.data?.totalPages || 1);
    auditLogTotalRecords = Number(res.data?.total || cachedAuditLogs.length);

    renderAuditLogs(cachedAuditLogs, auditLogTotalRecords, auditLogCurrentPage, auditLogTotalPages, limit);
  } catch (err) {
    if (tbody) tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;color:var(--red);padding:20px;">Lỗi: ' + escapeHtml(err.message) + '</td></tr>';
  }
}

function navigateAuditPage(delta) {
  const targetPage = auditLogCurrentPage + delta;
  if (targetPage >= 1 && targetPage <= auditLogTotalPages) {
    refreshAuditLogs(targetPage);
  }
}

const AUDIT_CATEGORY_META = {
  AUTH: { label: 'Bảo mật', cls: 'audit-cat-auth' },
  BOT_CONTROL: { label: 'Điều khiển', cls: 'audit-cat-bot' },
  BOT_ACCOUNT: { label: 'Tài khoản MC', cls: 'audit-cat-bot' },
  BOT_SETTINGS: { label: 'Cài đặt bot', cls: 'audit-cat-settings' },
  BOT_INVENTORY: { label: 'Kho đồ', cls: 'audit-cat-bot' },
  FLEET: { label: 'Hạ tầng bot', cls: 'audit-cat-settings' },
  USER_MGMT: { label: 'Người dùng', cls: 'audit-cat-user' },
  LICENSE_KEY: { label: 'License Key', cls: 'audit-cat-key' },
  SYSTEM: { label: 'Hệ thống', cls: 'audit-cat-sys' }
};

const AUDIT_ACTION_LABELS = {
  LOGIN_SUCCESS: 'Đăng nhập Web thành công',
  LOGIN_FAILED: 'Đăng nhập Web thất bại',
  LOGIN_LOCKED: 'Khóa tạm thời do sai mật khẩu',
  LOGOUT: 'Đăng xuất Web Manager',
  REGISTER_SUCCESS: 'Đăng ký tài khoản mới',
  CHANGE_PASSWORD: 'Đổi mật khẩu tài khoản',
  DISCORD_LOGIN_SUCCESS: 'Liên kết & đăng nhập Discord',
  DISCORD_LOGIN_FAILED: 'Đăng nhập Discord thất bại',
  DISCORD_LOGIN_BLOCKED_DISABLED: 'Chặn đăng nhập Discord (tài khoản khóa)',
  DISCORD_LOGIN_RATE_LIMITED: 'Giới hạn đăng nhập Discord',
  DISCORD_LOGOUT: 'Hủy liên kết Discord',
  DISCORD_POINTS_ADMIN_ADJUST: 'Admin chỉnh điểm Discord',
  DISCORD_POINTS_ADMIN_RESET: 'Admin reset điểm Discord',
  BOT_START: 'Khởi chạy Bot',
  BOT_STOP: 'Dừng Bot',
  BOT_RESTART: 'Khởi động lại Bot',
  BOT_RESPAWN: 'Hồi sinh Bot',
  BOT_RESET: 'Đặt lại dữ liệu Bot',
  BOT_RESET_CUSTOMER: 'Thu hồi & bàn giao Bot mới',
  BOT_CREATE: 'Thêm Bot mới vào hệ thống',
  BOT_DELETE: 'Xóa Bot khỏi hệ thống',
  BOT_PATCH: 'Cập nhật thông tin / cấu hình Bot',
  BOT_BATCH_IMPORT: 'Nhập hàng loạt danh sách Bot',
  BOT_REORDER: 'Sắp xếp thứ tự hiển thị Bot',
  BOT_INVENTORY_MOVE: 'Di chuyển vật phẩm trong túi đồ',
  BOT_INVENTORY_EQUIP: 'Mặc trang bị / lắp tay phụ',
  BOT_INVENTORY_UNEQUIP: 'Tháo trang bị về túi đồ',
  BOT_INVENTORY_DROP: 'Vứt vật phẩm ra ngoài',
  BOT_WINDOW_CLICK: 'Bấm ô trong cửa sổ GUI',
  BOT_WINDOW_CLOSE: 'Đóng cửa sổ GUI trong game',
  BOT_ACCOUNT_UPDATE: 'Cập nhật tài khoản Minecraft',
  BOT_SETTINGS_UPDATE: 'Cập nhật cài đặt Bot',
  BOT_PROXY_UPDATE: 'Cập nhật Proxy Bot',
  BOT_CHAT_SEND: 'Gửi lệnh / chat trong game',
  WORKER_SECRET_UPDATED: 'Cập nhật Secret Key Worker',
  USER_CREATED: 'Tạo tài khoản khách mới',
  USER_UPDATED: 'Cập nhật tài khoản khách',
  USER_DELETED: 'Xóa tài khoản khách',
  USER_RENEWED: 'Gia hạn gói sử dụng',
  USER_LOCKED: 'Tạm khóa tài khoản khách',
  USER_UNLOCKED: 'Mở khóa tài khoản khách',
  KEY_GENERATED: 'Phát hành Key / Giftcode',
  KEY_REDEEMED: 'Kích hoạt Key gia hạn',
  KEY_DELETED: 'Xóa mã Key',
  IP_WHITELIST_ADD: 'Thêm IP vào Whitelist',
  IP_WHITELIST_REMOVE: 'Xóa IP khỏi Whitelist',
  TRIAL_GIFT_TOGGLED: 'Bật/Tắt quà tặng dùng thử',
  LINK4M_CONFIG_UPDATED: 'Cập nhật cấu hình Link4M +12h',
  LINK4M_REWARD_CLAIMED: 'Nhận thưởng +12h từ Link4M',
  ANNOUNCEMENT_UPDATED: 'Cập nhật thông báo hệ thống',
  BACKUP_CREATED: 'Tạo bản sao lưu dữ liệu',
  BACKUP_RESTORED: 'Khôi phục dữ liệu từ sao lưu',
  MAINTENANCE_TOGGLED: 'Thay đổi trạng thái bảo trì',
  AUDIT_LOGS_CLEARED: 'Xóa lịch sử nhật ký Audit'
};

const AUDIT_DETAIL_KEY_LABELS = {
  reason: 'Lý do',
  result: 'Kết quả',
  username: 'Tài khoản',
  actor: 'Thực hiện',
  botId: 'Bot',
  botName: 'Tên bot',
  workerId: 'Worker',
  provider: 'Nền tảng',
  days: 'Số ngày',
  planName: 'Gói',
  role: 'Vai trò',
  scope: 'Phạm vi',
  mode: 'Kiểu',
  amount: 'Số lượng',
  beforePoints: 'Điểm cũ',
  afterPoints: 'Điểm mới',
  ip: 'IP',
  clientIp: 'IP',
  guildId: 'Server Discord',
  error: 'Lỗi',
  message: 'Thông điệp',
  count: 'Số lượng',
  key: 'Mã Key',
  code: 'Mã',
  slot: 'Ô',
  sourceSlot: 'Từ ô',
  destSlot: 'Đến ô',
  destination: 'Vị trí mặc',
  action: 'Thao tác',
  enabled: 'Trạng thái bật',
  addedHours: 'Giờ cộng thêm'
};

function humanizeAuditAction(item) {
  const rawAction = String(item?.action || '').trim();
  const upperAction = rawAction.toUpperCase();
  if (AUDIT_ACTION_LABELS[upperAction]) {
    return AUDIT_ACTION_LABELS[upperAction];
  }
  const explicitLabel = String(item?.actionLabel || '').trim();
  if (explicitLabel && !/^[A-Z0-9_]{4,}$/.test(explicitLabel)) {
    return explicitLabel;
  }
  if (!rawAction) return 'Thao tác hệ thống';
  if (upperAction.startsWith('SYSTEM_ALERT_')) {
    return 'Cảnh báo ' + upperAction.slice('SYSTEM_ALERT_'.length).replace(/_/g, ' ').toLowerCase();
  }
  return rawAction.replace(/_/g, ' ').toLowerCase().replace(/^./, c => c.toUpperCase());
}

function formatAuditDetailsHtml(rawDetails, rawMessage) {
  const msgText = String(rawMessage || '').trim();
  let parsedObj = null;

  if (rawDetails && typeof rawDetails === 'object' && !Array.isArray(rawDetails)) {
    parsedObj = rawDetails;
  } else if (typeof rawDetails === 'string') {
    const trimmed = rawDetails.trim();
    if (trimmed.startsWith('{') && trimmed.endsWith('}')) {
      try {
        const candidate = JSON.parse(trimmed);
        if (candidate && typeof candidate === 'object' && !Array.isArray(candidate)) {
          parsedObj = candidate;
        }
      } catch (_) {}
    } else if (trimmed && trimmed !== '-' && trimmed !== msgText) {
      return '<div class="audit-detail-msg">' + escapeHtml(trimmed) + '</div>';
    }
  }

  const parts = [];
  const objMsg = parsedObj && typeof parsedObj.message === 'string' ? parsedObj.message.trim() : '';
  const leadMsg = msgText || objMsg;
  if (leadMsg) {
    parts.push('<div class="audit-detail-msg">' + escapeHtml(leadMsg) + '</div>');
  }

  if (parsedObj) {
    const ignoredKeys = new Set(['source', 'event', 'level', 'password', 'token', 'secret']);
    const entries = Object.entries(parsedObj).filter(([k, v]) => {
      if (ignoredKeys.has(k)) return false;
      if (k === 'message' && leadMsg) return false;
      if (v === null || v === undefined || v === '') return false;
      return true;
    });

    const visibleEntries = entries.slice(0, 4);
    const hiddenEntries = entries.slice(4);

    if (visibleEntries.length > 0) {
      parts.push(
        '<div class="audit-kv-list">' +
          visibleEntries.map(([k, v]) => {
            const label = AUDIT_DETAIL_KEY_LABELS[k] || k.replace(/([A-Z])/g, ' $1').replace(/_/g, ' ').trim();
            const valStr = typeof v === 'object' ? JSON.stringify(v) : String(v);
            return '<span class="audit-kv-pill"><span class="audit-kv-key">' + escapeHtml(label) + ':</span> <span class="audit-kv-val">' + escapeHtml(valStr.slice(0, 90)) + '</span></span>';
          }).join('') +
        '</div>'
      );
    }

    if (hiddenEntries.length > 0) {
      parts.push(
        '<details class="audit-raw-more"><summary>+' + hiddenEntries.length + ' chi tiết khác</summary>' +
          '<div class="audit-kv-list" style="margin-top:6px;">' +
            hiddenEntries.map(([k, v]) => {
              const label = AUDIT_DETAIL_KEY_LABELS[k] || k;
              const valStr = typeof v === 'object' ? JSON.stringify(v) : String(v);
              return '<span class="audit-kv-pill"><span class="audit-kv-key">' + escapeHtml(label) + ':</span> <span class="audit-kv-val">' + escapeHtml(valStr.slice(0, 120)) + '</span></span>';
            }).join('') +
          '</div>' +
        '</details>'
      );
    }
  }

  return parts.length > 0 ? parts.join('') : '<span style="color:var(--muted);">—</span>';
}

function renderAuditLogs(items, total, page, totalPages, limit) {
  const tbody = document.getElementById('auditLogTableBody');
  if (!tbody) return;

  const infoEl = document.getElementById('auditLogPaginationInfo');
  const indEl = document.getElementById('auditLogPageIndicator');
  const prevBtn = document.getElementById('auditLogPrevBtn');
  const nextBtn = document.getElementById('auditLogNextBtn');

  const startRecord = total === 0 ? 0 : (page - 1) * limit + 1;
  const endRecord = Math.min(total, page * limit);
  if (infoEl) infoEl.textContent = 'Hiển thị ' + startRecord + ' – ' + endRecord + ' / ' + total + ' bản ghi';
  if (indEl) indEl.textContent = 'Trang ' + page + ' / ' + totalPages;
  if (prevBtn) prevBtn.disabled = (page <= 1);
  if (nextBtn) nextBtn.disabled = (page >= totalPages);

  if (!items.length) {
    tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;padding:32px;color:var(--muted);">Không có bản ghi nhật ký nào phù hợp bộ lọc.</td></tr>';
    return;
  }

  tbody.innerHTML = items.map(item => {
    const d = item.timestamp ? new Date(item.timestamp) : null;
    const validDate = d && !Number.isNaN(d.getTime());
    const timeStr = validDate ? d.toLocaleTimeString('vi-VN', { hour12: false }) : '—';
    const dateStr = validDate ? d.toLocaleDateString('vi-VN') : '';
    const relativeTime = validDate ? formatRelativeTime(d) : '';

    const rawStatus = String(item.status || 'SUCCESS').toUpperCase();
    const statusMap = {
      SUCCESS: { text: 'Thành công', cls: 'audit-status-success', rowCls: '' },
      FAILED: { text: 'Thất bại', cls: 'audit-status-failed', rowCls: 'audit-row-failed' },
      BLOCKED: { text: 'Bị chặn', cls: 'audit-status-blocked', rowCls: 'audit-row-blocked' },
      PARTIAL: { text: 'Một phần', cls: 'audit-status-partial', rowCls: 'audit-row-warning' },
      WARNING: { text: 'Cảnh báo', cls: 'audit-status-partial', rowCls: 'audit-row-warning' }
    };
    const st = statusMap[rawStatus] || { text: rawStatus, cls: 'audit-status-neutral', rowCls: '' };

    const roleMeta = {
      admin: { label: 'Admin', cls: 'audit-role-admin' },
      user: { label: 'Khách thuê', cls: 'audit-role-user' },
      system: { label: 'Hệ thống', cls: 'audit-role-sys' }
    };
    const rawRole = String(item.actor?.role || '').toLowerCase();
    const actorRoleObj = roleMeta[rawRole] || { label: item.actor?.role || 'Khách', cls: 'audit-role-user' };
    const actorUser = String(item.actor?.username || item.actorId || 'system');
    const actorIp = String(item.actor?.ip || '').trim();

    let targetText = '—';
    if (item.target) {
      if (typeof item.target === 'object') {
        if (item.target.botId !== undefined && item.target.botId !== null && item.target.botId !== '') {
          const bNum = item.target.botId;
          const lbl = item.target.label;
          const hasCustom = lbl && lbl !== ('Bot ' + bNum) && lbl !== ('bot' + bNum) && lbl !== ('Bot #' + bNum);
          targetText = 'Bot #' + bNum + (hasCustom ? ' (' + lbl + ')' : '');
        } else if (item.target.username) {
          targetText = item.target.username;
        } else if (item.target.key) {
          targetText = item.target.key;
        } else if (item.target.label) {
          targetText = item.target.label;
        } else {
          targetText = String(item.target.id || '—');
        }
      } else {
        targetText = String(item.target);
      }
    }

    const catKey = String(item.category || 'SYSTEM').toUpperCase();
    const catMeta = AUDIT_CATEGORY_META[catKey] || { label: catKey, cls: 'audit-cat-sys' };
    const actionTitle = humanizeAuditAction(item);
    const detailsHtml = formatAuditDetailsHtml(item.details, item.message);

    return '<tr class="audit-row ' + st.rowCls + '">' +
      '<td class="audit-time-cell" title="' + escapeHtml(dateStr + ' ' + timeStr) + '">' +
        '<div class="audit-time-main">' + escapeHtml(timeStr) + '</div>' +
        '<div class="audit-time-sub">' + escapeHtml(dateStr + (relativeTime ? ' · ' + relativeTime : '')) + '</div>' +
      '</td>' +
      '<td>' +
        '<div class="audit-actor-top">' +
          '<span class="audit-actor-name">' + escapeHtml(actorUser) + '</span>' +
          '<span class="audit-role-tag ' + actorRoleObj.cls + '">' + escapeHtml(actorRoleObj.label) + '</span>' +
        '</div>' +
        (actorIp && actorIp !== '127.0.0.1'
          ? '<div class="audit-actor-ip">' + escapeHtml(actorIp) + '</div>'
          : '') +
      '</td>' +
      '<td>' +
        '<div class="audit-action-cell" title="' + escapeHtml(item.action || '') + '">' +
          '<span class="audit-cat-tag ' + catMeta.cls + '">' + escapeHtml(catMeta.label) + '</span>' +
          '<span class="audit-action-title">' + escapeHtml(actionTitle) + '</span>' +
        '</div>' +
      '</td>' +
      '<td class="audit-target-cell" title="' + escapeHtml(targetText) + '">' +
        '<span class="audit-target-pill">' + escapeHtml(targetText) + '</span>' +
      '</td>' +
      '<td class="audit-details-cell">' + detailsHtml + '</td>' +
      '<td style="text-align:right;white-space:nowrap;">' +
        '<span class="audit-status-pill ' + st.cls + '"><span class="audit-status-dot"></span>' + escapeHtml(st.text) + '</span>' +
      '</td>' +
    '</tr>';
  }).join('');
}

function formatRelativeTime(date) {
  const diffSec = Math.floor((Date.now() - date.getTime()) / 1000);
  if (diffSec < 5) return 'vừa xong';
  if (diffSec < 60) return diffSec + ' giây trước';
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return diffMin + ' phút trước';
  const diffHours = Math.floor(diffMin / 60);
  if (diffHours < 24) return diffHours + ' giờ trước';
  const diffDays = Math.floor(diffHours / 24);
  return diffDays + ' ngày trước';
}

async function exportAuditLogs(format) {
  if (!format) format = 'csv';
  if (currentUser?.role !== 'admin') {
    showToast('Chỉ Quản trị viên mới có quyền xuất nhật ký.');
    return;
  }
  const reqFormat = String(format).toLowerCase() === 'jsonl' ? 'jsonl' : 'csv';
  const q = encodeURIComponent((document.getElementById('auditLogSearchInput')?.value || '').trim());
  const category = encodeURIComponent((document.getElementById('auditLogCategoryFilter')?.value || '').trim());
  const status = encodeURIComponent((document.getElementById('auditLogStatusFilter')?.value || '').trim());
  const logType = encodeURIComponent(typeof auditLogType !== 'undefined' ? auditLogType : 'all');
  showToast('Đang tải file xuất nhật ký (' + reqFormat.toUpperCase() + ')...');
  try {
    const res = await fetch('/api/manager/audit-logs/export?format=' + encodeURIComponent(reqFormat) + '&q=' + q + '&category=' + category + '&status=' + status + '&logType=' + logType, {
      method: 'GET',
      cache: 'no-store',
      credentials: 'same-origin'
    });
    if (!res.ok) {
      let errMsg = 'Không thể xuất nhật ký (' + res.status + ').';
      try { const errJson = await res.json(); if (errJson?.error) errMsg = errJson.error; } catch (_) {}
      throw new Error(errMsg);
    }
    let blob;
    if (reqFormat === 'jsonl') {
      const rawText = await res.text();
      let content = rawText;
      try {
        const parsed = JSON.parse(rawText);
        if (parsed && Array.isArray(parsed.logs)) {
          content = parsed.logs.map(row => JSON.stringify(row)).join('\n');
        }
      } catch (_) {}
      blob = new Blob([content], { type: 'application/x-ndjson;charset=utf-8' });
    } else {
      const csvText = await res.text();
      blob = new Blob([csvText], { type: 'text/csv;charset=utf-8' });
    }
    const objUrl = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = objUrl;
    a.download = 'audit_logs_' + new Date().toISOString().slice(0, 10) + '.' + reqFormat;
    document.body.appendChild(a);
    try {
      a.click();
    } finally {
      document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(objUrl), 1000);
    }
    showToast('✅ Đã tải xuống file nhật ký (' + reqFormat.toUpperCase() + ').');
  } catch (err) {
    showToast('❌ Lỗi xuất nhật ký: ' + (err.message || 'Thất bại'), 'error');
  }
}

async function clearAllAuditLogs() {
  if (currentUser?.role !== 'admin') {
    showToast('Chỉ Quản trị viên mới có quyền xóa nhật ký.');
    return;
  }
  const confirm = window.confirm('⚠️ CẢNH BÁO QUẢN TRỊ VIÊN:\n\nBạn có chắc chắn muốn XÓA SẠCH toàn bộ lịch sử nhật ký hoạt động không?\n\nHành động này không thể hoàn tác và sự kiện xóa này sẽ được ghi nhận vào nhật ký mới để đối soát.');
  if (!confirm) return;

  try {
    const res = await requestJson('/api/manager/audit-logs/clear', { method: 'POST' });
    if (!res.ok) throw new Error(res.data?.error || 'Không thể xóa nhật ký.');
    showToast(res.data?.message || 'Đã xóa toàn bộ nhật ký cũ thành công!');
    await refreshAuditLogs(1);
  } catch (err) {
    showToast('Lỗi: ' + err.message);
  }
}

async function openBackupManagerModal() {
  closeUserProfileDropdown();
  if (currentUser?.role !== 'admin') {
    showToast('Chỉ Quản trị viên mới có quyền quản lý Backups.');
    return;
  }
  navigateTo('backup');
}

function closeBackupManagerModal() {
  navigateTo('dashboard');
}

async function refreshBackupList() {
  const tbody = document.getElementById('backupTableBody');
  if (tbody) tbody.innerHTML = '<tr><td colspan="4" style="text-align:center;padding:24px;color:var(--muted);">Đang tải danh sách bản sao lưu...</td></tr>';
  try {
    const res = await requestJson('/api/manager/backups');
    if (!res.ok) throw new Error(res.data?.error || 'Không thể tải danh sách backup.');
    const backups = Array.isArray(res.data?.backups) ? res.data.backups : [];
    const countEl = document.getElementById('backupTotalCount');
    if (countEl) countEl.textContent = 'Tổng cộng: ' + backups.length + ' bản sao lưu (Tối đa 30)';

    if (!backups.length) {
      if (tbody) tbody.innerHTML = '<tr><td colspan="4" style="text-align:center;padding:24px;color:var(--muted);">Chưa có bản sao lưu nào. Hãy bấm "Tạo Sao Lưu Ngay".</td></tr>';
      return;
    }

    if (tbody) {
      tbody.innerHTML = backups.map(b => {
        const timeStr = b.createdAt ? new Date(b.createdAt).toLocaleTimeString('vi-VN', { hour12: false }) + ' ' + new Date(b.createdAt).toLocaleDateString('vi-VN') : '-';
        const sizeKb = b.sizeBytes ? (b.sizeBytes / 1024).toFixed(1) + ' KB' : '-';
        return '<tr>' +
          '<td style="font-weight:600;font-family:monospace;font-size:11.5px;color:var(--text);">' + escapeHtml(b.filename) + '</td>' +
          '<td style="color:var(--muted);font-size:11px;">' + escapeHtml(timeStr) + '</td>' +
          '<td style="color:var(--muted);font-size:11px;">' + escapeHtml(sizeKb) + '</td>' +
          '<td style="text-align:right;white-space:nowrap;">' +
            '<span style="color:var(--green);font-size:10.5px;font-weight:700;background:rgba(34,197,94,0.15);padding:2px 8px;border-radius:999px;">✓ An toàn</span> ' +
            '<button type="button" class="small btn-restore-backup" data-filename="' + escapeHtml(b.filename) + '" style="margin-left:6px;padding:2px 8px;">↩ Khôi phục</button>' +
            '<button type="button" class="small danger btn-delete-backup" data-filename="' + escapeHtml(b.filename) + '" style="margin-left:6px;padding:2px 8px;">🗑 Xóa</button>' +
          '</td>' +
        '</tr>';
      }).join('');
      if (!tbody._delegationInit) {
        tbody._delegationInit = true;
        tbody.addEventListener('click', function(e) {
          const restoreBtn = e.target.closest('button.btn-restore-backup');
          if (restoreBtn) {
            const restoreName = restoreBtn.getAttribute('data-filename');
            if (restoreName) restoreBackupFile(restoreName);
            return;
          }
          const btn = e.target.closest('button.btn-delete-backup');
          if (!btn) return;
          const fn = btn.getAttribute('data-filename');
          if (fn) deleteBackupFile(fn);
        });
      }
    }
  } catch (err) {
    if (tbody) tbody.innerHTML = '<tr><td colspan="4" style="text-align:center;color:var(--red);padding:20px;">Lỗi: ' + escapeHtml(err.message) + '</td></tr>';
  }
}

async function deleteBackupFile(filename) {
  if (!filename) return;
  if (!confirm('Bạn có chắc chắn muốn xóa vĩnh viễn bản sao lưu "' + filename + '" không?')) return;
  try {
    const res = await requestJson('/api/manager/backups/' + encodeURIComponent(filename), { method: 'DELETE' });
    if (!res.ok) throw new Error(res.data?.error || 'Không thể xóa bản sao lưu.');
    showToast('✅ ' + (res.data?.message || 'Đã xóa bản sao lưu thành công!'));
    await refreshBackupList();
  } catch (err) {
    showToast('❌ Lỗi: ' + err.message);
  }
}
window.deleteBackupFile = deleteBackupFile;
async function restoreBackupFile(filename) {
  if (!filename || !confirm('Khôi phục "' + filename + '"? Hệ thống sẽ tạo backup dự phòng rồi thay thế Users, Keys, Registry và Bot Settings theo snapshot. Audit Logs và Sessions được giữ nguyên.')) return;
  const sendRestore = allowEmpty => requestJson('/api/manager/backups/' + encodeURIComponent(filename) + '/restore', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ allowEmpty: allowEmpty === true }),
    timeoutMs: 30000
  });
  try {
    showToast('Đang khôi phục backup và đồng bộ worker...');
    let res = await sendRestore(false);
    if (!res.ok && res.data?.code === 'EMPTY_SNAPSHOT') {
      const emptyFields = Array.isArray(res.data?.emptyFields) && res.data.emptyFields.length
        ? res.data.emptyFields.join(', ')
        : 'users, keys hoặc bot_settings';
      const confirmed = confirm('⚠️ CẢNH BÁO DỮ LIỆU RỖNG\n\nBackup này có snapshot rỗng: ' + emptyFields + '.\nNếu tiếp tục, dữ liệu tương ứng trên Cloud sẽ bị xóa sạch (không thể hoàn tác ngoài bản backup dự phòng).\n\nBạn đã kiểm tra đúng backup và thực sự muốn tiếp tục?');
      if (!confirmed) {
        showToast('Đã hủy khôi phục backup rỗng.');
        return;
      }
      res = await sendRestore(true);
    }
    if (!res.ok) throw new Error(res.data?.error || res.data?.message || 'Khôi phục backup thất bại.');
    showToast((res.data?.partial ? '⚠️ ' : '✅ ') + (res.data?.message || 'Đã khôi phục backup.'));
    await Promise.all([refreshBackupList(), refreshHome()]);
  } catch (err) {
    showToast('❌ ' + err.message);
  }
}
window.restoreBackupFile = restoreBackupFile;
async function triggerCreateBackup() {
  try {
    showToast('Đang tạo bản sao lưu hệ thống...');
    const res = await requestJson('/api/manager/backups/create', { method: 'POST' });
    if (!res.ok) throw new Error(res.data?.error || 'Không thể tạo backup.');
    showToast('✅ ' + (res.data?.message || 'Đã tạo bản sao lưu thành công!'));
    await refreshBackupList();
  } catch (err) {
    showToast('❌ Lỗi: ' + err.message);
  }
}

async function submitChangePassword(event) {
  if (event) event.preventDefault();
  const oldPassword = document.getElementById('changePassOld')?.value || '';
  const newPassword = document.getElementById('changePassNew')?.value || '';
  const confirmPassword = document.getElementById('changePassConfirm')?.value || '';
  const alertEl = document.getElementById('changePassAlert');
  const btn = document.getElementById('changePassSubmitBtn');

  if (!oldPassword) {
    if (alertEl) { alertEl.className = 'login-alert error'; alertEl.textContent = 'Vui lòng nhập mật khẩu hiện tại.'; }
    return;
  }
  if (!newPassword || newPassword.length < 6) {
    if (alertEl) { alertEl.className = 'login-alert error'; alertEl.textContent = 'Mật khẩu mới phải từ 6 ký tự trở lên.'; }
    return;
  }
  if (newPassword !== confirmPassword) {
    if (alertEl) { alertEl.className = 'login-alert error'; alertEl.textContent = 'Xác nhận mật khẩu mới không trùng khớp.'; }
    return;
  }
  if (oldPassword === newPassword) {
    if (alertEl) { alertEl.className = 'login-alert error'; alertEl.textContent = 'Mật khẩu mới không được trùng với mật khẩu hiện tại.'; }
    return;
  }

  if (alertEl) alertEl.className = 'login-alert hidden';
  if (btn) { btn.disabled = true; btn.textContent = '⏳ Đang lưu...'; }

  try {
    const res = await requestJson('/api/auth/change-password', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ currentPassword: oldPassword, oldPassword, newPassword })
    });
    if (!res.ok) {
      throw new Error(res.data?.error || 'Không thể đổi mật khẩu.');
    }
    showToast('✅ ' + (res.data?.message || 'Đổi mật khẩu thành công! Vui lòng đăng nhập lại.'), 'success', 3000);
    closeChangePasswordModal();
    setTimeout(() => {
      logout();
    }, 1500);
  } catch (err) {
    if (alertEl) {
      alertEl.className = 'login-alert error';
      alertEl.textContent = '⚠️ ' + err.message;
    }
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = '💾 Cập Nhật Mật Khẩu'; }
  }
}

