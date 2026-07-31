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

// Общие константы
const AVATAR_COLORS = ['#1B3A8C','#B23A2E','#2E7D32','#8E44AD','#B8860B','#455A64'];
const BORDER_COLORS = ['#1C1A16','#B23A2E','#1B3A8C','#00FF66','#FF0055','#E54B4B'];
const REACTION_EMOJIS = ['👍','❤️','😂','😮','🔥'];

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