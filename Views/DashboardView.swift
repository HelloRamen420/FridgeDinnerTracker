import SwiftUI

struct DashboardView: View {
    @ObservedObject var appState: AppState
    
    // 消費期限が近い、または切れている食材
    private var alertIngredients: [Ingredient] {
        appState.ingredients.filter { $0.expiryStatus == .expired || $0.expiryStatus == .critical }
            .sorted(by: { $0.daysRemaining < $1.daysRemaining })
    }
    
    // 今週（直近7日間）の晩ごはん記録数
    private var dinnerLogsThisWeekCount: Int {
        let calendar = Calendar.current
        let sevenDaysAgo = calendar.date(byAdding: .day, value: -7, to: Date())!
        return appState.dinnerLogs.filter { $0.date >= sevenDaysAgo }.count
    }
    
    var body: some View {
        NavigationView {
            ScrollView {
                VStack(spacing: 20) {
                    // 統計サマリーカード
                    statsSummarySection
                    
                    // 消費期限アラート
                    expirationAlertSection
                    
                    // 今日の献立アイデア提案 (スマートレコメンド)
                    recommendationCard
                    
                    Spacer(minLength: 20)
                }
                .padding()
            }
            .background(Color(.systemGroupedBackground))
            .navigationTitle("ダッシュボード")
        }
    }
    
    // MARK: - 統計サマリーセクション
    
    private var statsSummarySection: some View {
        HStack(spacing: 12) {
            // 冷蔵庫のストック数
            VStack(spacing: 8) {
                Image(systemName: "refrigerator")
                    .font(.system(size: 28))
                    .foregroundColor(.teal)
                
                Text("冷蔵庫の食材数")
                    .font(.caption)
                    .foregroundColor(.secondary)
                
                Text("\(appState.ingredients.count) 品")
                    .font(.title2)
                    .fontWeight(.bold)
                    .foregroundColor(.primary)
            }
            .frame(maxWidth: .infinity)
            .padding(.vertical, 16)
            .background(Color(.white))
            .cornerRadius(16)
            .shadow(color: Color.black.opacity(0.02), radius: 6, x: 0, y: 3)
            
            // 今週の料理記録数
            VStack(spacing: 8) {
                Image(systemName: "sparkles")
                    .font(.system(size: 28))
                    .foregroundColor(.orange)
                
                Text("今週の晩ごはん")
                    .font(.caption)
                    .foregroundColor(.secondary)
                
                Text("\(dinnerLogsThisWeekCount) 回")
                    .font(.title2)
                    .fontWeight(.bold)
                    .foregroundColor(.primary)
            }
            .frame(maxWidth: .infinity)
            .padding(.vertical, 16)
            .background(Color(.white))
            .cornerRadius(16)
            .shadow(color: Color.black.opacity(0.02), radius: 6, x: 0, y: 3)
        }
    }
    
    // MARK: - 消費期限アラートセクション
    
    private var expirationAlertSection: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack {
                Image(systemName: "exclamationmark.triangle.fill")
                    .foregroundColor(.orange)
                Text("消費期限アラート")
                    .font(.headline)
                    .fontWeight(.bold)
                
                Spacer()
                
                if !alertIngredients.isEmpty {
                    Text("\(alertIngredients.count)件")
                        .font(.caption)
                        .fontWeight(.bold)
                        .foregroundColor(.white)
                        .padding(.horizontal, 8)
                        .padding(.vertical, 3)
                        .background(Color.orange)
                        .cornerRadius(10)
                }
            }
            .padding(.horizontal, 4)
            
            if alertIngredients.isEmpty {
                // 安全ステート
                HStack(spacing: 12) {
                    Image(systemName: "checkmark.seal.fill")
                        .font(.title)
                        .foregroundColor(.green)
                    
                    VStack(alignment: .leading, spacing: 4) {
                        Text("すべての食材が安全です！")
                            .fontWeight(.bold)
                            .font(.subheadline)
                        Text("期限が近い食材はありません。バッチリです！")
                            .font(.caption)
                            .foregroundColor(.secondary)
                    }
                    Spacer()
                }
                .padding()
                .background(Color(.white))
                .cornerRadius(16)
                .shadow(color: Color.black.opacity(0.02), radius: 6, x: 0, y: 3)
            } else {
                // アラート一覧
                VStack(spacing: 10) {
                    ForEach(alertIngredients.prefix(3)) { ingredient in
                        HStack(spacing: 12) {
                            Text(ingredient.category.icon)
                                .font(.title3)
                            
                            VStack(alignment: .leading, spacing: 4) {
                                Text(ingredient.name)
                                    .font(.subheadline)
                                    .fontWeight(.bold)
                                
                                Text(expiryWarningText(for: ingredient))
                                    .font(.caption2)
                                    .foregroundColor(ingredient.expiryStatus == .expired ? .red : .orange)
                            }
                            
                            Spacer()
                            
                            Text("\(String(format: "%.1f", ingredient.quantity))\(ingredient.unit)")
                                .font(.caption)
                                .foregroundColor(.secondary)
                                .fontWeight(.medium)
                        }
                        .padding()
                        .background(Color(.white))
                        .cornerRadius(12)
                        .overlay(
                            RoundedRectangle(cornerRadius: 12)
                                .stroke(ingredient.expiryStatus == .expired ? Color.red.opacity(0.4) : Color.orange.opacity(0.4), lineWidth: 1.5)
                        )
                    }
                    
                    if alertIngredients.count > 3 {
                        Text("他 \(alertIngredients.count - 3) 件の食材が期限間近です")
                            .font(.caption)
                            .foregroundColor(.secondary)
                            .padding(.top, 4)
                    }
                }
            }
        }
    }
    
    // MARK: - 今日の献立アイデア提案 (スマートレコメンドカード)
    
    private var recommendationCard: some View {
        VStack(alignment: .leading, spacing: 14) {
            HStack {
                Image(systemName: "lightbulb.fill")
                    .foregroundColor(.yellow)
                Text("今日の献立アイデア")
                    .font(.headline)
                    .fontWeight(.bold)
                Spacer()
            }
            .padding(.horizontal, 4)
            
            let suggestion = generateRecipeSuggestion()
            
            VStack(alignment: .leading, spacing: 12) {
                HStack {
                    VStack(alignment: .leading, spacing: 4) {
                        Text(suggestion.tag)
                            .font(.caption2)
                            .fontWeight(.bold)
                            .foregroundColor(.white)
                            .padding(.horizontal, 8)
                            .padding(.vertical, 4)
                            .background(Color.white.opacity(0.25))
                            .cornerRadius(8)
                        
                        Text(suggestion.dishName)
                            .font(.title3)
                            .fontWeight(.bold)
                            .foregroundColor(.white)
                    }
                    
                    Spacer()
                    
                    Text(suggestion.emoji)
                        .font(.system(size: 48))
                }
                
                Text(suggestion.reason)
                    .font(.footnote)
                    .foregroundColor(.white.opacity(0.9))
                    .lineSpacing(4)
                
                Divider()
                    .background(Color.white.opacity(0.4))
                
                HStack {
                    Image(systemName: "plus.circle.fill")
                        .foregroundColor(.white)
                    Text("この料理を作って記録する")
                        .font(.subheadline)
                        .fontWeight(.bold)
                        .foregroundColor(.white)
                }
                .frame(maxWidth: .infinity, alignment: .center)
                .padding(.vertical, 8)
                .background(Color.white.opacity(0.2))
                .cornerRadius(10)
            }
            .padding(18)
            .background(
                LinearGradient(
                    gradient: Gradient(colors: [Color.orange.opacity(0.85), Color.pink.opacity(0.8)]),
                    startPoint: .topLeading,
                    endPoint: .bottomTrailing
                )
            )
            .cornerRadius(20)
            .shadow(color: Color.orange.opacity(0.2), radius: 10, x: 0, y: 6)
        }
    }
    
    // MARK: - レコメンドロジック
    
    struct RecipeSuggestion {
        let tag: String
        let dishName: String
        let reason: String
        let emoji: String
    }
    
    private func generateRecipeSuggestion() -> RecipeSuggestion {
        // 1. 期限切れ、または期限間近の食材があるか探す
        if let target = alertIngredients.first {
            switch target.category {
            case .meat:
                return RecipeSuggestion(
                    tag: "期限間近のお肉を消費！",
                    dishName: "ご飯が進む！特製スタミナ焼肉丼",
                    reason: "冷蔵庫の「\(target.name)」が使い切れます！玉ねぎやキャベツなどお好みの野菜と一緒に甘辛く炒めて、ボリューム満点の一品にしましょう。",
                    emoji: "🥩"
                )
            case .vegetable:
                return RecipeSuggestion(
                    tag: "お野菜すっきりメニュー！",
                    dishName: "シャキシャキ野菜とふんわり卵の中華炒め",
                    reason: "期限が迫っている「\(target.name)」を丸ごと消費！ごま油と鶏ガラスープの素でさっと炒めるだけで、栄養満点のおかずが完成します。",
                    emoji: "🥬"
                )
            case .fish:
                return RecipeSuggestion(
                    tag: "新鮮な魚介のごちそう！",
                    dishName: "香ばしい！絶品白身魚のムニエル",
                    reason: "「\(target.name)」の旨味を最大限に引き出すバターソテー。レモンを添えてさっぱりいただくのがおすすめです。",
                    emoji: "🐟"
                )
            case .dairy:
                return RecipeSuggestion(
                    tag: "乳製品を美味しく消費！",
                    dishName: "あったか濃厚クリーミークラムチャウダー",
                    reason: "「\(target.name)」を使った心温まるスープ。余っているお野菜を細かく刻んで入れれば、栄養たっぷりの朝ごはんやおやつにもなります。",
                    emoji: "🥛"
                )
            default:
                return RecipeSuggestion(
                    tag: "冷蔵庫のお助けメニュー！",
                    dishName: "パラパラ！特製パラパラ黄金炒飯",
                    reason: "「\(target.name)」をアクセントに！冷蔵庫の余り野菜やハムなどを細かく刻んで強火で炒め、スッキリ美味しくまとめましょう。",
                    emoji: "🍳"
                )
            }
        }
        
        // 2. 食材は入っているが期限間近がない場合
        if !appState.ingredients.isEmpty {
            let randomIngredient = appState.ingredients.randomElement()!
            return RecipeSuggestion(
                tag: "本日のおすすめレシピ",
                dishName: "コク旨！万能カレーライス",
                reason: "冷蔵庫にある「\(randomIngredient.name)」を隠し味や具材に加えて、ごちそうカレーを作ってみませんか？カレーならどんな具材でも美味しく包み込んでくれます！",
                emoji: "🍛"
            )
        }
        
        // 3. 冷蔵庫が完全に空っぽの場合
        return RecipeSuggestion(
            tag: "今日からスタート！",
            dishName: "ほっこり美味しい！彩り肉じゃが",
            reason: "まずはスーパーに行って、お肉、じゃがいも、玉ねぎ、人参を買ってきましょう！日本の食卓の定番メニューで、美味しく冷蔵庫管理をスタートしましょう。",
            emoji: "🍲"
        )
    }
    
    // MARK: - ヘルパー関数
    
    private func expiryWarningText(for ingredient: Ingredient) -> String {
        let days = ingredient.daysRemaining
        if days < 0 {
            return "消費期限が \(-days) 日過ぎています！早めに処分してください。"
        } else if days == 0 {
            return "今日が消費期限です！今すぐ使い切りましょう。"
        } else {
            return "期限まであと \(days) 日です。お早めに！"
        }
    }
}

struct DashboardView_Previews: PreviewProvider {
    static var previews: some View {
        DashboardView(appState: AppState())
    }
}
