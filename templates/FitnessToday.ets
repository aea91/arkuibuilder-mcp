@Entry
@Component
struct FitnessToday {
  @State period: number = 0
  @State move: number = 0
  @State exercise: number = 0
  @State stand: number = 0
  private titles: string[] = ['Today', 'This Week', 'This Month']

  aboutToAppear(): void {
    // Replace with real activity data (e.g. from a health service).
    this.getUIContext().animateTo({ duration: 1200, curve: Curve.EaseOut }, () => {
      this.move = 82
      this.exercise = 64
      this.stand = 91
    })
  }

  @Builder
  ringStat(label: string, value: number, color: string) {
    Column({ space: 2 }) {
      Text(label).fontSize(13).fontColor('#8E8E93')
      Text(`${Math.round(value)}%`).fontSize(20).fontWeight(FontWeight.Bold).fontColor(color)
    }.alignItems(HorizontalAlign.Start)
  }

  build() {
    Scroll() {
      Column({ space: 16 }) {
        Text(this.titles[this.period]).fontSize(30).fontWeight(FontWeight.Bold).width(320)
        SegmentedControlFb({ index: this.period })
        Row({ space: 24 }) {
          ActivityRingsFb({ move: this.move, exercise: this.exercise, stand: this.stand })
          Column({ space: 12 }) {
            this.ringStat('Move', this.move, '#FF375F')
            this.ringStat('Exercise', this.exercise, '#7AC70C')
            this.ringStat('Stand', this.stand, '#00B8D4')
          }
        }
        .width(320).padding(20).borderRadius(20).backgroundColor('#1C1C1E')
        StepCounterFb()
        WaterTrackerFb()
        SleepChartFb()
      }
      .width('100%').padding({ top: 24, bottom: 32 }).alignItems(HorizontalAlign.Center)
    }
    .width('100%').height('100%').backgroundColor('#F1F1F6').scrollBar(BarState.Off)
  }
}
