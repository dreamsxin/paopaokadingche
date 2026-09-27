import * as THREE from 'three'
import type { TrackSpline } from './TrackSpline'
import { makeRandom } from '../core/math'
import {
  RAINBOW,
  asphaltTexture,
  basic,
  checkerTexture,
  freezeStatic,
  grassTexture,
  stripeTexture,
  toon,
  toonGradient,
} from '../render/Materials'

/** 沿赛道生成横向带状网格（路面、路肩、中线都用它）。法线朝上，绕序与偏移顺序无关。 */
function ribbon(
  track: TrackSpline,
  offsetA: number,
  offsetB: number,
  y: number,
  pick: (i: number) => boolean,
  vScale = 10,
): THREE.BufferGeometry {
  const innerOffset = Math.min(offsetA, offsetB)
  const outerOffset = Math.max(offsetA, offsetB)
  const s = track.samples
  const n = s.length
  const pos: number[] = []
  const idx: number[] = []
  const uv: number[] = []
  for (let i = 0; i < n; i++) {
    if (!pick(i)) continue
    const a = s[i]
    const b = s[(i + 1) % n]
    const base = pos.length / 3
    for (const sm of [a, b]) {
      const p1 = sm.pos.clone().addScaledVector(sm.right, innerOffset)
      const p2 = sm.pos.clone().addScaledVector(sm.right, outerOffset)
      pos.push(p1.x, y, p1.z, p2.x, y, p2.z)
      const v = sm.dist / vScale
      uv.push(0, v, 1, v)
    }
    // 绕序保证法线朝 +Y，否则会被背面剔除掉（路面直接消失）
    idx.push(base, base + 1, base + 2, base + 1, base + 3, base + 2)
  }
  const geo = new THREE.BufferGeometry()
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2))
  geo.setIndex(idx)
  geo.computeVertexNormals()
  return geo
}

/** 沿赛道生成竖直挡墙（护栏面板） */
function fence(
  track: TrackSpline,
  offset: number,
  y0: number,
  y1: number,
  step = 2,
): THREE.BufferGeometry {
  const s = track.samples
  const n = s.length
  const pos: number[] = []
  const idx: number[] = []
  const uv: number[] = []
  for (let i = 0; i < n; i += step) {
    const a = s[i]
    const b = s[(i + step) % n]
    const base = pos.length / 3
    for (const sm of [a, b]) {
      const p = sm.pos.clone().addScaledVector(sm.right, offset)
      pos.push(p.x, y0, p.z, p.x, y1, p.z)
      const u = sm.dist / 6
      uv.push(u, 0, u, 1)
    }
    idx.push(base, base + 2, base + 1, base + 1, base + 2, base + 3)
  }
  const geo = new THREE.BufferGeometry()
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2))
  geo.setIndex(idx)
  geo.computeVertexNormals()
  return geo
}

/** 跨赛道的彩虹拱门：红色在最外圈，落脚点在护栏之外 */
function rainbowArch(track: TrackSpline, t: number): THREE.Group {
  const g = new THREE.Group()
  const s = track.sampleAt(t)
  const baseRadius = track.halfWidth + 6
  RAINBOW.forEach((color, i) => {
    const ring = new THREE.Mesh(
      new THREE.TorusGeometry(baseRadius + (RAINBOW.length - 1 - i) * 0.62, 0.3, 6, 28, Math.PI),
      toon(color),
    )
    g.add(ring)
  })
  g.position.set(s.pos.x, 0, s.pos.z)
  g.rotation.y = -(s.angle + Math.PI / 2)
  return g
}

/** 观众看台：阶梯式座席 + 条纹遮阳棚 */
function stand(track: TrackSpline, t: number, side: number): THREE.Group {
  const g = new THREE.Group()
  const s = track.sampleAt(t)
  // 三级阶梯座席，越往后越高
  for (let i = 0; i < 3; i++) {
    const tier = new THREE.Mesh(
      new THREE.BoxGeometry(22, 1.6 + i * 1.6, 3),
      toon(i % 2 === 0 ? 0xc6d0e6 : 0xa9b6d2),
    )
    tier.position.set(0, (1.6 + i * 1.6) / 2, -i * 3)
    g.add(tier)
  }
  const roof = new THREE.Mesh(new THREE.BoxGeometry(23, 0.6, 11), toon(0xffffff, stripeTexture()))
  roof.position.set(0, 8, -3)
  g.add(roof)
  for (const x of [-10.6, 10.6]) {
    const post = new THREE.Mesh(new THREE.BoxGeometry(0.7, 8, 0.7), toon(0x6b7793))
    post.position.set(x, 4, 1.6)
    g.add(post)
  }
  const p = s.pos.clone().addScaledVector(s.right, side * (track.halfWidth + 16))
  g.position.set(p.x, 0, p.z)
  g.rotation.y = -(s.angle + (side > 0 ? Math.PI / 2 : -Math.PI / 2))
  return g
}

/** 天空中的热气球 */
function balloon(x: number, y: number, z: number, color: number): THREE.Group {
  const g = new THREE.Group()
  const body = new THREE.Mesh(new THREE.SphereGeometry(7, 14, 12), toon(color))
  body.scale.y = 1.25
  const basket = new THREE.Mesh(new THREE.BoxGeometry(3, 2.4, 3), toon(0x9a6b3a))
  basket.position.y = -11
  const rope = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 6, 5), basic(0x5a5f70))
  rope.position.y = -7
  g.add(body, basket, rope)
  g.position.set(x, y, z)
  return g
}

/**
 * 生成赛道与周边场景。全部程序化，静态物件统一冻结矩阵；同类物件走 InstancedMesh。
 */
export function buildTrack(track: TrackSpline): THREE.Group {
  const group = new THREE.Group()
  const hw = track.halfWidth
  const rng = makeRandom(20260927)

  // 草地
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(2800, 2800),
    toon(0xffffff, grassTexture()),
  )
  ground.rotation.x = -Math.PI / 2
  ground.position.set(20, -0.06, 120)
  group.add(ground)

  // 路面（沥青 + 两侧白边线来自贴图）
  group.add(new THREE.Mesh(ribbon(track, -hw, hw, 0.02, () => true, 12), toon(0xffffff, asphaltTexture())))

  // 中线虚线
  group.add(
    new THREE.Mesh(
      ribbon(track, -0.28, 0.28, 0.05, (i) => Math.floor(i / 10) % 2 === 0),
      basic(0xe6ebf7),
    ),
  )

  // 红白路肩 + 护栏
  const railMat = new THREE.MeshToonMaterial({
    color: 0x3f6bd8,
    gradientMap: toonGradient(),
    side: THREE.DoubleSide,
  })
  for (const side of [-1, 1]) {
    const inner = side * hw
    const outer = side * (hw + 1.7)
    group.add(
      new THREE.Mesh(
        ribbon(track, inner, outer, 0.06, (i) => Math.floor(i / 7) % 2 === 0),
        toon(0xe6484c),
      ),
    )
    group.add(
      new THREE.Mesh(
        ribbon(track, inner, outer, 0.06, (i) => Math.floor(i / 7) % 2 === 1),
        toon(0xf6f8ff),
      ),
    )
    // 护栏面板 + 立柱（与 RaceDirector 的撞墙边界 halfWidth + WALL_MARGIN 对齐）
    group.add(new THREE.Mesh(fence(track, side * (hw + 4), 0.5, 1.6), railMat))
  }

  const postCount = 120
  const posts = new THREE.InstancedMesh(
    new THREE.BoxGeometry(0.45, 1.9, 0.45),
    toon(0xd7dded),
    postCount * 2,
  )
  const m = new THREE.Matrix4()
  let pi = 0
  for (let i = 0; i < postCount; i++) {
    const t = i / postCount
    for (const side of [-1, 1]) {
      const p = track.pointAt(t, side * (hw + 4))
      m.identity().setPosition(p.x, 0.95, p.z)
      posts.setMatrixAt(pi++, m)
    }
  }
  posts.instanceMatrix.needsUpdate = true
  group.add(posts)

  // 起跑线 + 拱门
  const s0 = track.samples[0]
  const line = new THREE.Mesh(
    new THREE.PlaneGeometry(hw * 2, 6),
    new THREE.MeshBasicMaterial({ map: checkerTexture() }),
  )
  line.rotation.x = -Math.PI / 2
  line.rotation.z = -s0.angle
  line.position.set(s0.pos.x, 0.07, s0.pos.z)
  group.add(line)

  for (const side of [-1, 1]) {
    const p = s0.pos.clone().addScaledVector(s0.right, side * (hw + 4.6))
    const pillar = new THREE.Mesh(new THREE.BoxGeometry(1.6, 10, 1.6), toon(0xffb03a))
    pillar.position.set(p.x, 5, p.z)
    group.add(pillar)
  }
  const banner = new THREE.Mesh(new THREE.BoxGeometry(hw * 2 + 7, 2.6, 0.7), toon(0x2f6bff))
  banner.position.set(s0.pos.x, 10.4, s0.pos.z)
  banner.rotation.y = -s0.angle
  group.add(banner)

  // 彩虹拱门 / 看台 / 热气球
  for (const t of [0.17, 0.46, 0.79]) group.add(rainbowArch(track, t))
  group.add(stand(track, 0.02, -1))
  group.add(stand(track, 0.33, 1))
  group.add(balloon(120, 96, -160, RAINBOW[0]))
  group.add(balloon(-210, 118, 90, RAINBOW[4]))
  group.add(balloon(320, 104, 210, RAINBOW[3]))

  // 树木（确定性摆放，只放在赛道外侧）
  const treeCount = 190
  const trunk = new THREE.InstancedMesh(
    new THREE.CylinderGeometry(0.4, 0.55, 2.8, 6),
    toon(0x7a5230),
    treeCount,
  )
  const crown = new THREE.InstancedMesh(new THREE.ConeGeometry(2.7, 7, 8), toon(0x2f9a52), treeCount)
  for (let i = 0; i < treeCount; i++) {
    const t = rng()
    const side = rng() < 0.5 ? -1 : 1
    const off = side * (hw + 9 + rng() * 40)
    const p = track.pointAt(t, off)
    const scale = 0.8 + rng() * 0.8
    m.makeScale(scale, scale, scale).setPosition(p.x, 1.4 * scale, p.z)
    trunk.setMatrixAt(i, m)
    m.makeScale(scale, scale, scale).setPosition(p.x, 5.2 * scale, p.z)
    crown.setMatrixAt(i, m)
  }
  trunk.instanceMatrix.needsUpdate = true
  crown.instanceMatrix.needsUpdate = true
  group.add(trunk, crown)

  // 灌木与岩石，贴近路肩做近景层次
  const bushCount = 150
  const bush = new THREE.InstancedMesh(new THREE.SphereGeometry(1.5, 8, 6), toon(0x3fb36a), bushCount)
  const rock = new THREE.InstancedMesh(new THREE.DodecahedronGeometry(1.1, 0), toon(0x9aa3b5), 70)
  for (let i = 0; i < bushCount; i++) {
    const side = rng() < 0.5 ? -1 : 1
    const p = track.pointAt(rng(), side * (hw + 5.5 + rng() * 6))
    const s = 0.6 + rng() * 0.9
    m.makeScale(s, s * 0.8, s).setPosition(p.x, 0.7 * s, p.z)
    bush.setMatrixAt(i, m)
  }
  for (let i = 0; i < 70; i++) {
    const side = rng() < 0.5 ? -1 : 1
    const p = track.pointAt(rng(), side * (hw + 7 + rng() * 26))
    const s = 0.6 + rng() * 1.2
    m.makeScale(s, s * 0.7, s).setPosition(p.x, 0.3 * s, p.z)
    rock.setMatrixAt(i, m)
  }
  bush.instanceMatrix.needsUpdate = true
  rock.instanceMatrix.needsUpdate = true
  group.add(bush, rock)

  freezeStatic(group)
  return group
}
