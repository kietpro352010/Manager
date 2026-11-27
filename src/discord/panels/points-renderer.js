'use strict';

const { ActionRowBuilder, ButtonStyle } = require('discord.js');
const { embed, button, safe } = require('./renderer');
const {
  DAILY_CHECKIN_POINTS,
  STREAK_MILESTONE_INTERVAL,
  STREAK_MILESTONE_BONUS,
  STREAK_RESTORE_COST,
  buildUpcomingStreakRoadmap
} = require('../../services/discord-points-service');

function formatNum(value) {
  return Math.max(0, Math.floor(Number(value) || 0)).toLocaleString('en-US');
}

function renderLoginRequiredNotice(discordUserId = '') {
  const uid = String(discordUserId || '').trim();
  const components = [];
  if (uid) {
    components.push(
      new ActionRowBuilder().addComponents(
        button('Đăng nhập ngay', `login:prompt:${uid}`, ButtonStyle.Primary, false, '🔐')
      )
    );
  }
  return {
    embeds: [
      embed(
        '⚠️ CHƯA ĐĂNG NHẬP (/LOGIN)',
        'Chỉ thành viên **đã đăng nhập tài khoản Web Manager** bằng lệnh `/login` mới được tham gia tích điểm, điểm danh và xem bảng xếp hạng.\n\n👉 Bấm nút **Đăng nhập ngay** bên dưới (hoặc gõ `/login`) rồi thử lại nhé!',
        0xf59e0b
      )
    ],
    components
  };
}

function formatVnTime(ms) {
  const d = new Date(Number.isFinite(Number(ms)) ? Number(ms) : Date.now());
  try {
    return new Intl.DateTimeFormat('vi-VN', {
      timeZone: 'Asia/Ho_Chi_Minh',
      hour12: false,
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      day: '2-digit',
      month: '2-digit',
      year: 'numeric'
    }).format(d);
  } catch (_) {
    return d.toISOString();
  }
}

function buildLeaderboardScheduleInfo(updatedAtMs = Date.now(), intervalMs = 15 * 60 * 1000) {
  const safeUpdatedAtMs = Number.isFinite(Number(updatedAtMs)) ? Number(updatedAtMs) : Date.now();
  const updatedAtUnix = Math.floor(safeUpdatedAtMs / 1000);
  const intervalSec = Math.max(60, Math.round((Number(intervalMs) || (15 * 60 * 1000)) / 1000));
  const nextUpdateAtUnix = updatedAtUnix + intervalSec;
  const intervalMinutes = Math.max(1, Math.round(intervalSec / 60));
  const timeText = formatVnTime(safeUpdatedAtMs);
  const block =
    `🕒 **Cập nhật lúc:** \`${timeText}\` (<t:${updatedAtUnix}:R>)\n` +
    `⏱️ **Tự động cập nhật tiếp theo:** <t:${nextUpdateAtUnix}:R> (mỗi **${intervalMinutes} phút**)`;
  return {
    updatedAtMs: safeUpdatedAtMs,
    updatedAtUnix,
    nextUpdateAtUnix,
    intervalMinutes,
    block
  };
}

function buildLeaderboardTabRow(activeType = 'tatca') {
  return new ActionRowBuilder().addComponents(
    button(
      'Tổng hợp Top 10',
      'points:lb:tatca',
      activeType === 'tatca' ? ButtonStyle.Primary : ButtonStyle.Secondary,
      activeType === 'tatca',
      '📊'
    ),
    button(
      'Điểm',
      'points:lb:diem',
      activeType === 'diem' ? ButtonStyle.Primary : ButtonStyle.Secondary,
      activeType === 'diem',
      '🏆'
    ),
    button(
      'Chuỗi điểm danh',
      'points:lb:chuoi',
      activeType === 'chuoi' ? ButtonStyle.Primary : ButtonStyle.Secondary,
      activeType === 'chuoi',
      '🔥'
    ),
    button(
      'Tin nhắn',
      'points:lb:tinnhan',
      activeType === 'tinnhan' ? ButtonStyle.Primary : ButtonStyle.Secondary,
      activeType === 'tinnhan',
      '💬'
    )
  );
}

function buildLeaderboardControlRow() {
  return new ActionRowBuilder().addComponents(
    button('Làm mới', 'points:lb:refresh', ButtonStyle.Success, false, '🔄')
  );
}

function formatStreakRoadmapBlock(roadmap) {
  const list = Array.isArray(roadmap) ? roadmap : [];
  if (list.length === 0) {
    return {
      title: '🗓️ Hành trình 10 ngày tiếp theo',
      value: '*(Chưa có dữ liệu)*'
    };
  }
  const totalUpcoming = list.reduce((sum, item) => sum + (Number(item?.totalPoints) || 0), 0);
  const lines = list.map((item) => {
    const dayStr = String(item.streakDay).padStart(2, ' ');
    if (item.isMilestone) {
      return `Ngày ${dayStr} : +${item.totalPoints}đ  ★ MỐC ${item.streakDay} NGÀY (+${item.milestoneBonus}đ)`;
    }
    return `Ngày ${dayStr} : +${item.totalPoints}đ`;
  });
  return {
    title: `🗓️ Hành trình ${list.length} ngày tiếp theo (Tổng +${formatNum(totalUpcoming)}đ)`,
    value: `\`\`\`text\n${lines.join('\n')}\n\`\`\``.slice(0, 1024)
  };
}

function renderCheckinResult({ user, result }) {
  const displayName = safe(
    user?.globalName || user?.username || result?.record?.username || 'Thành viên',
    48
  );
  const ownerId = String(user?.id || result?.record?.userId || '').trim();

  if (result?.needsRestoreChoice) {
    const canAfford = Boolean(result.canAffordRestore);
    const shortNote = canAfford
      ? `✅ Bạn đang có **${formatNum(result.currentPoints)} đ** (đủ để khôi phục).`
      : `⚠️ Bạn hiện có **${formatNum(result.currentPoints)} đ**, còn thiếu **${formatNum(result.restoreCost - result.currentPoints)} đ** để dùng tính năng này.`;

    const promptDesc = [
      `**${displayName}** đã bỏ lỡ ngày **${result.missedDateKey}** khiến chuỗi **${result.previousStreak} ngày** bị gián đoạn.`,
      '',
      `Bạn có muốn dùng **${result.restoreCost} đ** để khôi phục chuỗi lên **${result.restoredStreak} ngày** không?`,
      `• **Có (-${result.restoreCost} đ):** Khôi phục và tăng chuỗi thành **${result.restoredStreak} ngày** *(không cộng điểm điểm danh hôm nay)*.`,
      `• **Không:** Mất chuỗi cũ (bắt đầu lại từ **Ngày 1**), vẫn cộng **+${DAILY_CHECKIN_POINTS} đ** điểm danh bình thường.`,
      '',
      shortNote
    ].join('\n');

    const e = embed(
      '💔 BẠN ĐÃ BỎ LỠ 1 NGÀY ĐIỂM DANH!',
      promptDesc,
      0xf59e0b
    ).addFields(
      { name: '🎁 Điểm hiện tại', value: `**${formatNum(result.currentPoints)} đ**`, inline: true },
      { name: '🔥 Chuỗi trước đó', value: `**${result.previousStreak} ngày**`, inline: true },
      { name: '💸 Phí khôi phục', value: `**${result.restoreCost} đ**`, inline: true }
    );
    if (typeof user?.displayAvatarURL === 'function') {
      e.setThumbnail(user.displayAvatarURL({ size: 128 }));
    }
    e.setFooter({ text: 'Reset ngày mới lúc 00:00 (giờ VN) • Chỉ áp dụng khi lỡ đúng 1 ngày' });

    const row = new ActionRowBuilder().addComponents(
      button(
        `Có, dùng ${result.restoreCost}đ khôi phục`,
        `points:restore:yes:${ownerId}`,
        ButtonStyle.Success,
        !canAfford,
        '🔥'
      ),
      button(
        `Không, điểm danh mới (+${DAILY_CHECKIN_POINTS}đ)`,
        `points:restore:no:${ownerId}`,
        ButtonStyle.Danger,
        false,
        '🔄'
      )
    );
    return { embeds: [e], components: [row] };
  }

  const streak = Number(result?.streak || 0);
  const roadmapList = Array.isArray(result?.roadmap) && result.roadmap.length > 0
    ? result.roadmap
    : buildUpcomingStreakRoadmap(streak, 10);
  const roadmapField = formatStreakRoadmapBlock(roadmapList);

  if (result?.restored) {
    const e = embed(
      '🔥 KHÔI PHỤC CHUỖI THÀNH CÔNG!',
      `Đã dùng **${formatNum(result.pointsSpent)} đ** để khôi phục chuỗi điểm danh ngày **${result.todayKey}** cho **${displayName}** *(không cộng điểm ngày hôm nay)*.`,
      0x22c55e
    ).addFields(
      { name: '💸 Chi phí khôi phục', value: `**-${formatNum(result.pointsSpent)} đ**`, inline: true },
      { name: '🎁 Điểm hiện tại', value: `**${formatNum(result.record?.points)} đ**`, inline: true },
      { name: '🔥 Chuỗi hiện tại', value: `**${streak} ngày**`, inline: true },
      { name: roadmapField.title, value: roadmapField.value, inline: false }
    );
    if (typeof user?.displayAvatarURL === 'function') {
      e.setThumbnail(user.displayAvatarURL({ size: 128 }));
    }
    e.setFooter({
      text: `Reset ngày mới lúc 00:00 (giờ VN) • Kỷ lục chuỗi: ${result.record?.longestStreak || streak} ngày`
    });
    return { embeds: [e], components: [] };
  }

  if (result?.alreadyCheckedIn) {
    const daysLeft = Number(result.daysToNextMilestone || STREAK_MILESTONE_INTERVAL);
    const e = embed(
      '⏳ BẠN ĐÃ ĐIỂM DANH HÔM NAY RỒI',
      `Hôm nay (${result.todayKey}) **${displayName}** đã điểm danh rồi. Hãy quay lại sau **00:00** ngày mai để giữ chuỗi nhé!`,
      0xf59e0b
    ).addFields(
      { name: '🎁 Điểm hiện tại', value: `**${formatNum(result.record?.points)} đ**`, inline: true },
      { name: '🔥 Chuỗi hiện tại', value: `**${streak} ngày**`, inline: true },
      { name: `🎯 Mốc +${STREAK_MILESTONE_BONUS}đ`, value: `Còn **${daysLeft} ngày**`, inline: true },
      { name: roadmapField.title, value: roadmapField.value, inline: false }
    );
    if (typeof user?.displayAvatarURL === 'function') {
      e.setThumbnail(user.displayAvatarURL({ size: 128 }));
    }
    e.setFooter({ text: 'Reset ngày mới lúc 00:00 (giờ VN) • 1 tin nhắn = +1đ (tự động cộng)' });
    return { embeds: [e], components: [] };
  }

  const isMilestone = Boolean(result?.isMilestone);
  const title = isMilestone
    ? `🎉 ĐIỂM DANH MỐC ${streak} NGÀY!`
    : '✅ ĐIỂM DANH THÀNH CÔNG';
  const color = isMilestone ? 0xeab308 : 0x22c55e;
  const rewardDetail = isMilestone
    ? `**+${result.pointsEarned} đ** *(+${DAILY_CHECKIN_POINTS}đ ngày + **${STREAK_MILESTONE_BONUS}đ** thưởng mốc ${streak} ngày)*`
    : `**+${result.pointsEarned} đ**`;
  const lostNote = result?.lostPreviousStreak > 0
    ? `\n*(Đã bỏ chuỗi cũ ${result.lostPreviousStreak} ngày và bắt đầu lại từ Ngày 1)*`
    : '';

  const e = embed(
    title,
    `Chúc mừng **${displayName}** đã điểm danh ngày **${result.todayKey}**!${lostNote}`,
    color
  ).addFields(
    { name: '✨ Phần thưởng hôm nay', value: rewardDetail, inline: false },
    { name: '🎁 Điểm hiện tại', value: `**${formatNum(result.record?.points)} đ**`, inline: true },
    { name: '🔥 Chuỗi liên tiếp', value: `**${streak} ngày**`, inline: true },
    {
      name: `🎯 Mốc +${STREAK_MILESTONE_BONUS}đ tiếp theo`,
      value: `Còn **${result.daysToNextMilestone} ngày**`,
      inline: true
    },
    { name: roadmapField.title, value: roadmapField.value, inline: false }
  );
  if (typeof user?.displayAvatarURL === 'function') {
    e.setThumbnail(user.displayAvatarURL({ size: 128 }));
  }
  e.setFooter({
    text: `Reset ngày mới lúc 00:00 (giờ VN) • Kỷ lục: ${result.record?.longestStreak || streak} ngày • Tổng tin nhắn: ${formatNum(result.record?.totalMessages)}`
  });
  return { embeds: [e], components: [] };
}

function renderUserPointsProfile({ targetUser, profile, viewerId = '' }) {
  const displayName = safe(
    targetUser?.globalName || targetUser?.username || profile?.username || 'Thành viên',
    48
  );
  const rankPts = profile?.ranks?.pointsRank ? `#${profile.ranks.pointsRank}` : 'Chưa có';
  const rankStr = profile?.ranks?.streakRank ? `#${profile.ranks.streakRank}` : 'Chưa có';
  const rankMsg = profile?.ranks?.messagesRank ? `#${profile.ranks.messagesRank}` : 'Chưa có';
  const todayBadge = profile?.checkedInToday ? '✅ Đã điểm danh hôm nay' : '⏳ Chưa điểm danh hôm nay';

  const e = embed(
    `📊 HỒ SƠ ĐIỂM TÍCH LŨY — ${displayName}`,
    `Thông tin điểm thưởng, chuỗi điểm danh và mức độ hoạt động trong server (${todayBadge}).`,
    0x0ea5e9
  ).addFields(
    {
      name: '🎁 Điểm tích lũy',
      value: `**${formatNum(profile?.points)} đ**\nHạng: **${rankPts}**`,
      inline: true
    },
    {
      name: '🔥 Chuỗi điểm danh',
      value: `**${formatNum(profile?.effectiveStreak)} ngày** (Kỷ lục: ${formatNum(profile?.longestStreak)})\nHạng: **${rankStr}**`,
      inline: true
    },
    {
      name: '💬 Tổng tin nhắn',
      value: `**${formatNum(profile?.totalMessages)}**\nHạng: **${rankMsg}**`,
      inline: true
    },
    {
      name: '📅 Tổng ngày điểm danh',
      value: `**${formatNum(profile?.totalCheckins)} ngày**`,
      inline: true
    },
    {
      name: `🎯 Mốc thưởng +${STREAK_MILESTONE_BONUS}đ`,
      value: `Còn **${formatNum(profile?.daysToNextMilestone)} ngày** *(mỗi ${STREAK_MILESTONE_INTERVAL} ngày)*`,
      inline: true
    }
  );
  if (typeof targetUser?.displayAvatarURL === 'function') {
    e.setThumbnail(targetUser.displayAvatarURL({ size: 128 }));
  }
  e.setFooter({ text: 'Dùng /diemdanh mỗi ngày để nhận +10đ và giữ chuỗi nhận thêm +30đ' });

  const isSelf = Boolean(viewerId && targetUser?.id && String(viewerId) === String(targetUser.id));
  const actionRow = new ActionRowBuilder();
  if (isSelf && !profile?.checkedInToday) {
    actionRow.addComponents(
      button('Điểm danh ngay (+10đ)', `points:quick_checkin:${viewerId}`, ButtonStyle.Success, false, '📅')
    );
  }
  actionRow.addComponents(
    button('Xem Bảng xếp hạng', 'points:lb:tatca', ButtonStyle.Secondary, false, '🏆')
  );

  return { embeds: [e], components: [actionRow] };
}

function renderUserMessagesStats({ targetUser, profile }) {
  const displayName = safe(
    targetUser?.globalName || targetUser?.username || profile?.username || 'Thành viên',
    48
  );
  const rankMsg = profile?.ranks?.messagesRank ? `#${profile.ranks.messagesRank}` : 'Chưa có';

  const e = embed(
    `💬 THỐNG KÊ TIN NHẮN — ${displayName}`,
    'Tổng số tin nhắn đã gửi trong server từ trước tới nay (mỗi tin nhắn được cộng âm thầm **+1 đ**).',
    0x3b82f6
  ).addFields(
    { name: '💬 Tổng tin nhắn', value: `**${formatNum(profile?.totalMessages)} tin nhắn**`, inline: true },
    { name: '🏆 Hạng tin nhắn', value: `**${rankMsg}**`, inline: true },
    { name: '🎁 Điểm hiện tại', value: `**${formatNum(profile?.points)} đ**`, inline: true }
  );
  if (typeof targetUser?.displayAvatarURL === 'function') {
    e.setThumbnail(targetUser.displayAvatarURL({ size: 128 }));
  }
  e.setFooter({ text: 'Chỉ tính tin nhắn trong server sau khi đã /login • Dùng /bxh để xem Top 10' });
  return { embeds: [e] };
}

function medalForRank(rank) {
  if (rank === 1) return '🥇';
  if (rank === 2) return '🥈';
  if (rank === 3) return '🥉';
  return `\`#${rank}\``;
}

function formatBoardSection(entries, type) {
  if (!Array.isArray(entries) || entries.length === 0) {
    return '*(Chưa có dữ liệu)*';
  }
  const lines = entries.map((entry) => {
    const medal = medalForRank(entry.rank);
    if (type === 'chuoi') {
      return `${medal} <@${entry.userId}> — **${formatNum(entry.effectiveStreak)} ngày** *(kỷ lục ${formatNum(entry.longestStreak)})*`;
    }
    if (type === 'tinnhan') {
      return `${medal} <@${entry.userId}> — **${formatNum(entry.totalMessages)} tin**`;
    }
    return `${medal} <@${entry.userId}> — **${formatNum(entry.points)} đ**`;
  });
  return lines.join('\n').slice(0, 1020);
}

function renderCombinedPointsLeaderboard({
  guildName = 'Server',
  combined,
  updatedAtMs = Date.now(),
  intervalMs = 15 * 60 * 1000,
  hasViewer = true
}) {
  const limit = Number(combined?.limit || 10);
  const diem = combined?.diem || {};
  const chuoi = combined?.chuoi || {};
  const tinnhan = combined?.tinnhan || {};
  const sched = buildLeaderboardScheduleInfo(updatedAtMs, intervalMs);

  const e = embed(
    `📊 BẢNG XẾP HẠNG TOP ${limit} — ${safe(guildName, 36)}`,
    'Bảng xếp hạng thành viên đã đăng nhập (`/login`) theo **Điểm tích lũy**, **Chuỗi điểm danh** và **Tổng tin nhắn**.\n' +
    sched.block,
    0xeab308
  ).addFields(
    {
      name: `🏆 Top ${limit} Điểm tích lũy`,
      value: formatBoardSection(diem.entries, 'diem'),
      inline: false
    },
    {
      name: `🔥 Top ${limit} Chuỗi điểm danh`,
      value: formatBoardSection(chuoi.entries, 'chuoi'),
      inline: false
    },
    {
      name: `💬 Top ${limit} Tin nhắn`,
      value: formatBoardSection(tinnhan.entries, 'tinnhan'),
      inline: false
    }
  );

  const pRank = diem.viewerRank ? `#${diem.viewerRank} (${formatNum(diem.viewerMetric)}đ)` : 'Chưa có';
  const sRank = chuoi.viewerRank ? `#${chuoi.viewerRank} (${formatNum(chuoi.viewerMetric)}d)` : 'Chưa có';
  const mRank = tinnhan.viewerRank ? `#${tinnhan.viewerRank} (${formatNum(tinnhan.viewerMetric)} tin)` : 'Chưa có';
  const footerText = hasViewer
    ? `Hạng của bạn — Điểm: ${pRank} • Chuỗi: ${sRank} • Tin nhắn: ${mRank} • Tự động cập nhật mỗi ${sched.intervalMinutes} phút`
    : `Tự động cập nhật mỗi ${sched.intervalMinutes} phút • Dùng /diemdanh và chat để tích điểm`;
  e.setFooter({ text: footerText.slice(0, 2048) }).setTimestamp(new Date(sched.updatedAtMs));

  return {
    embeds: [e],
    components: [buildLeaderboardTabRow('tatca'), buildLeaderboardControlRow()]
  };
}

function renderPointsLeaderboard({
  guildName = 'Server',
  leaderboard,
  updatedAtMs = Date.now(),
  intervalMs = 15 * 60 * 1000,
  hasViewer = true
}) {
  const type = leaderboard?.type || 'diem';
  const entries = Array.isArray(leaderboard?.entries) ? leaderboard.entries : [];
  const sched = buildLeaderboardScheduleInfo(updatedAtMs, intervalMs);

  const titleByType = {
    diem: `🏆 BẢNG XẾP HẠNG ĐIỂM — ${safe(guildName, 40)}`,
    chuoi: `🔥 BẢNG XẾP HẠNG CHUỖI ĐIỂM DANH — ${safe(guildName, 40)}`,
    tinnhan: `💬 BẢNG XẾP HẠNG TIN NHẮN — ${safe(guildName, 40)}`
  };

  let body = '';
  if (entries.length === 0) {
    body = 'Chưa có thành viên đã `/login` nào có dữ liệu trên bảng xếp hạng này.\nHãy chat trong server hoặc dùng `/diemdanh` để lên bảng xếp hạng!';
  } else {
    const lines = entries.map((entry) => {
      const medal = medalForRank(entry.rank);
      if (type === 'chuoi') {
        return `${medal} <@${entry.userId}> — **${formatNum(entry.effectiveStreak)} ngày** *(Kỷ lục: ${formatNum(entry.longestStreak)} • ${formatNum(entry.points)} đ)*`;
      }
      if (type === 'tinnhan') {
        return `${medal} <@${entry.userId}> — **${formatNum(entry.totalMessages)} tin nhắn** *(${formatNum(entry.points)} đ)*`;
      }
      return `${medal} <@${entry.userId}> — **${formatNum(entry.points)} đ** *(Chuỗi: ${formatNum(entry.effectiveStreak)}d • ${formatNum(entry.totalMessages)} msg)*`;
    });
    body = lines.join('\n');
  }

  const description = `${sched.block}\n\n${body}`.slice(0, 4096);

  const colorByType = {
    diem: 0xeab308,
    chuoi: 0xf97316,
    tinnhan: 0x3b82f6
  };

  const e = embed(
    titleByType[type] || titleByType.diem,
    description,
    colorByType[type] || 0xeab308
  );

  let viewerFooter = `Tổng thành viên đã xếp hạng: ${formatNum(leaderboard?.totalRanked || 0)}`;
  if (hasViewer) {
    if (leaderboard?.viewerRank) {
      const unit = type === 'chuoi' ? 'ngày' : (type === 'tinnhan' ? 'tin nhắn' : 'đ');
      viewerFooter = `Vị trí của bạn: #${leaderboard.viewerRank} (${formatNum(leaderboard.viewerMetric)} ${unit}) • ${viewerFooter}`;
    } else {
      viewerFooter = `Bạn chưa có hạng ở mục này • ${viewerFooter}`;
    }
  }
  viewerFooter = `${viewerFooter} • Tự động cập nhật mỗi ${sched.intervalMinutes} phút`;
  e.setFooter({ text: viewerFooter.slice(0, 2048) }).setTimestamp(new Date(sched.updatedAtMs));

  return {
    embeds: [e],
    components: [buildLeaderboardTabRow(type), buildLeaderboardControlRow()]
  };
}

module.exports = {
  renderLoginRequiredNotice,
  formatStreakRoadmapBlock,
  renderCheckinResult,
  renderUserPointsProfile,
  renderUserMessagesStats,
  renderCombinedPointsLeaderboard,
  renderPointsLeaderboard
};
