// ─── 0. サービスワーカー登録 (PWA) ＆ 強制自動即時アップデート ───
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js')
      .then(reg => {
        console.log('サービスワーカー登録成功:', reg.scope);

        // 起動時にサーバー上の更新ファイルを強制チェック
        reg.update();

        // アップデートが検出されインストールされた際の即時反映処理
        reg.onupdatefound = () => {
          const installingWorker = reg.installing;
          if (installingWorker) {
            installingWorker.onstatechange = () => {
              if (installingWorker.state === 'installed' && navigator.serviceWorker.controller) {
                console.log('新しいアップデートを検出しました。即時適用のためリロードします。');
                window.location.reload();
              }
            };
          }
        };
      })
      .catch(err => console.log('サービスワーカー登録失敗:', err));
  });

  // アクティブなサービスワーカーが切り替わったらページを自動で即座に再起動
  let refreshing = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!refreshing) {
      refreshing = true;
      window.location.reload();
    }
  });
}

// ─── 0.5. アプリの共通設定とマッピング ───
const INGREDIENT_EMOJI_MAP = {
  "肉類": "🥩",
  "魚介類": "🐟",
  "野菜・果物": "🥬",
  "卵・乳製品": "🥚",
  "乳製品・卵": "🥚", // 旧データ互換用
  "練り物・豆腐": "🍥",
  "主食・麺・パン": "🍞",
  "調味料": "🧂",
  "飲料・ドリンク": "🥤",
  "お酒": "🍻",
  "その他・缶詰など": "📦",
  "その他": "📦" // 旧データ互換用
};

// ─── 1. グローバルアプリケーション状態 ───
// ユーザー状態に応じたLocalStorageのキーを取得するヘルパー
function getStorageKeys() {
  const user = window.sheetDB ? sheetDB.getCurrentUser() : null;
  if (user && user.id) {
    return {
      ingredients: `ingredients_${user.id}`,
      dinnerLogs: `dinnerLogs_${user.id}`,
      shoppingList: `shoppingList_${user.id}`
    };
  } else {
    return {
      ingredients: 'ingredients_guest',
      dinnerLogs: 'dinnerLogs_guest',
      shoppingList: 'shoppingList_guest'
    };
  }
}

const state = {
  ingredients: [],
  dinnerLogs: [],
  shoppingList: [], // 買い物メモ用の配列

  // データ保存用ヘルパー
  save() {
    const keys = getStorageKeys();
    localStorage.setItem(keys.ingredients, JSON.stringify(this.ingredients));
    localStorage.setItem(keys.dinnerLogs, JSON.stringify(this.dinnerLogs));
    localStorage.setItem(keys.shoppingList, JSON.stringify(this.shoppingList));
    if (typeof triggerCloudSync === 'function') {
      triggerCloudSync();
    }
  },

  load() {
    // 以前の古いデモサンプルデータを一度だけ自動クリーンアップして初期化
    if (localStorage.getItem('purgedSampleData') !== 'true') {
      localStorage.removeItem('ingredients');
      localStorage.removeItem('dinnerLogs');
      localStorage.removeItem('shoppingList');
      localStorage.setItem('purgedSampleData', 'true');
    }

    // 後方互換性：古い「_guestなし」のキーが存在し、且つ「_guestあり」のキーが未存在の場合、自動で移行する
    const legacyIng = localStorage.getItem('ingredients');
    const legacyLogs = localStorage.getItem('dinnerLogs');
    const legacyShop = localStorage.getItem('shoppingList');

    if (legacyIng && !localStorage.getItem('ingredients_guest')) {
      localStorage.setItem('ingredients_guest', legacyIng);
      localStorage.removeItem('ingredients');
    }
    if (legacyLogs && !localStorage.getItem('dinnerLogs_guest')) {
      localStorage.setItem('dinnerLogs_guest', legacyLogs);
      localStorage.removeItem('dinnerLogs');
    }
    if (legacyShop && !localStorage.getItem('shoppingList_guest')) {
      localStorage.setItem('shoppingList_guest', legacyShop);
      localStorage.removeItem('shoppingList');
    }

    const keys = getStorageKeys();
    const rawIng = localStorage.getItem(keys.ingredients);
    const rawLogs = localStorage.getItem(keys.dinnerLogs);
    const rawShop = localStorage.getItem(keys.shoppingList);

    this.ingredients = rawIng ? JSON.parse(rawIng) : [];
    this.dinnerLogs = rawLogs ? JSON.parse(rawLogs) : [];
    this.shoppingList = rawShop ? JSON.parse(rawShop) : [];
  }
};

// 安全なUUID生成関数 (HTTP非セキュアコンテキスト下でも動作するフォールバック付)
function generateUUID() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  // 非セキュア環境 (HTTP経由でのスマホ検証時など) のためのフォールバック
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
    const r = Math.random() * 16 | 0;
    const v = c === 'x' ? r : (r & 0x3 | 0x8);
    return v.toString(16);
  });
}

// スマホの巨大画像をローカルストレージ限界(5MB)を超えないよう圧縮・リサイズする関数 (最大幅800px, JPEG品質0.7)
function compressAndResizeImage(file, callback) {
  const reader = new FileReader();
  reader.onload = (e) => {
    const img = new Image();
    img.onload = () => {
      try {
        const canvas = document.createElement('canvas');
        let width = img.width;
        let height = img.height;

        const MAX_WIDTH = 800;
        const MAX_HEIGHT = 800;

        if (width > height) {
          if (width > MAX_WIDTH) {
            height *= MAX_WIDTH / width;
            width = MAX_WIDTH;
          }
        } else {
          if (height > MAX_HEIGHT) {
            width *= MAX_HEIGHT / height;
            height = MAX_HEIGHT;
          }
        }

        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, width, height);

        // JPEG形式・品質0.7（軽量かつ十分高画質）で圧縮
        const compressedDataUrl = canvas.toDataURL('image/jpeg', 0.7);
        callback(compressedDataUrl);
      } catch (err) {
        console.error("Canvas compression failed, falling back to original:", err);
        callback(e.target.result); // エラー時はオリジナルデータURLでフォールバック
      }
    };
    img.onerror = (err) => {
      console.error("Image load failed, falling back to original:", err);
      callback(e.target.result); // 画像読み込み失敗時もオリジナルでフォールバック
    };
    img.src = e.target.result;
  };
  reader.onerror = (err) => {
    console.error("FileReader failed:", err);
    callback(null); // ファイル読み込み失敗時はnullでコールバック
  };
  reader.readAsDataURL(file);
}

// 日本語の全角数字を半角数字に自動変換してFloatパースする関数
function parseJapaneseFloat(str) {
  if (str === null || str === undefined) return null;
  const strVal = String(str).trim();
  if (strVal === '') return null;

  // 全角の数字、小数点「．」を半角に置換
  let cleaned = strVal.replace(/[０-９．]/g, (s) => {
    if (s === '．') return '.';
    return String.fromCharCode(s.charCodeAt(0) - 0xFEE0);
  });

  const parsed = parseFloat(cleaned);
  return isNaN(parsed) ? null : parsed;
}

// 消費期限までの残り日数を計算
function getDaysRemaining(expiryDateString) {
  if (!expiryDateString) return 999; // 期限なし
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const expiry = new Date(expiryDateString);
  if (isNaN(expiry.getTime())) return 999; // パース失敗時は安全なフォールバック
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

// 人数の表示用フォーマット
function formatServings(servings) {
  if (!servings) return '2人前';
  const str = String(servings).trim();
  if (str.endsWith('人前')) {
    return str;
  }
  return str + '人前';
}

// 日付の和風フォーマット
function formatJapaneseDate(dateString, withDayOfWeek = true) {
  if (!dateString) return '日付不明';
  const date = new Date(dateString);
  if (isNaN(date.getTime())) {
    return dateString; // パースできない場合は元の文字列をそのまま返してRangeErrorを回避（フォールバック）
  }
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

// A. ダッシュボード（マイページ＆メモ用データ）の描画
function renderDashboardData() {
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
      if (ing.days < 0) warningText = `期限切れ （${Math.abs(ing.days)}日経過)`;
      else if (ing.days === 0) warningText = '今日が期限です';
      else if (ing.days === 1) warningText = '明日まで';
      else warningText = `期限まであと ${ing.days} 日`;

      const emoji = INGREDIENT_EMOJI_MAP[ing.category] || "📦";

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
          <div style="font-size:0.9rem; font-weight:700; color:var(--text-main);">すべての食材が安全です</div>
          <div style="font-size:0.75rem; color:var(--text-sub); margin-top:2px;">期限が近い食材はありません。管理バッチリです。</div>
        </div>
      </div>
    `;
  }

  // --- AI食事構成要素分析の描画 ---
  const profileContainer = document.getElementById('ai-preference-profile-card');
  const prefData = analyzeUserPreferences();

  if (!prefData || state.dinnerLogs.length === 0) {
    if (profileContainer) {
      profileContainer.innerHTML = `
        <div class="profile-empty-placeholder">
          <span class="profile-empty-icon">📊</span>
          <div class="profile-empty-title">データを分析中</div>
          <p class="profile-empty-text">晩ごはんを記録していくと、使用食材やレシピメモからAIが裏側で自動的に構成要素（鍋・サラダ等）を抽出して可視化します。</p>
        </div>
      `;
    }
  } else {
    const primaryElement = prefData[0]; // 最も比率が高い食事要素

    let profileDesc = "";
    if (primaryElement.name === "🍲 鍋・煮込み") {
      profileDesc = "おでんや肉じゃが、カレー、シチューなどの「鍋・煮込み」を好んで作っています。素材の旨味がお出汁にじわっと染みた、心ほぐれる優しい料理に高い評価をつけています。";
    } else if (primaryElement.name === "🥩 焼き物・炒め物") {
      profileDesc = "フライパンやグリルでサッと香ばしく仕上げる「焼き物・炒め物」を多く作っています。ジューシーなお肉や野菜のソテーなど、手際よく仕上がるメインおかずに高評価をつけています。";
    } else if (primaryElement.name === "🥗 サラダ・和え物") {
      profileDesc = "新鮮なお野菜をたっぷり使った「サラダ・和え物」を多く作っています。ドレッシングやポン酢でさっぱりと仕上げる、健康志向で爽やかなサイドメニューに高評価をつけています。";
    } else if (primaryElement.name === "🥣 汁物・スープ") {
      profileDesc = "旨味が溶け込んだ温かい「汁物・スープ」を多く作っています。出汁やコンソメの香りがフワッと広がる、食卓に安らぎを与えるお汁物に高評価をつけています。";
    } else if (primaryElement.name === "🍤 揚げ物") {
      profileDesc = "サクサクに揚がった唐揚げやカツなど、ごちそう感あふれる「揚げ物」を多く作っています。噛むたびに旨味が広がる、特別感のある一品に高い評価をつけています。";
    } else if (primaryElement.name === "🍜 麺類") {
      profileDesc = "つるっと食べられるパスタやうどん、ラーメンなどの「麺類」を好んで作っています。こだわりのソースやスープが絡む、手軽で満足度の高い一皿に高評価をつけています。";
    } else if (primaryElement.name === "🍛 丼物・ご飯物") {
      profileDesc = "具材をご飯にのせる大満足の「丼物・ご飯物」や、香ばしいチャーハン、オムライスなどを多く作っています。カレーライスや一皿で大満足のご飯メニューに高評価をつけています。";
    }

    // 上位3つの要素をゲージで表示
    const topElements = prefData.slice(0, 3);
    const gaugeRows = topElements.map(item => {
      return `
        <div class="profile-stat-row">
          <div class="profile-stat-name-row">
            <span>${item.name}</span>
            <span>${item.percentage}%</span>
          </div>
          <div class="profile-gauge-bar-bg">
            <div class="profile-gauge-bar-fill" style="width: ${item.percentage}%;"></div>
          </div>
        </div>
      `;
    }).join('');

    if (profileContainer) {
      profileContainer.innerHTML = `
        <div class="profile-header">
          <span class="profile-primary-element">${primaryElement.name}中心</span>
          <span class="profile-badge">AI自動解析の傾向</span>
        </div>
        <p class="profile-desc">${profileDesc}</p>
        <div class="profile-stats-title">よく作る食事構成要素</div>
        <div class="profile-stats-list">
          ${gaugeRows}
        </div>
      `;
    }
  }

  // --- AIレシピ提案の動的構築 ---
  let recTag = '本日のおすすめレシピ';
  let recDish = 'コク旨万能カレーライス';
  let recReason = '冷蔵庫にある余ったお野菜や調味料を加えて、栄養たっぷりのオリジナルカレーを作ってみませんか？カレーならどんな食材でも美味しくまとまります。';
  let recEmoji = '🍛';

  // ユーザーのメイン構成要素を判定 (無ければデフォルトは丼物)
  const primaryPrefName = (prefData && prefData.length > 0) ? prefData[0].name : "🍛 丼物・ご飯物";

  if (alerts.length > 0) {
    const target = alerts[0];
    recEmoji = INGREDIENT_EMOJI_MAP[target.category] || '🍳';

    // 好み構成要素と期限食材カテゴリーのインテリジェントマッピング
    if (target.category === '肉類') {
      recTag = `期限間近の「${target.name}」を消費`;
      if (primaryPrefName === "🍲 鍋・煮込み") {
        recDish = `お出汁香る ほっこり「${target.name}」の肉じゃが風煮込み`;
        recReason = `冷蔵庫で期限が迫る「${target.name}」を、じゃがいもやにんじんをお出汁でコトコト煮込み、甘辛い味わいがじんわり染みるほっこり煮物をおすすめします。`;
      } else if (primaryPrefName === "🥗 サラダ・和え物") {
        recDish = `さっぱり「${target.name}」の冷しゃぶ風温野菜サラダ`;
        recReason = `期限が近い「${target.name}」をサッと茹でて冷まし、冷蔵庫のレタスやキャベツとお好みのドレッシングで和える、ヘルシーなサラダ仕立てをおすすめします。`;
      } else if (primaryPrefName === "🥣 汁物・スープ") {
        recDish = `旨味たっぷり「${target.name}」と具だくさんおかず豚汁`;
        recReason = `期限が近い「${target.name}」のジューシーな旨味を活かし、大根やこんにゃく等とお味噌でじっくりコトコト煮込む、栄養満点でおかずになるお汁物です。`;
      } else if (primaryPrefName === "🍤 揚げ物") {
        recDish = `極上ジューシー「${target.name}」のカラッと唐揚げ`;
        recReason = `期限が近い「${target.name}」に生姜とニンニクを効かせ、衣をまぶして外はカリッ、中はジュワッとジューシーに揚げて極上の美味しさを味わいましょう。`;
      } else if (primaryPrefName === "🍜 麺類") {
        recDish = `とろける「${target.name}」の濃厚和風肉南蛮うどん`;
        recReason = `期限が近い「${target.name}」の旨みがお出汁に溶け出し、もちもちのうどん麺にネギと一緒に優しく絡む、手軽で温まる一杯です。`;
      } else { // デフォルト 焼き物・炒め物 / 丼物
        recDish = `ご飯が進む「${target.name}」のスタミナ甘辛炒め丼`;
        recReason = `冷蔵庫の「${target.name}」をキャベツやネギと一緒に強火で香ばしく炒め、ご飯の上にドカンとのせるスタミナ満点の一杯です。`;
      }
    } else if (target.category === '野菜・果物') {
      recTag = `新鮮な「${target.name}」を美味しく消費`;
      if (primaryPrefName === "🍲 鍋・煮込み") {
        recDish = `味が染み渡る「${target.name}」と根菜のおでん風和風煮込み`;
        recReason = `期限が迫る「${target.name}」をお出汁でじっくり時間をかけて煮込み、おでんのように中まで味がじわっと染み込んだ温かい煮物料理をおすすめします。`;
      } else if (primaryPrefName === "🥗 サラダ・和え物") {
        recDish = `シャキシャキ「${target.name}」の彩り特製和風サラダ`;
        recReason = `新鮮な「${target.name}」を主役に、キャベツやトマトと合わせてドレッシングで和える、食卓をみずみずしく彩るヘルシーなサラダです。`;
      } else if (primaryPrefName === "🥣 汁物・スープ") {
        recDish = `お野菜と「${target.name}」の和風コンソメスープ`;
        recReason = `期限が近い「${target.name}」から出る優しい甘みをスープに溶かし、豆腐などと一緒に優しくすする、体に染み入る温かい一杯です。`;
      } else if (primaryPrefName === "🍜 麺類") {
        recDish = `たっぷり「${target.name}」の具だくさん和風焼きそば`;
        recReason = `期限が近い「${target.name}」をたっぷり千切りにして麺と一緒に香ばしく炒める、シャキシャキ食感が楽しい特製焼きそばです。`;
      } else { // デフォルト 焼き物・炒め物 / 丼物
        recDish = `ふんわり卵と「${target.name}」の強火スタミナ炒め`;
        recReason = `「${target.name}」をふんわり炒めた卵と合わせ、ごま油を少し垂らして強火でサッと炒め上げる、ご飯との相性抜群のおかずです。`;
      }
    } else if (target.category === '魚介類') {
      recTag = `旨味豊かな「${target.name}」の消費レシピ`;
      if (primaryPrefName === "🍲 鍋・煮込み") {
        recDish = `「${target.name}」と大根のお出汁染みる寄せ鍋風煮込み`;
        recReason = `期限が近い「${target.name}」から出る絶品のお出汁を大根や白菜にたっぷり吸わせ、お鍋のようにハフハフと温まりながら食べる一品です。`;
      } else if (primaryPrefName === "🥗 サラダ・和え物") {
        recDish = `「${target.name}」のさっぱりカルパッチョ風サラダ`;
        recReason = `新鮮な「${target.name}」を薄切りにしてレタスにのせ、オリーブオイルとレモンをキュッと絞って和える、おしゃれな前菜サラダです。`;
      } else if (primaryPrefName === "🥣 汁物・スープ") {
        recDish = `「${target.name}」の旨み溶け出す潮仕立てお吸い物`;
        recReason = `期限が近い「${target.name}」を贅沢に使い、かつおだしと塩・少量の醤油で上品に仕上げた、魚介の芳醇な香りを楽しむ極上お吸い物です。`;
      } else { // デフォルト 焼き物・炒め物 / 丼物
        recDish = `香ばしい「${target.name}」の特製焦がし醤油ソテー`;
        recReason = `「${target.name}」をバターでカリッと焼き上げ、仕上げに醤油をひと回しして香ばしさを引き立てる、大満足のごちそうおかずです。`;
      }
    } else if (target.category === '卵・乳製品' || target.category === '乳製品・卵') {
      recTag = `クリーミーに「${target.name}」を消費`;
      if (primaryPrefName === "🍲 鍋・煮込み") {
        recDish = `とろーり「${target.name}」の野菜クリーミーシチュー`;
        recReason = `「${target.name}」の濃厚なコクを活かし、じゃがいもやにんじんをお鍋でじっくり優しく煮込む、心まで温まるシチューです。`;
      } else if (primaryPrefName === "🥗 サラダ・和え物") {
        recDish = `「${target.name}」とアボカドの濃厚カプレーゼ和え`;
        recReason = `「${target.name}」をトマトやアボカドと重ね合わせ、オリーブオイルとバジルで和える、見た目もおしゃれでヘルシーな冷菜サイドメニューです。`;
      } else if (primaryPrefName === "🍜 麺類") {
        recDish = `「${target.name}」で仕上げる濃厚クリーミーパスタ`;
        recReason = `「${target.name}」のクリーミーさをベースに、モチモチのパスタ麺とベーコンを絡める、極上のパスタプレートです。`;
      } else { // デフォルト 焼き物・炒め物 / 丼物
        recDish = `とろーり「${target.name}」のふんわり包みオムライス`;
        recReason = `「${target.name}」を包み込んだふんわり卵を、ケチャップライスの上にのせる、おうちカフェ気分を楽しめる大人気メニューです。`;
      }
    } else {
      recTag = '冷蔵庫お助けメニュー';
      recDish = `「${target.name}」を活かしたパラパラ黄金チャーハン`;
      recReason = `冷蔵庫で出番を待つ「${target.name}」を細かく刻み、ご飯と卵と一緒に強火で一気にパラパラに炒め上げる、スピーディーで美味しい一皿です。`;
    }
  } else if (state.ingredients.length > 0) {
    // 期限食材が無いが、何か食材がある場合（過去の好みを優先して推薦）
    const randomIng = state.ingredients[Math.floor(Math.random() * state.ingredients.length)];
    recTag = `${primaryPrefName}のおすすめメニュー`;
    recEmoji = primaryPrefName.substring(0, 2); // 絵文字を抽出

    if (primaryPrefName === "🍲 鍋・煮込み") {
      recDish = `お出汁が染みる「${randomIng.name}」の特製ほっこり煮`;
      recReason = `冷蔵庫にある「${randomIng.name}」を使って、コトコト煮込んだ温かい煮物を作りましょう。中までじっくり味が染みて、明日も美味しく召し上がれます。`;
    } else if (primaryPrefName === "🥗 サラダ・和え物") {
      recDish = `「${randomIng.name}」のシャキシャキ特製冷製サラダ`;
      recReason = `「${randomIng.name}」の新鮮な食感を活かし、お好みのドレッシングやタレでサッと和えて食べる、体も喜ぶサラダをおすすめします。`;
    } else if (primaryPrefName === "🥣 汁物・スープ") {
      recDish = `「${randomIng.name}」で作る香り引き立つ具だくさん味噌汁`;
      recReason = `「${randomIng.name}」の旨みがたっぷりお出汁に溶け出し、豆腐等と合わせ味噌で優しく仕上げる、毎日の食卓に欠かせない一杯です。`;
    } else if (primaryPrefName === "🍜 麺類") {
      recDish = `「${randomIng.name}」の絶品パスタソースプレート`;
      recReason = `「${randomIng.name}」の風味をベースに、モチモチのパスタ麺とニンニクオリーブオイルでサッと絡める、手軽で満足度の高い一皿です。`;
    } else if (primaryPrefName === "🍤 揚げ物") {
      recDish = `「${randomIng.name}」のカリッとジューシー竜田揚げ`;
      recReason = `「${randomIng.name}」に下味をつけて衣をまぶし、カリッと香ばしく揚げる、お箸が止まらなくなる大人気おかずです。`;
    } else { // 丼物 / 焼き物
      recDish = `「${randomIng.name}」の香ばしスタミナ醤油炒め`;
      recReason = `冷蔵庫の「${randomIng.name}」を取り出して、キャベツなどとお醤油で香ばしく炒めましょう。強火で一気に仕上げるのが美味しさのコツです。`;
    }
  } else {
    recTag = '今日からスタート';
    recDish = 'ごちそう肉じゃが';
    recReason = 'まずはスーパーでお好みの肉、じゃがいも、にんじん、玉ねぎを買ってきて冷蔵庫に登録しましょう。基本の美味しいおかずでアプリの使用をスタート。';
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
      この料理を作って記録する
    </button>
  `;

  // レコメンドから「これを作る」ボタンタップ時
  document.getElementById('btn-rec-log-trigger').addEventListener('click', () => {
    openLogModal(recDish);
  });

  // 買い物メモの描画を実行
  renderShoppingList();
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

  // 優先順位に基づきカテゴリ一覧を構成（旧カテゴリが残っている場合は互換性のために動的に末尾に追加）
  const predefinedCategories = ["肉類", "魚介類", "野菜・果物", "卵・乳製品", "練り物・豆腐", "主食・麺・パン", "調味料", "飲料・ドリンク", "お酒", "その他・缶詰など"];
  const activeCategories = Array.from(new Set(state.ingredients.map(ing => ing.category)));
  const categories = predefinedCategories.concat(activeCategories.filter(c => !predefinedCategories.includes(c)));

  container.innerHTML = categories.map(cat => {
    const items = state.ingredients.filter(ing => ing.category === cat);
    if (items.length === 0) return '';

    const rows = items.map(ing => {
      const days = getDaysRemaining(ing.expiryDate);
      const status = getExpiryStatus(days);
      const isZero = ing.quantity === 0;
      const rowClass = isZero ? 'ingredient-row out-of-stock-row' : 'ingredient-row';

      let badgeText = '';
      if (days < 0) badgeText = `期限切れ (${Math.abs(days)}日経過)`;
      else if (days === 0) badgeText = '今日まで';
      else if (days === 1) badgeText = '明日まで';
      else badgeText = `あと${days}日`;

      // 画像サムネイルか絵文字プレースホルダー
      const thumbContent = ing.photo
        ? `<img src="${ing.photo}" alt="${ing.name}">`
        : `<span class="thumb-emoji">${INGREDIENT_EMOJI_MAP[cat] || "📦"}</span>`;

      const deleteButtonHtml = isZero
        ? `
          <div class="row-delete-container" style="display: flex; gap: 8px; padding-left: 78px; padding-bottom: 12px;">
            <button type="button" class="row-delete-btn" data-id="${ing.id}">削除する</button>
            <button type="button" class="row-add-memo-btn" data-id="${ing.id}" data-name="${ing.name}" data-unit="${ing.unit}">メモに追加</button>
          </div>
        `
        : '';

      return `
        <div class="${rowClass}" data-id="${ing.id}">
          <div class="ingredient-thumb status-${status}">
            ${thumbContent}
          </div>

          <div class="ingredient-info">
            <div class="ingredient-name">${ing.name}</div>
            <span class="ingredient-expiry-label ${status}">${badgeText}</span>
          </div>

          <div class="qty-controller">
            <button class="qty-btn minus" data-id="${ing.id}">−</button>
            <input type="text" class="qty-input" data-id="${ing.id}" value="${ing.quantity}">
            <span style="font-size:0.75rem; font-weight:700; color:var(--text-sub); margin-left:2px; margin-right:4px;">${ing.unit}</span>
            <button class="qty-btn plus" data-id="${ing.id}">＋</button>
          </div>
        </div>
        ${deleteButtonHtml}
      `;
    }).join('');

    return `
      <div class="category-block">
        <div class="category-title-bar">
          <span>${INGREDIENT_EMOJI_MAP[cat] || "📦"}</span>
          <span>${cat}</span>
        </div>
        <div class="category-rows">
          ${rows}
        </div>
      </div>
    `;
  }).join('');

  // ＋/ー ボタンのアクション設定 (伝播を遮断し、入力欄の数字も同期)
  document.querySelectorAll('.qty-btn.plus').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation(); // 行クリックイベントを遮断
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
      e.stopPropagation(); // 行クリックイベントを遮断
      const id = e.target.getAttribute('data-id');
      const index = state.ingredients.findIndex(item => item.id === id);
      if (index !== -1) {
        const ing = state.ingredients[index];
        ing.quantity = parseFloat((ing.quantity - 1).toFixed(1));
        if (ing.quantity < 0) {
          ing.quantity = 0; // 0未満にはならず0件として維持
        }
        state.save();
        renderAll();
      }
    });
  });

  // 直接入力用テキストボックスのアクション設定 (全角・半角両対応)
  document.querySelectorAll('.qty-input').forEach(input => {
    input.addEventListener('click', (e) => {
      e.stopPropagation(); // 行クリックイベントを遮断
    });

    const handleQtyChange = (e) => {
      const id = e.target.getAttribute('data-id');
      const index = state.ingredients.findIndex(item => item.id === id);
      if (index !== -1) {
        const ing = state.ingredients[index];
        const rawVal = e.target.value;
        const val = parseJapaneseFloat(rawVal);

        if (val !== null && val >= 0) {
          ing.quantity = parseFloat(val.toFixed(1));
        } else {
          // 不正値なら以前の数値に戻す
          e.target.value = ing.quantity;
          return;
        }
        state.save();
        renderAll();
      }
    };

    input.addEventListener('blur', handleQtyChange);
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.target.blur(); // Enterで入力を確定
      }
    });
  });

  // 食材カードのタップで行編集モーダルを開く
  document.querySelectorAll('.ingredient-row').forEach(row => {
    row.addEventListener('click', (e) => {
      if (e.target.closest('.qty-controller')) {
        return; // 数量調整部のタップ時は無視
      }
      const id = row.getAttribute('data-id');
      const ing = state.ingredients.find(item => item.id === id);
      if (ing) {
        openIngredientModalForEdit(ing);
      }
    });
  });

  // 0件食材の下の「削除する」ボタンのアクション設定
  document.querySelectorAll('.row-delete-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const id = e.target.getAttribute('data-id');
      state.ingredients = state.ingredients.filter(item => item.id !== id);
      state.save();
      renderAll();
    });
  });

  // 0件食材の下の「メモに追加」ボタンのアクション設定 (買い物メモ連携)
  document.querySelectorAll('.row-add-memo-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const name = e.target.getAttribute('data-name');
      const unit = e.target.getAttribute('data-unit');

      // 重複チェックして買い物リストに追加
      const exists = state.shoppingList.some(item => item.text === `${name} (${unit})`);
      if (!exists) {
        state.shoppingList.push({
          id: generateUUID(),
          text: `${name} (${unit})`,
          checked: false
        });
        state.save();
      }

      // 極上のマイクロインタラクション：ボタン文字を「追加しました」に変更して1秒後に再描画
      const originalText = e.target.textContent;
      e.target.textContent = '追加しました';
      e.target.style.backgroundColor = 'var(--secondary-light)';
      e.target.disabled = true;

      setTimeout(() => {
        e.target.textContent = originalText;
        e.target.style.backgroundColor = 'white';
        e.target.disabled = false;
        renderAll();
      }, 800);
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
    const dateFormatted = formatJapaneseDate(log.date);

    // 写真カード
    const photoTag = log.photo
      ? `<div class="log-card-photo"><img src="${log.photo}" alt="${log.name}"></div>`
      : '';

    // 食事要素タグと食材タグの表示
    const compHtml = (log.components || []).map(comp => `<span class="log-tag" style="background-color:var(--secondary-light); color:var(--secondary);">${comp}</span>`).join('');
    const ingredientsArray = log.ingredientsUsed || log.usedIngredients || [];
    const ingHtml = ingredientsArray.map(item => {
      let label = "";
      if (typeof item === 'object' && item !== null) {
        const qtyStr = item.quantity !== undefined && item.quantity !== null ? ` ${item.quantity}${item.unit || ''}` : '';
        label = `${item.name}${qtyStr}`;
      } else {
        label = item;
      }
      return `<span class="log-tag">${label}</span>`;
    }).join('');
    const tags = compHtml + ingHtml;

    // メモ要約
    const memoPreview = log.memo ? `<div class="log-card-memo-preview">${log.memo}</div>` : '';

    const percentage = (parseFloat(log.rating || 5) / 5.0) * 100;
    const ratingVal = parseFloat(log.rating || 5).toFixed(1);

    const servingsText = log.servings ? ` <span style="font-size: 0.75rem; color: var(--text-sub); font-weight: 500; margin-left: 4px;">(${log.servings})</span>` : '';

    return `
      <div class="log-card" data-id="${log.id}">
        <div class="log-card-header">
          <span class="log-card-date">${dateFormatted}${servingsText}</span>
          <div style="display: flex; align-items: center; gap: 8px;">
            <div class="star-rating-display">
              <span class="stars-empty">★★★★★</span>
              <span class="stars-filled" style="width: ${percentage}%;">★★★★★</span>
            </div>
            <span style="font-size: 0.8rem; font-weight: 700; color: var(--primary);">${ratingVal}</span>
          </div>
        </div>

        ${photoTag}

        <div class="log-card-title">${log.name}</div>

        <div class="log-card-tags">
          ${tags}
        </div>

        ${memoPreview}

        <div class="log-card-footer" style="display: flex; justify-content: space-between; align-items: center; padding: 12px 16px;">
          <span style="font-size: 0.8rem; color: var(--primary);">詳細・レシピを見る</span>
          <button type="button" class="btn-share-log-timeline" data-id="${log.id}" style="padding: 6px 12px; border-radius: 8px; font-size: 0.75rem; background-color: var(--primary-light); color: var(--primary); border: none; font-weight: 600; cursor: pointer; transition: all 0.2s ease; display: flex; align-items: center; gap: 4px;">
            📲 タイムラインに共有
          </button>
        </div>
      </div>
    `;
  }).join('');

  // 詳細ポップアップのイベントバインド
  document.querySelectorAll('.log-card').forEach(card => {
    card.addEventListener('click', (e) => {
      // 共有ボタンのクリック時は詳細を開かないように防ぐ
      if (e.target.closest('.btn-share-log-timeline')) return;

      const id = card.getAttribute('data-id');
      const log = state.dinnerLogs.find(item => item.id === id);
      if (log) {
        openLogDetailModal(log);
      }
    });
  });

  // ワンタップ共有ボタンのイベントバインド
  document.querySelectorAll('.btn-share-log-timeline').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.preventDefault();
      e.stopPropagation(); // 親要素のカードクリックイベントを伝播させない

      const currentUser = sheetDB.getCurrentUser();
      if (!currentUser) {
        alert('タイムラインにレシピを共有するには、ログインが必要です！');
        return;
      }

      const id = btn.getAttribute('data-id');
      const log = state.dinnerLogs.find(item => item.id === id);
      if (!log) return;

      btn.disabled = true;
      const originalText = btn.innerHTML;
      btn.innerHTML = '📤 共有中...';
      btn.style.backgroundColor = 'var(--border-color)';
      btn.style.color = 'var(--text-sub)';

      try {
        await sheetDB.postDinner(null, log);

        // 極上のマイクロインタラクションフィードバック
        btn.innerHTML = '✅ 投稿しました！';
        btn.style.backgroundColor = '#E0FDF4';
        btn.style.color = '#10B981';

        // タイムラインを再描画
        renderTimeline();

        setTimeout(() => {
          btn.innerHTML = originalText;
          btn.style.backgroundColor = 'var(--primary-light)';
          btn.style.color = 'var(--primary)';
          btn.disabled = false;
        }, 1500);
      } catch (err) {
        console.error(err);
        alert('共有に失敗しました。ネットワーク状況を確認してください。');
        btn.innerHTML = originalText;
        btn.style.backgroundColor = 'var(--primary-light)';
        btn.style.color = 'var(--primary)';
        btn.disabled = false;
      }
    });
  });
}

// 統括レンダラー
// 新規: タイムラインの描画
async function renderTimeline() {
  const container = document.getElementById('tl-feed-container');
  const emptyState = document.getElementById('tl-empty-state');
  const loginBanner = document.getElementById('tl-login-banner');

  if (!window.sheetDB) return;

  const user = sheetDB.getCurrentUser();
  if (!user) {
    loginBanner.style.display = 'block';
    container.innerHTML = '';
    emptyState.classList.add('hidden');
    return;
  }

  loginBanner.style.display = 'none';

  try {
    const posts = await sheetDB.getFollowingFeed(user.id);
    if (!posts || posts.length === 0) {
      emptyState.classList.remove('hidden');
      container.innerHTML = '';
      return;
    }

    // エスケープ処理用の簡易ヘルパー
    const escapeString = (str) => {
      if (!str) return '';
      return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    };

    emptyState.classList.add('hidden');
    container.innerHTML = posts.map(post => {
      const isMyPost = post.userId === user.id;
      const tags = (post.ingredients || []).map(ing => {
        let label = typeof ing === 'object' ? `${ing.name} ${ing.quantity || ''}${ing.unit || ''}` : ing;
        return `<span class="tl-post-ingredient-tag">${label}</span>`;
      }).join('');

      const ratingWidth = (parseFloat(post.rating || 5) / 5) * 100;
      const photoHtml = post.photo ? `<img src="${post.photo}" class="tl-post-photo" alt="Photo">` : '';

      return `
        <div class="tl-post-card" data-postid="${post.id}">
          <div class="tl-post-header">
            <div class="tl-post-avatar" data-userid="${post.userId}">${post.avatarEmoji || '🧑‍🍳'}</div>
            <div class="tl-post-author">
              <div class="tl-post-nickname">${post.nickname || '名無し'}</div>
              <div class="tl-post-date">${formatJapaneseDate(post.date)}</div>
            </div>
            ${isMyPost ? `<button class="icon-btn-info" style="width:30px;height:30px;font-size:0.8rem;" onclick="deletePost('${post.id}')">🗑</button>` : ''}
          </div>
          ${photoHtml}
          <div class="tl-post-body">
            <div class="tl-post-dishname">${post.dishName}</div>
            <div class="tl-post-meta">
              <span>👤 ${formatServings(post.servings)}</span>
              <span class="tl-post-rating">★ ${parseFloat(post.rating || 5).toFixed(1)}</span>
            </div>
            <div class="tl-post-ingredients">${tags}</div>
            ${post.memo ? `
              <div class="tl-post-memo-section">
                <div class="tl-post-memo-preview" id="memo-${post.id}" style="white-space: pre-wrap; line-height: 1.6; font-size: 0.85rem; color: var(--text-main);">${escapeString(post.memo)}</div>
                <button class="tl-markdown-toggle-btn" data-postid="${post.id}" data-is-md="false">📝 マークダウンで表示する</button>
              </div>
            ` : ''}
          </div>
        </div>
      `;
    }).join('');

    // プロフィールモーダルを開くイベント
    container.querySelectorAll('.tl-post-avatar').forEach(avatar => {
      avatar.addEventListener('click', (e) => {
        e.stopPropagation(); // 詳細モーダルの起動を防ぐ
        const userId = avatar.getAttribute('data-userid');
        openUserProfileModal(userId);
      });
    });

    // カードタップで詳細を開くイベント
    container.querySelectorAll('.tl-post-card').forEach(card => {
      card.addEventListener('click', (e) => {
        // 特定アクションボタンやアバター等のクリック時は詳細を開かない
        if (e.target.closest('.tl-post-avatar') || 
            e.target.closest('.icon-btn-info') || 
            e.target.closest('.tl-markdown-toggle-btn')) {
          return;
        }

        const postId = card.getAttribute('data-postid');
        const post = posts.find(p => p.id === postId);
        if (post) {
          const isMyPost = post.userId === user.id;
          const localLog = isMyPost ? state.dinnerLogs.find(item => item.id === post.id) : null;
          if (localLog) {
            openLogDetailModal(localLog, true); // 自分の投稿かつローカルログありなら編集可能
          } else {
            openLogDetailModal(post, false); // 他人の投稿なら編集不可
          }
        }
      });
    });

    // マークダウン切り替えイベント
    container.querySelectorAll('.tl-markdown-toggle-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation(); // 詳細モーダルの起動を防ぐ
        const postId = btn.getAttribute('data-postid');
        const memoDiv = document.getElementById(`memo-${postId}`);
        const post = posts.find(p => p.id === postId);
        if (!post || !memoDiv) return;

        const isMd = btn.getAttribute('data-is-md') === 'true';
        if (isMd) {
          // プレーンテキストに戻す（3行制限を復元）
          memoDiv.innerHTML = escapeString(post.memo);
          memoDiv.style.whiteSpace = 'pre-wrap';
          memoDiv.style.webkitLineClamp = '3';
          memoDiv.style.display = '-webkit-box';
          btn.innerHTML = '📝 マークダウンで表示する';
          btn.setAttribute('data-is-md', 'false');
        } else {
          // マークダウンでレンダリング（行制限を完全解除）
          memoDiv.innerHTML = `<div class="markdown-content">${renderMarkdown(post.memo)}</div>`;
          memoDiv.style.whiteSpace = 'normal';
          memoDiv.style.webkitLineClamp = 'none';
          memoDiv.style.display = 'block';
          btn.innerHTML = '📄 プレーンテキストで表示する';
          btn.setAttribute('data-is-md', 'true');
        }
      });
    });

  } catch(e) {
    console.error("Timeline error:", e);
    container.innerHTML = `<p style="text-align:center;color:red;padding:20px;">読み込みエラーが発生しました</p>`;
  }
}

window.deletePost = async function(postId) {
  if (confirm('この投稿を削除しますか？')) {
    await sheetDB.deletePost(postId);
    renderTimeline();
  }
};

// 新規: マイページの描画
async function renderMyPage() {
  const authArea = document.getElementById('mypage-auth-area');
  const profileArea = document.getElementById('mypage-profile-area');

  if (!window.sheetDB) return;
  const user = sheetDB.getCurrentUser();

  if (!user) {
    authArea.classList.remove('hidden');
    profileArea.classList.add('hidden');
    return;
  }

  authArea.classList.add('hidden');
  profileArea.classList.remove('hidden');

  // プロフィール情報反映
  document.getElementById('mypage-nickname').textContent = user.nickname || user.username;
  document.getElementById('mypage-username').textContent = '@' + user.username;
  document.getElementById('mypage-avatar').textContent = user.avatarEmoji || '🧑‍🍳';

  // 入力欄への反映
  const usernameInput = document.getElementById('mypage-username-input');
  const nicknameInput = document.getElementById('mypage-nickname-input');
  const bioInput = document.getElementById('mypage-bio');

  if (usernameInput) usernameInput.value = user.username || '';
  if (nicknameInput) nicknameInput.value = user.nickname || '';
  if (bioInput) bioInput.value = user.bio || '';

  // アバター入力欄への反映と初期化
  const avatarInput = document.getElementById('mypage-avatar-input');
  if (avatarInput) {
    avatarInput.value = user.avatarEmoji || '🧑‍🍳';
    avatarInput.style.borderColor = '';
    const warningEl = document.getElementById('mypage-avatar-warning');
    if (warningEl) warningEl.style.display = 'none';
  }

  // 統計取得 (非同期)
  try {
    const prof = await sheetDB.getUserProfile(user.id);
    document.getElementById('mypage-following-count').textContent = prof.followingCount || 0;
    document.getElementById('mypage-followers-count').textContent = prof.followersCount || 0;
    document.getElementById('mypage-posts-count').textContent = prof.posts ? prof.posts.length : 0;
  } catch(e) {
    console.error("Profile load error:", e);
  }
}

function renderAll() {
  renderDashboardData();
  renderFridge();
  renderLogs();
  renderTimeline();
  renderMyPage();
}

// 買い物メモ（Shopping List）のレンダリング
function renderShoppingList() {
  const container = document.getElementById('memo-shopping-list');

  if (!container) return;

  if (state.shoppingList.length === 0) {
    container.innerHTML = `<li style="font-size:0.8rem; text-align:center; color:var(--text-sub); font-style:italic; padding:12px 0; width:100%;">買うものは登録されていません</li>`;
    return;
  }

  container.innerHTML = state.shoppingList.map(item => {
    const itemClass = item.checked ? 'shopping-item completed' : 'shopping-item';
    const checkIcon = item.checked ? '🟢' : '⚪️';

    return `
      <li class="${itemClass}" data-id="${item.id}">
        <span class="shopping-check" data-id="${item.id}">${checkIcon}</span>
        <span class="shopping-text">${item.text}</span>
        <button type="button" class="shopping-delete-btn" data-id="${item.id}">削除</button>
      </li>
    `;
  }).join('');

  // チェックボタンのイベント紐付け
  document.querySelectorAll('.shopping-check').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const id = e.target.getAttribute('data-id');
      const item = state.shoppingList.find(i => i.id === id);
      if (item) {
        item.checked = !item.checked;
        state.save();
        renderAll();
      }
    });
  });

  // 行タップでの削除ボタン表示切り替え（アコーディオン制御）
  document.querySelectorAll('.shopping-item').forEach(itemRow => {
    itemRow.addEventListener('click', (e) => {
      // チェックボタンや削除ボタン自体のクリック時は何もしない
      if (e.target.closest('.shopping-check') || e.target.closest('.shopping-delete-btn')) {
        return;
      }

      const id = itemRow.getAttribute('data-id');

      // 他のすべての行の削除ボタン表示を閉じる
      document.querySelectorAll('.shopping-item').forEach(row => {
        if (row.getAttribute('data-id') !== id) {
          row.classList.remove('show-delete');
        }
      });

      // 自行の削除ボタン表示状態を切り替える
      itemRow.classList.toggle('show-delete');
    });
  });

  // 個別削除ボタンのイベント紐付け
  document.querySelectorAll('.shopping-delete-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const id = e.target.getAttribute('data-id');
      state.shoppingList = state.shoppingList.filter(item => item.id !== id);
      state.save();
      renderAll();
    });
  });
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

// A. 食材追加・編集モーダル
const btnOpenAddIngredient = document.getElementById('btn-open-add-ingredient');
const modalAddIngredient = document.getElementById('modal-add-ingredient');
const ingNameInput = document.getElementById('ing-name');
const ingPhotoInput = document.getElementById('ing-photo-input');
const ingPhotoPreview = document.getElementById('ing-photo-preview-container');
const btnSaveIngredient = document.getElementById('btn-save-ingredient');
const btnDeleteIngredient = document.getElementById('btn-delete-ingredient');
const ingDeleteSection = document.getElementById('ing-delete-section');

let currentIngPhotoBase64 = null;
let editingIngredientId = null; // 編集中の食材ID (新規はnull)

btnOpenAddIngredient.addEventListener('click', () => {
  editingIngredientId = null;
  document.getElementById('ingredient-modal-title').textContent = "新しい食材";
  ingDeleteSection.classList.add('hidden');

  // フォーム初期化
  document.getElementById('form-ingredient').reset();
  document.getElementById('ing-expiry').value = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString().split('T')[0]; // デフォルトは3日後
  currentIngPhotoBase64 = null;
  ingPhotoPreview.innerHTML = `<div class="upload-icon">📸</div><div class="upload-text">写真を撮影・選択</div>`;
  btnSaveIngredient.disabled = true;
  openModal('modal-add-ingredient');
});

// 行タップ時の食材編集モード起動
function openIngredientModalForEdit(ing) {
  editingIngredientId = ing.id;
  document.getElementById('ingredient-modal-title').textContent = "食材の編集";
  ingDeleteSection.classList.remove('hidden');

  // 各フォーム値の復元
  ingNameInput.value = ing.name;
  document.getElementById('ing-category').value = ing.category;
  document.getElementById('ing-qty').value = ing.quantity;
  document.getElementById('ing-unit').value = ing.unit;
  document.getElementById('ing-expiry').value = ing.expiryDate;

  // 写真復元
  currentIngPhotoBase64 = ing.photo;
  if (ing.photo) {
    ingPhotoPreview.innerHTML = `
      <img src="${ing.photo}" class="preview-image">
      <button type="button" class="photo-remove-btn" id="btn-remove-ing-photo">×</button>
    `;
    document.getElementById('btn-remove-ing-photo').addEventListener('click', (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      currentIngPhotoBase64 = null;
      ingPhotoInput.value = '';
      ingPhotoPreview.innerHTML = `<div class="upload-icon">📸</div><div class="upload-text">写真を撮影・選択</div>`;
    });
  } else {
    ingPhotoPreview.innerHTML = `<div class="upload-icon">📸</div><div class="upload-text">写真を撮影・選択</div>`;
  }

  btnSaveIngredient.disabled = false;
  openModal('modal-add-ingredient');
}

// 食材編集モーダル内の削除ボタン処理
btnDeleteIngredient.addEventListener('click', () => {
  if (editingIngredientId) {
    state.ingredients = state.ingredients.filter(item => item.id !== editingIngredientId);
    state.save();
    renderAll();
    closeModal('modal-add-ingredient');
    editingIngredientId = null;
  }
});

// 食材入力のバリデーション ＆ 数量全角数字自動変換
ingNameInput.addEventListener('input', () => {
  btnSaveIngredient.disabled = ingNameInput.value.trim() === '';
});

const ingQtyInput = document.getElementById('ing-qty');
if (ingQtyInput) {
  ingQtyInput.addEventListener('blur', (e) => {
    const val = parseJapaneseFloat(e.target.value);
    if (val !== null && val >= 0) {
      e.target.value = parseFloat(val.toFixed(1));
    } else {
      e.target.value = 1.0; // 不正な入力は1.0にリセット
    }
  });
  ingQtyInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.target.blur();
    }
  });
}

// 食材写真の読み込み処理 (カメラ撮影・ライブラリ選択)
ingPhotoInput.addEventListener('change', (e) => {
  const file = e.target.files[0];
  if (file) {
    compressAndResizeImage(file, (compressedDataUrl) => {
      currentIngPhotoBase64 = compressedDataUrl;
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
        ingPhotoPreview.innerHTML = `<div class="upload-icon">📸</div><div class="upload-text">写真を撮影・選択</div>`;
      });
    });
  }
});

// 食材保存処理
btnSaveIngredient.addEventListener('click', async (e) => {
  e.preventDefault();
  const name = ingNameInput.value.trim();
  if (name === '') return;

  // ボタンの無効化とローディング表示
  btnSaveIngredient.disabled = true;
  const originalText = btnSaveIngredient.textContent;
  btnSaveIngredient.textContent = '保存中...';

  try {
    const category = document.getElementById('ing-category').value;

    // 全角入力に対応した数量のFloat変換
    const rawQty = document.getElementById('ing-qty').value;
    const parsedQty = parseJapaneseFloat(rawQty);
    const quantity = (parsedQty !== null && parsedQty >= 0) ? parseFloat(parsedQty.toFixed(1)) : 1.0;

    const unit = document.getElementById('ing-unit').value || "個";
    const expiryDate = document.getElementById('ing-expiry').value;

    if (editingIngredientId) {
      // 編集・更新処理
      const index = state.ingredients.findIndex(item => item.id === editingIngredientId);
      if (index !== -1) {
        state.ingredients[index] = {
          id: editingIngredientId,
          name,
          category,
          quantity,
          unit,
          expiryDate,
          photo: currentIngPhotoBase64
        };
      }
    } else {
      // 新規追加処理
      const newIng = {
        id: generateUUID(),
        name,
        category,
        quantity,
        unit,
        expiryDate,
        photo: currentIngPhotoBase64
      };
      state.ingredients.push(newIng);
    }

    state.save();
    renderAll();
    closeModal('modal-add-ingredient');
  } catch (err) {
    console.error("Save ingredient failed:", err);
    alert("食材の保存に失敗しました。");
  } finally {
    editingIngredientId = null;
    btnSaveIngredient.disabled = false;
    btnSaveIngredient.textContent = originalText;
  }
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
let currentRating = 5.0;
let editingLogId = null; // 編集中のログID (新規はnull)
let activeDetailLog = null; // 現在詳細表示中のログ

// 星評価スライダー制御
const ratingSlider = document.getElementById('log-rating-slider');
const ratingValueLabel = document.getElementById('log-rating-value');
const ratingStarFilled = document.getElementById('log-star-filled');

if (ratingSlider) {
  ratingSlider.addEventListener('input', (e) => {
    currentRating = parseFloat(parseFloat(e.target.value).toFixed(1));
    updateSliderRatingUI(currentRating);
  });
}

function updateSliderRatingUI(rating) {
  if (ratingValueLabel && ratingStarFilled) {
    ratingValueLabel.textContent = rating.toFixed(1);
    const percentage = (rating / 5.0) * 100;
    ratingStarFilled.style.width = `${percentage}%`;
  }
}

function openLogModal(defaultDishName = '', existingLog = null) {
  document.getElementById('form-log').reset();

  const titleEl = document.getElementById('log-modal-title');
  const deleteSecEl = document.getElementById('log-delete-section');

  if (existingLog) {
    editingLogId = existingLog.id;
    if (titleEl) titleEl.textContent = "記録の編集";
    btnSaveLog.textContent = "保存する";
    if (deleteSecEl) deleteSecEl.classList.remove('hidden');

    logNameInput.value = existingLog.name;
    document.getElementById('log-date').value = existingLog.date;

    // 人数の復元
    let servingsVal = existingLog.servings || '2';
    servingsVal = String(servingsVal).replace(/人前/g, '').trim();
    document.getElementById('log-servings').value = servingsVal || '2';

    currentRating = parseFloat(existingLog.rating || 5.0);
    if (ratingSlider) {
      ratingSlider.value = currentRating;
    }
    updateSliderRatingUI(currentRating);

    currentLogPhotoBase64 = existingLog.photo;
    if (existingLog.photo) {
      logPhotoPreview.innerHTML = `
        <img src="${currentLogPhotoBase64}" class="preview-image">
        <button type="button" class="photo-remove-btn" id="btn-remove-log-photo">×</button>
      `;
      document.getElementById('btn-remove-log-photo').addEventListener('click', (ev) => {
        ev.preventDefault();
        ev.stopPropagation();
        currentLogPhotoBase64 = null;
        logPhotoInput.value = '';
        logPhotoPreview.innerHTML = `<div class="upload-icon">🥘</div><div class="upload-text">料理の写真を撮影・追加する</div>`;
      });
    } else {
      logPhotoPreview.innerHTML = `<div class="upload-icon">🥘</div><div class="upload-text">料理の写真を撮影・追加する</div>`;
    }

    document.getElementById('log-memo').value = existingLog.memo || '';
    document.getElementById('log-memo-preview').innerHTML = '<span class="preview-placeholder">何も書かれていません</span>';
    switchMemoMode('edit');

    // チェックリストの復元
    buildFridgeChecklist(existingLog.ingredientsUsed || existingLog.usedIngredients || []);
  } else {
    editingLogId = null;
    if (titleEl) titleEl.textContent = "晩ごはんを記録";
    btnSaveLog.textContent = "記録する";
    if (deleteSecEl) deleteSecEl.classList.add('hidden');

    logNameInput.value = defaultDishName;
    document.getElementById('log-date').value = new Date().toISOString().split('T')[0]; // デフォルト今日

    // 人数の初期化
    document.getElementById('log-servings').value = '2';

    currentRating = 5.0;
    if (ratingSlider) {
      ratingSlider.value = 5.0;
    }
    updateSliderRatingUI(5.0);
    currentLogPhotoBase64 = null;
    logPhotoPreview.innerHTML = `<div class="upload-icon">🥘</div><div class="upload-text">料理の写真を撮影・選択</div>`;

    document.getElementById('log-memo').value = '';
    document.getElementById('log-memo-preview').innerHTML = '<span class="preview-placeholder">何も書かれていません</span>';
    switchMemoMode('edit');

    buildFridgeChecklist([]);
  }

  // タイムライン共有チェックボックスの初期表示制御
  const shareCheckbox = document.getElementById('log-share-timeline');
  const shareDesc = document.getElementById('log-share-timeline-desc');
  if (shareCheckbox && shareDesc) {
    const currentUser = sheetDB.getCurrentUser();
    if (!currentUser) {
      shareCheckbox.checked = false;
      shareCheckbox.disabled = true;
      shareDesc.textContent = '※ログインするとタイムラインへの共有機能が利用できます。';
      shareDesc.style.color = 'var(--text-sub)';
    } else {
      shareCheckbox.disabled = false;
      shareDesc.textContent = 'このレシピをSNSタイムラインに投稿し、他の人と共有します。';
      shareDesc.style.color = 'var(--text-sub)';

      // 編集時はすでに共有されているか非同期で確認して反映
      if (existingLog) {
        // ロード中は仮で true にしておく
        shareCheckbox.checked = true;
        sheetDB.isTimelineShared(existingLog.id).then(isShared => {
          shareCheckbox.checked = isShared;
        }).catch(() => {
          shareCheckbox.checked = true;
        });
      } else {
        shareCheckbox.checked = true;
      }
    }
  }

  btnSaveLog.disabled = logNameInput.value.trim() === '';
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
    compressAndResizeImage(file, (compressedDataUrl) => {
      currentLogPhotoBase64 = compressedDataUrl;
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
    });
  }
});

// 食材連携チェックリストの生成
function buildFridgeChecklist(checkedNames = []) {
  if (state.ingredients.length === 0) {
    logFridgeChecklist.innerHTML = `<p class="checklist-empty-note">冷蔵庫に食材がありません</p>`;
    return;
  }

  logFridgeChecklist.innerHTML = state.ingredients.map(ing => {
    let isChecked = false;
    let usedQty = ing.quantity; // デフォルトは全量
    let isPartial = false;      // デフォルトは全量

    const foundUsed = checkedNames.find(item => {
      if (typeof item === 'object' && item !== null) {
        return item.name === ing.name;
      }
      return item === ing.name;
    });

    if (foundUsed) {
      isChecked = true;
      if (typeof foundUsed === 'object' && foundUsed !== null) {
        usedQty = foundUsed.quantity !== undefined ? foundUsed.quantity : ing.quantity;
        isPartial = usedQty < ing.quantity;
      }
    }

    const checkIcon = isChecked ? '🟢' : '⚪️';
    const rowClass = isChecked ? 'checklist-row checked' : 'checklist-row';
    const segmentFullClass = isPartial ? 'deduct-segment-btn' : 'deduct-segment-btn active';
    const segmentPartialClass = isPartial ? 'deduct-segment-btn active' : 'deduct-segment-btn';
    const stepperClass = isPartial ? 'stepper-control' : 'stepper-control hidden';

    return `
      <div class="${rowClass}" id="checkrow-${ing.id}">
        <span class="check-btn" data-id="${ing.id}">${checkIcon}</span>
        <span class="check-label">${INGREDIENT_EMOJI_MAP[ing.category] || "📦"} ${ing.name}</span>

        <div class="checklist-controls">
          <div class="deduct-segmented">
            <button type="button" class="${segmentFullClass}" data-id="${ing.id}" data-mode="full">使い切る</button>
            <button type="button" class="${segmentPartialClass}" data-id="${ing.id}" data-mode="partial">一部</button>
          </div>

          <div class="${stepperClass}" id="stepper-${ing.id}">
            <button type="button" class="stepper-btn min" data-id="${ing.id}">−</button>
            <input type="text" class="stepper-input" id="stepval-${ing.id}" data-id="${ing.id}" value="${usedQty}" style="width: 50px; text-align: center; border: 1px solid var(--border-color); border-radius: 6px; font-size: 0.85rem; font-weight: 700; color: var(--text-main); padding: 2px 0;">
            <span style="font-size:0.75rem; margin-left: 2px;">${ing.unit}</span>
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
        document.getElementById(`stepval-${id}`).value = ing.quantity;
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

      row.querySelectorAll('.deduct-segment-btn').forEach(b => b.classList.remove('active'));
      e.target.classList.add('active');

      const stepper = document.getElementById(`stepper-${id}`);
      const valInput = document.getElementById(`stepval-${id}`);

      if (mode === 'full') {
        stepper.classList.add('hidden');
        valInput.value = ing.quantity;
      } else {
        stepper.classList.remove('hidden');
        valInput.value = parseFloat(Math.max(0.1, (ing.quantity / 2)).toFixed(1));
      }
    });
  });

  // ステッパーアクション
  document.querySelectorAll('.stepper-btn.plus').forEach(btn => {
    btn.addEventListener('click', (e) => {
      const id = e.target.getAttribute('data-id');
      const ing = state.ingredients.find(item => item.id === id);
      const valInput = document.getElementById(`stepval-${id}`);
      let currentVal = parseJapaneseFloat(valInput.value) || 0;

      if (currentVal < ing.quantity) {
        currentVal = parseFloat((currentVal + 0.1).toFixed(1));
        if (currentVal > ing.quantity) currentVal = ing.quantity;
        valInput.value = currentVal;
      }
    });
  });

  document.querySelectorAll('.stepper-btn.min').forEach(btn => {
    btn.addEventListener('click', (e) => {
      const id = e.target.getAttribute('data-id');
      const valInput = document.getElementById(`stepval-${id}`);
      let currentVal = parseJapaneseFloat(valInput.value) || 0;

      if (currentVal > 0.1) {
        currentVal = parseFloat((currentVal - 0.1).toFixed(1));
        valInput.value = currentVal;
      }
    });
  });

  // 直接入力用テキストボックスのアクション設定
  document.querySelectorAll('.stepper-input').forEach(input => {
    const handleValChange = (e) => {
      const id = e.target.getAttribute('data-id');
      const ing = state.ingredients.find(item => item.id === id);
      if (!ing) return;

      const rawVal = e.target.value;
      const val = parseJapaneseFloat(rawVal);

      if (val !== null && val >= 0.1) {
        let finalVal = parseFloat(val.toFixed(1));
        if (finalVal > ing.quantity) {
          finalVal = ing.quantity;
        }
        e.target.value = finalVal;
      } else {
        e.target.value = 0.1;
      }
    };

    input.addEventListener('blur', handleValChange);
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.target.blur();
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
btnSaveLog.addEventListener('click', async (e) => {
  e.preventDefault();
  const name = logNameInput.value.trim();
  const date = document.getElementById('log-date').value;
  const servings = document.getElementById('log-servings').value.replace(/人前/g, '').trim() || '2';
  const memo = memoTextarea.value;

  if (name === '') return;

  // ボタンの無効化とローディング表示
  btnSaveLog.disabled = true;
  const originalText = btnSaveLog.textContent;
  btnSaveLog.textContent = '保存中...';

  try {
    // 使用食材と減算数量の計算
    const usedIngredients = [];
    const deductions = []; // { id, quantity }

    document.querySelectorAll('.checklist-row.checked').forEach(row => {
      const id = row.querySelector('.check-btn').getAttribute('data-id');
      const ing = state.ingredients.find(item => item.id === id);
      if (ing) {
        const deductVal = parseJapaneseFloat(document.getElementById(`stepval-${id}`).value) || ing.quantity;

        usedIngredients.push({
          name: ing.name,
          quantity: deductVal,
          unit: ing.unit
        });

        deductions.push({ id, deductVal });
      }
    });

    const ingNamesOnly = usedIngredients.map(item => item.name);
    const components = extractMealComponents(name, ingNamesOnly, memo);

    // 共有用のログを事前に特定する
    const targetSavedLog = editingLogId
      ? state.dinnerLogs.find(item => item.id === editingLogId)
      : null;

    if (editingLogId) {
      // 編集・更新処理
      const index = state.dinnerLogs.findIndex(item => item.id === editingLogId);
      if (index !== -1) {
        state.dinnerLogs[index] = {
          ...state.dinnerLogs[index],
          name,
          date,
          memo,
          rating: currentRating,
          servings: servings,
          ingredientsUsed: usedIngredients,
          components: components,
          photo: currentLogPhotoBase64
        };
      }
    } else {
      // 新規追加処理
      const newLog = {
        id: generateUUID(),
        name,
        date,
        memo,
        rating: currentRating,
        servings: servings,
        ingredientsUsed: usedIngredients,
        components: components,
        photo: currentLogPhotoBase64
      };

      // 在庫の自動減算ロジック適用 (新規記録時のみ)
      deductions.forEach(d => {
        const index = state.ingredients.findIndex(item => item.id === d.id);
        if (index !== -1) {
          const ing = state.ingredients[index];
          ing.quantity = parseFloat((ing.quantity - d.deductVal).toFixed(1));
          if (ing.quantity < 0) {
            ing.quantity = 0;
          }
        }
      });

      state.dinnerLogs.unshift(newLog);
    }

    state.save();

    // タイムライン共有スイッチがONかつログイン済みの場合、非同期でタイムラインにも自動投稿・削除トグル処理を行う
    const shareCheckbox = document.getElementById('log-share-timeline');
    if (shareCheckbox && shareCheckbox.checked) {
      const currentUser = sheetDB.getCurrentUser();
      if (currentUser) {
        // 編集時は事前に取得した対象（編集後の新しいデータが入ったもの）、新規時はunshiftした最新を使用
        const logToShare = targetSavedLog
          ? state.dinnerLogs.find(item => item.id === targetSavedLog.id)
          : state.dinnerLogs[0];

        if (logToShare) {
          try {
            await sheetDB.postDinner(null, logToShare);
            console.log("Automatically shared to timeline.");
            renderTimeline();
          } catch (err) {
            console.error("Auto timeline share failed:", err);
          }
        }
      }
    } else {
      // 共有チェックがオフの場合で、編集時であれば、既存のタイムライン投稿を削除する（トグル機能）
      if (editingLogId) {
        const currentUser = sheetDB.getCurrentUser();
        if (currentUser) {
          try {
            await sheetDB.deletePost(editingLogId);
            console.log("Automatically deleted from timeline.");
            renderTimeline();
          } catch (err) {
            console.error("Auto timeline delete failed:", err);
          }
        }
      }
    }

    renderAll();
    closeModal('modal-add-log');
  } catch (err) {
    console.error("Save log failed:", err);
    alert("晩ごはんの保存に失敗しました。");
  } finally {
    // 最後に editingLogId を安全にクリアし、ボタンを有効化
    editingLogId = null;
    btnSaveLog.disabled = false;
    btnSaveLog.textContent = originalText;
  }
});

// C. 晩ごはん詳細ポップアップモーダル
const modalLogDetail = document.getElementById('modal-log-detail');
const detailTitle = document.getElementById('detail-title');
const detailDate = document.getElementById('detail-date');
const detailStars = document.getElementById('detail-stars');
const detailPhotoWrapper = document.getElementById('detail-photo-wrapper');
const detailTags = document.getElementById('detail-ingredients-tags');
const detailMemoRendered = document.getElementById('detail-memo-rendered');

function openLogDetailModal(log, isEditable = true) {
  activeDetailLog = log; // 現在詳細表示中のログを保持
  detailTitle.textContent = log.name || log.dishName;
  detailDate.textContent = formatJapaneseDate(log.date);

  // 編集ボタンの表示制御
  const btnEditLogTrigger = document.getElementById('btn-edit-log-trigger');
  if (btnEditLogTrigger) {
    btnEditLogTrigger.style.display = isEditable ? 'block' : 'none';
  }

  // 人数表示の更新
  const servingsEl = document.getElementById('detail-servings');
  if (servingsEl) {
    servingsEl.textContent = formatServings(log.servings);
  }

  // 星評価 (小数点対応)
  const percentage = (parseFloat(log.rating || 5) / 5.0) * 100;
  detailStars.innerHTML = `
    <span class="stars-empty">★★★★★</span>
    <span class="stars-filled" style="width: ${percentage}%;">★★★★★</span>
  `;
  const starsVal = document.getElementById('detail-stars-val');
  if (starsVal) {
    starsVal.textContent = parseFloat(log.rating || 5).toFixed(1);
  }

  // 写真
  if (log.photo) {
    detailPhotoWrapper.innerHTML = `<img src="${log.photo}" alt="${log.name || log.dishName}">`;
    detailPhotoWrapper.classList.remove('hidden');
  } else {
    detailPhotoWrapper.innerHTML = '';
    detailPhotoWrapper.classList.add('hidden');
  }

  // 食材タグ
  const ingredientsArray = log.ingredientsUsed || log.usedIngredients || log.ingredients || [];
  if (ingredientsArray.length > 0) {
    detailTags.parentElement.classList.remove('hidden');
    detailTags.innerHTML = ingredientsArray.map(item => {
      let label = "";
      if (typeof item === 'object' && item !== null) {
        const qtyStr = item.quantity !== undefined && item.quantity !== null ? ` ${item.quantity}${item.unit || ''}` : '';
        label = `${item.name}${qtyStr}`;
      } else {
        label = item;
      }
      return `
        <span class="log-tag" style="font-size:0.75rem; padding:4px 10px; background-color:var(--primary-light); color:var(--primary);">${label}</span>
      `;
    }).join('');
  } else {
    detailTags.innerHTML = '';
    detailTags.parentElement.classList.add('hidden');
  }

  // マークダウンメモレンダリング
  detailMemoRendered.innerHTML = renderMarkdown(log.memo);

  openModal('modal-log-detail');
}

// 晩ごはん履歴の編集・削除イベントバインド
const btnEditLogTrigger = document.getElementById('btn-edit-log-trigger');
if (btnEditLogTrigger) {
  btnEditLogTrigger.addEventListener('click', () => {
    if (activeDetailLog) {
      closeModal('modal-log-detail');
      openLogModal('', activeDetailLog);
    }
  });
}

const btnDeleteLog = document.getElementById('btn-delete-log');
if (btnDeleteLog) {
  btnDeleteLog.addEventListener('click', async () => {
    if (editingLogId) {
      if (confirm('本当に削除していいですか？')) {
        // ボタンをローディング表示にして二重クリックを防ぐ
        const originalText = btnDeleteLog.textContent;
        btnDeleteLog.disabled = true;
        btnDeleteLog.textContent = '削除中...';

        try {
          const currentUser = sheetDB.getCurrentUser();
          if (currentUser) {
            // 1. タイムライン投稿も削除する（もし共有されていれば）
            try {
              await sheetDB.deletePost(editingLogId);
              console.log("Timeline post auto-deleted.");
            } catch (err) {
              console.error("Auto timeline delete failed:", err);
            }
          }

          // 2. ローカルから削除
          state.dinnerLogs = state.dinnerLogs.filter(item => item.id !== editingLogId);
          
          // 3. ローカルの保存
          state.save();

          // 4. クラウドに直接上書き同期を送信して確実に待機する
          if (currentUser && window.sheetDB && sheetDB.isLive()) {
            await sheetDB.syncUserData(currentUser.id, state.ingredients, state.dinnerLogs, state.shoppingList);
            console.log("Server DB dinner log deletion completed.");
          }
          
          renderAll();
          closeModal('modal-add-log');
          editingLogId = null;
        } catch (err) {
          console.error("Delete log failed:", err);
          alert("削除中にエラーが発生しました。");
        } finally {
          btnDeleteLog.disabled = false;
          btnDeleteLog.textContent = originalText;
        }
      }
    }
  });
}

// タイムライン手動更新ボタンのイベントバインド
const btnRefreshTimeline = document.getElementById('btn-refresh-timeline');
if (btnRefreshTimeline) {
  btnRefreshTimeline.addEventListener('click', async () => {
    btnRefreshTimeline.classList.add('spinning');
    btnRefreshTimeline.disabled = true;
    try {
      await renderTimeline();
    } catch (e) {
      console.error(e);
    } finally {
      // スピンアニメーションが滑らかに見えるよう最低500msは回す
      setTimeout(() => {
        btnRefreshTimeline.classList.remove('spinning');
        btnRefreshTimeline.disabled = false;
      }, 500);
    }
  });
}

// アプリ情報モーダルのイベントバインド
const btnOpenInfo = document.getElementById('btn-open-info');
if (btnOpenInfo) {
  btnOpenInfo.addEventListener('click', () => {
    openModal('modal-app-info');
  });
}

const btnOpenChangelog = document.getElementById('btn-open-changelog');
if (btnOpenChangelog) {
  btnOpenChangelog.addEventListener('click', () => {
    openModal('modal-app-changelog');
  });
}

// ─── ユーザー検索モーダルのイベントバインド ───
const btnOpenSearch = document.getElementById('btn-open-search');
const btnCloseSearch = document.getElementById('btn-close-search');
const userSearchInput = document.getElementById('user-search-input');
const btnClearSearch = document.getElementById('btn-clear-search');
const userSearchResults = document.getElementById('user-search-results');

let searchableUsers = [];
let currentMyFollowingIds = [];

if (btnOpenSearch) {
  btnOpenSearch.addEventListener('click', async () => {
    openModal('modal-user-search');

    // 初期クリア
    if (userSearchInput) userSearchInput.value = '';
    if (btnClearSearch) btnClearSearch.classList.add('hidden');
    if (userSearchResults) {
      userSearchResults.innerHTML = '<p style="text-align: center; color: var(--text-sub); font-size: 0.85rem; padding: 32px 0;">読み込み中...</p>';
    }

    try {
      // 全ユーザーをロード
      const allUsers = await sheetDB.getAllUsers();
      const currentUser = sheetDB.getCurrentUser();

      // 自分以外のユーザーを検索対象にする
      searchableUsers = allUsers.filter(u => !currentUser || u.id !== currentUser.id);

      // 現在フォローしている人のIDリストを取得
      if (currentUser) {
        const followRes = await sheetDB.getFollowingIds(currentUser.id);
        currentMyFollowingIds = (followRes || []).map(String);
      } else {
        currentMyFollowingIds = [];
      }

      // 初期状態：全員を表示
      renderSearchResults(searchableUsers);
    } catch (e) {
      console.error(e);
      if (userSearchResults) {
        userSearchResults.innerHTML = '<p style="text-align: center; color: var(--red); font-size: 0.85rem; padding: 32px 0;">ユーザー一覧の取得に失敗しました</p>';
      }
    }
  });
}

if (btnCloseSearch) {
  btnCloseSearch.addEventListener('click', () => {
    closeModal('modal-user-search');
  });
}

// リアルタイム検索（入力時）
if (userSearchInput) {
  userSearchInput.addEventListener('input', (e) => {
    const query = e.target.value.trim().toLowerCase();

    if (query) {
      if (btnClearSearch) btnClearSearch.classList.remove('hidden');

      const filtered = searchableUsers.filter(u =>
        (u.username || '').toLowerCase().includes(query) ||
        (u.nickname || '').toLowerCase().includes(query)
      );
      renderSearchResults(filtered);
    } else {
      if (btnClearSearch) btnClearSearch.classList.add('hidden');
      renderSearchResults(searchableUsers);
    }
  });
}

// クリアボタン
if (btnClearSearch) {
  btnClearSearch.addEventListener('click', () => {
    if (userSearchInput) userSearchInput.value = '';
    btnClearSearch.classList.add('hidden');
    renderSearchResults(searchableUsers);
  });
}

// 検索結果を描画する関数
function renderSearchResults(users) {
  if (!userSearchResults) return;

  if (users.length === 0) {
    userSearchResults.innerHTML = '<p style="text-align: center; color: var(--text-sub); font-size: 0.85rem; padding: 32px 0;">該当するユーザーは見つかりません</p>';
    return;
  }

  const currentUser = sheetDB.getCurrentUser();

  userSearchResults.innerHTML = users.map(u => {
    const emoji = u.avatarEmoji || '🧑‍🍳';
    const dispName = u.nickname || u.username;
    const isMe = currentUser && String(currentUser.id) === String(u.id);
    const isFollowing = currentMyFollowingIds.includes(String(u.id));
    const followBtnHtml = isMe ? '' : `
      <button type="button" class="follow-list-btn ${isFollowing ? 'following' : ''}" data-userid="${u.id}" style="
        background: ${isFollowing ? 'var(--primary-light)' : 'var(--primary-gradient)'};
        color: ${isFollowing ? 'var(--primary)' : '#fff'};
        border: none;
        padding: 6px 14px;
        border-radius: 20px;
        font-size: 0.75rem;
        font-weight: 700;
        cursor: pointer;
        transition: all 0.2s ease;
      ">${isFollowing ? 'フォロー中' : 'フォローする'}</button>
    `;

    return `
      <div class="search-user-card" data-userid="${u.id}">
        <div class="search-user-info">
          <div class="search-user-avatar">${emoji}</div>
          <div class="search-user-meta">
            <span class="search-user-nickname">${dispName}</span>
            <span class="search-user-username">@${u.username}</span>
          </div>
        </div>
        <div class="search-user-actions" style="display: flex; gap: 8px; align-items: center;">
          <button type="button" class="search-view-profile-btn" data-userid="${u.id}">プロフィール</button>
          ${followBtnHtml}
        </div>
      </div>
    `;
  }).join('');

  // イベントバインド
  userSearchResults.querySelectorAll('.search-user-card').forEach(card => {
    card.addEventListener('click', (e) => {
      const targetUserId = card.getAttribute('data-userid');
      if (targetUserId) {
        closeModal('modal-user-search');
        openUserProfileModal(targetUserId);
      }
    });
  });

  userSearchResults.querySelectorAll('.search-view-profile-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation(); // 親カードのクリックイベントを発火させない
      const targetUserId = btn.getAttribute('data-userid');
      if (targetUserId) {
        closeModal('modal-user-search');
        openUserProfileModal(targetUserId);
      }
    });
  });

  // 検索結果からのフォロー/アンフォローボタン
  userSearchResults.querySelectorAll('.follow-list-btn').forEach(btn => {
    btn.addEventListener('click', async (e) => {
    });
  });
}



// ─── 8. 買い物メモ手動操作イベント ───
const btnAddShopping = document.getElementById('btn-add-shopping');
const shoppingNewItemInput = document.getElementById('shopping-new-item');

if (btnAddShopping) {
  btnAddShopping.addEventListener('click', () => {
    const text = shoppingNewItemInput.value.trim();
    if (text !== '') {
      state.shoppingList.push({
        id: generateUUID(),
        text: text,
        checked: false
      });
      state.save();
      shoppingNewItemInput.value = '';
      renderAll();
    }
  });

  shoppingNewItemInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      btnAddShopping.click();
    }
  });
}

/**
 * ログイン・新規登録時、またはリロード（起動）時にクラウドからデータを取得し、ローカルとマージして同期する
 */
async function syncOnLogin(userId, isReload = false) {
  if (!window.sheetDB || !sheetDB.isLive() || !userId) return;

  try {
    // 1. クラウド側のバックアップデータを取得
    const cloud = await sheetDB.getUserBackupData(userId);

    let shouldMigrate = false;

    // リロード時（起動時の自動同期）以外のみゲストデータの引き継ぎチェックと確認を行う
    if (!isReload) {
      const guestIng = localStorage.getItem('ingredients_guest');
      const guestLogs = localStorage.getItem('dinnerLogs_guest');
      const guestShop = localStorage.getItem('shoppingList_guest');

      let hasGuestData = false;
      try {
        if (guestIng && JSON.parse(guestIng).length > 0) hasGuestData = true;
        if (guestLogs && JSON.parse(guestLogs).length > 0) hasGuestData = true;
        if (guestShop && JSON.parse(guestShop).length > 0) hasGuestData = true;
      } catch(e) {}

      if (hasGuestData) {
        shouldMigrate = confirm('未ログイン時に登録した冷蔵庫や夕食履歴のデータが残っています。\nこれを新しくログインするアカウントに引き継ぎ（統合）しますか？\n\n・「OK」を選ぶと、現在のデータをアカウントに統合します。\n・「キャンセル」を選ぶと、この端末のデータは消去され、アカウントにすでに保存されているデータのみが表示されます。');
      }
    }

    // 3. スマートマージ処理
    // ── 食材 (Ingredients) ──
    // リロード時、または新規ログイン時に移行を選択した場合は、現在のstateデータ（リロード時は既にstateに読み込み済み）から開始する。
    let mergedIngredients = (isReload || shouldMigrate) ? [...state.ingredients] : [];
    if (cloud.ingredients && cloud.ingredients.length > 0) {
      cloud.ingredients.forEach(cloudItem => {
        const localIdx = mergedIngredients.findIndex(li => li.id === cloudItem.id);
        if (localIdx === -1) {
          mergedIngredients.push(cloudItem);
        } else {
          mergedIngredients[localIdx] = cloudItem;
        }
      });
    }
    state.ingredients = mergedIngredients;

    // ── 夕食履歴 (dinnerLogs) ──
    let mergedLogs = (isReload || shouldMigrate) ? [...state.dinnerLogs] : [];
    if (cloud.logs && cloud.logs.length > 0) {
      cloud.logs.forEach(cloudItem => {
        const localIdx = mergedLogs.findIndex(ll => ll.id === cloudItem.id);
        if (localIdx === -1) {
          mergedLogs.push(cloudItem);
        } else {
          mergedLogs[localIdx] = cloudItem;
        }
      });
    }
    mergedLogs.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
    state.dinnerLogs = mergedLogs;

    // ── 買い物メモ (shoppingList) ──
    let mergedShop = (isReload || shouldMigrate) ? [...state.shoppingList] : [];
    if (cloud.shoppingList && cloud.shoppingList.length > 0) {
      cloud.shoppingList.forEach(cloudItem => {
        const localIdx = mergedShop.findIndex(ls => ls.id === cloudItem.id);
        if (localIdx === -1) {
          mergedShop.push(cloudItem);
        } else {
          mergedShop[localIdx] = cloudItem;
        }
      });
    }
    state.shoppingList = mergedShop;

    // 4. マージしたデータをローカルに保存
    state.save();

    // 新規ログインで移行完了、または移行不要と判断されたときのみゲストデータをクリーンアップ
    if (!isReload) {
      localStorage.removeItem('ingredients_guest');
      localStorage.removeItem('dinnerLogs_guest');
      localStorage.removeItem('shoppingList_guest');
    }

    // 5. マージしたデータを再びクラウドに押し上げて完全に同期
    await sheetDB.syncUserData(userId, state.ingredients, state.dinnerLogs, state.shoppingList);

    console.log("Login/Reload sync and merge completed successfully. Reload:", isReload, "Migrated:", shouldMigrate);
  } catch (error) {
    console.error("Login/Reload sync failed:", error);
  }
}

// ─── 9. SNS/会員・設定系イベント ───

// モーダル開閉
document.getElementById('tl-btn-goto-login')?.addEventListener('click', () => openModal('modal-login'));
document.getElementById('btn-open-login-modal')?.addEventListener('click', () => openModal('modal-login'));
document.getElementById('btn-open-register-modal')?.addEventListener('click', () => openModal('modal-register'));

document.getElementById('btn-switch-to-register')?.addEventListener('click', () => {
  closeModal('modal-login');
  setTimeout(() => openModal('modal-register'), 300);
});
document.getElementById('btn-switch-to-login')?.addEventListener('click', () => {
  closeModal('modal-register');
  setTimeout(() => openModal('modal-login'), 300);
});

// 新規登録
document.getElementById('form-register')?.addEventListener('submit', async (e) => {
  e.preventDefault();
  const username = document.getElementById('register-username').value.trim();
  const nickname = document.getElementById('register-nickname').value.trim();
  const pass = document.getElementById('register-password').value;
  const passConf = document.getElementById('register-password-confirm').value;
  const err = document.getElementById('register-error-msg');

  if (pass !== passConf) {
    err.textContent = 'パスワードが一致しません';
    err.classList.remove('hidden');
    return;
  }

  // 送信ボタンの無効化とローディング表示
  const submitBtn = e.target.querySelector('button[type="submit"]');
  const originalText = submitBtn ? submitBtn.textContent : 'アカウント作成';
  if (submitBtn) {
    submitBtn.disabled = true;
    submitBtn.textContent = '作成中...';
  }

  try {
    const user = await sheetDB.register(username, pass, nickname);

    // クラウド側と同期・マージを行う
    await syncOnLogin(user.id);

    closeModal('modal-register');
    e.target.reset();
    err.classList.add('hidden');
    renderAll();

    // マイページタブへ移動
    document.querySelector('[data-tab="tab-mypage"]').click();
  } catch (error) {
    err.textContent = error.message;
    err.classList.remove('hidden');
  } finally {
    if (submitBtn) {
      submitBtn.disabled = false;
      submitBtn.textContent = originalText;
    }
  }
});

// ログイン
document.getElementById('form-login')?.addEventListener('submit', async (e) => {
  e.preventDefault();
  const username = document.getElementById('login-username').value.trim();
  const pass = document.getElementById('login-password').value;
  const err = document.getElementById('login-error-msg');

  // 送信ボタンの無効化とローディング表示
  const submitBtn = e.target.querySelector('button[type="submit"]');
  const originalText = submitBtn ? submitBtn.textContent : 'ログイン';
  if (submitBtn) {
    submitBtn.disabled = true;
    submitBtn.textContent = 'ログイン中...';
  }

  try {
    const user = await sheetDB.login(username, pass);

    // クラウド側と同期・マージを行う
    await syncOnLogin(user.id);

    closeModal('modal-login');
    e.target.reset();
    err.classList.add('hidden');
    renderAll();
    document.querySelector('[data-tab="tab-mypage"]').click();
  } catch (error) {
    err.textContent = error.message;
    err.classList.remove('hidden');
  } finally {
    if (submitBtn) {
      submitBtn.disabled = false;
      submitBtn.textContent = originalText;
    }
  }
});

// ログアウト
document.getElementById('btn-logout')?.addEventListener('click', () => {
  if (confirm('ログアウトしますか？')) {
    sheetDB.logout();
    state.load(); // ゲスト用の領域（または空のデータ）に切り替えて再ロードする
    renderAll();
  }
});

// プロフィール一括保存
document.getElementById('btn-save-profile')?.addEventListener('click', async () => {
  const user = sheetDB.getCurrentUser();
  if (!user) return;

  const usernameInput = document.getElementById('mypage-username-input');
  const nicknameInput = document.getElementById('mypage-nickname-input');
  const bioInput = document.getElementById('mypage-bio');
  const avatarInput = document.getElementById('mypage-avatar-input');

  const username = usernameInput ? usernameInput.value.trim() : '';
  const nickname = nicknameInput ? nicknameInput.value.trim() : '';
  const bio = bioInput ? bioInput.value.trim() : '';
  let avatarEmoji = avatarInput ? avatarInput.value : '🧑‍🍳';

  if (!username) {
    alert('ユーザーネームを入力してください');
    return;
  }
  if (!nickname) {
    alert('ニックネームを入力してください');
    return;
  }

  // アバター文字数検証
  let charCount = 0;
  if (avatarEmoji) {
    if (typeof Intl !== 'undefined' && Intl.Segmenter) {
      const segmenter = new Intl.Segmenter('ja', { granularity: 'grapheme' });
      charCount = Array.from(segmenter.segment(avatarEmoji)).length;
    } else {
      charCount = Array.from(avatarEmoji).length;
    }
  }

  if (charCount > 1) {
    alert('アバターは1文字のみ設定可能です。');
    if (avatarInput) {
      avatarInput.focus();
      avatarInput.style.borderColor = '#ff3b30';
    }
    const warningEl = document.getElementById('mypage-avatar-warning');
    if (warningEl) warningEl.style.display = 'block';
    return;
  }

  if (!avatarEmoji) {
    avatarEmoji = '🧑‍🍳';
  }

  const btn = document.getElementById('btn-save-profile');
  btn.disabled = true;
  btn.textContent = '保存中...';

  try {
    await sheetDB.updateProfile(user.id, {
      username: username,
      nickname: nickname,
      bio: bio,
      avatarEmoji: avatarEmoji
    });
    alert('プロフィールを保存しました');
    renderAll();
  } catch(e) {
    alert(e.message || '保存に失敗しました。ユーザー名が重複している可能性があります。');
  } finally {
    btn.disabled = false;
    btn.textContent = 'プロフィールを保存';
  }
});

// アバター入力の1文字制限と警告・プレビューのリアルタイム制御
document.getElementById('mypage-avatar-input')?.addEventListener('input', (e) => {
  const input = e.target;
  const val = input.value;
  const warningEl = document.getElementById('mypage-avatar-warning');
  const previewEl = document.getElementById('mypage-avatar');

  if (!val) {
    if (warningEl) warningEl.style.display = 'none';
    input.style.borderColor = '';
    if (previewEl) previewEl.textContent = '🧑‍🍳';
    return;
  }

  // 文字数（書記素）の判定
  let charCount = 0;
  let firstChar = '';
  if (typeof Intl !== 'undefined' && Intl.Segmenter) {
    const segmenter = new Intl.Segmenter('ja', { granularity: 'grapheme' });
    const segments = Array.from(segmenter.segment(val));
    charCount = segments.length;
    if (charCount > 0) firstChar = segments[0].segment;
  } else {
    const points = Array.from(val);
    charCount = points.length;
    if (charCount > 0) firstChar = points[0];
  }

  if (charCount > 1) {
    if (warningEl) warningEl.style.display = 'block';
    input.style.borderColor = '#ff3b30';
  } else {
    if (warningEl) warningEl.style.display = 'none';
    input.style.borderColor = '';
    if (previewEl && firstChar) previewEl.textContent = firstChar;
  }
});

// フォーカスアウト時に自動的に1文字に丸める
document.getElementById('mypage-avatar-input')?.addEventListener('blur', (e) => {
  const input = e.target;
  const val = input.value;
  if (!val) return;

  let firstChar = val;
  if (typeof Intl !== 'undefined' && Intl.Segmenter) {
    const segmenter = new Intl.Segmenter('ja', { granularity: 'grapheme' });
    const segments = Array.from(segmenter.segment(val));
    if (segments.length > 0) firstChar = segments[0].segment;
  } else {
    const points = Array.from(val);
    if (points.length > 0) firstChar = points[0];
  }

  input.value = firstChar;
  input.style.borderColor = '';
  const warningEl = document.getElementById('mypage-avatar-warning');
  if (warningEl) warningEl.style.display = 'none';
  const previewEl = document.getElementById('mypage-avatar');
  if (previewEl) previewEl.textContent = firstChar;
});



// 他ユーザープロフィールモーダルを開く
async function openUserProfileModal(userId) {
  const user = sheetDB.getCurrentUser();
  if (!user) {
    alert('プロフィールを見るにはログインしてください');
    return;
  }

  if (userId === user.id) {
    // 自分の場合はマイページへ飛ばす
    document.querySelector('[data-tab="tab-mypage"]').click();
    return;
  }

  try {
    const prof = await sheetDB.getUserProfile(userId);
    const targetUser = prof.user;

    document.getElementById('user-profile-avatar').textContent = targetUser.avatarEmoji || '🧑‍🍳';
    document.getElementById('user-profile-nickname').textContent = targetUser.nickname || targetUser.username;
    document.getElementById('user-profile-username').textContent = '@' + targetUser.username;
    document.getElementById('user-profile-bio').textContent = targetUser.bio || '自己紹介はありません';

    document.getElementById('user-profile-following').textContent = prof.followingCount || 0;
    document.getElementById('user-profile-followers').textContent = prof.followersCount || 0;

    // フォローボタン状態
    const btnFollow = document.getElementById('btn-follow-toggle');
    const isFollowing = await sheetDB.isFollowing(user.id, userId);

    btnFollow.setAttribute('data-userid', userId);
    if (isFollowing) {
      btnFollow.textContent = 'フォロー中';
      btnFollow.classList.add('following');
    } else {
      btnFollow.textContent = 'フォローする';
      btnFollow.classList.remove('following');
    }

    // その人がタイムラインに上げた料理一覧をレンダリングする
    const postsContainer = document.getElementById('user-profile-posts');
    if (postsContainer) {
      if (!prof.posts || prof.posts.length === 0) {
        postsContainer.innerHTML = '<p style="text-align: center; color: var(--text-sub); font-size: 0.85rem; padding: 32px 0; border-top: 1px solid var(--border-color); margin-top: 16px;">まだタイムライン投稿はありません</p>';
      } else {
        const escapeString = (str) => {
          if (!str) return '';
          return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
        };

        postsContainer.innerHTML = `
          <h4 style="font-size: 0.9rem; font-weight: 700; margin: 24px 0 12px; color: var(--text-main); display: flex; align-items: center; gap: 6px; border-top: 1px solid var(--border-color); padding-top: 16px;">
            🍳 晩ごはんの投稿一覧 <span style="font-size: 0.75rem; color: var(--text-sub); font-weight: 500;">(${prof.posts.length}件)</span>
          </h4>
          <div class="user-profile-grid" style="display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; max-height: 400px; overflow-y: auto; padding-top: 4px;">
            ${prof.posts.map(post => {
              const photoHtml = post.photo 
                ? `<img src="${post.photo}" style="width: 100%; height: 100%; object-fit: cover; border-radius: 8px;">`
                : `<div style="width: 100%; height: 100%; background: var(--bg-soft); border-radius: 8px; display: flex; flex-direction: column; justify-content: center; align-items: center; padding: 8px; text-align: center; box-sizing: border-box;">
                     <span style="font-size: 1.5rem; margin-bottom: 4px;">🍳</span>
                     <span style="font-size: 0.7rem; font-weight: 700; color: var(--text-main); display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; word-break: break-all; line-height: 1.2;">${escapeString(post.dishName)}</span>
                   </div>`;

              return `
                <div class="profile-grid-item" data-postid="${post.id}" style="aspect-ratio: 1 / 1; position: relative; overflow: hidden; border-radius: 8px; cursor: pointer; border: 1px solid var(--border-color); transition: transform 0.2s ease, box-shadow 0.2s ease;">
                  ${photoHtml}
                  <div class="grid-item-overlay" style="position: absolute; top: 0; left: 0; width: 100%; height: 100%; background: rgba(0,0,0,0.5); display: flex; flex-direction: column; justify-content: center; align-items: center; gap: 4px; opacity: 0; transition: opacity 0.2s ease; color: white; font-size: 0.75rem; font-weight: bold; border-radius: 8px; text-align: center; padding: 4px; box-sizing: border-box;">
                    <div style="font-size: 0.8rem; font-weight: 700; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; width: 90%;">${escapeString(post.dishName)}</div>
                    <div style="display: flex; align-items: center; gap: 6px;">
                      <span>★ ${parseFloat(post.rating || 5).toFixed(1)}</span>
                      <span>👤 ${formatServings(post.servings)}</span>
                    </div>
                  </div>
                </div>
              `;
            }).join('')}
          </div>
        `;

        // プロフィール内カードタップで詳細を開くイベント
        postsContainer.querySelectorAll('.profile-grid-item').forEach(card => {
          card.addEventListener('click', (e) => {
            const postId = card.getAttribute('data-postid');
            const post = prof.posts.find(p => p.id === postId);
            if (post) {
              const isMyPost = post.userId === user.id;
              const localLog = isMyPost ? state.dinnerLogs.find(item => item.id === post.id) : null;
              if (localLog) {
                openLogDetailModal(localLog, true); // 自分の投稿でローカルログありなら編集可能
              } else {
                openLogDetailModal(post, false); // 他人の投稿またはローカルログなしなら編集不可（読み取り専用）
              }
            }
          });
        });
      }
    }

    openModal('modal-user-profile');
  } catch(e) {
    alert('プロフィールを取得できませんでした');
  }
}

// フォロートグルアクション
document.getElementById('btn-follow-toggle')?.addEventListener('click', async (e) => {
  const btn = e.currentTarget;
  const targetId = btn.getAttribute('data-userid');
  const user = sheetDB.getCurrentUser();
  if (!user || !targetId) return;

  const isFollowing = btn.classList.contains('following');
  btn.disabled = true;
  try {
    if (isFollowing) {
      await sheetDB.unfollow(user.id, targetId);
      btn.textContent = 'フォローする';
      btn.classList.remove('following');
    } else {
      await sheetDB.follow(user.id, targetId);
      btn.textContent = 'フォロー中';
      btn.classList.add('following');
    }
    renderAll();
  } catch(err) {
    alert('エラーが発生しました');
  }
  btn.disabled = false;
});

/**
 * パスワード表示トグル（一瞬だけ表示＆長押し）機能の初期化
 */
function initPasswordToggles() {
  document.querySelectorAll('.password-wrapper').forEach(wrapper => {
    const input = wrapper.querySelector('input');
    const button = wrapper.querySelector('.password-toggle-btn');
    if (!input || !button) return;

    const openEye = button.querySelector('.eye-open');
    const closedEye = button.querySelector('.eye-closed');

    let hideTimeout = null;
    let pressTimer = null;
    let isHeld = false;

    function showPassword() {
      input.type = 'text';
      openEye?.classList.remove('hidden');
      closedEye?.classList.add('hidden');
    }

    function hidePassword() {
      input.type = 'password';
      openEye?.classList.add('hidden');
      closedEye?.classList.remove('hidden');
      if (hideTimeout) {
        clearTimeout(hideTimeout);
        hideTimeout = null;
      }
    }

    // 状態トグル関数（通常タップ用）
    function togglePassword() {
      if (hideTimeout || input.type === 'text') {
        hidePassword();
      } else {
        showPassword();
        // 2秒後に自動的に非表示にする
        hideTimeout = setTimeout(() => {
          hidePassword();
        }, 2000);
      }
    }

    // タッチ・クリック長押し対応 (Pointer Events)
    button.addEventListener('pointerdown', (e) => {
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      e.preventDefault();

      isHeld = false;

      // すでにタイマーがあればクリア
      if (hideTimeout) {
        clearTimeout(hideTimeout);
        hideTimeout = null;
      }

      // 長押し判定用タイマー（250ms長押ししたら「ホールド状態」とみなす）
      pressTimer = setTimeout(() => {
        isHeld = true;
        showPassword();
      }, 250);
    });

    // 指やマウスを離したとき
    const handleRelease = (e) => {
      if (pressTimer) {
        clearTimeout(pressTimer);
        pressTimer = null;
      }

      if (isHeld) {
        // 長押ししていた場合は、離した瞬間に即非表示
        hidePassword();
        isHeld = false;
      }
    };

    button.addEventListener('pointerup', handleRelease);
    button.addEventListener('pointerleave', handleRelease);
    button.addEventListener('pointercancel', handleRelease);

    // タップが完了したときに呼ばれるclickイベント
    button.addEventListener('click', (e) => {
      e.preventDefault();
      // 長押し（ホールド状態）されていた場合はクリック処理をスキップ
      if (isHeld) {
        isHeld = false;
        return;
      }
      // 通常の短いタップとしてトグル処理（2秒自動非表示タイマー付き）を実行
      togglePassword();
    });
  });
}

let isSyncRunning = false;
let isSyncPending = false;

/**
 * 現在のローカルの冷蔵庫・履歴・買い物メモをバックグラウンドでクラウドへ非同期同期する（合流・シリアライズ化）
 */
async function triggerCloudSync() {
  if (!window.sheetDB || !sheetDB.isLive()) return;
  const user = sheetDB.getCurrentUser();
  if (!user) return;

  if (isSyncRunning) {
    isSyncPending = true;
    return;
  }

  isSyncRunning = true;
  isSyncPending = false;

  try {
    // 非同期で上書き同期実行
    await sheetDB.syncUserData(user.id, state.ingredients, state.dinnerLogs, state.shoppingList);
    console.log("Cloud sync completed successfully.");
  } catch (error) {
    console.error("Cloud sync failed:", error);
  } finally {
    isSyncRunning = false;
    if (isSyncPending) {
      // 待機中の同期要求があれば、最新の状態で再度同期を呼び出す
      triggerCloudSync();
    }
  }
}



// ─── 7. アプリ初期化実行 ───
state.load();
renderAll();
initPasswordToggles();

// ログイン中の場合は起動時にバックグラウンドで最新データを同期マージする
const currentUser = sheetDB.getCurrentUser();
if (currentUser) {
  // リロード起動時の自動同期のため第二引数に true を設定
  syncOnLogin(currentUser.id, true).then(() => {
    renderAll();
  });
}

// ─── ユーザーアバター＆フォロー一覧の制御 ───

/**
 * フォロー/フォロワー一覧モーダルを開く
 */
async function openFollowListModal(targetUserId, type) {
  const container = document.getElementById('follow-list-container');
  const title = document.getElementById('follow-list-title');
  if (!container || !title) return;

  title.textContent = type === 'following' ? 'フォロー中' : 'フォロワー';
  container.innerHTML = '<p style="text-align: center; color: var(--text-sub); font-size: 0.85rem; padding: 32px 0;">読み込み中...</p>';

  openModal('modal-follow-list');

  try {
    let targetIds = [];
    if (type === 'following') {
      const res = await sheetDB.getFollowingIds(targetUserId);
      targetIds = res || [];
    } else {
      const res = await sheetDB.getFollowerIds(targetUserId);
      targetIds = res || [];
    }

    const allUsers = await sheetDB.getAllUsers();
    const filteredUsers = allUsers.filter(u => targetIds.map(String).includes(String(u.id)));

    if (filteredUsers.length === 0) {
      container.innerHTML = `<p style="text-align: center; color: var(--text-sub); font-size: 0.85rem; padding: 32px 0;">${type === 'following' ? 'フォローしているユーザーはいません' : 'フォロワーはいません'}</p>`;
      return;
    }

    const currentUser = sheetDB.getCurrentUser();
    let myFollowingIds = [];
    if (currentUser) {
      const followRes = await sheetDB.getFollowingIds(currentUser.id);
      myFollowingIds = (followRes || []).map(String);
    }

    container.innerHTML = filteredUsers.map(u => {
      const emoji = u.avatarEmoji || '🧑‍🍳';
      const dispName = u.nickname || u.username;
      const isMe = currentUser && String(currentUser.id) === String(u.id);
      const isFollowing = myFollowingIds.includes(String(u.id));
      const followBtnHtml = isMe ? '' : `
        <button type="button" class="follow-list-btn ${isFollowing ? 'following' : ''}" data-userid="${u.id}" style="
          background: ${isFollowing ? 'var(--primary-light)' : 'var(--primary-gradient)'};
          color: ${isFollowing ? 'var(--primary)' : '#fff'};
          border: none;
          padding: 6px 14px;
          border-radius: 20px;
          font-size: 0.75rem;
          font-weight: 700;
          cursor: pointer;
          transition: all 0.2s ease;
        ">${isFollowing ? 'フォロー中' : 'フォローする'}</button>
      `;

      return `
        <div class="search-user-card" data-userid="${u.id}">
          <div class="search-user-info">
            <div class="search-user-avatar">${emoji}</div>
            <div class="search-user-meta">
              <span class="search-user-nickname">${dispName}</span>
              <span class="search-user-username">@${u.username}</span>
            </div>
          </div>
          <div class="search-user-actions" style="display: flex; gap: 8px; align-items: center;">
            <button type="button" class="search-view-profile-btn" data-userid="${u.id}">プロフィール</button>
            ${followBtnHtml}
          </div>
        </div>
      `;
    }).join('');

    // カードタップでプロフィールモーダルを開く
    container.querySelectorAll('.search-user-card').forEach(card => {
      card.addEventListener('click', () => {
        const uid = card.getAttribute('data-userid');
        closeModal('modal-follow-list');
        closeModal('modal-user-profile');
        openUserProfileModal(uid);
      });
    });

    container.querySelectorAll('.search-view-profile-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const uid = btn.getAttribute('data-userid');
        closeModal('modal-follow-list');
        closeModal('modal-user-profile');
        openUserProfileModal(uid);
      });
    });

    // 一撃フォロー/アンフォローボタン
    container.querySelectorAll('.follow-list-btn').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        e.stopPropagation(); // 親カードのタップイベント（プロフィール表示）を防ぐ
        if (!currentUser) {
          alert('ログインが必要です');
          return;
        }
        const targetId = btn.getAttribute('data-userid');
        btn.disabled = true;

        const isFollowingAlready = btn.classList.contains('following');
        try {
          if (isFollowingAlready) {
            // アンフォロー
            await sheetDB.unfollow(currentUser.id, targetId);
            btn.textContent = 'フォローする';
            btn.classList.remove('following');
            btn.style.background = 'var(--primary-gradient)';
            btn.style.color = '#fff';
          } else {
            // フォロー
            await sheetDB.follow(currentUser.id, targetId);
            btn.textContent = 'フォロー中';
            btn.classList.add('following');
            btn.style.background = 'var(--primary-light)';
            btn.style.color = 'var(--primary)';
          }
          // プロフィール統計やタイムライン表示を更新
          if (typeof renderMyPage === 'function') renderMyPage();
          if (typeof renderTimeline === 'function') renderTimeline();
        } catch (err) {
          console.error(err);
          alert('フォロー処理に失敗しました');
        } finally {
          btn.disabled = false;
        }
      });
    });

  } catch (err) {
    console.error(err);
    container.innerHTML = '<p style="text-align: center; color: var(--red); font-size: 0.85rem; padding: 32px 0;">読み込みに失敗しました</p>';
  }
}

// フォローリストのイベントバインド
document.getElementById('btn-close-follow-list')?.addEventListener('click', () => {
  closeModal('modal-follow-list');
});

// マイページの統計クリック
document.getElementById('btn-mypage-following')?.addEventListener('click', () => {
  const user = sheetDB.getCurrentUser();
  if (user) openFollowListModal(user.id, 'following');
});
document.getElementById('btn-mypage-followers')?.addEventListener('click', () => {
  const user = sheetDB.getCurrentUser();
  if (user) openFollowListModal(user.id, 'followers');
});

// 他ユーザープロフィールの統計クリック
document.getElementById('btn-user-profile-following')?.addEventListener('click', () => {
  const btn = document.getElementById('btn-follow-toggle');
  const userId = btn ? btn.getAttribute('data-userid') : null;
  if (userId) openFollowListModal(userId, 'following');
});
document.getElementById('btn-user-profile-followers')?.addEventListener('click', () => {
  const btn = document.getElementById('btn-follow-toggle');
  const userId = btn ? btn.getAttribute('data-userid') : null;
  if (userId) openFollowListModal(userId, 'followers');
});
