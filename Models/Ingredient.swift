import Foundation

enum IngredientCategory: String, Codable, CaseIterable, Identifiable {
    case meat = "肉類"
    case fish = "魚介類"
    case vegetable = "野菜・果物"
    case dairy = "乳製品・卵"
    case condiment = "調味料"
    case other = "その他"
    
    var id: String { self.rawValue }
    
    var icon: String {
        switch self {
        case .meat: return "🥩"
        case .fish: return "🐟"
        case .vegetable: return "🥬"
        case .dairy: return "🥛"
        case .condiment: return "🧂"
        case .other: return "📦"
        }
    }
}

enum ExpiryStatus {
    case expired     // 期限切れ
    case critical    // 2日以内（期限間近）
    case safe        // 3日以上
}

struct Ingredient: Identifiable, Codable, Equatable {
    var id = UUID()
    var name: String
    var category: IngredientCategory
    var quantity: Double
    var unit: String
    var expirationDate: Date
    var purchaseDate: Date = Date()
    var photoData: Data? // カメラ・ライブラリから取得した食材画像
    
    // 消費期限までの残り日数を計算
    var daysRemaining: Int {
        let calendar = Calendar.current
        let startOfToday = calendar.startOfDay(for: Date())
        let startOfExpiration = calendar.startOfDay(for: expirationDate)
        
        let components = calendar.dateComponents([.day], from: startOfToday, to: startOfExpiration)
        return components.day ?? 0
    }
    
    // 期限ステータスの判定
    var expiryStatus: ExpiryStatus {
        let days = daysRemaining
        if days < 0 {
            return .expired
        } else if days <= 2 {
            return .critical
        } else {
            return .safe
        }
    }
}
