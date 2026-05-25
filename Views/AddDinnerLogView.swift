import SwiftUI

struct AddDinnerLogView: View {
    @ObservedObject var appState: AppState
    @Environment(\.dismiss) var dismiss
    
    // 基本ステート
    @State private var name = ""
    @State private var date = Date()
    @State private var rating = 5
    @State private var memo = ""
    @State private var memoMode = 0 // 0: 編集, 1: プレビュー
    
    // 写真撮影・選択用ステート
    @State private var selectedUiImage: UIImage?
    @State private var showImagePicker = false
    @State private var imagePickerSourceType: UIImagePickerController.SourceType = .photoLibrary
    @State private var showActionSheet = false
    
    // 食材連携ステート
    @State private var selectedIngredientIds = Set<UUID>()
    @State private var deductionQuantities = [UUID: Double]() // 食材ID -> 減算数量
    
    var body: some View {
        NavigationView {
            Form {
                // 基本情報セクション
                Section(header: Text("今日の料理").foregroundColor(.secondary)) {
                    TextField("料理名 (例: 特製チキンカレー)", text: $name)
                        .autocorrectionDisabled()
                    
                    DatePicker("作成日", selection: $date, displayedComponents: .date)
                        .environment(\.locale, Locale(identifier: "ja_JP"))
                    
                    HStack {
                        Text("おいしさ評価")
                        Spacer()
                        StarRatingView(rating: $rating, isInteractive: true)
                    }
                    .padding(.vertical, 4)
                }
                
                // 料理の写真セクション
                Section(header: Text("料理の写真").foregroundColor(.secondary)) {
                    VStack(alignment: .center, spacing: 12) {
                        if let uiImage = selectedUiImage {
                            Image(uiImage: uiImage)
                                .resizable()
                                .scaledToFill()
                                .frame(height: 200)
                                .cornerRadius(12)
                                .clipped()
                                .overlay(
                                    Button(action: {
                                        selectedUiImage = nil
                                    }) {
                                        Image(systemName: "xmark.circle.fill")
                                            .foregroundColor(.white)
                                            .background(Circle().fill(Color.black.opacity(0.6)))
                                            .font(.title)
                                    }
                                    .padding(8),
                                    alignment: .topTrailing
                                )
                        } else {
                            Button(action: {
                                showActionSheet = true
                            }) {
                                VStack(spacing: 8) {
                                    Image(systemName: "camera.fill")
                                        .font(.system(size: 32))
                                    Text("料理の写真を撮影・追加する")
                                        .font(.subheadline)
                                }
                                .foregroundColor(.accentColor)
                                .frame(maxWidth: .infinity)
                                .frame(height: 120)
                                .background(
                                    RoundedRectangle(cornerRadius: 12)
                                        .stroke(style: StrokeStyle(lineWidth: 1.5, dash: [6]))
                                        .foregroundColor(Color.accentColor.opacity(0.6))
                                )
                            }
                            .buttonStyle(PlainButtonStyle())
                        }
                    }
                    .padding(.vertical, 8)
                }
                
                // 冷蔵庫の消費連携セクション
                if !appState.ingredients.isEmpty {
                    Section(header: Text("使った冷蔵庫の食材（自動で減算されます）").foregroundColor(.secondary)) {
                        ForEach(appState.ingredients) { ingredient in
                            HStack {
                                Button(action: {
                                    if selectedIngredientIds.contains(ingredient.id) {
                                        selectedIngredientIds.remove(ingredient.id)
                                    } else {
                                        selectedIngredientIds.insert(ingredient.id)
                                        // デフォルトはすべて使い切る（全量）
                                        deductionQuantities[ingredient.id] = ingredient.quantity
                                    }
                                }) {
                                    Image(systemName: selectedIngredientIds.contains(ingredient.id) ? "checkmark.circle.fill" : "circle")
                                        .foregroundColor(selectedIngredientIds.contains(ingredient.id) ? .green : .gray)
                                        .font(.title3)
                                }
                                .buttonStyle(PlainButtonStyle())
                                
                                Text("\(ingredient.category.icon) \(ingredient.name)")
                                    .font(.body)
                                
                                Spacer()
                                
                                if selectedIngredientIds.contains(ingredient.id) {
                                    VStack(alignment: .trailing, spacing: 4) {
                                        Picker("減算量", selection: Binding(
                                            get: {
                                                let isFull = abs((deductionQuantities[ingredient.id] ?? 0) - ingredient.quantity) < 0.001
                                                return isFull ? "full" : "partial"
                                            },
                                            set: { newValue in
                                                if newValue == "full" {
                                                    deductionQuantities[ingredient.id] = ingredient.quantity
                                                } else {
                                                    // 半分、もしくは1.0を消費（上限チェック）
                                                    deductionQuantities[ingredient.id] = min(ingredient.quantity / 2.0, 1.0)
                                                }
                                            }
                                        )) {
                                            Text("使い切る").tag("full")
                                            Text("一部").tag("partial")
                                        }
                                        .pickerStyle(SegmentedPickerStyle())
                                        .frame(width: 130)
                                        
                                        let isFull = abs((deductionQuantities[ingredient.id] ?? 0) - ingredient.quantity) < 0.001
                                        if !isFull {
                                            Stepper(value: Binding(
                                                get: { deductionQuantities[ingredient.id] ?? 0.0 },
                                                set: { newValue in
                                                    // 食材の在庫量を超えない範囲で、かつ0より大きい値
                                                    let rounded = Double(round(10 * newValue) / 10)
                                                    deductionQuantities[ingredient.id] = max(0.1, min(rounded, ingredient.quantity))
                                                }
                                            ), in: 0.1...ingredient.quantity, step: 0.1) {
                                                Text(String(format: "%.1f%@", deductionQuantities[ingredient.id] ?? 0.0, ingredient.unit))
                                                    .font(.caption)
                                                    .foregroundColor(.secondary)
                                            }
                                        }
                                    }
                                } else {
                                    Text("\(String(format: "%.1f", ingredient.quantity))\(ingredient.unit)")
                                        .font(.subheadline)
                                        .foregroundColor(.secondary)
                                }
                            }
                            .padding(.vertical, 4)
                        }
                    }
                }
                
                // メモ・レシピセクション (マークダウン対応)
                Section(header: Text("メモ・レシピ (Markdown対応)").foregroundColor(.secondary)) {
                    VStack(alignment: .leading, spacing: 8) {
                        Picker("表示モード", selection: $memoMode) {
                            Text("編集").tag(0)
                            Text("プレビュー").tag(1)
                        }
                        .pickerStyle(SegmentedPickerStyle())
                        .padding(.bottom, 4)
                        
                        if memoMode == 0 {
                            // 編集用エディタ
                            TextEditor(text: $memo)
                                .frame(minHeight: 180)
                                .font(.system(.body, design: .monospaced))
                                .overlay(
                                    Group {
                                        if memo.isEmpty {
                                            VStack {
                                                HStack {
                                                    Text("# レシピの手順などを書けます\n\n- **太字**や *斜体*\n- `-` で箇条書き\n- 重要なコツなどをメモ")
                                                        .font(.body)
                                                        .foregroundColor(.gray.opacity(0.5))
                                                        .padding(.top, 8)
                                                        .padding(.leading, 5)
                                                    Spacer()
                                                }
                                                Spacer()
                                            }
                                        }
                                    }
                                )
                        } else {
                            // プレビュー表示
                            ScrollView {
                                VStack(alignment: .leading, spacing: 10) {
                                    if memo.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                                        Text("何も書かれていません")
                                            .foregroundColor(.secondary)
                                            .italic()
                                    } else {
                                        // SwiftUIの標準Markdownレンダリングを使用
                                        Text(LocalizedStringKey(memo))
                                            .frame(maxWidth: .infinity, alignment: .leading)
                                            .lineSpacing(4)
                                    }
                                }
                                .padding(.vertical, 8)
                                .padding(.horizontal, 4)
                            }
                            .frame(minHeight: 180)
                        }
                    }
                    .padding(.vertical, 4)
                }
            }
            .navigationTitle("晩ごはんを記録")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .navigationBarLeading) {
                    Button("キャンセル") {
                        dismiss()
                    }
                }
                
                ToolbarItem(placement: .navigationBarTrailing) {
                    Button("記録する") {
                        saveDinnerLog()
                    }
                    .disabled(name.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                    .fontWeight(.bold)
                }
            }
            .confirmationDialog("写真の追加方法を選択", isPresented: $showActionSheet, titleVisibility: .visible) {
                Button("カメラで写真を撮影") {
                    imagePickerSourceType = .camera
                    showImagePicker = true
                }
                Button("フォトライブラリから選択") {
                    imagePickerSourceType = .photoLibrary
                    showImagePicker = true
                }
                Button("キャンセル", role: .cancel) {}
            }
            .sheet(isPresented: $showImagePicker) {
                ImagePicker(selectedImage: $selectedUiImage, sourceType: imagePickerSourceType)
            }
        }
    }
    
    private func saveDinnerLog() {
        var photoData: Data? = nil
        if let uiImage = selectedUiImage {
            photoData = uiImage.jpegData(compressionQuality: 0.7)
        }
        
        // 使用した食材の名前を収集
        var usedNames: [String] = []
        var finalDeductions: [UUID: Double] = [:]
        
        for id in selectedIngredientIds {
            if let ingredient = appState.ingredients.first(where: { $0.id == id }) {
                usedNames.append(ingredient.name)
                // 実際に減算する数量
                let qty = deductionQuantities[id] ?? ingredient.quantity
                finalDeductions[id] = qty
            }
        }
        
        let newLog = DinnerLog(
            name: name,
            date: date,
            memo: memo,
            rating: rating,
            ingredientsUsed: usedNames,
            photoData: photoData
        )
        
        // AppStateを通じて食材の減算を実行しつつ、晩ごはん履歴に保存
        appState.addDinnerLog(newLog, deductions: finalDeductions)
        dismiss()
    }
}

struct AddDinnerLogView_Previews: PreviewProvider {
    static var previews: some View {
        AddDinnerLogView(appState: AppState())
    }
}
