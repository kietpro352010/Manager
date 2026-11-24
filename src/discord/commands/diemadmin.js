'use strict';

const { SlashCommandBuilder } = require('discord.js');
const { embed, safe } = require('../panels/renderer');
const { resolveLinkedUser } = require('../handlers/panel-handler');

function checkUserAdmin(interaction, services, user, allowedGuildId) {
  const { isUserAdmin } = require('../handlers/interaction-handler');
  return isUserAdmin(interaction, services, user, allowedGuildId);
}

const definition = new SlashCommandBuilder()
  .setName('diemadmin')
  .setDescription('Quản lý điểm tích lũy & chuỗi điểm danh thành viên (Chỉ Admin)')
  .addSubcommand((cmd) =>
    cmd.setName('cong')
      .setDescription('Cộng điểm cho thành viên')
      .addUserOption((opt) =>
        opt.setName('nguoidung')
          .setDescription('Thành viên nhận điểm')
          .setRequired(true)
      )
      .addIntegerOption((opt) =>
        opt.setName('so_diem')
          .setDescription('Số điểm cần cộng (tối thiểu 1)')
          .setRequired(true)
          .setMinValue(1)
          .setMaxValue(1000000)
      )
      .addStringOption((opt) =>
        opt.setName('ly_do')
          .setDescription('Ghi chú lý do (tuỳ chọn)')
          .setRequired(false)
          .setMaxLength(200)
      )
  )
  .addSubcommand((cmd) =>
    cmd.setName('tru')
      .setDescription('Trừ điểm của thành viên')
      .addUserOption((opt) =>
        opt.setName('nguoidung')
          .setDescription('Thành viên bị trừ điểm')
          .setRequired(true)
      )
      .addIntegerOption((opt) =>
        opt.setName('so_diem')
          .setDescription('Số điểm cần trừ (tối thiểu 1)')
          .setRequired(true)
          .setMinValue(1)
          .setMaxValue(1000000)
      )
      .addStringOption((opt) =>
        opt.setName('ly_do')
          .setDescription('Ghi chú lý do (tuỳ chọn)')
          .setRequired(false)
          .setMaxLength(200)
      )
  )
  .addSubcommand((cmd) =>
    cmd.setName('dat')
      .setDescription('Đặt chính xác số điểm của thành viên')
      .addUserOption((opt) =>
        opt.setName('nguoidung')
          .setDescription('Thành viên cần đặt điểm')
          .setRequired(true)
      )
      .addIntegerOption((opt) =>
        opt.setName('so_diem')
          .setDescription('Mức điểm mới (>= 0)')
          .setRequired(true)
          .setMinValue(0)
          .setMaxValue(1000000)
      )
      .addStringOption((opt) =>
        opt.setName('ly_do')
          .setDescription('Ghi chú lý do (tuỳ chọn)')
          .setRequired(false)
          .setMaxLength(200)
      )
  )
  .addSubcommand((cmd) =>
    cmd.setName('reset')
      .setDescription('Reset điểm (hoặc toàn bộ dữ liệu) của thành viên')
      .addUserOption((opt) =>
        opt.setName('nguoidung')
          .setDescription('Thành viên cần reset')
          .setRequired(true)
      )
      .addStringOption((opt) =>
        opt.setName('pham_vi')
          .setDescription('Phạm vi reset (mặc định: Chỉ reset điểm về 0)')
          .setRequired(false)
          .addChoices(
            { name: 'Chỉ reset điểm về 0 (giữ chuỗi & tin nhắn)', value: 'diem' },
            { name: 'Reset toàn bộ (điểm + chuỗi + tin nhắn)', value: 'tatca' }
          )
      )
      .addStringOption((opt) =>
        opt.setName('ly_do')
          .setDescription('Ghi chú lý do (tuỳ chọn)')
          .setRequired(false)
          .setMaxLength(200)
      )
  );

async function execute(interaction, services) {
  const { getEffectiveAllowedGuildId } = require('../handlers/interaction-handler');
  const allowedGuildId = await getEffectiveAllowedGuildId(services?.config, services);
  const user = (services?.accessStore?.getUserByDiscordId && typeof resolveLinkedUser === 'function')
    ? await resolveLinkedUser(interaction, services)
    : null;
  const isAdmin = checkUserAdmin(interaction, services, user, allowedGuildId);

  if (!isAdmin) {
    return {
      embeds: [embed('⛔ TỪ CHỐI TRUY CẬP', 'Lệnh này chỉ dành cho Quản trị viên (Admin).', 0xef4444)]
    };
  }

  const pointsService = services?.discordPoints;
  if (!pointsService) {
    return {
      embeds: [embed('❌ LỖI', 'Hệ thống điểm tích lũy chưa được khởi tạo.', 0xef4444)]
    };
  }

  const subcommand = interaction.options?.getSubcommand?.(false);
  const targetUser = interaction.options?.getUser?.('nguoidung');
  if (!targetUser) {
    return {
      embeds: [embed('❌ THIẾU THÔNG TIN', 'Vui lòng chọn thành viên hợp lệ.', 0xef4444)]
    };
  }
  if (targetUser.bot) {
    return {
      embeds: [embed('🤖 KHÔNG HỢP LỆ', 'Không thể thao tác điểm cho tài khoản bot Discord.', 0xf59e0b)]
    };
  }

  const targetName = targetUser.globalName || targetUser.username || '';
  const reason = safe(interaction.options?.getString?.('ly_do') || 'Không ghi chú', 200);

  if (subcommand === 'reset') {
    const scope = interaction.options?.getString?.('pham_vi') || 'diem';
    const res = await pointsService.adminResetUser({
      guildId: interaction.guildId,
      userId: targetUser.id,
      username: targetName,
      scope
    });

    await services?.accessStore?.addAudit?.({
      action: 'DISCORD_POINTS_ADMIN_RESET',
      actorId: interaction.user?.id || 'admin',
      targetId: targetUser.id,
      details: {
        guildId: interaction.guildId,
        scope: res.scope,
        beforePoints: res.before.points,
        afterPoints: res.after.points,
        reason
      }
    })?.catch?.(() => null);

    const scopeLabel = res.scope === 'tatca'
      ? 'Toàn bộ (Điểm + Chuỗi điểm danh + Tổng tin nhắn)'
      : 'Chỉ Điểm tích lũy (giữ nguyên chuỗi & tin nhắn)';

    return {
      embeds: [
        embed(
          '🔄 ĐÃ RESET DỮ LIỆU THÀNH VIÊN',
          `Đã reset dữ liệu cho <@${targetUser.id}>.`,
          0xf59e0b
        ).addFields(
          { name: '📌 Phạm vi', value: scopeLabel, inline: false },
          { name: '📉 Trước khi reset', value: `**${res.before.points.toLocaleString('en-US')} đ**`, inline: true },
          { name: '📍 Sau khi reset', value: `**${res.after.points.toLocaleString('en-US')} đ**`, inline: true },
          { name: '📝 Lý do', value: reason, inline: false }
        )
      ]
    };
  }

  const amount = Number(interaction.options?.getInteger?.('so_diem') ?? 0);
  const modeMap = { cong: 'add', tru: 'subtract', dat: 'set' };
  const mode = modeMap[subcommand];
  if (!mode) {
    return {
      embeds: [embed('❌ LỆNH KHÔNG HỢP LỆ', 'Subcommand không được hỗ trợ.', 0xef4444)]
    };
  }

  const res = await pointsService.adminAdjustPoints({
    guildId: interaction.guildId,
    userId: targetUser.id,
    username: targetName,
    mode,
    amount
  });

  await services?.accessStore?.addAudit?.({
    action: 'DISCORD_POINTS_ADMIN_ADJUST',
    actorId: interaction.user?.id || 'admin',
    targetId: targetUser.id,
    details: {
      guildId: interaction.guildId,
      mode,
      amount,
      beforePoints: res.beforePoints,
      afterPoints: res.afterPoints,
      reason
    }
  })?.catch?.(() => null);

  const actionTitle = mode === 'add'
    ? '➕ ĐÃ CỘNG ĐIỂM THÀNH VIÊN'
    : mode === 'subtract'
      ? '➖ ĐÃ TRỪ ĐIỂM THÀNH VIÊN'
      : '🎯 ĐÃ CẬP NHẬT ĐIỂM THÀNH VIÊN';
  const signDelta = res.delta >= 0 ? `+${res.delta.toLocaleString('en-US')}` : res.delta.toLocaleString('en-US');
  const clampNote = res.clampedToZero ? '\n*(Đã giữ mức tối thiểu 0 đ — điểm không thể âm)*' : '';

  return {
    embeds: [
      embed(
        actionTitle,
        `Đã cập nhật điểm cho <@${targetUser.id}>.${clampNote}`,
        mode === 'subtract' ? 0xf59e0b : 0x22c55e
      ).addFields(
        { name: '📉 Điểm cũ', value: `**${res.beforePoints.toLocaleString('en-US')} đ**`, inline: true },
        { name: '📈 Điểm mới', value: `**${res.afterPoints.toLocaleString('en-US')} đ** (${signDelta})`, inline: true },
        { name: '📝 Lý do', value: reason, inline: false }
      )
    ]
  };
}

module.exports = {
  data: definition,
  ephemeral: true,
  execute
};
