import * as THREE from 'three'
import { makeRandom } from '../core/math'

/**
 * 美术资源中心：卡通渲染用的 toon 色阶、程序化贴图与共享材质/几何缓存。
 * 全部程序生成，不依赖外部美术资源，同时保证同类物件复用同一份材质以压低 draw call 与显存。
 */

let gradient: THREE.DataTexture | null = null

/** toon 色阶（3 段），卡通赛车的关键 */
export function toonGradient(): THREE.DataTexture {
  if (gradient) return gradient
  const data = new Uint8Array([96, 178, 255])
  const tex = new THREE.DataTexture(data, data.length, 1, THREE.RedFormat)
  tex.minFilter = THREE.NearestFilter
  tex.magFilter = THREE.NearestFilter
  tex.generateMipmaps = false
  tex.needsUpdate = true
  gradient = tex
  return tex
}

const toonCache = new Map<string, THREE.MeshToonMaterial>()

/** 缓存版卡通材质 */
export function toon(color: number, map?: THREE.Texture): THREE.MeshToonMaterial {
  const key = `${color}-${map?.uuid ?? 'n'}`
  const hit = toonCache.get(key)
  if (hit) return hit
  const mat = new THREE.MeshToonMaterial({ color, gradientMap: toonGradient(), map })
  toonCache.set(key, mat)
  return mat
}

const basicCache = new Map<number, THREE.MeshBasicMaterial>()

export function basic(color: number): THREE.MeshBasicMaterial {
  const hit = basicCache.get(color)
  if (hit) return hit
  const mat = new THREE.MeshBasicMaterial({ color })
  basicCache.set(color, mat)
  return mat
}

/** 描边材质：反向壳描边（BackSide + 放大），卡通风格的廉价轮廓 */
let outlineMat: THREE.MeshBasicMaterial | null = null
export function outline(): THREE.MeshBasicMaterial {
  if (!outlineMat) {
    outlineMat = new THREE.MeshBasicMaterial({ color: 0x151a2c, side: THREE.BackSide })
  }
  return outlineMat
}

function canvas(size: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement('canvas')
  c.width = size
  c.height = size
  return [c, c.getContext('2d')!]
}

let asphalt: THREE.Texture | null = null

/** 沥青：深灰底 + 颗粒噪点 + 两侧白色车道线 */
export function asphaltTexture(): THREE.Texture {
  if (asphalt) return asphalt
  const [c, g] = canvas(256)
  g.fillStyle = '#4d5266'
  g.fillRect(0, 0, 256, 256)
  const rng = makeRandom(4242)
  for (let i = 0; i < 5200; i++) {
    const v = rng()
    g.fillStyle = v > 0.5 ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.10)'
    g.fillRect(rng() * 256, rng() * 256, 2, 2)
  }
  // u 方向为赛道横向：两侧画出白色边线
  g.fillStyle = 'rgba(236,242,255,0.85)'
  g.fillRect(6, 0, 5, 256)
  g.fillRect(245, 0, 5, 256)
  const tex = new THREE.CanvasTexture(c)
  tex.wrapS = THREE.ClampToEdgeWrapping
  tex.wrapT = THREE.RepeatWrapping
  tex.anisotropy = 4
  asphalt = tex
  return tex
}

let checker: THREE.Texture | null = null

/** 起跑线格纹 */
export function checkerTexture(): THREE.Texture {
  if (checker) return checker
  const [c, g] = canvas(64)
  const cell = 16
  for (let y = 0; y < 4; y++) {
    for (let x = 0; x < 4; x++) {
      g.fillStyle = (x + y) % 2 === 0 ? '#ffffff' : '#1a1f2e'
      g.fillRect(x * cell, y * cell, cell, cell)
    }
  }
  const tex = new THREE.CanvasTexture(c)
  tex.wrapS = THREE.RepeatWrapping
  tex.wrapT = THREE.RepeatWrapping
  tex.repeat.set(8, 1)
  checker = tex
  return tex
}

let soft: THREE.Texture | null = null

/** 径向柔和圆点：烟雾、火花、车底阴影共用 */
export function softCircleTexture(): THREE.Texture {
  if (soft) return soft
  const [c, g] = canvas(128)
  const grad = g.createRadialGradient(64, 64, 2, 64, 64, 62)
  grad.addColorStop(0, 'rgba(255,255,255,1)')
  grad.addColorStop(0.45, 'rgba(255,255,255,0.55)')
  grad.addColorStop(1, 'rgba(255,255,255,0)')
  g.fillStyle = grad
  g.fillRect(0, 0, 128, 128)
  soft = new THREE.CanvasTexture(c)
  return soft
}

let cloud: THREE.Texture | null = null

/** 云朵：几个叠加的柔和圆 */
export function cloudTexture(): THREE.Texture {
  if (cloud) return cloud
  const [c, g] = canvas(256)
  const blob = (x: number, y: number, r: number) => {
    const grad = g.createRadialGradient(x, y, r * 0.15, x, y, r)
    grad.addColorStop(0, 'rgba(255,255,255,0.98)')
    grad.addColorStop(0.6, 'rgba(255,255,255,0.7)')
    grad.addColorStop(1, 'rgba(255,255,255,0)')
    g.fillStyle = grad
    g.beginPath()
    g.arc(x, y, r, 0, Math.PI * 2)
    g.fill()
  }
  blob(96, 150, 62)
  blob(150, 132, 74)
  blob(196, 156, 52)
  blob(62, 164, 42)
  cloud = new THREE.CanvasTexture(c)
  return cloud
}

let grass: THREE.Texture | null = null

/** 草地：深浅绿斑驳，避免一整片纯色 */
export function grassTexture(): THREE.Texture {
  if (grass) return grass
  const [c, g] = canvas(256)
  g.fillStyle = '#54a05c'
  g.fillRect(0, 0, 256, 256)
  const rng = makeRandom(1357)
  for (let i = 0; i < 2600; i++) {
    const v = rng()
    g.fillStyle = v > 0.66 ? '#5fae66' : v > 0.33 ? '#4b9553' : '#68b56f'
    const s = 3 + rng() * 9
    g.fillRect(rng() * 256, rng() * 256, s, s)
  }
  const tex = new THREE.CanvasTexture(c)
  tex.wrapS = THREE.RepeatWrapping
  tex.wrapT = THREE.RepeatWrapping
  tex.repeat.set(70, 70)
  grass = tex
  return tex
}

let stripe: THREE.Texture | null = null

/** 看台条纹（红白遮阳棚） */
export function stripeTexture(): THREE.Texture {
  if (stripe) return stripe
  const [c, g] = canvas(64)
  for (let i = 0; i < 8; i++) {
    g.fillStyle = i % 2 === 0 ? '#ff5f5f' : '#fdfdfd'
    g.fillRect(i * 8, 0, 8, 64)
  }
  const tex = new THREE.CanvasTexture(c)
  tex.wrapS = THREE.RepeatWrapping
  tex.wrapT = THREE.RepeatWrapping
  tex.repeat.set(4, 1)
  stripe = tex
  return tex
}

/** 彩虹 7 色，拱门与氮气特效共用 */
export const RAINBOW = [0xff5252, 0xff9f3c, 0xffe14f, 0x4fd86a, 0x4fc3ff, 0x5a6bff, 0xb35aff]

/** 把静态物件的矩阵固定下来，省掉每帧 updateMatrixWorld 的开销 */
export function freezeStatic(root: THREE.Object3D): void {
  root.updateMatrixWorld(true)
  root.traverse((o) => {
    o.matrixAutoUpdate = false
  })
}
