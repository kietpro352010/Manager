'use strict';

const { SlashCommandBuilder, escapeMarkdown } = require('discord.js');
const { botDashboard, workerDetail, padId, workerState, uptimeText } = require('../panels/renderer');

const botOption = (command, required = false) => command.addStringOption((option) =>
  option.setName('bot')
    .setDescription('Số thứ tự hoặc ID bot (VD: 1, 01 hoặc afk-01 - để trống nếu chỉ có 1 bot)')
    .setRequired(required)
    .setMaxLength(40));

const confirmationOption = (command) => command.addBooleanOption((option) =>
  option.setName('confirm')
    .setDescription('Xác nhận thực hiện hành động này')
    .setRequired(true));

const definition = new SlashCommandBuilder()
  .setName('bot')
  .setDescription('Quản lý và điều khiển bot KingMC AFK')
  // User subcommands
  .addSubcommand((cmd) => botOption(cmd.setName('panel').setDescription('Mở bảng điều khiển tương tác trực quan (Khuyên dùng)'), false))
  .addSubcommand((cmd) => cmd.setName('list').setDescription('Xem danh sách bot được gán cho bạn'))
  .addSubcommand((cmd) => botOption(cmd.setName('status').setDescription('Xem trạng thái kết nối, ping, uptime của bot'), false))
  .addSubcommand((cmd) => botOption(cmd.setName('start').setDescription('Bật bot vào server KingMC AFK'), false))
  .addSubcommand((cmd) => botOption(cmd.setName('stop').setDescription('Tắt bot khỏi server KingMC'), false))
  .addSubcommand((cmd) => botOption(cmd.setName('restart').setDescription('Khởi động lại bot'), false))
  // Admin subcommands
  .addSubcommand((cmd) => cmd.setName('add').setDescription('Đăng ký thêm bot mới vào Manager (Admin)')
    .addStringOption((opt) => opt.setName('name').setDescription('Tên hiển thị bot (VD: KingMC Bot 1)').setRequired(true).setMaxLength(64))
    .addStringOption((opt) => opt.setName('id').setDescription('Mã định danh duy nhất (để trống sẽ tự gán 01, 02...)').setRequired(false).setMaxLength(40))
    .addStringOption((opt) => opt.setName('provider').setDescription('Nền tảng host bot (mặc định: Wispbyte)').setRequired(false)
      .addChoices({ name: 'Wispbyte (Server/VPS)', value: 'wispbyte' }, { name: 'Render (Cloud)', value: 'render' }))
    .addStringOption((opt) => opt.setName('url').setDescription('URL Render HTTPS (VD: https://bot-01.onrender.com)').setMaxLength(200))
    .addStringOption((opt) => opt.setName('render_service_id').setDescription('Render Service ID (tùy chọn)').setMaxLength(100)))
  .addSubcommand((cmd) => confirmationOption(botOption(cmd.setName('remove').setDescription('Xóa bot khỏi Manager (Admin)'), true)))
  .addSubcommand((cmd) => botOption(cmd.setName('rotate-secret').setDescription('Đổi khóa secret kết nối của bot (Admin)'), true))
  .addSubcommand((cmd) => confirmationOption(botOption(cmd.setName('reset').setDescription('Xóa tài khoản MC, xóa lỗi và reset dữ liệu bot (Admin)'), true)))
  .addSubcommand((cmd) => confirmationOption(cmd.setName('stop-all').setDescription('Tắt toàn bộ bot trong hệ thống (Admin)')))
  .addSubcommand((cmd) => confirmationOption(cmd.setName('reconnect-errors').setDescription('Khởi động lại các bot đang gặp lỗi (Admin)')))
  .addSubcommand((cmd) => confirmationOption(cmd.setName('clean-dead').setDescription('Dọn dẹp các bot Render không còn tồn tại (Admin)')));

function safe(value, max = 180) {
  return escapeMarkdown(String(value || '—').replace(/[\r\n]/g, ' ').slice(0, max)).replace(/@/g, '@\u200b');
}

function statusText(worker, status = worker.status || {}) {
  const online = status.online || status.connected;
  const ping = Number.isFinite(status.pingMs) ? `${Math.round(status.pingMs)}ms` : '—';
  const uptime = status.online ? uptimeText(status.uptimeSeconds) : 'Đang tắt';
  const stateIcon = online ? '🟢' : worker.reachable ? '🟡' : '🔴';
  const ram = Number.isFinite(status.rssMb) ? `${Math.round(status.rssMb)} MB` : '—';
  return [
    `🤖 **Bot #${padId(worker.botNumber)} · ${safe(worker.name)}**`,
    `• Trạng thái: ${stateIcon} **${workerState(worker)}**`,
    `• Độ trễ mạng (Ping): \`${ping}\``,
    `• Thời gian hoạt động: \`${uptime}\``,
    `• Bộ nhớ RAM: \`${ram}\``,
    status.restriction ? `⚠️ Đang chờ máy chủ: ${safe(status.restriction)}` : '',
    status.lastError ? `⚠️ Lưu ý: ${safe(status.lastError, 180)}` : '',
    `\n💡 *Mẹo: Gõ \`/panel\` để mở bảng điều khiển với các nút bấm trực quan.*`
  ].filter(Boolean).join('\n');
}

async function audit(accessStore, logger, actorId, action, target = '', details = {}) {
  if (accessStore && typeof accessStore.addAudit === 'function') {
    await accessStore.addAudit({ actorId, action, target, details }).catch((error) => {
      logger.warn('bot_audit_write_failed', { action, message: error.message });
    });
  }
}

function formatOperation(name, result) {
  if (Array.isArray(result.results)) {
    const done = result.results.filter((entry) => entry.ok).length;
    const pending = result.results.filter((entry) => entry.pending).length;
    const failed = result.results.filter((entry) => !entry.ok && !entry.pending).length;
    return `Thao tác ${name}: Hoàn tất ${done} · Đang chờ ${pending} · Thất bại ${failed} / Tổng ${result.total} bot.`;
  }
  return `Dọn dẹp ${name}: Đã kiểm tra ${result.checked}; Đã xóa ${result.removed.length}; Còn giữ ${result.retained.length}.${result.removed.length ? ` Các bot đã xóa: ${result.removed.map((id) => `\`${safe(id, 40)}\``).join(', ')}` : ''}`;
}

async function resolveWorker(registry, input) {
  if (!input) return null;
  const trimmed = String(input).trim().replace(/^#/, '');
  if (/^\d+$/.test(trimmed)) {
    const num = parseInt(trimmed, 10);
    const byNumber = await registry.findByNumber(num);
    if (byNumber) return byNumber;
  }
  return registry.find(String(input).trim().toLowerCase());
}

async function execute(interaction, services) {
  const { registry, broker, logger, accessControl, accessStore, fleetOperations } = services;
  const role = accessControl.roleFor(interaction.member, interaction);
  const subcommand = interaction.options.getSubcommand();
  const isAdmin = role === 'admin';
  const requireAdmin = () => { if (!isAdmin) throw new Error('Chỉ thành viên có role Discord Admin mới có thể thực hiện thao tác này.'); };

  const userWorkers = await accessControl.workersFor(interaction.user.id, await registry.list(), role);

  // Subcommand: panel
  if (subcommand === 'panel') {
    const botInput = interaction.options.getString('bot');
    if (!botInput && userWorkers.length === 1 && !isAdmin) {
      // If user has exactly 1 bot, open their detail control panel directly!
      return workerDetail({ registry, accessControl }, interaction.user.id, userWorkers[0].workerId, role);
    }
    if (!botInput) return botDashboard({ registry, accessControl }, interaction.user.id, role);
    const worker = await resolveWorker(registry, botInput);
    if (!worker || !(await accessControl.canUseWorker(interaction.user.id, worker, role))) {
      return { content: `Không tìm thấy bot khớp với "${safe(botInput)}" hoặc tài khoản của bạn chưa được cấp quyền.` };
    }
    return workerDetail({ registry, accessControl }, interaction.user.id, worker.workerId, role);
  }

  // Subcommand: list
  if (subcommand === 'list') {
    if (!userWorkers.length) return '📋 Hiện tại bạn chưa được gán bot nào. Hãy liên hệ Admin để được cấp quyền sử dụng bot nhé.';
    const lines = userWorkers.slice(0, 25).map((w) => {
      const isOnline = w.reachable && (w.status?.online || w.status?.state === 'online');
      const icon = isOnline ? '🟢' : w.reachable ? '🟡' : '🔴';
      return `${icon} **Bot #${padId(w.botNumber)} · ${safe(w.name, 40)}** — ${workerState(w)}`;
    });
    return `📋 **Danh Sách Bot Của Bạn**\n\n${lines.join('\n')}\n\n💡 *Gõ \`/panel\` để mở bảng điều khiển bấm nút cực kỳ tiện lợi.*`;
  }

  // Subcommand: add (Admin)
  if (subcommand === 'add') {
    requireAdmin();
    const result = await registry.add({
      workerId: interaction.options.getString('id'),
      name: interaction.options.getString('name'),
      provider: interaction.options.getString('provider'),
      serviceUrl: interaction.options.getString('url') || '',
      serviceId: interaction.options.getString('render_service_id') || ''
    });
    await audit(accessStore, logger, interaction.user.id, 'worker.add', result.worker.workerId, { botNumber: result.worker.botNumber, provider: result.worker.provider });
    return `✅ Đã đăng ký bot **${safe(result.worker.name)}** là **#${padId(result.worker.botNumber)}** (\`${result.worker.workerId}\`).\nKhóa secret kết nối cho bot slot (nhập vào biến \`WORKER_SECRET_1\` hoặc \`WORKER_SECRET_2\` trên host):\n\n||${result.secret}||`;
  }

  // Subcommands: stop-all, reconnect-errors, clean-dead (Admin)
  if (subcommand === 'stop-all' || subcommand === 'reconnect-errors' || subcommand === 'clean-dead') {
    requireAdmin();
    if (!interaction.options.getBoolean('confirm')) return 'Hành động chưa được xác nhận.';
    const action = subcommand === 'stop-all' ? 'worker.stop-all' : subcommand === 'reconnect-errors' ? 'worker.reconnect-errors' : 'worker.clean-dead';
    const result = subcommand === 'stop-all' ? await fleetOperations.stopAll()
      : subcommand === 'reconnect-errors' ? await fleetOperations.reconnectErrors() : await fleetOperations.cleanDead();
    await audit(accessStore, logger, interaction.user.id, action, '', result);
    return formatOperation(subcommand, result);
  }

  // Resolve target worker for control commands
  const botInput = interaction.options.getString('bot');
  let worker = null;

  if (!botInput) {
    if (!userWorkers.length) {
      if (isAdmin) throw new Error('Chưa có bot nào trong hệ thống. Hãy dùng `/bot add` để thêm bot.');
      throw new Error('👋 Bạn chưa được gán bot nào. Hãy liên hệ Admin để được cấp bot nhé.');
    }
    if (userWorkers.length === 1) {
      worker = userWorkers[0]; // Auto-target their only bot
    } else {
      const botNumbers = userWorkers.map((w) => `#${padId(w.botNumber)}`).join(', ');
      throw new Error(`💡 Bạn đang có ${userWorkers.length} bot (${botNumbers}). Vui lòng nhập số thứ tự bot (VD: \`/bot ${subcommand} bot:1\`) hoặc gõ \`/panel\` để chọn trực tiếp.`);
    }
  } else {
    worker = await resolveWorker(registry, botInput);
  }

  if (!worker) {
    if (isAdmin) throw new Error(`Không tìm thấy bot nào khớp với "${safe(botInput)}".`);
    throw new Error('Bot này không tồn tại hoặc tài khoản Discord của bạn chưa được cấp quyền.');
  }

  if (!await accessControl.canUseWorker(interaction.user.id, worker, role)) {
    throw new Error('❌ Bot này không thuộc quyền quản lý của bạn.');
  }

  const workerId = worker.workerId;

  // Subcommand: remove (Admin)
  if (subcommand === 'remove') {
    requireAdmin();
    if (!interaction.options.getBoolean('confirm')) return 'Hành động xóa chưa được xác nhận.';
    let stopped = false;
    try {
      const res = await broker.dispatch(workerId, 'stop');
      stopped = !res.timedOut && res.result?.ok !== false && (res.result?.detail?.ok ?? true) !== false;
    } catch (err) { logger.warn('worker_stop_before_remove_failed', { workerId, name: err.name || 'Error' }); }
    broker.cancelWorker(workerId);
    const removed = await registry.remove(workerId);
    if (removed) await audit(accessStore, logger, interaction.user.id, 'worker.remove', workerId, { stopped });
    return removed ? `🗑️ Đã xóa bot **#${padId(worker.botNumber)} (${safe(worker.name)})** khỏi Manager${stopped ? ' (đã gửi lệnh dừng trước đó)' : ''}. Danh sách bot đã được tự động sắp xếp lại.` : `Bot ${safe(workerId)} không tồn tại.`;
  }

  // Subcommand: rotate-secret (Admin)
  if (subcommand === 'rotate-secret') {
    requireAdmin();
    const secret = await registry.rotateSecret(workerId);
    await audit(accessStore, logger, interaction.user.id, 'worker.rotate-secret', workerId);
    return `🔑 Đã đổi secret cho bot **#${padId(worker.botNumber)} ${safe(worker.name)}**. Cập nhật biến môi trường trên host; giá trị chỉ hiển thị 1 lần:\n\n||${secret}||`;
  }

  // Subcommand: status
  if (subcommand === 'status') {
    let status = worker.status || {};
    if (worker.provider === 'render') status = await broker.status(worker);
    await audit(accessStore, logger, interaction.user.id, 'worker.status', workerId);
    return statusText(worker, status);
  }

  // Subcommand: start, restart
  if (['start', 'restart'].includes(subcommand)) {
    const settings = await registry.privateSettings(workerId);
    if (!settings?.credentialsConfigured) {
      return '⚠️ Bạn chưa cài đặt tài khoản Minecraft cho bot. Hãy mở `/panel`, chọn bot này rồi bấm **👤 Tài khoản MC** để lưu tài khoản và mật khẩu nhé.';
    }
  }

  // Subcommand: reset (Admin)
  if (subcommand === 'reset') {
    requireAdmin();
    if (!interaction.options.getBoolean('confirm')) return 'Hành động reset chưa được xác nhận.';
  }

  const result = await broker.dispatch(workerId, subcommand, {});
  await audit(accessStore, logger, interaction.user.id, `worker.${subcommand}`, workerId, {
    timedOut: Boolean(result.timedOut)
  });

  if (result.timedOut) return `⏳ Lệnh **${subcommand}** đã được gửi đến bot **#${padId(worker.botNumber)} (${safe(worker.name)})**, bot đang xử lý kết nối. Bạn có thể mở \`/panel\` để theo dõi trực tiếp.`;
  const detail = result.result?.detail || result.result || {};
  if (detail.restriction) return `⚠️ Bot **#${padId(worker.botNumber)} (${safe(worker.name)})** đang bị server KingMC giữ kết nối (${safe(detail.restriction)}). Vui lòng đợi giây lát.`;
  if (detail.ok === false) return `❌ Lệnh ${subcommand} thất bại: ${safe(detail.error || JSON.stringify(detail), 700)}`;
  if (subcommand === 'reset') return `✅ Đã reset dữ liệu bot **#${padId(worker.botNumber)} ${safe(worker.name)}**.`;

  if (subcommand === 'start') {
    return `🟢 **Đã bật Bot #${padId(worker.botNumber)} (${safe(worker.name)}) thành công!**\n🎮 Bot đang kết nối vào máy chủ KingMC... Hãy dùng \`/panel\` để theo dõi trực tiếp.`;
  }
  if (subcommand === 'stop') {
    return `🛑 **Đã tắt Bot #${padId(worker.botNumber)} (${safe(worker.name)}) thành công!**\nBot đã ngắt kết nối an toàn khỏi máy chủ.`;
  }
  if (subcommand === 'restart') {
    return `🔄 **Đang khởi động lại Bot #${padId(worker.botNumber)} (${safe(worker.name)})...**\nBot đang kết nối lại vào máy chủ ngay lập tức.`;
  }

  return `✅ Lệnh **${subcommand}** hoàn tất cho bot **#${padId(worker.botNumber)} ${safe(worker.name)}**.`;
}

module.exports = { data: definition, execute };
