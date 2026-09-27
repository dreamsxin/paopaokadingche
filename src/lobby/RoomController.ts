import { LocalBotAdapter, type NetAdapter, type RoomPlayer, type RoomSnapshot } from '../net/NetAdapter'

/**
 * 房间流程：选人数(2/4/6) -> 等待其他玩家加入 -> 满员或超时(AI 补位) -> 就绪倒数 -> 开赛。
 */
export class RoomController {
  snapshot: RoomSnapshot | null = null
  /** 满员后到开赛的就绪倒数 */
  readyCountdown = 0
  private started = false

  constructor(
    private readonly adapter: NetAdapter = new LocalBotAdapter(),
    private readonly readyDelay = 1.6,
  ) {}

  open(size: number, self: RoomPlayer, onUpdate: (s: RoomSnapshot) => void): void {
    this.started = false
    this.readyCountdown = this.readyDelay
    this.adapter.onUpdate((s) => {
      this.snapshot = s
      onUpdate(s)
    })
    this.adapter.join(size, self)
  }

  /** @returns true 表示可以开赛 */
  tick(dt: number): boolean {
    if (this.started) return false
    this.adapter.tick(dt)
    if (this.snapshot?.state === 'ready') {
      this.readyCountdown -= dt
      if (this.readyCountdown <= 0) {
        this.started = true
        return true
      }
    }
    return false
  }

  fillNow(): void {
    this.adapter.fillWithBots()
  }

  close(): void {
    this.started = true
    this.snapshot = null
    this.adapter.leave()
  }
}
