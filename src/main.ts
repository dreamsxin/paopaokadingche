import './ui/styles.css'
import { Game } from './core/Game'

const viewport = document.getElementById('viewport')
const uiRoot = document.getElementById('ui')

if (!viewport || !uiRoot) {
  throw new Error('缺少 #viewport / #ui 容器')
}

new Game(viewport, uiRoot)
