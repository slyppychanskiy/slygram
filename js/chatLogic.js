let activeChatWith = null;
let activeCollectionRef = null;
let unsubMessages = null;
let unsubChatMeta = null;
let unsubOtherUserStatus = null;
let headerStatusInterval = null;
let currentPinnedMap = {};
let currentPinnedIds = [];
let pinnedViewIndex = 0;
let pendingImage = null;
let lightboxGallery = [];
let lightboxIndex = 0;
let editingMsgId = null;

// Кнопка справа от поля ввода "морфит" между микрофоном и отправкой —
// микрофон, пока поле пустое и нет вложения/редактирования, иначе отправка.
function updateSendMicToggle() {
  const input = document.getElementById('msgInput');
  const sendBtn = document.getElementById('sendBtn');
  const voiceBtn = document.getElementById('voiceBtn');
  if (!input || !sendBtn || !voiceBtn) return;
  const hasContent = !!(input.value.trim() || pendingImage || editingMsgId);
  sendBtn.classList.toggle('morphShow', hasContent);
  voiceBtn.classList.toggle('morphHide', hasContent);
}
let replyingToMsg = null;
let chatEmojiDocumentClickHandler = null;
let messageElements = new Map();
let unreadWhileScrolledUp = 0;
let hasRenderedInitial = false;

let mediaRecorder = null;
let audioChunks = [];
let isRecording = false;

function renderStickerPanel() {
  const stickerGrid = document.getElementById('stickerGrid');
  const stickerPanelEmpty = document.getElementById('stickerPanelEmpty');
  if (!stickerGrid || !stickerPanelEmpty) return;
  stickerGrid.innerHTML = '';
  if (!myStickers || myStickers.length === 0) {
    stickerPanelEmpty.style.display = 'flex';
    return;
  }
  stickerPanelEmpty.style.display = 'none';
  myStickers.forEach(stickerUrl => {
    const img = document.createElement('img');
    img.src = stickerUrl;
    img.className = 'stickerThumb';
    img.title = 'Отправить стикер';
    img.onclick = async (e) => {
      e.stopPropagation();
      await sendSticker(stickerUrl);
      const expressionPanel = document.getElementById('expressionPanel');
      if (expressionPanel) expressionPanel.classList.remove('show');
    };
    stickerGrid.appendChild(img);
  });
}

async function addStickerToLibrary(stickerUrl) {
  if (!stickerUrl || !currentUser) return;
  if (myStickers.includes(stickerUrl)) return;
  myStickers.unshift(stickerUrl);
  if (myStickers.length > 100) myStickers.length = 100;
  await db.collection('users').doc(currentUser.uid).update({ stickers: myStickers });
  renderStickerPanel();
}

async function sendSticker(stickerUrl) {
  if (!stickerUrl || !currentUser || !activeCollectionRef) return;
  const payload = {
    senderId: currentUser.uid,
    from: currentUser.uid,
    createdAt: firebase.firestore.FieldValue.serverTimestamp(),
    read: false,
    sticker: stickerUrl
  };
  if (activeChatWith && !activeChatWith.isGroup) {
    payload.to = activeChatWith.uid;
  }
  await activeCollectionRef.add(payload);
}
/* ---------------- VISUAL VIEWPORT (КЛАВИАТУРА) ---------------- */
if (window.visualViewport) {
  window.visualViewport.addEventListener('resize', adjustInputPosition);
  window.visualViewport.addEventListener('scroll', adjustInputPosition);
}

let vvRaf = null;
function adjustInputPosition() {
  if (vvRaf) cancelAnimationFrame(vvRaf);
  vvRaf = requestAnimationFrame(() => {
    const app = document.getElementById('app');
    const viewport = window.visualViewport;
    if (!app || !viewport) return;

    app.style.height = viewport.height + 'px';
    window.scrollTo(0, 0);

    const box = document.getElementById('messages');
    if (box) box.scrollTop = box.scrollHeight;
  });
}

function chatIdFor(uidA, uidB){ return [uidA, uidB].sort().join('_'); }

async function openChat(friend){
  if (activeChatWith && activeChatWith.uid === friend.uid && document.body.classList.contains('chatOpen')) {
    return;
  }
  activeChatWith = friend;
  window.activeChatWith = friend;
  const cid = chatIdFor(currentUser.uid, friend.uid);

  // Сообщения открываем сразу — они читаются из локального кэша Firestore
  // мгновенно, не дожидаясь сети. А запись participants в документ чата
  // не блокирует открытие — это фоновая синхронизация, а не условие показа сообщений.
  setupChatLayout(friend.username, false, friend);

  db.collection('chats').doc(cid).set({
    participants: [currentUser.uid, friend.uid]
  }, { merge: true }).catch(() => {});
}

function openGroupChat(group){
  if (activeChatWith && activeChatWith.id === group.id && document.body.classList.contains('chatOpen')) {
    return;
  }
  activeChatWith = group;
  window.activeChatWith = group;
  setupChatLayout(group.name, true, group);
}

/* ---------------- ПЕРЕСЫЛКА СООБЩЕНИЙ ---------------- */
let forwardingMsg = null;

function openForwardPicker(msgData) {
  forwardingMsg = msgData;
  const modal = document.getElementById('forwardModal');
  const list = document.getElementById('forwardList');
  if (!modal || !list) return;
  list.innerHTML = '';

  const makeRow = (name, avatarHtml, onClick) => {
    const row = document.createElement('div');
    row.className = 'forwardItem';
    row.innerHTML = `${avatarHtml}<div class="fwdName">${name}</div>`;
    row.onclick = onClick;
    list.appendChild(row);
  };

  (myFriends || []).forEach(f => {
    const avWrap = document.createElement('span');
    avWrap.style.display = 'contents';
    const avContainer = document.createElement('div');
    avContainer.className = 'avatar';
    renderAvatar(avContainer, f.username, f.color, f.photo);
    const row = document.createElement('div');
    row.className = 'forwardItem';
    row.appendChild(avContainer);
    const nameEl = document.createElement('div');
    nameEl.className = 'fwdName';
    nameEl.textContent = '@' + f.username;
    row.appendChild(nameEl);
    row.onclick = () => forwardTo(f, false);
    list.appendChild(row);
  });

  (myGroups || []).forEach(g => {
    const row = document.createElement('div');
    row.className = 'forwardItem';
    const avContainer = document.createElement('div');
    avContainer.className = 'avatar';
    renderGroupAvatar(avContainer, g, 18);
    row.appendChild(avContainer);
    const nameEl = document.createElement('div');
    nameEl.className = 'fwdName';
    nameEl.textContent = g.name;
    row.appendChild(nameEl);
    row.onclick = () => forwardTo(g, true);
    list.appendChild(row);
  });

  if (list.children.length === 0) {
    list.innerHTML = '<div class="empty">Нет чатов для пересылки</div>';
  }
  svgifyEmoji(list);
  modal.classList.add('show');
}

async function forwardTo(target, isGrp) {
  if (!forwardingMsg || !currentUser) return;
  try {
    const cid = isGrp ? target.id : chatIdFor(currentUser.uid, target.uid);
    const colRef = isGrp ? db.collection('groups').doc(cid).collection('messages') : db.collection('chats').doc(cid).collection('messages');
    if (!isGrp) {
      await db.collection('chats').doc(cid).set({ participants: [currentUser.uid, target.uid] }, { merge: true });
    }
    const payload = {
      senderId: currentUser.uid,
      from: currentUser.uid,
      createdAt: firebase.firestore.FieldValue.serverTimestamp(),
      read: false,
      forwarded: true
    };
    if (!isGrp) payload.to = target.uid;
    if (forwardingMsg.text) payload.text = forwardingMsg.text;
    if (forwardingMsg.image) payload.image = forwardingMsg.image;
    if (forwardingMsg.sticker) payload.sticker = forwardingMsg.sticker;
    if (forwardingMsg.audio) payload.audio = forwardingMsg.audio;
    await colRef.add(payload);
  } catch (err) {
    alert('Не удалось переслать сообщение: ' + err.message);
  } finally {
    forwardingMsg = null;
    const modal = document.getElementById('forwardModal');
    if (modal) modal.classList.remove('show');
  }
}

const forwardCloseBtnEl = document.getElementById('forwardCloseBtn');
if (forwardCloseBtnEl) {
  forwardCloseBtnEl.onclick = () => {
    document.getElementById('forwardModal').classList.remove('show');
    forwardingMsg = null;
  };
}
const forwardModalEl = document.getElementById('forwardModal');
if (forwardModalEl) {
  forwardModalEl.onclick = (e) => {
    if (e.target.id === 'forwardModal') {
      forwardModalEl.classList.remove('show');
      forwardingMsg = null;
    }
  };
}

/* ---------------- РАСПОЗНАВАНИЕ И ОБРАБОТКА УПОМИНАНИЙ (@username) ---------------- */
function formatMessageTextWithMentions(text) {
  if (!text) return '';
  const escaped = escapeHtml(text);
  return escaped.replace(/@([a-z0-9_]{3,20})/gi, (match, username) => {
    return `<span class="mentionTag" data-mention="${username.toLowerCase()}" style="color: var(--wire); font-weight: bold; cursor: pointer; text-decoration: underline;">${match}</span>`;
  });
}

function setupChatLayout(titleText, isGroup = false, targetObj = null) {
  pendingImage = null;
  editingMsgId = null;
  editingMsgId = null;
  replyingToMsg = null;
  document.body.classList.add('chatOpen');
  renderList();

  const chatArea = document.getElementById('chatArea');
  const cid = isGroup ? targetObj.id : chatIdFor(currentUser.uid, targetObj.uid);
  const collectionRef = isGroup ? db.collection('groups').doc(cid).collection('messages') : db.collection('chats').doc(cid).collection('messages');
  activeCollectionRef = collectionRef;
  activeChatWith = targetObj;

  const isChannelAdmin = isGroup && (targetObj.admins || []).includes(currentUser.uid);
  const canWrite = !isGroup || targetObj.type !== 'channel' || targetObj.owner === currentUser.uid || isChannelAdmin;

  if (unsubMessages) {
    unsubMessages();
    unsubMessages = null;
  }
  messageElements.clear();
  unreadWhileScrolledUp = 0;
  hasRenderedInitial = false;

  chatArea.innerHTML = `
    <div id="chatTopBar">
      <div id="chatHeader">
        <div class="hdrMain">
          <button id="backBtn">${icon('back', 18)}</button>
          <div class="avatar" id="hdrAvatar"></div>
          <div class="hdrText">
            <div>${isGroup ? escapeHtml(titleText) : '@' + escapeHtml(titleText) + badgeHtmlFor(targetObj)}</div>
            <div class="sub" id="typingIndicator"></div>
          </div>
        </div>
        <div>
          <button id="muteChatBtn" class="iconBtn chatHeaderIconBtn" title="Без звука"></button>
          <button id="searchMsgToggleBtn" class="iconBtn chatHeaderIconBtn" title="Поиск в чате">${icon('search', 16)}</button>
        </div>
      </div>
      <div id="chatSearchPanel">
        <input id="chatSearchInput" placeholder="Поиск в чате...">
        <button id="chatSearchClose" class="smallBtn">${icon('close', 14)}</button>
      </div>
      <div id="pinnedBar">
        <div class="pinTicks" id="pinTicks"></div>
        <div class="pinIconWrap">${icon('pin', 15)}</div>
        <div class="pinTextWrap" id="pinnedContent">
          <div class="pinCount" id="pinCount"></div>
          <div class="pinText" id="pinnedText">Закрепленное сообщение</div>
        </div>
        <button id="unpinBtn" title="Открепить">${icon('close', 14)}</button>
      </div>
    </div>
    <div id="messages">
      <button id="scrollDownBtn" title="К новым сообщениям">
        <span class="scrollDownIcon">${icon('arrowDown', 18)}</span>
        <span class="unreadDot" id="scrollDownUnread"></span>
      </button>
    </div>
    <div id="replyBar">
      <span id="replyTextPreview">Ответ на сообщение...</span>
      <button id="replyCancelBtn" style="border:1px solid var(--ink); background:var(--paper); cursor:pointer;">${icon('close', 14)}</button>
    </div>
    <div id="imgPreviewBar"><img id="imgPreviewThumb"><span>Картинка готова</span><button id="imgCancelBtn">Убрать</button></div>
    ${canWrite ? `
    <div id="inputBar">
      <button class="iconBtn" id="attachBtn" title="Фото">${icon('paperclip', 19)}</button>
      <div class="expressionWrapper">
        <button class="iconBtn" id="chatEmojiBtn" title="Эмодзи и стикеры">${icon('smile', 19)}</button>
        <div id="expressionPanel" class="expressionPanel">
          <div class="expressionTabs">
            <div class="expressionTab active" data-pane="emojiPane">Эмодзи</div>
            <div class="expressionTab" data-pane="stickerPane">Стикеры</div>
          </div>
          <div id="emojiPane" class="expressionPane active">
            <div id="chatEmojiPickerPanel" style="position:static; transform:none; opacity:1; box-shadow:none; border:none; padding:0; background:transparent; filter:none;">
              <span>😀</span><span>😂</span><span>😍</span><span>🔥</span><span>👍</span><span>❤️</span>
              <span>😎</span><span>🎉</span><span>💩</span><span>✨</span><span>🚀</span><span>🤔</span>
              <span>👀</span><span>👏</span><span>💪</span><span>🥳</span><span>💯</span><span>🙏</span>
            </div>
          </div>
          <div class="expressionPane" id="stickerPane">
            <div class="stickerPanelHeader">
              <button id="uploadStickerBtn" class="smallBtn stickerAddBtn" title="Загрузить стикер">${icon('plus', 13)}</button>
              <span>Мои стикеры</span>
            </div>
            <div id="stickerGrid" class="stickerGrid"></div>
            <div id="stickerPanelEmpty" class="stickerPanelEmpty">У вас ещё нет стикеров</div>
          </div>
        </div>
      </div>
      <input id="msgInput" type="text" placeholder="Сообщение...">
      <div class="sendMicSlot">
        <button class="iconBtn" id="voiceBtn" title="Голосовое сообщение">${icon('mic', 19)}</button>
        <button id="sendBtn">${icon('send', 18)}</button>
      </div>
    </div>` : `<div style="padding:15px; text-align:center; color:var(--muted); background:var(--paper2); border-top:2px solid var(--ink); font-size:12px;">Только администратор может отправлять сообщения в этот канал.</div>`}
  `;

  const pinnedBar = document.getElementById('pinnedBar');
  const pinnedContent = document.getElementById('pinnedContent');
  const pinnedTextEl = document.getElementById('pinnedText');
  const pinCountEl = document.getElementById('pinCount');
  const pinTicksEl = document.getElementById('pinTicks');
  const unpinBtn = document.getElementById('unpinBtn');
  const messagesBox = document.getElementById('messages');
  const scrollDownBtn = document.getElementById('scrollDownBtn');
  const scrollDownUnread = document.getElementById('scrollDownUnread');
  const uploadStickerBtn = document.getElementById('uploadStickerBtn');
  const stickerFileInput = document.getElementById('stickerFileInput');
  const chatEmojiPickerPanel = document.getElementById('chatEmojiPickerPanel');
  const expressionPanel = document.getElementById('expressionPanel');
  const metaDocRef = isGroup ? db.collection('groups').doc(cid) : db.collection('chats').doc(cid);

  currentPinnedMap = {};
  currentPinnedIds = [];
  pinnedViewIndex = 0;

  const jumpToPinned = async (pinnedMsg) => {
    const targetId = pinnedMsg.id;
    let targetEl = document.getElementById('msg_' + targetId);
    if (!targetEl) {
      try {
        const targetDocSnap = await collectionRef.doc(targetId).get();
        if (targetDocSnap.exists) {
          const targetCreatedAt = targetDocSnap.data().createdAt;
          const earliestDoc = historyMsgDocs[0] || liveMsgDocs[0];
          if (targetCreatedAt) {
            const query = earliestDoc
              ? collectionRef.orderBy('createdAt').startAt(targetCreatedAt).endBefore(earliestDoc.data().createdAt)
              : collectionRef.orderBy('createdAt').startAt(targetCreatedAt);
            const gapSnap = await query.get();
            const gapDocs = gapSnap.docs.some(d => d.id === targetId) ? gapSnap.docs : [targetDocSnap, ...gapSnap.docs];
            historyMsgDocs = gapDocs.concat(historyMsgDocs);
            rebuildMergedDocs();
            renderMessages(latestMsgDocs, currentMsgFilter);
            targetEl = document.getElementById('msg_' + targetId);
          }
        }
      } catch (err) {
        console.error('Не удалось загрузить закреплённое сообщение', err);
      }
    }
    if (targetEl) {
      targetEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
      targetEl.classList.add('highlight');
      setTimeout(() => targetEl.classList.remove('highlight'), 900);
    }
  };

  const renderPinnedDots = () => {
    if (!pinTicksEl) return;
    pinTicksEl.innerHTML = '';
    if (currentPinnedIds.length <= 1) return;
    currentPinnedIds.forEach((_, i) => {
      const dot = document.createElement('span');
      dot.className = 'pinDot' + (i === pinnedViewIndex ? ' active' : '');
      pinTicksEl.appendChild(dot);
    });
  };

  // Показывает закреплённое сообщение по индексу. Поддерживает сразу
  // несколько закреплённых сообщений — тап по плашке листает их по кругу.
  const showPinnedAt = (index) => {
    if (!pinnedBar || !pinnedTextEl) return;
    const n = currentPinnedIds.length;
    if (n === 0) {
      pinnedBar.classList.remove('show');
      pinnedTextEl.textContent = 'Закрепленное сообщение';
      pinCountEl.textContent = '';
      renderPinnedDots();
      return;
    }
    pinnedViewIndex = ((index % n) + n) % n;
    const pinnedMsg = currentPinnedMap[currentPinnedIds[pinnedViewIndex]];
    pinnedBar.classList.add('show');
    let preview = '';
    if (pinnedMsg.text) preview = pinnedMsg.text.length > 80 ? pinnedMsg.text.slice(0, 80) + '…' : pinnedMsg.text;
    else if (pinnedMsg.image) preview = 'Фото';
    else if (pinnedMsg.sticker) preview = 'Стикер';
    else if (pinnedMsg.audio) preview = 'Голосовое сообщение';
    else preview = 'Медиа';
    pinnedTextEl.textContent = preview;
    pinCountEl.textContent = n > 1 ? `Закреплено ${pinnedViewIndex + 1} из ${n}` : 'Закреплённое сообщение';
    renderPinnedDots();
    if (pinnedContent) {
      pinnedContent.title = n > 1 ? 'Нажмите, чтобы посмотреть следующее закреплённое' : 'Нажмите, чтобы перейти к сообщению';
      pinnedContent.onclick = () => {
        jumpToPinned(pinnedMsg);
        if (n > 1) setTimeout(() => showPinnedAt(pinnedViewIndex + 1), 260);
      };
    }
  };

  const applyPinnedMap = (map) => {
    currentPinnedMap = map || {};
    currentPinnedIds = Object.keys(currentPinnedMap).sort((a, b) => {
      const ta = currentPinnedMap[a]?.pinnedAt?.toMillis ? currentPinnedMap[a].pinnedAt.toMillis() : 0;
      const tb = currentPinnedMap[b]?.pinnedAt?.toMillis ? currentPinnedMap[b].pinnedAt.toMillis() : 0;
      return ta - tb;
    });
    if (pinnedViewIndex >= currentPinnedIds.length) pinnedViewIndex = 0;
    showPinnedAt(pinnedViewIndex);
    refreshPinButtonStates();
  };

  if (pinnedBar) pinnedBar.classList.remove('show');
  if (unsubChatMeta) {
    unsubChatMeta();
    unsubChatMeta = null;
  }
  const typingIndicatorEl = document.getElementById('typingIndicator');
  let typingHideTimer = null;
  let isCurrentlyTyping = false;
  let latestOtherUserData = null;

  function renderHeaderStatus() {
    if (!typingIndicatorEl || isGroup) return;
    if (isCurrentlyTyping) {
      typingIndicatorEl.className = 'sub typing';
      typingIndicatorEl.innerHTML = 'печатает <span class="typingDots"><span></span><span></span><span></span></span>';
      return;
    }
    if (!latestOtherUserData) { typingIndicatorEl.className = 'sub'; typingIndicatorEl.innerHTML = ''; return; }
    const online = !latestOtherUserData.hideOnline && latestOtherUserData.lastOnline && (Date.now() - latestOtherUserData.lastOnline.toMillis() < 45000);
    if (online) {
      typingIndicatorEl.className = 'sub online';
      typingIndicatorEl.innerHTML = 'в сети';
    } else if (latestOtherUserData.hideOnline) {
      typingIndicatorEl.className = 'sub';
      typingIndicatorEl.innerHTML = '';
    } else {
      typingIndicatorEl.className = 'sub';
      const txt = formatLastOnline(latestOtherUserData.lastOnline);
      typingIndicatorEl.textContent = txt.charAt(0).toUpperCase() + txt.slice(1);
    }
  }

  if (unsubOtherUserStatus) { unsubOtherUserStatus(); unsubOtherUserStatus = null; }
  if (headerStatusInterval) { clearInterval(headerStatusInterval); headerStatusInterval = null; }
  if (!isGroup) {
    unsubOtherUserStatus = db.collection('users').doc(targetObj.uid).onSnapshot(snap => {
      latestOtherUserData = snap.exists ? snap.data() : null;
      renderHeaderStatus();
    });
    // «Был(а) в сети N минут назад» — переформатируем раз в 30с, чтобы не протухало.
    headerStatusInterval = setInterval(renderHeaderStatus, 30000);
  }

  unsubChatMeta = metaDocRef.onSnapshot(doc => {
    if (!doc.exists) { applyPinnedMap({}); return; }
    const data = doc.data();
    // Обратная совместимость со старым форматом одного закреплённого сообщения
    const map = data?.pinnedMsgs || (data?.pinnedMsg ? { [data.pinnedMsg.id]: data.pinnedMsg } : {});
    applyPinnedMap(map);

    if (!isGroup) {
      if (typingHideTimer) { clearTimeout(typingHideTimer); typingHideTimer = null; }
      const typing = data?.typing || {};
      const otherTs = typing[targetObj.uid];
      const ageMs = otherTs && otherTs.toMillis ? Date.now() - otherTs.toMillis() : Infinity;
      isCurrentlyTyping = ageMs < 4000;
      renderHeaderStatus();
      if (isCurrentlyTyping) {
        typingHideTimer = setTimeout(() => { isCurrentlyTyping = false; renderHeaderStatus(); }, 4000 - ageMs);
      }
    }
  });

  if (unpinBtn) {
    unpinBtn.onclick = async () => {
      if (!metaDocRef || currentPinnedIds.length === 0) return;
      const idToUnpin = currentPinnedIds[pinnedViewIndex];
      try {
        await metaDocRef.update({ [`pinnedMsgs.${idToUnpin}`]: firebase.firestore.FieldValue.delete() });
      } catch (err) {
        console.error('Unpin failed', err);
      }
    };
  }

  function refreshScrollDownBtn() {
    if (!messagesBox || !scrollDownBtn) return;
    const nearBottom = messagesBox.scrollHeight - messagesBox.scrollTop - messagesBox.clientHeight < 80;
    if (nearBottom) {
      scrollDownBtn.classList.remove('show');
    } else {
      scrollDownBtn.classList.add('show');
    }
  }

  let latestMsgDocs = [];
  let currentMsgFilter = '';

  // ---- Пагинация: при входе в чат грузим не всю историю, а только последние сообщения ----
  const MSG_PAGE_SIZE = 20;
  let liveMsgDocs = [];      // «живое» окно последних сообщений — обновляется через onSnapshot
  let historyMsgDocs = [];   // более старая история — догружается вручную при скролле вверх
  let allHistoryLoaded = false;
  let isLoadingOlderMessages = false;

  function rebuildMergedDocs() {
    latestMsgDocs = historyMsgDocs.concat(liveMsgDocs);
  }

  function toggleOlderLoadingIndicator(show) {
    if (!messagesBox) return;
    let indicator = messagesBox.querySelector('.olderLoadingIndicator');
    if (show) {
      if (!indicator) {
        indicator = document.createElement('div');
        indicator.className = 'olderLoadingIndicator';
        indicator.textContent = 'Загрузка…';
        messagesBox.insertBefore(indicator, messagesBox.firstChild);
      }
    } else if (indicator) {
      indicator.remove();
    }
  }

  async function loadOlderMessages() {
    if (isLoadingOlderMessages || allHistoryLoaded) return;
    const earliestDoc = historyMsgDocs[0] || liveMsgDocs[0];
    if (!earliestDoc) return;
    isLoadingOlderMessages = true;
    toggleOlderLoadingIndicator(true);
    try {
      const snap = await collectionRef.orderBy('createdAt').endBefore(earliestDoc.data().createdAt).limitToLast(MSG_PAGE_SIZE).get();
      if (snap.empty) {
        allHistoryLoaded = true;
      } else {
        historyMsgDocs = snap.docs.concat(historyMsgDocs);
        rebuildMergedDocs();
        const prevScrollHeight = messagesBox ? messagesBox.scrollHeight : 0;
        const prevScrollTop = messagesBox ? messagesBox.scrollTop : 0;
        renderMessages(latestMsgDocs, currentMsgFilter);
        if (messagesBox) {
          messagesBox.scrollTop = prevScrollTop + (messagesBox.scrollHeight - prevScrollHeight);
        }
        if (snap.docs.length < MSG_PAGE_SIZE) allHistoryLoaded = true;
      }
    } catch (err) {
      console.error('Не удалось догрузить старые сообщения', err);
    } finally {
      isLoadingOlderMessages = false;
      toggleOlderLoadingIndicator(false);
    }
  }

  if (messagesBox) {
    messagesBox.onscroll = () => {
      refreshScrollDownBtn();
      if (messagesBox.scrollTop < 200) loadOlderMessages();
    };
  }
  if (scrollDownBtn) {
    scrollDownBtn.onclick = () => {
      if (messagesBox) messagesBox.scrollTop = messagesBox.scrollHeight;
      unreadWhileScrolledUp = 0;
      if (scrollDownUnread) scrollDownUnread.classList.remove('show');
      refreshScrollDownBtn();
    };
  }

  async function markIncomingMessagesRead(docs) {
    const unread = docs.filter(d => {
      const m = d.data();
      const senderId = m.senderId || m.from;
      return senderId && senderId !== currentUser.uid && m.read !== true;
    });
    if (unread.length === 0) return;
    try {
      const batch = db.batch();
      unread.forEach(d => batch.update(d.ref, { read: true }));
      await batch.commit();
    } catch (err) {}
  }

  unsubMessages = collectionRef.orderBy('createdAt').limitToLast(MSG_PAGE_SIZE).onSnapshot(snapshot => {
    liveMsgDocs = snapshot.docs;
    if (liveMsgDocs.length < MSG_PAGE_SIZE) allHistoryLoaded = true;
    if (historyMsgDocs.length && liveMsgDocs.length) {
      // на случай пересечения — не дублируем сообщения, уже присутствующие в живом окне
      const liveIds = new Set(liveMsgDocs.map(d => d.id));
      historyMsgDocs = historyMsgDocs.filter(d => !liveIds.has(d.id));
    }
    rebuildMergedDocs();
    renderMessages(latestMsgDocs, currentMsgFilter);
    markIncomingMessagesRead(liveMsgDocs);
  }, err => {
    console.error('Ошибка подписки на сообщения:', err);
  });

  const searchMsgToggleBtn = document.getElementById('searchMsgToggleBtn');
  const chatSearchPanel = document.getElementById('chatSearchPanel');
  const chatSearchInput = document.getElementById('chatSearchInput');
  const chatSearchClose = document.getElementById('chatSearchClose');
  if (searchMsgToggleBtn && chatSearchPanel && chatSearchInput) {
    searchMsgToggleBtn.onclick = () => {
      chatSearchPanel.classList.toggle('show');
      if (chatSearchPanel.classList.contains('show')) {
        chatSearchInput.focus();
      } else {
        chatSearchInput.value = '';
        currentMsgFilter = '';
        renderMessages(latestMsgDocs, currentMsgFilter);
      }
    };
    chatSearchInput.oninput = () => {
      currentMsgFilter = chatSearchInput.value.trim().toLowerCase();
      renderMessages(latestMsgDocs, currentMsgFilter);
    };
    if (chatSearchClose) {
      chatSearchClose.onclick = () => {
        chatSearchPanel.classList.remove('show');
        chatSearchInput.value = '';
        currentMsgFilter = '';
        renderMessages(latestMsgDocs, currentMsgFilter);
      };
    }
  }

  if (uploadStickerBtn && stickerFileInput) {
    uploadStickerBtn.onclick = (e) => {
      e.stopPropagation();
      stickerFileInput.click();
    };
  }
  renderStickerPanel();

  // Объединённая панель эмодзи/стикеров, открывается одной кнопкой с вкладками
  const chatEmojiBtn = document.getElementById('chatEmojiBtn');
  if (chatEmojiBtn && expressionPanel) {
    chatEmojiBtn.onclick = (e) => {
      e.stopPropagation();
      expressionPanel.classList.toggle('show');
    };
    expressionPanel.querySelectorAll('.expressionTab').forEach(tab => {
      tab.onclick = (e) => {
        e.stopPropagation();
        expressionPanel.querySelectorAll('.expressionTab').forEach(t => t.classList.remove('active'));
        expressionPanel.querySelectorAll('.expressionPane').forEach(p => p.classList.remove('active'));
        tab.classList.add('active');
        document.getElementById(tab.dataset.pane).classList.add('active');
      };
    });
    if (chatEmojiDocumentClickHandler) {
      document.removeEventListener('click', chatEmojiDocumentClickHandler);
      chatEmojiDocumentClickHandler = null;
    }
    chatEmojiDocumentClickHandler = (e) => {
      if (!expressionPanel.contains(e.target) && e.target !== chatEmojiBtn) {
        expressionPanel.classList.remove('show');
      }
    };
    document.addEventListener('click', chatEmojiDocumentClickHandler);
    chatEmojiPickerPanel.querySelectorAll('span').forEach(sp => {
      const emojiValue = sp.textContent || sp.dataset.emoji || '';
      sp.dataset.emoji = emojiValue;
      sp.onclick = (e) => {
        e.stopPropagation();
        const msgInput = document.getElementById('msgInput');
        if (msgInput) {
          const emoji = sp.dataset.emoji || sp.textContent || '';
          const start = msgInput.selectionStart;
          const end = msgInput.selectionEnd;
          const val = msgInput.value;
          msgInput.value = val.substring(0, start) + emoji + val.substring(end);
          msgInput.selectionStart = msgInput.selectionEnd = start + emoji.length;
          msgInput.focus();
        }
        expressionPanel.classList.remove('show');
      };
    });
  }

  if (!isGroup) {
    renderAvatar(document.getElementById('hdrAvatar'), targetObj.username, targetObj.color, targetObj.photo);
    const hdrMain = document.querySelector('.hdrMain');
    if (hdrMain) {
      hdrMain.style.cursor = 'pointer';
      hdrMain.onclick = (e) => {
        if (e.target.closest('#backBtn')) return;
        openUserProfile(targetObj);
      };
    }
  } else {
    const av = document.getElementById('hdrAvatar');
    if (av) renderGroupAvatar(av, targetObj, 20);
    const hdrMain = document.querySelector('.hdrMain');
    if (hdrMain) {
      hdrMain.style.cursor = 'pointer';
      hdrMain.onclick = (e) => {
        if (e.target.closest('#backBtn')) return;
        openGroupInfo(targetObj);
      };
    }
  }
  svgifyEmoji(document.getElementById('hdrAvatar'));
  svgifyEmoji(document.getElementById('chatHeader'));
  svgifyEmoji(document.getElementById('pinnedContent'));

  document.getElementById('backBtn').onclick = () => document.body.classList.remove('chatOpen');

  const muteKey = isGroup ? 'g_' + targetObj.id : 'f_' + targetObj.uid;
  const muteChatBtn = document.getElementById('muteChatBtn');
  if (muteChatBtn) {
    const refreshMuteIcon = () => {
      const muted = isChatMuted(muteKey);
      muteChatBtn.innerHTML = icon(muted ? 'bellOff' : 'bell', 16);
      muteChatBtn.title = muted ? 'Включить звук' : 'Без звука';
      svgifyEmoji(muteChatBtn);
    };
    refreshMuteIcon();
    muteChatBtn.onclick = (e) => {
      e.stopPropagation();
      toggleChatMute(muteKey);
      refreshMuteIcon();
    };
  }

  // Сигнатура сообщения для определения "изменилось ли оно визуально".
  // createdAt намеренно не учитывается — см. комментарии в местах использования.
  function computeMsgSig(m) {
    return JSON.stringify({ ...m, createdAt: undefined });
  }

  function buildMessageEl(doc, animate) {
    const m = doc.data();
    const sender = m.senderId || m.from;
    const mine = sender === currentUser.uid;

    const row = document.createElement('div');
    row.className = 'msgRow ' + (mine ? 'me' : 'other');

    const wrap = document.createElement('div');
    wrap.className = 'msgWrap ' + (mine ? 'me' : 'other') + (animate ? ' msgEnter' : '');
    row.appendChild(wrap);

    const div = document.createElement('div');
    div.id = 'msg_' + doc.id;
    div.className = 'msg ' + (mine ? 'me' : 'other');
    const time = m.createdAt
      ? m.createdAt.toDate().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
      : new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }); // ещё не подтверждено сервером — показываем «сейчас», чтобы не было скачка при подтверждении

    let inner = '';
    if (m.forwarded) {
      inner += `<div class="forwardedTag">${icon('forward', 11)} Переслано</div>`;
    }
    if (m.storyReply) {
      inner += `<div class="replyQuote storyReplyQuote"><img src="${m.storyReply.image}" class="storyReplyThumb"><span>Ответ на историю</span></div>`;
    }
    if (m.replyTo) {
      inner += `<div class="replyQuote"><b>Ответ:</b> ${escapeHtml(m.replyTo.text || 'Медиафайл')}</div>`;
    }
    if (m.image) inner += `<img src="${m.image}" class="chatImage">`;
    if (m.sticker) inner += `<img src="${m.sticker}" class="chatSticker" style="max-width:120px; max-height:120px; display:block;">`;
    if (m.audio) inner += `<audio controls src="${m.audio}"></audio>`;

    let ticks = '';
    if (mine) {
      ticks = `<span class="ticks" title="${m.read ? 'Просмотрено' : 'Отправлено'}">${icon(m.read ? 'checkDouble' : 'check', 13)}</span>`;
    }
    const timeHtml = `<span class="t">${time}${ticks}</span>`;

    if (m.text) {
      // Время «подтягивается» к последней строке текста через float,
      // а не занимает отдельную полноширинную строку под сообщением.
      inner += `<span class="bubbleText">${formatMessageTextWithMentions(m.text)}${m.isEdited ? ' <small style="opacity:0.6">(изм.)</small>' : ''}</span>${timeHtml}`;
    } else {
      inner += timeHtml;
    }

    inner += `
      <div class="msgActions">
        <button class="replyBtn" title="Ответить">${icon('reply', 15)}</button>
        ${(m.text || m.image || m.sticker || m.audio) ? `<button class="forwardBtn" title="Переслать">${icon('forward', 15)}</button>` : ''}
        ${m.text ? `<button class="copyBtn" title="Копировать">${icon('copy', 15)}</button>` : ''}
        <button class="pinBtn${currentPinnedIds.includes(doc.id) ? ' pinned' : ''}" data-mid="${doc.id}" title="${currentPinnedIds.includes(doc.id) ? 'Открепить' : 'Закрепить'}">${icon('pin', 15)}</button>
        ${mine && m.text ? `<button class="editBtn" title="Редактировать">${icon('edit', 15)}</button>` : ''}
        ${m.sticker && !myStickers.includes(m.sticker) ? `<button class="saveStickerBtn" title="Сохранить стикер">${icon('star', 15)}</button>` : ''}
        ${mine ? `<button class="delBtn" title="Удалить">${icon('trash', 15)}</button>` : ''}
      </div>
    `;

    div.innerHTML = inner;

    div.querySelectorAll('.mentionTag').forEach(tag => {
      tag.onclick = async (e) => {
        e.stopPropagation();
        const username = tag.getAttribute('data-mention');
        if (username === myUsername) return;
        const friend = myFriends.find(f => f.username.toLowerCase() === username);
        if (friend) {
          openChat(friend);
          return;
        }
        try {
          const userDoc = await db.collection('usernames').doc(username).get();
          if (!userDoc.exists) {
            alert(`Пользователь @${username} не найден.`);
            return;
          }
          const targetUid = userDoc.data().uid;
          const userFullDoc = await db.collection('users').doc(targetUid).get();
          if (userFullDoc.exists) {
            openChat({ uid: targetUid, ...userFullDoc.data() });
          }
        } catch (err) {
          alert('Не удалось открыть чат с пользователем.');
        }
      };
    });

    const imgEl = div.querySelector('.chatImage');
    if (imgEl) {
      imgEl.onclick = (e) => {
        e.stopPropagation();
        openLightbox(m.image, latestMsgDocs, doc.id);
      };
    }

    // Стикеры больше не открываются в лайтбоксе (они не фото, увеличивать их не нужно) —
    // клик по стикеру не делает ничего, кроме обычного тапа по строке сообщения (реакции/меню).

    const saveStickerBtn = div.querySelector('.saveStickerBtn');
    if (saveStickerBtn) {
      saveStickerBtn.onclick = async (e) => {
        e.stopPropagation();
        if (m.sticker) await addStickerToLibrary(m.sticker);
        saveStickerBtn.style.display = 'none';
      };
    }

    const replyBtn = div.querySelector('.replyBtn');
    if (replyBtn) replyBtn.onclick = (e) => { e.stopPropagation(); startReply(m); };

    const forwardBtn = div.querySelector('.forwardBtn');
    if (forwardBtn) forwardBtn.onclick = (e) => { e.stopPropagation(); openForwardPicker(m); };

    let pointerStartX = 0;
    let pointerStartY = 0;
    let pointerId = null;
    div.onpointerdown = (e) => {
      if (e.pointerType !== 'touch' && e.pointerType !== 'pen') return;
      if (e.target.closest('button, a, input, textarea')) return;
      pointerId = e.pointerId;
      pointerStartX = e.clientX;
      pointerStartY = e.clientY;
      div.setPointerCapture(pointerId);
      div.style.transition = 'transform 0s';
    };
    div.onpointermove = (e) => {
      if (pointerId === null || e.pointerId !== pointerId) return;
      const dx = e.clientX - pointerStartX;
      const dy = e.clientY - pointerStartY;
      if (Math.abs(dx) > 6 && Math.abs(dy) < 20) {
        div.style.transform = `translateX(${Math.min(30, dx)}px)`;
      }
    };
    div.onpointerup = (e) => {
      if (pointerId === null || e.pointerId !== pointerId) return;
      div.releasePointerCapture(pointerId);
      pointerId = null;
      const dx = e.clientX - pointerStartX;
      const dy = e.clientY - pointerStartY;
      div.style.transition = 'transform .2s ease';
      div.style.transform = '';
      if (dx > 60 && Math.abs(dy) < 25) {
        startReply(m);
        div.classList.add('highlight');
        setTimeout(() => div.classList.remove('highlight'), 520);
      }
    };
    div.onpointercancel = () => {
      if (pointerId !== null) {
        div.releasePointerCapture(pointerId);
        pointerId = null;
      }
      div.style.transition = 'transform .2s ease';
      div.style.transform = '';
    };

    const copyBtn = div.querySelector('.copyBtn');
    if (copyBtn) copyBtn.onclick = async (e) => {
      e.stopPropagation();
      try {
        await navigator.clipboard.writeText(m.text);
        copyBtn.innerHTML = icon('check', 15);
        setTimeout(() => { copyBtn.innerHTML = icon('copy', 15); }, 900);
      } catch (err) {}
    };

    const pinBtn = div.querySelector('.pinBtn');
    if (pinBtn) pinBtn.onclick = (e) => { e.stopPropagation(); pinMessage(cid, doc.id, m, isGroup); };

    if (mine) {
      const del = div.querySelector('.delBtn');
      if (del) del.onclick = (e) => { e.stopPropagation(); deleteMessage(collectionRef, doc.id); };

      const edit = div.querySelector('.editBtn');
      if (edit) edit.onclick = (e) => { e.stopPropagation(); startEditMessage(doc.id, m.text); };
    }

    const bar = document.createElement('div');
    bar.className = 'emojiBar';
    const addReactionPill = (emoji, before, extra) => {
      const sp = document.createElement('span');
      if (extra) sp.className = 'emojiExtra';
      sp.textContent = emoji;
      sp.onclick = (e) => {
        e.stopPropagation();
        const already = ((m.reactions && m.reactions[emoji]) || []).includes(currentUser.uid);
        toggleReaction(collectionRef, doc.id, emoji, already);
        bar.classList.remove('show');
        bar.classList.remove('expanded');
        moreReactionsBtn.classList.remove('open');
      };
      if (before) bar.insertBefore(sp, before); else bar.appendChild(sp);
    };
    REACTION_EMOJIS.forEach(emoji => addReactionPill(emoji));
    const moreReactionsBtn = document.createElement('span');
    moreReactionsBtn.className = 'emojiBarMore';
    moreReactionsBtn.innerHTML = icon('plus', 13);
    moreReactionsBtn.title = 'Ещё реакции';
    moreReactionsBtn.onclick = (e) => {
      e.stopPropagation();
      if (!bar.dataset.expandedBuilt) {
        EXTRA_REACTION_EMOJIS.forEach(emoji => addReactionPill(emoji, moreReactionsBtn, true));
        bar.dataset.expandedBuilt = '1';
        svgifyEmoji(bar);
      }
      bar.classList.toggle('expanded');
      moreReactionsBtn.classList.toggle('open', bar.classList.contains('expanded'));
    };
    bar.appendChild(moreReactionsBtn);

    const actionsEl = div.querySelector('.msgActions');

    wrap.appendChild(div);

    const reactions = m.reactions || {};
    const reactWrap = document.createElement('div');
    reactWrap.className = 'reactions';
    Object.keys(reactions).forEach(emoji => {
      const uids = reactions[emoji] || [];
      if (uids.length === 0) return;
      const pill = document.createElement('span');
      pill.className = 'reactionPill' + (uids.includes(currentUser.uid) ? ' mine' : '');
      pill.textContent = `${emoji} ${uids.length}`;
      pill.onclick = (e) => { e.stopPropagation(); toggleReaction(collectionRef, doc.id, emoji, uids.includes(currentUser.uid)); };
      reactWrap.appendChild(pill);
    });
    wrap.appendChild(reactWrap);
    wrap.appendChild(bar);

    // Один тап по всей строке сообщения (включая пустое поле рядом с пузырём,
    // не только сам пузырь) открывает реакции + меню действий; двойной тап по
    // той же строке ставит ❤️. Открытие меню отложено на длительность окна
    // двойного тапа: если прилетает второй клик — это начало dblclick, и мы
    // его гасим, чтобы сердечко никогда не сопровождалось всплытием меню.
    let msgTapTimer = null;
    const isInteractive = (e) => e.target.closest('button, a, input, textarea, .reactionPill, img, audio');

    row.addEventListener('click', (e) => {
      if (isInteractive(e)) return;
      if (msgTapTimer) {
        clearTimeout(msgTapTimer);
        msgTapTimer = null;
        return;
      }
      msgTapTimer = setTimeout(() => {
        msgTapTimer = null;
        document.querySelectorAll('.msgActions.show').forEach(a => { if (a !== actionsEl) a.classList.remove('show'); });
        toggleEmojiBar(bar);
        if (actionsEl) {
          const opening = !actionsEl.classList.contains('show');
          actionsEl.classList.toggle('show');
          if (opening) {
            const box = document.getElementById('messages');
            if (box) {
              const spaceAbove = div.getBoundingClientRect().top - box.getBoundingClientRect().top;
              actionsEl.classList.toggle('below', spaceAbove < 70);
            }
          }
        }
      }, 260);
    });

    row.addEventListener('dblclick', (e) => {
      if (isInteractive(e)) return;
      e.stopPropagation();
      if (msgTapTimer) { clearTimeout(msgTapTimer); msgTapTimer = null; }
      bar.classList.remove('show');
      if (actionsEl) actionsEl.classList.remove('show');
      const dblEmoji = getDblTapReaction();
      const already = ((m.reactions && m.reactions[dblEmoji]) || []).includes(currentUser.uid);
      if (!already) toggleReaction(collectionRef, doc.id, dblEmoji, false);
      burstHeart(div, dblEmoji);
    });

    svgifyEmoji(wrap);
    return { wrap: row, sig: computeMsgSig(m) };
  }

  function renderMessages(docs, filterText = '') {
    const box = document.getElementById('messages');
    const scrollDownUnread = document.getElementById('scrollDownUnread');
    if (!box) return;

    const existingEmpty = box.querySelector('.chatEmpty');
    if (existingEmpty) existingEmpty.remove();

    const nearBottom = box.scrollHeight - box.scrollTop - box.clientHeight < 80;
    const visibleIds = new Set();
    let prevWrap = null;
    let changed = false;
    let newRemoteCount = 0;

    docs.forEach(doc => {
      const m = doc.data();
      if (filterText && (!m.text || !m.text.toLowerCase().includes(filterText))) return;

      visibleIds.add(doc.id);
      let entry = messageElements.get(doc.id);
      // createdAt сознательно исключён из сигнатуры: у только что отправленного
      // сообщения он сначала null (ждём подтверждения сервера), а через мгновение
      // становится настоящим Timestamp — само по себе это не визуальное изменение,
      // и пересоздавать весь DOM-узел ради этого не нужно (раньше это обрывало
      // анимации и вызывало резкий скачок размера пузыря).
      const sig = computeMsgSig(m);

      if (!entry) {
        try {
          entry = buildMessageEl(doc, hasRenderedInitial);
        } catch (err) {
          console.error('Не удалось отрисовать сообщение:', err);
          return;
        }
        messageElements.set(doc.id, entry);
        changed = true;
        if (hasRenderedInitial && !nearBottom && (m.senderId || m.from) !== currentUser.uid) {
          newRemoteCount++;
        }
      } else if (entry.sig !== sig) {
        const fresh = buildMessageEl(doc, false);
        entry.wrap.replaceWith(fresh.wrap);
        messageElements.set(doc.id, fresh);
        entry = fresh;
        changed = true;
      }

      const expectedNext = prevWrap ? prevWrap.nextSibling : box.firstChild;
      if (expectedNext !== entry.wrap) {
        box.insertBefore(entry.wrap, expectedNext);
        changed = true;
      }
      prevWrap = entry.wrap;
    });

    messageElements.forEach((entry, id) => {
      if (!visibleIds.has(id)) {
        entry.wrap.remove();
        messageElements.delete(id);
        changed = true;
      }
    });

    if (visibleIds.size === 0 && !filterText) {
      const emptyTip = document.createElement('div');
      emptyTip.className = 'chatEmpty';
      emptyTip.textContent = 'Здесь пока нет сообщений. Напишите первым!';
      box.appendChild(emptyTip);
      changed = true;
    }

    if (changed && nearBottom) {
      box.scrollTop = box.scrollHeight;
      // Изображения/стикеры догружаются асинхронно и могут изменить высоту списка —
      // переустанавливаем прокрутку после их загрузки, чтобы не было заметного скачка.
      box.querySelectorAll('img').forEach(imgEl => {
        if (!imgEl.complete) {
          imgEl.addEventListener('load', () => {
            const stillNearBottom = box.scrollHeight - box.scrollTop - box.clientHeight < 160;
            if (stillNearBottom) box.scrollTop = box.scrollHeight;
          }, { once: true });
        }
      });
    }
    if (newRemoteCount > 0) {
      unreadWhileScrolledUp += newRemoteCount;
      if (scrollDownUnread) {
        scrollDownUnread.textContent = unreadWhileScrolledUp > 9 ? '9+' : String(unreadWhileScrolledUp);
        scrollDownUnread.classList.add('show');
      }
    }
    refreshScrollDownBtn();
    hasRenderedInitial = true;
  }

  function toggleEmojiBar(bar){
    document.querySelectorAll('.emojiBar.show').forEach(b => { if (b!==bar) b.classList.remove('show'); });
    bar.classList.toggle('show');
  }

  async function deleteMessage(colRef, msgId) {
    if (confirm("Удалить сообщение?")) {
      await colRef.doc(msgId).delete();
    }
  }

  async function pinMessage(chatId, msgId, msgData, isGrp) {
    const targetRef = isGrp ? db.collection('groups').doc(chatId) : db.collection('chats').doc(chatId);
    const alreadyPinned = currentPinnedIds.includes(msgId);
    try {
      if (alreadyPinned) {
        await targetRef.update({ [`pinnedMsgs.${msgId}`]: firebase.firestore.FieldValue.delete() });
      } else {
        const dataToSave = { ...msgData, id: msgId, pinnedAt: firebase.firestore.FieldValue.serverTimestamp() };
        await targetRef.set({ pinnedMsgs: { [msgId]: dataToSave } }, { merge: true });
      }
    } catch (err) {
      console.error('Pin toggle failed', err);
    }
  }

  // Подсвечивает кнопки закрепления у уже отрисованных сообщений в соответствии
  // с актуальным списком закреплённых id — вызывается при каждом обновлении меты чата.
  function refreshPinButtonStates() {
    document.querySelectorAll('#messages .pinBtn[data-mid]').forEach(btn => {
      const pinned = currentPinnedIds.includes(btn.dataset.mid);
      btn.classList.toggle('pinned', pinned);
      btn.title = pinned ? 'Открепить' : 'Закрепить';
    });
  }

  function startEditMessage(msgId, text) {
    editingMsgId = msgId;
    const input = document.getElementById('msgInput');
    if (input) {
      input.value = text;
      input.focus();
    }
    updateSendMicToggle();
  }

  function startReply(msgData) {
    replyingToMsg = msgData;
    const replyBar = document.getElementById('replyBar');
    const replyTextPreview = document.getElementById('replyTextPreview');
    replyTextPreview.textContent = 'Ответ на: ' + (msgData.text || 'Медиасообщение');
    replyBar.classList.add('show');
    document.getElementById('replyCancelBtn').onclick = () => {
      replyingToMsg = null;
      replyBar.classList.remove('show');
    };
  }

  async function toggleReaction(colRef, msgId, emoji, alreadyReacted){
    const ref = colRef.doc(msgId);
    const fieldPath = `reactions.${emoji}`;
    await ref.update({
      [fieldPath]: alreadyReacted 
        ? firebase.firestore.FieldValue.arrayRemove(currentUser.uid)
        : firebase.firestore.FieldValue.arrayUnion(currentUser.uid)
    });
  }

  if (canWrite) {
    const send = async () => {
      const input = document.getElementById('msgInput');
      const text = input.value.trim();
      if (!text && !pendingImage) return;
      
      if (editingMsgId) {
        await collectionRef.doc(editingMsgId).update({
          text: text,
          isEdited: true
        });
        editingMsgId = null;
        input.value = '';
        input.focus();
        updateSendMicToggle();
        return;
      }

      input.value = '';
      
      const payload = {
        senderId: currentUser.uid,
        from: currentUser.uid,
        createdAt: firebase.firestore.FieldValue.serverTimestamp(),
        read: false
      };
      if (!isGroup) payload.to = targetObj.uid;
      if (text) payload.text = text;
      if (pendingImage) payload.image = pendingImage;
      if (replyingToMsg) {
        payload.replyTo = { text: replyingToMsg.text || '' };
        replyingToMsg = null;
        document.getElementById('replyBar').classList.remove('show');
      }

      pendingImage = null;
      document.getElementById('imgPreviewBar').classList.remove('show');
      updateSendMicToggle();
      
      await collectionRef.add(payload);
      input.focus();
    };

    const sendBtn = document.getElementById('sendBtn');
    sendBtn.onclick = send;
    sendBtn.addEventListener('mousedown', e => e.preventDefault());
    sendBtn.addEventListener('touchend', e => { e.preventDefault(); send(); }, { passive: false });

    const msgInput = document.getElementById('msgInput');
    msgInput.addEventListener('keydown', e => { 
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        send(); 
      } 
    });

    msgInput.addEventListener('input', updateSendMicToggle);
    updateSendMicToggle();
    
    if (!isGroup) {
      msgInput.addEventListener('input', () => {
        db.collection('chats').doc(cid).set({
          participants: [currentUser.uid, targetObj.uid],
          typing: { [currentUser.uid]: firebase.firestore.FieldValue.serverTimestamp() }
        }, { merge: true });
      });
      msgInput.addEventListener('blur', async () => {
        await db.collection('chats').doc(cid).set({
          typing: { [currentUser.uid]: firebase.firestore.FieldValue.delete() }
        }, { merge: true });
      });
    }

    const voiceBtn = document.getElementById('voiceBtn');
    voiceBtn.onclick = async () => {
      if (!isRecording) {
        try {
          const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
          mediaRecorder = new MediaRecorder(stream);
          audioChunks = [];
          
          mediaRecorder.ondataavailable = e => audioChunks.push(e.data);
          mediaRecorder.onstop = async () => {
            const audioBlob = new Blob(audioChunks, { type: 'audio/webm' });
            const reader = new FileReader();
            reader.readAsDataURL(audioBlob);
            reader.onloadend = async () => {
              const base64Audio = reader.result;
              await collectionRef.add({
                senderId: currentUser.uid,
                from: currentUser.uid,
                audio: base64Audio,
                read: false,
                createdAt: firebase.firestore.FieldValue.serverTimestamp()
              });
            };
          };

          mediaRecorder.start();
          isRecording = true;
          voiceBtn.classList.add('recActive');
        } catch (err) {
          alert('Не удалось получить доступ к микрофону');
        }
      } else {
        mediaRecorder.stop();
        isRecording = false;
        voiceBtn.classList.remove('recActive');
      }
    };

    document.getElementById('attachBtn').onclick = () => document.getElementById('imgFileInput').click();
    document.getElementById('imgCancelBtn').onclick = () => {
      pendingImage = null;
      document.getElementById('imgPreviewBar').classList.remove('show');
      updateSendMicToggle();
    };
  }
}

// Общие медиа для профиля/инфо группы — как в Telegram: последние фото
// из переписки, по клику открываются в лайтбоксе с той же пролисткой.
async function loadSharedMedia(colRef, cardEl, gridEl) {
  if (!cardEl || !gridEl) return;
  cardEl.style.display = 'none';
  try {
    const snap = await colRef.orderBy('createdAt', 'desc').limit(150).get();
    const imageDocs = snap.docs.filter(d => d.data().image).slice(0, 24);
    if (imageDocs.length === 0) return;

    cardEl.style.display = 'block';
    gridEl.innerHTML = '';
    imageDocs.forEach(d => {
      const thumb = document.createElement('div');
      thumb.className = 'mediaThumb';
      thumb.style.backgroundImage = `url(${d.data().image})`;
      thumb.onclick = () => openLightbox(d.data().image, imageDocs, d.id);
      gridEl.appendChild(thumb);
    });
  } catch (e) { /* нет доступа/сети — просто не показываем секцию */ }
}

function openLightbox(src, docsList, currentDocId) {
  const lightbox = document.getElementById('lightbox');

  if (Array.isArray(docsList)) {
    lightboxGallery = docsList
      .filter(d => d.data().image)
      .map(d => ({ id: d.id, image: d.data().image }));
    const foundIndex = lightboxGallery.findIndex(g => g.id === currentDocId);
    lightboxIndex = foundIndex >= 0 ? foundIndex : 0;
  } else {
    lightboxGallery = [{ id: null, image: src }];
    lightboxIndex = 0;
  }

  showLightboxImage();
  lightbox.classList.add('show');
}

function showLightboxImage() {
  const img = document.getElementById('lightboxImg');
  const lightbox = document.getElementById('lightbox');
  const counter = document.getElementById('lightboxCounter');
  if (!img || lightboxGallery.length === 0) return;
  img.src = lightboxGallery[lightboxIndex].image;
  const multi = lightboxGallery.length > 1;
  lightbox.classList.toggle('multi', multi);
  if (counter) counter.textContent = `${lightboxIndex + 1} / ${lightboxGallery.length}`;
}

function lightboxGoPrev() {
  if (lightboxGallery.length < 2) return;
  lightboxIndex = (lightboxIndex - 1 + lightboxGallery.length) % lightboxGallery.length;
  showLightboxImage();
}
function lightboxGoNext() {
  if (lightboxGallery.length < 2) return;
  lightboxIndex = (lightboxIndex + 1) % lightboxGallery.length;
  showLightboxImage();
}

document.getElementById('lightboxPrev').onclick = (e) => { e.stopPropagation(); lightboxGoPrev(); };
document.getElementById('lightboxNext').onclick = (e) => { e.stopPropagation(); lightboxGoNext(); };
document.getElementById('lightboxPrevZone').onclick = (e) => { e.stopPropagation(); lightboxGoPrev(); };
document.getElementById('lightboxNextZone').onclick = (e) => { e.stopPropagation(); lightboxGoNext(); };

// Свайп по картинке — влево/вправо листает галерею
(function setupLightboxSwipe() {
  const img = document.getElementById('lightboxImg');
  if (!img) return;
  let startX = 0, startY = 0, dragging = false;
  img.addEventListener('pointerdown', (e) => {
    startX = e.clientX; startY = e.clientY; dragging = true;
  });
  img.addEventListener('pointerup', (e) => {
    if (!dragging) return;
    dragging = false;
    const dx = e.clientX - startX;
    const dy = e.clientY - startY;
    if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy)) {
      if (dx > 0) lightboxGoPrev(); else lightboxGoNext();
    }
  });
  img.addEventListener('pointercancel', () => { dragging = false; });
})();

document.getElementById('lightboxClose').onclick = () => document.getElementById('lightbox').classList.remove('show');
document.getElementById('lightbox').onclick = (e) => {
  if (e.target.id === 'lightbox') document.getElementById('lightbox').classList.remove('show');
};

document.getElementById('imgFileInput').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  e.target.value = '';
  if (!file) return;
  pendingImage = await resizeImage(file, 800, 0.6);
  document.getElementById('imgPreviewThumb').src = pendingImage;
  document.getElementById('imgPreviewBar').classList.add('show');
  updateSendMicToggle();
});

document.getElementById('stickerFileInput').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  e.target.value = '';
  if (!file || !currentUser) return;
  const stickerData = await resizeImage(file, 800, 0.8);
  await addStickerToLibrary(stickerData);
  const expressionPanel = document.getElementById('expressionPanel');
  if (expressionPanel) {
    expressionPanel.classList.add('show');
    const stickerTab = expressionPanel.querySelector('.expressionTab[data-pane="stickerPane"]');
    if (stickerTab) stickerTab.click();
  }
});