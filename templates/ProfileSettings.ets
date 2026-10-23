@Entry
@Component
struct ProfileSettings {
  @State notifications: boolean = true

  build() {
    Scroll() {
      Column({ space: 16 }) {
        Text('Profile').fontSize(30).fontWeight(FontWeight.Bold).width(320)
        ProfileCardFb()
        Row() {
          Column({ space: 2 }) {
            Text('Notifications').fontSize(16).fontWeight(FontWeight.Medium)
            Text(this.notifications ? 'On' : 'Off').fontSize(13).fontColor('#8E8E93')
          }.alignItems(HorizontalAlign.Start)
          Blank()
          SwitchFb({ on: this.notifications })
        }
        .width(320).padding({ left: 18, right: 18, top: 14, bottom: 14 }).borderRadius(16).backgroundColor('#FFFFFF')
        SettingsListFb()
        ThemeToggleFb()
      }
      .width('100%').padding({ top: 24, bottom: 32 }).alignItems(HorizontalAlign.Center)
    }
    .width('100%').height('100%').backgroundColor('#F1F1F6').scrollBar(BarState.Off)
  }
}
