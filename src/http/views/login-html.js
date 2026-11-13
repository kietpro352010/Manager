'use strict';

const PUBLIC_LOGIN_HTML = `<!doctype html>
<html lang="vi" data-theme="deep-galaxy">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="dark light">
<title>KBOT Manager — Đăng Nhập Hệ Thống Quản Lý Bot Minecraft</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&family=JetBrains+Mono:wght@500;700&display=swap" rel="stylesheet">
<script data-kbot-theme-boot>
(function(){
  try {
    var raw = localStorage.getItem('kbot_theme') || localStorage.getItem('kbot_dashboard_theme') || localStorage.getItem('kbot_cosmic_mode') || 'deep-galaxy';
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
    var theme = map[raw] || 'deep-galaxy';
    document.documentElement.setAttribute('data-theme', theme);
    document.documentElement.style.colorScheme = theme === 'moonlight' ? 'light' : 'dark';
  } catch (_) {}
})();
</script>
<style>
:root,
:root[data-theme="deep-galaxy"] {
  color-scheme: dark;
  --bg-base: #080511;
  --bg-elevated: #110b22;
  --bg-glow-1: rgba(124, 58, 237, 0.24);
  --bg-glow-2: rgba(91, 33, 182, 0.18);
  --bg-glow-3: rgba(56, 189, 248, 0.08);
  --surface-card: rgba(19, 14, 36, 0.90);
  --surface-panel: rgba(24, 18, 46, 0.86);
  --surface-soft: rgba(34, 26, 62, 0.72);
  --surface-input: rgba(10, 7, 20, 0.92);
  --border-subtle: rgba(167, 139, 250, 0.22);
  --border-strong: rgba(167, 139, 250, 0.42);
  --text-primary: #f5f3ff;
  --text-secondary: #cbc4e6;
  --text-muted: #9b92bf;
  --accent: #8b5cf6;
  --accent-hover: #7c3aed;
  --accent-active: #6d28d9;
  --accent-soft: rgba(139, 92, 246, 0.16);
  --accent-text: #c4b5fd;
  --accent-on: #ffffff;
  --success: #22c55e;
  --success-soft: rgba(34, 197, 94, 0.14);
  --success-text: #86efac;
  --danger: #ef4444;
  --danger-soft: rgba(239, 68, 68, 0.14);
  --danger-text: #fca5a5;
  --warning: #f59e0b;
  --warning-soft: rgba(245, 158, 11, 0.14);
  --warning-text: #fcd34d;
  --neutral-soft: rgba(148, 163, 184, 0.14);
  --neutral-text: #cbd5e1;
  --shadow-card: 0 24px 60px rgba(4, 2, 12, 0.62);
  --diorama-sky-top: #0b0618;
  --diorama-sky-bot: #1f1142;
  --cloud-color: rgba(196, 181, 253, 0.12);
}

:root[data-theme="ocean-abyss"] {
  color-scheme: dark;
  --bg-base: #040d1a;
  --bg-elevated: #08172c;
  --bg-glow-1: rgba(14, 165, 233, 0.22);
  --bg-glow-2: rgba(2, 132, 199, 0.18);
  --bg-glow-3: rgba(56, 189, 248, 0.12);
  --surface-card: rgba(8, 23, 44, 0.92);
  --surface-panel: rgba(10, 28, 54, 0.88);
  --surface-soft: rgba(14, 38, 70, 0.75);
  --surface-input: rgba(5, 15, 30, 0.94);
  --border-subtle: rgba(56, 189, 248, 0.22);
  --border-strong: rgba(56, 189, 248, 0.44);
  --text-primary: #f0f9ff;
  --text-secondary: #bae6fd;
  --text-muted: #7dd3fc;
  --accent: #0ea5e9;
  --accent-hover: #38bdf8;
  --accent-active: #0284c7;
  --accent-soft: rgba(14, 165, 233, 0.18);
  --accent-text: #7dd3fc;
  --accent-on: #ffffff;
  --success: #10b981;
  --success-soft: rgba(16, 185, 129, 0.16);
  --success-text: #6ee7b7;
  --danger: #ef4444;
  --danger-soft: rgba(239, 68, 68, 0.16);
  --danger-text: #fca5a5;
  --warning: #f59e0b;
  --warning-soft: rgba(245, 158, 11, 0.16);
  --warning-text: #fcd34d;
  --neutral-soft: rgba(148, 163, 184, 0.16);
  --neutral-text: #cbd5e1;
  --shadow-card: 0 24px 60px rgba(2, 8, 20, 0.70);
  --diorama-sky-top: #030a14;
  --diorama-sky-bot: #0a2544;
  --cloud-color: rgba(125, 211, 252, 0.14);
}

:root[data-theme="violet-dusk"] {
  color-scheme: dark;
  --bg-base: #121118;
  --bg-elevated: #191722;
  --bg-glow-1: rgba(126, 91, 239, 0.14);
  --bg-glow-2: rgba(94, 72, 178, 0.10);
  --bg-glow-3: rgba(148, 163, 184, 0.05);
  --surface-card: #1d1b27;
  --surface-panel: #191722;
  --surface-soft: #242131;
  --surface-input: #13111a;
  --border-subtle: rgba(176, 168, 206, 0.20);
  --border-strong: rgba(176, 168, 206, 0.36);
  --text-primary: #f2f0fa;
  --text-secondary: #c5bfd8;
  --text-muted: #9891b0;
  --accent: #7e5bef;
  --accent-hover: #6f4ce2;
  --accent-active: #5f3dc4;
  --accent-soft: rgba(126, 91, 239, 0.16);
  --accent-text: #c4b5fd;
  --accent-on: #ffffff;
  --success: #22c55e;
  --success-soft: rgba(34, 197, 94, 0.14);
  --success-text: #86efac;
  --danger: #ef4444;
  --danger-soft: rgba(239, 68, 68, 0.14);
  --danger-text: #fca5a5;
  --warning: #f59e0b;
  --warning-soft: rgba(245, 158, 11, 0.14);
  --warning-text: #fcd34d;
  --neutral-soft: rgba(148, 163, 184, 0.14);
  --neutral-text: #cbd5e1;
  --shadow-card: 0 20px 48px rgba(5, 4, 10, 0.50);
  --diorama-sky-top: #14121d;
  --diorama-sky-bot: #231e36;
  --cloud-color: rgba(196, 181, 253, 0.08);
}

:root[data-theme="moonlight"] {
  color-scheme: light;
  --bg-base: #edf1f7;
  --bg-elevated: #ffffff;
  --bg-glow-1: rgba(99, 102, 241, 0.08);
  --bg-glow-2: rgba(14, 165, 233, 0.06);
  --bg-glow-3: rgba(148, 163, 184, 0.05);
  --surface-card: #ffffff;
  --surface-panel: #ffffff;
  --surface-soft: #f1f5f9;
  --surface-input: #ffffff;
  --border-subtle: #cbd5e1;
  --border-strong: #94a3b8;
  --text-primary: #0f172a;
  --text-secondary: #334155;
  --text-muted: #64748b;
  --accent: #4f46e5;
  --accent-hover: #4338ca;
  --accent-active: #3730a3;
  --accent-soft: rgba(79, 70, 229, 0.10);
  --accent-text: #4f46e5;
  --accent-on: #ffffff;
  --success: #16a34a;
  --success-soft: rgba(22, 163, 74, 0.12);
  --success-text: #15803d;
  --danger: #dc2626;
  --danger-soft: rgba(220, 38, 38, 0.12);
  --danger-text: #b91c1c;
  --warning: #d97706;
  --warning-soft: rgba(217, 119, 6, 0.12);
  --warning-text: #b45309;
  --neutral-soft: rgba(100, 116, 139, 0.12);
  --neutral-text: #334155;
  --shadow-card: 0 16px 40px rgba(15, 23, 42, 0.09), 0 1px 3px rgba(15, 23, 42, 0.06);
  --diorama-sky-top: #e2e8f0;
  --diorama-sky-bot: #cbd5e1;
  --cloud-color: rgba(255, 255, 255, 0.85);
}

*, *::before, *::after {
  box-sizing: border-box;
}

html, body {
  margin: 0;
  padding: 0;
  min-height: 100%;
  background: var(--bg-base);
  color: var(--text-primary);
  font-family: 'Inter', system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
  line-height: 1.5;
  -webkit-font-smoothing: antialiased;
  overflow-x: hidden;
}

.sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
  white-space: nowrap;
  border: 0;
}

.hidden,
[hidden] {
  display: none !important;
}

/* =========================================================
   SEAMLESS INFINITE AMBIENT BACKGROUND
   ========================================================= */
.scene-bg {
  position: fixed;
  inset: 0;
  z-index: 0;
  pointer-events: none;
  overflow: hidden;
  background:
    radial-gradient(ellipse 75% 58% at 18% 18%, var(--bg-glow-1), transparent 68%),
    radial-gradient(ellipse 68% 55% at 84% 80%, var(--bg-glow-2), transparent 68%),
    radial-gradient(ellipse 50% 45% at 52% 45%, var(--bg-glow-3), transparent 70%),
    var(--bg-base);
}

.scene-video {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  object-fit: cover;
  opacity: 0.18;
  filter: saturate(0.85) hue-rotate(12deg);
  pointer-events: none;
}

:root[data-theme="moonlight"] .scene-video,
:root[data-theme="violet-dusk"] .scene-video {
  opacity: 0.08;
}
:root[data-theme="ocean-abyss"] .scene-video {
  opacity: 0.22;
  filter: saturate(1.1) hue-rotate(180deg);
}

.scene-nebula {
  position: absolute;
  inset: -12%;
  background:
    radial-gradient(circle at 26% 34%, rgba(139, 92, 246, 0.16), transparent 42%),
    radial-gradient(circle at 74% 66%, rgba(109, 40, 217, 0.14), transparent 46%);
  opacity: 0.85;
  will-change: transform, opacity;
}

:root[data-theme="ocean-abyss"] .scene-nebula {
  background:
    radial-gradient(circle at 26% 34%, rgba(14, 165, 233, 0.22), transparent 45%),
    radial-gradient(circle at 74% 66%, rgba(2, 132, 199, 0.18), transparent 50%);
  opacity: 0.88;
}

:root[data-theme="moonlight"] .scene-nebula {
  opacity: 0.20;
}

:root[data-theme="violet-dusk"] .scene-nebula {
  opacity: 0.45;
}

/* Ocean Abyss Portal Styling */
:root[data-theme="ocean-abyss"] .portal-aura-glow {
  fill: url(#portalGlowOcean);
}
:root[data-theme="ocean-abyss"] .portal-core-pulse {
  fill: url(#portalCoreOcean);
}

/* Moonlight Light-Theme Contrast & Border Enhancements */
:root[data-theme="moonlight"] .auth-card {
  background: #ffffff !important;
  border: 1px solid #cbd5e1 !important;
  box-shadow: 0 16px 40px rgba(15, 23, 42, 0.09), 0 1px 3px rgba(15, 23, 42, 0.05) !important;
}
:root[data-theme="moonlight"] .feature-card,
:root[data-theme="moonlight"] .feature-item,
:root[data-theme="moonlight"] .discord-support-link {
  background: #ffffff !important;
  border: 1px solid #cbd5e1 !important;
  box-shadow: 0 2px 4px rgba(15, 23, 42, 0.04) !important;
}
:root[data-theme="moonlight"] .discord-support-link {
  color: #334155 !important;
}
:root[data-theme="moonlight"] .discord-support-link:hover {
  background: #f8fafc !important;
  border-color: #6366f1 !important;
  color: #0f172a !important;
}
:root[data-theme="moonlight"] .brand-pill {
  background: #ffffff !important;
  border: 1px solid #cbd5e1 !important;
  color: #334155 !important;
}
:root[data-theme="moonlight"] .server-pulse-tag {
  background: #ffffff !important;
  border: 1px solid #cbd5e1 !important;
}
:root[data-theme="moonlight"] .auth-field input {
  background: #ffffff !important;
  border: 1px solid #cbd5e1 !important;
  color: #0f172a !important;
}
:root[data-theme="moonlight"] .auth-field input:focus {
  border-color: #6366f1 !important;
  box-shadow: 0 0 0 3px rgba(99, 102, 241, 0.15) !important;
}
:root[data-theme="moonlight"] .theme-switcher {
  background: #e2e8f0 !important;
  border: 1px solid #cbd5e1 !important;
}
:root[data-theme="moonlight"] .theme-pill-btn {
  color: #475569 !important;
}
:root[data-theme="moonlight"] .theme-pill-btn.active {
  background: #ffffff !important;
  color: #0f172a !important;
  border: 1px solid #cbd5e1 !important;
  box-shadow: 0 1px 3px rgba(15, 23, 42, 0.08) !important;
}
:root[data-theme="moonlight"] .auth-tab-btn {
  color: #64748b !important;
}
:root[data-theme="moonlight"] .auth-tab-btn.active {
  background: #ffffff !important;
  color: #0f172a !important;
  border: 1px solid #cbd5e1 !important;
}

.scene-canvas {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  display: block;
}

.scene-clouds {
  position: absolute;
  left: 0;
  right: 0;
  bottom: 0;
  height: 220px;
  overflow: hidden;
  opacity: 0.7;
}

.cloud-track {
  display: flex;
  width: 200%;
  height: 100%;
  will-change: transform;
}

.cloud-band {
  width: 50%;
  height: 100%;
  background:
    radial-gradient(ellipse 22% 55% at 12% 85%, var(--cloud-color), transparent 72%),
    radial-gradient(ellipse 28% 60% at 38% 92%, var(--cloud-color), transparent 72%),
    radial-gradient(ellipse 24% 52% at 64% 86%, var(--cloud-color), transparent 72%),
    radial-gradient(ellipse 26% 58% at 88% 90%, var(--cloud-color), transparent 72%);
}

/* =========================================================
   LAYOUT SHELL
   ========================================================= */
.page-shell {
  position: relative;
  z-index: 1;
  min-height: 100dvh;
  max-width: 1240px;
  margin: 0 auto;
  padding: 24px 24px 36px;
  display: flex;
  flex-direction: column;
  justify-content: space-between;
  gap: 20px;
  box-sizing: border-box;
}

.topbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 14px;
  flex-wrap: wrap;
}

.brand-lockup {
  display: inline-flex;
  align-items: center;
  gap: 12px;
  min-width: 0;
}

.brand-emblem {
  width: 40px;
  height: 40px;
  border-radius: 12px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  background: var(--accent-soft);
  border: 1px solid var(--border-strong);
  color: var(--accent-text);
  flex-shrink: 0;
}

.brand-meta {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.brand-title-row {
  display: flex;
  align-items: center;
  gap: 8px;
}

.brand-name {
  font-size: 16px;
  font-weight: 800;
  letter-spacing: -0.02em;
  color: var(--text-primary);
}

.brand-version {
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-size: 11px;
  font-weight: 700;
  padding: 2px 7px;
  border-radius: 999px;
  background: var(--accent-soft);
  border: 1px solid var(--border-subtle);
  color: var(--accent-text);
}

.brand-sub {
  font-size: 12px;
  color: var(--text-muted);
}

.topbar-controls {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
}

.server-pulse-tag {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 7px 12px;
  border-radius: 999px;
  font-size: 12.5px;
  font-weight: 600;
  border: 1px solid var(--border-subtle);
  background: var(--surface-card);
  color: var(--text-secondary);
  min-height: 36px;
}

.status-dot {
  width: 8px;
  height: 8px;
  border-radius: 999px;
  background: var(--text-muted);
  flex-shrink: 0;
}

.server-pulse-tag.is-checking {
  background: var(--neutral-soft);
  color: var(--neutral-text);
}
.server-pulse-tag.is-checking .status-dot {
  background: var(--neutral-text);
}

.server-pulse-tag.is-online {
  background: var(--success-soft);
  border-color: rgba(34, 197, 94, 0.36);
  color: var(--success-text);
}
.server-pulse-tag.is-online .status-dot {
  background: var(--success);
}

.server-pulse-tag.is-degraded {
  background: var(--warning-soft);
  border-color: rgba(245, 158, 11, 0.36);
  color: var(--warning-text);
}
.server-pulse-tag.is-degraded .status-dot {
  background: var(--warning);
}

.server-pulse-tag.is-offline {
  background: var(--danger-soft);
  border-color: rgba(239, 68, 68, 0.36);
  color: var(--danger-text);
}
.server-pulse-tag.is-offline .status-dot {
  background: var(--danger);
}

.theme-switcher {
  display: inline-flex;
  align-items: center;
  padding: 3px;
  border-radius: 10px;
  background: var(--surface-card);
  border: 1px solid var(--border-subtle);
  gap: 2px;
}

.theme-pill-btn {
  appearance: none;
  border: 1px solid transparent;
  background: transparent;
  color: var(--text-muted);
  font-family: inherit;
  font-size: 12px;
  font-weight: 600;
  padding: 6px 10px;
  min-height: 30px;
  border-radius: 7px;
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  gap: 5px;
  transition: background-color 0.16s ease, color 0.16s ease, border-color 0.16s ease;
}

.theme-pill-btn:hover {
  color: var(--text-primary);
  background: var(--surface-soft);
}

.theme-pill-btn.active,
.theme-pill-btn[aria-pressed="true"] {
  background: var(--accent-soft);
  color: var(--accent-text);
  border-color: var(--border-strong);
}

/* =========================================================
   SPLIT-SCREEN MAIN WORKSPACE
   ========================================================= */
.split-grid {
  flex: 1;
  display: grid;
  grid-template-columns: minmax(0, 1.15fr) minmax(380px, 440px);
  gap: 40px;
  align-items: center;
  margin: auto 0;
  width: 100%;
}

.hero-panel {
  display: flex;
  flex-direction: column;
  gap: 18px;
  min-width: 0;
}

.hero-kicker {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  align-self: flex-start;
  padding: 5px 12px;
  border-radius: 999px;
  background: var(--accent-soft);
  border: 1px solid var(--border-strong);
  color: var(--accent-text);
  font-size: 12px;
  font-weight: 700;
  letter-spacing: 0.02em;
}

.hero-heading {
  margin: 0;
  font-size: clamp(28px, 3.6vw, 42px);
  font-weight: 800;
  line-height: 1.16;
  letter-spacing: -0.03em;
  color: var(--text-primary);
}

.hero-heading-accent {
  color: var(--accent-text);
}

.hero-lead {
  margin: 0;
  font-size: 15px;
  line-height: 1.6;
  color: var(--text-secondary);
  max-width: 58ch;
}

/* =========================================================
   MINECRAFT FLOATING ISLAND & PORTAL DIORAMA
   ========================================================= */
.hero-diorama {
  position: relative;
  border-radius: 18px;
  border: 1px solid var(--border-subtle);
  background: linear-gradient(180deg, var(--diorama-sky-top) 0%, var(--diorama-sky-bot) 100%);
  overflow: hidden;
  min-height: 204px;
  max-height: 224px;
  display: flex;
  align-items: center;
  justify-content: center;
  box-shadow: var(--shadow-card);
}

.hero-diorama-svg {
  width: 100%;
  height: auto;
  max-height: 256px;
  display: block;
}

.diorama-caption {
  position: absolute;
  left: 14px;
  bottom: 12px;
  right: 14px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  pointer-events: none;
}

.diorama-badge {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 5px 10px;
  border-radius: 8px;
  background: var(--surface-card);
  border: 1px solid var(--border-subtle);
  font-size: 11.5px;
  font-weight: 600;
  color: var(--text-secondary);
}

/* =========================================================
   FEATURE CARDS (AUTHENTIC REPO CAPABILITIES)
   ========================================================= */
.feature-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px;
}

.feature-card {
  display: flex;
  align-items: flex-start;
  gap: 12px;
  padding: 13px 14px;
  border-radius: 14px;
  background: var(--surface-panel);
  border: 1px solid var(--border-subtle);
}

.feature-icon {
  width: 34px;
  height: 34px;
  border-radius: 9px;
  background: var(--accent-soft);
  border: 1px solid var(--border-subtle);
  color: var(--accent-text);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}

.feature-title {
  margin: 0 0 2px;
  font-size: 13.5px;
  font-weight: 700;
  color: var(--text-primary);
}

.feature-desc {
  margin: 0;
  font-size: 12.2px;
  line-height: 1.45;
  color: var(--text-muted);
}

.hero-footer-links {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  flex-wrap: wrap;
}

.discord-support-link {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 8px 14px;
  min-height: 38px;
  border-radius: 10px;
  background: var(--surface-panel);
  border: 1px solid var(--border-subtle);
  color: var(--text-secondary);
  font-size: 13px;
  font-weight: 600;
  text-decoration: none;
  transition: border-color 0.16s ease, color 0.16s ease, background-color 0.16s ease;
}

.discord-support-link:hover {
  border-color: var(--border-strong);
  color: var(--text-primary);
  background: var(--surface-soft);
}

.hero-footnote {
  font-size: 12px;
  color: var(--text-muted);
}

/* =========================================================
   AUTH CARD (RIGHT COLUMN — PRIMARY FOCUS)
   ========================================================= */
.auth-column {
  display: flex;
  flex-direction: column;
  width: 100%;
}

.auth-card {
  position: relative;
  background: var(--surface-card);
  border: 1px solid var(--border-strong);
  border-top: 2px solid var(--accent);
  border-radius: 18px;
  padding: 26px 24px 22px;
  box-shadow: var(--shadow-card);
}

.auth-card-header {
  margin-bottom: 18px;
}

.auth-card-title {
  margin: 0 0 4px;
  font-size: 20px;
  font-weight: 800;
  letter-spacing: -0.02em;
  color: var(--text-primary);
}

.auth-card-subtitle {
  margin: 0;
  font-size: 13px;
  color: var(--text-muted);
}

.auth-tabs {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 6px;
  padding: 4px;
  border-radius: 12px;
  background: var(--surface-input);
  border: 1px solid var(--border-subtle);
  margin-bottom: 18px;
}

.auth-tab-btn {
  appearance: none;
  border: 1px solid transparent;
  background: transparent;
  color: var(--text-muted);
  font-family: inherit;
  font-size: 13.5px;
  font-weight: 700;
  min-height: 40px;
  border-radius: 9px;
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 7px;
  transition: background-color 0.16s ease, color 0.16s ease, border-color 0.16s ease;
}

.auth-tab-btn:hover {
  color: var(--text-primary);
}

.auth-tab-btn.active,
.auth-tab-btn[aria-selected="true"] {
  background: var(--accent-soft);
  border-color: var(--border-strong);
  color: var(--accent-text);
  box-shadow: inset 0 -2px 0 var(--accent);
}

.login-alert {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  padding: 11px 12px;
  border-radius: 10px;
  font-size: 13px;
  line-height: 1.45;
  margin-bottom: 16px;
  border: 1px solid transparent;
}

.login-alert.error {
  background: var(--danger-soft);
  border-color: rgba(239, 68, 68, 0.35);
  color: var(--danger-text);
}

.login-alert.success {
  background: var(--success-soft);
  border-color: rgba(34, 197, 94, 0.35);
  color: var(--success-text);
}

.login-alert.info {
  background: var(--accent-soft);
  border-color: var(--border-strong);
  color: var(--accent-text);
}

.alert-icon-wrap {
  flex-shrink: 0;
  margin-top: 1px;
}

.trial-callout {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  padding: 11px 12px;
  border-radius: 10px;
  background: var(--accent-soft);
  border: 1px solid var(--border-strong);
  color: var(--text-secondary);
  font-size: 12.5px;
  line-height: 1.45;
  margin-bottom: 16px;
}

.trial-callout-icon {
  color: var(--accent-text);
  flex-shrink: 0;
  margin-top: 1px;
}

.auth-form {
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.field-group {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.field-label {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 8px;
  font-size: 12.5px;
  font-weight: 600;
  color: var(--text-secondary);
}

.field-hint-inline {
  font-size: 11.5px;
  font-weight: 500;
  color: var(--text-muted);
}

.input-wrap {
  position: relative;
  display: flex;
  align-items: center;
}

.field-input {
  width: 100%;
  min-height: 44px;
  padding: 10px 12px;
  border-radius: 10px;
  background: var(--surface-input);
  border: 1px solid var(--border-subtle);
  color: var(--text-primary);
  font-family: inherit;
  font-size: 14px;
  transition: border-color 0.16s ease, box-shadow 0.16s ease;
}

.field-input::placeholder {
  color: var(--text-muted);
}

.field-input:hover {
  border-color: var(--border-strong);
}

.field-input:focus {
  outline: none;
  border-color: var(--accent);
  box-shadow: 0 0 0 3px var(--accent-soft);
}

.field-input.has-toggle {
  padding-right: 46px;
}

.field-input.is-invalid,
.field-input[aria-invalid="true"] {
  border-color: var(--danger);
}

.key-input {
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  letter-spacing: 0.03em;
  font-size: 13px;
}

.password-toggle-btn {
  position: absolute;
  right: 4px;
  top: 50%;
  transform: translateY(-50%);
  width: 38px;
  height: 38px;
  border: none;
  border-radius: 8px;
  background: transparent;
  color: var(--text-muted);
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  transition: background-color 0.15s ease, color 0.15s ease;
}

.password-toggle-btn:hover {
  background: var(--accent-soft);
  color: var(--text-primary);
}

.field-error {
  margin: 0;
  font-size: 12px;
  font-weight: 600;
  color: var(--danger-text);
}

.remember-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  margin: 2px 0;
}

.checkbox-label {
  display: inline-flex;
  align-items: center;
  gap: 9px;
  font-size: 13px;
  font-weight: 500;
  color: var(--text-secondary);
  cursor: pointer;
  min-height: 28px;
}

.checkbox-label input[type="checkbox"] {
  width: 17px;
  height: 17px;
  accent-color: var(--accent);
  cursor: pointer;
}

.primary-cta {
  width: 100%;
  min-height: 46px;
  padding: 11px 16px;
  border: 1px solid transparent;
  border-radius: 11px;
  background: var(--accent);
  color: var(--accent-on);
  font-family: inherit;
  font-size: 14px;
  font-weight: 700;
  letter-spacing: 0.01em;
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 9px;
  margin-top: 4px;
  transition: background-color 0.16s ease, transform 0.14s ease, opacity 0.16s ease;
}

.primary-cta:hover:not(:disabled) {
  background: var(--accent-hover);
}

.primary-cta:active:not(:disabled) {
  background: var(--accent-active);
  transform: translateY(1px);
}

.primary-cta:disabled {
  opacity: 0.72;
  cursor: not-allowed;
}

.primary-cta.is-success {
  background: var(--success);
  color: #ffffff;
}

.auth-footer-note {
  margin-top: 16px;
  padding-top: 14px;
  border-top: 1px solid var(--border-subtle);
  font-size: 12px;
  line-height: 1.5;
  color: var(--text-muted);
  display: flex;
  align-items: flex-start;
  gap: 8px;
}

.ui-icon {
  width: 18px;
  height: 18px;
  flex-shrink: 0;
}

.auth-tab-btn:focus-visible,
.theme-pill-btn:focus-visible,
.password-toggle-btn:focus-visible,
.primary-cta:focus-visible,
.discord-support-link:focus-visible,
.checkbox-label input:focus-visible {
  outline: 2px solid var(--accent-text);
  outline-offset: 2px;
}

/* =========================================================
   ANIMATIONS (STRICT PREFERS-REDUCED-MOTION OPT-IN)
   ========================================================= */
@keyframes kbotCloudScroll {
  from { transform: translate3d(0, 0, 0); }
  to { transform: translate3d(-50%, 0, 0); }
}

@keyframes kbotIslandFloat {
  0%, 100% { transform: translate3d(0, 0px, 0); }
  50% { transform: translate3d(0, -6px, 0); }
}

@keyframes kbotPortalPulse {
  0%, 100% { opacity: 0.78; transform: scale(1); }
  50% { opacity: 1; transform: scale(1.03); }
}

@keyframes kbotNebulaDrift {
  0%, 100% { transform: translate3d(0, 0, 0) scale(1); }
  50% { transform: translate3d(1.5%, -1.2%, 0) scale(1.03); }
}

@keyframes kbotSpin {
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
}

@media (prefers-reduced-motion: no-preference) {
  .cloud-track {
    animation: kbotCloudScroll 52s linear infinite;
  }
  .scene-nebula {
    animation: kbotNebulaDrift 26s ease-in-out infinite;
  }
  .island-float-group {
    transform-origin: center;
    animation: kbotIslandFloat 6.5s ease-in-out infinite;
  }
  .portal-core-pulse {
    transform-origin: 320px 104px;
    animation: kbotPortalPulse 4s ease-in-out infinite;
  }
  .icon-spin {
    animation: kbotSpin 0.9s linear infinite;
  }
  :root[data-theme="violet-dusk"] .cloud-track {
    animation-duration: 78s;
  }
  :root[data-theme="violet-dusk"] .scene-nebula {
    animation: none;
  }
}

/* =========================================================
   FORCED COLORS ACCESSIBILITY SUPPORT
   ========================================================= */
@media (forced-colors: active) {
  .auth-card,
  .feature-card,
  .theme-switcher,
  .server-pulse-tag,
  .field-input,
  .primary-cta,
  .auth-tab-btn.active {
    border: 1px solid CanvasText;
  }
}

/* =========================================================
   RESPONSIVE MOBILE (KEEP LOGIN ABOVE THE FOLD)
   ========================================================= */
@media (max-width: 960px) {
  .page-shell {
    padding: 16px 16px 28px;
    gap: 18px;
  }
  .split-grid {
    grid-template-columns: 1fr;
    gap: 20px;
    align-items: stretch;
  }
  .auth-column {
    order: 1;
  }
  .hero-panel {
    order: 2;
  }
  .hero-diorama {
    min-height: 170px;
  }
  .feature-grid {
    grid-template-columns: 1fr;
  }
}

@media (max-width: 520px) {
  .topbar {
    gap: 10px;
  }
  .theme-pill-btn {
    padding: 7px 9px;
    min-height: 36px;
    font-size: 11.5px;
  }
  .auth-card {
    padding: 20px 16px 18px;
  }
  .primary-cta,
  .field-input,
  .auth-tab-btn {
    min-height: 46px;
  }
  .password-toggle-btn {
    width: 44px;
    height: 44px;
  }
}
</style>
</head>
<body>

<div class="scene-bg" aria-hidden="true">
  <video id="publicGalaxyVideo" class="scene-video" autoplay muted loop playsinline preload="none" poster=""></video>
  <div class="scene-nebula"></div>
  <canvas id="publicStarfieldCanvas" class="scene-canvas"></canvas>
  <div class="scene-clouds">
    <div class="cloud-track">
      <div class="cloud-band"></div>
      <div class="cloud-band"></div>
    </div>
  </div>
</div>

<main class="page-shell">
  <header class="topbar">
    <div class="brand-lockup">
      <div class="brand-emblem" aria-hidden="true">
        <svg class="ui-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M12 2L3 7v10l9 5 9-5V7l-9-5z"/>
          <path d="M12 22V12"/>
          <path d="M21 7l-9 5-9-5"/>
        </svg>
      </div>
      <div class="brand-meta">
        <div class="brand-title-row">
          <span class="brand-name">KBOT Manager</span>
          <span class="brand-version">V11.8</span>
        </div>
        <span class="brand-sub">Nền Tảng Điều Khiển Minecraft Bot Thương Mại</span>
      </div>
    </div>

    <div class="topbar-controls">
      <div id="serverStatusPill" class="server-pulse-tag is-checking" role="status" aria-live="polite">
        <span class="status-dot" aria-hidden="true"></span>
        <span id="serverStatusText">Đang kiểm tra trạng thái...</span>
      </div>

      <div class="theme-switcher" role="group" aria-label="Chọn giao diện hiển thị">
        <button type="button" class="theme-pill-btn active" data-theme-choice="deep-galaxy" aria-pressed="true">Deep Galaxy</button>
        <button type="button" class="theme-pill-btn" data-theme-choice="ocean-abyss" aria-pressed="false">Ocean Abyss</button>
        <button type="button" class="theme-pill-btn" data-theme-choice="violet-dusk" aria-pressed="false">Violet Dusk</button>
        <button type="button" class="theme-pill-btn" data-theme-choice="moonlight" aria-pressed="false">Moonlight</button>
      </div>
    </div>
  </header>

  <section class="split-grid" aria-label="Khu vực giới thiệu và đăng nhập">
    <div class="hero-panel">
      <div class="hero-kicker">
        <svg class="ui-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
          <rect x="4" y="4" width="16" height="16" rx="3"/>
          <path d="M9 9h6v6H9z"/>
        </svg>
        <span>KIẾN TRÚC WORKER PHÂN TÁN • PURE RENDER NATIVE</span>
      </div>

      <h1 class="hero-heading">
        Điều Khiển Hạm Đội <span class="hero-heading-accent">Minecraft Bot</span> Mọi Lúc
      </h1>

      <p class="hero-lead">
        Giám sát trạng thái trực tiếp, thao tác Remote GUI trong game, quản lý 36 ô hòm đồ, lên lịch tự động và phân quyền thuê bot an toàn trên một bảng điều khiển duy nhất.
      </p>

      <div class="hero-diorama" aria-hidden="true">
        <svg class="hero-diorama-svg" viewBox="0 0 640 240" fill="none" xmlns="http://www.w3.org/2000/svg">
          <defs>
            <radialGradient id="portalGlow" cx="50%" cy="50%" r="50%">
              <stop offset="0%" stop-color="#c084fc" stop-opacity="0.95"/>
              <stop offset="48%" stop-color="#7c3aed" stop-opacity="0.65"/>
              <stop offset="100%" stop-color="#4c1d95" stop-opacity="0"/>
            </radialGradient>
            <radialGradient id="portalGlowOcean" cx="50%" cy="50%" r="50%">
              <stop offset="0%" stop-color="#38bdf8" stop-opacity="0.95"/>
              <stop offset="48%" stop-color="#0ea5e9" stop-opacity="0.65"/>
              <stop offset="100%" stop-color="#0284c7" stop-opacity="0"/>
            </radialGradient>
            <linearGradient id="portalCore" x1="0" y1="0" x2="1" y2="1">
              <stop offset="0%" stop-color="#ddd6fe"/>
              <stop offset="45%" stop-color="#8b5cf6"/>
              <stop offset="100%" stop-color="#4c1d95"/>
            </linearGradient>
            <linearGradient id="portalCoreOcean" x1="0" y1="0" x2="1" y2="1">
              <stop offset="0%" stop-color="#e0f2fe"/>
              <stop offset="45%" stop-color="#38bdf8"/>
              <stop offset="100%" stop-color="#0369a1"/>
            </linearGradient>
            <linearGradient id="stoneShade" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stop-color="#473c66"/>
              <stop offset="100%" stop-color="#1e1733"/>
            </linearGradient>
          </defs>

          <!-- Distant floating voxel shards -->
          <g opacity="0.55">
            <rect x="86" y="54" width="18" height="18" rx="3" fill="#4c1d95"/>
            <rect x="86" y="54" width="18" height="6" rx="2" fill="#8b5cf6"/>
            <rect x="536" y="64" width="22" height="22" rx="3" fill="#3b1d6a"/>
            <rect x="536" y="64" width="22" height="7" rx="2" fill="#a78bfa"/>
            <rect x="498" y="138" width="14" height="14" rx="2" fill="#433878"/>
            <rect x="130" y="148" width="14" height="14" rx="2" fill="#3f3369"/>
          </g>

          <!-- Ambient portal aura -->
          <circle class="portal-aura-glow" cx="320" cy="104" r="96" fill="url(#portalGlow)"/>

          <!-- Main Floating Minecraft Island & Ancient Portal -->
          <g class="island-float-group">
            <!-- Island underside voxel spire -->
            <polygon points="184,152 456,152 418,186 358,214 320,224 276,210 218,184" fill="url(#stoneShade)"/>
            <rect x="220" y="152" width="44" height="28" fill="#332852"/>
            <rect x="378" y="152" width="40" height="24" fill="#2c2247"/>
            <rect x="288" y="162" width="64" height="40" fill="#271e40"/>
            <!-- Grass / Moss voxel surface -->
            <rect x="172" y="138" width="296" height="16" rx="3" fill="#2b2149"/>
            <rect x="172" y="132" width="296" height="9" rx="2" fill="#5b4694"/>
            <rect x="190" y="132" width="48" height="9" fill="#7c3aed" opacity="0.55"/>
            <rect x="392" y="132" width="54" height="9" fill="#6d28d9" opacity="0.6"/>

            <!-- Left Voxel Tree -->
            <rect x="210" y="102" width="10" height="30" fill="#4b352a"/>
            <rect x="195" y="80" width="40" height="24" rx="2" fill="#312357"/>
            <rect x="203" y="68" width="24" height="16" rx="2" fill="#4c3582"/>

            <!-- Right Voxel Crystals -->
            <polygon points="418,132 428,104 438,132" fill="#8b5cf6"/>
            <polygon points="434,132 442,114 450,132" fill="#a78bfa"/>

            <!-- Ancient Obsidian Portal Frame -->
            <rect x="278" y="54" width="84" height="78" rx="4" fill="#120b24" stroke="#3b2667" stroke-width="2"/>
            <!-- Portal Vortex -->
            <rect class="portal-core-pulse" x="292" y="68" width="56" height="64" rx="2" fill="url(#portalCore)"/>
            <!-- Portal Voxel Steps -->
            <rect x="268" y="128" width="104" height="8" rx="2" fill="#241744"/>
            <rect x="278" y="122" width="84" height="6" rx="1" fill="#312059"/>
          </g>
        </svg>

        <div class="diorama-caption">
          <span class="diorama-badge">Cổng Điều Phối Remote GUI</span>
          <span class="diorama-badge">Tự Động Khôi Phục Kết Nối</span>
        </div>
      </div>

      <div class="feature-grid">
        <article class="feature-card">
          <div class="feature-icon" aria-hidden="true">
            <svg class="ui-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <rect x="3" y="4" width="18" height="14" rx="2"/>
              <path d="M8 20h8M12 18v2"/>
            </svg>
          </div>
          <div>
            <h2 class="feature-title">Remote GUI &amp; Hòm Đồ</h2>
            <p class="feature-desc">Click trực tiếp slot rương /menu ingame, kéo thả 36 ô đồ và lắp Totem tay phụ tức thì.</p>
          </div>
        </article>

        <article class="feature-card">
          <div class="feature-icon" aria-hidden="true">
            <svg class="ui-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <circle cx="12" cy="12" r="9"/>
              <path d="M12 7v5l3 2"/>
            </svg>
          </div>
          <div>
            <h2 class="feature-title">Hẹn Giờ &amp; Auto Chat</h2>
            <p class="feature-desc">Thiết lập lịch bật/tắt theo khung giờ hoặc chu kỳ lặp cùng chuỗi Spawn Commands.</p>
          </div>
        </article>

        <article class="feature-card">
          <div class="feature-icon" aria-hidden="true">
            <svg class="ui-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M12 2l7 4v6c0 5-3.5 8.5-7 10-3.5-1.5-7-5-7-10V6l7-4z"/>
            </svg>
          </div>
          <div>
            <h2 class="feature-title">Phân Quyền &amp; Phiên An Toàn</h2>
            <p class="feature-desc">Cô lập chặt chẽ dữ liệu theo tài khoản thuê, hỗ trợ Proxy riêng SOCKS5/HTTP và Audit Log.</p>
          </div>
        </article>

        <article class="feature-card">
          <div class="feature-icon" aria-hidden="true">
            <svg class="ui-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M4 17l6-6 4 4 6-6"/>
              <path d="M16 9h4v4"/>
            </svg>
          </div>
          <div>
            <h2 class="feature-title">Giám Sát &amp; Đồng Bộ Cloud</h2>
            <p class="feature-desc">Theo dõi Ping, RAM, Chat/Event Log thời gian thực và sao lưu cấu hình lên Supabase.</p>
          </div>
        </article>
      </div>

      <div class="hero-footer-links">
        <a href="https://discord.gg/mJWX5Xp3z" target="_blank" rel="noopener noreferrer" class="discord-support-link">
          <svg class="ui-icon" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
            <path d="M20.317 4.37a19.791 19.791 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.25.077.077 0 0 0-.079-.037A19.736 19.736 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 0 0 .031.057 19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028c.462-.63.874-1.295 1.226-1.994.021-.041.001-.09-.041-.106a13.107 13.107 0 0 1-1.872-.892.077.077 0 0 1-.008-.128 10.2 10.2 0 0 0 .372-.292.074.074 0 0 1 .077-.01c3.929 1.793 8.18 1.793 12.061 0a.074.074 0 0 1 .078.01c.12.098.246.198.373.292a.077.077 0 0 1-.006.127 12.299 12.299 0 0 1-1.873.894.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028 19.839 19.839 0 0 0 6.002-3.03.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.028z"/>
          </svg>
          <span>Hỗ Trợ Discord KingMC</span>
        </a>
        <span class="hero-footnote">Đã hỗ trợ liên kết tài khoản Discord qua lệnh /login</span>
      </div>
    </div>

    <div class="auth-column">
      <div class="auth-card">
        <div class="auth-card-header">
          <h2 class="auth-card-title">Truy Cập Bảng Điều Khiển</h2>
          <p class="auth-card-subtitle">Đăng nhập tài khoản vận hành hoặc tạo tài khoản mới bằng mã Key</p>
        </div>

        <div class="auth-tabs" role="tablist" aria-label="Chế độ xác thực">
          <button
            id="tabPublicLoginBtn"
            type="button"
            class="auth-tab-btn active"
            role="tab"
            aria-selected="true"
            aria-controls="publicLoginForm"
            tabindex="0"
            data-auth-tab="login">Đăng Nhập</button>
          <button
            id="tabPublicRegisterBtn"
            type="button"
            class="auth-tab-btn"
            role="tab"
            aria-selected="false"
            aria-controls="publicRegisterForm"
            tabindex="-1"
            data-auth-tab="register">Đăng Ký</button>
        </div>

        <div id="publicFieldAnnouncer" class="sr-only" aria-live="polite" aria-atomic="true"></div>
        <div id="publicLoginAlert" class="login-alert hidden" role="alert" aria-live="assertive" hidden></div>

        <form id="publicLoginForm" role="tabpanel" aria-labelledby="tabPublicLoginBtn" class="auth-form" novalidate>
          <div class="field-group">
            <label class="field-label" for="publicUsername">
              <span>Tên đăng nhập</span>
              <span class="field-hint-inline">Tài khoản User hoặc Admin</span>
            </label>
            <div class="input-wrap">
              <input id="publicUsername" class="field-input" type="text" autocomplete="username" placeholder="Nhập tên đăng nhập..." aria-describedby="publicUsernameErr">
            </div>
            <p id="publicUsernameErr" class="field-error" hidden></p>
          </div>

          <div class="field-group">
            <label class="field-label" for="publicPassword">
              <span>Mật khẩu</span>
            </label>
            <div class="input-wrap">
              <input id="publicPassword" class="field-input has-toggle" type="password" autocomplete="current-password" placeholder="Nhập mật khẩu..." aria-describedby="publicPasswordErr">
              <button type="button" class="password-toggle-btn" data-toggle-target="publicPassword" aria-label="Hiện mật khẩu" aria-pressed="false">
                <svg class="ui-icon icon-eye" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
                  <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/>
                  <circle cx="12" cy="12" r="3"/>
                </svg>
                <svg class="ui-icon icon-eye-off hidden" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
                  <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94"/>
                  <path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19"/>
                  <line x1="1" y1="1" x2="23" y2="23"/>
                </svg>
              </button>
            </div>
            <p id="publicPasswordErr" class="field-error" hidden></p>
          </div>

          <div class="field-group">
            <label class="field-label" for="publicLicenseKey">
              <span>Mã Key kích hoạt / Gia hạn</span>
              <span class="field-hint-inline">Tùy chọn</span>
            </label>
            <div class="input-wrap">
              <input id="publicLicenseKey" class="field-input key-input" type="text" autocomplete="off" placeholder="Nhập License Key nếu cần nạp thêm gói...">
            </div>
          </div>

          <div class="remember-row">
            <label class="checkbox-label" for="publicRememberMe">
              <input id="publicRememberMe" type="checkbox" checked>
              <span>Ghi nhớ phiên đăng nhập trên trình duyệt này</span>
            </label>
          </div>

          <button id="publicSubmitBtn" type="submit" class="primary-cta">
            <span class="btn-icon" aria-hidden="true">
              <svg class="ui-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2">
                <path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4"/>
                <polyline points="10 17 15 12 10 7"/>
                <line x1="15" y1="12" x2="3" y2="12"/>
              </svg>
            </span>
            <span class="btn-label">ĐĂNG NHẬP VÀO HỆ THỐNG</span>
          </button>
        </form>

        <form id="publicRegisterForm" class="hidden" role="tabpanel" aria-labelledby="tabPublicRegisterBtn" hidden novalidate>
          <div class="auth-form">
            <div id="publicTrialCalloutBadge" class="trial-callout">
              <span class="trial-callout-icon" aria-hidden="true">
                <svg class="ui-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <polyline points="20 12 20 22 4 22 4 12"/>
                  <rect x="2" y="7" width="20" height="5"/>
                  <line x1="12" y1="22" x2="12" y2="7"/>
                </svg>
              </span>
              <div id="publicTrialCalloutText">
                <strong>ĐẶC QUYỀN MỚI:</strong> Nhận ngay <strong>1 NGÀY DÙNG THỬ MIỄN PHÍ</strong> sau khi tạo tài khoản thành công!
              </div>
            </div>

            <div class="field-group">
              <label class="field-label" for="regUsername">
                <span>Tên tài khoản mới</span>
                <span class="field-hint-inline">3–32 ký tự a-z, 0-9, _</span>
              </label>
              <div class="input-wrap">
                <input id="regUsername" class="field-input" type="text" autocomplete="username" placeholder="Ví dụ: player_vip01" aria-describedby="regUsernameErr">
              </div>
              <p id="regUsernameErr" class="field-error" hidden></p>
            </div>

            <div class="field-group">
              <label class="field-label" for="regPassword">
                <span>Mật khẩu</span>
                <span class="field-hint-inline">Tối thiểu 6 ký tự</span>
              </label>
              <div class="input-wrap">
                <input id="regPassword" class="field-input has-toggle" type="password" autocomplete="new-password" placeholder="Tạo mật khẩu an toàn..." aria-describedby="regPasswordErr">
                <button type="button" class="password-toggle-btn" data-toggle-target="regPassword" aria-label="Hiện mật khẩu" aria-pressed="false">
                  <svg class="ui-icon icon-eye" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
                    <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/>
                    <circle cx="12" cy="12" r="3"/>
                  </svg>
                  <svg class="ui-icon icon-eye-off hidden" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
                    <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94"/>
                    <path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19"/>
                    <line x1="1" y1="1" x2="23" y2="23"/>
                  </svg>
                </button>
              </div>
              <p id="regPasswordErr" class="field-error" hidden></p>
            </div>

            <div class="field-group">
              <label class="field-label" for="regPasswordConfirm">
                <span>Xác nhận mật khẩu</span>
              </label>
              <div class="input-wrap">
                <input id="regPasswordConfirm" class="field-input has-toggle" type="password" autocomplete="new-password" placeholder="Nhập lại mật khẩu vừa tạo..." aria-describedby="regPasswordConfirmErr">
                <button type="button" class="password-toggle-btn" data-toggle-target="regPasswordConfirm" aria-label="Hiện mật khẩu" aria-pressed="false">
                  <svg class="ui-icon icon-eye" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
                    <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/>
                    <circle cx="12" cy="12" r="3"/>
                  </svg>
                  <svg class="ui-icon icon-eye-off hidden" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
                    <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94"/>
                    <path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19"/>
                    <line x1="1" y1="1" x2="23" y2="23"/>
                  </svg>
                </button>
              </div>
              <p id="regPasswordConfirmErr" class="field-error" hidden></p>
            </div>

            <div class="field-group">
              <label class="field-label" for="regLicenseKey">
                <span>Mã License Key</span>
                <span id="regLicenseKeyHint" class="field-hint-inline">(Để trống nếu dùng thử)</span>
              </label>
              <div class="input-wrap">
                <input id="regLicenseKey" class="field-input key-input" type="text" autocomplete="off" placeholder="Để trống để nhận 1 ngày dùng thử miễn phí...">
              </div>
            </div>

            <button id="publicRegSubmitBtn" type="submit" class="primary-cta">
              <span class="btn-icon" aria-hidden="true">
                <svg class="ui-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2">
                  <path d="M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/>
                  <circle cx="8.5" cy="7" r="4"/>
                  <line x1="20" y1="8" x2="20" y2="14"/>
                  <line x1="23" y1="11" x2="17" y2="11"/>
                </svg>
              </span>
              <span class="btn-label">HOÀN TẤT ĐĂNG KÝ VÀ BẮT ĐẦU</span>
            </button>
          </div>
        </form>

        <div class="auth-footer-note">
          <svg class="ui-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
            <rect x="3" y="11" width="18" height="11" rx="2"/>
            <path d="M7 11V7a5 5 0 0 1 10 0v4"/>
          </svg>
          <span>Kết nối được bảo vệ bằng cookie phiên bảo mật và kiểm tra nguồn gốc CSRF. Cần hỗ trợ cấp lại mật khẩu hãy liên hệ Admin qua Discord.</span>
        </div>
      </div>
    </div>
  </section>
</main>

<template id="tplIconLogin">
  <svg class="ui-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" aria-hidden="true">
    <path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4"/>
    <polyline points="10 17 15 12 10 7"/>
    <line x1="15" y1="12" x2="3" y2="12"/>
  </svg>
</template>
<template id="tplIconRegister">
  <svg class="ui-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" aria-hidden="true">
    <path d="M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/>
    <circle cx="8.5" cy="7" r="4"/>
    <line x1="20" y1="8" x2="20" y2="14"/>
    <line x1="23" y1="11" x2="17" y2="11"/>
  </svg>
</template>
<template id="tplIconSpinner">
  <svg class="ui-icon icon-spin" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" aria-hidden="true">
    <circle cx="12" cy="12" r="9" opacity="0.25"/>
    <path d="M21 12a9 9 0 0 0-9-9"/>
  </svg>
</template>
<template id="tplIconWarn">
  <svg class="ui-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" aria-hidden="true">
    <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/>
    <line x1="12" y1="9" x2="12" y2="13"/>
    <line x1="12" y1="17" x2="12.01" y2="17"/>
  </svg>
</template>
<template id="tplIconLock">
  <svg class="ui-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" aria-hidden="true">
    <rect x="3" y="11" width="18" height="11" rx="2"/>
    <path d="M7 11V7a5 5 0 0 1 10 0v4"/>
  </svg>
</template>
<template id="tplIconSuccess">
  <svg class="ui-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.3" aria-hidden="true">
    <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/>
    <polyline points="22 4 12 14.01 9 11.01"/>
  </svg>
</template>

<script>
const THEME_MAP = {
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

function normalizePublicTheme(raw) {
  return THEME_MAP[String(raw || '').trim()] || 'deep-galaxy';
}

function getActivePublicTheme() {
  try {
    return normalizePublicTheme(
      localStorage.getItem('kbot_theme') ||
      localStorage.getItem('kbot_dashboard_theme') ||
      localStorage.getItem('kbot_cosmic_mode') ||
      'deep-galaxy'
    );
  } catch (_) {
    return 'deep-galaxy';
  }
}

function applyPublicTheme(themeName) {
  const theme = normalizePublicTheme(themeName);
  try {
    localStorage.setItem('kbot_theme', theme);
    localStorage.setItem('kbot_dashboard_theme', theme);
    localStorage.setItem('kbot_cosmic_mode', theme);
  } catch (_) {}
  if (document.documentElement && typeof document.documentElement.setAttribute === 'function') {
    document.documentElement.setAttribute('data-theme', theme);
    if (document.documentElement.style) {
      document.documentElement.style.colorScheme = theme === 'moonlight' ? 'light' : 'dark';
    }
  }
  if (typeof document.querySelectorAll === 'function') {
    const btns = document.querySelectorAll('[data-theme-choice]');
    for (let i = 0; i < btns.length; i++) {
      const btn = btns[i];
      const match = btn.getAttribute('data-theme-choice') === theme;
      btn.classList.toggle('active', match);
      btn.setAttribute('aria-pressed', match ? 'true' : 'false');
    }
  }
  return theme;
}

function cloneTemplateIcon(templateId) {
  const tpl = document.getElementById(templateId);
  if (tpl && tpl.content && tpl.content.firstElementChild) {
    return tpl.content.firstElementChild.cloneNode(true);
  }
  return null;
}

function setSubmitButtonState(btn, mode, labelText, iconTemplateId) {
  if (!btn) return;
  const iconWrap = btn.querySelector('.btn-icon');
  const labelEl = btn.querySelector('.btn-label');
  if (labelEl) labelEl.textContent = labelText;
  btn.classList.toggle('is-success', mode === 'success');
  if (iconWrap) {
    const nextSvg = mode === 'loading'
      ? cloneTemplateIcon('tplIconSpinner')
      : cloneTemplateIcon(iconTemplateId);
    if (nextSvg) iconWrap.replaceChildren(nextSvg);
    else iconWrap.replaceChildren();
  }
}

function setLoginAlert(type, msg, iconTemplateId) {
  const el = document.getElementById('publicLoginAlert');
  if (!el) return;
  if (!msg) {
    el.hidden = true;
    el.className = 'login-alert hidden';
    el.replaceChildren();
    return;
  }
  el.hidden = false;
  el.className = 'login-alert ' + (type || 'info');

  const iconSpan = document.createElement('span');
  iconSpan.className = 'alert-icon-wrap';
  const iconSvg = cloneTemplateIcon(iconTemplateId || (type === 'success' ? 'tplIconSuccess' : 'tplIconWarn'));
  if (iconSvg) iconSpan.appendChild(iconSvg);

  const textSpan = document.createElement('span');
  textSpan.textContent = String(msg);

  el.replaceChildren(iconSpan, textSpan);
}

function setFieldError(inputId, errId, message) {
  const input = document.getElementById(inputId);
  const errEl = document.getElementById(errId);
  if (input) {
    input.classList.toggle('is-invalid', Boolean(message));
    if (message) input.setAttribute('aria-invalid', 'true');
    else input.removeAttribute('aria-invalid');
  }
  if (errEl) {
    errEl.textContent = message || '';
    errEl.hidden = !message;
  }
}

function switchPublicAuthTab(tab) {
  const isLogin = tab !== 'register';
  const loginBtn = document.getElementById('tabPublicLoginBtn');
  const regBtn = document.getElementById('tabPublicRegisterBtn');
  const loginForm = document.getElementById('publicLoginForm');
  const regForm = document.getElementById('publicRegisterForm');

  if (loginBtn) {
    loginBtn.classList.toggle('active', isLogin);
    loginBtn.setAttribute('aria-selected', isLogin ? 'true' : 'false');
    loginBtn.setAttribute('tabindex', isLogin ? '0' : '-1');
  }
  if (regBtn) {
    regBtn.classList.toggle('active', !isLogin);
    regBtn.setAttribute('aria-selected', isLogin ? 'false' : 'true');
    regBtn.setAttribute('tabindex', isLogin ? '-1' : '0');
  }
  if (loginForm) {
    loginForm.classList.toggle('hidden', !isLogin);
    loginForm.hidden = !isLogin;
  }
  if (regForm) {
    regForm.classList.toggle('hidden', isLogin);
    regForm.hidden = isLogin;
  }
  setLoginAlert('', '');
  const announcer = document.getElementById('publicFieldAnnouncer');
  if (announcer) {
    announcer.textContent = isLogin ? 'Đang ở biểu mẫu đăng nhập.' : 'Đang ở biểu mẫu đăng ký tài khoản.';
  }
}

function togglePublicPass(inputId, btn) {
  const input = document.getElementById(inputId);
  if (!input) return;
  const isShowing = input.type === 'password';
  input.type = isShowing ? 'text' : 'password';
  if (btn) {
    btn.setAttribute('aria-pressed', isShowing ? 'true' : 'false');
    btn.setAttribute('aria-label', isShowing ? 'Ẩn mật khẩu' : 'Hiện mật khẩu');
    const eye = btn.querySelector('.icon-eye');
    const eyeOff = btn.querySelector('.icon-eye-off');
    if (eye) eye.classList.toggle('hidden', isShowing);
    if (eyeOff) eyeOff.classList.toggle('hidden', !isShowing);
  }
}

function validateLoginFields() {
  const uEl = document.getElementById('publicUsername');
  const pEl = document.getElementById('publicPassword');
  const u = uEl ? uEl.value.trim() : '';
  const p = pEl ? pEl.value : '';

  let firstInvalid = null;
  if (!u) {
    setFieldError('publicUsername', 'publicUsernameErr', 'Vui lòng nhập tên đăng nhập.');
    firstInvalid = firstInvalid || uEl;
  } else {
    setFieldError('publicUsername', 'publicUsernameErr', '');
  }

  if (!p) {
    setFieldError('publicPassword', 'publicPasswordErr', 'Vui lòng nhập mật khẩu.');
    firstInvalid = firstInvalid || pEl;
  } else {
    setFieldError('publicPassword', 'publicPasswordErr', '');
  }

  return { ok: !firstInvalid, firstInvalid };
}

function validateRegisterFields() {
  const uEl = document.getElementById('regUsername');
  const pEl = document.getElementById('regPassword');
  const p2El = document.getElementById('regPasswordConfirm');
  const u = uEl ? uEl.value.trim() : '';
  const p = pEl ? pEl.value : '';
  const p2 = p2El ? p2El.value : '';

  let firstInvalid = null;
  if (!/^[a-zA-Z0-9_]{3,32}$/.test(u)) {
    setFieldError('regUsername', 'regUsernameErr', 'Tên đăng nhập phải từ 3–32 ký tự gồm chữ, số hoặc dấu gạch dưới (_).');
    firstInvalid = firstInvalid || uEl;
  } else {
    setFieldError('regUsername', 'regUsernameErr', '');
  }

  if (p.length < 6) {
    setFieldError('regPassword', 'regPasswordErr', 'Mật khẩu phải có ít nhất 6 ký tự.');
    firstInvalid = firstInvalid || pEl;
  } else {
    setFieldError('regPassword', 'regPasswordErr', '');
  }

  if (!p2 || p !== p2) {
    setFieldError('regPasswordConfirm', 'regPasswordConfirmErr', 'Mật khẩu xác nhận không khớp.');
    firstInvalid = firstInvalid || p2El;
  } else {
    setFieldError('regPasswordConfirm', 'regPasswordConfirmErr', '');
  }

  return { ok: !firstInvalid, firstInvalid };
}

async function handlePublicLoginSubmit(e) {
  if (e) e.preventDefault();
  const check = validateLoginFields();
  if (!check.ok) {
    const uErr = document.getElementById('publicUsernameErr');
    const pErr = document.getElementById('publicPasswordErr');
    const summaryMsg = (uErr && uErr.textContent) || (pErr && pErr.textContent) || 'Vui lòng nhập đầy đủ thông tin.';
    setLoginAlert('error', summaryMsg, 'tplIconWarn');
    if (check.firstInvalid) check.firstInvalid.focus();
    return;
  }

  const u = document.getElementById('publicUsername').value.trim();
  const p = document.getElementById('publicPassword').value;
  const k = document.getElementById('publicLicenseKey').value.trim();
  const rememberEl = document.getElementById('publicRememberMe');
  const remember = rememberEl ? rememberEl.checked : true;
  const btn = document.getElementById('publicSubmitBtn');

  setLoginAlert('', '');
  btn.disabled = true;
  setSubmitButtonState(btn, 'loading', 'Đang xác thực...', 'tplIconLogin');

  try {
    const res = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify({ username: u, password: p, key: k, licenseKey: k, rememberMe: remember })
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.ok) {
      throw new Error(data.error || 'Tên đăng nhập hoặc mật khẩu không đúng.');
    }
    if (data.token) {
      try { localStorage.setItem('kingmc_session', data.token); } catch (_) {}
    }
    setLoginAlert('success', 'Đăng nhập thành công! Đang chuyển hướng...', 'tplIconSuccess');
    setSubmitButtonState(btn, 'success', 'ĐĂNG NHẬP THÀNH CÔNG!', 'tplIconLogin');
    setTimeout(() => { window.location.replace('/'); }, 300);
  } catch (err) {
    setLoginAlert('error', err && err.message ? err.message : 'Đăng nhập thất bại.', 'tplIconWarn');
    btn.disabled = false;
    setSubmitButtonState(btn, 'idle', 'ĐĂNG NHẬP VÀO HỆ THỐNG', 'tplIconLogin');
  }
}

async function handlePublicRegisterSubmit(e) {
  if (e) e.preventDefault();
  const check = validateRegisterFields();
  if (!check.ok) {
    const uErr = document.getElementById('regUsernameErr');
    const pErr = document.getElementById('regPasswordErr');
    const p2Err = document.getElementById('regPasswordConfirmErr');
    const summaryMsg = (uErr && uErr.textContent) || (pErr && pErr.textContent) || (p2Err && p2Err.textContent) || 'Vui lòng kiểm tra lại thông tin đăng ký.';
    setLoginAlert('error', summaryMsg, 'tplIconWarn');
    if (check.firstInvalid) check.firstInvalid.focus();
    return;
  }

  const u = document.getElementById('regUsername').value.trim();
  const p = document.getElementById('regPassword').value;
  const p2 = document.getElementById('regPasswordConfirm').value;
  const k = document.getElementById('regLicenseKey').value.trim();
  const btn = document.getElementById('publicRegSubmitBtn');

  setLoginAlert('', '');
  btn.disabled = true;
  setSubmitButtonState(btn, 'loading', 'Đang đăng ký...', 'tplIconRegister');

  try {
    const res = await fetch('/api/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify({ username: u, password: p, confirmPassword: p2, key: k, licenseKey: k })
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.ok) {
      throw new Error(data.error || 'Không thể đăng ký tài khoản.');
    }
    if (data.token) {
      try { localStorage.setItem('kingmc_session', data.token); } catch (_) {}
    }
    setLoginAlert('success', data.message || 'Đăng ký thành công! Đang chuyển hướng...', 'tplIconSuccess');
    setSubmitButtonState(btn, 'success', 'ĐĂNG KÝ THÀNH CÔNG!', 'tplIconRegister');
    setTimeout(() => { window.location.replace('/'); }, 350);
  } catch (err) {
    setLoginAlert('error', err && err.message ? err.message : 'Không thể đăng ký tài khoản.', 'tplIconWarn');
    btn.disabled = false;
    setSubmitButtonState(btn, 'idle', 'HOÀN TẤT ĐĂNG KÝ VÀ BẮT ĐẦU', 'tplIconRegister');
  }
}

function updateServerStatusPill(state, text) {
  const pill = document.getElementById('serverStatusPill');
  const label = document.getElementById('serverStatusText');
  if (!pill || !label) return;
  pill.classList.remove('is-checking', 'is-online', 'is-degraded', 'is-offline');
  pill.classList.add(state);
  label.textContent = text;
}

function renderTrialCallout(trialGiftEnabled, rawTrialDays) {
  const badge = document.getElementById('publicTrialCalloutBadge');
  const text = document.getElementById('publicTrialCalloutText');
  const keyHint = document.getElementById('regLicenseKeyHint');
  const keyInput = document.getElementById('regLicenseKey');
  if (!badge) return;

  if (trialGiftEnabled === false) {
    badge.hidden = true;
    if (keyHint) keyHint.textContent = '(Tùy chọn - Nhập nếu có mã Key)';
    if (keyInput) keyInput.placeholder = 'Nhập mã Key (Tùy chọn, để trống nếu chưa có)...';
    return;
  }

  const parsedDays = Number.parseInt(rawTrialDays, 10);
  const days = Number.isFinite(parsedDays) && parsedDays > 0 && parsedDays <= 365 ? parsedDays : 1;

  badge.hidden = false;
  if (text) {
    const strongTitle = document.createElement('strong');
    strongTitle.textContent = 'ĐẶC QUYỀN MỚI:';
    const strongDays = document.createElement('strong');
    strongDays.textContent = days + ' NGÀY DÙNG THỬ MIỄN PHÍ';

    text.replaceChildren(
      strongTitle,
      document.createTextNode(' Nhận ngay '),
      strongDays,
      document.createTextNode(' sau khi tạo tài khoản thành công!')
    );
  }
  if (keyHint) keyHint.textContent = '(Để trống nếu dùng thử)';
  if (keyInput) keyInput.placeholder = 'Để trống để nhận ' + days + ' ngày dùng thử miễn phí...';
}

function parseBoundedInt(value, maxVal) {
  const num = Number.parseInt(value, 10);
  if (!Number.isFinite(num) || num < 0) return 0;
  return num > maxVal ? maxVal : num;
}

async function pingServerHealth() {
  try {
    const hRes = await fetch('/health', { credentials: 'same-origin' });
    const hData = await hRes.json().catch(() => ({}));
    if (hRes.ok && hData && hData.ok) {
      if (hData.degraded) {
        updateServerStatusPill('is-degraded', 'Hoạt động giới hạn');
      } else {
        updateServerStatusPill('is-online', 'Hệ thống trực tuyến');
      }
      return;
    }
  } catch (_) {}
  updateServerStatusPill('is-offline', 'Không thể kết nối máy chủ');
}

async function loadPublicSystemInfo() {
  try {
    const [sysRes, healthRes] = await Promise.all([
      fetch('/api/public/system-info', { credentials: 'same-origin' }),
      fetch('/health', { credentials: 'same-origin' }).catch(() => null)
    ]);
    const sysData = await sysRes.json().catch(() => ({}));
    const healthData = healthRes ? await healthRes.json().catch(() => ({})) : null;

    if (sysRes.ok && sysData && sysData.ok) {
      renderTrialCallout(sysData.trialGiftEnabled, sysData.trialDays);

      const totalBots = parseBoundedInt(sysData.totalBots, 99999);
      const onlineBots = parseBoundedInt(sysData.onlineBots, totalBots || 99999);

      if (healthData && healthData.degraded) {
        updateServerStatusPill('is-degraded', 'Hoạt động giới hạn • ' + onlineBots + '/' + totalBots + ' Bot');
      } else if (totalBots > 0) {
        updateServerStatusPill('is-online', 'Trực tuyến • ' + onlineBots + '/' + totalBots + ' Bot');
      } else {
        updateServerStatusPill('is-online', 'Hệ thống trực tuyến');
      }
      return;
    }
  } catch (_) {}

  await pingServerHealth();
}

(function bindPublicAuthEvents() {
  applyPublicTheme(getActivePublicTheme());

  if (typeof document.querySelectorAll === 'function') {
    const themeBtns = document.querySelectorAll('[data-theme-choice]');
    for (let i = 0; i < themeBtns.length; i++) {
      themeBtns[i].addEventListener('click', function() {
        applyPublicTheme(this.getAttribute('data-theme-choice'));
      });
    }
  }

  const tabList = document.querySelector('.auth-tabs[role="tablist"]');
  if (tabList) {
    const tabs = tabList.querySelectorAll('[role="tab"]');
    tabs.forEach((tabBtn) => {
      tabBtn.addEventListener('click', () => {
        switchPublicAuthTab(tabBtn.getAttribute('data-auth-tab'));
      });
    });

    tabList.addEventListener('keydown', (e) => {
      if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight' && e.key !== 'Home' && e.key !== 'End') return;
      const tabArr = Array.from(tabs);
      if (tabArr.length < 2) return;
      const idx = tabArr.indexOf(document.activeElement);
      let nextIdx = idx < 0 ? 0 : idx;
      if (e.key === 'ArrowRight') nextIdx = (idx + 1) % tabArr.length;
      else if (e.key === 'ArrowLeft') nextIdx = (idx - 1 + tabArr.length) % tabArr.length;
      else if (e.key === 'Home') nextIdx = 0;
      else if (e.key === 'End') nextIdx = tabArr.length - 1;
      e.preventDefault();
      const targetTab = tabArr[nextIdx];
      switchPublicAuthTab(targetTab.getAttribute('data-auth-tab'));
      targetTab.focus();
    });
  }

  document.querySelectorAll('.password-toggle-btn[data-toggle-target]').forEach((btn) => {
    btn.addEventListener('click', () => {
      togglePublicPass(btn.getAttribute('data-toggle-target'), btn);
    });
  });

  const loginForm = document.getElementById('publicLoginForm');
  if (loginForm) loginForm.addEventListener('submit', handlePublicLoginSubmit);

  const regForm = document.getElementById('publicRegisterForm');
  if (regForm) regForm.addEventListener('submit', handlePublicRegisterSubmit);
})();

(function checkUrlParams() {
  try {
    const params = new URLSearchParams(window.location.search);
    const err = params.get('error');
    const reason = params.get('reason');
    if (err === 'locked' || reason === 'locked') {
      setLoginAlert('error', 'Tài khoản của bạn hiện đang bị tạm khóa. Vui lòng liên hệ Quản trị viên.', 'tplIconLock');
    } else if (err === 'expired' || reason === 'expired') {
      setLoginAlert('error', 'Gói thuê của bạn đã hết hạn. Vui lòng nhập License Key mới ở ô bên dưới để kích hoạt.', 'tplIconWarn');
    } else if (params.has('logged_out')) {
      setLoginAlert('success', 'Đã đăng xuất khỏi hệ thống an toàn.', 'tplIconSuccess');
    }
  } catch (_) {}
  loadPublicSystemInfo();
})();

(function initPublicGalaxy() {
  const reducedMotionQuery = typeof window.matchMedia === 'function'
    ? window.matchMedia('(prefers-reduced-motion: reduce)')
    : { matches: false };

  const video = document.getElementById('publicGalaxyVideo');
  const canvas = document.getElementById('publicStarfieldCanvas');
  const ctx = canvas && typeof canvas.getContext === 'function' ? canvas.getContext('2d') : null;
  let w = 0;
  let h = 0;
  let rafId = null;

  function hideVideoFallback() {
    if (!video) return;
    if (typeof video.pause === 'function') video.pause();
    if (video.style) video.style.display = 'none';
  }

  if (video && typeof video.addEventListener === 'function') {
    video.addEventListener('error', hideVideoFallback);
  }

  function resize() {
    if (!canvas) return;
    w = canvas.width = window.innerWidth;
    h = canvas.height = window.innerHeight;
  }
  window.addEventListener('resize', resize, { passive: true });
  resize();

  const isMobile = /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent || '') || (window.innerWidth <= 768);
  const starCount = isMobile ? 18 : 34;
  const stars = [];
  for (let i = 0; i < starCount; i++) {
    stars.push({
      x: Math.random() * w,
      y: Math.random() * h,
      z: Math.random() * 1.6 + 0.4,
      r: Math.random() * 1.4 + 0.5,
      a: Math.random() * 0.5 + 0.25,
      da: (Math.random() * 0.009 + 0.003) * (Math.random() < 0.5 ? 1 : -1),
      rgb: Math.random() < 0.55 ? '237,233,254' : '196,181,253'
    });
  }
  const shootingStars = [];

  function stopMotion() {
    if (rafId !== null) {
      cancelAnimationFrame(rafId);
      rafId = null;
    }
    if (ctx) ctx.clearRect(0, 0, w, h);
    if (video && typeof video.pause === 'function') {
      video.pause();
    }
  }

  let lastTime = 0;
  const frameInterval = 1000 / 45;

  function frame(timestamp) {
    rafId = null;
    if (document.hidden || reducedMotionQuery.matches || !ctx) {
      stopMotion();
      return;
    }

    if (timestamp && (timestamp - lastTime < frameInterval)) {
      rafId = requestAnimationFrame(frame);
      return;
    }
    lastTime = timestamp || (typeof performance !== 'undefined' ? performance.now() : Date.now());

    const theme = getActivePublicTheme();
    const isLight = theme === 'moonlight';
    const speedScale = theme === 'violet-dusk' ? 0.55 : 1.0;

    ctx.clearRect(0, 0, w, h);
    for (let i = 0; i < stars.length; i++) {
      const s = stars[i];
      s.y -= 0.08 * s.z * speedScale;
      s.a += s.da * speedScale;
      if (s.a > 0.9 || s.a < 0.16) s.da = -s.da;
      if (s.y < -10) {
        s.y = h + 10;
        s.x = Math.random() * w;
      }
      var starRgb = theme === 'ocean-abyss'
        ? (i % 2 === 0 ? '56,189,248' : '186,230,253')
        : s.rgb;
      ctx.beginPath();
      ctx.arc(s.x | 0, s.y | 0, (s.r * s.z * 0.8) | 0 || 1, 0, Math.PI * 2);
      ctx.fillStyle = isLight
        ? 'rgba(79,70,229,' + (s.a * 0.20).toFixed(2) + ')'
        : 'rgba(' + starRgb + ',' + (s.a * (theme === 'violet-dusk' ? 0.5 : 0.78)).toFixed(2) + ')';
      ctx.fill();
    }

    if (!isMobile && !isLight && (theme === 'deep-galaxy' || theme === 'ocean-abyss')) {
      if (shootingStars.length < 1 && Math.random() < 0.005) {
        shootingStars.push({
          x: Math.random() * w * 0.7 + w * 0.15,
          y: Math.random() * h * 0.35,
          len: Math.random() * 100 + 60,
          speed: Math.random() * 6 + 6,
          a: 0.85
        });
      }
      for (let j = shootingStars.length - 1; j >= 0; j--) {
        const st = shootingStars[j];
        st.x -= st.speed;
        st.y += st.speed * 0.52;
        st.a -= 0.022;
        if (st.a <= 0) {
          shootingStars.splice(j, 1);
          continue;
        }
        const tx = st.x + st.len;
        const ty = st.y - st.len * 0.52;
        const grad = ctx.createLinearGradient(st.x, st.y, tx, ty);
        grad.addColorStop(0, 'rgba(196,181,253,' + st.a.toFixed(2) + ')');
        grad.addColorStop(1, 'rgba(196,181,253,0)');
        ctx.strokeStyle = grad;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(st.x, st.y);
        ctx.lineTo(tx, ty);
        ctx.stroke();
      }
    }

    rafId = requestAnimationFrame(frame);
  }

  function startMotion() {
    if (document.hidden || reducedMotionQuery.matches) {
      stopMotion();
      return;
    }
    if (video && typeof video.play === 'function') {
      video.playbackRate = 0.85;
      const p = video.play();
      if (p && typeof p.catch === 'function') p.catch(() => {});
    }
    if (rafId === null && ctx) {
      rafId = requestAnimationFrame(frame);
    }
  }

  if (typeof reducedMotionQuery.addEventListener === 'function') {
    reducedMotionQuery.addEventListener('change', (ev) => {
      if (ev.matches) stopMotion();
      else startMotion();
    });
  }

  document.addEventListener('visibilitychange', () => {
    if (document.hidden) stopMotion();
    else startMotion();
  });

  startMotion();
})();

window.switchPublicAuthTab = switchPublicAuthTab;
window.togglePublicPass = togglePublicPass;
window.handlePublicLoginSubmit = handlePublicLoginSubmit;
window.handlePublicRegisterSubmit = handlePublicRegisterSubmit;
</script>
</body>
</html>`;

module.exports = { PUBLIC_LOGIN_HTML };
