let isLogin = true;
let isRegistering = false;
let currentUser = null;
let myUsername = null;
let myColor = AVATAR_COLORS[0];
let myPhoto = null;
let myBanner = null;
let myTheme = 'slygram';
let myBio = '';
let myChannels = [];
let myStories = [];
let myFeaturedChannel = null;
let myStickers = []; // Массив кастомных стикеров пользователя
let myHideOnline = false;
let customAvatarData = null;
let customBannerData = null;

let myFriends = []; // контакты (люди, с которыми есть переписка)
let myGroups = [];
let activeTab = 'chats';
let unsubChats = null;
let unsubGroups = null;
let userSearchDebounce = null;

/* ---------------- ПРЕВЬЮ ПОСЛЕДНЕГО СООБЩЕНИЯ В СПИСКЕ ЧАТОВ ---------------- */
let lastMsgCache = {};   // key -> { text, time, senderId }
let lastMsgUnsubs = {};  // key -> unsubscribe fn

function previewTextFor(d) {
  if (d.text) return d.text;
  if (d.storyReply) return '↪️ Ответ на историю';
  if (d.image) return '📷 Фото';
  if (d.sticker) return '🌟 Стикер';
  if (d.audio) return '🎙️ Голосовое сообщение';
  return 'Сообщение';
}

function formatMsgTime(ts) {
  if (!ts || !ts.toDate) return '';
  const d = ts.toDate();
  const now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  if (sameDay) return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  return d.toLocaleDateString([], { day: '2-digit', month: '2-digit' });
}

function subscribeLastMessage(key, colRef, refreshTab) {
  if (lastMsgUnsubs[key]) return;
  lastMsgUnsubs[key] = colRef.orderBy('createdAt', 'desc').limit(1).onSnapshot(snap => {
    if (snap.empty) {
      lastMsgCache[key] = null;
    } else {
      const d = snap.docs[0].data();
      lastMsgCache[key] = {
        preview: (d.forwarded ? '↪️ ' : '') + previewTextFor(d),
        time: d.createdAt || null,
        senderId: d.senderId || d.from
      };
    }
    if (activeTab === refreshTab) {
      const filterVal = (document.getElementById('searchInput')?.value || '').trim().toLowerCase();
      renderList(filterVal);
    }
  }, () => {});
}

function pruneLastMsgSubs(prefix, keepIds) {
  const keepSet = new Set(keepIds.map(id => prefix + id));
  Object.keys(lastMsgUnsubs).forEach(key => {
    if (key.startsWith(prefix) && !keepSet.has(key)) {
      lastMsgUnsubs[key]();
      delete lastMsgUnsubs[key];
      delete lastMsgCache[key];
    }
  });
}

function clearAllLastMsgSubs() {
  Object.values(lastMsgUnsubs).forEach(fn => { try { fn(); } catch (e) {} });
  lastMsgUnsubs = {};
  lastMsgCache = {};
}

/* ---------------- SVG-ЭМОДЗИ (TWEMOJI) ---------------- */
function svgifyEmoji(el) {
  if (window.twemoji && el) {
    twemoji.parse(el, { folder: 'svg', ext: '.svg', className: 'twemoji' });
  }
}

/* ---------------- ДВОЙНОЙ ТАП = БЫСТРЫЙ ❤️ ---------------- */
function burstHeart(targetEl) {
  const heart = document.createElement('div');
  heart.className = 'heartBurst';
  heart.textContent = '❤️';
  svgifyEmoji(heart);
  targetEl.appendChild(heart);
  heart.addEventListener('animationend', () => heart.remove());
}

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
        username, email, color, photo: null, banner: null, theme: 'slygram', bio: '', channels: [], stickers: [], hideOnline: false,
        createdAt: firebase.firestore.FieldValue.serverTimestamp()
      });

      isRegistering = false;
      await enterApp(cred.user, username, color, null, null, 'slygram', '', [], [], '', null, false);
    }
  } catch (e) {
    authErr.textContent = translateError(e.code) || e.message;
  } finally {
    isRegistering = false;
    authSubmitBtn.disabled = false;
    authSubmitBtn.textContent = originalText;
  }
};

async function enterApp(user, username, color, photo, banner, theme, bio, channels, stickers, stories, featuredChannel, hideOnline){
  currentUser = user;
  myUsername = username;
  myColor = color || AVATAR_COLORS[0];
  myPhoto = photo || null;
  myBanner = banner || null;
  myTheme = theme || 'slygram';
  myBio = bio || '';
  myChannels = channels || [];
  myStickers = stickers || [];
  myStories = stories || [];
  myFeaturedChannel = featuredChannel || null;
  myHideOnline = !!hideOnline;

  applyTheme(myTheme);

  document.getElementById('authScreen').style.display = 'none';
  document.getElementById('mainScreen').style.display = 'flex';
  document.getElementById('myName').textContent = '@' + myUsername;
  svgifyEmoji(document.getElementById('mainScreen'));

  renderAvatar(document.getElementById('myAvatar'), myUsername, myColor, myPhoto);
  renderStoryFeed();

  updateUserPresence();
  listenChats();
  listenGroups();
}

let presenceInterval = null;

function updateUserPresence() {
  if (!currentUser) return;
  const userRef = db.collection('users').doc(currentUser.uid);
  userRef.update({ lastOnline: firebase.firestore.FieldValue.serverTimestamp() });
  if (presenceInterval) clearInterval(presenceInterval);
  presenceInterval = setInterval(() => {
    if (currentUser) userRef.update({ lastOnline: firebase.firestore.FieldValue.serverTimestamp() });
  }, 15000);
}

function clearUserPresence() {
  if (presenceInterval) {
    clearInterval(presenceInterval);
    presenceInterval = null;
  }
}

function applyTheme(theme) {
  document.body.classList.forEach(cls => {
    if (cls.startsWith('theme-')) document.body.classList.remove(cls);
  });
  if (theme && theme !== 'paper') {
    document.body.classList.add('theme-' + theme);
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
    await enterApp(user, d.username, d.color, d.photo, d.banner, d.theme, d.bio, d.channels, d.stickers || [], d.stories || [], d.featuredChannel, d.hideOnline);
  } else {
    currentUser = null; myUsername = null;
    clearUserPresence();
    clearAllLastMsgSubs();
    if (unsubChats) unsubChats();
    if (unsubGroups) unsubGroups();
    document.getElementById('authScreen').style.display = 'flex';
    document.getElementById('mainScreen').style.display = 'none';
  }
});

/* ---------------- ПРОФИЛЬ ---------------- */
const profileModal = document.getElementById('profileModal');
const userProfileModal = document.getElementById('userProfileModal');
const settingsModal = document.getElementById('settingsModal');
let pickedColor = myColor;

/* ---------------- НАСТРОЙКИ ---------------- */
document.getElementById('settingsBtn').onclick = (e) => {
  e.stopPropagation();
  document.getElementById('themeSelect').value = myTheme || 'slygram';
  document.getElementById('hideOnlineToggle').checked = !!myHideOnline;
  document.getElementById('settingsErr').textContent = '';
  settingsModal.classList.add('show');
};
document.getElementById('settingsCloseBtn').onclick = () => settingsModal.classList.remove('show');

document.getElementById('themeSelect').onchange = async (e) => {
  const theme = e.target.value;
  applyTheme(theme);
  myTheme = theme;
  try { await db.collection('users').doc(currentUser.uid).update({ theme }); } catch (err) {}
};

document.getElementById('hideOnlineToggle').onchange = async (e) => {
  myHideOnline = e.target.checked;
  try { await db.collection('users').doc(currentUser.uid).update({ hideOnline: myHideOnline }); }
  catch (err) { document.getElementById('settingsErr').textContent = err.message; }
};

document.getElementById('settingsLogoutBtn').onclick = () => {
  settingsModal.classList.remove('show');
  auth.signOut();
};

function renderBannerPreview(el, bannerData) {
  if (!el) return;
  if (bannerData) {
    el.style.backgroundImage = `url(${bannerData})`;
    el.classList.add('has-banner');
  } else {
    el.style.backgroundImage = 'none';
    el.classList.remove('has-banner');
  }
}

document.getElementById('me').onclick = () => {
  document.getElementById('editUsername').value = myUsername;
  const editBioEl = document.getElementById('editBio');
  if (editBioEl) editBioEl.value = myBio || '';
  pickedColor = myColor;
  customAvatarData = myPhoto;
  customBannerData = myBanner;

  const featChSel = document.getElementById('editFeaturedChannel');
  if (featChSel) {
    featChSel.innerHTML = '<option value="">Нет</option>';
    myChannels.forEach(ch => {
      const opt = document.createElement('option');
      opt.value = ch.id;
      opt.textContent = ch.name;
      featChSel.appendChild(opt);
    });
    featChSel.value = myFeaturedChannel || '';
  }

  renderAvatar(document.getElementById('editAvatarPreview'), myUsername, pickedColor, customAvatarData);
  renderBannerPreview(document.getElementById('editBannerPreview'), customBannerData);

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

document.getElementById('uploadBannerBtn').onclick = () => document.getElementById('bannerFileInput').click();
document.getElementById('bannerFileInput').onchange = async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  customBannerData = await resizeImage(file, 900, 0.7);
  renderBannerPreview(document.getElementById('editBannerPreview'), customBannerData);
};
document.getElementById('removeBannerBtn').onclick = () => {
  customBannerData = null;
  renderBannerPreview(document.getElementById('editBannerPreview'), null);
};

document.getElementById('profileCloseBtn').onclick = () => profileModal.classList.remove('show');
document.getElementById('profileCancelBtn').onclick = () => profileModal.classList.remove('show');
const userProfileCloseBtn = document.getElementById('userProfileCloseBtn');
if (userProfileCloseBtn) {
  userProfileCloseBtn.onclick = () => userProfileModal.classList.remove('show');
}

let viewedProfileUser = null;

function openUserProfile(userObj) {
  if (!userObj) return;
  viewedProfileUser = userObj;
  renderBannerPreview(document.getElementById('viewUserBanner'), userObj.banner);
  document.getElementById('viewUsername').textContent = '@' + userObj.username;
  document.getElementById('viewUserBio').textContent = userObj.bio ? escapeHtml(userObj.bio) : 'Пользователь еще ничего не написал о себе.';

  const featuredWrap = document.getElementById('viewFeaturedChannel');
  if (featuredWrap) {
    const featured = userObj.featuredChannel ? myGroups.find(g => g.id === userObj.featuredChannel) : null;
    if (featured) {
      featuredWrap.style.display = 'flex';
      featuredWrap.textContent = `📢 ${escapeHtml(featured.name)}`;
      featuredWrap.onclick = () => {
        userProfileModal.classList.remove('show');
        openGroupChat(featured);
      };
      svgifyEmoji(featuredWrap);
    } else {
      featuredWrap.style.display = 'none';
      featuredWrap.onclick = null;
    }
  }

  const channelsContainer = document.getElementById('viewUserChannels');
  if (channelsContainer) {
    channelsContainer.innerHTML = '';
    const userChannels = userObj.channels || [];

    if (userChannels.length === 0) {
      channelsContainer.innerHTML = '<span style="color: var(--muted);">Нет каналов</span>';
    } else {
      userChannels.forEach(ch => {
        const chTag = document.createElement('div');
        chTag.style.cssText = 'padding: 4px 0; border-bottom: 1px dashed var(--ink); cursor: pointer; display: flex; justify-content: space-between; align-items: center;';
        chTag.innerHTML = `<span>📢 ${escapeHtml(ch.name)}</span> <small style="color: var(--muted);">Перейти →</small>`;
        chTag.onclick = () => {
          userProfileModal.classList.remove('show');
          const foundGroup = myGroups.find(g => g.id === ch.id);
          if (foundGroup) {
            openGroupChat(foundGroup);
          } else {
            alert('Вы не состоите в этом канале или он был удален.');
          }
        };
        channelsContainer.appendChild(chTag);
      });
    }
  }

  const isOnline = !userObj.hideOnline && userObj.lastOnline && (Date.now() - userObj.lastOnline.toMillis() < 45000);
  document.getElementById('viewUserStatus').textContent = isOnline ? 'В сети' : (userObj.hideOnline ? 'Офлайн' : formatLastOnline(userObj.lastOnline));

  renderAvatar(document.getElementById('viewUserAvatar'), userObj.username, userObj.color, userObj.photo);
  userProfileModal.classList.add('show');
}

const userProfileMessageBtn = document.getElementById('userProfileMessageBtn');
if (userProfileMessageBtn) {
  userProfileMessageBtn.onclick = () => {
    if (!viewedProfileUser) return;
    userProfileModal.classList.remove('show');
    openChat(viewedProfileUser);
  };
}

const userProfileRemoveFriendBtn = document.getElementById('userProfileRemoveFriendBtn');
if (userProfileRemoveFriendBtn) {
  userProfileRemoveFriendBtn.onclick = async () => {
    if (!viewedProfileUser) return;
    if (!confirm(`Удалить чат с @${viewedProfileUser.username}? История переписки будет скрыта из списка.`)) return;
    const targetUid = viewedProfileUser.uid;
    try {
      const cid = chatIdFor(currentUser.uid, targetUid);
      await db.collection('chats').doc(cid).delete();
      userProfileModal.classList.remove('show');
      document.body.classList.remove('chatOpen');
    } catch (err) {
      alert('Не удалось удалить чат: ' + err.message);
    }
  };
}

document.getElementById('profileSaveBtn').onclick = async () => {
  const errEl = document.getElementById('profileErr');
  errEl.textContent = '';
  const newUsername = document.getElementById('editUsername').value.trim().toLowerCase();
  const editBioEl = document.getElementById('editBio');
  const newBio = editBioEl ? editBioEl.value.trim() : '';
  const featChSel = document.getElementById('editFeaturedChannel');
  const selectedFeaturedChannel = featChSel ? (featChSel.value || null) : null;

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
      photo: customAvatarData,
      banner: customBannerData,
      bio: newBio,
      featuredChannel: selectedFeaturedChannel
    });

    myUsername = newUsername; myColor = pickedColor; myPhoto = customAvatarData; myBanner = customBannerData; myBio = newBio; myFeaturedChannel = selectedFeaturedChannel;

    document.getElementById('myName').textContent = '@' + myUsername;
    renderAvatar(document.getElementById('myAvatar'), myUsername, myColor, myPhoto);

    profileModal.classList.remove('show');

  } catch (e) {
    errEl.textContent = e.message || 'Ошибка сохранения';
  }
};

/* ---------------- ГЛОБАЛЬНЫЙ ПОИСК ЛЮДЕЙ ---------------- */
document.getElementById('searchInput').oninput = (e) => {
  const q = e.target.value.trim().toLowerCase();
  renderList(q);
  clearTimeout(userSearchDebounce);
  if (activeTab !== 'chats' || !q) {
    lastUserSearchResults = [];
    renderList(q);
    return;
  }
  userSearchDebounce = setTimeout(() => runUserSearch(q), 260);
};

let lastUserSearchResults = [];

async function runUserSearch(q) {
  if (!q) { lastUserSearchResults = []; renderList(''); return; }
  try {
    const end = q + '\uf8ff';
    const snap = await db.collection('users')
      .orderBy('username')
      .startAt(q)
      .endAt(end)
      .limit(15)
      .get();
    lastUserSearchResults = snap.docs
      .map(d => ({ uid: d.id, ...d.data() }))
      .filter(u => u.uid !== currentUser.uid && !myFriends.some(f => f.uid === u.uid));
  } catch (err) {
    lastUserSearchResults = [];
  }
  const currentQ = (document.getElementById('searchInput').value || '').trim().toLowerCase();
  if (currentQ === q) renderList(q);
}

/* ---------------- СПИСОК ЧАТОВ (на основе реальных переписок) ---------------- */
function listenChats(){
  if (unsubChats) unsubChats();
  unsubChats = db.collection('chats')
    .where('participants', 'array-contains', currentUser.uid)
    .onSnapshot(async snap => {
      const otherUids = [...new Set(snap.docs.map(d => {
        const p = d.data().participants || [];
        return p.find(u => u !== currentUser.uid);
      }).filter(Boolean))];

      pruneLastMsgSubs('f_', otherUids);
      if (otherUids.length === 0) {
        myFriends = [];
        renderStoryFeed();
        if (activeTab === 'chats') renderList((document.getElementById('searchInput').value || '').trim().toLowerCase());
        return;
      }
      const docs = await Promise.all(otherUids.map(uid => db.collection('users').doc(uid).get()));
      myFriends = docs.filter(d => d.exists).map(d => ({ uid: d.id, ...d.data() }));
      myFriends.forEach(f => {
        const cid = chatIdFor(currentUser.uid, f.uid);
        subscribeLastMessage('f_' + f.uid, db.collection('chats').doc(cid).collection('messages'), 'chats');
      });
      renderStoryFeed();
      if (activeTab === 'chats') renderList((document.getElementById('searchInput').value || '').trim().toLowerCase());
    });
}

function listenGroups(){
  unsubGroups = db.collection('groups')
    .where('members', 'array-contains', currentUser.uid)
    .onSnapshot(snap => {
      myGroups = snap.docs.map(d => ({ id: d.id, ...d.data(), isGroup: true }));
      pruneLastMsgSubs('g_', myGroups.map(g => g.id));
      myGroups.forEach(g => {
        subscribeLastMessage('g_' + g.id, db.collection('groups').doc(g.id).collection('messages'), 'groups');
      });
      if (activeTab === 'groups') renderList();
    });
}

document.querySelectorAll('.tab').forEach(tab => {
  tab.onclick = () => {
    document.querySelectorAll('.tab').forEach(t=>t.classList.remove('active'));
    tab.classList.add('active');
    activeTab = tab.dataset.tab;
    lastUserSearchResults = [];
    renderList((document.getElementById('searchInput').value || '').trim().toLowerCase());
  };
});

function isRecentStory(story){
  if (!story || !story.createdAt) return false;
  const ms = story.createdAt.toMillis ? story.createdAt.toMillis() : story.createdAt.getTime ? story.createdAt.getTime() : Date.parse(story.createdAt);
  return ms >= Date.now() - 24 * 60 * 60 * 1000;
}

function cleanupOldStories(stories){
  return (stories || []).filter(isRecentStory).slice(-12);
}

/* ---------------- ОТМЕТКА ПРОСМОТРЕННЫХ ИСТОРИЙ (кольцо как в Instagram) ---------------- */
function getSeenStoryIds() {
  try { return new Set(JSON.parse(localStorage.getItem('seenStoryIds') || '[]')); }
  catch (e) { return new Set(); }
}
function markStorySeen(storyId) {
  try {
    const seen = getSeenStoryIds();
    seen.add(storyId);
    localStorage.setItem('seenStoryIds', JSON.stringify([...seen].slice(-500)));
  } catch (e) { /* localStorage unavailable — ring just won't remember across reloads */ }
}

function renderStoryFeed(){
  const storyList = document.getElementById('storyList');
  const addBubble = document.getElementById('storyAddBubble');
  if (!storyList) return;
  const stories = cleanupOldStories(myStories);
  const friendStories = myFriends.filter(f => (f.stories || []).some(isRecentStory));
  storyList.innerHTML = '';

  if (addBubble) {
    const frame = addBubble.querySelector('.storyBubbleFrame');
    if (stories.length && frame) {
      frame.innerHTML = `<div class="storyBubbleImg" style="background-image:url(${stories[stories.length - 1].image})"></div><div class="storyAddPlus small">+</div>`;
      addBubble.onclick = () => openStoryViewer({ uid: currentUser.uid, username: myUsername, color: myColor, photo: myPhoto }, stories, stories.length - 1);
      const plusEl = frame.querySelector('.storyAddPlus');
      if (plusEl) plusEl.onclick = (e) => { e.stopPropagation(); document.getElementById('storyFileInput').click(); };
    } else if (frame) {
      frame.innerHTML = `<div class="storyAddPlus">+</div>`;
      addBubble.onclick = () => document.getElementById('storyFileInput').click();
    }
  }

  const seenIds = getSeenStoryIds();
  let storyIndex = 0;
  friendStories.forEach(friend => {
    const friendRecentAll = cleanupOldStories(friend.stories || []);
    const friendRecent = friendRecentAll[friendRecentAll.length - 1];
    if (!friendRecent) return;
    const hasUnseen = friendRecentAll.some(s => !seenIds.has(s.id));
    const bubble = document.createElement('div');
    bubble.className = 'storyBubble rowAnim';
    bubble.style.animationDelay = (Math.min(storyIndex, 14) * 28) + 'ms';
    storyIndex++;
    bubble.onclick = () => openStoryViewer(friend, friendRecentAll, 0);
    bubble.innerHTML = `
      <div class="storyBubbleFrame ${hasUnseen ? 'unseen' : ''}"><div class="storyBubbleImg" style="background-image:url(${friendRecent.image})"></div></div>
      <div class="storyLabel">@${escapeHtml(friend.username)}</div>
    `;
    storyList.appendChild(bubble);
  });
}

/* ---------------- ПРОСМОТР ИСТОРИЙ С ЛИСТАНИЕМ И ТАЙМЕРОМ ---------------- */
const STORY_DURATION = 4500;
let currentStoryView = null; // { userObj, stories, index }
let storyAdvanceTimer = null;

function buildStoryProgressBars() {
  const row = document.getElementById('storyProgressRow');
  if (!row || !currentStoryView) return;
  row.innerHTML = '';
  currentStoryView.stories.forEach(() => {
    const seg = document.createElement('div');
    seg.className = 'storyProgressSeg';
    seg.innerHTML = '<div class="fill"></div>';
    row.appendChild(seg);
  });
}

function showCurrentStory() {
  if (!currentStoryView) return;
  const { userObj, stories, index } = currentStoryView;
  const story = stories[index];
  const owner = document.getElementById('storyViewerOwner');
  const img = document.getElementById('storyViewerImg');
  const meta = document.getElementById('storyViewerMeta');
  if (!owner || !img || !meta) return;

  owner.textContent = userObj.uid === currentUser.uid ? 'Ваша история' : `История @${userObj.username}`;
  img.style.backgroundImage = `url(${story.image})`;
  const when = story.createdAt && story.createdAt.toDate ? story.createdAt.toDate() : (story.createdAt instanceof Date ? story.createdAt : new Date(story.createdAt));
  meta.textContent = `Опубликовано ${when.toLocaleString([], { hour:'2-digit', minute:'2-digit', day:'2-digit', month:'2-digit' })}`;

  markStorySeen(story.id);

  const segs = document.querySelectorAll('#storyProgressRow .storyProgressSeg');
  segs.forEach((seg, i) => {
    const fill = seg.querySelector('.fill');
    seg.classList.remove('active');
    if (i < index) { seg.classList.add('done'); fill.style.transition = 'none'; fill.style.width = '100%'; }
    else { seg.classList.remove('done'); fill.style.transition = 'none'; fill.style.width = '0%'; }
  });

  if (storyAdvanceTimer) clearTimeout(storyAdvanceTimer);
  const activeSeg = segs[index];
  if (activeSeg) {
    activeSeg.classList.add('active');
    const fill = activeSeg.querySelector('.fill');
    requestAnimationFrame(() => {
      fill.style.transition = `width ${STORY_DURATION}ms linear`;
      fill.style.width = '100%';
    });
  }
  storyAdvanceTimer = setTimeout(() => goToNextStory(), STORY_DURATION);

  renderStoryFeed();
}

function goToNextStory() {
  if (!currentStoryView) return;
  if (currentStoryView.index < currentStoryView.stories.length - 1) {
    currentStoryView.index++;
    showCurrentStory();
  } else {
    closeStoryViewer();
  }
}
function goToPrevStory() {
  if (!currentStoryView) return;
  if (currentStoryView.index > 0) {
    currentStoryView.index--;
    showCurrentStory();
  } else {
    showCurrentStory();
  }
}
function closeStoryViewer() {
  if (storyAdvanceTimer) { clearTimeout(storyAdvanceTimer); storyAdvanceTimer = null; }
  const modal = document.getElementById('storyViewerModal');
  if (modal) modal.classList.remove('show');
  currentStoryView = null;
}

function openStoryViewer(userObj, stories, startIndex){
  if (!stories || stories.length === 0) return;
  currentStoryView = { userObj, stories, index: Math.max(0, Math.min(startIndex || 0, stories.length - 1)) };
  buildStoryProgressBars();
  showCurrentStory();
  document.getElementById('storyViewerModal').classList.add('show');
}

const storyPrevZoneEl = document.getElementById('storyPrevZone');
if (storyPrevZoneEl) storyPrevZoneEl.onclick = (e) => { e.stopPropagation(); goToPrevStory(); };
const storyNextZoneEl = document.getElementById('storyNextZone');
if (storyNextZoneEl) storyNextZoneEl.onclick = (e) => { e.stopPropagation(); goToNextStory(); };

const storyViewerCloseBtn = document.getElementById('storyViewerCloseBtn');
if (storyViewerCloseBtn) {
  storyViewerCloseBtn.onclick = () => closeStoryViewer();
}

const storyLikeBtn = document.getElementById('storyLikeBtn');
if (storyLikeBtn) {
  storyLikeBtn.onclick = () => {
    if (!currentStoryView) return;
    burstHeart(document.getElementById('storyViewerImg'));
  };
}

/* ---------------- ИНЛАЙН-ОТВЕТ НА ИСТОРИЮ (без выхода из просмотра) ---------------- */
function pauseStoryProgress() {
  if (storyAdvanceTimer) { clearTimeout(storyAdvanceTimer); storyAdvanceTimer = null; }
  const activeFill = document.querySelector('#storyProgressRow .storyProgressSeg.active .fill');
  if (activeFill) {
    const currentWidth = getComputedStyle(activeFill).width;
    activeFill.style.transition = 'none';
    activeFill.style.width = currentWidth;
  }
}
function resumeStoryProgress() {
  if (!currentStoryView) return;
  const activeFill = document.querySelector('#storyProgressRow .storyProgressSeg.active .fill');
  if (activeFill) {
    requestAnimationFrame(() => {
      activeFill.style.transition = `width ${STORY_DURATION}ms linear`;
      activeFill.style.width = '100%';
    });
  }
  if (storyAdvanceTimer) clearTimeout(storyAdvanceTimer);
  storyAdvanceTimer = setTimeout(() => goToNextStory(), STORY_DURATION);
}

function showStoryToast(text) {
  const stage = document.getElementById('storyViewerStage');
  if (!stage) return;
  const existing = stage.querySelector('.storyToast');
  if (existing) existing.remove();
  const toast = document.createElement('div');
  toast.className = 'storyToast';
  toast.textContent = text;
  stage.appendChild(toast);
  setTimeout(() => toast.remove(), 2600);
}

async function sendStoryReply() {
  const input = document.getElementById('storyReplyInput');
  if (!input || !currentStoryView) return;
  const text = input.value.trim();
  if (!text) return;

  const ownerId = currentStoryView.userObj.uid;
  if (ownerId === currentUser.uid) {
    alert('Нельзя ответить на свою историю');
    return;
  }
  const friend = myFriends.find(f => f.uid === ownerId);
  if (!friend) {
    alert('Добавьте пользователя в друзья, чтобы ответить на его историю');
    return;
  }

  const story = currentStoryView.stories[currentStoryView.index];
  const cid = chatIdFor(currentUser.uid, ownerId);

  input.value = '';
  input.disabled = true;
  try {
    await db.collection('chats').doc(cid).set({ participants: [currentUser.uid, ownerId] }, { merge: true });
    await db.collection('chats').doc(cid).collection('messages').add({
      senderId: currentUser.uid,
      from: currentUser.uid,
      to: ownerId,
      text: text,
      storyReply: { image: story.image },
      read: false,
      createdAt: firebase.firestore.FieldValue.serverTimestamp()
    });
    showStoryToast('Ответ отправлен');
  } catch (err) {
    alert('Не удалось отправить ответ: ' + err.message);
  } finally {
    input.disabled = false;
    resumeStoryProgress();
  }
}

const storyReplyInputEl = document.getElementById('storyReplyInput');
if (storyReplyInputEl) {
  storyReplyInputEl.addEventListener('focus', pauseStoryProgress);
  storyReplyInputEl.addEventListener('blur', () => {
    if (storyReplyInputEl.value.trim()) return;
    resumeStoryProgress();
  });
  storyReplyInputEl.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); sendStoryReply(); }
  });
  storyReplyInputEl.addEventListener('click', (e) => e.stopPropagation());
}
const storySendReplyBtn = document.getElementById('storySendReplyBtn');
if (storySendReplyBtn) {
  storySendReplyBtn.onclick = (e) => { e.stopPropagation(); sendStoryReply(); };
}

const storyFileInputEl = document.getElementById('storyFileInput');
if (storyFileInputEl) {
  const storyAddBubbleEl = document.getElementById('storyAddBubble');
  if (storyAddBubbleEl) storyAddBubbleEl.onclick = () => storyFileInputEl.click();
  storyFileInputEl.onchange = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    await addStory(file);
    e.target.value = '';
  };
}

async function addStory(file) {
  if (!file || !currentUser) return;
  const imageData = await resizeImage(file, 900, 0.75);
  const storyObject = {
    id: `${Date.now()}_${Math.random().toString(36).slice(2,6)}`,
    image: imageData,
    createdAt: new Date(),
    likes: []
  };
  myStories = cleanupOldStories([...myStories, storyObject]);
  await db.collection('users').doc(currentUser.uid).update({ stories: myStories });
  renderStoryFeed();
}

function buildPersonRow(f, onClick) {
  const row = document.createElement('div');
  row.className = 'row' + (window.activeChatWith && window.activeChatWith.uid === f.uid ? ' active' : '');
  const avContainer = document.createElement('div');
  avContainer.className = 'avatar';

  const isOnline = !f.hideOnline && f.lastOnline && (Date.now() - f.lastOnline.toMillis() < 45000);
  renderAvatar(avContainer, f.username, f.color, f.photo, isOnline);

  row.appendChild(avContainer);
  const lm = lastMsgCache['f_' + f.uid];
  const subText = isOnline ? 'В сети' : (lm ? lm.preview : (f.bio || 'Нажмите, чтобы написать'));
  row.innerHTML += `<div class="rowInfo"><div class="n">@${escapeHtml(f.username)}</div><div class="s${isOnline ? ' online' : ''}">${escapeHtml(subText)}</div></div>` +
    (lm && lm.time ? `<div class="rowMeta"><div class="rowTime">${formatMsgTime(lm.time)}</div></div>` : '');
  row.onclick = onClick;
  return row;
}

function renderList(filter = ''){
  const list = document.getElementById('list');
  list.innerHTML = '';

  let rowIndex = 0;
  const animateIn = (el) => {
    el.classList.add('rowAnim');
    el.style.animationDelay = (Math.min(rowIndex, 14) * 28) + 'ms';
    rowIndex++;
  };

  if (activeTab === 'chats') {
    const filtered = myFriends.filter(f => f.username.toLowerCase().includes(filter));
    filtered.sort((a, b) => {
      const ta = lastMsgCache['f_' + a.uid]?.time?.toMillis ? lastMsgCache['f_' + a.uid].time.toMillis() : 0;
      const tb = lastMsgCache['f_' + b.uid]?.time?.toMillis ? lastMsgCache['f_' + b.uid].time.toMillis() : 0;
      return tb - ta;
    });
    filtered.forEach(f => {
      const row = buildPersonRow(f, () => openChat(f));
      animateIn(row);
      list.appendChild(row);
    });

    if (filter && lastUserSearchResults.length > 0) {
      const heading = document.createElement('div');
      heading.className = 'listSectionHeading';
      heading.textContent = 'Люди';
      animateIn(heading);
      list.appendChild(heading);
      lastUserSearchResults.forEach(u => {
        const row = buildPersonRow(u, () => openChat(u));
        animateIn(row);
        list.appendChild(row);
      });
    }

    if (list.children.length === 0) {
      list.innerHTML = `<div class="empty">${filter ? 'Никого не найдено' : 'Пока нет чатов — найдите кого-нибудь через поиск'}</div>`;
    }
  } else {
    const filtered = myGroups.filter(g => g.name.toLowerCase().includes(filter));
    if (filtered.length === 0) {
      list.innerHTML = '<div class="empty">Группы и каналы не найдены</div>';
      return;
    }
    filtered.sort((a, b) => {
      const ta = lastMsgCache['g_' + a.id]?.time?.toMillis ? lastMsgCache['g_' + a.id].time.toMillis() : 0;
      const tb = lastMsgCache['g_' + b.id]?.time?.toMillis ? lastMsgCache['g_' + b.id].time.toMillis() : 0;
      return tb - ta;
    });
    filtered.forEach(g => {
      const row = document.createElement('div');
      row.className = 'row' + (window.activeChatWith && window.activeChatWith.id === g.id ? ' active' : '');
      const avContainer = document.createElement('div');
      avContainer.className = 'avatar';
      avContainer.textContent = g.type === 'channel' ? '📢' : '👥';

      row.appendChild(avContainer);
      const lm = lastMsgCache['g_' + g.id];
      const subText = lm ? lm.preview : `${g.type === 'channel' ? 'Канал' : 'Группа'} • ${g.members ? g.members.length : 1} участн.`;
      row.innerHTML += `<div class="rowInfo"><div class="n">${escapeHtml(g.name)}</div><div class="s">${escapeHtml(subText)}</div></div>` +
        (lm && lm.time ? `<div class="rowMeta"><div class="rowTime">${formatMsgTime(lm.time)}</div></div>` : '');
      row.onclick = () => openGroupChat(g);
      animateIn(row);
      list.appendChild(row);
    });
  }
  svgifyEmoji(list);
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
    const newGroupRef = await db.collection('groups').add({
      name: name,
      type: type,
      owner: currentUser.uid,
      members: checked,
      admins: [],
      createdAt: firebase.firestore.FieldValue.serverTimestamp()
    });

    if (type === 'channel') {
      myChannels.push({ id: newGroupRef.id, name: name });
      await db.collection('users').doc(currentUser.uid).update({
        channels: myChannels
      });
    }

    groupModal.classList.remove('show');
  } catch (err) {
    document.getElementById('groupErr').textContent = 'Ошибка: ' + err.message;
  }
};

/* ---------------- ИНФОРМАЦИЯ О ГРУППЕ/КАНАЛЕ ---------------- */
const groupInfoModal = document.getElementById('groupInfoModal');
document.getElementById('giCloseBtn').onclick = () => groupInfoModal.classList.remove('show');

async function openGroupInfo(group) {
  const errEl = document.getElementById('giErr');
  errEl.textContent = '';
  document.getElementById('giName').textContent = group.name;
  document.getElementById('giType').textContent = group.type === 'channel' ? 'Канал' : 'Группа';

  const avEl = document.getElementById('giAvatar');
  avEl.style.backgroundImage = 'none';
  avEl.style.background = 'var(--wire)';
  avEl.textContent = group.type === 'channel' ? '📢' : '👥';
  svgifyEmoji(avEl);

  const members = group.members || [];
  const admins = group.admins || [];
  document.getElementById('giMemberCount').textContent = members.length;
  const isOwner = group.owner === currentUser.uid;
  const isAdmin = admins.includes(currentUser.uid);

  const memberList = document.getElementById('giMemberList');
  memberList.innerHTML = '<span style="color:var(--muted);">Загрузка...</span>';
  groupInfoModal.classList.add('show');

  const userDocs = await Promise.all(members.map(uid => db.collection('users').doc(uid).get()));
  memberList.innerHTML = '';
  userDocs.forEach((doc, i) => {
    const uid = members[i];
    if (!doc.exists) return;
    const u = doc.data();
    const isMemberAdmin = admins.includes(uid);
    const roleTag = uid === group.owner ? '👑' : (isMemberAdmin ? '🛡️' : '');
    const row = document.createElement('div');
    row.style.cssText = 'display:flex; align-items:center; gap:8px; padding:5px 0; border-bottom:1px dashed rgba(0,0,0,0.15);';
    row.innerHTML = `
      <div class="avatar giMemberAv" style="width:28px; height:28px; font-size:12px; flex-shrink:0;"></div>
      <div style="flex:1; min-width:0; font-size:13px;">@${escapeHtml(u.username)} ${roleTag}</div>
      <div style="display:flex; gap:4px; flex-shrink:0;">
        ${isOwner && uid !== currentUser.uid && group.type === 'channel' ? `<button class="giPromote" style="border:1px solid var(--ink); background:var(--paper); cursor:pointer; font-size:10px; padding:3px 6px; border-radius:6px;">${isMemberAdmin ? 'Снять админа' : 'Сделать админом'}</button>` : ''}
        ${isOwner && uid !== currentUser.uid ? '<button class="giKick" style="border:1px solid var(--ink); background:var(--paper); cursor:pointer; font-size:10px; padding:3px 6px; border-radius:6px;">Убрать</button>' : ''}
      </div>
    `;
    renderAvatar(row.querySelector('.giMemberAv'), u.username, u.color, u.photo);
    const promoteBtn = row.querySelector('.giPromote');
    if (promoteBtn) promoteBtn.onclick = async () => {
      try {
        await db.collection('groups').doc(group.id).update({
          admins: isMemberAdmin ? firebase.firestore.FieldValue.arrayRemove(uid) : firebase.firestore.FieldValue.arrayUnion(uid)
        });
        openGroupInfo({ ...group, admins: isMemberAdmin ? admins.filter(a => a !== uid) : [...admins, uid] });
      } catch (err) { errEl.textContent = err.message; }
    };
    const kickBtn = row.querySelector('.giKick');
    if (kickBtn) kickBtn.onclick = async () => {
      if (!confirm(`Убрать @${u.username} из "${group.name}"?`)) return;
      try {
        await db.collection('groups').doc(group.id).update({
          members: firebase.firestore.FieldValue.arrayRemove(uid),
          admins: firebase.firestore.FieldValue.arrayRemove(uid)
        });
        openGroupInfo({ ...group, members: members.filter(m => m !== uid), admins: admins.filter(a => a !== uid) });
      } catch (err) { errEl.textContent = err.message; }
    };
    memberList.appendChild(row);
    svgifyEmoji(row);
  });

  const addWrap = document.getElementById('giAddMemberWrap');
  const addList = document.getElementById('giAddMemberList');
  const addable = (isOwner || isAdmin) ? myFriends.filter(f => !members.includes(f.uid)) : [];
  if (addable.length > 0) {
    addWrap.style.display = 'block';
    addList.innerHTML = '';
    addable.forEach(f => {
      const row = document.createElement('div');
      row.style.cssText = 'display:flex; align-items:center; justify-content:space-between; gap:8px; padding:5px 0;';
      row.innerHTML = `<span style="font-size:13px;">@${escapeHtml(f.username)}</span><button style="border:1px solid var(--ink); background:var(--wire); color:var(--paper); cursor:pointer; font-size:10px; padding:3px 6px; border-radius:6px;">Добавить</button>`;
      row.querySelector('button').onclick = async () => {
        try {
          await db.collection('groups').doc(group.id).update({ members: firebase.firestore.FieldValue.arrayUnion(f.uid) });
          openGroupInfo({ ...group, members: [...members, f.uid] });
        } catch (err) { errEl.textContent = err.message; }
      };
      addList.appendChild(row);
    });
  } else {
    addWrap.style.display = 'none';
  }

  const leaveBtn = document.getElementById('giLeaveBtn');
  const deleteBtn = document.getElementById('giDeleteBtn');
  leaveBtn.style.display = isOwner ? 'none' : 'block';
  deleteBtn.style.display = isOwner ? 'block' : 'none';

  leaveBtn.onclick = async () => {
    if (!confirm('Покинуть ' + (group.type === 'channel' ? 'канал' : 'группу') + '?')) return;
    try {
      await db.collection('groups').doc(group.id).update({ members: firebase.firestore.FieldValue.arrayRemove(currentUser.uid) });
      groupInfoModal.classList.remove('show');
      document.body.classList.remove('chatOpen');
    } catch (err) { errEl.textContent = err.message; }
  };

  deleteBtn.onclick = async () => {
    if (!confirm('Удалить ' + (group.type === 'channel' ? 'канал' : 'группу') + ' безвозвратно?')) return;
    try {
      await db.collection('groups').doc(group.id).delete();
      groupInfoModal.classList.remove('show');
      document.body.classList.remove('chatOpen');
    } catch (err) { errEl.textContent = err.message; }
  };
}