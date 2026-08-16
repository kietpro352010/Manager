const mineflayer = require('mineflayer');
const express = require('express');

const HOST = process.env.MC_SERVER_HOST || 'sgp.kingmc.vn';
const PORT = Number(process.env.MC_SERVER_PORT || 25565);

const USERNAME = process.env.MC_USERNAME;
const PASSWORD = process.env.MC_PASSWORD;

// Repo gốc đang dùng 1.20.1.
// Có thể đổi trên Render bằng MC_VERSION.
const VERSION = process.env.MC_VERSION || '1.20.1';

const app = express();
const HTTP_PORT = Number(process.env.PORT || 10000);

let bot = null;
let reconnectTimer = null;
let routineTimer = null;
let connecting = false;
let ready = false;

app.get('/health', (req, res) => {
    res.status(200).json({
        status: 'ok',
        minecraft: bot && bot.player ? 'online' : 'offline',
        ready
    });
});

app.listen(HTTP_PORT, '0.0.0.0', () => {
    console.log(`[HTTP] Health server listening on ${HTTP_PORT}`);
});

function cleanText(text) {
    return String(text || '')
        .replace(/§[0-9a-fk-or]/gi, '')
        .replace(/&[0-9a-fk-or]/gi, '')
        .trim()
        .toLowerCase();
}

function clearTimers() {
    if (reconnectTimer) {
        clearTimeout(reconnectTimer);
        reconnectTimer = null;
    }

    if (routineTimer) {
        clearTimeout(routineTimer);
        routineTimer = null;
    }
}

function scheduleReconnect() {
    clearTimers();

    ready = false;

    console.log('[BOT] Reconnect sau 10 giây...');

    reconnectTimer = setTimeout(() => {
        reconnectTimer = null;
        connect();
    }, 10000);
}

function connect() {
    if (connecting) return;

    connecting = true;
    ready = false;

    clearTimers();

    console.log(
        `[BOT] Đang kết nối ${HOST}:${PORT} | Minecraft ${VERSION}`
    );

    try {
        bot = mineflayer.createBot({
            host: HOST,
            port: PORT,
            username: USERNAME,
            auth: 'offline',
            version: VERSION
        });
    } catch (err) {
        console.error('[BOT] Không tạo được bot:', err.message);
        connecting = false;
        scheduleReconnect();
        return;
    }

    bot.once('spawn', () => {
        connecting = false;

        console.log('[BOT] Spawn thành công.');

        startAfkRoutine();
    });

    bot.on('message', (jsonMsg) => {
        const text = jsonMsg.toString();
        const msg = cleanText(text);

        console.log(`[MC] ${text}`);

        // Server yêu cầu đăng nhập
        if (
            PASSWORD &&
            (
                msg.includes('/login') ||
                msg.includes('vui long dang nhap') ||
                msg.includes('dang nhap')
            )
        ) {
            console.log('[BOT] Server yêu cầu login.');

            setTimeout(() => {
                if (bot && bot.player) {
                    bot.chat(`/login ${PASSWORD}`);
                    console.log('[BOT] Đã gửi /login.');
                }
            }, 1000);
        }
    });

    bot.on('windowOpen', (window) => {
        console.log(
            `[BOT] GUI mở: ${window.title ? window.title.toString() : 'unknown'}`
        );
    });

    bot.on('error', (err) => {
        console.error('[BOT] Error:', err.message);
    });

    bot.on('kicked', (reason) => {
        console.log('[BOT] Bị kick:', JSON.stringify(reason));
        ready = false;
    });

    bot.on('end', () => {
        connecting = false;
        ready = false;

        console.log('[BOT] Mất kết nối.');

        scheduleReconnect();
    });
}

function startAfkRoutine() {
    ready = false;

    if (!bot || !bot.player) {
        console.log('[BOT] Chưa spawn, không chạy routine.');
        return;
    }

    console.log('[BOT] Đợi 6 giây trước khi mở /menu...');

    routineTimer = setTimeout(() => {
        if (!bot || !bot.player) return;

        console.log('[BOT] Gửi /menu...');
        bot.chat('/menu');

        routineTimer = setTimeout(() => {
            if (!bot || !bot.player) return;

            console.log('[BOT] Đợi GUI /menu mở...');

            // Chờ thêm một chút để packet GUI tới client bot.
            routineTimer = setTimeout(() => {
                if (!bot || !bot.player) return;

                const window = bot.currentWindow;

                if (!window) {
                    console.log(
                        '[BOT] Không thấy GUI /menu. Thử lại routine...'
                    );

                    startAfkRoutine();
                    return;
                }

                console.log('[BOT] GUI đã mở.');
                console.log('[BOT] Click slot 24...');

                try {
                    // Giống logic trong repo tham khảo:
                    // bot.clickWindow(24, 0, 0)
                    bot.clickWindow(24, 0, 0);

                    console.log('[BOT] Đã click slot 24.');

                    // Không RTP.
                    // Đây là trạng thái cuối cùng.
                    ready = true;

                    console.log('[BOT] ===== AFK READY =====');
                    console.log('[BOT] Bot sẽ đứng im.');
                } catch (err) {
                    console.error(
                        '[BOT] Lỗi click slot 24:',
                        err.message
                    );

                    ready = false;
                    scheduleReconnect();
                }
            }, 2000);
        }, 4000);
    }, 6000);
}

if (!USERNAME || !PASSWORD) {
    console.error(
        '[BOT] Thiếu MC_USERNAME hoặc MC_PASSWORD trong Environment Variables.'
    );
} else {
    connect();
}
