/**
 * 固定步长逻辑 + 自由帧率渲染。
 * 物理与漂移集气都依赖稳定步长，否则不同刷新率手机的小喷时机会不一致。
 */
export class Loop {
  private readonly step: number
  private acc = 0
  private last = 0
  private rafId = 0
  private running = false

  constructor(
    private readonly onFixed: (dt: number) => void,
    private readonly onRender: (alpha: number, dt: number) => void,
    hz = 60,
  ) {
    this.step = 1 / hz
  }

  start(): void {
    if (this.running) return
    this.running = true
    this.last = performance.now()
    this.acc = 0
    const tick = (now: number) => {
      if (!this.running) return
      this.rafId = requestAnimationFrame(tick)
      // 单帧最多补 0.25s，避免切后台回来后一次性追帧导致穿墙
      const frame = Math.min(0.25, (now - this.last) / 1000)
      this.last = now
      this.acc += frame
      let guard = 0
      while (this.acc >= this.step && guard++ < 8) {
        this.acc -= this.step
        this.onFixed(this.step)
      }
      this.onRender(this.acc / this.step, frame)
    }
    this.rafId = requestAnimationFrame(tick)
  }

  stop(): void {
    this.running = false
    cancelAnimationFrame(this.rafId)
  }
}
