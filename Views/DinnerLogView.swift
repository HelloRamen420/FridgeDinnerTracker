import SwiftUI

struct DinnerLogView: View {
    @ObservedObject var appState: AppState
    @State private var showAddSheet = false
    @State private var selectedLog: DinnerLog? // 詳細表示用のステート
    
    var body: some View {
        NavigationView {
            ZStack {
                Color(.systemGroupedBackground)
                    .ignoresSafeArea()
                
                if appState.dinnerLogs.isEmpty {
                    emptyStateView
                } else {
                    ScrollView {
                        LazyVStack(spacing: 16) {
                            ForEach(appState.dinnerLogs) { log in
                                dinnerLogCard(for: log)
                                    .onTapGesture {
                                        selectedLog = log
                                    }
                            }
                        }
                        .padding(16)
                    }
                }
            }
            .navigationTitle("晩ごはんの記録")
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
                AddDinnerLogView(appState: appState)
            }
            .sheet(item: $selectedLog) { log in
                DinnerLogDetailView(log: log)
            }
        }
    }
    
    // MARK: - 晩ごはんカード
    
    private func dinnerLogCard(for log: DinnerLog) -> some View {
        VStack(alignment: .leading, spacing: 12) {
            // ヘッダー: 日付と星評価
            HStack {
                Text(formattedDate(log.date))
                    .font(.caption)
                    .fontWeight(.bold)
                    .foregroundColor(.secondary)
                
                Spacer()
                
                StarRatingView(rating: .constant(log.rating), isInteractive: false)
            }
            
            // 中央: 写真（登録されている場合）
            if let photoData = log.photoData, let uiImage = UIImage(data: photoData) {
                Image(uiImage: uiImage)
                    .resizable()
                    .scaledToFill()
                    .frame(height: 160)
                    .cornerRadius(12)
                    .clipped()
            }
            
            // タイトル
            Text(log.name)
                .font(.title3)
                .fontWeight(.bold)
                .foregroundColor(.primary)
            
            // 使用した食材タグ
            if !log.ingredientsUsed.isEmpty {
                ScrollView(.horizontal, showsIndicators: false) {
                    HStack(spacing: 6) {
                        ForEach(log.ingredientsUsed, id: \.self) { name in
                            Text(name)
                                .font(.caption2)
                                .fontWeight(.semibold)
                                .foregroundColor(.accentColor)
                                .padding(.horizontal, 8)
                                .padding(.vertical, 4)
                                .background(Color.accentColor.opacity(0.1))
                                .cornerRadius(8)
                        }
                    }
                }
            }
            
            // メモプレビュー（最大3行表示）
            if !log.memo.isEmpty {
                Text(log.memo)
                    .font(.footnote)
                    .foregroundColor(.secondary)
                    .lineLimit(2)
                    .padding(.top, 2)
            }
            
            HStack {
                Spacer()
                Text("タップして詳細・レシピを見る")
                    .font(.caption2)
                    .foregroundColor(.accentColor)
                    .fontWeight(.medium)
            }
            .padding(.top, 4)
        }
        .padding(14)
        .background(Color(.white))
        .cornerRadius(16)
        .shadow(color: Color.black.opacity(0.04), radius: 8, x: 0, y: 4)
    }
    
    // MARK: - 空白状態表示
    
    private var emptyStateView: some View {
        VStack(spacing: 18) {
            Image(systemName: "square.and.pencil")
                .font(.system(size: 80))
                .foregroundColor(.gray.opacity(0.3))
            
            Text("晩ごはんはまだ記録されていません")
                .font(.title3)
                .fontWeight(.bold)
                .foregroundColor(.secondary)
            
            Text("今日作った料理の写真やレシピを記録して、\n美味しい日々の思い出をここに残しましょう！")
                .font(.subheadline)
                .foregroundColor(.secondary.opacity(0.8))
                .multilineTextAlignment(.center)
                .lineSpacing(4)
        }
        .padding()
    }
    
    // MARK: - ヘルパー関数
    
    private func formattedDate(_ date: Date) -> String {
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "ja_JP")
        formatter.dateFormat = "yyyy年MM月dd日 (E)"
        
        let calendar = Calendar.current
        if calendar.isDateInToday(date) {
            return "今日 - " + formatter.string(from: date)
        } else if calendar.isDateInYesterday(date) {
            return "昨日 - " + formatter.string(from: date)
        } else {
            return formatter.string(from: date)
        }
    }
}

// MARK: - 晩ごはん詳細表示シート (マークダウン表示対応)

struct DinnerLogDetailView: View {
    let log: DinnerLog
    @Environment(\.dismiss) var dismiss
    
    var body: some View {
        NavigationView {
            ScrollView {
                VStack(alignment: .leading, spacing: 18) {
                    
                    // 日付と評価
                    HStack {
                        Text(formattedFullDate(log.date))
                            .font(.subheadline)
                            .fontWeight(.semibold)
                            .foregroundColor(.secondary)
                        
                        Spacer()
                        
                        StarRatingView(rating: .constant(log.rating), isInteractive: false)
                    }
                    .padding(.horizontal)
                    
                    // 料理写真（大）
                    if let photoData = log.photoData, let uiImage = UIImage(data: photoData) {
                        Image(uiImage: uiImage)
                            .resizable()
                            .scaledToFill()
                            .frame(maxHeight: 250)
                            .cornerRadius(16)
                            .clipped()
                            .padding(.horizontal)
                    }
                    
                    // 使用した食材リスト
                    if !log.ingredientsUsed.isEmpty {
                        VStack(alignment: .leading, spacing: 8) {
                            Text("🍳 使用した食材")
                                .font(.headline)
                                .fontWeight(.bold)
                            
                            FlowLayout(spacing: 8) {
                                ForEach(log.ingredientsUsed, id: \.self) { name in
                                    Text(name)
                                        .font(.caption)
                                        .fontWeight(.bold)
                                        .foregroundColor(.white)
                                        .padding(.horizontal, 10)
                                        .padding(.vertical, 5)
                                        .background(Color.accentColor)
                                        .cornerRadius(8)
                                }
                            }
                        }
                        .padding(.horizontal)
                        .padding(.vertical, 8)
                        .background(Color(.systemGray6).opacity(0.5))
                        .cornerRadius(12)
                        .padding(.horizontal)
                    }
                    
                    // マークダウンで書かれたメモ・レシピの表示
                    VStack(alignment: .leading, spacing: 12) {
                        Text("📝 メモ・レシピ")
                            .font(.headline)
                            .fontWeight(.bold)
                        
                        Divider()
                        
                        if log.memo.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                            Text("メモは記録されていません")
                                .foregroundColor(.secondary)
                                .italic()
                        } else {
                            // SwiftUIの標準Markdownレンダリングをリッチに描画
                            Text(LocalizedStringKey(log.memo))
                                .font(.body)
                                .lineSpacing(6)
                                .accentColor(.accentColor) // リンクなどのカラー
                        }
                    }
                    .padding(.horizontal)
                    .padding(.top, 8)
                }
                .padding(.vertical)
            }
            .navigationTitle(log.name)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .navigationBarTrailing) {
                    Button("閉じる") {
                        dismiss()
                    }
                    .fontWeight(.semibold)
                }
            }
        }
    }
    
    private func formattedFullDate(_ date: Date) -> String {
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "ja_JP")
        formatter.dateFormat = "yyyy年MM月dd日 (E)"
        return formatter.string(from: date)
    }
}

// SwiftUIでタグをきれいに並べるためのFlowLayoutヘルパー
struct FlowLayout: Layout {
    var spacing: CGFloat = 8

    func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize {
        let sizes = subviews.map { $0.sizeThatFits(.unspecified) }
        let width = proposal.width ?? 0
        
        var totalHeight: CGFloat = 0
        var currentWidth: CGFloat = 0
        var currentHeight: CGFloat = 0
        
        for size in sizes {
            if currentWidth + size.width + spacing > width {
                totalHeight += currentHeight + spacing
                currentWidth = size.width
                currentHeight = size.height
            } else {
                currentWidth += size.width + spacing
                currentHeight = max(currentHeight, size.height)
            }
        }
        totalHeight += currentHeight
        
        return CGSize(width: width, height: totalHeight)
    }

    func placeSubviews(in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) {
        let sizes = subviews.map { $0.sizeThatFits(.unspecified) }
        var currentX = bounds.minX
        var currentY = bounds.minY
        var rowHeight: CGFloat = 0
        
        for index in subviews.indices {
            let size = sizes[index]
            if currentX + size.width + spacing > bounds.maxX {
                currentX = bounds.minX
                currentY += rowHeight + spacing
                rowHeight = size.height
            } else {
                rowHeight = max(rowHeight, size.height)
            }
            
            subviews[index].place(
                at: CGPoint(x: currentX, y: currentY),
                proposal: ProposedViewSize(size)
            )
            currentX += size.width + spacing
        }
    }
}

struct DinnerLogView_Previews: PreviewProvider {
    static var previews: some View {
        DinnerLogView(appState: AppState())
    }
}
