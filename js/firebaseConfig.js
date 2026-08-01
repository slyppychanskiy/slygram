// Конфигурация и инициализация Firebase
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

// Локальный кэш Firestore: чаты открываются мгновенно из кэша,
// а не только после ответа сети — убирает заметную задержку/скачок при входе в чат
try {
  db.enablePersistence({ synchronizeTabs: true }).catch(() => {});
} catch (e) {}

// Общие константы
const AVATAR_COLORS = ['#1B3A8C','#B23A2E','#2E7D32','#8E44AD','#B8860B','#455A64'];
const REACTION_EMOJIS = ['👍','❤️','😂','😮','🔥'];

/* ---------------- ИКОНКИ ИНТЕРФЕЙСА ----------------
   Монохромный набор SVG-иконок вместо эмодзи для системных элементов
   управления (поиск, настройки, пересылка и т.д.). Эмодзи в реакциях
   и в панели стикеров/смайликов остаются настоящими эмодзи —
   это осознанный выбор для «живого» контента, а не UI-хрома. */
const ICONS = {
  search: '<path d="M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16Z"/><path d="m21 21-4.3-4.3"/>',
  settings: '<path d="M12 15.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7Z"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09a1.65 1.65 0 0 0 1.51-1 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1Z"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  close: '<path d="M18 6 6 18M6 6l12 12"/>',
  back: '<path d="m15 18-6-6 6-6"/>',
  arrowDown: '<path d="M12 5v14M19 12l-7 7-7-7"/>',
  paperclip: '<path d="M21.4 11.05 12.2 20.24a5.5 5.5 0 0 1-7.78-7.78l9.19-9.2a3.67 3.67 0 0 1 5.19 5.2L9.66 17.65a1.83 1.83 0 0 1-2.6-2.6l8.5-8.48"/>',
  smile: '<path d="M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Z"/><path d="M8 14s1.5 2 4 2 4-2 4-2"/><path d="M9 9h.01M15 9h.01"/>',
  mic: '<path d="M12 15a3 3 0 0 0 3-3V6a3 3 0 0 0-6 0v6a3 3 0 0 0 3 3Z"/><path d="M19 11a7 7 0 0 1-14 0M12 18v3"/>',
  send: '<path d="m3 11 18-8-8 18-2.5-7.5L3 11Z"/>',
  reply: '<path d="M9 14 4 9l5-5"/><path d="M4 9h11a5 5 0 0 1 5 5v3"/>',
  forward: '<path d="m15 14 5-5-5-5"/><path d="M20 9H9a5 5 0 0 0-5 5v3"/>',
  copy: '<rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>',
  check: '<path d="M20 6 9 17l-5-5"/>',
  checkDouble: '<path d="m2.5 12.5 4 4L16 7"/><path d="m8 15.5 1.5 1.5L21 7"/>',
  pin: '<path d="M12 17v5"/><path d="M9 10.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V16h14v-.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V7h1a1 1 0 0 0 0-2H8a1 1 0 0 0 0 2h1Z"/>',
  edit: '<path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"/>',
  star: '<path d="m12 2 3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2Z"/>',
  trash: '<path d="M3 6h18"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2m3 0-1 14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2L4 6h16Z"/>',
  envelope: '<rect x="2" y="4" width="20" height="16" rx="3"/><path d="m3 6.5 9 6 9-6"/>',
  crown: '<path d="m3 18 1.4-8.6L9 13l3-8 3 8 4.6-3.6L21 18Z"/><path d="M4 21h16"/>',
  shield: '<path d="M12 22s7.5-3.6 7.5-9.5V5.3L12 2 4.5 5.3v7.2C4.5 18.4 12 22 12 22Z"/>',
  megaphone: '<path d="m3 10.5 17-5v13l-17-5v-3Z"/><path d="M7 13.5v4.3A1.7 1.7 0 0 0 8.7 19.5H9a1.7 1.7 0 0 0 1.7-1.7v-3.3"/>',
  users: '<path d="M16.5 20.5v-1.7a3.8 3.8 0 0 0-3.8-3.8H6.3a3.8 3.8 0 0 0-3.8 3.8v1.7"/><circle cx="9.4" cy="7.7" r="3.7"/><path d="M21.5 20.5v-1.7a3.8 3.8 0 0 0-2.8-3.66M15.1 4.2a3.7 3.7 0 0 1 0 7.13"/>',
  heart: '<path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.6l-1-1a5.5 5.5 0 0 0-7.8 7.8l1 1L12 21l7.8-7.6 1-1a5.5 5.5 0 0 0 0-7.8Z"/>',
  chevronRight: '<path d="m9 18 6-6-6-6"/>',
  bell: '<path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/>',
  bellOff: '<path d="M13.73 21a2 2 0 0 1-3.46 0"/><path d="M18.63 13A17.89 17.89 0 0 1 18 8"/><path d="M6.26 6.26A5.86 5.86 0 0 0 6 8c0 7-3 9-3 9h14"/><path d="M18 8a6 6 0 0 0-9.33-5"/><path d="m2 2 20 20"/>'
};

function icon(name, size) {
  const s = size || 20;
  const body = ICONS[name] || '';
  return `<svg class="icon-svg" width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;
}

// Утилита перевода ошибок Auth
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

// Защита от XSS
function escapeHtml(str){
  if (!str) return '';
  const d = document.createElement('div');
  d.textContent = str;
  return d.innerHTML;
}

// Сжатие изображений через Canvas
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