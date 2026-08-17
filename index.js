const mineflayer = require('mineflayer');
const express = require('express');

const USERNAME = process.env.MC_USERNAME;
const PASSWORD = process.env.MC_PASSWORD;

const HOSTS = (process.env.MC_SERVER_HOSTS || 'sgp.kingmc.vn,kingmc.vn')
    .split(',')
    .map(host => host.trim())
    .filter(Boolean);

const PORT = Number(process.env.MC_SERVER_PORT || 25565);

// Repo mẫu đang dùng 1.20.1.
// Để giống repo mẫu, mặc định giữ nguyên 1.20.1.
const MC_VERSION = '1.20.1';

if (!USERNAME || !PASSWORD) {
    console.error('[BOT] Thiếu MC_USERNAME hoặc MC_PASSWORD.');
    process.exit(1);
}

if (HOSTS.length === 0) {
    console.error('[BOT] Không có Minecraft server host.');
    process.exit(1);
}

/* =========================================================
   HTTP HEALTH ENDPOINT - dùng cho Render /health
   ========================================================= */

const app = express();
const HTTP_PORT = Number(process.env.PORT || 10000);

let bot = null;
let currentHostIndex = 0;

let isBotOnline = false;
let isReady = false;

let reconnectTimer = null;

let afkRoutineRunning = false;
let afkTimers = [];

let lastAuthTime = 0;

app.get('/', (req, res) => {
    res.status(200).send('KingMC AFK bot is running.');
});

app.get('/health', (req, res) => {
    res.status(200).json({
        status: 'ok',
        minecraft: isBotOnline ? 'online' : 'offline',
        ready: isReady,
        host: HOSTS[currentHostIndex],
        username: USERNAME
    });
});

app.listen(HTTP_PORT, '0.0.0.0', () => {
    console.log(`[HTTP] Listening on port ${HTTP_PORT}`);
});

/* =========================================================
   TEXT CLEANER
   Giữ phần cần thiết từ repo mẫu
   ========================================================= */

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

/* =========================================================
   TIMER MANAGEMENT
   ========================================================= */

function clearAfkTimers() {
    afkRoutineRunning = false;

    for (const timer of afkTimers) {
        clearTimeout(timer);
    }

    afkTimers = [];
}

function scheduleReconnect() {
    clearAfkTimers();

    isReady = false;

    if (reconnectTimer) {
        clearTimeout(reconnectTimer);
    }

    reconnectTimer = setTimeout(() => {
        reconnectTimer = null;
        connect();
    }, 10000);

    console.log('[BOT] Sẽ reconnect sau 10 giây.');
}

/* =========================================================
   CONNECT
   ========================================================= */

function connect() {
    clearAfkTimers();

    isBotOnline = false;
    isReady = false;

    const host = HOSTS[currentHostIndex];

    console.log(
        `[BOT] Đang kết nối tới ${host}:${PORT} | Minecraft ${MC_VERSION}`
    );

    const options = {
        host,
        port: PORT,
        username: USERNAME,
        version: MC_VERSION,
        auth: 'offline'
    };

    try {
        bot = mineflayer.createBot(options);
    } catch (err) {
        console.error('[BOT] Lỗi khởi tạo Mineflayer:', err.message);
        scheduleReconnect();
        return;
    }

    registerEvents();
}

/* =========================================================
   EVENTS
   ========================================================= */

function registerEvents() {
    bot.on('error', (err) => {
        console.error('[BOT] Lỗi kết nối:', err.message);
    });

    bot.on('kicked', (reason) => {
        const reasonText =
            typeof reason === 'string'
                ? reason
                : JSON.stringify(reason);

        console.warn(
            `[BOT] Bị kick: ${cleanMinecraftText(reasonText)}`
        );
    });

    bot.on('end', () => {
        isBotOnline = false;
        isReady = false;

        console.log('[BOT] Mất kết nối.');

        // Giống repo mẫu:
        // chuyển sang host tiếp theo khi reconnect.
        currentHostIndex =
            (currentHostIndex + 1) % HOSTS.length;

        scheduleReconnect();
    });

    bot.once('spawn', () => {
        isBotOnline = true;
        isReady = false;

        console.log('[BOT] Đã spawn vào server.');

        /*
         * Không gọi /menu ngay.
         *
         * Repo mẫu xử lý authentication/lobby thông qua
         * message + vị trí lobby.
         */
    });

    bot.on('message', (jsonMsg) => {
        handleServerMessage(jsonMsg);
    });

    bot.on('windowOpen', (window) => {
        const title = window && window.title
            ? cleanMinecraftText(window.title.toString())
            : '';

        console.log(`[BOT] GUI mở: ${title || 'unknown'}`);
    });
}

/* =========================================================
   SERVER MESSAGE HANDLER
   Giữ logic authentication + lobby detection
   từ repo mẫu.
   ========================================================= */

function handleServerMessage(jsonMsg) {
    const msgText = jsonMsg.toString();
    const cleanMsg = cleanMinecraftText(msgText);
    const lowerMsg = cleanMsg.toLowerCase();

    console.log(`[MC] ${cleanMsg}`);

    /*
     * -----------------------------------------------------
     * KINGMC LOBBY DETECTION
     *
     * Repo mẫu:
     * chat chứa "kingmc.vn"
     * +
     * tọa độ gần (0.50, 41.00, 0.80)
     * -----------------------------------------------------
     */

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
            if (
                !lastAuthTime ||
                Date.now() - lastAuthTime > 5000
            ) {
                lastAuthTime = Date.now();

                console.log(
                    '[BOT] Xác nhận đang ở Lobby KingMC.'
                );

                isReady = false;

                clearAfkTimers();

                /*
                 * Repo mẫu:
                 * /dn <password>
                 */
                bot.chat(`/dn ${PASSWORD}`);

                console.log(
                    '[BOT] Đã gửi /dn.'
                );

                /*
                 * Repo mẫu chờ 2.5 giây rồi
                 * chạy lại AFK routine.
                 */
                const timer = setTimeout(() => {
                    console.log(
                        '[BOT] Đã chờ /dn. Bắt đầu routine /menu.'
                    );

                    startAfkRoutine();
                }, 2500);

                afkTimers.push(timer);
            }
        }

        return;
    }

    /*
     * -----------------------------------------------------
     * LOGIN DETECTION
     *
     * Giữ logic từ repo:
     * /dk / register
     * /dn / vui long / dang nhap / login
     * -----------------------------------------------------
     */

    if (!PASSWORD) {
        return;
    }

    if (
        lowerMsg.includes('/dk') ||
        lowerMsg.includes('dang ky bang lenh') ||
        lowerMsg.includes('dang ky') ||
        lowerMsg.includes('/register')
    ) {
        if (
            !lastAuthTime ||
            Date.now() - lastAuthTime > 3000
        ) {
            console.log(
                '[BOT] Server yêu cầu đăng ký.'
            );

            bot.chat(
                `/register ${PASSWORD} ${PASSWORD}`
            );

            lastAuthTime = Date.now();
        }

        return;
    }

    if (
        lowerMsg.includes('/dn') ||
        lowerMsg.includes('vui long') ||
        lowerMsg.includes('dang nhap') ||
        lowerMsg.includes('/login')
    ) {
        if (
            !lastAuthTime ||
            Date.now() - lastAuthTime > 3000
        ) {
            console.log(
                '[BOT] Server yêu cầu đăng nhập.'
            );

            bot.chat(`/login ${PASSWORD}`);

            lastAuthTime = Date.now();
        }
    }
}

/* =========================================================
   AFK ROUTINE
   Repo mẫu:
   6s -> /menu
   4s -> click slot 24
 *
 * BỎ hoàn toàn:
 * /rtp
 * click slot 15
 * ========================================================= */

function startAfkRoutine() {
    clearAfkTimers();

    afkRoutineRunning = true;
    isReady = false;

    console.log(
        '[BOT] Bắt đầu AFK routine. /menu sau 6 giây...'
    );

    const delayMenu = setTimeout(() => {
        if (
            !afkRoutineRunning ||
            !bot ||
            !isBotOnline
        ) {
            return;
        }

        console.log('[BOT] Gửi /menu...');

        bot.chat('/menu');

        const delayClick = setTimeout(() => {
            if (
                !afkRoutineRunning ||
                !bot ||
                !isBotOnline
            ) {
                return;
            }

            console.log(
                '[BOT] Đợi GUI /menu rồi click slot 24...'
            );

            try {
                const currentWindow = bot.currentWindow;

                if (currentWindow) {
                    bot.clickWindow(24, 0, 0);

                    console.log(
                        '[BOT] Đã click slot 24.'
                    );

                    /*
                     * Không /rtp.
                     * Không click slot 15.
                     *
                     * Đây là trạng thái AFK cuối cùng.
                     */
                    isReady = true;

                    console.log(
                        '[BOT] ✅ Đã vào trạng thái AFK.'
                    );
                } else {
                    console.log(
                        '[BOT] Không có GUI /menu để click.'
                    );

                    /*
                     * Thử lại routine thay vì chết process.
                     */
                    startAfkRoutine();
                }
            } catch (err) {
                console.error(
                    '[BOT] Lỗi click slot 24:',
                    err.message
                );

                /*
                 * Không crash process.
                 * Thử lại routine.
                 */
                startAfkRoutine();
            }
        }, 4000);

        afkTimers.push(delayClick);
    }, 6000);

    afkTimers.push(delayMenu);
}

/* =========================================================
   START
   ========================================================= */

console.log('======================================');
console.log(' KingMC AFK Bot');
console.log(' Username:', USERNAME);
console.log(' Hosts:', HOSTS.join(', '));
console.log(' Port:', PORT);
console.log(' Version:', MC_VERSION);
console.log('======================================');

connect();
