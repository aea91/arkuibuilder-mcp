@Entry
@Component
struct SignIn {
  @State creating: boolean = false

  build() {
    Scroll() {
      Column({ space: 18 }) {
        if (this.creating) {
          SignupFormFb()
          PasswordStrengthFb()
        } else {
          LoginFb()
        }
        Text(this.creating ? 'Already have an account? Sign in' : 'New here? Create an account')
          .fontSize(15).fontColor('#4338CA').fontWeight(FontWeight.Medium)
          .onClick(() => { this.creating = !this.creating })
      }
      .width('100%').constraintSize({ minHeight: '100%' })
      .padding({ top: 32, bottom: 32 }).justifyContent(FlexAlign.Center).alignItems(HorizontalAlign.Center)
    }
    .width('100%').height('100%').backgroundColor('#F1F1F6').scrollBar(BarState.Off)
  }
}
