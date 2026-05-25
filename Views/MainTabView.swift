import SwiftUI

struct MainTabView: View {
    @ObservedObject var appState: AppState
    @State private var selectedTab = 0
    
    var body: some View {
        TabView(selection: $selectedTab) {
            DashboardView(appState: appState)
                .tabItem {
                    Label("ダッシュボード", systemImage: "sparkles")
                }
                .tag(0)
            
            FridgeView(appState: appState)
                .tabItem {
                    Label("冷蔵庫", systemImage: "refrigerator")
                }
                .tag(1)
            
            DinnerLogView(appState: appState)
                .tabItem {
                    Label("晩ごはん", systemImage: "fork.knife")
                }
                .tag(2)
        }
        .accentColor(.orange) // アプリ全体のキーカラー（オレンジ）に統一して温かみを演出
    }
}

struct MainTabView_Previews: PreviewProvider {
    static var previews: some View {
        MainTabView(appState: AppState())
    }
}
