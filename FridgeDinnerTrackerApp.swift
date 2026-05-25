import SwiftUI

@main
struct FridgeDinnerTrackerApp: App {
    // アプリ全体のライフサイクルに合わせて状態オブジェクトを一度だけ生成
    @StateObject private var appState = AppState()
    
    var body: some Scene {
        WindowGroup {
            MainTabView(appState: appState)
        }
    }
}
