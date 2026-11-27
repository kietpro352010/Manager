'use strict';

const { SlashCommandBuilder, ActionRowBuilder, ButtonStyle } = require('discord.js');
const {
  renderBotLogs,
  renderUnauthenticatedPanel,
  renderEntitlementBlockedPanel,
  embed,
  button,
  plainCode
} = require('../panels/renderer');
const {
  resolveLinkedUser,
  getUserBots,
  isUserAccountEntitled,
  resolvePublicBaseUrl
} = require('../handlers/panel-handler');
const { getMaintenanceState } = require('../../utils/maintenance');

const definition = new SlashCommandBuilder()
  .setName('logs')
  .setDescription('Xem nhật ký hoạt động của bot')
  .addStringOption(option =>
    option.setName('bot_id')
      .setDescription('ID, số thứ tự (#01, 1) hoặc tên bot cần xem logs (bỏ trống để xem bot đầu tiên)')
      .setRequired(false)
  )
  .addIntegerOption(option =>
    option.setName('lines')
      .setDescription('Số dòng nhật ký cần lấy (mặc định 20, tối đa 100)')
      .setRequired(false)
  );

async function execute(interaction, services) {
  const discordUserId = interaction?.user?.id;
  const publicBaseUrl = resolvePublicBaseUrl(services);
  const user = await resolveLinkedUser(interaction, services);
  if (!user) {
    return renderUnauthenticatedPanel({ discordUserId, publicBaseUrl });
  }

  const maintenance = await getMaintenanceState(services?.accessStore || services?.store);

  if (user.role !== 'admin') {
    const normalizedUser = { ...user, expiresAt: user.expiresAt || user.expiresAtRental || null };
    if (!isUserAccountEntitled(normalizedUser, services, maintenance)) {
      return renderEntitlementBlockedPanel({
        user: normalizedUser,
        discordUserId,
        publicBaseUrl
      });
    }
  }

  const userBots = await getUserBots(user, services, maintenance);
  const botIdOption = interaction.options?.getString?.('bot_id');
  const linesOption = Math.max(1, Math.min(100, interaction.options?.getInteger?.('lines') || 20));

  let targetWorker = null;
  if (botIdOption) {
    const cleanOpt = String(botIdOption).trim().toLowerCase();
    const cleanNoHash = cleanOpt.replace(/^(bot\s*#?|#)/i, '').trim();
    const numericOpt = /^\d+$/.test(cleanNoHash) ? Number(cleanNoHash) : NaN;

    targetWorker = userBots.find((w) => {
      const wid = String(w.workerId || w.id || '').trim().toLowerCase();
      const bNum = w.botNumber !== undefined && w.botNumber !== null ? Number(w.botNumber) : NaN;
      const wName = String(w.name || '').trim().toLowerCase();
      const mcName = String(w.status?.username || w.settings?.account?.username || '').trim().toLowerCase();
      if (wid === cleanOpt || (cleanNoHash && wid === cleanNoHash)) return true;
      if (Number.isFinite(numericOpt) && Number.isFinite(bNum) && numericOpt === bNum) return true;
      if (wName && wName === cleanOpt) return true;
      if (mcName && mcName === cleanOpt) return true;
      return false;
    });
    if (!targetWorker && user.role === 'admin') {
      targetWorker = { workerId: botIdOption };
    }
    if (!targetWorker) {
      const availableHint = userBots.length > 0
        ? `\n\n**Bot hiện có của bạn:**\n${userBots.slice(0, 8).map((w) => `• \`${plainCode(w.workerId || w.id, 40)}\` (${plainCode(w.name || `BOT ${w.botNumber || 1}`, 40)})`).join('\n')}`
        : '';
      const components = userBots.length > 0
        ? [new ActionRowBuilder().addComponents(button('Mở danh sách Bot', 'bots:list', ButtonStyle.Primary, false, '🤖'))]
        : [];
      return {
        embeds: [
          embed(
            '❌ KHÔNG TÌM THẤY BOT',
            `Không tìm thấy bot \`${plainCode(botIdOption, 64)}\` trong danh sách bot được cấp của bạn.${availableHint}`,
            0xef4444
          )
        ],
        components
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
          'Bạn chưa sở hữu bot nào để xem nhật ký hoạt động. Hãy kiểm tra lại gói dịch vụ bằng `/bots` hoặc trên Web Manager.',
          0xf59e0b
        )
      ]
    };
  }

  const fullBotId = targetWorker.workerId || targetWorker.id;
  const storeRef = services?.store || services?.registry?.store;
  let logs = [];
  try {
    if (typeof services?.registry?.refreshLogsFromStore === 'function') {
      await services.registry.refreshLogsFromStore(fullBotId, { kind: 'all', maxAgeMs: 3000 }).catch(() => {});
    }
    if (services?.workerClient?.getBotLogs) {
      logs = await services.workerClient.getBotLogs(fullBotId, linesOption);
    } else if (services?.registry?.getLogs) {
      logs = await services.registry.getLogs(fullBotId, linesOption);
    }
    if ((!Array.isArray(logs) || logs.length === 0) && storeRef?.get) {
      const fullRecord = await storeRef.get(fullBotId, { includeEvents: true }).catch(() => null);
      if (Array.isArray(fullRecord?.events) && fullRecord.events.length > 0) {
        logs = fullRecord.events;
      }
    }
    if ((!Array.isArray(logs) || logs.length === 0) && storeRef?.getAuditLogs) {
      logs = await storeRef.getAuditLogs({ botId: fullBotId, limit: linesOption });
    }
  } catch (err) {
    logs = [{ time: new Date().toISOString(), type: 'error', message: 'Không thể tải logs: ' + err.message }];
  }

  return renderBotLogs({
    user,
    worker: targetWorker,
    logs: Array.isArray(logs) ? logs.slice(-linesOption) : [],
    workers: userBots
  });
}

module.exports = {
  data: definition,
  execute
};
