// ─── 0. サービスワーカー登録 (PWA) ───
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js')
      .then(reg => console.log('サービスワーカー登録成功:', reg.scope))
      .catch(err => console.log('サービスワーカー登録失敗:', err));
  });
}

// ─── 1. グローバルアプリケーション状態 ───
const state = {
  ingredients: [],
  dinnerLogs: [],
  
  // データ保存用ヘルパー
  save() {
    localStorage.setItem('ingredients', JSON.stringify(this.ingredients));
    localStorage.setItem('dinnerLogs', JSON.stringify(this.dinnerLogs));
  },
  
  load() {
    const rawIng = localStorage.getItem('ingredients');
    const rawLogs = localStorage.getItem('dinnerLogs');
    
    if (rawIng) this.ingredients = JSON.parse(rawIng);
    if (rawLogs) this.dinnerLogs = JSON.parse(rawLogs);
    
    // データが空ならデモ用サンプルデータをプリロード
    if (this.ingredients.length === 0 && this.dinnerLogs.length === 0) {
      this.loadSampleData();
    }
  },
  
  loadSampleData() {
    const today = new Date();
    const addDays = (d, days) => {
      const date = new Date(d);
      date.setDate(date.getDate() + days);
      return date.toISOString().split('T')[0];
    };
    
    this.ingredients = [
      {
        id: crypto.randomUUID(),
        name: "国産和牛バラ肉",
        category: "肉類",
        quantity: 300,
        unit: "g",
        expiryDate: addDays(today, 1), // 明日切れる！
        photo: null
      },
      {
        id: crypto.randomUUID(),
        name: "シャキシャキほうれん草",
        category: "野菜・果物",
        quantity: 1,
        unit: "束",
        expiryDate: addDays(today, 2), // 明後日切れる！
        photo: null
      },
      {
        id: crypto.randomUUID(),
        name: "おいしい低脂肪牛乳",
        category: "乳製品・卵",
        quantity: 1,
        unit: "本",
        expiryDate: addDays(today, 5), // 安全
        photo: null
      },
      {
        id: crypto.randomUUID(),
        name: "塩こうじ調味料",
        category: "調味料",
        quantity: 0.8,
        unit: "瓶",
        expiryDate: addDays(today, 30), // 安全
        photo: null
      }
    ];
    
    this.dinnerLogs = [
      {
        id: crypto.randomUUID(),
        name: "とろける特製牛丼",
        date: addDays(today, -1),
        memo: `# とろける特製牛丼 🥩\n\n冷蔵庫の期限が近い**和牛バラ肉**を消費するために作りました！\n少し長めに煮込んだので、お肉が口の中でとろけるほど柔らかく仕上がりました。\n\n### 📝 レシピ・作り方のコツ\n- **玉ねぎ**は先にすき焼きのタレでしんなりするまで煮るのがポイント。\n- 牛肉は**弱火でさっと煮る**ことで硬くなるのを防ぎます。\n- 仕上げに少し七味を振ると味が締まって美味しい！\n\n### 🥛 一緒に食べたもの\n- ほうれん草のおひたし\n- お味噌汁`,
        rating: 5,
        ingredientsUsed: ["国産和牛バラ肉", "たまねぎ"],
        photo: null
      }
    ];
    
    this.save();
  }
};

// ─── 2. お役立ちユーティリティ ───

// 消費期限までの残り日数を計算
function getDaysRemaining(expiryDateString) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  
  const expiry = new Date(expiryDateString);
  expiry.setHours(0, 0, 0, 0);
  
  const diffTime = expiry.getTime() - today.getTime();
  const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
  return diffDays;
}

// 期限ステータスの判定 (expired, critical, safe)
function getExpiryStatus(days) {
  if (days < 0) return 'expired';
  if (days <= 2) return 'critical';
  return 'safe';
}

// 日付の和風フォーマット
function formatJapaneseDate(dateString, withDayOfWeek = true) {
  const date = new Date(dateString);
  const formatter = new Intl.DateTimeFormat('ja-JP', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    weekday: withDayOfWeek ? 'short' : undefined
  });
  return formatter.format(date);
}

// ─── 3. 自作マークダウンレンダラー (iOSメモ風) ───
function renderMarkdown(text) {
  if (!text) return '<span class="preview-placeholder">何も書かれていません</span>';
  
  // 特殊文字のエスケープを簡易的に防ぎつつ、セキュアに置換
  let html = text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
  
  // 改行をプレースホルダー化
  const lines = html.split('\n');
  let inList = false;
  let listHtml = '';
  
  const renderedLines = lines.map(line => {
    let cleanLine = line.trim();
    
    // ヘッダー #
    if (cleanLine.startsWith('# ')) {
      return `<h1>${cleanLine.substring(2)}</h1>`;
    }
    // サブヘッダー ###
    if (cleanLine.startsWith('### ')) {
      return `<h3>${cleanLine.substring(4)}</h3>`;
    }
    // サブヘッダー ##
    if (cleanLine.startsWith('## ')) {
      return `<h2>${cleanLine.substring(3)}</h2>`;
    }
    
    // 太字 **text**
    cleanLine = cleanLine.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
    // 斜体 *text*
    cleanLine = cleanLine.replace(/\*(.*?)\*/g, '<em>$1</em>');
    
    // 箇条書きリスト -
    if (cleanLine.startsWith('- ') || cleanLine.startsWith('* ')) {
      const content = cleanLine.substring(2);
      if (!inList) {
        inList = true;
        return `<ul><li>${content}</li>`;
      }
      return `<li>${content}</li>`;
    } else {
      if (inList) {
        inList = false;
        return `</ul><p>${cleanLine}</p>`;
      }
    }
    
    // 通常の段落
    if (cleanLine === '') {
      return '<br>';
    }
    
    return `<p>${cleanLine}</p>`;
  });
  
  let result = renderedLines.join('');
  if (inList) {
    result += '</ul>';
  }
  
  // 二重の空行をきれいにする
  return result.replace(/<br><br>/g, '<br>');
}

// ─── 4. アプリケーション描画エンジン ───

// A. ダッシュボードの描画
function renderDashboard() {
  const alertList = document.getElementById('dashboard-alert-list');
  const alertBadge = document.getElementById('dashboard-alert-badge');
  const statsFridge = document.getElementById('stats-fridge-count');
  const statsDinner = document.getElementById('stats-dinner-count');
  const recCardContainer = document.getElementById('recipe-recommendation-card');
  
  // 統計カウンタ
  statsFridge.textContent = `${state.ingredients.length} 品`;
  
  // 今週の料理回数 (直近7日)
  const today = new Date();
  const sevenDaysAgo = new Date();
  sevenDaysAgo.setDate(today.getDate() - 7);
  const dinnerThisWeek = state.dinnerLogs.filter(log => new Date(log.date) >= sevenDaysAgo).length;
  statsDinner.textContent = `${dinnerThisWeek} 回`;
  
  // アラート食材のフィルタ
  const alerts = state.ingredients
    .map(ing => ({ ...ing, days: getDaysRemaining(ing.expiryDate), status: getExpiryStatus(getDaysRemaining(ing.expiryDate)) }))
    .filter(ing => ing.status === 'expired' || ing.status === 'critical')
    .sort((a, b) => a.days - b.days);
  
  // アラートバッジとリスト表示
  if (alerts.length > 0) {
    alertBadge.textContent = alerts.length;
    alertBadge.style.display = 'inline-block';
    
    alertList.innerHTML = alerts.slice(0, 3).map(ing => {
      let warningText = '';
      if (ing.days < 0) warningText = `期限切れ！ (${Math.abs(ing.days)}日経過)`;
      else if (ing.days === 0) warningText = '今日が期限です！';
      else if (ing.days === 1) warningText = '明日まで！';
      else warningText = `期限まであと ${ing.days} 日`;
      
      const emojiMap = { "肉類": "🥩", "魚介類": "🐟", "野菜・果物": "🥬", "乳製品・卵": "🥛", "調味料": "🧂", "その他": "📦" };
      const emoji = emojiMap[ing.category] || "📦";
      
      return `
        <div class="alert-card ${ing.status}">
          <span class="alert-emoji">${emoji}</span>
          <div class="alert-info">
            <div class="alert-name">${ing.name}</div>
            <div class="alert-desc">${warningText}</div>
          </div>
          <div class="alert-qty">${ing.quantity}${ing.unit}</div>
        </div>
      `;
    }).join('');
    
    if (alerts.length > 3) {
      alertList.innerHTML += `<p style="font-size:0.75rem; text-align:center; color:var(--text-sub); margin-top:8px;">他 ${alerts.length - 3} 件の食材が期限間近です</p>`;
    }
  } else {
    alertBadge.style.display = 'none';
    alertList.innerHTML = `
      <div class="alert-card" style="border-color:rgba(16,185,129,0.3); background-color:#F0FDF4; display:flex; align-items:center; gap:12px; padding:16px;">
        <span style="font-size:1.75rem;">🥦</span>
        <div style="flex:1;">
          <div style="font-size:0.9rem; font-weight:700; color:var(--text-main);">すべての食材が安全です！</div>
          <div style="font-size:0.75rem; color:var(--text-sub); margin-top:2px;">期限が近い食材はありません。管理バッチリです！</div>
        </div>
      </div>
    `;
  }
  
  // AIレシピ提案の動的構築
  let recTag = '本日のおすすめレシピ';
  let recDish = 'コク旨！万能カレーライス';
  let recReason = '冷蔵庫にある余ったお野菜や調味料を加えて、栄養たっぷりのオリジナルカレーを作ってみませんか？カレーならどんな食材でも美味しくまとまります！';
  let recEmoji = '🍛';
  
  if (alerts.length > 0) {
    const target = alerts[0];
    recEmoji = target.category === '肉類' ? '🥩' : target.category === '野菜・果物' ? '🥬' : target.category === '魚介類' ? '🐟' : target.category === '乳製品・卵' ? '🥛' : '🍳';
    
    if (target.category === '肉類') {
      recTag = '期限間近のお肉を消費！';
      recDish = 'ご飯が進む！特製スタミナ焼肉丼';
      recReason = `冷蔵庫の「${target.name}」を余さず美味しく！玉ねぎやキャベツなどお好みの野菜と一緒に甘辛ダレでさっと炒めるだけで、大満足のご飯が完成します。`;
    } else if (target.category === '野菜・果物') {
      recTag = 'お野菜すっきりメニュー！';
      recDish = 'ふんわり卵とシャキシャキ野菜炒め';
      recReason = `消費期限が近い「${target.name}」をたっぷり使った一品。強火で一気に炒め、仕上げにごま油をひと回しすれば絶品おかずに変身します。`;
    } else if (target.category === '魚介類') {
      recTag = '新鮮な魚介のごちそう！';
      recDish = '香ばしい！絶品バタームニエル';
      recReason = `「${target.name}」の旨みをぎゅっと閉じ込めるバターソテー。小麦粉を薄くまぶしてカリッと焼き上げ、レモンを絞って召し上がれ。`;
    } else if (target.category === '乳製品・卵') {
      recTag = 'クリーミーに美味しく消費！';
      recDish = 'とろ〜り濃厚！野菜グラタン';
      recReason = `「${target.name}」を使って心も温まるマカロニグラタン。冷蔵庫の余り野菜も一緒にホワイトソースで煮込んで、チーズを乗せてオーブンへ！`;
    } else {
      recTag = '冷蔵庫お助けメニュー！';
      recDish = 'パラパラ！極旨黄金レタスチャーハン';
      recReason = `冷蔵庫の「${target.name}」を細かく刻んで旨味のアクセントに。強火でご飯と卵をパラパラに炒め上げれば、冷蔵庫が一気にスッキリします。`;
    }
  } else if (state.ingredients.length > 0) {
    const randomIng = state.ingredients[Math.floor(Math.random() * state.ingredients.length)];
    recTag = '本日のピックアップ食材レシピ';
    recDish = `ほっこり美味しい！彩り肉じゃが`;
    recReason = `冷蔵庫にある「${randomIng.name}」を取り出して、じっくり煮込んだ和食の定番を作りましょう。味がしみた翌日も最高に美味しいです。`;
    recEmoji = '🍲';
  } else {
    recTag = '今日からスマートライフ！';
    recDish = 'ごちそう肉じゃが＆お味噌汁';
    recReason = 'まずはスーパーで、お好みの肉、じゃがいも、にんじん、玉ねぎを買ってきて冷蔵庫に登録しましょう！基本の美味しいおかずでアプリの使用をスタート！';
    recEmoji = '🥗';
  }
  
  recCardContainer.innerHTML = `
    <div class="rec-header">
      <div>
        <span class="rec-tag">${recTag}</span>
        <div class="rec-dish">${recDish}</div>
      </div>
      <span class="rec-emoji">${recEmoji}</span>
    </div>
    <p class="rec-reason">${recReason}</p>
    <button class="rec-btn" id="btn-rec-log-trigger">
      <span>🍳</span> この料理を作って記録する
    </button>
  `;
  
  // レコメンドから「これを作る」ボタンタップ時
  document.getElementById('btn-rec-log-trigger').addEventListener('click', () => {
    openLogModal(recDish);
  });
}

// B. 冷蔵庫管理の描画
function renderFridge() {
  const container = document.getElementById('fridge-list-container');
  const emptyState = document.getElementById('fridge-empty-state');
  
  if (state.ingredients.length === 0) {
    emptyState.classList.remove('hidden');
    container.innerHTML = '';
    return;
  }
  
  emptyState.classList.add('hidden');
  
  const categories = ["肉類", "魚介類", "野菜・果物", "乳製品・卵", "調味料", "その他"];
  const emojiMap = { "肉類": "🥩", "魚介類": "🐟", "野菜・果物": "🥬", "乳製品・卵": "🥛", "調味料": "🧂", "その他": "📦" };
  
  container.innerHTML = categories.map(cat => {
    const items = state.ingredients.filter(ing => ing.category === cat);
    if (items.length === 0) return '';
    
    const rows = items.map(ing => {
      const days = getDaysRemaining(ing.expiryDate);
      const status = getExpiryStatus(days);
      
      let badgeText = '';
      if (days < 0) badgeText = `期限切れ！ (\${Math.abs(days)}日超過)`;
      else if (days === 0) badgeText = '今日まで';
      else if (days === 1) badgeText = '明日まで';
      else badgeText = `あと\${days}日`;
      
      // 画像サムネイルか絵文字プレースホルダー
      const thumbContent = ing.photo 
        ? `<img src="${ing.photo}" alt="${ing.name}">`
        : `<span class="thumb-emoji">${emojiMap[cat]}</span>`;
      
      return `
        <div class="ingredient-row" data-id="${ing.id}">
          <div class="ingredient-thumb status-${status}">
            ${thumbContent}
          </div>
          
          <div class="ingredient-info">
            <div class="ingredient-name">${ing.name}</div>
            <span class="ingredient-expiry-label ${status}">${badgeText}</span>
          </div>
          
          <div class="qty-controller">
            <button class="qty-btn minus" data-id="${ing.id}">−</button>
            <span class="qty-display">${ing.quantity} ${ing.unit}</span>
            <button class="qty-btn plus" data-id="${ing.id}">＋</button>
          </div>
        </div>
      `;
    }).join('');
    
    return `
      <div class="category-block">
        <div class="category-title-bar">
          <span>${emojiMap[cat]}</span>
          <span>${cat}</span>
        </div>
        <div class="category-rows">
          ${rows}
        </div>
      </div>
    `;
  }).join('');
  
  // ＋/ー ボタンのアクション設定
  document.querySelectorAll('.qty-btn.plus').forEach(btn => {
    btn.addEventListener('click', (e) => {
      const id = e.target.getAttribute('data-id');
      const ing = state.ingredients.find(item => item.id === id);
      if (ing) {
        ing.quantity = parseFloat((ing.quantity + 1).toFixed(1));
        state.save();
        renderAll();
      }
    });
  });
  
  document.querySelectorAll('.qty-btn.minus').forEach(btn => {
    btn.addEventListener('click', (e) => {
      const id = e.target.getAttribute('data-id');
      const index = state.ingredients.findIndex(item => item.id === id);
      if (index !== -1) {
        const ing = state.ingredients[index];
        ing.quantity = parseFloat((ing.quantity - 1).toFixed(1));
        if (ing.quantity <= 0) {
          // 0以下になったら自動削除
          state.ingredients.splice(index, 1);
        }
        state.save();
        renderAll();
      }
    });
  });
}

// C. 晩ごはん履歴の描画
function renderLogs() {
  const container = document.getElementById('logs-list-container');
  const emptyState = document.getElementById('logs-empty-state');
  
  if (state.dinnerLogs.length === 0) {
    emptyState.classList.remove('hidden');
    container.innerHTML = '';
    return;
  }
  
  emptyState.classList.add('hidden');
  
  container.innerHTML = state.dinnerLogs.map(log => {
    const stars = '★'.repeat(log.rating) + '☆'.repeat(5 - log.rating);
    const dateFormatted = formatJapaneseDate(log.date);
    
    // 写真カード
    const photoTag = log.photo 
      ? `<div class="log-card-photo"><img src="${log.photo}" alt="${log.name}"></div>`
      : '';
      
    // 食材タグ
    const tags = log.ingredientsUsed.map(name => `<span class="log-tag">${name}</span>`).join('');
    
    // メモ要約
    const memoPreview = log.memo ? `<div class="log-card-memo-preview">${log.memo}</div>` : '';
    
    return `
      <div class="log-card" data-id="${log.id}">
        <div class="log-card-header">
          <span class="log-card-date">${dateFormatted}</span>
          <div class="star-rating-picker read-only">
            ${Array.from({length: 5}, (_, i) => `<span class="star-item \${i < log.rating ? 'active' : ''}">★</span>`).join('')}
          </div>
        </div>
        
        ${photoTag}
        
        <div class="log-card-title">${log.name}</div>
        
        <div class="log-card-tags">
          ${tags}
        </div>
        
        ${memoPreview}
        
        <div class="log-card-footer">
          <span>詳細・レシピを見る →</span>
        </div>
      </div>
    `;
  }).join('');
  
  // 詳細ポップアップのイベントバインド
  document.querySelectorAll('.log-card').forEach(card => {
    card.addEventListener('click', () => {
      const id = card.getAttribute('data-id');
      const log = state.dinnerLogs.find(item => item.id === id);
      if (log) {
        openLogDetailModal(log);
      }
    });
  });
}

// 統括レンダラー
function renderAll() {
  renderDashboard();
  renderFridge();
  renderLogs();
}

// ─── 5. タブ切り替え制御 ───
document.querySelectorAll('#bottom-navbar .nav-item').forEach(button => {
  button.addEventListener('click', (e) => {
    const btn = e.currentTarget;
    const tabId = btn.getAttribute('data-tab');
    
    // ナビボタンのアクティブクラス切り替え
    document.querySelectorAll('#bottom-navbar .nav-item').forEach(item => item.classList.remove('active'));
    btn.classList.add('active');
    
    // コンテンツ画面のアクティブクラス切り替え
    document.querySelectorAll('.tab-pane').forEach(pane => pane.classList.remove('active'));
    document.getElementById(tabId).classList.add('active');
  });
});

// ─── 6. モーダルシート操作 ───
function openModal(modalId) {
  document.getElementById(modalId).classList.add('show');
}

function closeModal(modalId) {
  document.getElementById(modalId).classList.remove('show');
}

// 各種キャンセルボタンの共通動作設定
document.querySelectorAll('.modal-btn-cancel, .modal-btn-close').forEach(btn => {
  btn.addEventListener('click', (e) => {
    const modal = e.target.closest('.modal-overlay');
    if (modal) {
      closeModal(modal.id);
    }
  });
});

// A. 食材追加モーダル
const btnOpenAddIngredient = document.getElementById('btn-open-add-ingredient');
const modalAddIngredient = document.getElementById('modal-add-ingredient');
const ingNameInput = document.getElementById('ing-name');
const ingPhotoInput = document.getElementById('ing-photo-input');
const ingPhotoPreview = document.getElementById('ing-photo-preview-container');
const btnSaveIngredient = document.getElementById('btn-save-ingredient');

let currentIngPhotoBase64 = null;

btnOpenAddIngredient.addEventListener('click', () => {
  // フォーム初期化
  document.getElementById('form-ingredient').reset();
  document.getElementById('ing-expiry').value = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString().split('T')[0]; // デフォルトは3日後
  currentIngPhotoBase64 = null;
  ingPhotoPreview.innerHTML = `<div class="upload-icon">📸</div><div class="upload-text">タップして写真を撮影・追加する</div>`;
  btnSaveIngredient.disabled = true;
  openModal('modal-add-ingredient');
});

// 食材入力のバリデーション
ingNameInput.addEventListener('input', () => {
  btnSaveIngredient.disabled = ingNameInput.value.trim() === '';
});

// 食材写真の読み込み処理 (カメラ撮影・ライブラリ選択)
ingPhotoInput.addEventListener('change', (e) => {
  const file = e.target.files[0];
  if (file) {
    const reader = new FileReader();
    reader.onload = (event) => {
      currentIngPhotoBase64 = event.target.result;
      ingPhotoPreview.innerHTML = `
        <img src="${currentIngPhotoBase64}" class="preview-image">
        <button type="button" class="photo-remove-btn" id="btn-remove-ing-photo">×</button>
      `;
      // 写真削除イベント
      document.getElementById('btn-remove-ing-photo').addEventListener('click', (ev) => {
        ev.preventDefault();
        ev.stopPropagation();
        currentIngPhotoBase64 = null;
        ingPhotoInput.value = '';
        ingPhotoPreview.innerHTML = `<div class="upload-icon">📸</div><div class="upload-text">タップして写真を撮影・追加する</div>`;
      });
    };
    reader.readAsDataURL(file);
  }
});

// 食材保存処理
btnSaveIngredient.addEventListener('click', (e) => {
  e.preventDefault();
  const name = ingNameInput.value.trim();
  const category = document.getElementById('ing-category').value;
  const quantity = parseFloat(document.getElementById('ing-qty').value) || 1;
  const unit = document.getElementById('ing-unit').value || "個";
  const expiryDate = document.getElementById('ing-expiry').value;
  
  if (name === '') return;
  
  const newIng = {
    id: crypto.randomUUID(),
    name,
    category,
    quantity,
    unit,
    expiryDate,
    photo: currentIngPhotoBase64
  };
  
  state.ingredients.push(newIng);
  state.save();
  renderAll();
  closeModal('modal-add-ingredient');
});

// B. 晩ごはん記録モーダル
const btnOpenAddLog = document.getElementById('btn-open-add-log');
const modalAddLog = document.getElementById('modal-add-log');
const logNameInput = document.getElementById('log-name');
const logPhotoInput = document.getElementById('log-photo-input');
const logPhotoPreview = document.getElementById('log-photo-preview-container');
const btnSaveLog = document.getElementById('btn-save-log');
const logFridgeChecklist = document.getElementById('log-fridge-checklist');

let currentLogPhotoBase64 = null;
let currentRating = 5;

// 星評価ピッカー制御
const starPicker = document.getElementById('log-star-picker');
starPicker.addEventListener('click', (e) => {
  if (e.target.classList.contains('star-item')) {
    currentRating = parseInt(e.target.getAttribute('data-value'));
    updateStarPickerUI(currentRating);
  }
});

function updateStarPickerUI(rating) {
  const stars = starPicker.querySelectorAll('.star-item');
  stars.forEach((star, index) => {
    if (index < rating) {
      star.classList.add('active');
    } else {
      star.classList.remove('active');
    }
  });
}

function openLogModal(defaultDishName = '') {
  document.getElementById('form-log').reset();
  logNameInput.value = defaultDishName;
  document.getElementById('log-date').value = new Date().toISOString().split('T')[0]; // デフォルト今日
  currentRating = 5;
  updateStarPickerUI(5);
  currentLogPhotoBase64 = null;
  logPhotoPreview.innerHTML = `<div class="upload-icon">🥘</div><div class="upload-text">料理の写真を撮影・追加する</div>`;
  btnSaveLog.disabled = defaultDishName.trim() === '';
  
  // メモ欄のマークダウンプレビュー初期化
  document.getElementById('log-memo').value = '';
  document.getElementById('log-memo-preview').innerHTML = '<span class="preview-placeholder">何も書かれていません</span>';
  switchMemoMode('edit');
  
  // 冷蔵庫食材チェックリストの構築
  buildFridgeChecklist();
  
  openModal('modal-add-log');
}

btnOpenAddLog.addEventListener('click', () => {
  openLogModal('');
});

// 料理名入力バリデーション
logNameInput.addEventListener('input', () => {
  btnSaveLog.disabled = logNameInput.value.trim() === '';
});

// 料理写真読み込み
logPhotoInput.addEventListener('change', (e) => {
  const file = e.target.files[0];
  if (file) {
    const reader = new FileReader();
    reader.onload = (event) => {
      currentLogPhotoBase64 = event.target.result;
      logPhotoPreview.innerHTML = `
        <img src="${currentLogPhotoBase64}" class="preview-image">
        <button type="button" class="photo-remove-btn" id="btn-remove-log-photo">×</button>
      `;
      // 写真削除イベント
      document.getElementById('btn-remove-log-photo').addEventListener('click', (ev) => {
        ev.preventDefault();
        ev.stopPropagation();
        currentLogPhotoBase64 = null;
        logPhotoInput.value = '';
        logPhotoPreview.innerHTML = `<div class="upload-icon">🥘</div><div class="upload-text">料理の写真を撮影・追加する</div>`;
      });
    };
    reader.readAsDataURL(file);
  }
});

// 食材連携チェックリストの生成
function buildFridgeChecklist() {
  if (state.ingredients.length === 0) {
    logFridgeChecklist.innerHTML = `<p class="checklist-empty-note">冷蔵庫に食材がありません</p>`;
    return;
  }
  
  const emojiMap = { "肉類": "🥩", "魚介類": "🐟", "野菜・果物": "🥬", "乳製品・卵": "🥛", "調味料": "🧂", "その他": "📦" };
  
  logFridgeChecklist.innerHTML = state.ingredients.map(ing => {
    return `
      <div class="checklist-row" id="checkrow-${ing.id}">
        <span class="check-btn" data-id="${ing.id}">⚪️</span>
        <span class="check-label">${emojiMap[ing.category] || "📦"} ${ing.name}</span>
        
        <div class="checklist-controls">
          <div class="deduct-segmented">
            <button type="button" class="deduct-segment-btn active" data-id="${ing.id}" data-mode="full">使い切る</button>
            <button type="button" class="deduct-segment-btn" data-id="${ing.id}" data-mode="partial">一部</button>
          </div>
          
          <div class="stepper-control hidden" id="stepper-${ing.id}">
            <button type="button" class="stepper-btn min" data-id="${ing.id}">−</button>
            <span class="stepper-val" id="stepval-${ing.id}">${ing.quantity}</span>
            <span style="font-size:0.75rem;">${ing.unit}</span>
            <button type="button" class="stepper-btn plus" data-id="${ing.id}">＋</button>
          </div>
        </div>
      </div>
    `;
  }).join('');
  
  // チェックボックスのアクション
  document.querySelectorAll('.checklist-row .check-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      const row = e.target.closest('.checklist-row');
      const id = e.target.getAttribute('data-id');
      const ing = state.ingredients.find(item => item.id === id);
      
      if (row.classList.contains('checked')) {
        row.classList.remove('checked');
        e.target.textContent = '⚪️';
      } else {
        row.classList.add('checked');
        e.target.textContent = '🟢';
        // デフォルトは全量
        document.getElementById(`stepval-${id}`).textContent = ing.quantity;
      }
    });
  });
  
  // 全量・一部 切り替えアクション
  document.querySelectorAll('.deduct-segment-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      const id = e.target.getAttribute('data-id');
      const mode = e.target.getAttribute('data-mode');
      const ing = state.ingredients.find(item => item.id === id);
      const row = e.target.closest('.checklist-row');
      
      // アクティブ切り替え
      row.querySelectorAll('.deduct-segment-btn').forEach(b => b.classList.remove('active'));
      e.target.classList.add('active');
      
      const stepper = document.getElementById(`stepper-${id}`);
      const valSpan = document.getElementById(`stepval-${id}`);
      
      if (mode === 'full') {
        stepper.classList.add('hidden');
        valSpan.textContent = ing.quantity;
      } else {
        stepper.classList.remove('hidden');
        // 半分、または最小1.0
        valSpan.textContent = parseFloat(Math.max(0.1, (ing.quantity / 2)).toFixed(1));
      }
    });
  });
  
  // ステッパーアクション
  document.querySelectorAll('.stepper-btn.plus').forEach(btn => {
    btn.addEventListener('click', (e) => {
      const id = e.target.getAttribute('data-id');
      const ing = state.ingredients.find(item => item.id === id);
      const valSpan = document.getElementById(`stepval-${id}`);
      let currentVal = parseFloat(valSpan.textContent);
      
      if (currentVal < ing.quantity) {
        currentVal = parseFloat((currentVal + 0.1).toFixed(1));
        if (currentVal > ing.quantity) currentVal = ing.quantity;
        valSpan.textContent = currentVal;
      }
    });
  });
  
  document.querySelectorAll('.stepper-btn.min').forEach(btn => {
    btn.addEventListener('click', (e) => {
      const id = e.target.getAttribute('data-id');
      const valSpan = document.getElementById(`stepval-${id}`);
      let currentVal = parseFloat(valSpan.textContent);
      
      if (currentVal > 0.1) {
        currentVal = parseFloat((currentVal - 0.1).toFixed(1));
        valSpan.textContent = currentVal;
      }
    });
  });
}

// メモ欄マークダウンプレビュー切り替え
const memoTabControl = document.getElementById('memo-tab-control');
const memoTextarea = document.getElementById('log-memo');
const memoPreviewArea = document.getElementById('log-memo-preview');

memoTabControl.addEventListener('click', (e) => {
  if (e.target.classList.contains('segment-item')) {
    const mode = e.target.getAttribute('data-mode');
    switchMemoMode(mode);
  }
});

function switchMemoMode(mode) {
  memoTabControl.querySelectorAll('.segment-item').forEach(b => b.classList.remove('active'));
  memoTabControl.querySelector(`[data-mode="${mode}"]`).classList.add('active');
  
  if (mode === 'edit') {
    memoTextarea.classList.remove('hidden');
    memoPreviewArea.classList.add('hidden');
  } else {
    memoTextarea.classList.add('hidden');
    memoPreviewArea.classList.remove('hidden');
    
    // Markdownの描画
    const rawText = memoTextarea.value;
    memoPreviewArea.innerHTML = `<div class="markdown-content">${renderMarkdown(rawText)}</div>`;
  }
}

// 晩ごはん記録保存処理（スマート自動減算連動）
btnSaveLog.addEventListener('click', (e) => {
  e.preventDefault();
  const name = logNameInput.value.trim();
  const date = document.getElementById('log-date').value;
  const memo = memoTextarea.value;
  
  if (name === '') return;
  
  // 使用食材と減算数量の計算
  const usedIngredients = [];
  const deductions = []; // { id, quantity }
  
  document.querySelectorAll('.checklist-row.checked').forEach(row => {
    const id = row.querySelector('.check-btn').getAttribute('data-id');
    const ing = state.ingredients.find(item => item.id === id);
    if (ing) {
      usedIngredients.push(ing.name);
      
      const deductVal = parseFloat(document.getElementById(`stepval-${id}`).textContent);
      deductions.push({ id, deductVal });
    }
  });
  
  const newLog = {
    id: crypto.randomUUID(),
    name,
    date,
    memo,
    rating: currentRating,
    ingredientsUsed: usedIngredients,
    photo: currentLogPhotoBase64
  };
  
  // 在庫の自動減算ロジック適用
  deductions.forEach(d => {
    const index = state.ingredients.findIndex(item => item.id === d.id);
    if (index !== -1) {
      const ing = state.ingredients[index];
      ing.quantity = parseFloat((ing.quantity - d.deductVal).toFixed(1));
      if (ing.quantity <= 0) {
        state.ingredients.splice(index, 1); // 在庫が0以下になったら完全消費として削除
      }
    }
  });
  
  state.dinnerLogs.unshift(newLog); // 最新をリストのトップへ
  state.save();
  renderAll();
  closeModal('modal-add-log');
});

// C. 晩ごはん詳細ポップアップモーダル
const modalLogDetail = document.getElementById('modal-log-detail');
const detailTitle = document.getElementById('detail-title');
const detailDate = document.getElementById('detail-date');
const detailStars = document.getElementById('detail-stars');
const detailPhotoWrapper = document.getElementById('detail-photo-wrapper');
const detailTags = document.getElementById('detail-ingredients-tags');
const detailMemoRendered = document.getElementById('detail-memo-rendered');

function openLogDetailModal(log) {
  detailTitle.textContent = log.name;
  detailDate.textContent = formatJapaneseDate(log.date);
  
  // 星評価
  detailStars.innerHTML = Array.from({length: 5}, (_, i) => `
    <span class="star-item \${i < log.rating ? 'active' : ''}">★</span>
  `).join('');
  
  // 写真
  if (log.photo) {
    detailPhotoWrapper.innerHTML = `<img src="${log.photo}" alt="${log.name}">`;
    detailPhotoWrapper.classList.remove('hidden');
  } else {
    detailPhotoWrapper.innerHTML = '';
    detailPhotoWrapper.classList.add('hidden');
  }
  
  // 食材タグ
  if (log.ingredientsUsed.length > 0) {
    detailTags.parentElement.classList.remove('hidden');
    detailTags.innerHTML = log.ingredientsUsed.map(name => `
      <span class="log-tag" style="font-size:0.75rem; padding:4px 10px; background-color:var(--primary-light); color:var(--primary);">${name}</span>
    `).join('');
  } else {
    detailTags.innerHTML = '';
    detailTags.parentElement.classList.add('hidden');
  }
  
  // マークダウンメモレンダリング
  detailMemoRendered.innerHTML = renderMarkdown(log.memo);
  
  openModal('modal-log-detail');
}

// ─── 7. アプリ初期化実行 ───
state.load();
renderAll();
