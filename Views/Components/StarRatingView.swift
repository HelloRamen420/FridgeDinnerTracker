import SwiftUI

struct StarRatingView: View {
    @Binding var rating: Int
    var maxRating = 5
    var isInteractive = true // 編集可能か、表示のみか
    
    var body: some View {
        HStack {
            ForEach(1...maxRating, id: \.self) { index in
                Image(systemName: index <= rating ? "star.fill" : "star")
                    .foregroundColor(index <= rating ? .amber : .gray.opacity(0.4))
                    .font(.system(size: isInteractive ? 28 : 16))
                    .onTapGesture {
                        if isInteractive {
                            rating = index
                        }
                    }
                    .animation(.spring(response: 0.2, dampingFraction: 0.5), value: rating)
            }
        }
    }
}

// カラーパレット用の拡張
extension Color {
    static let amber = Color(red: 1.0, green: 0.75, blue: 0.0) // 暖かい琥珀色（プレミアムな星用）
}

struct StarRatingView_Previews: PreviewProvider {
    static var previews: some View {
        Group {
            StarRatingView(rating: .constant(4))
                .previewLayout(.sizeThatFits)
                .padding()
            
            StarRatingView(rating: .constant(3), isInteractive: false)
                .previewLayout(.sizeThatFits)
                .padding()
        }
    }
}
