import type { RoomSnapshot } from '../net/NetAdapter'
import { button, el } from './dom'

/** 房间面板：6 格位置 + 等待状态 + AI 补位 / 取消 */
export class RoomPanel {
  readonly root: HTMLDivElement
  private slots: HTMLDivElement
  private status: HTMLDivElement

  constructor(parent: HTMLElement) {
    this.root = el('div', 'panel hidden')
    this.root.appendChild(el('h1', 'title', '房间'))
    this.slots = el('div', 'slots')
    this.root.appendChild(this.slots)
    this.status = el('div', 'status', '')
    this.root.appendChild(this.status)

    const row = el('div', 'row')
    row.appendChild(button('AI 补位并开始', 'btn', () => this.onFill()))
    row.appendChild(button('离开房间', 'btn secondary', () => this.onCancel()))
    this.root.appendChild(row)
    parent.appendChild(this.root)
  }

  private onFill: () => void = () => {}
  private onCancel: () => void = () => {}

  show(handlers: { onFill: () => void; onCancel: () => void }): void {
    this.onFill = handlers.onFill
    this.onCancel = handlers.onCancel
    this.root.classList.remove('hidden')
  }

  hide(): void {
    this.root.classList.add('hidden')
  }

  render(snapshot: RoomSnapshot, readyCountdown: number): void {
    this.slots.innerHTML = ''
    for (let i = 0; i < snapshot.size; i++) {
      const p = snapshot.players[i]
      const slot = el('div', 'slot')
      if (!p) {
        slot.classList.add('empty')
        slot.appendChild(el('div', 'avatar'))
        slot.appendChild(el('div', '', '等待加入'))
      } else {
        if (p.kind === 'self') slot.classList.add('me')
        slot.appendChild(el('div', 'avatar'))
        slot.appendChild(el('div', '', p.name))
        slot.appendChild(
          el('div', 'tag', p.kind === 'self' ? '我' : p.kind === 'bot' ? 'AI 补位' : '玩家'),
        )
      }
      this.slots.appendChild(slot)
    }

    if (snapshot.state === 'ready') {
      this.status.textContent = `满员！${Math.max(0, readyCountdown).toFixed(1)}s 后进入赛道`
    } else {
      this.status.textContent = `等待 ${snapshot.missing} 名玩家加入… ${Math.ceil(snapshot.waitLeft)}s 后 AI 补位`
    }
  }
}
