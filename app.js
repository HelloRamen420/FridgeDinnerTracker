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
// ─── 1. グローバルアプリケーション状態 ＆ クラウド同期エンジン ───

// SQLテーブル作成用スクリプトの定義
const SUPABASE_SQL_SCHEMA = `-- Profiles table
CREATE TABLE IF NOT EXISTS public.profiles (
  id UUID REFERENCES auth.users ON DELETE CASCADE PRIMARY KEY,
  username TEXT UNIQUE NOT NULL,
  avatar_url TEXT,
  bio TEXT,
  created_at TIMESTAMPTZ DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- Refrigerator ingredients table
CREATE TABLE IF NOT EXISTS public.ingredients (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users ON DELETE CASCADE NOT NULL,
  name TEXT NOT NULL,
  category TEXT NOT NULL,
  quantity NUMERIC NOT NULL,
  unit TEXT NOT NULL,
  expiry_date DATE NOT NULL,
  photo TEXT, -- base64 compressed photo
  created_at TIMESTAMPTZ DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- Dinner logs table
CREATE TABLE IF NOT EXISTS public.dinner_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users ON DELETE CASCADE NOT NULL,
  name TEXT NOT NULL,
  date DATE NOT NULL,
  rating NUMERIC NOT NULL,
  memo TEXT,
  photo TEXT, -- base64 compressed photo
  ingredients_used TEXT[] DEFAULT '{}'::TEXT[],
  components TEXT[] DEFAULT '{}'::TEXT[],
  is_public BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- Shopping list table
CREATE TABLE IF NOT EXISTS public.shopping_list (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users ON DELETE CASCADE NOT NULL,
  text TEXT NOT NULL,
  checked BOOLEAN DEFAULT false NOT NULL,
  created_at TIMESTAMPTZ DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- Folders table
CREATE TABLE IF NOT EXISTS public.folders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users ON DELETE CASCADE NOT NULL,
  name TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- Favorites table
CREATE TABLE IF NOT EXISTS public.favorites (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users ON DELETE CASCADE NOT NULL,
  log_id UUID NOT NULL,
  folder_id UUID REFERENCES public.folders ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- Follows table
CREATE TABLE IF NOT EXISTS public.follows (
  follower_id UUID REFERENCES auth.users ON DELETE CASCADE,
  following_id UUID REFERENCES auth.users ON DELETE CASCADE,
  PRIMARY KEY (follower_id, following_id),
  created_at TIMESTAMPTZ DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- Timeline likes table
CREATE TABLE IF NOT EXISTS public.timeline_likes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users ON DELETE CASCADE NOT NULL,
  log_id UUID REFERENCES public.dinner_logs ON DELETE CASCADE NOT NULL,
  created_at TIMESTAMPTZ DEFAULT timezone('utc'::text, now()) NOT NULL,
  UNIQUE(user_id, log_id)
);

-- Comments table
CREATE TABLE IF NOT EXISTS public.comments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users ON DELETE CASCADE NOT NULL,
  log_id UUID REFERENCES public.dinner_logs ON DELETE CASCADE NOT NULL,
  text TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- Notifications table
CREATE TABLE IF NOT EXISTS public.notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users ON DELETE CASCADE NOT NULL,
  notifier_id UUID REFERENCES auth.users ON DELETE CASCADE NOT NULL,
  type TEXT NOT NULL,
  log_id UUID,
  comment_id UUID,
  is_read BOOLEAN DEFAULT false NOT NULL,
  created_at TIMESTAMPTZ DEFAULT timezone('utc'::text, now()) NOT NULL
);`;

// 安全なUUID生成関数
function generateUUID() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
    const r = Math.random() * 16 | 0;
    const v = c === 'x' ? r : (r & 0x3 | 0x8);
    return v.toString(16);
  });
}

// 模擬データベース初期値 (SNSに活気を持たせるプリセット)
const PRESET_MOCK_PROFILES = [
  { id: "m-user-mary", username: "cook_mary", avatar_url: "https://images.unsplash.com/photo-1544005313-94ddf0286df2?w=150", bio: "料理研究家のマリーです。毎日おうちで作れる健康ご飯を共有しています！" },
  { id: "m-user-ken", username: "ken_donburi", avatar_url: "https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=150", bio: "ガッツリ系丼物と炒め物の王道レシピを連投します！" },
  { id: "m-user-yuki", username: "yasai_lover", avatar_url: "https://images.unsplash.com/photo-1494790108377-be9c29b29330?w=150", bio: "野菜ソムリエ。無農薬野菜を使ったサラダやスープの専門家。" }
];

const PRESET_MOCK_LOGS = [
  {
    id: "m-log-1",
    user_id: "m-user-mary",
    name: "夏野菜たっぷり極上キーマカレー",
    date: "2026-05-25",
    rating: 4.8,
    memo: "# マリー特製キーマカレー\n- フライパンに油とみじん切りのにんにくを入れて温め、ひき肉と野菜を炒める。\n- トマトを入れて煮込み、カレールーを入れて仕上げる！\n- 目玉焼きをのせるとさらにマイルドで美味しくなります！",
    photo: "https://images.unsplash.com/photo-1565557623262-b51c2513a641?w=400",
    ingredients_used: ["合い挽き肉", "ナス", "トマト", "玉ねぎ", "卵"],
    components: ["🍛 丼物・ご飯物", "🥗 サラダ・和え物"],
    is_public: true,
    created_at: "2026-05-25T12:00:00Z"
  },
  {
    id: "m-log-2",
    user_id: "m-user-ken",
    name: "スタミナ爆発！にんにく醤油の豚バラ炒め丼",
    date: "2026-05-24",
    rating: 5.0,
    memo: "# 漢のスタミナ丼\n- 豚バラ肉をごま油でカリカリに炒める。\n- キャベツとにんにくを追加し、醤油、酒、みりんで味付け！\n- 熱々の大盛りご飯に豪快に盛り付ける。",
    photo: "https://images.unsplash.com/photo-1534422298391-e4f8c172dddb?w=400",
    ingredients_used: ["豚バラ肉", "にんにく", "キャベツ", "ご飯"],
    components: ["🍛 丼物・ご飯物", "🥩 焼き物・炒め物"],
    is_public: true,
    created_at: "2026-05-24T19:30:00Z"
  },
  {
    id: "m-log-3",
    user_id: "m-user-yuki",
    name: "ほっこり大根と根菜の和風寄せ煮込み",
    date: "2026-05-23",
    rating: 4.5,
    memo: "# 野菜染み渡る煮込み\n- 大根、にんじん、里芋を出汁でじっくりコトコトコト煮る。\n- 醤油とみりんで優しい味付けにし、練り物を追加。\n- 寒い日にも最適な、体に染みる逸品です。",
    photo: "https://images.unsplash.com/photo-1547592180-85f173990554?w=400",
    ingredients_used: ["大根", "にんじん", "里芋", "出汁", "ちくわ"],
    components: ["🍲 鍋・煮込み"],
    is_public: true,
    created_at: "2026-05-23T18:00:00Z"
  }
];

// クラウド・ローカル統括DBシンクエンジン
const cloudDB = {
  supabaseUrl: localStorage.getItem('supabase_url') || '',
  supabaseKey: localStorage.getItem('supabase_key') || '',
  supabase: null,
  syncStatus: 'local', // 'local', 'syncing', 'synced', 'offline'
  currentUser: null,  // { id, email, username, avatar_url, bio }

  init() {
    this.supabaseUrl = localStorage.getItem('supabase_url') || '';
    this.supabaseKey = localStorage.getItem('supabase_key') || '';
    if (this.supabaseUrl && this.supabaseKey && typeof supabase !== 'undefined') {
      try {
        this.supabase = supabase.createClient(this.supabaseUrl, this.supabaseKey);
        this.checkSession();
      } catch (err) {
        console.error("Supabaseクライアントの初期化エラー:", err);
        this.syncStatus = 'offline';
      }
    } else {
      this.supabase = null;
      this.syncStatus = 'local';
      this.loadSimulatedUser();
    }
  },

  isConfigured() {
    return this.supabase !== null;
  },

  async checkSession() {
    if (!this.supabase) return;
    try {
      const { data: { session }, error } = await this.supabase.auth.getSession();
      if (error) throw error;
      if (session) {
        this.currentUser = {
          id: session.user.id,
          email: session.user.email,
          username: session.user.user_metadata?.username || 'ユーザー様',
          avatar_url: '',
          bio: ''
        };
        // プロフィールをクラウドから引き出す
        const { data: profile } = await this.supabase
          .from('profiles')
          .select('*')
          .eq('id', session.user.id)
          .single();
        
        if (profile) {
          this.currentUser.username = profile.username;
          this.currentUser.avatar_url = profile.avatar_url || '';
          this.currentUser.bio = profile.bio || '';
        }
        this.syncStatus = 'synced';
        // データをクラウドから同期ロードする
        await this.pullCloudData();
      } else {
        this.currentUser = null;
        this.syncStatus = 'local';
      }
      renderAll();
    } catch (err) {
      console.error("セッションチェックエラー:", err);
      this.syncStatus = 'offline';
      renderAll();
    }
  },

  loadSimulatedUser() {
    const rawUser = localStorage.getItem('simulated_current_user');
    if (rawUser) {
      this.currentUser = JSON.parse(rawUser);
    } else {
      this.currentUser = null;
    }
  },

  // アカウント新規作成
  async signUp(username, email, password) {
    this.syncStatus = 'syncing';
    renderAll();
    
    if (this.isConfigured()) {
      try {
        const { data, error } = await this.supabase.auth.signUp({
          email,
          password,
          options: {
            data: { username }
          }
        });
        if (error) throw error;
        
        if (data.user) {
          // プロフィールレコードの作成
          const { error: pErr } = await this.supabase
            .from('profiles')
            .insert({
              id: data.user.id,
              username: username,
              bio: 'よろしくお願いします！',
              avatar_url: ''
            });
          if (pErr) throw pErr;
          
          this.currentUser = {
            id: data.user.id,
            email: email,
            username: username,
            avatar_url: '',
            bio: 'よろしくお願いします！'
          };
          this.syncStatus = 'synced';
          
          // 新規登録成功時に、現在のローカルデータをこのアカウントへマージする
          await this.mergeLocalDataToCloud();
          alert("アカウントが作成され、クラウド同期が有効になりました！");
        }
      } catch (err) {
        console.error("SignUp失敗:", err);
        this.syncStatus = 'offline';
        alert("アカウント作成エラー: " + err.message);
      }
    } else {
      // 模擬データベース動作
      let simulatedUsers = JSON.parse(localStorage.getItem('simulated_users') || '[]');
      if (simulatedUsers.some(u => u.username === username)) {
        this.syncStatus = 'local';
        alert("そのユーザー名は既に使用されています。");
        return;
      }
      
      const newUser = {
        id: generateUUID(),
        email,
        username,
        bio: 'よろしくお願いします！',
        avatar_url: ''
      };
      simulatedUsers.push(newUser);
      localStorage.setItem('simulated_users', JSON.stringify(simulatedUsers));
      
      this.currentUser = newUser;
      localStorage.setItem('simulated_current_user', JSON.stringify(newUser));
      this.syncStatus = 'local';
      alert("模擬アカウントが作成されました！(ローカル保存中)");
    }
    renderAll();
  },

  // ログイン
  async signIn(email, password) {
    this.syncStatus = 'syncing';
    renderAll();
    
    if (this.isConfigured()) {
      try {
        const { data, error } = await this.supabase.auth.signInWithPassword({
          email,
          password
        });
        if (error) throw error;
        
        if (data.user) {
          this.currentUser = {
            id: data.user.id,
            email: email,
            username: data.user.user_metadata?.username || 'ユーザー様',
            avatar_url: '',
            bio: ''
          };
          
          const { data: profile } = await this.supabase
            .from('profiles')
            .select('*')
            .eq('id', data.user.id)
            .single();
          
          if (profile) {
            this.currentUser.username = profile.username;
            this.currentUser.avatar_url = profile.avatar_url || '';
            this.currentUser.bio = profile.bio || '';
          }
          
          this.syncStatus = 'synced';
          // ログインした時点でローカルとクラウドのデータを合流
          await this.mergeLocalDataToCloud();
          await this.pullCloudData();
          alert("ログイン成功！データを完全にクラウドと同期しました。");
        }
      } catch (err) {
        console.error("Login失敗:", err);
        this.syncStatus = 'offline';
        alert("ログインエラー: " + err.message);
      }
    } else {
      // 模擬データベース動作
      const simulatedUsers = JSON.parse(localStorage.getItem('simulated_users') || '[]');
      const user = simulatedUsers.find(u => u.email === email);
      if (user) {
        this.currentUser = user;
        localStorage.setItem('simulated_current_user', JSON.stringify(user));
        this.syncStatus = 'local';
        alert("模擬ログイン成功！");
      } else {
        this.syncStatus = 'local';
        alert("ユーザーが見つかりません。アカウント作成をしてください。");
      }
    }
    renderAll();
  },

  // ログアウト
  async signOut() {
    if (this.isConfigured()) {
      try {
        await this.supabase.auth.signOut();
      } catch (e) {
        console.error(e);
      }
    }
    this.currentUser = null;
    localStorage.removeItem('simulated_current_user');
    this.syncStatus = this.isConfigured() ? 'local' : 'local';
    
    // データ初期化 (ログアウト時は一旦空にしてリセット)
    state.ingredients = [];
    state.dinnerLogs = [];
    state.shoppingList = [];
    state.save();
    
    alert("ログアウトしました。");
    renderAll();
  },

  // プロフィールの更新
  async updateProfile(username, bio, avatarUrl) {
    if (!this.currentUser) return;
    this.currentUser.username = username;
    this.currentUser.bio = bio;
    if (avatarUrl) this.currentUser.avatar_url = avatarUrl;
    
    if (this.isConfigured()) {
      this.syncStatus = 'syncing';
      renderAll();
      try {
        const { error } = await this.supabase
          .from('profiles')
          .upsert({
            id: this.currentUser.id,
            username,
            bio,
            avatar_url: this.currentUser.avatar_url
          });
        if (error) throw error;
        this.syncStatus = 'synced';
      } catch (err) {
        console.error("プロフィール更新エラー:", err);
        this.syncStatus = 'offline';
      }
    } else {
      localStorage.setItem('simulated_current_user', JSON.stringify(this.currentUser));
      // 模擬データベース内も更新
      let simulatedUsers = JSON.parse(localStorage.getItem('simulated_users') || '[]');
      const idx = simulatedUsers.findIndex(u => u.id === this.currentUser.id);
      if (idx !== -1) {
        simulatedUsers[idx] = this.currentUser;
        localStorage.setItem('simulated_users', JSON.stringify(simulatedUsers));
      }
    }
    renderAll();
  },

  // ローカルデータをクラウドに自動マージする
  async mergeLocalDataToCloud() {
    if (!this.isConfigured() || !this.currentUser) return;
    try {
      this.syncStatus = 'syncing';
      
      // ローカルの食材マージ
      if (state.ingredients.length > 0) {
        const payload = state.ingredients.map(ing => ({
          id: ing.id,
          user_id: this.currentUser.id,
          name: ing.name,
          category: ing.category,
          quantity: ing.quantity,
          unit: ing.unit,
          expiry_date: ing.expiryDate,
          photo: ing.photo || ''
        }));
        await this.supabase.from('ingredients').upsert(payload);
      }
      
      // ローカルの夕食記録マージ
      if (state.dinnerLogs.length > 0) {
        const payload = state.dinnerLogs.map(log => ({
          id: log.id,
          user_id: this.currentUser.id,
          name: log.name,
          date: log.date,
          rating: log.rating,
          memo: log.memo,
          photo: log.photo || '',
          ingredients_used: log.ingredientsUsed || [],
          components: log.components || [],
          is_public: log.is_public || false
        }));
        await this.supabase.from('dinner_logs').upsert(payload);
      }
      
      // ローカルの買い物メモマージ
      if (state.shoppingList.length > 0) {
        const payload = state.shoppingList.map(item => ({
          id: item.id,
          user_id: this.currentUser.id,
          text: item.text,
          checked: item.checked
        }));
        await this.supabase.from('shopping_list').upsert(payload);
      }
      
      this.syncStatus = 'synced';
    } catch (err) {
      console.error("ローカルデータマージ失敗:", err);
      this.syncStatus = 'offline';
    }
  },

  // クラウドから最新データを引っ張る
  async pullCloudData() {
    if (!this.isConfigured() || !this.currentUser) return;
    try {
      this.syncStatus = 'syncing';
      renderAll();
      
      // 食材
      const { data: ing } = await this.supabase
        .from('ingredients')
        .select('*')
        .eq('user_id', this.currentUser.id);
      
      if (ing) {
        state.ingredients = ing.map(d => ({
          id: d.id,
          name: d.name,
          category: d.category,
          quantity: parseFloat(d.quantity),
          unit: d.unit,
          expiryDate: d.expiry_date,
          photo: d.photo || null
        }));
      }
      
      // 夕食記録
      const { data: logs } = await this.supabase
        .from('dinner_logs')
        .select('*')
        .eq('user_id', this.currentUser.id);
      
      if (logs) {
        state.dinnerLogs = logs.map(d => ({
          id: d.id,
          name: d.name,
          date: d.date,
          rating: parseFloat(d.rating),
          memo: d.memo || '',
          photo: d.photo || null,
          ingredientsUsed: d.ingredients_used || [],
          components: d.components || [],
          is_public: d.is_public || false
        }));
      }
      
      // 買い物メモ
      const { data: shop } = await this.supabase
        .from('shopping_list')
        .select('*')
        .eq('user_id', this.currentUser.id);
      
      if (shop) {
        state.shoppingList = shop.map(d => ({
          id: d.id,
          text: d.text,
          checked: d.checked
        }));
      }
      
      state.save();
      this.syncStatus = 'synced';
    } catch (err) {
      console.error("クラウドデータのロード失敗:", err);
      this.syncStatus = 'offline';
    }
    renderAll();
  },

  // 食材をセーブ（クラウド＋ローカル）
  async saveIngredients(ingredients) {
    state.ingredients = ingredients;
    state.save();
    
    if (this.isConfigured() && this.currentUser) {
      try {
        this.syncStatus = 'syncing';
        renderSyncIndicator();
        
        const payload = ingredients.map(ing => ({
          id: ing.id,
          user_id: this.currentUser.id,
          name: ing.name,
          category: ing.category,
          quantity: ing.quantity,
          unit: ing.unit,
          expiry_date: ing.expiryDate,
          photo: ing.photo || ''
        }));
        
        const ids = ingredients.map(i => i.id);
        if (ids.length > 0) {
          await this.supabase.from('ingredients').delete().eq('user_id', this.currentUser.id).not('id', 'in', `(${ids.join(',')})`);
          await this.supabase.from('ingredients').upsert(payload);
        } else {
          await this.supabase.from('ingredients').delete().eq('user_id', this.currentUser.id);
        }
        
        this.syncStatus = 'synced';
      } catch (err) {
        console.error("食材クラウド同期失敗:", err);
        this.syncStatus = 'offline';
      }
    }
    renderSyncIndicator();
  },

  // 夕食記録をセーブ（クラウド＋ローカル）
  async saveDinnerLogs(logs) {
    state.dinnerLogs = logs;
    state.save();
    
    if (this.isConfigured() && this.currentUser) {
      try {
        this.syncStatus = 'syncing';
        renderSyncIndicator();
        
        const payload = logs.map(log => ({
          id: log.id,
          user_id: this.currentUser.id,
          name: log.name,
          date: log.date,
          rating: log.rating,
          memo: log.memo,
          photo: log.photo || '',
          ingredients_used: log.ingredientsUsed || [],
          components: log.components || [],
          is_public: log.is_public || false
        }));
        
        const ids = logs.map(l => l.id);
        if (ids.length > 0) {
          await this.supabase.from('dinner_logs').delete().eq('user_id', this.currentUser.id).not('id', 'in', `(${ids.join(',')})`);
          await this.supabase.from('dinner_logs').upsert(payload);
        } else {
          await this.supabase.from('dinner_logs').delete().eq('user_id', this.currentUser.id);
        }
        
        this.syncStatus = 'synced';
      } catch (err) {
        console.error("料理履歴クラウド同期失敗:", err);
        this.syncStatus = 'offline';
      }
    }
    renderSyncIndicator();
  },

  // 買い物メモをセーブ（クラウド＋ローカル）
  async saveShoppingList(list) {
    state.shoppingList = list;
    state.save();
    
    if (this.isConfigured() && this.currentUser) {
      try {
        this.syncStatus = 'syncing';
        renderSyncIndicator();
        
        const payload = list.map(item => ({
          id: item.id,
          user_id: this.currentUser.id,
          text: item.text,
          checked: item.checked
        }));
        
        const ids = list.map(l => l.id);
        if (ids.length > 0) {
          await this.supabase.from('shopping_list').delete().eq('user_id', this.currentUser.id).not('id', 'in', `(${ids.join(',')})`);
          await this.supabase.from('shopping_list').upsert(payload);
        } else {
          await this.supabase.from('shopping_list').delete().eq('user_id', this.currentUser.id);
        }
        
        this.syncStatus = 'synced';
      } catch (err) {
        console.error("買い物メモクラウド同期失敗:", err);
        this.syncStatus = 'offline';
      }
    }
    renderSyncIndicator();
  },

  // --- SNS コミュニティデータアクセス ---

  // タイムラインパブリック投稿ロード
  async getTimelinePosts() {
    if (this.isConfigured()) {
      try {
        const { data: logs, error } = await this.supabase
          .from('dinner_logs')
          .select('*, profiles(username, avatar_url)')
          .eq('is_public', true)
          .order('date', { ascending: false });
        
        if (error) throw error;
        return logs.map(d => ({
          id: d.id,
          user_id: d.user_id,
          author: d.profiles?.username || '匿名の料理人',
          avatar_url: d.profiles?.avatar_url || '',
          name: d.name,
          date: d.date,
          rating: parseFloat(d.rating),
          memo: d.memo || '',
          photo: d.photo || null,
          ingredientsUsed: d.ingredients_used || [],
          components: d.components || [],
          created_at: d.created_at
        }));
      } catch (err) {
        console.error("タイムラインロードエラー:", err);
        return [];
      }
    } else {
      // 模擬DBタイムライン
      const localLogs = PRESET_MOCK_LOGS.concat(
        state.dinnerLogs.filter(log => log.is_public).map(log => ({
          ...log,
          user_id: this.currentUser ? this.currentUser.id : 'anonymous',
          author: this.currentUser ? this.currentUser.username : '自分',
          avatar_url: this.currentUser ? this.currentUser.avatar_url : ''
        }))
      );
      
      const uniqueLogs = [];
      const seen = new Set();
      localLogs.forEach(l => {
        if (!seen.has(l.id)) {
          seen.add(l.id);
          const prof = PRESET_MOCK_PROFILES.find(p => p.id === l.user_id) || { username: l.author || '匿名の料理人', avatar_url: l.avatar_url || '' };
          uniqueLogs.push({
            ...l,
            author: prof.username,
            avatar_url: prof.avatar_url
          });
        }
      });
      
      return uniqueLogs.sort((a,b) => new Date(b.date) - new Date(a.date));
    }
  },

  // お気に入りフォルダ一覧ロード
  async getFolders() {
    if (this.isConfigured() && this.currentUser) {
      try {
        const { data, error } = await this.supabase
          .from('folders')
          .select('*')
          .eq('user_id', this.currentUser.id);
        if (error) throw error;
        return data;
      } catch (err) {
        console.error(err);
        return [];
      }
    } else {
      const allFolders = JSON.parse(localStorage.getItem('simulated_folders') || '[]');
      return allFolders.filter(f => f.user_id === (this.currentUser ? this.currentUser.id : 'sim-guest'));
    }
  },

  // フォルダの作成
  async createFolder(name) {
    const userId = this.currentUser ? this.currentUser.id : 'sim-guest';
    const newFolder = {
      id: generateUUID(),
      user_id: userId,
      name: name,
      created_at: new Date().toISOString()
    };
    
    if (this.isConfigured() && this.currentUser) {
      try {
        await this.supabase.from('folders').insert(newFolder);
      } catch (err) {
        console.error(err);
      }
    } else {
      let folders = JSON.parse(localStorage.getItem('simulated_folders') || '[]');
      folders.push(newFolder);
      localStorage.setItem('simulated_folders', JSON.stringify(folders));
    }
    renderAll();
  },

  // お気に入りブックマーク登録トグル
  async toggleBookmark(logId, folderId) {
    if (!this.currentUser) {
      alert("ブックマークするにはログインしてください。");
      return false;
    }
    
    const isBookmarked = await this.isBookmarked(logId);
    
    if (this.isConfigured()) {
      try {
        if (isBookmarked) {
          await this.supabase.from('favorites').delete().eq('user_id', this.currentUser.id).eq('log_id', logId);
        } else {
          await this.supabase.from('favorites').insert({
            user_id: this.currentUser.id,
            log_id: logId,
            folder_id: folderId || null
          });
        }
      } catch (err) {
        console.error(err);
      }
    } else {
      let favs = JSON.parse(localStorage.getItem('simulated_favorites') || '[]');
      if (isBookmarked) {
        favs = favs.filter(f => !(f.user_id === this.currentUser.id && f.log_id === logId));
      } else {
        favs.push({
          id: generateUUID(),
          user_id: this.currentUser.id,
          log_id: logId,
          folder_id: folderId || null,
          created_at: new Date().toISOString()
        });
      }
      localStorage.setItem('simulated_favorites', JSON.stringify(favs));
    }
    return !isBookmarked;
  },

  async isBookmarked(logId) {
    if (!this.currentUser) return false;
    if (this.isConfigured()) {
      const { data } = await this.supabase
        .from('favorites')
        .select('id')
        .eq('user_id', this.currentUser.id)
        .eq('log_id', logId);
      return data && data.length > 0;
    } else {
      const favs = JSON.parse(localStorage.getItem('simulated_favorites') || '[]');
      return favs.some(f => f.user_id === this.currentUser.id && f.log_id === logId);
    }
  },

  // いいね（Like）のトグル
  async toggleLike(logId) {
    if (!this.currentUser) {
      alert("いいねするにはログインが必要です。");
      return;
    }
    
    const liked = await this.hasLiked(logId);
    
    if (this.isConfigured()) {
      try {
        if (liked) {
          await this.supabase.from('timeline_likes').delete().eq('user_id', this.currentUser.id).eq('log_id', logId);
        } else {
          await this.supabase.from('timeline_likes').insert({
            user_id: this.currentUser.id,
            log_id: logId
          });
          // 投稿者にいいね通知を送信する
          const { data: log } = await this.supabase.from('dinner_logs').select('user_id').eq('id', logId).single();
          if (log && log.user_id !== this.currentUser.id) {
            await this.sendNotification(log.user_id, 'like', logId);
          }
        }
      } catch (err) {
        console.error(err);
      }
    } else {
      let likes = JSON.parse(localStorage.getItem('simulated_likes') || '[]');
      if (liked) {
        likes = likes.filter(l => !(l.user_id === this.currentUser.id && l.log_id === logId));
      } else {
        likes.push({ user_id: this.currentUser.id, log_id: logId });
        
        // 模擬通知送信
        const allLogs = PRESET_MOCK_LOGS.concat(state.dinnerLogs);
        const log = allLogs.find(l => l.id === logId);
        if (log && log.user_id !== this.currentUser.id) {
          this.sendMockNotification(log.user_id, 'like', logId);
        }
      }
      localStorage.setItem('simulated_likes', JSON.stringify(likes));
    }
  },

  async hasLiked(logId) {
    if (!this.currentUser) return false;
    if (this.isConfigured()) {
      const { data } = await this.supabase
        .from('timeline_likes')
        .select('id')
        .eq('user_id', this.currentUser.id)
        .eq('log_id', logId);
      return data && data.length > 0;
    } else {
      const likes = JSON.parse(localStorage.getItem('simulated_likes') || '[]');
      return likes.some(l => l.user_id === this.currentUser.id && l.log_id === logId);
    }
  },

  async getLikeCount(logId) {
    if (this.isConfigured()) {
      const { count } = await this.supabase
        .from('timeline_likes')
        .select('*', { count: 'exact', head: true })
        .eq('log_id', logId);
      return count || 0;
    } else {
      const likes = JSON.parse(localStorage.getItem('simulated_likes') || '[]');
      return likes.filter(l => l.log_id === logId).length;
    }
  },

  // コメント返信投稿
  async addComment(logId, text) {
    if (!this.currentUser) return;
    
    const newComment = {
      id: generateUUID(),
      log_id: logId,
      user_id: this.currentUser.id,
      text: text,
      created_at: new Date().toISOString()
    };
    
    if (this.isConfigured()) {
      try {
        await this.supabase.from('comments').insert(newComment);
        
        // メンション検知 & 通知送信
        const mentions = text.match(/@\w+/g);
        if (mentions) {
          for (let m of mentions) {
            const username = m.substring(1);
            const { data: profile } = await this.supabase.from('profiles').select('id').eq('username', username).single();
            if (profile && profile.id !== this.currentUser.id) {
              await this.sendNotification(profile.id, 'mention', logId);
            }
          }
        }
        
        // 投稿者にコメント通知送信
        const { data: log } = await this.supabase.from('dinner_logs').select('user_id').eq('id', logId).single();
        if (log && log.user_id !== this.currentUser.id) {
          await this.sendNotification(log.user_id, 'comment', logId);
        }
      } catch (err) {
        console.error(err);
      }
    } else {
      let comments = JSON.parse(localStorage.getItem('simulated_comments') || '[]');
      comments.push(newComment);
      localStorage.setItem('simulated_comments', JSON.stringify(comments));
      
      // 模擬通知送信
      const allLogs = PRESET_MOCK_LOGS.concat(state.dinnerLogs);
      const log = allLogs.find(l => l.id === logId);
      if (log && log.user_id !== this.currentUser.id) {
        this.sendMockNotification(log.user_id, 'comment', logId);
      }
      
      // 模擬メンション通知送信
      const mentions = text.match(/@\w+/g);
      if (mentions) {
        const users = PRESET_MOCK_PROFILES.concat(JSON.parse(localStorage.getItem('simulated_users') || '[]'));
        for (let m of mentions) {
          const username = m.substring(1);
          const u = users.find(x => x.username === username);
          if (u && u.id !== this.currentUser.id) {
            this.sendMockNotification(u.id, 'mention', logId);
          }
        }
      }
    }
  },

  async getComments(logId) {
    if (this.isConfigured()) {
      try {
        const { data, error } = await this.supabase
          .from('comments')
          .select('*, profiles(username, avatar_url)')
          .eq('log_id', logId)
          .order('created_at', { ascending: true });
        if (error) throw error;
        return data.map(d => ({
          id: d.id,
          user_id: d.user_id,
          author: d.profiles?.username || '匿名の料理人',
          avatar_url: d.profiles?.avatar_url || '',
          text: d.text,
          created_at: d.created_at
        }));
      } catch (err) {
        console.error(err);
        return [];
      }
    } else {
      const allComments = JSON.parse(localStorage.getItem('simulated_comments') || '[]');
      const filtered = allComments.filter(c => c.log_id === logId);
      const users = PRESET_MOCK_PROFILES.concat(JSON.parse(localStorage.getItem('simulated_users') || '[]'));
      if (this.currentUser) users.push(this.currentUser);
      
      return filtered.map(c => {
        const u = users.find(x => x.id === c.user_id) || { username: '自分', avatar_url: '' };
        return {
          id: c.id,
          user_id: c.user_id,
          author: u.username,
          avatar_url: u.avatar_url,
          text: c.text,
          created_at: c.created_at
        };
      }).sort((a,b) => new Date(a.created_at) - new Date(b.created_at));
    }
  },

  // 通知（Notifications）
  async sendNotification(userId, type, logId) {
    if (!this.currentUser) return;
    try {
      await this.supabase.from('notifications').insert({
        user_id: userId,
        notifier_id: this.currentUser.id,
        type,
        log_id: logId,
        is_read: false
      });
    } catch (e) {
      console.error("通知作成失敗:", e);
    }
  },

  sendMockNotification(userId, type, logId) {
    if (!this.currentUser) return;
    let notifs = JSON.parse(localStorage.getItem('simulated_notifications') || '[]');
    notifs.push({
      id: generateUUID(),
      user_id: userId,
      notifier_id: this.currentUser.id,
      type,
      log_id: logId,
      is_read: false,
      created_at: new Date().toISOString()
    });
    localStorage.setItem('simulated_notifications', JSON.stringify(notifs));
  },

  async getNotifications() {
    if (!this.currentUser) return [];
    if (this.isConfigured()) {
      try {
        const { data, error } = await this.supabase
          .from('notifications')
          .select('*, profiles!notifications_notifier_id_fkey(username, avatar_url), dinner_logs(name)')
          .eq('user_id', this.currentUser.id)
          .order('created_at', { ascending: false });
        if (error) throw error;
        
        return data.map(d => ({
          id: d.id,
          type: d.type,
          actor: d.profiles?.username || '誰か',
          avatar_url: d.profiles?.avatar_url || '',
          log_name: d.dinner_logs?.name || '料理',
          log_id: d.log_id,
          is_read: d.is_read,
          created_at: d.created_at
        }));
      } catch (err) {
        console.error(err);
        return [];
      }
    } else {
      const all = JSON.parse(localStorage.getItem('simulated_notifications') || '[]');
      const filtered = all.filter(n => n.user_id === this.currentUser.id);
      const users = PRESET_MOCK_PROFILES.concat(JSON.parse(localStorage.getItem('simulated_users') || '[]'));
      const allLogs = PRESET_MOCK_LOGS.concat(state.dinnerLogs);
      
      return filtered.map(n => {
        const u = users.find(x => x.id === n.notifier_id) || { username: '誰か', avatar_url: '' };
        const l = allLogs.find(x => x.id === n.log_id) || { name: '料理' };
        return {
          id: n.id,
          type: n.type,
          actor: u.username,
          avatar_url: u.avatar_url,
          log_name: l.name,
          log_id: n.log_id,
          is_read: n.is_read,
          created_at: n.created_at
        };
      }).sort((a,b) => new Date(b.created_at) - new Date(a.created_at));
    }
  },

  async markNotificationsRead() {
    if (!this.currentUser) return;
    if (this.isConfigured()) {
      await this.supabase.from('notifications').update({ is_read: true }).eq('user_id', this.currentUser.id);
    } else {
      let notifs = JSON.parse(localStorage.getItem('simulated_notifications') || '[]');
      notifs.forEach(n => {
        if (n.user_id === this.currentUser.id) n.is_read = true;
      });
      localStorage.setItem('simulated_notifications', JSON.stringify(notifs));
    }
    renderSyncIndicator();
  },

  // フォロー (Follow)
  async toggleFollow(targetUserId) {
    if (!this.currentUser) {
      alert("フォローするにはログインが必要です。");
      return;
    }
    
    const isFollowing = await this.isFollowing(targetUserId);
    
    if (this.isConfigured()) {
      try {
        if (isFollowing) {
          await this.supabase.from('follows').delete().eq('follower_id', this.currentUser.id).eq('following_id', targetUserId);
        } else {
          await this.supabase.from('follows').insert({
            follower_id: this.currentUser.id,
            following_id: targetUserId
          });
          // フォロー通知
          await this.sendNotification(targetUserId, 'follow', null);
        }
      } catch (err) {
        console.error(err);
      }
    } else {
      let follows = JSON.parse(localStorage.getItem('simulated_follows') || '[]');
      if (isFollowing) {
        follows = follows.filter(f => !(f.follower_id === this.currentUser.id && f.following_id === targetUserId));
      } else {
        follows.push({ follower_id: this.currentUser.id, following_id: targetUserId });
        this.sendMockNotification(targetUserId, 'follow', null);
      }
      localStorage.setItem('simulated_follows', JSON.stringify(follows));
    }
    renderAll();
  },

  async isFollowing(targetUserId) {
    if (!this.currentUser) return false;
    if (this.isConfigured()) {
      const { data } = await this.supabase
        .from('follows')
        .select('*')
        .eq('follower_id', this.currentUser.id)
        .eq('following_id', targetUserId);
      return data && data.length > 0;
    } else {
      const follows = JSON.parse(localStorage.getItem('simulated_follows') || '[]');
      return follows.some(f => f.follower_id === this.currentUser.id && f.following_id === targetUserId);
    }
  },

  async getFollowStats(userId) {
    if (this.isConfigured()) {
      const { count: following } = await this.supabase.from('follows').select('*', { count: 'exact', head: true }).eq('follower_id', userId);
      const { count: followers } = await this.supabase.from('follows').select('*', { count: 'exact', head: true }).eq('following_id', userId);
      return { following: following || 0, followers: followers || 0 };
    } else {
      const follows = JSON.parse(localStorage.getItem('simulated_follows') || '[]');
      const following = follows.filter(f => f.follower_id === userId).length;
      const followers = follows.filter(f => f.following_id === userId).length;
      return { following, followers };
    }
  },

  // 他ユーザーのプロフィール詳細をロード
  async getUserPublicProfile(userId) {
    if (this.isConfigured()) {
      const { data: profile } = await this.supabase.from('profiles').select('*').eq('id', userId).single();
      const { data: logs } = await this.supabase.from('dinner_logs').select('*').eq('user_id', userId).eq('is_public', true);
      const stats = await this.getFollowStats(userId);
      
      return {
        id: userId,
        username: profile?.username || 'ユーザー',
        bio: profile?.bio || 'よろしくお願いします！',
        avatar_url: profile?.avatar_url || '',
        shared_logs: logs || [],
        ...stats
      };
    } else {
      const users = PRESET_MOCK_PROFILES.concat(JSON.parse(localStorage.getItem('simulated_users') || '[]'));
      if (this.currentUser) users.push(this.currentUser);
      
      const prof = users.find(u => u.id === userId) || { id: userId, username: '料理人', bio: 'よろしくお願いします！', avatar_url: '' };
      const logs = PRESET_MOCK_LOGS.concat(state.dinnerLogs).filter(l => l.user_id === userId && l.is_public);
      const stats = await this.getFollowStats(userId);
      
      return {
        ...prof,
        shared_logs: logs,
        ...stats
      };
    }
  }
};

// クラウドエンジンの初期化起動
cloudDB.init();

const state = {
  ingredients: [],
  dinnerLogs: [],
  shoppingList: [], // 買い物メモ用の配列
  
  // データ保存用ヘルパー（LocalStorageキャッシュ）
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

// スマホの巨大画像をローカルストレージ限界(5MB)を超えないよう圧縮・リサイズする関数 (最大幅800px, JPEG品質0.7)
function compressAndResizeImage(file, callback) {
  const reader = new FileReader();
  reader.onload = (e) => {
    const img = new Image();
// 同期インジケータ（☁️）の更新
function renderSyncIndicator() {
  const indicator = document.getElementById('sync-indicator');
  const dot = indicator.querySelector('.sync-dot');
  const text = indicator.querySelector('.sync-text');
  const bellBadge = document.getElementById('notification-badge');
  
  if (!indicator) return;
  indicator.className = 'app-header-sync';
  
  if (cloudDB.syncStatus === 'synced') {
    indicator.classList.add('synced');
    text.textContent = '同期完了';
  } else if (cloudDB.syncStatus === 'syncing') {
    indicator.classList.add('syncing');
    text.textContent = '同期中';
  } else if (cloudDB.syncStatus === 'offline') {
    indicator.className = 'app-header-sync syncing'; // 警告色
    text.textContent = 'オフライン';
  } else {
    text.textContent = 'ローカル保存';
  }
  
  // 未読お知らせバッジの更新
  cloudDB.getNotifications().then(notifs => {
    const unreadCount = notifs.filter(n => !n.is_read).length;
    if (unreadCount > 0) {
      bellBadge.textContent = unreadCount;
      bellBadge.style.display = 'block';
    } else {
      bellBadge.style.display = 'none';
    }
  });
}

// @メンション検知リンクパーサー
function parseMentions(text) {
  if (!text) return '';
  return text.replace(/@(\w+)/g, '<a class="mention-link" data-username="$1">@$1</a>');
}

// A. タイムライン（👥）の描画
async function renderTimeline() {
  const container = document.getElementById('timeline-posts-container');
  const emptyState = document.getElementById('timeline-empty-state');
  
  if (!container) return;
  
  const posts = await cloudDB.getTimelinePosts();
  
  if (posts.length === 0) {
    if (emptyState) emptyState.style.display = 'block';
    container.innerHTML = '';
    return;
  }
  
  if (emptyState) emptyState.style.display = 'none';
  
  let html = '';
  for (let p of posts) {
    const likeCount = await cloudDB.getLikeCount(p.id);
    const hasLiked = await cloudDB.hasLiked(p.id);
    const likeClass = hasLiked ? 'timeline-action-btn liked' : 'timeline-action-btn';
    const comments = await cloudDB.getComments(p.id);
    
    const ratingPct = (parseFloat(p.rating || 5) / 5.0) * 100;
    const photoHtml = p.photo 
      ? `<img src="${p.photo}" class="timeline-post-photo" data-id="${p.id}" style="cursor:pointer;">`
      : '';
      
    const tagsHtml = (p.components || []).map(t => `
      <span class="timeline-post-tag">${t}</span>
    `).join('');
    
    const avatarSrc = p.avatar_url || 'https://cdn-icons-png.flaticon.com/512/5778/5778508.png';
    
    html += `
      <div class="timeline-post-card">
        <div class="timeline-post-user-row">
          <div class="timeline-post-avatar-wrapper" data-userid="${p.user_id}">
            <img src="${avatarSrc}" class="timeline-post-avatar">
            <div class="timeline-post-user-meta">
              <span class="timeline-post-author">${p.author}</span>
              <span class="timeline-post-date">${formatJapaneseDate(p.date)}</span>
            </div>
          </div>
          <div class="star-rating-display" style="font-size: 0.85rem;">
            <span class="stars-empty">★★★★★</span>
            <span class="stars-filled" style="width: ${ratingPct}%;">★★★★★</span>
          </div>
        </div>
        
        <h3 class="timeline-post-title" data-id="${p.id}" style="cursor:pointer; margin-top: 8px;">${p.name}</h3>
        ${photoHtml}
        
        <div style="font-size:0.8rem; color:var(--text-main); margin-top:4px; line-height:1.4;">
          ${parseMentions(renderMarkdown(p.memo))}
        </div>
        
        <div class="timeline-post-tags" style="margin-top: 8px;">
          ${tagsHtml}
        </div>
        
        <div class="timeline-post-actions">
          <button class="${likeClass}" data-action="like" data-id="${p.id}">
            <span>❤️</span>
            <span>いいね (${likeCount})</span>
          </button>
          <button class="timeline-action-btn" data-action="comment" data-id="${p.id}">
            <span>💬</span>
            <span>コメント (${comments.length})</span>
          </button>
        </div>
      </div>
    `;
  }
  
  container.innerHTML = html;
  
  // いいねボタンハンドラー
  container.querySelectorAll('[data-action="like"]').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const id = btn.getAttribute('data-id');
      await cloudDB.toggleLike(id);
      renderTimeline();
    });
  });
  
  // コメントボタンハンドラー
  container.querySelectorAll('[data-action="comment"]').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const id = btn.getAttribute('data-id');
      openCommentModal(id);
    });
  });
  
  // ユーザー詳細クリック
  container.querySelectorAll('.timeline-post-avatar-wrapper').forEach(wrapper => {
    wrapper.addEventListener('click', (e) => {
      const userId = wrapper.getAttribute('data-userid');
      openUserProfileModal(userId);
    });
  });
  
  // 詳細モーダル
  container.querySelectorAll('.timeline-post-title, .timeline-post-photo').forEach(elem => {
    elem.addEventListener('click', () => {
      const id = elem.getAttribute('data-id');
      cloudDB.getTimelinePosts().then(posts => {
        const p = posts.find(x => x.id === id);
        if (p) {
          openLogDetailModal({
            id: p.id,
            name: p.name,
            date: p.date,
            rating: p.rating,
            memo: p.memo,
            photo: p.photo,
            ingredientsUsed: p.ingredientsUsed
          });
        }
      });
    });
  });

  // メンションリンククリック
  container.querySelectorAll('.mention-link').forEach(link => {
    link.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      const username = link.getAttribute('data-username');
      const allUsers = PRESET_MOCK_PROFILES.concat(JSON.parse(localStorage.getItem('simulated_users') || '[]'));
      if (cloudDB.currentUser) allUsers.push(cloudDB.currentUser);
      
      const found = allUsers.find(u => u.username === username);
      if (found) {
        openUserProfileModal(found.id);
      } else {
        alert("該当するユーザーが見つかりません。");
      }
    });
  });
}

// B. 冷蔵庫管理の描画 (既存の renderFridge を上書き/そのまま維持)
// C. 夕飯の記録の描画 (既存の renderLogs を上書き/そのまま維持)

// D. 買い物メモ（🛒）の描画
function renderShoppingMemo() {
  const container = document.getElementById('memo-shopping-list');
  
  if (!container) return;
  
  if (state.shoppingList.length === 0) {
    container.innerHTML = `<li style="font-size:0.85rem; text-align:center; color:var(--text-sub); font-style:italic; padding:24px 0; width:100%;">買うものは登録されていません</li>`;
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
  
  // イベント紐付け
  container.querySelectorAll('.shopping-check').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const id = e.target.getAttribute('data-id');
      const item = state.shoppingList.find(i => i.id === id);
      if (item) {
        item.checked = !item.checked;
        cloudDB.saveShoppingList(state.shoppingList);
        renderShoppingMemo();
      }
    });
  });

  container.querySelectorAll('.shopping-item').forEach(itemRow => {
    itemRow.addEventListener('click', (e) => {
      if (e.target.closest('.shopping-check') || e.target.closest('.shopping-delete-btn')) return;
      const id = itemRow.getAttribute('data-id');
      container.querySelectorAll('.shopping-item').forEach(row => {
        if (row.getAttribute('data-id') !== id) row.classList.remove('show-delete');
      });
      itemRow.classList.toggle('show-delete');
    });
  });

  container.querySelectorAll('.shopping-delete-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const id = e.target.getAttribute('data-id');
      state.shoppingList = state.shoppingList.filter(item => item.id !== id);
      cloudDB.saveShoppingList(state.shoppingList);
      renderShoppingMemo();
    });
  });
}

// E. マイページ（👤）の描画
async function renderMyPage() {
  const loggedOutPanel = document.getElementById('mypage-logged-out');
  const loggedInPanel = document.getElementById('mypage-logged-in');
  const logoutBtn = document.getElementById('btn-logout');
  
  if (!loggedOutPanel || !loggedInPanel) return;

  if (!cloudDB.currentUser) {
    loggedOutPanel.style.display = 'block';
    loggedInPanel.style.display = 'none';
    logoutBtn.style.display = 'none';
    
    // Supabase URL・Keyの入力欄の復元
    document.getElementById('supabase-url').value = localStorage.getItem('supabase_url') || '';
    document.getElementById('supabase-key').value = localStorage.getItem('supabase_key') || '';
    return;
  }
  
  loggedOutPanel.style.display = 'none';
  loggedInPanel.style.display = 'block';
  logoutBtn.style.display = 'block';
  
  // プロフィールメタの反映
  document.getElementById('mypage-avatar').src = cloudDB.currentUser.avatar_url || 'https://cdn-icons-png.flaticon.com/512/5778/5778508.png';
  document.getElementById('mypage-username').textContent = cloudDB.currentUser.username;
  document.getElementById('mypage-bio').textContent = cloudDB.currentUser.bio || '自己紹介を書いてみましょう！';
  
  // フォローなどの統計取得
  const stats = await cloudDB.getFollowStats(cloudDB.currentUser.id);
  document.getElementById('mypage-following-count').textContent = stats.following;
  document.getElementById('mypage-followers-count').textContent = stats.followers;
  
  const myPublicLogs = state.dinnerLogs.filter(log => log.is_public);
  document.getElementById('mypage-shared-count').textContent = myPublicLogs.length;
  
  // --- AI Preference profilingの描画 ---
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
    const primaryElement = prefData[0];
    let profileDesc = "";
    if (primaryElement.name === "🍲 鍋・煮込み") {
      profileDesc = "鍋料理やカレー、肉じゃがなどの「煮込み」を好んで作っています。コトコト煮た優しく染み入る料理に高い評価をつけています。";
    } else if (primaryElement.name === "🥩 焼き物・炒め物") {
      profileDesc = "フライパンでサッと仕上げる「炒め物・グリル」を多く作っています。ジューシーなお肉など、手際よく仕上がるメインおかずに高評価をつけています。";
    } else if (primaryElement.name === "🥗 サラダ・和え物") {
      profileDesc = "お野菜をたっぷり使った「サラダ・和え物」を多く作っています。さっぱりとした、健康志向で爽やかなサイドメニューに高評価をつけています。";
    } else if (primaryElement.name === "🥣 汁物・スープ") {
      profileDesc = "温かい「汁物・スープ」を多く作っています。出汁やコンソメの香りが広がる安らぎを与えるお汁物に高評価をつけています。";
    } else if (primaryElement.name === "🍤 揚げ物") {
      profileDesc = "サクサクの唐揚げやフライなど、ごちそう感あふれる「揚げ物」を好んで作っています。旨味が広がる特別感のある一品に高い評価をつけています。";
    } else if (primaryElement.name === "🍜 麺類") {
      profileDesc = "パスタやうどん、ラーメンなどの「麺類」を好んで作っています。ソースが絡む手軽で満足度の高い一杯に高評価をつけています。";
    } else if (primaryElement.name === "🍛 丼物・ご飯物") {
      profileDesc = "ご飯に具材をのせる大満足 of 「丼物・ご飯物」を多く作っています。一皿で大満足のご飯メニューに高評価をつけています。";
    }
    
    const topElements = prefData.slice(0, 3);
    const gaugeRows = topElements.map(item => `
      <div class="profile-stat-row">
        <div class="profile-stat-name-row">
          <span>${item.name}</span>
          <span>${item.percentage}%</span>
        </div>
        <div class="profile-gauge-bar-bg">
          <div class="profile-gauge-bar-fill" style="width: ${item.percentage}%;"></div>
        </div>
      </div>
    `).join('');
    
    if (profileContainer) {
      profileContainer.innerHTML = `
        <div class="profile-header">
          <span class="profile-primary-element">${primaryElement.name}中心</span>
          <span class="profile-badge">AI自動解析の傾向</span>
        </div>
        <p class="profile-desc" style="font-size:0.75rem; color:var(--text-sub); margin-top:4px;">${profileDesc}</p>
        <div class="profile-stats-title" style="margin-top: 10px;">よく作る食事構成要素</div>
        <div class="profile-stats-list">
          ${gaugeRows}
        </div>
      `;
    }
  }

  // --- AI レシピおすすめ提案 ---
  const recCardContainer = document.getElementById('recipe-recommendation-card');
  const alerts = state.ingredients
    .map(ing => ({ ...ing, days: getDaysRemaining(ing.expiryDate), status: getExpiryStatus(getDaysRemaining(ing.expiryDate)) }))
    .filter(ing => ing.status === 'expired' || ing.status === 'critical')
    .sort((a, b) => a.days - b.days);
    
  let recTag = '本日のおすすめレシピ';
  let recDish = 'コク旨万能カレーライス';
  let recReason = '冷蔵庫にある余ったお野菜や調味料を加えて、栄養たっぷりのオリジナルカレーを作ってみませんか？カレーならどんな食材でも美味しくまとまります。';
  let recEmoji = '🍛';
  const primaryPrefName = (prefData && prefData.length > 0) ? prefData[0].name : "🍛 丼物・ご飯物";
  
  if (alerts.length > 0) {
    const target = alerts[0];
    recEmoji = INGREDIENT_EMOJI_MAP[target.category] || '🍳';
    if (target.category === '肉類') {
      recTag = `期限間近の「${target.name}」を消費`;
      if (primaryPrefName === "🍲 鍋・煮込み") {
        recDish = `お出汁香る ほっこり「${target.name}」の肉じゃが風煮込み`;
        recReason = `冷蔵庫で期限が迫る「${target.name}」を、じゃがいもやにんじんをお出汁でコトコト煮込み、甘辛い味わいがじんわり染みるほっこり煮物をおすすめします。`;
      } else {
        recDish = `ご飯が進む「${target.name}」のスタミナ甘辛炒め丼`;
        recReason = `冷蔵庫の「${target.name}」をキャベツやネギと一緒に強火で香ばしく炒め、ご飯の上にドカンとのせるスタミナ満点の一杯です。`;
      }
    } else if (target.category === '野菜・果物') {
      recTag = `新鮮な「${target.name}」を美味しく消費`;
      recDish = `シャキシャキ「${target.name}」の彩り特製和風サラダ`;
      recReason = `新鮮な「${target.name}」を主役に、キャベツやトマトと合わせてドレッシングで和える、食卓をみずみずしく彩るヘルシーなサラダです。`;
    }
  } else if (state.ingredients.length > 0) {
    const randomIng = state.ingredients[Math.floor(Math.random() * state.ingredients.length)];
    recTag = `${primaryPrefName}のおすすめメニュー`;
    recEmoji = primaryPrefName.substring(0, 2);
    recDish = `お出汁が染みる「${randomIng.name}」の特製ほっこり煮`;
    recReason = `冷蔵庫にある「${randomIng.name}」を使って、コトコト煮込んだ温かい煮物を作りましょう。中までじっくり味が染みて、明日も美味しく召し上がれます。`;
  }
  
  if (recCardContainer) {
    recCardContainer.innerHTML = `
      <div class="rec-header" style="display:flex; justify-content:space-between; align-items:center;">
        <div>
          <span class="rec-tag" style="font-size:0.7rem; font-weight:700; color:var(--primary); background-color:var(--primary-light); padding:2px 8px; border-radius:10px;">${recTag}</span>
          <div class="rec-dish" style="font-size:1.0rem; font-weight:700; color:var(--text-main); margin-top:4px;">${recDish}</div>
        </div>
        <span class="rec-emoji" style="font-size:2.0rem;">${recEmoji}</span>
      </div>
      <p class="rec-reason" style="font-size:0.75rem; color:var(--text-sub); margin-top:8px; line-height:1.4;">${recReason}</p>
      <button class="rec-btn" id="btn-rec-log-trigger" style="width:100%; border:none; padding:10px; border-radius:10px; background:var(--primary-gradient); color:white; font-weight:bold; margin-top:12px; cursor:pointer;">
        この料理を作って記録する
      </button>
    `;
    document.getElementById('btn-rec-log-trigger').addEventListener('click', () => {
      openLogModal(recDish);
    });
  }

  // --- お気に入りコレクション（Folders）の描画 ---
  const foldersGrid = document.getElementById('mypage-folders-grid');
  const folders = await cloudDB.getFolders();
  
  let foldersHtml = '';
  for (let f of folders) {
    let count = 0;
    if (cloudDB.isConfigured()) {
      const { count: c } = await cloudDB.supabase
        .from('favorites')
        .select('*', { count: 'exact', head: true })
        .eq('folder_id', f.id);
      count = c || 0;
    } else {
      const favs = JSON.parse(localStorage.getItem('simulated_favorites') || '[]');
      count = favs.filter(x => x.folder_id === f.id).length;
    }
    
    foldersHtml += `
      <div class="folder-binder-card" data-folderid="${f.id}" data-foldername="${f.name}">
        <div class="folder-cover-icon">📁</div>
        <div class="folder-meta-info" style="margin-top: 8px;">
          <span class="folder-title-name">${f.name}</span>
          <span class="folder-count-lbl" style="font-size: 0.72rem; color: var(--text-sub); display: block; margin-top: 2px;">${count}品のお気に入り</span>
        </div>
      </div>
    `;
  }
  foldersGrid.innerHTML = foldersHtml;
  
  // フォルダタップハンドラ
  foldersGrid.querySelectorAll('.folder-binder-card').forEach(card => {
    card.addEventListener('click', () => {
      const folderId = card.getAttribute('data-folderid');
      const folderName = card.getAttribute('data-foldername');
      openFolderDetailModal(folderId, folderName);
    });
  });

  // --- 共有中のレシピ一覧の描画 ---
  const mySharedContainer = document.getElementById('mypage-shared-list-container');
  if (myPublicLogs.length === 0) {
    mySharedContainer.innerHTML = `<p style="font-size:0.8rem; text-align:center; color:var(--text-sub); font-style:italic; padding:16px 0;">まだ共有レシピはありません</p>`;
  } else {
    mySharedContainer.innerHTML = myPublicLogs.map(log => {
      const percentage = (parseFloat(log.rating || 5) / 5.0) * 100;
      const photoHtml = log.photo 
        ? `<div class="log-photo" style="margin-top: 8px; width: 100%; height: 120px; overflow: hidden; border-radius: 8px;"><img src="${log.photo}" alt="${log.name}" style="width: 100%; height: 100%; object-fit: cover;"></div>`
        : '';
        
      return `
        <div class="log-card" data-id="${log.id}" style="background-color: var(--card-bg); border-radius: 16px; border: 1px solid var(--border-color); padding: 16px; margin-bottom: 12px; cursor: pointer;">
          <div class="log-card-header" style="display:flex; justify-content:space-between;">
            <div class="log-title" style="font-weight:700; font-size:1.0rem;">${log.name}</div>
            <span class="log-date" style="font-size:0.75rem; color:var(--text-sub);">${formatJapaneseDate(log.date)}</span>
          </div>
          <div class="log-rating-display" style="display:flex; align-items:center; gap:8px; margin-top:4px;">
            <div class="star-rating-display" style="font-size:0.8rem;">
              <span class="stars-empty">★★★★★</span>
              <span class="stars-filled" style="width: ${percentage}%;">★★★★★</span>
            </div>
          </div>
          ${photoHtml}
        </div>
      `;
    }).join('');
    
    mySharedContainer.querySelectorAll('.log-card').forEach(card => {
      card.addEventListener('click', () => {
        const id = card.getAttribute('data-id');
        const log = state.dinnerLogs.find(item => item.id === id);
        if (log) openLogDetailModal(log);
      });
    });
  }

  // Supabase URL・Keyの入力欄の復元
  document.getElementById('supabase-url').value = localStorage.getItem('supabase_url') || '';
  document.getElementById('supabase-key').value = localStorage.getItem('supabase_key') || '';
}

// F. コメント返信モーダルの制御
let activeCommentLogId = null;
async function openCommentModal(logId) {
  activeCommentLogId = logId;
  openModal('modal-comments');
  renderCommentsList();
}

async function renderCommentsList() {
  const container = document.getElementById('comments-list-container');
  if (!container || !activeCommentLogId) return;
  
  const comments = await cloudDB.getComments(activeCommentLogId);
  
  if (comments.length === 0) {
    container.innerHTML = `<p style="font-size:0.8rem; text-align:center; color:var(--text-sub); font-style:italic; padding:40px 0;">まだ返信コメントはありません</p>`;
    return;
  }
  
  container.innerHTML = comments.map(c => {
    const avatar = c.avatar_url || 'https://cdn-icons-png.flaticon.com/512/5778/5778508.png';
    return `
      <div class="comment-bubble" style="margin-bottom: 12px; display: flex; gap: 10px;">
        <img src="${avatar}" class="comment-bubble-avatar" data-userid="${c.user_id}" style="width: 32px; height: 32px; border-radius: 50%; object-fit: cover;">
        <div class="comment-bubble-content" style="flex: 1; background-color: #F3F4F6; border-radius: 12px; padding: 8px 12px;">
          <span class="comment-bubble-author" data-userid="${c.user_id}" style="font-weight: 700; font-size: 0.78rem; display: block;">${c.author}</span>
          <span style="font-size:0.8rem; display: block; margin-top: 2px;">${parseMentions(c.text)}</span>
          <span class="comment-bubble-time" style="font-size:0.65rem; color: var(--text-sub); display: block; margin-top: 4px;">${formatJapaneseDate(c.created_at)}</span>
        </div>
      </div>
    `;
  }).join('');
  
  // 返信スレッド内のアバター・著者名クリック
  container.querySelectorAll('.comment-bubble-avatar, .comment-bubble-author').forEach(elem => {
    elem.addEventListener('click', () => {
      const userId = elem.getAttribute('data-userid');
      closeModal('modal-comments');
      openUserProfileModal(userId);
    });
  });

  // メンションリンククリック
  container.querySelectorAll('.mention-link').forEach(link => {
    link.addEventListener('click', (e) => {
      e.preventDefault();
      const username = link.getAttribute('data-username');
      const allUsers = PRESET_MOCK_PROFILES.concat(JSON.parse(localStorage.getItem('simulated_users') || '[]'));
      if (cloudDB.currentUser) allUsers.push(cloudDB.currentUser);
      
      const found = allUsers.find(u => u.username === username);
      if (found) {
        closeModal('modal-comments');
        openUserProfileModal(found.id);
      } else {
        alert("該当するユーザーが見つかりません。");
      }
    });
  });
}

// G. 他ユーザー詳細プロフィールの制御
async function openUserProfileModal(userId) {
  if (cloudDB.currentUser && userId === cloudDB.currentUser.id) {
    document.querySelector('[data-tab="tab-mypage"]').click();
    return;
  }
  
  const modal = document.getElementById('modal-user-profile');
  const avatar = document.getElementById('user-profile-avatar');
  const name = document.getElementById('user-profile-username');
  const bio = document.getElementById('user-profile-bio');
  const following = document.getElementById('user-profile-following-count');
  const followers = document.getElementById('user-profile-followers-count');
  const shared = document.getElementById('user-profile-shared-count');
  const followBtn = document.getElementById('btn-follow-action');
  const sharedList = document.getElementById('user-profile-shared-list');
  
  if (!modal) return;
  const prof = await cloudDB.getUserPublicProfile(userId);
  
  avatar.src = prof.avatar_url || 'https://cdn-icons-png.flaticon.com/512/5778/5778508.png';
  name.textContent = prof.username;
  bio.textContent = prof.bio;
  following.textContent = prof.following;
  followers.textContent = prof.followers;
  shared.textContent = prof.shared_logs.length;
  
  // フォロー状態の更新
  const isFollowing = await cloudDB.isFollowing(userId);
  if (isFollowing) {
    followBtn.textContent = "フォロー解除する";
    followBtn.style.background = "#E5E7EB";
    followBtn.style.color = "var(--text-main)";
  } else {
    followBtn.textContent = "フォローする";
    followBtn.style.background = "var(--primary-gradient)";
    followBtn.style.color = "white";
  }
  
  // フォローボタンイベントの再構築
  followBtn.onclick = async () => {
    await cloudDB.toggleFollow(userId);
    openUserProfileModal(userId);
  };
  
  // 共有料理リストのレンダリング
  if (prof.shared_logs.length === 0) {
    sharedList.innerHTML = `<p style="font-size:0.8rem; text-align:center; color:var(--text-sub); font-style:italic; padding:16px 0;">共有レシピはありません</p>`;
  } else {
    sharedList.innerHTML = prof.shared_logs.map(log => {
      const pct = (parseFloat(log.rating || 5) / 5.0) * 100;
      const photo = log.photo 
        ? `<div class="log-photo" style="margin-top:8px; width: 100%; height: 120px; overflow: hidden; border-radius: 8px;"><img src="${log.photo}" alt="${log.name}" style="width: 100%; height: 100%; object-fit: cover;"></div>`
        : '';
        
      return `
        <div class="log-card" data-id="${log.id}" style="background-color: var(--card-bg); border-radius: 16px; border: 1px solid var(--border-color); padding: 16px; margin-bottom: 12px; cursor: pointer; text-align:left;">
          <div style="display:flex; justify-content:space-between;">
            <div style="font-weight:700; font-size:1.0rem;">${log.name}</div>
            <span style="font-size:0.75rem; color:var(--text-sub);">${formatJapaneseDate(log.date)}</span>
          </div>
          <div style="display:flex; align-items:center; gap:8px; margin-top:4px;">
            <div class="star-rating-display" style="font-size:0.8rem;">
              <span class="stars-empty">★★★★★</span>
              <span class="stars-filled" style="width: ${pct}%;">★★★★★</span>
            </div>
          </div>
          ${photo}
        </div>
      `;
    }).join('');
    
    sharedList.querySelectorAll('.log-card').forEach(card => {
      card.addEventListener('click', () => {
        const id = card.getAttribute('data-id');
        const log = prof.shared_logs.find(x => x.id === id);
        if (log) {
          closeModal('modal-user-profile');
          openLogDetailModal(log);
        }
      });
    });
  }
  
  openModal('modal-user-profile');
}

// H. お知らせ通知モーダル
async function openNotificationsModal() {
  openModal('modal-notifications');
  const empty = document.getElementById('notifications-empty');
  const container = document.getElementById('notifications-list-container');
  
  if (!container) return;
  const list = await cloudDB.getNotifications();
  
  if (list.length === 0) {
    if (empty) empty.style.display = 'block';
    container.innerHTML = '';
    return;
  }
  
  if (empty) empty.style.display = 'none';
  
  container.innerHTML = list.map(n => {
    let typeText = '';
    let actionIcon = '🔔';
    if (n.type === 'like') { typeText = `あなたの料理「<strong>${n.log_name}</strong>」にいいねしました。`; actionIcon = '❤️'; }
    else if (n.type === 'comment') { typeText = `あなたの料理「<strong>${n.log_name}</strong>」に返信コメントしました。`; actionIcon = '💬'; }
    else if (n.type === 'mention') { typeText = `コメントであなたを@メンションしました。`; actionIcon = '🏷️'; }
    else if (n.type === 'follow') { typeText = `あなたをフォローしました。`; actionIcon = '👤'; }
    
    const unreadClass = n.is_read ? 'notification-card' : 'notification-card unread';
    const avatar = n.avatar_url || 'https://cdn-icons-png.flaticon.com/512/5778/5778508.png';
    
    return `
      <li class="${unreadClass}" data-logid="${n.log_id || ''}">
        <img src="${avatar}" class="notification-avatar-img" style="width:40px; height:40px; border-radius:50%; object-fit:cover;">
        <div class="notification-desc-text" style="flex: 1; margin-left: 10px;">
          <span style="font-size:0.8rem; line-height:1.4; color:var(--text-main); display:block;"><strong>${n.actor}</strong> さんが ${typeText}</span>
          <span class="notification-time-ago" style="font-size:0.65rem; color:var(--text-sub); display:block; margin-top:2px;">${formatJapaneseDate(n.created_at)}</span>
        </div>
        <span class="notification-action-indicator" style="font-size:1.1rem; flex-shrink:0;">${actionIcon}</span>
      </li>
    `;
  }).join('');
  
  // タップで料理詳細に飛ぶ or 閉じる
  container.querySelectorAll('.notification-card').forEach(card => {
    card.addEventListener('click', () => {
      const logId = card.getAttribute('data-logid');
      closeModal('modal-notifications');
      if (logId) {
        const allLogs = PRESET_MOCK_LOGS.concat(state.dinnerLogs);
        const log = allLogs.find(x => x.id === logId);
        if (log) openLogDetailModal(log);
      }
    });
  });
  
  // 開いたらすべて既読にする
  await cloudDB.markNotificationsRead();
}

// I. フォルダ内お気に入り一覧の描画
async function openFolderDetailModal(folderId, folderName) {
  const modal = document.getElementById('modal-folder-detail');
  const title = document.getElementById('folder-detail-title');
  const empty = document.getElementById('folder-detail-empty');
  const container = document.getElementById('folder-detail-list-container');
  
  title.textContent = `コレクション: ${folderName}`;
  openModal('modal-folder-detail');
  
  let favs = [];
  if (cloudDB.isConfigured()) {
    const { data } = await cloudDB.supabase.from('favorites').select('log_id').eq('folder_id', folderId);
    favs = data || [];
  } else {
    const all = JSON.parse(localStorage.getItem('simulated_favorites') || '[]');
    favs = all.filter(x => x.folder_id === folderId);
  }
  
  const allLogs = PRESET_MOCK_LOGS.concat(state.dinnerLogs);
  const matchedLogs = allLogs.filter(log => favs.some(f => f.log_id === log.id));
  
  if (matchedLogs.length === 0) {
    if (empty) empty.style.display = 'block';
    container.innerHTML = '';
    return;
  }
  
  if (empty) empty.style.display = 'none';
  
  container.innerHTML = matchedLogs.map(log => {
    const percentage = (parseFloat(log.rating || 5) / 5.0) * 100;
    const photo = log.photo 
      ? `<div class="log-photo" style="margin-top:8px; width:100%; height:120px; overflow:hidden; border-radius:8px;"><img src="${log.photo}" alt="${log.name}" style="width:100%; height:100%; object-fit:cover;"></div>`
      : '';
      
    return `
      <div class="log-card" data-id="${log.id}" style="background-color: var(--card-bg); border-radius: 16px; border: 1px solid var(--border-color); padding: 16px; margin-bottom: 12px; cursor: pointer;">
        <div style="display:flex; justify-content:space-between;">
          <div style="font-weight:700; font-size:1.0rem;">${log.name}</div>
          <span style="font-size:0.75rem; color:var(--text-sub);">${formatJapaneseDate(log.date)}</span>
        </div>
        <div style="display:flex; align-items:center; gap:8px; margin-top:4px;">
          <div class="star-rating-display" style="font-size:0.8rem;">
            <span class="stars-empty">★★★★★</span>
            <span class="stars-filled" style="width: ${percentage}%;">★★★★★</span>
          </div>
        </div>
        ${photo}
      </div>
    `;
  }).join('');
  
  container.querySelectorAll('.log-card').forEach(card => {
    card.addEventListener('click', () => {
      const id = card.getAttribute('data-id');
      const log = matchedLogs.find(x => x.id === id);
      if (log) {
        closeModal('modal-folder-detail');
        openLogDetailModal(log);
      }
    });
  });
}

// 統括レンダラー
function renderAll() {
  renderSyncIndicator();
  renderTimeline();
  renderFridge();
  renderLogs();
  renderShoppingMemo();
  renderMyPage();
}

// 旧買い物メモ呼び出しダミー
function renderShoppingList() {
  renderShoppingMemo();
}ctiveCategories.filter(c => !predefinedCategories.includes(c)));
  
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

const btnOpenChangelog = document.getElementById('btn-open-changelog');
if (btnOpenChangelog) {
  btnOpenChangelog.addEventListener('click', () => {
    openModal('modal-app-changelog');
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
