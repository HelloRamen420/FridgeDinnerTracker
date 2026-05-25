import Foundation
import Combine

class AppState: ObservableObject {
    @Published var ingredients: [Ingredient] = [] {
        didSet {
            saveIngredients()
        }
    }
    
    @Published var dinnerLogs: [DinnerLog] = [] {
        didSet {
            saveDinnerLogs()
        }
    }
    
    private let ingredientsFileName = "ingredients.json"
    private let dinnerLogsFileName = "dinner_logs.json"
    
    init() {
        loadIngredients()
        loadDinnerLogs()
        
        // 初回起動時に美しいサンプルデータを作成（デモ用）
        if ingredients.isEmpty && dinnerLogs.isEmpty {
            createSampleData()
        }
    }
    
    // MARK: - ファイル保存とロード
    
    private func getDocumentsDirectory() -> URL {
        FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0]
    }
    
    private func loadIngredients() {
        let url = getDocumentsDirectory().appendingPathComponent(ingredientsFileName)
        guard FileManager.default.fileExists(atPath: url.path) else { return }
        
        do {
            let data = try Data(contentsOf: url)
            let decoder = JSONDecoder()
            self.ingredients = try decoder.decode([Ingredient].self, from: data)
        } catch {
            print("食材データの読み込みエラー: \(error)")
        }
    }
    
    private func saveIngredients() {
        let url = getDocumentsDirectory().appendingPathComponent(ingredientsFileName)
        do {
            let encoder = JSONEncoder()
            let data = try encoder.encode(ingredients)
            try data.write(to: url, options: [.atomic, .completeFileProtection])
        } catch {
            print("食材データの保存エラー: \(error)")
        }
    }
    
    private func loadDinnerLogs() {
        let url = getDocumentsDirectory().appendingPathComponent(dinnerLogsFileName)
        guard FileManager.default.fileExists(atPath: url.path) else { return }
        
        do {
            let data = try Data(contentsOf: url)
            let decoder = JSONDecoder()
            self.dinnerLogs = try decoder.decode([DinnerLog].self, from: data)
        } catch {
            print("晩ごはん履歴の読み込みエラー: \(error)")
        }
    }
    
    private func saveDinnerLogs() {
        let url = getDocumentsDirectory().appendingPathComponent(dinnerLogsFileName)
        do {
            let encoder = JSONEncoder()
            let data = try encoder.encode(dinnerLogs)
            try data.write(to: url, options: [.atomic, .completeFileProtection])
        } catch {
            print("晩ごはん履歴の保存エラー: \(error)")
        }
    }
    
    // MARK: - 食材操作
    
    func addIngredient(_ ingredient: Ingredient) {
        ingredients.append(ingredient)
    }
    
    func updateIngredient(_ ingredient: Ingredient) {
        if let index = ingredients.firstIndex(where: { $0.id == ingredient.id }) {
            ingredients[index] = ingredient
        }
    }
    
    func deleteIngredient(at offsets: IndexSet) {
        ingredients.remove(atOffsets: offsets)
    }
    
    func deleteIngredient(_ ingredient: Ingredient) {
        ingredients.removeAll(where: { $0.id == ingredient.id })
    }
    
    // MARK: - 晩ごはん記録 ＆ スマート自動減算連携
    
    /// 晩ごはんを記録し、選択された食材を冷蔵庫から減算・消費します。
    /// - Parameters:
    ///   - log: 晩ごはん記録
    ///   - deductions: 食材IDと減算する数量のマップ（使い切る場合は全量を指定）
    func addDinnerLog(_ log: DinnerLog, deductions: [UUID: Double]) {
        dinnerLogs.insert(log, at: 0) // 最新が一番上に来るように挿入
        
        for (id, deductQty) in deductions {
            if let index = ingredients.firstIndex(where: { $0.id == id }) {
                let current = ingredients[index].quantity
                let newQty = current - deductQty
                
                if newQty <= 0 {
                    // 数量が0以下になったら、冷蔵庫から完全に使い切ったとして削除
                    ingredients.remove(at: index)
                } else {
                    // 一部使った場合は数量を更新
                    ingredients[index].quantity = newQty
                }
            }
        }
    }
    
    func deleteDinnerLog(at offsets: IndexSet) {
        dinnerLogs.remove(atOffsets: offsets)
    }
    
    // MARK: - デモ用の初期サンプルデータ生成
    
    private func createSampleData() {
        let calendar = Calendar.current
        let today = Date()
        
        // 冷蔵庫のサンプル食材
        let sampleIngredients = [
            Ingredient(
                name: "国産和牛バラ肉",
                category: .meat,
                quantity: 300,
                unit: "g",
                expirationDate: calendar.date(byAdding: .day, value: 1, to: today)! // 明日切れる！
            ),
            Ingredient(
                name: "シャキシャキほうれん草",
                category: .vegetable,
                quantity: 1,
                unit: "束",
                expirationDate: calendar.date(byAdding: .day, value: 2, to: today)! // 明後日切れる！
            ),
            Ingredient(
                name: "おいしい低脂肪牛乳",
                category: .dairy,
                quantity: 1,
                unit: "本",
                expirationDate: calendar.date(byAdding: .day, value: 5, to: today)! // 安全
            ),
            Ingredient(
                name: "塩こうじ調味料",
                category: .condiment,
                quantity: 0.8,
                unit: "瓶",
                expirationDate: calendar.date(byAdding: .day, value: 30, to: today)! // 安全
            )
        ]
        
        self.ingredients = sampleIngredients
        
        // 晩ごはんのサンプル記録
        let sampleLog = DinnerLog(
            name: "とろける特製牛丼",
            date: calendar.date(byAdding: .day, value: -1, to: today)!,
            memo: """
            # とろける特製牛丼 🥩
            
            冷蔵庫の期限が近い**和牛バラ肉**を消費するために作りました！
            少し長めに煮込んだので、お肉が口の中でとろけるほど柔らかく仕上がりました。
            
            ### 📝 レシピ・作り方のコツ
            - **玉ねぎ**は先にすき焼きのタレでしんなりするまで煮るのがポイント。
            - 牛肉は**弱火でさっと煮る**ことで硬くなるのを防ぎます。
            - 仕上げに少し七味を振ると味が締まって美味しい！
            
            ### 🥛 一緒に食べたもの
            - ほうれん草のおひたし
            - お味噌汁
            """,
            rating: 5,
            ingredientsUsed: ["国産和牛バラ肉", "たまねぎ"],
            photoData: nil
        )
        
        self.dinnerLogs = [sampleLog]
    }
}
