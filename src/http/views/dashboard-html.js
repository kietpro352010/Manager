'use strict';

const HTML = String.raw`<!doctype html>
<html lang="vi">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>KBOT — Hệ Thống Cho Thuê Bot AFK KingMC Thương Mại Cao Cấp</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;500;600;700&family=Plus+Jakarta+Sans:wght@400;500;600;700;800;900&display=swap" rel="stylesheet">
<style>
:root {
  color-scheme: dark;
  --bg: #040711;
  --bg-gradient:
    radial-gradient(ellipse at 12% 10%, rgba(14, 165, 233, 0.16) 0%, transparent 45%),
    radial-gradient(ellipse at 88% 88%, rgba(124, 58, 237, 0.14) 0%, transparent 50%),
    radial-gradient(ellipse at 55% 0%, rgba(16, 185, 129, 0.09) 0%, transparent 35%),
    radial-gradient(circle at 50% 50%, rgba(8, 14, 26, 0.98) 0%, #040711 100%);
  --card: rgba(13, 20, 34, 0.82);
  --card-hover: rgba(18, 28, 46, 0.92);
  --card2: rgba(9, 14, 24, 0.78);
  --border: rgba(255, 255, 255, 0.08);
  --border-glow: rgba(56, 189, 248, 0.42);
  --text: #f0f6fc;
  --muted: #8b9bb4;
  --green: #10b981;
  --green-glow: rgba(16, 185, 129, 0.35);
  --red: #ef4444;
  --red-glow: rgba(239, 68, 68, 0.35);
  --yellow: #f59e0b;
  --yellow-glow: rgba(245, 158, 11, 0.35);
  --blue: #38bdf8;
  --blue-glow: rgba(56, 189, 248, 0.35);
  --accent: #38bdf8;
  --gold: #fbbf24;
  --purple: #a78bfa;
}

@keyframes fadeUpIn {
  from { opacity: 0; transform: translateY(14px); }
  to { opacity: 1; transform: translateY(0); }
}
@keyframes auroraFloat {
  0%, 100% { transform: translate(0, 0) scale(1); }
  50% { transform: translate(28px, -18px) scale(1.08); }
}
@keyframes barShimmer {
  0% { transform: translateX(-100%); }
  100% { transform: translateX(100%); }
}
@keyframes shimmer {
  0% { transform: translateX(-120%); }
  100% { transform: translateX(280%); }
}
@keyframes sonarPulse {
  0% { transform: scale(1); opacity: 0.85; }
  70% { transform: scale(2.4); opacity: 0; }
  100% { transform: scale(2.4); opacity: 0; }
}
@keyframes textShine {
  0% { background-position: 0% center; }
  100% { background-position: 250% center; }
}
@keyframes modalSpringIn {
  from { opacity: 0; transform: scale(0.92) translateY(16px); }
  to { opacity: 1; transform: scale(1) translateY(0); }
}

* {
  box-sizing: border-box;
}

body {
  margin: 0;
  min-height: 100vh;
  background: var(--bg);
  background-image: var(--bg-gradient),
    linear-gradient(rgba(255,255,255,0.02) 1px, transparent 1px),
    linear-gradient(90deg, rgba(255,255,255,0.02) 1px, transparent 1px);
  background-size: auto, 32px 32px, 32px 32px;
  background-attachment: fixed;
  color: var(--text);
  font-family: 'Plus Jakarta Sans', system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
  overflow-x: hidden;
}

h1, h2, h3, p, label {
  margin: 0;
}

button, input, select, textarea {
  font: inherit;
}

button {
  position: relative;
  overflow: hidden;
  border: 1px solid var(--border);
  border-radius: 10px;
  background: linear-gradient(160deg, rgba(28, 40, 58, 0.95) 0%, rgba(18, 28, 44, 0.98) 100%);
  color: var(--text);
  padding: 9px 14px;
  cursor: pointer;
  font-weight: 600;
  font-family: inherit;
  transition: all 0.22s cubic-bezier(0.16, 1, 0.3, 1);
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.3), inset 0 1px 0 rgba(255,255,255,0.07);
  user-select: none;
  letter-spacing: 0.01em;
}

button::after {
  content: '';
  position: absolute;
  top: 0; left: 0;
  width: 45%;
  height: 100%;
  background: linear-gradient(90deg, transparent, rgba(255,255,255,0.12), transparent);
  transform: translateX(-120%);
  transition: transform 0s;
}

button:hover::after {
  transform: translateX(280%);
  transition: transform 0.55s cubic-bezier(0.16, 1, 0.3, 1);
}

button:hover, button:hover:not(:disabled) {
  background: linear-gradient(160deg, rgba(36, 52, 74, 0.98) 0%, rgba(24, 38, 58, 0.99) 100%);
  border-color: rgba(255, 255, 255, 0.16);
  transform: translateY(-1px);
  box-shadow: 0 6px 18px rgba(0, 0, 0, 0.4), inset 0 1px 0 rgba(255,255,255,0.1);
}

button:active, button:active:not(:disabled) {
  transform: scale(0.96) translateY(0);
}

button:focus-visible, input:focus-visible, select:focus-visible, textarea:focus-visible {
  outline: 2px solid var(--cyan);
  outline-offset: 2px;
}

button.primary {
  background: linear-gradient(135deg, #0ea5e9 0%, #2563eb 100%);
  border-color: rgba(56, 189, 248, 0.55);
  box-shadow: 0 4px 16px rgba(14, 165, 233, 0.35), inset 0 1px 0 rgba(255,255,255,0.15);
  color: #fff;
  font-weight: 700;
}

button.primary:hover, button.primary:hover:not(:disabled) {
  background: linear-gradient(135deg, #22b8fc 0%, #3b7ff5 100%);
  border-color: rgba(56, 189, 248, 0.7);
  box-shadow: 0 6px 24px rgba(14, 165, 233, 0.5), inset 0 1px 0 rgba(255,255,255,0.18);
  transform: translateY(-2px);
}

button.danger {
  background: linear-gradient(135deg, #ef4444 0%, #b91c1c 100%);
  border-color: rgba(239, 68, 68, 0.55);
  box-shadow: 0 4px 16px rgba(239, 68, 68, 0.3), inset 0 1px 0 rgba(255,255,255,0.1);
  color: #fff;
  font-weight: 700;
}

button.danger:hover, button.danger:hover:not(:disabled) {
  background: linear-gradient(135deg, #f87171 0%, #dc2626 100%);
  border-color: rgba(239, 68, 68, 0.7);
  box-shadow: 0 6px 24px rgba(239, 68, 68, 0.45), inset 0 1px 0 rgba(255,255,255,0.12);
  transform: translateY(-2px);
}

button:disabled {
  opacity: 0.38;
  cursor: not-allowed;
  transform: none !important;
  filter: grayscale(30%);
}

input, select, textarea {
  width: 100%;
  padding: 10px 12px;
  border-radius: 10px;
  border: 1px solid var(--border);
  background: rgba(7, 12, 22, 0.85);
  color: var(--text);
  outline: none;
  font-family: inherit;
  transition: border-color 0.2s ease, box-shadow 0.2s ease, background 0.2s ease;
  box-shadow: inset 0 2px 4px rgba(0,0,0,0.3);
}

input:focus, select:focus, textarea:focus {
  border-color: var(--cyan);
  background: rgba(7, 12, 22, 0.95);
  box-shadow: 0 0 0 3px rgba(56, 189, 248, 0.22), inset 0 2px 4px rgba(0,0,0,0.3);
}

.app {
  width: min(1360px, calc(100% - 24px));
  margin: 0 auto;
  padding: 12px 0 48px;
}

.topbar, .header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  flex-wrap: wrap;
  gap: 12px;
  margin-bottom: 20px;
}

.page-title {
  font-size: 24px;
  font-weight: 850;
  letter-spacing: -0.02em;
  margin: 0 0 4px;
  background: linear-gradient(135deg, #ffffff 30%, #a5c2eb 100%);
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
}

.page-subtitle {
  color: var(--muted);
  font-size: 13px;
  margin: 0 0 16px;
}

/* Fleet Welcome Header */
.fleet-welcome-header {
  position: relative;
  display: flex;
  justify-content: space-between;
  align-items: center;
  flex-wrap: wrap;
  gap: 16px;
  margin-bottom: 22px;
  padding: 22px 26px;
  background: linear-gradient(135deg, rgba(14, 23, 42, 0.75) 0%, rgba(9, 14, 26, 0.88) 100%);
  backdrop-filter: blur(20px) saturate(160%);
  -webkit-backdrop-filter: blur(20px) saturate(160%);
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 20px;
  box-shadow: 0 16px 40px -8px rgba(0,0,0,0.5), inset 0 1px 0 rgba(255,255,255,0.1);
  overflow: hidden;
  animation: fadeUpIn 0.35s cubic-bezier(0.16, 1, 0.3, 1) both;
}
.fleet-welcome-header::before {
  content: '';
  position: absolute;
  top: -80px;
  left: 20%;
  width: 260px;
  height: 260px;
  border-radius: 50%;
  background: radial-gradient(circle, rgba(56, 189, 248, 0.12) 0%, transparent 70%);
  filter: blur(40px);
  pointer-events: none;
}
.fleet-welcome-title-wrap {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
  margin-bottom: 6px;
}
.fleet-welcome-title {
  font-size: 22px;
  font-weight: 850;
  letter-spacing: -0.02em;
  margin: 0;
  background: linear-gradient(135deg, #ffffff 30%, #93c5fd 100%);
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
}
.fleet-welcome-subtitle {
  color: var(--muted);
  font-size: 13px;
  margin: 0;
  line-height: 1.4;
}
.fleet-welcome-actions {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
  align-items: center;
}

/* Bento KPI Grid */
.kpi-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(185px, 1fr));
  gap: 14px;
  margin-bottom: 22px;
}
.kpi-card {
  position: relative;
  background: rgba(11, 18, 32, 0.82);
  backdrop-filter: blur(20px) saturate(160%);
  -webkit-backdrop-filter: blur(20px) saturate(160%);
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 18px;
  padding: 18px 20px;
  box-shadow: 0 12px 36px -4px rgba(0, 0, 0, 0.5), inset 0 1px 0 rgba(255, 255, 255, 0.09);
  overflow: hidden;
  transition: all 0.28s cubic-bezier(0.16, 1, 0.3, 1);
  display: flex;
  flex-direction: column;
  justify-content: space-between;
  animation: fadeUpIn 0.4s cubic-bezier(0.16, 1, 0.3, 1) both;
}
.kpi-card:nth-child(1) { animation-delay: 0.05s; }
.kpi-card:nth-child(2) { animation-delay: 0.1s; }
.kpi-card:nth-child(3) { animation-delay: 0.15s; }
.kpi-card:nth-child(4) { animation-delay: 0.2s; }
.kpi-card:nth-child(5) { animation-delay: 0.25s; }
.kpi-card:hover {
  transform: translateY(-4px);
  border-color: rgba(56, 189, 248, 0.45);
  box-shadow: 0 20px 48px -4px rgba(0, 0, 0, 0.7), 0 0 28px rgba(56, 189, 248, 0.12), inset 0 1px 0 rgba(255,255,255,0.15);
}
.kpi-card::before {
  content: '';
  position: absolute;
  top: 0; left: 0; right: 0;
  height: 3px;
  background: linear-gradient(90deg, #38bdf8, transparent);
}
.kpi-card::after {
  content: ''; position: absolute; top: 0; left: 0; right: 0; height: 70px;
  background: radial-gradient(ellipse at top, rgba(56, 189, 248, 0.15), transparent 70%);
  pointer-events: none;
}

/* 6 distinct states for 6 KPI cards */
.kpi-card.kpi-total::before { background: linear-gradient(90deg, #38bdf8, transparent); }
.kpi-card.kpi-total::after { background: radial-gradient(ellipse at top, rgba(56, 189, 248, 0.18), transparent 70%); }
.kpi-card.kpi-health::before { background: linear-gradient(90deg, #10b981, transparent); }
.kpi-card.kpi-health::after { background: radial-gradient(ellipse at top, rgba(16, 185, 129, 0.18), transparent 70%); }
.kpi-card.kpi-afk::before { background: linear-gradient(90deg, #34d399, transparent); }
.kpi-card.kpi-afk::after { background: radial-gradient(ellipse at top, rgba(52, 211, 153, 0.18), transparent 70%); }
.kpi-card.kpi-online::before { background: linear-gradient(90deg, #3b82f6, transparent); }
.kpi-card.kpi-online::after { background: radial-gradient(ellipse at top, rgba(59, 130, 246, 0.18), transparent 70%); }
.kpi-card.kpi-offline::before { background: linear-gradient(90deg, #ef4444, transparent); }
.kpi-card.kpi-offline::after { background: radial-gradient(ellipse at top, rgba(239, 68, 68, 0.18), transparent 70%); }
.kpi-card.kpi-unreachable::before { background: linear-gradient(90deg, #f97316, transparent); }
.kpi-card.kpi-unreachable::after { background: radial-gradient(ellipse at top, rgba(249, 115, 22, 0.18), transparent 70%); }

.kpi-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 6px;
}
.kpi-title {
  font-size: 11px;
  font-weight: 750;
  color: var(--muted);
  text-transform: uppercase;
  letter-spacing: 0.05em;
}
.kpi-icon {
  font-size: 18px;
  opacity: 0.85;
}
.kpi-value {
  font-size: 28px;
  font-weight: 900;
  letter-spacing: -0.02em;
  margin: 3px 0;
  line-height: 1.1;
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-variant-numeric: tabular-nums;
}
.kpi-sub {
  font-size: 11px;
  color: var(--muted);
  margin-top: 4px;
}

/* Fleet Command Center Toolbar */
.fleet-toolbar {
  display: flex;
  justify-content: space-between;
  align-items: center;
  flex-wrap: wrap;
  gap: 10px;
  margin-bottom: 14px;
  background: rgba(9, 16, 28, 0.72);
  backdrop-filter: blur(16px) saturate(150%);
  -webkit-backdrop-filter: blur(16px) saturate(150%);
  border: 1px solid rgba(255, 255, 255, 0.07);
  border-radius: 14px;
  padding: 11px 15px;
  box-shadow: 0 6px 20px rgba(0,0,0,0.3), inset 0 1px 0 rgba(255,255,255,0.06);
}
.fleet-toolbar-primary {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
  align-items: center;
}
.fleet-toolbar-tools {
  display: flex;
  gap: 7px;
  flex-wrap: wrap;
  align-items: center;
}
.warning-btn {
  background: rgba(234, 179, 8, 0.15) !important;
  border-color: rgba(234, 179, 8, 0.35) !important;
  color: #facc15 !important;
}
.warning-btn:hover {
  background: rgba(234, 179, 8, 0.25) !important;
  color: #fff !important;
}

.fleet-search-filter-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  flex-wrap: wrap;
  gap: 12px;
  margin-bottom: 20px;
}
.fleet-search-sort-wrap {
  display: flex;
  gap: 8px;
  align-items: center;
  flex: 1;
  justify-content: flex-end;
  min-width: 280px;
}
.sort-select {
  width: auto;
  min-width: 170px;
  cursor: pointer;
  background: rgba(14, 21, 31, 0.85);
}

.search-box {
  flex: 1;
  min-width: 230px;
}

/* Status Filter Tabs */
.filter-tabs {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}

.tab-btn {
  padding: 8px 14px;
  border-radius: 10px;
  font-size: 12px;
  font-weight: 650;
  border: 1px solid var(--border);
  background: rgba(14, 21, 31, 0.65);
  color: var(--muted);
  cursor: pointer;
  transition: all 0.18s cubic-bezier(0.16, 1, 0.3, 1);
}

.tab-btn:hover {
  background: rgba(25, 36, 52, 0.85);
  color: var(--text);
  transform: translateY(-1px);
}

.tab-btn.active {
  background: linear-gradient(135deg, rgba(14, 165, 233, 0.25) 0%, rgba(37, 99, 235, 0.2) 100%);
  color: #7dd3fc;
  border-color: rgba(56, 189, 248, 0.5);
  box-shadow: 0 2px 12px rgba(14, 165, 233, 0.25), inset 0 1px 0 rgba(255,255,255,0.08);
  font-weight: 700;
}

/* Grids & Panels */
.bot-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(320px, 1fr));
  gap: 16px;
  width: 100%;
  box-sizing: border-box;
  align-items: stretch;
}

.panel {
  border: 1px solid var(--border);
  border-radius: 16px;
  background: rgba(10, 18, 32, 0.94);
  padding: 16px;
  box-shadow: 0 12px 36px -4px rgba(0, 0, 0, 0.5), inset 0 1px 0 0 rgba(255, 255, 255, 0.08);
  transition: transform 0.28s cubic-bezier(0.16, 1, 0.3, 1), border-color 0.28s, box-shadow 0.28s;
}

.bot-card {
  position: relative;
  width: 100%;
  max-width: 100%;
  box-sizing: border-box;
  background: #090e1a;
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 18px;
  padding: 14px 16px;
  box-shadow: 0 12px 36px -4px rgba(0, 0, 0, 0.5), inset 0 1px 0 rgba(255, 255, 255, 0.08);
  cursor: pointer;
  display: flex;
  flex-direction: column;
  transition: transform 0.28s cubic-bezier(0.16, 1, 0.3, 1), border-color 0.28s, box-shadow 0.28s;
  overflow: hidden;
  min-height: 250px;
  animation: fadeUpIn 0.35s cubic-bezier(0.16, 1, 0.3, 1) both;
}

.bot-card:hover {
  border-color: rgba(56, 189, 248, 0.45);
  transform: translateY(-3px);
  box-shadow: 0 20px 50px -4px rgba(0, 0, 0, 0.65), 0 0 28px rgba(56, 189, 248, 0.14), inset 0 1px 0 rgba(255,255,255,0.12);
}

.bot-card.status-afk {
  border-left: 3px solid #10b981;
  box-shadow: 0 12px 36px -4px rgba(0, 0, 0, 0.5), inset 3px 0 14px rgba(16, 185, 129, 0.16);
}
.bot-card.status-waiting {
  border-left: 3px solid #f59e0b;
  box-shadow: 0 12px 36px -4px rgba(0, 0, 0, 0.5), inset 3px 0 14px rgba(245, 158, 11, 0.16);
}
.bot-card.status-offline {
  border-left: 3px solid #ef4444;
  box-shadow: 0 12px 36px -4px rgba(0, 0, 0, 0.5), inset 3px 0 14px rgba(239, 68, 68, 0.16);
}
.bot-card.status-unreachable {
  border-left: 3px solid #f97316;
  box-shadow: 0 12px 36px -4px rgba(0, 0, 0, 0.5), inset 3px 0 14px rgba(249, 115, 22, 0.16);
}

.bot-card-topbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 6px;
  margin-bottom: 8px;
}
.bot-card-title-group {
  display: flex;
  align-items: center;
  gap: 7px;
  min-width: 0;
  flex: 1;
}
.bot-id-chip {
  font-size: 11px;
  font-weight: 800;
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-variant-numeric: tabular-nums;
  background: rgba(56, 189, 248, 0.15);
  color: #38bdf8;
  border: 1px solid rgba(56, 189, 248, 0.3);
  border-radius: 6px;
  padding: 2px 7px;
  flex-shrink: 0;
}
.bot-card-name {
  font-size: 15px;
  font-weight: 800;
  color: #fff;
  margin: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.bot-card-admin-actions {
  display: flex;
  gap: 4px;
  flex-shrink: 0;
}
.bot-mini-btn {
  font-size: 10px;
  font-weight: 700;
  padding: 3px 7px;
  border-radius: 6px;
  background: rgba(255, 255, 255, 0.06);
  border: 1px solid rgba(255, 255, 255, 0.1);
  color: #cbd5e1;
  cursor: pointer;
  transition: all 0.15s;
}
.bot-mini-btn:hover {
  background: rgba(255, 255, 255, 0.14);
  color: #fff;
}
.bot-mini-btn.danger {
  background: rgba(239, 68, 68, 0.12);
  border-color: rgba(239, 68, 68, 0.3);
  color: #f87171;
}
.bot-mini-btn.danger:hover {
  background: #ef4444;
  color: #fff;
}

.bot-status-strip {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
  margin-bottom: 8px;
  padding-bottom: 6px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.05);
}
.bot-status-pill {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  font-size: 10.5px;
  font-weight: 750;
  padding: 2px 7px;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.06);
}
.bot-status-pill.green {
  background: rgba(48, 209, 88, 0.14);
  color: #4ade80;
  border: 1px solid rgba(48, 209, 88, 0.35);
}
.bot-status-pill.yellow {
  background: rgba(234, 179, 8, 0.14);
  color: #facc15;
  border: 1px solid rgba(234, 179, 8, 0.35);
}
.bot-status-pill.red {
  background: rgba(239, 68, 68, 0.14);
  color: #f87171;
  border: 1px solid rgba(239, 68, 68, 0.35);
}
.bot-status-pill.orange, .bot-status-pill.warning {
  background: rgba(249, 115, 22, 0.16);
  color: #fb923c;
  border: 1px solid rgba(249, 115, 22, 0.45);
}
.bot-status-pill.purple, .bot-status-pill.sleep {
  background: rgba(168, 85, 247, 0.16);
  color: #c084fc;
  border: 1px solid rgba(168, 85, 247, 0.45);
}
.bot-status-pill.blue {
  background: rgba(56, 189, 248, 0.14);
  color: #38bdf8;
  border: 1px solid rgba(56, 189, 248, 0.35);
}
.bot-status-pill.gray {
  background: rgba(148, 163, 184, 0.12);
  color: #94a3b8;
  border: 1px solid rgba(148, 163, 184, 0.3);
}
.pulse-status-dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  display: inline-block;
  position: relative;
  flex-shrink: 0;
}
.pulse-status-dot::after {
  content: '';
  position: absolute;
  inset: 0;
  border-radius: 50%;
  animation: sonarPulse 2.2s ease-out infinite;
}
.pulse-status-dot.green { background: #10b981; box-shadow: 0 0 7px #10b981; }
.pulse-status-dot.green::after { background: #10b981; }
.pulse-status-dot.yellow { background: #f59e0b; box-shadow: 0 0 7px #f59e0b; }
.pulse-status-dot.yellow::after { background: #f59e0b; animation-duration: 1.8s; }
.pulse-status-dot.red { background: #ef4444; box-shadow: 0 0 7px #ef4444; }
.pulse-status-dot.red::after { background: #ef4444; animation-duration: 2.5s; }
.pulse-status-dot.orange, .pulse-status-dot.warning { background: #f97316; box-shadow: 0 0 7px #f97316; }
.pulse-status-dot.orange::after, .pulse-status-dot.warning::after { background: #f97316; animation-duration: 2s; }
.pulse-status-dot.purple, .pulse-status-dot.sleep { background: #a855f7; box-shadow: 0 0 7px #a855f7; }
.pulse-status-dot.purple::after, .pulse-status-dot.sleep::after { background: #a855f7; animation-duration: 3s; }
.pulse-status-dot.blue { background: #38bdf8; box-shadow: 0 0 7px #38bdf8; }
.pulse-status-dot.blue::after { background: #38bdf8; animation-duration: 2.8s; }
.pulse-status-dot.gray { background: #64748b; box-shadow: none; }
.pulse-status-dot.gray::after { display: none; }

.bot-error-action-banner {
  margin: 6px 0 10px;
  padding: 8px 10px;
  border-radius: 8px;
  font-size: 11.5px;
  line-height: 1.4;
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 8px;
  min-height: 48px;
  box-sizing: border-box;
}
.bot-error-action-banner.warning {
  background: rgba(249, 115, 22, 0.12);
  border: 1px solid rgba(249, 115, 22, 0.35);
  color: #fb923c;
}
.bot-error-action-banner.sleep {
  background: rgba(168, 85, 247, 0.12);
  border: 1px solid rgba(168, 85, 247, 0.35);
  color: #c084fc;
}
.bot-error-action-banner.danger {
  background: rgba(239, 68, 68, 0.12);
  border: 1px solid rgba(239, 68, 68, 0.35);
  color: #f87171;
}
.bot-error-text {
  flex: 1;
  min-width: 140px;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
  text-overflow: ellipsis;
  word-break: break-word;
}
.bot-action-chip {
  padding: 3px 8px;
  font-size: 11px;
  font-weight: 700;
  border-radius: 6px;
  cursor: pointer;
  border: 1px solid rgba(255, 255, 255, 0.2);
  background: rgba(255, 255, 255, 0.08);
  color: #fff;
  white-space: nowrap;
  transition: all 0.2s ease;
}
.bot-action-chip:hover {
  background: rgba(255, 255, 255, 0.18);
}
.bot-action-chip.warning {
  background: rgba(249, 115, 22, 0.25);
  border-color: rgba(249, 115, 22, 0.5);
  color: #ffedd5;
}
.bot-action-chip.warning:hover {
  background: rgba(249, 115, 22, 0.4);
}
.bot-action-chip.danger {
  background: rgba(239, 68, 68, 0.25);
  border-color: rgba(239, 68, 68, 0.5);
  color: #fee2e2;
}
.bot-action-chip.danger:hover {
  background: rgba(239, 68, 68, 0.4);
}
.bot-action-chip.info {
  background: rgba(56, 189, 248, 0.25);
  border-color: rgba(56, 189, 248, 0.5);
  color: #e0f2fe;
}
.bot-action-chip.info:hover {
  background: rgba(56, 189, 248, 0.4);
}
.spinner-sm {
  display: inline-block;
  width: 13px;
  height: 13px;
  border: 2px solid rgba(255, 255, 255, 0.25);
  border-top-color: currentColor;
  border-radius: 50%;
  animation: spin 0.75s linear infinite;
  vertical-align: middle;
}
@keyframes spin {
  to { transform: rotate(360deg); }
}

.eco-badge-glow {
  font-size: 9.5px;
  font-weight: 800;
  padding: 2px 5px;
  border-radius: 5px;
  background: rgba(34, 197, 94, 0.15);
  color: #4ade80;
  border: 1px solid rgba(34, 197, 94, 0.35);
  box-shadow: 0 0 8px rgba(34, 197, 94, 0.2);
}
.bot-owner-wrap {
  margin-left: auto;
  display: flex;
  align-items: center;
}
.bot-owner-pill {
  font-size: 10px;
  font-weight: 700;
  padding: 2px 6px;
  border-radius: 6px;
  display: inline-flex;
  align-items: center;
  gap: 4px;
}
.bot-owner-pill.rented {
  background: rgba(56, 189, 248, 0.14);
  color: #38bdf8;
  border: 1px solid rgba(56, 189, 248, 0.32);
}
.bot-owner-pill.free {
  background: rgba(148, 163, 184, 0.12);
  color: #94a3b8;
  border: 1px solid rgba(148, 163, 184, 0.25);
}

.bot-ingame-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 6px;
  margin-bottom: 8px;
  background: rgba(0, 0, 0, 0.25);
  padding: 5px 8px;
  border-radius: 7px;
  border: 1px solid rgba(255, 255, 255, 0.04);
  font-size: 11.5px;
}
.bot-ingame-user {
  display: flex;
  align-items: center;
  gap: 5px;
  font-weight: 700;
  color: #f1f5f9;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  min-width: 0;
  flex: 1;
}
.bot-ip-pill {
  display: flex;
  align-items: center;
  gap: 4px;
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-variant-numeric: tabular-nums;
  font-size: 10.5px;
  color: #c084fc;
  cursor: pointer;
  padding: 2px 7px;
  border-radius: 5px;
  background: rgba(192, 132, 252, 0.1);
  border: 1px solid rgba(192, 132, 252, 0.25);
  transition: all 0.15s;
  max-width: 170px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  flex-shrink: 0;
}
.bot-ip-pill:hover {
  background: rgba(192, 132, 252, 0.22);
  border-color: #c084fc;
}

.bot-vitals-matrix {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 6px;
  margin-bottom: 8px;
}
.vital-card {
  background: rgba(255, 255, 255, 0.03);
  border: 1px solid rgba(255, 255, 255, 0.06);
  border-radius: 10px;
  padding: 7px 10px;
  display: flex;
  flex-direction: column;
  justify-content: space-between;
  transition: all 0.2s cubic-bezier(0.16, 1, 0.3, 1);
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.03);
}
.vital-card:hover {
  background: rgba(255, 255, 255, 0.05);
  border-color: rgba(56, 189, 248, 0.25);
}
.vital-label-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  font-size: 10.5px;
  margin-bottom: 3px;
}
.vital-label {
  font-size: 9.5px;
  font-weight: 750;
  color: var(--muted);
  letter-spacing: 0.3px;
}
.vital-val {
  font-size: 12px;
  font-weight: 800;
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-variant-numeric: tabular-nums;
}
.hp-bar-track {
  width: 100%;
  height: 5px;
  background: rgba(255, 255, 255, 0.08);
  border-radius: 999px;
  overflow: hidden;
  margin-top: 3px;
  box-shadow: inset 0 1px 2px rgba(0,0,0,0.4);
}
.hp-bar-fill {
  height: 100%;
  border-radius: 999px;
  transition: width 0.35s cubic-bezier(0.16, 1, 0.3, 1), background-color 0.35s ease;
  box-shadow: 0 0 10px currentColor;
  position: relative;
  overflow: hidden;
}
.hp-bar-fill::after {
  content: '';
  position: absolute;
  inset: 0;
  background: linear-gradient(90deg, transparent, rgba(255,255,255,0.35), transparent);
  animation: barShimmer 2.4s ease-in-out infinite;
}
.totem-warning-badge {
  font-size: 9.5px;
  font-weight: 800;
  color: #f87171;
  background: rgba(239, 68, 68, 0.15);
  border-radius: 4px;
  padding: 1px 4px;
  display: inline-block;
  width: fit-content;
  margin-top: 1px;
}
.totem-ok-badge {
  font-size: 9.5px;
  font-weight: 700;
  color: #4ade80;
  background: rgba(74, 222, 128, 0.12);
  border-radius: 4px;
  padding: 1px 4px;
  display: inline-block;
  width: fit-content;
  margin-top: 1px;
}
.sparkline-container {
  height: 12px;
  margin-top: 2px;
  display: flex;
  align-items: center;
  justify-content: flex-end;
}
.vital-sub-info {
  font-size: 9px;
  color: var(--muted);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  margin-top: 1px;
}
.bot-kick-notice {
  background: rgba(234, 179, 8, 0.12);
  border: 1px solid rgba(234, 179, 8, 0.3);
  border-radius: 7px;
  padding: 5px 8px;
  font-size: 10.5px;
  color: #facc15;
  margin-bottom: 7px;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
  text-overflow: ellipsis;
  word-break: break-word;
}
.bot-ram-meter-box {
  background: rgba(0, 0, 0, 0.2);
  border: 1px solid rgba(255, 255, 255, 0.05);
  border-radius: 7px;
  padding: 5px 8px;
  margin-bottom: 8px;
  font-size: 10px;
}
.bot-ram-meter-labels {
  display: flex;
  justify-content: space-between;
  color: var(--muted);
  margin-bottom: 3px;
}
.ram-meter-track {
  width: 100%;
  height: 5px;
  background: rgba(255, 255, 255, 0.08);
  border-radius: 999px;
  overflow: hidden;
  box-shadow: inset 0 1px 2px rgba(0,0,0,0.4);
}
.ram-meter-bar-fill {
  height: 100%;
  border-radius: 999px;
  transition: width 0.35s cubic-bezier(0.16, 1, 0.3, 1), background-color 0.35s ease;
  box-shadow: 0 0 10px currentColor;
}
.card-quick-actions {
  display: flex;
  gap: 6px;
  margin-top: auto;
  padding-top: 10px;
  border-top: 1px solid rgba(255, 255, 255, 0.06);
}
.card-quick-actions .card-btn {
  flex: 1;
  font-size: 11px;
  font-weight: 750;
  padding: 6px 4px;
  border-radius: 8px;
  text-align: center;
  transition: all 0.2s cubic-bezier(0.16, 1, 0.3, 1);
  box-shadow: 0 2px 6px rgba(0,0,0,0.25), inset 0 1px 0 rgba(255,255,255,0.06);
}
.card-quick-actions .card-btn:hover {
  transform: translateY(-1.5px);
  box-shadow: 0 4px 12px rgba(0,0,0,0.35), inset 0 1px 0 rgba(255,255,255,0.1);
}
.detail-link-btn {
  background: rgba(56, 189, 248, 0.12) !important;
  border-color: rgba(56, 189, 248, 0.3) !important;
  color: #38bdf8 !important;
}
.detail-link-btn:hover {
  background: #0284c7 !important;
  border-color: #38bdf8 !important;
  color: #fff !important;
}
.back-btn {
  background: rgba(56, 189, 248, 0.15) !important;
  border-color: rgba(56, 189, 248, 0.35) !important;
  color: #38bdf8 !important;
  font-weight: 750 !important;
}
.back-btn:hover {
  background: rgba(56, 189, 248, 0.3) !important;
  color: #fff !important;
}

.small {
  font-size: 11px;
  padding: 7px 10px;
}

/* Sound Alert Toggle Button */
.sound-btn {
  font-size: 11px;
  padding: 7px 12px;
  border-radius: 9px;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-weight: 600;
}

.sound-btn.active {
  border-color: var(--green);
  color: var(--green);
  background: rgba(48, 209, 88, 0.12);
  box-shadow: 0 0 8px var(--green-glow);
}

/* Capacity Badge */
.capacity-badge {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 11px;
  font-weight: 750;
  padding: 5px 10px;
  border-radius: 8px;
  background: rgba(255, 255, 255, 0.05);
  border: 1px solid var(--border);
}

.capacity-badge.warning {
  border-color: var(--yellow);
  color: var(--yellow);
  background: rgba(255, 214, 10, 0.12);
}

.capacity-badge.danger {
  border-color: var(--red);
  color: var(--red);
  background: rgba(255, 69, 58, 0.14);
}

/* Modals */
.modal {
  position: fixed;
  inset: 0;
  background: rgba(2, 6, 18, 0.8);
  backdrop-filter: blur(12px);
  -webkit-backdrop-filter: blur(12px);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 16px;
  z-index: 1000;
}

@keyframes modalZoomIn {
  from { opacity: 0; transform: scale(0.93) translateY(12px); }
  to { opacity: 1; transform: scale(1) translateY(0); }
}

.modal-card {
  width: min(540px, 100%);
  max-height: calc(100vh - 32px);
  overflow-y: auto;
  overscroll-behavior: contain;
  background: rgba(8, 14, 26, 0.96);
  border: 1px solid rgba(56, 189, 248, 0.35);
  border-radius: 22px;
  padding: 26px;
  box-shadow: 0 32px 80px rgba(0, 0, 0, 0.85), 0 0 45px rgba(56, 189, 248, 0.12), inset 0 1px 0 rgba(255, 255, 255, 0.12);
  backdrop-filter: blur(24px) saturate(180%);
  -webkit-backdrop-filter: blur(24px) saturate(180%);
  animation: modalSpringIn 0.35s cubic-bezier(0.22, 1, 0.36, 1);
}

.modal-card h3 {
  margin: 0 0 16px;
  font-size: 18px;
  font-weight: 750;
}

.form-row {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin-bottom: 12px;
}

.form-row label {
  color: var(--muted);
  font-size: 11px;
  font-weight: 600;
}

.modal-actions {
  display: flex;
  justify-content: flex-end;
  gap: 10px;
  margin-top: 18px;
}

.modal-card.modal-lg {
  width: min(880px, 98vw);
  max-height: 88vh;
  overflow-y: auto;
}

/* User Mode restrictions */
.user-mode .admin-only {
  display: none !important;
}

/* Login Gate Styles */
.login-gate {
  position: fixed;
  inset: 0;
  background: var(--bg);
  background-image: var(--bg-gradient);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 99999;
  padding: 18px;
}

.login-card {
  width: min(440px, 100%);
  background: rgba(15, 23, 42, 0.95);
  border: 1px solid rgba(56, 189, 248, 0.28);
  border-radius: 22px;
  padding: 34px 26px;
  box-shadow: 0 25px 70px rgba(0, 0, 0, 0.8), 0 0 35px rgba(56, 189, 248, 0.15);
  backdrop-filter: blur(16px);
  -webkit-backdrop-filter: blur(16px);
  animation: modalZoomIn 0.25s cubic-bezier(0.16, 1, 0.3, 1);
}

.login-header {
  text-align: center;
  margin-bottom: 22px;
}

.login-icon {
  font-size: 38px;
  margin-bottom: 8px;
  display: inline-block;
  filter: drop-shadow(0 0 14px rgba(56, 189, 248, 0.5));
}

.login-title {
  font-size: 20px;
  font-weight: 800;
  letter-spacing: 0.5px;
  color: #fff;
  margin: 0 0 6px;
}

.login-subtitle {
  font-size: 11.5px;
  color: var(--muted);
  line-height: 1.4;
}

.login-alert {
  padding: 10px 14px;
  border-radius: 8px;
  font-size: 12px;
  font-weight: 600;
  margin-bottom: 14px;
  display: flex;
  align-items: center;
  gap: 8px;
}
.login-alert.error {
  background: rgba(255, 69, 58, 0.15);
  border: 1px solid rgba(255, 69, 58, 0.4);
  color: #ff8580;
}
.login-alert.success {
  background: rgba(48, 209, 88, 0.15);
  border: 1px solid rgba(48, 209, 88, 0.4);
  color: #5be37f;
}

.password-input-wrap {
  position: relative;
  display: flex;
  align-items: center;
}
.password-input-wrap input {
  padding-right: 42px;
  width: 100%;
}
.password-toggle-btn {
  position: absolute;
  right: 8px;
  background: transparent !important;
  border: none !important;
  color: var(--muted) !important;
  padding: 4px 6px !important;
  cursor: pointer;
  box-shadow: none !important;
  font-size: 14px;
}

/* User Management Tables & Badges */
.user-table-wrap {
  margin: 14px 0;
  overflow-x: auto;
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 16px;
  background: rgba(7, 12, 22, 0.7);
  box-shadow: 0 8px 30px rgba(0, 0, 0, 0.35), inset 0 1px 0 rgba(255, 255, 255, 0.06);
}
.user-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 12.5px;
  text-align: left;
}
.user-table th {
  background: rgba(12, 19, 34, 0.98);
  position: sticky;
  top: 0;
  z-index: 2;
  padding: 13px 16px;
  color: var(--muted);
  font-weight: 750;
  font-size: 11px;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  border-bottom: 1px solid rgba(255, 255, 255, 0.1);
  white-space: nowrap;
}
.user-table td {
  padding: 13px 16px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.04);
  vertical-align: middle;
  transition: background 0.18s cubic-bezier(0.16, 1, 0.3, 1);
}
.user-table tr:last-child td {
  border-bottom: none;
}
.user-table tr:hover td {
  background: rgba(56, 189, 248, 0.06);
}

.bot-checkbox-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(210px, 1fr));
  gap: 8px;
  max-height: 220px;
  overflow-y: auto;
  padding: 10px;
  background: rgba(0,0,0,0.3);
  border: 1px solid var(--border);
  border-radius: 10px;
  margin: 8px 0;
}
.bot-check-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 7px 10px;
  background: rgba(255,255,255,0.04);
  border: 1px solid rgba(255,255,255,0.08);
  border-radius: 8px;
  cursor: pointer;
  font-size: 11.5px;
  transition: all 0.15s ease;
}
.bot-check-item:hover {
  background: rgba(56,189,248,0.1);
  border-color: rgba(56,189,248,0.3);
}
.bot-check-item input[type="checkbox"] {
  cursor: pointer;
  accent-color: var(--blue);
}

/* User Announcement Popup (Modal) */
.user-announcement-card {
  width: min(580px, 95vw);
  background: radial-gradient(circle at 10% 10%, rgba(26, 42, 66, 0.95) 0%, rgba(15, 23, 42, 0.98) 100%);
  border: 1px solid rgba(56, 189, 248, 0.45);
  border-radius: 24px;
  box-shadow: 0 35px 90px rgba(0, 0, 0, 0.85), 0 0 50px rgba(56, 189, 248, 0.25);
  backdrop-filter: blur(24px);
  -webkit-backdrop-filter: blur(24px);
  padding: 28px 24px 22px;
  animation: modalZoomIn 0.28s cubic-bezier(0.16, 1, 0.3, 1);
}
.user-announcement-header {
  display: flex;
  align-items: flex-start;
  gap: 16px;
  margin-bottom: 18px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.08);
  padding-bottom: 16px;
}
.announcement-bell-badge {
  font-size: 34px;
  background: rgba(56, 189, 248, 0.15);
  border: 1px solid rgba(56, 189, 248, 0.35);
  width: 56px;
  height: 56px;
  border-radius: 18px;
  display: flex;
  align-items: center;
  justify-content: center;
  filter: drop-shadow(0 0 16px rgba(56, 189, 248, 0.5));
  flex-shrink: 0;
  animation: bellFloat 3s ease-in-out infinite;
}
@keyframes bellFloat {
  0%, 100% { transform: translateY(0); }
  50% { transform: translateY(-4px); }
}
.announcement-badge-pill {
  font-size: 10px;
  font-weight: 850;
  color: #fbbf24;
  background: rgba(245, 158, 11, 0.18);
  border: 1px solid rgba(245, 158, 11, 0.38);
  padding: 3px 9px;
  border-radius: 999px;
  display: inline-block;
  margin-bottom: 6px;
  letter-spacing: 0.5px;
}
.announcement-main-title {
  font-size: 20px;
  font-weight: 850;
  color: #fff;
  margin: 0 0 4px;
  line-height: 1.3;
}
.announcement-sub-date {
  font-size: 11px;
  color: var(--muted);
}
.announcement-close-btn {
  background: rgba(255, 255, 255, 0.08) !important;
  border: 1px solid rgba(255, 255, 255, 0.12) !important;
  color: var(--muted) !important;
  width: 32px;
  height: 32px;
  padding: 0 !important;
  border-radius: 10px !important;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  transition: all 0.2s ease;
}
.announcement-close-btn:hover {
  background: rgba(255, 69, 58, 0.2) !important;
  border-color: rgba(255, 69, 58, 0.4) !important;
  color: #ff8580 !important;
}
.user-announcement-body {
  max-height: 52vh;
  overflow-y: auto;
  padding: 16px 18px;
  background: rgba(0, 0, 0, 0.35);
  border: 1px solid rgba(255, 255, 255, 0.06);
  border-radius: 14px;
  font-size: 13.5px;
  line-height: 1.7;
  color: #e2e8f0;
  white-space: pre-wrap;
  word-break: break-word;
  margin-bottom: 18px;
}
.user-announcement-footer {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
}
.announcement-freq-note {
  font-size: 11.5px;
  color: var(--muted);
  display: flex;
  align-items: center;
  gap: 6px;
}
.announcement-ack-btn {
  padding: 12px 24px !important;
  font-size: 13.5px !important;
  font-weight: 800 !important;
  letter-spacing: 0.5px;
  border-radius: 12px !important;
  background: linear-gradient(135deg, #0284c7 0%, #2563eb 50%, #4f46e5 100%) !important;
  box-shadow: 0 0 20px rgba(37, 99, 235, 0.4) !important;
  transition: all 0.2s ease !important;
}
.announcement-ack-btn:hover {
  transform: translateY(-2px);
  box-shadow: 0 0 28px rgba(37, 99, 235, 0.6) !important;
}

/* User Profile Menu & Dropdown */
.user-profile-menu-wrap {
  position: relative;
  display: inline-block;
  margin-left: auto;
}

.user-profile-btn {
  display: flex !important;
  align-items: center !important;
  gap: 8px !important;
  padding: 6px 12px !important;
  border-radius: 999px !important;
  background: rgba(255, 255, 255, 0.06) !important;
  border: 1px solid rgba(255, 255, 255, 0.15) !important;
  color: #fff !important;
  font-size: 12.5px !important;
  font-weight: 750 !important;
  cursor: pointer !important;
  transition: all 0.2s cubic-bezier(0.16, 1, 0.3, 1) !important;
  user-select: none;
}

.user-profile-btn:hover {
  background: rgba(56, 189, 248, 0.15) !important;
  border-color: rgba(56, 189, 248, 0.45) !important;
  box-shadow: 0 0 14px rgba(56, 189, 248, 0.25) !important;
  transform: translateY(-1px);
}

.user-avatar-badge {
  font-size: 14px;
  width: 22px;
  height: 22px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(255, 255, 255, 0.1);
}

.user-profile-name {
  max-width: 120px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.user-profile-arrow {
  font-size: 10px;
  color: var(--muted);
  transition: transform 0.2s ease;
}

.user-profile-dropdown {
  position: absolute;
  top: calc(100% + 8px);
  right: 0;
  left: auto;
  transform-origin: top right;
  width: 250px;
  max-width: calc(100vw - 24px);
  background: rgba(15, 23, 42, 0.96);
  backdrop-filter: blur(20px);
  -webkit-backdrop-filter: blur(20px);
  border: 1px solid rgba(56, 189, 248, 0.35);
  border-radius: 16px;
  box-shadow: 0 20px 45px rgba(0, 0, 0, 0.7), 0 0 25px rgba(56, 189, 248, 0.15);
  padding: 12px;
  z-index: 150;
  animation: modalZoomIn 0.18s cubic-bezier(0.16, 1, 0.3, 1);
}

.profile-dropdown-header {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 6px 6px 10px;
}

.profile-dropdown-avatar {
  font-size: 24px;
  width: 42px;
  height: 42px;
  border-radius: 12px;
  background: rgba(56, 189, 248, 0.15);
  border: 1px solid rgba(56, 189, 248, 0.3);
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}

.profile-dropdown-info {
  flex: 1;
  min-width: 0;
}

.profile-dropdown-user {
  font-size: 14px;
  font-weight: 800;
  color: #fff;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.profile-dropdown-role {
  font-size: 11px;
  font-weight: 700;
  color: #38bdf8;
  margin-top: 2px;
}

.profile-dropdown-divider {
  height: 1px;
  background: rgba(255, 255, 255, 0.08);
  margin: 6px 0;
}

.profile-dropdown-menu {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.profile-menu-item {
  display: flex !important;
  align-items: center !important;
  gap: 10px !important;
  width: 100% !important;
  padding: 9px 12px !important;
  border-radius: 10px !important;
  background: transparent !important;
  border: 1px solid transparent !important;
  color: #e2e8f0 !important;
  font-size: 12.5px !important;
  font-weight: 650 !important;
  text-align: left !important;
  cursor: pointer !important;
  transition: all 0.15s ease !important;
  box-shadow: none !important;
}

.profile-menu-item:hover {
  background: rgba(255, 255, 255, 0.08) !important;
  border-color: rgba(255, 255, 255, 0.12) !important;
  color: #fff !important;
}

.profile-menu-item.danger:hover {
  background: rgba(255, 69, 58, 0.18) !important;
  border-color: rgba(255, 69, 58, 0.35) !important;
  color: #ff8580 !important;
}

/* Pulsing Status Indicators */
@keyframes pulseGreen {
  0%, 100% { transform: scale(1); box-shadow: 0 0 0 0 rgba(48, 209, 88, 0.7); }
  50% { transform: scale(1.15); box-shadow: 0 0 12px 3px rgba(48, 209, 88, 0.4); }
}

@keyframes pulseYellow {
  0%, 100% { transform: scale(1); box-shadow: 0 0 0 0 rgba(255, 214, 10, 0.7); }
  50% { transform: scale(1.15); box-shadow: 0 0 12px 3px rgba(255, 214, 10, 0.4); }
}

@keyframes pulseRed {
  0%, 100% { transform: scale(1); box-shadow: 0 0 0 0 rgba(255, 69, 58, 0.7); }
  50% { transform: scale(1.15); box-shadow: 0 0 12px 3px rgba(255, 69, 58, 0.4); }
}

.status-line {
  display: flex;
  align-items: center;
  gap: 8px;
  font-weight: 700;
  margin-bottom: 12px;
}

.dot {
  width: 9px;
  height: 9px;
  border-radius: 50%;
  display: inline-block;
  background: #4b5a6e;
  position: relative;
  transition: all 0.25s ease;
  flex-shrink: 0;
}

.dot::after {
  content: '';
  position: absolute;
  inset: 0;
  border-radius: 50%;
  animation: sonarPulse 2.2s ease-out infinite;
  opacity: 0;
}

.dot.green {
  background: var(--green);
  box-shadow: 0 0 6px var(--green);
}
.dot.green::after { background: var(--green); }

.dot.yellow {
  background: var(--yellow);
  box-shadow: 0 0 6px var(--yellow);
}
.dot.yellow::after { background: var(--yellow); animation-duration: 1.8s; }

.dot.red {
  background: var(--red);
  box-shadow: 0 0 6px var(--red);
}
.dot.red::after { background: var(--red); animation-duration: 2.5s; }

.dot.blue {
  background: var(--blue);
  box-shadow: 0 0 6px var(--blue);
}
.dot.blue::after { background: var(--blue); animation-duration: 3s; }

.dot.gray {
  background: #64748b;
}
.dot.gray::after { display: none; }

.summary-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 8px;
}

.summary-item {
  padding: 9px 10px;
  border-radius: 10px;
  background: var(--card2);
  min-width: 0;
  border: 1px solid rgba(255, 255, 255, 0.04);
}

.summary-label {
  color: var(--muted);
  font-size: 9px;
  font-weight: 600;
  margin-bottom: 4px;
  text-transform: uppercase;
}

.summary-value {
  font-size: 12px;
  font-weight: 700;
  word-break: break-word;
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-variant-numeric: tabular-nums;
}

/* Detail Page Layout */
.detail-header {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 20px;
}

.detail-header .title-wrap {
  flex: 1;
}

.detail-title {
  font-size: 24px;
  font-weight: 850;
  margin: 0;
}

.detail-subtitle {
  color: var(--muted);
  font-size: 13px;
  margin-top: 4px;
}

.grid {
  display: grid;
  grid-template-columns: 1.15fr 0.85fr;
  gap: 18px;
}

.panel h3 {
  font-size: 15px;
  font-weight: 750;
  margin: 0 0 14px;
  letter-spacing: -0.01em;
}

.big-status {
  display: flex;
  align-items: center;
  gap: 10px;
  font-size: 18px;
  font-weight: 800;
  margin-bottom: 14px;
}

.info {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 10px;
}

.info-item {
  padding: 10px 12px;
  border-radius: 11px;
  background: var(--card2);
  border: 1px solid rgba(255, 255, 255, 0.04);
}

.info-label {
  color: var(--muted);
  font-size: 10px;
  font-weight: 600;
  margin-bottom: 4px;
  text-transform: uppercase;
}

.info-value {
  font-size: 14px;
  font-weight: 700;
  word-break: break-word;
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-variant-numeric: tabular-nums;
}

.controls {
  display: flex;
  gap: 10px;
  flex-wrap: wrap;
  margin-top: 16px;
  padding-top: 14px;
  border-top: 1px solid rgba(255, 255, 255, 0.06);
}

.controls button {
  flex: 1;
  min-width: 100px;
  padding: 10px 14px;
  font-size: 13px;
  font-weight: 750;
  border-radius: 11px;
}

.chat-panel {
  display: flex;
  flex-direction: column;
}

.chat-title-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 12px;
}

.chat-row {
  display: flex;
  gap: 8px;
}

.chat-form {
  margin-top: 10px;
}

.chip-row {
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
  margin-top: 8px;
}

.chip {
  padding: 5px 12px;
  font-size: 11px;
  font-weight: 650;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.05);
  border: 1px solid rgba(255, 255, 255, 0.09);
  color: var(--muted);
  cursor: pointer;
  transition: all 0.2s cubic-bezier(0.16, 1, 0.3, 1);
  user-select: none;
  backdrop-filter: blur(8px);
  -webkit-backdrop-filter: blur(8px);
}

.chip:hover {
  background: rgba(56, 189, 248, 0.16);
  border-color: rgba(56, 189, 248, 0.5);
  color: #e0f2fe;
  transform: translateY(-2px);
  box-shadow: 0 0 12px rgba(56, 189, 248, 0.25), inset 0 1px 0 rgba(255,255,255,0.1);
}

.chip:active {
  transform: scale(0.94) translateY(0);
}

.copyable {
  cursor: pointer;
  transition: all 0.22s cubic-bezier(0.16, 1, 0.3, 1);
}

.copyable:hover {
  border-color: rgba(56, 189, 248, 0.5) !important;
  background: rgba(56, 189, 248, 0.1) !important;
  box-shadow: 0 4px 14px rgba(0, 0, 0, 0.3), 0 0 12px rgba(56, 189, 248, 0.25) !important;
  transform: translateY(-2px);
}

.log, .chat-log {
  height: 440px;
  overflow: auto;
  background: #060911;
  border: 1px solid rgba(255,255,255,0.06);
  border-radius: 12px;
  padding: 10px 12px;
  font: 12.5px/1.6 'JetBrains Mono', ui-monospace, SFMono-Regular, Consolas, "Liberation Mono", Menlo, monospace;
  white-space: pre-wrap;
  word-break: break-word;
  box-shadow: inset 0 2px 8px rgba(0, 0, 0, 0.6), 0 4px 16px rgba(0,0,0,0.3);
  scrollbar-width: thin;
  scrollbar-color: rgba(56, 189, 248, 0.25) transparent;
}

.log::-webkit-scrollbar, .chat-log::-webkit-scrollbar {
  width: 5px;
}
.log::-webkit-scrollbar-thumb, .chat-log::-webkit-scrollbar-thumb {
  background: rgba(56, 189, 248, 0.25);
  border-radius: 99px;
}

.line {
  padding: 3px 8px;
  border-radius: 5px;
  transition: background 0.12s ease;
}

.line:hover {
  background: rgba(255, 255, 255, 0.04);
}

.line-error { color: #f87171 !important; background: rgba(239, 68, 68, 0.08); border-left: 2px solid #ef4444; }
.line-warn { color: #fbbf24 !important; background: rgba(245, 158, 11, 0.08); border-left: 2px solid #f59e0b; }
.line-flow { color: #38bdf8 !important; border-left: 2px solid #0284c7; background: rgba(56, 189, 248, 0.04); }
.line-chat { color: #e2e8f0 !important; }
.line-success { color: #4ade80 !important; border-left: 2px solid #22c55e; background: rgba(34, 197, 94, 0.05); }
.line-time { color: var(--muted, #64748b); font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace; font-size: 11px; margin-right: 6px; user-select: none; }
.chat-sender { color: #38bdf8; font-weight: 600; }
.chat-badge { background: rgba(56, 189, 248, 0.15); color: #38bdf8; border: 1px solid rgba(56, 189, 248, 0.3); border-radius: 4px; padding: 0 5px; font-size: 11px; font-weight: 600; }
.chat-server-badge { background: rgba(249, 115, 22, 0.15); color: #fb923c; border: 1px solid rgba(249, 115, 22, 0.3); border-radius: 4px; padding: 0 5px; font-size: 11px; font-weight: 600; }
.chat-outgoing { color: #f472b6 !important; font-style: italic; }
.chat-server-text { color: #fed7aa; }
.chat-text { color: #f1f5f9; }

.note {
  margin-top: 8px;
  color: var(--muted);
  font-size: 12px;
  line-height: 1.45;
}

@keyframes toastSlideIn {
  from { opacity: 0; transform: translateY(20px) scale(0.96); }
  to { opacity: 1; transform: translateY(0) scale(1); }
}

.toast {
  position: fixed;
  right: 20px;
  bottom: 20px;
  display: none;
  max-width: 400px;
  padding: 14px 18px 14px 22px;
  border: 1px solid rgba(56, 189, 248, 0.35);
  border-radius: 14px;
  background: rgba(10, 18, 32, 0.97);
  backdrop-filter: blur(20px) saturate(160%);
  -webkit-backdrop-filter: blur(20px) saturate(160%);
  box-shadow: 0 16px 48px rgba(0, 0, 0, 0.65), 0 0 0 1px rgba(255,255,255,0.06);
  z-index: 2000;
  font-size: 13px;
  font-weight: 600;
  animation: toastSlideIn 0.3s cubic-bezier(0.22, 1, 0.36, 1);
  border-left: 4px solid var(--blue);
  line-height: 1.45;
}

/* Inventory & Equipment Area - AAA Game Standard Architecture */
.inventory-area {
  display: flex;
  flex-direction: column;
}

.inventory-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 10px;
  margin-bottom: 14px;
}

.inventory-stat {
  padding: 10px 12px;
  border-radius: 11px;
  background: var(--card2);
  border: 1px solid rgba(255, 255, 255, 0.04);
}

.inventory-stat .info-label {
  color: var(--muted);
  font-size: 10px;
  font-weight: 600;
  margin-bottom: 4px;
  text-transform: uppercase;
}

.inventory-stat .info-value {
  font-size: 14px;
  font-weight: 700;
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-variant-numeric: tabular-nums;
}

.bar {
  width: 100%;
  height: 10px;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.06);
  box-shadow: inset 0 1px 3px rgba(0, 0, 0, 0.5);
  overflow: hidden;
  margin-top: 6px;
}

.bar > span, .bar>span {
  display: block;
  height: 100%;
  width: 0;
  transition: width 0.4s cubic-bezier(0.4, 0, 0.2, 1);
  position: relative;
  overflow: hidden;
}

.bar > span::after, .bar>span::after {
  content: '';
  position: absolute;
  inset: 0;
  background: linear-gradient(90deg, transparent, rgba(255,255,255,0.35), transparent);
  animation: barShimmer 2.2s ease-in-out infinite;
}

.health-bar > span, .health-bar>span {
  background: linear-gradient(90deg, #ef4444, #f87171);
  box-shadow: 0 0 12px rgba(239, 68, 68, 0.55);
  border-radius: 999px;
}

.hunger-bar > span, .hunger-bar>span {
  background: linear-gradient(90deg, #f59e0b, #fbbf24);
  box-shadow: 0 0 12px rgba(245, 158, 11, 0.55);
  border-radius: 999px;
}

.equipment-row {
  display: grid;
  grid-template-columns: repeat(5, minmax(60px, 1fr));
  gap: 8px;
  margin: 8px 0 14px;
}

/* 5 Equipment Slots & 36 Inventory Slots - Single Authoritative Specification */
.equipment-slot, .inventory-slot {
  background: linear-gradient(145deg, rgba(18, 27, 44, 0.92), rgba(10, 15, 26, 0.98)) !important;
  border: 1px solid rgba(255, 255, 255, 0.08) !important;
  border-radius: 10px;
  min-height: 64px !important;
  position: relative;
  padding: 8px 6px;
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.06), 0 3px 8px rgba(0, 0, 0, 0.4);
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  text-align: center;
  cursor: pointer;
  overflow: hidden;
  transition: all 0.2s cubic-bezier(0.16, 1, 0.3, 1);
  user-select: none;
}

.equipment-slot:hover, .inventory-slot:hover {
  border-color: rgba(56, 189, 248, 0.45) !important;
  transform: translateY(-2px);
  box-shadow: 0 6px 16px rgba(0, 0, 0, 0.5), 0 0 12px rgba(56, 189, 248, 0.15), inset 0 1px 0 rgba(255,255,255,0.1);
}

.equipment-slot .equip-label, .equip-label {
  font-size: 8.5px;
  color: var(--muted);
  font-weight: 700;
  text-transform: uppercase;
  margin-bottom: 5px;
  letter-spacing: 0.3px;
}

.inventory-slot:active, .inventory-slot.active {
  transform: scale(0.96);
}

.inventory-slot.empty {
  opacity: 0.6;
}

.inventory-slot.selected {
  border-color: #34d399 !important;
  box-shadow: 0 0 16px rgba(52, 211, 153, 0.4), inset 0 0 6px rgba(52, 211, 153, 0.15) !important;
  background: linear-gradient(145deg, rgba(16, 36, 26, 0.95), rgba(10, 24, 18, 0.98)) !important;
}

.inventory-slot.selected-for-move, .equipment-slot.selected-for-move {
  outline: 2px solid #fbbf24 !important;
  border-color: #fbbf24 !important;
  box-shadow: 0 0 18px rgba(251, 191, 36, 0.6), inset 0 0 8px rgba(251, 191, 36, 0.25) !important;
  transform: scale(1.04);
  animation: movePulse 1.5s ease-in-out infinite;
  z-index: 5;
}

@keyframes movePulse {
  0%, 100% { box-shadow: 0 0 12px rgba(251, 191, 36, 0.4), inset 0 0 6px rgba(251, 191, 36, 0.2); }
  50% { box-shadow: 0 0 22px rgba(251, 191, 36, 0.8), inset 0 0 10px rgba(251, 191, 36, 0.35); }
}

.touch-move-hint {
  background: rgba(251, 191, 36, 0.12);
  border: 1px solid rgba(251, 191, 36, 0.35);
  color: #fbbf24;
  padding: 8px 14px;
  border-radius: 10px;
  font-size: 12px;
  font-weight: 600;
  margin-top: 10px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.equipment-slot.dragover, .inventory-slot.dragover, .inventory-slot.selected.dragover {
  border-color: #38bdf8 !important;
  background: rgba(18, 38, 58, 0.95) !important;
  box-shadow: 0 0 14px rgba(56, 189, 248, 0.4) !important;
}

.slot-grid {
  display: grid;
  grid-template-columns: repeat(9, minmax(0, 1fr));
  gap: 6px;
  margin-top: 10px;
}

.slot-index {
  position: absolute;
  top: 4px;
  left: 6px;
  font-size: 9px;
  font-weight: 700;
  color: rgba(148, 163, 184, 0.5);
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-variant-numeric: tabular-nums;
  pointer-events: none;
  line-height: 1;
}

.slot-name {
  font-size: 10px !important;
  font-weight: 700 !important;
  color: #f1f5f9 !important;
  text-align: center;
  line-height: 1.25;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
  word-break: break-word;
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  padding: 0 2px;
}

.slot-count {
  position: absolute;
  bottom: 4px;
  right: 5px;
  background: rgba(14, 165, 233, 0.22);
  border: 1px solid rgba(56, 189, 248, 0.4);
  padding: 1px 5px;
  border-radius: 5px;
  font-size: 9.5px;
  font-weight: 800;
  color: #38bdf8;
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-variant-numeric: tabular-nums;
  line-height: 1.2;
}

.drop-zone, #dropZone {
  margin-top: 14px;
  min-height: 52px;
  border: 2px dashed rgba(239, 68, 68, 0.35);
  border-radius: 12px;
  background: rgba(22, 12, 16, 0.6);
  color: #fca5a5;
  display: flex;
  align-items: center;
  justify-content: center;
  text-align: center;
  padding: 10px;
  font-size: 12px;
  font-weight: 700;
  transition: all 0.2s cubic-bezier(0.16, 1, 0.3, 1);
}

.drop-zone:hover, .drop-zone.dragover, .drop-zone.drag-over, #dropZone:hover, #dropZone.drag-over {
  border-color: #ef4444 !important;
  background: rgba(35, 12, 18, 0.8) !important;
  box-shadow: 0 0 20px rgba(239, 68, 68, 0.25) !important;
  color: #fff;
}

.position-value, .revision {
  font-variant-numeric: tabular-nums;
}

.inventory-list {
  display: grid;
  gap: 6px;
}

.inventory-item-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 6px 10px;
  border-radius: 8px;
  background: var(--card2);
}

.inventory-item-name {
  font-size: 12px;
  font-weight: 600;
}

/* Settings & Schedules */
.setting-list {
  display: grid;
  gap: 8px;
  margin-bottom: 14px;
}

.check-row {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 9px 12px;
  border: 1px solid rgba(255, 255, 255, 0.05);
  border-radius: 10px;
  background: rgba(255, 255, 255, 0.025);
  font-size: 13px;
  cursor: pointer;
  transition: background 0.18s, border-color 0.18s;
}

.check-row:hover {
  background: rgba(255, 255, 255, 0.05);
  border-color: rgba(255, 255, 255, 0.1);
}

.check-row input[type="checkbox"] {
  -webkit-appearance: none;
  appearance: none;
  width: 38px;
  height: 22px;
  min-width: 38px;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.12);
  border: 1px solid rgba(255, 255, 255, 0.15);
  position: relative;
  cursor: pointer;
  transition: all 0.25s cubic-bezier(0.16, 1, 0.3, 1);
  padding: 0;
  box-shadow: inset 0 1px 3px rgba(0, 0, 0, 0.4);
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
  box-shadow: 0 1px 4px rgba(0, 0, 0, 0.4);
  transition: all 0.25s cubic-bezier(0.16, 1, 0.3, 1);
}

.check-row input[type="checkbox"]:checked {
  background: linear-gradient(135deg, #10b981, #0ea5e9);
  border-color: rgba(16, 185, 129, 0.6);
  box-shadow: 0 0 10px rgba(16, 185, 129, 0.35), inset 0 1px 3px rgba(0, 0, 0, 0.2);
}

.check-row input[type="checkbox"]:checked::after {
  left: calc(100% - 19px);
}

.schedule-list {
  display: grid;
  gap: 8px;
  margin: 10px 0;
}

.schedule-row {
  padding: 10px 12px;
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 11px;
  background: linear-gradient(180deg, rgba(21, 31, 41, 0.85) 0%, rgba(17, 26, 34, 0.85) 100%);
  box-shadow: 0 4px 14px rgba(0, 0, 0, 0.18);
  transition: border-color 0.18s, opacity 0.18s, transform 0.18s;
}

.schedule-row:hover {
  border-color: rgba(77, 163, 255, 0.45);
}

.schedule-row.dragging {
  opacity: 0.5;
  transform: scale(0.98);
}

.schedule-row-top {
  display: grid;
  grid-template-columns: 26px minmax(0, 1fr) auto auto;
  gap: 8px;
  align-items: center;
}

.schedule-handle {
  width: 26px;
  height: 30px;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--muted);
  cursor: grab;
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 7px;
  background: rgba(255, 255, 255, 0.03);
  user-select: none;
}

.schedule-handle:active {
  cursor: grabbing;
}

.schedule-row-title {
  font-size: 12px;
  font-weight: 800;
  min-width: 0;
}

.schedule-inline {
  display: flex;
  gap: 6px;
  align-items: center;
  min-width: 0;
  flex-wrap: wrap;
}

.schedule-inline input, .schedule-inline select {
  padding: 7px 9px;
  border-radius: 8px;
  font-size: 11px;
  min-width: 0;
}

.schedule-inline .action-select { width: 94px; }
.schedule-inline .time-input { width: 90px; }
.schedule-inline .minutes-input { width: 106px; }

.schedule-row-main {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 8px;
  align-items: end;
  margin-top: 8px;
}

.schedule-row-main textarea {
  width: 100%;
  min-height: 52px;
  padding: 8px 10px;
  border-radius: 9px;
  font-size: 12px;
  resize: vertical;
}

.schedule-row-main .schedule-field, .schedule-field { display: grid; gap: 4px; }
.schedule-row-main .schedule-field > span, .schedule-row-main .schedule-field>span, .schedule-field > span, .schedule-field>span { color: var(--muted); font-size: 10px; font-weight: 600; }
.schedule-meta { display: flex; gap: 6px; flex-wrap: wrap; align-items: center; color: var(--muted); font-size: 10px; }

.scheduler-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  flex-wrap: wrap;
  margin: 10px 0 8px;
}

.scheduler-mode-box {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 220px;
}

.scheduler-mode-box > span, .scheduler-mode-box>span { color: var(--muted); font-size: 11px; font-weight: 600; }
.scheduler-mode-box select { padding: 8px 10px; border-radius: 9px; font-size: 12px; }
.scheduler-note { margin: 6px 0 10px; color: var(--muted); font-size: 10px; line-height: 1.5; }
.compact-save { margin-top: 8px; }
.hidden-field { display: none !important; }

.credential-list {
  display: grid;
  gap: 10px;
  max-height: 60vh;
  overflow: auto;
}

.credential-card {
  padding: 12px;
  border: 1px solid var(--border);
  border-radius: 12px;
  background: var(--card2);
}

.credential-row {
  display: grid;
  grid-template-columns: 1fr auto;
  gap: 8px;
  margin-top: 8px;
}

.credential-value {
  padding: 10px;
  border-radius: 8px;
  background: rgba(10, 16, 24, 0.85);
  font-family: ui-monospace, SFMono-Regular, Consolas, monospace;
  word-break: break-all;
  font-size: 12px;
}

.dragging { opacity: 0.55; }
.app-footer {
  margin-top: 36px;
  padding: 16px 20px;
  background: rgba(15, 23, 42, 0.45);
  border: 1px solid rgba(255, 255, 255, 0.06);
  border-radius: 14px;
  text-align: left;
  color: var(--muted);
  backdrop-filter: blur(10px);
  -webkit-backdrop-filter: blur(10px);
}
.footer-recent-wrap {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 14px;
  flex-wrap: wrap;
}
.footer-recent-left {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
  flex: 1;
  min-width: 0;
}
.footer-recent-tag {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: 10.5px;
  font-weight: 800;
  letter-spacing: 0.5px;
  padding: 3px 8px;
  border-radius: 6px;
  background: rgba(56, 189, 248, 0.15);
  border: 1px solid rgba(56, 189, 248, 0.35);
  color: #38bdf8;
  white-space: nowrap;
}
.footer-recent-desc {
  font-size: 12px;
  color: #94a3b8;
  line-height: 1.4;
}
.footer-changelog-btn {
  background: rgba(255, 255, 255, 0.05) !important;
  border: 1px solid rgba(255, 255, 255, 0.12) !important;
  color: #cbd5e1 !important;
  font-size: 11.5px !important;
  font-weight: 650 !important;
  padding: 6px 12px !important;
  border-radius: 8px !important;
  cursor: pointer !important;
  transition: all 0.2s ease !important;
  white-space: nowrap;
  box-shadow: none !important;
}
.footer-changelog-btn:hover {
  background: rgba(56, 189, 248, 0.15) !important;
  border-color: rgba(56, 189, 248, 0.4) !important;
  color: #38bdf8 !important;
}
.footer-discord-btn {
  background: #5865F2 !important;
  border: 1px solid #7983f5 !important;
  color: #ffffff !important;
  font-size: 11.5px !important;
  font-weight: 700 !important;
  padding: 6px 12px !important;
  border-radius: 8px !important;
  cursor: pointer !important;
  transition: all 0.2s ease !important;
  white-space: nowrap;
  text-decoration: none !important;
  display: inline-flex !important;
  align-items: center !important;
  gap: 6px !important;
  box-shadow: 0 2px 8px rgba(88, 101, 242, 0.35) !important;
}
.footer-discord-btn:hover {
  background: #4752c4 !important;
  border-color: #5865F2 !important;
  color: #ffffff !important;
  transform: translateY(-1px);
  box-shadow: 0 4px 12px rgba(88, 101, 242, 0.5) !important;
}
.footer-copy {
  margin-top: 10px;
  padding-top: 10px;
  border-top: 1px solid rgba(255, 255, 255, 0.04);
  font-size: 11px;
  color: var(--muted);
  text-align: center;
  opacity: 0.65;
}

/* Changelog Timeline Modal */
.changelog-card {
  width: min(720px, 96vw);
  max-height: 85vh;
  display: flex;
  flex-direction: column;
}
.changelog-body {
  overflow-y: auto;
  padding-right: 6px;
  margin: 12px 0;
  max-height: calc(85vh - 120px);
}
.timeline-item {
  position: relative;
  padding-left: 28px;
  padding-bottom: 22px;
  border-left: 2px solid rgba(56, 189, 248, 0.2);
}
.timeline-item:last-child {
  border-left: 2px solid transparent;
  padding-bottom: 6px;
}
.timeline-node {
  position: absolute;
  left: -7px;
  top: 0;
  width: 12px;
  height: 12px;
  border-radius: 50%;
  background: #0284c7;
  border: 2px solid #38bdf8;
  box-shadow: 0 0 10px rgba(56, 189, 248, 0.8);
}
.timeline-item.latest .timeline-node {
  background: #10b981;
  border-color: #34d399;
  box-shadow: 0 0 12px rgba(52, 211, 153, 0.9);
}
.timeline-header {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 6px;
  flex-wrap: wrap;
}
.timeline-version {
  font-size: 14.5px;
  font-weight: 850;
  color: #fff;
}
.timeline-badge {
  font-size: 10px;
  font-weight: 800;
  padding: 2px 7px;
  border-radius: 999px;
  letter-spacing: 0.4px;
}
.timeline-badge.current {
  background: rgba(16, 185, 129, 0.2);
  border: 1px solid rgba(16, 185, 129, 0.4);
  color: #34d399;
}
.timeline-badge.past {
  background: rgba(255, 255, 255, 0.06);
  border: 1px solid rgba(255, 255, 255, 0.12);
  color: #94a3b8;
}
.timeline-content {
  background: rgba(255, 255, 255, 0.025);
  border: 1px solid rgba(255, 255, 255, 0.06);
  border-radius: 12px;
  padding: 10px 14px;
  font-size: 12px;
  color: #cbd5e1;
  line-height: 1.65;
}
.timeline-content ul {
  margin: 0;
  padding-left: 18px;
}
.timeline-content li {
  margin-bottom: 4px;
}
.timeline-content li strong {
  color: #38bdf8;
}

.hidden { display: none !important; }

/* Custom Scrollbars */
::-webkit-scrollbar { width: 6px; height: 6px; }
::-webkit-scrollbar-track { background: rgba(0, 0, 0, 0.2); border-radius: 4px; }
::-webkit-scrollbar-thumb { background: rgba(255, 255, 255, 0.16); border-radius: 4px; }
::-webkit-scrollbar-thumb:hover { background: rgba(255, 255, 255, 0.3); }

@media (max-width: 900px) {
  .grid { grid-template-columns: 1fr; }
}

@media (max-width: 680px) {
  .bot-grid { grid-template-columns: 1fr; gap: 12px; }
  .bot-card { width: 100%; max-width: 100%; padding: 12px; }
  .info, .inventory-grid { grid-template-columns: 1fr; }
  .equipment-row { grid-template-columns: repeat(5, minmax(48px, 1fr)); }
  .bot-mini-btn {
    min-height: 34px;
    padding: 5px 9px;
    font-size: 11px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
  }
}

.vip-pill {
  font-size: 11px;
  font-weight: 800;
  padding: 4px 10px;
  border-radius: 999px;
  background: linear-gradient(135deg, rgba(245, 158, 11, 0.22) 0%, rgba(217, 119, 6, 0.3) 100%);
  border: 1px solid rgba(245, 158, 11, 0.45);
  color: #fbbf24;
  letter-spacing: 0.05em;
  box-shadow: 0 0 12px rgba(245, 158, 11, 0.2);
  display: inline-flex;
  align-items: center;
  gap: 5px;
}

.platform-pill {
  font-size: 11px;
  font-weight: 750;
  padding: 4px 10px;
  border-radius: 999px;
  background: rgba(6, 182, 212, 0.15);
  border: 1px solid rgba(6, 182, 212, 0.4);
  color: #38bdf8;
  letter-spacing: 0.04em;
  display: inline-flex;
  align-items: center;
  gap: 5px;
}

.ram-pill {
  font-size: 11px;
  font-weight: 700;
  padding: 4px 10px;
  border-radius: 999px;
  background: rgba(16, 185, 129, 0.15);
  border: 1px solid rgba(16, 185, 129, 0.35);
  color: #34d399;
  display: inline-flex;
  align-items: center;
  gap: 5px;
}

.fleet-resource-bar {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
  gap: 12px;
  background: linear-gradient(135deg, rgba(16, 24, 38, 0.75) 0%, rgba(10, 16, 26, 0.85) 100%);
  border: 1px solid rgba(56, 189, 248, 0.2);
  border-radius: 14px;
  padding: 14px 18px;
  margin-bottom: 18px;
  backdrop-filter: blur(16px);
  -webkit-backdrop-filter: blur(16px);
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.25), inset 0 1px 0 rgba(255, 255, 255, 0.05);
}

.fleet-res-item {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 8px 12px;
  border-radius: 10px;
  background: rgba(255, 255, 255, 0.02);
  border: 1px solid rgba(255, 255, 255, 0.05);
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.2);
  transition: all 0.2s cubic-bezier(0.16, 1, 0.3, 1);
}

.fleet-res-item:hover {
  background: rgba(56, 189, 248, 0.06);
  border-color: rgba(56, 189, 248, 0.3);
  transform: translateY(-2px);
  box-shadow: 0 6px 16px rgba(0, 0, 0, 0.3);
}

.fleet-res-icon {
  font-size: 20px;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 40px;
  height: 40px;
  border-radius: 10px;
  background: rgba(56, 189, 248, 0.08);
  border: 1px solid rgba(56, 189, 248, 0.2);
  box-shadow: 0 0 12px rgba(56, 189, 248, 0.15);
  flex-shrink: 0;
}

.fleet-res-label {
  font-size: 11px;
  font-weight: 600;
  color: var(--muted);
  text-transform: uppercase;
  letter-spacing: 0.05em;
  margin-bottom: 2px;
}

.fleet-res-val {
  font-family: 'JetBrains Mono', 'SF Mono', Consolas, monospace;
  font-size: 15px;
  font-weight: 800;
  color: var(--text);
  letter-spacing: -0.02em;
}

.eco-badge {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  background: rgba(16, 185, 129, 0.18);
  border: 1px solid rgba(16, 185, 129, 0.45);
  color: #34d399;
  font-size: 10px;
  font-weight: 800;
  padding: 2px 7px;
  border-radius: 6px;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  box-shadow: 0 0 10px rgba(16, 185, 129, 0.15);
}

.ram-meter-wrap {
  margin-top: 8px;
  padding: 6px 9px;
  background: rgba(0, 0, 0, 0.28);
  border-radius: 7px;
  border: 1px solid rgba(255, 255, 255, 0.05);
}

.ram-meter-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  font-size: 10.5px;
  font-weight: 700;
  margin-bottom: 5px;
}

.ram-meter-bar {
  width: 100%;
  height: 5px;
  background: rgba(255, 255, 255, 0.08);
  border-radius: 999px;
  overflow: hidden;
}

.ram-meter-fill {
  height: 100%;
  border-radius: 999px;
  transition: width 0.4s cubic-bezier(0.16, 1, 0.3, 1), background-color 0.4s ease;
}

@media (max-width: 768px) {
  .fleet-resource-bar {
    grid-template-columns: repeat(2, 1fr);
    padding: 10px;
    gap: 8px;
  }
  .fleet-res-item {
    padding: 6px 8px;
  }
  .fleet-res-icon {
    width: 34px;
    height: 34px;
    font-size: 18px;
  }
  .fleet-res-val {
    font-size: 13px;
  }
  .card-quick-actions button {
    min-height: 44px;
  }
  .top-actions button {
    min-height: 44px;
  }
}

@media (max-width: 480px) {
  .fleet-resource-bar {
    grid-template-columns: repeat(2, 1fr);
  }
  .toast {
    left: 12px !important;
    right: 12px !important;
    bottom: 14px !important;
    max-width: calc(100% - 24px) !important;
    text-align: center;
  }
}

/* ========================================================================== */
/* KBOT COMMERCIAL SAAS PORTAL & LANDING STYLES (UI/UX PRO MAX)               */
/* ========================================================================== */
.kbot-portal-wrapper {
  display: flex;
  width: min(1080px, 96vw);
  max-height: 90vh;
  background: rgba(10, 18, 32, 0.95);
  border: 1px solid rgba(56, 189, 248, 0.35);
  border-radius: 26px;
  box-shadow: 0 35px 80px rgba(0, 0, 0, 0.85), 0 0 50px rgba(56, 189, 248, 0.12), inset 0 1px 0 rgba(255,255,255,0.1);
  backdrop-filter: blur(24px) saturate(180%);
  -webkit-backdrop-filter: blur(24px) saturate(180%);
  overflow: hidden;
  position: relative;
  animation: modalSpringIn 0.32s cubic-bezier(0.22, 1, 0.36, 1);
}
.kbot-portal-wrapper::before {
  content: '';
  position: absolute;
  top: -40%;
  left: -20%;
  width: 500px;
  height: 500px;
  background: radial-gradient(circle, rgba(56, 189, 248, 0.15) 0%, transparent 70%);
  filter: blur(60px);
  pointer-events: none;
  z-index: 0;
  animation: auroraFloat 18s ease-in-out infinite alternate;
}
.kbot-portal-wrapper::after {
  content: '';
  position: absolute;
  bottom: -40%;
  right: -20%;
  width: 500px;
  height: 500px;
  background: radial-gradient(circle, rgba(16, 185, 129, 0.12) 0%, transparent 70%);
  filter: blur(60px);
  pointer-events: none;
  z-index: 0;
  animation: auroraFloat 22s ease-in-out infinite alternate-reverse;
}

@media (max-width: 920px) {
  .kbot-portal-wrapper {
    flex-direction: column;
    max-height: 94vh;
    overflow-y: auto;
  }
}

.kbot-landing-col {
  flex: 1.25;
  padding: 32px 30px;
  overflow-y: auto;
  position: relative;
  z-index: 1;
  border-right: 1px solid rgba(255, 255, 255, 0.07);
  background: radial-gradient(circle at 10% 20%, rgba(16, 185, 129, 0.08) 0%, transparent 60%);
}

.kbot-landing-col::-webkit-scrollbar {
  width: 5px;
}
.kbot-landing-col::-webkit-scrollbar-thumb {
  background: rgba(56, 189, 248, 0.3);
  border-radius: 10px;
}

.kbot-login-col {
  flex: 0.95;
  padding: 32px 28px;
  display: flex;
  align-items: center;
  justify-content: center;
  position: relative;
  z-index: 1;
  background: rgba(15, 23, 42, 0.45);
}

.kbot-brand-badge {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 4px 12px;
  border-radius: 999px;
  background: rgba(16, 185, 129, 0.15);
  border: 1px solid rgba(16, 185, 129, 0.38);
  color: #34d399;
  font-size: 11px;
  font-weight: 850;
  letter-spacing: 0.8px;
  margin-bottom: 12px;
  box-shadow: 0 0 15px rgba(16, 185, 129, 0.2);
}

.kbot-pulse-dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: #10b981;
  box-shadow: 0 0 8px #10b981;
  position: relative;
  flex-shrink: 0;
}
.kbot-pulse-dot::after {
  content: '';
  position: absolute;
  inset: 0;
  border-radius: 50%;
  background: #10b981;
  animation: sonarPulse 2s ease-out infinite;
}

.kbot-landing-title {
  font-size: 23px;
  font-weight: 850;
  line-height: 1.35;
  color: #fff;
  margin: 0 0 8px;
  letter-spacing: -0.02em;
}

.kbot-gradient-text {
  display: block;
  background: linear-gradient(135deg, #34d399 0%, #38bdf8 50%, #818cf8 100%);
  background-size: 200% auto;
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
  animation: textShine 6s linear infinite;
}

.kbot-landing-desc {
  font-size: 13px;
  line-height: 1.6;
  color: #94a3b8;
  margin: 0 0 18px;
}

/* Discord CTA Button */
.kbot-discord-btn {
  display: flex;
  align-items: center;
  gap: 12px;
  background: linear-gradient(135deg, #5865F2 0%, #4752C4 100%);
  border: 1px solid rgba(255, 255, 255, 0.2);
  border-radius: 14px;
  padding: 12px 16px;
  color: #fff !important;
  text-decoration: none !important;
  box-shadow: 0 10px 24px rgba(88, 101, 242, 0.35);
  transition: all 0.25s cubic-bezier(0.16, 1, 0.3, 1);
  margin-bottom: 22px;
}
.kbot-discord-btn:hover {
  transform: translateY(-2px);
  box-shadow: 0 14px 30px rgba(88, 101, 242, 0.55);
  filter: brightness(1.08);
}
.kbot-discord-icon {
  flex-shrink: 0;
  filter: drop-shadow(0 2px 4px rgba(0,0,0,0.3));
}
.kbot-discord-text {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
}
.kbot-discord-text strong {
  font-size: 13.5px;
  font-weight: 800;
  letter-spacing: 0.2px;
}
.kbot-discord-text small {
  font-size: 11px;
  color: rgba(255, 255, 255, 0.85);
  margin-top: 2px;
}
.kbot-discord-badge {
  background: rgba(255, 255, 255, 0.2);
  padding: 3px 8px;
  border-radius: 6px;
  font-size: 10px;
  font-weight: 800;
  letter-spacing: 0.5px;
}

.kbot-section-subtitle {
  font-size: 11px;
  font-weight: 800;
  letter-spacing: 0.8px;
  color: #38bdf8;
  margin-bottom: 10px;
  text-transform: uppercase;
  display: flex;
  align-items: center;
  gap: 6px;
}

/* Benefits Grid */
.kbot-benefits-grid {
  display: grid;
  grid-template-columns: 1fr;
  gap: 8px;
  margin-bottom: 18px;
}
.kbot-benefit-card {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  background: rgba(255, 255, 255, 0.025);
  border: 1px solid rgba(255, 255, 255, 0.06);
  border-radius: 12px;
  padding: 10px 14px;
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.2), inset 0 1px 0 rgba(255, 255, 255, 0.05);
  transition: all 0.25s cubic-bezier(0.16, 1, 0.3, 1);
}
.kbot-benefit-card:hover {
  background: rgba(56, 189, 248, 0.07);
  border-color: rgba(56, 189, 248, 0.3);
  transform: translateX(4px) translateY(-1px);
  box-shadow: 0 8px 24px rgba(56, 189, 248, 0.12), inset 0 1px 0 rgba(255, 255, 255, 0.1);
}
.kbot-benefit-icon {
  font-size: 18px;
  flex-shrink: 0;
  margin-top: 1px;
}
.kbot-benefit-info strong {
  font-size: 12.5px;
  font-weight: 750;
  color: #f1f5f9;
  display: block;
  margin-bottom: 2px;
}
.kbot-benefit-info p {
  margin: 0;
  font-size: 11.5px;
  color: #94a3b8;
  line-height: 1.45;
}

/* 3-Steps Workflow */
.kbot-steps-row {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-bottom: 18px;
  background: rgba(0, 0, 0, 0.25);
  padding: 10px 12px;
  border-radius: 12px;
  border: 1px solid rgba(255, 255, 255, 0.05);
}
@media (max-width: 600px) {
  .kbot-steps-row {
    flex-direction: column;
    align-items: stretch;
  }
}
.kbot-step-item {
  flex: 1;
  font-size: 11px;
  line-height: 1.4;
  color: #cbd5e1;
}
.kbot-step-num {
  font-weight: 850;
  color: #34d399;
  margin-bottom: 2px;
  text-transform: uppercase;
  font-size: 10.5px;
}
.kbot-step-arrow {
  color: var(--muted);
  font-weight: bold;
}

/* Commitments Box */
.kbot-commitments-box {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 8px;
}
@media (max-width: 600px) {
  .kbot-commitments-box {
    grid-template-columns: 1fr;
  }
}
.kbot-commit-item {
  display: flex;
  align-items: center;
  gap: 8px;
  background: rgba(16, 185, 129, 0.08);
  border: 1px solid rgba(16, 185, 129, 0.22);
  padding: 8px 10px;
  border-radius: 10px;
}
.kbot-commit-icon {
  font-size: 16px;
}
.kbot-commit-item strong {
  display: block;
  font-size: 11.5px;
  font-weight: 750;
  color: #34d399;
}
.kbot-commit-item small {
  display: block;
  font-size: 10px;
  color: #94a3b8;
  line-height: 1.35;
}

/* ==========================================================================
   V11.7 COMMERCIAL ENTERPRISE EDITION — GLOBAL NAV, OVERLAYS & FULL PAGE SECTIONS
   ========================================================================== */

/* Account Restriction Blur & Overlays */
.account-restricted-blur {
  filter: blur(8px) brightness(0.65) !important;
  pointer-events: none !important;
  user-select: none !important;
  transition: filter 0.3s ease;
}

.account-restriction-overlay {
  position: fixed;
  inset: 0;
  z-index: 999999;
  background: rgba(3, 7, 18, 0.82);
  backdrop-filter: blur(14px);
  -webkit-backdrop-filter: blur(14px);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 20px;
}
.account-restriction-overlay.hidden {
  display: none !important;
}
.restriction-card {
  width: 100%;
  max-width: 480px;
  background: rgba(15, 23, 42, 0.96);
  border: 1px solid rgba(239, 68, 68, 0.45);
  box-shadow: 0 25px 60px rgba(0, 0, 0, 0.8), 0 0 35px rgba(239, 68, 68, 0.2);
  border-radius: 20px;
  padding: 30px 24px;
  text-align: center;
  animation: modalZoomIn 0.25s cubic-bezier(0.16, 1, 0.3, 1);
}
.restriction-icon {
  font-size: 48px;
  margin-bottom: 12px;
}
.restriction-title {
  font-size: 20px;
  font-weight: 850;
  color: #ef4444;
  margin: 0 0 8px;
  letter-spacing: 0.5px;
}
.restriction-subtitle {
  font-size: 13px;
  color: #94a3b8;
  line-height: 1.5;
  margin-bottom: 18px;
}
.restriction-reason-box {
  background: rgba(239, 68, 68, 0.1);
  border: 1px dashed rgba(239, 68, 68, 0.35);
  border-radius: 12px;
  padding: 14px;
  margin-bottom: 20px;
  text-align: left;
}
.restriction-reason-box .reason-label {
  font-size: 11px;
  font-weight: 800;
  color: #f87171;
  margin-bottom: 6px;
}
.restriction-reason-box .reason-content {
  font-size: 13.5px;
  color: #f1f5f9;
  font-weight: 600;
  line-height: 1.5;
  word-break: break-word;
}
.expired-redeem-box {
  background: rgba(56, 189, 248, 0.08);
  border: 1px solid rgba(56, 189, 248, 0.3);
  border-radius: 12px;
  padding: 14px;
  margin-bottom: 20px;
  text-align: left;
}
.expired-redeem-box label {
  font-size: 11.5px;
  font-weight: 800;
  color: #38bdf8;
  display: block;
}
.restriction-actions {
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.btn-discord {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 12px 18px;
  background: #5865f2;
  color: #fff;
  border-radius: 10px;
  font-weight: 750;
  font-size: 14px;
  text-decoration: none;
  transition: all 0.2s ease;
}
.btn-discord:hover {
  background: #4752c4;
  transform: translateY(-1px);
  box-shadow: 0 4px 16px rgba(88, 101, 242, 0.4);
}
.btn-logout-overlay {
  padding: 11px;
  background: rgba(255, 255, 255, 0.08);
  border: 1px solid rgba(255, 255, 255, 0.15);
  color: #cbd5e1;
  border-radius: 10px;
  font-size: 13px;
  font-weight: 700;
  cursor: pointer;
  transition: all 0.2s ease;
}
.btn-logout-overlay:hover {
  background: rgba(239, 68, 68, 0.2);
  border-color: rgba(239, 68, 68, 0.5);
  color: #f87171;
}

/* Global Sticky Top Navigation Bar */
.global-header {
  position: sticky;
  top: 0;
  z-index: 100;
  width: 100%;
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 8px 16px;
  background: rgba(10, 15, 30, 0.92);
  backdrop-filter: blur(20px) saturate(180%);
  -webkit-backdrop-filter: blur(20px) saturate(180%);
  border-bottom: 1px solid rgba(56, 189, 248, 0.2);
  box-shadow: 0 4px 24px rgba(0, 0, 0, 0.5);
  box-sizing: border-box;
}
.global-header-left {
  display: flex;
  align-items: center;
  gap: 12px;
}
.global-header-brand {
  display: flex;
  align-items: center;
  gap: 8px;
  cursor: pointer;
  user-select: none;
}
.global-logo {
  font-size: 20px;
}
.global-brand-text {
  font-weight: 850;
  font-size: 16px;
  letter-spacing: 0.5px;
  background: linear-gradient(135deg, #38bdf8 0%, #818cf8 100%);
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
}
.vip-pill-mini {
  font-size: 10px;
  font-weight: 800;
  padding: 2px 6px;
  border-radius: 999px;
  background: rgba(234, 179, 8, 0.15);
  color: #eab308;
  border: 1px solid rgba(234, 179, 8, 0.35);
}
.global-nav-pills {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-left: 12px;
}
.nav-pill-btn {
  padding: 6px 12px;
  border-radius: 8px;
  background: rgba(255, 255, 255, 0.05);
  border: 1px solid rgba(255, 255, 255, 0.1);
  color: #cbd5e1;
  font-size: 12.5px;
  font-weight: 700;
  cursor: pointer;
  transition: all 0.2s ease;
}
.nav-pill-btn:hover {
  background: rgba(56, 189, 248, 0.15);
  border-color: rgba(56, 189, 248, 0.4);
  color: #fff;
}
.nav-pill-btn.active {
  background: linear-gradient(135deg, #0ea5e9, #2563eb);
  border-color: rgba(56, 189, 248, 0.6);
  color: #fff;
  box-shadow: 0 0 14px rgba(14, 165, 233, 0.45);
}
.global-header-right {
  display: flex;
  align-items: center;
  gap: 10px;
}

/* Dropdown Top Logout Button */
.dropdown-top-logout-wrap {
  padding-bottom: 8px;
  margin-bottom: 8px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.08);
}
.dropdown-top-logout-btn {
  width: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 10px;
  border-radius: 10px;
  background: rgba(239, 68, 68, 0.15);
  border: 1px solid rgba(239, 68, 68, 0.4);
  color: #f87171;
  font-weight: 800;
  font-size: 13px;
  cursor: pointer;
  transition: all 0.2s ease;
}
.dropdown-top-logout-btn:hover {
  background: #ef4444;
  color: #fff;
  box-shadow: 0 0 16px rgba(239, 68, 68, 0.5);
}
.profile-menu-section-title {
  font-size: 10px;
  font-weight: 800;
  letter-spacing: 0.6px;
  color: var(--muted);
  padding: 6px 8px 4px;
}
.big-tab-item {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 12px;
  border-radius: 10px;
  background: rgba(255, 255, 255, 0.03);
  border: 1px solid rgba(255, 255, 255, 0.06);
  margin-bottom: 4px;
  cursor: pointer;
  transition: all 0.15s ease;
}
.big-tab-item:hover {
  background: rgba(56, 189, 248, 0.12) !important;
  border-color: rgba(56, 189, 248, 0.3) !important;
}
.big-tab-item .menu-icon {
  font-size: 20px;
  flex-shrink: 0;
}
.big-tab-item .menu-text {
  display: flex;
  flex-direction: column;
}
.big-tab-item .menu-text strong {
  font-size: 13px;
  color: #f1f5f9;
}
.big-tab-item .menu-text small {
  font-size: 10.5px;
  color: #94a3b8;
}

/* Full Page Sections */
.full-page-section {
  width: 100%;
  max-width: 1400px;
  margin: 0 auto;
  padding: 20px 24px;
  box-sizing: border-box;
  animation: fadeIn 0.2s ease;
}
.full-page-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 14px;
  flex-wrap: wrap;
  margin-bottom: 20px;
  padding-bottom: 16px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.08);
}
.full-page-title {
  font-size: 22px;
  font-weight: 850;
  margin: 0 0 4px;
  color: #fff;
}
.full-page-subtitle {
  font-size: 13px;
  color: #94a3b8;
}
.sub-tab-bar {
  display: flex;
  gap: 8px;
  margin-bottom: 16px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.08);
  padding-bottom: 12px;
}
.sub-tab-btn {
  padding: 8px 18px;
  border-radius: 10px;
  background: rgba(255, 255, 255, 0.04);
  border: 1px solid rgba(255, 255, 255, 0.08);
  color: #94a3b8;
  font-weight: 750;
  font-size: 13.5px;
  cursor: pointer;
  transition: all 0.2s ease;
}
.sub-tab-btn:hover {
  background: rgba(255, 255, 255, 0.08);
  color: #fff;
}
.sub-tab-btn.active {
  background: rgba(56, 189, 248, 0.2);
  border-color: #38bdf8;
  color: #38bdf8;
  box-shadow: 0 0 14px rgba(56, 189, 248, 0.25);
}
.mgmt-filter-bar {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 16px;
  flex-wrap: wrap;
  background: rgba(255, 255, 255, 0.02);
  padding: 10px 14px;
  border-radius: 12px;
  border: 1px solid rgba(255, 255, 255, 0.06);
}
.filter-chip {
  padding: 6px 12px;
  border-radius: 20px;
  background: rgba(255, 255, 255, 0.05);
  border: 1px solid rgba(255, 255, 255, 0.1);
  color: #94a3b8;
  font-size: 12px;
  font-weight: 700;
  cursor: pointer;
  transition: all 0.15s ease;
}
.filter-chip:hover {
  background: rgba(255, 255, 255, 0.1);
  color: #fff;
}
.filter-chip.active {
  background: #0284c7;
  border-color: #38bdf8;
  color: #fff;
}
.password-cell-wrap {
  display: flex;
  align-items: center;
  gap: 8px;
  font-family: monospace;
}
.password-text.revealed {
  color: #38bdf8;
  font-weight: 700;
  letter-spacing: 0.5px;
  background: rgba(56, 189, 248, 0.1);
  padding: 2px 6px;
  border-radius: 4px;
}
.password-text.masked {
  color: #94a3b8;
  letter-spacing: 2px;
}
.btn-peek {
  background: none;
  border: 1px solid rgba(255, 255, 255, 0.15);
  border-radius: 6px;
  padding: 2px 6px;
  font-size: 13px;
  cursor: pointer;
  color: #cbd5e1;
  transition: all 0.2s;
}
.btn-peek:hover {
  background: rgba(255, 255, 255, 0.1);
  border-color: rgba(255, 255, 255, 0.3);
  color: #fff;
}
.quick-renew-row {
  display: flex;
  gap: 4px;
  flex-wrap: wrap;
  margin-top: 6px;
}
.quick-renew-btn {
  padding: 4px 8px;
  border-radius: 6px;
  background: rgba(56, 189, 248, 0.12);
  border: 1px solid rgba(56, 189, 248, 0.3);
  color: #38bdf8;
  font-size: 11px;
  font-weight: 750;
  cursor: pointer;
  transition: all 0.15s cubic-bezier(0.16, 1, 0.3, 1);
}
.quick-renew-btn:hover {
  background: #0284c7;
  color: #fff;
  border-color: #38bdf8;
  transform: translateY(-1px);
  box-shadow: 0 2px 8px rgba(56, 189, 248, 0.3);
}
.quick-renew-btn:active {
  transform: translateY(0);
}
.quick-renew-btn.minus {
  background: rgba(239, 68, 68, 0.12);
  border-color: rgba(239, 68, 68, 0.3);
  color: #f87171;
}
.quick-renew-btn.minus:hover {
  background: #ef4444;
  color: #fff;
  border-color: #f87171;
  box-shadow: 0 2px 8px rgba(239, 68, 68, 0.3);
}
.quick-renew-btn.vip {
  background: rgba(234, 179, 8, 0.15);
  border-color: rgba(234, 179, 8, 0.4);
  color: #eab308;
}
.quick-renew-btn.vip:hover {
  background: linear-gradient(135deg, #eab308, #ca8a04);
  color: #000;
  border-color: #fde047;
  box-shadow: 0 2px 8px rgba(234, 179, 8, 0.4);
}
.quick-renew-btn.custom {
  background: rgba(148, 163, 184, 0.15);
  border-color: rgba(148, 163, 184, 0.3);
  color: #cbd5e1;
}
.quick-renew-btn.custom:hover {
  background: rgba(255, 255, 255, 0.2);
  color: #fff;
  border-color: rgba(255, 255, 255, 0.4);
}
.bot-check-item.bot-occupied {
  opacity: 0.65;
  filter: grayscale(0.85);
  border-style: dashed;
  background: rgba(255, 255, 255, 0.02);
}
.badge-occupied {
  display: block;
  font-size: 10.5px;
  color: #eab308;
  font-weight: 700;
  margin-top: 2px;
}
.badge-lifetime {
  background: rgba(234, 179, 8, 0.2);
  color: #eab308;
  border: 1px solid rgba(234, 179, 8, 0.4);
  padding: 2px 8px;
  border-radius: 999px;
  font-size: 11px;
  font-weight: 800;
  display: inline-block;
}
.badge-expired {
  background: rgba(239, 68, 68, 0.2);
  color: #ef4444;
  border: 1px solid rgba(239, 68, 68, 0.4);
  padding: 2px 8px;
  border-radius: 999px;
  font-size: 11px;
  font-weight: 800;
  display: inline-block;
}
.badge-active {
  background: rgba(16, 185, 129, 0.2);
  color: #34d399;
  border: 1px solid rgba(16, 185, 129, 0.4);
  padding: 2px 8px;
  border-radius: 999px;
  font-size: 11px;
  font-weight: 800;
  display: inline-block;
}
.create-key-card {
  background: rgba(255, 255, 255, 0.03);
  border: 1px solid var(--border);
  padding: 16px;
  border-radius: 12px;
  margin-bottom: 16px;
}

@media (max-width: 768px) {
  /* Layout & Viewport Ergonomics */
  .app {
    width: 100% !important;
    max-width: 100% !important;
    padding: 6px 8px 60px !important;
    box-sizing: border-box !important;
  }
  .global-header {
    flex-wrap: wrap;
    padding: 8px 10px;
    gap: 8px;
  }
  .global-header-left {
    display: contents;
  }
  .global-header-brand {
    order: 1;
  }
  .global-header-right {
    order: 2;
    gap: 6px;
  }
  .global-nav-pills {
    display: flex !important;
    order: 3;
    width: 100%;
    margin-left: 0;
    overflow-x: auto;
    -webkit-overflow-scrolling: touch;
    scrollbar-width: none;
    flex-wrap: nowrap;
    gap: 6px;
    padding: 4px 2px 2px 2px;
  }
  .global-nav-pills::-webkit-scrollbar {
    display: none;
  }
  .nav-pill-btn {
    white-space: nowrap;
    flex-shrink: 0;
    padding: 7px 11px;
    font-size: 11.5px;
    min-height: 36px;
    display: inline-flex;
    align-items: center;
    gap: 4px;
  }
  .full-page-section {
    padding: 10px 8px;
  }
  .mgmt-filter-bar {
    flex-direction: column;
    align-items: stretch;
    gap: 8px;
  }

  /* GPU Fill-rate & Mobile Lag Elimination */
  .bot-card, .fleet-resource-bar, .user-table-wrap, .panel, .full-page-card, .modal-card, .kpi-card, .kbot-portal-wrapper {
    backdrop-filter: blur(4px) !important;
    -webkit-backdrop-filter: blur(4px) !important;
    box-shadow: 0 4px 16px rgba(0, 0, 0, 0.45) !important;
    contain: content;
  }
  .app-cosmic-video, .cosmic-bg-video {
    opacity: 0.12 !important;
  }

  /* Bento KPI Grid & Fleet Resources */
  .fleet-resource-bar {
    display: grid !important;
    grid-template-columns: repeat(2, 1fr) !important;
    gap: 8px !important;
    padding: 8px !important;
  }
  .fleet-res-item {
    padding: 6px 8px !important;
  }
  .kpi-grid {
    display: grid !important;
    grid-template-columns: repeat(2, 1fr) !important;
    gap: 8px !important;
    margin-bottom: 12px !important;
  }
  .kpi-card {
    padding: 10px 12px !important;
  }
  .kpi-title {
    font-size: 11px !important;
  }
  .kpi-value {
    font-size: 19px !important;
  }

  /* Bot Cards & Control Buttons */
  .bot-grid {
    grid-template-columns: 1fr !important;
    gap: 10px !important;
  }
  .bot-card {
    padding: 14px 12px !important;
    border-radius: 14px !important;
  }
  .bot-head {
    flex-wrap: wrap !important;
    gap: 6px !important;
  }
  .controls {
    display: flex !important;
    flex-wrap: wrap !important;
    gap: 6px !important;
    margin-top: 10px !important;
    padding-top: 10px !important;
  }
  .controls button {
    flex: 1 1 calc(50% - 6px) !important;
    min-width: 0 !important;
    min-height: 40px !important;
    padding: 8px 10px !important;
    font-size: 12px !important;
  }

  /* Minecraft GUI & Inventory Slot Grid */
  #detailRemoteGuiCard {
    overflow-x: auto !important;
    -webkit-overflow-scrolling: touch !important;
  }
  #detailRemoteGuiSlots {
    min-width: 440px !important;
  }
  .slot-grid {
    overflow-x: auto;
    -webkit-overflow-scrolling: touch;
    display: grid;
    grid-template-columns: repeat(9, minmax(42px, 1fr));
    padding-bottom: 8px;
  }
  .inventory-slot {
    min-height: 56px;
    min-width: 42px;
  }

  /* Tables & Responsive Scrolling */
  .user-table-wrap {
    overflow-x: auto !important;
    -webkit-overflow-scrolling: touch !important;
    margin: 10px 0 !important;
    border-radius: 12px !important;
  }
  .user-table th, .user-table td {
    padding: 8px 10px !important;
    font-size: 12px !important;
    white-space: nowrap !important;
  }

  /* Modals & Inputs */
  .modal {
    padding: 8px !important;
  }
  .modal-card {
    width: 100% !important;
    max-width: 100% !important;
    padding: 16px 14px !important;
    border-radius: 16px !important;
    max-height: 90vh !important;
  }
  input, select, textarea {
    font-size: 16px !important; /* Prevents auto-zoom on mobile */
  }

  /* Ergonomic Touch Targets & Responsive Polish */
  .bot-mini-btn {
    min-height: 44px;
    min-width: 44px;
    padding: 8px 12px;
    font-size: 12px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
  }
  .quick-renew-btn {
    min-height: 44px;
    padding: 8px 12px;
    font-size: 12.5px;
    display: inline-flex;
    align-items: center;
  }
  .btn-peek {
    min-height: 44px;
    min-width: 44px;
    padding: 6px 12px;
    font-size: 14px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
  }
  .password-toggle-btn {
    min-width: 44px;
    min-height: 44px;
    font-size: 18px;
    display: flex;
    align-items: center;
    justify-content: center;
  }
  .log, .chat-log {
    height: min(320px, 42vh);
  }
  .slot-index, .slot-name, .equip-label, .vital-label, .summary-label {
    font-size: 11px;
  }
}

@media (max-width: 480px) {
  /* Ultra-lightweight Mobile Mode */
  .bot-card, .fleet-resource-bar, .user-table-wrap, .panel, .full-page-card, .modal-card, .kpi-card {
    backdrop-filter: none !important;
    -webkit-backdrop-filter: none !important;
    background: rgba(9, 15, 28, 0.95) !important;
  }
  .app-cosmic-video, .cosmic-bg-video {
    display: none !important;
  }

  /* Tinh chỉnh bố cục điện thoại nhỏ gọn, vừa mắt, không tràn màn hình */
  .app {
    padding: 4px 6px 60px !important;
  }
  .global-header {
    padding: 6px 8px !important;
    border-radius: 12px !important;
  }
  .global-header-brand span {
    font-size: 13.5px !important;
  }
  .bot-card {
    padding: 10px 10px !important;
    border-radius: 12px !important;
    min-height: auto !important;
    margin-bottom: 8px !important;
  }
  .bot-head {
    gap: 4px !important;
    margin-bottom: 6px !important;
  }
  .bot-title {
    font-size: 13px !important;
  }
  .bot-id-chip {
    font-size: 9.5px !important;
    padding: 1.5px 5px !important;
  }
  .status-pill {
    font-size: 9.5px !important;
    padding: 2px 6px !important;
  }
  .bot-vitals {
    gap: 4px !important;
  }
  .vital-card {
    padding: 4px 6px !important;
    border-radius: 8px !important;
  }
  .vital-label {
    font-size: 9px !important;
  }
  .vital-val {
    font-size: 11px !important;
  }
  .controls {
    gap: 4px !important;
    margin-top: 6px !important;
    padding-top: 6px !important;
  }
  .controls button {
    min-height: 34px !important;
    padding: 5px 6px !important;
    font-size: 11px !important;
    border-radius: 8px !important;
  }
  .kpi-grid {
    gap: 6px !important;
    margin-bottom: 8px !important;
  }
  .kpi-card {
    padding: 7px 9px !important;
    border-radius: 10px !important;
  }
  .kpi-title {
    font-size: 10px !important;
  }
  .kpi-value {
    font-size: 15px !important;
  }
  .fleet-resource-bar {
    gap: 5px !important;
    padding: 6px !important;
    border-radius: 10px !important;
  }
  .fleet-res-item {
    padding: 4px 6px !important;
    gap: 5px !important;
  }
  .fleet-res-icon {
    width: 26px !important;
    height: 26px !important;
    font-size: 13px !important;
  }
  .fleet-res-label {
    font-size: 9px !important;
  }
  .fleet-res-val {
    font-size: 11px !important;
  }
  .panel, .full-page-card {
    padding: 10px 8px !important;
    border-radius: 12px !important;
    margin-bottom: 10px !important;
  }
  .panel-header h2, .full-page-card h2 {
    font-size: 13px !important;
  }
  .nav-pill-btn {
    padding: 5px 8px !important;
    font-size: 10.5px !important;
    min-height: 30px !important;
  }
  #userRentalBanner {
    padding: 8px 10px !important;
    border-radius: 12px !important;
    font-size: 11.5px !important;
  }
  #btnUserLink4mReward, #btnExpiredLink4mReward {
    padding: 6px 10px !important;
    font-size: 11px !important;
    border-radius: 8px !important;
  }
}

/* Technical data: monospace tabular numbers */
.vital-val, .bot-id-chip, .kpi-value, .position-value, .revision,
.bot-ip-pill, .vip-pill, .platform-pill, .ram-pill,
.slot-count, .slot-name, .slot-index {
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-variant-numeric: tabular-nums;
}

@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after {
    animation-duration: 0.01ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 0.01ms !important;
    scroll-behavior: auto !important;
  }
}

button:focus-visible, input:focus-visible, select:focus-visible, textarea:focus-visible, a:focus-visible {
  outline: 2px solid var(--cyan) !important;
  outline-offset: 2px !important;
}

/* ==========================================================================
   1. DUAL-INTENSITY GALAXY STAGE (HIGH DEPTH ON LOGIN / SUBTLE ON DASHBOARD)
   ========================================================================== */
body {
  background: transparent !important;
}
.app-cosmic-stage {
  position: fixed; inset: 0; z-index: 0; overflow: hidden; pointer-events: none;
  background: radial-gradient(ellipse at 50% 20%, #0d1b38 0%, #060d1e 60%, #02050c 100%);
  transition: background 0.5s ease;
}
.app-cosmic-video {
  position: absolute; inset: -2%; width: 104%; height: 104%; object-fit: cover;
  /* Chế độ Dịu (Subtle Dashboard): Rõ chuyển động xoay không gian êm ái */
  opacity: 0.35;
  filter: saturate(1.3) contrast(1.1) brightness(0.85) hue-rotate(-6deg);
  transition: opacity 0.5s ease, filter 0.5s ease;
}
.app-cosmic-nebula {
  position: absolute; border-radius: 50%; filter: blur(90px); mix-blend-mode: screen;
  opacity: 0.35; transition: opacity 0.5s ease;
}
.app-cosmic-nebula.n1 {
  top: -18%; left: -10%; width: 52vw; height: 52vw;
  background: radial-gradient(circle, rgba(14, 165, 233, 0.38) 0%, transparent 70%);
}
.app-cosmic-nebula.n2 {
  bottom: -20%; right: -10%; width: 56vw; height: 56vw;
  background: radial-gradient(circle, rgba(124, 58, 237, 0.32) 0%, transparent 70%);
}
.app-cosmic-canvas {
  position: absolute; inset: 0; width: 100%; height: 100%;
  opacity: 0.75; transition: opacity 0.5s ease;
}
.app-cosmic-scrim {
  position: absolute; inset: 0;
  background:
    radial-gradient(circle at 50% 30%, rgba(4, 7, 17, 0.38) 0%, rgba(3, 6, 14, 0.68) 75%, rgba(2, 4, 10, 0.86) 100%),
    linear-gradient(rgba(255, 255, 255, 0.018) 1px, transparent 1px),
    linear-gradient(90deg, rgba(255, 255, 255, 0.018) 1px, transparent 1px);
  background-size: 100% 100%, 36px 36px, 36px 36px;
  transition: background 0.5s ease;
}

/* CHẾ ĐỘ SÂU (VIVID) & CỔNG LOGIN GATE */
body.cosmic-mode-login .app-cosmic-video,
body.cosmic-mode-vivid .app-cosmic-video {
  opacity: 0.70 !important;
  filter: saturate(1.5) contrast(1.18) brightness(0.95) hue-rotate(-4deg) !important;
}
body.cosmic-mode-login .app-cosmic-nebula,
body.cosmic-mode-vivid .app-cosmic-nebula {
  opacity: 0.65 !important;
}
body.cosmic-mode-login .app-cosmic-canvas,
body.cosmic-mode-vivid .app-cosmic-canvas {
  opacity: 1.0 !important;
}
body.cosmic-mode-login .app-cosmic-scrim,
body.cosmic-mode-vivid .app-cosmic-scrim {
  background:
    radial-gradient(circle at 50% 45%, rgba(4, 7, 17, 0.12) 0%, rgba(3, 6, 15, 0.50) 75%, rgba(2, 4, 10, 0.72) 100%),
    linear-gradient(rgba(255, 255, 255, 0.025) 1px, transparent 1px),
    linear-gradient(90deg, rgba(255, 255, 255, 0.025) 1px, transparent 1px) !important;
  background-size: 100% 100%, 38px 38px, 38px 38px !important;
}

/* CHẾ ĐỘ TẮT (OFF - TỐI ƯU GPU/TIẾT KIỆM TÀI NGUYÊN) */
body.cosmic-mode-off .app-cosmic-stage,
body.theme-off .app-cosmic-stage {
  background: #030712 !important;
}
body.cosmic-mode-off .app-cosmic-video,
body.cosmic-mode-off .app-cosmic-nebula,
body.cosmic-mode-off .app-cosmic-canvas,
body.theme-off .app-cosmic-video,
body.theme-off .app-cosmic-nebula,
body.theme-off .app-cosmic-canvas {
  display: none !important;
  opacity: 0 !important;
}
body.cosmic-mode-off .app-cosmic-scrim,
body.theme-off .app-cosmic-scrim {
  background:
    radial-gradient(circle at 50% 30%, rgba(6, 11, 24, 0.96) 0%, rgba(3, 7, 18, 0.98) 100%),
    linear-gradient(rgba(255, 255, 255, 0.015) 1px, transparent 1px),
    linear-gradient(90deg, rgba(255, 255, 255, 0.015) 1px, transparent 1px) !important;
  background-size: 100% 100%, 36px 36px, 36px 36px !important;
}

/* ==========================================================================
   CHỦ ĐỀ 2: HOÀNG HÔN BỜ BIỂN (SUNSET COASTAL CHILL)
   ========================================================================== */
body.theme-sunset .app-cosmic-stage {
  background:
    radial-gradient(ellipse at 50% 64%, rgba(251, 146, 60, 0.42) 0%, rgba(194, 65, 12, 0.22) 38%, transparent 72%),
    linear-gradient(180deg, #10061e 0%, #240a33 24%, #46112d 46%, #7c2d12 66%, #1a0e22 100%) !important;
  transition: background 0.6s ease;
}
body.theme-sunset .app-cosmic-video {
  display: none !important;
}
body.theme-sunset .app-cosmic-nebula.n1 {
  background: radial-gradient(circle, rgba(249, 115, 22, 0.42) 0%, rgba(234, 88, 12, 0.12) 50%, transparent 70%) !important;
  top: 40% !important; left: 8% !important; width: 62vw !important; height: 62vw !important; opacity: 0.65 !important;
}
body.theme-sunset .app-cosmic-nebula.n2 {
  background: radial-gradient(circle, rgba(168, 85, 247, 0.30) 0%, transparent 70%) !important;
  bottom: -12% !important; right: 6% !important; opacity: 0.58 !important;
}
body.theme-sunset .app-cosmic-scrim {
  background:
    radial-gradient(circle at 50% 50%, rgba(14, 5, 27, 0.18) 0%, rgba(10, 4, 20, 0.58) 72%, rgba(7, 2, 14, 0.82) 100%),
    linear-gradient(rgba(255, 255, 255, 0.015) 1px, transparent 1px),
    linear-gradient(90deg, rgba(255, 255, 255, 0.015) 1px, transparent 1px) !important;
  background-size: 100% 100%, 36px 36px, 36px 36px !important;
}
body.theme-sunset .card,
body.theme-sunset .kpi-card,
body.theme-sunset .bot-card,
body.theme-sunset .fleet-toolbar,
body.theme-sunset .fleet-welcome-header {
  background: rgba(24, 11, 32, 0.76) !important;
  border-color: rgba(251, 146, 60, 0.24) !important;
  box-shadow: 0 16px 42px rgba(0, 0, 0, 0.55), 0 0 28px rgba(234, 88, 12, 0.10) !important;
}
body.theme-sunset .global-header {
  background: rgba(18, 8, 26, 0.88) !important;
  border-bottom-color: rgba(251, 146, 60, 0.26) !important;
}
body.theme-sunset .kpi-card:hover,
body.theme-sunset .bot-card:hover {
  border-color: rgba(251, 146, 60, 0.55) !important;
  box-shadow: 0 20px 48px -4px rgba(0, 0, 0, 0.7), 0 0 32px rgba(251, 146, 60, 0.18) !important;
}
body.theme-sunset .cosmic-toggle-pill {
  background: linear-gradient(135deg, rgba(234, 88, 12, 0.35) 0%, rgba(168, 85, 247, 0.25) 100%) !important;
  border-color: rgba(251, 146, 60, 0.5) !important;
  color: #fed7aa !important;
}

/* ==========================================================================
   CHỦ ĐỀ 3: BÌNH MINH SINH THÁI (MORNING NATURE & BREEZE)
   ========================================================================== */
body.theme-morning .app-cosmic-stage {
  background:
    radial-gradient(ellipse at 80% 20%, rgba(254, 240, 138, 0.38) 0%, rgba(56, 189, 248, 0.20) 45%, transparent 75%),
    linear-gradient(180deg, #051a30 0%, #033252 24%, #026090 48%, #0ea5e9 74%, #064e3b 100%) !important;
  transition: background 0.6s ease;
}
body.theme-morning .app-cosmic-video {
  display: none !important;
}
body.theme-morning .app-cosmic-nebula.n1 {
  background: radial-gradient(circle, rgba(253, 224, 71, 0.28) 0%, rgba(250, 204, 21, 0.08) 50%, transparent 70%) !important;
  top: -8% !important; right: -4% !important; left: auto !important; width: 56vw !important; height: 56vw !important; opacity: 0.65 !important;
}
body.theme-morning .app-cosmic-nebula.n2 {
  background: radial-gradient(circle, rgba(56, 189, 248, 0.26) 0%, transparent 70%) !important;
  bottom: -15% !important; left: -8% !important; opacity: 0.55 !important;
}
body.theme-morning .app-cosmic-scrim {
  background:
    radial-gradient(circle at 50% 40%, rgba(3, 20, 36, 0.16) 0%, rgba(2, 14, 26, 0.55) 75%, rgba(1, 10, 20, 0.78) 100%),
    linear-gradient(rgba(255, 255, 255, 0.018) 1px, transparent 1px),
    linear-gradient(90deg, rgba(255, 255, 255, 0.018) 1px, transparent 1px) !important;
  background-size: 100% 100%, 36px 36px, 36px 36px !important;
}
body.theme-morning .card,
body.theme-morning .kpi-card,
body.theme-morning .bot-card,
body.theme-morning .fleet-toolbar,
body.theme-morning .fleet-welcome-header {
  background: rgba(7, 22, 38, 0.75) !important;
  border-color: rgba(56, 189, 248, 0.24) !important;
  box-shadow: 0 16px 42px rgba(0, 0, 0, 0.5), 0 0 28px rgba(14, 165, 233, 0.12) !important;
}
body.theme-morning .global-header {
  background: rgba(6, 18, 32, 0.88) !important;
  border-bottom-color: rgba(56, 189, 248, 0.28) !important;
}
body.theme-morning .kpi-card:hover,
body.theme-morning .bot-card:hover {
  border-color: rgba(56, 189, 248, 0.6) !important;
  box-shadow: 0 20px 48px -4px rgba(0, 0, 0, 0.7), 0 0 32px rgba(56, 189, 248, 0.2) !important;
}
body.theme-morning .cosmic-toggle-pill {
  background: linear-gradient(135deg, rgba(14, 165, 233, 0.35) 0%, rgba(16, 185, 129, 0.25) 100%) !important;
  border-color: rgba(56, 189, 248, 0.5) !important;
  color: #bae6fd !important;
}

/* ==========================================================================
   2. LOGIN GATE & RESTRICTION OVERLAYS (OBSIDIAN SPECULAR GLASS)
   ========================================================================== */
.login-gate {
  background: rgba(3, 6, 15, 0.35) !important;
  backdrop-filter: blur(4px);
}
.kbot-portal-wrapper {
  background: linear-gradient(155deg, rgba(10, 18, 34, 0.74) 0%, rgba(5, 9, 20, 0.88) 100%) !important;
  border: 1px solid rgba(56, 189, 248, 0.36) !important;
  box-shadow: 0 40px 100px rgba(0, 0, 0, 0.88), 0 0 70px rgba(14, 165, 233, 0.16), inset 0 1px 0 rgba(255, 255, 255, 0.18) !important;
  backdrop-filter: blur(28px) saturate(190%) !important; -webkit-backdrop-filter: blur(28px) saturate(190%) !important;
}
.kbot-landing-col {
  background: radial-gradient(circle at 15% 15%, rgba(56, 189, 248, 0.08) 0%, rgba(124, 58, 237, 0.05) 45%, transparent 75%) !important;
  border-right: 1px solid rgba(255, 255, 255, 0.09) !important;
}
.kbot-login-col {
  background: linear-gradient(180deg, rgba(13, 23, 42, 0.55) 0%, rgba(7, 12, 24, 0.75) 100%) !important;
}
.kbot-benefit-card, .kbot-steps-row, .kbot-commitments-box {
  background: rgba(8, 14, 28, 0.65) !important;
  border: 1px solid rgba(255, 255, 255, 0.085) !important;
  backdrop-filter: blur(12px) !important;
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.07) !important;
}
.account-restriction-overlay {
  background: radial-gradient(circle at 50% 40%, rgba(8, 15, 32, 0.78) 0%, rgba(2, 5, 12, 0.94) 100%) !important;
  backdrop-filter: blur(18px) saturate(160%) !important; -webkit-backdrop-filter: blur(18px) saturate(160%) !important;
}
.restriction-card {
  background: linear-gradient(165deg, rgba(15, 25, 45, 0.92) 0%, rgba(8, 13, 26, 0.97) 100%) !important;
  border: 1px solid rgba(56, 189, 248, 0.35) !important;
  box-shadow: 0 32px 80px rgba(0, 0, 0, 0.85), 0 0 45px rgba(14, 165, 233, 0.15), inset 0 1px 0 rgba(255, 255, 255, 0.15) !important;
}

/* ==========================================================================
   3. DASHBOARD COMMAND CENTER (HIGH-CONTRAST, LOW-NOISE MANAGEMENT UI)
   ========================================================================== */
#mainApp { position: relative; z-index: 1; }
.global-header {
  background: rgba(6, 11, 22, 0.85) !important;
  backdrop-filter: blur(22px) saturate(180%) !important; -webkit-backdrop-filter: blur(22px) saturate(180%) !important;
  border-bottom: 1px solid rgba(56, 189, 248, 0.22) !important;
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.55) !important;
}
.cosmic-toggle-pill {
  display: inline-flex; align-items: center; gap: 5px; padding: 5px 10px;
  font-size: 11.5px; font-weight: 700; border-radius: 999px;
  background: rgba(124, 58, 237, 0.16); border: 1px solid rgba(167, 139, 250, 0.35);
  color: #ddd6fe; cursor: pointer; transition: all 0.2s ease;
}
.cosmic-toggle-pill:hover {
  background: rgba(124, 58, 237, 0.28); border-color: rgba(167, 139, 250, 0.6); color: #fff;
}
.fleet-welcome-header {
  background: linear-gradient(135deg, rgba(12, 20, 38, 0.78) 0%, rgba(7, 12, 24, 0.9) 100%) !important;
  border: 1px solid rgba(56, 189, 248, 0.18) !important;
  box-shadow: 0 18px 45px -10px rgba(0, 0, 0, 0.6), inset 0 1px 0 rgba(255, 255, 255, 0.12) !important;
}
.fleet-resource-bar {
  background: linear-gradient(90deg, rgba(11, 19, 35, 0.82) 0%, rgba(14, 24, 44, 0.78) 50%, rgba(11, 19, 35, 0.82) 100%) !important;
  border: 1px solid rgba(56, 189, 248, 0.16) !important; border-radius: 16px !important;
  box-shadow: 0 10px 30px rgba(0, 0, 0, 0.4), inset 0 1px 0 rgba(255, 255, 255, 0.08) !important;
}
.user-rental-dashboard-banner {
  background: linear-gradient(135deg, rgba(14, 26, 48, 0.86) 0%, rgba(9, 16, 32, 0.92) 100%) !important;
  border: 1px solid rgba(56, 189, 248, 0.38) !important; border-radius: 16px !important;
  box-shadow: 0 12px 32px rgba(0, 0, 0, 0.45), 0 0 25px rgba(14, 165, 233, 0.12), inset 0 1px 0 rgba(255, 255, 255, 0.12) !important;
}
.kpi-card {
  background: linear-gradient(175deg, rgba(14, 23, 42, 0.84) 0%, rgba(8, 13, 25, 0.94) 100%) !important;
  border: 1px solid rgba(255, 255, 255, 0.085) !important;
  box-shadow: 0 14px 36px -6px rgba(0, 0, 0, 0.55), inset 0 1px 0 rgba(255, 255, 255, 0.1) !important;
}
.kpi-value {
  font-family: 'JetBrains Mono', ui-monospace, monospace !important;
  font-variant-numeric: tabular-nums !important; font-weight: 850 !important;
}
.fleet-toolbar {
  background: rgba(10, 17, 32, 0.84) !important;
  border: 1px solid rgba(255, 255, 255, 0.08) !important; border-radius: 16px !important;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.38), inset 0 1px 0 rgba(255, 255, 255, 0.07) !important;
}
.bot-card {
  background: linear-gradient(168deg, rgba(13, 22, 38, 0.88) 0%, rgba(7, 12, 22, 0.96) 100%) !important;
  backdrop-filter: blur(16px) saturate(150%); -webkit-backdrop-filter: blur(16px) saturate(150%);
  border: 1px solid rgba(255, 255, 255, 0.085) !important; border-radius: 18px !important;
  box-shadow: 0 14px 38px -6px rgba(0, 0, 0, 0.6), inset 0 1px 0 rgba(255, 255, 255, 0.09) !important;
}
.bot-card:hover {
  transform: translateY(-4px) !important; border-color: rgba(56, 189, 248, 0.48) !important;
  box-shadow: 0 22px 52px -6px rgba(0, 0, 0, 0.75), 0 0 28px rgba(56, 189, 248, 0.15), inset 0 1px 0 rgba(255, 255, 255, 0.15) !important;
}
.bot-card.status-afk { border-left: 3.5px solid #10b981 !important; }
.bot-card.status-waiting { border-left: 3.5px solid #f59e0b !important; }
.bot-card.status-offline { border-left: 3.5px solid #ef4444 !important; }
.bot-card.status-unreachable { border-left: 3.5px solid #f97316 !important; }

/* ==========================================================================
   4. DETAIL PAGE PANELS, USER/AUDIT TABLES & ENTERPRISE MODALS
   ========================================================================== */
.panel, .full-page-card {
  background: linear-gradient(170deg, rgba(12, 20, 36, 0.86) 0%, rgba(7, 12, 23, 0.94) 100%) !important;
  border: 1px solid rgba(255, 255, 255, 0.085) !important; border-radius: 18px !important;
  box-shadow: 0 16px 40px -8px rgba(0, 0, 0, 0.6), inset 0 1px 0 rgba(255, 255, 255, 0.09) !important;
  backdrop-filter: blur(18px) saturate(160%) !important; -webkit-backdrop-filter: blur(18px) saturate(160%) !important;
}
.info-item {
  background: rgba(6, 11, 22, 0.72) !important;
  border: 1px solid rgba(255, 255, 255, 0.065) !important; border-radius: 12px !important;
}
.user-table-wrap {
  background: rgba(7, 12, 24, 0.84) !important;
  border: 1px solid rgba(255, 255, 255, 0.09) !important; border-radius: 16px !important;
  backdrop-filter: blur(16px) !important;
}
.user-table th {
  background: rgba(11, 19, 35, 0.96) !important;
  border-bottom: 1px solid rgba(56, 189, 248, 0.18) !important;
}
.modal {
  background: rgba(2, 5, 14, 0.78) !important;
  backdrop-filter: blur(14px) saturate(160%) !important; -webkit-backdrop-filter: blur(14px) saturate(160%) !important;
}
.modal-card {
  background: linear-gradient(165deg, rgba(13, 22, 40, 0.94) 0%, rgba(7, 12, 24, 0.98) 100%) !important;
  border: 1px solid rgba(56, 189, 248, 0.36) !important;
  box-shadow: 0 32px 90px rgba(0, 0, 0, 0.88), 0 0 50px rgba(14, 165, 233, 0.14), inset 0 1px 0 rgba(255, 255, 255, 0.16) !important;
}
@media (prefers-reduced-motion: reduce) {
  .app-cosmic-video, .app-cosmic-canvas { display: none !important; }
}
</style>
</head>
<body>
<div id="appCosmicStage" class="app-cosmic-stage" aria-hidden="true">
  <video id="appGalaxyVideo" class="app-cosmic-video" autoplay loop muted playsinline preload="auto" onerror="this.style.display='none'">
    <source src="https://cdn.pixabay.com/video/2020/04/18/36466-410655390_large.mp4" type="video/mp4">
    <source src="https://assets.mixkit.co/videos/preview/mixkit-stars-in-space-1610-large.mp4" type="video/mp4">
  </video>
  <div class="app-cosmic-nebula n1"></div>
  <div class="app-cosmic-nebula n2"></div>
  <canvas id="appStarfieldCanvas" class="app-cosmic-canvas"></canvas>
  <div class="app-cosmic-scrim"></div>
</div>
<div id="loginGate" class="login-gate hidden">
  <div class="kbot-portal-wrapper">
    <!-- CỘT TRÁI: SAAS SHOWCASE GIỚI THIỆU SẢN PHẨM & QUYỀN LỢI & DISCORD -->
    <div class="kbot-landing-col">
      <div class="kbot-brand-badge">
        <span class="kbot-pulse-dot"></span>
        <span>KBOT • GIẢI PHÁP AFK KINGMC SỐ 1</span>
      </div>

      <h1 class="kbot-landing-title">
        Hệ Thống Cho Thuê Bot AFK KingMC
        <span class="kbot-gradient-text">Tự Động 24/7 Đám Mây</span>
      </h1>

      <p class="kbot-landing-desc">
        Treo Máy Thông Minh - Tự Động Thu Hoạch - Bất Tử 24/7 Không Cần Bật Máy Tính. Nền tảng chuyên nghiệp số 1 dành riêng cho người chơi máy chủ KingMC.
      </p>

      <!-- NÚT DISCORD CỘNG ĐỒNG HỖ TRỢ 24/7 -->
      <a href="https://discord.gg/mJWX5Xp3z" target="_blank" rel="noopener noreferrer" class="kbot-discord-btn" title="Tham gia Discord Hỗ Trợ 24/7">
        <svg class="kbot-discord-icon" viewBox="0 0 24 24" width="24" height="24" fill="currentColor">
          <path d="M20.317 4.37a19.791 19.791 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.25.077.077 0 0 0-.079-.037A19.736 19.736 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 0 0 .031.057 19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028 14.09 14.09 0 0 0 1.226-1.994.076.076 0 0 0-.041-.106 13.107 13.107 0 0 1-1.872-.892.077.077 0 0 1-.008-.128 10.2 10.2 0 0 0 .372-.292.074.074 0 0 1 .077-.01c3.929 1.793 8.18 1.793 12.061 0a.074.074 0 0 1 .078.01c.12.098.246.198.373.292a.077.077 0 0 1-.006.127 12.299 12.299 0 0 1-1.873.894.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028 19.839 19.839 0 0 0 6.002-3.03.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.028zM8.02 15.33c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.956-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.956 2.418-2.157 2.418zm7.975 0c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.955-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.946 2.418-2.157 2.418z"/>
        </svg>
        <span class="kbot-discord-text">
          <strong>Gia Nhập Cộng Đồng Discord Hỗ Trợ 24/7</strong>
          <small>Giải đáp thắc mắc, mua Giftcode & hỗ trợ kỹ thuật tức thì</small>
        </span>
        <span class="kbot-discord-badge">ONLINE</span>
      </a>

      <!-- 5 QUYỀN LỢI KHÁCH THUÊ -->
      <div class="kbot-section-subtitle">💎 QUYỀN LỢI DÀNH CHO KHÁCH THUÊ BOT</div>
      <div class="kbot-benefits-grid">
        <div class="kbot-benefit-card">
          <div class="kbot-benefit-icon">⚡</div>
          <div class="kbot-benefit-info">
            <strong>Auto Totem Bất Tử</strong>
            <p>Tự động trang bị totem tay phụ khi máu thấp (&lt; 5 tim), chống té ngã &amp; quái cắn khi AFK.</p>
          </div>
        </div>
        <div class="kbot-benefit-card">
          <div class="kbot-benefit-icon">🍞</div>
          <div class="kbot-benefit-info">
            <strong>Auto Ăn &amp; Chống Đói</strong>
            <p>Tự tìm thức ăn trong túi đồ khi thanh đói giảm, đảm bảo không bao giờ chết đói.</p>
          </div>
        </div>
        <div class="kbot-benefit-card">
          <div class="kbot-benefit-icon">💬</div>
          <div class="kbot-benefit-info">
            <strong>Auto Chat &amp; Quảng Cáo</strong>
            <p>Lập lịch phát ngôn rao bán shop, lệnh chat định kỳ tự động và vi chuyển động chống kick AFK.</p>
          </div>
        </div>
        <div class="kbot-benefit-card">
          <div class="kbot-benefit-icon">⏰</div>
          <div class="kbot-benefit-info">
            <strong>Hẹn Giờ Thông Minh</strong>
            <p>Lập lịch bật/tắt theo giờ cố định hoặc chu kỳ lặp giúp bot hoạt động như người chơi thật.</p>
          </div>
        </div>
        <div class="kbot-benefit-card">
          <div class="kbot-benefit-icon">🔑</div>
          <div class="kbot-benefit-info">
            <strong>Tự Chủ Đổi Mật Khẩu</strong>
            <p>Tự do đổi mật khẩu /login hoặc tên nhân vật ingame trên Web bất cứ lúc nào, an toàn 100%.</p>
          </div>
        </div>
      </div>

      <!-- QUY TRÌNH 3 BƯỚC HOẠT ĐỘNG -->
      <div class="kbot-section-subtitle" style="margin-top:14px;">🚀 CÁCH THỨC HOẠT ĐỘNG (3 BƯỚC ĐƠN GIẢN)</div>
      <div class="kbot-steps-row">
        <div class="kbot-step-item">
          <div class="kbot-step-num">Bước 1: Kích Hoạt</div>
          <div>Đăng nhập tài khoản hoặc kích hoạt bằng <strong>Mã Key gia hạn</strong>.</div>
        </div>
        <div class="kbot-step-arrow">→</div>
        <div class="kbot-step-item">
          <div class="kbot-step-num">Bước 2: Cài Đặt</div>
          <div>Điền Username, Mật khẩu KingMC và bật các chế độ Auto mong muốn.</div>
        </div>
        <div class="kbot-step-arrow">→</div>
        <div class="kbot-step-item">
          <div class="kbot-step-num">Bước 3: Tận Hưởng</div>
          <div>Nhấn <strong>Bật Bot</strong> — Hệ thống đám mây sẽ tự động treo máy 24/7!</div>
        </div>
      </div>

      <!-- CAM KẾT DỊCH VỤ / SLA -->
      <div class="kbot-commitments-box">
        <div class="kbot-commit-item">
          <span class="kbot-commit-icon">🛡️</span>
          <div>
            <strong>Cam Kết 99.9% Uptime</strong>
            <small>Đám mây ổn định, tự động Reconnect sau khi cụm máy chủ KingMC bảo trì.</small>
          </div>
        </div>
        <div class="kbot-commit-item">
          <span class="kbot-commit-icon">🔒</span>
          <div>
            <strong>Bảo Mật Tuyệt Đối</strong>
            <small>Mã hóa chuẩn scrypt quân sự, không bao giờ lộ mật khẩu hay đồ đạc của khách.</small>
          </div>
        </div>
      </div>
    </div>

    <!-- CỘT PHẢI: FORM ĐĂNG NHẬP -->
    <div class="kbot-login-col">
      <div class="login-card" style="position:relative; width:100%; max-width:400px; box-shadow:none; padding:20px 10px; background:transparent; border:none;">
        <button type="button" id="loginGateCloseBtn" onclick="if(currentUser) hideLoginGate();" style="display:none;position:absolute;top:-10px;right:0;background:none;border:none;color:var(--muted);font-size:18px;cursor:pointer;padding:4px 8px;" title="Đóng">✕</button>
        <div class="login-header" style="margin-bottom:14px;">
          <div class="login-icon" style="font-size:32px;">🛡️</div>
          <h2 class="login-title" style="font-size:19px;">CỔNG ĐIỀU KHIỂN KBOT</h2>
          <div class="login-subtitle">Hệ Thống Cho Thuê Bot AFK KingMC • Uptime 99.9%</div>
        </div>

        <!-- TAB SWITCHER: LOGIN vs REGISTER -->
        <div style="display:flex;gap:6px;margin-bottom:14px;background:rgba(255,255,255,0.04);padding:4px;border-radius:10px;">
          <button type="button" id="tabBtnLogin" onclick="switchLoginGateTab('login')" style="flex:1;padding:8px;border-radius:8px;font-size:13px;font-weight:750;background:rgba(56,189,248,0.2);color:#38bdf8;border:1px solid rgba(56,189,248,0.4);cursor:pointer;">
            🚀 Đăng Nhập
          </button>
          <button type="button" id="tabBtnRegister" onclick="switchLoginGateTab('register')" style="flex:1;padding:8px;border-radius:8px;font-size:13px;font-weight:750;background:transparent;color:#94a3b8;border:1px solid transparent;cursor:pointer;">
            📝 Đăng Ký Mới
          </button>
        </div>

        <div id="loginAlert" class="login-alert hidden"></div>

        <!-- FORM ĐĂNG NHẬP -->
        <form id="loginForm" onsubmit="handleLoginSubmit(event)" style="display:flex;flex-direction:column;gap:14px;text-align:left;">
          <div class="form-row" style="margin-bottom:0;">
            <label for="loginUsername">TÊN ĐĂNG NHẬP</label>
            <input id="loginUsername" type="text" autocomplete="username" placeholder="Nhập tên đăng nhập..." required autofocus>
          </div>
          <div class="form-row" style="margin-bottom:0;">
            <label for="loginPassword">MẬT KHẨU TRUY CẬP</label>
            <div class="password-input-wrap">
              <input id="loginPassword" type="password" autocomplete="current-password" placeholder="Nhập mật khẩu..." required>
              <button type="button" class="password-toggle-btn" onclick="togglePasswordVisibility('loginPassword', this)">👁</button>
            </div>
          </div>
          <div class="form-row" style="margin-bottom:0;">
            <label for="loginLicenseKey" style="display:flex;justify-content:space-between;align-items:center;">
              <span style="color:#38bdf8;">🎁 MÃ KEY GIA HẠN (NẾU CÓ)</span>
              <span style="font-size:11px;color:var(--muted);font-weight:normal;">Không bắt buộc</span>
            </label>
            <input id="loginLicenseKey" type="text" placeholder="Nhập mã Key để tự mở khóa & gia hạn ngay..." style="text-transform:uppercase;border-color:rgba(56,189,248,0.3);">
          </div>
          <div style="display:flex;justify-content:space-between;align-items:center;font-size:12px;margin:2px 0 6px;">
            <label class="check-row" style="margin:0;font-size:12px;cursor:pointer;">
              <input id="loginRememberMe" type="checkbox" checked> <span>Ghi nhớ phiên đăng nhập (30 ngày)</span>
            </label>
          </div>
          <button id="loginSubmitBtn" type="submit" class="primary" style="padding:12px;font-size:14.5px;font-weight:750;letter-spacing:0.4px;">
            🚀 ĐĂNG NHẬP VÀO HỆ THỐNG
          </button>
        </form>

        <!-- FORM ĐĂNG KÝ -->
        <form id="registerForm" onsubmit="handleInAppRegisterSubmit(event)" style="display:none;flex-direction:column;gap:14px;text-align:left;">
          <div class="form-row" style="margin-bottom:0;">
            <label for="regUsername">TÊN ĐĂNG NHẬP MỚI</label>
            <input id="regUsername" type="text" autocomplete="username" placeholder="Chữ, số, gạch dưới (3-32 ký tự)..." required>
          </div>
          <div class="form-row" style="margin-bottom:0;">
            <label for="regPassword">MẬT KHẨU (TỐI THIỂU 5 KÝ TỰ)</label>
            <div class="password-input-wrap">
              <input id="regPassword" type="password" autocomplete="new-password" placeholder="Tối thiểu 5 ký tự (chữ hoặc số, phân biệt hoa thường)..." required>
              <button type="button" class="password-toggle-btn" onclick="togglePasswordVisibility('regPassword', this)">👁</button>
            </div>
          </div>
          <div class="form-row" style="margin-bottom:0;">
            <label for="regConfirmPassword">XÁC NHẬN MẬT KHẨU</label>
            <div class="password-input-wrap">
              <input id="regConfirmPassword" type="password" autocomplete="new-password" placeholder="Nhập lại mật khẩu..." required>
              <button type="button" class="password-toggle-btn" onclick="togglePasswordVisibility('regConfirmPassword', this)">👁</button>
            </div>
          </div>
          <div class="form-row" style="margin-bottom:0;">
            <label for="regLicenseKey" style="display:flex;justify-content:space-between;align-items:center;">
              <span style="color:#38bdf8;">🎁 MÃ KEY GIA HẠN (NẾU CÓ)</span>
              <span style="font-size:11px;color:var(--muted);font-weight:normal;">Tùy chọn (Mặc định tặng 1 ngày)</span>
            </label>
            <input id="regLicenseKey" type="text" placeholder="Nhập mã Key để kích hoạt gói ngay..." style="text-transform:uppercase;border-color:rgba(56,189,248,0.3);">
          </div>
          <button id="regSubmitBtn" type="submit" class="primary" style="padding:12px;font-size:14.5px;font-weight:750;letter-spacing:0.4px;background:#059669;border-color:#10b981;">
            📝 TẠO TÀI KHOẢN &amp; VÀO HỆ THỐNG
          </button>
        </form>

        <div style="margin-top:14px;padding-top:12px;border-top:1px solid rgba(255,255,255,0.06);font-size:11.5px;color:var(--muted);line-height:1.5;">
          • Quản trị viên: Đăng nhập tài khoản <code>admin</code>.<br/>
          • Khách mới: Tự đăng ký tài khoản (tặng 1 ngày dùng thử hoặc nhập Key).<br/>
          • Tài khoản hết hạn: Đăng nhập để nạp Key hoặc vượt link nhận +12h miễn phí.
        </div>
      </div>
    </div>
  </div>
</div>

<!-- OVERLAY TẠM KHÓA TÀI KHOẢN (BLUR BACKGROUND) -->
<div id="accountLockedOverlay" class="account-restriction-overlay hidden">
  <div class="restriction-card">
    <div class="restriction-icon">🔒</div>
    <h2 class="restriction-title">TÀI KHOẢN ĐANG BỊ TẠM KHÓA</h2>
    <div class="restriction-subtitle">Quyền truy cập bảng điều khiển của bạn đã bị Quản trị viên tạm dừng.</div>
    <div class="restriction-reason-box">
      <div class="reason-label">📢 LỜI NHẮN TỪ QUẢN TRỊ VIÊN:</div>
      <div id="lockedReasonMessage" class="reason-content">Tài khoản của bạn đang bị tạm khóa. Vui lòng liên hệ Admin để được hỗ trợ.</div>
    </div>
    <div class="restriction-actions">
      <a href="https://discord.gg/mJWX5Xp3z" target="_blank" rel="noopener noreferrer" class="btn-discord">
        💬 Liên Hệ Hỗ Trợ Discord
      </a>
      <button type="button" class="btn-logout-overlay" onclick="logout()">
        🚪 Đăng Xuất
      </button>
    </div>
  </div>
</div>

<!-- OVERLAY HẾT HẠN THUÊ BOT (BLUR BACKGROUND) -->
<div id="accountExpiredOverlay" class="account-restriction-overlay hidden">
  <div class="restriction-card">
    <div class="restriction-icon">⏳</div>
    <h2 class="restriction-title">GÓI THUÊ BOT ĐÃ HẾT HẠN</h2>
    <div class="restriction-subtitle">Thời hạn sử dụng dịch vụ bot AFK của bạn đã kết thúc. Vui lòng nạp Mã Key để mở khóa hoặc liên hệ Discord.</div>
    <div class="expired-redeem-box">
      <label>KÍCH HOẠT &amp; GIA HẠN NGAY BẰNG MÃ KEY</label>
      <div style="display:flex;gap:8px;margin-top:6px;">
        <input type="text" id="expiredKeyInput" placeholder="Nhập mã Key gia hạn..." style="text-transform:uppercase;flex:1;">
        <button type="button" class="primary" onclick="redeemKeyFromExpiredOverlay()">🚀 Kích Hoạt</button>
      </div>
      <div id="expiredKeyAlert" class="login-alert hidden" style="margin-top:8px;"></div>
    </div>

    <!-- LINK4M REWARD BOX FOR EXPIRED ACCOUNTS -->
    <div style="margin:12px 0 14px;padding:14px;background:rgba(56,189,248,0.08);border:1px solid rgba(56,189,248,0.25);border-radius:10px;text-align:center;">
      <div style="font-size:12.5px;color:#cbd5e1;margin-bottom:8px;font-weight:600;">Chưa có Key? Bạn có thể nhận ngay 12h dùng thử miễn phí:</div>
      <button type="button" id="btnExpiredLink4mReward" class="primary" onclick="startLink4mReward(this)" style="display:inline-flex;align-items:center;gap:6px;padding:9px 18px;font-weight:800;background:linear-gradient(135deg, #0284c7 0%, #0369a1 100%);box-shadow:0 0 15px rgba(2,132,199,0.35);cursor:pointer;">
        <span>⚡</span> Vượt link +12h hồi sinh tài khoản <span id="expiredLink4mUsageBadge" style="font-size:11px;background:rgba(0,0,0,0.35);padding:2px 6px;border-radius:4px;margin-left:4px;">0/2 lượt</span>
      </button>
    </div>
    <div class="restriction-actions">
      <a href="https://discord.gg/mJWX5Xp3z" target="_blank" rel="noopener noreferrer" class="btn-discord">
        💬 Vào Discord KingMC Gia Hạn
      </a>
      <button type="button" class="btn-logout-overlay" onclick="logout()">
        🚪 Đăng Xuất
      </button>
    </div>
  </div>
</div>

<div id="mainApp" class="app">
  <!-- GLOBAL TOP-RIGHT PINNED NAVIGATION HEADER (PERSISTENT ON ALL TABS PC & MOBILE) -->
  <header id="globalHeader" class="global-header">
    <div class="global-header-left">
      <div class="global-header-brand" onclick="navigateTo('dashboard')">
        <span class="global-logo">👑</span>
        <span class="global-brand-text">KBOT</span>
        <span class="vip-pill-mini">V11.8 PRO</span>
      </div>
      <nav class="global-nav-pills">
        <button type="button" class="nav-pill-btn active" id="navPillHome" onclick="navigateTo('dashboard')">
          📊 Dashboard
        </button>
        <button type="button" class="nav-pill-btn admin-only" id="navPillUsers" onclick="navigateTo('users')">
          👥 Quản Lý User &amp; Key
        </button>
        <button type="button" class="nav-pill-btn admin-only" id="navPillAudit" onclick="navigateTo('audit')">
          📋 Nhật Ký (Audit)
        </button>
        <button type="button" class="nav-pill-btn admin-only" id="navPillBackup" onclick="navigateTo('backup')">
          💾 Sao Lưu
        </button>
        <button type="button" class="nav-pill-btn admin-only" id="navPillSupabase" onclick="openSupabaseModal()">
          ☁️ Supabase Cloud
        </button>
      </nav>
    </div>
    <div class="global-header-right">
      <button type="button" id="cosmicModeToggleBtn" class="cosmic-toggle-pill" onclick="cycleDashboardCosmicMode()" title="Đổi mức độ nền Galaxy trên Dashboard (Dịu / Sâu / Tĩnh)">🌌 Vũ trụ: Dịu</button>
      <span id="globalUserRoleBadge" class="vip-pill" style="background:rgba(148,163,184,0.15);color:#94a3b8;border-color:rgba(148,163,184,0.3);">🔒 CHƯA ĐĂNG NHẬP</span>
      <span class="ram-pill">📊 <strong id="globalManagerRam">-- MB</strong></span>

      <!-- ACCOUNT MENU BUTTON - PINNED SAT GOC PHAI -->
      <div class="user-profile-menu-wrap" style="position:relative;">
        <button id="globalUserProfileBtn" class="user-profile-btn" onclick="toggleGlobalProfileDropdown(event)">
          <span class="user-avatar-badge" id="globalUserAvatarBadge">👑</span>
          <span class="user-profile-name" id="globalUserProfileName">admin</span>
          <span class="user-profile-arrow">▾</span>
        </button>

        <!-- DROPDOWN MENU (RIGHT: 0; EXPANDS SAFELY INWARD) -->
        <div id="globalUserProfileDropdown" class="user-profile-dropdown hidden" onclick="event.stopPropagation()">
          <!-- DANG XUAT O NGAY DAU TAB PHIA TREN -->
          <div class="dropdown-top-logout-wrap">
            <button type="button" class="dropdown-top-logout-btn" onclick="logout()">
              🚪 ĐĂNG XUẤT
            </button>
          </div>

          <div class="profile-dropdown-header">
            <div class="profile-dropdown-avatar" id="globalDropdownAvatar">👑</div>
            <div class="profile-dropdown-info">
              <div class="profile-dropdown-user" id="globalDropdownUsername">admin</div>
              <div class="profile-dropdown-role" id="globalDropdownRole">👑 Quản trị viên</div>
              <div class="profile-dropdown-expires" id="globalDropdownExpires" style="display:none;font-size:11px;color:#38bdf8;margin-top:2px;font-weight:700;"></div>
            </div>
          </div>
          <div class="profile-dropdown-divider"></div>

          <div class="profile-dropdown-menu">
            <div class="profile-menu-section-title">CHUYỂN TRANG NHANH</div>
            <div class="big-tab-item" onclick="navigateTo('dashboard'); closeGlobalProfileDropdown();">
              <span class="menu-icon">📊</span>
              <div class="menu-text">
                <strong>Dashboard</strong>
                <small>Xem và điều khiển danh sách bot</small>
              </div>
            </div>
            <div class="big-tab-item admin-only" onclick="navigateTo('users'); closeGlobalProfileDropdown();">
              <span class="menu-icon">👥</span>
              <div class="menu-text">
                <strong>Quản Lý User &amp; Key</strong>
                <small>Cấp quyền, gia hạn, xem pass, khóa</small>
              </div>
            </div>
            <div class="big-tab-item admin-only" onclick="navigateTo('audit'); closeGlobalProfileDropdown();">
              <span class="menu-icon">📋</span>
              <div class="menu-text">
                <strong>Nhật Ký Hoạt Động (Audit)</strong>
                <small>Lịch sử thao tác, lệnh và can thiệp</small>
              </div>
            </div>
            <div class="big-tab-item admin-only" onclick="openSupabaseModal(); closeGlobalProfileDropdown();">
              <span class="menu-icon">☁️</span>
              <div class="menu-text">
                <strong>Supabase Cloud Database</strong>
                <small>Lưu trữ vĩnh viễn, chống mất dữ liệu khi restart</small>
              </div>
            </div>

            <div class="profile-dropdown-divider admin-only"></div>
            <div class="profile-menu-section-title admin-only">TIỆN ÍCH QUẢN TRỊ</div>
            <button type="button" class="profile-menu-item admin-only" onclick="openAnnouncementAdminModal(); closeGlobalProfileDropdown();">
              <span>📢 Thông Báo Người Dùng</span>
            </button>
            <button type="button" class="profile-menu-item admin-only" onclick="openBatchSettingsModal(); closeGlobalProfileDropdown();">
              <span>⚙ Đồng Bộ Cài Đặt Fleet</span>
            </button>
            <button type="button" class="profile-menu-item admin-only" onclick="openAdminModal(); closeGlobalProfileDropdown();">
              <span>🔑 Mật Khẩu Minecraft Bot</span>
            </button>

            <div class="profile-dropdown-divider"></div>
            <button type="button" class="profile-menu-item" onclick="openChangePasswordModal(); closeGlobalProfileDropdown();">
              <span>🔐 Đổi Mật Khẩu</span>
            </button>
            <button id="globalRenewKeyBtn" type="button" class="profile-menu-item user-only" onclick="openRenewModal(); closeGlobalProfileDropdown();">
              <span>🎁 Gia Hạn Bằng Mã Key</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  </header>

  <section id="homePage">
    <!-- FLEET HERO WELCOME HEADER -->
    <div class="fleet-welcome-header">
      <div class="fleet-welcome-text">
        <div class="fleet-welcome-title-wrap">
          <h1 class="fleet-welcome-title">👋 Bảng Điều Khiển Hạm Đội Bot</h1>
          <span class="vip-pill">👑 KBOT V11.8 PRO</span>
          <span id="userRoleBadge" class="vip-pill" style="background:rgba(148,163,184,0.15);color:#94a3b8;border-color:rgba(148,163,184,0.3);">🔒 CHƯA ĐĂNG NHẬP</span>
          <span class="platform-pill">⚡ RENDER CLOUD</span>
          <span class="ram-pill">📊 RAM: <strong id="managerRamUsage">-- MB</strong></span>
        </div>
        <div id="homeSubtitle" class="fleet-welcome-subtitle">Hệ Thống Cho Thuê Bot AFK KingMC Tự Động • Giám Sát Đa Máy Chủ Real-Time • Uptime 99.9%</div>
      </div>
      <div class="fleet-welcome-actions">
        <button class="primary admin-only" onclick="openAddBotModal()">＋ Thêm Bot Mới</button>
        <button id="btnAnnouncementAdmin" class="admin-only" onclick="openAnnouncementAdminModal()">📢 Thông Báo User</button>
        <button class="admin-only" onclick="openBatchSettingsModal()">⚙ Đồng Bộ Setting</button>
        <button class="admin-only" onclick="openAdminModal()">🔑 Mật Khẩu Bot</button>
        <button class="secondary admin-only" onclick="openSupabaseModal()" title="Mở trung tâm sao lưu & phục hồi dữ liệu Supabase Cloud">☁️ Supabase Cloud</button>
      </div>
    </div>

    <!-- User Rental Banner (Prominently displaying expiration date, hours, minutes and live countdown) -->
    <div id="userRentalDashboardBanner" class="user-rental-dashboard-banner" style="display:none;margin-bottom:16px;padding:14px 18px;border-radius:12px;background:rgba(30,41,59,0.7);border:1px solid rgba(59,130,246,0.35);backdrop-filter:blur(8px);align-items:center;justify-content:space-between;flex-wrap:wrap;gap:12px;">
      <div style="display:flex;align-items:center;gap:12px;">
        <div style="font-size:26px;" id="userRentalBannerIcon">⏳</div>
        <div>
          <div style="font-size:14px;font-weight:700;color:var(--text);display:flex;align-items:center;gap:8px;">
            <span id="userRentalBannerTitle">Thông Tin Thuê Dịch Vụ Của Bạn:</span>
            <span id="userRentalBannerPlan" style="font-size:12px;padding:2px 8px;border-radius:6px;background:rgba(59,130,246,0.2);color:#60a5fa;border:1px solid rgba(59,130,246,0.3);">Gói thường</span>
          </div>
          <div style="font-size:13px;color:var(--muted);margin-top:3px;">
            Hạn sử dụng: <b id="userRentalBannerExactTime" style="color:var(--text);font-family:monospace;">--:-- - --/--/----</b>
            • Trạng thái: <span id="userRentalBannerCountdown" style="font-weight:700;color:var(--green);">Còn -- ngày -- giờ -- phút</span>
          </div>
        </div>
      </div>
      <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;">
        <button id="btnUserLink4mReward" class="small secondary" onclick="startLink4mReward(this)" style="display:inline-flex;align-items:center;gap:6px;padding:8px 14px;font-weight:700;color:#38bdf8;border-color:rgba(56,189,248,0.4);background:rgba(56,189,248,0.12);" title="Vượt link quảng cáo để nhận thêm 12 giờ sử dụng">
          <span>⚡</span> Vượt link +12h <span id="link4mUsageBadge" style="font-size:11px;background:rgba(56,189,248,0.25);padding:2px 6px;border-radius:4px;color:#fff;">0/2 lượt</span>
        </button>
        <button class="small primary" onclick="openRenewModal()" style="display:inline-flex;align-items:center;gap:6px;padding:8px 14px;font-weight:600;">
          <span>🎁</span> Nạp Key Gia Hạn
        </button>
      </div>
    </div>

    <!-- Fleet Resource Bar (Eco & RAM Watchdog) -->
    <div class="fleet-resource-bar" id="fleetResourceBar">
      <div class="fleet-res-item">
        <span class="fleet-res-icon">🌱</span>
        <div>
          <div class="fleet-res-label">Eco Mode Fleet</div>
          <div class="fleet-res-val"><span id="fleetEcoCount">0</span>/<span id="fleetEcoTotal">0</span> Active</div>
        </div>
      </div>
      <div class="fleet-res-item">
        <span class="fleet-res-icon">🧠</span>
        <div>
          <div class="fleet-res-label">Tổng RAM Bot (Fleet)</div>
          <div class="fleet-res-val" id="fleetTotalRam">0 MB</div>
        </div>
      </div>
      <div class="fleet-res-item">
        <span class="fleet-res-icon">⚡</span>
        <div>
          <div class="fleet-res-label">RAM TB / Bot</div>
          <div class="fleet-res-val" id="fleetAvgRam">0 MB</div>
        </div>
      </div>
      <div class="fleet-res-item">
        <span class="fleet-res-icon">📉</span>
        <div>
          <div class="fleet-res-label">CPU Tiết Kiệm (AFK)</div>
          <div class="fleet-res-val" style="color:var(--green);" id="fleetCpuSaved">~80%</div>
        </div>
      </div>
      <div class="fleet-res-item">
        <span class="fleet-res-icon">🛡️</span>
        <div>
          <div class="fleet-res-label">Watchdog Lock</div>
          <div class="fleet-res-val" style="color:#38bdf8;">220 MB RAM Limit</div>
        </div>
      </div>
    </div>

    <!-- BENTO KPI CARDS GRID -->
    <div class="kpi-grid">
      <div class="kpi-card kpi-total">
        <div class="kpi-header">
          <span class="kpi-title">Tổng Số Bot Hạm Đội</span>
          <span class="kpi-icon">🤖</span>
        </div>
        <div id="kpiTotal" class="kpi-value">0</div>
        <div class="kpi-sub">Sức chứa hạm đội đám mây</div>
      </div>
      <div class="kpi-card kpi-health">
        <div class="kpi-header">
          <span class="kpi-title">Sức Khỏe Hạm Đội</span>
          <span class="kpi-icon">❤️‍🔥</span>
        </div>
        <div id="kpiFleetHealth" class="kpi-value" style="color:var(--green)">100%</div>
        <div class="kpi-sub" id="kpiFleetHealthSub">Hệ thống tối ưu</div>
      </div>
      <div class="kpi-card kpi-afk">
        <div class="kpi-header">
          <span class="kpi-title">Đang AFK Ingame</span>
          <span class="kpi-icon pulse-icon">🟢</span>
        </div>
        <div id="kpiAfk" class="kpi-value" style="color:var(--green)">0</div>
        <div class="kpi-sub">Bot đang cắm chuột trực tiếp</div>
      </div>
      <div class="kpi-card kpi-online">
        <div class="kpi-header">
          <span class="kpi-title">Online / Chờ Vào</span>
          <span class="kpi-icon">🟡</span>
        </div>
        <div id="kpiOnline" class="kpi-value" style="color:var(--blue)">0</div>
        <div class="kpi-sub">Đang kết nối / sảnh chờ</div>
      </div>
      <div class="kpi-card kpi-offline">
        <div class="kpi-header">
          <span class="kpi-title">Offline / Kicked</span>
          <span class="kpi-icon">🔴</span>
        </div>
        <div id="kpiOffline" class="kpi-value" style="color:var(--red)">0</div>
        <div class="kpi-sub">Mất kết nối server / Bị kick</div>
      </div>
      <div class="kpi-card kpi-unreachable">
        <div class="kpi-header">
          <span class="kpi-title">Lỗi / Unreachable</span>
          <span class="kpi-icon">⚠️</span>
        </div>
        <div id="kpiUnreachable" class="kpi-value" style="color:#f97316">0</div>
        <div class="kpi-sub">Mất kết nối máy chủ bot con</div>
      </div>
    </div>

    <!-- FLEET COMMAND CENTER: ROW 1 (PRIMARY BATCH CONTROLS & UTILITIES) -->
    <div class="fleet-toolbar">
      <div class="fleet-toolbar-primary">
        <button id="allStartButton" class="primary" onclick="runAllAction('start')">▶ Chạy tất cả</button>
        <button id="allStopButton" class="danger" onclick="runAllAction('stop')">⏹ Dừng tất cả</button>
        <button id="allRestartButton" class="small" onclick="runAllAction('restart')">↻ Chạy lại tất cả</button>
        <button class="small warning-btn" onclick="reconnectOfflineBots()" title="Chỉ kết nối lại các bot đang Offline hoặc Kicked">⚡ Reconnect lỗi</button>
        <button id="btnCleanDeadBots" class="small danger-btn admin-only" onclick="cleanDeadBots()" title="Tự động phát hiện và dọn dẹp các bot chết (404/Unreachable)">🧹 Dọn bot chết</button>
      </div>
      <div class="fleet-toolbar-tools">
        <button class="small" onclick="openBroadcastModal()" title="Bắn lệnh hàng loạt tới toàn bộ bot">📡 Broadcast</button>
        <button id="soundAlertBtn" class="small sound-btn" onclick="toggleSoundAlert()">🔕 Cảnh báo: TẮT</button>
        <button id="btnUserRenewKey" class="small user-only" onclick="openRenewModal()" title="Nhập mã key gia hạn hạn thuê">🎁 Nhập Key</button>
        <button class="small admin-only" onclick="openKeyManagementModal()" title="Quản lý mã key kích hoạt / gia hạn">🎟️ Quản Lý Key</button>
        <button class="small admin-only" onclick="openWebhookModal()" title="Cài đặt thông báo Discord / Telegram khi bot offline">🔔 Webhook</button>
        <button class="small admin-only" onclick="exportBotList()" title="Sao lưu danh sách bot ra file JSON">📥 Backup</button>
        <button class="small admin-only" onclick="triggerImport()" title="Khôi phục danh sách bot từ file JSON">📤 Restore</button>
        <input type="file" id="importFileInput" accept=".json" style="display:none" onchange="handleImportFile(event)">
      </div>
    </div>

    <!-- FLEET SEARCH & FILTER: ROW 2 -->
    <div class="fleet-search-filter-row">
      <div class="filter-tabs">
        <button class="tab-btn active" id="tabAll" onclick="setStatusFilter('all')">Tất cả (<span id="countAll">0</span>)</button>
        <button class="tab-btn" id="tabAfk" onclick="setStatusFilter('afk')">🟢 Đang AFK (<span id="countAfk">0</span>)</button>
        <button class="tab-btn" id="tabOnline" onclick="setStatusFilter('online')">🟡 Online/Chờ (<span id="countOnline">0</span>)</button>
        <button class="tab-btn" id="tabOffline" onclick="setStatusFilter('offline')">🔴 Offline/Kicked (<span id="countOffline">0</span>)</button>
        <button class="tab-btn" id="tabUnreachable" onclick="setStatusFilter('unreachable')">⚠️ Lỗi/Unreachable (<span id="countUnreachable">0</span>)</button>
      </div>
      <div class="fleet-search-sort-wrap">
        <input id="searchInput" class="search-box" placeholder="🔍 Tìm bot (tên, user ingame, IP...)" oninput="filterBots()">
        <select id="sortBotsSelect" class="sort-select" onchange="changeBotSort(this.value)">
          <option value="default">Sắp xếp: Mặc định</option>
          <option value="status">Sắp xếp: Ưu tiên AFK</option>
          <option value="uptime">Sắp xếp: Uptime cao nhất</option>
          <option value="totem">Sắp xếp: Totem nhiều nhất</option>
          <option value="name">Sắp xếp: Tên A-Z</option>
        </select>
      </div>
    </div>

    <!-- FLEET TAG FILTER BAR -->
    <div id="fleetTagFilterRow" class="fleet-tag-filter-row" style="display:flex;gap:8px;align-items:center;margin-top:10px;margin-bottom:6px;flex-wrap:wrap;">
      <span style="font-size:12px;color:var(--muted);font-weight:700;">🏷️ TAGS:</span>
      <div id="tagPillsContainer" style="display:flex;gap:6px;flex-wrap:wrap;"></div>
    </div>

    <div id="botGrid" class="bot-grid"></div>
  </section>

  <section id="detailPage" class="hidden">
    <div class="detail-header">
      <div style="display:flex;align-items:center;gap:12px;flex-wrap:wrap;">
        <button class="small back-btn" onclick="goHome()">← Quay về Dashboard</button>
        <div class="title-wrap">
          <div style="display:flex;align-items:center;gap:10px;">
            <div id="detailTitle" class="detail-title">Bot</div>
            <button type="button" class="small" onclick="renameDetailBotAlias()" title="Đổi tên hiển thị / Ghi chú cho bot này" style="padding:3px 10px;font-size:11px;font-weight:600;border-radius:6px;background:rgba(255,255,255,0.08);border:1px solid rgba(255,255,255,0.18);color:var(--text);cursor:pointer;">✏ Đổi tên / Ghi chú</button>
          </div>
          <div class="detail-subtitle">Quản lý, theo dõi và đồng bộ cấu hình bot</div>
        </div>
      </div>
      <div class="detail-hud" style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;">
        <span class="vip-pill">👑 KBOT V11.8 PRO</span>
        <span id="detailUserRoleBadge" class="vip-pill" style="background:rgba(148,163,184,0.15);color:#94a3b8;border-color:rgba(148,163,184,0.3);">🔒 CHƯA ĐĂNG NHẬP</span>
        <span class="platform-pill">⚡ RENDER CLOUD</span>
        <span class="ram-pill">📊 RAM: <strong id="detailManagerRamUsage">-- MB</strong></span>
      </div>
    </div>

    <div class="grid">

      <!-- PANEL 1: BẢNG TRẠNG THÁI / THEO DÕI -->
      <div class="panel">
        <h3>Trạng thái</h3>
        <div id="detailStatus" class="big-status"></div>
        <div class="info">
          <div class="info-item copyable" onclick="copyToClipboard(document.getElementById('detailUsername')?.innerText, 'Username')" title="Click để copy Username"><div class="info-label">USERNAME 📋</div><div id="detailUsername" class="info-value">-</div></div>
          <div class="info-item"><div class="info-label">SERVER</div><div id="detailHost" class="info-value">-</div></div>
          <div class="info-item"><div class="info-label">PING</div><div id="detailPing" class="info-value">-</div></div>
          <div class="info-item"><div class="info-label">SERVER TPS ⚡</div><div id="detailTps" class="info-value" style="color:var(--green);font-weight:700;">--</div></div>
          <div class="info-item"><div class="info-label">RAM MÁY HOST 🧠</div><div id="detailHostRam" class="info-value" style="color:var(--green);font-weight:700;">-</div></div>
          <div class="info-item"><div class="info-label">CPU MÁY HOST ⚡</div><div id="detailHostCpu" class="info-value" style="color:#38bdf8;font-weight:700;">-</div></div>
          <div class="info-item"><div class="info-label">LƯU LƯỢNG MẠNG 📶</div><div id="detailHostNet" class="info-value" style="color:var(--yellow);font-weight:700;">-</div></div>
          <div class="info-item copyable" onclick="copyToClipboard(document.getElementById('detailPosition')?.innerText, 'Tọa độ')" title="Click để copy Tọa độ"><div class="info-label">COORDINATES 📋</div><div id="detailPosition" class="info-value position-value">-</div></div>
          <div class="info-item"><div class="info-label">DIMENSION / LOCATION</div><div id="detailDimension" class="info-value">-</div></div>
          <div id="detailIpItem" class="info-item copyable admin-only" onclick="copyToClipboard(document.getElementById('detailIp')?.innerText, 'IP')" title="Click để copy IP"><div class="info-label">BOT IP 📋</div><div id="detailIp" class="info-value">-</div></div>
          <div class="info-item"><div class="info-label">RAM BOT CON 🤖</div><div id="detailRam" class="info-value" style="color:#38bdf8;font-weight:700;">-</div></div>
          <div class="info-item"><div class="info-label">UPTIME ⏱</div><div id="detailUptime" class="info-value" style="color:#38bdf8;font-weight:700;">-</div></div>
          <div class="info-item"><div class="info-label">RECONNECTS 🔄</div><div id="detailReconnects" class="info-value">-</div></div>
        </div>
        <div class="controls">
          <button id="detailStartButton" class="primary" onclick="detailAction('start')">▶ Chạy</button>
          <button id="detailStopButton" class="danger" onclick="detailAction('stop')">■ Dừng</button>
          <button id="detailRestartButton" onclick="detailAction('restart')">↻ Chạy lại</button>
          <button id="detailResetCustomerBtn" class="danger admin-only" onclick="resetCustomerBot()" style="margin-left:auto;background:rgba(239,68,68,0.2);border-color:rgba(239,68,68,0.5);" title="Dừng bot, xóa trắng tài khoản và lịch sử để bàn giao khách mới">🧹 Reset Bàn Giao Khách Mới</button>
        </div>
        <div class="note" style="margin-top:12px;">
          <div style="font-weight:700;margin-bottom:6px;">Lịch sử tọa độ gần nhất</div>
          <div id="detailPositionHistory" style="max-height:180px;overflow:auto;line-height:1.6;">Đang tải lịch sử...</div>
        </div>
      </div>

      <!-- PANEL 2: BẢNG GUI INGAME (HIỂN THỊ CỨNG CẠNH BẢNG THEO DÕI) -->
      <div class="panel" id="detailRemoteGuiCard">
        <div class="chat-title-row">
          <h3 id="detailRemoteGuiTitle">🖥️ Cửa Sổ GUI / Menu Ingame</h3>
          <span id="detailRemoteGuiBadge" class="capacity-badge" style="background:var(--accent);color:#fff;display:none;">Đang Mở</span>
          <button id="detailRemoteGuiCloseBtn" type="button" class="small" onclick="closeDetailGuiWindow()" style="display:none;">✕ Đóng GUI</button>
        </div>
        <div id="detailRemoteGuiPlaceholder" style="text-align:center;padding:55px 16px;color:var(--muted);">
          <div style="font-size:42px;margin-bottom:10px;opacity:0.75;">🖥️</div>
          <div style="font-size:15px;font-weight:700;color:var(--text);margin-bottom:6px;">Hiện Chưa Có Cửa Sổ GUI Nào Đang Mở</div>
          <div style="font-size:12px;color:var(--muted);max-width:320px;margin:0 auto;line-height:1.5;">Khi bot mở Menu (<code>/menu</code>, <code>/warp</code> hoặc mở rương trong game), các ô vật phẩm sẽ xuất hiện tại đây để bạn bấm tương tác trực tiếp.</div>
        </div>
        <div id="detailRemoteGuiContent" style="display:none;">
          <p style="font-size:12px;color:var(--muted);margin:4px 0 10px 0;">Click trực tiếp vào ô vật phẩm bên dưới để chọn chức năng:</p>
          <div id="detailRemoteGuiSlots" style="display:grid;grid-template-columns:repeat(9, 1fr);gap:5px;max-width:540px;margin:0 auto;background:rgba(0,0,0,0.3);padding:10px;border-radius:8px;border:1px solid var(--border);"></div>
        </div>
      </div>

      <!-- PANEL 3: BẢNG CHAT (BÊN CẠNH EVENT LOG) -->
      <div class="panel">
        <div class="chat-title-row"><h3>Chat</h3><button class="small danger" onclick="clearDetailChat()">Xóa lịch sử</button></div>
        <div id="detailChatLogs" class="log"></div>
        <form class="chat-row chat-form" onsubmit="sendDetailMessage(event)">
          <input id="detailMessageInput" autocomplete="off" placeholder="Nhập chat hoặc command... (↑↓ lịch sử)">
          <button class="primary" type="submit">Gửi</button>
        </form>
        <div class="chip-row">
          <button type="button" class="chip" style="background:rgba(14,165,233,0.18);color:#38bdf8;border-color:rgba(14,165,233,0.45);font-weight:700;" onclick="quickEnterServer()">⚡ Vào Server (Slot 24)</button>
          <button type="button" class="chip" onclick="quickDetailCommand('/menu')">⚡ /menu</button>
          <button type="button" class="chip" onclick="quickDetailCommand('/dn')">🔑 /dn [MK]</button>
          <button type="button" class="chip" onclick="quickDetailCommand('/login')">🔓 /login [MK]</button>
          <button type="button" class="chip" onclick="quickDetailCommand('/bal')">💵 /bal</button>
          <button type="button" class="chip" onclick="quickDetailCommand('/team chat')">🛡️ /team chat</button>
          <button type="button" class="chip" onclick="quickDetailCommand('/spawn')">🏠 /spawn</button>
          <button type="button" class="chip" onclick="quickDetailCommand('/pay')">💰 /pay</button>
        </div>
        <div class="note">
          Bấm chip để gửi nhanh. Dùng phím ↑ ↓ trong ô nhập để xem lại các lệnh đã gửi.
        </div>
      </div>

      <!-- PANEL 4: BẢNG EVENT LOG (BÊN CẠNH CHAT) -->
      <div class="panel">
        <div class="chat-title-row"><h3>Event Log</h3><button class="small" onclick="exportBotLogs(event,selectedBotId)" style="margin-left:auto;margin-right:8px;">📥 Tải Log</button><button class="small danger" onclick="clearDetailLogs()">Xóa lịch sử</button></div>
        <div id="detailEventLogs" class="log"></div>
      </div>

      <!-- PANEL 5: INVENTORY MANAGER -->
      <div class="panel" style="grid-column: 1 / -1;">
        <div class="chat-title-row">
          <h3>Inventory Manager</h3>
          <span id="detailInventoryCapacity" class="capacity-badge">0/36 ô (0%)</span>
          <button type="button" class="small" style="background:rgba(234,179,8,0.2);color:#fbbf24;border:1px solid rgba(234,179,8,0.5);font-weight:700;margin-left:auto;" onclick="quickEquipTotem()" title="Tự động tìm Totem trong 36 ô rương đồ và lắp vào tay phụ">⚡ Lắp Totem Tay Phụ</button>
        </div>
        <div class="inventory-grid">
          <div class="inventory-stat"><div class="info-label">HEALTH</div><div id="detailHealth" class="info-value">20 / 20</div><div class="bar health-bar"><span id="detailHealthBar"></span></div></div>
          <div class="inventory-stat"><div class="info-label">HUNGER</div><div id="detailFood" class="info-value">20 / 20</div><div class="bar hunger-bar"><span id="detailFoodBar"></span></div></div>
          <div class="inventory-stat"><div class="info-label">GOLDEN APPLE</div><div id="detailGolden" class="info-value">0</div></div>
          <div class="inventory-stat"><div class="info-label">TOTEM</div><div id="detailTotem" class="info-value">0</div></div>
          <div class="inventory-stat"><div class="info-label">OFFHAND</div><div id="detailOffhand" class="info-value">-</div></div>
          <div class="inventory-stat"><div class="info-label">FOOD COUNT</div><div id="detailFoodCount" class="info-value">0</div></div>
        </div>

        <div class="info-label">EQUIPMENT / OFFHAND</div>
        <div class="equipment-row">
          <div id="equipHeadBox" class="equipment-slot" draggable="true" ondragstart="startEquipmentDrag(event,'head')" ondragover="allowDrop(event)" ondragleave="clearDragOver(event)" ondrop="dropEquip(event,'head')" onclick="handleDetailEquipmentClick('head')" ondblclick="unequipDetail('head')"><div class="equip-label">HEAD</div><div id="equipHead">-</div></div>
          <div id="equipTorsoBox" class="equipment-slot" draggable="true" ondragstart="startEquipmentDrag(event,'torso')" ondragover="allowDrop(event)" ondragleave="clearDragOver(event)" ondrop="dropEquip(event,'torso')" onclick="handleDetailEquipmentClick('torso')" ondblclick="unequipDetail('torso')"><div class="equip-label">CHEST</div><div id="equipTorso">-</div></div>
          <div id="equipLegsBox" class="equipment-slot" draggable="true" ondragstart="startEquipmentDrag(event,'legs')" ondragover="allowDrop(event)" ondragleave="clearDragOver(event)" ondrop="dropEquip(event,'legs')" onclick="handleDetailEquipmentClick('legs')" ondblclick="unequipDetail('legs')"><div class="equip-label">LEGS</div><div id="equipLegs">-</div></div>
          <div id="equipFeetBox" class="equipment-slot" draggable="true" ondragstart="startEquipmentDrag(event,'feet')" ondragover="allowDrop(event)" ondragleave="clearDragOver(event)" ondrop="dropEquip(event,'feet')" onclick="handleDetailEquipmentClick('feet')" ondblclick="unequipDetail('feet')"><div class="equip-label">FEET</div><div id="equipFeet">-</div></div>
          <div id="equipOffhandBox" class="equipment-slot" draggable="true" ondragstart="startEquipmentDrag(event,'off-hand')" ondragover="allowDrop(event)" ondragleave="clearDragOver(event)" ondrop="dropEquip(event,'off-hand')" onclick="handleDetailEquipmentClick('off-hand')" ondblclick="unequipDetail('off-hand')"><div class="equip-label">OFFHAND</div><div id="equipOffhand">-</div></div>
        </div>

        <div class="info-label">INVENTORY 27 SLOTS</div>
        <div id="detailInventory" class="slot-grid"></div>
        <div class="info-label" style="margin-top:12px;">HOTBAR 9 SLOTS</div>
        <div id="detailHotbar" class="slot-grid"></div>
        <div id="detailDropZone" class="drop-zone" ondragover="allowDrop(event)" ondragleave="clearDragOver(event)" ondrop="dropDetailItemToWorld(event)" onclick="handleDetailDropZoneClick()">Kéo item vào đây để vứt</div>
        <div id="detailInventoryRevision" class="note">revision 0</div>
      </div>

      <!-- PANEL 6: SETTINGS -->
      <div class="panel">
        <div class="chat-title-row"><h3>Settings</h3><div class="revision">đồng bộ từ bot con</div></div>
        <div class="setting-list">
          <label class="check-row"><input id="detailSettingEcoMode" type="checkbox" checked> <span>🌱 Eco Mode Siêu Tiết Kiệm (Giảm 80% CPU & giữ RAM &lt; 220MB)</span></label>
          <label class="check-row"><input id="detailSettingAutoTotem" type="checkbox" checked> <span>Auto Totem phản xạ tức thì (&lt; 50ms)</span></label>
          <label class="check-row"><input id="detailSettingAntiHungry" type="checkbox" checked> <span>Anti Hungry / Auto Eat</span></label>
          <label class="check-row"><input id="detailSettingAutoReconnect" type="checkbox" checked> <span>Auto Reconnect + LOGIN/DN/MENU</span></label>
          <label class="check-row"><input id="detailSettingAntiAfkKick" type="checkbox" checked> <span>Smart Anti-AFK Kick (Xoay đầu, vung tay nhẹ)</span></label>
          <label for="detailSpawnCommands" style="display:block;font-size:12px;font-weight:600;margin-top:6px;">⚡ Spawn Commands (lệnh chạy khi vào AFK, phân tách bằng ; hoặc xuống dòng)</label>
          <textarea id="detailSpawnCommands" rows="3" style="width:100%;box-sizing:border-box;border-radius:6px;padding:6px 8px;font-family:monospace;font-size:12px;background:rgba(15,23,42,0.6);border:1px solid var(--border);resize:vertical;" placeholder="/server town;&#10;/fly;&#10;/home afk" oninput="markDetailSettingsDirty()"></textarea>
          <div class="note" style="margin-top:4px;">Nếu hiển thị ******** nghĩa là tài khoản của bạn không có quyền đổi tài khoản Minecraft — giữ nguyên để không thay đổi cấu hình.</div>
        </div>
        <button id="saveDetailSettingsButton" class="primary" onclick="saveDetailSettings()">Lưu setting</button>
      </div>

      <div id="detailAutoChatPanel" class="panel">
        <div class="chat-title-row"><h3>Auto Chat</h3><button class="small primary" onclick="addDetailAutoChatSchedule()">＋ Thêm</button></div>
        <div id="detailAutoChatSchedules" class="schedule-list"></div>
        <div class="note">Mỗi dòng là một lịch riêng. Kéo ⋮⋮ để đổi thứ tự; sửa trực tiếp rồi bấm Lưu Auto Chat.</div>
        <button id="saveDetailAutoChatButton" class="primary compact-save" onclick="saveDetailAutoChat()">Lưu Auto Chat</button>
      </div>

      <div id="detailBotSchedulePanel" class="panel">
        <div class="chat-title-row"><h3>Hẹn giờ Bot</h3><button class="small primary" onclick="addDetailBotSchedule()">＋ Thêm</button></div>
        <div class="scheduler-toolbar">
          <label class="scheduler-mode-box"><span>Chế độ</span>
            <select id="detailBotScheduleMode" onchange="detailBotScheduleModeChanged(this)">
              <option value="fixed">Giờ cố định mỗi ngày</option>
              <option value="cycle">Chu kỳ theo thứ tự</option>
            </select>
          </label>
          <label class="check-row" style="margin:0;padding:7px 9px;"><input id="detailBotScheduleEnabled" type="checkbox" checked> <span>Kích hoạt lịch</span></label>
        </div>
        <div id="detailBotScheduleModeNote" class="scheduler-note"></div>
        <div id="detailBotSchedules" class="schedule-list"></div>
        <div class="note">Chỉ có một chế độ tại một thời điểm. Ở Chu kỳ, thời gian mỗi dòng tính từ dòng kề trên; kéo đổi thứ tự thì cách tính cũng đổi theo.</div>
        <button id="saveDetailBotSchedulesButton" class="primary compact-save" onclick="saveDetailBotSchedules()">Lưu hẹn giờ Bot</button>
      </div>

      <div class="panel" id="detailAccountPanel">
        <h3>Tài khoản Minecraft Bot</h3>
        <div class="form-row">
          <label>Username Ingame</label>
          <input id="detailUsernameInput" autocomplete="off" placeholder="Username Minecraft bot...">
        </div>
        <div class="form-row">
          <label>Mật khẩu /login</label>
          <div class="password-input-wrap">
            <input id="detailPasswordInput" type="password" autocomplete="new-password" placeholder="Mật khẩu /login bot...">
            <button type="button" class="password-toggle-btn" onclick="togglePasswordVisibility('detailPasswordInput', this)">👁</button>
          </div>
        </div>
        <div style="display:flex;gap:8px;align-items:center;margin-top:10px;">
          <button class="primary" onclick="saveDetailAccount()">Lưu thay đổi</button>
          <button class="small" onclick="saveAndRestartBot()" style="font-weight:700;">💾 Lưu & Chạy lại ngay</button>
        </div>
        <div class="note">Áp dụng ngay cho bot. Bấm "Lưu & Chạy lại ngay" để bot đăng nhập tài khoản mới lập tức.</div>
      </div>

      <!-- PANEL CẤU HÌNH PROXY RIÊNG CỦA TỪNG BOT (BUG-19) -->
      <div class="panel admin-only" id="detailProxyPanel">
        <div class="chat-title-row">
          <h3>🌐 Cấu hình Proxy Riêng</h3>
          <span id="detailProxyBadge" class="capacity-badge" style="background:var(--border);color:var(--muted);">TẮT</span>
        </div>
        <div class="setting-list" style="margin-bottom:12px;">
          <label class="check-row">
            <input id="detailProxyEnabled" type="checkbox">
            <span>Kích hoạt Proxy khi kết nối Minecraft</span>
          </label>
        </div>
        <div class="form-row">
          <label>Giao thức (Protocol)</label>
          <select id="detailProxyProtocol" style="width:100%;box-sizing:border-box;">
            <option value="socks5">SOCKS5 (Khuyên dùng - Nhanh & Ẩn danh)</option>
            <option value="http">HTTP / HTTPS CONNECT Proxy</option>
            <option value="socks4">SOCKS4</option>
          </select>
        </div>
        <div style="display:grid;grid-template-columns:2fr 1fr;gap:8px;">
          <div class="form-row">
            <label>Host / IP Proxy</label>
            <input id="detailProxyHost" placeholder="vd: 103.152.112.5" autocomplete="off">
          </div>
          <div class="form-row">
            <label>Port</label>
            <input id="detailProxyPort" type="number" placeholder="1080" min="1" max="65535">
          </div>
        </div>
        <div class="form-row">
          <label>Username (nếu có)</label>
          <input id="detailProxyUsername" placeholder="Để trống nếu không có auth" autocomplete="off">
        </div>
        <div class="form-row">
          <label>Password (nếu có)</label>
          <div class="password-input-wrap">
            <input id="detailProxyPassword" type="password" autocomplete="new-password" placeholder="Mật khẩu proxy...">
            <button type="button" class="password-toggle-btn" onclick="togglePasswordVisibility('detailProxyPassword', this)">👁</button>
          </div>
        </div>
        <div style="display:flex;gap:8px;align-items:center;margin-top:12px;flex-wrap:wrap;">
          <button class="primary" onclick="saveDetailProxy()">💾 Lưu Proxy</button>
          <button class="small" onclick="testDetailProxy()" id="detailProxyTestBtn">🧪 Kiểm Tra Kết Nối</button>
          <button class="small danger" onclick="clearDetailProxy()" style="margin-left:auto;">✕ Xóa Proxy</button>
        </div>
        <div id="detailProxyTestResult" class="note" style="margin-top:8px;">
          Proxy có thể dùng chung giữa các bot. Hỗ trợ SOCKS5 & HTTP. Khi bật, bot sẽ định tuyến qua Proxy này để đổi IP an toàn.
        </div>
      </div>
    </div>
  </section>

  <!-- DEDICATED FULL-PAGE USER & KEY MANAGEMENT SECTION -->
  <section id="userManagementPage" class="full-page-section hidden">
    <div class="full-page-header">
      <div style="display:flex;align-items:center;gap:12px;flex-wrap:wrap;">
        <button class="small" onclick="navigateTo('dashboard')">← Về Dashboard</button>
        <div>
          <h2 class="full-page-title">👥 Quản Lý Người Dùng &amp; Key Gia Hạn</h2>
          <div class="full-page-subtitle">Quản lý tài khoản khách thuê, phân quyền 1-Bot-1-User, gia hạn linh hoạt, xem mật khẩu và quản lý Key bản quyền.</div>
        </div>
      </div>
      <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;">
        <div class="admin-only" style="display:inline-flex;align-items:center;gap:6px;background:rgba(15,23,42,0.6);border:1px solid rgba(56,189,248,0.3);border-radius:8px;padding:3px 8px;">
          <button id="trialGiftToggleBtn" class="small" onclick="toggleTrialGiftSetting()" title="Bật/Tắt chế độ tặng dùng thử kèm bot trống cho người mới" style="background:transparent;border:none;color:#38bdf8;font-weight:700;padding:2px 4px;cursor:pointer;">
            <span id="trialGiftBtnLabel">🎁 Tặng Dùng Thử:</span> <span id="trialGiftStatusBadge">BẬT</span>
          </button>
          <span style="color:var(--border);">|</span>
          <label style="font-size:12px;color:var(--muted);display:inline-flex;align-items:center;gap:4px;margin:0;">
            <span>Số ngày:</span>
            <input type="number" id="trialDaysInput" min="1" max="365" value="1" title="Số ngày dùng thử tặng khi đăng ký tài khoản mới" style="width:52px;padding:3px 6px;font-size:12px;border-radius:4px;background:rgba(0,0,0,0.4);border:1px solid var(--border);color:var(--text);text-align:center;" onchange="saveTrialDaysSetting()">
            <span style="font-size:11px;">ngày</span>
          </label>
        </div>

        <!-- CỤM CẤU HÌNH VƯỢT LINK +12H (ADMIN) -->
        <div class="admin-only" style="display:inline-flex;align-items:center;gap:6px;background:rgba(15,23,42,0.6);border:1px solid rgba(234,179,8,0.35);border-radius:8px;padding:3px 8px;">
          <button id="link4mToggleBtn" class="small" onclick="toggleLink4mSetting()" title="Bật/Tắt tính năng vượt link Link4M nhận +12h" style="background:transparent;border:none;color:#facc15;font-weight:700;padding:2px 4px;cursor:pointer;">
            <span id="link4mBtnLabel">⚡ Vượt Link +12h:</span> <span id="link4mStatusBadge">TẮT</span>
          </button>
          <span style="color:var(--border);">|</span>
          <button type="button" class="small" onclick="openLink4mConfigModal()" title="Cấu hình Link rút gọn hoặc API Token Link4M" style="background:rgba(234,179,8,0.15);border:1px solid rgba(234,179,8,0.3);color:#facc15;padding:2px 8px;border-radius:5px;cursor:pointer;font-weight:600;">
            ⚙ Cấu hình Link
          </button>
        </div>
        <button class="primary" onclick="openCreateUserModal()">＋ Thêm Người Dùng Mới</button>
        <button class="secondary" onclick="switchUserMgmtSubTab('keys')">🎟️ Quản Lý Key</button>
        <button class="small" onclick="refreshUserManagementPage()">↻ Làm mới</button>
      </div>
    </div>

    <!-- SUB TABS: USER LIST vs KEY LIST -->
    <div class="sub-tab-bar">
      <button class="sub-tab-btn active" id="subTabUsers" onclick="switchUserMgmtSubTab('users')">
        👥 Danh Sách Người Dùng (<span id="userMgmtTotalCount">0</span>)
      </button>
      <button class="sub-tab-btn" id="subTabKeys" onclick="switchUserMgmtSubTab('keys')">
        🎟️ Quản Lý Key Gia Hạn (<span id="keyMgmtTotalCount">0</span>)
      </button>
    </div>

    <!-- SUB-PANEL 1: DANH SÁCH USER -->
    <div id="subPanelUsers" class="sub-panel">
      <!-- FILTERS & STATS -->
      <div class="mgmt-filter-bar">
        <div style="flex:1;min-width:220px;">
          <input type="text" id="userFilterSearch" placeholder="🔍 Tìm theo username, ghi chú, gói..." class="search-box" style="margin:0;width:100%;box-sizing:border-box;" oninput="debounceUserFilter()">
        </div>
        <div style="display:flex;gap:8px;flex-wrap:wrap;">
          <button class="filter-chip active" id="userFilterAll" onclick="setUserStatusFilter('all')">Tất cả (<span id="statUserAll">0</span>)</button>
          <button class="filter-chip" id="userFilterActive" onclick="setUserStatusFilter('active')">🟢 Hoạt động (<span id="statUserActive">0</span>)</button>
          <button class="filter-chip" id="userFilterDisabled" onclick="setUserStatusFilter('disabled')">🔒 Tạm khóa (<span id="statUserDisabled">0</span>)</button>
          <button class="filter-chip" id="userFilterExpired" onclick="setUserStatusFilter('expired')">⏳ Hết hạn (<span id="statUserExpired">0</span>)</button>
          <button class="filter-chip" id="userFilterLifetime" onclick="setUserStatusFilter('lifetime')">👑 Vĩnh viễn (<span id="statUserLifetime">0</span>)</button>
        </div>
      </div>

      <!-- USER TABLE -->
      <div class="user-table-wrap">
        <table class="user-table">
          <thead>
            <tr>
              <th style="min-width:140px;">NGƯỜI DÙNG</th>
              <th style="min-width:140px;">MẬT KHẨU</th>
              <th style="min-width:280px;">HẠN THUÊ &amp; GIA HẠN NHANH</th>
              <th style="min-width:110px;">TRẠNG THÁI</th>
              <th style="min-width:180px;">BOT ĐƯỢC CẤP (1-USER-1-BOT)</th>
              <th style="min-width:140px;text-align:right;">THAO TÁC</th>
            </tr>
          </thead>
          <tbody id="userFullTableBody">
            <tr><td colspan="6" style="text-align:center;padding:28px;color:var(--muted);">Đang tải danh sách người dùng...</td></tr>
          </tbody>
        </table>
      </div>
    </div>

    <!-- SUB-PANEL 2: QUẢN LÝ KEY GIA HẠN -->
    <div id="subPanelKeys" class="sub-panel hidden">
      <div class="create-key-card">
        <h4 style="margin:0 0 10px 0;font-size:14.5px;color:#38bdf8;font-weight:750;">🎟️ Tạo Mã Key & Giftcode Sự Kiện</h4>
        <div style="display:flex;gap:12px;flex-wrap:wrap;align-items:flex-end;">
          <div>
            <label style="font-size:11px;color:var(--muted);display:block;margin-bottom:4px;font-weight:700;">GÓI THUÊ:</label>
            <div style="display:flex;gap:4px;align-items:center;">
              <select id="mgmtKeyDays" onchange="onKeyDaysSelectChange('mgmt')" style="background:var(--bg);border:1px solid var(--border);color:#fff;padding:8px 12px;border-radius:8px;font-size:13px;">
                <option value="1">1 Ngày (Dùng thử)</option>
                <option value="3">3 Ngày</option>
                <option value="7" selected>7 Ngày (1 Tuần)</option>
                <option value="15">15 Ngày (Nửa Tháng)</option>
                <option value="30">30 Ngày (1 Tháng)</option>
                <option value="90">90 Ngày (3 Tháng)</option>
                <option value="lifetime">👑 Vĩnh Viễn</option>
                <option value="custom">✏️ Tùy chỉnh ngày...</option>
              </select>
              <input type="number" id="mgmtKeyCustomDays" min="1" max="3650" placeholder="Số ngày" style="display:none;width:75px;background:var(--bg);border:1px solid var(--border);color:#fff;padding:8px;border-radius:8px;font-size:13px;" />
            </div>
          </div>
          <div>
            <label style="font-size:11px;color:var(--muted);display:block;margin-bottom:4px;font-weight:700;">TÊN GÓI:</label>
            <input type="text" id="mgmtKeyPlan" placeholder="VD: Gói Tuần VIP" style="background:var(--bg);border:1px solid var(--border);color:#fff;padding:8px 12px;border-radius:8px;font-size:13px;width:130px;" />
          </div>
          <div>
            <label style="font-size:11px;color:var(--muted);display:block;margin-bottom:4px;font-weight:700;">MÃ TÙY CHỌN (GIFTCODE):</label>
            <input type="text" id="mgmtKeyCustomKey" placeholder="Để trống = sinh ngẫu nhiên" style="background:var(--bg);border:1px solid var(--border);color:#fff;padding:8px 12px;border-radius:8px;font-size:13px;width:160px;text-transform:uppercase;" />
          </div>
          <div>
            <label style="font-size:11px;color:var(--muted);display:block;margin-bottom:4px;font-weight:700;" title="Số lượt dùng tối đa trên toàn server. Mỗi user chỉ được dùng 1 lần!">LƯỢT DÙNG:</label>
            <input type="number" id="mgmtKeyMaxUses" value="1" min="0" max="10000" title="1 = Key cá nhân, n = Giftcode nhiều người nhập, 0 = Không giới hạn" style="background:var(--bg);border:1px solid var(--border);color:#fff;padding:8px 12px;border-radius:8px;font-size:13px;width:75px;" />
          </div>
          <div>
            <label style="font-size:11px;color:var(--muted);display:block;margin-bottom:4px;font-weight:700;">HẠN ÁP DỤNG:</label>
            <select id="mgmtKeyValidDays" style="background:var(--bg);border:1px solid var(--border);color:#fff;padding:8px 12px;border-radius:8px;font-size:13px;">
              <option value="0" selected>Vô thời hạn</option>
              <option value="1">Trong 1 Ngày</option>
              <option value="3">Trong 3 Ngày</option>
              <option value="7">Trong 7 Ngày</option>
              <option value="30">Trong 30 Ngày</option>
            </select>
          </div>
          <div>
            <label style="font-size:11px;color:var(--muted);display:block;margin-bottom:4px;font-weight:700;" title="Số lượng bot tối đa cấp độc quyền cho tài khoản sử dụng key này (mặc định 1 bot)">SỐ BOT:</label>
            <input type="number" id="mgmtKeyBotCount" value="1" min="1" max="50" style="background:var(--bg);border:1px solid var(--border);color:#fff;padding:8px 12px;border-radius:8px;font-size:13px;width:60px;" />
          </div>
          <div>
            <label style="font-size:11px;color:var(--muted);display:block;margin-bottom:4px;font-weight:700;">SỐ KEY:</label>
            <input type="number" id="mgmtKeyCount" value="1" min="1" max="50" style="background:var(--bg);border:1px solid var(--border);color:#fff;padding:8px 12px;border-radius:8px;font-size:13px;width:60px;" />
          </div>
          <button class="primary" onclick="submitCreateKeysFromMgmt()" style="padding:9px 18px;font-weight:750;">+ Phát Hành Mã</button>
        </div>
      </div>

      <div class="user-table-wrap">
        <table class="user-table">
          <thead>
            <tr>
              <th>MÃ KEY / GIFTCODE</th>
              <th>GÓI THUÊ</th>
              <th>TRẠNG THÁI &amp; LƯỢT DÙNG</th>
              <th>NGƯỜI KÍCH HOẠT</th>
              <th>HẠN ÁP DỤNG</th>
              <th style="text-align:right;">THAO TÁC</th>
            </tr>
          </thead>
          <tbody id="keysFullTableBody">
            <tr><td colspan="6" style="text-align:center;padding:28px;color:var(--muted);">Đang tải danh sách key...</td></tr>
          </tbody>
        </table>
      </div>
    </div>
  </section>

  <!-- DEDICATED FULL-PAGE AUDIT TRAIL SECTION -->
  <section id="auditPage" class="full-page-section hidden">
    <div class="full-page-header">
      <div style="display:flex;align-items:center;gap:12px;flex-wrap:wrap;">
        <button class="small" onclick="navigateTo('dashboard')">← Về Dashboard</button>
        <div>
          <h2 class="full-page-title">📋 Nhật Ký Hoạt Động (Audit Trail Enterprise)</h2>
          <div class="full-page-subtitle">Theo dõi thời gian thực 100% mọi hành vi vận hành bot, can thiệp cấu hình, tài khoản và cấp phát license key.</div>
        </div>
      </div>
      <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;">
        <button class="small" onclick="exportAuditLogs('csv')">📥 Xuất CSV</button>
        <button class="small" onclick="exportAuditLogs('jsonl')">📥 Xuất JSONL</button>
        <button class="small danger" onclick="clearAllAuditLogs()">🗑 Xóa Nhật Ký</button>
        <button class="small" onclick="refreshAuditLogs(1)">↻ Làm mới</button>
      </div>
    </div>

    <!-- TABS PHÂN LOẠI NHẬT KÝ (HỆ THỐNG / USER vs BOT VẬN HÀNH / COORDS) -->
    <div class="audit-type-tabs" style="display:flex;gap:8px;margin-bottom:12px;flex-wrap:wrap;">
      <button type="button" id="auditTabSystem" class="audit-tab-btn active" onclick="switchAuditLogType('SYSTEM')">
        🌐 Nhật Ký Hệ Thống &amp; Thao Tác Người Dùng
      </button>
      <button type="button" id="auditTabBot" class="audit-tab-btn" onclick="switchAuditLogType('BOT')">
        🤖 Nhật Ký Vận Hành Bot &amp; Tài Khoản (Coords, Acc, Proxy)
      </button>
      <button type="button" id="auditTabAll" class="audit-tab-btn" onclick="switchAuditLogType('')">
        📋 Tất Cả Nhật Ký
      </button>
    </div>

    <!-- FILTER TOOLBAR -->
    <div style="display:flex;align-items:center;gap:8px;margin-bottom:12px;flex-wrap:wrap;background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.06);padding:8px 12px;border-radius:8px;">
      <div style="flex:1;min-width:180px;">
        <input id="auditLogSearchInput" placeholder="🔍 Tìm theo từ khóa, chi tiết, IP, user..." class="search-box" style="margin:0;padding:6px 12px;font-size:12px;width:100%;box-sizing:border-box;" oninput="debounceAuditFilter()">
      </div>
      <div style="min-width:160px;">
        <select id="auditLogCategoryFilter" style="margin:0;padding:6px 10px;font-size:12px;background:var(--card);border:1px solid var(--border);color:#fff;border-radius:6px;width:100%;" onchange="refreshAuditLogs(1)">
          <option value="">📂 Tất cả danh mục</option>
          <option value="AUTH">🔐 Xác thực &amp; Bảo mật (AUTH)</option>
          <option value="BOT_CONTROL">🎮 Điều khiển Bot (BOT)</option>
          <option value="BOT_ACCOUNT">👤 Tài khoản Minecraft</option>
          <option value="BOT_SETTINGS">⚙️ Cài đặt Bot</option>
          <option value="BOT_INVENTORY">🎒 Kho đồ &amp; Trang bị</option>
          <option value="FLEET">🚀 Quản lý Hạm đội (FLEET)</option>
          <option value="USER_MGMT">👥 Quản lý Khách thuê</option>
          <option value="LICENSE_KEY">🔑 Mã Bản quyền/Gói</option>
          <option value="SYSTEM">🤖 Hệ thống Tự động</option>
        </select>
      </div>
      <div style="min-width:140px;">
        <select id="auditLogStatusFilter" style="margin:0;padding:6px 10px;font-size:12px;background:var(--card);border:1px solid var(--border);color:#fff;border-radius:6px;width:100%;" onchange="refreshAuditLogs(1)">
          <option value="">⚡ Tất cả trạng thái</option>
          <option value="SUCCESS">🟢 Thành công (SUCCESS)</option>
          <option value="FAILED">🔴 Thất bại (FAILED)</option>
          <option value="BLOCKED">🟠 Bị chặn (BLOCKED)</option>
          <option value="PARTIAL">🟡 Một phần (PARTIAL)</option>
        </select>
      </div>
      <div style="min-width:110px;">
        <select id="auditLogLimitSelect" style="margin:0;padding:6px 10px;font-size:12px;background:var(--card);border:1px solid var(--border);color:#fff;border-radius:6px;width:100%;" onchange="refreshAuditLogs(1)">
          <option value="25">25 dòng/trang</option>
          <option value="50" selected>50 dòng/trang</option>
          <option value="100">100 dòng/trang</option>
          <option value="200">200 dòng/trang</option>
        </select>
      </div>
    </div>

    <!-- TABLE WRAP -->
    <div class="user-table-wrap" style="overflow-y:auto;max-height:65vh;">
      <table class="user-table" style="font-size:12px;">
        <thead>
          <tr>
            <th style="width:135px;">THỜI GIAN</th>
            <th style="width:145px;">NGƯỜI THỰC HIỆN</th>
            <th style="width:170px;">HÀNH ĐỘNG</th>
            <th style="width:135px;">MỤC TIÊU</th>
            <th>CHI TIẾT THAO TÁC</th>
            <th style="width:95px;text-align:right;">TRẠNG THÁI</th>
          </tr>
        </thead>
        <tbody id="auditLogTableBody">
          <tr><td colspan="6" style="text-align:center;padding:28px;color:var(--muted);">Đang tải nhật ký...</td></tr>
        </tbody>
      </table>
    </div>

    <!-- PAGINATION FOOTER -->
    <div class="modal-actions" style="margin-top:12px;padding-top:10px;border-top:1px solid rgba(255,255,255,0.06);display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:10px;">
      <div id="auditLogPaginationInfo" style="color:var(--muted);font-size:11.5px;">Tổng cộng: 0 bản ghi</div>
      <div style="display:flex;align-items:center;gap:6px;">
        <button id="auditLogPrevBtn" class="small" onclick="navigateAuditPage(-1)">‹ Trước</button>
        <span id="auditLogPageIndicator" style="font-size:11.5px;padding:0 6px;color:#fff;">Trang 1 / 1</span>
        <button id="auditLogNextBtn" class="small" onclick="navigateAuditPage(1)">Sau ›</button>
      </div>
    </div>
  </section>

  <!-- DEDICATED FULL-PAGE BACKUP MANAGEMENT SECTION -->
  <section id="backupPage" class="full-page-section hidden">
    <div class="full-page-header">
      <div style="display:flex;align-items:center;gap:12px;flex-wrap:wrap;">
        <button class="small" onclick="navigateTo('dashboard')">← Về Dashboard</button>
        <div>
          <h2 class="full-page-title">💾 Quản Lý Bản Sao Lưu Supabase</h2>
          <div class="full-page-subtitle">Snapshot lưu trong Supabase, giữ tối đa 30 bản gần nhất; tạo định kỳ và trước các thao tác quan trọng.</div>
        </div>
      </div>
      <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;">
        <button class="primary small" onclick="triggerCreateBackup()">⚡ Tạo Sao Lưu Ngay</button>
        <button class="small" onclick="refreshBackupList()">↻ Làm mới</button>
      </div>
    </div>

    <div style="background:rgba(56,189,248,0.08);border:1px solid rgba(56,189,248,0.25);border-radius:10px;padding:12px 16px;margin-bottom:16px;font-size:12.5px;color:var(--cyan);line-height:1.5;">
      ☁️ <strong>Nguồn dữ liệu chính thức là Supabase.</strong> Khôi phục sẽ tạo backup dự phòng trước, thay thế Users, Keys, Registry và Bot Settings theo snapshot. Audit Logs và Sessions không nằm trong backup nên được giữ nguyên.
    </div>

    <div class="user-table-wrap" style="overflow-y:auto;max-height:60vh;">
      <table class="user-table" style="font-size:12px;">
        <thead>
          <tr>
            <th>TÊN BẢN SAO LƯU</th>
            <th>THỜI GIAN TẠO</th>
            <th>DUNG LƯỢNG</th>
            <th style="text-align:right;">THAO TÁC / TÌNH TRẠNG</th>
          </tr>
        </thead>
        <tbody id="backupTableBody">
          <tr><td colspan="4" style="text-align:center;padding:28px;color:var(--muted);">Đang tải danh sách bản sao lưu...</td></tr>
        </tbody>
      </table>
    </div>

    <div style="margin-top:12px;padding-top:10px;border-top:1px solid rgba(255,255,255,0.06);display:flex;justify-content:space-between;align-items:center;">
      <div id="backupTotalCount" style="color:var(--muted);font-size:12px;">Tổng cộng: 0 bản sao lưu (Tối đa 30)</div>
    </div>
  </section>
</div>

<!-- MODAL TẠM KHÓA USER KÈM LỜI NHẮN (ADMIN) -->
<div id="userLockReasonModal" class="modal hidden">
  <div class="modal-card" style="max-width:440px;">
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;">
      <h3 style="margin:0;color:#ef4444;display:flex;align-items:center;gap:8px;">🔒 Tạm Khóa Tài Khoản</h3>
      <button class="small" onclick="closeUserLockReasonModal()">✕</button>
    </div>
    <p style="font-size:13px;color:var(--muted);margin-bottom:12px;">
      Bạn đang chuẩn bị tạm khóa tài khoản <strong id="lockTargetUsername" style="color:#fff;"></strong>.
      Tài khoản này sẽ bị làm mờ màn hình khi đăng nhập và hiển thị lời nhắn bên dưới:
    </p>
    <input id="lockTargetUserId" type="hidden">
    <div class="form-row">
      <label>Lời nhắn gửi đến người dùng (Hiển thị khi đăng nhập)</label>
      <textarea id="lockReasonInput" rows="3" placeholder="Ví dụ: Tài khoản bị tạm khóa do vi phạm nội quy / Đang chờ xác minh thanh toán..."></textarea>
    </div>
    <div class="modal-actions" style="margin-top:16px;">
      <button onclick="closeUserLockReasonModal()">Hủy</button>
      <button class="danger" onclick="submitLockUserWithReason()">🔒 Xác Nhận Khóa</button>
    </div>
  </div>
</div>

<!-- MODAL CẤU HÌNH LINK4M (ADMIN) -->
<div id="link4mSettingsModal" class="modal hidden">
  <div class="modal-card" style="max-width:540px;width:100%;box-sizing:border-box;">
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:14px;border-bottom:1px solid var(--border);padding-bottom:10px;">
      <h3 style="margin:0;color:#facc15;display:flex;align-items:center;gap:8px;">⚡ Cài Đặt Vượt Link +12h (Link4M)</h3>
      <button type="button" class="small" onclick="closeLink4mConfigModal()">✕</button>
    </div>

    <div style="display:flex;flex-direction:column;gap:14px;font-size:13px;">
      <div style="padding:10px 12px;background:rgba(239,68,68,0.15);border:1px solid rgba(239,68,68,0.4);border-radius:8px;color:#fca5a5;font-size:12px;line-height:1.5;">
        ⚠️ <strong>LƯU Ý QUY ĐỊNH LINK4M (INCENTIVIZED TRAFFIC):</strong><br>
        Chính sách của Link4M cấm lưu lượng truy cập có thưởng trừ khi được thỏa thuận và phê duyệt trước. Vui lòng đảm bảo bạn đã xin phép Link4M và cấu hình <strong>Khóa bí mật Webhook Postback</strong> để hệ thống chỉ cộng giờ khi nhận tín hiệu hoàn tất thực sự từ server Link4M.
      </div>
      <div style="display:flex;align-items:center;justify-content:space-between;padding:10px 12px;background:rgba(15,23,42,0.6);border:1px solid var(--border);border-radius:8px;">
        <div>
          <strong style="color:var(--text);display:block;">Bật tính năng Vượt Link:</strong>
          <span style="font-size:11.5px;color:var(--muted);">Cho phép khách thuê tự vượt link nhận +12h vào tài khoản</span>
        </div>
        <input type="checkbox" id="link4mModalEnabled" style="width:20px;height:20px;cursor:pointer;">
      </div>

      <div>
        <label style="font-weight:700;display:block;margin-bottom:4px;color:var(--text);">Chế độ tạo liên kết:</label>
        <select id="link4mModalMode" style="width:100%;padding:8px 10px;border-radius:6px;background:rgba(0,0,0,0.4);border:1px solid var(--border);color:var(--text);" onchange="updateLink4mModalFields()">
          <option value="custom_url">🔗 Link Rút Gọn Cố Định (Admin tự tạo link dán vào)</option>
          <option value="api">🤖 Tự Động Gọi API Link4M (Tạo link động cho từng lượt)</option>
        </select>
      </div>

      <div id="link4mCustomUrlGroup">
        <label style="font-weight:700;display:block;margin-bottom:4px;color:var(--text);">Đường dẫn Link rút gọn gán vào:</label>
        <input type="text" id="link4mModalUrl" placeholder="Ví dụ: https://link4m.co/abcxyz" style="width:100%;padding:8px 10px;border-radius:6px;background:rgba(0,0,0,0.4);border:1px solid var(--border);color:var(--text);box-sizing:border-box;">
        <span style="font-size:11.5px;color:var(--muted);display:block;margin-top:4px;">Khi người dùng bấm vượt link, hệ thống sẽ mở link này.</span>
      </div>

      <div id="link4mApiTokenGroup" style="display:none;">
        <label style="font-weight:700;display:block;margin-bottom:4px;color:var(--text);">Link4M Publisher API Token:</label>
        <input type="text" id="link4mModalApiToken" placeholder="Nhập API Token từ tài khoản Link4M của bạn..." style="width:100%;padding:8px 10px;border-radius:6px;background:rgba(0,0,0,0.4);border:1px solid var(--border);color:var(--text);box-sizing:border-box;">
        <span style="font-size:11.5px;color:var(--muted);display:block;margin-top:4px;">Backend sẽ tự gọi https://link4m.co/api để rút gọn link trả thưởng động.</span>
      </div>

      <div style="display:flex;gap:12px;">
        <div style="flex:1;">
          <label style="font-weight:700;display:block;margin-bottom:4px;color:var(--text);">Số giờ cộng mỗi lượt:</label>
          <input type="number" id="link4mModalHours" min="1" max="48" value="12" style="width:100%;padding:8px 10px;border-radius:6px;background:rgba(0,0,0,0.4);border:1px solid var(--border);color:var(--text);box-sizing:border-box;">
        </div>
        <div style="flex:1;">
          <label style="font-weight:700;display:block;margin-bottom:4px;color:var(--text);">Giới hạn lượt / ngày (VN):</label>
          <input type="number" id="link4mModalDailyLimit" min="1" max="10" value="2" style="width:100%;padding:8px 10px;border-radius:6px;background:rgba(0,0,0,0.4);border:1px solid var(--border);color:var(--text);box-sizing:border-box;">
        </div>
      </div>

      <div>
        <label style="font-weight:700;display:block;margin-bottom:4px;color:var(--text);">Khóa bí mật Webhook Postback (Tùy chọn):</label>
        <input type="text" id="link4mModalSecretKey" placeholder="Để trống nếu không dùng server postback..." style="width:100%;padding:8px 10px;border-radius:6px;background:rgba(0,0,0,0.4);border:1px solid var(--border);color:var(--text);box-sizing:border-box;">
      </div>
    </div>

    <div style="display:flex;justify-content:flex-end;gap:8px;margin-top:18px;border-top:1px solid var(--border);padding-top:12px;">
      <button type="button" class="secondary" onclick="closeLink4mConfigModal()">Đóng</button>
      <button type="button" class="primary" onclick="saveLink4mConfigModal()">💾 Lưu Cài Đặt</button>
    </div>
  </div>
</div>

<!-- MODAL TÙY CHỈNH HẠN THUÊ USER (ADMIN) -->
<div id="customRenewModal" class="modal hidden">
  <div class="modal-card" style="max-width:440px;">
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;">
      <h3 style="margin:0;color:#38bdf8;display:flex;align-items:center;gap:8px;">⏱ Tùy Chỉnh Hạn Thuê Bot</h3>
      <button class="small" onclick="closeCustomRenewModal()">✕</button>
    </div>
    <p style="font-size:13px;color:var(--muted);margin-bottom:12px;">
      Điều chỉnh thời hạn cho tài khoản <strong id="customRenewTargetUser" style="color:#fff;"></strong>:
    </p>
    <input id="customRenewTargetUserId" type="hidden">
    <div class="form-row">
      <label>Hình thức điều chỉnh</label>
      <select id="customRenewMode" onchange="handleCustomRenewModeChange()">
        <option value="add_days">Cộng thêm số ngày (+N ngày)</option>
        <option value="subtract_days">Trừ bớt số ngày (-N ngày)</option>
        <option value="set_date">Đặt mốc ngày giờ cụ thể</option>
        <option value="set_permanent">👑 Đặt VIP Vĩnh Viễn</option>
      </select>
    </div>
    <div id="customRenewDaysGroup" class="form-row">
      <label>Số ngày điều chỉnh</label>
      <input type="number" id="customRenewDaysInput" value="7" min="1" max="3650">
    </div>
    <div id="customRenewDateGroup" class="form-row" style="display:none;">
      <label>Mốc ngày giờ hết hạn mới</label>
      <input type="datetime-local" id="customRenewDateInput">
    </div>
    <div class="form-row">
      <label>Tên gói cước / Ghi chú hạn (Tùy chỉnh)</label>
      <input type="text" id="customRenewPlanNameInput" placeholder="Ví dụ: Gói Tuần VIP, 15 Ngày Khuyến Mãi...">
    </div>
    <div class="note" style="margin-top:10px;">
      * Lưu ý: Nếu tài khoản đang là Vĩnh viễn, khi cộng/trừ ngày hoặc đặt mốc mới, quyền Vĩnh viễn sẽ tự động hủy và chuyển sang mốc ngày giờ mới.
    </div>
    <div class="modal-actions" style="margin-top:16px;">
      <button onclick="closeCustomRenewModal()">Hủy</button>
      <button class="primary" onclick="submitCustomRenew()">💾 Cập Nhật Hạn</button>
    </div>
  </div>
</div>

<!-- MODAL XÁC NHẬN CHUYỂN QUYỀN BOT 1-USER-1-BOT -->
<div id="reassignBotConfirmModal" class="modal hidden" style="z-index:9999999;">
  <div class="modal-card" style="max-width:460px;border-color:rgba(234,179,8,0.5);">
    <div style="display:flex;align-items:center;gap:10px;margin-bottom:12px;">
      <span style="font-size:28px;">⚠️</span>
      <div>
        <h3 style="margin:0;color:#eab308;font-size:17px;">Xác Nhận Chuyển Quyền Sở Hữu Bot</h3>
        <div style="font-size:12px;color:var(--muted);">Nguyên tắc 1-Bot-1-User độc quyền</div>
      </div>
    </div>
    <p id="reassignBotConfirmMsg" style="font-size:13px;line-height:1.5;color:#e2e8f0;margin-bottom:16px;background:rgba(234,179,8,0.1);padding:12px;border-radius:8px;border:1px dashed rgba(234,179,8,0.3);">
      Bot này hiện đang được cấp cho người dùng khác. Bạn có chắc chắn muốn hủy bot khỏi người dùng cũ để cấp cho người này không?
    </p>
    <div class="modal-actions">
      <button onclick="closeReassignBotConfirmModal(false)">Hủy (Giữ nguyên)</button>
      <button class="primary" style="background:#eab308;color:#000;font-weight:750;" onclick="closeReassignBotConfirmModal(true)">✓ Đồng Ý Chuyển Bot</button>
    </div>
  </div>
</div>
<div id="addBotModal" class="modal hidden">
  <div class="modal-card" style="max-width:520px;">
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;">
      <h3 style="margin:0;color:#38bdf8;display:flex;align-items:center;gap:8px;">➕ Thêm Bot Con (Hỗ Trợ Thêm Hàng Loạt)</h3>
      <button class="small" onclick="closeAddBotModal()">✕</button>
    </div>
    <div class="form-row">
      <label style="display:flex;justify-content:space-between;align-items:center;">
        <span>Web URL của bot con (1 hoặc nhiều link)</span>
        <span id="addBotUrlCountBadge" style="font-size:11.5px;color:#38bdf8;font-weight:700;">0 link</span>
      </label>
      <textarea id="addBotUrl" rows="5" autocomplete="off" oninput="updateAddBotUrlCounter()" placeholder="Dán 1 hoặc nhiều link bot tại đây, phân biệt bằng dấu cách hoặc xuống dòng:&#10;https://kbot-1.onrender.com&#10;https://kbot-2.onrender.com" style="width:100%;box-sizing:border-box;font-family:monospace;font-size:12.5px;padding:10px;resize:vertical;line-height:1.45;"></textarea>
    </div>
    <div class="form-row">
      <label>Tên hiển thị / Tiền tố đặt tên (Không bắt buộc)</label>
      <input id="addBotLabel" autocomplete="off" placeholder="Ví dụ: Bot (Để trống sẽ tự động lấy tên bot hoặc Bot #ID)">
    </div>
    <div class="note" style="line-height:1.5;">
      💡 <strong>Thêm hàng loạt & Tự động nhận diện 3-in-1:</strong> Bạn có thể dán nhiều link cùng lúc (ngăn cách bằng <strong>xuống dòng</strong> hoặc <strong>dấu cách</strong>). Hệ thống sẽ tự động kiểm tra, phát hiện cụm Worker 3-in-1 để tự bung 3 bot độc lập (Slot 1, 2, 3) cho từng link!
    </div>
    <div class="modal-actions" style="margin-top:16px;">
      <button onclick="closeAddBotModal()">Hủy</button>
      <button id="confirmAddBotButton" class="primary" onclick="addBotFromWeb()">➕ Thêm Bot</button>
    </div>
  </div>
</div>
<div id="editBotModal" class="modal hidden">
  <div class="modal-card" style="max-width:480px;">
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;">
      <h3 style="margin:0;display:flex;align-items:center;gap:8px;">✏️ Chỉnh Sửa Thông Tin & Tag Bot</h3>
      <button class="small" onclick="closeEditBotModal()">✕</button>
    </div>
    <input id="editBotId" type="hidden">
    <div class="form-row" style="margin-bottom:10px;">
      <label style="display:block;font-size:12px;color:var(--muted);margin-bottom:4px;font-weight:600;">Tên hiển thị / Ghi chú</label>
      <input id="editBotLabel" placeholder="Ví dụ: Bot Farm Lúa, Bot VIP..." autocomplete="off" style="width:100%;box-sizing:border-box;">
    </div>
    <div class="form-row admin-only" style="margin-bottom:10px;">
      <label style="display:block;font-size:12px;color:var(--muted);margin-bottom:4px;font-weight:600;">Web URL bot con</label>
      <input id="editBotUrl" placeholder="https://kbot-instance.onrender.com" autocomplete="off" style="width:100%;box-sizing:border-box;">
    </div>
    <div class="form-row admin-only" style="margin-bottom:10px;display:none;">
      <label style="display:flex;justify-content:space-between;align-items:center;font-size:12px;color:var(--muted);margin-bottom:4px;font-weight:600;">
        <span>Khóa bảo mật Worker (Secret Key)</span>
        <small style="color:var(--muted);font-weight:normal;">Bỏ trống để dùng mặc định</small>
      </label>
      <div style="position:relative;display:flex;align-items:center;">
        <input id="editBotSecretKey" type="password" placeholder="Khóa kết nối Service-to-Service nội bộ..." autocomplete="off" style="width:100%;box-sizing:border-box;padding-right:60px;">
        <button type="button" class="small" onclick="toggleEditSecretKeyVisibility()" style="position:absolute;right:4px;padding:3px 8px;font-size:11px;">Hiện</button>
      </div>
      <div style="font-size:11px;color:#38bdf8;margin-top:3px;">
        ⚡ <strong>Direct Connection:</strong> Không bắt buộc! Chỉ cần nhập URL là Manager tự kết nối trực tiếp với Worker.
      </div>
    </div>
    <div class="form-row" style="margin-bottom:12px;">
      <label style="display:block;font-size:12px;color:var(--muted);margin-bottom:4px;font-weight:600;">🏷️ Nhóm Tags (ngăn cách bởi dấu phẩy)</label>
      <input id="editBotTags" placeholder="farm, afk, lobby, vip..." autocomplete="off" oninput="renderEditBotTagPreviews(this.value)" style="width:100%;box-sizing:border-box;">
      <div id="editBotTagsPreview" style="display:flex;flex-wrap:wrap;gap:6px;margin-top:8px;min-height:24px;"></div>
      <div id="editBotTagSuggestions" style="display:flex;flex-wrap:wrap;gap:5px;margin-top:8px;"></div>
    </div>
    <div class="form-row admin-only" style="margin-bottom:12px;background:rgba(255,255,255,0.03);padding:10px 12px;border-radius:8px;border:1px solid var(--border);">
      <label style="display:flex;align-items:center;gap:8px;cursor:pointer;margin:0;font-size:13px;font-weight:600;color:var(--text);">
        <input type="checkbox" id="editBotRentable" style="width:16px;height:16px;cursor:pointer;">
        <span>Cho phép thuê (Nằm trong danh sách cấp phát tự động)</span>
      </label>
      <div style="font-size:11.5px;color:var(--muted);margin-top:4px;line-height:1.4;">
        Nếu bỏ chọn, bot này sẽ không bao giờ được cấp tự động khi khách đăng ký mới hoặc nạp Giftcode.
      </div>
      <div id="editBotRentalStatus" style="font-size:12px;margin-top:6px;"></div>
    </div>
    <div class="modal-actions" style="margin-top:16px;">
      <button onclick="closeEditBotModal()">Hủy</button>
      <button class="primary" onclick="saveEditBot()">💾 Lưu Thay Đổi</button>
    </div>
  </div>
</div>
<div id="adminModal" class="modal hidden">
  <div class="modal-card modal-lg">
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;">
      <h3 style="margin:0;display:flex;align-items:center;gap:8px;">🔑 Mật Khẩu Tài Khoản Bot (Tất cả Bot)</h3>
      <button class="small" onclick="closeAdminModal()">✕</button>
    </div>
    <div id="adminCredentialStep">
      <div id="adminCredentialList" class="credential-list">
        <div style="text-align:center;padding:24px;color:var(--muted);">⏳ Đang tải thông tin tài khoản bot...</div>
      </div>
      <div class="modal-actions" style="margin-top:16px;">
        <button class="small" onclick="loadAdminCredentials()">🔄 Tải lại</button>
        <button class="primary" onclick="closeAdminModal()">Đóng</button>
      </div>
    </div>
  </div>
</div>
<div id="announcementAdminModal" class="modal hidden">
  <div class="modal-card modal-lg">
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;">
      <h3 style="margin:0;display:flex;align-items:center;gap:8px;">📢 Quản Trị Thông Báo Người Dùng</h3>
      <button class="small" onclick="closeAnnouncementAdminModal()">✕</button>
    </div>
    <div class="form-row">
      <label class="check-row" style="margin:0;padding:9px 12px;background:var(--card2);border:1px solid var(--border);border-radius:10px;cursor:pointer;">
        <input id="announcementEnabled" type="checkbox" checked>
        <span style="font-weight:750;color:#fff;">Kích hoạt hiển thị thông báo popup tới người dùng</span>
      </label>
    </div>
    <div class="form-row">
      <label>Tiêu đề thông báo</label>
      <input id="announcementTitle" autocomplete="off" placeholder="Ví dụ: 📢 THÔNG BÁO TỪ QUẢN TRỊ VIÊN">
    </div>
    <div class="form-row">
      <label>Nội dung thông báo (hỗ trợ xuống dòng, emoji, bullet points)</label>
      <textarea id="announcementContent" rows="6" placeholder="Nhập nội dung thông báo hàng ngày hoặc thông tin bảo trì..."></textarea>
    </div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;">
      <div class="form-row">
        <label>Chế độ hiển thị</label>
        <select id="announcementMode" onchange="handleAnnouncementModeChange()">
          <option value="daily">🗓️ Hằng ngày (Lần đầu vào trong ngày hiện 1 lần)</option>
          <option value="every_login">⚡ Mọi lần truy cập / đăng nhập</option>
          <option value="time_range">⏳ Khoảng thời gian cố định</option>
        </select>
      </div>
      <div id="announcementDateRangeGroup" class="form-row" style="display:none;">
        <label>Khoảng ngày hiển thị</label>
        <div style="display:flex;gap:6px;align-items:center;">
          <input id="announcementStartDate" type="date" style="padding:7px 9px;font-size:12px;">
          <span>đến</span>
          <input id="announcementEndDate" type="date" style="padding:7px 9px;font-size:12px;">
        </div>
      </div>
    </div>
    <div class="note" style="margin:8px 0 16px;">
      ℹ️ <strong>Cơ chế hiển thị:</strong> Khi chọn <em>Hằng ngày</em>, người dùng bấm "Đã hiểu & Đóng" thì trong ngày đó sẽ không hiện lại nữa; sang ngày hôm sau khi truy cập lại sẽ tự động xuất hiện.
    </div>
    <div class="modal-actions" style="display:flex;justify-content:space-between;align-items:center;">
      <button type="button" class="small" onclick="previewAnnouncementModal()">👁️ Xem trước (Preview)</button>
      <div style="display:flex;gap:8px;">
        <button onclick="closeAnnouncementAdminModal()">Hủy</button>
        <button class="primary" onclick="saveAnnouncementConfig()">💾 Lưu Thông Báo</button>
      </div>
    </div>
  </div>
</div>

<div id="userAnnouncementModal" class="modal hidden" style="z-index:999999;">
  <div class="modal-card user-announcement-card">
    <div class="user-announcement-header">
      <div class="announcement-bell-badge">📢</div>
      <div style="flex:1;">
        <div class="announcement-badge-pill">👑 THÔNG BÁO TỪ QUẢN TRỊ VIÊN</div>
        <h3 id="userAnnouncementTitle" class="announcement-main-title">THÔNG BÁO HỆ THỐNG</h3>
        <div id="userAnnouncementTime" class="announcement-sub-date">Cập nhật lúc --</div>
      </div>
      <button class="announcement-close-btn" onclick="dismissUserAnnouncement()" title="Đóng">✕</button>
    </div>
    <div id="userAnnouncementBody" class="user-announcement-body"></div>
    <div class="user-announcement-footer">
      <div id="userAnnouncementFreqNote" class="announcement-freq-note">
        🗓️ Thông báo này sẽ chỉ xuất hiện 1 lần trong ngày hôm nay.
      </div>
      <button class="primary announcement-ack-btn" onclick="dismissUserAnnouncement()">
        ✨ ĐÃ HIỂU & ĐÓNG
      </button>
    </div>
  </div>
</div>
<div id="batchSettingsModal" class="modal hidden">
  <div class="modal-card">
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;">
      <h3 style="margin:0;display:flex;align-items:center;gap:8px;">⚙️ Đồng bộ Cài đặt Hàng loạt</h3>
      <button class="small" onclick="closeBatchSettingsModal()">✕</button>
    </div>
    <div style="margin-bottom:14px;">
      <label for="batchTargetTag" style="display:block;font-size:12px;color:var(--muted);margin-bottom:5px;font-weight:600;">🎯 Đối tượng áp dụng:</label>
      <select id="batchTargetTag" style="width:100%;box-sizing:border-box;padding:8px 10px;border-radius:6px;background:rgba(0,0,0,0.3);color:var(--text);border:1px solid var(--border);font-size:13px;outline:none;">
        <option value="">🌐 Toàn bộ bot trong danh sách</option>
      </select>
    </div>
    <div class="setting-list" style="margin:14px 0;">
      <label class="check-row"><input id="batchEcoMode" type="checkbox" checked> <span>🌱 Eco Mode Siêu Tiết Kiệm (Giảm 80% CPU & giữ RAM &lt; 220MB)</span></label>
      <label class="check-row"><input id="batchAutoTotem" type="checkbox" checked> <span>Auto Totem phản xạ tức thì (&lt; 50ms)</span></label>
      <label class="check-row"><input id="batchAntiHungry" type="checkbox" checked> <span>Anti Hungry / Auto Eat</span></label>
      <label class="check-row"><input id="batchAutoReconnect" type="checkbox" checked> <span>Auto Reconnect + LOGIN/DN/MENU</span></label>
      <label class="check-row"><input id="batchAntiAfkKick" type="checkbox" checked> <span>Smart Anti-AFK Kick (Xoay đầu, vung tay nhẹ)</span></label>
    </div>
    <div style="margin-top:14px;padding-top:12px;border-top:1px solid var(--border);">
      <label class="check-row" style="margin-bottom:8px;">
        <input id="batchSyncSpawnCommandsEnabled" type="checkbox" onchange="document.getElementById('batchSpawnCommandsDetails').style.display = this.checked ? 'block' : 'none'">
        <span style="font-weight:700;color:var(--accent);">⚡ Đồng bộ Lệnh Tự Động (spawnCommands)</span>
      </label>
      <div id="batchSpawnCommandsDetails" style="display:none;padding:10px;background:rgba(255,255,255,0.03);border:1px solid var(--border);border-radius:6px;margin-top:6px;">
        <div style="font-size:11px;color:var(--muted);margin-bottom:6px;">Mỗi dòng một lệnh (/warp afk, /fix all, /feed) — chạy tuần tự khi bot vào trạng thái AFK:</div>
        <textarea id="batchSpawnCommands" placeholder="/fix all&#10;/warp afk&#10;/feed" rows="2" style="width:100%;box-sizing:border-box;font-size:12px;padding:8px;background:rgba(0,0,0,0.3);color:var(--text);border:1px solid var(--border);border-radius:6px;font-family:monospace;resize:vertical;"></textarea>
      </div>
    </div>
    <div style="margin-top:16px;padding-top:14px;border-top:1px solid var(--border);">
      <label class="check-row" style="margin-bottom:10px;">
        <input id="batchSyncScheduleEnabled" type="checkbox" onchange="document.getElementById('batchScheduleDetails').style.display = this.checked ? 'block' : 'none'">
        <span style="font-weight:700;color:var(--accent);">⏰ Đồng bộ Hẹn giờ Bật/Tắt Bot (On/Off)</span>
      </label>
      <div id="batchScheduleDetails" style="display:none;padding:12px;background:rgba(255,255,255,0.03);border:1px solid var(--border);border-radius:6px;margin-top:8px;">
        <label class="check-row" style="margin-bottom:10px;">
          <input id="batchScheduleActive" type="checkbox" checked>
          <span>Kích hoạt lịch hẹn giờ</span>
        </label>
        <div class="form-row" style="margin-bottom:10px;">
          <label>Chế độ hẹn giờ</label>
          <select id="batchScheduleMode" onchange="handleBatchScheduleModeChange()">
            <option value="fixed">Giờ cố định mỗi ngày</option>
            <option value="cycle">Chu kỳ lặp lại</option>
          </select>
        </div>
        <div id="batchFixedSettings">
          <div style="display:flex;gap:10px;">
            <div class="form-row" style="flex:1;">
              <label>Giờ Tắt (VD: 04:30)</label>
              <input type="time" id="batchFixedStopTime" value="04:30">
            </div>
            <div class="form-row" style="flex:1;">
              <label>Giờ Bật (VD: 05:30)</label>
              <input type="time" id="batchFixedStartTime" value="05:30">
            </div>
          </div>
        </div>
        <div id="batchCycleSettings" style="display:none;">
          <div style="display:flex;gap:10px;">
            <div class="form-row" style="flex:1;">
              <label>Phút chạy trước khi Tắt</label>
              <input type="number" id="batchCycleStopMinutes" value="120" min="1" max="43200">
            </div>
            <div class="form-row" style="flex:1;">
              <label>Phút nghỉ trước khi Bật</label>
              <input type="number" id="batchCycleStartMinutes" value="300" min="1" max="43200">
            </div>
          </div>
        </div>
      </div>
    </div>
    <div class="modal-actions">
      <button onclick="closeBatchSettingsModal()">Hủy</button>
      <button class="primary" onclick="submitBatchSettings()">Áp dụng tất cả</button>
    </div>
  </div>
</div>
<div id="webhookModal" class="modal hidden">
  <div class="modal-card">
    <h3>🔔 Cài đặt Cảnh báo Webhook (Discord & Telegram)</h3>
    <div style="margin:12px 0 16px;">
      <label class="check-row"><input id="webhookEnabled" type="checkbox"> <span style="font-weight:700;color:var(--green);">Kích hoạt hệ thống Cảnh báo Webhook</span></label>
    </div>
    <div class="form-row">
      <label>Discord Webhook URL</label>
      <input id="webhookDiscordUrl" placeholder="https://discord.com/api/webhooks/...">
    </div>
    <div class="form-row">
      <label>Telegram Bot Token (Tùy chọn)</label>
      <input id="webhookTelegramToken" placeholder="123456:ABC-DEF1234ghIkl-zyx57W2v1u123ew11">
    </div>
    <div class="form-row">
      <label>Telegram Chat ID (Tùy chọn)</label>
      <input id="webhookTelegramChatId" placeholder="-100123456789 hoặc ID cá nhân">
    </div>
    <div class="setting-list" style="margin:14px 0;">
      <label class="check-row"><input id="webhookNotifyOffline" type="checkbox" checked> <span>🚨 Cảnh báo khi Bot Offline hoặc Kicked quá 5 phút</span></label>
      <label class="check-row"><input id="webhookNotifyRecover" type="checkbox" checked> <span>✅ Thông báo khi Bot Phục Hồi trực tuyến trở lại</span></label>
      <label class="check-row"><input id="webhookNotifyLowTotem" type="checkbox" checked> <span>🪙 Cảnh báo khẩn khi Bot sắp hết Totem (&le; 1 cái)</span></label>
      <label class="check-row"><input id="webhookNotifyLowHealth" type="checkbox" checked> <span>🩸 Cảnh báo khẩn khi Máu yếu (&le; 5 tim / 10 HP)</span></label>
      <label class="check-row"><input id="webhookNotifyDeath" type="checkbox" checked> <span>💀 Cảnh báo khi Bot tử vong (chết trong game)</span></label>
    </div>
    <div class="form-row">
      <label>Ngưỡng thời gian Offline để báo (Phút):</label>
      <input id="webhookOfflineThreshold" type="number" min="1" max="60" value="5" style="width:120px;">
    </div>
    <div class="modal-actions" style="margin-top:16px;">
      <button onclick="closeWebhookModal()">Đóng</button>
      <button class="secondary" onclick="testWebhookSettings()">🧪 Gửi thử (Test)</button>
      <button class="primary" onclick="saveWebhookSettings()">💾 Lưu cài đặt</button>
    </div>
  </div>
</div>
<div id="userManagementModal" class="modal hidden">
  <div class="modal-card modal-lg">
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:14px;flex-wrap:wrap;gap:10px;">
      <div>
        <h3 style="margin:0 0 4px;font-size:18.5px;">👥 Quản lý Người dùng & Phân quyền Bot (RBAC)</h3>
        <div style="color:var(--muted);font-size:12px;">Tạo tài khoản và phân quyền vận hành bot cho từng thành viên.</div>
      </div>
      <button class="primary" onclick="openCreateUserModal()">＋ Thêm Người Dùng Mới</button>
    </div>

    <div class="user-table-wrap">
      <table class="user-table">
        <thead>
          <tr>
            <th>TÊN ĐĂNG NHẬP</th>
            <th>GÓI & HẠN THUÊ</th>
            <th>GHI CHÚ</th>
            <th>TRẠNG THÁI</th>
            <th>BOT ĐƯỢC CẤP QUYỀN</th>
            <th style="text-align:right;">THAO TÁC</th>
          </tr>
        </thead>
        <tbody id="userTableBody">
          <tr><td colspan="5" style="text-align:center;padding:24px;color:var(--muted);">Đang tải danh sách người dùng...</td></tr>
        </tbody>
      </table>
    </div>

    <div class="modal-actions">
      <button onclick="closeUserManagementModal()">Đóng</button>
    </div>
  </div>
</div>

<div id="userEditModal" class="modal hidden">
  <div class="modal-card" style="width:min(580px, 98vw);">
    <h3 id="userEditModalTitle">Thêm Người Dùng Mới</h3>
    <input id="userFormId" type="hidden">
    <div class="form-row">
      <label>Tên đăng nhập (Username)</label>
      <input id="userFormUsername" autocomplete="off" placeholder="Ví dụ: operator1">
    </div>
    <div class="form-row">
      <label>Mật khẩu (Password)</label>
      <div class="password-input-wrap">
        <input id="userFormPassword" type="text" autocomplete="off" placeholder="Nhập mật khẩu (tối thiểu 5 ký tự, gồm cả chữ và số)...">
        <button type="button" class="password-toggle-btn" onclick="generateRandomUserPassword()" title="Tạo mật khẩu ngẫu nhiên">🎲</button>
      </div>
    </div>
    <div class="form-row">
      <label>Trạng thái tài khoản</label>
      <select id="userFormStatus" class="search-box" style="width:100%;">
        <option value="active">🟢 Đang hoạt động (Cho phép đăng nhập)</option>
        <option value="expired">⚠️ Hết hạn thuê</option>
        <option value="disabled">🔴 Tạm khóa (Không thể đăng nhập)</option>
      </select>
    </div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;">
      <div class="form-row">
        <label>Tên gói cước</label>
        <input id="userFormPlanName" placeholder="Ví dụ: Gói Tuần, VIP Tháng...">
      </div>
      <div class="form-row">
        <label>Hạn thuê (Bỏ trống = Vĩnh viễn)</label>
        <input id="userFormExpiresAt" type="datetime-local">
      </div>
    </div>
    <div class="form-row">
      <label>Ghi chú liên hệ (Zalo / Facebook / SĐT)</label>
      <input id="userFormNote" placeholder="Ví dụ: Zalo: 0912345678 (Anh Nam)">
    </div>
    <div class="form-row" style="margin-top:6px;">
      <label class="check-row" style="cursor:pointer;font-size:12.5px;">
        <input id="userFormAllowAccountChange" type="checkbox" checked>
        <span>Cho phép khách tự đổi Username & Mật khẩu Minecraft của bot</span>
      </label>
    </div>

    <div style="margin-top:14px;">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:6px;">
        <label style="color:var(--muted);font-size:11.5px;font-weight:700;">DANH SÁCH BOT CẤP QUYỀN VẬN HÀNH</label>
        <div style="display:flex;gap:8px;">
          <button type="button" class="small" onclick="toggleSelectAllUserBots(true)">Chọn hết</button>
          <button type="button" class="small" onclick="toggleSelectAllUserBots(false)">Bỏ hết</button>
        </div>
      </div>
      <div id="userFormBotsGrid" class="bot-checkbox-grid"></div>
    </div>

    <div class="modal-actions" style="margin-top:20px;">
      <button onclick="closeUserEditModal()">Hủy</button>
      <button id="userFormSubmitBtn" class="primary" onclick="saveUserForm()">Lưu Người Dùng</button>
    </div>
  </div>
</div>

<div id="changePasswordModal" class="modal hidden">
  <div class="modal-card" style="width:min(440px, 96vw);">
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;">
      <h3 style="margin:0;display:flex;align-items:center;gap:8px;">🔑 Đổi Mật Khẩu Tài Khoản</h3>
      <button class="small" onclick="closeChangePasswordModal()">✕</button>
    </div>
    <form id="changePasswordForm" onsubmit="submitChangePassword(event)" style="display:flex;flex-direction:column;gap:12px;">
      <div class="form-row" style="margin-bottom:0;">
        <label>Tài khoản</label>
        <input id="changePassUsernameDisplay" type="text" disabled style="opacity:0.8;background:rgba(255,255,255,0.04);">
      </div>
      <div class="form-row" style="margin-bottom:0;">
        <label>Mật khẩu hiện tại</label>
        <div class="password-input-wrap">
          <input id="changePassOld" type="password" autocomplete="current-password" placeholder="Nhập mật khẩu hiện tại..." required>
          <button type="button" class="password-toggle-btn" onclick="togglePasswordVisibility('changePassOld', this)">👁</button>
        </div>
      </div>
      <div class="form-row" style="margin-bottom:0;">
        <label>Mật khẩu mới (tối thiểu 5 ký tự, gồm cả chữ và số)</label>
        <div class="password-input-wrap">
          <input id="changePassNew" type="password" autocomplete="new-password" placeholder="Nhập mật khẩu mới..." required>
          <button type="button" class="password-toggle-btn" onclick="togglePasswordVisibility('changePassNew', this)">👁</button>
        </div>
      </div>
      <div class="form-row" style="margin-bottom:0;">
        <label>Xác nhận mật khẩu mới</label>
        <div class="password-input-wrap">
          <input id="changePassConfirm" type="password" autocomplete="new-password" placeholder="Nhập lại mật khẩu mới..." required>
          <button type="button" class="password-toggle-btn" onclick="togglePasswordVisibility('changePassConfirm', this)">👁</button>
        </div>
      </div>
      <div id="changePassAlert" class="login-alert hidden" style="margin-top:4px;"></div>
      <div class="modal-actions" style="margin-top:12px;">
        <button type="button" onclick="closeChangePasswordModal()">Hủy</button>
        <button id="changePassSubmitBtn" type="submit" class="primary">💾 Cập Nhật Mật Khẩu</button>
      </div>
    </form>
  </div>
</div>
<div id="changelogModal" class="modal hidden">
  <div class="modal-card changelog-card">
    <div style="display:flex;justify-content:space-between;align-items:center;padding-bottom:12px;border-bottom:1px solid rgba(255,255,255,0.08);">
      <div>
        <h3 style="margin:0;display:flex;align-items:center;gap:8px;">📜 Nhật Ký Cập Nhật & Lịch Sử Phiên Bản</h3>
        <div style="color:var(--muted);font-size:11.5px;margin-top:2px;">Hành trình tối ưu và nâng cấp KingMC Sentinel (V1.0 - V11.8 Pure Render)</div>
      </div>
      <button class="small" onclick="closeChangelogModal()">✕</button>
    </div>

    <div class="changelog-body">
      <!-- V11.7 -->
      <div class="timeline-item latest">
        <div class="timeline-node"></div>
        <div class="timeline-header">
          <span class="timeline-version">🚀 KBOT Commercial Enterprise Edition V11.7 (Pure Render Production)</span>
          <span class="timeline-badge current">ZERO BANDWIDTH WASTE • REALTIME SYNC • DISCORD SUPPORT • 99.9% UPTIME</span>
        </div>
        <div class="timeline-content">
          <ul>
            <li><strong>Đồng Bộ Dữ Liệu Tức Thì (Không Cần F5):</strong> Toàn bộ thao tác nạp key gia hạn, đổi biệt danh bot, tạo tài khoản hay cập nhật từ Supabase Cloud đều hiển thị ngay lập tức trên màn hình một cách mượt mà và liền mạch.</li>
            <li><strong>Bảng Trạng Thái Phân Tách Chuẩn Xác:</strong> Tách biệt rõ ràng giữa <code>Offline / Kicked</code> (bot bị ngắt kết nối Minecraft) và <code>Lỗi / Unreachable</code> (máy chủ bot con mất kết nối web), giúp theo dõi hạm đội chuẩn xác 100%.</li>
            <li><strong>Đảm Bảo Bot Luôn Kết Nối (Always Connected):</strong> Tối ưu hóa giao thức kết nối nội bộ giữa Manager và Bot con; tự động fallback qua cổng sức khỏe <code>/health</code>, loại bỏ hoàn toàn tình trạng link bot con sống nhưng manager báo nhầm Unreachable.</li>
            <li><strong>Nút Hỗ Trợ Discord Tiện Lợi:</strong> Bổ sung nút bấm Discord trực tiếp ở chân trang, giúp khách thuê và admin liên hệ hỗ trợ kỹ thuật hoặc cập nhật thông báo cộng đồng nhanh chóng.</li>
            <li><strong>Siêu Tiết Kiệm Băng Thông (Render 5GB/tháng):</strong> Tối ưu hóa chu kỳ kiểm tra ETag, loại bỏ dữ liệu thừa và nén dữ liệu cấp độ cao, đảm bảo hệ thống vận hành liên tục 24/7 suốt cả tháng mà không lo cạn kiệt băng thông Render.</li>
          </ul>
        </div>
      </div>

      <!-- V11.6 -->
      <div class="timeline-item">
        <div class="timeline-node"></div>
        <div class="timeline-header">
          <span class="timeline-version">👑 KBOT Commercial Enterprise Edition V11.6 (Performance & Experience Evolution)</span>
          <span class="timeline-badge">HIGH-SPEED REAL-TIME • 99.9% AFK UPTIME • SMART RECONNECT • SEAMLESS MOBILE UI</span>
        </div>
        <div class="timeline-content">
          <ul>
            <li><strong>Tối Ưu Tốc Độ Truyền Tải &amp; Độ Nhạy (High-Speed Real-Time):</strong> Nâng cấp cơ chế truyền dữ liệu telemetry, giảm độ trễ cập nhật trạng thái bot xuống mức tối thiểu, bảng điều khiển phản hồi mượt mà tức thì và tiết kiệm tối đa dữ liệu mạng.</li>
            <li><strong>Tăng Cường Độ Ổn Định AFK (Uptime 99.9%):</strong> Nâng cấp thuật toán tự động kết nối lại (Auto-Reconnect) thông minh khi máy chủ KingMC bảo trì hoặc gặp sự cố mạng, bảo đảm bot tự động vào lại, giữ vững vị trí và duy trì cày cuốc liên tục 24/7.</li>
            <li><strong>Giao Diện Trực Quan &amp; Tối Ưu Mobile:</strong> Hoàn thiện hiển thị chi tiết các chỉ số sinh tồn (máu, thanh đói, tọa độ, totem, giáp) sắc nét; hỗ trợ giao diện cảm ứng mượt mà và chuẩn xác trên mọi dòng điện thoại.</li>
            <li><strong>Chuẩn Hóa Thời Hạn Thuê Minh Bạch:</strong> Cải tiến hệ thống tính toán thời gian thuê bot chuẩn xác đến từng phút, hiển thị rõ ràng thời hạn sử dụng và hỗ trợ nhập mã Key bản quyền gia hạn trực tiếp mà không cần tải lại trang.</li>
            <li><strong>Bảo Mật Phiên Làm Việc &amp; Đăng Nhập Liền Mạch:</strong> Bảo vệ dữ liệu cá nhân an toàn tuyệt đối, duy trì phiên đăng nhập ổn định không bị đăng xuất bất ngờ khi đang theo dõi bot.</li>
          </ul>
        </div>
      </div>

      <!-- V11.5 -->
      <div class="timeline-item">
        <div class="timeline-node"></div>
        <div class="timeline-header">
          <span class="timeline-version">👑 KBOT Commercial Enterprise Edition V11.5 (Full Enterprise SaaS)</span>
          <span class="timeline-badge">SELF-REGISTER • FULL-PAGE DEDICATED SECTIONS • RESTRICTED BLUR OVERLAYS • 1-BOT-1-USER</span>
        </div>
        <div class="timeline-content">
          <ul>
            <li><strong>Tự Đăng Ký Tài Khoản Khách Thuê:</strong> Khách hàng có thể tự đăng ký tài khoản trực tiếp trên Web với username độc nhất (không phân biệt hoa thường), xác thực chính sách mật khẩu và nhận ngay 1 ngày dùng thử hoặc kích hoạt mã Key bản quyền.</li>
            <li><strong>Thanh Điều Hướng Toàn Diện &amp; Nút Tài Khoản Góc Phải:</strong> Menu tài khoản được neo cố định góc trên bên phải trên mọi thiết bị (PC &amp; Mobile), tích hợp nút Đăng Xuất ở ngay đầu danh mục và mở các tab chuyển trang lớn trực quan.</li>
            <li><strong>Tách Biệt Toàn Trang (Full-Page Dedicated Sections):</strong> Chuyển đổi toàn bộ các trang Quản Lý User &amp; Key, Nhật Ký Hoạt Động (Audit Trail Enterprise) và Quản Lý Sao Lưu (Disaster Recovery) sang dạng toàn trang độc lập, tiện lợi hơn gấp 10 lần các modal pop-up cũ.</li>
            <li><strong>Màn Hình Khóa &amp; Hết Hạn Làm Mờ Nền (Blurred Restriction Overlays):</strong> Người dùng bị tạm khóa hoặc hết hạn vẫn có thể đăng nhập để xem thông báo/lời nhắn từ Admin hoặc kích hoạt Key gia hạn và chuyển hướng sang Discord hỗ trợ, trong khi toàn bộ nền Dashboard phía sau bị làm mờ và khóa tương tác tuyệt đối.</li>
            <li><strong>Phân Quyền Độc Quyền 1-Bot-1-User:</strong> Mỗi bot chỉ được cấp phát cho tối đa 1 khách thuê; bot đã có chủ sở hữu sẽ tự động hiển thị xám với nhãn người dùng đang giữ, yêu cầu xác nhận trước khi hủy quyền để chuyển giao cho người mới.</li>
            <li><strong>Cơ Chế Gia Hạn Linh Hoạt &amp; Thu Hồi Vĩnh Viễn:</strong> Thêm hệ thống nút gia hạn nhanh (+1N, +3N, +7N, +15N, +30N, -1N, 👑 Vĩnh viễn, ⏱ Tùy chỉnh). Nếu tài khoản VIP Vĩnh Viễn được điều chỉnh cộng/trừ ngày hoặc cố định ngày, quyền vĩnh viễn sẽ tự động hủy và tính từ thời điểm hiện tại; đồng thời giao diện người dùng vĩnh viễn được tối giản bỏ nút nhập Key.</li>
            <li><strong>Bảo Mật Cao Cấp &amp; Tự Phục Hồi Dữ Liệu:</strong> Mã hóa dữ liệu bảo mật chuẩn scrypt; cơ chế tự phục hồi đa đường dẫn giải quyết triệt để lỗi tài khoản biến mất sau chu kỳ Logout / Login.</li>
          </ul>
        </div>
      </div>

      <!-- V11.4 -->
      <div class="timeline-item">
        <div class="timeline-node"></div>
        <div class="timeline-header">
          <span class="timeline-version">🚀 KBOT Cloud Native Edition V11.4 (Persistence & UI Harmony)</span>
          <span class="timeline-badge">ROCK-SOLID PERSISTENCE • DOCKING UI • 100% FLEET SYNC</span>
        </div>
        <div class="timeline-content">
          <ul>
            <li><strong>Khắc Phục Triệt Để Mất Dữ Liệu Tài Khoản:</strong> Tái cấu trúc cơ chế tự phục hồi (Self-Healing) và quy trình sao lưu; bảo toàn tuyệt đối danh sách tài khoản khách thuê qua chu kỳ Logout / Login mà không bị ghi đè bởi bản backup cũ.</li>
            <li><strong>Bố Cục Menu Tài Khoản Chuẩn Mực:</strong> Nút người dùng được neo vững chắc ở phía bên phải thanh công cụ; menu dropdown mở rộng theo hướng bên trái (<code>right: 0; left: auto;</code>) hiển thị trọn vẹn không bao giờ tràn màn hình.</li>
            <li><strong>Đồng Bộ Dữ Liệu Hai Chiều Hoàn Hảo:</strong> Kết nối thông suốt giữa Manager và Bot Worker qua biến môi trường <code>BOT_SECRET_KEY</code> thống nhất trên bảng điều khiển hosting, bảo đảm 100% lệnh, mật khẩu, tài khoản và lịch trình đồng nhất giữa các hosting riêng biệt.</li>
            <li><strong>Tối Ưu Phần Cứng & Băng Thông:</strong> Giảm tải CPU idle với chu kỳ polling thông minh thích ứng (500ms khi hoạt động, 5000ms khi ẩn tab), khóa giới hạn mảng log tránh tràn RAM trên gói Render cơ bản.</li>
            <li><strong>Hiệu Ứng Hoạt Ảnh Mượt Mà:</strong> Thêm chuyển động nâng thẻ bot khi di chuột, highlight hàng bảng quản trị và chuyển đổi mượt mà các tab.</li>
          </ul>
        </div>
      </div>

      <!-- V11.3 -->
      <div class="timeline-item">
        <div class="timeline-node"></div>
        <div class="timeline-header">
          <span class="timeline-version">🛡️ KBOT Cloud Native Edition V11.3 (Pure Render Optimized)</span>
          <span class="timeline-badge">PURE RENDER • SESSION REVOCATION • ATOMIC ROLLBACK</span>
        </div>
        <div class="timeline-content">
          <ul>
            <li><strong>Triển Khai Độc Quyền Pure Render Cloud:</strong> Tối ưu hóa toàn diện cho Render Web Service, tự động nhận diện PORT 10000 fallback, thanh trừng triệt để toàn bộ mã nguồn và nền tảng cũ.</li>
            <li><strong>Thu Hồi Phiên Đăng Nhập Tức Thì Khi Đổi Mật Khẩu:</strong> Tự động vô hiệu hóa toàn bộ active session của tài khoản khi quản trị viên hoặc người dùng cập nhật mật khẩu mới, ép đăng nhập lại trên mọi thiết bị và bot con.</li>
            <li><strong>Lưu Trữ Nguyên Tử (Atomic Persistence & Rollback):</strong> Cơ chế hoàn tác in-memory an toàn 100% khi ghi dữ liệu tài khoản (users) hoặc mã key bản quyền thất bại, ngăn chặn mất đồng bộ trạng thái hệ thống.</li>
            <li><strong>Đồng Bộ Hash Mật Khẩu Login Gate:</strong> Cổng <code>/api/auth/verify-bot-access</code> truyền tải đầy đủ hash mật khẩu chuẩn scrypt để Bot Worker giám sát phiên đăng nhập theo thời gian thực.</li>
            <li><strong>Giao Diện Quản Trị Bảo Mật Cao:</strong> Loại bỏ triệt để nguy cơ chèn chuỗi HTML injection trong modal tài khoản quản trị và khắc phục race condition khi cập nhật thẻ tóm tắt bot.</li>
          </ul>
        </div>
      </div>

      <!-- V10.0 -->
      <div class="timeline-item">
        <div class="timeline-node"></div>
        <div class="timeline-header">
          <span class="timeline-version">🚀 KBOT Commercial Pro Edition V10.0 (16.10.2026)</span>
          <span class="timeline-badge current">SAAS COMMERCIAL & MULTI-HOST CLOUD</span>
        </div>
        <div class="timeline-content">
          <ul>
            <li><strong>Thương Hiệu & Trải Nghiệm Thương Mại KBOT:</strong> Chính thức ra mắt nền tảng thương mại KBOT hoàn chỉnh cho dịch vụ thuê bot AFK KingMC số 1.</li>
            <li><strong>SaaS Showcase & Landing Portal:</strong> Tích hợp giao diện giới thiệu sản phẩm trực quan, 5 quyền lợi khách thuê vượt trội, quy trình hoạt động 3 bước và cam kết SLA 99.9% Uptime.</li>
            <li><strong>Cổng Hỗ Trợ Cộng Đồng Discord 24/7:</strong> Tích hợp nút kết nối trực tiếp kênh Discord hỗ trợ kỹ thuật và mua key tự động (https://discord.gg/mJWX5Xp3z).</li>
            <li><strong>Tối Ưu Đồng Bộ Đa Máy Chủ (Multi-Host Sync):</strong> Hoạt động ổn định bất kể Manager và Bot Worker triển khai trên các hạ tầng khác nhau (Render Web Service, VPS Linux, Docker, máy chủ riêng).</li>
            <li><strong>Bảo Mật Quân Sự Scrypt & Zero Plaintext:</strong> Cơ chế mã hóa hai chiều và đồng bộ offline cache bảo vệ tuyệt đối thông tin khách hàng.</li>
          </ul>
        </div>
      </div>

      <!-- V9.3 -->
      <div class="timeline-item">
        <div class="timeline-node"></div>
        <div class="timeline-header">
          <span class="timeline-version">🛡️ KingMC Real-Time & Security V9.3</span>
          <span class="timeline-badge current">REAL-TIME 500MS & AUTH SYNC</span>
        </div>
        <div class="timeline-content">
          <ul>
            <li><strong>Polling Real-time 500ms mượt mà, chống nghẽn:</strong> Nâng cấp tần số polling lên 500ms với cơ chế gọi tuần tự async/await, loại bỏ triệt để xung đột race-condition khi nhiều tab cùng mở.</li>
            <li><strong>Khóa Bảo Mật Service-to-Service Nội Bộ:</strong> Sử dụng <code>BOT_SECRET_KEY</code> cấu hình qua biến môi trường giữa Manager và Bot con, khóa chặt 100% API riêng tư của Bot con trước mọi truy cập trái phép.</li>
            <li><strong>Đồng Bộ Tài Khoản Auth Sync (Scrypt Hash):</strong> Manager đồng bộ danh sách khách thuê và phân quyền xuống từng Bot con bằng chuẩn băm scrypt bảo mật, khách có thể đăng nhập trực tiếp trên Web Bot con mà không cần Manager online.</li>
            <li><strong>Bảo Vệ Giao Diện Bot Con Chống Lộ Dữ Liệu:</strong> Login Gate che kín UI mặc định ngay từ HTML, thêm nút Đăng xuất trên topbar và Modal lịch sử cập nhật riêng cho Bot con.</li>
            <li><strong>Nút Xem Mật Khẩu (👁 / 🙈) & Chip Lệnh Nhanh Chuẩn Hóa:</strong> Nút con mắt xem mật khẩu ở cả 2 file, chip lệnh nhanh (/dn, /login, /pay) tự điền tham số và không auto gửi.</li>
            <li><strong>Reset Bàn Giao Khách Mới Sạch 100%:</strong> Xóa trắng hoàn toàn trạng thái trong RAM, xóa sạch username không để lại dấu vết của khách cũ.</li>
            <li><strong>Quản Lý Bản Sao Lưu & Đồng Bộ Hẹn Giờ Bật/Tắt Hàng Loạt:</strong> Thêm nút xóa từng file Backup có kiểm tra bảo mật, bổ sung cấu hình hẹn giờ On/Off cố định và chu kỳ trong modal đồng bộ hàng loạt.</li>
          </ul>
        </div>
      </div>

      <!-- V9.0 -->
      <div class="timeline-item">
        <div class="timeline-node"></div>
        <div class="timeline-header">
          <span class="timeline-version">🚀 KingMC Commercial SaaS & Audit Trail Pro Max V9.0</span>
          <span class="timeline-badge current">SAAS COMMERCIAL & AUDIT TRAIL</span>
        </div>
        <div class="timeline-content">
          <ul>
            <li><strong>Nhật Ký Hoạt Động & Lịch Sử Cập Nhật Toàn Diện (Audit Trail Pro Max):</strong> Ghi nhận 100% thời gian thực mọi hành vi, thao tác người dùng và sự kiện tự động (Xác thực, Điều khiển bot, Tài khoản Minecraft, Cài đặt, Túi đồ, Hạm đội, Khách thuê, Giftcode, Watchdog, Auto-Healing).</li>
            <li><strong>Bộ Lọc Đa Năng & Xuất Dữ Liệu (Export CSV / JSONL):</strong> Hỗ trợ tìm kiếm từ khóa, phân loại theo danh mục (AUTH, BOT, FLEET, USER, LICENSE, SYSTEM), phân loại theo trạng thái (Thành công, Thất bại, Bị chặn), phân trang mượt mà và tải file báo cáo CSV/JSONL về máy tính với font tiếng Việt chuẩn UTF-8 BOM.</li>
            <li><strong>Xóa Lịch Sử Nhật Ký Có Kiểm Soát (Audit Retention & Clear):</strong> Admin có quyền xóa sạch nhật ký cũ, hệ thống tự động ghi nhận lại sự kiện xóa vào nhật ký mới để đảm bảo tính minh bạch và toàn vẹn dữ liệu.</li>
            <li><strong>Hệ Thống Thuê Bot & Gói Cước Tự Động (Subscription Engine):</strong> Quản lý thời hạn thuê chính xác từng giây, đồng hồ đếm ngược trực quan, cảnh báo sắp hết hạn và tự động thu hồi/tắt bot an toàn khi hết hạn.</li>
            <li><strong>Hệ Thống Mã Kích Hoạt (License Key / Giftcode):</strong> Tạo key gia hạn linh hoạt theo ngày/gói, tự động kích hoạt nạp ngày thuê qua Web Toolbar hoặc Login Gate.</li>
            <li><strong>Tự Đổi Tài Khoản Minecraft & Reset Bàn Giao:</strong> Khách thuê được chủ động đổi nick/pass bot của mình (kèm phân quyền Admin), tính năng 1-click Reset bàn giao bot sạch sẽ cho khách mới.</li>
            <li><strong>Broadcast Lệnh Hạm Đội & Remote GUI Inspector:</strong> Gửi lệnh hàng loạt cho toàn hạm đội bot, tương tác ảo click slot rương/kho đồ từ xa.</li>
            <li><strong>Xử Lý Triệt Để 24 Lỗi Kỹ Thuật (Bug Fixes):</strong> Khóa AES cố định không đổi khi restart container, log stream ổn định, phân quyền RBAC chặt chẽ, tối ưu DOM không giật lag.</li>
          </ul>
        </div>
      </div>

      <!-- V8.2 -->
      <div class="timeline-item">
        <div class="timeline-node"></div>
        <div class="timeline-header">
          <span class="timeline-version">🌱 KingMC Eco Sentinel & UI Evolution V8.2</span>
          <span class="timeline-badge past">ECO MODE & FLEET RESOURCE BAR</span>
        </div>
        <div class="timeline-content">
          <ul>
            <li><strong>Siêu Tối Ưu Eco Mode (Giảm 80% CPU & Lock RAM &lt; 220MB):</strong> Khi bot AFK tĩnh, tắt toàn bộ tính toán vật lý collision/raycasting (<code>physicsEnabled = false</code>), triệt tiêu gói tin hạt/ánh sáng/âm thanh không cần thiết và giới hạn buffer log 150 mục.</li>
            <li><strong>Fleet Resource Overview Bar:</strong> Bổ sung thanh thống kê tài nguyên hạm đội chuẩn Glassmorphism (Tổng RAM, RAM TB/bot, số bot đang kích hoạt Eco, mức CPU tiết kiệm ước tính ~80%).</li>
            <li><strong>Thanh Đo RAM Usage & Badge Eco Trên Thẻ Bot:</strong> Hiển thị badge <code>🌱 ECO ACTIVE</code> và thanh tiến trình RAM đổi màu trực quan theo ngưỡng dung lượng (&lt;200MB Xanh, 200-320MB Vàng/Lam, &gt;320MB Cam).</li>
            <li><strong>Đồng Bộ Cài Đặt Eco Toàn Hạm Đội:</strong> Hỗ trợ bật/tắt Eco Mode hàng loạt chỉ với 1 click trong modal Đồng bộ Cài đặt và từng bot riêng biệt.</li>
            <li><strong>Tối Ưu Giao Diện Di Động (Mobile UX):</strong> Chuẩn hóa touch targets &ge; 44px, grid co giãn thích ứng mượt mà trên mọi kích thước màn hình smartphone.</li>
          </ul>
        </div>
      </div>

      <!-- V8.1 -->
      <div class="timeline-item">
        <div class="timeline-node"></div>
        <div class="timeline-header">
          <span class="timeline-version">⚡ KingMC Telemetry Sentinel V8.1</span>
          <span class="timeline-badge past">SMART WATCHDOG & TELEMETRY</span>
        </div>
        <div class="timeline-content">
          <ul>
            <li><strong>Smart Watchdog Chống Kẹt Sảnh (&gt; 28s):</strong> Tự động phát hiện bot bị kẹt ở tọa độ đăng nhập hoặc sảnh quá 28 giây mà không vào được server AFK, tự động ngắt kết nối và đăng nhập lại từ đầu.</li>
            <li><strong>Ghost Freeze Watchdog (&gt; 35s):</strong> Lắng nghe luồng gói tin socket trực tiếp từ KingMC. Nếu quá 35s không nhận được packet (đứt kết nối ngầm), bot tự động Hard Reset kết nối.</li>
            <li><strong>Full Jitter Exponential Backoff:</strong> Thuật toán kết nối lại ngẫu nhiên đều kết hợp độ lệch pha theo ID bot (Fleet Phase Staggering), xóa bỏ nghẽn mạng Thundering Herd và chống ban IP hạm đội.</li>
            <li><strong>Cảnh Báo Telemetry Máu Yếu &amp; Tử Vong:</strong> Tích hợp webhook Discord Rich Embed và Telegram cảnh báo tức thì khi bot còn &le; 10 HP (&le; 5 tim) hoặc tử vong trong game (kèm tọa độ chi tiết).</li>
            <li><strong>Fleet Auto-Healing Lệch Pha:</strong> Cơ chế tự phục hồi bot offline của Manager giãn cách 2.5s mỗi bot, đảm bảo máy chủ không bị shock tải khi có nhiều bot cùng ngắt kết nối.</li>
          </ul>
        </div>
      </div>

      <!-- V8.0 -->
      <div class="timeline-item">
        <div class="timeline-node"></div>
        <div class="timeline-header">
          <span class="timeline-version">👑 KingMC Enterprise Fleet V8.0</span>
          <span class="timeline-badge past">ENTERPRISE SECURITY</span>
        </div>
        <div class="timeline-content">
          <ul>
            <li><strong>Bảo Mật Mật Khẩu:</strong> Mật khẩu Admin được băm bằng <code>scrypt</code>; mật khẩu tài khoản và thông tin đăng nhập bot được bảo vệ khi lưu trên Supabase bằng khóa cấu hình môi trường.</li>
            <li><strong>Chống Brute-Force Đăng Nhập:</strong> Giới hạn 5 lần thử trong 15 phút, khóa IP và độ trễ lũy thừa bảo vệ cổng đăng nhập.</li>
            <li><strong>Sao Lưu Cloud:</strong> Tạo snapshot vào Supabase định kỳ, trước thao tác lớn và giữ tối đa 30 bản gần nhất.</li>
            <li><strong>Audit Trail:</strong> Ghi nhận hoạt động quản trị vào bảng <code>audit_logs</code> trên Supabase, có phân trang và lọc trên giao diện Admin.</li>
          </ul>
        </div>
      </div>

      <!-- V7.2 -->
      <div class="timeline-item">
        <div class="timeline-node"></div>
        <div class="timeline-header">
          <span class="timeline-version">⭐ KingMC Sentinel V7.2</span>
          <span class="timeline-badge past">ZERO-FLICKER & PROFILE</span>
        </div>
        <div class="timeline-content">
          <ul>
            <li><strong>Zero-Flicker Instant Loading:</strong> Tối ưu hóa render phân giải phiên đăng nhập phía máy chủ; triệt tiêu 100% hiện tượng chớp nhấp nháy màn hình khi vừa mở web.</li>
            <li><strong>Menu Hồ Sơ Dropdown Góc Phải:</strong> Tích hợp nút Avatar thông minh (👑 Admin / 👤 User), hiển thị thông tin tài khoản, cấp bậc và bảng điều khiển trực quan.</li>
            <li><strong>Tính Năng Tự Đổi Mật Khẩu (Self-Service):</strong> Cung cấp form đổi mật khẩu an toàn cho cả User lẫn Admin trực tiếp từ menu hồ sơ.</li>
            <li><strong>Tinh Giản Cổng Đăng Nhập:</strong> Chuẩn hóa ô nhập tài khoản ("Nhập tên đăng nhập..."), gỡ bỏ các văn bản hướng dẫn rườm rà.</li>
          </ul>
        </div>
      </div>

      <!-- V7.1 -->
      <div class="timeline-item">
        <div class="timeline-node"></div>
        <div class="timeline-header">
          <span class="timeline-version">⭐ KingMC Sentinel V7.1</span>
          <span class="timeline-badge past">MULTI-USER RBAC</span>
        </div>
        <div class="timeline-content">
          <ul>
            <li><strong>Phân Quyền Đa Người Dùng (RBAC):</strong> Tách biệt Quản trị viên (Admin) và Operator; phân quyền chỉ định bot con cho từng thành viên.</li>
            <li><strong>Hệ Thống Thông Báo Sentinel:</strong> Popup thông báo admin thông minh với 3 chế độ (Hằng ngày 1 lần/ngày, Mọi lần vào, Khung thời gian).</li>
            <li><strong>Bảo Mật Phiên 30 Ngày:</strong> Lưu phiên bền vững trong bảng <code>manager_sessions</code> trên Supabase; không phụ thuộc filesystem host.</li>
            <li><strong>Đồng Bộ HUD Toàn Diện:</strong> Huy hiệu PRO V7.1, Role badge, Platform và RAM Manager hiển thị sắc nét xuyên suốt từ Dashboard đến chi tiết bot con.</li>
            <li><strong>Bảo Mật Dữ Liệu Bot:</strong> Ẩn hoàn toàn form tài khoản/mật khẩu bot con đối với tài khoản User thường.</li>
          </ul>
        </div>
      </div>

      <!-- V7.0 -->
      <div class="timeline-item">
        <div class="timeline-node"></div>
        <div class="timeline-header">
          <span class="timeline-version">⭐ KingMC Commander V7.0</span>
          <span class="timeline-badge past">INTELLIGENT SCHEDULER</span>
        </div>
        <div class="timeline-content">
          <ul>
            <li><strong>Hẹn Giờ Bot Thông Minh:</strong> Hỗ trợ đặt lịch theo giờ cố định hằng ngày hoặc chạy theo chu kỳ tuần tự.</li>
            <li><strong>Auto Chat Đa Dòng:</strong> Lên lịch gửi tin nhắn lặp lại với độ trễ (delay) mượt mà chống spam block.</li>
            <li><strong>Kéo Thả Hòm Đồ:</strong> Tương tác trực tiếp kéo thả slot trang bị, chuyển đổi Hotbar và vứt item ra thế giới thực.</li>
            <li><strong>Smart Anti-AFK Kick:</strong> Mô phỏng hành vi di chuyển, vung tay nhẹ nhàng chống AFK kick.</li>
          </ul>
        </div>
      </div>

      <!-- V6.0 -->
      <div class="timeline-item">
        <div class="timeline-node"></div>
        <div class="timeline-header">
          <span class="timeline-version">⭐ KingMC Sentinel Guard V6.1 (V6.0)</span>
          <span class="timeline-badge past">WEBHOOK WATCHDOG</span>
        </div>
        <div class="timeline-content">
          <ul>
            <li><strong>Cảnh Báo Webhook:</strong> Tích hợp thông báo tức thời qua Discord & Telegram khi bot offline quá 5 phút hoặc sắp hết Totem.</li>
            <li><strong>Watchdog Tự Phục Hồi:</strong> Tự động phát hiện bot bị kẹt hoặc mất kết nối và kích hoạt tái kết nối thông minh.</li>
          </ul>
        </div>
      </div>

      <!-- V5.0 -->
      <div class="timeline-item">
        <div class="timeline-node"></div>
        <div class="timeline-header">
          <span class="timeline-version">⭐ KingMC Performance V5.0</span>
          <span class="timeline-badge past">REALTIME SPARKLINES</span>
        </div>
        <div class="timeline-content">
          <ul>
            <li><strong>Đồ Thị SVG Sparklines:</strong> Theo dõi biến thiên Ping và RAM RSS trực quan theo thời gian thực.</li>
            <li><strong>Tối Ưu Bộ Nhớ:</strong> Tinh chỉnh cân đối tài nguyên ổn định trong mức 300 - 500 MB RAM.</li>
          </ul>
        </div>
      </div>

      <!-- V4.0 -->
      <div class="timeline-item">
        <div class="timeline-node"></div>
        <div class="timeline-header">
          <span class="timeline-version">⭐ KingMC Dynamic Hub V4.0</span>
          <span class="timeline-badge past">REGISTRY & BACKUP</span>
        </div>
        <div class="timeline-content">
          <ul>
            <li><strong>Quản Lý Bot Trực Tuyến:</strong> Thêm, sửa URL, xóa bot trực tiếp từ giao diện không cần khởi động lại server.</li>
            <li><strong>Sao Lưu Danh Sách:</strong> Hỗ trợ Export và Import khôi phục danh sách bot bằng định dạng file JSON.</li>
          </ul>
        </div>
      </div>

      <!-- V3.0 -->
      <div class="timeline-item">
        <div class="timeline-node"></div>
        <div class="timeline-header">
          <span class="timeline-version">⭐ KingMC Inventory V3.0</span>
          <span class="timeline-badge past">WORLD INTERACTION</span>
        </div>
        <div class="timeline-content">
          <ul>
            <li><strong>Giao Diện Hòm Đồ 36 Ô:</strong> Giám sát slot trang bị, Hotbar, hiển thị thanh Máu (Health), Đói (Hunger) và số lượng Totem.</li>
          </ul>
        </div>
      </div>

      <!-- V2.1 -->
      <div class="timeline-item">
        <div class="timeline-node"></div>
        <div class="timeline-header">
          <span class="timeline-version">⭐ KingMC Core V2.0 (V2.1)</span>
          <span class="timeline-badge past">MULTI-BOT CONTROL</span>
        </div>
        <div class="timeline-content">
          <ul>
            <li><strong>Điều Khiển Hàng Loạt:</strong> Nút chạy, dừng, khởi động lại tất cả bot cùng lúc; bảng thống kê KPI tập trung.</li>
          </ul>
        </div>
      </div>

      <!-- V1.1 -->
      <div class="timeline-item">
        <div class="timeline-node"></div>
        <div class="timeline-header">
          <span class="timeline-version">⭐ KingMC Console V1.1</span>
          <span class="timeline-badge past">CHAT & QUICK COMMANDS</span>
        </div>
        <div class="timeline-content">
          <ul>
            <li><strong>Live Console:</strong> Theo dõi Event Log và Chat Log trực tiếp; chip gửi lệnh nhanh <code>/menu</code> (Slot 24), <code>/dn</code>, <code>/login</code>, <code>/bal</code>, <code>/team chat</code>.</li>
          </ul>
        </div>
      </div>

      <!-- V1.0 -->
      <div class="timeline-item">
        <div class="timeline-node"></div>
        <div class="timeline-header">
          <span class="timeline-version">🚀 KingMC Genesis V1.0</span>
          <span class="timeline-badge past">INITIAL RELEASE</span>
        </div>
        <div class="timeline-content">
          <ul>
            <li><strong>Khởi Tạo Nền Tảng:</strong> Hệ thống KingMC AFK Bot cơ bản và giao diện web giám sát độc lập.</li>
          </ul>
        </div>
      </div>
    </div>

    <div class="modal-actions" style="margin-top:10px;padding-top:10px;border-top:1px solid rgba(255,255,255,0.06);">
      <button onclick="closeChangelogModal()">Đóng</button>
    </div>
</div>
</div>

<div id="supabaseModal" class="modal hidden">
  <div class="modal-card">
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:14px;">
      <h3 style="margin:0;font-size:18px;display:flex;align-items:center;gap:8px;">
        <span>☁️</span> Cấu hình Supabase Cloud Database
      </h3>
      <span id="supabaseStatusBadge" class="vip-pill" style="background:rgba(148,163,184,0.15);color:#94a3b8;border-color:rgba(148,163,184,0.3);">
        ⚪ Đang kiểm tra...
      </span>
    </div>

    <div id="supabaseAlertBox" class="login-alert hidden" style="margin-bottom:14px;"></div>

    <p style="font-size:12.5px;color:var(--muted);line-height:1.5;margin-bottom:16px;">
      Đồng bộ người dùng, License Key, hạm đội, phiên đăng nhập, cài đặt Bot và Audit Log lên Supabase PostgreSQL. Khi tạo project Supabase mới, sao chép SQL bên dưới và chạy một lần trong SQL Editor trước khi kết nối.
    </p>

    <div class="form-row">
      <label>Supabase Project URL</label>
      <input id="supabaseUrlInput" type="text" placeholder="https://xyzcompany.supabase.co" autocomplete="off" spellcheck="false">
    </div>

    <div class="form-row">
      <label>Supabase Service Role Key / API Key</label>
      <div class="password-input-wrap">
        <input id="supabaseKeyInput" type="password" placeholder="eyJh..." autocomplete="off">
        <button type="button" class="password-toggle-btn" onclick="togglePasswordVisibility('supabaseKeyInput', this)">👁</button>
      </div>
      <small style="color:var(--muted);font-size:11px;margin-top:4px;display:block;">
        Khuyên dùng <strong>service_role secret</strong> từ Supabase Dashboard (Settings &gt; API) để có toàn quyền đồng bộ bảng.
      </small>
    </div>

    <div style="background:rgba(56,189,248,0.06);border:1px solid rgba(56,189,248,0.2);border-radius:10px;padding:12px;margin:16px 0;font-size:12px;color:#cbd5e1;line-height:1.5;">
      <div style="font-weight:700;color:#38bdf8;margin-bottom:4px;">💡 Trạng thái hiện tại:</div>
      <div id="supabaseStatusMsg">Chưa tải trạng thái kết nối.</div>
    </div>

    <div class="modal-actions" style="margin-top:16px;gap:8px;flex-wrap:wrap;">
      <button type="button" onclick="closeSupabaseModal()">Đóng</button>
      <button type="button" class="secondary" id="supabaseSchemaBtn" onclick="copySupabaseSchemaSql()">📋 Sao chép SQL tạo bảng</button>
      <button type="button" class="secondary" id="supabaseTestBtn" onclick="testSupabaseConnection()">🧪 Kiểm tra kết nối</button>
      <button type="button" class="secondary" id="supabaseSyncBtn" onclick="syncAllToSupabase()">⬆ Tải lên Supabase Cloud</button>
      <button type="button" class="secondary" id="supabaseSyncDownBtn" onclick="syncDownFromSupabase()">⬇ Đồng bộ xuống</button>
      <button type="button" class="secondary" id="resolveAllResetsBtn" onclick="resolveAllPendingResets()" style="color:#f59e0b;border-color:rgba(245,158,11,0.4);" title="Dọn dẹp và gỡ bỏ tất cả xung đột / checkpoint reset đang treo">🧹 Dọn dẹp Reset Treo</button>
      <button type="button" class="primary" id="supabaseSaveBtn" onclick="saveSupabaseConfig()">💾 Lưu cấu hình</button>
    </div>
  </div>
</div>

<div class="app-footer">
  <div class="footer-recent-wrap">
    <div class="footer-recent-left">
      <span class="footer-recent-tag">🚀 KBOT V11.8 COMMERCIAL ENTERPRISE</span>
      <span class="footer-recent-desc">Nền Tảng Cho Thuê Bot AFK KingMC Thương Mại Số 1 • Pure Render Native • Zero Bandwidth Waste • 99.9% Uptime.</span>
    </div>
    <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;">
      <a href="https://discord.gg/mJWX5Xp3z" target="_blank" rel="noopener noreferrer" class="footer-discord-btn" title="Tham gia máy chủ Discord hỗ trợ KingMC">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M20.317 4.37a19.791 19.791 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.25.077.077 0 0 0-.079-.037A19.736 19.736 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 0 0 .031.057 19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028c.462-.63.874-1.295 1.226-1.994.021-.041.001-.09-.041-.106a13.107 13.107 0 0 1-1.872-.892.077.077 0 0 1-.008-.128 10.2 10.2 0 0 0 .372-.292.074.074 0 0 1 .077-.01c3.929 1.793 8.18 1.793 12.061 0a.074.074 0 0 1 .078.01c.12.098.246.198.373.292a.077.077 0 0 1-.006.127 12.299 12.299 0 0 1-1.873.894.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028 19.839 19.839 0 0 0 6.002-3.03.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.028zM8.02 15.33c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.956-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.956 2.418-2.157 2.418zm7.975 0c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.955-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.946 2.418-2.157 2.418z"/></svg>
        Discord
      </a>
      <button class="footer-changelog-btn" onclick="openChangelogModal()">📜 Xem Lịch Sử Cập Nhật (V1.0 - V11.8)</button>
    </div>
  </div>
  <div class="footer-copy">© 2026 KBOT — Hệ Thống Cho Thuê Bot AFK KingMC Thương Mại Cao Cấp. All rights reserved.</div>
</div>
<div id="toast" class="toast"></div>
<script>
window.__INITIAL_USER__ = null;
let currentUser = window.__INITIAL_USER__ || null;
let userManagementList = [];
let userManagementAvailableBots = [];
let userPassPeekMap = {};
let bots = [];
let selectedBotId = null;
let detailBot = null;
let managerPollTimerId = null;
let detailInventory = null;
let detailDragged = null;
let detailInventoryBusy = false;
let homeRequestInFlight = false;
let routeResolving = false;
let detailRequestInFlight = false;
let lastEventRevision = -1;
let lastChatRevision = -1;
let lastPositionHistoryRevision = -1;
let lastPositionHistoryFetchedAt = 0;
let eventLoading = false;
let chatLoading = false;
let uptimeSyncAt = Date.now();
let detailRefreshQueued = false;
let draggedBotId = null;
let detailAutoChatSchedules = [];
let detailBotSchedules = [];
let detailSettingsDirty = false;
let detailAutoChatDirty = false;
let detailBotScheduleDirty = false;
let detailSettingsSaveInFlight = false;
let detailAutoChatSaveInFlight = false;
let detailBotScheduleSaveInFlight = false;
let detailAccountSaveInFlight = false;
let detailLifecycleActionInFlight = false;
let allLifecycleActionInFlight = false;
let detailRefreshGeneration = 0;

function invalidateDetailReads() {
  detailRefreshGeneration++;
  return detailRefreshGeneration;
}

async function requestJson(url, options = {}) {
  const controller = new AbortController();
  const timeoutMs = Number.isFinite(Number(options.timeoutMs))
    ? Math.max(1000, Math.min(30000, Number(options.timeoutMs)))
    : 15000;
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const headers = { ...(options.headers || {}) };
  try {
    const localToken = localStorage.getItem('kingmc_session');
    if (localToken && !headers['Authorization'] && !headers['authorization']) {
      headers['Authorization'] = 'Bearer ' + localToken;
    }
  } catch (_) {}
  const requestOptions = { ...options, headers, cache: 'no-store', credentials: 'same-origin', signal: controller.signal };
  delete requestOptions.timeoutMs;
  if (options.body && typeof options.body === 'object' && !(options.body instanceof FormData) && !(options.body instanceof URLSearchParams) && !(typeof Blob !== 'undefined' && options.body instanceof Blob)) {
    if (!headers['Content-Type'] && !headers['content-type']) {
      headers['Content-Type'] = 'application/json';
    }
    requestOptions.body = JSON.stringify(options.body);
  }
  try {
    const response = await fetch(url, requestOptions);
    if (response.status === 401) {
      return { ok: false, status: 401, data: { error: 'Phiên đăng nhập hết hạn hoặc chưa đăng nhập.' } };
    }
    const text = await response.text();
    let data = {};
    try { data = text ? JSON.parse(text) : {}; }
    catch (_) { data = { raw: text }; }
    return { ok: response.ok, status: response.status, data };
  } catch (err) {
    return { ok: false, status: 0, data: { error: err && err.name === 'AbortError' ? 'Request web quá thời gian chờ.' : (err.message || 'Không thể kết nối web tổng.') } };
  } finally {
    clearTimeout(timer);
  }
}

function clampClientNumber(value, fallback, min, max) {
  const number = Number(value);
  if(!Number.isFinite(number)) return fallback;
  return Math.max(min, Math.min(max, number));
}

function normalizeClientBotUrl(value) {
  try {
    const url = new URL(String(value || '').trim());
    if(!['http:','https:'].includes(url.protocol)) return '';
    url.hash='';
    url.search='';
    return url.toString().replace(/\/+$/, '');
  } catch (_) {
    return '';
  }
}

function setDetailSettingsDisabled(disabled) {
  document.querySelectorAll('#detailSettingEcoMode, #detailSettingAutoTotem, #detailSettingAntiHungry, #detailSettingAutoReconnect, #detailSettingAntiAfkKick, #detailSpawnCommands, #saveDetailSettingsButton')
    .forEach(el => { el.disabled = !!disabled; });
}

// BUG-24: Detail settings giờ có field Spawn Commands; textarea input phải bật cờ dirty.
function markDetailSettingsDirty() { detailSettingsDirty = true; }

function setDetailAutoChatDisabled(disabled) {
  document.querySelectorAll('#detailAutoChatPanel button, #detailAutoChatPanel input, #detailAutoChatPanel select, #detailAutoChatPanel textarea')
    .forEach(el => { el.disabled = !!disabled; });
}

function setDetailBotScheduleDisabled(disabled) {
  document.querySelectorAll('#detailBotSchedulePanel button, #detailBotSchedulePanel input, #detailBotSchedulePanel select, #detailBotSchedulePanel textarea')
    .forEach(el => { el.disabled = !!disabled; });
}

document.addEventListener('click', event => {
  closeUserProfileDropdown();
  const copyIpBtn = event.target?.closest?.('.btn-copy-bot-ip');
  if (copyIpBtn && copyIpBtn.dataset.ip && copyIpBtn.dataset.ip !== '--') {
    event.stopPropagation();
    copyToClipboard(copyIpBtn.dataset.ip, 'IP Bot');
  }
});
document.addEventListener('input',event=>{
  if(event.target?.closest?.('#detailAutoChatSchedules')){
    detailAutoChatDirty=true;
    return;
  }
  if(event.target?.id==='detailBotScheduleEnabled' || event.target?.closest?.('#detailBotSchedules')){
    detailBotScheduleDirty=true;
    return;
  }
  if(['detailSettingEcoMode','detailSettingAutoTotem','detailSettingAntiHungry','detailSettingAutoReconnect','detailSettingAntiAfkKick','detailSpawnCommands'].includes(event.target?.id)){
    detailSettingsDirty=true;
  }
});
document.addEventListener('change',event=>{
  if(event.target?.closest?.('#detailAutoChatSchedules')){
    detailAutoChatDirty=true;
    return;
  }
  if(event.target?.id==='detailBotScheduleEnabled' || event.target?.closest?.('#detailBotSchedules')){
    detailBotScheduleDirty=true;
    return;
  }
  if(['detailSettingEcoMode','detailSettingAutoTotem','detailSettingAntiHungry','detailSettingAutoReconnect','detailSettingAntiAfkKick','detailSpawnCommands'].includes(event.target?.id)){
    detailSettingsDirty=true;
  }
});

function statusMeta(status, available=true, manuallyStopped=false, bot=null) {
  const isStopped = Boolean(manuallyStopped || bot?.manuallyStopped);
  if (isStopped && (status === 'offline' || status === 'kicked' || status === 'stopped' || !available)) {
    return ['gray', 'STOPPED', 'stopped'];
  }
  if (!available) {
    const httpStatus = bot?.httpStatus;
    const isSecretMismatch = !!(bot?.secretMismatch || httpStatus === 409 || String(bot?.lastError || bot?.error || '').includes('409') || String(bot?.lastError || bot?.error || '').toLowerCase().includes('secret') || String(bot?.lastError || bot?.error || '').includes('khóa') || String(bot?.lastError || bot?.error || '').includes('lệch key'));
    if (isSecretMismatch) {
      return ['orange', 'Lệch Secret Key (409)', 'secret_mismatch'];
    }
    const isSleep = !!(httpStatus === 503 || httpStatus === 502 || httpStatus === 521 || bot?.status === 'waking' || String(bot?.lastError || bot?.error || '').includes('503') || String(bot?.lastError || bot?.error || '').includes('502') || String(bot?.lastError || bot?.error || '').includes('521') || String(bot?.lastError || bot?.error || '').toLowerCase().includes('sleep') || String(bot?.lastError || bot?.error || '').includes('ngủ') || String(bot?.lastError || bot?.error || '').toLowerCase().includes('timeout') || String(bot?.lastError || bot?.error || '').toLowerCase().includes('quá thời gian') || String(bot?.lastError || bot?.error || '').toLowerCase().includes('waking'));
    if (isSleep) {
      const isRender = bot?.url ? String(bot.url).includes('.onrender.com') : true;
      const is521 = httpStatus === 521 || String(bot?.lastError || bot?.error || '').includes('521');
      return ['purple', is521 ? 'Wispbyte Sleep / Waking (521)' : (isRender ? 'Render Sleep / Timeout (503)' : 'Đang kết nối lại / Timeout (503)'), 'render_sleep'];
    }
    const isNotFound = !!(httpStatus === 404 || String(bot?.lastError || bot?.error || '').includes('404') || String(bot?.lastError || bot?.error || '').toLowerCase().includes('not found') || String(bot?.lastError || bot?.error || '').includes('không tồn tại'));
    if (isNotFound) {
      return ['red', 'URL không tồn tại (404)', 'not_found'];
    }
    const isProbing = !!(bot?.status === 'probing' || String(bot?.lastError || bot?.error || '').indexOf('Đang kiểm tra') !== -1);
    if (isProbing) {
      return ['yellow', 'ĐANG KIỂM TRA...', 'probing'];
    }
    return ['red', 'Mất kết nối / Unreachable', 'unreachable'];
  }
  const map={
    online:['green','ONLINE','online'],
    afk:['green','AFK','afk'],
    connecting:['yellow','CONNECTING','connecting'],
    authenticating:['blue','AUTH','authenticating'],
    entering:['blue','ENTERING SERVER','entering'],
    kicked:['red','KICKED','kicked'],
    offline:['red','OFFLINE','offline']
  };
  return map[status] || ['red','OFFLINE','offline'];
}

function showToast(message, type = 'info', duration = 3200) {
  const toast=document.getElementById('toast');
  if(!toast) return;
  const icons = {
    success: '✅ ',
    error: '❌ ',
    warning: '⚠️ ',
    info: 'ℹ️ '
  };
  const icon = icons[type] || '';
  toast.innerHTML = '<div style="display:flex;align-items:center;justify-content:space-between;gap:10px;">' +
    '<span>' + icon + escapeHtml(message || '') + '</span>' +
    '<span style="cursor:pointer;opacity:0.6;font-size:14px;padding:0 2px;" onclick="document.getElementById(\'toast\').style.display=\'none\'" title="Đóng">✕</span>' +
    '</div>';
  toast.className = 'toast toast-' + type;
  toast.style.display='block';
  clearTimeout(showToast.timer);
  showToast.timer=setTimeout(()=>{toast.style.display='none'}, duration);
}

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g,'&amp;')
    .replace(/</g,'&lt;')
    .replace(/>/g,'&gt;')
    .replace(/"/g,'&quot;')
    .replace(/'/g,'&#039;');
}

function botCardHtml(bot) {
  if (!bot) return '';
  const [color, label, errorType] = statusMeta(bot.status, bot.available, !!bot.manuallyStopped, bot);
  const username = bot.username || 'Chưa đặt';
  const isOffline = !bot.available || ['offline', 'kicked', 'error', 'disconnected', 'stopped'].includes(String(bot.status || '').toLowerCase());
  const pingRaw = bot.ping;

  const pingVal =
      pingRaw === null ||
      pingRaw === undefined ||
      String(pingRaw).trim() === ''
          ? NaN
          : Number(pingRaw);

  const ping =
      Number.isFinite(pingVal) && pingVal >= 0
          ? pingVal + ' ms'
          : (isOffline ? '-- ms (Tắt)' : '--');

  const tpsRaw = bot.tps ?? bot.serverTps;

  const tpsVal =
      tpsRaw === null ||
      tpsRaw === undefined ||
      String(tpsRaw).trim() === ''
          ? NaN
          : Number(tpsRaw);

  const hasTps = Number.isFinite(tpsVal) && tpsVal >= 0;

  const tpsText = hasTps
      ? tpsVal.toFixed(1) + ' TPS'
      : (isOffline ? '-- TPS (Tắt)' : '-- TPS');

  const tpsColor = !hasTps
      ? 'var(--muted)'
      : tpsVal >= 18.5
          ? 'var(--green)'
          : tpsVal >= 14.0
              ? 'var(--yellow)'
              : 'var(--red)';
  const posObj = bot.position || bot.roundedLocation;
  const pos = posObj && Number.isFinite(Number(posObj.x)) && Number.isFinite(Number(posObj.y)) && Number.isFinite(Number(posObj.z))
    ? (Math.round(Number(posObj.x)) + ' ' + Math.round(Number(posObj.y)) + ' ' + Math.round(Number(posObj.z)))
    : '-';
  const id = Number(bot.id);
  const totems = Number(bot.totemCount || 0);
  const isEco = bot.settings?.ecoMode !== false && bot.ecoMode !== false;
  const hw = bot.hostHardware;
  const botRamMb = Number(hw?.botRssMb || bot.ramRss || bot.rssMb || bot.memory?.rssMb || 0);
  const botHeapMb = Number(hw?.botHeapMb || bot.ramHeap || bot.heapMb || bot.memory?.heapMb || 0);

  // Host RAM
  const hostRamUsedMb = hw ? Number(hw.ramUsedMb) : botRamMb;
  const hostRamTotalMb = hw ? Number(hw.ramTotalMb) : (isEco ? 220 : 380);
  const hostRamPercent = hw ? Number(hw.ramPercent) : (hostRamTotalMb > 0 ? Math.min(100, Math.round((botRamMb / hostRamTotalMb) * 100)) : 0);
  const ramColor = hostRamPercent > 85 ? 'var(--red)' : hostRamPercent > 70 ? 'var(--yellow)' : 'var(--green)';

  // Host CPU & Net
  const hostCpuText = hw ? (hw.cpuPercent + '% / ' + hw.cpuCores + ' Cores') : '--';
  const cpuColor = hw && hw.cpuPercent > 85 ? 'var(--red)' : hw && hw.cpuPercent > 60 ? 'var(--yellow)' : '#38bdf8';
  const netText = hw ? ('↓ ' + hw.netDownKb + ' • ↑ ' + hw.netUpKb + ' KB/s') : '--';

  const pingSpark = generateSparklineSvg(bot.history?.ping, '#38bdf8');
  const ramSpark = generateSparklineSvg(bot.history?.ram, ramColor);
  const isAdmin = Boolean(currentUser && currentUser.role === 'admin');
  const sec = Number(bot.uptimeSeconds || 0);
  const uptimeText = sec > 0 ? (Math.floor(sec / 3600) + 'h ' + Math.floor((sec % 3600) / 60) + 'm') : '--';

  // HP Calculation & Bar
  const hpVal = Number.isFinite(Number(bot.health)) ? Number(bot.health) : null;
  const hpText = hpVal !== null ? (Math.round(hpVal) + ' / 20 HP') : (isOffline ? '-- HP (Tắt)' : '--');
  const hpPercent = hpVal !== null ? Math.max(0, Math.min(100, Math.round((hpVal / 20) * 100))) : 0;
  const hpColor = hpVal === null ? '#94a3b8' : (hpVal <= 6 ? 'var(--red)' : hpVal <= 14 ? 'var(--yellow)' : 'var(--green)');

  const kickWarning = bot.lastKickReason ? ('<div class="bot-kick-notice">⚠️ <strong>Bị kick:</strong> ' + escapeHtml(bot.lastKickReason) + '</div>') : '';
  const rawIp = String(bot.ipAddress || '').trim();
  const isLoopback = rawIp === '127.0.0.1' || rawIp === 'localhost' || rawIp === '0.0.0.0' || rawIp === '::1';
  const ipDisplay = (!isLoopback && rawIp) ? rawIp : (bot.host ? bot.host : '--');

  // Ownership badge (Hỗ trợ click để lọc theo tag trạng thái thuê)
  let ownerBadgeHtml = '';
  if (bot.rentable === false) {
    ownerBadgeHtml = '<span class="bot-owner-pill blocked" onclick="event.stopPropagation(); filterByTag(\'sys:not-rentable\')" title="Bấm để lọc các bot Không Cho Thuê" style="background:rgba(148,163,184,0.15);color:var(--muted);border:1px solid rgba(148,163,184,0.3);font-size:11px;padding:2px 8px;border-radius:12px;cursor:pointer;">🚫 Không Cho Thuê</span>';
  } else if (bot.assignedUsername) {
    ownerBadgeHtml = '<span class="bot-owner-pill rented" onclick="event.stopPropagation(); filterByTag(\'sys:rented\')" title="Bấm để lọc các bot Đang Được Thuê (Thuộc: ' + escapeHtml(bot.assignedUsername) + ')" style="cursor:pointer;">' +
      '👤 Thuộc: <strong>' + escapeHtml(bot.assignedUsername) + '</strong>' +
      (bot.assignedPlan ? ' <small>(' + escapeHtml(bot.assignedPlan) + ')</small>' : '') +
      '</span>';
  } else {
    ownerBadgeHtml = '<span class="bot-owner-pill free" onclick="event.stopPropagation(); filterByTag(\'sys:rentable\')" title="Bấm để lọc các bot Sẵn Sàng Cho Thuê" style="cursor:pointer;">' +
      '✨ Sẵn Sàng Cho Thuê' +
      '</span>';
  }

  const isAFK = bot.status === 'afk';
  const isOnlineWaiting = ['online', 'connecting', 'authenticating', 'entering'].includes(String(bot.status || '').toLowerCase());
  const statusGlowClass = !bot.available ? 'status-unreachable' : (isAFK ? 'status-afk' : (isOnlineWaiting ? 'status-waiting' : 'status-offline'));
  const displayNum = bot.displayIndex !== undefined ? bot.displayIndex : id;
  const idStr = String(displayNum).padStart(2, '0');

  const botTags = Array.isArray(bot.tags) ? bot.tags : [];
  const tagsHtml = botTags.length > 0
    ? ('<div class="bot-tags-wrap" style="display:flex;gap:4px;flex-wrap:wrap;align-items:center;">' +
        botTags.map(t => '<span class="bot-tag-chip" onclick="event.stopPropagation(); filterByTag(\'' + escapeHtml(t) + '\')" title="Lọc bot theo tag #' + escapeHtml(t) + '" style="font-size:10px;padding:2px 6px;border-radius:4px;background:rgba(168,85,247,0.18);color:#c084fc;border:1px solid rgba(168,85,247,0.3);cursor:pointer;font-weight:600;">#' + escapeHtml(t) + '</span>').join('') +
        (isAdmin ? '<button type="button" class="bot-mini-btn" onclick="event.stopPropagation(); editBotTags(' + id + ')" title="Chỉnh sửa tags" style="padding:1px 5px;font-size:10px;">🏷️</button>' : '') +
      '</div>')
    : (isAdmin ? '<button type="button" class="bot-mini-btn" onclick="event.stopPropagation(); editBotTags(' + id + ')" title="Gắn tag phân loại bot (+tag)" style="padding:1px 5px;font-size:10px;opacity:0.6;">＋tag</button>' : '');

  let errorBannerHtml = '';
  if (!bot.available) {
    if (errorType === 'stopped') {
      errorBannerHtml = '';
    } else if (errorType === 'secret_mismatch') {
      errorBannerHtml = '<div class="bot-error-action-banner warning">' +
        '<div class="bot-error-text">⚠️ <strong>Lệch Secret Key (409):</strong> Worker từ chối lệnh do khóa bí mật không khớp với Manager.</div>' +
        (isAdmin ? '<button type="button" class="bot-action-chip warning" onclick="event.stopPropagation(); openEditSecretModal(' + id + ')" title="Cập nhật Secret Key cho Bot #' + idStr + '">🔑 Sửa Secret Key</button>' : '') +
      '</div>';
    } else if (errorType === 'render_sleep') {
      const isRender = bot?.url ? String(bot.url).includes('.onrender.com') : true;
      const is521 = bot?.httpStatus === 521 || String(bot?.lastError || bot?.error || '').includes('521');
      const sleepLabel = is521 ? 'Wispbyte / Cloudflare Đang khởi động (521):' : (isRender ? 'Render Sleep / Timeout (503):' : 'Đang kết nối lại / Timeout (503):');
      const sleepMsg = is521 ? 'Máy chủ Wispbyte đang khởi động hoặc kết nối lại qua Cloudflare edge (~10-20s)...' : (isRender ? 'Máy chủ Cloud đang khởi động từ chế độ ngủ đông (~30-50s) hoặc timeout.' : 'Worker phản hồi chậm hoặc đang tải nặng, đang tự động kết nối lại...');
      errorBannerHtml = '<div class="bot-error-action-banner sleep">' +
        '<div class="bot-error-text">💤 <strong>' + sleepLabel + '</strong> ' + sleepMsg + '</div>' +
        '<button type="button" class="bot-action-chip info" onclick="event.stopPropagation(); quickBotAction(event,' + id + ',\'restart\')" title="Ping lại kết nối">⚡ Thử lại</button>' +
      '</div>';
    } else if (errorType === 'not_found') {
      errorBannerHtml = '<div class="bot-error-action-banner danger">' +
        '<div class="bot-error-text">❌ <strong>URL không tồn tại (404):</strong> URL worker bị sai hoặc app đã bị xoá khỏi Render.</div>' +
        '<div style="display:flex;gap:4px;">' +
          (isAdmin ? '<button type="button" class="bot-action-chip danger" onclick="event.stopPropagation(); deleteBot(event,' + id + ')" title="Xoá bot này khỏi registry">🗑 Xoá</button>' : '') +
          (isAdmin ? '<button type="button" class="bot-action-chip" onclick="event.stopPropagation(); editBot(event,' + id + ')" title="Sửa lại URL">✏ Sửa URL</button>' : '') +
        '</div>' +
      '</div>';
    } else if (errorType === 'probing') {
      errorBannerHtml = '<div class="bot-error-action-banner info">' +
        '<div class="bot-error-text">⏳ <strong>Đang kết nối:</strong> Đang kiểm tra trạng thái máy chủ bot...</div>' +
      '</div>';
    } else {
      errorBannerHtml = '<div class="bot-error-action-banner danger">' +
        '<div class="bot-error-text">⚠️ <strong>Mất kết nối:</strong> ' + escapeHtml(bot.lastError || bot.error || 'Worker không phản hồi.') + '</div>' +
        (isAdmin ? '<button type="button" class="bot-action-chip danger" onclick="event.stopPropagation(); deleteBot(event,' + id + ')" title="Xoá bot này khỏi registry">🗑 Xoá bot</button>' : '') +
      '</div>';
    }
  }

  return '<div class="bot-card ' + statusGlowClass + '" data-bot-id="' + id + '" draggable="' + (isAdmin ? 'true' : 'false') + '" ' +
    (isAdmin ? 'ondragstart="startBotDrag(event,' + id + ')" ondragover="allowBotDrop(event)" ondrop="dropBot(event,' + id + ')"' : '') +
    ' onclick="openBot(' + id + ')">' +

    '<div class="bot-card-topbar">' +
      '<div class="bot-card-title-group">' +
        '<span class="bot-id-chip">#' + idStr + '</span>' +
        '<h2 class="bot-card-name" title="' + escapeHtml(bot.label) + '">' + escapeHtml(bot.label) + '</h2>' +
        '<button type="button" class="bot-mini-btn btn-rename-alias" data-bot-id="' + id + '" data-bot-label="' + escapeHtml(bot.label) + '" onclick="event.stopPropagation(); handleRenameClick(this)" title="Đổi tên / Ghi chú hiển thị">✏</button>' +
        '<div class="bot-card-quick-actions" style="display:inline-flex;margin-left:4px;" onclick="event.stopPropagation()">' +
          (isOffline ?
            '<button type="button" class="bot-mini-btn" style="background:rgba(16,185,129,0.18);color:#34d399;border:1px solid rgba(16,185,129,0.45);font-weight:700;" onclick="quickCardAction(this,' + id + ',\'start\')" title="Chạy bot ngay">▶ Chạy</button>' :
            '<button type="button" class="bot-mini-btn danger" onclick="quickCardAction(this,' + id + ',\'stop\')" title="Dừng bot ngay">■ Dừng</button>') +
        '</div>' +
      '</div>' +
      (isAdmin ?
        '<div class="bot-card-admin-actions" onclick="event.stopPropagation()">' +
          '<button type="button" class="bot-mini-btn" onclick="editBot(event,' + id + ')" title="Cấu hình bot">⚙ Sửa</button>' +
          '<button type="button" class="bot-mini-btn danger" onclick="deleteBot(event,' + id + ')" title="Xóa bot khỏi hệ thống">🗑 Xóa</button>' +
        '</div>' : '') +
    '</div>' +

    '<div class="bot-status-strip">' +
      '<div class="bot-status-pill ' + color + '">' +
        '<span class="pulse-status-dot ' + color + '"></span>' +
        '<span>' + escapeHtml(label) + '</span>' +
      '</div>' +
      (isEco ? '<span class="eco-badge-glow" title="Eco Mode: Tiết kiệm 80% CPU & Watchdog khóa RAM < 220MB">🌱 ECO</span>' : '') +
      '<div class="bot-owner-wrap">' + ownerBadgeHtml + '</div>' +
      tagsHtml +
    '</div>' +
    errorBannerHtml +

    '<div class="bot-ingame-row">' +
      '<div class="bot-ingame-user" title="Nhân vật Minecraft ingame">' +
        '<span class="ingame-icon">🎮</span>' +
        '<span class="ingame-name">' + escapeHtml(username) + '</span>' +
      '</div>' +
      (isAdmin ? ('<div class="bot-ip-pill btn-copy-bot-ip" data-ip="' + escapeHtml(ipDisplay) + '" title="Click để copy IP Bot: ' + escapeHtml(ipDisplay) + '" style="cursor:pointer;">' +
        '<span>🌐 ' + escapeHtml(ipDisplay) + '</span>' +
        (ipDisplay !== '--' ? '<button type="button" class="btn-copy-bot-ip bot-mini-btn" data-ip="' + escapeHtml(ipDisplay) + '" title="Copy IP bot" style="padding:1px 4px;font-size:10px;margin-left:4px;cursor:pointer;">📋</button>' : '') +
      '</div>') : '') +
    '</div>' +

    '<div class="bot-vitals-matrix">' +
      '<div class="vital-card hp-card">' +
        '<div class="vital-label-row">' +
          '<span class="vital-label">❤️ MÁU (HP)</span>' +
          '<span class="vital-val" style="color:' + hpColor + ';">' + hpText + '</span>' +
        '</div>' +
        '<div class="hp-bar-track">' +
          '<div class="hp-bar-fill" style="width:' + hpPercent + '%;background:' + hpColor + ';"></div>' +
        '</div>' +
      '</div>' +

      '<div class="vital-card totem-card">' +
        '<div class="vital-label-row">' +
          '<span class="vital-label">🪙 TOTEM</span>' +
          '<span class="vital-val" style="color:var(--gold);">' + totems + ' Cái</span>' +
        '</div>' +
        (totems === 0 ?
          '<div class="totem-warning-badge">⚠️ Hết Totem!</div>' :
          '<div class="totem-ok-badge">🛡️ An Toàn</div>') +
      '</div>' +

      '<div class="vital-card ping-card">' +
        '<div class="vital-label-row">' +
          '<span class="vital-label">📶 PING / TPS ⚡</span>' +
          '<span class="vital-val" style="color:#38bdf8;">' + escapeHtml(ping) + ' <small style="color:' + tpsColor + ';font-weight:700;">(' + escapeHtml(tpsText) + ')</small></span>' +
        '</div>' +
        '<div class="sparkline-container">' + pingSpark + '</div>' +
      '</div>' +

      '<div class="vital-card uptime-card">' +
        '<div class="vital-label-row">' +
          '<span class="vital-label">⏱ UPTIME</span>' +
          '<span class="vital-val" style="color:var(--green);">' + uptimeText + '</span>' +
        '</div>' +
        '<div class="vital-sub-info">Tọa độ: ' + escapeHtml(pos) + '</div>' +
      '</div>' +
    '</div>' +

    (hostRamTotalMb > 0 ?
      '<div class="bot-ram-meter-box">' +
        '<div class="bot-ram-meter-labels" style="display:flex;justify-content:space-between;flex-wrap:wrap;gap:4px;font-size:11px;">' +
          '<span>🧠 RAM: <strong style="color:' + ramColor + ';">' + botRamMb + ' MB</strong>' + (botHeapMb > 0 ? ' <small style="color:var(--muted);">(Heap: ' + botHeapMb + 'MB)</small>' : '') + '</span>' +
          '<span>⚡ CPU: <strong style="color:' + cpuColor + ';">' + (hw ? hw.cpuPercent + '%' : '--') + '</strong></span>' +
          '<span>🌐 Net: <strong style="color:#a78bfa;">' + netText + '</strong></span>' +
        '</div>' +
        '<div class="ram-meter-track" style="margin-top:6px;">' +
          '<div class="ram-meter-bar-fill" style="width:' + Math.max(4, Math.min(100, hostRamPercent)) + '%;background:' + ramColor + ';" title="Host RAM: ' + hostRamUsedMb + '/' + hostRamTotalMb + ' MB (' + hostRamPercent + '%)"></div>' +
        '</div>' +
      '</div>' : '') +

    '<div class="card-quick-actions" onclick="event.stopPropagation()">' +
      '<button type="button" class="small card-btn" onclick="quickBotAction(event,' + id + ',\'restart\')">⚡ Restart</button>' +
      (isOffline ?
        '<button type="button" class="small card-btn primary" onclick="quickBotAction(event,' + id + ',\'start\')">▶ Bật</button>' :
        '<button type="button" class="small card-btn danger" onclick="quickBotAction(event,' + id + ',\'stop\')">⏹ Dừng</button>'
      ) +
      '<button type="button" class="small card-btn detail-link-btn" onclick="openBot(' + id + ')">⚙ Chi Tiết →</button>' +
    '</div>' +

  '</div>';
}

function startBotDrag(event,id){
  draggedBotId=Number(id);
  try{event.dataTransfer.setData('text/plain',String(id));event.dataTransfer.effectAllowed='move';}catch(_){}
  event.currentTarget.classList.add('dragging');
}
function allowBotDrop(event){event.preventDefault();}
async function dropBot(event,targetId){
  event.preventDefault();
  const sourceId=Number((()=>{try{return event.dataTransfer.getData('text/plain')||draggedBotId}catch(_){return draggedBotId}})());
  draggedBotId=null;
  if(!Number.isInteger(sourceId)||sourceId===Number(targetId))return;
  const ids=bots.map(x=>Number(x.id));
  const from=ids.indexOf(sourceId);const to=ids.indexOf(Number(targetId));
  if(from<0||to<0)return;
  const [item]=ids.splice(from,1);ids.splice(to,0,item);
  try{
    const result=await requestJson('/api/manager/bots/reorder',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({ids})});
    const data=result.data||{};
    if(!result.ok)throw new Error(data.error||'Không thể sắp xếp bot.');
    await refreshHome();
  }catch(err){showToast(err.message||'Không thể sắp xếp bot.');}
}

function renderEditBotTagSuggestions() {
  const container = document.getElementById('editBotTagSuggestions');
  if (!container) return;
  const currentTags = String(document.getElementById('editBotTags')?.value || '')
    .split(/[,;\s]+/)
    .map(t => t.trim().toLowerCase().replace(/^#/, ''))
    .filter(Boolean);
  const currentTagSet = new Set(currentTags);

  const allTags = new Set();
  (bots || []).forEach(b => {
    if (Array.isArray(b.tags)) {
      b.tags.forEach(t => {
        const clean = String(t || '').trim().toLowerCase().replace(/^#/, '');
        if (clean) allTags.add(clean);
      });
    }
  });

  if (allTags.size === 0) {
    container.innerHTML = '<span style="font-size:11px;color:var(--muted);font-style:italic;">Chưa có tag riêng nào trong hệ thống. Gõ tag vào ô trên để thêm mới.</span>';
    return;
  }

  let html = '<div style="font-size:11px;color:var(--muted);margin-bottom:4px;width:100%;">💡 <strong>Bấm chọn nhanh tag riêng đã có:</strong></div>';
  Array.from(allTags).sort().forEach(tag => {
    const isSelected = currentTagSet.has(tag);
    html += '<button type="button" onclick="toggleEditBotTag(\'' + escapeHtml(tag) + '\')" style="padding:2px 8px;font-size:11px;border-radius:12px;cursor:pointer;transition:all 0.15s;font-weight:600;' +
      (isSelected
        ? 'background:rgba(56,189,248,0.25);color:#38bdf8;border:1px solid #38bdf8;'
        : 'background:rgba(255,255,255,0.05);color:var(--muted);border:1px solid var(--border);') +
      '">' + (isSelected ? '✓ ' : '＋ ') + '#' + escapeHtml(tag) + '</button>';
  });
  container.innerHTML = html;
}
window.renderEditBotTagSuggestions = renderEditBotTagSuggestions;

function toggleEditBotTag(tag) {
  const input = document.getElementById('editBotTags');
  if (!input) return;
  const cleanTag = String(tag || '').trim().toLowerCase().replace(/^#/, '');
  if (!cleanTag) return;

  const currentTags = input.value.split(/[,;\s]+/).map(t => t.trim().toLowerCase().replace(/^#/, '')).filter(Boolean);
  const idx = currentTags.indexOf(cleanTag);
  if (idx >= 0) {
    currentTags.splice(idx, 1);
  } else {
    currentTags.push(cleanTag);
  }
  input.value = currentTags.join(', ');
  renderEditBotTagPreviews(input.value);
}
window.toggleEditBotTag = toggleEditBotTag;

function renderEditBotTagPreviews(raw) {
  const box = document.getElementById('editBotTagsPreview');
  if (!box) return;
  const tags = String(raw || '').split(/[,;\s]+/).map(t => t.trim().toLowerCase().replace(/^#/, '')).filter(Boolean);
  if (!tags.length) {
    box.innerHTML = '<span style="font-size:11px;color:var(--muted);font-style:italic;">Chưa có tag nào</span>';
  } else {
    box.innerHTML = tags.map(t => '<span style="font-size:11px;padding:2px 8px;border-radius:12px;background:rgba(56,189,248,0.15);color:#38bdf8;border:1px solid rgba(56,189,248,0.3);font-weight:600;">#' + escapeHtml(t) + '</span>').join('');
  }
  renderEditBotTagSuggestions();
}
window.renderEditBotTagPreviews = renderEditBotTagPreviews;

function editBot(event,id){
  if(event)event.stopPropagation();
  const bot=bots.find(x=>Number(x.id)===Number(id));
  if(!bot)return;
  document.getElementById('editBotId').value=String(id);
  document.getElementById('editBotUrl').value=bot.url||'';
  document.getElementById('editBotLabel').value=bot.label||'';
  const secInput = document.getElementById('editBotSecretKey');
  if (secInput) {
    secInput.value = bot.secretKey || '';
    secInput.type = 'password';
  }
  const tagsVal = Array.isArray(bot.tags) ? bot.tags.join(', ') : '';
  const tagsInput = document.getElementById('editBotTags');
  if (tagsInput) tagsInput.value = tagsVal;
  renderEditBotTagPreviews(tagsVal);
  const rentChk = document.getElementById('editBotRentable');
  if (rentChk) rentChk.checked = bot.rentable !== false;
  const rentStatusEl = document.getElementById('editBotRentalStatus');
  if (rentStatusEl) {
    if (bot.assignedUsername) {
      rentStatusEl.innerHTML = '<span style="color:#d8b4fe;font-weight:600;">👤 Đang được thuê bởi: <strong>' + escapeHtml(bot.assignedUsername) + '</strong></span>';
    } else if (bot.rentable === false) {
      rentStatusEl.innerHTML = '<span style="color:var(--muted);font-weight:600;">🚫 Đang khóa cho thuê (Dùng nội bộ / riêng)</span>';
    } else {
      rentStatusEl.innerHTML = '<span style="color:#7dd3fc;font-weight:600;">✨ Đang sẵn sàng cho thuê (Chưa có người thuê)</span>';
    }
  }
  document.getElementById('editBotModal').classList.remove('hidden');
}
function closeEditBotModal(){document.getElementById('editBotModal').classList.add('hidden');}
async function saveEditBot(){
  const id=Number(document.getElementById('editBotId').value);
  const url=document.getElementById('editBotUrl').value.trim();
  const label=document.getElementById('editBotLabel').value.trim();
  const secInput = document.getElementById('editBotSecretKey');
  const secretKey = secInput ? secInput.value.trim() : undefined;
  const rawTags=document.getElementById('editBotTags')?.value || '';
  const tags = rawTags.split(/[,;\s]+/).map(t => t.trim().toLowerCase().replace(/^#/, '')).filter(Boolean);
  const rentable = document.getElementById('editBotRentable') ? document.getElementById('editBotRentable').checked : true;
  if(currentUser?.role !== 'user' && !url){showToast('URL không được trống.');return;}
  try{
    let data;
    if (currentUser?.role === 'user') {
      const result = await requestJson('/api/manager/bot/' + id + '/alias', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ label })
      });
      data = result.data || {};
      if (!result.ok) throw new Error(data.error || 'Không thể đổi tên bot.');
      const found = bots.find(b => Number(b.id) === id);
      if (found) found.label = data.label || label || ('bot' + id);
      if (detailBot && Number(detailBot.id) === id) {
        detailBot.label = data.label || label || ('bot' + id);
        const titleEl = document.getElementById('detailTitle');
        if (titleEl) titleEl.textContent = detailBot.label;
      }
    } else {
      const payload = { url, label, tags, rentable };
      if (secretKey !== undefined) payload.secretKey = secretKey;
      const result=await requestJson('/api/manager/bot/'+id,{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)});
      data=result.data||{};
      if(!result.ok)throw new Error(data.error||'Không thể sửa bot.');
      const found = bots.find(b => Number(b.id) === id);
      if (found && data.bot) {
        if (data.bot.label) found.label = data.bot.label;
        if (data.bot.tags) found.tags = data.bot.tags;
        found.rentable = data.bot.rentable !== false;
        if (data.bot.secretKey !== undefined) found.secretKey = data.bot.secretKey;
      }
      if (detailBot && Number(detailBot.id) === id && data.bot?.label) {
        detailBot.label = data.bot.label;
        if (data.bot.secretKey !== undefined) detailBot.secretKey = data.bot.secretKey;
        const titleEl = document.getElementById('detailTitle');
        if (titleEl) titleEl.textContent = detailBot.label;
      }
    }
    closeEditBotModal();
    showToast(data.message||'Đã lưu thông tin bot.');
    lastHomeSig = '';
    updateTagPills();
    filterBots();
    await refreshHome();
  }catch(err){showToast(err.message||'Không thể sửa bot.');}
}

async function openAdminModal(){
  document.getElementById('adminModal').classList.remove('hidden');
  await loadAdminCredentials();
}
function closeAdminModal(){document.getElementById('adminModal').classList.add('hidden');}
async function loadAdminCredentials(){
  const box = document.getElementById('adminCredentialList');
  box.innerHTML = '<div style="text-align:center;padding:24px;color:var(--muted);">⏳ Đang tải thông tin tài khoản bot...</div>';
  try{
    const result=await requestJson('/api/manager/admin/credentials',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({}),timeoutMs:15000});
    const data=result.data||{};
    if(!result.ok)throw new Error(data.error||'Không thể mở thông tin bot.');
    box.innerHTML = '';
    if (!data.bots || data.bots.length === 0) {
      box.innerHTML = '<div style="text-align:center;padding:24px;color:var(--muted);">Chưa có bot nào trong danh sách.</div>';
      return;
    }
    (data.bots || []).forEach(bot => {
      const card = document.createElement('div');
      card.className = 'credential-card';
      const title = document.createElement('strong');
      title.textContent = bot.label || ('Bot ' + bot.id);
      card.appendChild(title);
      if (bot.ok) {
        const rowUser = document.createElement('div');
        rowUser.className = 'credential-row';
        const valUser = document.createElement('div');
        valUser.className = 'credential-value';
        valUser.textContent = bot.username || '(Chưa đặt)';
        const btnUser = document.createElement('button');
        btnUser.className = 'small';
        btnUser.type = 'button';
        btnUser.textContent = 'Copy User';
        btnUser.addEventListener('click', () => copyText(bot.username || ''));
        rowUser.appendChild(valUser);
        rowUser.appendChild(btnUser);
        card.appendChild(rowUser);

        const rowPass = document.createElement('div');
        rowPass.className = 'credential-row';
        const valPass = document.createElement('div');
        valPass.className = 'credential-value';
        valPass.textContent = '••••••••';
        valPass.setAttribute('data-full-pass', bot.password || '');
        const btnToggle = document.createElement('button');
        btnToggle.className = 'small';
        btnToggle.type = 'button';
        btnToggle.textContent = '👁 Hiện';
        btnToggle.addEventListener('click', function() {
          if (valPass.textContent === '••••••••') {
            valPass.textContent = valPass.getAttribute('data-full-pass') || '(Trống)';
            btnToggle.textContent = '🙈 Ẩn';
          } else {
            valPass.textContent = '••••••••';
            btnToggle.textContent = '👁 Hiện';
          }
        });
        const btnPass = document.createElement('button');
        btnPass.className = 'small';
        btnPass.type = 'button';
        btnPass.textContent = 'Copy Pass';
        btnPass.addEventListener('click', () => copyText(bot.password || ''));
        rowPass.appendChild(valPass);
        rowPass.appendChild(btnToggle);
        rowPass.appendChild(btnPass);
        card.appendChild(rowPass);
      } else {
        const note = document.createElement('div');
        note.className = 'note';
        note.style.color = 'var(--red)';
        note.textContent = '⚠️ ' + (bot.error || 'Lỗi đọc bot.');
        card.appendChild(note);
      }
      box.appendChild(card);
    });
  }catch(err){box.innerHTML = '<div style="text-align:center;padding:24px;color:var(--red);">⚠️ ' + escapeHtml(err.message) + '</div>';}
}

async function copyText(value){
  try{await navigator.clipboard.writeText(String(value??''));showToast('Đã copy.');}
  catch(_){showToast('Không thể copy trên trình duyệt này.');}
}

// ============================================================================
// HỆ THỐNG XÁC THỰC & PHÂN QUYỀN ĐA NGƯỜI DÙNG (CLIENT RBAC)
// ============================================================================

function showLoginGate() {
  document.getElementById('loginGate')?.classList.remove('hidden');
  document.body.classList.add('cosmic-mode-login');
  const closeBtn = document.getElementById('loginGateCloseBtn');
  if (closeBtn) closeBtn.style.display = currentUser ? 'block' : 'none';
  const v = document.getElementById('appGalaxyVideo');
  if (v) { v.playbackRate = 0.85; v.play().catch(() => {}); }
}

function hideLoginGate() {
  if (!currentUser) return;
  document.getElementById('loginGate')?.classList.add('hidden');
  document.body.classList.remove('cosmic-mode-login');
  applyDashboardCosmicMode(localStorage.getItem('kbot_cosmic_mode') || 'subtle');
}

function applyDashboardCosmicMode(mode) {
  var validThemes = ['galaxy', 'subtle', 'vivid', 'sunset', 'morning', 'off'];
  var raw = validThemes.indexOf(mode) >= 0 ? mode : 'galaxy';
  var effective = (raw === 'subtle' || raw === 'vivid') ? 'galaxy' : raw;

  localStorage.setItem('kbot_dashboard_theme', effective);
  localStorage.setItem('kbot_cosmic_mode', raw);

  document.body.classList.remove(
    'theme-galaxy', 'theme-sunset', 'theme-morning', 'theme-off',
    'cosmic-mode-vivid', 'cosmic-mode-subtle', 'cosmic-mode-off'
  );

  document.body.classList.add('theme-' + effective);
  if (effective === 'galaxy') {
    document.body.classList.add('cosmic-mode-vivid');
  } else if (effective === 'off') {
    document.body.classList.add('cosmic-mode-off');
  }

  var btn = document.getElementById('cosmicModeToggleBtn');
  if (btn) {
    if (effective === 'galaxy') {
      btn.textContent = '🌌 Chủ đề: Galaxy';
      btn.title = 'Chủ đề: Vũ Trụ Vô Tận (Deep Galaxy) — Bấm để chuyển sang Hoàng Hôn Bờ Biển';
    } else if (effective === 'sunset') {
      btn.textContent = '🌅 Chủ đề: Hoàng Hôn';
      btn.title = 'Chủ đề: Hoàng Hôn Bờ Biển (Sunset Coast) — Bấm để chuyển sang Bình Minh Thiên Nhiên';
    } else if (effective === 'morning') {
      btn.textContent = '🌄 Chủ đề: Bình Minh';
      btn.title = 'Chủ đề: Bình Minh Thiên Nhiên (Morning Nature) — Bấm để chuyển sang Tối Giản';
    } else {
      btn.textContent = '🌑 Chủ đề: Tĩnh';
      btn.title = 'Chủ đề: Tối Giản (Minimal Mode) — Bấm để quay về Vũ Trụ Galaxy';
    }
  }

  var v = document.getElementById('appGalaxyVideo');
  if (v) {
    if (effective === 'galaxy' && !document.body.classList.contains('cosmic-mode-off')) {
      v.style.display = 'block';
      v.style.transform = 'translate3d(0px,0px,0) scale(1.02)';
      v.playbackRate = 0.85;
      v.play().catch(function() {});
    } else {
      v.pause();
      v.style.display = 'none';
    }
  }
}

function cycleDashboardCosmicMode() {
  var current = localStorage.getItem('kbot_dashboard_theme') || localStorage.getItem('kbot_cosmic_mode') || 'galaxy';
  if (current === 'subtle' || current === 'vivid') current = 'galaxy';
  var themeOrder = ['galaxy', 'sunset', 'morning', 'off'];
  var idx = themeOrder.indexOf(current);
  var next = idx >= 0 ? themeOrder[(idx + 1) % themeOrder.length] : 'sunset';
  applyDashboardCosmicMode(next);
  if (typeof showToast === 'function') {
    var toastMap = {
      galaxy: '🌌 Chủ đề: Vũ Trụ Vô Tận (Deep Galaxy) — Chiều sâu 3D & Huyền bí',
      sunset: '🌅 Chủ đề: Hoàng Hôn Bờ Biển (Sunset Coast) — Yên ắng, tĩnh lặng & Thư thái',
      morning: '🌄 Chủ đề: Bình Minh Sinh Thái (Morning Nature) — Mây gió, chim trời & Thiên nhiên',
      off: '🌑 Chủ đề: Tối Giản (Minimal Mode) — Giải phóng 100% GPU & Phần cứng'
    };
    showToast(toastMap[next] || 'Đã chuyển đổi chủ đề', 'info');
  }
}
window.cycleDashboardCosmicMode = cycleDashboardCosmicMode;
window.applyDashboardCosmicMode = applyDashboardCosmicMode;

(function initAppGalaxyEngine() {
  var savedTheme = localStorage.getItem('kbot_dashboard_theme') || localStorage.getItem('kbot_cosmic_mode') || 'galaxy';
  setTimeout(function() { applyDashboardCosmicMode(savedTheme); }, 50);

  var canvas = document.getElementById('appStarfieldCanvas');
  if (!canvas) return;
  var ctx = canvas.getContext('2d');
  var w = 0, h = 0;
  var animTime = 0;
  var isMobile = /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent) || (window.innerWidth <= 768);

  function resize() {
    w = canvas.width = window.innerWidth;
    h = canvas.height = window.innerHeight;
    isMobile = /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent) || (window.innerWidth <= 768);
  }
  window.addEventListener('resize', resize, { passive: true });
  resize();

  // 1. GALAXY ASSETS (Optimized particle budget for mobile and desktop)
  var stars = [];
  var shootingStars = [];
  var starCount = isMobile ? 35 : 85;
  for (var i = 0; i < starCount; i++) {
    stars.push({
      x: Math.random() * w, y: Math.random() * h, z: Math.random() * 2.0 + 0.4,
      r: Math.random() * 1.8 + 0.7, a: Math.random() * 0.6 + 0.3,
      da: (Math.random() * 0.014 + 0.004) * (Math.random() < 0.5 ? 1 : -1),
      rgb: Math.random() < 0.4 ? '255,255,255' : (Math.random() < 0.7 ? '224,242,254' : '233,213,255')
    });
  }

  // 2. SUNSET ASSETS (Optimized particle budget)
  var sunsetEmbers = [];
  var emberCount = isMobile ? 12 : 28;
  for (var se = 0; se < emberCount; se++) {
    sunsetEmbers.push({
      x: Math.random() * w,
      y: Math.random() * h * 0.75 + h * 0.25,
      r: Math.random() * 2.2 + 0.8,
      a: Math.random() * 0.5 + 0.3,
      speedY: Math.random() * 0.5 + 0.25,
      seed: Math.random() * 10
    });
  }

  // 3. MORNING NATURE ASSETS
  var morningClouds = [
    { x: w * 0.08, y: h * 0.16, scale: 1.15, speed: 0.22 },
    { x: w * 0.38, y: h * 0.09, scale: 0.85, speed: 0.16 },
    { x: w * 0.68, y: h * 0.22, scale: 1.35, speed: 0.28 },
    { x: w * 0.92, y: h * 0.13, scale: 0.95, speed: 0.19 }
  ];
  var morningBirds = isMobile ? [
    { x: -50, y: h * 0.28, speedX: 2.3, speedY: -0.22, scale: 0.9, flapSpeed: 8.5, offset: 0 },
    { x: -110, y: h * 0.32, speedX: 2.4, speedY: -0.25, scale: 0.8, flapSpeed: 9.0, offset: 1.5 },
    { x: -170, y: h * 0.29, speedX: 2.2, speedY: -0.20, scale: 0.75, flapSpeed: 8.7, offset: 3.0 }
  ] : [
    { x: -50, y: h * 0.28, speedX: 2.4, speedY: -0.25, scale: 1.0, flapSpeed: 8.5, offset: 0 },
    { x: -90, y: h * 0.31, speedX: 2.3, speedY: -0.22, scale: 0.85, flapSpeed: 9.0, offset: 1.2 },
    { x: -130, y: h * 0.27, speedX: 2.5, speedY: -0.26, scale: 0.95, flapSpeed: 8.2, offset: 2.1 },
    { x: -160, y: h * 0.34, speedX: 2.2, speedY: -0.20, scale: 0.75, flapSpeed: 9.5, offset: 3.4 },
    { x: -210, y: h * 0.30, speedX: 2.4, speedY: -0.24, scale: 0.90, flapSpeed: 8.7, offset: 4.5 }
  ];
  var morningLeaves = [];
  var leafCount = isMobile ? 8 : 20;
  for (var ml = 0; ml < leafCount; ml++) {
    morningLeaves.push({
      x: Math.random() * w,
      y: Math.random() * h,
      vx: Math.random() * 1.2 + 0.8,
      vy: Math.random() * 0.8 + 0.4,
      size: Math.random() * 7 + 4,
      angle: Math.random() * Math.PI * 2,
      rotSpeed: (Math.random() - 0.5) * 0.04,
      color: Math.random() < 0.65 ? 'rgba(52,211,153,0.72)' : 'rgba(251,191,36,0.68)'
    });
  }

  document.addEventListener('visibilitychange', function() {
    var v = document.getElementById('appGalaxyVideo');
    if (!v) return;
    if (document.hidden) v.pause();
    else if (localStorage.getItem('kbot_dashboard_theme') === 'galaxy') v.play().catch(function() {});
  });

  function renderGalaxy(t) {
    for (var i = 0; i < stars.length; i++) {
      var s = stars[i];
      s.y -= 0.12 * s.z;
      s.a += s.da;
      if (s.a > 1.0 || s.a < 0.2) s.da = -s.da;
      if (s.y < -10) { s.y = h + 10; s.x = Math.random() * w; }
      var rad = s.r * s.z * 0.85;
      var alpha = Math.max(0.18, Math.min(1.0, s.a));
      if (rad > 1.8 && alpha > 0.6) {
        ctx.beginPath();
        ctx.arc(s.x, s.y, rad * 1.9, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(' + s.rgb + ',' + (alpha * 0.2).toFixed(2) + ')';
        ctx.fill();
        if (!isMobile && alpha > 0.85) {
          ctx.strokeStyle = 'rgba(255,255,255,' + (alpha * 0.7).toFixed(2) + ')';
          ctx.lineWidth = 1.0;
          var spLen = rad * 2.5;
          ctx.beginPath();
          ctx.moveTo(s.x - spLen, s.y); ctx.lineTo(s.x + spLen, s.y);
          ctx.moveTo(s.x, s.y - spLen); ctx.lineTo(s.x + spLen, s.y);
          ctx.stroke();
        }
      }
      ctx.beginPath();
      ctx.arc(s.x, s.y, rad, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(' + s.rgb + ',' + alpha + ')';
      ctx.fill();
    }
    if (shootingStars.length < 2 && Math.random() < 0.012) {
      shootingStars.push({
        x: Math.random() * w * 0.85 + w * 0.1,
        y: Math.random() * h * 0.4,
        len: Math.random() * 120 + 75,
        speed: Math.random() * 9 + 8,
        a: 1.0
      });
    }
    for (var j = shootingStars.length - 1; j >= 0; j--) {
      var st = shootingStars[j];
      st.x -= st.speed; st.y += st.speed * 0.58; st.a -= 0.02;
      if (st.a <= 0) { shootingStars.splice(j, 1); continue; }
      var tailX = st.x + st.len;
      var tailY = st.y - st.len * 0.58;
      var gGlow = ctx.createLinearGradient(st.x, st.y, tailX, tailY);
      gGlow.addColorStop(0, 'rgba(56,189,248,' + (st.a * 0.6).toFixed(2) + ')');
      gGlow.addColorStop(1, 'rgba(56,189,248,0)');
      ctx.strokeStyle = gGlow; ctx.lineWidth = 3.6; ctx.beginPath();
      ctx.moveTo(st.x, st.y); ctx.lineTo(tailX, tailY); ctx.stroke();
      ctx.beginPath();
      ctx.arc(st.x, st.y, 2.5, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(255,255,255,' + st.a.toFixed(2) + ')';
      ctx.fill();
    }
  }

  function renderSunsetCoast(t) {
    var horizonY = h * 0.58;
    var sunX = w * 0.5;
    var sunY = horizonY - 14;

    // 1. Crepuscular dusk sunbeams
    ctx.save();
    for (var r = 0; r < 8; r++) {
      var angle = -Math.PI * 0.85 + (r / 7) * Math.PI * 0.70 + Math.sin(t * 0.4 + r) * 0.04;
      var rLen = Math.max(w, h) * 1.2;
      var rayGrad = ctx.createLinearGradient(sunX, sunY, sunX + Math.cos(angle) * rLen, sunY + Math.sin(angle) * rLen);
      rayGrad.addColorStop(0, 'rgba(251,146,60,0.18)');
      rayGrad.addColorStop(0.6, 'rgba(234,88,12,0.06)');
      rayGrad.addColorStop(1, 'rgba(234,88,12,0)');
      ctx.fillStyle = rayGrad;
      ctx.beginPath();
      ctx.moveTo(sunX, sunY);
      ctx.lineTo(sunX + Math.cos(angle - 0.07) * rLen, sunY + Math.sin(angle - 0.07) * rLen);
      ctx.lineTo(sunX + Math.cos(angle + 0.07) * rLen, sunY + Math.sin(angle + 0.07) * rLen);
      ctx.closePath();
      ctx.fill();
    }
    ctx.restore();

    // 2. Majestic Sinking Sun Disc & Corona
    var sunAura = ctx.createRadialGradient(sunX, sunY, 15, sunX, sunY, 180);
    sunAura.addColorStop(0, 'rgba(255,255,240,0.95)');
    sunAura.addColorStop(0.25, 'rgba(253,186,116,0.75)');
    sunAura.addColorStop(0.6, 'rgba(249,115,22,0.30)');
    sunAura.addColorStop(1, 'rgba(234,88,12,0)');
    ctx.fillStyle = sunAura;
    ctx.beginPath();
    ctx.arc(sunX, sunY, 180, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = '#fffbeb';
    ctx.beginPath();
    ctx.arc(sunX, sunY, 44, 0, Math.PI * 2);
    ctx.fill();

    // 3. Distant Coastline Islands Silhouette
    ctx.fillStyle = 'rgba(28, 9, 38, 0.94)';
    ctx.beginPath();
    ctx.moveTo(0, horizonY);
    for (var px = 0; px <= w; px += 30) {
      var py = horizonY - 14 - Math.sin(px * 0.0035 + 0.4) * 22 - Math.sin(px * 0.011) * 10;
      ctx.lineTo(px, py);
    }
    ctx.lineTo(w, horizonY + 2);
    ctx.lineTo(0, horizonY + 2);
    ctx.closePath();
    ctx.fill();

    // 4. Multi-layered Ocean Waves
    var waveBands = [
      { y0: horizonY, h: 45, speed: 0.7, amp: 3.5, color: 'rgba(36, 12, 48, 0.82)' },
      { y0: horizonY + 35, h: 65, speed: 0.55, amp: 5.0, color: 'rgba(26, 9, 36, 0.88)' },
      { y0: horizonY + 85, h: 95, speed: 0.42, amp: 6.8, color: 'rgba(18, 6, 26, 0.93)' },
      { y0: horizonY + 160, h: h - (horizonY + 160), speed: 0.32, amp: 8.5, color: 'rgba(10, 3, 16, 0.98)' }
    ];
    for (var b = 0; b < waveBands.length; b++) {
      var wb = waveBands[b];
      ctx.fillStyle = wb.color;
      ctx.beginPath();
      ctx.moveTo(0, wb.y0);
      for (var wx = 0; wx <= w; wx += 25) {
        var waveY = wb.y0 + Math.sin(wx * 0.008 + t * wb.speed + b) * wb.amp + Math.cos(wx * 0.016 - t * 0.3) * (wb.amp * 0.4);
        ctx.lineTo(wx, waveY);
      }
      ctx.lineTo(w, h);
      ctx.lineTo(0, h);
      ctx.closePath();
      ctx.fill();
    }

    // 5. Sun Reflection Shimmer on Water
    for (var wy = horizonY + 4; wy < h; wy += 8) {
      var prog = (wy - horizonY) / (h - horizonY);
      var colSpread = 30 + prog * 260;
      var shimCenter = sunX + Math.sin(wy * 0.04 + t * 2.2) * (8 + prog * 24);
      var shimAlpha = (1.0 - prog * 0.72) * (0.32 + Math.sin(wy * 0.14 - t * 2.8) * 0.24);
      if (shimAlpha > 0.04) {
        ctx.strokeStyle = 'rgba(253, 186, 116, ' + shimAlpha.toFixed(2) + ')';
        ctx.lineWidth = 2.0 + prog * 2.2;
        ctx.beginPath();
        var barW = colSpread * (0.35 + Math.sin(wy + t) * 0.25);
        ctx.moveTo(shimCenter - barW, wy);
        ctx.lineTo(shimCenter + barW, wy);
        ctx.stroke();
      }
    }

    // 6. Floating Sunset Embers
    for (var se = 0; se < sunsetEmbers.length; se++) {
      var em = sunsetEmbers[se];
      em.y -= em.speedY;
      em.x += Math.sin(t + em.seed) * 0.6;
      if (em.y < horizonY - 40) { em.y = h + 10; em.x = Math.random() * w; }
      ctx.fillStyle = 'rgba(254, 215, 170, ' + em.a.toFixed(2) + ')';
      ctx.beginPath();
      ctx.arc(em.x, em.y, em.r, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  function renderMorningNature(t) {
    var sunX = w * 0.82;
    var sunY = h * 0.18;

    // 1. Radiant Morning Sunbeams
    ctx.save();
    for (var gr = 0; gr < 10; gr++) {
      var bAngle = (gr / 10) * Math.PI * 2 + t * 0.025;
      var rSpread = 0.08 + Math.sin(t * 0.6 + gr) * 0.02;
      var rayLen = Math.max(w, h) * 1.4;
      ctx.fillStyle = 'rgba(254, 240, 138, ' + (0.04 + Math.sin(t + gr * 0.7) * 0.022).toFixed(3) + ')';
      ctx.beginPath();
      ctx.moveTo(sunX, sunY);
      ctx.lineTo(sunX + Math.cos(bAngle - rSpread) * rayLen, sunY + Math.sin(bAngle - rSpread) * rayLen);
      ctx.lineTo(sunX + Math.cos(bAngle + rSpread) * rayLen, sunY + Math.sin(bAngle + rSpread) * rayLen);
      ctx.closePath();
      ctx.fill();
    }
    ctx.restore();

    // 2. Radiant Sun Disc
    var mSunAura = ctx.createRadialGradient(sunX, sunY, 12, sunX, sunY, 150);
    mSunAura.addColorStop(0, 'rgba(255,255,245,0.95)');
    mSunAura.addColorStop(0.3, 'rgba(254,240,138,0.72)');
    mSunAura.addColorStop(0.65, 'rgba(56,189,248,0.22)');
    mSunAura.addColorStop(1, 'rgba(56,189,248,0)');
    ctx.fillStyle = mSunAura;
    ctx.beginPath();
    ctx.arc(sunX, sunY, 150, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = '#fef08a';
    ctx.beginPath();
    ctx.arc(sunX, sunY, 40, 0, Math.PI * 2);
    ctx.fill();

    // 3. Drifting Fluffy Morning Clouds
    for (var c = 0; c < morningClouds.length; c++) {
      var cd = morningClouds[c];
      cd.x += cd.speed * 1.2;
      if (cd.x > w + 160) cd.x = -160;
      var cX = cd.x;
      var cY = cd.y;
      ctx.fillStyle = 'rgba(255, 255, 255, 0.40)';
      ctx.beginPath();
      ctx.arc(cX, cY, 35 * cd.scale, 0, Math.PI * 2);
      ctx.arc(cX + 28 * cd.scale, cY - 14 * cd.scale, 42 * cd.scale, 0, Math.PI * 2);
      ctx.arc(cX + 65 * cd.scale, cY, 32 * cd.scale, 0, Math.PI * 2);
      ctx.arc(cX + 35 * cd.scale, cY + 10 * cd.scale, 28 * cd.scale, 0, Math.PI * 2);
      ctx.fill();
    }

    // 4. Flock of Flying Birds (Đàn chim bay tự nhiên)
    for (var b = 0; b < morningBirds.length; b++) {
      var bd = morningBirds[b];
      bd.x += bd.speedX;
      bd.y += bd.speedY;
      if (bd.x > w + 60) {
        bd.x = -60 - Math.random() * 80;
        bd.y = h * 0.20 + Math.random() * h * 0.25;
      }
      var wing = Math.sin(t * bd.flapSpeed + bd.offset) * 10 * bd.scale;
      var span = 14 * bd.scale;
      ctx.strokeStyle = 'rgba(15, 35, 55, 0.90)';
      ctx.lineWidth = 1.8 * bd.scale;
      ctx.beginPath();
      ctx.moveTo(bd.x, bd.y);
      ctx.quadraticCurveTo(bd.x - span * 0.5, bd.y - wing - 4 * bd.scale, bd.x - span, bd.y - wing);
      ctx.moveTo(bd.x, bd.y);
      ctx.quadraticCurveTo(bd.x + span * 0.5, bd.y - wing - 4 * bd.scale, bd.x + span, bd.y - wing);
      ctx.stroke();
    }

    // 5. Swaying Forest Canopy
    ctx.fillStyle = 'rgba(4, 28, 20, 0.94)';
    ctx.beginPath();
    ctx.moveTo(0, h);
    for (var fx = 0; fx <= w; fx += 20) {
      var treeSway = Math.sin(fx * 0.04 + t * 1.4) * 3;
      var foliageY = h - 55 - Math.sin(fx * 0.008) * 25 - Math.sin(fx * 0.02) * 14 + treeSway;
      ctx.lineTo(fx, foliageY);
    }
    ctx.lineTo(w, h);
    ctx.closePath();
    ctx.fill();

    // 6. Floating Wind Leaves
    for (var l = 0; l < morningLeaves.length; l++) {
      var lf = morningLeaves[l];
      lf.x += lf.vx + Math.sin(t + l) * 0.5;
      lf.y += lf.vy + Math.cos(t + l) * 0.3;
      lf.angle += lf.rotSpeed;
      if (lf.x > w + 20 || lf.y > h + 20) {
        lf.x = -20;
        lf.y = Math.random() * h * 0.8;
      }
      ctx.save();
      ctx.translate(lf.x, lf.y);
      ctx.rotate(lf.angle);
      ctx.fillStyle = lf.color;
      ctx.beginPath();
      ctx.ellipse(0, 0, lf.size, lf.size * 0.45, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
  }

  function render() {
    var isOff = document.body.classList.contains('cosmic-mode-off') || document.body.classList.contains('theme-off');
    if (document.hidden || isOff) {
      setTimeout(function() { requestAnimationFrame(render); }, 800);
      return;
    }

    ctx.clearRect(0, 0, w, h);
    animTime += 0.02;

    var curTheme = localStorage.getItem('kbot_dashboard_theme') || 'galaxy';

    if (curTheme === 'sunset') {
      renderSunsetCoast(animTime);
    } else if (curTheme === 'morning') {
      renderMorningNature(animTime);
    } else {
      renderGalaxy(animTime);
    }

    requestAnimationFrame(render);
  }
  render();
})();

function togglePasswordVisibility(inputId, btn) {
  const input = document.getElementById(inputId);
  if (!input) return;
  if (input.type === 'password') {
    input.type = 'text';
    if (btn) btn.textContent = '🙈';
  } else {
    input.type = 'password';
    if (btn) btn.textContent = '👁';
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

  try {
    const res = await requestJson('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password, licenseKey, rememberMe })
    });

    if (!res.ok) {
      throw new Error(res.data?.error || 'Tên đăng nhập hoặc mật khẩu không chính xác.');
    }

    const data = res.data || {};
    currentUser = data.user || null;
    if (data.token) {
      try { localStorage.setItem('kingmc_session', data.token); } catch (_) {}
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
      if (typeof checkRewardQueryParams === 'function') checkRewardQueryParams();
    }, 350);

  } catch (err) {
    if (alertEl) {
      alertEl.textContent = '⚠️ ' + err.message;
      alertEl.className = 'login-alert error';
    }
  } finally {
    if (btn) {
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
      if (el) el.textContent = '🔑';
    });
    document.querySelectorAll('.admin-only').forEach(el => { el.style.display = 'none'; });
    return;
  }

  const username = currentUser.username || (currentUser.role === 'admin' ? 'admin' : 'User');
  const isAdmin = currentUser.role === 'admin';
  const avatar = isAdmin ? '👑' : '👤';
  const roleText = isAdmin ? '👑 Quản trị viên (Toàn quyền)' : '👤 Người vận hành (' + (Array.isArray(currentUser.assignedBotIds) ? currentUser.assignedBotIds.length : 0) + ' Bot)';

  // Kiểm tra hạn thuê và tạm khóa cho tài khoản User
  if (!isAdmin) {
    const isLocked = currentUser.status === 'disabled';
    const isExpired = currentUser.status === 'expired' || (currentUser.expiresAt && Date.now() > Date.parse(currentUser.expiresAt));

    if (isLocked) {
      appEl?.classList.add('account-restricted-blur');
      if (lockedOverlay) {
        lockedOverlay.classList.remove('hidden');
        const reasonEl = document.getElementById('lockedReasonMessage');
        if (reasonEl) reasonEl.textContent = currentUser.lockReason || 'Tài khoản của bạn đang bị tạm khóa. Vui lòng liên hệ Admin để được hỗ trợ.';
      }
      if (expiredOverlay) expiredOverlay.classList.add('hidden');
    } else if (isExpired) {
      appEl?.classList.add('account-restricted-blur');
      if (expiredOverlay) expiredOverlay.classList.remove('hidden');
      if (lockedOverlay) lockedOverlay.classList.add('hidden');
    } else {
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
    badges.forEach(b => {
      b.innerHTML = '👑 <strong>ADMIN (Toàn quyền)</strong>';
      b.style.background = 'rgba(234,179,8,0.2)';
      b.style.color = '#eab308';
      b.style.borderColor = 'rgba(234,179,8,0.4)';
    });
    document.querySelectorAll('.admin-only').forEach(el => { el.style.display = ''; });
  } else {
    appEl?.classList.add('user-mode');
    badges.forEach(b => {
      b.innerHTML = '👤 <strong>USER: ' + escapeHtml(currentUser.username) + '</strong>';
      b.style.background = 'rgba(56,189,248,0.2)';
      b.style.color = '#38bdf8';
      b.style.borderColor = 'rgba(56,189,248,0.4)';
    });
    document.querySelectorAll('.admin-only').forEach(el => { el.style.display = 'none'; });
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
  if (expEl) {
    if (isAdmin) {
      expEl.style.display = 'none';
    } else {
      expEl.style.display = 'block';
      if (!currentUser.expiresAt) {
        expEl.textContent = '👑 VIP Vĩnh Viễn';
        expEl.style.color = '#eab308';
      } else {
        const expDate = new Date(currentUser.expiresAt);
        const isExp = Date.now() > expDate.getTime();
        expEl.textContent = (isExp ? '⛔ Đã hết hạn: ' : '⏳ Hạn dùng: ') + expDate.toLocaleDateString('vi-VN');
        expEl.style.color = isExp ? '#ef4444' : '#38bdf8';
      }
    }
  }

  // Ẩn nút nhập mã key đối với tài khoản VIP Vĩnh Viễn
  const isPermanentUser = !isAdmin && !currentUser.expiresAt;
  const renewBtnTop = document.getElementById('btnUserRenewKey');
  const renewBtnDropdown = document.getElementById('globalRenewKeyBtn');
  if (renewBtnTop) renewBtnTop.style.display = (isAdmin || isPermanentUser) ? 'none' : '';
  if (renewBtnDropdown) renewBtnDropdown.style.display = (isAdmin || isPermanentUser) ? 'none' : '';

  if (typeof loadLink4mAdminSetting === 'function' && isAdmin) {
    void loadLink4mAdminSetting();
  } else if (typeof loadLink4mStatus === 'function' && !isAdmin) {
    void loadLink4mStatus();
  }
}

function toggleUserProfileDropdown(event) {
  if (typeof toggleGlobalProfileDropdown === 'function') {
    return toggleGlobalProfileDropdown(event);
  }
  if (event) event.stopPropagation();
  const dropdown = document.getElementById('globalUserProfileDropdown');
  if (dropdown) dropdown.classList.toggle('hidden');
}

function closeUserProfileDropdown() {
  document.getElementById('globalUserProfileDropdown')?.classList.add('hidden');
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
    document.getElementById(id)?.classList.toggle('active', auditLogType === type);
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

function renderAuditLogs(items, total, page, totalPages, limit) {
  const tbody = document.getElementById('auditLogTableBody');
  if (!tbody) return;

  const infoEl = document.getElementById('auditLogPaginationInfo');
  const indEl = document.getElementById('auditLogPageIndicator');
  const prevBtn = document.getElementById('auditLogPrevBtn');
  const nextBtn = document.getElementById('auditLogNextBtn');

  const startRecord = total === 0 ? 0 : (page - 1) * limit + 1;
  const endRecord = Math.min(total, page * limit);
  if (infoEl) infoEl.textContent = 'Hiển thị ' + startRecord + ' - ' + endRecord + ' trong tổng số ' + total + ' bản ghi';
  if (indEl) indEl.textContent = 'Trang ' + page + ' / ' + totalPages;
  if (prevBtn) prevBtn.disabled = (page <= 1);
  if (nextBtn) nextBtn.disabled = (page >= totalPages);

  if (!items.length) {
    tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;padding:28px;color:var(--muted);">Không tìm thấy bản ghi nhật ký nào phù hợp với bộ lọc.</td></tr>';
    return;
  }

  tbody.innerHTML = items.map(item => {
    const d = item.timestamp ? new Date(item.timestamp) : null;
    const timeDisplay = d ? d.toLocaleTimeString('vi-VN', { hour12: false }) + ' ' + d.toLocaleDateString('vi-VN') : '-';
    const relativeTime = d ? formatRelativeTime(d) : '';

    const statusMap = {
      'SUCCESS': { text: '🟢 THÀNH CÔNG', color: 'var(--green)', bg: 'rgba(34,197,94,0.14)' },
      'FAILED': { text: '🔴 THẤT BẠI', color: 'var(--red)', bg: 'rgba(239,68,68,0.14)' },
      'BLOCKED': { text: '🟠 BỊ CHẶN', color: 'var(--yellow)', bg: 'rgba(234,179,8,0.14)' },
      'PARTIAL': { text: '🟡 MỘT PHẦN', color: 'var(--cyan)', bg: 'rgba(56,189,248,0.14)' }
    };
    const st = statusMap[item.status] || { text: item.status || 'UNKNOWN', color: 'var(--muted)', bg: 'rgba(255,255,255,0.06)' };

    const roleMap = {
      'admin': '<span style="color:var(--cyan);font-weight:700;">👑 Quản trị viên</span>',
      'user': '<span style="color:var(--green);font-weight:700;">👤 Khách thuê</span>',
      'system': '<span style="color:#a78bfa;font-weight:700;">🤖 Hệ thống tự động</span>'
    };
    const actorRole = roleMap[item.actor?.role] || ('<span style="color:var(--muted);">' + escapeHtml(item.actor?.role || 'Guest') + '</span>');
    const actorUser = item.actor?.username || 'system';
    const actorIp = item.actor?.ip || '127.0.0.1';

    let targetText = '-';
    if (item.target) {
      if (typeof item.target === 'object') {
        if (item.target.botId !== undefined && item.target.botId !== null && item.target.botId !== '') {
          const bNum = item.target.botId;
          const lbl = item.target.label;
          const hasCustom = lbl && lbl !== ('Bot ' + bNum) && lbl !== ('bot' + bNum) && lbl !== ('Bot #' + bNum);
          targetText = '🤖 Bot #' + bNum + (hasCustom ? ' (' + lbl + ')' : '');
        } else if (item.target.username) {
          targetText = '👤 ' + item.target.username;
        } else if (item.target.key) {
          targetText = '🔑 ' + item.target.key;
        } else if (item.target.label) {
          targetText = '🤖 ' + item.target.label;
        } else {
          targetText = JSON.stringify(item.target);
        }
      } else {
        targetText = String(item.target);
      }
    }

    let detailsText = item.details || '-';
    if (typeof detailsText === 'object') detailsText = JSON.stringify(detailsText);

    const catBadgeStyle = 'display:inline-block;padding:2px 6px;border-radius:4px;font-size:10px;font-weight:800;letter-spacing:0.5px;background:rgba(255,255,255,0.08);margin-right:6px;border:1px solid rgba(255,255,255,0.12);';
    const cat = item.category || 'SYSTEM';
    const actionLabel = item.actionLabel || item.action || 'UNKNOWN';

    return '<tr>' +
      '<td style="white-space:nowrap;font-family:monospace;font-size:11px;" title="' + escapeHtml(relativeTime) + '">' +
        '<div>' + escapeHtml(timeDisplay) + '</div>' +
        '<div style="font-size:10px;color:var(--muted);">' + escapeHtml(relativeTime) + '</div>' +
      '</td>' +
      '<td>' +
        '<div>' + actorRole + '</div>' +
        '<div style="font-size:10.5px;color:#cbd5e1;font-weight:600;">' + escapeHtml(actorUser) + '</div>' +
        '<div style="font-size:10px;color:var(--muted);font-family:monospace;">' + escapeHtml(actorIp) + '</div>' +
      '</td>' +
      '<td>' +
        '<div style="display:flex;align-items:center;flex-wrap:wrap;gap:4px;">' +
          '<span style="' + catBadgeStyle + '">' + escapeHtml(cat) + '</span>' +
          '<span style="font-weight:600;font-size:11.5px;color:#f8fafc;">' + escapeHtml(actionLabel) + '</span>' +
        '</div>' +
      '</td>' +
      '<td style="font-size:11px;color:#e2e8f0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:135px;" title="' + escapeHtml(targetText) + '">' +
        escapeHtml(targetText) +
      '</td>' +
      '<td style="font-size:11.5px;color:#e2e8f0;line-height:1.45;word-break:break-word;">' +
        escapeHtml(detailsText) +
      '</td>' +
      '<td style="text-align:right;white-space:nowrap;">' +
        '<span style="display:inline-block;padding:3px 8px;border-radius:999px;font-size:10px;font-weight:700;color:' + st.color + ';background:' + st.bg + ';border:1px solid ' + st.color + '40;">' + escapeHtml(st.text) + '</span>' +
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

function exportAuditLogs(format) {
  if (!format) format = 'csv';
  if (currentUser?.role !== 'admin') {
    showToast('Chỉ Quản trị viên mới có quyền xuất nhật ký.');
    return;
  }
  showToast('Đang tải file xuất nhật ký (' + format.toUpperCase() + ')...');
  const a = document.createElement('a');
  a.href = '/api/manager/audit-logs/export?format=' + format;
  a.target = '_blank';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
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
  if (!newPassword || newPassword.length < 5) {
    if (alertEl) { alertEl.className = 'login-alert error'; alertEl.textContent = 'Mật khẩu mới phải từ 5 ký tự trở lên.'; }
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
      body: JSON.stringify({ oldPassword, newPassword })
    });
    if (!res.ok) {
      throw new Error(res.data?.error || 'Không thể đổi mật khẩu.');
    }
    showToast('✅ ' + (res.data?.message || 'Đổi mật khẩu thành công!'));
    closeChangePasswordModal();
  } catch (err) {
    if (alertEl) {
      alertEl.className = 'login-alert error';
      alertEl.textContent = '⚠️ ' + err.message;
    }
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = '💾 Cập Nhật Mật Khẩu'; }
  }
}

// ============================================================================
// V11.7 COMMERCIAL ENTERPRISE EDITION — ROUTER & USER MANAGEMENT CONTROLLER
// ============================================================================

let currentEditingUserId = null;
let userManagementBotOwnership = {};
let currentUserStatusFilter = 'all';
let userFilterSearchTimer = null;
let pendingBotReassignCallback = null;
let currentNavPage = 'dashboard';

// Điều hướng trang lớn (Full-Page Navigation Router)
function navigateTo(pageName) {
  if (pageName === 'users' || pageName === 'audit' || pageName === 'backup') {
    if (!currentUser || currentUser.role !== 'admin') {
      pageName = 'dashboard';
    }
  }
  currentNavPage = pageName;
  closeGlobalProfileDropdown();

  const pages = {
    dashboard: document.getElementById('homePage'),
    users: document.getElementById('userManagementPage'),
    audit: document.getElementById('auditPage'),
    backup: document.getElementById('backupPage'),
    detail: document.getElementById('detailPage')
  };

  const navPills = {
    dashboard: document.getElementById('navPillHome'),
    users: document.getElementById('navPillUsers'),
    audit: document.getElementById('navPillAudit'),
    backup: document.getElementById('navPillBackup')
  };

  // Ẩn tất cả trang và tắt active nav pill
  Object.keys(pages).forEach(k => {
    if (pages[k]) pages[k].classList.add('hidden');
    if (navPills[k]) navPills[k]?.classList.remove('active');
  });

  if (pageName !== 'detail') {
    selectedBotId = null;
    const url = new URL(window.location.href);
    url.searchParams.delete('bot');
    url.searchParams.delete('botUrl');
    history.pushState({}, '', url.pathname + url.search);
  }

  const targetPage = pages[pageName] || pages.dashboard;
  if (targetPage) targetPage.classList.remove('hidden');
  if (navPills[pageName]) navPills[pageName]?.classList.add('active');

  // Kích hoạt nạp dữ liệu cho trang đích
  if (pageName === 'dashboard') {
    refreshHome();
  } else if (pageName === 'users') {
    refreshUserManagementPage();
  } else if (pageName === 'audit') {
    refreshAuditLogs(1);
  } else if (pageName === 'backup') {
    refreshBackupList();
  }
}
window.navigateTo = navigateTo;

function toggleGlobalProfileDropdown(event) {
  if (event) event.stopPropagation();
  const dropdown = document.getElementById('globalUserProfileDropdown');
  if (dropdown) dropdown.classList.toggle('hidden');
}
window.toggleGlobalProfileDropdown = toggleGlobalProfileDropdown;

function closeGlobalProfileDropdown() {
  document.getElementById('globalUserProfileDropdown')?.classList.add('hidden');
}
window.closeGlobalProfileDropdown = closeGlobalProfileDropdown;

window.addEventListener('click', (e) => {
  if (!e.target.closest('#globalUserProfileBtn') && !e.target.closest('#globalUserProfileDropdown')) {
    closeGlobalProfileDropdown();
  }
});

// ⌨️ ACCESSIBILITY: Đóng modal và menu khi nhấn phím Escape
window.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    closeGlobalProfileDropdown();
    const openModals = document.querySelectorAll('.modal:not(.hidden)');
    openModals.forEach(modal => {
      if (modal.id === 'loginGateModal' && !currentUser) return;
      modal.classList.add('hidden');
    });
  }
});

// Chuyển tab Đăng nhập / Đăng ký tại Login Gate
function switchLoginGateTab(tab) {
  const loginForm = document.getElementById('loginForm');
  const regForm = document.getElementById('registerForm');
  const btnLogin = document.getElementById('tabBtnLogin');
  const btnReg = document.getElementById('tabBtnRegister');
  const alertEl = document.getElementById('loginAlert');
  if (alertEl) { alertEl.classList.add('hidden'); alertEl.textContent = ''; }

  if (tab === 'register') {
    if (loginForm) loginForm.style.display = 'none';
    if (regForm) regForm.style.display = 'flex';
    if (btnReg) {
      btnReg.style.background = 'rgba(56,189,248,0.2)';
      btnReg.style.color = '#38bdf8';
      btnReg.style.borderColor = 'rgba(56,189,248,0.4)';
    }
    if (btnLogin) {
      btnLogin.style.background = 'transparent';
      btnLogin.style.color = '#94a3b8';
      btnLogin.style.borderColor = 'transparent';
    }
  } else {
    if (loginForm) loginForm.style.display = 'flex';
    if (regForm) regForm.style.display = 'none';
    if (btnLogin) {
      btnLogin.style.background = 'rgba(56,189,248,0.2)';
      btnLogin.style.color = '#38bdf8';
      btnLogin.style.borderColor = 'rgba(56,189,248,0.4)';
    }
    if (btnReg) {
      btnReg.style.background = 'transparent';
      btnReg.style.color = '#94a3b8';
      btnReg.style.borderColor = 'transparent';
    }
  }
}
window.switchLoginGateTab = switchLoginGateTab;

// Xử lý tự đăng ký tài khoản mới trên In-App Login Gate
async function handleInAppRegisterSubmit(event) {
  if (event) event.preventDefault();
  const alertEl = document.getElementById('loginAlert');
  const submitBtn = document.getElementById('regSubmitBtn');
  const username = String(document.getElementById('regUsername')?.value || '').trim();
  const password = String(document.getElementById('regPassword')?.value || '');
  const confirmPassword = String(document.getElementById('regConfirmPassword')?.value || '');
  const licenseKey = String(document.getElementById('regLicenseKey')?.value || '').trim();

  if (alertEl) { alertEl.classList.add('hidden'); alertEl.textContent = ''; }

  if (!username) {
    if (alertEl) { alertEl.className = 'login-alert error'; alertEl.textContent = 'Vui lòng nhập tên đăng nhập.'; alertEl.classList.remove('hidden'); }
    return;
  }
  if (password !== confirmPassword) {
    if (alertEl) { alertEl.className = 'login-alert error'; alertEl.textContent = 'Mật khẩu xác nhận không khớp!'; alertEl.classList.remove('hidden'); }
    return;
  }

  if (submitBtn) { submitBtn.disabled = true; submitBtn.textContent = '⏳ Đang khởi tạo tài khoản...'; }

  try {
    const res = await requestJson('/api/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password, licenseKey })
    });

    if (!res.ok) {
      throw new Error(res.data?.error || 'Đăng ký tài khoản thất bại.');
    }

    const data = res.data || {};
    currentUser = data.user || null;
    if (data.token) {
      try { localStorage.setItem('kingmc_session', data.token); } catch (_) {}
    }

    if (alertEl) {
      alertEl.textContent = '🎉 ' + (data.message || 'Đăng ký thành công! Đang vào hệ thống...');
      alertEl.className = 'login-alert success';
      alertEl.classList.remove('hidden');
    }
    showToast('🎉 ' + (data.message || 'Đăng ký thành công! Chào mừng ' + username + '.'));

    // Chuyển cảnh mượt mà tức thì không reload trang, loại bỏ triệt để hiện tượng đơ Chrome do reload khi prompt lưu mật khẩu
    setTimeout(async () => {
      hideLoginGate();
      applyUserRoleUI();
      await refreshHome();
      scheduleNextManagerPoll();
      checkAndShowAnnouncement();
      if (typeof checkRewardQueryParams === 'function') checkRewardQueryParams();
    }, 350);
  } catch (err) {
    if (alertEl) {
      alertEl.className = 'login-alert error';
      alertEl.textContent = '⚠️ ' + err.message;
      alertEl.classList.remove('hidden');
    }
    if (submitBtn) { submitBtn.disabled = false; submitBtn.textContent = '📝 TẠO TÀI KHOẢN & VÀO HỆ THỐNG'; }
  }
}
window.handleInAppRegisterSubmit = handleInAppRegisterSubmit;

// Kích hoạt mã Key từ màn hình thông báo Hết hạn (Blur Overlay)
async function redeemKeyFromExpiredOverlay() {
  const keyInput = document.getElementById('expiredKeyInput');
  const alertEl = document.getElementById('expiredKeyAlert');
  const key = String(keyInput?.value || '').trim().toUpperCase();

  if (alertEl) { alertEl.classList.add('hidden'); alertEl.textContent = ''; }

  if (!key) {
    if (alertEl) { alertEl.className = 'login-alert error'; alertEl.textContent = 'Vui lòng nhập mã Key gia hạn.'; alertEl.classList.remove('hidden'); }
    return;
  }

  try {
    const res = await requestJson('/api/manager/renew', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ licenseKey: key })
    });
    if (!res.ok) {
      throw new Error(res.data?.error || 'Mã Key không hợp lệ hoặc đã qua sử dụng.');
    }
    showToast((res.data?.partial ? '⚠️ ' : '🎉 ') + (res.data?.warning || 'Kích hoạt Key thành công! Đang tải lại phiên làm việc...'));
    setTimeout(() => { window.location.reload(); }, res.data?.partial ? 1800 : 800);
  } catch (err) {
    if (alertEl) {
      alertEl.className = 'login-alert error';
      alertEl.textContent = '⚠️ ' + err.message;
      alertEl.classList.remove('hidden');
    }
  }
}
window.redeemKeyFromExpiredOverlay = redeemKeyFromExpiredOverlay;

// Chuyển Sub-Tab giữa User List và Key List trên trang Quản lý User
function switchUserMgmtSubTab(subTab) {
  const panelUsers = document.getElementById('subPanelUsers');
  const panelKeys = document.getElementById('subPanelKeys');
  const tabUsers = document.getElementById('subTabUsers');
  const tabKeys = document.getElementById('subTabKeys');

  if (subTab === 'keys') {
    if (panelUsers) panelUsers.classList.add('hidden');
    if (panelKeys) panelKeys.classList.remove('hidden');
    if (tabKeys) tabKeys.classList.add('active');
    if (tabUsers) tabUsers.classList.remove('active');
    refreshKeysTable();
  } else {
    if (panelUsers) panelUsers.classList.remove('hidden');
    if (panelKeys) panelKeys.classList.add('hidden');
    if (tabUsers) tabUsers.classList.add('active');
    if (tabKeys) tabKeys.classList.remove('active');
    refreshUserManagementPage();
  }
}
window.switchUserMgmtSubTab = switchUserMgmtSubTab;

async function openUserManagementModal() {
  if (currentUser?.role !== 'admin') {
    showToast('Chỉ Quản trị viên mới có quyền mở quản lý user.');
    return;
  }
  navigateTo('users');
}
window.openUserManagementModal = openUserManagementModal;

function closeUserManagementModal() {
  document.getElementById('userManagementModal')?.classList.add('hidden');
}
window.closeUserManagementModal = closeUserManagementModal;

// Tải dữ liệu toàn bộ User và Bot Ownership
async function refreshUserManagementPage() {
  void loadTrialGiftSetting();
  const tbodyFull = document.getElementById('userFullTableBody');
  const tbodyModal = document.getElementById('userTableBody');
  const placeholders = [tbodyFull, tbodyModal].filter(Boolean);
  placeholders.forEach(tb => {
    tb.innerHTML = '<tr><td colspan="6" style="text-align:center;padding:24px;color:var(--muted);">⏳ Đang làm mới dữ liệu người dùng...</td></tr>';
  });

  try {
    const res = await requestJson('/api/manager/users');
    if (!res.ok) throw new Error(res.data?.error || 'Không thể tải danh sách user.');
    userManagementList = (Array.isArray(res.data?.users) ? res.data.users : [])
      .filter(u => u.role !== 'admin' && String(u.username || '').toLowerCase() !== 'admin');
    userManagementAvailableBots = Array.isArray(res.data?.availableBots) ? res.data.availableBots : [];
    userManagementBotOwnership = (res.data?.botOwnership && typeof res.data.botOwnership === 'object') ? res.data.botOwnership : {};

    // Cập nhật các thống kê số liệu
    const total = userManagementList.length;
    const now = Date.now();
    const activeCount = userManagementList.filter(u => u.status === 'active' && (!u.expiresAt || Date.parse(u.expiresAt) > now)).length;
    const disabledCount = userManagementList.filter(u => u.status === 'disabled').length;
    const expiredCount = userManagementList.filter(u => u.status === 'expired' || (u.expiresAt && Date.parse(u.expiresAt) <= now)).length;
    const lifetimeCount = userManagementList.filter(u => !u.expiresAt).length;

    const elTotal = document.getElementById('userMgmtTotalCount'); if (elTotal) elTotal.textContent = total;
    const elStatAll = document.getElementById('statUserAll'); if (elStatAll) elStatAll.textContent = total;
    const elStatAct = document.getElementById('statUserActive'); if (elStatAct) elStatAct.textContent = activeCount;
    const elStatDis = document.getElementById('statUserDisabled'); if (elStatDis) elStatDis.textContent = disabledCount;
    const elStatExp = document.getElementById('statUserExpired'); if (elStatExp) elStatExp.textContent = expiredCount;
    const elStatLife = document.getElementById('statUserLifetime'); if (elStatLife) elStatLife.textContent = lifetimeCount;

    renderUserTable();
  } catch (err) {
    placeholders.forEach(tb => {
      tb.innerHTML = '<tr><td colspan="6" style="text-align:center;color:var(--red);padding:24px;">Lỗi: ' + escapeHtml(err.message) + '</td></tr>';
    });
  }
}
window.refreshUserManagementPage = refreshUserManagementPage;
window.refreshUserManagementList = refreshUserManagementPage;

function setUserStatusFilter(status) {
  currentUserStatusFilter = status;
  const chipMap = {
    all: document.getElementById('userFilterAll'),
    active: document.getElementById('userFilterActive'),
    disabled: document.getElementById('userFilterDisabled'),
    expired: document.getElementById('userFilterExpired'),
    lifetime: document.getElementById('userFilterLifetime')
  };
  Object.keys(chipMap).forEach(k => {
    if (chipMap[k]) chipMap[k].classList.toggle('active', k === status);
  });
  renderUserTable();
}
window.setUserStatusFilter = setUserStatusFilter;

function debounceUserFilter() {
  if (userFilterSearchTimer) clearTimeout(userFilterSearchTimer);
  userFilterSearchTimer = setTimeout(() => { renderUserTable(); }, 200);
}
window.debounceUserFilter = debounceUserFilter;

// Bật / tắt hiển thị mật khẩu người dùng (Toggle Peek - On-Demand)
async function toggleUserPasswordPeek(userId) {
  const u = userManagementList.find(x => x.id === userId);
  if (!userPassPeekMap[userId]) {
    if (u && !u.password) {
      try {
        const res = await requestJson('/api/manager/users/' + encodeURIComponent(userId) + '/reveal-password', { method: 'POST' });
        const pass = res.data?.password ?? res.password;
        if (res.ok && typeof pass === 'string' && pass.length > 0) {
          u.password = pass;
        } else if (!res.ok) {
          showToast(res.data?.error || 'Không thể lấy mật khẩu người dùng.', 'error');
          return;
        } else {
          u.password = pass || '(trống)';
        }
      } catch (err) {
        showToast('Không thể lấy mật khẩu: ' + (err.message || err), 'error');
        return;
      }
    }
    userPassPeekMap[userId] = true;
  } else {
    userPassPeekMap[userId] = false;
  }
  renderUserTable();
}
window.toggleUserPasswordPeek = toggleUserPasswordPeek;
window.togglePassPeek = (userId) => toggleUserPasswordPeek(userId);

// Render bảng User (áp dụng bộ lọc trạng thái và tìm kiếm thời gian thực)
function renderUserTable() {
  const tbodyFull = document.getElementById('userFullTableBody');
  const tbodyModal = document.getElementById('userTableBody');
  const targets = [tbodyFull, tbodyModal].filter(Boolean);
  if (!targets.length) return;

  const searchQuery = String(document.getElementById('userFilterSearch')?.value || '').trim().toLowerCase();
  const now = Date.now();

  const filtered = userManagementList
    .filter(u => u.role !== 'admin' && String(u.username || '').toLowerCase() !== 'admin')
    .filter(u => {
    // Lọc theo từ khóa tìm kiếm
    if (searchQuery) {
      const matchUser = String(u.username || '').toLowerCase().includes(searchQuery);
      const matchNote = String(u.note || '').toLowerCase().includes(searchQuery);
      const matchPlan = String(u.planName || '').toLowerCase().includes(searchQuery);
      if (!matchUser && !matchNote && !matchPlan) return false;
    }

    // Lọc theo trạng thái
    const isAct = u.status === 'active' && (!u.expiresAt || Date.parse(u.expiresAt) > now);
    const isDis = u.status === 'disabled';
    const isExp = u.status === 'expired' || (u.expiresAt && Date.parse(u.expiresAt) <= now);
    const isLife = !u.expiresAt;

    if (currentUserStatusFilter === 'active') return isAct;
    if (currentUserStatusFilter === 'disabled') return isDis;
    if (currentUserStatusFilter === 'expired') return isExp;
    if (currentUserStatusFilter === 'lifetime') return isLife;
    return true;
  });

  if (!filtered.length) {
    const emptyHtml = '<tr><td colspan="6" style="text-align:center;padding:36px;color:var(--muted);">' +
      (userManagementList.length ? 'Không có người dùng nào khớp với bộ lọc.' : 'Chưa có người dùng nào. Nhấn "＋ Thêm Người Dùng Mới" để tạo ngay!') +
      '</td></tr>';
    targets.forEach(tb => { tb.innerHTML = emptyHtml; });
    return;
  }

  const rowsHtml = filtered.map(u => {
    const isAct = u.status === 'active' && (!u.expiresAt || Date.parse(u.expiresAt) > now);
    const isDis = u.status === 'disabled';
    const isExp = u.status === 'expired' || (u.expiresAt && Date.parse(u.expiresAt) <= now);
    const isLife = !u.expiresAt;

    // Cột 1: Người dùng
    const isAdmin = u.role === 'admin';
    const userCol = '<div>' +
      '<div style="display:flex;align-items:center;gap:6px;">' +
        '<strong style="font-size:13.5px;color:#fff;">' + (isAdmin ? '👑' : '👤') + ' ' + escapeHtml(u.username) + '</strong>' +
        (isAdmin ? ' <span class="vip-pill-mini">ADMIN</span>' : '') +
      '</div>' +
      (u.note ? '<div style="font-size:11px;color:var(--muted);margin-top:2px;">📝 ' + escapeHtml(u.note) + '</div>' : '') +
      (u.planName ? '<div style="font-size:11px;color:#38bdf8;margin-top:1px;font-weight:700;">' + escapeHtml(u.planName) + '</div>' : '') +
    '</div>';

    // Cột 2: Mật khẩu (Peek Toggle)
    const isPeek = !!userPassPeekMap[u.id];
    const passDisplay = isPeek ? (u.password || '—') : '••••••••';
    const eyeIcon = isPeek ? '🙈' : '👁';
    const passCol = '<div class="password-cell-wrap">' +
      '<span class="password-text ' + (isPeek ? 'revealed' : 'masked') + '" ' + (isPeek && u.password && u.password !== '—' && u.password !== '(trống)' ? 'onclick="copyToClipboard(\'' + escapeHtml(u.password) + '\', \'Mật khẩu\')" style="cursor:pointer;" title="Click để copy mật khẩu"' : '') + '>' + escapeHtml(passDisplay) + '</span>' +
      '<button type="button" class="btn-peek" onclick="toggleUserPasswordPeek(\'' + u.id + '\')" title="' + (isPeek ? 'Ẩn mật khẩu' : 'Hiện mật khẩu') + '">' + eyeIcon + '</button>' +
    '</div>';

    // Cột 3: Hạn dùng & Gia hạn nhanh
    let expBadge = '';
    if (isLife) {
      expBadge = '<span class="badge-lifetime">👑 Vĩnh Viễn</span>';
    } else if (isExp) {
      const expExact = typeof formatFullDateTime === 'function' ? formatFullDateTime(u.expiresAt) : new Date(u.expiresAt).toLocaleString('vi-VN');
      expBadge = '<span class="badge-expired" title="Hết hạn: ' + expExact + '">⛔ Hết hạn (' + expExact + ')</span>';
    } else {
      const diffMs = Date.parse(u.expiresAt) - now;
      const totalHours = Math.floor(diffMs / 3600000);
      const days = Math.floor(totalHours / 24);
      const hours = totalHours % 24;
      const expExact = typeof formatFullDateTime === 'function' ? formatFullDateTime(u.expiresAt) : new Date(u.expiresAt).toLocaleString('vi-VN');
      const timeRemaining = days > 0 ? (days + ' ngày ' + hours + ' giờ') : (totalHours + ' giờ');
      expBadge = '<span class="badge-active" title="Hạn dùng: ' + expExact + '">⏳ Còn ' + timeRemaining + ' (' + expExact + ')</span>';
    }

    const quickBtns = isAdmin ? '' : '<div class="quick-renew-row">' +
      '<button type="button" class="quick-renew-btn" onclick="quickRenewUser(\'' + u.id + '\', 1)" title="Cộng 1 ngày">+1N</button>' +
      '<button type="button" class="quick-renew-btn" onclick="quickRenewUser(\'' + u.id + '\', 3)" title="Cộng 3 ngày">+3N</button>' +
      '<button type="button" class="quick-renew-btn" onclick="quickRenewUser(\'' + u.id + '\', 7)" title="Cộng 7 ngày">+7N</button>' +
      '<button type="button" class="quick-renew-btn" onclick="quickRenewUser(\'' + u.id + '\', 15)" title="Cộng 15 ngày">+15N</button>' +
      '<button type="button" class="quick-renew-btn" onclick="quickRenewUser(\'' + u.id + '\', 30)" title="Cộng 30 ngày">+30N</button>' +
      '<button type="button" class="quick-renew-btn minus" onclick="quickRenewUser(\'' + u.id + '\', -1)" title="Trừ 1 ngày">-1N</button>' +
      '<button type="button" class="quick-renew-btn vip" onclick="quickSetLifetimeUser(\'' + u.id + '\')" title="Đặt VIP Vĩnh viễn">👑 Vĩnh viễn</button>' +
      '<button type="button" class="quick-renew-btn custom" onclick="openCustomRenewModal(\'' + u.id + '\', \'' + escapeHtml(u.username) + '\')" title="Tùy chỉnh ngày">⏱</button>' +
    '</div>';

    const expiryCol = '<div>' + expBadge + quickBtns + '</div>';

    // Cột 4: Trạng thái & Nút Khóa / Mở
    let statusCol = '';
    if (isDis) {
      statusCol = '<div>' +
        '<span style="color:#ef4444;font-weight:750;">🔒 Tạm khóa</span>' +
        (u.lockReason ? '<div style="font-size:10.5px;color:#fca5a5;margin-top:2px;max-width:140px;line-height:1.3;">💬 ' + escapeHtml(u.lockReason) + '</div>' : '') +
        '<div style="margin-top:4px;"><button type="button" class="small" style="background:#059669;border-color:#10b981;color:#fff;padding:2px 8px;font-size:11px;" onclick="unlockUser(\'' + u.id + '\')">🔓 Mở Khóa</button></div>' +
      '</div>';
    } else if (isExp) {
      statusCol = '<div>' +
        '<span style="color:#ef4444;font-weight:750;">⏳ Hết hạn</span>' +
        (!isAdmin ? '<div style="margin-top:4px;"><button type="button" class="small danger" style="padding:2px 8px;font-size:11px;" onclick="promptLockUser(\'' + u.id + '\', \'' + escapeHtml(u.username) + '\')">🔒 Khóa</button></div>' : '') +
      '</div>';
    } else {
      statusCol = '<div>' +
        '<span style="color:#10b981;font-weight:750;">🟢 Hoạt động</span>' +
        (!isAdmin ? '<div style="margin-top:4px;"><button type="button" class="small danger" style="padding:2px 8px;font-size:11px;" onclick="promptLockUser(\'' + u.id + '\', \'' + escapeHtml(u.username) + '\')">🔒 Tạm Khóa</button></div>' : '') +
      '</div>';
    }

    // Cột 5: Bot được cấp (1-Bot-1-User Exclusive)
    const assignedIds = Array.isArray(u.assignedBotIds) ? u.assignedBotIds : [];
    const botBadges = assignedIds.length
      ? assignedIds.map(id => {
          const numId = Number(id);
          const b = userManagementAvailableBots.find(x => Number(x.id) === numId);
          const name = b ? b.label : ('Bot #' + numId);
          return '<span class="badge-tag" style="background:rgba(56,189,248,0.15);color:#38bdf8;padding:2px 6px;border-radius:4px;margin:2px;display:inline-block;font-size:11px;font-weight:700;">🤖 ' + escapeHtml(name) + '</span>';
        }).join('')
      : '<span style="color:var(--muted);font-style:italic;font-size:11.5px;">Chưa gán bot nào</span>';

    // Cột 6: Thao tác
    const actionsCol = '<div style="text-align:right;white-space:nowrap;">' +
      '<button type="button" class="small" onclick="openEditUserModal(\'' + u.id + '\')">✏ Sửa</button> ' +
      (isAdmin ? '' : '<button type="button" class="small danger" onclick="deleteUserPrompt(\'' + u.id + '\', \'' + escapeHtml(u.username) + '\')">🗑 Xóa</button>') +
    '</div>';

    return '<tr>' +
      '<td>' + userCol + '</td>' +
      '<td>' + passCol + '</td>' +
      '<td>' + expiryCol + '</td>' +
      '<td>' + statusCol + '</td>' +
      '<td>' + botBadges + '</td>' +
      '<td>' + actionsCol + '</td>' +
    '</tr>';
  }).join('');

  targets.forEach(tb => { tb.innerHTML = rowsHtml; });
}

// Tạm khóa User kèm lời nhắn gửi đến màn hình của User
function promptLockUser(userId, username) {
  document.getElementById('lockTargetUserId').value = userId;
  document.getElementById('lockTargetUsername').textContent = username;
  document.getElementById('lockReasonInput').value = '';
  document.getElementById('userLockReasonModal')?.classList.remove('hidden');
}
window.promptLockUser = promptLockUser;

function closeUserLockReasonModal() {
  document.getElementById('userLockReasonModal')?.classList.add('hidden');
}
window.closeUserLockReasonModal = closeUserLockReasonModal;

async function submitLockUserWithReason() {
  const userId = document.getElementById('lockTargetUserId')?.value;
  const reason = document.getElementById('lockReasonInput')?.value.trim();
  if (!userId) return;

  try {
    const res = await requestJson('/api/manager/users/' + encodeURIComponent(userId), {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'disabled', lockReason: reason })
    });
    if (!res.ok) throw new Error(res.data?.error || 'Không thể tạm khóa người dùng.');
    showToast('🔒 Đã tạm khóa người dùng thành công.');
    closeUserLockReasonModal();
    await refreshUserManagementPage();
  } catch (err) {
    showToast('Lỗi: ' + err.message);
  }
}
window.submitLockUserWithReason = submitLockUserWithReason;

// Mở khóa người dùng
async function unlockUser(userId) {
  try {
    const res = await requestJson('/api/manager/users/' + encodeURIComponent(userId), {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'active', lockReason: '' })
    });
    if (!res.ok) throw new Error(res.data?.error || 'Không thể mở khóa.');
    showToast('🔓 Đã mở khóa tài khoản thành công!');
    await refreshUserManagementPage();
  } catch (err) {
    showToast('Lỗi mở khóa: ' + err.message);
  }
}
window.unlockUser = unlockUser;

// Gia hạn nhanh (+N / -N ngày)
async function quickRenewUser(userId, days) {
  try {
    const res = await requestJson('/api/manager/users/' + encodeURIComponent(userId) + '/renew-days', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ days: Number(days) })
    });
    if (!res.ok) throw new Error(res.data?.error || 'Gia hạn thất bại.');
    showToast(res.data?.message || 'Đã cập nhật hạn thuê bot!');
    await refreshUserManagementPage();
  } catch (err) {
    showToast('Lỗi: ' + err.message);
  }
}
window.quickRenewUser = quickRenewUser;

// Đặt VIP vĩnh viễn
async function quickSetLifetimeUser(userId) {
  if (!confirm('Đặt tài khoản này thành VIP Vĩnh Viễn?')) return;
  try {
    const res = await requestJson('/api/manager/users/' + encodeURIComponent(userId) + '/renew-days', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ setPermanent: true })
    });
    if (!res.ok) throw new Error(res.data?.error || 'Đặt vĩnh viễn thất bại.');
    showToast(res.data?.message || 'Đã nâng cấp VIP Vĩnh Viễn!');
    await refreshUserManagementPage();
  } catch (err) {
    showToast('Lỗi: ' + err.message);
  }
}
window.quickSetLifetimeUser = quickSetLifetimeUser;

// Modal Tùy chỉnh hạn dùng
function openCustomRenewModal(userId, username) {
  document.getElementById('customRenewTargetUserId').value = userId;
  document.getElementById('customRenewTargetUser').textContent = username;
  document.getElementById('customRenewMode').value = 'add_days';
  handleCustomRenewModeChange();
  const u = userManagementList.find(x => x.id === userId || x.username === username);
  const planInput = document.getElementById('customRenewPlanNameInput');
  if (planInput) {
    planInput.value = u?.planName || '';
  }
  const dateInput = document.getElementById('customRenewDateInput');
  if (dateInput) {
    if (u && u.expiresAt) {
      const d = new Date(u.expiresAt);
      if (!isNaN(d.getTime())) {
        const pad = function(n) { return String(n).padStart(2, '0'); };
        dateInput.value = d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) + 'T' + pad(d.getHours()) + ':' + pad(d.getMinutes());
      } else {
        dateInput.value = '';
      }
    } else {
      dateInput.value = '';
    }
  }
  document.getElementById('customRenewModal')?.classList.remove('hidden');
}
window.openCustomRenewModal = openCustomRenewModal;

function closeCustomRenewModal() {
  document.getElementById('customRenewModal')?.classList.add('hidden');
}
window.closeCustomRenewModal = closeCustomRenewModal;

function handleCustomRenewModeChange() {
  const mode = document.getElementById('customRenewMode')?.value;
  const daysGroup = document.getElementById('customRenewDaysGroup');
  const dateGroup = document.getElementById('customRenewDateGroup');

  if (mode === 'set_date') {
    if (daysGroup) daysGroup.style.display = 'none';
    if (dateGroup) dateGroup.style.display = 'block';
  } else if (mode === 'set_permanent') {
    if (daysGroup) daysGroup.style.display = 'none';
    if (dateGroup) dateGroup.style.display = 'none';
  } else {
    if (daysGroup) daysGroup.style.display = 'block';
    if (dateGroup) dateGroup.style.display = 'none';
  }
}
window.handleCustomRenewModeChange = handleCustomRenewModeChange;

async function submitCustomRenew() {
  const userId = document.getElementById('customRenewTargetUserId')?.value;
  const mode = document.getElementById('customRenewMode')?.value;
  const daysVal = parseInt(document.getElementById('customRenewDaysInput')?.value, 10);
  const dateVal = document.getElementById('customRenewDateInput')?.value;
  const planName = document.getElementById('customRenewPlanNameInput')?.value?.trim();

  if (!userId) return;

  const payload = {};
  if (planName) {
    payload.planName = planName;
  }
  if (mode === 'set_permanent') {
    payload.setPermanent = true;
  } else if (mode === 'set_date') {
    if (!dateVal) { showToast('Vui lòng chọn ngày giờ hết hạn!'); return; }
    const parsedDate = new Date(dateVal);
    if (isNaN(parsedDate.getTime())) { showToast('Ngày giờ không hợp lệ!'); return; }
    payload.fixedDate = parsedDate.toISOString();
  } else if (mode === 'add_days') {
    if (isNaN(daysVal) || daysVal <= 0) { showToast('Số ngày không hợp lệ!'); return; }
    payload.days = daysVal;
  } else if (mode === 'subtract_days') {
    if (isNaN(daysVal) || daysVal <= 0) { showToast('Số ngày không hợp lệ!'); return; }
    payload.days = -daysVal;
  }

  try {
    const res = await requestJson('/api/manager/users/' + encodeURIComponent(userId) + '/renew-days', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    if (!res.ok) throw new Error(res.data?.error || 'Cập nhật hạn thất bại.');
    showToast(res.data?.message || 'Đã cập nhật hạn thuê bot!');
    closeCustomRenewModal();
    await refreshUserManagementPage();
  } catch (err) {
    showToast('Lỗi: ' + err.message);
  }
}
window.submitCustomRenew = submitCustomRenew;

// Quản lý Modal Tạo/Sửa User & Checkbox Bot Độc Quyền (1-Bot-1-User)
function openCreateUserModal() {
  currentEditingUserId = null;
  document.getElementById('userEditModalTitle').textContent = 'Thêm Người Dùng Mới';
  document.getElementById('userFormId').value = '';
  document.getElementById('userFormUsername').value = '';
  document.getElementById('userFormPassword').value = '';
  document.getElementById('userFormPassword').placeholder = 'Tối thiểu 5 ký tự (chữ hoặc số, phân biệt hoa thường)...';
  document.getElementById('userFormStatus').value = 'active';
  if (document.getElementById('userFormPlanName')) document.getElementById('userFormPlanName').value = 'Gói thường';
  if (document.getElementById('userFormExpiresAt')) document.getElementById('userFormExpiresAt').value = '';
  if (document.getElementById('userFormNote')) document.getElementById('userFormNote').value = '';
  if (document.getElementById('userFormAllowAccountChange')) document.getElementById('userFormAllowAccountChange').checked = true;
  renderUserFormBotsCheckboxes([], null);
  document.getElementById('userEditModal')?.classList.remove('hidden');
}
window.openCreateUserModal = openCreateUserModal;

function openEditUserModal(userId) {
  const u = userManagementList.find(x => x.id === userId);
  if (!u) return;
  currentEditingUserId = u.id;
  document.getElementById('userEditModalTitle').textContent = 'Sửa Người Dùng: ' + u.username;
  document.getElementById('userFormId').value = u.id;
  document.getElementById('userFormUsername').value = u.username;
  document.getElementById('userFormPassword').value = '';
  document.getElementById('userFormPassword').placeholder = 'Để trống nếu không đổi mật khẩu';
  document.getElementById('userFormStatus').value = u.status || 'active';
  if (document.getElementById('userFormPlanName')) document.getElementById('userFormPlanName').value = u.planName || 'Gói thường';
  if (document.getElementById('userFormExpiresAt')) {
    if (u.expiresAt) {
      const d = new Date(u.expiresAt);
      if (!isNaN(d.getTime())) {
        const pad = n => String(n).padStart(2, '0');
        document.getElementById('userFormExpiresAt').value = d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) + 'T' + pad(d.getHours()) + ':' + pad(d.getMinutes());
      } else {
        document.getElementById('userFormExpiresAt').value = '';
      }
    } else {
      document.getElementById('userFormExpiresAt').value = '';
    }
  }
  if (document.getElementById('userFormNote')) document.getElementById('userFormNote').value = u.note || '';
  if (document.getElementById('userFormAllowAccountChange')) {
    document.getElementById('userFormAllowAccountChange').checked = u.allowAccountChange !== false;
  }
  renderUserFormBotsCheckboxes(u.assignedBotIds || [], u.id);
  document.getElementById('userEditModal')?.classList.remove('hidden');
}
window.openEditUserModal = openEditUserModal;

function closeUserEditModal() {
  currentEditingUserId = null;
  document.getElementById('userEditModal')?.classList.add('hidden');
}
window.closeUserEditModal = closeUserEditModal;

// Render checkbox phân quyền bot theo nguyên tắc 1-Bot-1-User độc quyền
function renderUserFormBotsCheckboxes(selectedIds, targetUserId) {
  const grid = document.getElementById('userFormBotsGrid');
  if (!grid) return;
  if (!userManagementAvailableBots.length) {
    grid.innerHTML = '<div style="color:var(--muted);padding:10px;grid-column:1/-1;">Chưa có bot nào trong Manager. Hãy thêm bot trước.</div>';
    return;
  }
  const set = new Set((selectedIds || []).map(Number));

  grid.innerHTML = userManagementAvailableBots.map(b => {
    const botId = Number(b.id);
    const isChecked = set.has(botId);
    const owner = userManagementBotOwnership[botId] || b.currentOwner;
    const isOccupiedByOther = owner && owner.userId && (!targetUserId || owner.userId !== targetUserId);

    const displayName = b.label || ('Bot #' + botId);
    const nonRentableBadge = b.rentable === false ? '<span style="font-size:10px;color:#f87171;margin-left:4px;font-weight:600;">[Không cho thuê]</span>' : '';
    if (isOccupiedByOther) {
      return '<label class="bot-check-item bot-occupied" style="position:relative;">' +
        '<input type="checkbox" class="user-bot-chk" value="' + botId + '" ' + (isChecked ? 'checked' : '') + ' data-occupied="1" data-bot-id="' + botId + '" data-bot-label="' + escapeHtml(displayName) + '" data-owner="' + escapeHtml(owner.username) + '" onclick="handleOccupiedBotClick(event)">' +
        '<div>' +
          '<span><strong style="color:#38bdf8;font-size:13px;">[' + escapeHtml(displayName) + ']</strong>' + nonRentableBadge + '</span>' +
          '<span class="badge-occupied">👤 Đang cấp cho: ' + escapeHtml(owner.username) + '</span>' +
        '</div>' +
      '</label>';
    }

    return '<label class="bot-check-item">' +
      '<input type="checkbox" class="user-bot-chk" value="' + botId + '" ' + (isChecked ? 'checked' : '') + '>' +
      '<span><strong style="color:#38bdf8;font-size:13px;">[' + escapeHtml(displayName) + ']</strong>' + nonRentableBadge + '</span>' +
    '</label>';
  }).join('');
}
window.renderUserFormBotsCheckboxes = renderUserFormBotsCheckboxes;

// Bắt sự kiện click bot đã có người dùng khác sở hữu
function handleOccupiedBotClick(event, directBotId, directBotLabel, directOldOwner) {
  const chk = event.target;
  const botId = directBotId !== undefined ? directBotId : Number(chk.dataset.botId || chk.value);
  const botLabel = directBotLabel !== undefined ? directBotLabel : (chk.dataset.botLabel || ('Bot #' + botId));
  const oldOwnerName = directOldOwner !== undefined ? directOldOwner : (chk.dataset.owner || '');
  if (chk.checked) {
    // Tạm bỏ check trước khi xác nhận
    chk.checked = false;
    event.preventDefault();

    const msgEl = document.getElementById('reassignBotConfirmMsg');
    if (msgEl) {
      msgEl.innerHTML = '⚠️ Bot <strong>#' + botId + ' (' + escapeHtml(botLabel) + ')</strong> hiện đang thuộc về người dùng <strong>' + escapeHtml(oldOwnerName) + '</strong>.<br/><br/>Bạn có chắc chắn muốn hủy bot khỏi <strong>' + escapeHtml(oldOwnerName) + '</strong> để cấp quyền cho người dùng này không?';
    }
    pendingBotReassignCallback = () => {
      chk.checked = true;
      chk.closest('.bot-check-item')?.classList.remove('bot-occupied');
    };
    document.getElementById('reassignBotConfirmModal')?.classList.remove('hidden');
  }
}
window.handleOccupiedBotClick = handleOccupiedBotClick;

function closeReassignBotConfirmModal(confirmed) {
  if (confirmed && typeof pendingBotReassignCallback === 'function') {
    pendingBotReassignCallback();
  }
  pendingBotReassignCallback = null;
  document.getElementById('reassignBotConfirmModal')?.classList.add('hidden');
}
window.closeReassignBotConfirmModal = closeReassignBotConfirmModal;

function toggleSelectAllUserBots(select) {
  document.querySelectorAll('.user-bot-chk').forEach(el => {
    if (select) {
      // Nếu là bot đang bận, bỏ qua không auto chọn hết để tránh cướp bot vô tình
      if (!el.closest('.bot-occupied')) el.checked = true;
    } else {
      el.checked = false;
    }
  });
}
window.toggleSelectAllUserBots = toggleSelectAllUserBots;

function generateRandomUserPassword() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$';
  let pass = '';
  for (let i = 0; i < 10; i++) pass += chars.charAt(Math.floor(Math.random() * chars.length));
  document.getElementById('userFormPassword').value = pass;
}
window.generateRandomUserPassword = generateRandomUserPassword;

async function saveUserForm() {
  const id = document.getElementById('userFormId').value.trim();
  const username = document.getElementById('userFormUsername').value.trim();
  const password = document.getElementById('userFormPassword').value.trim();
  const status = document.getElementById('userFormStatus').value;
  const chks = document.querySelectorAll('.user-bot-chk:checked');
  const assignedBotIds = Array.from(chks).map(el => Number(el.value));

  if (!username) { showToast('Vui lòng nhập tên đăng nhập.'); return; }
  const isUpdate = !!id;
  if (!isUpdate && !password) { showToast('Vui lòng nhập mật khẩu.'); return; }

  const btn = document.getElementById('userFormSubmitBtn');
  if (btn) btn.disabled = true;

  try {
    const url = isUpdate ? ('/api/manager/users/' + encodeURIComponent(id)) : '/api/manager/users';
    const method = isUpdate ? 'PUT' : 'POST';
    const planName = document.getElementById('userFormPlanName')?.value.trim() || 'Gói thường';
    const expiresAt = document.getElementById('userFormExpiresAt')?.value ? new Date(document.getElementById('userFormExpiresAt').value).toISOString() : null;
    const note = document.getElementById('userFormNote')?.value.trim() || '';
    const allowAccountChange = !!document.getElementById('userFormAllowAccountChange')?.checked;

    const payload = { username, status, planName, expiresAt, note, allowAccountChange, assignedBotIds };
    if (password) payload.password = password;

    const res = await requestJson(url, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    if (!res.ok) throw new Error(res.data?.error || 'Lỗi khi lưu user.');
    showToast((res.data?.partial ? '⚠️ ' : '') + (res.data?.warning || res.data?.message || 'Đã lưu người dùng thành công.'));
    closeUserEditModal();
    lastHomeSig = '';
    await Promise.allSettled([refreshUserManagementPage(), refreshHome()]);
  } catch (err) {
    showToast('Lỗi: ' + err.message);
  } finally {
    if (btn) btn.disabled = false;
  }
}
window.saveUserForm = saveUserForm;

async function deleteUserPrompt(userId, username) {
  if (!confirm('Bạn có chắc chắn muốn xóa người dùng "' + username + '"? Người dùng này sẽ mất quyền truy cập ngay lập tức.')) return;
  try {
    const res = await requestJson('/api/manager/users/' + encodeURIComponent(userId), { method: 'DELETE' });
    if (!res.ok) throw new Error(res.data?.error || 'Không thể xóa user.');
    showToast(res.data?.message || 'Đã xóa người dùng.');
    lastHomeSig = '';
    await Promise.allSettled([refreshUserManagementPage(), refreshHome()]);
  } catch (err) {
    showToast('Lỗi xóa user: ' + err.message);
  }
}
window.deleteUserPrompt = deleteUserPrompt;

function onKeyDaysSelectChange(source) {
  if (source === 'mgmt') {
    const sel = document.getElementById('mgmtKeyDays');
    const customInp = document.getElementById('mgmtKeyCustomDays');
    if (sel && customInp) {
      customInp.style.display = sel.value === 'custom' ? 'inline-block' : 'none';
      if (sel.value === 'custom') customInp.focus();
    }
  } else if (source === 'modal') {
    const sel = document.getElementById('createKeyDays');
    const customInp = document.getElementById('createKeyCustomDays');
    if (sel && customInp) {
      customInp.style.display = sel.value === 'custom' ? 'inline-block' : 'none';
      if (sel.value === 'custom') customInp.focus();
    }
  }
}
window.onKeyDaysSelectChange = onKeyDaysSelectChange;

// Phát hành mã Key từ Sub-panel Quản lý Key
async function submitCreateKeysFromMgmt() {
  const daysVal = document.getElementById('mgmtKeyDays')?.value;
  const customInp = document.getElementById('mgmtKeyCustomDays');
  const planName = document.getElementById('mgmtKeyPlan')?.value.trim();
  const count = parseInt(document.getElementById('mgmtKeyCount')?.value, 10) || 1;
  const botCount = parseInt(document.getElementById('mgmtKeyBotCount')?.value, 10) || 1;

  const isPermanent = daysVal === 'lifetime';
  let days = 7;
  if (isPermanent) {
    days = -1;
  } else if (daysVal === 'custom') {
    const customVal = parseInt(customInp?.value, 10);
    if (!Number.isFinite(customVal) || customVal < 1) {
      showToast('Vui lòng nhập số ngày hợp lệ (tối thiểu 1 ngày).', 'error');
      if (customInp) customInp.focus();
      return;
    }
    days = Math.min(customVal, 3650);
  } else {
    days = parseInt(daysVal, 10) || 7;
  }

  const customKey = document.getElementById('mgmtKeyCustomKey')?.value.trim();
  const maxUsesVal = document.getElementById('mgmtKeyMaxUses')?.value;
  const validDaysVal = document.getElementById('mgmtKeyValidDays')?.value;
  const maxUses = maxUsesVal !== '' ? parseInt(maxUsesVal, 10) : 1;
  const validDays = parseInt(validDaysVal, 10) || 0;

  try {
    const res = await requestJson('/api/manager/keys', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        days,
        isPermanent,
        setPermanent: isPermanent,
        planName: planName || (isPermanent ? 'VIP Vĩnh Viễn' : ('Gói ' + days + ' Ngày')),
        count,
        botCount,
        customKey: customKey || undefined,
        maxUses: isNaN(maxUses) ? 1 : maxUses,
        validDays: validDays > 0 ? validDays : undefined
      })
    });
    if (!res.ok) throw new Error(res.data?.error || 'Không thể tạo mã Key.');
    showToast('🎉 ' + (res.data?.message || 'Đã tạo ' + count + ' mã Key thành công!'));
    if (document.getElementById('mgmtKeyCustomKey')) document.getElementById('mgmtKeyCustomKey').value = '';
    await refreshKeysTable();
  } catch (err) {
    showToast('Lỗi: ' + err.message);
  }
}
window.submitCreateKeysFromMgmt = submitCreateKeysFromMgmt;

async function quickBotAction(event, id, action) {
  event.stopPropagation();
  var targetBot = bots.find(function(b) { return Number(b.id) === Number(id); });
  if (action === 'start' && (!targetBot?.username || targetBot.username === 'Chưa đặt')) {
    showToast('⚠️ Bot chưa cài đặt tài khoản Minecraft! Đang mở bảng Chi tiết để cài đặt...', 'warning', 4000);
    openBot(id);
    return;
  }
  if (targetBot) {
    if (action === 'start') {
      targetBot.status = 'waking';
      targetBot.manuallyStopped = false;
      targetBot.available = true;
    } else if (action === 'stop') {
      targetBot.status = 'offline';
      targetBot.manuallyStopped = true;
    }
    renderHome();
  }
  showToast('Đang gửi lệnh ' + action + ' tới Bot ' + id + '...');
  try {
    const res = await requestJson('/api/manager/bot/' + id + '/' + action, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({})
    });
    if (res.ok) {
      showToast('Đã thực hiện ' + action + ' Bot ' + id + ' thành công!', 'success');
      lastHomeSig = '';
      void refreshHome();
      setTimeout(() => { lastHomeSig = ''; void refreshHome(); }, 800);
      setTimeout(() => { lastHomeSig = ''; void refreshHome(); }, 2000);
    } else {
      var errText = res.data?.error || ('Lỗi khi ' + action + ' bot.');
      if (errText.indexOf('username') !== -1 || errText.indexOf('password') !== -1 || errText.indexOf('chưa có') !== -1) {
        showToast('⚠️ ' + errText + ' Đang mở Chi tiết để cài đặt...', 'warning', 4000);
        openBot(id);
      } else {
        showToast(errText, 'error');
        lastHomeSig = '';
        void refreshHome();
      }
    }
  } catch (err) {
    showToast(err.message || 'Lỗi kết nối.', 'error');
    lastHomeSig = '';
    void refreshHome();
  }
}
window.quickBotAction = quickBotAction;

let activeStatusFilter = 'all';
function setStatusFilter(filter) {
  activeStatusFilter = filter;
  ['all','afk','online','offline','unreachable'].forEach(k => {
    const el = document.getElementById('tab' + k.charAt(0).toUpperCase() + k.slice(1));
    if (el) el.classList.toggle('active', k === filter);
  });
  filterBots();
}
window.setStatusFilter = setStatusFilter;

function resetBotFilters() {
  const searchInput = document.getElementById('searchInput');
  if (searchInput) searchInput.value = '';
  activeTagFilter = null;
  setStatusFilter('all');
  if (typeof renderTagFilterChips === 'function') renderTagFilterChips();
}
window.resetBotFilters = resetBotFilters;

let soundAlertEnabled = localStorage.getItem('kingmc_mgr_sound') === '1';
let previousOfflineSet = new Set();

let _sharedAudioCtx = null;
function getSharedAudioContext() {
  if (!_sharedAudioCtx) {
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (AudioCtx) _sharedAudioCtx = new AudioCtx();
  }
  if (_sharedAudioCtx && _sharedAudioCtx.state === 'suspended') {
    _sharedAudioCtx.resume().catch(() => {});
  }
  return _sharedAudioCtx;
}

function playAlertTone(type = 'warn') {
  if (!soundAlertEnabled) return;
  try {
    const ctx = getSharedAudioContext();
    if (!ctx) return;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.type = type === 'danger' ? 'sawtooth' : 'sine';
    const now = ctx.currentTime;
    if (type === 'danger') {
      osc.frequency.setValueAtTime(220, now);
      osc.frequency.exponentialRampToValueAtTime(110, now + 0.35);
    } else {
      osc.frequency.setValueAtTime(587.33, now);
      osc.frequency.exponentialRampToValueAtTime(880, now + 0.3);
    }
    gain.gain.setValueAtTime(0.12, now);
    gain.gain.exponentialRampToValueAtTime(0.01, now + 0.35);
    osc.start(now);
    osc.stop(now + 0.35);
  } catch (_) {}
}

function toggleSoundAlert() {
  soundAlertEnabled = !soundAlertEnabled;
  localStorage.setItem('kingmc_mgr_sound', soundAlertEnabled ? '1' : '0');
  updateSoundAlertButton();
  if (soundAlertEnabled) playAlertTone('info');
}

function updateSoundAlertButton() {
  const btn = document.getElementById('soundAlertBtn');
  if (!btn) return;
  if (soundAlertEnabled) {
    btn.className = 'small sound-btn active';
    btn.innerHTML = '🔔 Cảnh báo: BẬT';
  } else {
    btn.className = 'small sound-btn';
    btn.innerHTML = '🔕 Cảnh báo: TẮT';
  }
}
window.toggleSoundAlert = toggleSoundAlert;

function exportBotList() {
  const exportData = bots.map(b => ({
    id: b.id,
    label: b.label,
    url: b.url
  }));
  const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'kingmc_bots_backup.json';
  a.click();
  showToast('Đã xuất danh sách bot ra file JSON!');
}
window.exportBotList = exportBotList;

function triggerImport() {
  const input = document.getElementById('importFileInput');
  if (input) input.click();
}
window.triggerImport = triggerImport;

async function handleImportFile(event) {
  const file = event.target?.files?.[0];
  if (!file) return;
  event.target.value = '';
  try {
    const text = await file.text();
    const data = JSON.parse(text);
    if (!Array.isArray(data)) throw new Error('File JSON không đúng định dạng danh sách bot.');
    showToast('Đang khôi phục ' + data.length + ' bot từ file...');
    const botsToImport = data.map(item => ({
      url: normalizeClientBotUrl(item.url || item.endpoint || item.sourceUrl),
      label: String(item.label || item.name || '').trim(),
      secretKey: item.secretKey ? String(item.secretKey).trim() : undefined
    })).filter(b => Boolean(b.url));

    if (!botsToImport.length) {
      showToast('Không tìm thấy URL bot hợp lệ nào trong file JSON.');
      return;
    }

    const res = await requestJson('/api/manager/bots/batch-import', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ bots: botsToImport })
    });
    if (res.ok) {
      const payload = res.data || {};
      const added = payload.addedCount || (payload.bots || []).length || 0;
      const skipped = payload.skippedCount || (payload.skipped || []).length || 0;
      showToast('Đã khôi phục thành công ' + added + ' bot mới!' + (skipped ? ' (Bỏ qua ' + skipped + ')' : ''));
      lastHomeSig = '';
      await refreshHome();
    } else {
      showToast('Lỗi nhập bot: ' + (res.data?.error || 'Thao tác không thành công.'));
    }
  } catch (err) {
    showToast('Lỗi đọc file: ' + (err.message || 'Không thể khôi phục.'));
  }
}
window.handleImportFile = handleImportFile;

async function reconnectOfflineBots() {
  const offlineList = bots.filter(b => (!b.available || b.status === 'offline' || b.status === 'kicked') && !b.manuallyStopped);
  if (!offlineList.length) {
    showToast('Tất cả bot đều đang hoạt động tốt!');
    return;
  }
  if (!confirm('Kết nối lại ' + offlineList.length + ' bot đang Offline / Lỗi?')) return;
  showToast('Đang kết nối lại ' + offlineList.length + ' bot...');
  let success = 0;
  for (const b of offlineList) {
    try {
      const res = await requestJson('/api/manager/bot/' + encodeURIComponent(String(b.id)) + '/start', {
        method: 'POST',
        timeoutMs: 15000
      });
      if (res.ok) success++;
    } catch (_) {}
  }
  showToast('Đã kích hoạt kết nối lại ' + success + '/' + offlineList.length + ' bot!');
  await refreshHome();
}
window.reconnectOfflineBots = reconnectOfflineBots;

let currentSortMode = 'default';
function changeBotSort(mode) {
  currentSortMode = mode || 'default';
  filterBots();
}
window.changeBotSort = changeBotSort;

function updateKpis() {
  const total = bots.length;
  const afk = bots.filter(b => b.available && b.status === 'afk').length;
  const online = bots.filter(b => b.available && ['online','connecting','authenticating','entering'].includes(b.status)).length;
  const offline = bots.filter(b => !b.available || b.status === 'offline' || b.status === 'kicked').length;
  const unreachable = bots.filter(b => !b.available).length;

  const tEl = document.getElementById('kpiTotal'); if(tEl) tEl.textContent = String(total);
  const aEl = document.getElementById('kpiAfk'); if(aEl) aEl.textContent = String(afk);
  const oEl = document.getElementById('kpiOnline'); if(oEl) oEl.textContent = String(online);
  const fEl = document.getElementById('kpiOffline'); if(fEl) fEl.textContent = String(offline);
  const uEl = document.getElementById('kpiUnreachable'); if(uEl) uEl.textContent = String(unreachable);

  // Cập nhật Chỉ số Sức khỏe Hạm đội (Fleet Health Score)
  const healthPercent = total > 0 ? Math.round(((afk * 1.0 + online * 0.7) / total) * 100) : 100;
  const hEl = document.getElementById('kpiFleetHealth');
  const hSubEl = document.getElementById('kpiFleetHealthSub');
  if (hEl) {
    hEl.textContent = healthPercent + '%';
    hEl.style.color = healthPercent >= 90 ? 'var(--green)' : (healthPercent >= 60 ? 'var(--yellow)' : 'var(--red)');
  }
  if (hSubEl) {
    hSubEl.textContent = healthPercent >= 90 ? 'Hệ thống tối ưu' : (healthPercent >= 60 ? 'Cần chú ý kết nối' : 'Cảnh báo gián đoạn!');
  }
  updateTagPills();

  // Cập nhật Fleet Resource Bar (Eco & RAM Fleet & Host Hardware Aggregation)
  const ecoCount = bots.filter(b => b.available && b.settings?.ecoMode !== false && b.ecoMode !== false).length;
  const activeBots = bots.filter(b => b.available && b.status !== 'offline' && b.status !== 'kicked');
  const totalFleetRam = bots.reduce((sum, b) => sum + Number(b.hostHardware?.botRssMb || b.ramRss || b.rssMb || b.memory?.rssMb || 0), 0);
  const avgFleetRam = activeBots.length > 0 ? Math.round(totalFleetRam / activeBots.length) : 0;

  // Tính tổng RAM đã dùng / Tổng RAM được cấp, Trung bình % CPU và Tổng băng thông toàn hạm đội
  const botsWithHw = activeBots.filter(b => b.hostHardware && Number(b.hostHardware.ramTotalMb) > 0);
  let fleetRamUsedMb = 0;
  let fleetRamTotalMb = 0;
  let fleetCpuSum = 0;
  let fleetRxKbps = 0;
  let fleetTxKbps = 0;

  for (const b of botsWithHw) {
    fleetRamUsedMb += Number(b.hostHardware.ramUsedMb || b.hostHardware.botRssMb || 0);
    fleetRamTotalMb += Number(b.hostHardware.ramTotalMb || 0);
    fleetCpuSum += Number(b.hostHardware.cpuPercent || 0);
    fleetRxKbps += Number(b.hostHardware.netDownKb || 0);
    fleetTxKbps += Number(b.hostHardware.netUpKb || 0);
  }

  const fleetRamPercent = fleetRamTotalMb > 0 ? Math.round((fleetRamUsedMb / fleetRamTotalMb) * 1000) / 10 : 0;
  const avgFleetCpu = botsWithHw.length > 0 ? Math.round((fleetCpuSum / botsWithHw.length) * 10) / 10 : 0;

  const ecoCountEl = document.getElementById('fleetEcoCount'); if(ecoCountEl) ecoCountEl.textContent = String(ecoCount);
  const ecoTotalEl = document.getElementById('fleetEcoTotal'); if(ecoTotalEl) ecoTotalEl.textContent = String(total);
  const totalRamEl = document.getElementById('fleetTotalRam');
  if (totalRamEl) {
    if (fleetRamTotalMb > 0) {
      totalRamEl.textContent = fleetRamUsedMb + ' / ' + fleetRamTotalMb + ' MB (' + fleetRamPercent + '%)';
    } else {
      totalRamEl.textContent = totalFleetRam + ' MB RSS';
    }
  }
  const avgRamEl = document.getElementById('fleetAvgRam'); if(avgRamEl) avgRamEl.textContent = avgFleetRam + ' MB RSS';
  const cpuSavedEl = document.getElementById('fleetCpuSaved');
  if (cpuSavedEl) {
    if (botsWithHw.length > 0) {
      cpuSavedEl.textContent = avgFleetCpu + '% TB' + (fleetRxKbps > 0 || fleetTxKbps > 0 ? ' • ↓' + Math.round(fleetRxKbps) + ' ↑' + Math.round(fleetTxKbps) + 'KB/s' : '');
    } else {
      cpuSavedEl.textContent = ecoCount > 0 ? '~80%' : '0%';
    }
  }

  // Cập nhật số đếm trên các Tab Bộ lọc
  const cAll = document.getElementById('countAll'); if(cAll) cAll.textContent = String(total);
  const cAfk = document.getElementById('countAfk'); if(cAfk) cAfk.textContent = String(afk);
  const cOn = document.getElementById('countOnline'); if(cOn) cOn.textContent = String(online);
  const cOff = document.getElementById('countOffline'); if(cOff) cOff.textContent = String(offline);
  const cUn = document.getElementById('countUnreachable'); if(cUn) cUn.textContent = String(unreachable);

  // Âm thanh cảnh báo nếu có bot vừa mất kết nối
  const currentOfflineIds = new Set(bots.filter(b => (!b.available || b.status === 'offline' || b.status === 'kicked') && !b.manuallyStopped).map(b => b.id));
  if (previousOfflineSet.size > 0) {
    for (const id of currentOfflineIds) {
      if (!previousOfflineSet.has(id)) {
        playAlertTone('danger');
        break;
      }
    }
  }
  previousOfflineSet = currentOfflineIds;
}

let activeTagFilter = '';
function filterByTag(tag) {
  const normalized = String(tag || '').trim().toLowerCase();
  // Nếu bấm lại vào tag đang chọn -> tự động bỏ lọc (quay về Tất cả)
  if (activeTagFilter === normalized) {
    activeTagFilter = '';
  } else {
    activeTagFilter = normalized;
  }
  updateTagPills();
  filterBots();
}
window.filterByTag = filterByTag;

function updateTagPills() {
  const container = document.getElementById('tagPillsContainer');
  if (!container) return;

  const totalCount = (bots || []).length;
  // Đếm 3 nhóm trạng thái thuê:
  // 1. Cho thuê (Sẵn sàng / Trống): rentable !== false && không có người thuê
  const countRentable = (bots || []).filter(b => b.rentable !== false && !b.assignedUsername).length;
  // 2. Đang được thuê: có người thuê
  const countRented = (bots || []).filter(b => Boolean(b.assignedUsername)).length;
  // 3. Không cho thuê: rentable === false
  const countNotRentable = (bots || []).filter(b => b.rentable === false).length;

  // Thu thập danh sách tag riêng tự tạo từ b.tags
  const tagMap = new Map();
  (bots || []).forEach(b => {
    if (Array.isArray(b.tags)) {
      b.tags.forEach(t => {
        const clean = String(t || '').trim().replace(/^#/, '');
        if (!clean) return;
        const lower = clean.toLowerCase();
        if (!tagMap.has(lower)) {
          tagMap.set(lower, { display: clean, count: 0 });
        }
        tagMap.get(lower).count++;
      });
    }
  });

  let html = '';

  // 1. Nút Tất cả
  const isAllAct = !activeTagFilter;
  html += '<button type="button" class="tab-btn ' + (isAllAct ? 'active' : '') + '" onclick="filterByTag(\'\')" style="padding:3px 10px;font-size:11px;border-radius:6px;display:inline-flex;align-items:center;gap:4px;" title="Xem toàn bộ bot">';
  html += '<span>🌐 Tất cả</span> <span style="opacity:0.75;font-size:10px;">(' + totalCount + ')</span>';
  html += '</button>';

  // 2. Nhóm trạng thái thuê:
  // Cho thuê
  const isRentableAct = activeTagFilter === 'sys:rentable' || activeTagFilter === 'rentable' || activeTagFilter === 'cho-thue';
  html += '<button type="button" class="tab-btn ' + (isRentableAct ? 'active' : '') + '" onclick="filterByTag(\'sys:rentable\')" style="padding:3px 10px;font-size:11px;border-radius:6px;display:inline-flex;align-items:center;gap:4px;' + (isRentableAct ? 'border-color:#38bdf8;' : '') + '" title="Lọc bot sẵn sàng cho thuê (chưa ai thuê)">';
  html += '<span>✨ Cho thuê</span> <span style="opacity:0.85;font-size:10px;color:' + (isRentableAct ? '#7dd3fc' : 'var(--green)') + ';">(' + countRentable + ')</span>';
  html += '</button>';

  // Đang được thuê
  const isRentedAct = activeTagFilter === 'sys:rented' || activeTagFilter === 'rented' || activeTagFilter === 'dang-thue';
  html += '<button type="button" class="tab-btn ' + (isRentedAct ? 'active' : '') + '" onclick="filterByTag(\'sys:rented\')" style="padding:3px 10px;font-size:11px;border-radius:6px;display:inline-flex;align-items:center;gap:4px;' + (isRentedAct ? 'border-color:#a855f7;' : '') + '" title="Lọc bot hiện đang được khách thuê">';
  html += '<span>👤 Đang thuê</span> <span style="opacity:0.85;font-size:10px;color:' + (isRentedAct ? '#d8b4fe' : '#c084fc') + ';">(' + countRented + ')</span>';
  html += '</button>';

  // Không cho thuê
  const isNotRentableAct = activeTagFilter === 'sys:not-rentable' || activeTagFilter === 'not-rentable' || activeTagFilter === 'khong-cho-thue';
  html += '<button type="button" class="tab-btn ' + (isNotRentableAct ? 'active' : '') + '" onclick="filterByTag(\'sys:not-rentable\')" style="padding:3px 10px;font-size:11px;border-radius:6px;display:inline-flex;align-items:center;gap:4px;' + (isNotRentableAct ? 'border-color:#f59e0b;' : '') + '" title="Lọc bot không cho thuê (dùng riêng / nội bộ)">';
  html += '<span>🚫 Không cho thuê</span> <span style="opacity:0.85;font-size:10px;color:' + (isNotRentableAct ? '#fde047' : 'var(--muted)') + ';">(' + countNotRentable + ')</span>';
  html += '</button>';

  // Vạch phân cách nếu có tag riêng tự tạo
  if (tagMap.size > 0) {
    html += '<span style="color:var(--border);margin:0 2px;user-select:none;font-size:13px;align-self:center;">|</span>';
  }

  // 3. Danh sách tag riêng tự tạo
  const sortedTags = Array.from(tagMap.values()).sort((a, b) => a.display.localeCompare(b.display));
  sortedTags.forEach(t => {
    const isAct = activeTagFilter === t.display.toLowerCase();
    html += '<button type="button" class="tab-btn ' + (isAct ? 'active' : '') + '" onclick="filterByTag(\'' + escapeHtml(t.display) + '\')" style="padding:3px 9px;font-size:11px;border-radius:6px;display:inline-flex;align-items:center;gap:4px;' + (isAct ? 'border-color:#ec4899;' : '') + '" title="Lọc theo tag #' + escapeHtml(t.display) + '">';
    html += '<span>#' + escapeHtml(t.display) + '</span> <span style="opacity:0.75;font-size:10px;">(' + t.count + ')</span>';
    html += '</button>';
  });

  container.innerHTML = html;
}
window.updateTagPills = updateTagPills;

function editBotTags(id) {
  editBot(null, id);
  setTimeout(() => {
    const input = document.getElementById('editBotTags');
    if (input) {
      input.focus();
      input.select();
    }
  }, 100);
}
window.editBotTags = editBotTags;

function filterBots() {
  const query = String(document.getElementById('searchInput')?.value || '').toLowerCase().trim();
  const grid = document.getElementById('botGrid');
  if(!grid) return;
  const isAdmin = Boolean(currentUser && currentUser.role === 'admin');
  const filtered = bots.filter(b => {
    // 1. Lọc theo Tab trạng thái
    if (activeStatusFilter === 'afk' && b.status !== 'afk') return false;
    if (activeStatusFilter === 'online' && !['online','connecting','authenticating','entering'].includes(b.status)) return false;
    if (activeStatusFilter === 'offline' && b.available && b.status !== 'offline' && b.status !== 'kicked') return false;
    if (activeStatusFilter === 'unreachable' && b.available) return false;

    // 2. Lọc theo Tag phân loại & Trạng thái thuê
    if (activeTagFilter) {
      if (activeTagFilter === 'sys:rentable' || activeTagFilter === 'rentable' || activeTagFilter === 'cho-thue') {
        if (b.rentable === false || b.assignedUsername) return false;
      } else if (activeTagFilter === 'sys:rented' || activeTagFilter === 'rented' || activeTagFilter === 'dang-thue') {
        if (!b.assignedUsername) return false;
      } else if (activeTagFilter === 'sys:not-rentable' || activeTagFilter === 'not-rentable' || activeTagFilter === 'khong-cho-thue') {
        if (b.rentable !== false) return false;
      } else {
        const bTags = Array.isArray(b.tags) ? b.tags.map(t => String(t).toLowerCase().replace(/^#/, '')) : [];
        if (!bTags.includes(activeTagFilter)) return false;
      }
    }

    // 3. Lọc theo Từ khóa tìm kiếm
    if(!query) return true;
    return (b.label && b.label.toLowerCase().includes(query)) ||
      (b.username && b.username.toLowerCase().includes(query)) ||
      (isAdmin && b.ipAddress && b.ipAddress.toLowerCase().includes(query)) ||
      (b.status && b.status.toLowerCase().includes(query));
  });

  // Tự động hồi phục tab Tất cả cho khách thuê nếu tab hiện tại không khớp bot nào nhưng hạm đội có bot
  if (currentUser && currentUser.role === 'user' && bots.length > 0 && filtered.length === 0 && !query && !activeTagFilter && activeStatusFilter !== 'all') {
    setStatusFilter('all');
    return;
  }

  // 3. Sắp xếp theo chế độ được chọn
  if (currentSortMode === 'status') {
    const order = { afk: 1, entering: 2, authenticating: 3, connecting: 4, online: 5, offline: 6, kicked: 7 };
    filtered.sort((a, b) => (order[a.status] || 99) - (order[b.status] || 99));
  } else if (currentSortMode === 'uptime') {
    filtered.sort((a, b) => (b.uptimeSeconds || 0) - (a.uptimeSeconds || 0));
  } else if (currentSortMode === 'totem') {
    filtered.sort((a, b) => (b.totemCount || 0) - (a.totemCount || 0));
  } else if (currentSortMode === 'name') {
    filtered.sort((a, b) => String(a.label || '').localeCompare(String(b.label || '')));
  }

  if(!filtered.length){
    const emptyHtml = '<div class="panel empty-filter-state" style="grid-column:1/-1;text-align:center;padding:42px 20px;background:rgba(15,23,42,0.65);border:1px dashed rgba(255,255,255,0.12);border-radius:16px;">' +
      '<div style="font-size:36px;margin-bottom:10px;opacity:0.85;">🔍</div>' +
      '<div style="font-size:15px;font-weight:750;color:var(--text);margin-bottom:6px;">Không tìm thấy bot nào</div>' +
      '<div style="font-size:13px;color:var(--muted);max-width:380px;margin:0 auto 16px auto;line-height:1.5;">Không có bot nào khớp với tiêu chí tìm kiếm hoặc bộ lọc hiện tại.</div>' +
      '<button type="button" class="btn btn-secondary" onclick="resetBotFilters()" style="padding:7px 16px;font-size:12px;font-weight:700;border-radius:8px;background:rgba(56,189,248,0.12);border:1px solid rgba(56,189,248,0.3);color:#38bdf8;cursor:pointer;">' +
      '🔄 Xóa bộ lọc &amp; Hiện tất cả' +
      '</button>' +
      '</div>';
    if(grid.innerHTML!==emptyHtml) grid.innerHTML=emptyHtml;
    return;
  }
  if (draggedBotId !== null) return;

  const currentCards = Array.from(grid.querySelectorAll('.bot-card'));
  const currentIds = currentCards.map(c => c.getAttribute('data-bot-id')).filter(Boolean);
  const nextIds = filtered.map(b => String(b.id));
  const isSameOrder = currentIds.length === nextIds.length && currentIds.every((id, idx) => id === nextIds[idx]);

  if (isSameOrder) {
    filtered.forEach(b => {
      const card = grid.querySelector('.bot-card[data-bot-id="' + b.id + '"]');
      if (card) {
        try {
          const newHtml = botCardHtml(b);
          const temp = document.createElement('div');
          temp.innerHTML = newHtml;
          const fresh = temp.firstElementChild;
          if (fresh) {
            if (card.innerHTML !== fresh.innerHTML) {
              card.innerHTML = fresh.innerHTML;
            }
            if (card.className !== fresh.className) {
              card.className = fresh.className;
            }
          }
        } catch(e){}
      }
    });
  } else {
    const nextHtml = filtered.map(b => {
      try {
        return botCardHtml(b);
      } catch (e) {
        return '';
      }
    }).join('');
    if (grid.innerHTML !== nextHtml) {
      grid.innerHTML = nextHtml;
    }
  }
}

function renderHome() {
  updateKpis();
  filterBots();
}

let currentUserAnnouncement = null;

function renderAnnouncementHtml(text) {
  if (!text) return '';
  const lines = String(text).split('\n');
  let html = '';
  let inList = false;

  for (let line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith('• ') || trimmed.startsWith('- ') || trimmed.startsWith('* ')) {
      if (!inList) { html += '<ul style="margin:6px 0 10px;padding-left:20px;">'; inList = true; }
      const itemContent = escapeHtml(trimmed.slice(2));
      html += '<li style="margin-bottom:4px;">' + itemContent + '</li>';
    } else {
      if (inList) { html += '</ul>'; inList = false; }
      if (!trimmed) {
        html += '<div style="height:8px;"></div>';
      } else {
        html += '<p style="margin:0 0 8px;">' + escapeHtml(line) + '</p>';
      }
    }
  }
  if (inList) html += '</ul>';
  return html;
}

async function checkAndShowAnnouncement() {
  if (!currentUser) return;
  try {
    const res = await requestJson('/api/manager/announcement');
    if (!res.ok || !res.data?.announcement) return;
    const ann = res.data.announcement;
    if (!ann.enabled || !ann.content?.trim()) return;

    const now = new Date();
    const todayStr = now.toLocaleDateString('sv-SE'); // YYYY-MM-DD
    const annId = ann.id || 'default';

    if (ann.mode === 'daily') {
      const dismissedDate = localStorage.getItem('kingmc_ann_dismiss_daily_' + annId);
      if (dismissedDate === todayStr) {
        return; // Đã đóng trong ngày hôm nay!
      }
    } else if (ann.mode === 'every_login') {
      const sessionDismissed = sessionStorage.getItem('kingmc_ann_dismiss_session_' + annId);
      if (sessionDismissed) {
        return; // Đã đóng trong phiên làm việc này!
      }
    } else if (ann.mode === 'time_range') {
      if (ann.startDate && new Date(ann.startDate + 'T00:00:00') > now) return;
      if (ann.endDate && new Date(ann.endDate + 'T23:59:59') < now) return;
      const dismissedDate = localStorage.getItem('kingmc_ann_dismiss_range_' + annId);
      if (dismissedDate === todayStr) {
        return;
      }
    }

    showUserAnnouncement(ann);
  } catch (_) {}
}

function showUserAnnouncement(ann) {
  if (!ann) return;
  currentUserAnnouncement = ann;
  const titleEl = document.getElementById('userAnnouncementTitle');
  const bodyEl = document.getElementById('userAnnouncementBody');
  const timeEl = document.getElementById('userAnnouncementTime');
  const freqEl = document.getElementById('userAnnouncementFreqNote');

  if (titleEl) titleEl.textContent = ann.title || 'THÔNG BÁO HỆ THỐNG';
  if (bodyEl) bodyEl.innerHTML = renderAnnouncementHtml(ann.content || '');
  if (timeEl) {
    const d = ann.updatedAt ? new Date(ann.updatedAt) : new Date();
    timeEl.textContent = 'Cập nhật: ' + d.toLocaleDateString('vi-VN') + ' ' + d.toLocaleTimeString('vi-VN');
  }
  if (freqEl) {
    if (ann.mode === 'daily') {
      freqEl.innerHTML = '🗓️ <span>Thông báo xuất hiện 1 lần mỗi ngày khi truy cập</span>';
    } else if (ann.mode === 'every_login') {
      freqEl.innerHTML = '⚡ <span>Thông báo xuất hiện mỗi phiên đăng nhập</span>';
    } else if (ann.mode === 'time_range') {
      freqEl.innerHTML = '⏳ <span>Áp dụng từ ' + escapeHtml(ann.startDate || '...') + ' đến ' + escapeHtml(ann.endDate || '...') + '</span>';
    }
  }

  document.getElementById('userAnnouncementModal')?.classList.remove('hidden');
}

function dismissUserAnnouncement() {
  document.getElementById('userAnnouncementModal')?.classList.add('hidden');
  if (!currentUserAnnouncement) return;
  const ann = currentUserAnnouncement;
  const annId = ann.id || 'default';
  const todayStr = new Date().toLocaleDateString('sv-SE');

  if (ann.mode === 'daily') {
    localStorage.setItem('kingmc_ann_dismiss_daily_' + annId, todayStr);
  } else if (ann.mode === 'every_login') {
    sessionStorage.setItem('kingmc_ann_dismiss_session_' + annId, '1');
  } else if (ann.mode === 'time_range') {
    localStorage.setItem('kingmc_ann_dismiss_range_' + annId, todayStr);
  }
}

async function openAnnouncementAdminModal() {
  if (currentUser?.role !== 'admin') {
    showToast('Chỉ Quản trị viên mới có quyền cài đặt thông báo.');
    return;
  }
  try {
    const res = await requestJson('/api/manager/announcement');
    const ann = (res.ok && res.data?.announcement) ? res.data.announcement : {};
    const enabledEl = document.getElementById('announcementEnabled');
    const titleEl = document.getElementById('announcementTitle');
    const contentEl = document.getElementById('announcementContent');
    const modeEl = document.getElementById('announcementMode');
    const startEl = document.getElementById('announcementStartDate');
    const endEl = document.getElementById('announcementEndDate');

    if (enabledEl) enabledEl.checked = ann.enabled !== false;
    if (titleEl) titleEl.value = ann.title || '📢 THÔNG BÁO TỪ QUẢN TRỊ VIÊN';
    if (contentEl) contentEl.value = ann.content || '';
    if (modeEl) modeEl.value = ann.mode || 'daily';
    if (startEl) startEl.value = ann.startDate || '';
    if (endEl) endEl.value = ann.endDate || '';

    handleAnnouncementModeChange();
    document.getElementById('announcementAdminModal')?.classList.remove('hidden');
  } catch (err) {
    showToast('Lỗi tải thông báo: ' + err.message);
  }
}

function closeAnnouncementAdminModal() {
  document.getElementById('announcementAdminModal')?.classList.add('hidden');
}

function handleAnnouncementModeChange() {
  const mode = document.getElementById('announcementMode')?.value;
  const rangeGroup = document.getElementById('announcementDateRangeGroup');
  if (rangeGroup) {
    rangeGroup.style.display = (mode === 'time_range') ? 'block' : 'none';
  }
}

async function saveAnnouncementConfig() {
  const enabled = !!document.getElementById('announcementEnabled')?.checked;
  const title = String(document.getElementById('announcementTitle')?.value || '').trim();
  const content = String(document.getElementById('announcementContent')?.value || '').trim();
  const mode = String(document.getElementById('announcementMode')?.value || 'daily');
  const startDate = String(document.getElementById('announcementStartDate')?.value || '').trim();
  const endDate = String(document.getElementById('announcementEndDate')?.value || '').trim();

  if (!title) { showToast('Vui lòng nhập tiêu đề thông báo.'); return; }
  if (enabled && !content) { showToast('Vui lòng nhập nội dung thông báo.'); return; }

  try {
    const res = await requestJson('/api/manager/announcement', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabled, title, content, mode, startDate, endDate })
    });
    if (res.ok) {
      showToast(res.data?.message || 'Đã lưu cấu hình thông báo!');
      closeAnnouncementAdminModal();
      checkAndShowAnnouncement();
    } else {
      showToast(res.data?.error || 'Lỗi khi lưu thông báo.');
    }
  } catch (err) {
    showToast('Lỗi kết nối: ' + err.message);
  }
}

function previewAnnouncementModal() {
  const enabled = !!document.getElementById('announcementEnabled')?.checked;
  const title = String(document.getElementById('announcementTitle')?.value || '').trim();
  const content = String(document.getElementById('announcementContent')?.value || '').trim();
  const mode = String(document.getElementById('announcementMode')?.value || 'daily');
  const startDate = String(document.getElementById('announcementStartDate')?.value || '').trim();
  const endDate = String(document.getElementById('announcementEndDate')?.value || '').trim();

  showUserAnnouncement({
    enabled,
    title: title || '📢 THÔNG BÁO XEM TRƯỚC',
    content: content || 'Nội dung thông báo mẫu...',
    mode,
    startDate,
    endDate,
    updatedAt: new Date().toISOString()
  });
}

function openBatchSettingsModal() {
  const tagSelect = document.getElementById('batchTargetTag');
  if (tagSelect) {
    const existingTags = new Set();
    let countRentable = 0;
    let countRented = 0;
    let countNotRentable = 0;
    (bots || []).forEach(b => {
      if (b.rentable === false) countNotRentable++;
      else if (b.assignedUsername) countRented++;
      else countRentable++;

      if (Array.isArray(b.tags)) b.tags.forEach(t => {
        const clean = String(t || '').trim().toLowerCase().replace(/^#/, '');
        if (clean) existingTags.add(clean);
      });
    });

    let html = '<option value="">🌐 Toàn bộ bot trong danh sách (' + (bots || []).length + ' bot)</option>';
    html += '<optgroup label="📋 Nhóm Trạng Thái Thuê">';
    html += '<option value="sys:rentable">✨ Cho thuê (sẵn sàng) (' + countRentable + ' bot)</option>';
    html += '<option value="sys:rented">👤 Đang được thuê (' + countRented + ' bot)</option>';
    html += '<option value="sys:not-rentable">🚫 Không cho thuê (' + countNotRentable + ' bot)</option>';
    html += '</optgroup>';

    if (existingTags.size > 0) {
      html += '<optgroup label="🏷️ Tag riêng tự tạo">';
      Array.from(existingTags).sort().forEach(tag => {
        const count = (bots || []).filter(b => Array.isArray(b.tags) && b.tags.map(x => String(x).toLowerCase().replace(/^#/, '')).includes(tag)).length;
        html += '<option value="' + escapeHtml(tag) + '">🏷️ #' + escapeHtml(tag) + ' (' + count + ' bot)</option>';
      });
      html += '</optgroup>';
    }
    tagSelect.innerHTML = html;
    if (activeTagFilter) {
      tagSelect.value = activeTagFilter.toLowerCase();
    }
  }
  document.getElementById('batchSettingsModal')?.classList.remove('hidden');
}
function closeBatchSettingsModal() {
  document.getElementById('batchSettingsModal')?.classList.add('hidden');
}
function handleBatchScheduleModeChange() {
  const mode = document.getElementById('batchScheduleMode')?.value;
  const isFixed = mode === 'fixed';
  const fixedBox = document.getElementById('batchFixedSettings');
  const cycleBox = document.getElementById('batchCycleSettings');
  if (fixedBox) fixedBox.style.display = isFixed ? 'block' : 'none';
  if (cycleBox) cycleBox.style.display = isFixed ? 'none' : 'block';
}
window.handleBatchScheduleModeChange = handleBatchScheduleModeChange;

async function submitBatchSettings() {
  const targetTag = document.getElementById('batchTargetTag')?.value || '';
  const settings = {
    ecoMode: !!document.getElementById('batchEcoMode')?.checked,
    autoTotem: !!document.getElementById('batchAutoTotem')?.checked,
    antiHungry: !!document.getElementById('batchAntiHungry')?.checked,
    autoReconnect: !!document.getElementById('batchAutoReconnect')?.checked,
    antiAfkKick: !!document.getElementById('batchAntiAfkKick')?.checked
  };

  if (document.getElementById('batchSyncSpawnCommandsEnabled')?.checked) {
    settings.spawnCommands = String(document.getElementById('batchSpawnCommands')?.value || '').trim();
  }

  const syncSchedule = !!document.getElementById('batchSyncScheduleEnabled')?.checked;
  let botSchedules = null;
  if (syncSchedule) {
    const enabled = !!document.getElementById('batchScheduleActive')?.checked;
    const mode = document.getElementById('batchScheduleMode')?.value === 'cycle' ? 'cycle' : 'fixed';
    let items = [];
    if (mode === 'fixed') {
      const stopTime = String(document.getElementById('batchFixedStopTime')?.value || '04:30').trim();
      const startTime = String(document.getElementById('batchFixedStartTime')?.value || '05:30').trim();
      if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(stopTime) || !/^([01]\d|2[0-3]):[0-5]\d$/.test(startTime)) {
        showToast('Giờ hẹn bật/tắt cố định không hợp lệ.');
        return;
      }
      items = [
        { id: 'batch-stop', action: 'stop', time: stopTime },
        { id: 'batch-start', action: 'start', time: startTime }
      ];
    } else {
      const stopMin = clampClientNumber(document.getElementById('batchCycleStopMinutes')?.value, 120, 1, 43200);
      const startMin = clampClientNumber(document.getElementById('batchCycleStartMinutes')?.value, 300, 1, 43200);
      items = [
        { id: 'batch-stop', action: 'stop', afterMinutes: stopMin },
        { id: 'batch-start', action: 'start', afterMinutes: startMin }
      ];
    }
    botSchedules = [{ id: 'batch-' + Date.now(), enabled, mode, items }];
  }

  showToast('Đang đồng bộ cài đặt' + (syncSchedule ? ' & hẹn giờ' : '') + ' cho các bot...');
  try {
    const payload = { settings, botSchedules };
    if (targetTag) payload.tag = targetTag;
    const res = await requestJson('/api/manager/all/settings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      timeoutMs: 25000
    });
    if (res.ok && res.data?.ok && (res.data?.okCount === undefined || res.data?.okCount === res.data?.total)) {
      closeBatchSettingsModal();
      showToast('Đã đồng bộ thành công cho ' + (res.data?.total ?? res.data?.okCount ?? '') + ' bot!');
      await refreshHome();
    } else {
      const failCount = (res.data?.total || 0) - (res.data?.okCount || 0);
      showToast(res.data?.error || ('⚠️ Đồng bộ không hoàn tất: ' + failCount + ' bot thất bại.'));
      await refreshHome();
    }
  } catch(err) {
    showToast(err.message || 'Lỗi kết nối.');
  }
}

async function openWebhookModal() {
  const modal = document.getElementById('webhookModal');
  if(!modal) return;
  modal.classList.remove('hidden');
  try {
    const res = await requestJson('/api/manager/webhook');
    if(res.ok && res.data?.webhook) {
      const w = res.data.webhook;
      document.getElementById('webhookEnabled').checked = !!w.enabled;
      document.getElementById('webhookDiscordUrl').value = w.discordUrl || '';
      document.getElementById('webhookTelegramToken').value = w.telegramToken || '';
      document.getElementById('webhookTelegramChatId').value = w.telegramChatId || '';
      document.getElementById('webhookNotifyOffline').checked = w.notifyOnOffline !== false;
      document.getElementById('webhookNotifyRecover').checked = w.notifyOnRecover !== false;
      document.getElementById('webhookNotifyLowTotem').checked = w.notifyOnLowTotem !== false;
      document.getElementById('webhookNotifyLowHealth').checked = w.notifyOnLowHealth !== false;
      document.getElementById('webhookNotifyDeath').checked = w.notifyOnDeath !== false;
      document.getElementById('webhookOfflineThreshold').value = w.offlineThresholdMinutes || 5;
    }
  } catch(_) {}
}

function closeWebhookModal() {
  document.getElementById('webhookModal')?.classList.add('hidden');
}

async function saveWebhookSettings() {
  const payload = {
    enabled: !!document.getElementById('webhookEnabled')?.checked,
    discordUrl: document.getElementById('webhookDiscordUrl')?.value?.trim() || '',
    telegramToken: document.getElementById('webhookTelegramToken')?.value?.trim() || '',
    telegramChatId: document.getElementById('webhookTelegramChatId')?.value?.trim() || '',
    notifyOnOffline: !!document.getElementById('webhookNotifyOffline')?.checked,
    notifyOnRecover: !!document.getElementById('webhookNotifyRecover')?.checked,
    notifyOnLowTotem: !!document.getElementById('webhookNotifyLowTotem')?.checked,
    notifyOnLowHealth: !!document.getElementById('webhookNotifyLowHealth')?.checked,
    notifyOnDeath: !!document.getElementById('webhookNotifyDeath')?.checked,
    offlineThresholdMinutes: Number(document.getElementById('webhookOfflineThreshold')?.value) || 5
  };
  try {
    const res = await requestJson('/api/manager/webhook', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    if(!res.ok) throw new Error(res.data?.error || 'Lỗi lưu cấu hình.');
    showToast('✅ Đã lưu cấu hình Webhook thành công!');
    closeWebhookModal();
  } catch(err) {
    showToast('Lỗi: ' + err.message);
  }
}

async function testWebhookSettings() {
  const payload = {
    discordUrl: document.getElementById('webhookDiscordUrl')?.value?.trim() || '',
    telegramToken: document.getElementById('webhookTelegramToken')?.value?.trim() || '',
    telegramChatId: document.getElementById('webhookTelegramChatId')?.value?.trim() || ''
  };
  try {
    showToast('Đang gửi thử tin nhắn Webhook...');
    const res = await requestJson('/api/manager/webhook/test', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    if(!res.ok) throw new Error(res.data?.error || 'Không gửi được test.');
    showToast('✅ ' + (res.data?.message || 'Gửi test thành công!'));
  } catch(err) {
    showToast('Lỗi test: ' + err.message);
  }
}

function generateSparklineSvg(points, strokeColor = '#38bdf8', width = 44, height = 14) {
  if (!Array.isArray(points)) return '';
  const validPts = points.filter(v => typeof v === 'number' && Number.isFinite(v) && v >= 0);
  if (validPts.length < 2) return '';

  const min = Math.min(...validPts);
  const max = Math.max(...validPts);
  const isFlat = min === max;
  const range = isFlat ? 1 : (max - min);
  const step = width / (validPts.length - 1);
  const midY = Math.round((height / 2) * 10) / 10;

  const ptsArr = validPts.map((v, i) => {
    const x = Math.round(i * step * 10) / 10;
    const y = isFlat ? midY : Math.round((height - 2 - ((v - min) / range) * (height - 4)) * 10) / 10;
    return x + ',' + y;
  });

  const pts = ptsArr.join(' ');
  const areaPts = '0,' + height + ' ' + pts + ' ' + width + ',' + height;
  const cleanColor = String(strokeColor || '#38bdf8').replace(/[^a-zA-Z0-9#(),. -]/g, '');
  const titleValues = validPts.map(v => Math.round(v)).join(' → ');

  return '<svg width="' + width + '" height="' + height + '" viewBox="0 0 ' + width + ' ' + height + '" style="display:inline-block;vertical-align:middle;margin-left:3px;opacity:0.95;overflow:visible;" title="Lịch sử: ' + titleValues + '">' +
    '<polygon fill="' + cleanColor + '" fill-opacity="0.18" points="' + areaPts + '"/>' +
    '<polyline fill="none" stroke="' + cleanColor + '" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" points="' + pts + '"/>' +
  '</svg>';
}

async function exportBotLogs(event, botId) {
  if(event) event.stopPropagation();
  try {
    showToast('Đang lấy dữ liệu log của Bot ' + botId + '...');
    const result = await requestJson('/api/manager/bot/' + encodeURIComponent(String(botId)) + '/logs');
    if(!result.ok) throw new Error(result.data?.error || 'Không thể lấy log.');
    const logLines = (result.data?.logs || []).join('\n') || 'Chưa có dữ liệu log.';
    const blob = new Blob([logLines], { type: 'text/plain;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'bot-' + botId + '-logs-' + new Date().toISOString().slice(0, 10) + '.txt';
    a.click();
    showToast('✅ Đã tải file log về máy.');
  } catch(err) {
    showToast('Lỗi tải log: ' + (err.message || 'Không thành công.'));
  }
}

let lastHomeSig = '';
async function getHomeBots() {
  const url = lastHomeSig ? ('/api/manager/bots?sig=' + encodeURIComponent(lastHomeSig)) : '/api/manager/bots';
  const result = await requestJson(url);
  if(!result.ok){const error=new Error(result.data?.error||('HTTP '+result.status));error.status=result.status;throw error;}
  if(result.data?.sig) lastHomeSig = result.data.sig;
  return result.data||{};
}

async function getRegistryFallback() {
  const result=await requestJson('/api/manager/registry');
  if(!result.ok)throw new Error(result.data?.error||('HTTP '+result.status));
  const data=result.data||{};
  const list=Array.isArray(data.bots)?data.bots:[];
  return {
    ok:true,
    bots:list.map(bot=>({
      id:Number(bot.id),
      url:bot.url||'',
      source:bot.source||'unknown',
      botId:String(bot.id),
      label:bot.label||('Bot '+bot.id),
      rentable:bot.rentable!==false,
      configured:!!bot.url,
      available:false,
      username:'',
      status:'offline',
      ready:false,
      ping:null,
      tps:null,
      serverTps:null,
      uptime:'0h 0m 0s',
      uptimeSeconds:0,
      reconnectCount:0,
      host:'',
      port:null,
      position:null,
      dimension:null,
      ipAddress:'',
      locationState:'unknown',
      roundedLocation:null,
      settings:null,
      totemCount:0,
      foodCount:0,
      memory:null,
      rssMb:0,
      heapMb:0,
      error:'Đang chờ bot phản hồi...'
    }))
  };
}

async function refreshHome() {
  if(homeRequestInFlight || selectedBotId!==null) return;
  homeRequestInFlight=true;
  try {
    let data;
    try {
      data=await getHomeBots();
    }catch(primaryError){
      lastHomeSig = '';
      try { data=await getRegistryFallback(); }
      catch(_){ throw primaryError; }
    }
    if (data.currentUser && currentUser) {
      const prevExp = currentUser.expiresAt;
      const prevBots = JSON.stringify(currentUser.assignedBotIds || []);
      const prevStatus = currentUser.status;
      const prevPlan = currentUser.planName;
      Object.assign(currentUser, data.currentUser);
      if (prevExp !== currentUser.expiresAt || prevBots !== JSON.stringify(currentUser.assignedBotIds || []) || prevStatus !== currentUser.status || prevPlan !== currentUser.planName) {
        applyUserRoleUI();
        updateUserHeaderCountdown();
      }
    }
    if (data.unchanged) {
      if (data.managerRamMb) {
        const ramStr = data.managerRamMb + ' MB';
        const r1 = document.getElementById('managerRamUsage');
        const r2 = document.getElementById('detailManagerRamUsage');
        const r3 = document.getElementById('globalManagerRam');
        if (r1) r1.textContent = ramStr;
        if (r2) r2.textContent = ramStr;
        if (r3) r3.textContent = ramStr;
      }
      updateUserHeaderCountdown();
      return;
    }
    bots=Array.isArray(data.bots)?data.bots:[];
    if (data.managerRamMb) {
      const ramStr = data.managerRamMb + ' MB';
      const r1 = document.getElementById('managerRamUsage');
      const r2 = document.getElementById('detailManagerRamUsage');
      const r3 = document.getElementById('globalManagerRam');
      if (r1) r1.textContent = ramStr;
      if (r2) r2.textContent = ramStr;
      if (r3) r3.textContent = ramStr;
    }
    const subtitle=document.getElementById('homeSubtitle');
    if(subtitle) subtitle.textContent='Quản lý tập trung '+bots.length+' bot';
    renderHome();
  updateUserHeaderCountdown();
  } catch(err) {
    const subtitle=document.getElementById('homeSubtitle');
    if(subtitle) subtitle.textContent='Không tải được danh sách bot';
  } finally {
    homeRequestInFlight=false;
  }
}

function updateAddBotUrlCounter() {
  const raw = String(document.getElementById('addBotUrl')?.value || '');
  const tokens = raw.split(/[\r\n\s,]+/).map(s => s.trim()).filter(Boolean);
  const badge = document.getElementById('addBotUrlCountBadge');
  const btn = document.getElementById('confirmAddBotButton');
  if (badge) {
    badge.textContent = tokens.length ? (tokens.length + ' link nhận diện') : '0 link';
  }
  if (btn) {
    btn.textContent = tokens.length > 1 ? ('➕ Thêm ' + tokens.length + ' Bot') : '➕ Thêm Bot';
  }
}
window.updateAddBotUrlCounter = updateAddBotUrlCounter;

function openAddBotModal() {
  const modal = document.getElementById('addBotModal');
  const url = document.getElementById('addBotUrl');
  const label = document.getElementById('addBotLabel');
  if (url) url.value = '';
  if (label) label.value = '';
  updateAddBotUrlCounter();
  if (modal) modal.classList.remove('hidden');
  setTimeout(() => url && url.focus(), 50);
}

function closeAddBotModal() {
  const modal = document.getElementById('addBotModal');
  if (modal) modal.classList.add('hidden');
}

async function addBotFromWeb() {
  const button = document.getElementById('confirmAddBotButton');
  const rawInput = String(document.getElementById('addBotUrl')?.value || '').trim();
  const label = String(document.getElementById('addBotLabel')?.value || '').trim();
  const tokens = rawInput.split(/[\r\n\s,]+/).map(s => s.trim()).filter(Boolean);
  if (!tokens.length) {
    showToast('Vui lòng nhập hoặc dán ít nhất 1 URL bot con.');
    return;
  }
  if (button) {
    button.disabled = true;
    button.textContent = tokens.length > 1 ? '⏳ Đang thêm các bot...' : '⏳ Đang thêm bot...';
  }
  try {
    const result = await requestJson('/api/manager/bots', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        urls: tokens,
        url: tokens[0],
        label
      })
    });
    const data = result.data || {};
    if (!result.ok) throw new Error(data.error || 'Không thể thêm bot.');
    closeAddBotModal();
    showToast(data.message || 'Đã thêm bot thành công!');
    lastHomeSig = '';
    await refreshHome();
  } catch (err) {
    showToast(err.message || 'Không thể thêm bot.');
  } finally {
    if (button) {
      button.disabled = false;
      updateAddBotUrlCounter();
    }
  }
}

async function deleteBot(event,id) {
  if(event) event.stopPropagation();
  const bot=bots.find(x=>Number(x.id)===Number(id));
  if(!bot) return;
  if(!confirm('Xóa '+(bot.label||('Bot '+id))+' khỏi Manager?')) return;
  try {
    const result=await requestJson('/api/manager/bot/'+Number(id),{method:'DELETE'});
    const data=result.data||{};
    if(!result.ok && !data.partial) throw new Error(data.error||'Không thể xóa bot.');
    if(Number(selectedBotId)===Number(id)) goHome();
    showToast(data.message || (data.partial ? ('Đã xóa ' + (bot.label || ('Bot #' + id)) + ' khỏi Supabase & Manager (bot còn lại offline sẽ tự đồng bộ sau).') : 'Đã xóa bot.'));
    bots = bots.filter(x => Number(x.id) !== Number(id));
    renderHome();
    lastHomeSig = '';
    await refreshHome();
  } catch(err) {
    showToast(err.message||'Không thể xóa bot.');
  }
}

// BUG-26: chỉ 404 có ngữ nghĩa "không còn tồn tại" mới đủ bằng chứng xóa. Các trạng
// thái khác (503 cold start, timeout, DNS, 401/403/409 secret mismatch...) KHÔNG chứng
// minh bot đã bị xóa → chỉ cảnh báo, không nằm trong danh sách xóa hàng loạt.
function classifyUnreachableBotEvidence(b) {
    const status = Number(b.httpStatus);
    const errText = String(b.lastError || b.error || '');
    const lower = errText.toLowerCase();
    if (status === 404 || errText.includes('404') || lower.includes('not found') || errText.includes('không tồn tại')) return '404';
    if (status === 503 || lower.includes('cold start') || lower.includes('waking') || lower.includes('spinning up')) return '503/waking';
    if (status === 401 || status === 403 || lower.includes('secret') || lower.includes('unauthorized') || lower.includes('forbidden')) return '401/403 secret';
    if (status === 409) return '409';
    if (lower.includes('timeout') || lower.includes('abort') || lower.includes('econn') || lower.includes('enotfound') || lower.includes('dns')) return 'timeout/DNS';
    return 'unknown';
}

async function cleanDeadBots() {
  if (currentUser?.role !== 'admin') {
    showToast('Chỉ Quản trị viên mới có quyền dọn dẹp bot.', 'error');
    return;
  }
  // Nhóm 1 — bằng chứng mạnh: 404 (endpoint tin cậy xác nhận "không còn tồn tại").
  const deadBots = bots.filter(b => !b.available && classifyUnreachableBotEvidence(b) === '404');
  // Nhóm 2 — chưa xác minh/unreachable: chỉ cảnh báo, tuyệt đối không xóa hàng loạt.
  const unreachables = bots.filter(b => !b.available && classifyUnreachableBotEvidence(b) !== '404');

  if (deadBots.length === 0) {
    if (unreachables.length === 0) {
      showToast('✨ Hạm đội hoạt động hoàn hảo! Không có bot chết hay mất kết nối nào.', 'success', 3500);
      return;
    }
    // BUG-26: không còn mở confirm xóa toàn bộ unreachable. Chỉ cảnh báo kèm bằng
    // chứng từng bot; Admin phải dùng nút Xóa riêng trên từng bot nếu thật sự muốn.
    const msg = '⚠️ Không có bot nào bị xác nhận 404 (đã xoá trên Cloud), nhưng có ' + unreachables.length +
      ' bot đang mất kết nối. Các bot này CHƯA được xác minh là đã bị xóa (có thể do 503 Render cold start, timeout, DNS, hoặc secret mismatch) nên hệ thống KHÔNG tự động xóa:\n' +
      unreachables.map(b => '• #' + b.id + ': ' + b.label + ' — bằng chứng: ' + classifyUnreachableBotEvidence(b) + ' — ' + String(b.lastError || b.error || 'không rõ lỗi').slice(0, 120)).join('\n') +
      '\n\nHãy kiểm tra từng bot (thử Start/Refresh hoặc sửa secret) và chỉ xóa thủ công nếu chắc chắn.';
    showToast(msg.replace(/\n/g, ' '), 'warning', 8000);
    return;
  }

  // Có 404 xác nhận: chỉ đề xuất xóa đúng nhóm 404, đồng thời nêu rõ nhóm unreachable
  // bị loại khỏi danh sách xóa (hai nhóm hiển thị riêng biệt).
  const confirmMsg = 'Phát hiện ' + deadBots.length + ' bot KHÔNG CÒN TỒN TẠI trên Cloud (bằng chứng 404 từ endpoint tin cậy):\n' +
    deadBots.map(b => '• #' + b.id + ': ' + b.label + ' (' + (b.url || 'chưa cấu hình URL') + ')').join('\n') +
    (unreachables.length
      ? '\n\n⚠️ Ngoài ra còn ' + unreachables.length + ' bot chỉ mất kết nối (chưa xác minh 404: ' + unreachables.map(b => '#' + b.id + ' ' + classifyUnreachableBotEvidence(b)).join(', ') + ') — các bot này KHÔNG bị xóa.'
      : '') +
    '\n\nBạn có chắc chắn muốn dọn dẹp và xoá vĩnh viễn CHỈ các bot 404 xác nhận khỏi hệ thống không?';
  if (!confirm(confirmMsg)) return;
  return executeCleanBots(deadBots);
}

async function executeCleanBots(list) {
  showToast('⏳ Đang dọn dẹp ' + list.length + ' bot chết khỏi registry...', 'info', 6000);
  let successCount = 0;
  let failCount = 0;
  for (const b of list) {
    try {
      const res = await requestJson('/api/manager/bot/' + Number(b.id), { method: 'DELETE' });
      if (res.ok || res.data?.partial) successCount++;
      else failCount++;
    } catch (_) {
      failCount++;
    }
  }
  lastHomeSig = '';
  await refreshHome();
  if (failCount === 0) {
    showToast('✅ Đã dọn dẹp thành công ' + successCount + ' bot chết khỏi registry!', 'success', 4500);
  } else {
    showToast('⚠️ Đã xoá ' + successCount + ' bot, có ' + failCount + ' bot gặp lỗi.', 'warning', 4500);
  }
}

function openEditSecretModal(id) {
  editBot(null, id);
  setTimeout(() => {
    const input = document.getElementById('editBotSecretKey');
    if (input) {
      input.focus();
      input.select?.();
      input.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }, 120);
}

function toggleEditSecretKeyVisibility() {
  const input = document.getElementById('editBotSecretKey');
  if (!input) return;
  input.type = input.type === 'password' ? 'text' : 'password';
}

function openBot(id) {
  selectedBotId=Number(id);
  invalidateDetailReads();
  // Reset all detail UI fields to prevent stale ghost data
  const dChat = document.getElementById('detailChatLogs'); if (dChat) dChat.innerHTML = '<div style="color:var(--muted);padding:8px;">Đang tải lịch sử chat...</div>';
  const dEvt = document.getElementById('detailEventLogs'); if (dEvt) dEvt.innerHTML = '<div style="color:var(--muted);padding:8px;">Đang tải nhật ký sự kiện...</div>';
  const dUser = document.getElementById('detailUsernameInput'); if (dUser) dUser.value = '';
  const dPass = document.getElementById('detailPasswordInput'); if (dPass) dPass.value = '';
  const dUp = document.getElementById('detailUptime'); if (dUp) dUp.textContent = '-';
  const dRec = document.getElementById('detailReconnects'); if (dRec) dRec.textContent = '-';
  const dStat = document.getElementById('detailStatus'); if (dStat) dStat.innerHTML = '<span class="dot yellow"></span> Đang tải...';
  const dInv = document.getElementById('detailInventory'); if (dInv) dInv.innerHTML = '';
  const dHot = document.getElementById('detailHotbar'); if (dHot) dHot.innerHTML = '';
  const selected=bots.find(item=>Number(item.id)===selectedBotId);
  const url=new URL(window.location.href);
  url.searchParams.set('bot',String(selectedBotId));
  url.searchParams.delete('botUrl');
  history.pushState({bot:selectedBotId},'',url);
  document.getElementById('homePage').classList.add('hidden');
  document.getElementById('detailPage').classList.remove('hidden');
  lastEventRevision=-1;
  lastChatRevision=-1;
lastPositionHistoryRevision=-1;
lastPositionHistoryFetchedAt=0;
  detailInventory=null;
  detailSettingsDirty=false;
  detailAutoChatDirty=false;
  detailBotScheduleDirty=false;
  renderDetailRemoteGui(null);
  setTimeout(initDetailChatInputHistory, 50);
  void refreshDetail(true);
}

function goHome() {
  invalidateDetailReads();
  selectedBotId=null;
  const url=new URL(window.location.href);
  url.searchParams.delete('bot');
  url.searchParams.delete('botUrl');
  history.pushState({},'',url.pathname+url.search);
  document.getElementById('detailPage').classList.add('hidden');
  document.getElementById('homePage').classList.remove('hidden');
  renderHome();
  lastHomeSig = '';
  void refreshHome();
}

async function resolveRouteFromUrl() {
  routeResolving=true;
  try {
    const url=new URL(window.location.href);
    const botIdParam = url.searchParams.get('bot') || url.searchParams.get('botId') || url.searchParams.get('id');
    const identity=normalizeClientBotUrl(url.searchParams.get('botUrl'));
    if(identity || botIdParam){
      try{
        const result=await requestJson('/api/manager/registry');
        const list = result.data?.bots || [];
        const match = botIdParam
          ? list.find(item => String(item.id) === String(botIdParam))
          : (identity ? list.find(item => item.url && normalizeClientBotUrl(item.url) === identity) : null);
        if(match){
          selectedBotId=Number(match.id);
          url.searchParams.set('bot',String(match.id));
          url.searchParams.delete('botUrl');
          url.searchParams.delete('botId');
          history.replaceState({bot:selectedBotId},'',url);
          invalidateDetailReads();
          document.getElementById('homePage').classList.add('hidden');
          document.getElementById('detailPage').classList.remove('hidden');
          lastEventRevision=-1;
          lastChatRevision=-1;
lastPositionHistoryRevision=-1;
lastPositionHistoryFetchedAt=0;
          detailInventory=null;
          detailSettingsDirty=false;
          detailAutoChatDirty=false;
          detailBotScheduleDirty=false;
          setTimeout(initDetailChatInputHistory, 50);
          await refreshDetail(true);
          return true;
        }
        if (identity) {
          selectedBotId=null;
          document.getElementById('detailPage').classList.add('hidden');
          document.getElementById('homePage').classList.remove('hidden');
          return false;
        }
      }catch(_) {
        // Keep legacy numeric fallback only when the identity lookup itself failed.
      }
    }

    const id=Number(botIdParam);
    if(Number.isInteger(id)&&id>0){
      selectedBotId=id;
      invalidateDetailReads();
      document.getElementById('homePage').classList.add('hidden');
      document.getElementById('detailPage').classList.remove('hidden');
      lastEventRevision=-1;
      lastChatRevision=-1;
lastPositionHistoryRevision=-1;
lastPositionHistoryFetchedAt=0;
      detailInventory=null;
      detailSettingsDirty=false;
      detailAutoChatDirty=false;
      detailBotScheduleDirty=false;
      setTimeout(initDetailChatInputHistory, 50);
      await refreshDetail(true);
      return true;
    }

    selectedBotId=null;
    document.getElementById('detailPage').classList.add('hidden');
    document.getElementById('homePage').classList.remove('hidden');
    return false;
  } finally {
    routeResolving=false;
  }
}

window.addEventListener('popstate',()=>{
  detailSettingsDirty=false;
  detailAutoChatDirty=false;
  detailBotScheduleDirty=false;
  void resolveRouteFromUrl().then(()=>{if(selectedBotId===null) return refreshHome();});
});

async function runAllAction(action) {
  if(allLifecycleActionInFlight) return;
  allLifecycleActionInFlight=true;
  const buttonMap={start:'allStartButton',stop:'allStopButton',restart:'allRestartButton'};
  Object.values(buttonMap).forEach(id=>{const button=document.getElementById(id);if(button)button.disabled=true;});
  try {
    const result=await requestJson('/api/manager/all/'+encodeURIComponent(action),{method:'POST',timeoutMs:30000});
    const data=result.data||{};
    if(!result.ok) throw new Error(data.error||'Thao tác thất bại.');
    const summary=(data.results||[]).map(x=>x.label+': '+(x.ok?'OK':'FAIL')).join(' | ');
    showToast(summary||data.message||'Đã thực hiện.');
    await refreshHome();
  } catch(err) {
    showToast(err.message||'Không thể thực hiện thao tác.');
  } finally {
    allLifecycleActionInFlight=false;
    Object.values(buttonMap).forEach(id=>{const button=document.getElementById(id);if(button)button.disabled=false;});
  }
}

function detailStatusHtml() {
  if(!detailBot) return;
  const isAdmin = Boolean(currentUser && currentUser.role === 'admin');
  const numId = selectedBotId || detailBot.id;
  const [color,label,errorType]=statusMeta(detailBot.status,detailBot.available,!!detailBot.manuallyStopped,detailBot);
  let statusDetailHtml = '<span class="dot '+color+'"></span>'+escapeHtml(label);
  if (!detailBot.available) {
    if (errorType === 'secret_mismatch') {
      statusDetailHtml += '<div style="font-size:12px;color:#fb923c;margin-top:8px;font-weight:600;display:flex;align-items:center;gap:6px;flex-wrap:wrap;">' +
        '<span>⚠️ Worker từ chối lệnh do lệch Secret Key (409).</span>' +
        '<button type="button" class="small warning-btn" onclick="openEditSecretModal(' + numId + ')" style="padding:2px 8px;font-size:11px;">🔑 Cập nhật Key</button>' +
      '</div>';
    } else if (errorType === 'render_sleep') {
      statusDetailHtml += '<div style="font-size:12px;color:#c084fc;margin-top:8px;font-weight:600;">' +
        '💤 Máy chủ Cloud (Render) đang ngủ đông (503) hoặc timeout. Đang thử kết nối lại...' +
      '</div>';
    } else if (errorType === 'not_found') {
      statusDetailHtml += '<div style="font-size:12px;color:#f87171;margin-top:8px;font-weight:600;display:flex;align-items:center;gap:6px;flex-wrap:wrap;">' +
        '<span>❌ Địa chỉ bot trả về 404 Not Found (URL sai hoặc app bị xoá).</span>' +
        '<button type="button" class="small danger" onclick="deleteBot(event,' + numId + ')" style="padding:2px 8px;font-size:11px;">🗑 Xoá Bot</button>' +
        '<button type="button" class="small" onclick="editBot(event,' + numId + ')" style="padding:2px 8px;font-size:11px;">✏ Sửa URL</button>' +
      '</div>';
    }
  }
  document.getElementById('detailStatus').innerHTML=statusDetailHtml;
  const rawLbl = String(detailBot.label || '').trim();
  const hasCustom = rawLbl && rawLbl !== ('Bot ' + numId) && rawLbl !== ('bot' + numId) && rawLbl !== ('Bot #' + numId);
  const detailTitle = hasCustom ? ('Bot #' + numId + ' (' + rawLbl + ')') : ('Bot #' + numId);
  document.getElementById('detailTitle').textContent = detailTitle;
  document.getElementById('detailUsername').textContent=detailBot.username||'Chưa đặt';
  document.getElementById('detailHost').textContent=detailBot.host?detailBot.host+':'+detailBot.port:'-';
  const pingEl = document.getElementById('detailPing');
  const pingRaw = detailBot.ping;

  const pingVal =
      pingRaw === null ||
      pingRaw === undefined ||
      String(pingRaw).trim() === ''
          ? NaN
          : Number(pingRaw);

  if (pingEl) {
      pingEl.textContent =
          Number.isFinite(pingVal) && pingVal >= 0
              ? pingVal + ' ms'
              : ((!detailBot.available || detailBot.status === 'offline') ? '-- ms (Bot đang tắt)' : '--');
  }

  const tpsEl = document.getElementById('detailTps');

  if (tpsEl) {
      const tpsRaw = detailBot.tps ?? detailBot.serverTps;

      const tpsVal =
          tpsRaw === null ||
          tpsRaw === undefined ||
          String(tpsRaw).trim() === ''
              ? NaN
              : Number(tpsRaw);

      const hasTps = Number.isFinite(tpsVal) && tpsVal >= 0;

      tpsEl.textContent = hasTps
          ? tpsVal.toFixed(1)
          : ((!detailBot.available || detailBot.status === 'offline') ? '-- (Bot đang tắt)' : '--');

      tpsEl.style.color = !hasTps
          ? 'var(--muted)'
          : tpsVal >= 18.5
              ? 'var(--green)'
              : tpsVal >= 14.0
                  ? 'var(--yellow)'
                  : 'var(--red)';
  }
  // 1. Hiển thị tọa độ bot
  const pos = detailBot.position || detailBot.roundedLocation;
  const positionEl = document.getElementById('detailPosition');

  if (positionEl) {
    const validPosition = pos &&
      [pos.x, pos.y, pos.z].every(
        v => v !== null && v !== '' && Number.isFinite(Number(v))
      );

    positionEl.textContent = validPosition
      ? ('X: ' + Math.round(Number(pos.x)) + ', Y: ' + Math.round(Number(pos.y)) + ', Z: ' + Math.round(Number(pos.z)))
      : '--';
  }

  // 2. Hiển thị Dimension và trạng thái vị trí
  const dimensionEl = document.getElementById('detailDimension');

  if (dimensionEl) {
    const rawDim = String(detailBot.dimension || '').trim();
    const dimension = rawDim ? rawDim.replace(/^minecraft:/, '') : '';
    const location = String(detailBot.locationState || '')
      .trim()
      .toLowerCase();

    const locationLabels = {
      login: 'LOGIN',
      lobby: 'LOBBY',
      other: 'INGAME'
    };

    const locationLabel = locationLabels[location] || (location && location !== 'unknown' ? location.toUpperCase() : '');

    dimensionEl.textContent = [
      dimension || 'Không xác định',
      locationLabel
    ].filter(Boolean).join(' • ');
  }
  const rawDetailIp = String(detailBot.ipAddress || '').trim();
  const isDetailLoopback = rawDetailIp === '127.0.0.1' || rawDetailIp === 'localhost' || rawDetailIp === '0.0.0.0' || rawDetailIp === '::1';
  const detailIpEl = document.getElementById('detailIp');
  if (detailIpEl) {
    detailIpEl.textContent = (isAdmin && !isDetailLoopback && rawDetailIp) ? rawDetailIp : (isAdmin && detailBot.host ? detailBot.host : '-');
  }

  const hw = detailBot.hostHardware;
  const botRamMb = Number(hw?.botRssMb || detailBot.ramRss || detailBot.rssMb || detailBot.memory?.rssMb || 0);

  // 1. RAM Máy Host
  const hostRamEl = document.getElementById('detailHostRam');
  if (hostRamEl) {
    if (hw && hw.ramTotalMb > 0) {
      hostRamEl.textContent = hw.ramUsedMb + ' / ' + hw.ramTotalMb + ' MB (' + hw.ramPercent + '%)';
      hostRamEl.style.color = hw.ramPercent > 85 ? 'var(--red)' : hw.ramPercent > 70 ? 'var(--yellow)' : 'var(--green)';
    } else {
      hostRamEl.textContent = '--';
    }
  }

  // 2. CPU Máy Host
  const hostCpuEl = document.getElementById('detailHostCpu');
  if (hostCpuEl) {
    if (hw) {
      hostCpuEl.textContent = hw.cpuPercent + '% / ' + hw.cpuCores + ' Cores';
      hostCpuEl.style.color = hw.cpuPercent > 85 ? 'var(--red)' : hw.cpuPercent > 60 ? 'var(--yellow)' : '#38bdf8';
    } else {
      hostCpuEl.textContent = '--';
    }
  }

  // 3. Lưu lượng mạng
  const hostNetEl = document.getElementById('detailHostNet');
  if (hostNetEl) {
    if (hw) {
      hostNetEl.textContent = '↓ ' + hw.netDownKb + ' KB/s • ↑ ' + hw.netUpKb + ' KB/s (Tổng: ' + hw.netTotalRxMb + ' MB)';
    } else {
      hostNetEl.textContent = '--';
    }
  }

  // 4. RAM Bot con
  const ramEl = document.getElementById('detailRam');
  if (ramEl) {
    ramEl.textContent = botRamMb > 0 ? (botRamMb + ' MB RSS') : '--';
  }

  // 5. Uptime & Reconnects
  const uptimeEl = document.getElementById('detailUptime');
  if (uptimeEl) {
    const sec = Number(detailBot.uptimeSeconds || 0);
    const h = Math.floor(sec / 3600);
    const m = Math.floor((sec % 3600) / 60);
    const s = sec % 60;
    uptimeEl.textContent = h + 'h ' + m + 'm ' + s + 's';
  }
  const recEl = document.getElementById('detailReconnects');
  if (recEl) {
    recEl.textContent = String(detailBot.reconnectAttempts || detailBot.reconnectCount || 0);
  }

  // 6. Phân quyền đổi tài khoản Minecraft theo allowAccountChange
  const canChangeAccount = currentUser?.role === 'admin' || currentUser?.allowAccountChange !== false;
  const accountPanel = document.getElementById('detailAccountPanel');
  if (accountPanel) {
    accountPanel.style.display = canChangeAccount ? 'block' : 'none';
  }

  // BUG-19: Ẩn #detailProxyPanel và #botProxyPanel trên giao diện theo role và quyền (allowAccountChange === false)
  const canManageProxy = currentUser?.role === 'admin' && canChangeAccount;
  const proxyPanels = document.querySelectorAll('#detailProxyPanel, #botProxyPanel');
  proxyPanels.forEach(panel => {
    panel.style.display = canManageProxy ? 'block' : 'none';
  });

  // Render Proxy riêng của Bot (masked {enabled} từ snapshot; admin nạp chi tiết sau)
  if (canManageProxy) {
    renderDetailProxy(detailBot.settings?.proxy);
    void loadFullSettingsForAdmin();
  }

  // 7. Render Remote GUI Inspector
  renderDetailRemoteGui(detailBot.currentWindow);

  document.getElementById('detailStartButton').disabled=false;
  document.getElementById('detailStopButton').disabled=false;
  document.getElementById('detailRestartButton').disabled=false;
}

async function detailGet(path) {
  if(selectedBotId===null) throw new Error('Chưa chọn bot.');
  const result=await requestJson('/api/manager/bot/'+encodeURIComponent(String(selectedBotId))+path);
  if(!result.ok){const error=new Error(result.data?.error||'Không thể lấy dữ liệu bot.');error.status=result.status;error.data=result.data||{};throw error;}
  return result.data||{};
}

// ----------------------------------------------------------------------------
// COMMERCIAL SAAS FRONTEND FUNCTIONS
// ----------------------------------------------------------------------------

function openBroadcastModal() {
  document.getElementById('broadcastCommandInput').value = '';
  document.getElementById('broadcastResultBox').style.display = 'none';
  const tagSelect = document.getElementById('broadcastTargetTag');
  if (tagSelect) {
    const existingTags = new Set();
    let countRentable = 0;
    let countRented = 0;
    let countNotRentable = 0;
    (bots || []).forEach(b => {
      if (b.rentable === false) countNotRentable++;
      else if (b.assignedUsername) countRented++;
      else countRentable++;

      if (Array.isArray(b.tags)) b.tags.forEach(t => {
        const clean = String(t || '').trim().toLowerCase().replace(/^#/, '');
        if (clean) existingTags.add(clean);
      });
    });

    let html = '<option value="">🌐 Toàn bộ bot trong danh sách (' + (bots || []).length + ' bot)</option>';
    html += '<optgroup label="📋 Nhóm Trạng Thái Thuê">';
    html += '<option value="sys:rentable">✨ Cho thuê (sẵn sàng) (' + countRentable + ' bot)</option>';
    html += '<option value="sys:rented">👤 Đang được thuê (' + countRented + ' bot)</option>';
    html += '<option value="sys:not-rentable">🚫 Không cho thuê (' + countNotRentable + ' bot)</option>';
    html += '</optgroup>';

    if (existingTags.size > 0) {
      html += '<optgroup label="🏷️ Tag riêng tự tạo">';
      Array.from(existingTags).sort().forEach(tag => {
        const count = (bots || []).filter(b => Array.isArray(b.tags) && b.tags.map(x => String(x).toLowerCase().replace(/^#/, '')).includes(tag)).length;
        html += '<option value="' + escapeHtml(tag) + '">🏷️ #' + escapeHtml(tag) + ' (' + count + ' bot)</option>';
      });
      html += '</optgroup>';
    }
    tagSelect.innerHTML = html;
    if (activeTagFilter) {
      tagSelect.value = activeTagFilter.toLowerCase();
    }
  }
  document.getElementById('broadcastModal').classList.remove('hidden');
}

function closeBroadcastModal() {
  document.getElementById('broadcastModal').classList.add('hidden');
}

async function submitBroadcastCommand() {
  const msg = document.getElementById('broadcastCommandInput').value.trim();
  const targetTag = document.getElementById('broadcastTargetTag')?.value || '';
  const box = document.getElementById('broadcastResultBox');
  if (!msg) {
    box.style.display = 'block';
    box.style.background = 'rgba(239,68,68,0.2)';
    box.style.color = 'var(--red)';
    box.textContent = 'Vui lòng nhập lệnh cần gửi!';
    return;
  }
  box.style.display = 'block';
  box.style.background = 'rgba(56,189,248,0.2)';
  box.style.color = '#38bdf8';
  box.textContent = 'Đang bắn lệnh tới các bot...';
  try {
    const payload = { message: msg };
    if (targetTag) payload.tag = targetTag;
    const res = await requestJson('/api/manager/all/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    if (res.ok) {
      box.style.background = 'rgba(16,185,129,0.2)';
      box.style.color = 'var(--green)';
      box.textContent = res.data?.message || 'Đã gửi thành công!';
      showToast('Đã broadcast lệnh thành công!');
      setTimeout(closeBroadcastModal, 1500);
    } else {
      box.style.background = 'rgba(239,68,68,0.2)';
      box.style.color = 'var(--red)';
      box.textContent = res.data?.error || 'Lỗi gửi broadcast.';
    }
  } catch(e) {
    box.style.background = 'rgba(239,68,68,0.2)';
    box.style.color = 'var(--red)';
    box.textContent = e.message || 'Lỗi mạng.';
  }
}

function openRenewModal() {
  document.getElementById('renewKeyInput').value = '';
  document.getElementById('renewResultBox').style.display = 'none';
  document.getElementById('renewModal').classList.remove('hidden');
}

function closeRenewModal() {
  document.getElementById('renewModal').classList.add('hidden');
}

async function submitRenewKey() {
  const key = document.getElementById('renewKeyInput').value.trim().toUpperCase();
  const box = document.getElementById('renewResultBox');
  if (!key) {
    box.style.display = 'block';
    box.style.background = 'rgba(239,68,68,0.2)';
    box.style.color = 'var(--red)';
    box.textContent = 'Vui lòng nhập mã Key!';
    return;
  }
  box.style.display = 'block';
  box.style.background = 'rgba(56,189,248,0.2)';
  box.style.color = '#38bdf8';
  box.textContent = 'Đang kích hoạt Key...';
  try {
    const res = await requestJson('/api/manager/renew', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key })
    });
    if (res.ok) {
      const partial = res.data?.partial === true;
      box.style.background = partial ? 'rgba(245,158,11,0.2)' : 'rgba(16,185,129,0.2)';
      box.style.color = partial ? 'var(--yellow)' : 'var(--green)';
      box.textContent = (partial ? '⚠️ ' : '') + (res.data?.warning || res.data?.message || 'Gia hạn thành công!');
      showToast((partial ? '⚠️ ' : '🎉 ') + (res.data?.warning || 'Kích hoạt Key gia hạn thành công!'));
      if (currentUser && res.data.expiresAt) {
        currentUser.expiresAt = res.data.expiresAt;
        if (res.data.planName) currentUser.planName = res.data.planName;
        if (Array.isArray(res.data.assignedBotIds)) currentUser.assignedBotIds = res.data.assignedBotIds;
        currentUser.status = 'active';
        applyUserRoleUI();
        updateUserHeaderCountdown();
      }
      lastHomeSig = '';
      await refreshHome();
      if (selectedBotId !== null) {
        await refreshDetail(true);
      }
      setTimeout(closeRenewModal, partial ? 2600 : 1800);
    } else {
      box.style.background = 'rgba(239,68,68,0.2)';
      box.style.color = 'var(--red)';
      box.textContent = res.data?.error || 'Kích hoạt thất bại.';
    }
  } catch (e) {
    box.style.background = 'rgba(239,68,68,0.2)';
    box.style.color = 'var(--red)';
    box.textContent = e.message || 'Lỗi kết nối.';
  }
}

async function openKeyManagementModal() {
  document.getElementById('keyManagementModal').classList.remove('hidden');
  await refreshKeysTable();
}

function closeKeyManagementModal() {
  document.getElementById('keyManagementModal').classList.add('hidden');
}

async function refreshKeysTable() {
  const tbody = document.getElementById('keysTableBody');
  const fullTbody = document.getElementById('keysFullTableBody');
  if (!tbody && !fullTbody) return;
  const loadingHtml = '<tr><td colspan="6" style="padding:16px;text-align:center;color:var(--muted);">Đang tải danh sách Key / Giftcode...</td></tr>';
  if (tbody) tbody.innerHTML = loadingHtml;
  if (fullTbody) fullTbody.innerHTML = loadingHtml;

  try {
    const res = await requestJson('/api/manager/keys');
    if (!res.ok) throw new Error(res.data?.error || 'Lỗi tải danh sách key');
    const keys = res.data?.keys || [];
    const countBadge = document.getElementById('keyMgmtTotalCount');
    if (countBadge) countBadge.textContent = keys.length;

    if (!keys.length) {
      const emptyHtml = '<tr><td colspan="6" style="padding:16px;text-align:center;color:var(--muted);">Chưa có mã Key / Giftcode nào. Sử dụng bảng phát hành phía trên để tạo mới.</td></tr>';
      if (tbody) tbody.innerHTML = emptyHtml;
      if (fullTbody) fullTbody.innerHTML = emptyHtml;
      return;
    }

    const rowsHtml = keys.map(k => {
      // Client-side scope: normalize independently from the server helper.
      // 0 = không giới hạn; invalid/missing values fall back to 1.
      const rawMaxUses = Number(k.maxUses);
      const maxUses = Number.isSafeInteger(rawMaxUses) && rawMaxUses >= 0 ? rawMaxUses : 1;
      const usedCount = Number(k.usedCount) || (k.used ? 1 : (Array.isArray(k.usedUsers) ? k.usedUsers.length : 0));
      const isExpired = k.expiresAt && Date.now() > Date.parse(k.expiresAt);
      const isExhausted = maxUses > 0 && usedCount >= maxUses;

      let statusBadge = '';
      if (isExpired) {
        statusBadge = '<span style="color:#f59e0b;background:rgba(245,158,11,0.15);padding:2px 7px;border-radius:4px;font-size:11px;font-weight:700;">Hết hạn</span>';
      } else if (isExhausted) {
        statusBadge = '<span style="color:var(--red);background:rgba(239,68,68,0.15);padding:2px 7px;border-radius:4px;font-size:11px;font-weight:700;">Hết lượt (' + usedCount + '/' + maxUses + ')</span>';
      } else if (usedCount > 0) {
        statusBadge = '<span style="color:#38bdf8;background:rgba(56,189,248,0.15);padding:2px 7px;border-radius:4px;font-size:11px;font-weight:700;">Đang dùng (' + usedCount + '/' + (maxUses > 0 ? maxUses : '∞') + ')</span>';
      } else {
        statusBadge = '<span style="color:var(--green);background:rgba(16,185,129,0.15);padding:2px 7px;border-radius:4px;font-size:11px;font-weight:700;">Khả dụng (0/' + (maxUses > 0 ? maxUses : '∞') + ')</span>';
      }

      const usersText = Array.isArray(k.usedUsers) && k.usedUsers.length > 0
        ? k.usedUsers.join(', ')
        : (k.usedBy ? String(k.usedBy) : '-');

      const expText = k.expiresAt
        ? new Date(k.expiresAt).toLocaleDateString('vi-VN')
        : 'Vô thời hạn';

      return '<tr style="border-bottom:1px solid var(--border);">' +
        '<td style="padding:8px 10px;font-family:monospace;font-weight:750;color:#38bdf8;">' + escapeHtml(k.key) + '</td>' +
        '<td style="padding:8px 10px;">' + escapeHtml(k.planName || ((k.days === -1 || k.isPermanent) ? 'VIP Vĩnh Viễn' : (k.days + ' Ngày'))) + ' • <span style="color:#a78bfa;font-weight:700;">' + (k.botCount || 1) + ' Bot</span></td>' +
        '<td style="padding:8px 10px;">' + statusBadge + '</td>' +
        '<td style="padding:8px 10px;color:var(--muted);max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="' + escapeHtml(usersText) + '">' + escapeHtml(usersText) + '</td>' +
        '<td style="padding:8px 10px;color:var(--muted);font-size:12px;">' + escapeHtml(expText) + '</td>' +
        '<td style="padding:8px 10px;text-align:right;">' +
          '<button type="button" class="small btn-copy-key" data-key="' + escapeHtml(k.key) + '" style="margin-right:6px;">📋 Copy</button>' +
          '<button type="button" class="small danger btn-delete-key" data-key="' + escapeHtml(k.key) + '">🗑 Xóa</button>' +
        '</td>' +
      '</tr>';
    }).join('');

    function attachDelegation(el) {
      if (!el || el._delegationInit) return;
      el._delegationInit = true;
      el.addEventListener('click', function(e) {
        const btn = e.target.closest('button');
        if (!btn) return;
        if (btn.classList.contains('btn-copy-key')) {
          copyToClipboard(btn.getAttribute('data-key'), 'Mã Key');
        } else if (btn.classList.contains('btn-delete-key')) {
          deleteLicenseKey(btn.getAttribute('data-key'));
        }
      });
    }

    if (tbody) {
      tbody.innerHTML = rowsHtml;
      attachDelegation(tbody);
    }
    if (fullTbody) {
      fullTbody.innerHTML = rowsHtml;
      attachDelegation(fullTbody);
    }
  } catch(e) {
    const errHtml = '<tr><td colspan="6" style="padding:12px;text-align:center;color:var(--red);">' + escapeHtml(e.message) + '</td></tr>';
    if (tbody) tbody.innerHTML = errHtml;
    if (fullTbody) fullTbody.innerHTML = errHtml;
  }
}

const keyMutationState = { creating: false, deleting: new Set() };

async function submitCreateKeys() {
  if (keyMutationState.creating) return;
  const daysSelect = document.getElementById('createKeyDays')?.value;
  const customInp = document.getElementById('createKeyCustomDays');
  const isPermanent = daysSelect === 'lifetime';
  let days = 7;
  if (isPermanent) {
    days = -1;
  } else if (daysSelect === 'custom') {
    const customVal = parseInt(customInp?.value, 10);
    if (!Number.isFinite(customVal) || customVal < 1) {
      showToast('Vui lòng nhập số ngày hợp lệ (tối thiểu 1 ngày).', 'error');
      if (customInp) customInp.focus();
      return;
    }
    days = Math.min(customVal, 3650);
  } else {
    days = Number(daysSelect) || 7;
  }
  const defaultPlanName = isPermanent ? 'VIP Vĩnh Viễn' : ('Gói ' + days + ' Ngày');
  const planName = document.getElementById('createKeyPlan')?.value.trim() || defaultPlanName;
  const count = Number(document.getElementById('createKeyCount')?.value) || 1;
  const botCount = Number(document.getElementById('createKeyBotCount')?.value) || 1;
  const rawMaxUses = document.getElementById('createKeyMaxUses')?.value;
  const maxUses = rawMaxUses === '' || rawMaxUses === undefined ? 1 : Number(rawMaxUses);
  if (!Number.isSafeInteger(maxUses) || maxUses < 0) {
    showToast('Số lượt dùng phải là số nguyên không âm; 0 = không giới hạn.', 'error');
    return;
  }
  keyMutationState.creating = true;
  try {
    const res = await requestJson('/api/manager/keys', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ days, isPermanent, setPermanent: isPermanent, planName, count, botCount, maxUses })
    });
    if (!res.ok) throw new Error(res.data?.error || 'Lỗi tạo key');
    showToast(res.data?.message || 'Đã tạo key thành công!');
    await refreshKeysTable();
  } catch(e) {
    showToast(e.message || 'Lỗi tạo key');
  } finally {
    keyMutationState.creating = false;
  }
}

async function deleteLicenseKey(key) {
  if (!confirm('Bạn có chắc chắn muốn xóa mã Key ' + key + ' không?')) return;
  const keyId = String(key || '');
  if (!keyId || keyMutationState.deleting.has(keyId)) return;
  keyMutationState.deleting.add(keyId);
  try {
    const res = await requestJson('/api/manager/keys/' + encodeURIComponent(key), { method: 'DELETE' });
    if (!res.ok) throw new Error(res.data?.error || 'Lỗi xóa key');
    showToast('Đã xóa key ' + key);
    await refreshKeysTable();
  } catch(e) {
    showToast(e.message || 'Lỗi xóa key');
  } finally {
    keyMutationState.deleting.delete(keyId);
  }
}

async function quickAddUserDays(username, days) {
  const label = days === -1 ? 'Vĩnh viễn' : ('+' + days + ' ngày');
  if (!confirm('Cộng ' + label + ' hạn thuê cho tài khoản ' + username + '?')) return;
  try {
    const res = await requestJson('/api/manager/user/' + encodeURIComponent(username) + '/add-days', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ days })
    });
    if (!res.ok) throw new Error(res.data?.error || 'Lỗi cập nhật');
    showToast(res.data?.message || 'Đã cộng ngày thuê!');
    lastHomeSig = '';
    await Promise.allSettled([
      typeof refreshUserManagementPage === 'function' ? refreshUserManagementPage() : Promise.resolve(),
      refreshHome()
    ]);
  } catch(e) {
    showToast(e.message || 'Lỗi cộng ngày thuê');
  }
}

async function resetCustomerBot() {
  if (!selectedBotId) return;
  if (!confirm('⚠️ BẠN CÓ CHẮC CHẮN MUỐN RESET BÀN GIAO BOT?\n\nThao tác này sẽ:\n1. Dừng bot ngay lập tức\n2. Xóa sạch tài khoản Minecraft cũ trên bot\n3. Xóa toàn bộ lịch sử Chat và Event Log\n4. Tắt toàn bộ lịch hẹn giờ và auto-chat\n\nSẵn sàng 100% để giao cho khách thuê mới!')) return;
  try {
    invalidateDetailReads();
    const res = await requestJson('/api/manager/bot/' + selectedBotId + '/reset-customer', { method: 'POST' });
    if (!res.ok) throw new Error((res.data?.warning ? res.data.warning + ' ' : '') + (res.data?.error || 'Lỗi reset bot'));
    if (res.data?.partial === true) {
      showToast('⚠️ Bot đã reset một phần: ' + (res.data?.warning || res.data?.message || 'Chưa thu hồi/xóa đủ dữ liệu Cloud. Kiểm tra log và thử lại.'));
    } else {
      showToast(res.data?.message || 'Đã reset bàn giao bot thành công!');
    }
    if (detailBot) {
      detailBot.username = '';
      detailBot.status = 'offline';
      detailBot.manuallyStopped = true;
    }
    const uInput = document.getElementById('detailUsernameInput'); if (uInput) uInput.value = '';
    const pInput = document.getElementById('detailPasswordInput'); if (pInput) pInput.value = '';
    const dChat = document.getElementById('detailChatLogs'); if (dChat) dChat.innerHTML = '<div style="color:var(--muted);padding:8px;">Chưa có tin nhắn nào.</div>';
    const dLog = document.getElementById('detailEventLogs'); if (dLog) dLog.innerHTML = '<div style="color:var(--muted);padding:8px;">Chưa có nhật ký nào.</div>';
    detailStatusHtml();
    renderDetailAutoChatSchedules([]);
    renderDetailBotSchedules([]);
    const botIdx = bots.findIndex(b => Number(b.id) === Number(selectedBotId));
    if (botIdx !== -1) {
      bots[botIdx].username = '';
      bots[botIdx].status = 'offline';
      bots[botIdx].manuallyStopped = true;
    }
    await refreshDetail(true);
  } catch(e) {
    showToast(e.message || 'Lỗi reset bàn giao');
  }
}

function renderDetailRemoteGui(win) {
  const card = document.getElementById('detailRemoteGuiCard');
  if (!card) return;
  const placeholder = document.getElementById('detailRemoteGuiPlaceholder');
  const content = document.getElementById('detailRemoteGuiContent');
  const badge = document.getElementById('detailRemoteGuiBadge');
  const closeBtn = document.getElementById('detailRemoteGuiCloseBtn');
  const titleEl = document.getElementById('detailRemoteGuiTitle');

  if (!win || !win.slots || win.slots.length === 0) {
    if (placeholder) placeholder.style.display = 'block';
    if (content) content.style.display = 'none';
    if (badge) badge.style.display = 'none';
    if (closeBtn) closeBtn.style.display = 'none';
    if (titleEl) titleEl.textContent = '🖥️ Cửa Sổ GUI / Menu Ingame';
    return;
  }

  if (placeholder) placeholder.style.display = 'none';
  if (content) content.style.display = 'block';
  if (badge) badge.style.display = 'inline-block';
  if (closeBtn) closeBtn.style.display = 'inline-block';
  if (titleEl) titleEl.textContent = '🖥️ ' + (win.title || 'GUI Sảnh / Máy Chủ Đang Mở');

  const container = document.getElementById('detailRemoteGuiSlots');
  if (!container) return;
  container.innerHTML = win.slots.slice(0, 54).map(function(item, idx) {
    if (!item) {
      return '<div onclick="clickDetailGuiSlot(' + idx + ')" style="aspect-ratio:1;background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.08);border-radius:6px;cursor:pointer;display:flex;align-items:center;justify-content:center;color:rgba(255,255,255,0.18);font-size:10px;font-family:monospace;" title="Ô #' + idx + ' (Trống)">' + idx + '</div>';
    }
    const rawName = String(item.displayName || item.name || 'Vật phẩm');
    const safeName = escapeHtml(rawName);
    return '<div onclick="clickDetailGuiSlot(' + idx + ')" style="aspect-ratio:1;background:rgba(56,189,248,0.15);border:1px solid rgba(56,189,248,0.45);border-radius:6px;cursor:pointer;display:flex;flex-direction:column;align-items:center;justify-content:center;position:relative;padding:3px;text-align:center;box-shadow:0 2px 8px rgba(0,0,0,0.3);transition:all 0.15s ease;" onmouseenter="this.style.transform=\'scale(1.05)\'" onmouseleave="this.style.transform=\'none\'" title="Ô #' + idx + ': ' + safeName + ' (Click để chọn)">' +
      '<span style="font-size:11px;font-weight:700;color:#fff;overflow:hidden;text-overflow:ellipsis;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;line-height:1.2;max-width:100%;word-break:break-word;">' + safeName + '</span>' +
      (item.count > 1 ? '<span style="position:absolute;bottom:2px;right:2px;font-size:9.5px;font-weight:800;background:rgba(15,23,42,0.9);border:1px solid rgba(56,189,248,0.4);padding:0 3px;border-radius:3px;color:#38bdf8;">x' + item.count + '</span>' : '') +
      '</div>';
  }).join('');
}

async function clickDetailGuiSlot(slot) {
  if (!selectedBotId) return;
  try {
    const res = await requestJson('/api/manager/bot/' + selectedBotId + '/window/click', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ slot, mouseButton: 0 }),
      timeoutMs: 8000
    });
    if (!res.ok) {
      showToast(res.data?.error || 'Lỗi click GUI', 'error');
    } else {
      showToast('Đã click ô ' + slot, 'success');
      await refreshDetail(true);
    }
  } catch(e) {
    showToast('Lỗi gửi click GUI', 'error');
  }
}

async function closeDetailGuiWindow() {
  if (!selectedBotId) return;
  try {
    const res = await requestJson('/api/manager/bot/' + selectedBotId + '/window/close', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}'
    });
    if (!res.ok) {
      showToast(res.data?.error || 'Không thể đóng GUI.');
      return;
    }
    showToast(res.data?.message || 'Đã đóng GUI.');
    await refreshDetail(true);
  } catch (_) {
    showToast('Lỗi gửi yêu cầu đóng GUI.');
  }
}

function formatFullDateTime(isoString) {
  if (!isoString) return 'Vĩnh Viễn';
  const d = new Date(isoString);
  if (isNaN(d.getTime())) return 'Không xác định';
  const pad = function(n) { return String(n).padStart(2, '0'); };
  const hours = pad(d.getHours());
  const minutes = pad(d.getMinutes());
  const day = pad(d.getDate());
  const month = pad(d.getMonth() + 1);
  const year = d.getFullYear();
  return hours + ':' + minutes + ' - ' + day + '/' + month + '/' + year;
}

function formatRentalCountdown(isoString) {
  if (!isoString) return { expired: false, text: 'Vĩnh viễn', color: 'var(--green)' };
  const expTime = Date.parse(isoString);
  if (isNaN(expTime)) return { expired: false, text: 'Không xác định', color: 'var(--muted)' };
  const diffMs = expTime - Date.now();
  if (diffMs <= 0) {
    return { expired: true, text: 'ĐÃ HẾT HẠN', color: 'var(--red)' };
  }
  const totalHours = Math.floor(diffMs / 3600000);
  const days = Math.floor(totalHours / 24);
  const hours = totalHours % 24;
  const minutes = Math.floor((diffMs % 3600000) / 60000);
  let text = '';
  if (days > 0) {
    text = 'Còn ' + days + ' ngày ' + hours + ' giờ ' + minutes + ' phút';
  } else if (hours > 0) {
    text = 'Còn ' + hours + ' giờ ' + minutes + ' phút';
  } else {
    text = 'Còn ' + minutes + ' phút';
  }
  let color = 'var(--green)';
  if (days < 1) color = 'var(--red)';
  else if (days < 3) color = 'var(--yellow)';
  return { expired: false, text: text, color: color };
}

function updateUserHeaderCountdown() {
  let badge = document.getElementById('userRentalCountdownBadge');
  const banner = document.getElementById('userRentalDashboardBanner');
  if (!currentUser || currentUser.role === 'admin') {
    if (badge) badge.style.display = 'none';
    if (banner) banner.style.display = 'none';
    return;
  }
  const topBar = document.querySelector('.top-actions') || document.querySelector('.header') || document.getElementById('homePage');
  if (!badge) {
    badge = document.createElement('div');
    badge.id = 'userRentalCountdownBadge';
    badge.style.display = 'inline-flex';
    badge.style.alignItems = 'center';
    badge.style.gap = '8px';
    badge.style.fontSize = '12px';
    badge.style.padding = '4px 10px';
    badge.style.borderRadius = '20px';
    badge.style.marginRight = '8px';
    const ref = document.querySelector('.top-actions');
    if (ref) ref.insertBefore(badge, ref.firstChild);
  }

  const bannerIcon = document.getElementById('userRentalBannerIcon');
  const bannerPlan = document.getElementById('userRentalBannerPlan');
  const bannerExactTime = document.getElementById('userRentalBannerExactTime');
  const bannerCountdown = document.getElementById('userRentalBannerCountdown');

  if (banner) {
    banner.style.display = 'flex';
    if (bannerPlan) bannerPlan.textContent = currentUser.planName || 'Gói thường';
  }

  if (!currentUser.expiresAt) {
    badge.style.display = 'inline-flex';
    badge.style.background = 'rgba(16,185,129,0.15)';
    badge.style.color = 'var(--green)';
    badge.style.border = '1px solid rgba(16,185,129,0.3)';
    badge.innerHTML = '<span>👑 Hạn thuê: <b>VIP Vĩnh Viễn</b></span>';

    if (banner) {
      if (bannerIcon) bannerIcon.textContent = '👑';
      if (bannerExactTime) bannerExactTime.textContent = 'Vĩnh Viễn';
      if (bannerCountdown) {
        bannerCountdown.textContent = 'Không giới hạn thời gian';
        bannerCountdown.style.color = 'var(--green)';
      }
      banner.style.background = 'rgba(16,185,129,0.1)';
      banner.style.borderColor = 'rgba(16,185,129,0.3)';
    }
    return;
  }

  const exactFormatted = formatFullDateTime(currentUser.expiresAt);
  const countdown = formatRentalCountdown(currentUser.expiresAt);

  if (countdown.expired) {
    badge.style.display = 'inline-flex';
    badge.style.background = 'rgba(239,68,68,0.2)';
    badge.style.color = 'var(--red)';
    badge.style.border = '1px solid rgba(239,68,68,0.4)';
    badge.innerHTML = '<span>⚠️ Hạn thuê: <b>ĐÃ HẾT HẠN (' + exactFormatted + ')</b></span><button class="small primary" onclick="openRenewModal()" style="margin-left:4px;">🎁 Gia Hạn Ngay</button>';

    if (banner) {
      if (bannerIcon) bannerIcon.textContent = '⛔';
      if (bannerExactTime) bannerExactTime.textContent = exactFormatted;
      if (bannerCountdown) {
        bannerCountdown.textContent = 'ĐÃ HẾT HẠN (Tạm dừng dịch vụ)';
        bannerCountdown.style.color = 'var(--red)';
      }
      banner.style.background = 'rgba(239,68,68,0.15)';
      banner.style.borderColor = 'rgba(239,68,68,0.4)';
    }
    return;
  }

  badge.style.display = 'inline-flex';
  badge.style.background = countdown.color === 'var(--green)' ? 'rgba(16,185,129,0.15)' : (countdown.color === 'var(--yellow)' ? 'rgba(234,179,8,0.15)' : 'rgba(239,68,68,0.2)');
  badge.style.color = countdown.color;
  badge.style.border = '1px solid ' + (countdown.color === 'var(--green)' ? 'rgba(16,185,129,0.3)' : (countdown.color === 'var(--yellow)' ? 'rgba(234,179,8,0.3)' : 'rgba(239,68,68,0.4)'));
  badge.innerHTML = '<span>⏳ Hạn thuê: <b>' + countdown.text + '</b> (' + exactFormatted + ')</span><button class="small" onclick="openRenewModal()" style="margin-left:4px;">🎁 Gia Hạn</button>';

  if (banner) {
    if (bannerIcon) bannerIcon.textContent = '⏳';
    if (bannerExactTime) bannerExactTime.textContent = exactFormatted;
    if (bannerCountdown) {
      bannerCountdown.textContent = countdown.text;
      bannerCountdown.style.color = countdown.color;
    }
    banner.style.background = 'rgba(30,41,59,0.7)';
    banner.style.borderColor = 'rgba(59,130,246,0.35)';
  }
}
window.formatFullDateTime = formatFullDateTime;
window.formatRentalCountdown = formatRentalCountdown;
window.updateUserHeaderCountdown = updateUserHeaderCountdown;

let detailLastRevMap = new Map();

async function refreshDetail(force=false) {
  if(selectedBotId===null) return;
  if(detailRequestInFlight){
    if(force) detailRefreshQueued=true;
    return;
  }

  const requestGeneration = detailRefreshGeneration;
  const requestBotId = selectedBotId;
  detailRequestInFlight=true;

  const isCurrentRequest = () =>
    requestGeneration === detailRefreshGeneration &&
    requestBotId === selectedBotId;

  try {
    const lastRev = detailLastRevMap.get(requestBotId);
    const snapshotPath = (!force && lastRev)
      ? ('/snapshot?rev=' + encodeURIComponent(lastRev))
      : '/snapshot';
    const snapshot=await detailGet(snapshotPath);
    if(!isCurrentRequest()) return;

    if(snapshot && snapshot.unchanged){
      uptimeSyncAt=Date.now();
      updateDetailUptime();
      await loadDetailLogs(force, requestGeneration, requestBotId);
      if(!isCurrentRequest()) return;
      await loadDetailChat(force, requestGeneration, requestBotId);
      return;
    }

    if(snapshot && snapshot.rev){
      detailLastRevMap.set(requestBotId, snapshot.rev);
    }

    if(snapshot && snapshot.bot){
      detailBot=snapshot.bot;
      detailInventory=snapshot.inventory||null;
      if(!detailSettingsDirty && snapshot.settings) renderDetailSettings(snapshot.settings);
      if(!detailAutoChatDirty && Array.isArray(snapshot.autoChatSchedules)) renderDetailAutoChatSchedules(snapshot.autoChatSchedules);
      if(!detailBotScheduleDirty && Array.isArray(snapshot.botSchedules)) renderDetailBotSchedules(snapshot.botSchedules);
    } else {
      const fallbackBot=await detailGet('/state');
      if(!isCurrentRequest()) return;
      const fallbackInventory=await detailGet('/inventory');
      if(!isCurrentRequest()) return;
      const settingsData=await detailGet('/settings');
      if(!isCurrentRequest()) return;
      const autoChatData=await detailGet('/autoChat');
      if(!isCurrentRequest()) return;
      const scheduleData=await detailGet('/botSchedules');
      if(!isCurrentRequest()) return;
      detailBot=fallbackBot;
      detailInventory=fallbackInventory;
      if(!detailSettingsDirty) renderDetailSettings(settingsData);
      if(!detailAutoChatDirty) renderDetailAutoChatSchedules(autoChatData.autoChatSchedules||[]);
      if(!detailBotScheduleDirty) renderDetailBotSchedules(scheduleData.botSchedules||[]);
    }

    if(!isCurrentRequest()) return;
    if (detailBot) {
      const bIdx = bots.findIndex(b => Number(b.id) === Number(requestBotId));
      if (bIdx !== -1) {
        bots[bIdx] = { ...bots[bIdx], ...detailBot };
        if (typeof renderHome === 'function') renderHome();
      }
    }
    uptimeSyncAt=Date.now();
    detailStatusHtml();
    renderDetailInventory();
    await loadDetailLogs(force, requestGeneration, requestBotId);
    if(!isCurrentRequest()) return;
    await loadDetailChat(force, requestGeneration, requestBotId);
    if(!isCurrentRequest()) return;
    await loadDetailPositionHistory(force, requestGeneration, requestBotId);
  } catch(err) {
    if(!isCurrentRequest()) return;
    if(err && err.status===404){
      showToast('Bot này không còn tồn tại trong Manager.');
      goHome();
      return;
    }
    if(
      err &&
      err.status===503 &&
      err.data &&
      err.data.label
    ) {
      detailBot=err.data;
      uptimeSyncAt=Date.now();
      detailStatusHtml();
    }
  } finally {
    detailRequestInFlight=false;
    if(detailRefreshQueued && selectedBotId!==null){detailRefreshQueued=false;void refreshDetail(true);}
  }
}

function nearBottom(box){return box.scrollHeight-box.scrollTop-box.clientHeight<24;}

async function loadDetailLogs(force=false, expectedGeneration=detailRefreshGeneration, expectedBotId=selectedBotId) {
  if(eventLoading) return;
  const currentBotRev = (detailBot && detailBot.logRevision !== undefined && detailBot.logRevision !== null)
    ? Number(detailBot.logRevision)
    : null;
  if(!force && currentBotRev !== null && Number.isFinite(currentBotRev) && lastEventRevision === currentBotRev) return;
  eventLoading=true;
  try {
    const data=await detailGet('/logs');
    if(!currentUser || (expectedGeneration!==null && (expectedGeneration!==detailRefreshGeneration || expectedBotId!==selectedBotId))) return;
    const box=document.getElementById('detailEventLogs');
    const sel = typeof window.getSelection === 'function' ? window.getSelection() : null;
    if (!force && sel && sel.rangeCount > 0 && !sel.isCollapsed && box?.contains(sel.anchorNode)) {
      return;
    }
    const keep=nearBottom(box);
    function formatLogLineHtml(line) {
      if (!line) return '';
      let cls = 'line';
      const lower = line.toLowerCase();
      if (lower.includes('[lỗi]') || lower.includes('[error]') || lower.includes('lỗi') || lower.includes('❌')) {
        cls += ' line-error';
      } else if (lower.includes('[cảnh báo]') || lower.includes('[warn]') || lower.includes('warning') || lower.includes('⚠️')) {
        cls += ' line-warn';
      } else if (lower.includes('[totem]') || lower.includes('⚡')) {
        cls += ' line-flow';
      } else if (lower.includes('[afk]') || lower.includes('✅') || lower.includes('🎉')) {
        cls += ' line-success';
      } else if (lower.includes('[vào cụm]') || lower.includes('[flow]') || lower.includes('[gui]') || lower.includes('[menu]') || lower.includes('🎯')) {
        cls += ' line-flow';
      } else if (lower.includes('[chat]') || lower.includes('[tin nhắn]')) {
        cls += ' line-chat';
      }

      const timeMatch = line.match(/^(\d{2}:\d{2}:\d{2})\s*(.*)$/);
      if (timeMatch) {
        return '<div class="' + cls + '"><span class="line-time">' + escapeHtml(timeMatch[1]) + '</span>' + escapeHtml(timeMatch[2]) + '</div>';
      }
      return '<div class="' + cls + '">' + escapeHtml(line) + '</div>';
    }
    const lines = Array.isArray(data?.logs) ? data.logs : [];
    const newHtml = lines.length > 0
      ? lines.map(formatLogLineHtml).join('')
      : '<div class="empty" style="color:var(--muted);padding:8px;font-style:italic;">Chưa có nhật ký sự kiện.</div>';
    if (box && box.innerHTML !== newHtml) {
      box.innerHTML = newHtml;
    }
    lastEventRevision = (currentBotRev !== null && Number.isFinite(currentBotRev))
      ? currentBotRev
      : Number(data.revision || 0);
    if(keep && box) box.scrollTop=box.scrollHeight;
  } finally {eventLoading=false;}
}

async function loadDetailChat(force=false, expectedGeneration=detailRefreshGeneration, expectedBotId=selectedBotId) {
  if(chatLoading) return;
  const currentChatRev = (detailBot && detailBot.chatLogRevision !== undefined && detailBot.chatLogRevision !== null)
    ? Number(detailBot.chatLogRevision)
    : null;
  if(!force && currentChatRev !== null && Number.isFinite(currentChatRev) && lastChatRevision >= 0 && lastChatRevision === currentChatRev) return;
  chatLoading=true;
  try {
    const data=await detailGet('/chat-logs');
    if(!currentUser || (expectedGeneration!==null && (expectedGeneration!==detailRefreshGeneration || expectedBotId!==selectedBotId))) return;
    const box=document.getElementById('detailChatLogs');
    const sel = typeof window.getSelection === 'function' ? window.getSelection() : null;
    if (!force && sel && sel.rangeCount > 0 && !sel.isCollapsed && box?.contains(sel.anchorNode)) {
      return;
    }
    const keep=nearBottom(box);
    function formatChatLineHtml(line) {
      if (!line) return '';
      let cls = 'line line-chat';
      const timeMatch = line.match(/^(\d{2}:\d{2}:\d{2})\s*(.*)$/);
      const timePart = timeMatch ? timeMatch[1] : '';
      let rest = timeMatch ? timeMatch[2] : line;

      let innerHtml = '';
      if (timePart) {
        innerHtml += '<span class="line-time">' + escapeHtml(timePart) + '</span>';
      }

      // 1. Tin nhắn lệnh / outgoing do bot gửi: "→ /menu"
      if (rest.startsWith('→') || rest.includes('→ /')) {
        cls += ' line-outgoing';
        innerHtml += '<span class="chat-outgoing">' + escapeHtml(rest) + '</span>';
      }
      // 2. Tin nhắn Role | Player: "VIP | Alex: hello" hoặc "[VIP] Alex: hello"
      else if (/^\[?([^\]|]+)[\]|]\s*([A-Za-z0-9_]{1,16})\s*[:»]\s*(.+)$/u.test(rest)) {
        const m = rest.match(/^\[?([^\]|]+)[\]|]\s*([A-Za-z0-9_]{1,16})\s*[:»]\s*(.+)$/u);
        const role = m[1].trim();
        const user = m[2].trim();
        const msg = m[3].trim();
        innerHtml += '<span class="chat-badge">' + escapeHtml(role) + '</span> ' +
                     '<span class="chat-sender">' + escapeHtml(user) + ':</span> ' +
                     '<span class="chat-text">' + escapeHtml(msg) + '</span>';
      }
      // 3. Tin nhắn người chơi chuẩn vanilla: "<Player> hello"
      else if (/^<([A-Za-z0-9_]{1,16})>\s*(.+)$/u.test(rest)) {
        const m = rest.match(/^<([A-Za-z0-9_]{1,16})>\s*(.+)$/u);
        const user = m[1].trim();
        const msg = m[2].trim();
        innerHtml += '<span class="chat-sender">&lt;' + escapeHtml(user) + '&gt;</span> ' +
                     '<span class="chat-text">' + escapeHtml(msg) + '</span>';
      }
      // 4. Tin nhắn hệ thống server: "[HỆ THỐNG] ..." hoặc "[Server] ..."
      else if (rest.startsWith('[HỆ THỐNG]') || rest.startsWith('[Server]') || rest.startsWith('Server:')) {
        cls += ' line-server';
        const cleanMsg = rest.replace(/^(\[HỆ THỐNG\]|\[Server\]|Server:)\s*/, '');
        innerHtml += '<span class="chat-server-badge">HỆ THỐNG</span> ' +
                     '<span class="chat-server-text">' + escapeHtml(cleanMsg) + '</span>';
      }
      // 5. Mặc định
      else {
        innerHtml += '<span class="chat-text">' + escapeHtml(rest) + '</span>';
      }

      return '<div class="' + cls + '">' + innerHtml + '</div>';
    }
    const lines = Array.isArray(data?.logs) ? data.logs : [];
    const newHtml = lines.length > 0
      ? lines.map(formatChatLineHtml).join('')
      : '<div class="empty" style="color:var(--muted);padding:8px;font-style:italic;">Chưa có tin nhắn nào.</div>';
    if (box && box.innerHTML !== newHtml) {
      box.innerHTML = newHtml;
    }
    lastChatRevision = (currentChatRev !== null && Number.isFinite(currentChatRev))
      ? currentChatRev
      : Number(data.revision || 0);
    if(keep && box) box.scrollTop=box.scrollHeight;
  } finally {chatLoading=false;}
}

async function loadDetailPositionHistory(force=false, expectedGeneration=detailRefreshGeneration, expectedBotId=selectedBotId) {
  const box=document.getElementById('detailPositionHistory');
  if(!box) return;
  if(!force && Date.now()-lastPositionHistoryFetchedAt<15000) return;
  lastPositionHistoryFetchedAt=Date.now();
  try {
    const data=await detailGet('/position-logs?limit=10');
    if(!currentUser || (expectedGeneration!==null && (expectedGeneration!==detailRefreshGeneration || expectedBotId!==selectedBotId))) return;
    const positionText=value => value && [value.x,value.y,value.z].every(v=>v!==null && v!==undefined && Number.isFinite(Number(v)))
      ? ('X ' + Math.round(Number(value.x)) + ', Y ' + Math.round(Number(value.y)) + ', Z ' + Math.round(Number(value.z)))
      : '--';
    const rows=Array.isArray(data.logs)?data.logs.slice().reverse():[];
    box.innerHTML=rows.length?rows.map(row=>{
      const when=row.changed_at?new Date(row.changed_at).toLocaleString('vi-VN',{hour12:false}):'--';
      const fromDimension=String(row.from_dimension||'unknown').replace(/^minecraft:/,'');
      const toDimension=String(row.to_dimension||'unknown').replace(/^minecraft:/,'');
      return '<div style="border-bottom:1px solid var(--border);padding:4px 0;"><span style="color:var(--muted);">'+escapeHtml(when)+'</span> · '+escapeHtml(positionText(row.from_position))+' ('+escapeHtml(fromDimension)+') → '+escapeHtml(positionText(row.to_position))+' ('+escapeHtml(toDimension)+') · '+escapeHtml(row.reason||'MOVE')+' · '+escapeHtml(row.location_state||'Unknown')+'</div>';
    }).join(''):'Chưa có lịch sử tọa độ.';
    lastPositionHistoryRevision=Number(data.revision||0);
    lastPositionHistoryFetchedAt=Date.now();
  } catch(err) {
    if(expectedGeneration===detailRefreshGeneration && expectedBotId===selectedBotId) box.textContent='Không tải được lịch sử tọa độ: '+(err.message||'lỗi Supabase');
  }
}

function itemLabel(item) {
  if(!item) return '-';
  const name=item.displayName||item.name||'-';
  const count=Number(item.count||0);
  return String(name).replace(/_/g,' ')+(count>1?' x'+count:'');
}

let selectedDetailMoveSlot = null;

function updateDetailTouchHint() {
  let hintEl = document.getElementById('detailTouchHint');
  if (!hintEl) {
    const invGrid = document.getElementById('detailInventory');
    if (invGrid && invGrid.parentNode) {
      hintEl = document.createElement('div');
      hintEl.id = 'detailTouchHint';
      hintEl.className = 'touch-move-hint';
      invGrid.parentNode.insertBefore(hintEl, invGrid);
    }
  }
  if (!hintEl) return;
  if (selectedDetailMoveSlot === null) {
    hintEl.style.display = 'none';
    hintEl.innerHTML = '';
  } else {
    const item = detailInventory?.slots?.[String(selectedDetailMoveSlot)];
    const label = item ? itemLabel(item) : 'ô #' + selectedDetailMoveSlot;
    hintEl.style.display = 'flex';
    hintEl.innerHTML = '<span>⚡ Đang chọn <strong>' + escapeHtml(label) + '</strong>. Chạm ô khác để chuyển, chạm ô Trang bị để mặc, hoặc chạm vùng Vứt đồ.</span><button type="button" class="small" onclick="cancelDetailSlotSelection(event)" style="padding:2px 8px;margin-left:8px;">Hủy</button>';
  }
}

function cancelDetailSlotSelection(e) {
  if (e && typeof e.stopPropagation === 'function') e.stopPropagation();
  selectedDetailMoveSlot = null;
  document.querySelectorAll('#detailPage .inventory-slot.selected-for-move, #detailPage .equipment-slot.selected-for-move').forEach(function(el) {
    el.classList.remove('selected-for-move');
  });
  updateDetailTouchHint();
}

function handleDetailSlotClick(slot, item, e) {
  if (selectedDetailMoveSlot === null) {
    if (!item) {
      if (slot >= 36 && slot <= 44) selectDetailHotbar(slot - 36);
      return;
    }
    selectedDetailMoveSlot = slot;
    document.querySelectorAll('#detailPage .inventory-slot.selected-for-move, #detailPage .equipment-slot.selected-for-move').forEach(function(el) {
      el.classList.remove('selected-for-move');
    });
    const targetEl = document.querySelector('#detailPage .inventory-slot[data-slot="' + slot + '"]');
    if (targetEl) targetEl.classList.add('selected-for-move');
    if (slot >= 36 && slot <= 44) selectDetailHotbar(slot - 36);
    updateDetailTouchHint();
    return;
  }

  if (selectedDetailMoveSlot === slot) {
    cancelDetailSlotSelection(e);
    return;
  }

  const fromSlot = selectedDetailMoveSlot;
  cancelDetailSlotSelection(e);
  void moveDetailItem(fromSlot, slot);
}

function handleDetailEquipmentClick(dest) {
  if (selectedDetailMoveSlot !== null) {
    const fromSlot = selectedDetailMoveSlot;
    cancelDetailSlotSelection();
    void equipDetailItem(fromSlot, dest);
  }
}

function handleDetailDropZoneClick() {
  if (selectedDetailMoveSlot !== null) {
    const fromSlot = selectedDetailMoveSlot;
    cancelDetailSlotSelection();
    if (detailInventoryBusy || !detailInventory) return;
    detailInventoryBusy = true;
    detailPost('/inventory/drop', { sourceSlot: fromSlot, revision: detailInventory.revision }).then(function(result) {
      if (result.data?.inventory) { detailInventory = result.data.inventory; renderDetailInventory(); }
      showToast(result.data?.message || result.data?.error || 'Đã xử lý.');
      if (!result.ok) refreshDetail(true);
    }).finally(function() {
      detailInventoryBusy = false;
    });
  }
}

function createDetailSlot(item,slot,selected) {
  const el=document.createElement('div');
  el.className='inventory-slot'+(selected?' selected':'')+(!item?' empty':'');
  el.draggable=!!item;
  el.dataset.slot=String(slot);
  el.ondragstart=function(e){detailDragged={type:'slot',slot};try{e.dataTransfer.setData('text/plain',String(slot));e.dataTransfer.effectAllowed='move';}catch(_) {}};
  el.ondragover=allowDrop;
  el.ondragleave=clearDragOver;
  el.ondrop=function(e){dropDetailInventory(e,slot);};
  el.onclick=function(e){handleDetailSlotClick(slot,item,e);};
  const idx=document.createElement('div');idx.className='slot-index';idx.textContent=slot>=36?String(slot-35):String(slot-8);
  const name=document.createElement('div');name.className='slot-name';name.textContent=itemLabel(item);
  const count=document.createElement('div');count.className='slot-count';count.textContent=item&&Number(item.count||0)>1?String(item.count):'';
  el.appendChild(idx);el.appendChild(name);el.appendChild(count);return el;
}

function renderDetailInventory(){
  if(!detailInventory) return;
  const dSlots = detailInventory.slots || [];
  let usedCount = 0;
  for (let i = 9; i <= 44; i++) {
    if (dSlots[i]) usedCount++;
  }
  const capPercent = Math.round((usedCount / 36) * 100);
  const capEl = document.getElementById('detailInventoryCapacity');
  if (capEl) {
    capEl.textContent = usedCount + '/36 ô (' + capPercent + '%)';
    capEl.className = 'capacity-badge' + (capPercent >= 90 ? ' danger' : capPercent >= 75 ? ' warning' : '');
  }
  const health=Math.max(0,Math.min(20,Number(detailInventory.health||0)));
  const food=Math.max(0,Math.min(20,Number(detailInventory.food||0)));
  document.getElementById('detailHealth').textContent=health.toFixed(1)+' / 20';
  document.getElementById('detailFood').textContent=String(food)+' / 20';
  document.getElementById('detailHealthBar').style.width=(health/20*100)+'%';
  document.getElementById('detailFoodBar').style.width=(food/20*100)+'%';
  document.getElementById('detailGolden').textContent=String(detailInventory.goldenAppleCount||0);
  document.getElementById('detailTotem').textContent=String(detailInventory.totemCount||0);
  document.getElementById('detailOffhand').textContent=String(detailInventory.offhand||'-').replace(/_/g,' ');
  document.getElementById('detailFoodCount').textContent=String(detailInventory.foodCount||0);
  document.getElementById('detailInventoryRevision').textContent='revision '+String(detailInventory.revision||0);
  const armor=detailInventory.armor||{};
  document.getElementById('equipHead').textContent=itemLabel(armor.head);
  document.getElementById('equipTorso').textContent=itemLabel(armor.torso);
  document.getElementById('equipLegs').textContent=itemLabel(armor.legs);
  document.getElementById('equipFeet').textContent=itemLabel(armor.feet);
  const off=detailInventory.slots?detailInventory.slots['45']:null;
  document.getElementById('equipOffhand').textContent=itemLabel(off);

  const slots=detailInventory.slots||{};
  const invBox=document.getElementById('detailInventory');invBox.innerHTML='';
  for(let slot=9;slot<=35;slot++) invBox.appendChild(createDetailSlot(slots[String(slot)]||null,slot,false));
  const hotBox=document.getElementById('detailHotbar');hotBox.innerHTML='';
  const selected=Number(detailInventory.selectedHotbar??detailInventory.selectedSlot??0);
  for(let slot=36;slot<=44;slot++) hotBox.appendChild(createDetailSlot(slots[String(slot)]||null,slot,slot-36===selected));
}

function allowDrop(event){
  event.preventDefault();
  try{event.dataTransfer.dropEffect='move';}catch(_){}
  if(event.currentTarget&&event.currentTarget.classList) event.currentTarget.classList.add('dragover');
}
function clearDragOver(event){if(event.currentTarget&&event.currentTarget.classList) event.currentTarget.classList.remove('dragover');}
function startEquipmentDrag(event,destination){
  const map={head:5,torso:6,legs:7,feet:8,'off-hand':45};
  detailDragged={type:'slot',slot:map[destination],equipment:destination};
  try{event.dataTransfer.setData('text/plain',String(map[destination]));event.dataTransfer.effectAllowed='move';}catch(_){}
}
function dropDetailInventory(event,destinationSlot){
  event.preventDefault();clearDragOver(event);
  let source=detailDragged&&detailDragged.slot;
  try{const value=event.dataTransfer.getData('text/plain');if(value!=='') source=Number(value);}catch(_){}
  detailDragged=null;
  if(!Number.isInteger(source)||source===destinationSlot) return;
  if(source>=5&&source<=8) {const map={5:'head',6:'torso',7:'legs',8:'feet'};unequipAndMove(map[source],destinationSlot);return;}
  if(source===45){unequipAndMove('off-hand',destinationSlot);return;}
  moveDetailItem(source,destinationSlot);
}
async function unequipAndMove(destination,slot){
  showToast('Đang tháo trang bị...');
  // BUG-22: Worker /inventory/unequip kiểm tra inventory revision và trả 409 khi
  // revision thiếu/sai. Gửi revision đúng từ snapshot; nếu 409 (dữ liệu đã đổi) thì
  // refresh từ response của worker rồi thử lại đúng 1 lần.
  let result=await detailPost('/inventory/unequip',{destination,revision:detailInventory?detailInventory.revision:0});
  if(!result.ok&&result.status===409&&result.data?.inventory){
    detailInventory=result.data.inventory;
    renderDetailInventory();
    result=await detailPost('/inventory/unequip',{destination,revision:detailInventory.revision});
  }
  if(!result.ok){showToast(result.data?.error||'Không thể tháo trang bị.');await refreshDetail(true);return;}
  await refreshDetail(true);
  if(!detailInventory) return;
  const targetSlot = result.data?.unequippedToSlot ?? result.data?.slot;
  if(Number.isInteger(targetSlot) && targetSlot !== slot){
    await moveDetailItem(targetSlot, slot);
  } else {
    let found=null;
    const slots=detailInventory.slots||{};
    for(let s=9;s<=35;s++){
      const item=slots[String(s)];
      if(item&&item.name){found={slot:s,item};break;}
    }
    if(found&&slot!==found.slot){await moveDetailItem(found.slot,slot);}
  }
}
async function moveDetailItem(sourceSlot,destSlot){
  if(detailInventoryBusy||!detailInventory) return;
  detailInventoryBusy=true;
  try{
    const result=await detailPost('/inventory/move',{sourceSlot,destSlot,revision:detailInventory.revision});
    if(result.data?.inventory){detailInventory=result.data.inventory;renderDetailInventory();}
    if(!result.ok){showToast(result.data?.error||'Di chuyển thất bại.');await refreshDetail(true);return;}
    showToast(result.data?.message||'Đã di chuyển item.');
  } finally {detailInventoryBusy=false;}
}
async function dropDetailItemToWorld(event){
  event.preventDefault();clearDragOver(event);
  let source=detailDragged&&detailDragged.slot;
  try{const value=event.dataTransfer.getData('text/plain');if(value!=='') source=Number(value);}catch(_){}
  detailDragged=null;
  if(!Number.isInteger(source)) return;
  if(source>=5&&source<=8){await unequipDetail({head:'head',torso:'torso',legs:'legs',feet:'feet'}[getEquipmentNameBySlot(source)]||'head');return;}
  if(source===45){await unequipDetail('off-hand');return;}
  if(detailInventoryBusy||!detailInventory) return;
  detailInventoryBusy=true;
  try{
    const result=await detailPost('/inventory/drop',{sourceSlot:source,revision:detailInventory.revision});
    if(result.data?.inventory){detailInventory=result.data.inventory;renderDetailInventory();}
    showToast(result.data?.message||result.data?.error||'Đã xử lý.');
    if(!result.ok) await refreshDetail(true);
  } finally {detailInventoryBusy=false;}
}
function getEquipmentNameBySlot(slot){return slot===5?'head':slot===6?'torso':slot===7?'legs':'feet';}
async function dropEquip(event,destination){
  event.preventDefault();clearDragOver(event);
  let source=detailDragged&&detailDragged.slot;
  try{const value=event.dataTransfer.getData('text/plain');if(value!=='') source=Number(value);}catch(_){}
  detailDragged=null;
  if(!Number.isInteger(source)||source===45&&destination==='off-hand') return;
  if(source>=5&&source<=8||source===45){showToast('Không thể lấy item từ equipment để equip vào chính equipment.');return;}
  await equipDetailItem(source,destination);
}
async function equipDetailItem(sourceSlot,destination){
  if(detailInventoryBusy||!detailInventory)return;
  detailInventoryBusy=true;
  try{
    const result=await detailPost('/inventory/equip',{sourceSlot,destination,revision:detailInventory.revision});
    if(result.data?.inventory){detailInventory=result.data.inventory;renderDetailInventory();}
    showToast(result.data?.message||result.data?.error||'Đã xử lý.');
    if(!result.ok) await refreshDetail(true);
  } finally {detailInventoryBusy=false;}
}
async function unequipDetail(destination){
  if(detailInventoryBusy||!detailInventory)return;
  detailInventoryBusy=true;
  try{
    const result=await detailPost('/inventory/unequip',{destination,revision:detailInventory.revision});
    if(result.data?.inventory){detailInventory=result.data.inventory;renderDetailInventory();}
    showToast(result.data?.message||result.data?.error||'Đã xử lý.');
    if(!result.ok) await refreshDetail(true);
  } finally {detailInventoryBusy=false;}
}
async function selectDetailHotbar(slot){
  if(detailInventoryBusy||!detailInventory)return;
  detailInventoryBusy=true;
  try{
    const result=await detailPost('/inventory/select',{slot,revision:detailInventory.revision});
    if(result.data?.inventory){detailInventory=result.data.inventory;renderDetailInventory();}
    showToast(result.data?.message||result.data?.error||'Đã xử lý.');
    if(!result.ok) await refreshDetail(true);
  } finally {detailInventoryBusy=false;}
}

function renderDetailSettings(data){
  const settings=data?.settings||data||{};
  const eco=document.getElementById('detailSettingEcoMode');
  const a=document.getElementById('detailSettingAutoTotem');
  const h=document.getElementById('detailSettingAntiHungry');
  const r=document.getElementById('detailSettingAutoReconnect');
  const k=document.getElementById('detailSettingAntiAfkKick');
  const sp=document.getElementById('detailSpawnCommands');

  if(eco&&!detailSettingsDirty)eco.checked=settings.ecoMode!==false;
  if(a&&!detailSettingsDirty)a.checked=settings.autoTotem!==false;
  if(h&&!detailSettingsDirty)h.checked=settings.antiHungry!==false;
  if(r&&!detailSettingsDirty)r.checked=settings.autoReconnect!==false;
  if(k&&!detailSettingsDirty)k.checked=settings.antiAfkKick!==false;
  // BUG-24: Worker hỗ trợ spawnCommands nhưng trang Detail trước đây không có field →
  // renderer/save bỏ qua. Với user không đủ quyền, worker trả '********' (masked);
  // giữ nguyên khi lưu để không ghi đè cấu hình cũ.
  if(sp&&!detailSettingsDirty)sp.value=typeof settings.spawnCommands==='string'?settings.spawnCommands:'';
}

function renderDetailAutoChatSchedules(schedules){
  detailAutoChatSchedules=Array.isArray(schedules)?schedules:[];
  const box=document.getElementById('detailAutoChatSchedules');
  if(!box)return;
  if(!detailAutoChatSchedules.length){box.innerHTML='<div class="note">Chưa có lịch Auto Chat. Bấm “＋ Thêm” để tạo.</div>';return;}

  box.innerHTML=detailAutoChatSchedules.map((s,i)=>{
    const fixed=s.mode==='fixed';
    return '<div class="schedule-row" draggable="true" data-index="'+i+'" data-id="'+escapeHtml(String(s.id||Date.now()+'-'+i))+'" ondragstart="dragDetailAutoChat(event,'+i+')" ondragover="allowDetailAutoChatDrop(event)" ondrop="dropDetailAutoChat(event,'+i+')" ondragend="endDetailScheduleDrag(this)">'+
      '<div class="schedule-row-top">'+
        '<div class="schedule-handle" title="Kéo để sắp xếp">⋮⋮</div>'+
        '<div class="schedule-row-title">Lịch #'+(i+1)+'</div>'+
        '<label class="check-row" style="margin:0;padding:5px 7px;"><input data-field="enabled" type="checkbox"'+(s.enabled!==false?' checked':'')+'> <span>Bật</span></label>'+
        '<button class="small danger" type="button" onclick="removeDetailAutoChatSchedule('+i+')">Xóa</button>'+
      '</div>'+
      '<div class="schedule-inline" style="margin-top:7px;">'+
        '<select data-field="mode" onchange="detailScheduleModeChanged(this)"><option value="interval"'+(!fixed?' selected':'')+'>Lặp lại</option><option value="fixed"'+(fixed?' selected':'')+'>Giờ cố định</option></select>'+
        (fixed
          ? '<input data-field="times" style="width:min(100%,280px);" value="'+escapeHtml((s.times||[]).join(', '))+'" placeholder="08:00, 12:00, 18:00">'
          : '<input data-field="intervalSeconds" class="minutes-input" type="number" min="10" max="604800" value="'+clampClientNumber(s.intervalSeconds,3600,10,604800)+'" title="Khoảng lặp (giây)">')+
        '<input data-field="messageDelaySeconds" class="minutes-input" type="number" min="0" max="3600" value="'+clampClientNumber(s.messageDelaySeconds,2,0,3600)+'" title="Delay giữa các tin (giây)"><span class="schedule-meta">Delay tin (s)</span>'+
      '</div>'+
      '<div class="schedule-row-main"><label class="schedule-field"><span>Tin nhắn — mỗi dòng một tin</span><textarea data-field="messages" placeholder="Tin 1&#10;Tin 2&#10;Tin 3">'+escapeHtml((s.messages||[]).join('\n'))+'</textarea></label><div class="schedule-meta" style="padding-bottom:6px;"><span>'+ (fixed?'Theo giờ':'Theo khoảng lặp') +'</span></div></div>'+
    '</div>';
  }).join('');
}

function detailScheduleModeChanged(select){const current=collectDetailAutoChatSchedules();const index=Number(select?.closest('.schedule-row')?.dataset.index??-1);if(current[index]){if(current[index].mode==='fixed'&&!current[index].times.length)current[index].times=['08:00'];if(current[index].mode==='interval'&&!Number.isFinite(Number(current[index].intervalSeconds)))current[index].intervalSeconds=3600;}detailAutoChatDirty=true;renderDetailAutoChatSchedules(current);}
function collectDetailAutoChatSchedules(){
  const box=document.getElementById('detailAutoChatSchedules'); if(!box)return [];
  return [...box.querySelectorAll('.schedule-row')].map((row,i)=>{
    const get=f=>row.querySelector('[data-field="'+f+'"]');
    const mode=get('mode')?.value==='fixed'?'fixed':'interval';
    return {id:row.dataset.id||detailAutoChatSchedules[i]?.id||(Date.now()+'-'+i),enabled:!!get('enabled')?.checked,mode,intervalSeconds:clampClientNumber(get('intervalSeconds')?.value,3600,10,604800),times:String(get('times')?.value||'').split(/[,\n]+/).map(x=>x.trim()).filter(Boolean),messages:String(get('messages')?.value||'').split(/\r?\n/).map(x=>x.trim()).filter(Boolean),messageDelaySeconds:clampClientNumber(get('messageDelaySeconds')?.value,2,0,3600)};
  });
}
function validateDetailAutoChatSchedules(schedules){
  const re=/^([01]\d|2[0-3]):[0-5]\d$/;
  for(let i=0;i<schedules.length;i++){const s=schedules[i];if(!s.messages.length)return 'Lịch #'+(i+1)+' chưa có tin nhắn.';if(s.mode==='fixed'){if(!s.times.length)return 'Lịch #'+(i+1)+' chưa có giờ cố định.';for(const t of s.times)if(!re.test(t))return 'Lịch #'+(i+1)+' có giờ không hợp lệ: '+t;}}
  return '';
}
function addDetailAutoChatSchedule(){if(detailAutoChatSaveInFlight)return;const data=collectDetailAutoChatSchedules();data.push({id:Date.now()+'-'+Math.random().toString(36).slice(2,8),enabled:true,mode:'interval',intervalSeconds:3600,times:[],messages:[''],messageDelaySeconds:2});detailAutoChatDirty=true;renderDetailAutoChatSchedules(data);document.getElementById('detailAutoChatSchedules')?.lastElementChild?.querySelector('[data-field="messages"]')?.focus();}
function removeDetailAutoChatSchedule(index){if(detailAutoChatSaveInFlight)return;const data=collectDetailAutoChatSchedules();data.splice(index,1);detailAutoChatDirty=true;renderDetailAutoChatSchedules(data);}
let draggedDetailAutoChatIndex=null;
function dragDetailAutoChat(event,index){draggedDetailAutoChatIndex=index;event.dataTransfer.effectAllowed='move';event.dataTransfer.setData('text/plain',String(index));event.currentTarget.classList.add('dragging');}
function allowDetailAutoChatDrop(event){event.preventDefault();event.dataTransfer.dropEffect='move';}
function dropDetailAutoChat(event,targetIndex){event.preventDefault();const from=draggedDetailAutoChatIndex;draggedDetailAutoChatIndex=null;if(!Number.isInteger(from)||from===targetIndex)return;const data=collectDetailAutoChatSchedules();const [moved]=data.splice(from,1);data.splice(targetIndex,0,moved);detailAutoChatDirty=true;renderDetailAutoChatSchedules(data);}
function endDetailScheduleDrag(element){if(element)element.classList.remove('dragging');draggedDetailAutoChatIndex=null;draggedDetailBotScheduleIndex=null;}

function detailDefaultFixedTime(index){const i=Number(index||0);if(i===0)return '04:30';if(i===1)return '05:30';const hour=(6+(i-2)*3)%24;return String(hour).padStart(2,'0')+':00';}
// BUG-21: Worker sanitizer chấp nhận action 'command' (+ trường command). Trước đây
// normalize chỉ cho start/stop nên action 'command' bị âm thầm đổi thành 'stop' khi
// Admin mở trang Detail và lưu lại. Giữ nguyên action/command để không phá cấu hình.
function normalizeDetailBotScheduleAction(item){
  return item?.action==='start'?'start':(item?.action==='command'?'command':'stop');
}
function normalizeDetailBotScheduler(schedules){
  const raw=Array.isArray(schedules)?schedules[0]:null;
  if(!raw)return{id:String(Date.now()),enabled:true,mode:'fixed',items:[
    {id:'default-stop-0430',action:'stop',time:'04:30'},
    {id:'default-start-0530',action:'start',time:'05:30'}
  ]};
  const mode=raw.mode==='cycle'?'cycle':'fixed';
  let items=Array.isArray(raw.items)?raw.items.slice():[];
  if(!items.length&&Array.isArray(schedules))items=schedules.filter(s=>(s.mode==='cycle'?'cycle':'fixed')===mode).flatMap(s=>mode==='fixed'?[{id:s.id,action:s.action,time:s.time}]:[{id:String(s.id||'')+'-stop',action:'stop',afterMinutes:clampClientNumber(s.offAfterMinutes,120,1,43200)},{id:String(s.id||'')+'-start',action:'start',afterMinutes:clampClientNumber(s.onAfterMinutes,300,1,43200)}]);
  if(!items.length&&mode==='fixed'){
    items=[
      {id:'default-stop-0430',action:'stop',time:'04:30'},
      {id:'default-start-0530',action:'start',time:'05:30'}
    ];
  }
  return{id:String(raw.id||Date.now()),enabled:raw.enabled!==false,mode,items:items.map((item,i)=>mode==='fixed'
    ?{id:String(item.id||Date.now()+'-'+i),action:normalizeDetailBotScheduleAction(item),time:String(item.time||(i===0?'04:30':(i===1?'05:30':'04:30'))),...(normalizeDetailBotScheduleAction(item)==='command'?{command:String(item.command||'')}:{})}
    :{id:String(item.id||Date.now()+'-'+i),action:normalizeDetailBotScheduleAction(item),afterMinutes:clampClientNumber(item.afterMinutes,i===0?120:300,1,43200),...(normalizeDetailBotScheduleAction(item)==='command'?{command:String(item.command||'')}:{})})};
}
function renderDetailBotScheduleModeNote(mode){const note=document.getElementById('detailBotScheduleModeNote');if(!note)return;note.textContent=mode==='cycle'?'Mỗi dòng kích hoạt sau khoảng thời gian tính từ dòng ngay phía trên. Dòng đầu tiên tính từ lúc bấm Lưu. Kéo ⋮⋮ để đổi thứ tự.':'Mỗi dòng dùng giờ Việt Nam (GMT+7). Mặc định: 04:30 Tắt → 05:30 Bật (bảo trì server hằng ngày). Có thể thêm/sửa tùy ý.';}
function renderDetailBotSchedules(schedules){
  detailBotSchedules=(Array.isArray(schedules)?schedules:[]);const box=document.getElementById('detailBotSchedules');if(!box)return;
  const scheduler=normalizeDetailBotScheduler(detailBotSchedules);
  document.getElementById('detailBotScheduleMode').value=scheduler.mode;document.getElementById('detailBotScheduleEnabled').checked=scheduler.enabled!==false;renderDetailBotScheduleModeNote(scheduler.mode);
  if(!scheduler.items.length){box.innerHTML='<div class="note">Chưa có dòng hẹn giờ. Bấm “＋ Thêm” để tạo dòng đầu tiên.</div>';return;}
  box.innerHTML=scheduler.items.map((item,i)=>{
    const action=normalizeDetailBotScheduleAction(item);const actionText=action==='start'?'Bật Bot':(action==='command'?'Chạy lệnh':'Tắt Bot');
    const timing=scheduler.mode==='fixed'?'<input data-field="time" class="time-input" type="time" value="'+escapeHtml(item.time||'03:00')+'">':'<input data-field="afterMinutes" class="minutes-input" type="number" min="1" max="43200" value="'+clampClientNumber(item.afterMinutes,i===0?120:300,1,43200)+'" title="Phút">';
    const commandInput='<input data-field="command" class="command-input" style="flex:1 1 140px;min-width:120px;display:'+(action==='command'?'inline-block':'none')+';" value="'+escapeHtml(item.command||'')+'" placeholder="/say Xin chao (lệnh chạy khi đến giờ)" oninput="markDetailBotScheduleDirty()">';
    const relation=scheduler.mode==='fixed'?'Mỗi ngày':(i===0?'Tính từ lúc lưu':'Tính từ dòng '+i);
    return '<div class="schedule-row" draggable="true" data-index="'+i+'" data-id="'+escapeHtml(item.id)+'" ondragstart="dragDetailBotSchedule(event,'+i+')" ondragover="allowDetailBotScheduleDrop(event)" ondrop="dropDetailBotSchedule(event,'+i+')" ondragend="endDetailScheduleDrag(this)">'+
      '<div class="schedule-row-top"><div class="schedule-handle" title="Kéo để đổi thứ tự">⋮⋮</div><div class="schedule-row-title">'+(i+1)+'. '+actionText+'</div><div class="schedule-inline"><select data-field="action" class="action-select" onchange="detailBotScheduleRowActionChanged(this)"><option value="stop"'+(action==='stop'?' selected':'')+'>Tắt</option><option value="start"'+(action==='start'?' selected':'')+'>Bật</option><option value="command"'+(action==='command'?' selected':'')+'>Lệnh</option></select>'+timing+commandInput+'</div><button class="small danger" type="button" onclick="removeDetailBotSchedule('+i+')">Xóa</button></div>'+
      '<div class="schedule-meta" style="margin-top:5px;"><span>'+relation+'</span>'+(scheduler.mode==='cycle'?'<span>•</span><span>Tính từ dòng kề trên</span>':'')+'</div></div>';
  }).join('');
}
function markDetailBotScheduleDirty(){detailBotScheduleDirty=true;}
function detailBotScheduleRowActionChanged(select) {
  detailBotScheduleDirty = true;
  const row = select?.closest('.schedule-row');
  if (!row) return;
  const cmdInput = row.querySelector('[data-field="command"]');
  if (cmdInput) cmdInput.style.display = select.value === 'command' ? 'inline-block' : 'none';
  const titleEl = row.querySelector('.schedule-row-title');
  const idx = Number(row.dataset.index || 0) + 1;
  if (titleEl) {
    titleEl.textContent = idx + '. ' + (select.value === 'start' ? 'Bật Bot' : (select.value === 'command' ? 'Chạy lệnh' : 'Tắt Bot'));
  }
}
window.detailBotScheduleRowActionChanged = detailBotScheduleRowActionChanged;
function collectDetailBotSchedules(){
  const box=document.getElementById('detailBotSchedules');if(!box)return[];const mode=document.getElementById('detailBotScheduleMode')?.value==='cycle'?'cycle':'fixed';const current=normalizeDetailBotScheduler(detailBotSchedules);
  const items=[...box.querySelectorAll('.schedule-row')].map((row,i)=>{const get=f=>row.querySelector('[data-field="'+f+'"]');const id=row.dataset.id||current.items[i]?.id||(Date.now()+'-'+i);const action=get('action')?.value==='start'?'start':(get('action')?.value==='command'?'command':'stop');const item=mode==='fixed'?{id,action,time:String(get('time')?.value||'').trim()}:{id,action,afterMinutes:clampClientNumber(get('afterMinutes')?.value,i===0?120:300,1,43200)};if(action==='command')item.command=String(get('command')?.value||'').trim();return item;});
  return items.length?[{id:current.id||String(Date.now()),enabled:!!document.getElementById('detailBotScheduleEnabled')?.checked,mode,items}]:[];
}
function validateDetailBotSchedules(schedules){if(!schedules.length)return'';if(schedules.length!==1)return'Chỉ được lưu một chế độ hẹn giờ Bot cùng lúc.';const s=schedules[0];if(!s.items.length)return'Hẹn giờ Bot chưa có dòng nào.';for(let i=0;i<s.items.length;i++){if(s.items[i].action==='command'&&!String(s.items[i].command||'').trim())return'Dòng #'+(i+1)+' chọn hành động Lệnh nhưng chưa nhập lệnh.';}if(s.mode==='fixed'){const seen=new Set();for(let i=0;i<s.items.length;i++){if(!/^([01]\d|2[0-3]):[0-5]\d$/.test(s.items[i].time))return'Dòng #'+(i+1)+' có giờ không hợp lệ.';if(seen.has(s.items[i].time))return'Dòng #'+(i+1)+' bị trùng giờ '+s.items[i].time+'.';seen.add(s.items[i].time);}}else for(let i=0;i<s.items.length;i++){const v=Number(s.items[i].afterMinutes);if(!Number.isFinite(v)||v<1||v>43200)return'Dòng #'+(i+1)+' có thời gian chờ không hợp lệ.';}return'';}
function detailBotScheduleModeChanged(select){const current=collectDetailBotSchedules();const s=normalizeDetailBotScheduler(current.length?current:detailBotSchedules);const mode=select?.value==='cycle'?'cycle':'fixed';const items=s.items.map((item,i)=>mode==='fixed'?{id:item.id,action:item.action,time:detailDefaultFixedTime(i),...(item.action==='command'?{command:item.command}:{})}:{id:item.id,action:item.action,afterMinutes:i===0?120:300,...(item.action==='command'?{command:item.command}:{})});detailBotSchedules=[{id:s.id||String(Date.now()),enabled:!!document.getElementById('detailBotScheduleEnabled')?.checked,mode,items}];detailBotScheduleDirty=true;renderDetailBotSchedules(detailBotSchedules);}
function addDetailBotSchedule(){const current=collectDetailBotSchedules();const s=normalizeDetailBotScheduler(current.length?current:detailBotSchedules);const i=s.items.length;const item=s.mode==='fixed'?{id:Date.now()+'-'+Math.random().toString(36).slice(2,8),action:'stop',time:detailDefaultFixedTime(i)}:{id:Date.now()+'-'+Math.random().toString(36).slice(2,8),action:i%2===0?'stop':'start',afterMinutes:i===0?120:300};s.items.push(item);detailBotSchedules=[s];detailBotScheduleDirty=true;renderDetailBotSchedules(detailBotSchedules);}
function removeDetailBotSchedule(index){if(detailBotScheduleSaveInFlight)return;const s=normalizeDetailBotScheduler(collectDetailBotSchedules());s.items.splice(index,1);detailBotSchedules=s.items.length?[s]:[];detailBotScheduleDirty=true;renderDetailBotSchedules(detailBotSchedules);}
let draggedDetailBotScheduleIndex=null;
function dragDetailBotSchedule(event,index){draggedDetailBotScheduleIndex=index;event.dataTransfer.effectAllowed='move';event.dataTransfer.setData('text/plain',String(index));event.currentTarget.classList.add('dragging');}
function allowDetailBotScheduleDrop(event){event.preventDefault();event.dataTransfer.dropEffect='move';}
function dropDetailBotSchedule(event,targetIndex){event.preventDefault();const from=draggedDetailBotScheduleIndex;draggedDetailBotScheduleIndex=null;if(!Number.isInteger(from)||from===targetIndex)return;const s=normalizeDetailBotScheduler(collectDetailBotSchedules());const[moved]=s.items.splice(from,1);s.items.splice(targetIndex,0,moved);detailBotSchedules=[s];detailBotScheduleDirty=true;renderDetailBotSchedules(detailBotSchedules);}

async function saveDetailSettings(){
  if(detailSettingsSaveInFlight)return;
  invalidateDetailReads();
  const spawnElement=document.getElementById('detailSpawnCommands');
  const body={settings:{
    ecoMode:!!document.getElementById('detailSettingEcoMode')?.checked,
    autoTotem:!!document.getElementById('detailSettingAutoTotem')?.checked,
    antiHungry:!!document.getElementById('detailSettingAntiHungry')?.checked,
    autoReconnect:!!document.getElementById('detailSettingAutoReconnect')?.checked,
    antiAfkKick:!!document.getElementById('detailSettingAntiAfkKick')?.checked,
    // BUG-24: đồng bộ Spawn Commands từ trang Detail (worker sanitizer cắt 5000 ký tự).
    // Giá trị '********' (masked) được worker phía sau hiểu là "giữ nguyên".
    ...(spawnElement?{spawnCommands:String(spawnElement.value||'')}:{})
  }};
  detailSettingsSaveInFlight=true;setDetailSettingsDisabled(true);
  try{
    const result=await detailPost('/settings',body);
    showToast(result.data?.message||result.data?.error||'Đã xử lý.');
    if(result.ok){
      detailSettingsDirty=false;
      renderDetailSettings(result.data.settings||result.data);
      lastHomeSig = '';
      if(selectedBotId!==null)detailLastRevMap.delete(selectedBotId);
      await refreshDetail(true);
    }
  }finally{detailSettingsSaveInFlight=false;setDetailSettingsDisabled(false);}
}
async function saveDetailAutoChat(){
  if(detailAutoChatSaveInFlight)return;
  invalidateDetailReads();const schedules=collectDetailAutoChatSchedules();const validationError=validateDetailAutoChatSchedules(schedules);if(validationError){showToast(validationError);return;}
  detailAutoChatSaveInFlight=true;setDetailAutoChatDisabled(true);
  try{
    const result=await detailPost('/auto-chat',{autoChatSchedules:schedules});
    showToast(result.data?.message||result.data?.error||'Đã xử lý.');
    if(result.ok){
      detailAutoChatDirty=false;
      detailAutoChatSchedules=result.data?.autoChatSchedules||schedules;
      renderDetailAutoChatSchedules(detailAutoChatSchedules);
      lastHomeSig = '';
      if(selectedBotId!==null)detailLastRevMap.delete(selectedBotId);
      await refreshDetail(true);
    }
  }finally{detailAutoChatSaveInFlight=false;setDetailAutoChatDisabled(false);}
}
async function saveDetailBotSchedules(){
  if(detailBotScheduleSaveInFlight)return;const schedules=collectDetailBotSchedules();const validationError=validateDetailBotSchedules(schedules);if(validationError){showToast(validationError);return;}
  detailBotScheduleSaveInFlight=true;setDetailBotScheduleDisabled(true);
  try{
    const result=await detailPost('/bot-schedules',{botSchedules:schedules});
    showToast(result.data?.message||result.data?.error||'Đã xử lý.');
    if(result.ok){
      detailBotScheduleDirty=false;
      detailBotSchedules=result.data?.botSchedules||schedules;
      renderDetailBotSchedules(detailBotSchedules);
      lastHomeSig = '';
      if(selectedBotId!==null)detailLastRevMap.delete(selectedBotId);
      await refreshDetail(true);
    }
  }finally{detailBotScheduleSaveInFlight=false;setDetailBotScheduleDisabled(false);}
}

async function clearDetailLogs(){if(!confirm('Xóa Event Log của bot này?'))return;try{const result=await detailPost('/logs/clear',{});showToast(result.data?.message||result.data?.error||'Đã xử lý.');if(result.ok)await loadDetailLogs(true);}catch(err){showToast(err.message||'Không thể xóa Event Log.');}}
async function clearDetailChat(){if(!confirm('Xóa Chat Log của bot này?'))return;try{const result=await detailPost('/chat-logs/clear',{});showToast(result.data?.message||result.data?.error||'Đã xử lý.');if(result.ok)await loadDetailChat(true);}catch(err){showToast(err.message||'Không thể xóa Chat Log.');}}

window.dragDetailAutoChat = dragDetailAutoChat;
window.allowDetailAutoChatDrop = allowDetailAutoChatDrop;
window.dropDetailAutoChat = dropDetailAutoChat;
window.endDetailScheduleDrag = endDetailScheduleDrag;
window.dragDetailBotSchedule = dragDetailBotSchedule;
window.allowDetailBotScheduleDrop = allowDetailBotScheduleDrop;
window.dropDetailBotSchedule = dropDetailBotSchedule;
async function detailPost(path,body){
  if(selectedBotId===null) return {ok:false,status:0,data:{error:'Chưa chọn bot.'}};
  invalidateDetailReads();
  return requestJson(
    '/api/manager/bot/'+encodeURIComponent(String(selectedBotId))+path,
    {
      method:'POST',
      headers:{'Content-Type':'application/json'},
      body:JSON.stringify(body||{}),
      timeoutMs:15000
    }
  );
}

async function detailAction(action){
  if(detailLifecycleActionInFlight)return;
  invalidateDetailReads();
  detailLifecycleActionInFlight=true;
  const buttons=['detailStartButton','detailStopButton','detailRestartButton'];
  const activeBtn=document.getElementById(action==='start'?'detailStartButton':action==='stop'?'detailStopButton':'detailRestartButton');
  const prevBtnText=activeBtn?activeBtn.textContent:'';

  try{
    if(activeBtn)activeBtn.textContent=action==='start'?'⏳ Đang chạy...':action==='stop'?'⏳ Đang dừng...':'⏳ Đang chạy lại...';
    buttons.forEach(function(id){const button=document.getElementById(id);if(button)button.disabled=true;});

    // Cập nhật Optimistic tức thì trên giao diện Detail và cache danh sách bots
    if (detailBot) {
      if (action === 'start') {
        detailBot.manuallyStopped = false;
        detailBot.status = 'waking';
      } else if (action === 'stop') {
        detailBot.manuallyStopped = true;
        detailBot.status = 'offline';
      } else if (action === 'restart') {
        detailBot.manuallyStopped = false;
        detailBot.status = 'waking';
      }
      detailStatusHtml();
    }
    const bIdx = bots.findIndex(function(b) { return Number(b.id) === Number(selectedBotId); });
    if (bIdx !== -1) {
      if (action === 'start') {
        bots[bIdx].manuallyStopped = false;
        bots[bIdx].status = 'waking';
      } else if (action === 'stop') {
        bots[bIdx].manuallyStopped = true;
        bots[bIdx].status = 'offline';
      } else if (action === 'restart') {
        bots[bIdx].manuallyStopped = false;
        bots[bIdx].status = 'waking';
      }
    }
    lastHomeSig = '';
    if (selectedBotId !== null) detailLastRevMap.delete(selectedBotId);

    showToast(action==='start'?'Đang chạy bot...':action==='stop'?'Đang dừng bot...':'Đang khởi động lại bot...');
    const result=await detailPost('/'+encodeURIComponent(action),{});
    if (result.ok) {
      showToast(result.data?.message||result.data?.error||'Đã xử lý thành công!', 'success');
      lastHomeSig = '';
      if (selectedBotId !== null) detailLastRevMap.delete(selectedBotId);
      await refreshDetail(true);
      setTimeout(function() { if (selectedBotId !== null) refreshDetail(true); }, 800);
      setTimeout(function() { if (selectedBotId !== null) refreshDetail(true); }, 2000);
    } else {
      var err = result.data?.error || 'Không thể thực hiện thao tác.';
      if (action === 'start' && (err.indexOf('username') !== -1 || err.indexOf('password') !== -1 || err.indexOf('chưa có') !== -1)) {
        showToast('⚠️ ' + err + ' Vui lòng nhập Username Ingame bên dưới và bấm "Lưu & Chạy lại ngay"!', 'warning', 6000);
        var uInput = document.getElementById('detailUsernameInput');
        if (uInput) { uInput.focus(); }
      } else {
        showToast(err, 'error');
        lastHomeSig = '';
        if (selectedBotId !== null) detailLastRevMap.delete(selectedBotId);
        await refreshDetail(true);
      }
    }
  }catch(err){
    showToast(err.message||'Không thể thực hiện thao tác.', 'error');
    lastHomeSig = '';
    if (selectedBotId !== null) detailLastRevMap.delete(selectedBotId);
    await refreshDetail(true);
  }
  finally{
    detailLifecycleActionInFlight=false;
    if(activeBtn)activeBtn.textContent=prevBtnText;
    buttons.forEach(function(id){const button=document.getElementById(id);if(button)button.disabled=false;});
  }
}

function renderDetailHeader(bot) {
  if (typeof detailStatusHtml === 'function') detailStatusHtml();
}
window.renderDetailHeader = renderDetailHeader;

let detailCommandHistory = [];
let detailCommandHistoryIndex = -1;

function initDetailChatInputHistory() {
  const input = document.getElementById('detailMessageInput');
  if (!input || !input.dataset || input.dataset.historyAttached) return;
  input.dataset.historyAttached = 'true';
  input.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowUp') {
      if (!detailCommandHistory.length) return;
      e.preventDefault();
      if (detailCommandHistoryIndex === -1) {
        detailCommandHistoryIndex = detailCommandHistory.length - 1;
      } else if (detailCommandHistoryIndex > 0) {
        detailCommandHistoryIndex--;
      }
      input.value = detailCommandHistory[detailCommandHistoryIndex] || '';
    } else if (e.key === 'ArrowDown') {
      if (!detailCommandHistory.length || detailCommandHistoryIndex === -1) return;
      e.preventDefault();
      if (detailCommandHistoryIndex < detailCommandHistory.length - 1) {
        detailCommandHistoryIndex++;
        input.value = detailCommandHistory[detailCommandHistoryIndex] || '';
      } else {
        detailCommandHistoryIndex = -1;
        input.value = '';
      }
    }
  });
}

function quickDetailCommand(cmd) {
  const input = document.getElementById('detailMessageInput');
  if (!input) return;
  const raw = String(cmd || '').trim();
  const needsSpace = ['/dn', '/login', '/pay'].includes(raw.toLowerCase());
  const finalCmd = needsSpace ? (raw + ' ') : raw;
  input.value = finalCmd;
  input.focus();
  input.setSelectionRange(input.value.length, input.value.length);
}
window.quickDetailCommand = quickDetailCommand;

async function quickEnterServer() {
  if (!selectedBotId) return;
  if (detailBot?.currentWindow && Array.isArray(detailBot.currentWindow.slots) && detailBot.currentWindow.slots.length > 24) {
    showToast('Đang click Slot 24 vào server...');
    await clickDetailGuiSlot(24);
  } else {
    showToast('Đang gửi lệnh /menu để vào server...');
    try {
      const res = await detailPost('/send', { text: '/menu' });
      if (res.ok) {
        showToast('Đã gửi /menu! Bot sẽ tự động click slot 24 ngay khi menu mở.', 'success');
        await refreshDetail(true);
      } else {
        showToast(res.data?.error || 'Không thể gửi /menu.', 'error');
      }
    } catch(e) {
      showToast(e.message || 'Lỗi gửi /menu', 'error');
    }
  }
}
window.quickEnterServer = quickEnterServer;

async function quickEquipTotem() {
  if (!selectedBotId || !detailInventory) return;
  const slots = detailInventory.slots || {};
  let totemSlot = null;
  for (let s = 9; s <= 44; s++) {
    const item = slots[String(s)];
    if (item && item.name && item.name.includes('totem')) {
      totemSlot = s;
      break;
    }
  }
  if (totemSlot === null) {
    showToast('⚠️ Không tìm thấy Totem trong 36 ô rương đồ!', 'warning');
    return;
  }
  showToast('Đang trang bị Totem vào tay phụ...');
  try {
    const res = await detailPost('/inventory/equip', {
      sourceSlot: totemSlot,
      destination: 'off-hand',
      revision: detailInventory.revision
    });
    if (res.ok) {
      showToast('🛡️ Đã trang bị Totem vào tay phụ thành công!', 'success');
      await refreshDetail(true);
    } else {
      showToast(res.data?.error || 'Lỗi trang bị Totem.', 'error');
    }
  } catch (e) {
    showToast(e.message || 'Lỗi gửi yêu cầu trang bị Totem.', 'error');
  }
}
window.quickEquipTotem = quickEquipTotem;

function refreshStatus() {
  lastHomeSig = '';
  if (selectedBotId === null) {
    void refreshHome();
  } else {
    if (selectedBotId !== null) detailLastRevMap.delete(selectedBotId);
    void refreshDetail(true);
  }
}
window.refreshStatus = refreshStatus;

async function quickCardAction(btn, botId, action) {
  if (!botId || btn.disabled) return;
  btn.disabled = true;
  const oldText = btn.textContent;
  btn.textContent = '...';

  // Optimistic UI update in bots array and immediate re-render
  const numId = Number(botId);
  const targetBot = bots.find(function(b) { return Number(b.id) === numId; });
  if (targetBot) {
    if (action === 'start') {
      targetBot.manuallyStopped = false;
      targetBot.status = 'waking';
      targetBot.available = true;
    } else if (action === 'stop') {
      targetBot.manuallyStopped = true;
      targetBot.status = 'offline';
    } else if (action === 'restart') {
      targetBot.manuallyStopped = false;
      targetBot.status = 'waking';
    }
    renderHome();
  }
  lastHomeSig = '';

  try {
    const res = await requestJson('/api/manager/bot/' + encodeURIComponent(botId) + '/' + action, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}',
      timeoutMs: 10000
    });
    if (res.ok) {
      showToast(res.data?.message || ('Đã gửi lệnh ' + action + ' bot #' + botId), 'success');
      lastHomeSig = '';
      refreshStatus();
      setTimeout(refreshStatus, 800);
      setTimeout(refreshStatus, 2000);
    } else {
      showToast(res.data?.error || ('Lỗi thao tác bot #' + botId), 'error');
      refreshStatus();
    }
  } catch (err) {
    showToast(err.message || 'Lỗi kết nối khi gửi lệnh.', 'error');
    refreshStatus();
  } finally {
    btn.disabled = false;
    btn.textContent = oldText;
  }
}
window.quickCardAction = quickCardAction;

async function copyToClipboard(text, label) {
  text = String(text || '').trim();
  if (!text || text === '-') return;
  try {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      await navigator.clipboard.writeText(text);
    } else {
      throw new Error('Clipboard API not supported');
    }
    showToast('Đã sao chép ' + (label || 'nội dung') + ': ' + text);
  } catch (_) {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.left = '-9999px';
    document.body.appendChild(ta);
    ta.focus();
    ta.select();
    try {
      document.execCommand('copy');
      showToast('Đã sao chép ' + (label || 'nội dung') + ': ' + text);
    } catch (e) {
      showToast('Không thể sao chép tự động: ' + text);
    }
    document.body.removeChild(ta);
  }
}
window.copyToClipboard = copyToClipboard;

async function sendDetailMessage(event){
  event.preventDefault();
  if(detailRequestInFlight)return;
  const input=document.getElementById('detailMessageInput');
  const text=String(input?.value||'');
  if(!text.trim()){showToast('Nội dung không được trống.');return;}
  if (!detailCommandHistory.length || detailCommandHistory[detailCommandHistory.length - 1] !== text.trim()) {
    detailCommandHistory.push(text.trim());
    if (detailCommandHistory.length > 50) detailCommandHistory.shift();
  }
  detailCommandHistoryIndex = -1;
  try{
    const result=await detailPost('/send',{text});
    showToast(result.data?.message||result.data?.error||'Đã xử lý.');
    if(result.ok){input.value='';await loadDetailChat(true);}
  }catch(err){showToast(err.message||'Không thể gửi chat.');}
}

async function saveDetailAccount(){
  if(detailAccountSaveInFlight)return;
  invalidateDetailReads();
  const username=String(document.getElementById('detailUsernameInput')?.value||'').trim();
  const password=String(document.getElementById('detailPasswordInput')?.value||'');
  if(!username&&!password){showToast('Nhập username hoặc password cần thay đổi.');return;}
  const userInput=document.getElementById('detailUsernameInput');
  const passInput=document.getElementById('detailPasswordInput');
  detailAccountSaveInFlight=true;
  if(userInput)userInput.disabled=true;
  if(passInput)passInput.disabled=true;
  try{
    const result=await detailPost('/account',{username,password});
    showToast(result.data?.message||result.data?.error||'Đã xử lý.');
    if(result.ok){
      if(userInput)userInput.value='';
      if(passInput)passInput.value='';
      lastHomeSig = '';
      if(selectedBotId!==null)detailLastRevMap.delete(selectedBotId);
      await refreshDetail(true);
      setTimeout(function() { if(selectedBotId!==null)refreshDetail(true); }, 1000);
    }
  }catch(err){showToast(err.message||'Không thể cập nhật tài khoản.');}
  finally{detailAccountSaveInFlight=false;if(userInput)userInput.disabled=false;if(passInput)passInput.disabled=false;}
}

async function saveAndRestartBot(){
  if(detailAccountSaveInFlight)return;
  invalidateDetailReads();
  const username=String(document.getElementById('detailUsernameInput')?.value||'').trim();
  const password=String(document.getElementById('detailPasswordInput')?.value||'');
  if(!username&&!password){showToast('Nhập username hoặc password cần thay đổi.');return;}
  const userInput=document.getElementById('detailUsernameInput');
  const passInput=document.getElementById('detailPasswordInput');
  detailAccountSaveInFlight=true;
  if(userInput)userInput.disabled=true;
  if(passInput)passInput.disabled=true;
  try{
    const result=await detailPost('/account',{username,password});
    if(!result.ok){showToast(result.data?.error||'Không thể cập nhật tài khoản.');return;}
    showToast('Đã lưu tài khoản. Đang khởi động lại bot...');
    if(userInput)userInput.value='';
    if(passInput)passInput.value='';
    const restartRes=await detailPost('/restart',{});
    showToast(restartRes.data?.message||restartRes.data?.error||'Đã gửi lệnh chạy lại bot.');
    lastHomeSig = '';
    if(selectedBotId!==null)detailLastRevMap.delete(selectedBotId);
    await refreshDetail(true);
    setTimeout(function() { if(selectedBotId!==null)refreshDetail(true); }, 800);
    setTimeout(function() { if(selectedBotId!==null)refreshDetail(true); }, 2000);
  }catch(err){showToast(err.message||'Lỗi khi lưu và khởi động lại bot.');}
  finally{detailAccountSaveInFlight=false;if(userInput)userInput.disabled=false;if(passInput)passInput.disabled=false;}
}

function renderDetailProxy(proxy) {
  const badge = document.getElementById('detailProxyBadge');
  const enabledInput = document.getElementById('detailProxyEnabled');
  const protocolInput = document.getElementById('detailProxyProtocol');
  const hostInput = document.getElementById('detailProxyHost');
  const portInput = document.getElementById('detailProxyPort');
  const usernameInput = document.getElementById('detailProxyUsername');
  const passwordInput = document.getElementById('detailProxyPassword');

  const p = proxy || {};
  if (badge) {
    if (p.enabled) {
      badge.textContent = '🟢 BẬT';
      badge.style.background = 'rgba(34, 197, 94, 0.2)';
      badge.style.color = '#4ade80';
    } else {
      badge.textContent = 'TẮT';
      badge.style.background = 'var(--border)';
      badge.style.color = 'var(--muted)';
    }
  }

  if (enabledInput && document.activeElement !== enabledInput) enabledInput.checked = !!p.enabled;
  if (protocolInput && document.activeElement !== protocolInput) protocolInput.value = p.protocol || 'socks5';
  if (hostInput && document.activeElement !== hostInput) hostInput.value = p.host || '';
  if (portInput && document.activeElement !== portInput) portInput.value = p.port || '';
  if (usernameInput && document.activeElement !== usernameInput) usernameInput.value = p.username || '';
  if (passwordInput && document.activeElement !== passwordInput) passwordInput.value = p.password || '';
}

// SEC-06/BUG-17: snapshot công khai chỉ chứa proxy { enabled }. Admin phải tải chi
// tiết đầy đủ (host/port/username + mật khẩu masked) từ GET /settings và render lại.
// Non-admin gọi hàm này là no-op (proxy đã bị Manager strip khỏi session data).
async function loadFullSettingsForAdmin() {
  if (currentUser?.role !== 'admin' || selectedBotId === null) return;
  try {
    const data = await detailGet('/settings');
    const settings = data?.settings || data || {};
    if (settings.proxy) renderDetailProxy(settings.proxy);
    const sp = document.getElementById('detailSpawnCommands');
    if (sp && !detailSettingsDirty && typeof settings.spawnCommands === 'string') sp.value = settings.spawnCommands;
  } catch (_) {
    // Không phá trang nếu worker offline — badge {enabled} từ snapshot vẫn hiển thị.
  }
}

async function saveDetailProxy() {
  if (selectedBotId === null) return;
  const enabled = !!document.getElementById('detailProxyEnabled')?.checked;
  const protocol = document.getElementById('detailProxyProtocol')?.value || 'socks5';
  const host = document.getElementById('detailProxyHost')?.value?.trim() || '';
  const port = Number(document.getElementById('detailProxyPort')?.value) || 0;
  const username = document.getElementById('detailProxyUsername')?.value?.trim() || '';
  const password = document.getElementById('detailProxyPassword')?.value || '';

  if (enabled && (!host || !port)) {
    showToast('Vui lòng nhập đầy đủ Host và Port khi kích hoạt Proxy!');
    return;
  }

  try {
    const res = await detailPost('/proxy', {
      proxy: { enabled, protocol, host, port, username, password }
    });
    if (res.ok) {
      showToast('Đã lưu cấu hình Proxy thành công!');
      lastHomeSig = '';
      if (selectedBotId !== null) detailLastRevMap.delete(selectedBotId);
      await refreshDetail(true);
    } else {
      showToast('Lỗi lưu Proxy: ' + (res.data?.error || 'Không rõ nguyên nhân'));
    }
  } catch (err) {
    showToast('Lỗi lưu Proxy: ' + (err.message || ''));
  }
}

async function testDetailProxy() {
  if (selectedBotId === null) return;
  const btn = document.getElementById('detailProxyTestBtn');
  const resDiv = document.getElementById('detailProxyTestResult');
  const enabled = !!document.getElementById('detailProxyEnabled')?.checked;
  const protocol = document.getElementById('detailProxyProtocol')?.value || 'socks5';
  const host = document.getElementById('detailProxyHost')?.value?.trim() || '';
  const port = Number(document.getElementById('detailProxyPort')?.value) || 0;
  const username = document.getElementById('detailProxyUsername')?.value?.trim() || '';
  const password = document.getElementById('detailProxyPassword')?.value || '';

  if (!host || !port) {
    showToast('Vui lòng nhập Host và Port Proxy trước khi kiểm tra!');
    return;
  }

  if (btn) { btn.disabled = true; btn.textContent = '⏳ Đang test...'; }
  if (resDiv) { resDiv.innerHTML = '<span style="color:var(--accent);">Đang kết nối thử tới Proxy...</span>'; }

  try {
    const res = await detailPost('/proxy/test', {
      proxy: { enabled, protocol, host, port, username, password }
    });
    if (res.ok && res.data?.ok) {
      if (resDiv) resDiv.innerHTML = '<span style="color:var(--green);font-weight:700;">✅ ' + escapeHtml(res.data.message) + '</span>';
      showToast('Proxy hoạt động tốt! Ping: ' + res.data.latencyMs + 'ms');
    } else {
      const err = res.data?.error || 'Không thể kết nối tới Proxy.';
      if (resDiv) resDiv.innerHTML = '<span style="color:var(--red);font-weight:700;">❌ ' + escapeHtml(err) + '</span>';
      showToast('Kiểm tra Proxy thất bại: ' + err);
    }
  } catch (err) {
    if (resDiv) resDiv.innerHTML = '<span style="color:var(--red);">❌ Lỗi kiểm tra: ' + escapeHtml(err.message) + '</span>';
    showToast('Lỗi kiểm tra: ' + err.message);
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = '🧪 Kiểm Tra Kết Nối'; }
  }
}

async function clearDetailProxy() {
  if (document.getElementById('detailProxyEnabled')) document.getElementById('detailProxyEnabled').checked = false;
  if (document.getElementById('detailProxyHost')) document.getElementById('detailProxyHost').value = '';
  if (document.getElementById('detailProxyPort')) document.getElementById('detailProxyPort').value = '';
  if (document.getElementById('detailProxyUsername')) document.getElementById('detailProxyUsername').value = '';
  if (document.getElementById('detailProxyPassword')) document.getElementById('detailProxyPassword').value = '';
  await saveDetailProxy();
}

async function loadTrialGiftSetting() {
  try {
    const res = await requestJson('/api/manager/settings/system');
    if (res.ok && res.data?.settings) {
      const isEnabled = res.data.settings.trialGiftEnabled === true;
      const trialDays = Number(res.data.settings.trialDays) || 1;
      const badge = document.getElementById('trialGiftStatusBadge');
      if (badge) {
        badge.textContent = isEnabled ? 'BẬT' : 'TẮT';
        badge.style.color = isEnabled ? '#4ade80' : '#f87171';
      }
      const daysInput = document.getElementById('trialDaysInput');
      if (daysInput) {
        daysInput.value = trialDays;
        daysInput.disabled = !isEnabled;
      }
      const label = document.getElementById('trialGiftBtnLabel');
      if (label) {
        label.textContent = '🎁 Tặng Dùng Thử:';
      }
    }
  } catch (_) {}
}

async function toggleTrialGiftSetting() {
  const badge = document.getElementById('trialGiftStatusBadge');
  const currentEnabled = badge ? badge.textContent.trim() === 'BẬT' : true;
  const newEnabled = !currentEnabled;
  const daysInput = document.getElementById('trialDaysInput');
  const trialDays = daysInput ? Math.max(1, Math.min(365, parseInt(daysInput.value, 10) || 1)) : 1;

  try {
    const res = await requestJson('/api/manager/settings/system', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: { trialGiftEnabled: newEnabled, trialDays }
    });
    if (res.ok) {
      if (badge) {
        badge.textContent = newEnabled ? 'BẬT' : 'TẮT';
        badge.style.color = newEnabled ? '#4ade80' : '#f87171';
      }
      if (daysInput) daysInput.disabled = !newEnabled;
      showToast(res.data?.message || 'Đã cập nhật chế độ tặng dùng thử!');
    } else {
      showToast('Lỗi cập nhật: ' + (res.data?.error || ''));
    }
  } catch (err) {
    showToast('Lỗi: ' + err.message);
  }
}

async function saveTrialDaysSetting() {
  const badge = document.getElementById('trialGiftStatusBadge');
  const isEnabled = badge ? badge.textContent.trim() === 'BẬT' : true;
  const daysInput = document.getElementById('trialDaysInput');
  const trialDays = daysInput ? Math.max(1, Math.min(365, parseInt(daysInput.value, 10) || 1)) : 1;
  if (daysInput) daysInput.value = trialDays;

  try {
    const res = await requestJson('/api/manager/settings/system', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: { trialGiftEnabled: isEnabled, trialDays }
    });
    if (res.ok) {
      showToast('Đã lưu số ngày dùng thử: ' + trialDays + ' ngày!');
    } else {
      showToast('Lỗi lưu số ngày: ' + (res.data?.error || ''));
    }
  } catch (err) {
    showToast('Lỗi: ' + err.message);
  }
}

// --- CLIENT-SIDE LINK4M REWARD & ADMIN SETTINGS CONTROLLER ---
var link4mCooldownTimer = null;
var link4mCooldownEnd = 0;

async function loadLink4mStatus() {
  try {
    const res = await requestJson('/api/rewards/link4m/status');
    if (!res.ok) return;
    const data = res.data;
    const badge = document.getElementById('link4mUsageBadge');
    const expiredBadge = document.getElementById('expiredLink4mUsageBadge');
    const btn = document.getElementById('btnUserLink4mReward');
    const expBtn = document.getElementById('btnExpiredLink4mReward');

    if (!data.enabled) {
      if (btn) btn.style.display = 'none';
      if (expBtn) expBtn.style.display = 'none';
      return;
    }

    if (btn) btn.style.display = 'inline-flex';
    if (expBtn) expBtn.style.display = 'inline-flex';

    if (link4mCooldownTimer) {
      clearInterval(link4mCooldownTimer);
      link4mCooldownTimer = null;
    }

    const countText = (data.todayCount || 0) + '/' + (data.dailyLimit || 2) + ' lượt';

    // 1. Trường hợp đã vượt đủ 2/2 lần hôm nay
    if ((data.todayCount || 0) >= (data.dailyLimit || 2) || (data.remainingAttempts !== undefined && data.remainingAttempts <= 0)) {
      var maxLabel = '<span>✅</span> Đã đạt giới hạn (' + (data.todayCount || 2) + '/' + (data.dailyLimit || 2) + ')';
      if (btn) {
        btn.disabled = true;
        btn.style.opacity = '0.55';
        btn.style.filter = 'grayscale(35%)';
        btn.style.cursor = 'not-allowed';
        btn.style.pointerEvents = 'none';
        btn.innerHTML = maxLabel;
        btn.title = 'Bạn đã dùng hết ' + (data.dailyLimit || 2) + '/' + (data.dailyLimit || 2) + ' lượt vượt link hôm nay. Làm mới lúc 00:00 VN.';
      }
      if (expBtn) {
        expBtn.disabled = true;
        expBtn.style.opacity = '0.55';
        expBtn.style.cursor = 'not-allowed';
        expBtn.style.pointerEvents = 'none';
        expBtn.innerHTML = maxLabel;
        expBtn.title = 'Bạn đã dùng hết lượt vượt link hôm nay.';
      }
      return;
    }

    // 2. Trường hợp đang trong thời gian Cooldown 2 tiếng
    var cooldownMs = Number(data.cooldownRemainingMs) || 0;
    if (cooldownMs > 0) {
      link4mCooldownEnd = Date.now() + cooldownMs;

      var renderCooldown = function() {
        var remaining = Math.max(0, link4mCooldownEnd - Date.now());
        if (remaining <= 0) {
          if (link4mCooldownTimer) {
            clearInterval(link4mCooldownTimer);
            link4mCooldownTimer = null;
          }
          void loadLink4mStatus();
          return;
        }

        var totalSec = Math.ceil(remaining / 1000);
        var h = Math.floor(totalSec / 3600);
        var m = Math.floor((totalSec % 3600) / 60);
        var s = totalSec % 60;
        var timeStr = '';
        if (h > 0) {
          timeStr = h + 'h ' + (m < 10 ? '0' : '') + m + 'm ' + (s < 10 ? '0' : '') + s + 's';
        } else {
          timeStr = m + 'm ' + (s < 10 ? '0' : '') + s + 's';
        }

        var label = '<span>⏳</span> Khả dụng lại sau ' + timeStr;
        var tip = 'Vui lòng chờ khoảng cách 2 tiếng giữa 2 lần vượt link. Còn lại: ' + timeStr;

        if (btn) {
          btn.disabled = true;
          btn.style.opacity = '0.55';
          btn.style.filter = 'grayscale(35%)';
          btn.style.cursor = 'not-allowed';
          btn.style.pointerEvents = 'none';
          btn.innerHTML = label + ' <span id="link4mUsageBadge" style="font-size:11px;background:rgba(0,0,0,0.35);padding:2px 6px;border-radius:4px;color:#cbd5e1;margin-left:4px;">' + countText + '</span>';
          btn.title = tip;
        }
        if (expBtn) {
          expBtn.disabled = true;
          expBtn.style.opacity = '0.55';
          expBtn.style.cursor = 'not-allowed';
          expBtn.style.pointerEvents = 'none';
          expBtn.innerHTML = label + ' <span id="expiredLink4mUsageBadge" style="font-size:11px;background:rgba(0,0,0,0.35);padding:2px 6px;border-radius:4px;margin-left:4px;">' + countText + '</span>';
          expBtn.title = tip;
        }
      };

      renderCooldown();
      link4mCooldownTimer = setInterval(renderCooldown, 1000);
      return;
    }

    // 3. Trường hợp sẵn sàng vượt link (Nút sáng bình thường, click được)
    if (btn) {
      btn.disabled = false;
      btn.style.opacity = '1';
      btn.style.filter = 'none';
      btn.style.cursor = 'pointer';
      btn.style.pointerEvents = 'auto';
      btn.innerHTML = '<span>⚡</span> Vượt link +12h <span id="link4mUsageBadge" style="font-size:11px;background:rgba(56,189,248,0.25);padding:2px 6px;border-radius:4px;color:#fff;">' + countText + '</span>';
      btn.title = 'Vượt link nhận thêm 12h thời gian sử dụng bot (' + countText + ')';
    }
    if (expBtn) {
      expBtn.disabled = false;
      expBtn.style.opacity = '1';
      expBtn.style.filter = 'none';
      expBtn.style.cursor = 'pointer';
      expBtn.style.pointerEvents = 'auto';
      expBtn.innerHTML = '<span>⚡</span> Vượt link +12h hồi sinh tài khoản <span id="expiredLink4mUsageBadge" style="font-size:11px;background:rgba(0,0,0,0.35);padding:2px 6px;border-radius:4px;margin-left:4px;">' + countText + '</span>';
      expBtn.title = 'Vượt link nhận thêm 12h thời gian sử dụng bot (' + countText + ')';
    }
  } catch (_) {}
}

async function startLink4mReward(btn) {
  if (btn && (btn.disabled || btn.style.pointerEvents === 'none')) {
    return;
  }

  if (btn) {
    btn.disabled = true;
    btn.setAttribute('data-original-html', btn.innerHTML);
    btn.innerHTML = '<span>⏳</span> Đang tạo liên kết...';
  }

  try {
    const res = await requestJson('/api/rewards/link4m/start', { method: 'POST', body: {} });
    if (!res.ok || !res.data?.redirectUrl) {
      showToast(res.data?.error || res.data?.message || 'Không thể tạo liên kết vượt link.');
      void loadLink4mStatus();
      return;
    }

    showToast('Đang chuyển hướng tới trang vượt link...');
    setTimeout(function() {
      window.location.href = res.data.redirectUrl;
    }, 400);
  } catch (err) {
    showToast('Lỗi: ' + err.message);
    void loadLink4mStatus();
  }
}

// Admin Link4M settings
async function loadLink4mAdminSetting() {
  try {
    const res = await requestJson('/api/manager/settings/system');
    if (res.ok && res.data?.settings) {
      const s = res.data.settings;
      const isEnabled = s.link4mRewardEnabled === true;
      const badge = document.getElementById('link4mStatusBadge');
      if (badge) {
        badge.textContent = isEnabled ? 'BẬT' : 'TẮT';
        badge.style.color = isEnabled ? '#4ade80' : '#f87171';
      }
    }
  } catch (_) {}
}

async function toggleLink4mSetting() {
  const badge = document.getElementById('link4mStatusBadge');
  const currentEnabled = badge ? badge.textContent.trim() === 'BẬT' : false;
  const newEnabled = !currentEnabled;

  try {
    const res = await requestJson('/api/manager/settings/system', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: { link4mRewardEnabled: newEnabled }
    });
    if (res.ok) {
      if (badge) {
        badge.textContent = newEnabled ? 'BẬT' : 'TẮT';
        badge.style.color = newEnabled ? '#4ade80' : '#f87171';
      }
      showToast('Đã ' + (newEnabled ? 'BẬT' : 'TẮT') + ' tính năng Vượt Link +12h!');
      void loadLink4mStatus();
    } else {
      showToast('Lỗi cập nhật: ' + (res.data?.error || ''));
    }
  } catch (err) {
    showToast('Lỗi: ' + err.message);
  }
}

async function openLink4mConfigModal() {
  try {
    const res = await requestJson('/api/manager/settings/system');
    if (res.ok && res.data?.settings) {
      const s = res.data.settings;
      const enabledCb = document.getElementById('link4mModalEnabled');
      if (enabledCb) enabledCb.checked = s.link4mRewardEnabled === true;
      const modeSel = document.getElementById('link4mModalMode');
      if (modeSel) modeSel.value = s.link4mMode || 'custom_url';
      const urlInp = document.getElementById('link4mModalUrl');
      if (urlInp) urlInp.value = s.link4mUrl || '';
      const apiTokenInp = document.getElementById('link4mModalApiToken');
      if (apiTokenInp) apiTokenInp.value = s.link4mApiToken || '';
      const hoursInp = document.getElementById('link4mModalHours');
      if (hoursInp) hoursInp.value = s.link4mRewardHours || 12;
      const limitInp = document.getElementById('link4mModalDailyLimit');
      if (limitInp) limitInp.value = s.link4mDailyLimit || 2;
      const secretInp = document.getElementById('link4mModalSecretKey');
      if (secretInp) secretInp.value = s.link4mSecretKey || '';
      updateLink4mModalFields();
    }
  } catch (_) {}
  const modal = document.getElementById('link4mSettingsModal');
  if (modal) modal.classList.remove('hidden');
}

function closeLink4mConfigModal() {
  const modal = document.getElementById('link4mSettingsModal');
  if (modal) modal.classList.add('hidden');
}

function updateLink4mModalFields() {
  const mode = document.getElementById('link4mModalMode')?.value || 'custom_url';
  const customGrp = document.getElementById('link4mCustomUrlGroup');
  const apiGrp = document.getElementById('link4mApiTokenGroup');
  if (customGrp) customGrp.style.display = mode === 'custom_url' ? 'block' : 'none';
  if (apiGrp) apiGrp.style.display = mode === 'api' ? 'block' : 'none';
}

async function saveLink4mConfigModal() {
  const enabled = document.getElementById('link4mModalEnabled')?.checked === true;
  const mode = document.getElementById('link4mModalMode')?.value || 'custom_url';
  const url = document.getElementById('link4mModalUrl')?.value || '';
  const apiToken = document.getElementById('link4mModalApiToken')?.value || '';
  const hours = parseInt(document.getElementById('link4mModalHours')?.value, 10) || 12;
  const dailyLimit = parseInt(document.getElementById('link4mModalDailyLimit')?.value, 10) || 2;
  const secretKey = document.getElementById('link4mModalSecretKey')?.value || '';

  try {
    const res = await requestJson('/api/manager/settings/system', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: {
        link4mRewardEnabled: enabled,
        link4mMode: mode,
        link4mUrl: url,
        link4mApiToken: apiToken,
        link4mRewardHours: hours,
        link4mDailyLimit: dailyLimit,
        link4mSecretKey: secretKey
      }
    });
    if (res.ok) {
      showToast('Đã lưu cấu hình Link4M thành công!');
      closeLink4mConfigModal();
      void loadLink4mAdminSetting();
      void loadLink4mStatus();
    } else {
      showToast('Lỗi: ' + (res.data?.error || 'Không thể lưu cài đặt'));
    }
  } catch (err) {
    showToast('Lỗi: ' + err.message);
  }
}

// BUG-10: loadCurrentUser chưa từng được định nghĩa trong UI script trong khi
// checkRewardQueryParams gọi nó sau khi nhận thưởng Link4M → ReferenceError bị nuốt,
// thông tin thuê bao (giờ còn lại) không refresh. Định nghĩa lại hàm này.
async function loadCurrentUser() {
  try {
    const res = await requestJson('/api/auth/me');
    if (res.ok && res.data?.user) {
      currentUser = res.data.user;
      try { applyUserRoleUI(); } catch (_) {}
      // Chỉ re-render home khi user đang ở giao diện đã đăng nhập (loginGate đã ẩn).
      const loginGate = document.getElementById('loginGate');
      if (loginGate?.classList.contains('hidden') && typeof renderHome === 'function') {
        void renderHome();
      }
    }
    return res.ok;
  } catch (_) {
    return false;
  }
}
window.loadCurrentUser = loadCurrentUser;

// Check reward query param on dashboard load
function checkRewardQueryParams() {
  const params = new URLSearchParams(window.location.search);
  const reward = params.get('reward');
  const attemptId = params.get('attempt') || '';
  if (reward === 'success') {
    const added = params.get('added') || '12h';
    showToast('🎉 Chúc mừng! Bạn đã vượt link thành công và được cộng thêm ' + added + ' sử dụng!');
    void loadCurrentUser();
    void loadLink4mStatus();
    window.history.replaceState({}, document.title, window.location.pathname);
  } else if (reward === 'pending') {
    const msg = params.get('message') || 'Đang chờ máy chủ Link4M gửi xác nhận hoàn tất (Postback)...';
    showToast('⏳ ' + msg);
    window.history.replaceState({}, document.title, window.location.pathname);
    // Poll verify endpoint for up to 30s to see if postback completes in background
    if (attemptId) {
      let pollCount = 0;
      const pollTimer = setInterval(async () => {
        pollCount++;
        if (pollCount > 10) { clearInterval(pollTimer); return; }
        try {
          const res = await requestJson('/api/rewards/link4m/verify', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: { attemptId }
          });
          if (res.ok && res.data?.isRewarded) {
            clearInterval(pollTimer);
            showToast('🎉 Xác nhận từ Link4M thành công! Đã cộng +' + (res.data.rewardHours || 12) + 'h vào tài khoản!');
            void loadCurrentUser();
            void loadLink4mStatus();
          }
        } catch (_) {}
      }, 3000);
    }
  } else if (reward === 'already') {
    showToast('⚠️ Phiên vượt link này đã được nhận thưởng trước đó.');
    window.history.replaceState({}, document.title, window.location.pathname);
  } else if (reward === 'error') {
    const msg = params.get('message') || 'Xác thực vượt link không thành công.';
    showToast('⚠️ Lỗi nhận thưởng: ' + msg);
    window.history.replaceState({}, document.title, window.location.pathname);
  }
}

window.loadLink4mStatus = loadLink4mStatus;
window.startLink4mReward = startLink4mReward;
window.loadLink4mAdminSetting = loadLink4mAdminSetting;
window.toggleLink4mSetting = toggleLink4mSetting;
window.openLink4mConfigModal = openLink4mConfigModal;
window.closeLink4mConfigModal = closeLink4mConfigModal;
window.updateLink4mModalFields = updateLink4mModalFields;
window.saveLink4mConfigModal = saveLink4mConfigModal;

window.toggleTrialGiftSetting = toggleTrialGiftSetting;
window.saveTrialDaysSetting = saveTrialDaysSetting;

function updateDetailUptime(){
  if(!detailBot||detailBot.status!=='afk')return;
  const base=Number(detailBot.uptimeSeconds||0);
  const extra=Math.floor((Date.now()-uptimeSyncAt)/1000);
  const seconds=Math.min(base+extra,3596399);
  const h=Math.floor(seconds/3600);const m=Math.floor((seconds%3600)/60);const s=seconds%60;
  const el=document.getElementById('detailUptime');if(el)el.textContent=h+'h '+m+'m '+s+'s';
}

async function handleRenameClick(btn) {
  if (!btn) return;
  const botId = Number(btn.getAttribute('data-bot-id'));
  const currentLabel = btn.getAttribute('data-bot-label') || '';
  await renameBotAlias(botId, currentLabel);
}

function renameBotAlias(botId, currentLabel) {
  editBot(null, botId);
  setTimeout(() => {
    const input = document.getElementById('editBotLabel');
    if (input) {
      input.focus();
      input.select();
    }
  }, 100);
}

async function renameDetailBotAlias() {
  if (!selectedBotId) return;
  const current = detailBot?.label || '';
  await renameBotAlias(selectedBotId, current);
}

async function openSupabaseModal() {
  const modal = document.getElementById('supabaseModal');
  if (!modal) return;
  modal.classList.remove('hidden');

  const alertBox = document.getElementById('supabaseAlertBox');
  if (alertBox) {
    alertBox.className = 'login-alert hidden';
    alertBox.textContent = '';
  }

  const badge = document.getElementById('supabaseStatusBadge');
  if (badge) {
    badge.innerHTML = '⏳ Đang kiểm tra...';
    badge.style.background = 'rgba(148,163,184,0.15)';
    badge.style.color = '#94a3b8';
    badge.style.borderColor = 'rgba(148,163,184,0.3)';
  }

  const statusMsg = document.getElementById('supabaseStatusMsg');
  if (statusMsg) statusMsg.textContent = 'Đang truy vấn trạng thái Supabase từ server...';

  try {
    const res = await requestJson('/api/manager/supabase/status');
    if (res.ok && res.data) {
      const urlInput = document.getElementById('supabaseUrlInput');
      const keyInput = document.getElementById('supabaseKeyInput');
      if (urlInput) urlInput.value = res.data.url || '';
      if (keyInput) keyInput.value = res.data.hasKey ? '••••••••••••••••' : '';

      if (badge) {
        if (res.data.connected) {
          badge.innerHTML = '🟢 Đã kết nối';
          badge.style.background = 'rgba(34,197,94,0.2)';
          badge.style.color = '#4ade80';
          badge.style.borderColor = 'rgba(34,197,94,0.4)';
        } else {
          badge.innerHTML = '🔴 Chưa kết nối';
          badge.style.background = 'rgba(239,68,68,0.2)';
          badge.style.color = '#f87171';
          badge.style.borderColor = 'rgba(239,68,68,0.4)';
        }
      }

      if (statusMsg) {
        statusMsg.textContent = res.data.message || (res.data.connected ? 'Kết nối Supabase Cloud hoạt động tốt.' : 'Chưa kết nối Supabase Cloud.');
      }
    } else {
      if (statusMsg) statusMsg.textContent = res.data?.error || 'Không thể tải trạng thái Supabase.';
    }
  } catch (err) {
    if (statusMsg) statusMsg.textContent = 'Lỗi kết nối: ' + err.message;
  }
}

function closeSupabaseModal() {
  document.getElementById('supabaseModal')?.classList.add('hidden');
}

async function copySupabaseSchemaSql() {
  const btn = document.getElementById('supabaseSchemaBtn');
  if (btn) { btn.disabled = true; btn.textContent = '⏳ Đang lấy SQL...'; }
  try {
    const res = await requestJson('/api/manager/supabase/schema');
    if (!res.ok || !res.data?.sql) throw new Error(res.data?.error || 'Không thể lấy SQL schema.');
    const sql = String(res.data.sql);
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(sql);
    } else {
      const textarea = document.createElement('textarea');
      textarea.value = sql;
      textarea.style.position = 'fixed';
      textarea.style.opacity = '0';
      document.body.appendChild(textarea);
      textarea.select();
      if (!document.execCommand('copy')) throw new Error('Trình duyệt không cho phép sao chép tự động.');
      textarea.remove();
    }
    showToast('✅ Đã sao chép SQL. Mở Supabase SQL Editor, dán và Run một lần.');
  } catch (err) {
    showToast('⚠️ ' + (err.message || 'Không thể sao chép SQL schema.'));
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = '📋 Sao chép SQL tạo bảng'; }
  }
}

async function testSupabaseConnection() {
  const btn = document.getElementById('supabaseTestBtn');
  const alertBox = document.getElementById('supabaseAlertBox');
  const badge = document.getElementById('supabaseStatusBadge');
  const statusMsg = document.getElementById('supabaseStatusMsg');

  const url = (document.getElementById('supabaseUrlInput')?.value || '').trim();
  const key = (document.getElementById('supabaseKeyInput')?.value || '').trim();

  if (!url) {
    if (alertBox) {
      alertBox.textContent = '⚠️ Vui lòng nhập Supabase Project URL.';
      alertBox.className = 'login-alert error';
    }
    return;
  }

  if (btn) { btn.disabled = true; btn.textContent = '⏳ Đang test...'; }
  if (alertBox) alertBox.className = 'login-alert hidden';

  try {
    const res = await requestJson('/api/manager/supabase/test', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url, key })
    });

    if (res.ok) {
      if (alertBox) {
        alertBox.textContent = '✅ ' + (res.data?.message || 'Kết nối Supabase thành công!');
        alertBox.className = 'login-alert success';
      }
      if (badge) {
        badge.innerHTML = '🟢 Kết nối OK';
        badge.style.background = 'rgba(34,197,94,0.2)';
        badge.style.color = '#4ade80';
        badge.style.borderColor = 'rgba(34,197,94,0.4)';
      }
      if (statusMsg) statusMsg.textContent = 'Kết nối Supabase Cloud phản hồi ping thành công!';
      showToast('✅ Kết nối Supabase thành công!');
    } else {
      if (alertBox) {
        alertBox.textContent = '⚠️ ' + (res.data?.error || 'Kết nối Supabase thất bại.');
        alertBox.className = 'login-alert error';
      }
      if (badge) {
        badge.innerHTML = '🔴 Lỗi kết nối';
        badge.style.background = 'rgba(239,68,68,0.2)';
        badge.style.color = '#f87171';
        badge.style.borderColor = 'rgba(239,68,68,0.4)';
      }
      if (statusMsg) statusMsg.textContent = res.data?.error || 'Lỗi kết nối Supabase.';
    }
  } catch (err) {
    if (alertBox) {
      alertBox.textContent = '⚠️ Lỗi kiểm tra: ' + err.message;
      alertBox.className = 'login-alert error';
    }
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = '🧪 Kiểm tra kết nối'; }
  }
}

async function saveSupabaseConfig() {
  const btn = document.getElementById('supabaseSaveBtn');
  const alertBox = document.getElementById('supabaseAlertBox');
  const badge = document.getElementById('supabaseStatusBadge');
  const statusMsg = document.getElementById('supabaseStatusMsg');

  const url = (document.getElementById('supabaseUrlInput')?.value || '').trim();
  const key = (document.getElementById('supabaseKeyInput')?.value || '').trim();

  if (btn) { btn.disabled = true; btn.textContent = '⏳ Đang lưu...'; }
  if (alertBox) alertBox.className = 'login-alert hidden';

  try {
    const res = await requestJson('/api/manager/supabase/config', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url, key })
    });

    if (res.ok) {
      if (alertBox) {
        alertBox.textContent = '✅ ' + (res.data?.message || 'Đã lưu cấu hình Supabase!');
        alertBox.className = 'login-alert success';
      }
      if (badge) {
        if (res.data.connected) {
          badge.innerHTML = '🟢 Đã kết nối';
          badge.style.background = 'rgba(34,197,94,0.2)';
          badge.style.color = '#4ade80';
          badge.style.borderColor = 'rgba(34,197,94,0.4)';
        } else {
          badge.innerHTML = '🟡 Đã lưu (Chưa ping)';
          badge.style.background = 'rgba(234,179,8,0.2)';
          badge.style.color = '#eab308';
          badge.style.borderColor = 'rgba(234,179,8,0.4)';
        }
      }
      if (statusMsg) statusMsg.textContent = res.data?.message || 'Cấu hình đã được lưu.';
      showToast('✅ Đã lưu cấu hình Supabase Cloud!');
    } else {
      if (alertBox) {
        alertBox.textContent = '⚠️ ' + (res.data?.error || 'Lưu cấu hình thất bại.');
        alertBox.className = 'login-alert error';
      }
    }
  } catch (err) {
    if (alertBox) {
      alertBox.textContent = '⚠️ Lỗi: ' + err.message;
      alertBox.className = 'login-alert error';
    }
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = '💾 Lưu cấu hình'; }
  }
}

function formatSupabaseCounts(counts, isUpload) {
  if (!counts || typeof counts !== 'object') return '';
  const parts = [];
  if (typeof counts.bots === 'number') parts.push(counts.bots + ' bot');
  if (typeof counts.users === 'number') parts.push(counts.users + ' users');
  if (typeof counts.keys === 'number') parts.push(counts.keys + ' keys');
  if (typeof counts.botSettings === 'number' && counts.botSettings > 0) parts.push(counts.botSettings + ' cấu hình');
  if (typeof counts.workersSynced === 'number' && counts.workersSynced > 0) parts.push(counts.workersSynced + ' worker');
  if (parts.length === 0) {
    const fallback = Object.entries(counts)
      .filter(([k, v]) => typeof v === 'number' && v > 0)
      .map(([k, v]) => v + ' ' + k);
    return fallback.join(', ');
  }
  return parts.join(', ');
}

async function runSupabaseSyncAction(buttonId, endpoint, busyText, successPrefix) {
  const btn = document.getElementById(buttonId);
  const otherBtnId = buttonId === 'supabaseSyncBtn' ? 'supabaseSyncDownBtn' : 'supabaseSyncBtn';
  const otherBtn = document.getElementById(otherBtnId);
  const saveBtn = document.getElementById('supabaseSaveBtn');
  const alertBox = document.getElementById('supabaseAlertBox');
  if (btn?.disabled) return;

  const isUpload = endpoint.includes('upload');

  if (btn) {
    btn.disabled = true;
    btn.dataset.originalHtml = btn.innerHTML;
    btn.innerHTML = '<span class="spinner-sm"></span> ' + escapeHtml(busyText);
  }
  if (otherBtn) otherBtn.disabled = true;
  if (saveBtn) saveBtn.disabled = true;

  if (alertBox) {
    alertBox.innerHTML = '<div style="display:flex;align-items:center;gap:8px;"><span class="spinner-sm"></span><span>' + escapeHtml(busyText) + ' Đang xử lý dữ liệu với Supabase Cloud...</span></div>';
    alertBox.className = 'login-alert info';
  }

  try {
    const res = await requestJson(endpoint, { method: 'POST', timeoutMs: 35000 });
    if (!res.ok) {
      const error = new Error(res.data?.error || 'Thao tác Supabase thất bại.');
      error.counts = res.data?.counts;
      throw error;
    }
    const counts = res.data?.counts;
    const partial = res.data?.partial === true;
    const countSummary = formatSupabaseCounts(counts, isUpload);

    let detailedMsg = '';
    if (countSummary) {
      detailedMsg = isUpload
        ? ('Đã sao lưu thành công ' + countSummary + ' lên Supabase Cloud.')
        : ('Đã tải thành công ' + countSummary + ' từ Supabase Cloud.');
    } else {
      detailedMsg = res.data?.message || 'Hoàn tất đồng bộ Supabase Cloud.';
    }

    if (partial) {
      const warnMsg = '⚠️ ' + (res.data?.message || detailedMsg);
      if (alertBox) {
        alertBox.textContent = warnMsg;
        alertBox.className = 'login-alert error';
      }
      showToast(warnMsg, 'warning', 6000);
    } else {
      if (alertBox) {
        alertBox.textContent = '✅ ' + detailedMsg;
        alertBox.className = 'login-alert success';
      }
      showToast('✅ ' + detailedMsg, 'success', 5000);
    }

    lastHomeSig = '';
    await Promise.allSettled([refreshHome(), refreshUserManagementPage(), refreshKeysTable()]);
    if (selectedBotId !== null) await refreshDetail(true);
  } catch (err) {
    const errCountSummary = formatSupabaseCounts(err.counts, isUpload);
    const message = (err.message || 'Không thể đồng bộ Supabase.') + (errCountSummary ? (' (' + errCountSummary + ')') : '');
    if (alertBox) {
      alertBox.textContent = '⚠️ ' + message;
      alertBox.className = 'login-alert error';
    }
    showToast('⚠️ ' + message, 'error', 6000);
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = btn.dataset.originalHtml || (buttonId === 'supabaseSyncBtn' ? '⬆ Tải lên Supabase Cloud' : '⬇ Đồng bộ xuống');
    }
    if (otherBtn) otherBtn.disabled = false;
    if (saveBtn) saveBtn.disabled = false;
  }
}
async function syncAllToSupabase() {
  return runSupabaseSyncAction('supabaseSyncBtn', '/api/manager/supabase/upload', '⏳ Đang tải lên...', '⬆ ');
}
async function syncDownFromSupabase() {
  return runSupabaseSyncAction('supabaseSyncDownBtn', '/api/manager/supabase/sync-down', '⏳ Đang tải xuống...', '⬇ ');
}
async function resolveAllPendingResets() {
  if (!confirm('Bạn có chắc chắn muốn dọn dẹp và hoàn tất tất cả các tiến trình reset / xung đột đang treo trên các bot?')) return;
  const btn = document.getElementById('resolveAllResetsBtn');
  if (btn) btn.disabled = true;
  try {
    showToast('⏳ Đang xử lý hoàn tất các reset treo...', 'info', 5000);
    await requestJson('/api/manager/pending-resets/all/resolve', {
      method: 'POST',
      body: { action: 'resume' }
    });
    const checkRes = await requestJson('/api/manager/pending-resets');
    if (checkRes.ok && checkRes.data && checkRes.data.conflicts > 0) {
      await requestJson('/api/manager/pending-resets/all/resolve', {
        method: 'POST',
        body: { action: 'discard', confirmOwnerCheck: true }
      });
    }
    showToast('✅ Đã dọn dẹp và gỡ bỏ xung đột reset thành công!', 'success', 5000);
    await Promise.allSettled([refreshHome(), refreshUserManagementPage()]);
  } catch (err) {
    showToast('⚠️ Lỗi khi dọn dẹp reset: ' + (err.message || 'Thất bại'), 'error', 6000);
  } finally {
    if (btn) btn.disabled = false;
  }
}

window.resolveAllPendingResets = resolveAllPendingResets;

window.handleRenameClick = handleRenameClick;
window.renameBotAlias = renameBotAlias;
window.renameDetailBotAlias = renameDetailBotAlias;
window.addBotFromWeb = addBotFromWeb;
window.addDetailAutoChatSchedule = addDetailAutoChatSchedule;
window.addDetailBotSchedule = addDetailBotSchedule;
window.allowBotDrop = allowBotDrop;
window.clearDetailChat = clearDetailChat;
window.saveDetailProxy = saveDetailProxy;
window.testDetailProxy = testDetailProxy;
window.clearDetailProxy = clearDetailProxy;
window.toggleTrialGiftSetting = toggleTrialGiftSetting;
window.clearDetailLogs = clearDetailLogs;
window.closeAddBotModal = closeAddBotModal;
window.closeAdminModal = closeAdminModal;
window.closeEditBotModal = closeEditBotModal;
window.copyText = copyText;
window.deleteBot = deleteBot;
window.detailAction = detailAction;
window.detailPost = detailPost;
window.detailScheduleModeChanged = detailScheduleModeChanged;
window.dropBot = dropBot;
window.dropDetailInventory = dropDetailInventory;
window.dropDetailItemToWorld = dropDetailItemToWorld;
window.editBot = editBot;
window.equipDetailItem = equipDetailItem;
window.goHome = goHome;
window.loadAdminCredentials = loadAdminCredentials;
window.handleDetailEquipmentClick = handleDetailEquipmentClick;
window.handleDetailDropZoneClick = handleDetailDropZoneClick;
window.cancelDetailSlotSelection = cancelDetailSlotSelection;
window.moveDetailItem = moveDetailItem;
window.openAddBotModal = openAddBotModal;
window.openAdminModal = openAdminModal;
window.openBroadcastModal = openBroadcastModal;
window.closeBroadcastModal = closeBroadcastModal;
window.submitBroadcast = submitBroadcastCommand;
window.hideLoginGate = hideLoginGate;
window.openBatchSettingsModal = openBatchSettingsModal;
window.closeBatchSettingsModal = closeBatchSettingsModal;
window.submitBatchSettings = submitBatchSettings;
window.filterBots = filterBots;
window.updateKpis = updateKpis;
window.openBot = openBot;
window.refreshDetail = refreshDetail;
window.refreshHome = refreshHome;
window.removeDetailAutoChatSchedule = removeDetailAutoChatSchedule;
window.removeDetailBotSchedule = removeDetailBotSchedule;
window.runAllAction = runAllAction;
window.saveDetailAccount = saveDetailAccount;
window.saveDetailAutoChat = saveDetailAutoChat;
window.saveDetailBotSchedules = saveDetailBotSchedules;
window.saveDetailSettings = saveDetailSettings;
window.detailBotScheduleModeChanged = detailBotScheduleModeChanged;
window.saveEditBot = saveEditBot;
window.selectDetailHotbar = selectDetailHotbar;
window.sendDetailMessage = sendDetailMessage;
window.showToast = showToast;
window.startBotDrag = startBotDrag;
window.unequipDetail = unequipDetail;
window.quickBotAction = quickBotAction;
window.setStatusFilter = setStatusFilter;
window.resetBotFilters = resetBotFilters;
window.toggleSoundAlert = toggleSoundAlert;
window.exportBotList = exportBotList;
window.triggerImport = triggerImport;
window.handleImportFile = handleImportFile;
window.reconnectOfflineBots = reconnectOfflineBots;
window.changeBotSort = changeBotSort;
window.quickDetailCommand = quickDetailCommand;
window.copyToClipboard = copyToClipboard;
window.openWebhookModal = openWebhookModal;
window.closeWebhookModal = closeWebhookModal;
window.saveWebhookSettings = saveWebhookSettings;
window.testWebhookSettings = testWebhookSettings;
window.exportBotLogs = exportBotLogs;
window.handleLoginSubmit = handleLoginSubmit;
window.logout = logout;
window.togglePasswordVisibility = togglePasswordVisibility;
window.openUserManagementModal = openUserManagementModal;
window.closeUserManagementModal = closeUserManagementModal;
window.openCreateUserModal = openCreateUserModal;
window.openEditUserModal = openEditUserModal;
window.closeUserEditModal = closeUserEditModal;
window.saveUserForm = saveUserForm;
window.deleteUserPrompt = deleteUserPrompt;
window.toggleSelectAllUserBots = toggleSelectAllUserBots;
window.generateRandomUserPassword = generateRandomUserPassword;
window.togglePassPeek = toggleUserPasswordPeek;
window.openAnnouncementAdminModal = openAnnouncementAdminModal;
window.closeAnnouncementAdminModal = closeAnnouncementAdminModal;
window.saveAnnouncementConfig = saveAnnouncementConfig;
window.previewAnnouncementModal = previewAnnouncementModal;
window.handleAnnouncementModeChange = handleAnnouncementModeChange;
window.dismissUserAnnouncement = dismissUserAnnouncement;
window.toggleUserProfileDropdown = toggleUserProfileDropdown;
window.closeUserProfileDropdown = closeUserProfileDropdown;
window.openChangePasswordModal = openChangePasswordModal;
window.closeChangePasswordModal = closeChangePasswordModal;
window.submitChangePassword = submitChangePassword;
window.openChangelogModal = openChangelogModal;
window.closeChangelogModal = closeChangelogModal;
window.openAuditLogModal = openAuditLogModal;
window.closeAuditLogModal = closeAuditLogModal;
window.refreshAuditLogs = refreshAuditLogs;
window.switchAuditLogType = switchAuditLogType;
window.openSupabaseModal = openSupabaseModal;
window.closeSupabaseModal = closeSupabaseModal;
window.copySupabaseSchemaSql = copySupabaseSchemaSql;
window.testSupabaseConnection = testSupabaseConnection;
window.saveSupabaseConfig = saveSupabaseConfig;
window.syncAllToSupabase = syncAllToSupabase;
window.syncDownFromSupabase = syncDownFromSupabase;
window.debounceAuditFilter = debounceAuditFilter;
window.filterAuditLogs = debounceAuditFilter;
window.navigateAuditPage = navigateAuditPage;
window.exportAuditLogs = exportAuditLogs;
window.clearAllAuditLogs = clearAllAuditLogs;
window.openBackupManagerModal = openBackupManagerModal;
window.closeBackupManagerModal = closeBackupManagerModal;
window.refreshBackupList = refreshBackupList;
window.triggerCreateBackup = triggerCreateBackup;
window.openBroadcastModal = openBroadcastModal;
window.closeBroadcastModal = closeBroadcastModal;
window.submitBroadcastCommand = submitBroadcastCommand;
window.openRenewModal = openRenewModal;
window.closeRenewModal = closeRenewModal;
window.submitRenewKey = submitRenewKey;
window.openKeyManagementModal = openKeyManagementModal;
window.closeKeyManagementModal = closeKeyManagementModal;
window.refreshKeysTable = refreshKeysTable;
window.submitCreateKeys = submitCreateKeys;
window.deleteLicenseKey = deleteLicenseKey;
window.quickAddUserDays = quickAddUserDays;
window.resetCustomerBot = resetCustomerBot;
window.resetBotForNewCustomer = resetCustomerBot;
window.renderDetailRemoteGui = renderDetailRemoteGui;
window.clickDetailGuiSlot = clickDetailGuiSlot;
window.closeDetailGuiWindow = closeDetailGuiWindow;
window.saveAndRestartBot = saveAndRestartBot;
window.cleanDeadBots = cleanDeadBots;
window.openEditSecretModal = openEditSecretModal;
window.toggleEditSecretKeyVisibility = toggleEditSecretKeyVisibility;

window.addEventListener('error',event=>{
  try{console.error('[MANAGER UI]',event.error||event.message||'Unknown UI error');}catch(_){}
});
window.addEventListener('unhandledrejection',event=>{
  try{console.error('[MANAGER UI] Unhandled rejection',event.reason);}catch(_){}
});

(async function init(){
  updateSoundAlertButton();
  initDetailChatInputHistory();

  if (currentUser) {
    try {
      applyUserRoleUI();
      hideLoginGate();
    } catch (_) {}
  }

  try {
    let res = await requestJson('/api/auth/me');
    if (!res.ok && res.status === 401) {
      // Nếu có stale Bearer token trong localStorage khiến bị 401 dù cookie hợp lệ,
      // xóa bỏ stale token và thử lại lần 2 bằng session cookie:
      const staleToken = localStorage.getItem('kingmc_session');
      if (staleToken) {
        try { localStorage.removeItem('kingmc_session'); } catch (_) {}
        res = await requestJson('/api/auth/me');
      }
    }

    if (res.ok && res.data?.user) {
      currentUser = res.data.user;
      applyUserRoleUI();
      hideLoginGate();
      const routed = await resolveRouteFromUrl();
      if (!routed) await refreshHome();
      scheduleNextManagerPoll();
      checkAndShowAnnouncement();
      if (typeof checkRewardQueryParams === 'function') checkRewardQueryParams();
    } else if (res.status === 401) {
      currentUser = null;
      bots = [];
      selectedBotId = null;
      detailBot = null;
      if (managerPollTimerId) clearTimeout(managerPollTimerId);
      try {
        localStorage.removeItem('kingmc_session');
        sessionStorage.removeItem('kingmc_session');
        document.cookie = 'kingmc_mgr_session=; Path=/; Expires=Thu, 01 Jan 1970 00:00:01 GMT; Max-Age=0; SameSite=Lax';
      } catch (_) {}
      applyUserRoleUI();
      renderHome();
      showLoginGate();
    } else if (res.status === 403) {
      currentUser = null;
      applyUserRoleUI();
      renderHome();
      showLoginGate();
      showToast(res.data?.error || 'Tài khoản không đủ quyền truy cập.');
    } else {
      if (!currentUser) {
        applyUserRoleUI();
        renderHome();
        showLoginGate();
        showToast('⚠️ Không thể xác minh phiên đăng nhập (' + (res.data?.error || 'Lỗi kết nối') + ').');
      }
    }
  } catch (err) {
    if (!currentUser) {
      applyUserRoleUI();
      renderHome();
      showLoginGate();
    }
  }
})();

let lastUserActivityAt = Date.now();
['mousemove', 'keydown', 'touchstart', 'scroll'].forEach(evt => {
  window.addEventListener(evt, () => { lastUserActivityAt = Date.now(); }, { passive: true });
});

// managerPollTimerId declared at top of client script
function scheduleNextManagerPoll() {
  if (managerPollTimerId) clearTimeout(managerPollTimerId);
  if (!currentUser) return;
  const isIdle = Date.now() - lastUserActivityAt > 2 * 60 * 1000;
  const delay = document.hidden ? 45000 : (isIdle ? 15000 : 3000); // 3s active poll for real-time responsiveness, 15s idle
  managerPollTimerId = setTimeout(async () => {
    try {
      if (!routeResolving && currentUser) {
        if (selectedBotId === null) await refreshHome();
        else await refreshDetail(false);
      }
    } finally {
      if (currentUser) {
        scheduleNextManagerPoll();
      }
    }
  }, delay);
}

document.addEventListener('visibilitychange', () => {
  if (!document.hidden) {
    lastUserActivityAt = Date.now();
    if (selectedBotId === null) refreshHome();
    else refreshDetail(true);
  }
  scheduleNextManagerPoll();
});

setInterval(updateDetailUptime, 1000);
setInterval(updateUserHeaderCountdown, 5000);
</script>

  <!-- MODAL BROADCAST LỆNH -->
  <div id="broadcastModal" class="modal hidden">
    <div class="modal-card" style="max-width:480px;">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;">
        <h3 style="margin:0;display:flex;align-items:center;gap:8px;">📡 Broadcast Lệnh Hàng Loạt</h3>
        <button class="small" onclick="closeBroadcastModal()">✕</button>
      </div>
      <p style="font-size:13px;color:var(--muted);margin-bottom:12px;">Gửi đồng loạt 1 lệnh chat hoặc câu lệnh server (/bal, /menu, /spawn,...) tới toàn bộ các bot trong quyền quản lý của bạn:</p>
      <div style="margin-bottom:12px;">
        <label for="broadcastTargetTag" style="display:block;font-size:12px;color:var(--muted);margin-bottom:5px;font-weight:600;">🎯 Đối tượng nhận lệnh:</label>
        <select id="broadcastTargetTag" style="width:100%;box-sizing:border-box;padding:8px 10px;border-radius:6px;background:rgba(0,0,0,0.3);color:var(--text);border:1px solid var(--border);font-size:13px;outline:none;">
          <option value="">🌐 Toàn bộ bot trong danh sách</option>
        </select>
      </div>
      <div style="margin-bottom:14px;">
        <input type="text" id="broadcastCommandInput" placeholder="Ví dụ: /bal hoặc /menu hoặc Tin nhắn..." style="width:100%;box-sizing:border-box;" />
      </div>
      <div class="chip-row" style="margin-bottom:14px;display:flex;gap:6px;flex-wrap:wrap;">
        <button type="button" class="small" onclick="document.getElementById('broadcastCommandInput').value='/bal'">/bal</button>
        <button type="button" class="small" onclick="document.getElementById('broadcastCommandInput').value='/menu'">/menu</button>
        <button type="button" class="small" onclick="document.getElementById('broadcastCommandInput').value='/spawn'">/spawn</button>
        <button type="button" class="small" onclick="document.getElementById('broadcastCommandInput').value='/team chat'">/team chat</button>
      </div>
      <div id="broadcastResultBox" style="display:none;font-size:12px;margin-bottom:12px;padding:8px;border-radius:6px;"></div>
      <div class="modal-actions" style="margin-top:16px;">
        <button onclick="closeBroadcastModal()">Hủy</button>
        <button class="primary" onclick="submitBroadcastCommand()">🚀 Bắn Lệnh Ngay</button>
      </div>
    </div>
  </div>

  <!-- MODAL GIA HẠN BẰNG KEY (USER) -->
  <div id="renewModal" class="modal hidden">
    <div class="modal-card" style="max-width:440px;">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;">
        <h3 style="margin:0;display:flex;align-items:center;gap:8px;">🎁 Gia Hạn Gói Thuê Bằng Mã Key</h3>
        <button class="small" onclick="closeRenewModal()">✕</button>
      </div>
      <p style="font-size:13px;color:var(--muted);margin-bottom:14px;">Nhập mã kích hoạt (License Key/Giftcode) được cấp bởi Quản trị viên để gia hạn thời gian sử dụng bot:</p>
      <div style="margin-bottom:14px;">
        <label style="font-size:12px;color:var(--muted);font-weight:600;display:block;margin-bottom:4px;">MÃ KEY GIA HẠN:</label>
        <input type="text" id="renewKeyInput" placeholder="VD: KINGMC-7D-ABC123" style="width:100%;box-sizing:border-box;text-transform:uppercase;" />
      </div>
      <div id="renewResultBox" style="display:none;font-size:12px;margin-bottom:12px;padding:8px;border-radius:6px;"></div>
      <div class="modal-actions" style="margin-top:16px;">
        <button onclick="closeRenewModal()">Đóng</button>
        <button class="primary" onclick="submitRenewKey()">Kích Hoạt Ngay</button>
      </div>
    </div>
  </div>

  <!-- MODAL QUẢN LÝ KEY GIA HẠN (ADMIN ONLY) -->
  <div id="keyManagementModal" class="modal hidden">
    <div class="modal-card" style="max-width:750px;">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;">
        <h3 style="margin:0;display:flex;align-items:center;gap:8px;">🎟️ Quản Lý Mã Key Gia Hạn (License Keys)</h3>
        <button class="small" onclick="closeKeyManagementModal()">✕</button>
      </div>
      <div style="background:rgba(255,255,255,0.03);border:1px solid var(--border);padding:14px;border-radius:8px;margin-bottom:16px;">
        <h4 style="margin:0 0 10px 0;font-size:14px;">Tạo Mã Key Mới</h4>
        <div style="display:flex;gap:10px;flex-wrap:wrap;align-items:flex-end;">
          <div>
            <label style="font-size:11px;color:var(--muted);display:block;margin-bottom:4px;">GÓI THUÊ (NGÀY):</label>
            <div style="display:flex;gap:4px;align-items:center;">
              <select id="createKeyDays" onchange="onKeyDaysSelectChange('modal')" style="background:var(--bg);border:1px solid var(--border);color:#fff;padding:8px;border-radius:6px;font-size:13px;">
                <option value="1">1 Ngày (Dùng thử)</option>
                <option value="3">3 Ngày</option>
                <option value="7" selected>7 Ngày (1 Tuần)</option>
                <option value="14">14 Ngày (2 Tuần)</option>
                <option value="30">30 Ngày (1 Tháng)</option>
                <option value="lifetime">👑 Vĩnh Viễn</option>
                <option value="custom">✏️ Tùy chỉnh ngày...</option>
              </select>
              <input type="number" id="createKeyCustomDays" min="1" max="3650" placeholder="Số ngày" style="display:none;width:75px;background:var(--bg);border:1px solid var(--border);color:#fff;padding:8px;border-radius:6px;font-size:13px;" />
            </div>
          </div>
          <div>
            <label style="font-size:11px;color:var(--muted);display:block;margin-bottom:4px;">TÊN GÓI:</label>
            <input type="text" id="createKeyPlan" placeholder="VD: Gói Tuần VIP" style="background:var(--bg);border:1px solid var(--border);color:#fff;padding:8px 10px;border-radius:6px;font-size:13px;width:130px;" />
          </div>
          <div>
            <label style="font-size:11px;color:var(--muted);display:block;margin-bottom:4px;">SỐ BOT:</label>
            <input type="number" id="createKeyBotCount" value="1" min="1" max="50" style="background:var(--bg);border:1px solid var(--border);color:#fff;padding:8px 10px;border-radius:6px;font-size:13px;width:60px;" />
          </div>
          <div>
            <label style="font-size:11px;color:var(--muted);display:block;margin-bottom:4px;">LƯỢT DÙNG (0=∞):</label>
            <input type="number" id="createKeyMaxUses" value="1" min="0" max="10000" style="background:var(--bg);border:1px solid var(--border);color:#fff;padding:8px 10px;border-radius:6px;font-size:13px;width:72px;" />
          </div>
          <div>
            <label style="font-size:11px;color:var(--muted);display:block;margin-bottom:4px;">SỐ LƯỢNG KEY:</label>
            <input type="number" id="createKeyCount" value="1" min="1" max="10" style="background:var(--bg);border:1px solid var(--border);color:#fff;padding:8px 10px;border-radius:6px;font-size:13px;width:60px;" />
          </div>
          <button class="primary" onclick="submitCreateKeys()" style="padding:8px 16px;">+ Tạo Key</button>
        </div>
      </div>

      <div style="max-height:300px;overflow-y:auto;border:1px solid var(--border);border-radius:6px;">
        <table style="width:100%;border-collapse:collapse;font-size:12px;text-align:left;">
          <thead>
            <tr style="background:rgba(255,255,255,0.06);border-bottom:1px solid var(--border);">
              <th style="padding:8px 10px;">MÃ KEY</th>
              <th style="padding:8px 10px;">GÓI</th>
              <th style="padding:8px 10px;">TRẠNG THÁI</th>
              <th style="padding:8px 10px;">NGƯỜI KÍCH HOẠT</th>
              <th style="padding:8px 10px;">HẾT HẠN</th>
              <th style="padding:8px 10px;text-align:right;">THAO TÁC</th>
            </tr>
          </thead>
          <tbody id="keysTableBody"></tbody>
        </table>
      </div>
      <div class="modal-actions" style="margin-top:16px;">
        <button onclick="closeKeyManagementModal()">Đóng</button>
      </div>
    </div>
  </div>

</body>
</html>`;

module.exports = { HTML };
