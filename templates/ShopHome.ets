@Entry
@Component
struct ShopHome {
  @State tab: number = 0
  @State category: number = 0
  @State orderStep: number = 1

  @Builder
  homeTab() {
    Column({ space: 16 }) {
      SearchBarFb()
      FilterChipsFb({ selected: this.category })
      PromoCardFb()
      ProductCardFb()
    }
  }

  @Builder
  cartTab() {
    Column({ space: 16 }) {
      CartSummaryFb()
      CouponFb()
      OrderCardFb({ step: this.orderStep })
    }
  }

  build() {
    Column() {
      Scroll() {
        Column({ space: 16 }) {
          Text(this.tab === 3 ? 'Your Cart' : 'Shop').fontSize(30).fontWeight(FontWeight.Bold).width(320)
          if (this.tab === 0) {
            this.homeTab()
          } else if (this.tab === 3) {
            this.cartTab()
          } else {
            EmptyStateFb()
          }
        }
        .width('100%').padding({ top: 24, bottom: 24 }).alignItems(HorizontalAlign.Center)
      }
      .layoutWeight(1).scrollBar(BarState.Off)
      // Tabs: Home, Search, Add, Cart, Calendar
      NavGradientFb({ selectedIndex: this.tab })
    }
    .width('100%').height('100%').backgroundColor('#F1F1F6')
  }
}
