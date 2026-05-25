import Foundation

struct DinnerLog: Identifiable, Codable, Equatable {
    var id = UUID()
    var name: String
    var date: Date = Date()
    var memo: String // Markdown形式で記述されたレシピやコツ
    var rating: Int // 1〜5の星評価
    var ingredientsUsed: [String] // 使用した食材の名前一覧
    var photoData: Data? // 完成した料理の画像
}
