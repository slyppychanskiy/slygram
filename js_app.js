const firebaseConfig = {
  apiKey: "AIzaSyAQJ1aWmizhddQINv9ilTEb-mKLXR6Yn1c",
  authDomain: "slygram-a10d1.firebaseapp.com",
  projectId: "slygram-a10d1",
  storageBucket: "slygram-a10d1.firebasestorage.app",
  messagingSenderId: "352496417787",
  appId: "1:352496417787:web:3902f252ab1fb1fe29295e"
};
firebase.initializeApp(firebaseConfig);
const auth = firebase.auth();
const db = firebase.firestore();

const AVATAR_COLORS = ['#1B3A8C','#B23A2E','#2E7D32','#8E44AD','#B8860B','#455A64'];
const BORDER_COLORS = ['#1C1A16','#B23A2E','#1B3A8C','#00FF66','#FF0055','#E54B4B'];

let isLogin = true;
let isRegistering = false;
let currentUser = null;
let myUsername = null;
let myColor = AVATAR_COLORS[0];
let myBorderColor = BORDER_COLORS[0];
let myPhoto = null;
let myTheme = 'paper';
let customAvatarData = null;

let myFriends = [];
let myGroups = [];
let incomingRequests = [];
let activeChatWith = null;
let unsubMessages = null;
let unsubFriendsA = null, unsubFriendsB = null;
let unsubRequests = null;
let unsubGroups = null;
let unsubChatMeta = null;
let activeTab = 'chats';
let friendsAccepted = { asFrom: [], asTo: [] };
let pendingImage = null;
let editingMsgId = null;
let replyingToMsg = null;

let mediaRecorder = null;
let audioChunks = [];
let isRecording = false;

/* ---------------- AUTH UI ---------------- */
const authTitle = document.getElementById('authTitle');
const authSubtitle = document.getElementById('authSubtitle');
const usernameInput = document.getElementById('usernameInput');
const emailInput = document.getElementById('emailInput');
const passInput = document.getElementById('passInput');
const authErr = document.getElementById('authErr');
const authSwitch = document.getElementById('authSwitch');
const authSubmitBtn = document.getElementById('authSubmitBtn');

authSwitch.onclick = () => {
  isLogin = !isLogin;
  authTitle.textContent = isLogin ? 'Вход' : 'Регистрация';
  authSubtitle.textContent = isLogin ? 'Войдите, чтобы продолжить' : 'Придумайте данные для входа';
  usernameInput.style.display = isLogin ? 'none' : 'block';
  authSubmitBtn.textContent = isLogin ? 'Войти' : 'Зарегистрироваться';
  authSwitch.innerHTML = isLogin ? 'Нет аккаунта? <b>Зарегистрироваться</b>' : 'Уже есть аккаунт? <b>Войти</b>';
  authErr.textContent = '';
};

authSubmitBtn.onclick = async () => {
  authErr.textContent = '';
  const email = emailInput.value.trim();
  const pass = passInput.value;
  if (!email || !pass) { authErr.textContent = 'Заполните email и пароль'; return; }

  const originalText = authSubmitBtn.textContent;
  authSubmitBtn.disabled = true;

  try {
    if (isLogin) {
      await auth.signInWithEmailAndPassword(email, pass);
    } else {
      const username = usernameInput.value.trim().toLowerCase();
      if (!/^[a-z0-9_]{3,20}$/.test(username)) {
        authErr.textContent = 'Юзернейм: 3-20 символов, латиница/цифры/_';
        return;
      }
      const taken = await db.collection('usernames').doc(username).get();
      if (taken.exists) { authErr.textContent = 'Этот юзернейм уже занят'; return; }

      isRegistering = true;
      const color = AVATAR_COLORS[Math.floor(Math.random()*AVATAR_COLORS.length)];
      const cred = await auth.createUserWithEmailAndPassword(email, pass);
      const uid = cred.user.uid;

      await db.collection('usernames').doc(username).set({ uid: uid });
      await db.collection('users').doc(uid).set({
        username, email, color, photo: null, theme: 'paper', borderColor: BORDER_COLORS[0],
        createdAt: firebase.firestore.FieldValue.serverTimestamp()
      });

      isRegistering = false;
      await enterApp(cred.user, username, color, null, 'paper', BORDER_COLORS[0]);
    }
  } catch (e) {
    authErr.textContent = translateError(e.code) || e.message;
  } finally {
    isRegistering = false;
    authSubmitBtn.disabled = false;
    authSubmitBtn.textContent = originalText;
  }
};

function translateError(code){
  const map = {
    'auth/email-already-in-use': 'Этот email уже используется',
    'auth/invalid-email': 'Некорректный email',
    'auth/weak-password': 'Пароль слишком простой (мин. 6 символов)',
    'auth/user-not-found': 'Пользователь не найден',
    'auth/wrong-password': 'Неверный пароль'
  };
  return map[code];
}

document.getElementById('logoutBtn').onclick = () => auth.signOut();

async function enterApp(user, username, color, photo, theme, borderColor){
  currentUser = user;
  myUsername = username;
  myColor = color || AVATAR_COLORS[0];
  myBorderColor = borderColor || BORDER_COLORS[0];
  myPhoto = photo || null;
  myTheme = theme || 'paper';
  
  applyTheme(myTheme, myBorderColor);
  
  document.getElementById('authScreen').style.display = 'none';
  document.getElementById('mainScreen').style.display = 'flex';
  document.getElementById('myName').textContent = '@' + myUsername;
  
  renderAvatar(document.getElementById('myAvatar'), myUsername, myColor, myPhoto);
  
  updateUserPresence();
  listenFriends();
  listenRequests();
  listenGroups();
}

function updateUserPresence() {
  if (!currentUser) return;
  const userRef = db.collection('users').doc(currentUser.uid);
  userRef.update({ lastOnline: firebase.firestore.FieldValue.serverTimestamp() });
  setInterval(() => {
    if (currentUser) userRef.update({ lastOnline: firebase.firestore.FieldValue.serverTimestamp() });
  }, 15000);
}

function applyTheme(theme, borderColor) {
  document.body.className = '';
  if (theme && theme !== 'paper') {
    document.body.classList.add('theme-' + theme);
  }
  if (borderColor) {
    document.documentElement.style.setProperty('--ink', borderColor);
  }
}

function renderAvatar(el, username, color, photo, isOnline = false) {
  if (!el) return;
  if (photo) {
    el.style.backgroundImage = `url(${photo})`;
    el.textContent = '';
  } else {
    el.style.backgroundImage = 'none';
    el.style.background = color || '#1B3A8C';
    el.textContent = username ? username[0].toUpperCase() : '?';
  }
  let dot = el.querySelector('.onlineStatus');
  if (isOnline) {
    if (!dot) {
      dot = document.createElement('div');
      dot.className = 'onlineStatus';
      el.appendChild(dot);
    }
  } else if (dot) {
    dot.remove();
  }
}

auth.onAuthStateChanged(async (user) => {
  if (user) {
    if (isRegistering) return;
    currentUser = user;
    const doc = await db.collection('users').doc(user.uid).get();
    if (!doc.exists) {
      auth.signOut();
      return;
    }
    const d = doc.data();
    await enterApp(user, d.username, d.color, d.photo, d.theme, d.borderColor);
  } else {
    currentUser = null; myUsername = null;
    if (unsubFriendsA) unsubFriendsA();
    if (unsubFriendsB) unsubFriendsB();
    if (unsubRequests) unsubRequests();
    if (unsubMessages) unsubMessages();
    if (unsubChatMeta) unsubChatMeta();
    if (unsubGroups) unsubGroups();
    document.getElementById('authScreen').style.display = 'flex';
    document.getElementById('mainScreen').style.display = 'none';
  }
});

/* ---------------- ПРОФИЛЬ ---------------- */
const profileModal = document.getElementById('profileModal');
const colorRow = document.getElementById('colorRow');
const borderColorRow = document.getElementById('borderColorRow');
let pickedColor = myColor;
let pickedBorderColor = myBorderColor;

AVATAR_COLORS.forEach(c => {
  const dot = document.createElement('div');
  dot.className = 'colorDot';
  dot.style.background = c;
  dot.onclick = () => {
    pickedColor = c;
    colorRow.querySelectorAll('.colorDot').forEach(d=>d.classList.remove('picked'));
    dot.classList.add('picked');
  };
  colorRow.appendChild(dot);
});

BORDER_COLORS.forEach(c => {
  const dot = document.createElement('div');
  dot.className = 'colorDot';
  dot.style.background = c;
  dot.onclick = () => {
    pickedBorderColor = c;
    borderColorRow.querySelectorAll('.colorDot').forEach(d=>d.classList.remove('picked'));
    dot.classList.add('picked');
  };
  borderColorRow.appendChild(dot);
});

document.getElementById('me').onclick = () => {
  document.getElementById('editUsername').value = myUsername;
  document.getElementById('themeSelect').value = myTheme || 'paper';
  pickedColor = myColor;
  pickedBorderColor = myBorderColor;
  customAvatarData = myPhoto;
  
  renderAvatar(document.getElementById('editAvatarPreview'), myUsername, pickedColor, customAvatarData);
  colorRow.querySelectorAll('.colorDot').forEach(d => d.classList.toggle('picked', d.style.background === myColor));
  borderColorRow.querySelectorAll('.colorDot').forEach(d => d.classList.toggle('picked', d.style.background === myBorderColor));
  document.getElementById('profileErr').textContent = '';
  profileModal.classList.add('show');
};

document.getElementById('uploadAvatarBtn').onclick = () => document.getElementById('avatarFileInput').click();
document.getElementById('avatarFileInput').onchange = async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  customAvatarData = await resizeImage(file, 200, 0.7);
  renderAvatar(document.getElementById('editAvatarPreview'), myUsername, pickedColor, customAvatarData);
};
document.getElementById('removeAvatarBtn').onclick = () => {
  customAvatarData = null;
  renderAvatar(document.getElementById('editAvatarPreview'), myUsername, pickedColor, null);
};

document.getElementById('profileCloseBtn').onclick = () => profileModal.classList.remove('show');

document.getElementById('profileSaveBtn').onclick = async () => {
  const errEl = document.getElementById('profileErr');
  errEl.textContent = '';
  const newUsername = document.getElementById('editUsername').value.trim().toLowerCase();
  const selectedTheme = document.getElementById('themeSelect').value;

  if (!/^[a-z0-9_]{3,20}$/.test(newUsername)) {
    errEl.textContent = 'Юзернейм: 3-20 символов, латиница/цифры/_';
    return;
  }
  try {
    if (newUsername !== myUsername) {
      const taken = await db.collection('usernames').doc(newUsername).get();
      if (taken.exists) { errEl.textContent = 'Этот юзернейм уже занят'; return; }
      await db.collection('usernames').doc(newUsername).set({ uid: currentUser.uid });
      await db.collection('usernames').doc(myUsername).delete();
    }
    
    await db.collection('users').doc(currentUser.uid).update({
      username: newUsername,
      color: pickedColor,
      borderColor: pickedBorderColor,
      photo: customAvatarData,
      theme: selectedTheme
    });

    myUsername = newUsername; myColor = pickedColor; myBorderColor = pickedBorderColor; myPhoto = customAvatarData; myTheme = selectedTheme;
    applyTheme(myTheme, myBorderColor);

    document.getElementById('myName').textContent = '@' + myUsername;
    renderAvatar(document.getElementById('myAvatar'), myUsername, myColor, myPhoto);

    profileModal.classList.remove('show');
  } catch (e) {
    errEl.textContent = e.message || 'Ошибка сохранения';
  }
};

/* ---------------- ДОБАВЛЕНИЕ В ДРУЗЬЯ ---------------- */
document.getElementById('addFriendBtn').onclick = async () => {
  const input = document.getElementById('friendInput');
  const target = input.value.trim().toLowerCase();
  if (!target || target === myUsername) return;

  if (myFriends.some(f => f.username.toLowerCase() === target)) {
    alert('Этот пользователь уже у вас в друзьях!');
    return;
  }

  const targetDoc = await db.collection('usernames').doc(target).get();
  if (!targetDoc.exists) { alert('Пользователь не найден'); return; }

  const targetUid = targetDoc.data().uid;
  const reqId = `${currentUser.uid}_${targetUid}`;

  const existing = await db.collection('friendRequests').doc(reqId).get();
  if (existing.exists && existing.data().status === 'pending') {
    alert('Заявка уже отправлена и ожидает ответа!');
    return;
  }

  await db.collection('friendRequests').doc(reqId).set({
    senderId: currentUser.uid,
    receiverId: targetUid,
    from: currentUser.uid, 
    fromUsername: myUsername,
    to: targetUid, 
    toUsername: target, 
    status: 'pending',
    createdAt: firebase.firestore.FieldValue.serverTimestamp()
  });
  input.value = '';
  alert('Заявка отправлена!');
};

document.getElementById('searchInput').oninput = (e) => {
  renderList(e.target.value.trim().toLowerCase());
};

/* ---------------- ЗАЯВКИ И СПИСОК ---------------- */
function listenRequests(){
  unsubRequests = db.collection('friendRequests')
    .where('receiverId', '==', currentUser.uid)
    .where('status', '==', 'pending')
    .onSnapshot(snap => {
      incomingRequests = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      document.getElementById('reqBadge').textContent = incomingRequests.length ? `(${incomingRequests.length})` : '';
      if (activeTab === 'requests') renderList();
    });
}

function listenGroups(){
  unsubGroups = db.collection('groups')
    .where('members', 'array-contains', currentUser.uid)
    .onSnapshot(snap => {
      myGroups = snap.docs.map(d => ({ id: d.id, ...d.data(), isGroup: true }));
      if (activeTab === 'groups') renderList();
    });
}

async function acceptRequest(req){
  await db.collection('friendRequests').doc(req.id).update({ status: 'accepted' });
}
async function declineRequest(req){
  await db.collection('friendRequests').doc(req.id).update({ status: 'declined' });
}

async function rebuildFriendsList(){
  const map = new Map();
  friendsAccepted.asFrom.forEach(r => map.set(r.to || r.receiverId, r.toUsername));
  friendsAccepted.asTo.forEach(r => map.set(r.from || r.senderId, r.fromUsername));
  const uids = [...map.keys()];
  if (uids.length === 0) { myFriends = []; if (activeTab==='chats') renderList(); return; }
  const docs = await Promise.all(uids.map(uid => db.collection('users').doc(uid).get()));
  myFriends = docs.filter(d=>d.exists).map(d => ({ uid: d.id, ...d.data() }));
  if (activeTab === 'chats') renderList();
}

function listenFriends(){
  unsubFriendsA = db.collection('friendRequests')
    .where('senderId','==',currentUser.uid).where('status','==','accepted')
    .onSnapshot(snap => { friendsAccepted.asFrom = snap.docs.map(d=>d.data()); rebuildFriendsList(); });
  unsubFriendsB = db.collection('friendRequests')
    .where('receiverId','==',currentUser.uid).where('status','==','accepted')
    .onSnapshot(snap => { friendsAccepted.asTo = snap.docs.map(d=>d.data()); rebuildFriendsList(); });
}

document.querySelectorAll('.tab').forEach(tab => {
  tab.onclick = () => {
    document.querySelectorAll('.tab').forEach(t=>t.classList.remove('active'));
    tab.classList.add('active');
    activeTab = tab.dataset.tab;

    document.getElementById('addFriendBox').style.display = activeTab === 'chats' ? 'flex' : 'none';
    document.getElementById('createGroupBar').style.display = activeTab === 'groups' ? 'flex' : 'none';

    renderList();
  };
});

function renderList(filter = ''){
  const list = document.getElementById('list');
  list.innerHTML = '';
  
  if (activeTab === 'chats') {
    const filtered = myFriends.filter(f => f.username.toLowerCase().includes(filter));
    if (filtered.length === 0) {
      list.innerHTML = '<div class="empty">Чаты не найдены</div>';
      return;
    }
    filtered.forEach(f => {
      const row = document.createElement('div');
      row.className = 'row' + (activeChatWith && activeChatWith.uid === f.uid ? ' active' : '');
      const avContainer = document.createElement('div');
      avContainer.className = 'avatar';
      
      const isOnline = f.lastOnline && (Date.now() - f.lastOnline.toMillis() < 45000);
      renderAvatar(avContainer, f.username, f.color, f.photo, isOnline);

      row.appendChild(avContainer);
      row.innerHTML += `<div class="rowInfo"><div class="n">@${f.username}</div><div class="s">${isOnline ? 'В сети' : formatLastOnline(f.lastOnline)}</div></div>`;
      row.onclick = () => openChat(f);
      list.appendChild(row);
    });
  } else if (activeTab === 'groups') {
    const filtered = myGroups.filter(g => g.name.toLowerCase().includes(filter));
    if (filtered.length === 0) {
      list.innerHTML = '<div class="empty">Группы и каналы не найдены</div>';
      return;
    }
    filtered.forEach(g => {
      const row = document.createElement('div');
      row.className = 'row' + (activeChatWith && activeChatWith.id === g.id ? ' active' : '');
      const avContainer = document.createElement('div');
      avContainer.className = 'avatar';
      avContainer.textContent = g.type === 'channel' ? '📢' : '👥';

      row.appendChild(avContainer);
      row.innerHTML += `<div class="rowInfo"><div class="n">${escapeHtml(g.name)}</div><div class="s">${g.type === 'channel' ? 'Канал' : 'Группа'} • ${g.members ? g.members.length : 1} участн.</div></div>`;
      row.onclick = () => openGroupChat(g);
      list.appendChild(row);
    });
  } else {
    if (incomingRequests.length === 0) {
      list.innerHTML = '<div class="empty">Нет заявок</div>';
      return;
    }
    incomingRequests.forEach(r => {
      const row = document.createElement('div');
      row.className = 'row';
      row.innerHTML = `
        <div class="avatar">${r.fromUsername[0].toUpperCase()}</div>
        <div class="rowInfo"><div class="n">@${r.fromUsername}</div><div class="s">Хочет дружить</div></div>
        <div class="reqBtns">
          <button class="accept">✓</button>
          <button class="decline">✕</button>
        </div>
      `;
      row.querySelector('.accept').onclick = (e) => { e.stopPropagation(); acceptRequest(r); };
      row.querySelector('.decline').onclick = (e) => { e.stopPropagation(); declineRequest(r); };
      list.appendChild(row);
    });
  }
}

function formatLastOnline(ts) {
  if (!ts) return 'Офлайн';
  const d = ts.toDate();
  return 'Был(а) ' + d.toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'});
}

/* ---------------- СОЗДАНИЕ ГРУПП И КАНАЛОВ ---------------- */
const groupModal = document.getElementById('groupModal');
document.getElementById('openGroupModalBtn').onclick = () => {
  const container = document.getElementById('groupMemberList');
  container.innerHTML = '';
  myFriends.forEach(f => {
    container.innerHTML += `
      <div class="memberCheckItem">
        <input type="checkbox" value="${f.uid}" id="m_${f.uid}">
        <label for="m_${f.uid}">@${f.username}</label>
      </div>
    `;
  });
  document.getElementById('groupNameInput').value = '';
  document.getElementById('groupErr').textContent = '';
  groupModal.classList.add('show');
};
document.getElementById('groupCloseBtn').onclick = () => groupModal.classList.remove('show');

document.getElementById('groupCreateSaveBtn').onclick = async () => {
  const name = document.getElementById('groupNameInput').value.trim();
  const type = document.getElementById('groupTypeSelect').value;
  if (!name) { document.getElementById('groupErr').textContent = 'Введите название'; return; }

  const checked = Array.from(document.querySelectorAll('#groupMemberList input:checked')).map(i => i.value);
  if (!checked.includes(currentUser.uid)) {
    checked.push(currentUser.uid);
  }

  try {
    await db.collection('groups').add({
      name: name,
      type: type,
      owner: currentUser.uid,
      members: checked,
      createdAt: firebase.firestore.FieldValue.serverTimestamp()
    });

    groupModal.classList.remove('show');
  } catch (err) {
    document.getElementById('groupErr').textContent = 'Ошибка: ' + err.message;
  }
};

/* ---------------- ЧАТ И ИНДИКАТОР ПЕЧАТИ ---------------- */
const REACTION_EMOJIS = ['👍','❤️','😂','😮','🔥'];
function chatIdFor(uidA, uidB){ return [uidA, uidB].sort().join('_'); }

async function openChat(friend){
  activeChatWith = friend;
  const cid = chatIdFor(currentUser.uid, friend.uid);
  
  await db.collection('chats').doc(cid).set({
    participants: [currentUser.uid, friend.uid]
  }, { merge: true });

  setupChatLayout(friend.username, false, friend);
}

function openGroupChat(group){
  activeChatWith = group;
  setupChatLayout(group.name, true, group);
}

function setupChatLayout(titleText, isGroup = false, targetObj = null) {
  editingMsgId = null;
  replyingToMsg = null;
  document.body.classList.add('chatOpen');
  renderList();

  const chatArea = document.getElementById('chatArea');
  const cid = isGroup ? targetObj.id : chatIdFor(currentUser.uid, targetObj.uid);
  const collectionRef = isGroup ? db.collection('groups').doc(cid).collection('messages') : db.collection('chats').doc(cid).collection('messages');

  const canWrite = !isGroup || targetObj.type !== 'channel' || targetObj.owner === currentUser.uid;

  chatArea.innerHTML = `
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
        <button id="searchMsgToggleBtn" style="border:2px solid var(--ink); background:var(--paper); cursor:pointer; padding:4px 8px;">🔍</button>
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
    <div id="messages"></div>
    <div id="replyBar">
      <span id="replyTextPreview">Ответ на сообщение...</span>
      <button id="replyCancelBtn" style="border:1px solid var(--ink); background:var(--paper); cursor:pointer;">✕</button>
    </div>
    <div id="imgPreviewBar"><img id="imgPreviewThumb"><span>Картинка готова</span><button id="imgCancelBtn">Убрать</button></div>
    ${canWrite ? `
    <div id="inputBar">
      <button class="iconBtn" id="attachBtn" title="Фото">📎</button>
      <button class="iconBtn" id="voiceBtn" title="Голосовое сообщение">🎙️</button>
      <input id="msgInput" type="text" placeholder="Сообщение...">
      <button id="sendBtn">➤</button>
    </div>` : `<div style="padding:15px; text-align:center; color:var(--muted); background:var(--paper2); border-top:2px solid var(--ink); font-size:12px;">Только администратор может отправлять сообщения в этот канал.</div>`}
  `;

  if (!isGroup) {
    renderAvatar(document.getElementById('hdrAvatar'), targetObj.username, targetObj.color, targetObj.photo);
  } else {
    const av = document.getElementById('hdrAvatar');
    if (av) av.textContent = targetObj.type === 'channel' ? '📢' : '👥';
  }

  document.getElementById('backBtn').onclick = () => document.body.classList.remove('chatOpen');

  const searchBtn = document.getElementById('searchMsgToggleBtn');
  const searchPanel = document.getElementById('chatSearchPanel');
  searchBtn.onclick = () => searchPanel.classList.toggle('show');
  document.getElementById('chatSearchClose').onclick = () => {
    searchPanel.classList.remove('show');
    document.getElementById('chatSearchInput').value = '';
    renderMessages(currentSnapshotDocs);
  };
  document.getElementById('chatSearchInput').oninput = (e) => {
    const val = e.target.value.toLowerCase();
    renderMessages(currentSnapshotDocs, val);
  };

  const metaDocRef = isGroup ? db.collection('groups').doc(cid) : db.collection('chats').doc(cid);
  if (unsubChatMeta) unsubChatMeta();
  unsubChatMeta = metaDocRef.onSnapshot(doc => {
    if (!doc.exists) return;
    const data = doc.data();
    const ind = document.getElementById('typingIndicator');
    const pinnedBar = document.getElementById('pinnedBar');
    const pinnedContent = document.getElementById('pinnedContent');

    if (!isGroup) {
      const t = data.typing || {};
      const otherTs = t[targetObj.uid];
      if (ind) {
        if (otherTs && (Date.now() - otherTs.toMillis()) < 3500) {
          ind.innerHTML = `печатает<span class="typingDots"><span>.</span><span>.</span><span>.</span></span>`;
        } else {
          ind.textContent = '';
        }
      }
    }

    if (data.pinnedMsg) {
      pinnedBar.classList.add('show');
      pinnedContent.textContent = "📌 " + (data.pinnedMsg.text || (data.pinnedMsg.audio ? "Голосовое сообщение" : "Изображение"));
      pinnedBar.onclick = () => {
        if (data.pinnedMsg.id) {
          const el = document.getElementById('msg_' + data.pinnedMsg.id);
          if (el) {
            el.scrollIntoView({ behavior: 'smooth', block: 'center' });
            el.classList.add('highlight');
            setTimeout(() => el.classList.remove('highlight'), 2000);
          }
        }
      };
      document.getElementById('unpinBtn').onclick = (e) => {
        e.stopPropagation();
        metaDocRef.update({ pinnedMsg: firebase.firestore.FieldValue.delete() });
      };
    } else {
      pinnedBar.classList.remove('show');
    }
  });

  let currentSnapshotDocs = [];
  if (unsubMessages) unsubMessages();
  unsubMessages = collectionRef.orderBy('createdAt', 'asc').onSnapshot(snap => {
    currentSnapshotDocs = snap.docs;
    renderMessages(currentSnapshotDocs);

    snap.docs.forEach(d => {
      const m = d.data();
      const sender = m.senderId || m.from;
      if (sender !== currentUser.uid && !m.read) {
        d.ref.update({ read: true });
      }
    });
  });

  function renderMessages(docs, filterText = '') {
    const box = document.getElementById('messages');
    if (!box) return;
    box.innerHTML = '';

    docs.forEach(doc => {
      const m = doc.data();
      if (filterText && m.text && !m.text.toLowerCase().includes(filterText)) return;

      const sender = m.senderId || m.from;
      const mine = sender === currentUser.uid;
      const wrap = document.createElement('div');
      wrap.className = 'msgWrap ' + (mine ? 'me' : 'other');

      const div = document.createElement('div');
      div.id = 'msg_' + doc.id;
      div.className = 'msg ' + (mine ? 'me' : 'other');
      const time = m.createdAt ? m.createdAt.toDate().toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'}) : '';
      
      let inner = '';
      if (m.replyTo) {
        inner += `<div class="replyQuote"><b>Ответ:</b> ${escapeHtml(m.replyTo.text || 'Медиафайл')}</div>`;
      }
      if (m.image) inner += `<img src="${m.image}" class="chatImage">`;
      if (m.audio) inner += `<audio controls src="${m.audio}"></audio>`;
      if (m.text) inner += escapeHtml(m.text) + (m.isEdited ? ' <small style="opacity:0.6">(изм.)</small>' : '');
      
      let ticks = '';
      if (mine) {
        ticks = `<span class="ticks" title="${m.read ? 'Просмотрено' : 'Отправлено'}">${m.read ? '✓✓' : '✓'}</span>`;
      }

      inner += `<span class="t">${time} ${ticks}</span>`;
      
      inner += `
        <div class="msgActions">
          <button class="replyBtn" title="Ответить">↩️</button>
          <button class="pinBtn" title="Закрепить">📌</button>
          ${mine && m.text ? '<button class="editBtn" title="Редактировать">✏️</button>' : ''}
          ${mine ? '<button class="delBtn" title="Удалить">✕</button>' : ''}
        </div>
      `;
      
      div.innerHTML = inner;

      const imgEl = div.querySelector('.chatImage');
      if (imgEl) {
        imgEl.onclick = (e) => {
          e.stopPropagation();
          openLightbox(m.image);
        };
      }

      const replyBtn = div.querySelector('.replyBtn');
      if (replyBtn) replyBtn.onclick = (e) => { e.stopPropagation(); startReply(m); };

      const pinBtn = div.querySelector('.pinBtn');
      if (pinBtn) pinBtn.onclick = (e) => { e.stopPropagation(); pinMessage(cid, doc.id, m, isGroup); };

      if (mine) {
        const del = div.querySelector('.delBtn');
        if (del) del.onclick = (e) => { e.stopPropagation(); deleteMessage(collectionRef, doc.id); };

        const edit = div.querySelector('.editBtn');
        if (edit) edit.onclick = (e) => { e.stopPropagation(); startEditMessage(doc.id, m.text); };
      }

      div.onclick = () => toggleEmojiBar(bar);
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
      wrap.appendChild(bar);

      box.appendChild(wrap);
    });
    box.scrollTop = box.scrollHeight;
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
        input.focus(); // <--- Фокус возвращается в поле ввода, клавиатура не прячется
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
      input.focus(); // <--- Фокус удерживается в поле ввода после отправки сообщения
    };

    document.getElementById('sendBtn').onclick = send;
    const msgInput = document.getElementById('msgInput');
    msgInput.addEventListener('keydown', e => { 
      if (e.key === 'Enter') {
        e.preventDefault(); // Предотвращаем дефолтное поведение формы/энтера
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

function resizeImage(file, maxDim, quality){
  return new Promise((resolve, reject) => {
    const img = new Image();
    const reader = new FileReader();
    reader.onload = () => {
      img.onload = () => {
        let { width, height } = img;
        if (width > maxDim || height > maxDim) {
          if (width > height) { height = Math.round(height * maxDim / width); width = maxDim; }
          else { width = Math.round(width * maxDim / height); height = maxDim; }
        }
        const canvas = document.createElement('canvas');
        canvas.width = width; canvas.height = height;
        canvas.getContext('2d').drawImage(img, 0, 0, width, height);
        resolve(canvas.toDataURL('image/jpeg', quality));
      };
      img.onerror = reject;
      img.src = reader.result;
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

function escapeHtml(str){
  if (!str) return '';
  const d = document.createElement('div');
  d.textContent = str;
  return d.innerHTML;
}