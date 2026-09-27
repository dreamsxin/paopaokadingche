import { makeRandom } from '../core/math'

export type RoomPlayerKind = 'self' | 'remote' | 'bot'

export interface RoomPlayer {
  id: string
  name: string
  kind: RoomPlayerKind
  /** AI 水平（remote 在本期同样由本地 AI 驱动） */
  skill: number
}

export interface RoomSnapshot {
  size: number
  players: RoomPlayer[]
  state: 'waiting' | 'ready'
  /** 还需要等待的人数 */
  missing: number
  /** 等待剩余时间（秒），到 0 由 AI 补位 */
  waitLeft: number
}

/**
 * 房间同步适配器。本期用 LocalBotAdapter 在本地模拟"别的玩家陆续加入"，
 * 下一期换成 WebSocket 权威服务器实现，只需替换这一层。
 */
export interface NetAdapter {
  join(size: number, self: RoomPlayer): void
  /** 推进内部计时（由固定步长循环驱动，避免 setTimeout 与逻辑帧错位） */
  tick(dt: number): void
  /** 立刻用 AI 填满空位 */
  fillWithBots(): void
  leave(): void
  onUpdate(cb: (snapshot: RoomSnapshot) => void): void
}

const REMOTE_NAMES = ['皮蛋', '黑妞', '大头', '小橘子', '阿龙', '拉莫', '迪迪', '莉莉']
const BOT_PREFIX = 'AI·'

export class LocalBotAdapter implements NetAdapter {
  private size = 6
  private players: RoomPlayer[] = []
  private pending: Array<{ at: number; player: RoomPlayer }> = []
  private elapsed = 0
  private listener: ((s: RoomSnapshot) => void) | null = null
  private rng = makeRandom(7)
  /** 等待上限，超时补 AI */
  readonly waitLimit = 12

  join(size: number, self: RoomPlayer): void {
    this.size = size
    this.players = [self]
    this.pending = []
    this.elapsed = 0
    this.rng = makeRandom(size * 977 + 13)
    const slots = size - 1
    let at = 0
    for (let i = 0; i < slots; i++) {
      at += 1.1 + this.rng() * 2.6
      this.pending.push({
        at,
        player: {
          id: `remote-${i}`,
          name: REMOTE_NAMES[i % REMOTE_NAMES.length],
          kind: 'remote',
          skill: 0.45 + this.rng() * 0.45,
        },
      })
    }
    this.emit()
  }

  tick(dt: number): void {
    if (this.players.length >= this.size) return
    this.elapsed += dt
    while (this.pending.length && this.pending[0].at <= this.elapsed) {
      const next = this.pending.shift()!
      // 模拟"有人没抢到位置/掉线"：小概率不加入，交给 AI 补位
      if (this.rng() > 0.18) this.players.push(next.player)
    }
    if (this.elapsed >= this.waitLimit && this.players.length < this.size) {
      this.fillWithBots()
      return
    }
    this.emit()
  }

  fillWithBots(): void {
    let i = 0
    while (this.players.length < this.size) {
      this.players.push({
        id: `bot-${i}`,
        name: `${BOT_PREFIX}${REMOTE_NAMES[(i + 4) % REMOTE_NAMES.length]}`,
        kind: 'bot',
        skill: 0.4 + this.rng() * 0.5,
      })
      i++
    }
    this.pending = []
    this.emit()
  }

  leave(): void {
    this.players = []
    this.pending = []
    this.listener = null
  }

  onUpdate(cb: (snapshot: RoomSnapshot) => void): void {
    this.listener = cb
    this.emit()
  }

  private emit(): void {
    if (!this.listener) return
    const full = this.players.length >= this.size
    this.listener({
      size: this.size,
      players: [...this.players],
      state: full ? 'ready' : 'waiting',
      missing: Math.max(0, this.size - this.players.length),
      waitLeft: Math.max(0, this.waitLimit - this.elapsed),
    })
  }
}
