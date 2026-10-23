@Entry
@Component
struct WatchHome {
  @State page: number = 0

  build() {
    Stack({ alignContent: Alignment.End }) {
      Swiper() {
        WatchDigitalFb()
        WatchWeatherFb()
        WatchCalendarFb()
        WatchRemindersFb()
        WatchSmartHomeFb()
      }
      .vertical(true).loop(false).indicator(false)
      .onChange((i: number) => { this.page = i })
      Column({ space: 5 }) {
        ForEach([0, 1, 2, 3, 4], (i: number) => {
          Circle({ width: 5, height: i === this.page ? 12 : 5 })
            .fill(i === this.page ? '#FFFFFF' : '#5A5A5A')
        }, (i: number) => i.toString())
      }.margin({ right: 8 })
    }
    .width('100%').height('100%').backgroundColor('#000000')
  }
}
