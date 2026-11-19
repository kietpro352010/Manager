'use strict';

const { SlashCommandBuilder } = require('discord.js');
const { renderBotLogs, embed } = require('../panels/renderer');
const { resolveLinkedUser, getUserBots } = require('../handlers/panel-handler');

const definition = new SlashCommandBuilder()
  .setName('logs')
  .setDescription('Xem nhật ký hoạt động của bot')
  .addStringOption(option =>
    option.setName('bot_id')
      .setDescription('ID của bot cần xem logs (bỏ trống để xem bot đầu tiên)')
      .setRequired(false)
  )
  .addIntegerOption(option =>
    option.setName('lines')
      .setDescription('Số dòng nhật ký cần lấy (mặc định 20, tối đa 100)')
      .setRequired(false)
  );

async function execute(interaction, services) {
  const user = await resolveLinkedUser(interaction, services);
  if (!user) {
    return {
      embeds: [
        embed(
          '⚠️ CHƯA ĐĂNG NHẬP',
          'Bạn chưa liên kết tài khoản Discord với Web Manager.\n\nVui lòng sử dụng lệnh /login để nhập Username và Password tài khoản Web.',
          0xf59e0b
        )
      ]
    };
  }

  if (user.role !== 'admin') {
    const isEntitled = services?.accessControl?.isEntitled
      ? services.accessControl.isEntitled(user)
      : (String(user.status || 'active').toLowerCase() !== 'disabled' && (user.isPermanent === true || (user.expiresAt && new Date(user.expiresAt).getTime() > Date.now())));

    if (!isEntitled) {
      const isLocked = String(user.status || 'active').toLowerCase() === 'disabled';
      const title = isLocked ? '⛔ TÀI KHOẢN BỊ KHÓA' : '⛔ TÀI KHOẢN HẾT HẠN HOẶC BỊ KHÓA';
      const desc = isLocked
        ? 'Tài khoản của bạn đã bị vô hiệu hóa bởi Quản trị viên.'
        : 'Tài khoản của bạn đã hết hạn thuê bot hoặc bị vô hiệu hóa. Vui lòng gia hạn trên Web Manager để tiếp tục sử dụng bot.';
      return {
        embeds: [embed(title, desc, 0xef4444)]
      };
    }
  }

  const userBots = await getUserBots(user, services);
  const botIdOption = interaction.options?.getString?.('bot_id');
  const linesOption = Math.max(1, Math.min(100, interaction.options?.getInteger?.('lines') || 20));

  let targetWorker = null;
  if (botIdOption) {
    const cleanOpt = String(botIdOption).trim().toLowerCase();
    targetWorker = userBots.find((w) => {
      const wid = String(w.workerId || w.id || '').trim().toLowerCase();
      const bNum = w.botNumber !== undefined && w.botNumber !== null ? String(w.botNumber).trim().toLowerCase() : '';
      return wid === cleanOpt || (bNum && bNum === cleanOpt);
    });
    if (!targetWorker && user.role === 'admin') {
      targetWorker = { workerId: botIdOption };
    }
    if (!targetWorker) {
      return {
        embeds: [
          embed(
            '❌ KHÔNG TÌM THẤY BOT',
            'Không tìm thấy bot có ID ' + botIdOption + ' trong danh sách bot được cấp của bạn.',
            0xef4444
          )
        ]
      };
    }
  } else {
    targetWorker = userBots[0] || null;
  }

  if (!targetWorker) {
    return {
      embeds: [
        embed(
          '⚠️ KHÔNG CÓ BOT',
          'Bạn chưa sở hữu bot nào để xem nhật ký hoạt động.',
          0xf59e0b
        )
      ]
    };
  }

  const fullBotId = targetWorker.workerId || targetWorker.id;
  let logs = [];
  try {
    if (services?.workerClient?.getBotLogs) {
      logs = await services.workerClient.getBotLogs(fullBotId, linesOption);
    } else if (services?.registry?.getLogs) {
      logs = await services.registry.getLogs(fullBotId, linesOption);
    } else if (services?.store?.getAuditLogs) {
      logs = await services.store.getAuditLogs({ botId: fullBotId, limit: linesOption });
    }
  } catch (err) {
    logs = [{ time: new Date().toISOString(), type: 'error', message: 'Không thể tải logs: ' + err.message }];
  }

  return renderBotLogs({
    user,
    worker: targetWorker,
    logs: Array.isArray(logs) ? logs.slice(-linesOption) : []
  });
}

module.exports = {
  data: definition,
  execute
};
