const mineflayer = require('mineflayer');
const express = require('express');

const app = express();
const HTTP_PORT = Number(process.env.PORT || 10000);

const BOT_COUNT = 3;
const MAX_LOGS = 100;
const RECONNECT_DELAY = 10000;

// Giữ đúng protocol/host/port đang chạy ổn trong bản cũ.
const MC_VERSION = '1.20.1';
const HOSTS = (process.env.MC_SERVER_HOSTS || 'sgp.kingmc.vn,kingmc.vn')
    .split(',')
    .map(host => host.trim())
    .filter(Boolean);
const PORT = Number(process.env.MC_SERVER_PORT || 25565);

app.use(express.json({ limit: '8kb' }));

function cleanMinecraftText(text) {
    if (!text) return '';

    return String(text)
        .replace(/§x(§[0-9a-f]){6}/gi, '')
        .replace(/&x(&[0-9a-f]){6}/gi, '')
        .replace(/&#[0-9a-f]{6}/gi, '')
        .replace(/§#[0-9a-f]{6}/gi, '')
        .replace(/§[0-9a-fk-or]/gi, '')
        .replace(/&[0-9a-fk-or]/gi, '')
        .replace(/§./g, '')
        .replace(/[\u00A0\u200B\uFEFF]/g, ' ')
        .normalize('NFC')
        .trim();
}

function getEnvCredentials(index) {
    // Bot 1 vẫn tương thích ENV cũ.
    if (index === 1) {
        return {
            username: process.env.BOT1_USERNAME || process.env.MC_USERNAME || '',
            password: process.env.BOT1_PASSWORD || process.env.MC_PASSWORD || ''
        };
    }

    return {
        username: process.env[`BOT${index}_USERNAME`] || '',
        password: process.env[`BOT${index}_PASSWORD`] || ''
    };
}

function createBotState(id) {
    const credentials = getEnvCredentials(id);

    return {
        id,
        username: credentials.username,
        password: credentials.password,

        bot: null,
        hostIndex: 0,

        status: 'offline',
        ready: false,
        manuallyStopped: true,
        connectedAt: null,

        reconnectTimer: null,
        afkTimers: [],
        lastAuthTime: 0,

        logs: []
    };
}

const bots = Array.from(
    { length: BOT_COUNT },
    (_, i) => createBotState(i + 1)
);

function addLog(state, message) {
    const time = new Date().toLocaleTimeString('en-GB');
    const line = `${time} ${message}`;

    state.logs.push(line);

    if (state.logs.length > MAX_LOGS) {
        state.logs.splice(0, state.logs.length - MAX_LOGS);
    }

    console.log(`[BOT ${state.id}] ${message}`);
}

function clearAfkTimers(state) {
    for (const timer of state.afkTimers) {
        clearTimeout(timer);
    }

    state.afkTimers = [];
}

function clearReconnectTimer(state) {
    if (state.reconnectTimer) {
        clearTimeout(state.reconnectTimer);
        state.reconnectTimer = null;
    }
}

function clearAllTimers(state) {
    clearAfkTimers(state);
    clearReconnectTimer(state);
}

function currentHost(state) {
    return HOSTS[state.hostIndex] || HOSTS[0] || 'sgp.kingmc.vn';
}

function getPing(state) {
    if (!state.bot) return null;

    if (state.bot.player && Number.isFinite(state.bot.player.ping)) {
        return state.bot.player.ping;
    }

    if (
        state.bot._client &&
        Number.isFinite(state.bot._client.latency)
    ) {
        return state.bot._client.latency;
    }

    return null;
}

function publicBotState(state) {
    return {
        id: state.id,
        username: state.username || '',
        status: state.status,
        ready: state.ready,
        ping: getPing(state),
        host: currentHost(state),
        port: PORT,
        version: MC_VERSION,
        connectedAt: state.connectedAt
    };
}

function scheduleReconnect(state) {
    if (state.manuallyStopped || state.reconnectTimer) {
        return;
    }

    clearAfkTimers(state);

    state.ready = false;
    state.status = 'connecting';

    state.reconnectTimer = setTimeout(() => {
        state.reconnectTimer = null;

        if (!state.manuallyStopped) {
            connectBot(state);
        }
    }, RECONNECT_DELAY);

    addLog(state, `Sẽ reconnect sau ${RECONNECT_DELAY / 1000}s.`);
}

function disconnectBot(state, reason = 'Stopped') {
    clearAllTimers(state);

    state.ready = false;
    state.status = 'offline';
    state.connectedAt = null;

    const currentBot = state.bot;
    state.bot = null;

    if (!currentBot) {
        return;
    }

    try {
        currentBot.removeAllListeners();

        if (typeof currentBot.quit === 'function') {
            currentBot.quit(reason);
        }
    } catch (err) {
        console.log(
            `[BOT ${state.id}] Shutdown error: ${err.message}`
        );
    }
}

function stopBot(state) {
    state.manuallyStopped = true;
    addLog(state, 'Dừng bot từ web.');
    disconnectBot(state, 'Stopped from web panel');
}

function startBot(state) {
    if (!state.username || !state.password) {
        addLog(
            state,
            'Không thể chạy: thiếu username hoặc password.'
        );
        state.status = 'offline';
        return false;
    }

    state.manuallyStopped = false;

    clearAllTimers(state);

    // Khi bấm Chạy/Chạy lại, luôn bắt đầu lại flow từ đầu.
    state.hostIndex = 0;
    state.ready = false;
    state.connectedAt = null;
    state.status = 'connecting';

    if (state.bot) {
        disconnectBot(state, 'Restart from web panel');
        state.manuallyStopped = false;
    }

    addLog(state, 'Bắt đầu bot từ đầu.');
    connectBot(state);

    return true;
}

function registerEvents(state, bot) {
    bot.on('error', (err) => {
        addLog(state, `Lỗi kết nối: ${err.message}`);
    });

    bot.on('kicked', (reason) => {
        const reasonText =
            typeof reason === 'string'
                ? reason
                : JSON.stringify(reason);

        state.status = 'kicked';
        state.ready = false;

        addLog(
            state,
            `Bị kick: ${cleanMinecraftText(reasonText)}`
        );
    });

    bot.on('end', () => {
        if (state.bot === bot) {
            state.bot = null;
        }

        state.ready = false;
        state.connectedAt = null;

        if (state.manuallyStopped) {
            state.status = 'offline';
            addLog(state, 'Đã ngắt kết nối.');
            return;
        }

        state.status = 'offline';
        addLog(state, 'Mất kết nối.');

        if (HOSTS.length > 1) {
            state.hostIndex =
                (state.hostIndex + 1) % HOSTS.length;
        }

        scheduleReconnect(state);
    });

    bot.once('spawn', () => {
        state.status = 'online';
        state.ready = false;
        state.connectedAt = Date.now();

        addLog(state, 'Đã spawn vào server.');
    });

    bot.on('message', (jsonMsg) => {
        handleServerMessage(state, bot, jsonMsg);
    });

    bot.on('windowOpen', (window) => {
        const title =
            window && window.title
                ? cleanMinecraftText(window.title.toString())
                : '';

        addLog(
            state,
            `GUI mở: ${title || 'unknown'}`
        );
    });
}

function connectBot(state) {
    if (state.manuallyStopped) {
        return;
    }

    clearAfkTimers();
    clearReconnectTimer();

    state.ready = false;
    state.status = 'connecting';

    const host = currentHost(state);

    addLog(
        state,
        `Đang kết nối tới ${host}:${PORT} | Minecraft ${MC_VERSION}`
    );

    let bot;

    try {
        bot = mineflayer.createBot({
            host,
            port: PORT,
            username: state.username,
            version: MC_VERSION,
            auth: 'offline'
        });
    } catch (err) {
        state.status = 'offline';

        addLog(
            state,
            `Lỗi khởi tạo Mineflayer: ${err.message}`
        );

        scheduleReconnect(state);
        return;
    }

    state.bot = bot;
    registerEvents(state, bot);
}
function handleServerMessage(state, bot, jsonMsg) {
    const text = jsonMsg.toString();
    const cleanMsg = cleanMinecraftText(text);
    const lowerMsg = cleanMsg.toLowerCase();

    addLog(state, `[MC] ${cleanMsg}`);

    // Giữ nguyên lobby detection từ bản cũ.
    if (lowerMsg.includes('kingmc.vn')) {
        const pos = bot && bot.entity
            ? bot.entity.position
            : null;

        let isLobby = false;

        if (pos) {
            const dx = Math.abs(pos.x - 0.50);
            const dy = Math.abs(pos.y - 41.00);
            const dz = Math.abs(pos.z - 0.80);

            if (
                dx <= 2.0 &&
                dy <= 2.0 &&
                dz <= 2.0
            ) {
                isLobby = true;
            }
        }

        if (isLobby) {
            const now = Date.now();

            if (
                !state.lastAuthTime ||
                now - state.lastAuthTime > 5000
            ) {
                state.lastAuthTime = now;
                state.ready = false;
                state.status = 'authenticating';

                addLog(
                    state,
                    'Xác nhận đang ở Lobby KingMC.'
                );

                if (!state.password) {
                    addLog(
                        state,
                        'Thiếu password, không thể gửi /dn.'
                    );
                    return;
                }

                // Giữ nguyên logic /dn đang chạy tốt.
                bot.chat(`/dn ${state.password}`);
                addLog(state, 'Đã gửi /dn.');

                const timer = setTimeout(() => {
                    if (
                        !state.manuallyStopped &&
                        state.bot === bot
                    ) {
                        addLog(
                            state,
                            'Đã chờ /dn. Bắt đầu routine /menu.'
                        );

                        startAfkRoutine(state);
                    }
                }, 2500);

                state.afkTimers.push(timer);
            }
        }

        return;
    }

    // Giữ nguyên fallback login/register.
    if (
        state.password &&
        (
            lowerMsg.includes('/dk') ||
            lowerMsg.includes('dang ky bang lenh') ||
            lowerMsg.includes('dang ky') ||
            lowerMsg.includes('/register')
        )
    ) {
        const now = Date.now();

        if (
            !state.lastAuthTime ||
            now - state.lastAuthTime > 3000
        ) {
            state.lastAuthTime = now;
            state.status = 'authenticating';

            bot.chat(
                `/register ${state.password} ${state.password}`
            );

            addLog(state, 'Đã gửi /register.');
        }

        return;
    }

    if (
        state.password &&
        (
            lowerMsg.includes('/dn') ||
            lowerMsg.includes('vui long') ||
            lowerMsg.includes('dang nhap') ||
            lowerMsg.includes('/login')
        )
    ) {
        const now = Date.now();

        if (
            !state.lastAuthTime ||
            now - state.lastAuthTime > 3000
        ) {
            state.lastAuthTime = now;
            state.status = 'authenticating';

            bot.chat(`/login ${state.password}`);
            addLog(state, 'Đã gửi /login.');
        }
    }
}

function startAfkRoutine(state) {
    if (state.manuallyStopped || !state.bot) {
        return;
    }

    clearAfkTimers();

    state.ready = false;
    state.status = 'entering';

    addLog(
        state,
        'Bắt đầu AFK routine. /menu sau 6 giây...'
    );

    const menuTimer = setTimeout(() => {
        if (
            state.manuallyStopped ||
            !state.bot
        ) {
            return;
        }

        addLog(state, 'Gửi /menu...');
        state.bot.chat('/menu');

        const clickTimer = setTimeout(() => {
            if (
                state.manuallyStopped ||
                !state.bot
            ) {
                return;
            }

            addLog(
                state,
                'Đợi GUI /menu rồi click slot 24...'
            );

            const currentWindow = state.bot.currentWindow;

            if (!currentWindow) {
                addLog(
                    state,
                    'Không có GUI /menu. Thử lại routine.'
                );

                startAfkRoutine(state);
                return;
            }

            try {
                state.bot.clickWindow(24, 0, 0);

                state.ready = true;
                state.status = 'afk';

                addLog(
                    state,
                    'Đã click slot 24.'
                );

                addLog(
                    state,
                    '✅ Đã vào trạng thái AFK.'
                );
            } catch (err) {
                state.ready = false;
                state.status = 'online';

                addLog(
                    state,
                    `Lỗi click slot 24: ${err.message}`
                );
            }
        }, 4000);

        state.afkTimers.push(clickTimer);
    }, 6000);

    state.afkTimers.push(menuTimer);
}

// -----------------------------------------------------------------------------
// Dashboard UI
// -----------------------------------------------------------------------------

const HTML = `<!doctype html>
<html lang="vi">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>KingMC Bot Manager</title>
<style>
:root{
  color-scheme:dark;
  --bg:#0a0e13;
  --card:#111820;
  --card2:#151f29;
  --border:#273442;
  --text:#eef4f8;
  --muted:#95a3b2;
  --green:#30d158;
  --red:#ff453a;
  --yellow:#ffd60a;
  --blue:#4da3ff;
}
*{box-sizing:border-box}
body{
  margin:0;
  min-height:100vh;
  background:var(--bg);
  color:var(--text);
  font-family:system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;
}
button,input{
  font:inherit;
}
button{
  border:1px solid var(--border);
  border-radius:10px;
  background:#1a2530;
  color:var(--text);
  padding:9px 13px;
  cursor:pointer;
}
button:hover{background:#22313f}
button.primary{background:#1769aa;border-color:#2588d2}
button.danger{background:#3a1717;border-color:#682525}
button:disabled{opacity:.45;cursor:not-allowed}
input{
  width:100%;
  padding:11px 12px;
  border-radius:10px;
  border:1px solid var(--border);
  background:#0d1319;
  color:var(--text);
  outline:none;
}
input:focus{border-color:#3d88c7}
.app{
  width:min(1080px,calc(100% - 28px));
  margin:0 auto;
  padding:28px 0 42px;
}
h1,h2,h3,p{margin:0}
.heading{
  margin-bottom:20px;
}
.heading h1{
  font-size:24px;
}
.heading p{
  color:var(--muted);
  font-size:13px;
  margin-top:4px;
}
.cards{
  display:grid;
  grid-template-columns:repeat(3,minmax(0,1fr));
  gap:16px;
}
.card{
  min-height:190px;
  padding:20px;
  border:1px solid var(--border);
  border-radius:18px;
  background:linear-gradient(180deg,var(--card),#0e141b);
  cursor:pointer;
  transition:.15s;
}
.card:hover{
  border-color:#3e5164;
  transform:translateY(-2px);
}
.card-head{
  display:flex;
  align-items:center;
  justify-content:space-between;
}
.bot-name{
  font-weight:750;
  font-size:18px;
}
.status{
  display:flex;
  align-items:center;
  gap:7px;
  font-size:12px;
  color:var(--muted);
}
.dot{
  width:9px;
  height:9px;
  border-radius:50%;
  display:inline-block;
  background:#697582;
}
.dot.green{background:var(--green)}
.dot.red{background:var(--red)}
.dot.yellow{background:var(--yellow)}
.dot.blue{background:var(--blue)}
.card-user{
  margin-top:28px;
  font-weight:650;
  font-size:16px;
  word-break:break-all;
}
.card-meta{
  margin-top:8px;
  color:var(--muted);
  font-size:13px;
  display:flex;
  justify-content:space-between;
  gap:8px;
}
.detail{display:none}
.detail.active{display:block}
.topbar{
  display:flex;
  align-items:center;
  gap:12px;
  margin-bottom:18px;
}
.back{
  padding:8px 11px;
}
.detail-title{
  font-size:22px;
  font-weight:750;
}
.detail-subtitle{
  color:var(--muted);
  font-size:12px;
  margin-top:3px;
}
.grid{
  display:grid;
  grid-template-columns:1.1fr .9fr;
  gap:16px;
}
.panel{
  border:1px solid var(--border);
  border-radius:16px;
  background:var(--card);
  padding:17px;
}
.panel h3{
  font-size:14px;
  margin-bottom:14px;
}
.big-status{
  display:flex;
  align-items:center;
  gap:8px;
  font-size:18px;
  font-weight:750;
  margin-bottom:13px;
}
.info{
  display:grid;
  grid-template-columns:repeat(2,minmax(0,1fr));
  gap:9px;
}
info-item{
  padding:10px 11px;
  border-radius:10px;
  background:var(--card2);
}
.info-item{
  padding:10px 11px;
  border-radius:10px;
  background:var(--card2);
}
.info-label{
  color:var(--muted);
  font-size:10px;
  margin-bottom:4px;
}
.info-value{
  font-size:14px;
  word-break:break-all;
}
.controls{
  display:flex;
  gap:8px;
  flex-wrap:wrap;
  margin-top:14px;
}
.form-row{
  display:grid;
  gap:7px;
  margin-bottom:11px;
}
label{
  color:var(--muted);
  font-size:12px;
}
.chat-row{
  display:flex;
  gap:8px;
}
.log{
  height:380px;
  overflow:auto;
  background:#080b0f;
  border:1px solid var(--border);
  border-radius:10px;
  padding:10px;
  font:12px/1.55 ui-monospace,SFMono-Regular,Consolas,monospace;
  white-space:pre-wrap;
  word-break:break-word;
}
.line{
  padding:2px 0;
}
.note{
  margin-top:8px;
  color:var(--muted);
  font-size:12px;
  line-height:1.45;
}
.toast{
  position:fixed;
  right:14px;
  bottom:14px;
  display:none;
  max-width:340px;
  padding:11px 13px;
  border:1px solid var(--border);
  border-radius:10px;
  background:#18222d;
}
@media(max-width:820px){
  .cards{grid-template-columns:1fr}
  .grid{grid-template-columns:1fr}
}
</style>
</head>
<body>
<div class="app">

<section id="home">
  <div class="heading">
    <h1>KINGMC BOT MANAGER</h1>
    <p>3 bot độc lập · Mineflayer · Minecraft 1.20.1</p>
  </div>
  <div id="cards" class="cards"></div>
</section>

<section id="detail" class="detail">
  <div class="topbar">
    <button class="back" onclick="goHome()">← Quay lại</button>
    <div>
      <div id="detailTitle" class="detail-title">BOT</div>
      <div class="detail-subtitle">Quản lý và theo dõi bot</div>
    </div>
  </div>

  <div class="grid">

    <div class="panel">
      <h3>Trạng thái</h3>
      <div id="detailStatus" class="big-status"></div>

      <div class="info">
        <div class="info-item">
          <div class="info-label">USERNAME</div>
          <div id="detailUsername" class="info-value">-</div>
        </div>
        <div class="info-item">
          <div class="info-label">SERVER</div>
          <div id="detailHost" class="info-value">-</div>
        </div>
        <div class="info-item">
          <div class="info-label">PING</div>
          <div id="detailPing" class="info-value">-</div>
        </div>
        <div class="info-item">
          <div class="info-label">VERSION</div>
          <div id="detailVersion" class="info-value">-</div>
        </div>
      </div>

      <div class="controls">
        <button id="startButton" class="primary" onclick="startBot()">▶ Chạy</button>
        <button id="stopButton" class="danger" onclick="stopBot()">■ Dừng</button>
        <button onclick="restartBot()">↻ Chạy lại</button>
      </div>
    </div>

    <div class="panel">
      <h3>Chat / Command</h3>

      <form class="chat-row" onsubmit="sendMessage(event)">
        <input
          id="messageInput"
          autocomplete="off"
          placeholder="Nhập gì gửi y nguyên lên Minecraft..."
        >
        <button class="primary" type="submit">Gửi</button>
      </form>

      <div class="note">
        Không phân biệt chat hay command. Nhập gì sẽ gửi nguyên văn bằng Mineflayer.
      </div>
    </div>

    <div class="panel">
      <h3>Log</h3>
      <div id="logs" class="log"></div>
    </div>

    <div class="panel">
      <h3>Tài khoản</h3>

      <div class="form-row">
        <label>Username</label>
        <input id="usernameInput" autocomplete="off">
      </div>

      <div class="form-row">
        <label>Password</label>
        <input
          id="passwordInput"
          type="password"
          autocomplete="new-password"
          placeholder="Chỉ nhập khi đổi mật khẩu"
        >
      </div>

      <button class="primary" onclick="saveAccount()">
        Lưu thay đổi
      </button>

      <div class="note">
        Thay đổi được lưu vào runtime hiện tại. Bấm "Chạy lại" để bot kết nối lại bằng thông tin mới.
      </div>
    </div>

  </div>
</section>

</div>

<div id="toast" class="toast"></div>

<script>
let currentBotId = null;
let bots = [];

function escapeHtml(value){
  return String(value ?? '')
    .replace(/&/g,'&amp;')
    .replace(/</g,'&lt;')
    .replace(/>/g,'&gt;')
    .replace(/"/g,'&quot;')
    .replace(/'/g,'&#039;');
}

function statusMeta(status){
  const map = {
    online:['green','ONLINE'],
    afk:['green','AFK'],
    connecting:['yellow','CONNECTING'],
    authenticating:['blue','AUTH'],
    entering:['blue','ENTERING SERVER'],
    kicked:['red','KICKED'],
    offline:['red','OFFLINE']
  };

  return map[status] || ['red','OFFLINE'];
}

async function getBots(){
  const response = await fetch('/api/bots');
  if (!response.ok) throw new Error('Không lấy được trạng thái bot.');
  bots = await response.json();
  return bots;
}

function findBot(){
  return bots.find(bot => bot.id === currentBotId);
}

function renderHome(){
  const container = document.getElementById('cards');

  container.innerHTML = bots.map(bot => {
    const [color,label] = statusMeta(bot.status);
    const ping = bot.ping == null ? '--' : bot.ping + ' ms';

    return \`
      <div class="card" onclick="openBot(\${bot.id})">
        <div class="card-head">
          <div class="bot-name">BOT \${bot.id}</div>
          <div class="status">
            <span class="dot \${color}"></span>\${label}
          </div>
        </div>

        <div class="card-user">
          \${escapeHtml(bot.username || 'Chưa đặt')}
        </div>

        <div class="card-meta">
          <span>\${escapeHtml(bot.host)}:\${bot.port}</span>
          <span>\${ping}</span>
        </div>
      </div>
    \`;
  }).join('');
}

function openBot(id){
  currentBotId = Number(id);

  document.getElementById('home').style.display = 'none';
  document.getElementById('detail').classList.add('active');

  history.replaceState(null,'','#/bot/' + currentBotId);

  renderDetail();
  loadLogs();
}

function goHome(){
  currentBotId = null;

  document.getElementById('detail').classList.remove('active');
  document.getElementById('home').style.display = 'block';

  history.replaceState(null,'',location.pathname);

  getBots().then(renderHome).catch(() => {});
}

function renderDetail(){
  const bot = findBot();
  if (!bot) return;

  const [color,label] = statusMeta(bot.status);

  document.getElementById('detailTitle').textContent =
    'BOT ' + bot.id;

  document.getElementById('detailStatus').innerHTML =
    '<span class="dot ' + color + '"></span>' + label;

  document.getElementById('detailUsername').textContent =
    bot.username || 'Chưa đặt';

  document.getElementById('detailHost').textContent =
    (bot.host || '-') + ':' + bot.port;

  document.getElementById('detailPing').textContent =
    bot.ping == null ? '--' : bot.ping + ' ms';

  document.getElementById('detailVersion').textContent =
    bot.version || '-';

  document.getElementById('usernameInput').value =
    bot.username || '';

  document.getElementById('startButton').disabled =
    !['offline','kicked'].includes(bot.status);

  document.getElementById('stopButton').disabled =
    bot.status === 'offline';
}

async function loadLogs(){
  if (!currentBotId) return;

  try{
    const response = await fetch(
      '/api/bots/' + currentBotId + '/logs'
    );

    if (!response.ok) return;

    const data = await response.json();
    const box = document.getElementById('logs');

    if (!data.logs.length){
      box.innerHTML = '';
      return;
    }

    box.innerHTML = data.logs.map(
      line => '<div class="line">' + escapeHtml(line) + '</div>'
    ).join('');

    box.scrollTop = box.scrollHeight;
  }catch(_){}
}

async function refresh(){
  try{
    await getBots();

    if (currentBotId){
      renderDetail();
      await loadLogs();
    }else{
      renderHome();
    }
  }catch(_){}
}

async function startBot(){
  if (!currentBotId) return;

  const response = await fetch(
    '/api/bots/' + currentBotId + '/start',
    {method:'POST'}
  );

  const data = await response.json();
  showToast(data.message || data.error || 'Done');
  await refresh();
}

async function stopBot(){
  if (!currentBotId) return;

  const response = await fetch(
    '/api/bots/' + currentBotId + '/stop',
    {method:'POST'}
  );

  const data = await response.json();
  showToast(data.message || data.error || 'Done');
  await refresh();
}

async function restartBot(){
  if (!currentBotId) return;

  const response = await fetch(
    '/api/bots/' + currentBotId + '/restart',
    {method:'POST'}
  );

  const data = await response.json();
  showToast(data.message || data.error || 'Done');
  await refresh();
}

async function sendMessage(event){
  event.preventDefault();

  if (!currentBotId) return;

  const input = document.getElementById('messageInput');
  const text = input.value;

  if (!text.trim()) return;

  const response = await fetch(
    '/api/bots/' + currentBotId + '/send',
    {
      method:'POST',
      headers:{'Content-Type':'application/json'},
      body:JSON.stringify({text})
    }
  );

  const data = await response.json();

  if (!response.ok){
    showToast(data.error || 'Gửi thất bại.');
    return;
  }

  input.value = '';
  showToast('Đã gửi.');
  await loadLogs();
}

async function saveAccount(){
  if (!currentBotId) return;

  const username =
    document.getElementById('usernameInput').value.trim();

  const password =
    document.getElementById('passwordInput').value;

  if (!username || !password){
    showToast('Cần nhập username và password.');
    return;
  }

  const response = await fetch(
    '/api/bots/' + currentBotId + '/account',
    {
      method:'POST',
      headers:{'Content-Type':'application/json'},
      body:JSON.stringify({username,password})
    }
  );

  const data = await response.json();

  if (!response.ok){
    showToast(data.error || 'Lưu thất bại.');
    return;
  }

  document.getElementById('passwordInput').value = '';

  showToast(
    'Đã lưu. Bấm "Chạy lại" để áp dụng.'
  );

  await refresh();
}

function showToast(message){
  const toast = document.getElementById('toast');

  toast.textContent = message;
  toast.style.display = 'block';

  clearTimeout(showToast.timer);

  showToast.timer = setTimeout(() => {
    toast.style.display = 'none';
  }, 2200);
}

function route(){
  const match =
    location.hash.match(/^#\/bot\/(1|2|3)$/);

  if (match){
    currentBotId = Number(match[1]);

    document.getElementById('home').style.display = 'none';
    document.getElementById('detail').classList.add('active');

    renderDetail();
    loadLogs();
  }else{
    currentBotId = null;

    document.getElementById('detail').classList.remove('active');
    document.getElementById('home').style.display = 'block';

    renderHome();
  }
}

window.addEventListener('hashchange', route);

(async function init(){
  await refresh();
  route();
})();

// Poll nhẹ mỗi 3 giây.
// Không dùng WebSocket để giảm độ phức tạp và tài nguyên.
setInterval(refresh, 3000);
</script>
</body>
</html>`;
//
// API
//

app.get('/api/bots', (req, res) => {
    res.json(
        bots.map(publicBotState)
    );
});

app.get('/api/bots/:id/logs', (req, res) => {
    const id = Number(req.params.id);
    const state = bots[id - 1];

    if (!state) {
        return res.status(404).json({
            error: 'Bot không tồn tại.'
        });
    }

    res.json({
        id: state.id,
        logs: state.logs
    });
});

//
// Start bot
//

app.post('/api/bots/:id/start', (req, res) => {
    const id = Number(req.params.id);
    const state = bots[id - 1];

    if (!state) {
        return res.status(404).json({
            error: 'Bot không tồn tại.'
        });
    }

    if (!state.username || !state.password) {
        return res.status(400).json({
            error: 'Bot chưa có username/password.'
        });
    }

    if (
        state.status !== 'offline' &&
        state.status !== 'kicked'
    ) {
        return res.json({
            ok: true,
            message: `Bot ${id} đang chạy.`
        });
    }

    startBot(state);

    res.json({
        ok: true,
        message: `Đã chạy Bot ${id}.`
    });
});

//
// Stop bot
//

app.post('/api/bots/:id/stop', (req, res) => {
    const id = Number(req.params.id);
    const state = bots[id - 1];

    if (!state) {
        return res.status(404).json({
            error: 'Bot không tồn tại.'
        });
    }

    stopBot(state);

    res.json({
        ok: true,
        message: `Đã dừng Bot ${id}.`
    });
});

//
// Restart bot
// Luôn chạy lại flow từ đầu:
// connect -> /dn -> /menu -> slot 24
//

app.post('/api/bots/:id/restart', (req, res) => {
    const id = Number(req.params.id);
    const state = bots[id - 1];

    if (!state) {
        return res.status(404).json({
            error: 'Bot không tồn tại.'
        });
    }

    if (!state.username || !state.password) {
        return res.status(400).json({
            error: 'Bot chưa có username/password.'
        });
    }

    state.manuallyStopped = true;

    disconnectBot(
        state,
        'Restart from web panel'
    );

    setTimeout(() => {
        state.manuallyStopped = false;
        startBot(state);
    }, 500);

    res.json({
        ok: true,
        message: `Đã chạy lại Bot ${id} từ đầu.`
    });
});

//
// Chat / command
//
// Nhập gì -> gửi nguyên văn bằng bot.chat()
//

app.post('/api/bots/:id/send', (req, res) => {
    const id = Number(req.params.id);
    const state = bots[id - 1];

    if (!state) {
        return res.status(404).json({
            error: 'Bot không tồn tại.'
        });
    }

    const text =
        typeof req.body?.text === 'string'
            ? req.body.text
            : '';

    if (!text.trim()) {
        return res.status(400).json({
            error: 'Nội dung không được trống.'
        });
    }

    if (!state.bot || !state.bot.player) {
        return res.status(409).json({
            error: `Bot ${id} chưa online.`
        });
    }

    state.bot.chat(text);

    addLog(
        state,
        `[WEB] → ${text}`
    );

    res.json({
        ok: true,
        message: 'Đã gửi.'
    });
});

//
// Update account
//

app.post('/api/bots/:id/account', (req, res) => {
    const id = Number(req.params.id);
    const state = bots[id - 1];

    if (!state) {
        return res.status(404).json({
            error: 'Bot không tồn tại.'
        });
    }

    const username =
        typeof req.body?.username === 'string'
            ? req.body.username.trim()
            : '';

    const password =
        typeof req.body?.password === 'string'
            ? req.body.password
            : '';

    if (!username || !password) {
        return res.status(400).json({
            error: 'Username và password không được trống.'
        });
    }

    state.username = username;
    state.password = password;

    addLog(
        state,
        'Đã thay đổi username/password từ web.'
    );

    res.json({
        ok: true,
        message: 'Đã lưu thay đổi.'
    });
});

//
// Health endpoint
// Render + Google Apps Script keep-alive
//

app.get('/health', (req, res) => {
    const online =
        bots.filter(
            state => state.status !== 'offline'
        ).length;

    res.status(200).json({
        status: 'ok',
        online,
        bots: bots.map(publicBotState)
    });
});

//
// Dashboard root
//

app.get('/', (req, res) => {
    res.type('html').send(HTML);
});

//
// Start HTTP server
//

app.listen(
    HTTP_PORT,
    '0.0.0.0',
    () => {
        console.log(
            `[HTTP] Dashboard listening on ${HTTP_PORT}`
        );
    }
);

//
// Startup
//
// Bot 1:
// giữ tương thích với ENV cũ:
// MC_USERNAME / MC_PASSWORD
//
// Bot 2:
// BOT2_USERNAME / BOT2_PASSWORD
//
// Bot 3:
// BOT3_USERNAME / BOT3_PASSWORD
//
// Nếu không có credential -> OFFLINE.
//

for (const state of bots) {
    if (
        state.username &&
        state.password
    ) {
        state.manuallyStopped = false;

        addLog(
            state,
            'Có credential. Tự động khởi động bot.'
        );

        connectBot(state);
    } else {
        addLog(
            state,
            `Bot ${state.id} đang OFFLINE (chưa có credential).`
        );
    }
}
