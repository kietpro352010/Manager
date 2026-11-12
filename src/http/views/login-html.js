'use strict';

const PUBLIC_LOGIN_HTML = String.raw`<!doctype html>
<html lang="vi">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<meta name="color-scheme" content="dark">
<title>Cổng Đăng Nhập | KBOT — Hệ Thống AFK KingMC</title>
<link rel="icon" type="image/svg+xml" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'%3E%3Crect width='32' height='32' rx='8' fill='%23050811'/%3E%3Cpath d='M16 5l9 3.5v7c0 6-4 9.5-9 11.5-5-2-9-5.5-9-11.5v-7L16 5z' fill='none' stroke='%2338bdf8' stroke-width='2.2'/%3E%3C/svg%3E">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;500;600;700&family=Plus+Jakarta+Sans:wght@400;500;600;700;800&display=swap" rel="stylesheet">
<style>
:root {
  color-scheme: dark;
  --bg-base: #050811;
  --bg-surface: rgba(11, 17, 30, 0.86);
  --bg-surface-elevated: rgba(16, 24, 42, 0.92);
  --bg-input: rgba(6, 10, 19, 0.9);
  --border-subtle: rgba(255, 255, 255, 0.08);
  --border-strong: rgba(255, 255, 255, 0.14);
  --border-focus: #38bdf8;
  --text-primary: #f8fafc;
  --text-secondary: #cbd5e1;
  --text-muted: #94a3b8;
  --text-dim: #8596b0;
  --cyan: #38bdf8;
  --cyan-soft: rgba(56, 189, 248, 0.12);
  --scrollbar-thumb: rgba(148, 163, 184, 0.32);
  --scrollbar-track: transparent;
  --blue: #2563eb;
  --indigo: #6366f1;
  --discord: #5865f2;
  --green: #10b981;
  --green-soft: rgba(16, 185, 129, 0.12);
  --amber: #f59e0b;
  --amber-soft: rgba(245, 158, 11, 0.12);
  --red: #ef4444;
  --red-soft: rgba(239, 68, 68, 0.12);
  --radius-sm: 8px;
  --radius-md: 11px;
  --radius-lg: 16px;
  --radius-xl: 20px;
  --shadow-card: 0 24px 64px -12px rgba(0, 0, 0, 0.78), 0 0 0 1px rgba(255, 255, 255, 0.08), inset 0 1px 0 rgba(255, 255, 255, 0.1);
  --shadow-subtle: 0 8px 24px -4px rgba(0, 0, 0, 0.45), inset 0 1px 0 rgba(255, 255, 255, 0.06);
  --font-sans: 'Plus Jakarta Sans', -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
  --font-mono: 'JetBrains Mono', ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
}

@keyframes fadeUpIn {
  from { opacity: 0; transform: translateY(10px); }
  to { opacity: 1; transform: translateY(0); }
}
@keyframes auroraFloat {
  0%, 100% { transform: translate(0, 0) scale(1); }
  50% { transform: translate(20px, -14px) scale(1.05); }
}
@keyframes sonarPulse {
  0% { transform: scale(1); opacity: 0.85; }
  75% { transform: scale(2.3); opacity: 0; }
  100% { transform: scale(2.3); opacity: 0; }
}
@keyframes spin {
  to { transform: rotate(360deg); }
}

*, *::before, *::after {
  box-sizing: border-box;
  margin: 0;
  padding: 0;
}

.hidden,
[hidden] {
  display: none !important;
}

.visually-hidden:where(:not(:focus-within, :active)) {
  position: absolute !important;
  clip-path: inset(50%) !important;
  overflow: hidden !important;
  width: 1px !important;
  height: 1px !important;
  margin: -1px !important;
  padding: 0 !important;
  border: 0 !important;
  white-space: nowrap !important;
}

html {
  color-scheme: dark;
  scrollbar-color: var(--scrollbar-thumb) var(--scrollbar-track);
  scrollbar-width: thin;
}
@supports not (scrollbar-color: auto) {
  ::-webkit-scrollbar {
    width: 6px;
    height: 6px;
  }
  ::-webkit-scrollbar-track {
    background: transparent;
  }
  ::-webkit-scrollbar-thumb {
    background: var(--scrollbar-thumb);
    border-radius: 999px;
  }
}
html, body {
  width: 100%;
  max-width: 100%;
  min-height: 100vh;
  min-height: 100dvh;
  overflow-x: hidden;
  background-color: var(--bg-base);
  color: var(--text-primary);
  font-family: var(--font-sans);
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
  text-rendering: optimizeLegibility;
}

body {
  display: flex;
  flex-direction: column;
  justify-content: space-between;
  position: relative;
}

svg.ui-icon {
  display: block;
  flex-shrink: 0;
}

/* ==========================================================================
   AMBIENT CLOUD STAGE (SUBTLE ENTERPRISE DEPTH)
   ========================================================================== */
.cosmic-login-stage {
  position: fixed;
  inset: 0;
  z-index: 0;
  overflow: hidden;
  pointer-events: none;
  background:
    radial-gradient(ellipse 80% 50% at 50% -15%, rgba(14, 165, 233, 0.16), transparent 70%),
    radial-gradient(ellipse 60% 50% at 90% 100%, rgba(99, 102, 241, 0.12), transparent 70%),
    linear-gradient(180deg, #070b16 0%, #050811 100%);
}
.cosmic-bg-video {
  position: absolute;
  inset: -2%;
  width: 104%;
  height: 104%;
  object-fit: cover;
  opacity: 0.24;
  filter: saturate(1.15) contrast(1.08) brightness(0.68) hue-rotate(-6deg);
}
.cosmic-nebula-orb {
  position: absolute;
  border-radius: 50%;
  filter: blur(95px);
  pointer-events: none;
}
.cosmic-nebula-orb.orb-cyan {
  top: -15%;
  left: -10%;
  width: min(560px, 55vw);
  height: min(560px, 55vw);
  background: radial-gradient(circle, rgba(14, 165, 233, 0.2) 0%, transparent 70%);
}
.cosmic-nebula-orb.orb-purple {
  bottom: -18%;
  right: -8%;
  width: min(600px, 60vw);
  height: min(600px, 60vw);
  background: radial-gradient(circle, rgba(99, 102, 241, 0.18) 0%, transparent 70%);
}
.cosmic-nebula-orb.orb-emerald {
  top: 30%;
  left: 40%;
  width: min(420px, 45vw);
  height: min(420px, 45vw);
  background: radial-gradient(circle, rgba(16, 185, 129, 0.1) 0%, transparent 70%);
}
.cosmic-starfield-canvas {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  opacity: 0.65;
}
.cosmic-vignette-overlay {
  position: absolute;
  inset: 0;
  background-image:
    radial-gradient(circle at 50% 45%, rgba(5, 8, 17, 0.2) 0%, rgba(5, 8, 17, 0.78) 80%, rgba(5, 8, 17, 0.95) 100%),
    linear-gradient(rgba(255, 255, 255, 0.02) 1px, transparent 1px),
    linear-gradient(90deg, rgba(255, 255, 255, 0.02) 1px, transparent 1px);
  background-size: 100% 100%, 40px 40px, 40px 40px;
  background-position: 0 0, -1px -1px, -1px -1px;
}

/* ==========================================================================
   TOP SAAS CONSOLE HEADER BAR
   ========================================================================== */
.portal-topbar {
  position: relative;
  z-index: 2;
  width: 100%;
  max-width: 1200px;
  margin: 0 auto;
  padding: 18px 24px 0;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  flex-wrap: wrap;
}
.portal-brand {
  display: inline-flex;
  align-items: center;
  gap: 10px;
  text-decoration: none;
  color: var(--text-primary);
}
.portal-brand-mark {
  width: 34px;
  height: 34px;
  border-radius: 9px;
  background: linear-gradient(135deg, rgba(56, 189, 248, 0.2) 0%, rgba(37, 99, 235, 0.25) 100%);
  border: 1px solid rgba(56, 189, 248, 0.4);
  color: var(--cyan);
  display: flex;
  align-items: center;
  justify-content: center;
  box-shadow: 0 0 18px rgba(56, 189, 248, 0.2);
}
.portal-brand-name {
  font-size: 15px;
  font-weight: 800;
  letter-spacing: -0.02em;
  display: flex;
  align-items: center;
  gap: 8px;
}
.portal-brand-tier {
  font-family: var(--font-mono);
  font-size: 11px;
  font-weight: 700;
  padding: 2px 7px;
  border-radius: 5px;
  background: var(--cyan-soft);
  color: var(--cyan);
  border: 1px solid rgba(56, 189, 248, 0.3);
  letter-spacing: 0.04em;
}
.portal-topbar-right {
  display: flex;
  align-items: center;
  gap: 10px;
}
.server-pulse-tag {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  font-size: 11.5px;
  font-weight: 600;
  padding: 5px 12px;
  border-radius: 999px;
  background: rgba(148, 163, 184, 0.1);
  color: var(--text-secondary);
  border: 1px solid rgba(148, 163, 184, 0.26);
  transition: background-color 0.2s ease, border-color 0.2s ease, color 0.2s ease;
}
.server-pulse-tag.is-online {
  background: var(--green-soft);
  color: #34d399;
  border-color: rgba(16, 185, 129, 0.28);
}
.server-pulse-tag.is-degraded {
  background: var(--amber-soft);
  color: #fbbf24;
  border-color: rgba(245, 158, 11, 0.34);
}
.server-pulse-tag.is-offline {
  background: var(--red-soft);
  color: #fca5a5;
  border-color: rgba(239, 68, 68, 0.36);
}
.pulse-circle {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: var(--text-muted);
  position: relative;
  flex-shrink: 0;
}
.server-pulse-tag.is-online .pulse-circle {
  background: var(--green);
  box-shadow: 0 0 8px var(--green);
}
.server-pulse-tag.is-degraded .pulse-circle {
  background: var(--amber);
  box-shadow: 0 0 8px var(--amber);
}
.server-pulse-tag.is-offline .pulse-circle {
  background: var(--red);
  box-shadow: 0 0 8px var(--red);
}
.pulse-circle::after {
  content: '';
  position: absolute;
  inset: 0;
  border-radius: 50%;
  background: currentColor;
  opacity: 0;
}
.topbar-discord-link {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  min-height: 30px;
  font-size: 12px;
  font-weight: 600;
  color: var(--text-secondary);
  text-decoration: none;
  padding: 5px 12px;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.04);
  border: 1px solid var(--border-subtle);
  transition: background-color 0.18s ease, border-color 0.18s ease, color 0.18s ease;
}
.topbar-discord-link:hover {
  background: rgba(88, 101, 242, 0.16);
  border-color: rgba(88, 101, 242, 0.45);
  color: #fff;
}

/* ==========================================================================
   MAIN PORTAL CONTAINER (DESKTOP 2-COL SPLIT / MOBILE ERGONOMIC STACK)
   ========================================================================== */
.kbot-portal-main {
  position: relative;
  z-index: 2;
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px 24px 32px;
  width: 100%;
}
.kbot-portal-container {
  width: 100%;
  max-width: 1200px;
  display: grid;
  grid-template-columns: 1.12fr 0.88fr;
  gap: 48px;
  align-items: center;
  margin: auto;
}

/* ==========================================================================
   LEFT COLUMN: ENTERPRISE INFRASTRUCTURE & FLEET SHOWCASE
   ========================================================================== */
.kbot-showcase-col {
  display: flex;
  flex-direction: column;
  justify-content: center;
}
.brand-pill-row {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
  margin-bottom: 18px;
}
.brand-tag {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-family: var(--font-mono);
  font-size: 11px;
  font-weight: 700;
  padding: 5px 11px;
  border-radius: 6px;
  background: var(--cyan-soft);
  color: var(--cyan);
  border: 1px solid rgba(56, 189, 248, 0.28);
  letter-spacing: 0.04em;
}
.arch-tag {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  font-family: var(--font-mono);
  font-size: 11px;
  font-weight: 600;
  padding: 5px 10px;
  border-radius: 6px;
  background: rgba(255, 255, 255, 0.04);
  color: var(--text-muted);
  border: 1px solid var(--border-subtle);
}
.showcase-headline {
  font-size: clamp(28px, 1.35rem + 1.45vw, 38px);
  font-weight: 800;
  line-height: 1.2;
  letter-spacing: -0.03em;
  color: var(--text-primary);
  margin-bottom: 14px;
}
.gradient-headline {
  background: linear-gradient(135deg, #38bdf8 0%, #818cf8 50%, #34d399 100%);
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
  background-clip: text;
}
.showcase-desc {
  font-size: 14.5px;
  color: var(--text-muted);
  line-height: 1.65;
  margin-bottom: 24px;
  max-width: 560px;
}

/* 4-FEATURE BENTO ARCHITECTURE GRID */
.bento-features-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px;
  margin-bottom: 20px;
}
.bento-feature-item {
  background: var(--bg-surface);
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-md);
  padding: 15px 16px;
  display: flex;
  flex-direction: column;
  gap: 8px;
  box-shadow: var(--shadow-subtle);
  backdrop-filter: blur(16px);
  -webkit-backdrop-filter: blur(16px);
}
@media (hover: hover) {
  .bento-feature-item:hover {
    border-color: rgba(56, 189, 248, 0.35);
    background: var(--bg-surface-elevated);
  }
}
.bento-item-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}
.bento-icon {
  width: 28px;
  height: 28px;
  border-radius: 7px;
  background: rgba(56, 189, 248, 0.1);
  border: 1px solid rgba(56, 189, 248, 0.22);
  color: var(--cyan);
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}
.bento-metric-tag {
  font-family: var(--font-mono);
  font-size: 11px;
  font-weight: 600;
  color: var(--cyan);
  background: rgba(56, 189, 248, 0.08);
  border: 1px solid rgba(56, 189, 248, 0.18);
  padding: 2px 6px;
  border-radius: 4px;
  font-variant-numeric: tabular-nums;
}
.bento-text strong {
  display: block;
  font-size: 13px;
  font-weight: 700;
  color: var(--text-primary);
  margin-bottom: 3px;
}
.bento-text p {
  font-size: 12px;
  color: var(--text-muted);
  line-height: 1.45;
  margin: 0;
}

/* DISCORD COMMUNITY SUPPORT CTA */
.discord-card-btn {
  display: flex;
  align-items: center;
  gap: 14px;
  padding: 14px 18px;
  border-radius: var(--radius-md);
  background: linear-gradient(135deg, rgba(88, 101, 242, 0.16) 0%, rgba(71, 82, 196, 0.1) 100%);
  border: 1px solid rgba(88, 101, 242, 0.4);
  color: var(--text-primary);
  text-decoration: none;
  margin-bottom: 20px;
  box-shadow: var(--shadow-subtle);
  backdrop-filter: blur(12px);
  -webkit-backdrop-filter: blur(12px);
}
@media (hover: hover) {
  .discord-card-btn:hover {
    background: linear-gradient(135deg, rgba(88, 101, 242, 0.26) 0%, rgba(71, 82, 196, 0.18) 100%);
    border-color: rgba(88, 101, 242, 0.68);
  }
}
.discord-icon-box {
  width: 38px;
  height: 38px;
  border-radius: 10px;
  background: rgba(88, 101, 242, 0.22);
  border: 1px solid rgba(88, 101, 242, 0.45);
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}
.discord-icon {
  fill: #818cf8;
}
.discord-text {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}
.discord-text strong {
  font-size: 13.5px;
  font-weight: 700;
  color: #fff;
}
.discord-text small {
  font-size: 11.5px;
  color: #a5b4fc;
}
.discord-online-badge {
  font-family: var(--font-mono);
  font-size: 11px;
  font-weight: 700;
  padding: 4px 9px;
  border-radius: 999px;
  background: var(--green-soft);
  color: #34d399;
  border: 1px solid rgba(16, 185, 129, 0.35);
  letter-spacing: 0.04em;
  flex-shrink: 0;
}

/* SLA & SECURITY BAR */
.sla-row {
  display: flex;
  flex-wrap: wrap;
  gap: 18px;
  font-size: 12px;
  color: var(--text-muted);
  align-items: center;
  border-top: 1px solid var(--border-subtle);
  padding-top: 16px;
}
.sla-item {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  color: var(--cyan);
}
.sla-item strong {
  color: var(--text-secondary);
  font-weight: 600;
}

/* ==========================================================================
   RIGHT COLUMN: AUTHENTICATION CARD (CLOUD SAAS CONSOLE)
   ========================================================================== */
.login-card {
  position: relative;
  width: 100%;
  max-width: 450px;
  margin-left: auto;
  background: var(--bg-surface);
  border: 1px solid rgba(255, 255, 255, 0.11);
  border-radius: var(--radius-xl);
  padding: 32px 30px;
  box-shadow: var(--shadow-card);
  backdrop-filter: blur(24px) saturate(160%);
  -webkit-backdrop-filter: blur(24px) saturate(160%);
  display: flex;
  flex-direction: column;
}
.login-card::before {
  content: '';
  position: absolute;
  top: 0;
  left: 24px;
  right: 24px;
  height: 1px;
  background: linear-gradient(90deg, transparent, rgba(56, 189, 248, 0.5), transparent);
  pointer-events: none;
}

.login-card-header {
  margin-bottom: 20px;
  text-align: left;
  display: flex;
  align-items: center;
  gap: 14px;
}
.login-logo {
  width: 44px;
  height: 44px;
  border-radius: 12px;
  background: linear-gradient(135deg, rgba(14, 165, 233, 0.18) 0%, rgba(37, 99, 235, 0.22) 100%);
  border: 1px solid rgba(56, 189, 248, 0.35);
  color: var(--cyan);
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  box-shadow: 0 4px 16px rgba(14, 165, 233, 0.18);
}
.login-header-text {
  min-width: 0;
}
.login-title {
  font-size: 19px;
  font-weight: 800;
  color: var(--text-primary);
  letter-spacing: -0.02em;
  margin-bottom: 3px;
}
.login-subtitle {
  font-size: 12.5px;
  color: var(--text-muted);
  line-height: 1.4;
}

/* SEGMENTED TABS */
.auth-tabs {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 4px;
  margin-bottom: 20px;
  background: rgba(5, 8, 17, 0.65);
  padding: 4px;
  border-radius: 10px;
  border: 1px solid var(--border-subtle);
}
.auth-tab-btn {
  position: relative;
  min-height: 40px;
  padding: 9px 12px;
  background: transparent;
  border: 1px solid transparent;
  color: var(--text-muted);
  font-size: 12.5px;
  font-weight: 700;
  border-radius: 7px;
  cursor: pointer;
  transition: color 0.18s ease, background-color 0.18s ease, border-color 0.18s ease;
  font-family: inherit;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 7px;
}
.auth-tab-btn:hover:not([aria-selected="true"]) {
  color: var(--text-primary);
  background: rgba(255, 255, 255, 0.03);
}
.auth-tab-btn[aria-selected="true"],
.auth-tab-btn.active {
  background: rgba(56, 189, 248, 0.14);
  color: #7dd3fc;
  border-color: rgba(56, 189, 248, 0.35);
  box-shadow: 0 2px 10px rgba(0, 0, 0, 0.25);
}
.auth-tab-btn[aria-selected="true"]::after,
.auth-tab-btn.active::after {
  content: '';
  position: absolute;
  left: 16px;
  right: 16px;
  bottom: 2px;
  border-block-end: 2px solid var(--cyan);
}

/* ALERT BANNER */
.login-alert {
  padding: 11px 14px;
  border-radius: var(--radius-sm);
  font-size: 12.5px;
  font-weight: 600;
  margin-bottom: 16px;
  text-align: left;
  line-height: 1.45;
  display: flex;
  align-items: flex-start;
  gap: 9px;
}
.login-alert-icon {
  margin-top: 1px;
  flex-shrink: 0;
}
.login-alert.error {
  background: var(--red-soft);
  border: 1px solid rgba(239, 68, 68, 0.4);
  color: #fca5a5;
}
.login-alert.success {
  background: var(--green-soft);
  border: 1px solid rgba(16, 185, 129, 0.4);
  color: #6ee7b7;
}

/* TRIAL CALLOUT */
.trial-callout-badge {
  background: linear-gradient(135deg, rgba(245, 158, 11, 0.12) 0%, rgba(234, 88, 12, 0.1) 100%);
  border: 1px solid rgba(245, 158, 11, 0.32);
  border-radius: var(--radius-sm);
  padding: 10px 12px;
  font-size: 12px;
  color: #fde68a;
  text-align: left;
  margin-bottom: 16px;
  display: flex;
  align-items: center;
  gap: 10px;
  line-height: 1.4;
}
.trial-callout-icon {
  color: #fbbf24;
  flex-shrink: 0;
}

/* FORM CONTROLS */
.form-row {
  text-align: left;
  margin-bottom: 14px;
}
.form-row label {
  display: flex;
  justify-content: space-between;
  align-items: center;
  font-size: 11px;
  font-weight: 700;
  color: var(--text-secondary);
  margin-bottom: 6px;
  letter-spacing: 0.04em;
  text-transform: uppercase;
}
.label-hint {
  font-size: 11px;
  color: var(--text-muted);
  font-weight: 500;
  text-transform: none;
  letter-spacing: 0;
}
.input-wrap {
  position: relative;
  display: flex;
  align-items: center;
}
.input-wrap input {
  width: 100%;
  padding: 11px 14px 11px 38px;
  background: var(--bg-input);
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-sm);
  color: var(--text-primary);
  font-size: 14px;
  font-family: inherit;
  outline: none;
  transition: border-color 0.18s ease, box-shadow 0.18s ease, background-color 0.18s ease;
}
.input-wrap input::placeholder {
  color: var(--text-dim);
}
@media (hover: hover) {
  .input-wrap input:hover {
    border-color: var(--border-strong);
  }
}
.input-wrap input:focus {
  border-color: var(--border-focus);
  background: rgba(8, 13, 24, 0.96);
  box-shadow: 0 0 0 3px rgba(56, 189, 248, 0.16);
}
.input-wrap input.input-valid {
  border-color: rgba(16, 185, 129, 0.6);
  box-shadow: 0 0 0 3px rgba(16, 185, 129, 0.12);
}
.input-wrap input.input-invalid {
  border-color: rgba(239, 68, 68, 0.72);
  box-shadow: 0 0 0 3px rgba(239, 68, 68, 0.14);
}
.input-icon {
  position: absolute;
  left: 12px;
  top: 50%;
  transform: translateY(-50%);
  color: var(--text-dim);
  pointer-events: none;
  display: flex;
  align-items: center;
  justify-content: center;
}
.field-error {
  margin-top: 5px;
  font-size: 11.5px;
  font-weight: 600;
  color: #fca5a5;
  line-height: 1.35;
}
.input-wrap input.key-input {
  font-family: var(--font-mono);
  text-transform: uppercase;
  letter-spacing: 0.03em;
}
.password-input-wrap input {
  padding-right: 44px;
}
.password-toggle-btn {
  position: absolute;
  right: 5px;
  top: 50%;
  transform: translateY(-50%);
  min-width: 34px;
  min-height: 34px;
  background: transparent;
  border: none;
  color: var(--text-muted);
  cursor: pointer;
  border-radius: 6px;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: color 0.15s ease, background-color 0.15s ease;
}
.password-toggle-btn:hover {
  color: var(--text-primary);
  background: rgba(255, 255, 255, 0.06);
}

/* REMEMBER SWITCH */
.check-row {
  display: flex;
  align-items: center;
  gap: 10px;
  min-height: 32px;
  font-size: 12.5px;
  color: var(--text-secondary);
  cursor: pointer;
  margin: 14px 0 18px;
  user-select: none;
  text-align: left;
}
.check-row input[type="checkbox"] {
  -webkit-appearance: none;
  appearance: none;
  width: 36px;
  height: 20px;
  min-width: 36px;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.12);
  border: 1px solid rgba(255, 255, 255, 0.16);
  position: relative;
  cursor: pointer;
  transition: background-color 0.2s ease, border-color 0.2s ease;
  flex-shrink: 0;
}
.check-row input[type="checkbox"]::after {
  content: '';
  position: absolute;
  left: 2px;
  top: 50%;
  transform: translateY(-50%);
  width: 14px;
  height: 14px;
  border-radius: 50%;
  background: #fff;
  transition: left 0.2s ease, background-color 0.2s ease;
}
.check-row input[type="checkbox"]:checked {
  background: var(--cyan);
  border-color: var(--cyan);
}
.check-row input[type="checkbox"]:checked::after {
  left: calc(100% - 16px);
  background: #04101e;
}

/* PRIMARY SUBMIT CTA */
button.primary-cta {
  width: 100%;
  min-height: 44px;
  padding: 12px 16px;
  background: linear-gradient(135deg, #0ea5e9 0%, #2563eb 100%);
  border: 1px solid rgba(56, 189, 248, 0.45);
  border-radius: var(--radius-sm);
  color: #fff;
  font-size: 13.5px;
  font-weight: 700;
  font-family: inherit;
  cursor: pointer;
  letter-spacing: 0.01em;
  box-shadow: 0 4px 16px rgba(14, 165, 233, 0.3), inset 0 1px 0 rgba(255, 255, 255, 0.18);
  transition: background 0.2s ease, border-color 0.2s ease, box-shadow 0.2s ease;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
}
button.primary-cta:hover:not(:disabled) {
  background: linear-gradient(135deg, #38bdf8 0%, #3b82f6 100%);
  box-shadow: 0 8px 24px rgba(14, 165, 233, 0.42), inset 0 1px 0 rgba(255, 255, 255, 0.22);
}
button.primary-cta.is-success {
  background: linear-gradient(135deg, #10b981 0%, #059669 100%);
  border-color: rgba(16, 185, 129, 0.6);
  box-shadow: 0 0 24px rgba(16, 185, 129, 0.45);
}
button.primary-cta:disabled {
  opacity: 0.72;
  cursor: not-allowed;
}
.btn-icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}

/* FOOTER ROLE & HELP GUIDE */
.login-footer-info {
  margin-top: 20px;
  padding-top: 16px;
  border-top: 1px solid var(--border-subtle);
  font-size: 11.5px;
  color: var(--text-muted);
  line-height: 1.65;
  text-align: left;
  display: grid;
  gap: 4px;
}
.login-footer-item {
  display: flex;
  align-items: baseline;
  gap: 6px;
}
.login-footer-item::before {
  content: '•';
  color: var(--cyan);
  font-weight: 700;
}
.login-footer-info code {
  background: var(--cyan-soft);
  border: 1px solid rgba(56, 189, 248, 0.22);
  padding: 1px 6px;
  border-radius: 4px;
  color: var(--cyan);
  font-family: var(--font-mono);
  font-size: 11px;
  font-variant-numeric: tabular-nums;
}
.login-footer-info a {
  color: var(--cyan);
  text-decoration: none;
  font-weight: 600;
}
@media (hover: hover) {
  .login-footer-info a:hover {
    text-decoration: underline;
  }
}

/* ==========================================================================
   OPT-IN MOTION (RESPECTS PREFERS-REDUCED-MOTION WITHOUT ANIMATION BREAKS)
   ========================================================================== */
@media (prefers-reduced-motion: no-preference) {
  .cosmic-bg-video {
    transition: opacity 0.8s ease;
    will-change: transform;
  }
  .cosmic-nebula-orb.orb-cyan {
    animation: auroraFloat 20s ease-in-out infinite alternate;
  }
  .cosmic-nebula-orb.orb-purple {
    animation: auroraFloat 24s ease-in-out infinite alternate-reverse;
  }
  .server-pulse-tag.is-online .pulse-circle::after {
    opacity: 0.85;
    animation: sonarPulse 2.2s ease-out infinite;
  }
  .kbot-showcase-col {
    animation: fadeUpIn 0.4s cubic-bezier(0.16, 1, 0.3, 1) both;
  }
  .login-card {
    animation: fadeUpIn 0.45s cubic-bezier(0.16, 1, 0.3, 1) both;
  }
  .bento-feature-item {
    transition: border-color 0.2s ease, transform 0.2s ease, background-color 0.2s ease;
  }
  .discord-card-btn {
    transition: background 0.2s cubic-bezier(0.16, 1, 0.3, 1), border-color 0.2s ease, transform 0.2s cubic-bezier(0.16, 1, 0.3, 1);
  }
  @media (hover: hover) {
    .bento-feature-item:hover {
      transform: translateY(-2px);
    }
    .discord-card-btn:hover {
      transform: translateY(-2px);
    }
    button.primary-cta:hover:not(:disabled) {
      transform: translateY(-1px);
    }
  }
  button.primary-cta:active:not(:disabled) {
    transform: translateY(0) scale(0.99);
  }
  .btn-spinner {
    animation: spin 0.9s linear infinite;
  }
}

@media (prefers-reduced-motion: reduce) {
  .cosmic-bg-video,
  .cosmic-starfield-canvas,
  .pulse-circle::after {
    display: none;
  }
}

/* ==========================================================================
   RESPONSIVE DESIGN: PROACTIVE MOBILE & TABLET EXPERIENCE
   ========================================================================== */
@media (max-width: 960px) {
  .portal-topbar {
    padding: 14px 16px 0;
  }
  .kbot-portal-main {
    padding: 16px 14px 28px;
    align-items: flex-start;
  }
  .kbot-portal-container {
    grid-template-columns: 1fr;
    gap: 20px;
    max-width: 480px;
  }
  /* Đặt Card Đăng Nhập lên đầu tiên trên Mobile để không phải cuộn trang */
  .login-card {
    order: 1;
    margin: 0 auto;
    max-width: 100%;
    padding: 24px 20px;
  }
  /* Giữ lại thông tin tính năng & Discord bên dưới dạng gọn thay vì xóa bỏ */
  .kbot-showcase-col {
    order: 2;
    padding: 4px 2px 0;
  }
  .showcase-headline {
    font-size: 22px;
  }
  .showcase-desc {
    font-size: 13px;
    margin-bottom: 16px;
  }
  .bento-features-grid {
    grid-template-columns: 1fr 1fr;
    gap: 8px;
  }
  .bento-feature-item {
    padding: 12px;
  }
  .input-wrap input {
    font-size: max(1rem, 16px);
  }
}

@media (max-width: 768px) {
  /* Giảm chi phí GPU và render video trên thiết bị di động */
  .cosmic-bg-video,
  .cosmic-nebula-orb.orb-emerald {
    display: none;
  }
  .cosmic-nebula-orb {
    filter: blur(48px);
  }
  .login-card,
  .bento-feature-item,
  .discord-card-btn {
    backdrop-filter: none;
    -webkit-backdrop-filter: none;
  }
  .login-card {
    background: rgba(12, 18, 32, 0.96);
  }
  .bento-feature-item {
    background: rgba(12, 18, 32, 0.92);
  }
}

@media (max-width: 480px) {
  .portal-topbar {
    padding: 12px 12px 0;
    flex-wrap: wrap;
    row-gap: 8px;
  }
  .topbar-discord-link {
    min-width: 44px;
    min-height: 44px;
    justify-content: center;
    padding: 6px;
  }
  .topbar-discord-link-text {
    position: absolute;
    clip-path: inset(50%);
    overflow: hidden;
    width: 1px;
    height: 1px;
    margin: -1px;
    padding: 0;
    border: 0;
    white-space: nowrap;
  }
  .kbot-portal-main {
    padding: 12px 10px 24px;
  }
  .login-card {
    padding: 20px 16px;
    border-radius: 16px;
  }
  .login-title {
    font-size: 17.5px;
  }
  .auth-tab-btn {
    min-height: 46px;
  }
  .input-wrap input {
    padding: 12px 12px 12px 36px;
  }
  .password-input-wrap input {
    padding-right: 48px;
  }
  .password-toggle-btn {
    right: 4px;
    min-width: 44px;
    min-height: 44px;
  }
  button.primary-cta {
    min-height: 48px;
    font-size: 14px;
  }
  .bento-features-grid {
    grid-template-columns: 1fr;
  }
  .sla-row {
    gap: 10px 14px;
    font-size: 11px;
  }
}

@media (max-width: 360px) {
  .portal-topbar {
    padding: 10px 10px 0;
  }
  .topbar-brand-badge {
    font-size: 11px;
    padding: 5px 10px;
  }
  .login-card {
    padding: 18px 12px;
  }
  .auth-tab-btn {
    font-size: 12.5px;
    padding: 8px 6px;
    gap: 5px;
  }
}

@media (pointer: coarse) {
  .topbar-discord-link,
  .password-toggle-btn {
    min-width: 44px;
    min-height: 44px;
  }
  .auth-tab-btn,
  button.primary-cta,
  .check-row {
    min-height: 44px;
  }
}

button:focus-visible,
input:focus-visible,
.input-wrap input:focus-visible,
a:focus-visible,
[tabindex]:focus-visible {
  outline: 2px solid var(--cyan);
  outline-offset: 2px;
}
</style>
</head>
<body>
<!-- BACKGROUND STAGE -->
<div class="cosmic-login-stage" aria-hidden="true">
  <video id="publicGalaxyVideo" class="cosmic-bg-video" loop muted playsinline preload="metadata">
    <source src="https://assets.mixkit.co/videos/preview/mixkit-stars-in-space-1610-large.mp4" type="video/mp4">
  </video>
  <div class="cosmic-nebula-orb orb-cyan"></div>
  <div class="cosmic-nebula-orb orb-purple"></div>
  <div class="cosmic-nebula-orb orb-emerald"></div>
  <canvas id="publicStarfieldCanvas" class="cosmic-starfield-canvas"></canvas>
  <div class="cosmic-vignette-overlay"></div>
</div>

<!-- ENTERPRISE TOPBAR -->
<header class="portal-topbar">
  <a href="/" class="portal-brand">
    <span class="portal-brand-mark" aria-hidden="true">
      <svg class="ui-icon" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <path d="M3 7l4.5 4.5L12 5l4.5 6.5L21 7l-2 11H5L3 7z"/>
        <path d="M6 21h12"/>
      </svg>
    </span>
    <span class="portal-brand-name">
      KBOT SENTINEL
      <span class="portal-brand-tier">CLOUD SAAS</span>
    </span>
  </a>
  <div class="portal-topbar-right">
    <span id="serverStatusPill" class="server-pulse-tag is-checking" role="status" aria-live="polite">
      <span class="pulse-circle" aria-hidden="true"></span>
      <span id="serverStatusText">Đang kiểm tra trạng thái...</span>
    </span>
    <a href="https://discord.gg/mJWX5Xp3z" target="_blank" rel="noopener noreferrer" class="topbar-discord-link" title="Discord Hỗ Trợ 24/7">
      <svg class="ui-icon" viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
      </svg>
      <span class="topbar-discord-link-text">Discord Hỗ Trợ</span>
    </a>
  </div>
</header>

<!-- MAIN SPLIT VIEW -->
<main class="kbot-portal-main">
  <div class="kbot-portal-container">
    <!-- CỘT TRÁI: SAAS & FLEET SHOWCASE -->
    <div class="kbot-showcase-col">
      <div class="brand-pill-row">
        <span class="brand-tag">
          <svg class="ui-icon" viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>
          </svg>
          <span>KBOT SENTINEL • ENTERPRISE</span>
        </span>
        <span class="arch-tag">
          <svg class="ui-icon" viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/>
          </svg>
          <span>RENDER &amp; CLOUD CLUSTER</span>
        </span>
      </div>

      <h1 class="showcase-headline">
        Nền Tảng Thuê Bot AFK KingMC<br>
        <span class="gradient-headline">Tự Động &amp; Bất Tử Đám Mây</span>
      </h1>

      <p class="showcase-desc">
        Giải pháp cắm chuột AFK đám mây chuyên nghiệp số 1 dành riêng cho cụm máy chủ KingMC. Không cần mở máy tính, tự động thay totem, tự ăn, tự cất đồ và chống kick máy chủ tuyệt đối.
      </p>

      <!-- NÚT DISCORD HỖ TRỢ 24/7 -->
      <a href="https://discord.gg/mJWX5Xp3z" target="_blank" rel="noopener noreferrer" class="discord-card-btn" title="Tham gia Discord Hỗ Trợ 24/7">
        <div class="discord-icon-box" aria-hidden="true">
          <svg class="discord-icon" viewBox="0 0 24 24" width="22" height="22" aria-hidden="true">
            <path d="M20.317 4.37a19.791 19.791 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.25.077.077 0 0 0-.079-.037A19.736 19.736 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 0 0 .031.057 19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028 14.09 14.09 0 0 0 1.226-1.994.076.076 0 0 0-.041-.106 13.107 13.107 0 0 1-1.872-.892.077.077 0 0 1-.008-.128 10.2 10.2 0 0 0 .372-.292.074.074 0 0 1 .077-.01c3.929 1.793 8.18 1.793 12.061 0a.074.074 0 0 1 .078.01c.12.098.246.198.373.292a.077.077 0 0 1-.006.127 12.299 12.299 0 0 1-1.873.894.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028 19.839 19.839 0 0 0 6.002-3.03.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.028zM8.02 15.33c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.956-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.956 2.418-2.157 2.418zm7.975 0c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.955-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.946 2.418-2.157 2.418z"/>
          </svg>
        </div>
        <div class="discord-text">
          <strong>Gia Nhập Cộng Đồng Discord Hỗ Trợ 24/7</strong>
          <small>Mua Key gia hạn, nhận Giftcode khuyến mãi &amp; trợ giúp kỹ thuật</small>
        </div>
        <span class="discord-online-badge">ONLINE</span>
      </a>

      <!-- 4 TÍNH NĂNG ĐỈNH CAO BENTO -->
      <div class="bento-features-grid">
        <div class="bento-feature-item">
          <div class="bento-item-head">
            <span class="bento-icon" aria-hidden="true">
              <svg class="ui-icon" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/>
              </svg>
            </span>
            <span class="bento-metric-tag">&lt; 50ms REFLEX</span>
          </div>
          <div class="bento-text">
            <strong>Auto Totem Bất Tử</strong>
            <p>Tự động trang bị totem tay phụ khi máu &lt; 5 tim, chống quái cắn và rơi vực.</p>
          </div>
        </div>
        <div class="bento-feature-item">
          <div class="bento-item-head">
            <span class="bento-icon" aria-hidden="true">
              <svg class="ui-icon" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                <path d="M22 12h-4l-3 9L9 3l-3 9H2"/>
              </svg>
            </span>
            <span class="bento-metric-tag">AUTO VITALS</span>
          </div>
          <div class="bento-text">
            <strong>Auto Ăn &amp; Chống Đói</strong>
            <p>Tự tìm bánh mì/thịt trong túi đồ ăn khi đói, đảm bảo hồi máu liên tục.</p>
          </div>
        </div>
        <div class="bento-feature-item">
          <div class="bento-item-head">
            <span class="bento-icon" aria-hidden="true">
              <svg class="ui-icon" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
              </svg>
            </span>
            <span class="bento-metric-tag">ANTI-AFK KICK</span>
          </div>
          <div class="bento-text">
            <strong>Auto Chat &amp; Anti-AFK</strong>
            <p>Lập lịch rao bán shop và vi chuyển động thông minh chống kick máy chủ.</p>
          </div>
        </div>
        <div class="bento-feature-item">
          <div class="bento-item-head">
            <span class="bento-icon" aria-hidden="true">
              <svg class="ui-icon" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                <circle cx="12" cy="12" r="10"/>
                <polyline points="12 6 12 12 16 14"/>
              </svg>
            </span>
            <span class="bento-metric-tag">CRON SCHEDULER</span>
          </div>
          <div class="bento-text">
            <strong>Hẹn Giờ Bật/Tắt</strong>
            <p>Cài đặt lịch bật tắt theo giờ cố định hoặc chu kỳ lặp như người chơi thật.</p>
          </div>
        </div>
      </div>

      <!-- CAM KẾT SLA -->
      <div class="sla-row">
        <div class="sla-item">
          <svg class="ui-icon" viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>
            <path d="m9 12 2 2 4-4"/>
          </svg>
          <strong>99.9% Uptime Cloud</strong>
        </div>
        <div class="sla-item">
          <svg class="ui-icon" viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <rect x="3" y="11" width="18" height="11" rx="2" ry="2"/>
            <path d="M7 11V7a5 5 0 0 1 10 0v4"/>
          </svg>
          <strong>Mã Hóa Chuẩn Scrypt Quân Sự</strong>
        </div>
        <div class="sla-item">
          <svg class="ui-icon" viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <path d="M21 12a9 9 0 0 0-9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/>
            <path d="M3 3v5h5"/>
            <path d="M3 12a9 9 0 0 0 9 9 9.75 9.75 0 0 0 6.74-2.74L21 16"/>
            <path d="M16 16h5v5"/>
          </svg>
          <strong>Tự Reconnect Sau Bảo Trì</strong>
        </div>
      </div>
    </div>

    <!-- CỘT PHẢI: CỔNG ĐĂNG NHẬP / ĐĂNG KÝ -->
    <div class="login-card">
      <div class="login-card-header">
        <div class="login-logo" aria-hidden="true">
          <svg class="ui-icon" viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>
            <path d="m9 12 2 2 4-4"/>
          </svg>
        </div>
        <div class="login-header-text">
          <h2 class="login-title">CỔNG BẢO MẬT KBOT</h2>
          <div class="login-subtitle">Hệ Thống Thuê Bot AFK KingMC Thương Mại Cao Cấp</div>
        </div>
      </div>

      <!-- SEGMENTED TABS -->
      <div class="auth-tabs" role="tablist" aria-label="Chế độ xác thực">
        <button type="button" role="tab" aria-selected="true" aria-controls="publicLoginForm" tabindex="0" class="auth-tab-btn active" id="tabPublicLoginBtn" data-auth-tab="login">
          <svg class="ui-icon" viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4"/>
            <polyline points="10 17 15 12 10 7"/>
            <line x1="15" y1="12" x2="3" y2="12"/>
          </svg>
          <span>Đăng Nhập</span>
        </button>
        <button type="button" role="tab" aria-selected="false" aria-controls="publicRegisterForm" tabindex="-1" class="auth-tab-btn" id="tabPublicRegisterBtn" data-auth-tab="register">
          <svg class="ui-icon" viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <path d="M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/>
            <circle cx="8.5" cy="7" r="4"/>
            <line x1="20" y1="8" x2="20" y2="14"/>
            <line x1="23" y1="11" x2="17" y2="11"/>
          </svg>
          <span>Đăng Ký Tài Khoản</span>
        </button>
      </div>

      <div id="publicFieldAnnouncer" class="visually-hidden" aria-live="polite" aria-atomic="true"></div>
      <div id="publicLoginAlert" class="login-alert hidden" role="alert" aria-atomic="true" hidden></div>

      <!-- FORM 1: ĐĂNG NHẬP -->
      <form id="publicLoginForm" role="tabpanel" aria-labelledby="tabPublicLoginBtn" novalidate>
        <div class="form-row">
          <label for="publicUsername"><span>TÊN ĐĂNG NHẬP</span></label>
          <div class="input-wrap">
            <span class="input-icon" aria-hidden="true">
              <svg class="ui-icon" viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/>
                <circle cx="12" cy="7" r="4"/>
              </svg>
            </span>
            <input id="publicUsername" name="username" type="text" autocomplete="username" autocorrect="off" autocapitalize="none" spellcheck="false" enterkeyhint="next" placeholder="Nhập admin hoặc username thuê..." aria-invalid="false" required>
          </div>
          <p id="publicUsernameErr" class="field-error" hidden></p>
        </div>
        <div class="form-row">
          <label for="publicPassword"><span>MẬT KHẨU</span></label>
          <div class="input-wrap password-input-wrap">
            <span class="input-icon" aria-hidden="true">
              <svg class="ui-icon" viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                <rect x="3" y="11" width="18" height="11" rx="2" ry="2"/>
                <path d="M7 11V7a5 5 0 0 1 10 0v4"/>
              </svg>
            </span>
            <input id="publicPassword" name="password" type="password" autocomplete="current-password" enterkeyhint="next" placeholder="Nhập mật khẩu truy cập..." aria-invalid="false" required>
            <button type="button" class="password-toggle-btn" data-toggle-target="publicPassword" aria-pressed="false" aria-label="Hiện mật khẩu">
              <svg class="ui-icon icon-eye" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/>
                <circle cx="12" cy="12" r="3"/>
              </svg>
              <svg class="ui-icon icon-eye-off hidden" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/>
                <line x1="1" y1="1" x2="23" y2="23"/>
              </svg>
            </button>
          </div>
          <p id="publicPasswordErr" class="field-error" hidden></p>
        </div>
        <div class="form-row">
          <label for="publicLicenseKey">
            <span>MÃ KEY GIA HẠN</span>
            <span class="label-hint">(Nếu có / Tùy chọn)</span>
          </label>
          <div class="input-wrap">
            <span class="input-icon" aria-hidden="true">
              <svg class="ui-icon" viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                <circle cx="7.5" cy="15.5" r="5.5"/>
                <path d="m21 2-9.6 9.6"/>
                <path d="m15.5 7.5 3 3L22 7l-3-3"/>
              </svg>
            </span>
            <input id="publicLicenseKey" name="licenseKey" class="key-input" type="text" autocomplete="off" autocorrect="off" autocapitalize="none" spellcheck="false" enterkeyhint="done" placeholder="Nhập mã Key để tự mở khóa / cộng thêm ngày thuê...">
          </div>
        </div>
        <label class="check-row" for="publicRememberMe">
          <input id="publicRememberMe" name="rememberMe" type="checkbox" checked>
          <span>Ghi nhớ phiên đăng nhập (30 ngày)</span>
        </label>
        <button id="publicSubmitBtn" type="submit" class="primary-cta">
          <span class="btn-icon" aria-hidden="true">
            <svg class="ui-icon" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
              <path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4"/>
              <polyline points="10 17 15 12 10 7"/>
              <line x1="15" y1="12" x2="3" y2="12"/>
            </svg>
          </span>
          <span class="btn-label">ĐĂNG NHẬP VÀO HỆ THỐNG</span>
        </button>
      </form>

      <!-- FORM 2: ĐĂNG KÝ -->
      <form id="publicRegisterForm" class="hidden" role="tabpanel" aria-labelledby="tabPublicRegisterBtn" hidden novalidate>
        <div class="trial-callout-badge" id="publicTrialCalloutBadge">
          <span class="trial-callout-icon" aria-hidden="true">
            <svg class="ui-icon" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
              <polyline points="20 12 20 22 4 22 4 12"/>
              <rect x="2" y="7" width="20" height="5"/>
              <line x1="12" y1="22" x2="12" y2="7"/>
              <path d="M12 7H7.5a2.5 2.5 0 0 1 0-5C11 2 12 7 12 7z"/>
              <path d="M12 7h4.5a2.5 2.5 0 0 0 0-5C13 2 12 7 12 7z"/>
            </svg>
          </span>
          <div id="publicTrialCalloutText"><strong>ĐẶC QUYỀN MỚI:</strong> Nhận ngay <strong>1 NGÀY DÙNG THỬ MIỄN PHÍ</strong> sau khi tạo tài khoản thành công!</div>
        </div>
        <div class="form-row">
          <label for="regUsername"><span>TÊN ĐĂNG NHẬP MỚI</span></label>
          <div class="input-wrap">
            <span class="input-icon" aria-hidden="true">
              <svg class="ui-icon" viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/>
                <circle cx="12" cy="7" r="4"/>
              </svg>
            </span>
            <input id="regUsername" name="username" type="text" autocomplete="username" autocorrect="off" autocapitalize="none" spellcheck="false" enterkeyhint="next" minlength="3" maxlength="32" pattern="[a-zA-Z0-9_]{3,32}" placeholder="Tên tài khoản (3 - 32 ký tự)..." aria-invalid="false" required>
          </div>
          <p id="regUsernameErr" class="field-error" hidden></p>
        </div>
        <div class="form-row">
          <label for="regPassword"><span>MẬT KHẨU MỚI</span></label>
          <div class="input-wrap password-input-wrap">
            <span class="input-icon" aria-hidden="true">
              <svg class="ui-icon" viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                <rect x="3" y="11" width="18" height="11" rx="2" ry="2"/>
                <path d="M7 11V7a5 5 0 0 1 10 0v4"/>
              </svg>
            </span>
            <input id="regPassword" name="password" type="password" autocomplete="new-password" enterkeyhint="next" minlength="6" placeholder="Tối thiểu 6 ký tự (chữ hoặc số, phân biệt hoa thường)..." aria-invalid="false" required>
            <button type="button" class="password-toggle-btn" data-toggle-target="regPassword" aria-pressed="false" aria-label="Hiện mật khẩu">
              <svg class="ui-icon icon-eye" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/>
                <circle cx="12" cy="12" r="3"/>
              </svg>
              <svg class="ui-icon icon-eye-off hidden" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/>
                <line x1="1" y1="1" x2="23" y2="23"/>
              </svg>
            </button>
          </div>
          <p id="regPasswordErr" class="field-error" hidden></p>
        </div>
        <div class="form-row">
          <label for="regPasswordConfirm"><span>XÁC NHẬN MẬT KHẨU</span></label>
          <div class="input-wrap password-input-wrap">
            <span class="input-icon" aria-hidden="true">
              <svg class="ui-icon" viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                <rect x="3" y="11" width="18" height="11" rx="2" ry="2"/>
                <path d="M7 11V7a5 5 0 0 1 10 0v4"/>
              </svg>
            </span>
            <input id="regPasswordConfirm" name="confirmPassword" type="password" autocomplete="new-password" enterkeyhint="next" minlength="6" placeholder="Nhập lại mật khẩu mới..." aria-invalid="false" required>
            <button type="button" class="password-toggle-btn" data-toggle-target="regPasswordConfirm" aria-pressed="false" aria-label="Hiện mật khẩu xác nhận">
              <svg class="ui-icon icon-eye" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/>
                <circle cx="12" cy="12" r="3"/>
              </svg>
              <svg class="ui-icon icon-eye-off hidden" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/>
                <line x1="1" y1="1" x2="23" y2="23"/>
              </svg>
            </button>
          </div>
          <p id="regPasswordConfirmErr" class="field-error" hidden></p>
        </div>
        <div class="form-row">
          <label for="regLicenseKey">
            <span>MÃ KEY KÍCH HOẠT GÓI THUÊ</span>
            <span id="regLicenseKeyHint" class="label-hint">(Để trống nếu dùng thử)</span>
          </label>
          <div class="input-wrap">
            <span class="input-icon" aria-hidden="true">
              <svg class="ui-icon" viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                <circle cx="7.5" cy="15.5" r="5.5"/>
                <path d="m21 2-9.6 9.6"/>
                <path d="m15.5 7.5 3 3L22 7l-3-3"/>
              </svg>
            </span>
            <input id="regLicenseKey" name="licenseKey" class="key-input" type="text" autocomplete="off" autocorrect="off" autocapitalize="none" spellcheck="false" enterkeyhint="done" placeholder="Để trống để nhận 1 ngày dùng thử miễn phí...">
          </div>
        </div>
        <button id="publicRegSubmitBtn" type="submit" class="primary-cta">
          <span class="btn-icon" aria-hidden="true">
            <svg class="ui-icon" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
              <path d="M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/>
              <circle cx="8.5" cy="7" r="4"/>
              <line x1="20" y1="8" x2="20" y2="14"/>
              <line x1="23" y1="11" x2="17" y2="11"/>
            </svg>
          </span>
          <span class="btn-label">HOÀN TẤT ĐĂNG KÝ VÀ BẮT ĐẦU</span>
        </button>
      </form>

      <div class="login-footer-info">
        <div class="login-footer-item"><span>Quản trị viên: Đăng nhập bằng tài khoản <code>admin</code>.</span></div>
        <div class="login-footer-item"><span>Khách thuê: Sử dụng tài khoản cá nhân để xem bot và điều khiển.</span></div>
        <div class="login-footer-item"><span>Tài khoản hết hạn: Đăng nhập để nạp Key hoặc vượt link nhận +12h miễn phí.</span></div>
        <div class="login-footer-item"><span>Cần trợ giúp? Liên hệ ngay qua <a href="https://discord.gg/mJWX5Xp3z" target="_blank" rel="noopener noreferrer">Discord Hỗ Trợ 24/7</a>.</span></div>
      </div>
    </div>
  </div>
</main>

<!-- VECTOR ICON TEMPLATES FOR DYNAMIC UI STATES -->
<template id="tplIconLogin">
  <svg class="ui-icon" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
    <path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4"/>
    <polyline points="10 17 15 12 10 7"/>
    <line x1="15" y1="12" x2="3" y2="12"/>
  </svg>
</template>
<template id="tplIconRegister">
  <svg class="ui-icon" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
    <path d="M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/>
    <circle cx="8.5" cy="7" r="4"/>
    <line x1="20" y1="8" x2="20" y2="14"/>
    <line x1="23" y1="11" x2="17" y2="11"/>
  </svg>
</template>
<template id="tplIconSpinner">
  <svg class="ui-icon btn-spinner" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true">
    <path d="M21 12a9 9 0 1 1-6.219-8.56"/>
  </svg>
</template>
<template id="tplIconWarn">
  <svg class="ui-icon" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
    <path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"/>
    <line x1="12" y1="9" x2="12" y2="13"/>
    <line x1="12" y1="17" x2="12.01" y2="17"/>
  </svg>
</template>
<template id="tplIconLock">
  <svg class="ui-icon" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
    <rect x="3" y="11" width="18" height="11" rx="2" ry="2"/>
    <path d="M7 11V7a5 5 0 0 1 10 0v4"/>
  </svg>
</template>
<template id="tplIconSuccess">
  <svg class="ui-icon" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
    <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/>
    <polyline points="22 4 12 14.01 9 11.01"/>
  </svg>
</template>

<script>
function cloneTemplateSvg(tplId) {
  const tpl = document.getElementById(tplId);
  if (!tpl || !tpl.content) return null;
  const svg = tpl.content.firstElementChild;
  return svg ? svg.cloneNode(true) : null;
}

function setLoginAlert(type, message, iconTplId) {
  const alertEl = document.getElementById('publicLoginAlert');
  if (!alertEl) return;
  if (!type || !message) {
    alertEl.hidden = true;
    alertEl.className = 'login-alert hidden';
    alertEl.replaceChildren();
    return;
  }
  const tplId = iconTplId || (type === 'success' ? 'tplIconSuccess' : 'tplIconWarn');
  const iconWrap = document.createElement('span');
  iconWrap.className = 'login-alert-icon';
  iconWrap.setAttribute('aria-hidden', 'true');
  const svg = cloneTemplateSvg(tplId);
  if (svg) iconWrap.appendChild(svg);

  const textSpan = document.createElement('span');
  textSpan.textContent = String(message);

  alertEl.replaceChildren(iconWrap, textSpan);
  alertEl.hidden = false;
  alertEl.className = 'login-alert ' + (type === 'success' ? 'success' : 'error');
}

function setSubmitButtonState(btn, state, labelText, idleTplId) {
  if (!btn) return;
  const iconSlot = btn.querySelector('.btn-icon');
  const labelSlot = btn.querySelector('.btn-label');
  if (labelSlot) {
    labelSlot.textContent = String(labelText || '');
  }
  if (iconSlot) {
    let tplId = idleTplId || 'tplIconLogin';
    if (state === 'loading') tplId = 'tplIconSpinner';
    else if (state === 'success') tplId = 'tplIconSuccess';
    const svg = cloneTemplateSvg(tplId);
    iconSlot.replaceChildren(svg || document.createTextNode(''));
  }
  btn.classList.toggle('is-success', state === 'success');
}

function announceFieldError(message) {
  const announcer = document.getElementById('publicFieldAnnouncer');
  if (!announcer) return;
  const text = message ? String(message) : '';
  if (!text) {
    announcer.textContent = '';
    return;
  }
  if (announcer.textContent === text) {
    announcer.textContent = '';
  }
  announcer.textContent = text;
}

function setFieldFeedback(inputEl, errEl, state, message) {
  if (!inputEl) return;
  const prevMessage = errEl ? String(errEl.textContent || '') : '';
  const wasInvalid = inputEl.getAttribute('aria-invalid') === 'true';

  inputEl.classList.toggle('input-valid', state === 'valid');
  inputEl.classList.toggle('input-invalid', state === 'invalid');

  if (state === 'invalid' && message) {
    inputEl.setAttribute('aria-invalid', 'true');
    if (errEl && errEl.id) {
      errEl.textContent = message;
      errEl.hidden = false;
      inputEl.setAttribute('aria-describedby', errEl.id);
    }
    if (!wasInvalid || prevMessage !== message) {
      announceFieldError(message);
    }
  } else {
    inputEl.setAttribute('aria-invalid', 'false');
    if (errEl) {
      errEl.textContent = '';
      errEl.hidden = true;
    }
    inputEl.removeAttribute('aria-describedby');
    if (wasInvalid && prevMessage) {
      announceFieldError('');
    }
  }
}

function switchPublicAuthTab(tab) {
  const isLogin = tab === 'login';
  const loginTabBtn = document.getElementById('tabPublicLoginBtn');
  const regTabBtn = document.getElementById('tabPublicRegisterBtn');
  const loginForm = document.getElementById('publicLoginForm');
  const regForm = document.getElementById('publicRegisterForm');

  if (loginTabBtn) {
    loginTabBtn.classList.toggle('active', isLogin);
    loginTabBtn.setAttribute('aria-selected', isLogin ? 'true' : 'false');
    loginTabBtn.setAttribute('tabindex', isLogin ? '0' : '-1');
  }
  if (regTabBtn) {
    regTabBtn.classList.toggle('active', !isLogin);
    regTabBtn.setAttribute('aria-selected', !isLogin ? 'true' : 'false');
    regTabBtn.setAttribute('tabindex', !isLogin ? '0' : '-1');
  }
  if (loginForm) {
    loginForm.hidden = !isLogin;
    loginForm.classList.toggle('hidden', !isLogin);
  }
  if (regForm) {
    regForm.hidden = isLogin;
    regForm.classList.toggle('hidden', isLogin);
  }

  announceFieldError('');
  setLoginAlert('', '');
}

function togglePublicPass(id, btn) {
  const el = document.getElementById(id);
  if (!el) return;
  const show = el.type === 'password';
  el.type = show ? 'text' : 'password';
  if (btn) {
    btn.setAttribute('aria-pressed', show ? 'true' : 'false');
    const eye = btn.querySelector('.icon-eye');
    const eyeOff = btn.querySelector('.icon-eye-off');
    if (eye) eye.classList.toggle('hidden', show);
    if (eyeOff) eyeOff.classList.toggle('hidden', !show);
  }
}

function validateLoginFields() {
  const uEl = document.getElementById('publicUsername');
  const pEl = document.getElementById('publicPassword');
  const uErr = document.getElementById('publicUsernameErr');
  const pErr = document.getElementById('publicPasswordErr');
  const uVal = uEl ? uEl.value.trim() : '';
  const pVal = pEl ? pEl.value : '';
  let firstInvalid = null;

  if (!uVal) {
    setFieldFeedback(uEl, uErr, 'invalid', 'Vui lòng nhập tên đăng nhập.');
    firstInvalid = firstInvalid || uEl;
  } else {
    setFieldFeedback(uEl, uErr, 'valid', '');
  }

  if (!pVal) {
    setFieldFeedback(pEl, pErr, 'invalid', 'Vui lòng nhập mật khẩu.');
    firstInvalid = firstInvalid || pEl;
  } else {
    setFieldFeedback(pEl, pErr, 'valid', '');
  }

  return { ok: !firstInvalid, firstInvalid };
}

function validateRegisterFields() {
  const uEl = document.getElementById('regUsername');
  const pEl = document.getElementById('regPassword');
  const p2El = document.getElementById('regPasswordConfirm');
  const uErr = document.getElementById('regUsernameErr');
  const pErr = document.getElementById('regPasswordErr');
  const p2Err = document.getElementById('regPasswordConfirmErr');
  const uVal = uEl ? uEl.value.trim() : '';
  const pVal = pEl ? pEl.value : '';
  const p2Val = p2El ? p2El.value : '';
  let firstInvalid = null;

  if (uVal.length < 3 || !/^[a-zA-Z0-9_]{3,32}$/.test(uVal)) {
    setFieldFeedback(
      uEl,
      uErr,
      'invalid',
      'Tên đăng nhập dài 3 - 32 ký tự (chữ, số hoặc dấu gạch dưới _).'
    );
    firstInvalid = firstInvalid || uEl;
  } else {
    setFieldFeedback(uEl, uErr, 'valid', '');
  }

  if (pVal.length < 6) {
    setFieldFeedback(pEl, pErr, 'invalid', 'Mật khẩu phải có ít nhất 6 ký tự.');
    firstInvalid = firstInvalid || pEl;
  } else {
    setFieldFeedback(pEl, pErr, 'valid', '');
  }

  if (!p2Val || pVal !== p2Val || p2Val.length < 6) {
    setFieldFeedback(p2El, p2Err, 'invalid', 'Mật khẩu xác nhận chưa khớp.');
    firstInvalid = firstInvalid || p2El;
  } else {
    setFieldFeedback(p2El, p2Err, 'valid', '');
  }

  return { ok: !firstInvalid, firstInvalid };
}

async function handlePublicLoginSubmit(e) {
  if (e) e.preventDefault();
  const check = validateLoginFields();
  if (!check.ok) {
    setLoginAlert('error', 'Vui lòng kiểm tra lại thông tin đăng nhập.', 'tplIconWarn');
    if (check.firstInvalid) check.firstInvalid.focus();
    return;
  }

  const u = document.getElementById('publicUsername').value.trim();
  const p = document.getElementById('publicPassword').value;
  const k = document.getElementById('publicLicenseKey').value.trim();
  const remember = document.getElementById('publicRememberMe').checked === true;
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
      throw new Error(data.error || 'Tên đăng nhập hoặc mật khẩu không chính xác.');
    }
    if (data.token) {
      try { localStorage.setItem('kingmc_session', data.token); } catch (_) {}
    }
    setLoginAlert('success', data.message || 'Đăng nhập thành công! Đang tải dashboard...', 'tplIconSuccess');
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

async function loadPublicSystemInfo() {
  try {
    const results = await Promise.allSettled([
      fetch('/api/public/system-info', { cache: 'no-store' }),
      fetch('/health', { cache: 'no-store' })
    ]);

    let sysData = null;
    if (results[0].status === 'fulfilled' && results[0].value) {
      try {
        sysData = await results[0].value.json();
      } catch (_) {
        sysData = null;
      }
    }

    let healthData = null;
    if (results[1].status === 'fulfilled' && results[1].value) {
      try {
        healthData = await results[1].value.json();
      } catch (_) {
        healthData = null;
      }
    }

    const sysOk = Boolean(sysData && sysData.ok === true);
    const healthOk = Boolean(healthData && healthData.ok === true);
    const isDegraded = Boolean(healthData && (healthData.degraded === true || healthData.status === 'degraded'));

    if (sysOk) {
      renderTrialCallout(sysData.trialGiftEnabled, sysData.trialDays);
    }

    const totalBots = sysOk ? parseBoundedInt(sysData.totalBots, 10000) : 0;
    const onlineBots = sysOk ? Math.min(parseBoundedInt(sysData.onlineBots, 10000), totalBots || 10000) : 0;

    if (!sysOk && !healthOk) {
      updateServerStatusPill('is-offline', 'Không thể kết nối máy chủ');
    } else if (isDegraded) {
      updateServerStatusPill(
        'is-degraded',
        totalBots > 0
          ? ('Hoạt động giới hạn • ' + onlineBots + '/' + totalBots + ' Bot')
          : 'Hoạt động giới hạn (Bảo trì)'
      );
    } else if (totalBots > 0) {
      updateServerStatusPill('is-online', 'Trực tuyến • ' + onlineBots + '/' + totalBots + ' Bot');
    } else {
      updateServerStatusPill('is-online', 'Hệ thống sẵn sàng • 24/7');
    }
  } catch (_) {
    updateServerStatusPill('is-offline', 'Không thể kết nối máy chủ');
  }
}

function checkUrlSessionErrors() {
  try {
    const params = new URLSearchParams(window.location.search);
    const err = params.get('error') || params.get('reason');
    if (err === 'session_expired' || err === 'expired' || params.has('expired')) {
      setLoginAlert(
        'error',
        'Phiên đăng nhập của bạn đã hết hạn. Vui lòng đăng nhập lại để tiếp tục quản lý bot.',
        'tplIconWarn'
      );
    } else if (err === 'unauthorized' || err === 'forbidden') {
      setLoginAlert('error', 'Bạn cần đăng nhập để truy cập Bảng điều khiển.', 'tplIconLock');
    } else if (err === 'logged_out' || params.has('logged_out')) {
      setLoginAlert('success', 'Bạn đã đăng xuất an toàn khỏi hệ thống.', 'tplIconSuccess');
    }
  } catch (_) {}
}

function setupAuthInteractions() {
  const tabList = document.querySelector('.auth-tabs[role="tablist"]');
  const tabs = tabList ? Array.prototype.slice.call(tabList.querySelectorAll('[role="tab"]')) : [];

  tabs.forEach(function(tabBtn) {
    tabBtn.addEventListener('click', function() {
      const targetTab = tabBtn.getAttribute('data-auth-tab');
      if (targetTab) switchPublicAuthTab(targetTab);
    });
  });

  if (tabList && tabs.length > 0) {
    tabList.addEventListener('keydown', function(e) {
      const currentIdx = tabs.indexOf(document.activeElement);
      if (currentIdx === -1) return;
      let nextIdx = currentIdx;
      if (e.key === 'ArrowRight') nextIdx = (currentIdx + 1) % tabs.length;
      else if (e.key === 'ArrowLeft') nextIdx = (currentIdx - 1 + tabs.length) % tabs.length;
      else if (e.key === 'Home') nextIdx = 0;
      else if (e.key === 'End') nextIdx = tabs.length - 1;
      else return;

      e.preventDefault();
      const targetBtn = tabs[nextIdx];
      const targetTab = targetBtn.getAttribute('data-auth-tab');
      if (targetTab) switchPublicAuthTab(targetTab);
      targetBtn.focus();
    });
  }

  document.querySelectorAll('.password-toggle-btn[data-toggle-target]').forEach(function(btn) {
    btn.addEventListener('click', function() {
      const targetId = btn.getAttribute('data-toggle-target');
      if (targetId) togglePublicPass(targetId, btn);
    });
  });

  const loginForm = document.getElementById('publicLoginForm');
  const regForm = document.getElementById('publicRegisterForm');
  if (loginForm) loginForm.addEventListener('submit', handlePublicLoginSubmit);
  if (regForm) regForm.addEventListener('submit', handlePublicRegisterSubmit);
}

function setupInlineValidation() {
  const pubU = document.getElementById('publicUsername');
  const pubP = document.getElementById('publicPassword');
  const pubUErr = document.getElementById('publicUsernameErr');
  const pubPErr = document.getElementById('publicPasswordErr');

  const regU = document.getElementById('regUsername');
  const regP = document.getElementById('regPassword');
  const regP2 = document.getElementById('regPasswordConfirm');
  const regUErr = document.getElementById('regUsernameErr');
  const regPErr = document.getElementById('regPasswordErr');
  const regP2Err = document.getElementById('regPasswordConfirmErr');

  const regK = document.getElementById('regLicenseKey');
  const pubK = document.getElementById('publicLicenseKey');

  function bindBlurAndFixValidation(el, errEl, checkFn) {
    if (!el) return;
    let touched = false;
    el.addEventListener('blur', function() {
      if (!el.value) {
        setFieldFeedback(el, errEl, '', '');
        return;
      }
      touched = true;
      const res = checkFn();
      setFieldFeedback(el, errEl, res.ok ? 'valid' : 'invalid', res.msg);
    });
    el.addEventListener('input', function() {
      if (!el.value) {
        setFieldFeedback(el, errEl, '', '');
        return;
      }
      const res = checkFn();
      if (res.ok) {
        setFieldFeedback(el, errEl, 'valid', '');
      } else if (touched || el.classList.contains('input-invalid')) {
        setFieldFeedback(el, errEl, 'invalid', res.msg);
      }
    });
  }

  bindBlurAndFixValidation(pubU, pubUErr, function() {
    const ok = pubU.value.trim().length > 0;
    return { ok, msg: ok ? '' : 'Vui lòng nhập tên đăng nhập.' };
  });
  bindBlurAndFixValidation(pubP, pubPErr, function() {
    const ok = pubP.value.length > 0;
    return { ok, msg: ok ? '' : 'Vui lòng nhập mật khẩu.' };
  });

  bindBlurAndFixValidation(regU, regUErr, function() {
    const v = regU.value.trim();
    const ok = /^[a-zA-Z0-9_]{3,32}$/.test(v);
    return {
      ok,
      msg: ok ? '' : 'Tên đăng nhập dài 3 - 32 ký tự (chữ, số hoặc dấu gạch dưới _).'
    };
  });

  if (regP && regP2) {
    let pTouched = false;
    let p2Touched = false;

    const validateRegPass = function(showErr) {
      if (!regP.value) {
        setFieldFeedback(regP, regPErr, '', '');
      } else if (regP.value.length >= 6) {
        setFieldFeedback(regP, regPErr, 'valid', '');
      } else if (showErr || regP.classList.contains('input-invalid')) {
        setFieldFeedback(regP, regPErr, 'invalid', 'Mật khẩu phải có ít nhất 6 ký tự.');
      }
    };

    const validateRegConfirm = function(showErr) {
      if (!regP2.value) {
        setFieldFeedback(regP2, regP2Err, '', '');
      } else if (regP.value === regP2.value && regP2.value.length >= 6) {
        setFieldFeedback(regP2, regP2Err, 'valid', '');
      } else if (showErr || regP2.classList.contains('input-invalid')) {
        setFieldFeedback(regP2, regP2Err, 'invalid', 'Mật khẩu xác nhận chưa khớp.');
      }
    };

    regP.addEventListener('blur', function() {
      pTouched = Boolean(regP.value);
      validateRegPass(pTouched);
      if (regP2.value) validateRegConfirm(p2Touched);
    });
    regP.addEventListener('input', function() {
      validateRegPass(pTouched);
      if (regP2.value) validateRegConfirm(p2Touched);
    });
    regP2.addEventListener('blur', function() {
      p2Touched = Boolean(regP2.value);
      validateRegConfirm(p2Touched);
    });
    regP2.addEventListener('input', function() {
      validateRegConfirm(p2Touched);
    });
  }

  [regK, pubK].forEach(function(el) {
    if (!el) return;
    el.addEventListener('input', function() {
      const upper = el.value.toUpperCase();
      if (el.value === upper) return;
      const start = typeof el.selectionStart === 'number' ? el.selectionStart : null;
      const end = typeof el.selectionEnd === 'number' ? el.selectionEnd : null;
      el.value = upper;
      if (start !== null && end !== null && typeof el.setSelectionRange === 'function') {
        try { el.setSelectionRange(start, end); } catch (_) {}
      }
    });
  });
}

setupAuthInteractions();
checkUrlSessionErrors();
setupInlineValidation();
loadPublicSystemInfo();
window.switchPublicAuthTab = switchPublicAuthTab;
window.togglePublicPass = togglePublicPass;
window.handlePublicLoginSubmit = handlePublicLoginSubmit;
window.handlePublicRegisterSubmit = handlePublicRegisterSubmit;

(function initPublicGalaxyEngine() {
  var canvas = document.getElementById('publicStarfieldCanvas');
  var video = document.getElementById('publicGalaxyVideo');
  var motionQuery = typeof window.matchMedia === 'function'
    ? window.matchMedia('(prefers-reduced-motion: reduce)')
    : { matches: false };

  if (video) {
    const hideVideo = function() {
      video.hidden = true;
    };
    video.addEventListener('error', hideVideo);
    if (typeof video.querySelectorAll === 'function') {
      const sources = video.querySelectorAll('source');
      const lastSource = sources && sources.length ? sources[sources.length - 1] : null;
      if (lastSource && typeof lastSource.addEventListener === 'function') {
        lastSource.addEventListener('error', hideVideo);
      }
    }
  }

  var ctx = canvas ? canvas.getContext('2d') : null;
  var w = 0;
  var h = 0;
  var stars = [];
  var shootingStars = [];
  var rafId = null;
  var isRunning = false;

  function isMobileViewport() {
    var vw = typeof window.innerWidth === 'number' && window.innerWidth > 0 ? window.innerWidth : 1024;
    return /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent) || vw <= 768;
  }

  var isMobile = isMobileViewport();

  function syncVideoPlayback() {
    if (!video) return;
    if (motionQuery.matches || document.hidden || video.hidden || isMobile) {
      if (typeof video.pause === 'function') {
        try { video.pause(); } catch (_) {}
      }
      return;
    }
    video.playbackRate = 0.85;
    video.style.transform = 'translate3d(0px,0px,0) scale(1.02)';
    if (typeof video.play === 'function') {
      video.play().catch(function() {});
    }
  }

  function resize() {
    isMobile = isMobileViewport();
    if (canvas) {
      w = canvas.width = window.innerWidth;
      h = canvas.height = window.innerHeight;
    }
    syncVideoPlayback();
  }

  function initStars() {
    if (stars.length > 0 || !w || !h) return;
    var starCount = isMobile ? 30 : 65;
    for (var i = 0; i < starCount; i++) {
      stars.push({
        x: Math.random() * w,
        y: Math.random() * h,
        z: Math.random() * 2.0 + 0.4,
        r: Math.random() * 1.6 + 0.5,
        a: Math.random() * 0.55 + 0.3,
        da: (Math.random() * 0.014 + 0.004) * (Math.random() < 0.5 ? 1 : -1),
        rgb: Math.random() < 0.45 ? '255,255,255' : (Math.random() < 0.75 ? '224,242,254' : '199,210,254')
      });
    }
  }

  function stopEngine() {
    isRunning = false;
    if (rafId !== null) {
      cancelAnimationFrame(rafId);
      rafId = null;
    }
    if (video && typeof video.pause === 'function') {
      try { video.pause(); } catch (_) {}
    }
    if (ctx && canvas) {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
    }
  }

  function tick() {
    rafId = null;
    if (!isRunning || motionQuery.matches || document.hidden || !ctx) {
      if (motionQuery.matches) stopEngine();
      return;
    }
    ctx.clearRect(0, 0, w, h);
    for (var i = 0; i < stars.length; i++) {
      var s = stars[i];
      s.y -= 0.12 * s.z;
      s.a += s.da;
      if (s.a > 0.95 || s.a < 0.2) s.da = -s.da;
      if (s.y < -12) { s.y = h + 12; s.x = Math.random() * w; }
      var sx = s.x;
      var sy = s.y;
      var rad = s.r * s.z * 0.8;
      var alpha = Math.max(0.18, Math.min(0.95, s.a));
      if (!isMobile && rad > 1.9 && alpha > 0.65) {
        ctx.beginPath();
        ctx.arc(sx, sy, rad * 1.8, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(' + s.rgb + ',' + (alpha * 0.18).toFixed(2) + ')';
        ctx.fill();
      }
      ctx.beginPath();
      ctx.arc(sx, sy, rad, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(' + s.rgb + ',' + alpha + ')';
      ctx.fill();
    }
    if (shootingStars.length < 2 && Math.random() < 0.012) {
      shootingStars.push({
        x: Math.random() * w * 0.85 + w * 0.1,
        y: Math.random() * h * 0.38,
        len: Math.random() * 120 + 80,
        speed: Math.random() * 9 + 8,
        a: 1.0
      });
    }
    for (var j = shootingStars.length - 1; j >= 0; j--) {
      var st = shootingStars[j];
      st.x -= st.speed;
      st.y += st.speed * 0.58;
      st.a -= 0.02;
      if (st.a <= 0) { shootingStars.splice(j, 1); continue; }
      var tailX = st.x + st.len;
      var tailY = st.y - st.len * 0.58;
      var gGlow = ctx.createLinearGradient(st.x, st.y, tailX, tailY);
      gGlow.addColorStop(0, 'rgba(56,189,248,' + (st.a * 0.55).toFixed(2) + ')');
      gGlow.addColorStop(1, 'rgba(56,189,248,0)');
      ctx.strokeStyle = gGlow;
      ctx.lineWidth = 3.0;
      ctx.beginPath();
      ctx.moveTo(st.x, st.y);
      ctx.lineTo(tailX, tailY);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(st.x, st.y, 1.8, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(255,255,255,' + st.a.toFixed(2) + ')';
      ctx.fill();
    }
    if (isRunning && !motionQuery.matches && !document.hidden) {
      rafId = requestAnimationFrame(tick);
    }
  }

  function startEngine() {
    if (motionQuery.matches) {
      stopEngine();
      return;
    }
    if (canvas && ctx) {
      resize();
      initStars();
      if (!isRunning) {
        isRunning = true;
        if (!document.hidden && rafId === null) {
          rafId = requestAnimationFrame(tick);
        }
      }
    } else {
      isMobile = isMobileViewport();
      syncVideoPlayback();
    }
  }

  window.addEventListener('resize', resize, { passive: true });
  document.addEventListener('visibilitychange', function() {
    if (document.hidden) {
      if (rafId !== null) {
        cancelAnimationFrame(rafId);
        rafId = null;
      }
      syncVideoPlayback();
    } else if (!motionQuery.matches) {
      startEngine();
      if (isRunning && rafId === null && ctx) {
        rafId = requestAnimationFrame(tick);
      }
    }
  });

  var onMotionChange = function(ev) {
    if (ev.matches) stopEngine();
    else startEngine();
  };
  if (typeof motionQuery.addEventListener === 'function') {
    motionQuery.addEventListener('change', onMotionChange);
  } else if (typeof motionQuery.addListener === 'function') {
    motionQuery.addListener(onMotionChange);
  }

  startEngine();
})();
</script>
</body>
</html>`;

module.exports = { PUBLIC_LOGIN_HTML };
