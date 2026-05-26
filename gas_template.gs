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
  const sheets = [
    "Users",
    "Follows",
    "Timeline",
    "Ingredients",
    "Logs",
    "ShoppingList",
  ];
  sheets.forEach((name) => {
    let sheet = ss.getSheetByName(name);
    if (!sheet) {
      sheet = ss.insertSheet(name);
    }
  });

  // Users ヘッダー
  ss.getSheetByName("Users")
    .getRange(1, 1, 1, 7)
    .setValues([
      [
        "id",
        "username",
        "password",
        "nickname",
        "bio",
        "avatarEmoji",
        "createdAt",
      ],
    ]);

  // Follows ヘッダー
  ss.getSheetByName("Follows")
    .getRange(1, 1, 1, 3)
    .setValues([["followerId", "followingId", "createdAt"]]);

  // Timeline ヘッダー
  ss.getSheetByName("Timeline")
    .getRange(1, 1, 1, 12)
    .setValues([
      [
        "id",
        "userId",
        "nickname",
        "avatarEmoji",
        "dishName",
        "photo",
        "rating",
        "servings",
        "ingredients",
        "memo",
        "date",
        "postedAt",
      ],
    ]);

  // Ingredients ヘッダー (冷蔵庫の中身)
  ss.getSheetByName("Ingredients")
    .getRange(1, 1, 1, 8)
    .setValues([
      [
        "userId",
        "id",
        "name",
        "category",
        "quantity",
        "unit",
        "expiryDate",
        "photo",
      ],
    ]);

  // Logs ヘッダー (個人夕食履歴)
  ss.getSheetByName("Logs")
    .getRange(1, 1, 1, 10)
    .setValues([
      [
        "userId",
        "id",
        "name",
        "date",
        "rating",
        "servings",
        "memo",
        "usedIngredients",
        "components",
        "photo",
      ],
    ]);

  // ShoppingList ヘッダー (買い物メモ)
  ss.getSheetByName("ShoppingList")
    .getRange(1, 1, 1, 4)
    .setValues([["userId", "id", "text", "checked"]]);

  Logger.log("セットアップが正常に完了しました！");
}

/**
 * GET リクエストの受け口
 */
function doGet(e) {
  // アクションが指定されていない（ブラウザで直接開いた）場合は、HTML形式のライブダッシュボードを表示する
  if (!e || !e.parameter || !e.parameter.action) {
    return renderHtmlDashboard();
  }
  return handleRequest(e);
}

/**
 * POST リクエストの受け口 (GASでのCORS対策・簡易運用のためにdoGetへ転送)
 */
function doPost(e) {
  if (e && e.postData && e.postData.contents) {
    try {
      var postData = JSON.parse(e.postData.contents);
      var mockE = {
        parameter: {},
        postData: e.postData,
      };
      for (var key in postData) {
        if (postData.hasOwnProperty(key)) {
          mockE.parameter[key] = postData[key];
        }
      }
      return handleRequest(mockE);
    } catch (err) {
      // JSONパースに失敗した場合は通常の e で handleRequest にフォールバック
    }
  }
  return handleRequest(e);
}

/**
 * 全てのリクエストを処理してJSONで返却するメインハンドラ
 */
function handleRequest(e) {
  const action = e.parameter ? e.parameter.action : null;
  if (!action) {
    return _jsonResponse({
      error: "No action specified. Please access from the application.",
    });
  }

  // 書き込み系アクションの場合はスクリプトレベルのロックを取得して同時実行を防ぐ（連打や複数リクエストによる重複防止）
  const writeActions = [
    "register",
    "updateProfile",
    "follow",
    "unfollow",
    "postDinner",
    "deletePost",
    "syncUserData",
  ];
  let lock = null;
  if (writeActions.includes(action)) {
    lock = LockService.getScriptLock();
    try {
      lock.waitLock(15000); // 最大15秒間ロックが空くのを待つ
    } catch (lockError) {
      return _jsonResponse({
        error:
          "ただいまサーバーが大変混み合っています。少し時間をおいてもう一度お試しください。",
      });
    }
  }

  try {
    let result = {};

    switch (action) {
      // ── セッション・認証 ──
      case "register":
        result = registerUser(
          e.parameter.username,
          e.parameter.password,
          e.parameter.nickname,
        );
        break;
      case "login":
        result = loginUser(e.parameter.username, e.parameter.password);
        break;

      // ── プロフィール ──
      case "updateProfile":
        result = updateProfile(
          e.parameter.userId,
          e.parameter.bio,
          e.parameter.avatarEmoji,
          e.parameter.nickname,
          e.parameter.username,
        );
        break;
      case "getUserProfile":
        result = getUserProfile(e.parameter.userId);
        break;
      case "getAllUsers":
        result = getAllUsers();
        break;

      // ── フォロー関係 ──
      case "follow":
        result = followUser(e.parameter.followerId, e.parameter.followingId);
        break;
      case "unfollow":
        result = unfollowUser(e.parameter.followerId, e.parameter.followingId);
        break;
      case "isFollowing":
        result = isFollowing(e.parameter.followerId, e.parameter.followingId);
        break;
      case "getFollowingIds":
        result = getFollowingIds(e.parameter.userId);
        break;
      case "getFollowerIds":
        result = getFollowerIds(e.parameter.userId);
        break;

      // ── 投稿・タイムライン ──
      case "postDinner":
        result = postDinner(e.parameter.post);
        break;
      case "getTimeline":
        result = getTimeline(e.parameter.limit);
        break;
      case "getUserPosts":
        result = getUserPosts(e.parameter.userId, e.parameter.limit);
        break;
      case "getFollowingFeed":
        result = getFollowingFeed(e.parameter.userIds, e.parameter.limit);
        break;
      case "deletePost":
        result = deletePost(e.parameter.postId);
        break;
      case "isTimelineShared":
        result = isTimelineShared(e.parameter.postId);
        break;

      // ── 個人データ双方向同期 ──
      case "getUserBackupData":
        result = getUserBackupData(e.parameter.userId);
        break;
      case "syncUserData":
        result = syncUserData(
          e.parameter.userId,
          e.parameter.ingredients,
          e.parameter.logs,
          e.parameter.shoppingList,
        );
        break;

      default:
        result = { error: "Unknown action: " + action };
    }

    return _jsonResponse(result);
  } catch (error) {
    return _jsonResponse({ error: error.toString() });
  } finally {
    if (lock) {
      try {
        lock.releaseLock();
      } catch (e) {}
    }
  }
}

/** JSON返却用ヘルパー */
function _jsonResponse(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(
    ContentService.MimeType.JSON,
  );
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
  if (!username || !password)
    throw new Error("ユーザー名とパスワードを入力してください");

  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName("Users");
  const users = _getSheetData("Users");

  const duplicated = users.find(
    (u) => String(u.username).toLowerCase() === String(username).toLowerCase(),
  );
  if (duplicated) throw new Error("このユーザー名はすでに使われています");

  const id = "usr_" + Utilities.getUuid().substring(0, 8);
  const user = {
    id: id,
    username: username,
    password: password,
    nickname: nickname || username,
    bio: "",
    avatarEmoji: "🧑‍🍳",
    createdAt: new Date().toISOString(),
  };

  sheet.appendRow([
    user.id,
    user.username,
    user.password,
    user.nickname,
    user.bio,
    user.avatarEmoji,
    user.createdAt,
  ]);

  return {
    ok: true,
    user: {
      id: user.id,
      username: user.username,
      nickname: user.nickname,
      bio: user.bio,
      avatarEmoji: user.avatarEmoji,
    },
  };
}

/** ログイン認証 */
function loginUser(username, password) {
  const users = _getSheetData("Users");
  const found = users.find(
    (u) =>
      String(u.username).toLowerCase() === String(username).toLowerCase() &&
      String(u.password) === String(password),
  );
  if (!found) throw new Error("ユーザー名またはパスワードが間違っています");

  return {
    ok: true,
    user: {
      id: found.id,
      username: found.username,
      nickname: found.nickname,
      bio: found.bio,
      avatarEmoji: found.avatarEmoji,
    },
  };
}

/** プロフィール更新 */
function updateProfile(userId, bio, avatarEmoji, nickname, username) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();

  // 1. Usersシートを更新
  const userSheet = ss.getSheetByName("Users");
  const userData = userSheet.getDataRange().getValues();
  let userRowIndex = -1;

  for (let i = 1; i < userData.length; i++) {
    if (String(userData[i][0]) === String(userId)) {
      userRowIndex = i + 1;
      break;
    }
  }

  if (userRowIndex === -1) throw new Error("User not found");

  if (username !== undefined && username !== "") {
    // 重複チェック
    const users = _getSheetData("Users");
    const duplicated = users.find(
      (u) =>
        String(u.id) !== String(userId) &&
        String(u.username).toLowerCase() ===
          String(username).trim().toLowerCase(),
    );
    if (duplicated) throw new Error("このユーザー名はすでに使われています");
    userSheet.getRange(userRowIndex, 2).setValue(username.trim());
  }

  if (nickname !== undefined)
    userSheet.getRange(userRowIndex, 4).setValue(nickname);
  if (bio !== undefined) userSheet.getRange(userRowIndex, 5).setValue(bio);
  if (avatarEmoji !== undefined)
    userSheet.getRange(userRowIndex, 6).setValue(avatarEmoji);

  // 2. Timelineシート内の投稿情報も同期更新
  const tlSheet = ss.getSheetByName("Timeline");
  const tlData = tlSheet.getDataRange().getValues();
  for (let i = 1; i < tlData.length; i++) {
    if (String(tlData[i][1]) === String(userId)) {
      const row = i + 1;
      if (nickname !== undefined) tlSheet.getRange(row, 3).setValue(nickname);
      if (avatarEmoji !== undefined)
        tlSheet.getRange(row, 4).setValue(avatarEmoji);
    }
  }

  return { ok: true };
}

/** ユーザープロフィール情報の取得 */
function getUserProfile(userId) {
  const users = _getSheetData("Users");
  const follows = _getSheetData("Follows");
  const tl = _getSheetData("Timeline");

  const user = users.find((u) => String(u.id) === String(userId));
  if (!user) throw new Error("ユーザーが見つかりません");

  const followingCount = follows.filter(
    (f) => String(f.followerId) === String(userId),
  ).length;
  const followersCount = follows.filter(
    (f) => String(f.followingId) === String(userId),
  ).length;
  const posts = tl.filter((p) => String(p.userId) === String(userId)).reverse();

  return {
    user: {
      id: user.id,
      username: user.username,
      nickname: user.nickname,
      bio: user.bio,
      avatarEmoji: user.avatarEmoji,
    },
    followingCount: followingCount,
    followersCount: followersCount,
    posts: posts.map((p) => {
      try {
        p.ingredients = JSON.parse(p.ingredients);
      } catch (e) {}
      return p;
    }),
  };
}

/** 全ユーザー一覧の取得 */
function getAllUsers() {
  const users = _getSheetData("Users");
  return {
    users: users.map((u) => ({
      id: u.id,
      username: u.username,
      nickname: u.nickname,
      avatarEmoji: u.avatarEmoji,
    })),
  };
}

/** ユーザーのフォロー */
function followUser(followerId, followingId) {
  if (String(followerId) === String(followingId))
    throw new Error("自分自身はフォローできません");

  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName("Follows");
  const follows = _getSheetData("Follows");

  const alreadyFollowed = follows.find(
    (f) =>
      String(f.followerId) === String(followerId) &&
      String(f.followingId) === String(followingId),
  );
  if (alreadyFollowed) return { ok: true, message: "すでにフォローしています" };

  sheet.appendRow([followerId, followingId, new Date().toISOString()]);
  return { ok: true };
}

/** フォロー解除 */
function unfollowUser(followerId, followingId) {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName("Follows");
  const data = sheet.getDataRange().getValues();

  for (let i = 1; i < data.length; i++) {
    if (
      String(data[i][0]) === String(followerId) &&
      String(data[i][1]) === String(followingId)
    ) {
      sheet.deleteRow(i + 1);
      break;
    }
  }
  return { ok: true };
}

/** フォロー中かどうかの判定 */
function isFollowing(followerId, followingId) {
  const follows = _getSheetData("Follows");
  const found = follows.find(
    (f) =>
      String(f.followerId) === String(followerId) &&
      String(f.followingId) === String(followingId),
  );
  return { following: !!found };
}

/** フォロー中のユーザーID一覧 */
function getFollowingIds(userId) {
  const follows = _getSheetData("Follows");
  const ids = follows
    .filter((f) => String(f.followerId) === String(userId))
    .map((f) => f.followingId);
  return { ids: ids };
}

/** フォロワーのユーザーID一覧 */
function getFollowerIds(userId) {
  const follows = _getSheetData("Follows");
  const ids = follows
    .filter((f) => String(f.followingId) === String(userId))
    .map((f) => f.followerId);
  return { ids: ids };
}

/** 料理をタイムラインに投稿 */
function postDinner(postJson) {
  if (!postJson) throw new Error("No post content");

  const post = JSON.parse(postJson);
  const sheet =
    SpreadsheetApp.getActiveSpreadsheet().getSheetByName("Timeline");

  const id = post.id || "post_" + Utilities.getUuid().substring(0, 8);
  const postedAt = new Date().toISOString();
  const ingredientsStr = JSON.stringify(post.ingredients || []);

  // 重複チェック：同じIDの投稿が既に存在すれば更新する
  const data = sheet.getDataRange().getValues();
  let rowIndex = -1;
  for (let i = 1; i < data.length; i++) {
    if (String(data[i][0]) === String(id)) {
      rowIndex = i + 1;
      break;
    }
  }

  const rowValues = [
    id,
    post.userId,
    post.nickname,
    post.avatarEmoji,
    post.dishName,
    post.photo || "",
    post.rating || 5,
    post.servings || "",
    ingredientsStr,
    post.memo || "",
    post.date || postedAt.split("T")[0],
    postedAt,
  ];

  if (rowIndex !== -1) {
    // 既存の投稿行を上書き更新
    sheet.getRange(rowIndex, 1, 1, rowValues.length).setValues([rowValues]);
  } else {
    // 新規追加
    sheet.appendRow(rowValues);
  }

  return { ok: true };
}

/** タイムラインの全件取得 */
function getTimeline(limit) {
  const tl = _getSheetData("Timeline");
  const parsed = tl.map((p) => {
    try {
      p.ingredients = JSON.parse(p.ingredients);
    } catch (e) {}
    return p;
  });

  parsed.sort(
    (a, b) => new Date(b.postedAt).getTime() - new Date(a.postedAt).getTime(),
  );
  const lim = parseInt(limit) || 50;
  return { posts: parsed.slice(0, lim) };
}

/** 特定ユーザーの投稿フィードのみ取得 */
function getUserPosts(userId, limit) {
  const tl = _getSheetData("Timeline");
  const filtered = tl.filter((p) => String(p.userId) === String(userId));

  const parsed = filtered.map((p) => {
    try {
      p.ingredients = JSON.parse(p.ingredients);
    } catch (e) {}
    return p;
  });

  parsed.sort(
    (a, b) => new Date(b.postedAt).getTime() - new Date(a.postedAt).getTime(),
  );
  const lim = parseInt(limit) || 50;
  return { posts: parsed.slice(0, lim) };
}

/** フォロー中メンバーの投稿のみ取得 */
function getFollowingFeed(userIdsJson, limit) {
  if (!userIdsJson) return { posts: [] };
  const userIds = JSON.parse(userIdsJson);

  const tl = _getSheetData("Timeline");
  const filtered = tl.filter((p) =>
    userIds.map(String).includes(String(p.userId)),
  );

  const parsed = filtered.map((p) => {
    try {
      p.ingredients = JSON.parse(p.ingredients);
    } catch (e) {}
    return p;
  });

  parsed.sort(
    (a, b) => new Date(b.postedAt).getTime() - new Date(a.postedAt).getTime(),
  );
  const lim = parseInt(limit) || 50;
  return { posts: parsed.slice(0, lim) };
}

/** タイムライン投稿の削除 */
function deletePost(postId) {
  const sheet =
    SpreadsheetApp.getActiveSpreadsheet().getSheetByName("Timeline");
  const data = sheet.getDataRange().getValues();

  for (let i = 1; i < data.length; i++) {
    if (String(data[i][0]) === String(postId)) {
      sheet.deleteRow(i + 1);
      break;
    }
  }
  return { ok: true };
}

/** タイムラインに指定された投稿IDがすでに共有されているかチェック */
function isTimelineShared(postId) {
  if (!postId) return { shared: false };
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName("Timeline");
  const data = sheet.getDataRange().getValues();
  for (let i = 1; i < data.length; i++) {
    if (String(data[i][0]) === String(postId)) {
      return { shared: true };
    }
  }
  return { shared: false };
}

// ════════════════════════════════════════════════
//  個人用データの自動同期・バックアップ API
// ════════════════════════════════════════════════

/** 指定したユーザーの全バックアップデータを取得 */
function getUserBackupData(userId) {
  if (!userId) throw new Error("No userId specified");

  const ingredients = _getSheetData("Ingredients").filter(
    (r) => String(r.userId) === String(userId),
  );
  const logs = _getSheetData("Logs").filter(
    (r) => String(r.userId) === String(userId),
  );
  const shoppingList = _getSheetData("ShoppingList").filter(
    (r) => String(r.userId) === String(userId),
  );

  const parsedLogs = logs.map((l) => {
    try {
      l.usedIngredients = JSON.parse(l.usedIngredients);
    } catch (e) {}
    try {
      l.components = JSON.parse(l.components);
    } catch (e) {}
    return l;
  });

  return {
    ingredients: ingredients.map((i) => {
      // 数値型にパース
      i.quantity = i.quantity !== "" ? parseFloat(i.quantity) : 0;
      return i;
    }),
    logs: parsedLogs,
    shoppingList: shoppingList.map((s) => {
      s.checked =
        s.checked === true || String(s.checked).toLowerCase() === "true";
      return s;
    }),
  };
}

/** ユーザーデータを一括上書き同期 */
function syncUserData(userId, ingredientsJson, logsJson, shoppingListJson) {
  if (!userId) throw new Error("No userId specified");

  const ss = SpreadsheetApp.getActiveSpreadsheet();

  // ── 1. Ingredients 同期 ──
  if (ingredientsJson !== undefined) {
    const ingredients = JSON.parse(ingredientsJson || "[]");
    const sheet = ss.getSheetByName("Ingredients");
    _clearUserRows(sheet, userId);

    ingredients.forEach((item) => {
      sheet.appendRow([
        userId,
        item.id || "",
        item.name || "",
        item.category || "",
        item.quantity !== undefined ? item.quantity : "",
        item.unit || "",
        item.expiryDate || "",
        item.photo || "",
      ]);
    });
  }

  // ── 2. Logs 同期 ──
  if (logsJson !== undefined) {
    const logs = JSON.parse(logsJson || "[]");
    const sheet = ss.getSheetByName("Logs");
    _clearUserRows(sheet, userId);

    logs.forEach((item) => {
      sheet.appendRow([
        userId,
        item.id || "",
        item.name || "",
        item.date || "",
        item.rating !== undefined ? item.rating : 5,
        item.servings || "",
        item.memo || "",
        JSON.stringify(item.usedIngredients || item.ingredientsUsed || []),
        JSON.stringify(item.components || {}),
        item.photo || "",
      ]);
    });
  }

  // ── 3. ShoppingList 同期 ──
  if (shoppingListJson !== undefined) {
    const shoppingList = JSON.parse(shoppingListJson || "[]");
    const sheet = ss.getSheetByName("ShoppingList");
    _clearUserRows(sheet, userId);

    shoppingList.forEach((item) => {
      sheet.appendRow([
        userId,
        item.id || "",
        item.text || "",
        item.checked !== undefined ? String(item.checked) : "false",
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

/**
 * ブラウザで直接開いたときに、スプレッドシートの各データをHTMLで綺麗に表示するダッシュボード
 */
function renderHtmlDashboard() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();

  // 各データを取得
  const timelineData = _getSheetData("Timeline").reverse(); // 新しい順
  const ingredientsData = _getSheetData("Ingredients");
  const logsData = _getSheetData("Logs").reverse(); // 新しい順
  const usersData = _getSheetData("Users");

  // HTMLテンプレートの構築
  let html = `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>FridgeDinnerTracker - クラウドデータベースビューワー</title>
  <link href="https://fonts.googleapis.com/css2?family=Outfit:wght@400;600;700&family=Noto+Sans+JP:wght@400;700&display=swap" rel="stylesheet">
  <style>
    :root {
      --primary: #F97316;
      --primary-gradient: linear-gradient(135deg, #F97316 0%, #EC4899 100%);
      --bg: #F3F4F6;
      --card-bg: #FFFFFF;
      --text: #1F2937;
      --text-sub: #6B7280;
      --border: #E5E7EB;
    }
    body {
      font-family: 'Outfit', 'Noto Sans JP', sans-serif;
      background-color: var(--bg);
      color: var(--text);
      margin: 0;
      padding: 0;
      line-height: 1.5;
    }
    header {
      background: var(--primary-gradient);
      color: white;
      padding: 40px 20px;
      text-align: center;
      box-shadow: 0 4px 20px rgba(0,0,0,0.1);
    }
    header h1 {
      margin: 0;
      font-size: 2.25rem;
      font-weight: 700;
    }
    header p {
      margin: 8px 0 0;
      opacity: 0.9;
      font-size: 1rem;
    }
    .container {
      max-width: 1000px;
      margin: 30px auto;
      padding: 0 20px;
    }
    .section-title {
      font-size: 1.5rem;
      font-weight: 700;
      margin: 40px 0 20px;
      border-left: 5px solid var(--primary);
      padding-left: 12px;
      display: flex;
      justify-content: space-between;
      align-items: center;
    }
    .badge {
      background-color: var(--primary);
      color: white;
      font-size: 0.8rem;
      padding: 4px 10px;
      border-radius: 20px;
      font-weight: 600;
    }
    .grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
      gap: 20px;
    }
    .card {
      background: var(--card-bg);
      border-radius: 16px;
      box-shadow: 0 4px 12px rgba(0,0,0,0.03);
      border: 1px solid var(--border);
      overflow: hidden;
      display: flex;
      flex-direction: column;
      transition: transform 0.2s ease;
    }
    .card:hover {
      transform: translateY(-4px);
    }
    .card-img-wrapper {
      width: 100%;
      height: 180px;
      background: #E5E7EB;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 3rem;
      overflow: hidden;
      position: relative;
    }
    .card-img {
      width: 100%;
      height: 100%;
      object-fit: cover;
    }
    .card-body {
      padding: 20px;
      flex: 1;
      display: flex;
      flex-direction: column;
    }
    .card-meta {
      font-size: 0.8rem;
      color: var(--text-sub);
      margin-bottom: 8px;
      display: flex;
      align-items: center;
      gap: 6px;
    }
    .card-title {
      font-size: 1.2rem;
      font-weight: 700;
      margin: 0 0 10px;
    }
    .card-text {
      font-size: 0.9rem;
      color: var(--text-sub);
      flex: 1;
      margin-bottom: 15px;
    }
    .tags {
      display: flex;
      flex-wrap: wrap;
      gap: 6px;
      margin-top: auto;
    }
    .tag {
      background-color: #F3F4F6;
      color: var(--text);
      font-size: 0.75rem;
      padding: 2px 8px;
      border-radius: 4px;
      border: 1px solid var(--border);
    }
    table {
      width: 100%;
      border-collapse: collapse;
      background: white;
      border-radius: 16px;
      overflow: hidden;
      box-shadow: 0 4px 12px rgba(0,0,0,0.03);
      border: 1px solid var(--border);
      margin-bottom: 30px;
    }
    th, td {
      padding: 14px 20px;
      text-align: left;
      border-bottom: 1px solid var(--border);
    }
    th {
      background-color: #FAFAFA;
      font-weight: 600;
      color: var(--text);
    }
    tr:last-child td {
      border-bottom: none;
    }
    .user-avatar {
      width: 32px;
      height: 32px;
      border-radius: 50%;
      background: #FFE4E6;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      margin-right: 8px;
      vertical-align: middle;
    }
    footer {
      text-align: center;
      padding: 40px 20px;
      color: var(--text-sub);
      font-size: 0.85rem;
      border-top: 1px solid var(--border);
      margin-top: 60px;
      background: white;
    }
  </style>
</head>
<body>
  <header>
    <h1>FridgeDinnerTracker</h1>
    <p>☁️ クラウド同期データベース・ライブダッシュボード</p>
  </header>

  <div class="container">
    <!-- タイムラインセクション -->
    <div class="section-title">
      <span>👥 タイムライン共有レシピ</span>
      <span class="badge">\${timelineData.length}件</span>
    </div>
    <div class="grid">`;

  timelineData.forEach((p) => {
    let photoHtml = `<div class="card-img-wrapper">🍳</div>`;
    if (p.photo && p.photo.indexOf("data:") === 0) {
      photoHtml = `<div class="card-img-wrapper"><img src="\${p.photo}" class="card-img" alt="\${p.dishName}"></div>`;
    }

    let ingredients = [];
    try {
      ingredients = JSON.parse(p.ingredients || "[]");
    } catch (e) {}
    let tagsHtml = "";
    if (ingredients.length > 0) {
      tagsHtml =
        `<div class="tags">` +
        ingredients
          .map((ing) => {
            const name = typeof ing === "object" ? ing.name : ing;
            return `<span class="tag">🥕 \${name}</span>`;
          })
          .join("") +
        `</div>`;
    }

    const ratingStars = "⭐".repeat(p.rating || 5);
    const dateStr = p.date || (p.postedAt ? p.postedAt.split("T")[0] : "");

    html += `
      <div class="card">
        \${photoHtml}
        <div class="card-body">
          <div class="card-meta">
            <span class="user-avatar">\${p.avatarEmoji || '🧑‍🍳'}</span>
            <strong>\${p.nickname || 'ユーザー'}</strong>
            <span>• \${dateStr}</span>
          </div>
          <h3 class="card-title">\${p.dishName} <span style="font-size:0.9rem; font-weight:normal;">\${ratingStars}</span></h3>
          <p class="card-text">\${p.memo || 'メモはありません。'}</p>
          \${tagsHtml}
        </div>
      </div>`;
  });

  html += `
    </div>

    <!-- 冷蔵庫の在庫状況セクション -->
    <div class="section-title">
      <span>🧊 ユーザー登録中の冷蔵庫食材（一部抜粋）</span>
      <span class="badge">\${ingredientsData.length}件</span>
    </div>
    <table>
      <thead>
        <tr>
          <th>食材名</th>
          <th>カテゴリ</th>
          <th>数量</th>
          <th>消費期限</th>
        </tr>
      </thead>
      <tbody>`;

  ingredientsData.slice(0, 10).forEach((ing) => {
    html += `
        <tr>
          <td><strong>\${ing.name}</strong></td>
          <td><span class="tag">\${ing.category || 'その他'}</span></td>
          <td>\${ing.quantity || ''} \${ing.unit || ''}</td>
          <td>\${ing.expiryDate || '未設定'}</td>
        </tr>`;
  });

  if (ingredientsData.length === 0) {
    html += `<tr><td colspan="4" style="text-align:center; color:var(--text-sub);">冷蔵庫に食材はありません。</td></tr>`;
  }

  html += `
      </tbody>
    </table>

    <!-- ユーザー一覧セクション -->
    <div class="section-title">
      <span>🧑‍🍳 登録済みシェフメンバー</span>
      <span class="badge">\${usersData.length}名</span>
    </div>
    <table>
      <thead>
        <tr>
          <th>アバター</th>
          <th>ニックネーム</th>
          <th>ユーザーID</th>
          <th>登録日</th>
        </tr>
      </thead>
      <tbody>`;

  usersData.forEach((u) => {
    const regDate = u.createdAt ? u.createdAt.split("T")[0] : "不明";
    html += `
        <tr>
          <td><span style="font-size:1.5rem;">\${u.avatarEmoji || '🧑‍🍳'}</span></td>
          <td><strong>\${u.nickname || u.username}</strong> (@\${u.username})</td>
          <td><code style="background:#F3F4F6; padding:2px 6px; border-radius:4px; font-size:0.85rem;">\${u.id}</code></td>
          <td>\${regDate}</td>
        </tr>`;
  });

  html += `
      </tbody>
    </table>
  </div>

  <footer>
    <p>© 2026 FridgeDinnerTracker Cloud Server. All rights reserved.</p>
    <p style="font-size:0.75rem; margin-top:5px; opacity:0.8;">※この画面はデータベースの直接閲覧ページです。アプリの操作はクライアントアプリから行ってください。</p>
  </footer>
</body>
</html>`;

  return HtmlService.createHtmlOutput(html)
    .setTitle("FridgeDinnerTracker - クラウドデータベースビューワー")
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}
