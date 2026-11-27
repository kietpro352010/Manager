
function updateEquipSlot(elId, item) {
  const el = document.getElementById(elId);
  if (!el) return;
  const label = itemLabel(item);
  if (!item || !item.name) {
    el.innerHTML = '<span class="equip-text">-</span>';
    return;
  }
  const iconUrl = typeof getMinecraftItemIconUrl === 'function' ? getMinecraftItemIconUrl(item.name) : '';
  let imgHtml = '';
  if (iconUrl) {
    imgHtml = '<img class="equip-icon-img" src="' + escapeHtml(iconUrl) + '" alt="' + escapeHtml(label) + '" data-item-name="' + escapeHtml(item.name) + '" onerror="handleItemIconError(this, this.dataset.itemName)" loading="lazy">';
  }
  el.innerHTML = imgHtml + '<span class="equip-text">' + escapeHtml(label) + '</span>';
}

function renderDetailInventory(){
  const isOfflineBot = typeof isDetailBotOfflineOrStopped === 'function' ? isDetailBotOfflineOrStopped(detailBot) : false;
  if(!detailInventory && !isOfflineBot) return;
  const activeInv = isOfflineBot
    ? { slots: {}, armor: {}, offhand: null, totemCount: 0, goldenAppleCount: 0, foodCount: 0, selectedHotbar: -1, revision: detailInventory?.revision || 0 }
    : detailInventory;
  const dSlots = activeInv.slots || {};
  let usedCount = 0;
  for (let i = 9; i <= 44; i++) {
    if (dSlots[i] || dSlots[String(i)]) usedCount++;
  }
  const capPercent = Math.round((usedCount / 36) * 100);
  const capEl = document.getElementById('detailInventoryCapacity');
  if (capEl) {
    capEl.textContent = usedCount + '/36 ô (' + capPercent + '%)';
    capEl.className = 'capacity-badge' + (capPercent >= 90 ? ' danger' : capPercent >= 75 ? ' warning' : '');
  }
  const health=isOfflineBot ? 0 : Math.max(0,Math.min(20,Number(activeInv.health||0)));
  const food=isOfflineBot ? 0 : Math.max(0,Math.min(20,Number(activeInv.food||0)));
  document.getElementById('detailHealth').textContent=isOfflineBot ? '-- / 20' : (health.toFixed(1)+' / 20');
  document.getElementById('detailFood').textContent=isOfflineBot ? '-- / 20' : (String(food)+' / 20');
  document.getElementById('detailHealthBar').style.width=(isOfflineBot ? 0 : (health/20*100))+'%';
  document.getElementById('detailFoodBar').style.width=(isOfflineBot ? 0 : (food/20*100))+'%';
  document.getElementById('detailGolden').textContent=String(activeInv.goldenAppleCount||0);
  document.getElementById('detailTotem').textContent=String(activeInv.totemCount||0);
  const offSlotObj = activeInv.slots ? activeInv.slots['45'] : null;
  document.getElementById('detailOffhand').textContent = isOfflineBot
    ? '-'
    : (offSlotObj && offSlotObj.name ? itemLabel(offSlotObj) : (activeInv.offhand ? String(activeInv.offhand).replace(/_/g, ' ') : 'Trống'));
  document.getElementById('detailFoodCount').textContent = String(activeInv.foodCount || 0);
  document.getElementById('detailInventoryRevision').textContent = 'Đồng bộ túi đồ #' + String(activeInv.revision || 0) + (isOfflineBot ? ' • Bot đang tắt' : ' • Tự động cập nhật');
  const armor=activeInv.armor||{};
  updateEquipSlot('equipHead', armor.head);
  updateEquipSlot('equipTorso', armor.torso);
  updateEquipSlot('equipLegs', armor.legs);
  updateEquipSlot('equipFeet', armor.feet);
  const off=activeInv.slots?activeInv.slots['45']:null;
  updateEquipSlot('equipOffhand', off);

  const slots=activeInv.slots||{};
  const invBox=document.getElementById('detailInventory');invBox.innerHTML='';
  for(let slot=9;slot<=35;slot++) invBox.appendChild(createDetailSlot(slots[String(slot)]||null,slot,false));
  const hotBox=document.getElementById('detailHotbar');hotBox.innerHTML='';
  const selected=isOfflineBot ? -1 : Number(activeInv.selectedHotbar??activeInv.selectedSlot??0);
  for(let slot=36;slot<=44;slot++) hotBox.appendChild(createDetailSlot(slots[String(slot)]||null,slot,slot-36===selected));
  if (isOfflineBot && typeof cancelDetailSlotSelection === 'function') {
    cancelDetailSlotSelection();
  } else if (typeof updateDetailTouchHint === 'function') {
    updateDetailTouchHint();
  }
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
async function _moveDetailItemLocked(sourceSlot,destSlot){
  let result=await detailPost('/inventory/move',{sourceSlot,destSlot,revision:detailInventory.revision});
  if(!result.ok && (result.status === 409 || String(result.data?.error || '').includes('revision_mismatch'))){
    if(result.data?.inventory){
      detailInventory=result.data.inventory;
      renderDetailInventory();
    } else {
      await refreshDetail(true);
    }
    result=await detailPost('/inventory/move',{sourceSlot,destSlot,revision:detailInventory?.revision});
  }
  if(result.data?.inventory){detailInventory=result.data.inventory;renderDetailInventory();}
  if(!result.ok){showToast(result.data?.error||'Di chuyển thất bại.');await refreshDetail(true);return false;}
  showToast(result.data?.message||'Đã di chuyển item.');
  return true;
}
async function unequipAndMove(destination,slot){
  if(detailInventoryBusy||!detailInventory) return;
  detailInventoryBusy=true;
  try{
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
      await _moveDetailItemLocked(targetSlot, slot);
    } else if (!Number.isInteger(targetSlot)) {
      showToast('Đã tháo trang bị về rương đồ.');
    }
  } finally {detailInventoryBusy=false;}
}
async function moveDetailItem(sourceSlot,destSlot){
  if(detailInventoryBusy||!detailInventory) return;
  detailInventoryBusy=true;
  try{
    await _moveDetailItemLocked(sourceSlot,destSlot);
  } finally {detailInventoryBusy=false;}
}
async function dropDetailSlotDirect(sourceSlot) {
  const source = Number(sourceSlot);
  if (!Number.isInteger(source)) return;
  if (source >= 5 && source <= 8) { await unequipDetail(getEquipmentNameBySlot(source) || 'head'); return; }
  if (source === 45) { await unequipDetail('off-hand'); return; }
  if (detailInventoryBusy || !detailInventory) return;
  detailInventoryBusy = true;
  try {
    let result = await detailPost('/inventory/drop', { sourceSlot: source, revision: detailInventory.revision });
    if (!result.ok && (result.status === 409 || String(result.data?.error || '').includes('revision_mismatch'))) {
      if (result.data?.inventory) {
        detailInventory = result.data.inventory;
        renderDetailInventory();
      } else {
        await refreshDetail(true);
      }
      result = await detailPost('/inventory/drop', { sourceSlot: source, revision: detailInventory?.revision });
    }
    if (result.data?.inventory) { detailInventory = result.data.inventory; renderDetailInventory(); }
    showToast(result.data?.message || result.data?.error || 'Đã vứt item.');
    if (!result.ok) await refreshDetail(true);
  } finally { detailInventoryBusy = false; }
}
window.dropDetailSlotDirect = dropDetailSlotDirect;

async function dropDetailItemToWorld(event){
  event.preventDefault();clearDragOver(event);
  let source=detailDragged&&detailDragged.slot;
  try{const value=event.dataTransfer.getData('text/plain');if(value!=='') source=Number(value);}catch(_){}
  detailDragged=null;
  if(!Number.isInteger(source)) return;
  await dropDetailSlotDirect(source);
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
    let result=await detailPost('/inventory/equip',{sourceSlot,destination,revision:detailInventory.revision});
    if(!result.ok && (result.status === 409 || String(result.data?.error || '').includes('revision_mismatch'))){
      if(result.data?.inventory){
        detailInventory=result.data.inventory;
        renderDetailInventory();
      } else {
        await refreshDetail(true);
      }
      result=await detailPost('/inventory/equip',{sourceSlot,destination,revision:detailInventory?.revision});
    }
    if(result.data?.inventory){detailInventory=result.data.inventory;renderDetailInventory();}
    showToast(result.data?.message||result.data?.error||'Đã trang bị item.');
    if(!result.ok) await refreshDetail(true);
  } finally {detailInventoryBusy=false;}
}
async function unequipDetail(destination){
  if(detailInventoryBusy||!detailInventory)return;
  detailInventoryBusy=true;
  try{
    let result=await detailPost('/inventory/unequip',{destination,revision:detailInventory.revision});
    if(!result.ok && (result.status === 409 || String(result.data?.error || '').includes('revision_mismatch'))){
      if(result.data?.inventory){
        detailInventory=result.data.inventory;
        renderDetailInventory();
      } else {
        await refreshDetail(true);
      }
      result=await detailPost('/inventory/unequip',{destination,revision:detailInventory?.revision});
    }
    if(result.data?.inventory){detailInventory=result.data.inventory;renderDetailInventory();}
    showToast(result.data?.message||result.data?.error||'Đã tháo trang bị.');
    if(!result.ok) await refreshDetail(true);
  } finally {detailInventoryBusy=false;}
}
async function selectDetailHotbar(slot){
  if(detailInventoryBusy)return;
  detailInventoryBusy=true;
  try{
    const result=await detailPost('/inventory/select',{slot});
    if(result.data?.inventory){detailInventory=result.data.inventory;renderDetailInventory();}
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
  const un=document.getElementById('detailSettingUserNotifyEnabled');
  const nk=document.getElementById('detailSettingNotifyOnAfkKick');
  const nr=document.getElementById('detailSettingNotifyOnAfkRecover');
  const ne=document.getElementById('detailSettingNotifyOnReconnectExhausted');
  const sp=document.getElementById('detailSpawnCommands');

  if(eco&&!detailSettingsDirty)eco.checked=settings.ecoMode!==false;
  if(a&&!detailSettingsDirty)a.checked=settings.autoTotem!==false;
  if(h&&!detailSettingsDirty)h.checked=settings.antiHungry!==false;
  if(r&&!detailSettingsDirty)r.checked=settings.autoReconnect!==false;
  if(k&&!detailSettingsDirty)k.checked=settings.antiAfkKick!==false;
  if(un&&!detailSettingsDirty)un.checked=settings.userNotifyEnabled!==false;
  if(nk&&!detailSettingsDirty)nk.checked=settings.notifyOnAfkKick!==false;
  if(nr&&!detailSettingsDirty)nr.checked=settings.notifyOnAfkRecover!==false;
  if(ne&&!detailSettingsDirty)ne.checked=settings.notifyOnReconnectExhausted!==false;
  // BUG-24: Worker hỗ trợ spawnCommands nhưng trang Detail trước đây không có field →
  // renderer/save bỏ qua. Với user không đủ quyền, worker trả '********' (masked);
  // giữ nguyên khi lưu để không ghi đè cấu hình cũ.
  if(sp&&!detailSettingsDirty)sp.value=typeof settings.spawnCommands==='string'?settings.spawnCommands:'';
  if(typeof setDetailSettingsDisabled==='function'&&!detailSettingsSaveInFlight){
    setDetailSettingsDisabled(false);
  }
  if (typeof syncFormDirtyBadges === 'function') syncFormDirtyBadges();
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
function detailBotScheduleModeChanged(select){if(detailBotScheduleSaveInFlight)return;const current=collectDetailBotSchedules();const s=normalizeDetailBotScheduler(current.length?current:detailBotSchedules);const mode=select?.value==='cycle'?'cycle':'fixed';const items=s.items.map((item,i)=>mode==='fixed'?{id:item.id,action:item.action,time:detailDefaultFixedTime(i),...(item.action==='command'?{command:item.command}:{})}:{id:item.id,action:item.action,afterMinutes:i===0?120:300,...(item.action==='command'?{command:item.command}:{})});detailBotSchedules=[{id:s.id||String(Date.now()),enabled:!!document.getElementById('detailBotScheduleEnabled')?.checked,mode,items}];detailBotScheduleDirty=true;renderDetailBotSchedules(detailBotSchedules);}
function addDetailBotSchedule(){if(detailBotScheduleSaveInFlight)return;const current=collectDetailBotSchedules();const s=normalizeDetailBotScheduler(current.length?current:detailBotSchedules);const i=s.items.length;const item=s.mode==='fixed'?{id:Date.now()+'-'+Math.random().toString(36).slice(2,8),action:'stop',time:detailDefaultFixedTime(i)}:{id:Date.now()+'-'+Math.random().toString(36).slice(2,8),action:i%2===0?'stop':'start',afterMinutes:i===0?120:300};s.items.push(item);detailBotSchedules=[s];detailBotScheduleDirty=true;renderDetailBotSchedules(detailBotSchedules);}
function removeDetailBotSchedule(index){if(detailBotScheduleSaveInFlight)return;const s=normalizeDetailBotScheduler(collectDetailBotSchedules());s.items.splice(index,1);detailBotSchedules=s.items.length?[s]:[];detailBotScheduleDirty=true;renderDetailBotSchedules(detailBotSchedules);}
let draggedDetailBotScheduleIndex=null;
function dragDetailBotSchedule(event,index){draggedDetailBotScheduleIndex=index;event.dataTransfer.effectAllowed='move';event.dataTransfer.setData('text/plain',String(index));event.currentTarget.classList.add('dragging');}
function allowDetailBotScheduleDrop(event){event.preventDefault();event.dataTransfer.dropEffect='move';}
function dropDetailBotSchedule(event,targetIndex){event.preventDefault();const from=draggedDetailBotScheduleIndex;draggedDetailBotScheduleIndex=null;if(!Number.isInteger(from)||from===targetIndex)return;const s=normalizeDetailBotScheduler(collectDetailBotSchedules());const[moved]=s.items.splice(from,1);s.items.splice(targetIndex,0,moved);detailBotSchedules=[s];detailBotScheduleDirty=true;renderDetailBotSchedules(detailBotSchedules);}

async function saveDetailSettings(){
  if(detailSettingsSaveInFlight)return;
  invalidateDetailReads();
  const isRestricted=(typeof isDetailSettingsRestrictedUser==='function')
    ? isDetailSettingsRestrictedUser()
    : Boolean(typeof currentUser!=='undefined'&&currentUser&&currentUser.role!=='admin'&&currentUser.allowAccountChange===false);
  const spawnElement=document.getElementById('detailSpawnCommands');
  const spawnCommandsValue=spawnElement?String(spawnElement.value||''):'';
  if(!isRestricted&&spawnElement&&spawnCommandsValue.length>1000){
    showToast('Spawn Commands tối đa 1000 ký tự (hiện '+spawnCommandsValue.length+' ký tự).','error');
    spawnElement.focus();
    return;
  }
  const notifySettings={
    userNotifyEnabled:!!document.getElementById('detailSettingUserNotifyEnabled')?.checked,
    notifyOnAfkKick:!!document.getElementById('detailSettingNotifyOnAfkKick')?.checked,
    notifyOnAfkRecover:!!document.getElementById('detailSettingNotifyOnAfkRecover')?.checked,
    notifyOnReconnectExhausted:!!document.getElementById('detailSettingNotifyOnReconnectExhausted')?.checked
  };
  const body={settings:isRestricted?notifySettings:{
    ecoMode:!!document.getElementById('detailSettingEcoMode')?.checked,
    autoTotem:!!document.getElementById('detailSettingAutoTotem')?.checked,
    antiHungry:!!document.getElementById('detailSettingAntiHungry')?.checked,
    autoReconnect:!!document.getElementById('detailSettingAutoReconnect')?.checked,
    antiAfkKick:!!document.getElementById('detailSettingAntiAfkKick')?.checked,
    ...notifySettings,
    // Đồng bộ Spawn Commands từ trang Detail (backend giới hạn 1000 ký tự).
    // Giá trị '********' (masked) được worker phía sau hiểu là "giữ nguyên".
    ...(spawnElement?{spawnCommands:spawnCommandsValue}:{})
  }};
  detailSettingsSaveInFlight=true;setDetailSettingsDisabled(true);
  try{
    const result=await detailPost('/settings',body);
    showToast(result.data?.message||result.data?.error||'Đã xử lý.');
    if(result.ok){
      detailSettingsDirty=false;
      renderDetailSettings(result.data.settings||result.data);
      if (typeof syncFormDirtyBadges === 'function') syncFormDirtyBadges();
      if (typeof setDetailActionFeedback === 'function') {
        setDetailActionFeedback({ busy: false, tone: 'success', title: 'Đã lưu Cài đặt tự động', detail: 'Cấu hình bảo vệ mới đã được đồng bộ xuống Worker.' });
      }
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
      if (typeof syncFormDirtyBadges === 'function') syncFormDirtyBadges();
      if (typeof setDetailActionFeedback === 'function') {
        setDetailActionFeedback({ busy: false, tone: 'success', title: 'Đã lưu lịch Auto Chat', detail: 'Lịch gửi tin nhắn tự động đã được cập nhật.' });
      }
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
      if (typeof syncFormDirtyBadges === 'function') syncFormDirtyBadges();
      if (typeof setDetailActionFeedback === 'function') {
        setDetailActionFeedback({ busy: false, tone: 'success', title: 'Đã lưu Hẹn giờ bật/tắt Bot', detail: 'Lịch hoạt động mới đã kích hoạt.' });
      }
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
  const lockInfo = (typeof getWorkerLockInfo === 'function') ? getWorkerLockInfo() : { locked: false };
  if (lockInfo && lockInfo.locked) {
    const prefix = lockInfo.reason === 'maintenance' ? '🛠️ Hệ thống đang bảo trì: ' : '⚠️ ';
    if (typeof showToast === 'function') showToast(prefix + lockInfo.message, 'warning', 4500);
    return {
      ok: false,
      status: lockInfo.reason === 'maintenance' ? 503 : 403,
      data: {
        ok: false,
        code: lockInfo.reason === 'maintenance' ? 'SYSTEM_MAINTENANCE' : undefined,
        error: lockInfo.message
      }
    };
  }
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
  const lockInfo = (typeof getWorkerLockInfo === 'function') ? getWorkerLockInfo() : { locked: false };
  if (lockInfo && lockInfo.locked) {
    const prefix = lockInfo.reason === 'maintenance' ? '🛠️ Hệ thống đang bảo trì: ' : '⚠️ ';
    if (typeof showToast === 'function') showToast(prefix + lockInfo.message, 'warning', 4500);
    return;
  }
  if(detailLifecycleActionInFlight)return;
  invalidateDetailReads();
  detailLifecycleActionInFlight=true;
  const buttons=['detailStartButton','detailStopButton','detailRestartButton'];
  const activeBtn=document.getElementById(action==='start'?'detailStartButton':action==='stop'?'detailStopButton':'detailRestartButton');
  const prevBtnText=activeBtn?activeBtn.textContent:'';
  const prevDetailState = detailBot ? { status: detailBot.status, manuallyStopped: detailBot.manuallyStopped, available: detailBot.available } : null;
  const bIdx = bots.findIndex(function(b) { return String(b.workerId||b.id) === String(selectedBotId); });
  const prevBotState = bIdx !== -1 ? { status: bots[bIdx].status, manuallyStopped: bots[bIdx].manuallyStopped, available: bots[bIdx].available } : null;

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
        detailBot.currentWindow = null;
        detailInventory = { slots: {}, armor: {}, offhand: null, totemCount: 0, goldenAppleCount: 0, foodCount: 0, items: [], revision: 0 };
        renderDetailInventory();
      } else if (action === 'restart') {
        detailBot.manuallyStopped = false;
        detailBot.status = 'waking';
      }
      detailStatusHtml();
    }
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

    const actionLabel = action==='start' ? 'Chạy bot' : (action==='stop' ? 'Dừng bot' : 'Khởi động lại bot');
    if (typeof setDetailActionFeedback === 'function') {
      setDetailActionFeedback({ busy: true, tone: 'info', title: 'Đang thực hiện: ' + actionLabel + '...', detail: 'Đang gửi lệnh và chờ Worker đồng bộ trạng thái.' });
    }
    showToast(action==='start'?'Đang chạy bot...':action==='stop'?'Đang dừng bot...':'Đang khởi động lại bot...');
    const result=await detailPost('/'+encodeURIComponent(action),{});
    if (result.ok) {
      if (typeof setDetailActionFeedback === 'function') {
        setDetailActionFeedback({ busy: false, tone: 'success', title: 'Đã thực hiện: ' + actionLabel, detail: result.data?.message || 'Tiến trình trạng thái đang cập nhật trực tiếp.' });
      }
      showToast(result.data?.message||result.data?.error||'Đã xử lý thành công!', 'success');
      lastHomeSig = '';
      if (selectedBotId !== null) detailLastRevMap.delete(selectedBotId);
      await refreshDetail(true);
      setTimeout(function() { if (selectedBotId !== null) refreshDetail(true); }, 800);
      setTimeout(function() { if (selectedBotId !== null) refreshDetail(true); }, 2000);
    } else {
      if (detailBot && prevDetailState) Object.assign(detailBot, prevDetailState);
      if (bIdx !== -1 && prevBotState) Object.assign(bots[bIdx], prevBotState);
      if (typeof detailStatusHtml === 'function') detailStatusHtml();
      var err = result.data?.error || 'Không thể thực hiện thao tác.';
      if (typeof setDetailActionFeedback === 'function') {
        setDetailActionFeedback({ busy: false, tone: 'error', title: 'Không thể ' + actionLabel.toLowerCase(), detail: err });
      }
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
    if (detailBot && prevDetailState) Object.assign(detailBot, prevDetailState);
    if (bIdx !== -1 && prevBotState) Object.assign(bots[bIdx], prevBotState);
    if (typeof detailStatusHtml === 'function') detailStatusHtml();
    if (typeof setDetailActionFeedback === 'function') {
      setDetailActionFeedback({ busy: false, tone: 'error', title: 'Lỗi gửi lệnh điều khiển', detail: err.message || 'Không thể thực hiện thao tác.' });
    }
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
    if (typeof setDetailActionFeedback === 'function') {
      setDetailActionFeedback({ busy: true, tone: 'info', title: 'Đang bấm Slot 24 để vào Server...', detail: 'Cửa sổ Menu đã sẵn sàng.' });
    }
    showToast('Đang click Slot 24 vào server...');
    await clickDetailGuiSlot(24);
  } else {
    if (typeof setDetailActionFeedback === 'function') {
      setDetailActionFeedback({ busy: true, tone: 'info', title: 'Đang gửi lệnh /menu để vào Server...', detail: 'Bot sẽ tự chọn Slot 24 ngay khi cửa sổ Menu mở.' });
    }
    showToast('Đang gửi lệnh /menu để vào server...');
    try {
      const res = await detailPost('/send', { text: '/menu' });
      if (res.ok) {
        if (typeof setDetailActionFeedback === 'function') {
          setDetailActionFeedback({ busy: false, tone: 'success', title: 'Đã gửi lệnh /menu', detail: 'Bot sẽ tự click Slot 24 ngay khi menu mở.' });
        }
        showToast('Đã gửi /menu! Bot sẽ tự động click slot 24 ngay khi menu mở.', 'success');
        await refreshDetail(true);
      } else {
        if (typeof setDetailActionFeedback === 'function') {
          setDetailActionFeedback({ busy: false, tone: 'error', title: 'Không gửi được lệnh /menu', detail: res.data?.error || 'Lỗi không xác định.' });
        }
        showToast(res.data?.error || 'Không thể gửi /menu.', 'error');
      }
    } catch(e) {
      if (typeof setDetailActionFeedback === 'function') {
        setDetailActionFeedback({ busy: false, tone: 'error', title: 'Lỗi gửi /menu', detail: e.message || 'Lỗi mạng.' });
      }
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
    if (typeof setDetailActionFeedback === 'function') {
      setDetailActionFeedback({ busy: false, tone: 'warning', title: 'Không tìm thấy Totem trong rương đồ', detail: 'Hãy chuẩn bị Totem trong 36 ô túi đồ trước khi lắp tay phụ.' });
    }
    showToast('⚠️ Không tìm thấy Totem trong 36 ô rương đồ!', 'warning');
    return;
  }
  if (typeof setDetailActionFeedback === 'function') {
    setDetailActionFeedback({ busy: true, tone: 'info', title: 'Đang lắp Totem vào tay phụ...', detail: 'Từ ô số #' + totemSlot + ' sang ô Tay phụ.' });
  }
  showToast('Đang trang bị Totem vào tay phụ...');
  try {
    const res = await detailPost('/inventory/equip', {
      sourceSlot: totemSlot,
      destination: 'off-hand',
      revision: detailInventory.revision
    });
    if (res.ok) {
      if (typeof setDetailActionFeedback === 'function') {
        setDetailActionFeedback({ busy: false, tone: 'success', title: 'Đã lắp Totem vào tay phụ', detail: 'Bot đã được trang bị Totem dự phòng an toàn.' });
      }
      showToast('🛡️ Đã trang bị Totem vào tay phụ thành công!', 'success');
      await refreshDetail(true);
    } else {
      if (typeof setDetailActionFeedback === 'function') {
        setDetailActionFeedback({ busy: false, tone: 'error', title: 'Lỗi lắp Totem tay phụ', detail: res.data?.error || 'Không thể trang bị Totem.' });
      }
      showToast(res.data?.error || 'Lỗi trang bị Totem.', 'error');
    }
  } catch (e) {
    if (typeof setDetailActionFeedback === 'function') {
      setDetailActionFeedback({ busy: false, tone: 'error', title: 'Lỗi lắp Totem tay phụ', detail: e.message || 'Lỗi kết nối.' });
    }
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
  const lockInfo = (typeof getWorkerLockInfo === 'function') ? getWorkerLockInfo() : { locked: false };
  if (lockInfo && lockInfo.locked) {
    const prefix = lockInfo.reason === 'maintenance' ? '🛠️ Hệ thống đang bảo trì: ' : '⚠️ ';
    if (typeof showToast === 'function') showToast(prefix + lockInfo.message, 'warning', 4500);
    return;
  }
  btn.disabled = true;
  const oldText = btn.textContent;
  btn.textContent = '...';

  // Optimistic UI update in bots array and immediate re-render
  const targetBot = bots.find(function(b) { return String(b.workerId||b.id) === String(botId); });
  if (targetBot) {
    if (action === 'start') {
      targetBot.manuallyStopped = false;
      targetBot.status = 'waking';
      targetBot.available = true;
    } else if (action === 'stop') {
      targetBot.manuallyStopped = true;
      targetBot.status = 'offline';
      targetBot.currentWindow = null;
      targetBot.totemCount = 0;
      targetBot.goldenAppleCount = 0;
      if (String(selectedBotId) === String(botId)) {
        detailInventory = { slots: {}, armor: {}, offhand: null, totemCount: 0, goldenAppleCount: 0, foodCount: 0, items: [], revision: 0 };
        if (detailBot) {
          detailBot.status = 'offline';
          detailBot.manuallyStopped = true;
          detailBot.currentWindow = null;
        }
        renderDetailInventory();
        if (typeof detailStatusHtml === 'function') detailStatusHtml();
      }
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

async function copyToClipboard(text, label, triggerEl) {
  text = String(text || '').trim();
  if (!text || text === '-' || text === '--') return;
  const targetEl = (triggerEl && typeof triggerEl.setAttribute === 'function')
    ? triggerEl
    : (typeof document !== 'undefined' && document.activeElement && (document.activeElement.classList?.contains('copyable') || document.activeElement.tagName === 'BUTTON') ? document.activeElement : null);
  const markCopiedVisual = () => {
    if (targetEl && typeof targetEl.setAttribute === 'function') {
      if (targetEl._copyResetTimer) clearTimeout(targetEl._copyResetTimer);
      targetEl.setAttribute('data-copied', 'true');
      targetEl._copyResetTimer = setTimeout(() => {
        try { targetEl.removeAttribute('data-copied'); } catch (_) {}
      }, 1800);
    }
    if (typeof announceGlobalStatus === 'function') {
      announceGlobalStatus('Đã sao chép ' + (label || 'nội dung') + '.');
    }
  };
  try {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      await navigator.clipboard.writeText(text);
    } else {
      throw new Error('Clipboard API not supported');
    }
    markCopiedVisual();
    showToast('Đã sao chép ' + (label || 'nội dung') + ': ' + text, 'success');
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
      markCopiedVisual();
      showToast('Đã sao chép ' + (label || 'nội dung') + ': ' + text, 'success');
    } catch (e) {
      showToast('Không thể sao chép tự động: ' + text);
    }
    document.body.removeChild(ta);
  }
}
window.copyToClipboard = copyToClipboard;

let detailChatSendInFlight = false;
async function sendDetailMessage(event){
  event.preventDefault();
  if(detailChatSendInFlight)return;
  const input=document.getElementById('detailMessageInput');
  const sendBtn=document.getElementById('detailSendButton')||document.querySelector('#detailChatForm button[type="submit"], .chat-form button[type="submit"]')||event?.currentTarget?.querySelector?.('button[type="submit"]');
  const text=String(input?.value||'');
  if(!text.trim()){showToast('Nội dung không được trống.');return;}
  if (!detailCommandHistory.length || detailCommandHistory[detailCommandHistory.length - 1] !== text.trim()) {
    detailCommandHistory.push(text.trim());
    if (detailCommandHistory.length > 50) detailCommandHistory.shift();
  }
  detailCommandHistoryIndex = -1;
  detailChatSendInFlight = true;
  if (sendBtn) sendBtn.disabled = true;
  try{
    const result=await detailPost('/send',{text});
    showToast(result.data?.message||result.data?.error||'Đã xử lý.');
    if(result.ok){input.value='';await loadDetailChat(true);}
  }catch(err){showToast(err.message||'Không thể gửi chat.');}
  finally{
    detailChatSendInFlight = false;
    if (sendBtn) sendBtn.disabled = false;
  }
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
      if(userInput){ userInput.removeAttribute('data-dirty'); userInput.value=''; }
      if(passInput){ passInput.removeAttribute('data-dirty'); passInput.value=''; }
      if (typeof syncFormDirtyBadges === 'function') syncFormDirtyBadges();
      if (typeof setDetailActionFeedback === 'function') {
        setDetailActionFeedback({ busy: false, tone: 'success', title: 'Đã lưu tài khoản Minecraft', detail: 'Tài khoản mới đã được lưu. Bạn có thể bấm "Chạy lại" để vào game bằng tài khoản vừa đổi.' });
      }
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
    if (typeof setDetailActionFeedback === 'function') {
      setDetailActionFeedback({ busy: true, tone: 'info', title: 'Đang lưu tài khoản & khởi động lại bot...', detail: 'Bước 1/2: Cập nhật thông tin đăng nhập Minecraft xuống Worker.' });
    }
    const result=await detailPost('/account',{username,password});
    if(!result.ok){
      if (typeof setDetailActionFeedback === 'function') {
        setDetailActionFeedback({ busy: false, tone: 'error', title: 'Không thể lưu tài khoản Minecraft', detail: result.data?.error || 'Lỗi cập nhật tài khoản.' });
      }
      showToast(result.data?.error||'Không thể cập nhật tài khoản.');
      return;
    }
    showToast('Đã lưu tài khoản. Đang khởi động lại bot...');
    if(userInput){ userInput.removeAttribute('data-dirty'); userInput.value=''; }
    if(passInput){ passInput.removeAttribute('data-dirty'); passInput.value=''; }
    if (typeof syncFormDirtyBadges === 'function') syncFormDirtyBadges();
    if (typeof setDetailActionFeedback === 'function') {
      setDetailActionFeedback({ busy: true, tone: 'info', title: 'Đang khởi động lại bot...', detail: 'Bước 2/2: Bot đang kết nối lại với tài khoản mới.' });
    }
    const restartRes=await detailPost('/restart',{});
    showToast(restartRes.data?.message||restartRes.data?.error||'Đã gửi lệnh chạy lại bot.');
    if (restartRes.ok && typeof setDetailActionFeedback === 'function') {
      setDetailActionFeedback({ busy: false, tone: 'success', title: 'Đã lưu tài khoản & khởi động lại', detail: 'Theo dõi 4 bước kết nối bên dưới để xem bot đăng nhập và vào AFK.' });
    }
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

  if (!proxy || typeof proxy !== 'object') return;
  const p = proxy;
  if (badge && p.enabled !== undefined) {
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

  // Only overwrite host/port/username/password inputs when a full proxy object is provided (not the {enabled} stub from /snapshot)
  if (p.host === undefined) return;

  if (enabledInput && document.activeElement !== enabledInput) enabledInput.checked = !!p.enabled;
  if (protocolInput && document.activeElement !== protocolInput) protocolInput.value = p.protocol || 'socks5';
  if (hostInput && document.activeElement !== hostInput) hostInput.value = p.host || '';
  if (portInput && document.activeElement !== portInput) portInput.value = p.port || '';
  if (usernameInput && document.activeElement !== usernameInput) usernameInput.value = p.username || '';
  if (passwordInput && document.activeElement !== passwordInput) {
    passwordInput.value = p.password || '';
    passwordInput.placeholder = p.hasPassword
      ? '•••••••• (Đã lưu - để trống để giữ nguyên)'
      : 'Mật khẩu proxy...';
  }
}

// SEC-06/BUG-17: snapshot công khai chỉ chứa proxy { enabled }. Admin phải tải chi
// tiết đầy đủ (host/port/username + mật khẩu masked) từ GET /settings 1 lần khi mở bot (BW-02).
// Non-admin gọi hàm này là no-op (proxy đã bị Manager strip khỏi session data).
let _loadedAdminSettingsBotId = null;
async function loadFullSettingsForAdmin(force = false) {
  if (currentUser?.role !== 'admin' || selectedBotId === null) return;
  const targetId = String(selectedBotId);
  if (!force && _loadedAdminSettingsBotId === targetId) return;
  _loadedAdminSettingsBotId = targetId;
  try {
    const data = await detailGet('/settings');
    if (String(selectedBotId) !== targetId) return;
    const settings = data?.settings || data || {};
    if (settings.proxy) renderDetailProxy(settings.proxy);
    const sp = document.getElementById('detailSpawnCommands');
    if (sp && !detailSettingsDirty && typeof settings.spawnCommands === 'string') sp.value = settings.spawnCommands;
  } catch (_) {
    if (_loadedAdminSettingsBotId === targetId) _loadedAdminSettingsBotId = null;
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
      _loadedAdminSettingsBotId = null;
      if (selectedBotId !== null) detailLastRevMap.delete(selectedBotId);
      await refreshDetail(true);
      await loadFullSettingsForAdmin(true);
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

