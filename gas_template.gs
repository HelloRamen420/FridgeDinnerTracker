/**
 * =========================================================================
 *  FridgeDinnerTracker - Google Sheets フル機能データベース API サーバー
 * =========================================================================
 * 
 * 使い方：
 * 1. Google スプレッドシートを新規作成します。
 * 2. 上部メニューの「拡張機能」>「Apps Script」を開きます。
 * 3. このコードをすべてコピー＆ペーストして上書き保存します。
 * 4. 保存後、エディタ上部の関数選択で「setup」を選択して「実行」をクリックします。
 *    （初回実行時にアクセス権限の承認画面が出ますので、自身のアカウントで許可してください。
 *     詳細を開き、「FridgeDinnerTracker (安全ではないページ) に移動」をクリックして承認します）
 * 5. 右上の「デプロイ」>「新しいデプロイ」をクリック。
 * 6. 種類の選択(歯車マーク)から「ウェブアプリ」を選択。
 *    - 説明: 「v2.0 - クラウドバックアップ自動同期機能」
 *    - 実行するユーザー: 「自分」（※あなたのGoogle権限でシートを操作します）
 *    - アクセスできるユーザー: 「全員」（※アプリからのアクセスを許可します）
 * 7. 「デプロイ」をクリックし、表示された「ウェブアプリのURL」をコピーします。
 * 8. アプリは自動的にこの接続先を使用して動くように初期設定されています。
 * =========================================================================
 */

function setup() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  
  // 各シートを作成（なければ作成）
  const sheets = ['Users', 'Follows', 'Timeline', 'Ingredients', 'Logs', 'ShoppingList'];
  sheets.forEach(name => {
    let sheet = ss.getSheetByName(name);
    if (!sheet) {
      sheet = ss.insertSheet(name);
    }
  });

  // Users ヘッダー
  ss.getSheetByName('Users').getRange(1, 1, 1, 7).setValues([
    ['id', 'username', 'password', 'nickname', 'bio', 'avatarEmoji', 'createdAt']
  ]);

  // Follows ヘッダー
  ss.getSheetByName('Follows').getRange(1, 1, 1, 3).setValues([
    ['followerId', 'followingId', 'createdAt']
  ]);

  // Timeline ヘッダー
  ss.getSheetByName('Timeline').getRange(1, 1, 1, 12).setValues([
    ['id', 'userId', 'nickname', 'avatarEmoji', 'dishName', 'photo', 'rating', 'servings', 'ingredients', 'memo', 'date', 'postedAt']
  ]);

  // Ingredients ヘッダー (冷蔵庫の中身)
  ss.getSheetByName('Ingredients').getRange(1, 1, 1, 8).setValues([
    ['userId', 'id', 'name', 'category', 'quantity', 'unit', 'expiryDate', 'photo']
  ]);

  // Logs ヘッダー (個人夕食履歴)
  ss.getSheetByName('Logs').getRange(1, 1, 1, 10).setValues([
    ['userId', 'id', 'name', 'date', 'rating', 'servings', 'memo', 'usedIngredients', 'components', 'photo']
  ]);

  // ShoppingList ヘッダー (買い物メモ)
  ss.getSheetByName('ShoppingList').getRange(1, 1, 1, 4).setValues([
    ['userId', 'id', 'text', 'checked']
  ]);
  
  Logger.log("セットアップが正常に完了しました！");
}

/**
 * GET リクエストの受け口
 */
function doGet(e) {
  return handleRequest(e);
}

/**
 * POST リクエストの受け口 (GASでのCORS対策・簡易運用のためにdoGetへ転送)
 */
function doPost(e) {
  return handleRequest(e);
}

/**
 * 全てのリクエストを処理してJSONで返却するメインハンドラ
 */
function handleRequest(e) {
  try {
    const action = e.parameter.action;
    if (!action) {
      return _jsonResponse({ error: 'No action specified. Please access from the application.' });
    }

    let result = {};

    switch(action) {
      // ── セッション・認証 ──
      case 'register':
        result = registerUser(e.parameter.username, e.parameter.password, e.parameter.nickname);
        break;
      case 'login':
        result = loginUser(e.parameter.username, e.parameter.password);
        break;

      // ── プロフィール ──
      case 'updateProfile':
        result = updateProfile(
          e.parameter.userId, 
          e.parameter.bio, 
          e.parameter.avatarEmoji, 
          e.parameter.nickname,
          e.parameter.username
        );
        break;
      case 'getUserProfile':
        result = getUserProfile(e.parameter.userId);
        break;
      case 'getAllUsers':
        result = getAllUsers();
        break;

      // ── フォロー関係 ──
      case 'follow':
        result = followUser(e.parameter.followerId, e.parameter.followingId);
        break;
      case 'unfollow':
        result = unfollowUser(e.parameter.followerId, e.parameter.followingId);
        break;
      case 'isFollowing':
        result = isFollowing(e.parameter.followerId, e.parameter.followingId);
        break;
      case 'getFollowingIds':
        result = getFollowingIds(e.parameter.userId);
        break;
      case 'getFollowerIds':
        result = getFollowerIds(e.parameter.userId);
        break;

      // ── 投稿・タイムライン ──
      case 'postDinner':
        result = postDinner(e.parameter.post);
        break;
      case 'getTimeline':
        result = getTimeline(e.parameter.limit);
        break;
      case 'getUserPosts':
        result = getUserPosts(e.parameter.userId, e.parameter.limit);
        break;
      case 'getFollowingFeed':
        result = getFollowingFeed(e.parameter.userIds, e.parameter.limit);
        break;
      case 'deletePost':
        result = deletePost(e.parameter.postId);
        break;

      // ── 個人データ双方向同期 ──
      case 'getUserBackupData':
        result = getUserBackupData(e.parameter.userId);
        break;
      case 'syncUserData':
        result = syncUserData(
          e.parameter.userId,
          e.parameter.ingredients,
          e.parameter.logs,
          e.parameter.shoppingList
        );
        break;

      default:
        result = { error: 'Unknown GET action: ' + action };
    }

    return _jsonResponse(result);
  } catch (error) {
    return _jsonResponse({ error: error.toString() });
  }
}

/** JSON返却用ヘルパー */
function _jsonResponse(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

// ──────────────────────────────────────────
// データベース操作 API 実装
// ──────────────────────────────────────────

/** シートの全行をオブジェクト配列で取得 */
function _getSheetData(sheetName) {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(sheetName);
  if (!sheet) return [];
  const lastRow = sheet.getLastRow();
  if (lastRow <= 1) return [];
  
  const data = sheet.getRange(1, 1, lastRow, sheet.getLastColumn()).getValues();
  const headers = data[0];
  const rows = [];
  for (let i = 1; i < data.length; i++) {
    const obj = {};
    for (let j = 0; j < headers.length; j++) {
      obj[headers[j]] = data[i][j];
    }
    rows.push(obj);
  }
  return rows;
}

/** 新規会員登録 */
function registerUser(username, password, nickname) {
  if (!username || !password) throw new Error("ユーザー名とパスワードを入力してください");
  
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('Users');
  const users = _getSheetData('Users');
  
  const duplicated = users.find(u => String(u.username).toLowerCase() === String(username).toLowerCase());
  if (duplicated) throw new Error("このユーザー名はすでに使われています");
  
  const id = 'usr_' + Utilities.getUuid().substring(0, 8);
  const user = {
    id: id,
    username: username,
    password: password,
    nickname: nickname || username,
    bio: '',
    avatarEmoji: '🧑‍🍳',
    createdAt: new Date().toISOString()
  };
  
  sheet.appendRow([user.id, user.username, user.password, user.nickname, user.bio, user.avatarEmoji, user.createdAt]);
  
  return {
    ok: true,
    user: { id: user.id, username: user.username, nickname: user.nickname, bio: user.bio, avatarEmoji: user.avatarEmoji }
  };
}

/** ログイン認証 */
function loginUser(username, password) {
  const users = _getSheetData('Users');
  const found = users.find(u => String(u.username).toLowerCase() === String(username).toLowerCase() && String(u.password) === String(password));
  if (!found) throw new Error("ユーザー名またはパスワードが間違っています");
  
  return {
    ok: true,
    user: { id: found.id, username: found.username, nickname: found.nickname, bio: found.bio, avatarEmoji: found.avatarEmoji }
  };
}

/** プロフィール更新 */
function updateProfile(userId, bio, avatarEmoji, nickname, username) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  
  // 1. Usersシートを更新
  const userSheet = ss.getSheetByName('Users');
  const userData = userSheet.getDataRange().getValues();
  let userRowIndex = -1;
  
  for (let i = 1; i < userData.length; i++) {
    if (String(userData[i][0]) === String(userId)) {
      userRowIndex = i + 1;
      break;
    }
  }
  
  if (userRowIndex === -1) throw new Error("User not found");
  
  if (username !== undefined && username !== '') {
    // 重複チェック
    const users = _getSheetData('Users');
    const duplicated = users.find(u => String(u.id) !== String(userId) && String(u.username).toLowerCase() === String(username).trim().toLowerCase());
    if (duplicated) throw new Error("このユーザー名はすでに使われています");
    userSheet.getRange(userRowIndex, 2).setValue(username.trim());
  }
  
  if (nickname !== undefined) userSheet.getRange(userRowIndex, 4).setValue(nickname);
  if (bio !== undefined) userSheet.getRange(userRowIndex, 5).setValue(bio);
  if (avatarEmoji !== undefined) userSheet.getRange(userRowIndex, 6).setValue(avatarEmoji);

  // 2. Timelineシート内の投稿情報も同期更新
  const tlSheet = ss.getSheetByName('Timeline');
  const tlData = tlSheet.getDataRange().getValues();
  for (let i = 1; i < tlData.length; i++) {
    if (String(tlData[i][1]) === String(userId)) {
      const row = i + 1;
      if (nickname !== undefined) tlSheet.getRange(row, 3).setValue(nickname);
      if (avatarEmoji !== undefined) tlSheet.getRange(row, 4).setValue(avatarEmoji);
    }
  }

  return { ok: true };
}

/** ユーザープロフィール情報の取得 */
function getUserProfile(userId) {
  const users = _getSheetData('Users');
  const follows = _getSheetData('Follows');
  const tl = _getSheetData('Timeline');
  
  const user = users.find(u => String(u.id) === String(userId));
  if (!user) throw new Error("ユーザーが見つかりません");
  
  const followingCount = follows.filter(f => String(f.followerId) === String(userId)).length;
  const followersCount = follows.filter(f => String(f.followingId) === String(userId)).length;
  const posts = tl.filter(p => String(p.userId) === String(userId)).reverse();
  
  return {
    user: { id: user.id, username: user.username, nickname: user.nickname, bio: user.bio, avatarEmoji: user.avatarEmoji },
    followingCount: followingCount,
    followersCount: followersCount,
    posts: posts.map(p => {
      try { p.ingredients = JSON.parse(p.ingredients); } catch(e) {}
      return p;
    })
  };
}

/** 全ユーザー一覧の取得 */
function getAllUsers() {
  const users = _getSheetData('Users');
  return {
    users: users.map(u => ({ id: u.id, username: u.username, nickname: u.nickname, avatarEmoji: u.avatarEmoji }))
  };
}

/** ユーザーのフォロー */
function followUser(followerId, followingId) {
  if (String(followerId) === String(followingId)) throw new Error("自分自身はフォローできません");
  
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('Follows');
  const follows = _getSheetData('Follows');
  
  const alreadyFollowed = follows.find(f => String(f.followerId) === String(followerId) && String(f.followingId) === String(followingId));
  if (alreadyFollowed) return { ok: true, message: "すでにフォローしています" };
  
  sheet.appendRow([followerId, followingId, new Date().toISOString()]);
  return { ok: true };
}

/** フォロー解除 */
function unfollowUser(followerId, followingId) {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('Follows');
  const data = sheet.getDataRange().getValues();
  
  for (let i = 1; i < data.length; i++) {
    if (String(data[i][0]) === String(followerId) && String(data[i][1]) === String(followingId)) {
      sheet.deleteRow(i + 1);
      break;
    }
  }
  return { ok: true };
}

/** フォロー中かどうかの判定 */
function isFollowing(followerId, followingId) {
  const follows = _getSheetData('Follows');
  const found = follows.find(f => String(f.followerId) === String(followerId) && String(f.followingId) === String(followingId));
  return { following: !!found };
}

/** フォロー中のユーザーID一覧 */
function getFollowingIds(userId) {
  const follows = _getSheetData('Follows');
  const ids = follows.filter(f => String(f.followerId) === String(userId)).map(f => f.followingId);
  return { ids: ids };
}

/** フォロワーのユーザーID一覧 */
function getFollowerIds(userId) {
  const follows = _getSheetData('Follows');
  const ids = follows.filter(f => String(f.followingId) === String(userId)).map(f => f.followerId);
  return { ids: ids };
}

/** 料理をタイムラインに投稿 */
function postDinner(postJson) {
  if (!postJson) throw new Error("No post content");
  
  const post = JSON.parse(postJson);
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('Timeline');
  
  const id = 'post_' + Utilities.getUuid().substring(0, 8);
  const postedAt = new Date().toISOString();
  const ingredientsStr = JSON.stringify(post.ingredients || []);
  
  sheet.appendRow([
    id,
    post.userId,
    post.nickname,
    post.avatarEmoji,
    post.dishName,
    post.photo || '',
    post.rating || 5,
    post.servings || '',
    ingredientsStr,
    post.memo || '',
    post.date || postedAt.split('T')[0],
    postedAt
  ]);
  
  return { ok: true };
}

/** タイムラインの全件取得 */
function getTimeline(limit) {
  const tl = _getSheetData('Timeline');
  const parsed = tl.map(p => {
    try { p.ingredients = JSON.parse(p.ingredients); } catch(e) {}
    return p;
  });
  
  parsed.sort((a, b) => new Date(b.postedAt).getTime() - new Date(a.postedAt).getTime());
  const lim = parseInt(limit) || 50;
  return { posts: parsed.slice(0, lim) };
}

/** 特定ユーザーの投稿フィードのみ取得 */
function getUserPosts(userId, limit) {
  const tl = _getSheetData('Timeline');
  const filtered = tl.filter(p => String(p.userId) === String(userId));
  
  const parsed = filtered.map(p => {
    try { p.ingredients = JSON.parse(p.ingredients); } catch(e) {}
    return p;
  });
  
  parsed.sort((a, b) => new Date(b.postedAt).getTime() - new Date(a.postedAt).getTime());
  const lim = parseInt(limit) || 50;
  return { posts: parsed.slice(0, lim) };
}

/** フォロー中メンバーの投稿のみ取得 */
function getFollowingFeed(userIdsJson, limit) {
  if (!userIdsJson) return { posts: [] };
  const userIds = JSON.parse(userIdsJson);
  
  const tl = _getSheetData('Timeline');
  const filtered = tl.filter(p => userIds.map(String).includes(String(p.userId)));
  
  const parsed = filtered.map(p => {
    try { p.ingredients = JSON.parse(p.ingredients); } catch(e) {}
    return p;
  });
  
  parsed.sort((a, b) => new Date(b.postedAt).getTime() - new Date(a.postedAt).getTime());
  const lim = parseInt(limit) || 50;
  return { posts: parsed.slice(0, lim) };
}

/** タイムライン投稿の削除 */
function deletePost(postId) {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('Timeline');
  const data = sheet.getDataRange().getValues();
  
  for (let i = 1; i < data.length; i++) {
    if (String(data[i][0]) === String(postId)) {
      sheet.deleteRow(i + 1);
      break;
    }
  }
  return { ok: true };
}

// ════════════════════════════════════════════════
//  個人用データの自動同期・バックアップ API
// ════════════════════════════════════════════════

/** 指定したユーザーの全バックアップデータを取得 */
function getUserBackupData(userId) {
  if (!userId) throw new Error("No userId specified");
  
  const ingredients = _getSheetData('Ingredients').filter(r => String(r.userId) === String(userId));
  const logs = _getSheetData('Logs').filter(r => String(r.userId) === String(userId));
  const shoppingList = _getSheetData('ShoppingList').filter(r => String(r.userId) === String(userId));
  
  const parsedLogs = logs.map(l => {
    try { l.usedIngredients = JSON.parse(l.usedIngredients); } catch(e) {}
    try { l.components = JSON.parse(l.components); } catch(e) {}
    return l;
  });

  return {
    ingredients: ingredients.map(i => {
      // 数値型にパース
      i.quantity = i.quantity !== '' ? parseFloat(i.quantity) : 0;
      return i;
    }),
    logs: parsedLogs,
    shoppingList: shoppingList.map(s => {
      s.checked = s.checked === true || String(s.checked).toLowerCase() === 'true';
      return s;
    })
  };
}

/** ユーザーデータを一括上書き同期 */
function syncUserData(userId, ingredientsJson, logsJson, shoppingListJson) {
  if (!userId) throw new Error("No userId specified");
  
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  
  // ── 1. Ingredients 同期 ──
  if (ingredientsJson !== undefined) {
    const ingredients = JSON.parse(ingredientsJson || '[]');
    const sheet = ss.getSheetByName('Ingredients');
    _clearUserRows(sheet, userId);
    
    ingredients.forEach(item => {
      sheet.appendRow([
        userId,
        item.id || '',
        item.name || '',
        item.category || '',
        item.quantity !== undefined ? item.quantity : '',
        item.unit || '',
        item.expiryDate || '',
        item.photo || ''
      ]);
    });
  }
  
  // ── 2. Logs 同期 ──
  if (logsJson !== undefined) {
    const logs = JSON.parse(logsJson || '[]');
    const sheet = ss.getSheetByName('Logs');
    _clearUserRows(sheet, userId);
    
    logs.forEach(item => {
      sheet.appendRow([
        userId,
        item.id || '',
        item.name || '',
        item.date || '',
        item.rating !== undefined ? item.rating : 5,
        item.servings || '',
        item.memo || '',
        JSON.stringify(item.usedIngredients || item.ingredientsUsed || []),
        JSON.stringify(item.components || {}),
        item.photo || ''
      ]);
    });
  }
  
  // ── 3. ShoppingList 同期 ──
  if (shoppingListJson !== undefined) {
    const shoppingList = JSON.parse(shoppingListJson || '[]');
    const sheet = ss.getSheetByName('ShoppingList');
    _clearUserRows(sheet, userId);
    
    shoppingList.forEach(item => {
      sheet.appendRow([
        userId,
        item.id || '',
        item.text || '',
        item.checked !== undefined ? String(item.checked) : 'false'
      ]);
    });
  }
  
  return { ok: true };
}

/** 特定のuserIdの行をシートから安全に全削除する高速ヘルパー */
function _clearUserRows(sheet, userId) {
  const lastRow = sheet.getLastRow();
  if (lastRow <= 1) return;
  
  const data = sheet.getRange(1, 1, lastRow, 1).getValues(); // 1列目 (userId)
  for (let i = lastRow - 1; i >= 1; i--) {
    if (String(data[i][0]) === String(userId)) {
      sheet.deleteRow(i + 1);
    }
  }
}
