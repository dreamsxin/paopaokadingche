import { KART_MODELS, modelRadar, type KartModel } from '../karts/catalog'
import { button, el } from './dom'
import { clamp } from '../core/math'

/** 车库：选择车型，展示五维与定位 */
export class GaragePanel {
  readonly root: HTMLDivElement
  private cards = new Map<string, HTMLElement>()
  private selected = KART_MODELS[0].id
  private onSelect: (id: string) => void = () => {}
  private onClose: () => void = () => {}

  constructor(parent: HTMLElement) {
    this.root = el('div', 'panel hidden')
    this.root.appendChild(el('h1', 'title', '车库'))
    this.root.appendChild(el('p', 'subtitle', '不同车系手感差异很大：极速、灵活、集气各有侧重'))

    const list = el('div', 'kart-cards')
    for (const model of KART_MODELS) {
      const card = this.buildCard(model)
      this.cards.set(model.id, card)
      list.appendChild(card)
    }
    this.root.appendChild(list)

    const row = el('div', 'row')
    row.appendChild(button('确定', 'btn', () => this.onClose()))
    this.root.appendChild(row)
    parent.appendChild(this.root)
  }

  private buildCard(model: KartModel): HTMLElement {
    const card = el('div', 'kart-card')
    const chip = el('div', 'kart-chip')
    chip.style.background = `#${model.tint.toString(16).padStart(6, '0')}`
    card.appendChild(chip)
    card.appendChild(el('div', 'kart-name', model.name))
    card.appendChild(el('div', 'tag', model.series))
    card.appendChild(el('div', 'kart-tag', model.tagline))

    for (const { label, value } of modelRadar(model)) {
      const row = el('div', 'stat-row')
      row.appendChild(el('span', 'stat-label', label))
      const bar = el('div', 'stat-bar')
      const fill = el('i')
      fill.style.width = `${clamp(value, 0.08, 1) * 100}%`
      bar.appendChild(fill)
      row.appendChild(bar)
      card.appendChild(row)
    }

    card.addEventListener('click', () => {
      this.selected = model.id
      this.highlight()
      this.onSelect(model.id)
    })
    return card
  }

  private highlight(): void {
    for (const [id, card] of this.cards) {
      card.classList.toggle('active', id === this.selected)
    }
  }

  show(selected: string, handlers: { onSelect: (id: string) => void; onClose: () => void }): void {
    this.selected = selected
    this.onSelect = handlers.onSelect
    this.onClose = handlers.onClose
    this.highlight()
    this.root.classList.remove('hidden')
  }

  hide(): void {
    this.root.classList.add('hidden')
  }
}
