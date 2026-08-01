let isLogin = true;
let isRegistering = false;
let currentUser = null;
let myUsername = null;
let myColor = AVATAR_COLORS[0];
let myBorderColor = BORDER_COLORS[0];
let myPhoto = null;
let myTheme = 'paper';
let myBio = '';
let myChannels = [];
let myStories = [];
let myFeaturedChannel = null;
let myStickers = []; // Массив кастомных стикеров пользователя
let customAvatarData = null;

let myFriends = [];
let myGroups = [];
let incomingRequests = [];
let activeTab = 'chats';
let friendsAccepted = { asFrom: [], asTo: [] };
let unsubFriendsA = null, unsubFriendsB = null;
let unsubRequests = null;
let unsubGroups = null;

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
        username, email, color, photo: null, theme: 'paper', borderColor: BORDER_COLORS[0], bio: '', channels: [], stickers: [],
        createdAt: firebase.firestore.FieldValue.serverTimestamp()
      });

      isRegistering = false;
      await enterApp(cred.user, username, color, null, 'paper', BORDER_COLORS[0], '', [], [], '', null);
    }
  } catch (e) {
    authErr.textContent = translateError(e.code) || e.message;
  } finally {
    isRegistering = false;
    authSubmitBtn.disabled = false;
    authSubmitBtn.textContent = originalText;
  }
};

document.getElementById('logoutBtn').onclick = () => auth.signOut();

async function enterApp(user, username, color, photo, theme, borderColor, bio, channels, stickers, stories, featuredChannel){
  currentUser = user;
  myUsername = username;
  myColor = color || AVATAR_COLORS[0];
  myBorderColor = borderColor || BORDER_COLORS[0];
  myPhoto = photo || null;
  myTheme = theme || 'paper';
  myBio = bio || '';
  myChannels = channels || [];
  myStickers = stickers || [];

  
  applyTheme(myTheme, myBorderColor);
  
  document.getElementById('authScreen').style.display = 'none';
  document.getElementById('mainScreen').style.display = 'flex';
  document.getElementById('myName').textContent = '@' + myUsername;
  svgifyEmoji(document.getElementById('mainScreen'));
  
  renderAvatar(document.getElementById('myAvatar'), myUsername, myColor, myPhoto);
  renderStoryFeed();
  
  updateUserPresence();
  listenFriends();
  listenRequests();
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

function applyTheme(theme, borderColor) {
  document.body.classList.forEach(cls => {
    if (cls.startsWith('theme-')) document.body.classList.remove(cls);
  });
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
    await enterApp(user, d.username, d.color, d.photo, d.theme, d.borderColor, d.bio, d.channels, d.stickers || [], d.stories || [], d.featuredChannel);
  } else {
    currentUser = null; myUsername = null;
    clearUserPresence();
    if (unsubFriendsA) unsubFriendsA();
    if (unsubFriendsB) unsubFriendsB();
    if (unsubRequests) unsubRequests();
    if (unsubGroups) unsubGroups();
    document.getElementById('authScreen').style.display = 'flex';
    document.getElementById('mainScreen').style.display = 'none';
  }
});

/* ---------------- ПРОФИЛЬ ---------------- */
const profileModal = document.getElementById('profileModal');
const userProfileModal = document.getElementById('userProfileModal');
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
  const editBioEl = document.getElementById('editBio');
  if (editBioEl) editBioEl.value = myBio || '';
  document.getElementById('themeSelect').value = myTheme || 'paper';
  pickedColor = myColor;
  pickedBorderColor = myBorderColor;
  customAvatarData = myPhoto;

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
document.getElementById('profileCancelBtn').onclick = () => profileModal.classList.remove('show');
const userProfileCloseBtn = document.getElementById('userProfileCloseBtn');
if (userProfileCloseBtn) {
  userProfileCloseBtn.onclick = () => userProfileModal.classList.remove('show');
}

function openUserProfile(userObj) {
  if (!userObj) return;
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

  const isOnline = userObj.lastOnline && (Date.now() - userObj.lastOnline.toMillis() < 45000);
  document.getElementById('viewUserStatus').textContent = isOnline ? 'В сети' : formatLastOnline(userObj.lastOnline);

  renderAvatar(document.getElementById('viewUserAvatar'), userObj.username, userObj.color, userObj.photo);
  userProfileModal.classList.add('show');
}

document.getElementById('profileSaveBtn').onclick = async () => {
  const errEl = document.getElementById('profileErr');
  errEl.textContent = '';
  const newUsername = document.getElementById('editUsername').value.trim().toLowerCase();
  const editBioEl = document.getElementById('editBio');
  const newBio = editBioEl ? editBioEl.value.trim() : '';
  const selectedTheme = document.getElementById('themeSelect').value;
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
      borderColor: pickedBorderColor,
      photo: customAvatarData,
      theme: selectedTheme,
      bio: newBio,
      featuredChannel: selectedFeaturedChannel
    });

    myUsername = newUsername; myColor = pickedColor; myBorderColor = pickedBorderColor; myPhoto = customAvatarData; myTheme = selectedTheme; myBio = newBio; myFeaturedChannel = selectedFeaturedChannel;
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
if (uids.length === 0) { myFriends = []; renderStoryFeed(); if (activeTab==='chats') renderList(); return; }
    const docs = await Promise.all(uids.map(uid => db.collection('users').doc(uid).get()));
    myFriends = docs.filter(d=>d.exists).map(d => ({ uid: d.id, ...d.data() }));
    renderStoryFeed();
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
  if (!storyList) return;
  const stories = cleanupOldStories(myStories);
  const friendStories = myFriends.filter(f => (f.stories || []).some(isRecentStory));
  storyList.innerHTML = '';

  if (stories.length) {
    const bubble = document.createElement('div');
    bubble.className = 'storyBubble ownStory';
    bubble.onclick = () => openStoryViewer({ uid: currentUser.uid, username: myUsername, color: myColor, photo: myPhoto }, stories, stories.length - 1);
    bubble.innerHTML = `
      <div class="storyBubbleFrame"><div class="storyBubbleImg" style="background-image:url(${stories[stories.length - 1].image})"></div></div>
      <div class="storyLabel">Вы</div>
    `;
    storyList.appendChild(bubble);
  }

  const seenIds = getSeenStoryIds();
  friendStories.forEach(friend => {
    const friendRecentAll = cleanupOldStories(friend.stories || []);
    const friendRecent = friendRecentAll[friendRecentAll.length - 1];
    if (!friendRecent) return;
    const hasUnseen = friendRecentAll.some(s => !seenIds.has(s.id));
    const bubble = document.createElement('div');
    bubble.className = 'storyBubble';
    bubble.onclick = () => openStoryViewer(friend, friendRecentAll, 0);
    bubble.innerHTML = `
      <div class="storyBubbleFrame ${hasUnseen ? 'unseen' : ''}"><div class="storyBubbleImg" style="background-image:url(${friendRecent.image})"></div></div>
      <div class="storyLabel">@${escapeHtml(friend.username)}</div>
    `;
    storyList.appendChild(bubble);
  });

  if (storyList.children.length === 0) {
    storyList.innerHTML = '<div class="storyEmpty">Нет историй. Нажмите +, чтобы добавить.</div>';
  }
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

const storyReplyBtn = document.getElementById('storyReplyBtn');
if (storyReplyBtn) {
  storyReplyBtn.onclick = () => {
    if (!currentStoryView) return;
    const ownerId = currentStoryView.userObj.uid;
    if (ownerId === currentUser.uid) {
      alert('Нельзя ответить на свою историю');
      return;
    }
    const friend = myFriends.find(f => f.uid === ownerId);
    if (friend) {
      openChat(friend);
      closeStoryViewer();
    } else {
      alert('Добавьте пользователя в друзья, чтобы ответить');
    }
  };
}

const storyFileInputEl = document.getElementById('storyFileInput');
if (storyFileInputEl) {
  document.getElementById('uploadStoryBtn').onclick = () => storyFileInputEl.click();
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
      row.className = 'row' + (window.activeChatWith && window.activeChatWith.uid === f.uid ? ' active' : '');
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
      row.className = 'row' + (window.activeChatWith && window.activeChatWith.id === g.id ? ' active' : '');
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
  document.getElementById('giMemberCount').textContent = members.length;
  const isOwner = group.owner === currentUser.uid;

  const memberList = document.getElementById('giMemberList');
  memberList.innerHTML = '<span style="color:var(--muted);">Загрузка...</span>';
  groupInfoModal.classList.add('show');

  const userDocs = await Promise.all(members.map(uid => db.collection('users').doc(uid).get()));
  memberList.innerHTML = '';
  userDocs.forEach((doc, i) => {
    const uid = members[i];
    if (!doc.exists) return;
    const u = doc.data();
    const row = document.createElement('div');
    row.style.cssText = 'display:flex; align-items:center; gap:8px; padding:5px 0; border-bottom:1px dashed rgba(0,0,0,0.15);';
    row.innerHTML = `
      <div class="avatar giMemberAv" style="width:28px; height:28px; font-size:12px; flex-shrink:0;"></div>
      <div style="flex:1; min-width:0; font-size:13px;">@${escapeHtml(u.username)} ${uid === group.owner ? '👑' : ''}</div>
      ${isOwner && uid !== currentUser.uid ? '<button class="giKick" style="border:1px solid var(--ink); background:var(--paper); cursor:pointer; font-size:10px; padding:3px 6px; border-radius:6px;">Убрать</button>' : ''}
    `;
    renderAvatar(row.querySelector('.giMemberAv'), u.username, u.color, u.photo);
    const kickBtn = row.querySelector('.giKick');
    if (kickBtn) kickBtn.onclick = async () => {
      if (!confirm(`Убрать @${u.username} из "${group.name}"?`)) return;
      try {
        await db.collection('groups').doc(group.id).update({ members: firebase.firestore.FieldValue.arrayRemove(uid) });
        openGroupInfo({ ...group, members: members.filter(m => m !== uid) });
      } catch (err) { errEl.textContent = err.message; }
    };
    memberList.appendChild(row);
    svgifyEmoji(row);
  });

  const addWrap = document.getElementById('giAddMemberWrap');
  const addList = document.getElementById('giAddMemberList');
  const addable = isOwner ? myFriends.filter(f => !members.includes(f.uid)) : [];
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