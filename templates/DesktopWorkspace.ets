@Entry
@Component
struct DesktopWorkspace {
  @State tab: number = 0
  // The PC widgets animate from this counter; keep it ticking or drive it from your own data.
  @State step: number = 0
  private timer: number = -1
  private tabs: string[] = ['Dashboard', 'Board', 'Calendar', 'Inbox']

  aboutToAppear(): void {
    this.timer = setInterval(() => { this.step = this.step + 1 }, 130)
  }

  aboutToDisappear(): void {
    if (this.timer >= 0) {
      clearInterval(this.timer)
      this.timer = -1
    }
  }

  build() {
    Column() {
      Row({ space: 8 }) {
        ForEach(this.tabs, (t: string, i: number) => {
          Text(t)
            .fontSize(16).height(40).padding({ left: 18, right: 18 }).borderRadius(10)
            .fontColor(i === this.tab ? '#FFFFFF' : '#94A3B8')
            .fontWeight(i === this.tab ? FontWeight.Bold : FontWeight.Medium)
            .backgroundColor(i === this.tab ? '#334155' : '#00000000')
            .onClick(() => { this.tab = i })
        }, (t: string) => t)
      }
      .width('100%').height(64).padding({ left: 24, right: 24 })
      Stack() {
        if (this.tab === 0) {
          DashboardFb({ step: this.step })
        } else if (this.tab === 1) {
          KanbanFb({ step: this.step })
        } else if (this.tab === 2) {
          CalendarMonthFb({ step: this.step })
        } else {
          ChatDesktopFb({ step: this.step })
        }
      }
      .layoutWeight(1).width('100%')
    }
    .width('100%').height('100%').backgroundColor('#0B1020')
  }
}
