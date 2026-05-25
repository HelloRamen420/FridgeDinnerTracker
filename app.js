// ─── 0. サービスワーカー登録 (PWA) ───
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js')
      .then(reg => console.log('サービスワーカー登録成功:', reg.scope))
      .catch(err => console.log('サービスワーカー登録失敗:', err));
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
const state = {
  ingredients: [],
  dinnerLogs: [],
  shoppingList: [], // 買い物メモ用の配列
  
  // データ保存用ヘルパー
  save() {
    localStorage.setItem('ingredients', JSON.stringify(this.ingredients));
    localStorage.setItem('dinnerLogs', JSON.stringify(this.dinnerLogs));
    localStorage.setItem('shoppingList', JSON.stringify(this.shoppingList));
  },
  
  load() {
    // 以前の古いデモサンプルデータを一度だけ自動クリーンアップして初期化
    if (localStorage.getItem('purgedSampleData') !== 'true') {
      localStorage.removeItem('ingredients');
      localStorage.removeItem('dinnerLogs');
      localStorage.removeItem('shoppingList');
      localStorage.setItem('purgedSampleData', 'true');
    }

    const rawIng = localStorage.getItem('ingredients');
    const rawLogs = localStorage.getItem('dinnerLogs');
    const rawShop = localStorage.getItem('shoppingList');
    
    if (rawIng) this.ingredients = JSON.parse(rawIng);
    if (rawLogs) this.dinnerLogs = JSON.parse(rawLogs);
    if (rawShop) this.shoppingList = JSON.parse(rawShop);
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
    const ingHtml = log.ingredientsUsed.map(name => `<span class="log-tag">${name}</span>`).join('');
    const tags = compHtml + ingHtml;
    
    // メモ要約
    const memoPreview = log.memo ? `<div class="log-card-memo-preview">${log.memo}</div>` : '';
    
    const percentage = (parseFloat(log.rating || 5) / 5.0) * 100;
    const ratingVal = parseFloat(log.rating || 5).toFixed(1);
    
    return `
      <div class="log-card" data-id="${log.id}">
        <div class="log-card-header">
          <span class="log-card-date">${dateFormatted}</span>
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

// 買い物メモ（Shopping List）のレンダリング
function renderShoppingList() {
  const container = document.getElementById('dashboard-shopping-list');
  
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
        ingPhotoPreview.innerHTML = `<div class="upload-icon">📸</div><div class="upload-text">写真を撮影・選択</div>`;
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
  
  // 全角入力に対応した数量のFloat変換
  const rawQty = document.getElementById('ing-qty').value;
  const parsedQty = parseJapaneseFloat(rawQty);
  const quantity = (parsedQty !== null && parsedQty >= 0) ? parseFloat(parsedQty.toFixed(1)) : 1.0;
  
  const unit = document.getElementById('ing-unit').value || "個";
  const expiryDate = document.getElementById('ing-expiry').value;
  
  if (name === '') return;
  
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
    editingIngredientId = null;
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
    buildFridgeChecklist(existingLog.ingredientsUsed || []);
  } else {
    editingLogId = null;
    if (titleEl) titleEl.textContent = "晩ごはんを記録";
    btnSaveLog.textContent = "記録する";
    if (deleteSecEl) deleteSecEl.classList.add('hidden');
    
    logNameInput.value = defaultDishName;
    document.getElementById('log-date').value = new Date().toISOString().split('T')[0]; // デフォルト今日
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
function buildFridgeChecklist(checkedNames = []) {
  if (state.ingredients.length === 0) {
    logFridgeChecklist.innerHTML = `<p class="checklist-empty-note">冷蔵庫に食材がありません</p>`;
    return;
  }
  
  logFridgeChecklist.innerHTML = state.ingredients.map(ing => {
    const isChecked = checkedNames.includes(ing.name);
    const checkIcon = isChecked ? '🟢' : '⚪️';
    const rowClass = isChecked ? 'checklist-row checked' : 'checklist-row';
    
    return `
      <div class="${rowClass}" id="checkrow-${ing.id}">
        <span class="check-btn" data-id="${ing.id}">${checkIcon}</span>
        <span class="check-label">${INGREDIENT_EMOJI_MAP[ing.category] || "📦"} ${ing.name}</span>
        
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
  
  const components = extractMealComponents(name, usedIngredients, memo);

  if (editingLogId) {
    // 編集・更新処理
    const index = state.dinnerLogs.findIndex(item => item.id === editingLogId);
    if (index !== -1) {
      state.dinnerLogs[index] = {
        ...state.dinnerLogs[index], // IDやその他メタデータを維持
        name,
        date,
        memo,
        rating: currentRating,
        ingredientsUsed: usedIngredients,
        components: components,
        photo: currentLogPhotoBase64
      };
    }
    editingLogId = null;
  } else {
    // 新規追加処理
    const newLog = {
      id: generateUUID(),
      name,
      date,
      memo,
      rating: currentRating,
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
    
    state.dinnerLogs.unshift(newLog); // 最新をリストのトップへ
  }
  
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
  activeDetailLog = log; // 現在詳細表示中のログを保持
  detailTitle.textContent = log.name;
  detailDate.textContent = formatJapaneseDate(log.date);
  
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
  btnDeleteLog.addEventListener('click', () => {
    if (editingLogId) {
      state.dinnerLogs = state.dinnerLogs.filter(item => item.id !== editingLogId);
      state.save();
      renderAll();
      closeModal('modal-add-log');
      editingLogId = null;
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

// ─── 7. アプリ初期化実行 ───
state.load();
renderAll();
