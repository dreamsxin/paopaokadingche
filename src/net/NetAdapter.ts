import { makeRandom } from '../core/math'

export type RoomPlayerKind = 'self' | 'remote' | 'bot'

export interface RoomPlayer {
  id: string
  name: string
  kind: RoomPlayerKind
  /** AI 水平（remote 在本期同样由本地 AI 驱动） */
  skill: number
}

export interface RoomInfo {
  id: string
  name: string
  size: number
  count: number
}

export interface RoomSnapshot {
  roomId: string
  roomName: string
  size: number
  players: RoomPlayer[]
  state: 'waiting' | 'ready'
  /** 还需要等待的人数 */
  missing: number
  /** 等待剩余时间（秒），到 0 由 AI 补位 */
  waitLeft: number
  /** 是否是插进了已有玩家的房间（而不是新开的房） */
  joinedExisting: boolean
}

export interface LobbyStats {
  /** 该规格下还有空位的房间数 */
  openRooms: number
  /** 这些房间里的空位总数 */
  openSeats: number
}

/**
 * 房间同步适配器。本期用 LocalBotAdapter + 本地大厅模拟"服务器上已有若干房间"，
 * 下一期换成 WebSocket 权威服务器实现，只需替换这一层。
 */
export interface NetAdapter {
  /** 快速加入：优先进同规格中"人最多且有空位"的房间，没有才开新房 */
  quickJoin(size: number, self: RoomPlayer): RoomInfo
  /** 推进适配器自身计时（超时补位、状态广播） */
  tick(dt: number): void
  /** 立刻用 AI 填满空位 */
  fillWithBots(): void
  leave(): void
  onUpdate(cb: (snapshot: RoomSnapshot) => void): void
}

const REMOTE_NAMES = ['皮蛋', '黑妞', '大头', '小橘子', '阿龙', '拉莫', '迪迪', '莉莉', '西米', '豆豆']
const BOT_PREFIX = 'AI·'
const MAX_ROOMS = 9

interface LobbyRoom {
  id: string
  name: string
  size: number
  players: RoomPlayer[]
  /** 我是否在这个房间里 */
  mine: boolean
  /** 距离下一个模拟玩家进来的时间 */
  nextJoinIn: number
  /** 满员后开赛倒数，到点从大厅移除；null 表示还在等人 */
  startingIn: number | null
}

/**
 * 本地大厅：维护一批"别人的房间"，人数随时间变化，满员就开赛并从列表消失，
 * 偶尔有新房开出来。玩家点"多人 - N 人房"时走快速匹配塞进空位。
 */
class LocalLobby {
  private rooms: LobbyRoom[] = []
  private rng = makeRandom(20260927)
  private seq = 1
  private spawnIn = 4

  constructor() {
    for (const size of [2, 4, 6]) {
      const count = size === 6 ? 2 : 1
      for (let i = 0; i < count; i++) {
        this.createRoom(size, Math.floor(this.rng() * (size - 1)))
      }
    }
  }

  createRoom(size: number, occupancy = 0): LobbyRoom {
    const room: LobbyRoom = {
      id: `room-${this.seq}`,
      name: `${this.seq} 号房`,
      size,
      players: [],
      mine: false,
      nextJoinIn: 1 + this.rng() * 3,
      startingIn: null,
    }
    this.seq++
    for (let i = 0; i < occupancy; i++) room.players.push(this.makeRemote(room, i))
    this.rooms.push(room)
    return room
  }

  private makeRemote(room: LobbyRoom, index: number): RoomPlayer {
    return {
      id: `${room.id}-p${index}-${Math.floor(this.rng() * 10000)}`,
      name: REMOTE_NAMES[Math.floor(this.rng() * REMOTE_NAMES.length)],
      kind: 'remote',
      skill: 0.45 + this.rng() * 0.45,
    }
  }

  makeBot(index: number): RoomPlayer {
    return {
      id: `bot-${index}-${Math.floor(this.rng() * 10000)}`,
      name: `${BOT_PREFIX}${REMOTE_NAMES[index % REMOTE_NAMES.length]}`,
      kind: 'bot',
      skill: 0.4 + this.rng() * 0.5,
    }
  }

  /** 快速匹配：同规格、有空位、还没开赛的房间里，挑人最多的那个 */
  quickJoin(size: number, self: RoomPlayer): LobbyRoom {
    const open = this.rooms
      .filter((r) => r.size === size && !r.mine && r.startingIn === null && r.players.length < size)
      .sort((a, b) => b.players.length - a.players.length)
    const room = open[0] ?? this.createRoom(size)
    room.mine = true
    room.players.push(self)
    return room
  }

  /** 离开/开赛：房间从大厅移除 */
  dropRoom(room: LobbyRoom | null): void {
    if (!room) return
    this.rooms = this.rooms.filter((r) => r !== room)
  }

  stats(size: number): LobbyStats {
    const open = this.rooms.filter(
      (r) => r.size === size && !r.mine && r.startingIn === null && r.players.length < size,
    )
    return {
      openRooms: open.length,
      openSeats: open.reduce((sum, r) => sum + (r.size - r.players.length), 0),
    }
  }

  tick(dt: number): void {
    for (const room of [...this.rooms]) {
      if (room.startingIn !== null) {
        room.startingIn -= dt
        if (room.startingIn <= 0) this.dropRoom(room)
        continue
      }
      if (room.players.length >= room.size) {
        // 我的房间由 RoomController 决定何时开赛，别人的房间自己开走
        if (!room.mine) room.startingIn = 1.5
        continue
      }
      room.nextJoinIn -= dt
      if (room.nextJoinIn <= 0) {
        room.nextJoinIn = 1.2 + this.rng() * 3
        // 小概率这一轮没人进来（模拟别人挑房 / 掉线）
        if (this.rng() > 0.25) room.players.push(this.makeRemote(room, room.players.length))
      }
    }

    this.spawnIn -= dt
    if (this.spawnIn <= 0) {
      this.spawnIn = 5 + this.rng() * 6
      if (this.rooms.length < MAX_ROOMS) {
        const size = [2, 4, 6][Math.floor(this.rng() * 3)]
        this.createRoom(size, Math.floor(this.rng() * 2))
      }
    }
  }
}

const lobby = new LocalLobby()

/** 大厅模拟需要一直推进（即使玩家在主菜单），由主循环统一驱动 */
export function tickLocalLobby(dt: number): void {
  lobby.tick(dt)
}

/** 主菜单展示"该规格有几个房间可加入" */
export function lobbyStats(size: number): LobbyStats {
  return lobby.stats(size)
}

export class LocalBotAdapter implements NetAdapter {
  private room: LobbyRoom | null = null
  private elapsed = 0
  private joinedExisting = false
  private listener: ((s: RoomSnapshot) => void) | null = null
  /** 等待上限，超时补 AI */
  readonly waitLimit = 12

  quickJoin(size: number, self: RoomPlayer): RoomInfo {
    const room = lobby.quickJoin(size, self)
    this.room = room
    this.elapsed = 0
    // 除我之外已经有人 => 是插进了现有房间
    this.joinedExisting = room.players.length > 1
    this.emit()
    return { id: room.id, name: room.name, size: room.size, count: room.players.length }
  }

  tick(dt: number): void {
    const room = this.room
    if (!room) return
    this.elapsed += dt
    if (room.players.length < room.size && this.elapsed >= this.waitLimit) {
      this.fillWithBots()
      return
    }
    this.emit()
  }

  fillWithBots(): void {
    const room = this.room
    if (!room) return
    let i = 0
    while (room.players.length < room.size) {
      room.players.push(lobby.makeBot(i++))
    }
    this.emit()
  }

  leave(): void {
    lobby.dropRoom(this.room)
    this.room = null
    this.listener = null
  }

  onUpdate(cb: (snapshot: RoomSnapshot) => void): void {
    this.listener = cb
    this.emit()
  }

  private emit(): void {
    const room = this.room
    if (!this.listener || !room) return
    const full = room.players.length >= room.size
    this.listener({
      roomId: room.id,
      roomName: room.name,
      size: room.size,
      players: [...room.players],
      state: full ? 'ready' : 'waiting',
      missing: Math.max(0, room.size - room.players.length),
      waitLeft: Math.max(0, this.waitLimit - this.elapsed),
      joinedExisting: this.joinedExisting,
    })
  }
}
