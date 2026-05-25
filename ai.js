// ─── AI食事構成要素自動抽出＆プロファイリングエンジン ───

// 食事構成要素の分類定義
const MEAL_COMPONENTS = {
  "🍲 鍋・煮込み": {
    ingredients: ["じゃがいも", "大根", "にんじん", "こんにゃく", "ちくわ", "はんぺん", "練り物", "里芋", "さつまいも", "かぼちゃ", "ごぼう", "白菜", "出汁", "だし", "昆布", "かつお", "みりん", "醤油", "しょうゆ", "味噌", "みそ", "酒", "砂糖", "シチュー", "カレー"],
    keywords: ["煮込み", "煮る", "鍋", "おでん", "肉じゃが", "シチュー", "ポトフ", "すき焼き", "寄せ鍋", "煮魚", "スープカレー", "豚汁", "お汁コトコト", "コトコト"]
  },
  "🥩 焼き物・炒め物": {
    ingredients: ["豚肉", "牛肉", "鶏肉", "バラ肉", "ひき肉", "鶏もも", "鶏むね", "ステーキ", "ソーセージ", "ベーコン", "にんにく", "ニンニク", "生姜", "ショウガ", "ごま油", "バター", "焼肉のたれ"],
    keywords: ["炒め", "ソテー", "グリル", "焼き", "ステーキ", "生姜焼き", "ハンバーグ", "餃子", "ギョーザ", "ムニエル", "焼く", "強火"]
  },
  "🥗 サラダ・和え物": {
    ingredients: ["レタス", "キャベツ", "ブロッコリー", "ほうれん草", "トマト", "きゅうり", "アボカド", "パプリカ", "ピーマン", "なす", "ナス", "マヨネーズ", "ドレッシング", "ポン酢", "オリーブオイル", "レモン"],
    keywords: ["サラダ", "和え", "ナムル", "浸し", "カプレーゼ", "マリネ", "おひたし", "温野菜", "ドレッシングをかける", "ドレッシングで"]
  },
  "🥣 汁物・スープ": {
    ingredients: ["味噌", "みそ", "出汁", "だし", "コンソメ", "ワカメ", "豆腐", "油揚げ", "玉ねぎ", "ネギ"],
    keywords: ["スープ", "汁", "味噌汁", "お吸い物", "豚汁", "ポタージュ", "ミネストローネ", "お汁", "すする"]
  },
  "🍤 揚げ物": {
    ingredients: ["鶏もも", "鶏もも肉", "豚ロース", "パン粉", "片栗粉", "小麦粉", "揚げ油"],
    keywords: ["揚げ", "唐揚げ", "からあげ", "カツ", "フライ", "天ぷら", "コロッケ", "竜田揚げ", "油で揚げる"]
  },
  "🍜 麺類": {
    ingredients: ["パスタ", "スパゲティ", "マカロニ", "中華麺", "うどん", "そば", "蕎麦", "そうめん", "焼きそば麺"],
    keywords: ["パスタ", "スパゲティ", "ラーメン", "うどん", "そば", "蕎麦", "焼きそば", "ナポリタン", "そうめん", "麺", "フォー", "冷麺"]
  },
  "🍛 丼物・ご飯物": {
    ingredients: ["ご飯", "白ご飯", "米", "チャーハン", "カレー", "チーズ", "ケチャップ"],
    keywords: ["丼", "チャーハン", "炒飯", "オムライス", "カレーライス", "ドリア", "リゾット", "雑炊", "ピラフ", "どんぶり"]
  }
};

// 使用食材とメモから食事要素タグを完全自動でバックグラウンド抽出する関数
function extractMealComponents(name, ingredientsUsed, memo) {
  const nameText = String(name || "").toLowerCase();
  const ingredientsText = (ingredientsUsed || []).map(i => String(i).toLowerCase()).join(" ");
  const memoText = String(memo || "").toLowerCase();
  const fullText = `${nameText} ${ingredientsText} ${memoText}`;

  const scores = {};
  
  for (const [componentName, rules] of Object.entries(MEAL_COMPONENTS)) {
    scores[componentName] = 0;
    
    // 1. 食材の一致によるスコア加算 (各一致で1.2点)
    rules.ingredients.forEach(ing => {
      if (fullText.includes(ing)) {
        scores[componentName] += 1.2;
      }
    });
    
    // 2. 調理法・キーワードの一致によるスコア加算 (各一致で2.0点)
    rules.keywords.forEach(kw => {
      if (fullText.includes(kw)) {
        scores[componentName] += 2.0;
      }
    });
  }
  
  // スコアが1.8点以上の要素をタグとして抽出
  const threshold = 1.8;
  const detectedComponents = Object.entries(scores)
    .filter(([_, score]) => score >= threshold)
    .map(([name]) => name);
    
  // もし何も引っかからなかった場合は、最もスコアが高いものを1つだけ抽出
  if (detectedComponents.length === 0) {
    let bestComp = "🥩 焼き物・炒め物";
    let maxScore = -1;
    for (const [compName, score] of Object.entries(scores)) {
      if (score > maxScore) {
        maxScore = score;
        bestComp = compName;
      }
    }
    if (maxScore > 0) {
      detectedComponents.push(bestComp);
    } else {
      detectedComponents.push("🥩 焼き物・炒め物");
    }
  }
  
  return detectedComponents;
}

// ユーザーのログ履歴全体から食事構成要素の比率（%）を算出する
function analyzeUserPreferences() {
  if (state.dinnerLogs.length === 0) return null;
  
  const totalScores = {};
  for (const componentName of Object.keys(MEAL_COMPONENTS)) {
    totalScores[componentName] = 0;
  }
  
  state.dinnerLogs.forEach(log => {
    // 星評価による重み（★5点満点）
    const rating = parseFloat(log.rating || 5.0);
    const weight = Math.pow(rating / 5.0, 2);
    
    // components 配列がない場合はその場で動的抽出
    const comps = log.components || extractMealComponents(log.name, log.ingredientsUsed, log.memo);
    
    comps.forEach(comp => {
      if (totalScores[comp] !== undefined) {
        totalScores[comp] += weight;
      }
    });
  });
  
  const results = [];
  let totalScoreSum = 0;
  for (const score of Object.values(totalScores)) {
    totalScoreSum += score;
  }
  
  if (totalScoreSum === 0) {
    const count = Object.keys(MEAL_COMPONENTS).length;
    return Object.keys(MEAL_COMPONENTS).map(name => ({
      name,
      percentage: Math.round(100 / count)
    }));
  }
  
  for (const [name, score] of Object.entries(totalScores)) {
    const pct = Math.round((score / totalScoreSum) * 100);
    results.push({ name, score, percentage: pct });
  }
  
  return results.sort((a, b) => b.percentage - a.percentage);
}
