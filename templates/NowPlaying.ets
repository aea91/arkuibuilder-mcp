@Entry
@Component
struct NowPlaying {
  @State progress: number = 0
  @State playing: boolean = true
  private timer: number = -1

  aboutToAppear(): void {
    // Advances the track while playing; replace with your player's position (0-100).
    this.timer = setInterval(() => {
      if (this.playing) {
        this.progress = this.progress >= 100 ? 0 : this.progress + 0.5
      }
    }, 500)
  }

  aboutToDisappear(): void {
    if (this.timer >= 0) {
      clearInterval(this.timer)
      this.timer = -1
    }
  }

  build() {
    Scroll() {
      Column({ space: 16 }) {
        Text('Now Playing').fontSize(30).fontWeight(FontWeight.Bold).width(320)
        MusicCardFb({ progress: this.progress, playing: this.playing })
        WaveformFb()
        EqualizerFb()
        VolumeSliderFb()
      }
      .width('100%').padding({ top: 24, bottom: 32 }).alignItems(HorizontalAlign.Center)
    }
    .width('100%').height('100%').backgroundColor('#F1F1F6').scrollBar(BarState.Off)
  }
}
