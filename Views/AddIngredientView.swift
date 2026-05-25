import SwiftUI

struct AddIngredientView: View {
    @ObservedObject var appState: AppState
    @Environment(\.dismiss) var dismiss
    
    // フォーム用ステート
    @State private var name = ""
    @State private var category: IngredientCategory = .vegetable
    @State private var quantityText = "1"
    @State private var unit = "個"
    @State private var expirationDate = Calendar.current.date(byAdding: .day, value: 3, to: Date())!
    
    // 写真撮影・選択用のステート
    @State private var selectedUiImage: UIImage?
    @State private var showImagePicker = false
    @State private var imagePickerSourceType: UIImagePickerController.SourceType = .photoLibrary
    @State private var showActionSheet = false
    
    var body: some View {
        NavigationView {
            Form {
                // 食材基本情報セクション
                Section(header: Text("基本情報").foregroundColor(.secondary)) {
                    TextField("食材の名前 (例: 完熟トマト)", text: $name)
                        .autocorrectionDisabled()
                    
                    Picker("カテゴリ", selection: $category) {
                        ForEach(IngredientCategory.allCases) { cat in
                            HStack {
                                Text(cat.icon)
                                Text(cat.rawValue)
                            }
                            .tag(cat)
                        }
                    }
                }
                
                // 数量・期限セクション
                Section(header: Text("数量と期限").foregroundColor(.secondary)) {
                    HStack {
                        Text("数量")
                        Spacer()
                        TextField("1", text: $quantityText)
                            .keyboardType(.decimalPad)
                            .multilineTextAlignment(.trailing)
                            .frame(width: 80)
                        
                        TextField("単位 (例: 個)", text: $unit)
                            .frame(width: 60)
                            .multilineTextAlignment(.center)
                            .textFieldStyle(RoundedBorderTextFieldStyle())
                    }
                    
                    DatePicker("消費期限", selection: $expirationDate, displayedComponents: .date)
                        .environment(\.locale, Locale(identifier: "ja_JP"))
                }
                
                // 食材の写真セクション（写真撮影・選択）
                Section(header: Text("食材の写真").foregroundColor(.secondary)) {
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
                            // カメラ起動・写真追加を促すプレースホルダー
                            Button(action: {
                                showActionSheet = true
                            }) {
                                VStack(spacing: 8) {
                                    Image(systemName: "camera.fill")
                                        .font(.system(size: 32))
                                    Text("食材の写真を撮影・選択する")
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
            }
            .navigationTitle("新しい食材")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .navigationBarLeading) {
                    Button("キャンセル") {
                        dismiss()
                    }
                }
                
                ToolbarItem(placement: .navigationBarTrailing) {
                    Button("保存") {
                        saveIngredient()
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
    
    private func saveIngredient() {
        let qty = Double(quantityText) ?? 1.0
        
        // 画像をローカルのData形式に変換（高品質を保ちつつ圧縮）
        var photoData: Data? = nil
        if let uiImage = selectedUiImage {
            photoData = uiImage.jpegData(compressionQuality: 0.7)
        }
        
        let newIngredient = Ingredient(
            name: name,
            category: category,
            quantity: qty,
            unit: unit,
            expirationDate: expirationDate,
            photoData: photoData
        )
        
        appState.addIngredient(newIngredient)
        dismiss()
    }
}

struct AddIngredientView_Previews: PreviewProvider {
    static var previews: some View {
        AddIngredientView(appState: AppState())
    }
}
