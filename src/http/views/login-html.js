'use strict';

/* unslop craft principles adapted from Damir Sokolovsky (@heydamir), CC BY 4.0 */

const PUBLIC_LOGIN_HTML = `<!doctype html>
<html lang="vi" data-theme="deep-galaxy">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<meta name="color-scheme" content="dark light">
<title>KBOT Manager — Cổng Điều Khiển Bot Minecraft KingMC</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500;600&display=swap" rel="stylesheet">
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
/* unslop craft principles adapted from Damir Sokolovsky (@heydamir), CC BY 4.0 */
:root,
:root[data-theme="deep-galaxy"] {
  color-scheme: dark;
  /* Animate UI Motion Tokens (Subtle Level) */
  --ease-out: cubic-bezier(0.23, 1, 0.32, 1);
  --ease-soft: cubic-bezier(0.215, 0.61, 0.355, 1);
  --ease-in-out: cubic-bezier(0.77, 0, 0.175, 1);
  --ease-away: cubic-bezier(0.33, 0.17, 0.67, 0.5);
  --ease-color: cubic-bezier(0.25, 0.1, 0.25, 1);
  --ease-enter: cubic-bezier(0.25, 0.1, 0.35, 1);
  --scale-press: 0.97;
  --scale-choice: 0.985;
  --blur-icon: 2px;
  --blur-surface: 4px;

  /* Deep Galaxy — Low-saturation Ink/Obsidian Neutral Ramp */
  --bg-base: #08090f;
  --bg-elevated: #0f111a;
  --bg-glow-1: rgba(124, 92, 246, 0.08);
  --bg-glow-2: rgba(56, 189, 248, 0.04);
  --surface-card: #11131d;
  --surface-panel: #151824;
  --surface-soft: #1b1f2e;
  --surface-input: #0b0d15;
  --border-subtle: rgba(238, 240, 246, 0.09);
  --border-strong: rgba(238, 240, 246, 0.18);
  --text-primary: #eef0f6;
  --text-secondary: #a8afc2;
  --text-muted: #788097;
  --accent: #7c5cf6;
  --accent-hover: #6d4be8;
  --accent-active: #5e3dd6;
  --accent-soft: rgba(124, 92, 246, 0.14);
  --accent-text: #c4b5fd;
  --accent-on: #ffffff;
  --success: #34b37e;
  --success-soft: rgba(52, 179, 126, 0.12);
  --success-text: #7ee2b8;
  --danger: #e5484d;
  --danger-soft: rgba(229, 72, 77, 0.12);
  --danger-text: #fca5a5;
  --warning: #e59934;
  --warning-soft: rgba(229, 153, 52, 0.12);
  --warning-text: #fcd34d;
  --neutral-soft: rgba(148, 163, 184, 0.12);
  --neutral-text: #cbd5e1;
  --shadow-card: 0 20px 48px rgba(2, 4, 12, 0.55);
}

:root[data-theme="ocean-abyss"] {
  color-scheme: dark;
  --bg-base: #070d16;
  --bg-elevated: #0c1523;
  --bg-glow-1: rgba(14, 165, 233, 0.09);
  --bg-glow-2: rgba(20, 184, 166, 0.05);
  --surface-card: #0e1828;
  --surface-panel: #121e31;
  --surface-soft: #17273f;
  --surface-input: #09111d;
  --border-subtle: rgba(226, 238, 248, 0.10);
  --border-strong: rgba(125, 211, 252, 0.24);
  --text-primary: #ecf3fa;
  --text-secondary: #a4b8cc;
  --text-muted: #72889e;
  --accent: #0ea5e9;
  --accent-hover: #0284c7;
  --accent-active: #0369a1;
  --accent-soft: rgba(14, 165, 233, 0.14);
  --accent-text: #7dd3fc;
  --accent-on: #ffffff;
  --success: #2fb380;
  --success-soft: rgba(47, 179, 128, 0.12);
  --success-text: #6ee7b7;
  --danger: #e5484d;
  --danger-soft: rgba(229, 72, 77, 0.12);
  --danger-text: #fca5a5;
  --warning: #e59934;
  --warning-soft: rgba(229, 153, 52, 0.12);
  --warning-text: #fcd34d;
  --neutral-soft: rgba(148, 163, 184, 0.12);
  --neutral-text: #cbd5e1;
  --shadow-card: 0 20px 48px rgba(2, 8, 18, 0.60);
}

:root[data-theme="violet-dusk"] {
  color-scheme: dark;
  --bg-base: #111116;
  --bg-elevated: #17171e;
  --bg-glow-1: rgba(139, 108, 246, 0.07);
  --bg-glow-2: rgba(148, 163, 184, 0.04);
  --surface-card: #191922;
  --surface-panel: #1e1e29;
  --surface-soft: #252533;
  --surface-input: #13131a;
  --border-subtle: rgba(240, 238, 248, 0.09);
  --border-strong: rgba(240, 238, 248, 0.18);
  --text-primary: #efedf6;
  --text-secondary: #ada8bf;
  --text-muted: #7f7a94;
  --accent: #7e5bef;
  --accent-hover: #6f4ce2;
  --accent-active: #5f3dc4;
  --accent-soft: rgba(126, 91, 239, 0.14);
  --accent-text: #c4b5fd;
  --accent-on: #ffffff;
  --success: #34b37e;
  --success-soft: rgba(52, 179, 126, 0.12);
  --success-text: #86efac;
  --danger: #e5484d;
  --danger-soft: rgba(229, 72, 77, 0.12);
  --danger-text: #fca5a5;
  --warning: #e59934;
  --warning-soft: rgba(229, 153, 52, 0.12);
  --warning-text: #fcd34d;
  --neutral-soft: rgba(148, 163, 184, 0.12);
  --neutral-text: #cbd5e1;
  --shadow-card: 0 20px 44px rgba(4, 4, 8, 0.50);
}

:root[data-theme="moonlight"] {
  color-scheme: light;
  --bg-base: #f3f5f9;
  --bg-elevated: #ffffff;
  --bg-glow-1: rgba(79, 70, 229, 0.05);
  --bg-glow-2: rgba(14, 165, 233, 0.04);
  --surface-card: #ffffff;
  --surface-panel: #ffffff;
  --surface-soft: #eef2f7;
  --surface-input: #f8fafc;
  --border-subtle: rgba(15, 23, 42, 0.10);
  --border-strong: rgba(15, 23, 42, 0.20);
  --text-primary: #111827;
  --text-secondary: #475569;
  --text-muted: #64748b;
  --accent: #4f46e5;
  --accent-hover: #4338ca;
  --accent-active: #3730a3;
  --accent-soft: rgba(79, 70, 229, 0.09);
  --accent-text: #4338ca;
  --accent-on: #ffffff;
  --success: #16a34a;
  --success-soft: rgba(22, 163, 74, 0.10);
  --success-text: #15803d;
  --danger: #dc2626;
  --danger-soft: rgba(220, 38, 38, 0.10);
  --danger-text: #b91c1c;
  --warning: #d97706;
  --warning-soft: rgba(217, 119, 6, 0.10);
  --warning-text: #b45309;
  --neutral-soft: rgba(100, 116, 139, 0.10);
  --neutral-text: #334155;
  --shadow-card: 0 12px 32px rgba(15, 23, 42, 0.07), 0 1px 2px rgba(15, 23, 42, 0.04);
}

*, *::before, *::after {
  box-sizing: border-box;
}

html {
  scrollbar-gutter: stable;
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
   QUIET AMBIENT INSTRUMENT BACKDROP
   ========================================================= */
.scene-bg {
  position: fixed;
  inset: 0;
  z-index: 0;
  pointer-events: none;
  overflow: hidden;
  background:
    radial-gradient(ellipse 70% 52% at 16% 14%, var(--bg-glow-1), transparent 68%),
    radial-gradient(ellipse 62% 50% at 84% 84%, var(--bg-glow-2), transparent 68%),
    var(--bg-base);
}

.scene-canvas {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  display: block;
}

/* =========================================================
   LAYOUT SHELL (4PX GRID)
   ========================================================= */
.page-shell {
  position: relative;
  z-index: 1;
  min-height: 100dvh;
  max-width: 1200px;
  margin: 0 auto;
  padding: 24px 24px 32px;
  display: flex;
  flex-direction: column;
  justify-content: space-between;
  gap: 24px;
}

.topbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  flex-wrap: wrap;
}

.brand-lockup {
  display: inline-flex;
  align-items: center;
  gap: 12px;
  min-width: 0;
}

.brand-emblem {
  width: 36px;
  height: 36px;
  border-radius: 10px;
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
  font-weight: 600;
  letter-spacing: -0.01em;
  color: var(--text-primary);
}

.brand-version {
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-size: 11px;
  font-weight: 500;
  font-variant-numeric: tabular-nums;
  padding: 2px 6px;
  border-radius: 6px;
  background: var(--surface-soft);
  border: 1px solid var(--border-subtle);
  color: var(--text-secondary);
}

.brand-sub {
  font-size: 12px;
  color: var(--text-muted);
}

.topbar-controls {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}

.theme-switcher {
  display: inline-flex;
  align-items: center;
  padding: 4px;
  border-radius: 10px;
  background: var(--surface-card);
  border: 1px solid var(--border-subtle);
  gap: 4px;
}

.theme-pill-btn {
  appearance: none;
  border: 1px solid transparent;
  background: transparent;
  color: var(--text-muted);
  font-family: inherit;
  font-size: 12px;
  font-weight: 500;
  padding: 6px 10px;
  min-height: 32px;
  border-radius: 6px;
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  transition:
    background-color 200ms var(--ease-color),
    color 200ms var(--ease-color),
    border-color 200ms var(--ease-color),
    transform 140ms var(--ease-out);
}

.theme-pill-btn:active {
  transform: scale(var(--scale-press));
}

.theme-pill-btn.active,
.theme-pill-btn[aria-pressed="true"] {
  background: var(--surface-soft);
  color: var(--text-primary);
  border-color: var(--border-strong);
  font-weight: 600;
}

/* =========================================================
   ASYMMETRIC SPLIT WORKSPACE
   ========================================================= */
.split-grid {
  flex: 1;
  display: grid;
  grid-template-columns: minmax(0, 1.12fr) minmax(380px, 432px);
  gap: 48px;
  align-items: start;
  padding-block: clamp(12px, 3.5vh, 36px);
  width: 100%;
}

.hero-panel {
  display: flex;
  flex-direction: column;
  gap: 20px;
  min-width: 0;
}

.hero-kicker {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  align-self: flex-start;
  padding: 4px 10px;
  border-radius: 6px;
  background: var(--surface-panel);
  border: 1px solid var(--border-subtle);
  color: var(--text-secondary);
  font-size: 12px;
  font-weight: 500;
}

.kicker-dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: var(--success);
  position: relative;
  flex-shrink: 0;
}

.kicker-dot::after {
  content: '';
  position: absolute;
  inset: 0;
  border-radius: 50%;
  background: var(--success);
  opacity: 0;
}

.hero-heading {
  margin: 0;
  font-size: clamp(28px, 3.4vw, 40px);
  font-weight: 600;
  line-height: 1.15;
  letter-spacing: -0.025em;
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
  max-width: 54ch;
}

/* =========================================================
   SIGNATURE MOMENT: LIVE BOT TELEMETRY INSTRUMENT PREVIEW
   ========================================================= */
.telemetry-preview {
  background: var(--surface-card);
  border: 1px solid var(--border-strong);
  border-left: 3px solid var(--success);
  border-radius: 14px;
  padding: 16px;
  box-shadow: var(--shadow-card);
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.telemetry-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  flex-wrap: wrap;
}

.telemetry-id-group {
  display: flex;
  align-items: center;
  gap: 8px;
}

.telemetry-chip {
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-size: 11px;
  font-weight: 500;
  padding: 2px 8px;
  border-radius: 6px;
  background: var(--accent-soft);
  border: 1px solid var(--border-subtle);
  color: var(--accent-text);
  font-variant-numeric: tabular-nums;
}

.telemetry-bot-name {
  font-size: 14px;
  font-weight: 600;
  color: var(--text-primary);
}

.telemetry-status-pill {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 3px 8px;
  border-radius: 6px;
  background: var(--success-soft);
  border: 1px solid rgba(52, 179, 126, 0.28);
  color: var(--success-text);
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-size: 11px;
  font-weight: 500;
}

.telemetry-metrics {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 8px;
}

.telemetry-cell {
  background: var(--surface-input);
  border: 1px solid var(--border-subtle);
  border-radius: 8px;
  padding: 8px 10px;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.telemetry-label {
  font-size: 11px;
  color: var(--text-muted);
}

.telemetry-val {
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-size: 13px;
  font-weight: 600;
  color: var(--text-primary);
  font-variant-numeric: tabular-nums;
}

/* =========================================================
   CAPABILITY GRID (QUIET CHROME, ALIGNED 16PX ICONS)
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
  padding: 12px 14px;
  border-radius: 12px;
  background: var(--surface-panel);
  border: 1px solid var(--border-subtle);
  transition:
    transform 200ms var(--ease-out),
    border-color 200ms var(--ease-color),
    background-color 200ms var(--ease-color);
}

.feature-icon {
  width: 32px;
  height: 32px;
  border-radius: 8px;
  background: var(--surface-soft);
  border: 1px solid var(--border-subtle);
  color: var(--text-secondary);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}

.feature-title {
  margin: 0 0 2px;
  font-size: 13px;
  font-weight: 600;
  color: var(--text-primary);
}

.feature-desc {
  margin: 0;
  font-size: 12px;
  line-height: 1.5;
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
  min-height: 36px;
  border-radius: 8px;
  background: var(--surface-panel);
  border: 1px solid var(--border-subtle);
  color: var(--text-secondary);
  font-size: 13px;
  font-weight: 500;
  text-decoration: none;
  transition:
    border-color 200ms var(--ease-color),
    color 200ms var(--ease-color),
    background-color 200ms var(--ease-color),
    transform 140ms var(--ease-out);
}

.discord-support-link:active {
  transform: scale(var(--scale-press));
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
  border-radius: 16px;
  padding: 24px;
  box-shadow: var(--shadow-card);
}

.auth-card-header {
  margin-bottom: 16px;
}

.auth-card-title {
  margin: 0 0 4px;
  font-size: 19px;
  font-weight: 600;
  letter-spacing: -0.015em;
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
  gap: 4px;
  padding: 4px;
  border-radius: 10px;
  background: var(--surface-input);
  border: 1px solid var(--border-subtle);
  margin-bottom: 16px;
}

.auth-tab-btn {
  appearance: none;
  border: 1px solid transparent;
  background: transparent;
  color: var(--text-muted);
  font-family: inherit;
  font-size: 13px;
  font-weight: 500;
  min-height: 36px;
  border-radius: 6px;
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  transition:
    background-color 200ms var(--ease-color),
    color 200ms var(--ease-color),
    border-color 200ms var(--ease-color),
    transform 140ms var(--ease-out);
}

.auth-tab-btn:active {
  transform: scale(var(--scale-press));
}

.auth-tab-btn.active,
.auth-tab-btn[aria-selected="true"] {
  background: var(--surface-soft);
  border-color: var(--border-strong);
  color: var(--text-primary);
  font-weight: 600;
}

.login-alert {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  padding: 10px 12px;
  border-radius: 8px;
  font-size: 13px;
  line-height: 1.45;
  margin-bottom: 16px;
  border: 1px solid transparent;
}

.login-alert.error {
  background: var(--danger-soft);
  border-color: rgba(229, 72, 77, 0.30);
  color: var(--danger-text);
}

.login-alert.success {
  background: var(--success-soft);
  border-color: rgba(52, 179, 126, 0.30);
  color: var(--success-text);
}

.login-alert.info {
  background: var(--accent-soft);
  border-color: var(--border-strong);
  color: var(--accent-text);
}

.alert-icon-wrap {
  flex-shrink: 0;
  margin-top: 2px;
}

.trial-callout {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  padding: 10px 12px;
  border-radius: 8px;
  background: var(--accent-soft);
  border: 1px solid var(--border-strong);
  color: var(--text-secondary);
  font-size: 12.5px;
  line-height: 1.5;
  margin-bottom: 16px;
}

.trial-callout-icon {
  color: var(--accent-text);
  flex-shrink: 0;
  margin-top: 2px;
}

.auth-form {
  display: flex;
  flex-direction: column;
  gap: 12px;
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
  font-size: 13px;
  font-weight: 500;
  color: var(--text-secondary);
}

.field-hint-inline {
  font-size: 12px;
  font-weight: 400;
  color: var(--text-muted);
}

.input-wrap {
  position: relative;
  display: flex;
  align-items: center;
}

.field-input {
  width: 100%;
  min-height: 40px;
  padding: 8px 12px;
  border-radius: 8px;
  background: var(--surface-input);
  border: 1px solid var(--border-subtle);
  color: var(--text-primary);
  font-family: inherit;
  font-size: 14px;
  transition:
    border-color 200ms var(--ease-color),
    box-shadow 200ms var(--ease-color);
}

.field-input::placeholder {
  color: var(--text-muted);
}

.field-input:focus {
  outline: none;
  border-color: var(--accent);
  box-shadow: 0 0 0 3px var(--accent-soft);
}

.field-input.has-toggle {
  padding-right: 44px;
}

.field-input.is-invalid,
.field-input[aria-invalid="true"] {
  border-color: var(--danger);
}

.key-input {
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  letter-spacing: 0.02em;
  font-size: 13px;
}

.password-toggle-btn {
  position: absolute;
  right: 4px;
  top: 50%;
  transform: translateY(-50%);
  width: 34px;
  height: 34px;
  border: none;
  border-radius: 6px;
  background: transparent;
  color: var(--text-muted);
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  transition:
    background-color 200ms var(--ease-color),
    color 200ms var(--ease-color);
}

.field-error {
  margin: 0;
  font-size: 12px;
  font-weight: 500;
  color: var(--danger-text);
}

.remember-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  margin: 2px 0;
}

.checkbox-label {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  font-size: 13px;
  font-weight: 400;
  color: var(--text-secondary);
  cursor: pointer;
  min-height: 28px;
}

.checkbox-label input[type="checkbox"] {
  width: 16px;
  height: 16px;
  accent-color: var(--accent);
  cursor: pointer;
}

.primary-cta {
  width: 100%;
  min-height: 44px;
  padding: 10px 16px;
  border: 1px solid transparent;
  border-radius: 8px;
  background: var(--accent);
  color: var(--accent-on);
  font-family: inherit;
  font-size: 14px;
  font-weight: 600;
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  margin-top: 4px;
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.12);
  transition:
    background-color 200ms var(--ease-color),
    transform 140ms var(--ease-out),
    opacity 200ms var(--ease-out);
}

.primary-cta:active:not(:disabled) {
  background: var(--accent-active);
  transform: scale(var(--scale-press));
}

.primary-cta:disabled {
  opacity: 0.65;
  cursor: not-allowed;
}

.primary-cta.is-success {
  background: var(--success);
  color: #ffffff;
}

.btn-secondary:active:not(:disabled) {
  transform: scale(var(--scale-press));
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
  width: 16px;
  height: 16px;
  flex-shrink: 0;
}

/* Instantaneous focus ring (Animate UI Rule A17) */
button, a, [role="button"] {
  touch-action: manipulation;
  -webkit-tap-highlight-color: transparent;
}

.auth-tab-btn:focus-visible,
.theme-pill-btn:focus-visible,
.password-toggle-btn:focus-visible,
.primary-cta:focus-visible,
.btn-secondary:focus-visible,
.discord-support-link:focus-visible,
.checkbox-label input:focus-visible {
  outline: 2px solid var(--accent-text);
  outline-offset: 2px;
}

/* =========================================================
   FINE POINTER HOVER GATE (ANIMATE UI RULE A3 & B4)
   ========================================================= */
@media (hover: hover) and (pointer: fine) {
  .theme-pill-btn:hover:not(.active) {
    color: var(--text-primary);
    background: var(--surface-soft);
  }
  .feature-card:hover {
    transform: translateY(-2px);
    border-color: var(--border-strong);
  }
  .discord-support-link:hover {
    border-color: var(--border-strong);
    color: var(--text-primary);
    background: var(--surface-soft);
  }
  .auth-tab-btn:hover:not(.active) {
    color: var(--text-primary);
  }
  .field-input:hover:not(:focus) {
    border-color: var(--border-strong);
  }
  .password-toggle-btn:hover {
    background: var(--surface-soft);
    color: var(--text-primary);
  }
  .primary-cta:hover:not(:disabled) {
    background: var(--accent-hover);
  }
}

/* =========================================================
   ANIMATIONS (ANIMATE UI TOKENS + REDUCED-MOTION OPT-IN)
   ========================================================= */
@keyframes kbotSonar {
  0% { transform: scale(1); opacity: 0.75; }
  75%, 100% { transform: scale(2.3); opacity: 0; }
}

@keyframes kbotPanelIn {
  from {
    opacity: 0;
    filter: blur(var(--blur-icon));
    transform: translateY(6px);
  }
  to {
    opacity: 1;
    filter: none;
    transform: none;
  }
}

@keyframes kbotSurfaceIn {
  from {
    opacity: 0;
    filter: blur(var(--blur-surface));
    transform: translateY(8px) scale(0.985);
  }
  to {
    opacity: 1;
    filter: none;
    transform: none;
  }
}

@keyframes kbotSpin {
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
}

@media (prefers-reduced-motion: no-preference) {
  .kicker-dot::after {
    animation: kbotSonar 2.4s var(--ease-out) infinite;
  }
  .auth-card {
    animation: kbotSurfaceIn 320ms var(--ease-out);
  }
  .auth-panel-enter {
    animation: kbotPanelIn 220ms var(--ease-enter);
  }
  .icon-spin {
    animation: kbotSpin 0.85s linear infinite;
  }
}

@media (prefers-reduced-motion: reduce) {
  .auth-panel-enter {
    animation: kbotPanelFadeOnly 180ms var(--ease-out);
  }
  .icon-spin {
    animation: kbotSpin 4s linear infinite;
  }
}

@keyframes kbotPanelFadeOnly {
  from { opacity: 0; }
  to { opacity: 1; }
}

/* =========================================================
   FORCED COLORS ACCESSIBILITY SUPPORT
   ========================================================= */
@media (forced-colors: active) {
  .auth-card,
  .telemetry-preview,
  .feature-card,
  .theme-switcher,
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
    padding: 16px 16px max(28px, env(safe-area-inset-bottom, 28px));
    gap: 20px;
  }
  .split-grid {
    grid-template-columns: 1fr;
    gap: 24px;
    align-items: stretch;
  }
  .auth-column {
    order: 1;
  }
  .hero-panel {
    order: 2;
  }
  .telemetry-metrics {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
  .feature-grid {
    grid-template-columns: 1fr;
  }
  .field-input {
    font-size: 16px;
  }
}

@media (max-width: 520px) {
  .topbar {
    flex-direction: column;
    align-items: stretch;
    gap: 12px;
  }
  .topbar-controls {
    width: 100%;
  }
  .theme-switcher {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    width: 100%;
    gap: 4px;
  }
  .theme-pill-btn {
    padding: 8px;
    min-height: 36px;
    font-size: 12px;
    justify-content: center;
  }
  .auth-card {
    padding: 20px 16px;
    border-radius: 14px;
  }
  .field-label {
    flex-wrap: wrap;
    row-gap: 2px;
  }
  .primary-cta,
  .field-input,
  .auth-tab-btn {
    min-height: 44px;
  }
  .password-toggle-btn {
    width: 40px;
    height: 40px;
  }
}
</style>
</head>
<body>

<div class="scene-bg" aria-hidden="true">
  <video id="publicGalaxyVideo" class="hidden" hidden muted playsinline preload="none"></video>
  <canvas id="publicStarfieldCanvas" class="scene-canvas"></canvas>
</div>

<main class="page-shell">
  <header class="topbar">
    <div class="brand-lockup">
      <div class="brand-emblem" aria-hidden="true">
        <svg class="ui-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round">
          <path d="M12 2L3 7v10l9 5 9-5V7l-9-5z"/>
          <path d="M12 22V12"/>
          <path d="M21 7l-9 5-9-5"/>
        </svg>
      </div>
      <div class="brand-meta">
        <div class="brand-title-row">
          <span class="brand-name">KBOT Manager</span>
          <span class="brand-version">V12.1.1</span>
        </div>
        <span class="brand-sub">Bảng điều khiển vận hành Bot Minecraft KingMC</span>
      </div>
    </div>

    <div class="topbar-controls">
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
        <span class="kicker-dot" aria-hidden="true"></span>
        <span>Hạ tầng vận hành Bot AFK đám mây cho cụm máy chủ KingMC</span>
      </div>

      <h1 class="hero-heading">
        Điều phối và giám sát Bot <span class="hero-heading-accent">KingMC</span> theo thời gian thực
      </h1>

      <p class="hero-lead">
        Giữ nhân vật treo máy 24/7 không cần bật máy tính cá nhân. Tương tác trực tiếp menu rương ingame, quản lý túi đồ 36 ô và tự động kết nối lại khi máy chủ bảo trì.
      </p>

      <div class="telemetry-preview" aria-label="Mô phỏng thông số vận hành thực tế">
        <div class="telemetry-head">
          <div class="telemetry-id-group">
            <span class="telemetry-chip">BOT-01</span>
            <span class="telemetry-bot-name">KingMC Towny AFK</span>
          </div>
          <span class="telemetry-status-pill">
            <span class="kicker-dot" aria-hidden="true"></span>
            <span>ONLINE • ECO 1HZ</span>
          </span>
        </div>
        <div class="telemetry-metrics">
          <div class="telemetry-cell">
            <span class="telemetry-label">Sinh lực / Totem</span>
            <span class="telemetry-val">20/20 • x6</span>
          </div>
          <div class="telemetry-cell">
            <span class="telemetry-label">Độ trễ mạng</span>
            <span class="telemetry-val">24 ms</span>
          </div>
          <div class="telemetry-cell">
            <span class="telemetry-label">RAM Worker</span>
            <span class="telemetry-val">146 / 220 MB</span>
          </div>
          <div class="telemetry-cell">
            <span class="telemetry-label">Phiên kết nối</span>
            <span class="telemetry-val">AES-256-GCM</span>
          </div>
        </div>
      </div>

      <div class="feature-grid">
        <article class="feature-card">
          <div class="feature-icon" aria-hidden="true">
            <svg class="ui-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
              <rect x="3" y="3" width="18" height="18" rx="2"/>
              <path d="M3 9h18M9 21V9"/>
            </svg>
          </div>
          <div>
            <h2 class="feature-title">Cửa sổ GUI và túi đồ trực tiếp</h2>
            <p class="feature-desc">Bấm chọn ô trong /menu, rương ingame, kéo thả trang bị và lắp Totem tay phụ trên trình duyệt</p>
          </div>
        </article>

        <article class="feature-card">
          <div class="feature-icon" aria-hidden="true">
            <svg class="ui-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
              <path d="M23 4v6h-6M1 20v-6h6"/>
              <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/>
            </svg>
          </div>
          <div>
            <h2 class="feature-title">Tự động vào lại và chạy lệnh</h2>
            <p class="feature-desc">Tự đăng nhập /login, mở /menu vào sảnh và chạy chuỗi lệnh Spawn với độ trễ ngẫu nhiên an toàn</p>
          </div>
        </article>

        <article class="feature-card">
          <div class="feature-icon" aria-hidden="true">
            <svg class="ui-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
              <circle cx="12" cy="12" r="9"/>
              <path d="M12 7v5l3 2"/>
            </svg>
          </div>
          <div>
            <h2 class="feature-title">Hẹn giờ và Auto Chat định kỳ</h2>
            <p class="feature-desc">Đặt lịch bật tắt theo khung giờ cố định hoặc chu kỳ lặp kèm tin nhắn rao shop tự động</p>
          </div>
        </article>

        <article class="feature-card">
          <div class="feature-icon" aria-hidden="true">
            <svg class="ui-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
              <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>
              <path d="M9 12l2 2 4-4"/>
            </svg>
          </div>
          <div>
            <h2 class="feature-title">Đồng bộ cảnh báo qua Discord</h2>
            <p class="feature-desc">Liên kết tài khoản qua lệnh /login trên Discord để điều khiển bot và nhận tin nhắn DM khi bị kick</p>
          </div>
        </article>
      </div>

      <div class="hero-footer-links">
        <a href="https://discord.gg/SymBz2rs9j" target="_blank" rel="noopener noreferrer" class="discord-support-link">
          <svg class="ui-icon" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
            <path d="M20.317 4.37a19.791 19.791 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.25.077.077 0 0 0-.079-.037A19.736 19.736 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 0 0 .031.057 19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028c.462-.63.874-1.295 1.226-1.994.021-.041.001-.09-.041-.106a13.107 13.107 0 0 1-1.872-.892.077.077 0 0 1-.008-.128 10.2 10.2 0 0 0 .372-.292.074.074 0 0 1 .077-.01c3.929 1.793 8.18 1.793 12.061 0a.074.074 0 0 1 .078.01c.12.098.246.198.373.292a.077.077 0 0 1-.006.127 12.299 12.299 0 0 1-1.873.894.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028 19.839 19.839 0 0 0 6.002-3.03.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.028z"/>
          </svg>
          <span>Cộng đồng Discord KingMC</span>
        </a>
        <span class="hero-footnote">Hỗ trợ điều khiển nhanh trên Discord qua /bots và /login</span>
      </div>
    </div>

    <div class="auth-column">
      <div class="auth-card">
        <div class="auth-card-header">
          <h2 class="auth-card-title">Truy cập bảng điều khiển</h2>
          <p class="auth-card-subtitle">Đăng nhập tài khoản hiện có hoặc đăng ký tài khoản mới</p>
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
            data-auth-tab="login">Đăng nhập</button>
          <button
            id="tabPublicRegisterBtn"
            type="button"
            class="auth-tab-btn"
            role="tab"
            aria-selected="false"
            aria-controls="publicRegisterForm"
            tabindex="-1"
            data-auth-tab="register">Đăng ký</button>
        </div>

        <div id="publicFieldAnnouncer" class="sr-only" aria-live="polite" aria-atomic="true"></div>
        <div id="publicLoginAlert" class="login-alert hidden" role="alert" aria-live="assertive" hidden></div>

        <form id="publicLoginForm" role="tabpanel" aria-labelledby="tabPublicLoginBtn" class="auth-form" novalidate>
          <div class="field-group">
            <label class="field-label" for="publicUsername">
              <span>Tên đăng nhập</span>
              <span class="field-hint-inline">User hoặc Admin</span>
            </label>
            <div class="input-wrap">
              <input id="publicUsername" class="field-input" type="text" autocomplete="username" placeholder="Nhập tên đăng nhập" aria-describedby="publicUsernameErr">
            </div>
            <p id="publicUsernameErr" class="field-error" hidden></p>
          </div>

          <div class="field-group">
            <label class="field-label" for="publicPassword">
              <span>Mật khẩu</span>
            </label>
            <div class="input-wrap">
              <input id="publicPassword" class="field-input has-toggle" type="password" autocomplete="current-password" placeholder="Nhập mật khẩu" aria-describedby="publicPasswordErr">
              <button type="button" class="password-toggle-btn" data-toggle-target="publicPassword" aria-label="Hiện mật khẩu" aria-pressed="false">
                <svg class="ui-icon icon-eye" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" aria-hidden="true">
                  <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/>
                  <circle cx="12" cy="12" r="3"/>
                </svg>
                <svg class="ui-icon icon-eye-off hidden" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" aria-hidden="true">
                  <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94"/>
                  <path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19"/>
                  <line x1="1" y1="1" x2="23" y2="23"/>
                </svg>
              </button>
            </div>
            <p id="publicPasswordErr" class="field-error" hidden></p>
          </div>

          <div class="remember-row">
            <label class="checkbox-label" for="publicRememberMe">
              <input id="publicRememberMe" type="checkbox" checked>
              <span>Ghi nhớ phiên đăng nhập trên trình duyệt này</span>
            </label>
          </div>

          <button id="publicSubmitBtn" type="submit" class="primary-cta">
            <span class="btn-icon" aria-hidden="true">
              <svg class="ui-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75">
                <path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4"/>
                <polyline points="10 17 15 12 10 7"/>
                <line x1="15" y1="12" x2="3" y2="12"/>
              </svg>
            </span>
            <span class="btn-label">Đăng nhập vào hệ thống</span>
          </button>
        </form>

        <form id="publicRegisterForm" class="hidden" role="tabpanel" aria-labelledby="tabPublicRegisterBtn" hidden novalidate>
          <div class="auth-form">
            <div id="publicTrialCalloutBadge" class="trial-callout">
              <span class="trial-callout-icon" aria-hidden="true">
                <svg class="ui-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75">
                  <polyline points="20 12 20 22 4 22 4 12"/>
                  <rect x="2" y="7" width="20" height="5"/>
                  <line x1="12" y1="22" x2="12" y2="7"/>
                </svg>
              </span>
              <div id="publicTrialCalloutText">
                <strong>Ưu đãi tài khoản mới:</strong> Tặng <strong>1 NGÀY DÙNG THỬ MIỄN PHÍ</strong> ngay khi hoàn tất đăng ký
              </div>
            </div>

            <div class="field-group">
              <label class="field-label" for="regUsername">
                <span>Tên tài khoản mới</span>
                <span class="field-hint-inline">3–32 ký tự a-z, 0-9, _</span>
              </label>
              <div class="input-wrap">
                <input id="regUsername" class="field-input" type="text" autocomplete="username" placeholder="Ví dụ: player_kingmc" aria-describedby="regUsernameErr">
              </div>
              <p id="regUsernameErr" class="field-error" hidden></p>
            </div>

            <div class="field-group">
              <label class="field-label" for="regPassword">
                <span>Mật khẩu</span>
                <span class="field-hint-inline">Tối thiểu 6 ký tự</span>
              </label>
              <div class="input-wrap">
                <input id="regPassword" class="field-input has-toggle" type="password" autocomplete="new-password" placeholder="Tạo mật khẩu đăng nhập" aria-describedby="regPasswordErr">
                <button type="button" class="password-toggle-btn" data-toggle-target="regPassword" aria-label="Hiện mật khẩu" aria-pressed="false">
                  <svg class="ui-icon icon-eye" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" aria-hidden="true">
                    <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/>
                    <circle cx="12" cy="12" r="3"/>
                  </svg>
                  <svg class="ui-icon icon-eye-off hidden" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" aria-hidden="true">
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
                <input id="regPasswordConfirm" class="field-input has-toggle" type="password" autocomplete="new-password" placeholder="Nhập lại mật khẩu vừa tạo" aria-describedby="regPasswordConfirmErr">
                <button type="button" class="password-toggle-btn" data-toggle-target="regPasswordConfirm" aria-label="Hiện mật khẩu" aria-pressed="false">
                  <svg class="ui-icon icon-eye" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" aria-hidden="true">
                    <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/>
                    <circle cx="12" cy="12" r="3"/>
                  </svg>
                  <svg class="ui-icon icon-eye-off hidden" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" aria-hidden="true">
                    <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94"/>
                    <path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19"/>
                    <line x1="1" y1="1" x2="23" y2="23"/>
                  </svg>
                </button>
              </div>
              <p id="regPasswordConfirmErr" class="field-error" hidden></p>
            </div>

            <div id="regCaptchaGroup" class="field-group">
              <label class="field-label" for="regCaptchaAnswer">
                <span>Mã xác thực Captcha</span>
                <span class="field-hint-inline">Bắt buộc</span>
              </label>
              <div style="display:flex;align-items:center;gap:8px;margin-bottom:8px;flex-wrap:wrap;">
                <div id="regCaptchaImgContainer" style="background:var(--surface-input);border:1px solid var(--border-subtle);border-radius:8px;padding:4px 8px;min-width:136px;min-height:44px;flex:1 1 140px;display:flex;align-items:center;justify-content:center;cursor:pointer;" title="Nhấn để đổi mã khác">
                  <span style="font-size:12px;color:var(--text-muted);">Đang tải Captcha...</span>
                </div>
                <button type="button" id="regCaptchaRefreshBtn" class="btn-secondary" style="padding:8px 12px;min-height:44px;font-size:12px;font-weight:500;border-radius:8px;display:inline-flex;align-items:center;justify-content:center;gap:4px;cursor:pointer;background:var(--surface-input);border:1px solid var(--border-subtle);color:var(--text-primary);flex:0 0 auto;" title="Đổi mã xác thực khác">
                  Đổi mã
                </button>
              </div>
              <div class="input-wrap">
                <input id="regCaptchaAnswer" class="field-input" type="text" autocomplete="off" placeholder="Nhập kết quả phép tính hoặc ký tự trên" aria-describedby="regCaptchaErr">
                <input type="hidden" id="regCaptchaToken" value="">
              </div>
              <p id="regCaptchaErr" class="field-error" hidden></p>
            </div>

            <button id="publicRegSubmitBtn" type="submit" class="primary-cta">
              <span class="btn-icon" aria-hidden="true">
                <svg class="ui-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75">
                  <path d="M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/>
                  <circle cx="8.5" cy="7" r="4"/>
                  <line x1="20" y1="8" x2="20" y2="14"/>
                  <line x1="23" y1="11" x2="17" y2="11"/>
                </svg>
              </span>
              <span class="btn-label">Hoàn tất đăng ký</span>
            </button>
          </div>
        </form>

        <div class="auth-footer-note">
          <svg class="ui-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" aria-hidden="true">
            <rect x="3" y="11" width="18" height="11" rx="2"/>
            <path d="M7 11V7a5 5 0 0 1 10 0v4"/>
          </svg>
          <span>Phiên làm việc được bảo vệ bằng cookie HttpOnly và kiểm tra CSRF. Liên hệ Admin trên Discord khi cần cấp lại mật khẩu.</span>
        </div>
      </div>
    </div>
  </section>
</main>

<template id="tplIconLogin">
  <svg class="ui-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" aria-hidden="true">
    <path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4"/>
    <polyline points="10 17 15 12 10 7"/>
    <line x1="15" y1="12" x2="3" y2="12"/>
  </svg>
</template>
<template id="tplIconRegister">
  <svg class="ui-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" aria-hidden="true">
    <path d="M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/>
    <circle cx="8.5" cy="7" r="4"/>
    <line x1="20" y1="8" x2="20" y2="14"/>
    <line x1="23" y1="11" x2="17" y2="11"/>
  </svg>
</template>
<template id="tplIconSpinner">
  <svg class="ui-icon icon-spin" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
    <circle cx="12" cy="12" r="9" opacity="0.25"/>
    <path d="M21 12a9 9 0 0 0-9-9"/>
  </svg>
</template>
<template id="tplIconWarn">
  <svg class="ui-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" aria-hidden="true">
    <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/>
    <line x1="12" y1="9" x2="12" y2="13"/>
    <line x1="12" y1="17" x2="12.01" y2="17"/>
  </svg>
</template>
<template id="tplIconLock">
  <svg class="ui-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" aria-hidden="true">
    <rect x="3" y="11" width="18" height="11" rx="2"/>
    <path d="M7 11V7a5 5 0 0 1 10 0v4"/>
  </svg>
</template>
<template id="tplIconSuccess">
  <svg class="ui-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" aria-hidden="true">
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

let cachedPublicTheme = null;

function normalizePublicTheme(raw) {
  return THEME_MAP[String(raw || '').trim()] || 'deep-galaxy';
}

function getActivePublicTheme() {
  if (cachedPublicTheme) return cachedPublicTheme;
  try {
    cachedPublicTheme = normalizePublicTheme(
      localStorage.getItem('kbot_theme') ||
      localStorage.getItem('kbot_dashboard_theme') ||
      localStorage.getItem('kbot_cosmic_mode') ||
      'deep-galaxy'
    );
    return cachedPublicTheme;
  } catch (_) {
    cachedPublicTheme = 'deep-galaxy';
    return cachedPublicTheme;
  }
}

function applyPublicTheme(themeName) {
  const theme = normalizePublicTheme(themeName);
  cachedPublicTheme = theme;
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

function triggerAuthPanelTransition(panelEl) {
  if (!panelEl || !panelEl.classList) return;
  panelEl.classList.remove('auth-panel-enter');
  panelEl.classList.add('auth-panel-enter');
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
    if (isLogin) triggerAuthPanelTransition(loginForm);
  }
  if (regForm) {
    regForm.classList.toggle('hidden', isLogin);
    regForm.hidden = isLogin;
    if (!isLogin) triggerAuthPanelTransition(regForm);
  }
  setLoginAlert('', '');
  const announcer = document.getElementById('publicFieldAnnouncer');
  if (announcer) {
    announcer.textContent = isLogin ? 'Đang ở biểu mẫu đăng nhập.' : 'Đang ở biểu mẫu đăng ký tài khoản.';
  }
  if (!isLogin) {
    refreshRegisterCaptcha();
  }
}

function getDeviceFingerprint() {
  try {
    const parts = [
      typeof screen !== 'undefined' && screen.width ? screen.width : 0,
      typeof screen !== 'undefined' && screen.height ? screen.height : 0,
      typeof screen !== 'undefined' && screen.colorDepth ? screen.colorDepth : 0,
      navigator.hardwareConcurrency || 1,
      navigator.languages ? navigator.languages.join(',') : (navigator.language || ''),
      typeof Intl !== 'undefined' && Intl.DateTimeFormat ? (Intl.DateTimeFormat().resolvedOptions().timeZone || '') : ''
    ];
    try {
      const c = document.createElement('canvas');
      c.width = 100;
      c.height = 30;
      const ctx = c.getContext && c.getContext('2d');
      if (ctx && typeof ctx.fillText === 'function' && typeof c.toDataURL === 'function') {
        ctx.textBaseline = 'top';
        ctx.font = '12px sans-serif';
        ctx.fillText('kbot_fp_seed', 2, 2);
        parts.push(c.toDataURL().slice(-30));
      }
    } catch (_) {}
    const raw = parts.join(';');
    let h = 2166136261;
    for (let i = 0; i < raw.length; i++) {
      h ^= raw.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return 'dfp_' + (h >>> 0).toString(16);
  } catch (_) {
    return 'dfp_unknown';
  }
}

async function refreshRegisterCaptcha() {
  const container = document.getElementById('regCaptchaImgContainer');
  const tokenInput = document.getElementById('regCaptchaToken');
  const answerInput = document.getElementById('regCaptchaAnswer');
  if (answerInput) answerInput.value = '';
  if (container) {
    const span = document.createElement('span');
    span.style.fontSize = '11px';
    span.style.color = 'var(--text-muted)';
    span.textContent = 'Đang tải Captcha...';
    container.replaceChildren(span);
  }
  try {
    const res = await fetch('/api/auth/captcha');
    if (!res.ok) throw new Error('Không thể tải mã xác thực');
    const data = await res.json();
    if (data && data.token && data.svg) {
      if (tokenInput) tokenInput.value = data.token;
      if (container && typeof DOMParser !== 'undefined') {
        const parser = new DOMParser();
        const svgDoc = parser.parseFromString(data.svg, 'image/svg+xml');
        if (svgDoc.documentElement) {
          container.replaceChildren(svgDoc.documentElement);
        }
      }
    } else {
      throw new Error('Dữ liệu Captcha không hợp lệ');
    }
  } catch (err) {
    if (container) {
      const errSpan = document.createElement('span');
      errSpan.style.fontSize = '11px';
      errSpan.style.color = 'var(--danger,#ef4444)';
      errSpan.style.cursor = 'pointer';
      errSpan.textContent = 'Lỗi tải Captcha. Bấm để thử lại.';
      container.replaceChildren(errSpan);
    }
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
  const cEl = document.getElementById('regCaptchaAnswer');
  const u = uEl ? uEl.value.trim() : '';
  const p = pEl ? pEl.value : '';
  const p2 = p2El ? p2El.value : '';
  const c = cEl ? cEl.value.trim() : '';

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

  if (cEl && !c) {
    setFieldError('regCaptchaAnswer', 'regCaptchaErr', 'Vui lòng nhập kết quả mã xác thực Captcha.');
    firstInvalid = firstInvalid || cEl;
  } else if (cEl) {
    setFieldError('regCaptchaAnswer', 'regCaptchaErr', '');
  }

  return { ok: !firstInvalid, firstInvalid };
}

let _publicLoginLockoutTimer = null;

function stopPublicLoginLockoutCountdown() {
  if (_publicLoginLockoutTimer) {
    clearInterval(_publicLoginLockoutTimer);
    _publicLoginLockoutTimer = null;
  }
}

function formatPublicCountdownVi(seconds) {
  const total = Math.max(0, Math.ceil(Number(seconds) || 0));
  if (total >= 3600) {
    const h = Math.floor(total / 3600);
    const m = Math.floor((total % 3600) / 60);
    const s = total % 60;
    return h + ' giờ' + (m > 0 ? ' ' + m + ' phút' : '') + (s > 0 && m === 0 ? ' ' + s + ' giây' : '');
  }
  if (total >= 60) {
    const m = Math.floor(total / 60);
    const s = total % 60;
    return m + ' phút' + (s > 0 ? ' ' + s + ' giây' : '');
  }
  return total + ' giây';
}

function startPublicLoginLockoutCountdown(btn, retryAfterSeconds, errorMessage) {
  stopPublicLoginLockoutCountdown();
  let remaining = Math.max(1, Math.ceil(Number(retryAfterSeconds) || 0));
  const renderTick = () => {
    const waitText = formatPublicCountdownVi(remaining);
    setLoginAlert('error', (errorMessage || 'Quá nhiều lần đăng nhập sai.') + ' (Mở khóa sau ' + waitText + ')', 'tplIconWarn');
    if (btn) {
      btn.disabled = true;
      setSubmitButtonState(btn, 'idle', 'Tạm khóa (' + waitText + ')', 'tplIconLogin');
    }
  };
  renderTick();
  _publicLoginLockoutTimer = setInterval(() => {
    remaining -= 1;
    if (remaining <= 0) {
      stopPublicLoginLockoutCountdown();
      if (btn) {
        btn.disabled = false;
        setSubmitButtonState(btn, 'idle', 'Đăng nhập vào hệ thống', 'tplIconLogin');
      }
      setLoginAlert('info', 'Đã hết thời gian tạm khóa. Bạn có thể thử đăng nhập lại.', 'tplIconWarn');
      return;
    }
    renderTick();
  }, 1000);
}

async function handlePublicLoginSubmit(e) {
  if (e) e.preventDefault();
  stopPublicLoginLockoutCountdown();
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
      body: JSON.stringify({ username: u, password: p, rememberMe: remember })
    });
    const data = await res.json().catch(() => ({}));
    if (res.status === 429 && Number(data.retryAfterSeconds) > 0) {
      startPublicLoginLockoutCountdown(btn, Number(data.retryAfterSeconds), data.error);
      return;
    }
    if (!res.ok || !data.ok) {
      throw new Error(data.error || 'Tên đăng nhập hoặc mật khẩu không đúng.');
    }
    stopPublicLoginLockoutCountdown();
    setLoginAlert('success', 'Đăng nhập thành công. Đang chuyển hướng...', 'tplIconSuccess');
    setSubmitButtonState(btn, 'success', 'Đăng nhập thành công', 'tplIconLogin');
    setTimeout(() => { window.location.replace('/'); }, 300);
  } catch (err) {
    setLoginAlert('error', err && err.message ? err.message : 'Đăng nhập thất bại.', 'tplIconWarn');
    btn.disabled = false;
    setSubmitButtonState(btn, 'idle', 'Đăng nhập vào hệ thống', 'tplIconLogin');
  }
}

async function handlePublicRegisterSubmit(e) {
  if (e) e.preventDefault();
  const check = validateRegisterFields();
  if (!check.ok) {
    const uErr = document.getElementById('regUsernameErr');
    const pErr = document.getElementById('regPasswordErr');
    const p2Err = document.getElementById('regPasswordConfirmErr');
    const cErr = document.getElementById('regCaptchaErr');
    const summaryMsg = (uErr && uErr.textContent) || (pErr && pErr.textContent) || (p2Err && p2Err.textContent) || (cErr && cErr.textContent) || 'Vui lòng kiểm tra lại thông tin đăng ký.';
    setLoginAlert('error', summaryMsg, 'tplIconWarn');
    if (check.firstInvalid) check.firstInvalid.focus();
    return;
  }

  const u = document.getElementById('regUsername').value.trim();
  const p = document.getElementById('regPassword').value;
  const p2 = document.getElementById('regPasswordConfirm').value;
  const cToken = (document.getElementById('regCaptchaToken') ? document.getElementById('regCaptchaToken').value : '') || '';
  const cAnswer = (document.getElementById('regCaptchaAnswer') ? document.getElementById('regCaptchaAnswer').value.trim() : '') || '';
  const btn = document.getElementById('publicRegSubmitBtn');

  setLoginAlert('', '');
  btn.disabled = true;
  setSubmitButtonState(btn, 'loading', 'Đang tạo tài khoản...', 'tplIconRegister');

  try {
    const res = await fetch('/api/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify({
        username: u,
        password: p,
        confirmPassword: p2,
        captchaToken: cToken,
        captchaAnswer: cAnswer,
        deviceFingerprint: getDeviceFingerprint()
      })
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.ok) {
      throw new Error(data.error || 'Không thể đăng ký tài khoản.');
    }
    setLoginAlert('success', data.message || 'Đăng ký thành công. Đang chuyển hướng...', 'tplIconSuccess');
    setSubmitButtonState(btn, 'success', 'Đăng ký thành công', 'tplIconRegister');
    setTimeout(() => { window.location.replace('/'); }, 350);
  } catch (err) {
    setLoginAlert('error', err && err.message ? err.message : 'Không thể đăng ký tài khoản.', 'tplIconWarn');
    btn.disabled = false;
    setSubmitButtonState(btn, 'idle', 'Hoàn tất đăng ký', 'tplIconRegister');
    refreshRegisterCaptcha();
  }
}

function renderTrialCallout(trialGiftEnabled, rawTrialDays) {
  const badge = document.getElementById('publicTrialCalloutBadge');
  const text = document.getElementById('publicTrialCalloutText');

  if (trialGiftEnabled === false) {
    if (badge) badge.hidden = true;
    return;
  }

  const parsedDays = Number.parseInt(rawTrialDays, 10);
  const days = Number.isFinite(parsedDays) && parsedDays > 0 && parsedDays <= 365 ? parsedDays : 1;

  if (badge) badge.hidden = false;
  if (text) {
    const strongTitle = document.createElement('strong');
    strongTitle.textContent = 'Ưu đãi tài khoản mới:';
    const strongDays = document.createElement('strong');
    strongDays.textContent = days + ' NGÀY DÙNG THỬ MIỄN PHÍ';

    text.replaceChildren(
      strongTitle,
      document.createTextNode(' Tặng '),
      strongDays,
      document.createTextNode(' ngay sau khi hoàn tất đăng ký (nhập mã Key bên trong Web sau khi liên kết Discord)')
    );
  }
}

async function loadPublicSystemInfo() {
  try {
    let sysData = {};
    let loginCfgData = {};
    let sysOk = false;

    const bootRes = await fetch('/api/public/bootstrap', { credentials: 'same-origin' }).catch(() => null);
    const bootData = bootRes && bootRes.ok ? await bootRes.json().catch(() => null) : null;
    if (bootData && bootData.ok && bootData.systemInfo) {
      sysData = bootData.systemInfo;
      loginCfgData = bootData.loginConfig || {};
      sysOk = Boolean(sysData.ok);
    } else {
      const [sysRes, loginCfgRes] = await Promise.all([
        fetch('/api/public/system-info', { credentials: 'same-origin' }).catch(() => null),
        fetch('/api/auth/login-config', { credentials: 'same-origin' }).catch(() => null)
      ]);
      sysData = sysRes ? await sysRes.json().catch(() => ({})) : {};
      loginCfgData = loginCfgRes ? await loginCfgRes.json().catch(() => ({})) : {};
      sysOk = Boolean(sysRes && sysRes.ok && sysData && sysData.ok);
    }

    const trialGiftEnabled = loginCfgData && loginCfgData.trialGiftEnabled !== undefined
      ? loginCfgData.trialGiftEnabled
      : sysData?.trialGiftEnabled;
    const trialDays = loginCfgData && loginCfgData.trialDays !== undefined
      ? loginCfgData.trialDays
      : sysData?.trialDays;

    if (trialGiftEnabled !== undefined) {
      renderTrialCallout(trialGiftEnabled, trialDays);
    } else if (sysOk && sysData.trialGiftEnabled !== undefined) {
      renderTrialCallout(sysData.trialGiftEnabled, sysData.trialDays);
    }
  } catch (_) {}
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

  const captchaBtn = document.getElementById('regCaptchaRefreshBtn');
  if (captchaBtn) captchaBtn.addEventListener('click', refreshRegisterCaptcha);
  const captchaBox = document.getElementById('regCaptchaImgContainer');
  if (captchaBox) captchaBox.addEventListener('click', refreshRegisterCaptcha);
})();

(function checkUrlParams() {
  try {
    const params = new URLSearchParams(window.location.search);
    if (params.get('tab') === 'register' && typeof switchPublicAuthTab === 'function') {
      switchPublicAuthTab('register');
    }
    const err = params.get('error');
    const reason = params.get('reason');
    if (err === 'locked' || reason === 'locked') {
      setLoginAlert('error', 'Tài khoản của bạn hiện đang bị tạm khóa. Vui lòng liên hệ Quản trị viên.', 'tplIconLock');
    } else if (err === 'expired' || reason === 'expired') {
      setLoginAlert('error', 'Gói thuê của bạn đã hết hạn. Vui lòng đăng nhập vào Web để nhập mã gia hạn hoặc vượt link +12h.', 'tplIconWarn');
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

  function resize() {
    if (!canvas) return;
    w = canvas.width = window.innerWidth || 1280;
    h = canvas.height = window.innerHeight || 800;
  }
  window.addEventListener('resize', resize, { passive: true });
  resize();

  const isMobile = /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent || '') || (w <= 768);
  const nodeCount = isMobile ? 36 : 64;
  const nodes = [];
  for (let i = 0; i < nodeCount; i++) {
    nodes.push({
      x: Math.random() * w,
      y: Math.random() * h,
      z: Math.random() * 1.2 + 0.4,
      r: Math.random() * 0.9 + 0.5,
      a: Math.random() * 0.45 + 0.15,
      da: (Math.random() * 0.005 + 0.002) * (Math.random() < 0.5 ? 1 : -1),
      seed: Math.random() * 100
    });
  }

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
  const frameInterval = 1000 / 24;

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
    ctx.clearRect(0, 0, w, h);

    let dotRgb = '203, 213, 225';
    let lineRgba = 'rgba(148, 163, 184, 0.07)';
    let alphaScale = 0.65;
    if (theme === 'ocean-abyss') {
      dotRgb = '125, 211, 252';
      lineRgba = 'rgba(56, 189, 248, 0.08)';
      alphaScale = 0.7;
    } else if (theme === 'violet-dusk') {
      dotRgb = '196, 181, 253';
      lineRgba = 'rgba(167, 139, 250, 0.06)';
      alphaScale = 0.55;
    } else if (theme === 'moonlight') {
      dotRgb = '79, 70, 229';
      lineRgba = 'rgba(79, 70, 229, 0.05)';
      alphaScale = 0.35;
    }

    const connectLimit = Math.min(nodes.length, isMobile ? 16 : 28);
    const maxDistSq = isMobile ? 4900 : 8100;
    ctx.lineWidth = 0.75;
    ctx.strokeStyle = lineRgba;
    ctx.beginPath();
    for (let i = 0; i < connectLimit; i++) {
      const n1 = nodes[i];
      for (let j = i + 1; j < connectLimit; j++) {
        const n2 = nodes[j];
        const dx = n1.x - n2.x;
        const dy = n1.y - n2.y;
        if (dx * dx + dy * dy < maxDistSq) {
          ctx.moveTo(n1.x | 0, n1.y | 0);
          ctx.lineTo(n2.x | 0, n2.y | 0);
        }
      }
    }
    ctx.stroke();

    for (let i = 0; i < nodes.length; i++) {
      const n = nodes[i];
      n.y -= 0.14 * n.z;
      n.x += Math.sin(n.seed + n.y * 0.008) * 0.12;
      n.a += n.da;
      if (n.a > 0.65 || n.a < 0.12) n.da = -n.da;
      if (n.y < -10) {
        n.y = h + 10;
        n.x = Math.random() * w;
      }
      if (n.x < -10) n.x = w + 8;
      else if (n.x > w + 10) n.x = -8;

      ctx.beginPath();
      ctx.arc(n.x | 0, n.y | 0, Math.max(0.9, n.r * n.z * 0.75), 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(' + dotRgb + ', ' + (n.a * alphaScale).toFixed(2) + ')';
      ctx.fill();
    }

    rafId = requestAnimationFrame(frame);
  }

  function startMotion() {
    if (document.hidden || reducedMotionQuery.matches) {
      stopMotion();
      return;
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
window.renderTrialCallout = renderTrialCallout;
window.loadPublicSystemInfo = loadPublicSystemInfo;
</script>
</body>
</html>`;

module.exports = { PUBLIC_LOGIN_HTML };
