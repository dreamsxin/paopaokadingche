import { button, el } from './dom'

export interface MenuChoice {
  mode: 'single' | 'multi'
  roomSize: number
}

export type StatsProvider = (size: number) => { openRooms: number; openSeats: number }

const SIZES = [2, 4, 6]

export class MainMenu {
  readonly root: HTMLDivElement
  private onPick: (c: MenuChoice) => void = () => {}
  private onGarage: () => void = () => {}
  private onBoard: () => void = () => {}
  private stats: StatsProvider | null = null
  private sizeButtons: Array<{ size: number; btn: HTMLButtonElement }> = []
  private kartLine: HTMLElement

  constructor(parent: HTMLElement) {
    this.root = el('div', 'panel hidden')
    this.root.appendChild(el('h1', 'title', '跑跑卡丁车'))
    this.root.appendChild(
      el('p', 'subtitle', '漂移集气 · 拉车头出小喷 · 连喷维持高速。3 圈竞速，6 车同场。'),
    )

    this.kartLine = el('div', 'status', '当前车型：--')
    this.root.appendChild(this.kartLine)

    const top = el('div', 'row')
    top.appendChild(button('单人游戏', 'btn', () => this.onPick({ mode: 'single', roomSize: 6 })))
    top.appendChild(button('车库 · 选车型', 'btn secondary', () => this.onGarage()))
    top.appendChild(button('排行榜', 'btn secondary', () => this.onBoard()))
    this.root.appendChild(top)

    this.root.appendChild(el('div', 'status', '多人快速匹配（自动进有空位的房间）'))
    const multi = el('div', 'row')
    for (const size of SIZES) {
      const btn = button(`${size} 人房`, 'btn secondary', () =>
        this.onPick({ mode: 'multi', roomSize: size }),
      )
      this.sizeButtons.push({ size, btn })
      multi.appendChild(btn)
    }
    this.root.appendChild(multi)

    const hint = el(
      'p',
      'hint',
      '键盘：↑/W 加速 · ↓/S 刹车 · ←→/AD 转向 · Shift 漂移 · Ctrl/空格 氮气\n' +
        '手机：左摇杆转向（自动油门）+ 右侧 漂移 / 刹车 / 氮气\n' +
        '技巧：入弯按住方向+Shift 开始集气，出弯按反方向键拉车头即出小喷；小喷结束前再次入漂可累积连喷。',
    )
    hint.style.whiteSpace = 'pre-line'
    this.root.appendChild(hint)

    parent.appendChild(this.root)
  }

  show(
    handlers: { onPick: (c: MenuChoice) => void; onGarage: () => void; onBoard: () => void },
    stats?: StatsProvider,
  ): void {
    this.onPick = handlers.onPick
    this.onGarage = handlers.onGarage
    this.onBoard = handlers.onBoard
    if (stats) this.stats = stats
    this.refresh()
    this.root.classList.remove('hidden')
  }

  /** 显示当前选中的车型 */
  setKart(name: string, tagline: string): void {
    this.kartLine.textContent = `当前车型：${name} — ${tagline}`
  }

  /** 刷新各人数档位的可加入房间数（大厅一直在变） */
  refresh(): void {
    if (!this.stats) return
    for (const { size, btn } of this.sizeButtons) {
      const { openRooms, openSeats } = this.stats(size)
      btn.textContent =
        openRooms > 0 ? `${size} 人房 · ${openRooms} 房 ${openSeats} 空位` : `${size} 人房 · 新开房间`
    }
  }

  hide(): void {
    this.root.classList.add('hidden')
  }
}
