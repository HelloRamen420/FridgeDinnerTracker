import SwiftUI

struct FridgeView: View {
    @ObservedObject var appState: AppState
    @State private var showAddSheet = false
    
    var body: some View {
        NavigationView {
            ZStack {
                Color(.systemGroupedBackground)
                    .ignoresSafeArea()
                
                if appState.ingredients.isEmpty {
                    emptyStateView
                } else {
                    List {
                        ForEach(IngredientCategory.allCases) { category in
                            let categoryIngredients = appState.ingredients.filter { $0.category == category }
                            
                            if !categoryIngredients.isEmpty {
                                Section(header: HStack {
                                    Text(category.icon)
                                    Text(category.rawValue)
                                        .font(.headline)
                                        .fontWeight(.bold)
                                }) {
                                    ForEach(categoryIngredients) { ingredient in
                                        ingredientRow(for: ingredient)
                                            .swipeActions(edge: .trailing, allowsFullSwipe: true) {
                                                Button(role: .destructive) {
                                                    withAnimation {
                                                        appState.deleteIngredient(ingredient)
                                                    }
                                                } label: {
                                                    Label("削除", systemImage: "trash")
                                                }
                                            }
                                    }
                                }
                            }
                        }
                    }
                    .listStyle(InsetGroupedListStyle())
                }
            }
            .navigationTitle("冷蔵庫の中身")
            .toolbar {
                ToolbarItem(placement: .navigationBarTrailing) {
                    Button(action: {
                        showAddSheet = true
                    }) {
                        Image(systemName: "plus.circle.fill")
                            .font(.title2)
                    }
                }
            }
            .sheet(isPresented: $showAddSheet) {
                AddIngredientView(appState: appState)
            }
        }
    }
    
    // MARK: - 行レイアウト
    
    private func ingredientRow(for ingredient: Ingredient) -> some View {
        HStack(spacing: 12) {
            // 左側: 写真サムネイルまたはアイコン
            Group {
                if let photoData = ingredient.photoData, let uiImage = UIImage(data: photoData) {
                    Image(uiImage: uiImage)
                        .resizable()
                        .scaledToFill()
                } else {
                    ZStack {
                        Color(.systemGray6)
                        Text(ingredient.category.icon)
                            .font(.system(size: 24))
                    }
                }
            }
            .frame(width: 50, height: 50)
            .cornerRadius(10)
            .clipped()
            .overlay(
                RoundedRectangle(cornerRadius: 10)
                    .stroke(borderSignalColor(for: ingredient), lineWidth: 2)
            )
            
            // 中央: 名前と消費期限
            VStack(alignment: .leading, spacing: 4) {
                Text(ingredient.name)
                    .font(.body)
                    .fontWeight(.semibold)
                    .lineLimit(1)
                
                // 期限表示ラベル
                HStack(spacing: 4) {
                    Image(systemName: "clock")
                        .font(.caption2)
                    Text(expiryLabelText(for: ingredient))
                        .font(.caption)
                }
                .foregroundColor(expiryLabelColor(for: ingredient))
                .padding(.horizontal, 6)
                .padding(.vertical, 2)
                .background(expiryLabelColor(for: ingredient).opacity(0.12))
                .cornerRadius(6)
            }
            
            Spacer()
            
            // 右側: 数量変更コントローラー (＋/ー クイックボタン)
            HStack(spacing: 12) {
                Button(action: {
                    decrementQuantity(of: ingredient)
                }) {
                    Image(systemName: "minus.circle.fill")
                        .font(.title3)
                        .foregroundColor(.gray)
                }
                .buttonStyle(PlainButtonStyle())
                
                Text(String(format: "%.1f %@", ingredient.quantity, ingredient.unit))
                    .font(.subheadline)
                    .fontWeight(.bold)
                    .frame(minWidth: 45, alignment: .center)
                
                Button(action: {
                    incrementQuantity(of: ingredient)
                }) {
                    Image(systemName: "plus.circle.fill")
                        .font(.title3)
                        .foregroundColor(.accentColor)
                }
                .buttonStyle(PlainButtonStyle())
            }
        }
        .padding(.vertical, 2)
    }
    
    // MARK: - 空白状態表示
    
    private var emptyStateView: some View {
        VStack(spacing: 18) {
            Image(systemName: "fork.knife.circle.fill")
                .font(.system(size: 80))
                .foregroundColor(.gray.opacity(0.3))
            
            Text("冷蔵庫は空っぽです")
                .font(.title3)
                .fontWeight(.bold)
                .foregroundColor(.secondary)
            
            Text("右上の「＋」ボタンから食材を追加して、\nスマートな期限管理を始めましょう！")
                .font(.subheadline)
                .foregroundColor(.secondary.opacity(0.8))
                .multilineTextAlignment(.center)
                .lineSpacing(4)
        }
        .padding()
    }
    
    // MARK: - ヘルパー関数 (ロジック)
    
    private func incrementQuantity(of ingredient: Ingredient) {
        var updated = ingredient
        updated.quantity += 1.0
        withAnimation {
            appState.updateIngredient(updated)
        }
    }
    
    private func decrementQuantity(of ingredient: Ingredient) {
        var updated = ingredient
        updated.quantity -= 1.0
        
        withAnimation {
            if updated.quantity <= 0 {
                // 0以下になったら自動削除
                appState.deleteIngredient(ingredient)
            } else {
                appState.updateIngredient(updated)
            }
        }
    }
    
    // 枠線の色シグナル
    private func borderSignalColor(for ingredient: Ingredient) -> Color {
        switch ingredient.expiryStatus {
        case .expired:
            return .red
        case .critical:
            return .orange
        case .safe:
            return .green.opacity(0.3)
        }
    }
    
    // 期限表示テキスト
    private func expiryLabelText(for ingredient: Ingredient) -> String {
        let days = ingredient.daysRemaining
        if days < 0 {
            return "期限切れ！ (\(-days)日超過)"
        } else if days == 0 {
            return "今日まで！"
        } else if days == 1 {
            return "明日まで！"
        } else {
            return "あと\(days)日"
        }
    }
    
    // 期限警告ラベルの文字色
    private func expiryLabelColor(for ingredient: Ingredient) -> Color {
        switch ingredient.expiryStatus {
        case .expired:
            return .red
        case .critical:
            return .orange
        case .safe:
            return .secondary
        }
    }
}

struct FridgeView_Previews: PreviewProvider {
    static var previews: some View {
        FridgeView(appState: AppState())
    }
}
