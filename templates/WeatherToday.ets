@Entry
@Component
struct WeatherToday {
  build() {
    Scroll() {
      Column({ space: 16 }) {
        Text('Weather').fontSize(30).fontWeight(FontWeight.Bold).width(320)
        WeatherCardFb()
        WeatherHourlyFb()
        SunriseArcFb()
        WeatherRadarFb()
      }
      .width('100%').padding({ top: 24, bottom: 32 }).alignItems(HorizontalAlign.Center)
    }
    .width('100%').height('100%').backgroundColor('#F1F1F6').scrollBar(BarState.Off)
  }
}
