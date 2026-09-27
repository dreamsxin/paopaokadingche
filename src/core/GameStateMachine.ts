export type GameState = 'boot' | 'menu' | 'lobby' | 'countdown' | 'racing' | 'result'

const TRANSITIONS: Record<GameState, GameState[]> = {
  boot: ['menu'],
  menu: ['lobby', 'countdown'],
  lobby: ['menu', 'countdown'],
  countdown: ['racing', 'menu'],
  racing: ['result', 'menu'],
  result: ['menu', 'countdown', 'lobby'],
}

export class GameStateMachine {
  private current: GameState = 'boot'
  private enter = new Map<GameState, Array<() => void>>()
  private exit = new Map<GameState, Array<() => void>>()

  get state(): GameState {
    return this.current
  }

  onEnter(state: GameState, cb: () => void): void {
    const list = this.enter.get(state) ?? []
    list.push(cb)
    this.enter.set(state, list)
  }

  onExit(state: GameState, cb: () => void): void {
    const list = this.exit.get(state) ?? []
    list.push(cb)
    this.exit.set(state, list)
  }

  canGo(next: GameState): boolean {
    return TRANSITIONS[this.current].includes(next)
  }

  go(next: GameState): boolean {
    if (next === this.current || !this.canGo(next)) return false
    this.exit.get(this.current)?.forEach((cb) => cb())
    this.current = next
    this.enter.get(next)?.forEach((cb) => cb())
    return true
  }
}
