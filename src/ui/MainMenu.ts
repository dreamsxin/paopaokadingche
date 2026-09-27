import { button, el } from './dom'

export interface MenuChoice {
  mode: 'single' | 'multi'
  roomSize: number
}

export class MainMenu {
  readonly root: HTMLDivElement
  private onPick: (c: MenuChoice) => void = () => {}

  constructor(parent: HTMLElement) {
    this.root = el('div', 'panel hidden')
    this.root.appendChild(el('h1', 'title', '跑跑卡丁车'))
    this.root.appendChild(
      el(
        'p',
        'subtitle',
        '漂移集气 · 拉车头出小喷 · 连喷维持高速。3 圈竞速，6 车同场。',
      ),
    )

    const single = el('div', 'row')
    single.appendChild(
      button('单人游戏', 'btn', () => this.onPick({ mode: 'single', roomSize: 6 })),
    )
    this.root.appendChild(single)

    this.root.appendChild(el('div', 'status', '多人游戏（房间人数）'))
    const multi = el('div', 'row')
    for (const size of [2, 4, 6]) {
      const wait = size - 1
      multi.appendChild(
        button(`${size} 人房（等 ${wait} 人）`, 'btn secondary', () =>
          this.onPick({ mode: 'multi', roomSize: size }),
        ),
      )
    }
    this.root.appendChild(multi)

    this.root.appendChild(
      el(
        'p',
        'hint',
        '键盘：↑/W 加速 · ↓/S 刹车 · ←→/AD 转向 · Shift 漂移 · Ctrl/空格 氮气\n' +
          '手机：左摇杆转向（自动油门）+ 右侧 漂移 / 刹车 / 氮气\n' +
          '技巧：入弯按住方向+Shift 开始集气，出弯按反方向键拉车头即出小喷；小喷结束前再次入漂可累积连喷。',
      ),
    )
    ;(this.root.lastChild as HTMLElement).style.whiteSpace = 'pre-line'

    parent.appendChild(this.root)
  }

  show(onPick: (c: MenuChoice) => void): void {
    this.onPick = onPick
    this.root.classList.remove('hidden')
  }

  hide(): void {
    this.root.classList.add('hidden')
  }
}
