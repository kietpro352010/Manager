'use strict';

const PUBLIC_LOGIN_HTML = String.raw`<!doctype html>
<html lang="vi">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>KBOT — Cổng Đăng Nhập Hệ Thống AFK KingMC</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;500;600;700&family=Plus+Jakarta+Sans:wght@400;500;600;700;800;900&display=swap" rel="stylesheet">
<style>
:root {
  color-scheme: dark;
  --bg: #040711;
  --bg-gradient:
    radial-gradient(ellipse at 8% 12%, rgba(14, 165, 233, 0.18) 0%, transparent 42%),
    radial-gradient(ellipse at 92% 88%, rgba(124, 58, 237, 0.16) 0%, transparent 48%),
    radial-gradient(ellipse at 55% 0%, rgba(16, 185, 129, 0.1) 0%, transparent 36%),
    radial-gradient(circle at 50% 50%, rgba(8, 14, 26, 0.98) 0%, #040711 100%);
  --card-bg: rgba(10, 18, 32, 0.92);
  --border: rgba(255, 255, 255, 0.08);
  --border-glow: rgba(56, 189, 248, 0.42);
  --text: #f8fafc;
  --muted: #94a3b8;
  --cyan: #38bdf8;
  --blue: #2563eb;
  --purple: #818cf8;
  --green: #34d399;
  --red: #f87171;
  --gold: #fbbf24;
}

@keyframes fadeUpIn {
  from { opacity: 0; transform: translateY(14px); }
  to { opacity: 1; transform: translateY(0); }
}
@keyframes auroraFloat {
  0%, 100% { transform: translate(0, 0) scale(1); }
  50% { transform: translate(28px, -18px) scale(1.08); }
}
@keyframes textShine {
  0% { background-position: 0% center; }
  100% { background-position: 250% center; }
}
@keyframes sonarPulse {
  0% { transform: scale(1); opacity: 0.85; }
  70% { transform: scale(2.4); opacity: 0; }
  100% { transform: scale(2.4); opacity: 0; }
}
@keyframes shimmerSlide {
  0% { transform: translateX(-140%); }
  100% { transform: translateX(280%); }
}

* { box-sizing: border-box; margin: 0; padding: 0; }
html, body {
  overflow-x: hidden;
  max-width: 100vw;
  width: 100%;
}
body {
  margin: 0; min-height: 100vh;
  background: var(--bg) var(--bg-gradient);
  background-attachment: fixed;
  background-image: var(--bg-gradient),
    linear-gradient(rgba(255,255,255,0.02) 1px, transparent 1px),
    linear-gradient(90deg, rgba(255,255,255,0.02) 1px, transparent 1px);
  background-size: auto, 32px 32px, 32px 32px;
  background-position: 0 0, -1px -1px, -1px -1px;
  color: var(--text);
  font-family: 'Plus Jakarta Sans', system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
  display: flex; align-items: center; justify-content: center; padding: 24px 16px;
  overflow-x: hidden;
}
.kbot-portal-container {
  position: relative;
  width: 100%; max-width: 1120px;
  display: grid; grid-template-columns: 1.15fr 0.95fr; gap: 36px;
  align-items: stretch; margin: auto;
}
.kbot-portal-container::before {
  content: '';
  position: absolute;
  top: -80px; left: -60px;
  width: min(380px, 80vw); height: min(380px, 80vw);
  border-radius: 50%;
  background: radial-gradient(circle, rgba(14, 165, 233, 0.22) 0%, transparent 70%);
  filter: blur(50px);
  pointer-events: none;
  animation: auroraFloat 14s ease-in-out infinite;
  z-index: 0;
}
.kbot-portal-container::after {
  content: '';
  position: absolute;
  bottom: -60px; right: -40px;
  width: min(400px, 80vw); height: min(400px, 80vw);
  border-radius: 50%;
  background: radial-gradient(circle, rgba(16, 185, 129, 0.16) 0%, transparent 70%);
  filter: blur(55px);
  pointer-events: none;
  animation: auroraFloat 16s ease-in-out infinite reverse;
  z-index: 0;
}
@media (max-width: 920px) {
  .kbot-portal-container { grid-template-columns: 1fr; gap: 24px; max-width: 500px; width: 100%; overflow: hidden; border-radius: 24px; }
  .kbot-showcase-col { display: none !important; }
}

/* SHOWCASE COLUMN (LEFT) */
.kbot-showcase-col {
  position: relative;
  z-index: 1;
  display: flex; flex-direction: column; justify-content: center;
  padding: 20px 10px;
}
.brand-pill-row {
  display: flex; align-items: center; gap: 10px; flex-wrap: wrap; margin-bottom: 16px;
}
.brand-tag {
  display: inline-flex; align-items: center; gap: 6px;
  font-size: 11px; font-weight: 800; padding: 5px 12px; border-radius: 999px;
  background: rgba(56, 189, 248, 0.15); color: var(--cyan);
  border: 1px solid rgba(56, 189, 248, 0.35); letter-spacing: 0.5px;
  box-shadow: 0 0 12px rgba(56, 189, 248, 0.15);
}
.server-pulse-tag {
  display: inline-flex; align-items: center; gap: 6px;
  font-size: 11px; font-weight: 700; padding: 5px 12px; border-radius: 999px;
  background: rgba(52, 211, 153, 0.12); color: var(--green);
  border: 1px solid rgba(52, 211, 153, 0.3);
}
.pulse-circle {
  width: 7px; height: 7px; border-radius: 50%; background: #10b981;
  box-shadow: 0 0 8px #10b981;
  position: relative;
  flex-shrink: 0;
}
.pulse-circle::after {
  content: '';
  position: absolute;
  inset: 0;
  border-radius: 50%;
  background: #10b981;
  animation: sonarPulse 2s ease-out infinite;
}
.showcase-headline {
  font-size: 34px; font-weight: 900; line-height: 1.25; margin-bottom: 14px;
  letter-spacing: -0.02em; color: #fff;
}
.gradient-headline {
  background: linear-gradient(135deg, #38bdf8 0%, #818cf8 35%, #34d399 70%, #38bdf8 100%);
  background-size: 250% auto;
  -webkit-background-clip: text; -webkit-text-fill-color: transparent;
  background-clip: text;
  animation: textShine 5s linear infinite;
}
.showcase-desc {
  font-size: 14px; color: var(--muted); line-height: 1.6; margin-bottom: 24px;
}

/* DISCORD BUTTON */
.discord-card-btn {
  display: flex; align-items: center; gap: 14px;
  padding: 14px 18px; border-radius: 14px;
  background: rgba(88, 101, 242, 0.18); border: 1px solid rgba(88, 101, 242, 0.45);
  color: #fff; text-decoration: none; margin-bottom: 24px;
  transition: all 0.25s cubic-bezier(0.16, 1, 0.3, 1);
  box-shadow: 0 6px 20px rgba(88, 101, 242, 0.2), inset 0 1px 0 rgba(255,255,255,0.08);
}
.discord-card-btn:hover {
  background: rgba(88, 101, 242, 0.28); border-color: rgba(88, 101, 242, 0.7);
  transform: translateY(-3px);
  box-shadow: 0 12px 32px rgba(88, 101, 242, 0.38), 0 0 20px rgba(88,101,242,0.15), inset 0 1px 0 rgba(255,255,255,0.1);
}
.discord-icon { flex-shrink: 0; fill: #5865F2; }
.discord-text { flex: 1; display: flex; flex-direction: column; text-align: left; }
.discord-text strong { font-size: 13.5px; font-weight: 750; color: #fff; }
.discord-text small { font-size: 11px; color: #a5b4fc; }
.discord-online-badge {
  font-size: 10px; font-weight: 800; padding: 3px 8px; border-radius: 999px;
  background: rgba(34, 197, 94, 0.2); color: #4ade80; border: 1px solid rgba(34, 197, 94, 0.4);
}

/* SHOWCASE BENTO GRID */
.bento-features-grid {
  display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin-bottom: 20px;
}
.bento-feature-item {
  position: relative;
  background: rgba(255, 255, 255, 0.03); border: 1px solid rgba(255, 255, 255, 0.07);
  border-radius: 13px; padding: 13px 15px; display: flex; align-items: flex-start; gap: 10px;
  transition: all 0.25s cubic-bezier(0.16, 1, 0.3, 1);
  box-shadow: 0 4px 14px rgba(0,0,0,0.25), inset 0 1px 0 rgba(255,255,255,0.08);
  animation: fadeUpIn 0.4s cubic-bezier(0.16, 1, 0.3, 1) both;
}
.bento-feature-item:nth-child(1) { animation-delay: 0.08s; }
.bento-feature-item:nth-child(2) { animation-delay: 0.14s; }
.bento-feature-item:nth-child(3) { animation-delay: 0.20s; }
.bento-feature-item:nth-child(4) { animation-delay: 0.26s; }
.bento-feature-item:hover {
  background: rgba(56, 189, 248, 0.08);
  border-color: rgba(56, 189, 248, 0.4);
  transform: translateY(-2px);
  box-shadow: 0 10px 24px rgba(0,0,0,0.35), 0 0 20px rgba(56,189,248,0.12), inset 0 1px 0 rgba(255,255,255,0.12);
}
.bento-icon { font-size: 20px; flex-shrink: 0; line-height: 1; margin-top: 2px; }
.bento-text strong { display: block; font-size: 12.5px; font-weight: 750; color: #f1f5f9; margin-bottom: 2px; }
.bento-text p { font-size: 11px; color: var(--muted); line-height: 1.35; margin: 0; }

/* SLA ROW */
.sla-row {
  display: flex; gap: 16px; font-size: 11.5px; color: var(--muted); align-items: center;
  border-top: 1px solid rgba(255, 255, 255, 0.06); padding-top: 14px;
}
.sla-item { display: flex; align-items: center; gap: 6px; }

/* LOGIN CARD (RIGHT) */
.login-card {
  position: relative;
  z-index: 1;
  background: var(--card-bg);
  border: 1px solid var(--border-glow);
  border-radius: 24px; padding: 36px 32px;
  box-shadow: 0 32px 80px rgba(0,0,0,0.85), 0 0 50px rgba(56, 189, 248, 0.12), inset 0 1px 0 rgba(255,255,255,0.12);
  backdrop-filter: blur(24px) saturate(180%); -webkit-backdrop-filter: blur(24px) saturate(180%);
  display: flex; flex-direction: column; justify-content: center;
  text-align: center;
  animation: fadeUpIn 0.45s cubic-bezier(0.22, 1, 0.36, 1) both;
}
.login-card-header { margin-bottom: 22px; text-align: center; }
.login-logo { font-size: 40px; margin-bottom: 8px; filter: drop-shadow(0 0 16px rgba(56, 189, 248, 0.5)); }
.login-title {
  font-size: 22px; font-weight: 850; color: #fff; margin-bottom: 6px;
  letter-spacing: -0.02em;
}
.login-subtitle { font-size: 13px; color: var(--muted); line-height: 1.4; }

/* SEGMENTED TABS */
.auth-tabs {
  display: flex; gap: 6px; margin-bottom: 22px;
  background: rgba(0, 0, 0, 0.35); padding: 5px;
  border-radius: 12px; border: 1px solid rgba(255, 255, 255, 0.06);
}
.auth-tab-btn {
  flex: 1; padding: 10px 12px; background: transparent; border: none;
  color: var(--muted); font-size: 13px; font-weight: 750; border-radius: 8px;
  cursor: pointer; transition: all 0.2s ease;
  font-family: inherit;
}
.auth-tab-btn.active {
  background: linear-gradient(135deg, rgba(14, 165, 233, 0.25) 0%, rgba(37, 99, 235, 0.2) 100%);
  color: #7dd3fc;
  border: 1px solid rgba(56, 189, 248, 0.45);
  box-shadow: 0 4px 14px rgba(0,0,0,0.3), inset 0 1px 0 rgba(255,255,255,0.08);
  font-weight: 800;
}

/* FORM FIELDS */
.form-row { text-align: left; margin-bottom: 15px; }
.form-row label {
  display: flex; justify-content: space-between; align-items: center;
  font-size: 11px; font-weight: 750; color: #94a3b8; margin-bottom: 6px; letter-spacing: 0.5px;
}
.input-wrap { position: relative; }
.input-wrap input {
  width: 100%; padding: 12px 14px 12px 38px;
  background: rgba(7, 12, 22, 0.85); border: 1px solid rgba(255,255,255,0.08);
  border-radius: 10px; color: #fff; font-size: 13.5px; outline: none;
  font-family: inherit;
  transition: border-color 0.2s, box-shadow 0.2s;
  box-shadow: inset 0 2px 4px rgba(0,0,0,0.3);
}
.input-wrap input:focus {
  border-color: var(--cyan);
  box-shadow: 0 0 0 3px rgba(56, 189, 248, 0.22), inset 0 2px 4px rgba(0,0,0,0.3);
}
.input-icon {
  position: absolute; left: 12px; top: 50%; transform: translateY(-50%);
  font-size: 15px; color: var(--muted); pointer-events: none;
}
.password-input-wrap input { padding-right: 42px; }
.password-toggle-btn {
  position: absolute; right: 10px; top: 50%; transform: translateY(-50%);
  background: none; border: none; color: var(--muted); cursor: pointer;
  font-size: 16px; padding: 4px; border-radius: 4px;
}
.password-toggle-btn:hover { color: #fff; }

.trial-callout-badge {
  background: linear-gradient(135deg, rgba(234, 179, 8, 0.15) 0%, rgba(249, 115, 22, 0.15) 100%);
  border: 1px solid rgba(234, 179, 8, 0.35); border-radius: 10px;
  padding: 10px 12px; font-size: 12px; color: #fde047; text-align: left;
  margin-bottom: 16px; display: flex; align-items: center; gap: 8px; line-height: 1.35;
}

/* iOS-style Toggle Switch */
.check-row {
  display: flex; align-items: center; gap: 10px; font-size: 12.5px; color: var(--muted);
  cursor: pointer; margin: 12px 0 20px; user-select: none; text-align: left;
}
.check-row input[type="checkbox"] {
  -webkit-appearance: none;
  appearance: none;
  width: 38px;
  height: 22px;
  min-width: 38px;
  border-radius: 999px;
  background: rgba(255,255,255,0.12);
  border: 1px solid rgba(255,255,255,0.15);
  position: relative;
  cursor: pointer;
  transition: all 0.25s cubic-bezier(0.16, 1, 0.3, 1);
  padding: 0;
  box-shadow: inset 0 1px 3px rgba(0,0,0,0.4);
  flex-shrink: 0;
}
.check-row input[type="checkbox"]::after {
  content: '';
  position: absolute;
  left: 3px;
  top: 50%;
  transform: translateY(-50%);
  width: 16px;
  height: 16px;
  border-radius: 50%;
  background: #fff;
  box-shadow: 0 1px 4px rgba(0,0,0,0.4);
  transition: all 0.25s cubic-bezier(0.16, 1, 0.3, 1);
}
.check-row input[type="checkbox"]:checked {
  background: linear-gradient(135deg, #10b981, #0ea5e9);
  border-color: rgba(16, 185, 129, 0.6);
  box-shadow: 0 0 10px rgba(16, 185, 129, 0.35), inset 0 1px 3px rgba(0,0,0,0.2);
}
.check-row input[type="checkbox"]:checked::after {
  left: calc(100% - 19px);
}

button.primary-cta {
  position: relative;
  overflow: hidden;
  width: 100%; padding: 14px;
  background: linear-gradient(135deg, #0ea5e9 0%, #2563eb 100%);
  border: 1px solid rgba(56, 189, 248, 0.55);
  border-radius: 12px; color: #fff;
  font-size: 14.5px; font-weight: 800;
  font-family: inherit;
  cursor: pointer; letter-spacing: 0.01em;
  box-shadow: 0 6px 22px rgba(14, 165, 233, 0.4), inset 0 1px 0 rgba(255,255,255,0.15);
  transition: all 0.25s cubic-bezier(0.16, 1, 0.3, 1);
}
button.primary-cta::after {
  content: '';
  position: absolute;
  top: 0; left: 0;
  width: 50%;
  height: 100%;
  background: linear-gradient(90deg, transparent, rgba(255,255,255,0.2), transparent);
  transform: translateX(-140%);
}
button.primary-cta:hover::after {
  animation: shimmerSlide 0.65s cubic-bezier(0.16, 1, 0.3, 1) forwards;
}
button.primary-cta:hover:not(:disabled) {
  background: linear-gradient(135deg, #22b8fc 0%, #3b7ff5 100%);
  transform: translateY(-2px);
  box-shadow: 0 10px 32px rgba(14, 165, 233, 0.55), inset 0 1px 0 rgba(255,255,255,0.18);
}
button.primary-cta:active:not(:disabled) {
  transform: scale(0.97);
}
button.primary-cta:disabled { opacity: 0.55; cursor: not-allowed; }

.login-alert {
  padding: 11px 14px; border-radius: 10px; font-size: 13px;
  margin-bottom: 18px; text-align: left; line-height: 1.4;
}
.login-alert.hidden { display: none; }
.login-alert.error {
  background: rgba(239, 68, 68, 0.15); border: 1px solid rgba(239, 68, 68, 0.45); color: #fca5a5;
}
.login-alert.success {
  background: rgba(52, 211, 153, 0.15); border: 1px solid rgba(52, 211, 153, 0.45); color: #86efac;
}

.login-footer-info {
  margin-top: 20px; padding-top: 16px;
  border-top: 1px solid rgba(255, 255, 255, 0.06);
  font-size: 12px; color: var(--muted); line-height: 1.5; text-align: left;
}
.login-footer-info code {
  background: rgba(255, 255, 255, 0.08); padding: 2px 6px; border-radius: 4px;
  color: var(--cyan); font-family: 'JetBrains Mono', ui-monospace, monospace; font-size: 11.5px;
  font-variant-numeric: tabular-nums;
}
.hidden { display: none !important; }

@media (max-width: 480px) {
  body { padding: 12px 8px; }
  .login-card { padding: 24px 16px; border-radius: 18px; }
  .login-title { font-size: 20px; }
  .auth-tabs { gap: 4px; padding: 4px; }
  .auth-tab-btn { font-size: 12px; padding: 8px 10px; }
}

@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after {
    animation-duration: 0.01ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 0.01ms !important;
    scroll-behavior: auto !important;
  }
}

button:focus-visible, input:focus-visible, a:focus-visible {
  outline: 2px solid var(--cyan) !important;
  outline-offset: 2px !important;
}

/* === DEEP GALAXY INFINITE VIDEO & 3D COSMIC STAGE (PUBLIC LOGIN) === */
.cosmic-login-stage {
  position: fixed; inset: 0; z-index: 0; overflow: hidden; pointer-events: none;
  background: radial-gradient(ellipse at 50% 30%, #0b152c 0%, #050914 60%, #02040a 100%);
}
.cosmic-bg-video {
  position: absolute; inset: -3%; width: 106%; height: 106%; object-fit: cover;
  opacity: 0.52; filter: saturate(1.4) contrast(1.12) brightness(0.82) hue-rotate(-6deg);
  transition: transform 0.25s ease-out, opacity 1s ease; will-change: transform;
}
.cosmic-nebula-orb {
  position: absolute; border-radius: 50%; filter: blur(85px); mix-blend-mode: screen; pointer-events: none;
}
.cosmic-nebula-orb.orb-cyan {
  top: -12%; left: -8%; width: min(680px, 60vw); height: min(680px, 60vw);
  background: radial-gradient(circle, rgba(14, 165, 233, 0.36) 0%, rgba(56, 189, 248, 0.1) 45%, transparent 72%);
  animation: auroraFloat 18s ease-in-out infinite alternate;
}
.cosmic-nebula-orb.orb-purple {
  bottom: -16%; right: -8%; width: min(740px, 65vw); height: min(740px, 65vw);
  background: radial-gradient(circle, rgba(124, 58, 237, 0.34) 0%, rgba(168, 85, 247, 0.1) 48%, transparent 72%);
  animation: auroraFloat 22s ease-in-out infinite alternate-reverse;
}
.cosmic-nebula-orb.orb-emerald {
  top: 28%; left: 38%; width: min(460px, 45vw); height: min(460px, 45vw);
  background: radial-gradient(circle, rgba(16, 185, 129, 0.18) 0%, transparent 70%);
  animation: auroraFloat 26s ease-in-out infinite;
}
.cosmic-starfield-canvas { position: absolute; inset: 0; width: 100%; height: 100%; opacity: 0.96; }
.cosmic-vignette-overlay {
  position: absolute; inset: 0;
  background:
    radial-gradient(circle at 50% 45%, rgba(4, 7, 17, 0.15) 0%, rgba(3, 6, 15, 0.68) 76%, rgba(2, 4, 10, 0.92) 100%),
    linear-gradient(rgba(255, 255, 255, 0.018) 1px, transparent 1px),
    linear-gradient(90deg, rgba(255, 255, 255, 0.018) 1px, transparent 1px);
  background-size: 100% 100%, 38px 38px, 38px 38px;
}
.kbot-portal-container { z-index: 2; }
.login-card {
  background: linear-gradient(160deg, rgba(13, 22, 42, 0.76) 0%, rgba(6, 11, 24, 0.88) 100%) !important;
  border: 1px solid rgba(56, 189, 248, 0.36) !important;
  box-shadow: 0 32px 90px rgba(0, 0, 0, 0.85), 0 0 65px rgba(14, 165, 233, 0.16), inset 0 1px 0 rgba(255, 255, 255, 0.22) !important;
  backdrop-filter: blur(26px) saturate(190%) !important; -webkit-backdrop-filter: blur(26px) saturate(190%) !important;
}
.bento-feature-item {
  background: linear-gradient(145deg, rgba(14, 24, 46, 0.62) 0%, rgba(8, 13, 26, 0.78) 100%) !important;
  border: 1px solid rgba(255, 255, 255, 0.09) !important;
  backdrop-filter: blur(16px) saturate(160%) !important; -webkit-backdrop-filter: blur(16px) saturate(160%) !important;
  box-shadow: 0 12px 32px rgba(0, 0, 0, 0.45), inset 0 1px 0 rgba(255, 255, 255, 0.1) !important;
}
.discord-card-btn { backdrop-filter: blur(16px) !important; -webkit-backdrop-filter: blur(16px) !important; }
@media (prefers-reduced-motion: reduce) {
  .cosmic-bg-video, .cosmic-starfield-canvas { display: none !important; }
}
</style>
</head>
<body>
<div class="cosmic-login-stage" aria-hidden="true">
  <video id="publicGalaxyVideo" class="cosmic-bg-video" autoplay loop muted playsinline preload="auto" onerror="this.style.display='none'">
    <source src="https://cdn.pixabay.com/video/2020/04/18/36466-410655390_large.mp4" type="video/mp4">
    <source src="https://assets.mixkit.co/videos/preview/mixkit-stars-in-space-1610-large.mp4" type="video/mp4">
  </video>
  <div class="cosmic-nebula-orb orb-cyan"></div>
  <div class="cosmic-nebula-orb orb-purple"></div>
  <div class="cosmic-nebula-orb orb-emerald"></div>
  <canvas id="publicStarfieldCanvas" class="cosmic-starfield-canvas"></canvas>
  <div class="cosmic-vignette-overlay"></div>
</div>
<div class="kbot-portal-container">
  <!-- CỘT TRÁI: SAAS & FLEET SHOWCASE -->
  <div class="kbot-showcase-col">
    <div class="brand-pill-row">
      <span class="brand-tag">👑 KBOT SENTINEL • ENTERPRISE</span>
      <span class="server-pulse-tag"><span class="pulse-circle"></span> Hệ Thống Trực Tuyến 24/7</span>
    </div>

    <h1 class="showcase-headline">
      Nền Tảng Thuê Bot AFK KingMC<br>
      <span class="gradient-headline">Tự Động &amp; Bất Tử Đám Mây</span>
    </h1>

    <p class="showcase-desc">
      Giải pháp cắm chuột AFK đám mây chuyên nghiệp số 1 dành riêng cho cụm máy chủ KingMC. Không cần mở máy tính, tự động thay totem, tự ăn, tự cất đồ và chống kick máy chủ tuyệt đối.
    </p>

    <!-- NÚT DISCORD HỖ TRỢ 24/7 -->
    <a href="https://discord.gg/mJWX5Xp3z" target="_blank" rel="noopener noreferrer" class="discord-card-btn" title="Tham gia Discord Hỗ TrỢ 24/7">
      <svg class="discord-icon" viewBox="0 0 24 24" width="28" height="28">
        <path d="M20.317 4.37a19.791 19.791 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.25.077.077 0 0 0-.079-.037A19.736 19.736 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 0 0 .031.057 19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028 14.09 14.09 0 0 0 1.226-1.994.076.076 0 0 0-.041-.106 13.107 13.107 0 0 1-1.872-.892.077.077 0 0 1-.008-.128 10.2 10.2 0 0 0 .372-.292.074.074 0 0 1 .077-.01c3.929 1.793 8.18 1.793 12.061 0a.074.074 0 0 1 .078.01c.12.098.246.198.373.292a.077.077 0 0 1-.006.127 12.299 12.299 0 0 1-1.873.894.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028 19.839 19.839 0 0 0 6.002-3.03.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.028zM8.02 15.33c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.956-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.956 2.418-2.157 2.418zm7.975 0c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.955-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.946 2.418-2.157 2.418z"/>
      </svg>
      <div class="discord-text">
        <strong>Gia Nhập Cộng Đồng Discord Hỗ Trợ 24/7</strong>
        <small>Mua Key gia hạn, nhận Giftcode khuyến mãi &amp; trợ giúp kỹ thuật</small>
      </div>
      <span class="discord-online-badge">ONLINE</span>
    </a>

    <!-- 4 TÍNH NĂNG ĐỈNH CAO BENTO -->
    <div class="bento-features-grid">
      <div class="bento-feature-item">
        <span class="bento-icon">⚡</span>
        <div class="bento-text">
          <strong>Auto Totem Bất Tử</strong>
          <p>Tự động trang bị totem tay phụ khi máu &lt; 5 tim, chống quái cắn và rơi vực.</p>
        </div>
      </div>
      <div class="bento-feature-item">
        <span class="bento-icon">🍞</span>
        <div class="bento-text">
          <strong>Auto Ăn &amp; Chống Đói</strong>
          <p>Tự tìm bánh mì/thịt trong túi đồ ăn khi đói, đảm bảo hồi máu liên tục.</p>
        </div>
      </div>
      <div class="bento-feature-item">
        <span class="bento-icon">💬</span>
        <div class="bento-text">
          <strong>Auto Chat &amp; Anti-AFK</strong>
          <p>Lập lịch rao bán shop và vi chuyển động thông minh chống kick máy chủ.</p>
        </div>
      </div>
      <div class="bento-feature-item">
        <span class="bento-icon">⏰</span>
        <div class="bento-text">
          <strong>Hẹn Giờ Bật/Tắt</strong>
          <p>Cài đặt lịch bật tắt theo giờ cố định hoặc chu kỳ lặp như người chơi thật.</p>
        </div>
      </div>
    </div>

    <!-- CAM KẾT SLA -->
    <div class="sla-row">
      <div class="sla-item"><span>🛡️</span> <strong>99.9% Uptime Cloud</strong></div>
      <div class="sla-item"><span>🔒</span> <strong>Mã Hóa Chuẩn Scrypt Quân Sự</strong></div>
      <div class="sla-item"><span>🚀</span> <strong>Tự Reconnect Sau Bảo Trì</strong></div>
    </div>
  </div>

  <!-- CỘT PHẢI: CỔNG ĐĂNG NHẬP / ĐĂNG KÝ -->
  <div class="login-card">
    <div class="login-card-header">
      <div class="login-logo">🛡️</div>
      <h2 class="login-title">CỔNG BẢO MẬT KBOT</h2>
      <div class="login-subtitle">Hệ Thống Thuê Bot AFK KingMC Thương Mại Cao Cấp</div>
    </div>

    <!-- SEGMENTED TABS -->
    <div class="auth-tabs">
      <button type="button" class="auth-tab-btn active" id="tabPublicLoginBtn" onclick="switchPublicAuthTab('login')">🚀 Đăng Nhập</button>
      <button type="button" class="auth-tab-btn" id="tabPublicRegisterBtn" onclick="switchPublicAuthTab('register')">📝 Đăng Ký Tài Khoản</button>
    </div>

    <div id="publicLoginAlert" class="login-alert hidden"></div>

    <!-- FORM 1: ĐĂNG NHẬP -->
    <form id="publicLoginForm" onsubmit="handlePublicLoginSubmit(event)">
      <div class="form-row">
        <label for="publicUsername"><span>TÊN ĐĂNG NHẬP</span></label>
        <div class="input-wrap">
          <span class="input-icon">👤</span>
          <input id="publicUsername" type="text" autocomplete="username" placeholder="Nhập admin hoặc username thuê..." required autofocus>
        </div>
      </div>
      <div class="form-row">
        <label for="publicPassword"><span>MẬT KHẨU</span></label>
        <div class="input-wrap password-input-wrap">
          <span class="input-icon">🔒</span>
          <input id="publicPassword" type="password" autocomplete="current-password" placeholder="Nhập mật khẩu truy cập..." required>
          <button type="button" class="password-toggle-btn" onclick="togglePublicPass('publicPassword', this)">👁</button>
        </div>
      </div>
      <div class="form-row">
        <label for="publicLicenseKey">
          <span>MÃ KEY GIA HẠN</span>
          <span style="font-size:10.5px;color:var(--muted);font-weight:normal;">(Nếu có / Tùy chọn)</span>
        </label>
        <div class="input-wrap">
          <span class="input-icon">🔑</span>
          <input id="publicLicenseKey" type="text" placeholder="Nhập mã Key để tự mở khóa / cộng thêm ngày thuê..." style="text-transform:uppercase;">
        </div>
      </div>
      <label class="check-row">
        <input id="publicRememberMe" type="checkbox" checked>
        <span>Ghi nhớ phiên đăng nhập (30 ngày)</span>
      </label>
      <button id="publicSubmitBtn" type="submit" class="primary-cta">🚀 ĐĂNG NHẬP VÀO HỆ THỐNG</button>
    </form>

    <!-- FORM 2: ĐĂNG KÝ -->
    <form id="publicRegisterForm" class="hidden" onsubmit="handlePublicRegisterSubmit(event)">
      <div class="trial-callout-badge" id="publicTrialCalloutBadge">
        <span style="font-size:18px;">🎉</span>
        <div id="publicTrialCalloutText"><strong>ĐẶC QUYỀN MỚI:</strong> Nhận ngay <strong>1 NGÀY DÙNG THỬ MIỄN PHÍ</strong> sau khi tạo tài khoản thành công!</div>
      </div>
      <div class="form-row">
        <label for="regUsername"><span>TÊN ĐĂNG NHẬP MỚI</span></label>
        <div class="input-wrap">
          <span class="input-icon">👤</span>
          <input id="regUsername" type="text" autocomplete="username" placeholder="Tên tài khoản (3 - 32 ký tự)..." required>
        </div>
      </div>
      <div class="form-row">
        <label for="regPassword"><span>MẬT KHẨU MỚI</span></label>
        <div class="input-wrap password-input-wrap">
          <span class="input-icon">🔒</span>
          <input id="regPassword" type="password" autocomplete="new-password" placeholder="Tối thiểu 5 ký tự (chữ hoặc số, phân biệt hoa thường)..." required>
          <button type="button" class="password-toggle-btn" onclick="togglePublicPass('regPassword', this)">👁</button>
        </div>
      </div>
      <div class="form-row">
        <label for="regPasswordConfirm"><span>XÁC NHẬN MẬT KHẨU</span></label>
        <div class="input-wrap password-input-wrap">
          <span class="input-icon">🔒</span>
          <input id="regPasswordConfirm" type="password" autocomplete="new-password" placeholder="Nhập lại mật khẩu mới..." required>
          <button type="button" class="password-toggle-btn" onclick="togglePublicPass('regPasswordConfirm', this)">👁</button>
        </div>
      </div>
      <div class="form-row">
        <label for="regLicenseKey">
          <span>MÃ KEY KÍCH HOẠT GÓI THUÊ</span>
          <span id="regLicenseKeyHint" style="font-size:10.5px;color:var(--muted);font-weight:normal;">(Để trống nếu dùng thử)</span>
        </label>
        <div class="input-wrap">
          <span class="input-icon">🔑</span>
          <input id="regLicenseKey" type="text" placeholder="Để trống để nhận 1 ngày dùng thử miễn phí..." style="text-transform:uppercase;">
        </div>
      </div>
      <button id="publicRegSubmitBtn" type="submit" class="primary-cta">✨ HOÀN TẤT ĐĂNG KÝ VÀ BẮT ĐẦU</button>
    </form>

    <div class="login-footer-info">
      • Quản trị viên: Đăng nhập bằng tài khoản <code>admin</code>.<br>
      • Khách thuê: Sử dụng tài khoản cá nhân để xem bot và điều khiển.<br>
      • Tài khoản hết hạn: Đăng nhập để nạp Key hoặc vượt link nhận +12h miễn phí.<br>
      • Cần trợ giúp? Liên hệ ngay qua <a href="https://discord.gg/mJWX5Xp3z" target="_blank" rel="noopener noreferrer" style="color:#38bdf8;text-decoration:underline;">Discord Hỗ Trợ 24/7</a>.
    </div>
  </div>
</div>
<script>
function switchPublicAuthTab(tab) {
  const isLogin = tab === 'login';
  document.getElementById('tabPublicLoginBtn').classList.toggle('active', isLogin);
  document.getElementById('tabPublicRegisterBtn').classList.toggle('active', !isLogin);
  document.getElementById('publicLoginForm').classList.toggle('hidden', !isLogin);
  document.getElementById('publicRegisterForm').classList.toggle('hidden', isLogin);
  const alertEl = document.getElementById('publicLoginAlert');
  alertEl.className = 'login-alert hidden';
}
function togglePublicPass(id, btn) {
  const el = document.getElementById(id);
  if (!el) return;
  if (el.type === 'password') { el.type = 'text'; btn.textContent = '🙈'; }
  else { el.type = 'password'; btn.textContent = '👁'; }
}
async function handlePublicLoginSubmit(e) {
  if (e) e.preventDefault();
  const u = document.getElementById('publicUsername').value.trim();
  const p = document.getElementById('publicPassword').value;
  const k = document.getElementById('publicLicenseKey').value.trim();
  const remember = document.getElementById('publicRememberMe').checked === true;
  const alertEl = document.getElementById('publicLoginAlert');
  const btn = document.getElementById('publicSubmitBtn');
  alertEl.className = 'login-alert hidden';
  btn.disabled = true;
  btn.textContent = '⏳ Đang xác thực...';
  try {
    const res = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify({ username: u, password: p, licenseKey: k, rememberMe: remember })
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.ok) {
      throw new Error(data.error || 'Tên đăng nhập hoặc mật khẩu không chính xác.');
    }
    if (data.token) {
      try { localStorage.setItem('kingmc_session', data.token); } catch (_) {}
    }
    alertEl.textContent = '✅ ' + (data.message || 'Đăng nhập thành công! Đang tải dashboard...');
    alertEl.className = 'login-alert success';
    setTimeout(() => { window.location.replace('/'); }, 300);
  } catch (err) {
    alertEl.textContent = '⚠️ ' + err.message;
    alertEl.className = 'login-alert error';
    btn.disabled = false;
    btn.textContent = '🚀 ĐĂNG NHẬP VÀO HỆ THỐNG';
  }
}
async function handlePublicRegisterSubmit(e) {
  if (e) e.preventDefault();
  const u = document.getElementById('regUsername').value.trim();
  const p = document.getElementById('regPassword').value;
  const p2 = document.getElementById('regPasswordConfirm').value;
  const k = document.getElementById('regLicenseKey').value.trim();
  const alertEl = document.getElementById('publicLoginAlert');
  const btn = document.getElementById('publicRegSubmitBtn');

  if (p !== p2) {
    alertEl.textContent = '⚠️ Mật khẩu xác nhận không khớp!';
    alertEl.className = 'login-alert error';
    return;
  }

  alertEl.className = 'login-alert hidden';
  btn.disabled = true;
  btn.textContent = '⏳ Đang đăng ký...';
  try {
    const res = await fetch('/api/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify({ username: u, password: p, licenseKey: k })
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.ok) {
      throw new Error(data.error || 'Không thể đăng ký tài khoản.');
    }
    if (data.token) {
      try { localStorage.setItem('kingmc_session', data.token); } catch (_) {}
    }
    alertEl.textContent = '✅ ' + (data.message || 'Đăng ký thành công! Đang chuyển hướng...');
    alertEl.className = 'login-alert success';
    setTimeout(() => { window.location.replace('/'); }, 350);
  } catch (err) {
    alertEl.textContent = '⚠️ ' + err.message;
    alertEl.className = 'login-alert error';
    btn.disabled = false;
    btn.textContent = '✨ HOÀN TẤT ĐĂNG KÝ VÀ BẮT ĐẦU';
  }
}
async function loadPublicSystemInfo() {
  try {
    const res = await fetch('/api/public/system-info');
    if (!res.ok) return;
    const data = await res.json();
    const badge = document.getElementById('publicTrialCalloutBadge');
    const text = document.getElementById('publicTrialCalloutText');
    const keyHint = document.getElementById('regLicenseKeyHint');
    const keyInput = document.getElementById('regLicenseKey');
    if (!badge || !data || !data.ok) return;
    if (data.trialGiftEnabled === false) {
      badge.style.display = 'none';
      if (keyHint) keyHint.textContent = '(Tùy chọn - Nhập nếu có mã Key)';
      if (keyInput) keyInput.placeholder = 'Nhập mã Key (Tùy chọn, để trống nếu chưa có)...';
    } else {
      badge.style.display = 'flex';
      const days = data.trialDays || 1;
      if (text) text.innerHTML = '<strong>ĐẶC QUYỀN MỚI:</strong> Nhận ngay <strong>' + days + ' NGÀY DÙNG THỬ MIỄN PHÍ</strong> sau khi tạo tài khoản thành công!';
      if (keyHint) keyHint.textContent = '(Để trống nếu dùng thử)';
      if (keyInput) keyInput.placeholder = 'Để trống để nhận ' + days + ' ngày dùng thử miễn phí...';
    }
  } catch (_) {}
}
loadPublicSystemInfo();
window.switchPublicAuthTab = switchPublicAuthTab;
window.togglePublicPass = togglePublicPass;

(function initPublicGalaxyEngine() {
  var canvas = document.getElementById('publicStarfieldCanvas');
  var video = document.getElementById('publicGalaxyVideo');
  if (video) {
    video.playbackRate = 0.85;
    video.play().catch(function() {});
    video.style.transform = 'translate3d(' + (0).toFixed(1) + 'px,' + (0).toFixed(1) + 'px,0) scale(1.02)';
  }
  if (!canvas) return;
  var ctx = canvas.getContext('2d');
  var w = 0, h = 0;
  var stars = [], shootingStars = [];
  var isMobile = /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent) || (window.innerWidth <= 768);
  function resize() { w = canvas.width = window.innerWidth; h = canvas.height = window.innerHeight; }
  window.addEventListener('resize', resize, { passive: true });
  resize();
  var starCount = isMobile ? 35 : 75;
  for (var i = 0; i < starCount; i++) {
    stars.push({
      x: Math.random() * w, y: Math.random() * h, z: Math.random() * 2.2 + 0.4,
      r: Math.random() * 1.8 + 0.6, a: Math.random() * 0.6 + 0.35,
      da: (Math.random() * 0.016 + 0.005) * (Math.random() < 0.5 ? 1 : -1),
      rgb: Math.random() < 0.35 ? '255,255,255' : (Math.random() < 0.65 ? '224,242,254' : (Math.random() < 0.85 ? '233,213,255' : '254,240,138'))
    });
  }
  function tick() {
    if (document.hidden) { setTimeout(function() { requestAnimationFrame(tick); }, 500); return; }
    ctx.clearRect(0, 0, w, h);
    for (var i = 0; i < stars.length; i++) {
      var s = stars[i];
      s.y -= 0.14 * s.z; s.a += s.da;
      if (s.a > 1.0 || s.a < 0.25) s.da = -s.da;
      if (s.y < -12) { s.y = h + 12; s.x = Math.random() * w; }
      var sx = s.x;
      var sy = s.y;
      var rad = s.r * s.z * 0.85;
      var alpha = Math.max(0.2, Math.min(1.0, s.a));
      // Outer glow & diamond sparkle for bright twinkling stars (desktop only for performance)
      if (!isMobile && rad > 2.0 && alpha > 0.55) {
        ctx.beginPath();
        ctx.arc(sx, sy, rad * 2.0, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(' + s.rgb + ',' + (alpha * 0.22).toFixed(2) + ')';
        ctx.fill();
        if (alpha > 0.82) {
          ctx.strokeStyle = 'rgba(255,255,255,' + (alpha * 0.75).toFixed(2) + ')';
          ctx.lineWidth = 1.1;
          var spLen = rad * 2.8;
          ctx.beginPath();
          ctx.moveTo(sx - spLen, sy); ctx.lineTo(sx + spLen, sy);
          ctx.moveTo(sx, sy - spLen); ctx.lineTo(sx, sy + spLen);
          ctx.stroke();
        }
      }
      ctx.beginPath();
      ctx.arc(sx, sy, rad, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(' + s.rgb + ',' + alpha + ')';
      ctx.fill();
    }
    // Shooting stars with glowing comet head and luminous tail
    if (shootingStars.length < 3 && Math.random() < 0.018) {
      shootingStars.push({
        x: Math.random() * w * 0.85 + w * 0.1,
        y: Math.random() * h * 0.4,
        len: Math.random() * 140 + 90,
        speed: Math.random() * 10 + 8.5,
        a: 1.0
      });
    }
    for (var j = shootingStars.length - 1; j >= 0; j--) {
      var st = shootingStars[j];
      st.x -= st.speed; st.y += st.speed * 0.58; st.a -= 0.018;
      if (st.a <= 0) { shootingStars.splice(j, 1); continue; }
      var tailX = st.x + st.len;
      var tailY = st.y - st.len * 0.58;
      // Soft cyan glow trail
      var gGlow = ctx.createLinearGradient(st.x, st.y, tailX, tailY);
      gGlow.addColorStop(0, 'rgba(56,189,248,' + (st.a * 0.65).toFixed(2) + ')');
      gGlow.addColorStop(1, 'rgba(56,189,248,0)');
      ctx.strokeStyle = gGlow; ctx.lineWidth = 3.8; ctx.beginPath();
      ctx.moveTo(st.x, st.y); ctx.lineTo(tailX, tailY); ctx.stroke();
      // Sharp white core trail
      var gCore = ctx.createLinearGradient(st.x, st.y, tailX, tailY);
      gCore.addColorStop(0, 'rgba(255,255,255,' + st.a.toFixed(2) + ')');
      gCore.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.strokeStyle = gCore; ctx.lineWidth = 1.8; ctx.beginPath();
      ctx.moveTo(st.x, st.y); ctx.lineTo(tailX, tailY); ctx.stroke();
      // Glowing comet head
      ctx.beginPath();
      ctx.arc(st.x, st.y, 4.5, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(56,189,248,' + (st.a * 0.45).toFixed(2) + ')';
      ctx.fill();
      ctx.beginPath();
      ctx.arc(st.x, st.y, 2.2, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(255,255,255,' + st.a.toFixed(2) + ')';
      ctx.fill();
    }
    requestAnimationFrame(tick);
  }
  tick();
})();
</script>
</body>
</html>`;

module.exports = { PUBLIC_LOGIN_HTML };
