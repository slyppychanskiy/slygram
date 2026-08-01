let activeChatWith = null;
let activeCollectionRef = null;
let unsubMessages = null;
let unsubChatMeta = null;
let pendingImage = null;
let editingMsgId = null;
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
      const stickerPickerPanel = document.getElementById('chatStickerPickerPanel');
      if (stickerPickerPanel) stickerPickerPanel.classList.remove('show');
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
  activeChatWith = friend;
  window.activeChatWith = friend;
  const cid = chatIdFor(currentUser.uid, friend.uid);
  
  await db.collection('chats').doc(cid).set({
    participants: [currentUser.uid, friend.uid]
  }, { merge: true });

  setupChatLayout(friend.username, false, friend);
}

function openGroupChat(group){
  activeChatWith = group;
  window.activeChatWith = group;
  setupChatLayout(group.name, true, group);
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
  editingMsgId = null;
  replyingToMsg = null;
  document.body.classList.add('chatOpen');
  renderList();

  const chatArea = document.getElementById('chatArea');
  const cid = isGroup ? targetObj.id : chatIdFor(currentUser.uid, targetObj.uid);
  const collectionRef = isGroup ? db.collection('groups').doc(cid).collection('messages') : db.collection('chats').doc(cid).collection('messages');
  activeCollectionRef = collectionRef;
  activeChatWith = targetObj;

  const canWrite = !isGroup || targetObj.type !== 'channel' || targetObj.owner === currentUser.uid;

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
          <button id="backBtn">←</button>
          <div class="avatar" id="hdrAvatar"></div>
          <div class="hdrText">
            <div>${isGroup ? escapeHtml(titleText) : '@' + titleText}</div>
            <div class="sub" id="typingIndicator"></div>
          </div>
        </div>
        <div>
          <button id="searchMsgToggleBtn" style="border:2px solid var(--ink); background:var(--paper); cursor:pointer; padding:4px 8px; border-radius:8px;">🔍</button>
        </div>
      </div>
      <div id="chatSearchPanel">
        <input id="chatSearchInput" placeholder="Поиск в чате...">
        <button id="chatSearchClose">✕</button>
      </div>
      <div id="pinnedBar">
        <div class="pinText" id="pinnedContent">Закрепленное сообщение</div>
        <button id="unpinBtn">Открепить</button>
      </div>
    </div>
    <div id="messages">
      <button id="scrollDownBtn" title="К новым сообщениям">
        <span>↓</span>
        <span class="unreadDot" id="scrollDownUnread"></span>
      </button>
    </div>
    <div id="replyBar">
      <span id="replyTextPreview">Ответ на сообщение...</span>
      <button id="replyCancelBtn" style="border:1px solid var(--ink); background:var(--paper); cursor:pointer;">✕</button>
    </div>
    <div id="imgPreviewBar"><img id="imgPreviewThumb"><span>Картинка готова</span><button id="imgCancelBtn">Убрать</button></div>
    ${canWrite ? `
    <div id="inputBar">
      <button class="iconBtn" id="attachBtn" title="Фото">📎</button>
      <div class="chatStickerPickerWrapper">
        <button class="iconBtn" id="stickerBtn" title="Стикеры">🌟</button>
        <div id="chatStickerPickerPanel" class="chatStickerPickerPanel">
          <div class="stickerPanelHeader">
            <button id="uploadStickerBtn" class="smallBtn" title="Загрузить стикер">+</button>
            <span>Мои стикеры</span>
          </div>
          <div id="stickerGrid" class="stickerGrid"></div>
          <div id="stickerPanelEmpty" class="stickerPanelEmpty">У вас ещё нет стикеров</div>
        </div>
      </div>
      <div class="chatEmojiPickerWrapper">
        <button class="iconBtn" id="chatEmojiBtn" title="Эмодзи">😊</button>
        <div id="chatEmojiPickerPanel">
          <span>😀</span><span>😂</span><span>😍</span><span>🔥</span><span>👍</span><span>❤️</span>
          <span>😎</span><span>🎉</span><span>💩</span><span>✨</span><span>🚀</span><span>🤔</span>
          <span>👀</span><span>👏</span><span>💪</span><span>🥳</span><span>💯</span><span>🙏</span>
        </div>
      </div>
      <div class="chatGiftWrapper">
        <button class="iconBtn" id="giftBtn" title="Подарок">🎁</button>
        <div id="giftPickerPanel" class="giftPickerPanel">
          <div class="giftOption" data-gift='{"emoji":"🎉","title":"Праздничный подарок"}'>🎉<br>Праздник</div>
          <div class="giftOption" data-gift='{"emoji":"🍫","title":"Вкусный шоколад"}'>🍫<br>Шоколад</div>
          <div class="giftOption" data-gift='{"emoji":"🌹","title":"Розочка"}'>🌹<br>Розочка</div>
          <div class="giftOption" data-gift='{"emoji":"💎","title":"Сияющий дар"}'>💎<br>Дар</div>
          <div class="giftOption" data-gift='{"emoji":"🛡️","title":"Защитный подарок"}'>🛡️<br>Защита</div>
          <div class="giftOption" data-gift='{"emoji":"⚡","title":"Энергия"}'>⚡<br>Энергия</div>
        </div>
      </div>
      <button class="iconBtn" id="voiceBtn" title="Голосовое сообщение">🎙️</button>
      <input id="msgInput" type="text" placeholder="Сообщение...">
      <button id="sendBtn">➤</button>
    </div>` : `<div style="padding:15px; text-align:center; color:var(--muted); background:var(--paper2); border-top:2px solid var(--ink); font-size:12px;">Только администратор может отправлять сообщения в этот канал.</div>`}
  `;

  const pinnedBar = document.getElementById('pinnedBar');
  const pinnedContent = document.getElementById('pinnedContent');
  const unpinBtn = document.getElementById('unpinBtn');
  const messagesBox = document.getElementById('messages');
  const scrollDownBtn = document.getElementById('scrollDownBtn');
  const scrollDownUnread = document.getElementById('scrollDownUnread');
  const stickerBtn = document.getElementById('stickerBtn');
  const stickerPickerPanel = document.getElementById('chatStickerPickerPanel');
  const uploadStickerBtn = document.getElementById('uploadStickerBtn');
  const stickerFileInput = document.getElementById('stickerFileInput');
  const chatEmojiPickerPanel = document.getElementById('chatEmojiPickerPanel');
  const metaDocRef = isGroup ? db.collection('groups').doc(cid) : db.collection('chats').doc(cid);

  const showPinnedMessage = (pinnedMsg) => {
    if (!pinnedBar || !pinnedContent) return;
    if (!pinnedMsg) {
      pinnedBar.style.display = 'none';
      pinnedContent.textContent = 'Закрепленное сообщение';
      pinnedContent.onclick = null;
      return;
    }
    pinnedBar.style.display = 'flex';
    let preview = 'Закреплено: ';
    if (pinnedMsg.text) preview += pinnedMsg.text.length > 80 ? pinnedMsg.text.slice(0, 80) + '…' : pinnedMsg.text;
    else if (pinnedMsg.image) preview += 'Фото';
    else if (pinnedMsg.sticker) preview += 'Стикер';
    else if (pinnedMsg.audio) preview += 'Голосовое сообщение';
    else preview += 'Медиа';
    pinnedContent.textContent = preview;
    pinnedContent.title = 'Нажмите, чтобы перейти к закреплённому сообщению';
    pinnedContent.onclick = () => {
      const targetEl = document.getElementById('msg_' + pinnedMsg.id);
      if (targetEl) targetEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
    };
  };

  if (pinnedBar) pinnedBar.style.display = 'none';
  if (unsubChatMeta) {
    unsubChatMeta();
    unsubChatMeta = null;
  }
  const typingIndicatorEl = document.getElementById('typingIndicator');
  let typingHideTimer = null;
  unsubChatMeta = metaDocRef.onSnapshot(doc => {
    if (!doc.exists) { showPinnedMessage(null); if (typingIndicatorEl) typingIndicatorEl.innerHTML = ''; return; }
    const data = doc.data();
    showPinnedMessage(data?.pinnedMsg || null);

    if (typingIndicatorEl && !isGroup) {
      if (typingHideTimer) { clearTimeout(typingHideTimer); typingHideTimer = null; }
      const typing = data?.typing || {};
      const otherTs = typing[targetObj.uid];
      const ageMs = otherTs && otherTs.toMillis ? Date.now() - otherTs.toMillis() : Infinity;
      if (ageMs < 4000) {
        typingIndicatorEl.innerHTML = 'печатает <span class="typingDots"><span></span><span></span><span></span></span>';
        typingHideTimer = setTimeout(() => { typingIndicatorEl.innerHTML = ''; }, 4000 - ageMs);
      } else {
        typingIndicatorEl.innerHTML = '';
      }
    }
  });

  if (unpinBtn) {
    unpinBtn.onclick = async () => {
      if (!metaDocRef) return;
      try {
        await metaDocRef.update({ pinnedMsg: firebase.firestore.FieldValue.delete() });
        showPinnedMessage(null);
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

  if (messagesBox) {
    messagesBox.onscroll = refreshScrollDownBtn;
  }
  if (scrollDownBtn) {
    scrollDownBtn.onclick = () => {
      if (messagesBox) messagesBox.scrollTop = messagesBox.scrollHeight;
      unreadWhileScrolledUp = 0;
      if (scrollDownUnread) scrollDownUnread.classList.remove('show');
      refreshScrollDownBtn();
    };
  }

  unsubMessages = collectionRef.orderBy('createdAt').onSnapshot(snapshot => {
    renderMessages(snapshot.docs);
  });

  if (stickerBtn && stickerPickerPanel) {
    stickerBtn.onclick = (e) => {
      e.stopPropagation();
      stickerPickerPanel.classList.toggle('show');
      if (chatEmojiPickerPanel) chatEmojiPickerPanel.classList.remove('show');
      if (giftPickerPanel) giftPickerPanel.classList.remove('show');
    };
    if (uploadStickerBtn && stickerFileInput) {
      uploadStickerBtn.onclick = (e) => {
        e.stopPropagation();
        stickerFileInput.click();
      };
    }
    document.addEventListener('click', (e) => {
      if (!stickerPickerPanel.contains(e.target) && e.target !== stickerBtn) {
        stickerPickerPanel.classList.remove('show');
      }
    });
    renderStickerPanel();
  }
  const giftBtn = document.getElementById('giftBtn');
  const giftPickerPanel = document.getElementById('giftPickerPanel');
  if (giftBtn && giftPickerPanel) {
    giftBtn.onclick = (e) => {
      e.stopPropagation();
      giftPickerPanel.classList.toggle('show');
      if (chatEmojiPickerPanel) chatEmojiPickerPanel.classList.remove('show');
      if (stickerPickerPanel) stickerPickerPanel.classList.remove('show');
    };
    giftPickerPanel.querySelectorAll('.giftOption').forEach(option => {
      option.onclick = async (e) => {
        e.stopPropagation();
        const giftData = JSON.parse(option.dataset.gift || '{}');
        await sendGift(giftData);
        giftPickerPanel.classList.remove('show');
      };
    });
    document.addEventListener('click', (e) => {
      if (!giftPickerPanel.contains(e.target) && e.target !== giftBtn) {
        giftPickerPanel.classList.remove('show');
      }
    });
  }

  // Логика плавно вылазящей панели эмодзи из кнопки и вставки эмодзи в инпут
  const chatEmojiBtn = document.getElementById('chatEmojiBtn');
  if (chatEmojiBtn && chatEmojiPickerPanel) {
    chatEmojiBtn.onclick = (e) => {
      e.stopPropagation();
      chatEmojiPickerPanel.classList.toggle('show');
    };
    if (chatEmojiDocumentClickHandler) {
      document.removeEventListener('click', chatEmojiDocumentClickHandler);
      chatEmojiDocumentClickHandler = null;
    }
    chatEmojiDocumentClickHandler = (e) => {
      if (!chatEmojiPickerPanel.contains(e.target) && e.target !== chatEmojiBtn) {
        chatEmojiPickerPanel.classList.remove('show');
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
        chatEmojiPickerPanel.classList.remove('show');
      };
    });
  }

  if (!isGroup) {
    renderAvatar(document.getElementById('hdrAvatar'), targetObj.username, targetObj.color, targetObj.photo);
    const hdrMain = document.querySelector('.hdrMain');
    if (hdrMain) {
      hdrMain.style.cursor = 'pointer';
      hdrMain.onclick = (e) => {
        if (e.target.id === 'backBtn') return;
        openUserProfile(targetObj);
      };
    }
  } else {
    const av = document.getElementById('hdrAvatar');
    if (av) av.textContent = targetObj.type === 'channel' ? '📢' : '👥';
    const hdrMain = document.querySelector('.hdrMain');
    if (hdrMain) {
      hdrMain.style.cursor = 'pointer';
      hdrMain.onclick = (e) => {
        if (e.target.id === 'backBtn') return;
        openGroupInfo(targetObj);
      };
    }
  }
  svgifyEmoji(document.getElementById('hdrAvatar'));
  svgifyEmoji(document.getElementById('chatHeader'));
  svgifyEmoji(document.getElementById('pinnedContent'));

  document.getElementById('backBtn').onclick = () => document.body.classList.remove('chatOpen');

  function buildMessageEl(doc, animate) {
    const m = doc.data();
    const sender = m.senderId || m.from;
    const mine = sender === currentUser.uid;
    const wrap = document.createElement('div');
    wrap.className = 'msgWrap ' + (mine ? 'me' : 'other') + (animate ? ' msgEnter' : '');

    const div = document.createElement('div');
    div.id = 'msg_' + doc.id;
    div.className = 'msg ' + (mine ? 'me' : 'other');
    const time = m.createdAt ? m.createdAt.toDate().toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'}) : '';

    let inner = '';
    if (m.replyTo) {
      inner += `<div class="replyQuote"><b>Ответ:</b> ${escapeHtml(m.replyTo.text || 'Медиафайл')}</div>`;
    }
    if (m.image) inner += `<img src="${m.image}" class="chatImage">`;
    if (m.sticker) inner += `<img src="${m.sticker}" class="chatSticker" style="max-width:120px; max-height:120px; display:block; cursor:pointer;">`;
    if (m.audio) inner += `<audio controls src="${m.audio}"></audio>`;
    if (m.text) inner += formatMessageTextWithMentions(m.text) + (m.isEdited ? ' <small style="opacity:0.6">(изм.)</small>' : '');

    let ticks = '';
    if (mine) {
      ticks = `<span class="ticks" title="${m.read ? 'Просмотрено' : 'Отправлено'}">${m.read ? '✓✓' : '✓'}</span>`;
    }

    inner += `<span class="t">${time} ${ticks}</span>`;

    inner += `
      <div class="msgActions">
        <button class="replyBtn" title="Ответить">↩️</button>
        ${m.text ? '<button class="copyBtn" title="Копировать">📋</button>' : ''}
        <button class="pinBtn" title="Закрепить">📌</button>
        ${mine && m.text ? '<button class="editBtn" title="Редактировать">✏️</button>' : ''}
        ${m.sticker && !myStickers.includes(m.sticker) ? '<button class="saveStickerBtn" title="Сохранить стикер">⭐</button>' : ''}
        ${mine ? '<button class="delBtn" title="Удалить">✕</button>' : ''}
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
        openLightbox(m.image);
      };
    }

    const stickerEl = div.querySelector('.chatSticker');
    if (stickerEl) {
      stickerEl.onclick = (e) => {
        e.stopPropagation();
        openLightbox(m.sticker);
      };
    }

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
        copyBtn.textContent = '✓';
        setTimeout(() => { copyBtn.textContent = '📋'; svgifyEmoji(copyBtn); }, 900);
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
    REACTION_EMOJIS.forEach(emoji => {
      const sp = document.createElement('span');
      sp.textContent = emoji;
      sp.onclick = (e) => {
        e.stopPropagation();
        const already = ((m.reactions && m.reactions[emoji]) || []).includes(currentUser.uid);
        toggleReaction(collectionRef, doc.id, emoji, already);
        bar.classList.remove('show');
      };
      bar.appendChild(sp);
    });

    div.onclick = () => toggleEmojiBar(bar);
    div.ondblclick = (e) => {
      e.stopPropagation();
      const already = ((m.reactions && m.reactions['❤️']) || []).includes(currentUser.uid);
      if (!already) toggleReaction(collectionRef, doc.id, '❤️', false);
      burstHeart(div);
    };
    wrap.appendChild(div);

    if (m.gift) {
      const giftPanel = document.createElement('div');
      giftPanel.className = 'giftCard';
      giftPanel.innerHTML = `
        <div class="giftEmoji">${escapeHtml(m.gift.emoji || '')}</div>
        <div class="giftTitle">${escapeHtml(m.gift.title || 'Подарок')}</div>
      `;
      wrap.insertBefore(giftPanel, div.nextSibling);
    }

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

    svgifyEmoji(wrap);
    return { wrap, sig: JSON.stringify(m) };
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
      const sig = JSON.stringify(m);

      if (!entry) {
        entry = buildMessageEl(doc, hasRenderedInitial);
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
    const dataToSave = { ...msgData, id: msgId };
    const targetRef = isGrp ? db.collection('groups').doc(chatId) : db.collection('chats').doc(chatId);
    await targetRef.set({ pinnedMsg: dataToSave }, { merge: true });
  }

  function startEditMessage(msgId, text) {
    editingMsgId = msgId;
    const input = document.getElementById('msgInput');
    if (input) {
      input.value = text;
      input.focus();
    }
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

  async function sendGift(giftData) {
    if (!giftData || !activeCollectionRef || !currentUser) return;
    await activeCollectionRef.add({
      senderId: currentUser.uid,
      from: currentUser.uid,
      createdAt: firebase.firestore.FieldValue.serverTimestamp(),
      read: false,
      gift: giftData
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
    };
  }
}

function openLightbox(src) {
  const lightbox = document.getElementById('lightbox');
  const img = document.getElementById('lightboxImg');
  img.src = src;
  lightbox.classList.add('show');
}
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
});

document.getElementById('stickerFileInput').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  e.target.value = '';
  if (!file || !currentUser) return;
  const stickerData = await resizeImage(file, 800, 0.8);
  await addStickerToLibrary(stickerData);
  if (document.getElementById('chatStickerPickerPanel')) {
    document.getElementById('chatStickerPickerPanel').classList.add('show');
  }
});