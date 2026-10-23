@Entry
@Component
struct WalletHome {
  @State spent: number = 0

  aboutToAppear(): void {
    // Share of the monthly budget spent, 0-100.
    this.getUIContext().animateTo({ duration: 1000, curve: Curve.EaseOut }, () => {
      this.spent = 68
    })
  }

  build() {
    Scroll() {
      Column({ space: 16 }) {
        Row() {
          Column({ space: 2 }) {
            Text('Good morning').fontSize(14).fontColor('#8E8E93')
            Text('Wallet').fontSize(30).fontWeight(FontWeight.Bold)
          }.alignItems(HorizontalAlign.Start)
        }.width(320)
        WalletCardFb()
        ExpenseDonutFb({ value: this.spent })
        TransactionsFb()
        StockCardFb()
      }
      .width('100%').padding({ top: 24, bottom: 32 }).alignItems(HorizontalAlign.Center)
    }
    .width('100%').height('100%').backgroundColor('#F1F1F6').scrollBar(BarState.Off)
  }
}
