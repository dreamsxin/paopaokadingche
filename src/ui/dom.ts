export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag)
  if (className) node.className = className
  if (text !== undefined) node.textContent = text
  return node
}

export function button(label: string, className = 'btn', onClick?: () => void): HTMLButtonElement {
  const b = el('button', className, label)
  if (onClick) b.addEventListener('click', onClick)
  return b
}
