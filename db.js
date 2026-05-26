// ─────────────────────────────────────────────────────────
// db.js — Google スプレッドシート (GAS WebApp) 通信モジュール
// ─────────────────────────────────────────────────────────
// ● app.js からは window.sheetDB.xxx() で呼び出す
// ● GAS URL が未設定のときは LocalStorage シミュレーションモードで動作
// ─────────────────────────────────────────────────────────

const sheetDB = (() => {
  'use strict';

  // ── 内部状態 ──
  const LS_KEY_URL    = 'sheetDB_gasUrl';
  const LS_KEY_USER   = 'sheetDB_currentUser';
  const LS_KEY_SIM_USERS     = 'sheetDB_sim_users';
  const LS_KEY_SIM_FOLLOWS   = 'sheetDB_sim_follows';
  const LS_KEY_SIM_TIMELINE  = 'sheetDB_sim_timeline';

  // 古いURLやコピペミスのURLから、正しい新しいURLへの自動マイグレーション
  const LEGACY_URL_1 = 'https://script.google.com/macros/s/AKfycbxmbQHawlLlFVnTFbR1GCwA7QhcOhL7JCryFCDOoD-MQ6ZahZVm0Fb29JxxTVneeQFf5w/exec';
  const LEGACY_URL_2 = 'https://script.google.com/macros/s/AKfycbHG7pG2fMv-TppnV_uNEYEQCcpvHLWmvkZU_fxc4L46wUV_n70PXGbVsGGEGg8lgWYHw/exec';
  const LEGACY_URL_3 = 'https://script.google.com/macros/s/AKfycbzHG7pG2fMv-TppnV_uNEYEQCcpvHLWmvkZU_fxc4L46wUV_n70PXGbVsGGEGg8lgWYHw/exec';
  const LEGACY_URL_4 = 'https://script.google.com/macros/s/AKfycbyl1LcOFwGqA2MQn2E5FuV5rj-ulcMporwUZbdFtDkmtt_9Wnk05dgy8iP3XemlrzySnw/exec';
  const NEW_DEFAULT_URL = 'https://script.google.com/macros/s/AKfycbw0miQEERSeA-F1BM4lyhpRes1uQ0qFFNVtA-UnaWK-6_MX3QNaxqNJuex72xrv94ux4g/exec';
  
  const currentSaved = localStorage.getItem(LS_KEY_URL);
  if (currentSaved === LEGACY_URL_1 || currentSaved === LEGACY_URL_2 || currentSaved === LEGACY_URL_3 || currentSaved === LEGACY_URL_4) {
    localStorage.setItem(LS_KEY_URL, NEW_DEFAULT_URL);
  }

  let _gasUrl = localStorage.getItem(LS_KEY_URL) || NEW_DEFAULT_URL;

  // ── ヘルパー ──
  function _isLive() { return !!_gasUrl; }

  function _simLoad(key, fallback) {
    try { return JSON.parse(localStorage.getItem(key)) || fallback; }
    catch { return fallback; }
  }
  function _simSave(key, data) {
    localStorage.setItem(key, JSON.stringify(data));
  }

  /** 安全なUUID風ID生成（HTTP環境でも安定動作） */
  function _generateId() {
    if (typeof crypto !== 'undefined' && crypto.randomUUID) {
      try { return crypto.randomUUID(); } catch(e) { /* fallthrough */ }
    }
    return 'xxxx-xxxx-xxxx'.replace(/x/g, () =>
      Math.floor(Math.random() * 16).toString(16)
    );
  }

  /** GAS WebApp への通信ラッパー */
  async function _callGAS(action, params = {}) {
    if (!_isLive()) throw new Error('GAS URL が設定されていません');
    
    // アクションとパラメータをPOST用データとしてまとめる
    const postData = { action };
    Object.entries(params).forEach(([k, v]) => {
      postData[k] = typeof v === 'object' ? JSON.stringify(v) : String(v);
    });
    
    // text/plain 形式で JSON をそのまま送信（CORS単純リクエストを維持しつつ、サイズ制限を完全回避）
    const resp = await fetch(_gasUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'text/plain;charset=utf-8'
      },
      body: JSON.stringify(postData),
      redirect: 'follow'
    });
    
    if (!resp.ok) throw new Error(`GAS通信エラー (${resp.status})`);
    const json = await resp.json();
    if (json.error) throw new Error(json.error);
    return json;
  }

  // ════════════════════════════════════════════════
  //  公開API
  // ════════════════════════════════════════════════

  return {

    // ── 接続 ──
    /** GAS URL を設定して永続化 */
    setUrl(url) {
      _gasUrl = (url || '').trim();
      if (_gasUrl) {
        localStorage.setItem(LS_KEY_URL, _gasUrl);
      } else {
        localStorage.removeItem(LS_KEY_URL);
      }
    },
    getUrl()  { return _gasUrl; },
    isLive()  { return _isLive(); },

    // ── セッション管理 ──
    /** 現在ログイン中のユーザーを取得 (null = 未ログイン) */
    getCurrentUser() {
      try { return JSON.parse(localStorage.getItem(LS_KEY_USER)); }
      catch { return null; }
    },
    /** ユーザー情報をローカルに保存 */
    _saveSession(user) {
      localStorage.setItem(LS_KEY_USER, JSON.stringify(user));
    },
    /** ログアウト */
    logout() {
      localStorage.removeItem(LS_KEY_USER);
    },

    // ══════════════════════════════════
    //  会員登録 / ログイン
    // ══════════════════════════════════

    /** 新規会員登録 */
    async register(username, password, nickname) {
      if (_isLive()) {
        const res = await _callGAS('register', { username, password, nickname });
        this._saveSession(res.user);
        return res.user;
      }
      // ── シミュレーション ──
      const users = _simLoad(LS_KEY_SIM_USERS, []);
      if (users.find(u => u.username === username)) {
        throw new Error('このユーザー名はすでに使われています');
      }
      const newUser = {
        id: _generateId(),
        username,
        password,   // ※ シミュレーション専用、実運用ではGAS側でハッシュ化
        nickname: nickname || username,
        bio: '',
        avatarEmoji: '🧑‍🍳',
        createdAt: new Date().toISOString()
      };
      users.push(newUser);
      _simSave(LS_KEY_SIM_USERS, users);
      const { password: _, ...safeUser } = newUser;
      this._saveSession(safeUser);
      return safeUser;
    },

    /** ログイン */
    async login(username, password) {
      if (_isLive()) {
        const res = await _callGAS('login', { username, password });
        this._saveSession(res.user);
        return res.user;
      }
      // ── シミュレーション ──
      const users = _simLoad(LS_KEY_SIM_USERS, []);
      const found = users.find(u => u.username === username && u.password === password);
      if (!found) throw new Error('ユーザー名またはパスワードが違います');
      const { password: _, ...safeUser } = found;
      this._saveSession(safeUser);
      return safeUser;
    },

    // ══════════════════════════════════
    //  プロフィール
    // ══════════════════════════════════

    /** プロフィール更新 */
    async updateProfile(userId, updates) {
      if (_isLive()) {
        const res = await _callGAS('updateProfile', { userId, ...updates });
        // セッション情報も更新
        const cur = this.getCurrentUser();
        if (cur && cur.id === userId) {
          this._saveSession({ ...cur, ...updates });
        }
        return res;
      }
      // ── シミュレーション ──
      const users = _simLoad(LS_KEY_SIM_USERS, []);
      const idx = users.findIndex(u => u.id === userId);
      if (idx === -1) throw new Error('ユーザーが見つかりません');

      if (updates.username) {
        const duplicated = users.find(u => u.id !== userId && String(u.username).toLowerCase() === String(updates.username).trim().toLowerCase());
        if (duplicated) throw new Error('このユーザー名はすでに使われています');
      }

      Object.assign(users[idx], updates);
      _simSave(LS_KEY_SIM_USERS, users);
      const cur = this.getCurrentUser();
      if (cur && cur.id === userId) {
        this._saveSession({ ...cur, ...updates });
      }
      // タイムライン内のアバター・ニックネームも連動更新
      const tl = _simLoad(LS_KEY_SIM_TIMELINE, []);
      tl.forEach(post => {
        if (post.userId === userId) {
          if (updates.nickname) post.nickname = updates.nickname;
          if (updates.avatarEmoji) post.avatarEmoji = updates.avatarEmoji;
        }
      });
      _simSave(LS_KEY_SIM_TIMELINE, tl);
      return { ok: true };
    },

    /** 他ユーザーのプロフィール取得 */
    async getUserProfile(userId) {
      if (_isLive()) {
        return await _callGAS('getUserProfile', { userId });
      }
      // ── シミュレーション ──
      const users = _simLoad(LS_KEY_SIM_USERS, []);
      const user = users.find(u => u.id === userId);
      if (!user) throw new Error('ユーザーが見つかりません');
      const { password: _, ...safeUser } = user;

      // フォロー数
      const follows = _simLoad(LS_KEY_SIM_FOLLOWS, []);
      const followingCount = follows.filter(f => f.followerId === userId).length;
      const followersCount = follows.filter(f => f.followingId === userId).length;

      // 投稿
      const tl = _simLoad(LS_KEY_SIM_TIMELINE, []);
      const posts = tl.filter(p => p.userId === userId);

      return {
        user: safeUser,
        followingCount,
        followersCount,
        posts
      };
    },

    // ══════════════════════════════════
    //  フォロー / アンフォロー
    // ══════════════════════════════════

    async follow(followerId, followingId) {
      if (followerId === followingId) throw new Error('自分自身はフォローできません');
      if (_isLive()) {
        return await _callGAS('follow', { followerId, followingId });
      }
      const follows = _simLoad(LS_KEY_SIM_FOLLOWS, []);
      if (follows.find(f => f.followerId === followerId && f.followingId === followingId)) {
        return { ok: true, message: 'すでにフォローしています' };
      }
      follows.push({ followerId, followingId, createdAt: new Date().toISOString() });
      _simSave(LS_KEY_SIM_FOLLOWS, follows);
      return { ok: true };
    },

    async unfollow(followerId, followingId) {
      if (_isLive()) {
        return await _callGAS('unfollow', { followerId, followingId });
      }
      let follows = _simLoad(LS_KEY_SIM_FOLLOWS, []);
      follows = follows.filter(f => !(f.followerId === followerId && f.followingId === followingId));
      _simSave(LS_KEY_SIM_FOLLOWS, follows);
      return { ok: true };
    },

    async isFollowing(followerId, followingId) {
      if (_isLive()) {
        const res = await _callGAS('isFollowing', { followerId, followingId });
        return res.following;
      }
      const follows = _simLoad(LS_KEY_SIM_FOLLOWS, []);
      return !!follows.find(f => f.followerId === followerId && f.followingId === followingId);
    },

    /** 自分のフォロー中ユーザーIDリスト */
    async getFollowingIds(userId) {
      if (_isLive()) {
        const res = await _callGAS('getFollowingIds', { userId });
        return res.ids || [];
      }
      const follows = _simLoad(LS_KEY_SIM_FOLLOWS, []);
      return follows.filter(f => f.followerId === userId).map(f => f.followingId);
    },

    /** 自分のフォロワーIDリスト */
    async getFollowerIds(userId) {
      if (_isLive()) {
        const res = await _callGAS('getFollowerIds', { userId });
        return res.ids || [];
      }
      const follows = _simLoad(LS_KEY_SIM_FOLLOWS, []);
      return follows.filter(f => f.followingId === userId).map(f => f.followerId);
    },

    // ══════════════════════════════════
    //  タイムライン投稿
    // ══════════════════════════════════

    /** 料理をタイムラインに投稿 */
    async postDinner(userId, logData) {
      const user = this.getCurrentUser();
      if (!user) throw new Error('ログインが必要です');

      const post = {
        id: logData.id || _generateId(),
        userId: user.id,
        nickname: user.nickname || user.username,
        avatarEmoji: user.avatarEmoji || '🧑‍🍳',
        dishName: logData.name || '',
        photo: logData.photo || '',
        rating: logData.rating || 5,
        servings: logData.servings || '',
        ingredients: logData.usedIngredients || logData.ingredientsUsed || [],
        memo: logData.memo || '',
        date: logData.date || new Date().toISOString().split('T')[0],
        postedAt: new Date().toISOString()
      };

      if (_isLive()) {
        return await _callGAS('postDinner', { post: JSON.stringify(post) });
      }
      // ── シミュレーション ──
      const tl = _simLoad(LS_KEY_SIM_TIMELINE, []);
      tl.unshift(post); // 新しいものが先頭
      _simSave(LS_KEY_SIM_TIMELINE, tl);
      return { ok: true, post };
    },

    /** 特定の投稿がタイムラインに共有されているか確認 */
    async isTimelineShared(postId) {
      if (!postId) return false;
      if (_isLive()) {
        try {
          const res = await _callGAS('isTimelineShared', { postId });
          return !!res.shared;
        } catch (e) {
          return true; // エラー時は安全のために共有中とみなす
        }
      }
      const tl = _simLoad(LS_KEY_SIM_TIMELINE, []);
      return tl.some(p => String(p.id) === String(postId));
    },

    /** タイムライン全件取得 (新しい順) */
    async getTimeline(limit = 50) {
      if (_isLive()) {
        const res = await _callGAS('getTimeline', { limit });
        return res.posts || [];
      }
      const tl = _simLoad(LS_KEY_SIM_TIMELINE, []);
      return tl.slice(0, limit);
    },

    /** 特定ユーザーのフィードのみ取得 */
    async getUserPosts(userId, limit = 50) {
      if (_isLive()) {
        const res = await _callGAS('getUserPosts', { userId, limit });
        return res.posts || [];
      }
      const tl = _simLoad(LS_KEY_SIM_TIMELINE, []);
      return tl.filter(p => p.userId === userId).slice(0, limit);
    },

    /** タイムライン投稿を削除 */
    async deletePost(postId) {
      if (_isLive()) {
        return await _callGAS('deletePost', { postId });
      }
      let tl = _simLoad(LS_KEY_SIM_TIMELINE, []);
      tl = tl.filter(p => p.id !== postId);
      _simSave(LS_KEY_SIM_TIMELINE, tl);
      return { ok: true };
    },

    // ══════════════════════════════════
    //  ユーティリティ
    // ══════════════════════════════════

    /** フォロー中のユーザーの投稿のみ取得 (パーソナライズフィード) */
    async getFollowingFeed(userId, limit = 50) {
      let followingIds = [];
      try {
        followingIds = await this.getFollowingIds(userId);
      } catch (e) {
        console.error("Failed to get following ids, using empty list:", e);
      }
      
      // 確実に配列であることを保証
      if (!followingIds || !Array.isArray(followingIds)) {
        followingIds = [];
      }
      
      // 自分自身の投稿も確実に含める（重複防止）
      if (!followingIds.includes(userId)) {
        followingIds.push(userId);
      }
      
      if (_isLive()) {
        const res = await _callGAS('getFollowingFeed', { userIds: JSON.stringify(followingIds), limit });
        return res.posts || [];
      }
      const tl = _simLoad(LS_KEY_SIM_TIMELINE, []);
      return tl.filter(p => followingIds.includes(p.userId)).slice(0, limit);
    },

    /** シミュレーションデータの全消去 (開発用) */
    clearSimData() {
      localStorage.removeItem(LS_KEY_SIM_USERS);
      localStorage.removeItem(LS_KEY_SIM_FOLLOWS);
      localStorage.removeItem(LS_KEY_SIM_TIMELINE);
    },

    /** 全ユーザー一覧（シミュレーション、検索用） */
    async getAllUsers() {
      if (_isLive()) {
        const res = await _callGAS('getAllUsers');
        return res.users || [];
      }
      const users = _simLoad(LS_KEY_SIM_USERS, []);
      return users.map(({ password, ...u }) => u);
    },

    /** 指定したユーザーの全バックアップデータを取得 */
    async getUserBackupData(userId) {
      if (_isLive()) {
        return await _callGAS('getUserBackupData', { userId });
      }
      return { ingredients: [], logs: [], shoppingList: [] };
    },

    /** ユーザーデータを一括同期・バックアップ */
    async syncUserData(userId, ingredients, logs, shoppingList) {
      if (_isLive()) {
        return await _callGAS('syncUserData', {
          userId,
          ingredients: JSON.stringify(ingredients || []),
          logs: JSON.stringify(logs || []),
          shoppingList: JSON.stringify(shoppingList || [])
        });
      }
      return { ok: true };
    }
  };
})();

// グローバルに公開
window.sheetDB = sheetDB;
