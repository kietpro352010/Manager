'use strict';

const { SlashCommandBuilder, ActionRowBuilder, ChannelType } = require('discord.js');
const { embed, button } = require('../panels/renderer');

function checkUserAdmin(interaction, services, user, allowedGuildId) {
  const { isUserAdmin } = require('../handlers/interaction-handler');
  return isUserAdmin(interaction, services, user, allowedGuildId);
}

async function getGuildInvite(guild) {
  if (!guild) return '*(Không khả dụng)*';

  // 1. Kiểm tra vanity URL nếu server có link rút gọn tùy chỉnh
  if (guild.vanityURLCode) {
    return `https://discord.gg/${guild.vanityURLCode}`;
  }

  try {
    // 2. Ưu tiên lấy invite sẵn có còn hạn sử dụng (DISCORD-07)
    if (typeof guild.invites?.fetch === 'function') {
      const existingInvites = await guild.invites.fetch().catch(() => null);
      const activeInvite = existingInvites?.find?.((inv) => !inv.expired);
      if (activeInvite?.url) {
        return activeInvite.url;
      }
    }

    // 3. Tìm kênh văn bản hợp lệ mà bot có quyền tạo link mời
    let channels = guild.channels?.cache;
    if (!channels || channels.size === 0) {
      channels = await guild.channels?.fetch?.().catch(() => null);
    }

    if (channels) {
      const me = guild.members?.me || await guild.members?.fetchMe?.().catch(() => null);
      const targetChannel = channels.find((c) => {
        if (!c || !c.isTextBased?.()) return false;
        if (c.isThread?.()) return false;
        if (c.type !== undefined && c.type !== ChannelType.GuildText && c.type !== ChannelType.GuildAnnouncement) {
          return false;
        }
        if (!me) return true;
        const perms = c.permissionsFor?.(me);
        return perms?.has?.('CreateInstantInvite') || perms?.has?.(1n << 0n);
      });

      if (targetChannel && typeof targetChannel.createInvite === 'function') {
        const invite = await targetChannel.createInvite({
          maxAge: 3600,
          maxUses: 1,
          reason: 'KBot Server List (/kbot command)'
        }).catch(() => null);

        if (invite?.url) {
          return invite.url;
        }
      }
    }
  } catch (_) {}

  return '*(Không có quyền tạo link mời)*';
}

async function renderKbotServerList(client) {
  let guildList = [];
  try {
    if (client?.guilds?.cache && client.guilds.cache.size > 0) {
      guildList = Array.from(client.guilds.cache.values());
    } else if (typeof client?.guilds?.fetch === 'function') {
      const fetched = await client.guilds.fetch().catch(() => null);
      if (fetched && typeof fetched.values === 'function') {
        guildList = Array.from(fetched.values());
      } else if (Array.isArray(fetched)) {
        guildList = fetched;
      }
    }
  } catch (_) {
    guildList = client?.guilds?.cache ? Array.from(client.guilds.cache.values()) : [];
  }

  // Sắp xếp theo số lượng thành viên giảm dần
  guildList.sort((a, b) => (b.memberCount || 0) - (a.memberCount || 0));

  const totalGuilds = guildList.length;
  let totalMembers = 0;
  for (const g of guildList) {
    totalMembers += (g.memberCount || 0);
  }

  let desc = `• **Tổng số máy chủ:** **${totalGuilds}** server  ·  **Tổng thành viên:** **${totalMembers.toLocaleString('vi-VN')}** người dùng\n\n`;

  if (totalGuilds === 0) {
    desc += `ℹ️ *Bot hiện chưa có mặt trong bất kỳ máy chủ nào.*`;
  } else {
    // Giới hạn hiển thị 20 máy chủ để không vượt quá giới hạn 4096 ký tự của Discord Embed
    const displayGuilds = guildList.slice(0, 20);
    const inviteUrls = new Array(displayGuilds.length);
    for (let start = 0; start < displayGuilds.length; start += 5) {
      const chunk = displayGuilds.slice(start, start + 5);
      const settled = await Promise.all(chunk.map((g) => getGuildInvite(g).catch(() => '*(Không khả dụng)*')));
      for (let j = 0; j < settled.length; j++) {
        inviteUrls[start + j] = settled[j];
      }
    }

    for (let i = 0; i < displayGuilds.length; i++) {
      const g = displayGuilds[i];
      const inviteUrl = inviteUrls[i] || '*(Không khả dụng)*';
      const inviteFormatted = inviteUrl.startsWith('http')
        ? `[**Tham gia**](${inviteUrl})`
        : inviteUrl;
      const ownerText = g.ownerId ? `<@${g.ownerId}>` : '—';
      const memberCountText = (g.memberCount || 0).toLocaleString('vi-VN');

      desc += `**${i + 1}. ${g.name || 'Không có tên'}** (\`${g.id}\`)\n` +
              `> • Thành viên: **${memberCountText}** · Chủ server: ${ownerText} · ${inviteFormatted}\n\n`;
    }

    if (totalGuilds > 20) {
      desc += `*...và còn **${totalGuilds - 20}** máy chủ khác.*`;
    }
  }

  if (desc.length > 4096) {
    desc = `${desc.slice(0, 4050).trimEnd()}\n\n*(Đã rút gọn do giới hạn 4096 ký tự)*`;
  }

  const serverEmbed = embed(
    '🌐 DANH SÁCH MÁY CHỦ DISCORD — KBOT SYSTEM',
    desc.trimEnd(),
    0x5865F2 // Discord Blurple
  ).setFooter({ text: 'KBOT Admin • Danh sách server đang cài đặt bot' });

  const row = new ActionRowBuilder().addComponents(
    button('Làm mới danh sách', 'kbot:refresh_servers', 1, false, '🔄')
  );

  return {
    embeds: [serverEmbed],
    components: [row]
  };
}

const definition = new SlashCommandBuilder()
  .setName('kbot')
  .setDescription('Xem danh sách tất cả máy chủ Discord mà KBot đang tham gia (Chỉ dành cho Admin)');

async function execute(interaction, services) {
  const { resolveLinkedUser } = require('../handlers/panel-handler');
  const { getEffectiveAllowedGuildId } = require('../handlers/interaction-handler');
  const allowedGuildId = await getEffectiveAllowedGuildId(services?.config, services);
  const user = (services?.accessStore?.getUserByDiscordId && typeof resolveLinkedUser === 'function')
    ? await resolveLinkedUser(interaction, services).catch(() => null)
    : null;

  const isAdmin = checkUserAdmin(interaction, services, user, allowedGuildId);
  if (!isAdmin) {
    return {
      embeds: [
        embed(
          '⛔ TỪ CHỐI TRUY CẬP',
          'Lệnh `/kbot` chỉ dành cho **Quản trị viên (Admin)**.',
          0xef4444
        )
      ]
    };
  }

  const client = services?.discordClient || services?.client || interaction.client;
  const panel = await renderKbotServerList(client);
  return panel;
}

module.exports = {
  data: definition,
  execute,
  renderKbotServerList,
  getGuildInvite,
  ephemeral: true // Luôn ẩn với người khác, chỉ Admin nhìn thấy
};
