import * as THREE from 'three'
import type { TrackSpline } from './TrackSpline'
import { makeRandom } from '../core/math'

function ribbon(
  track: TrackSpline,
  innerOffset: number,
  outerOffset: number,
  y: number,
  pick: (i: number) => boolean,
): THREE.BufferGeometry {
  const s = track.samples
  const n = s.length
  const pos: number[] = []
  const idx: number[] = []
  const uv: number[] = []
  for (let i = 0; i < n; i++) {
    const a = s[i]
    const b = s[(i + 1) % n]
    if (!pick(i)) continue
    const base = pos.length / 3
    for (const sm of [a, b]) {
      const p1 = sm.pos.clone().addScaledVector(sm.right, innerOffset)
      const p2 = sm.pos.clone().addScaledVector(sm.right, outerOffset)
      pos.push(p1.x, y, p1.z, p2.x, y, p2.z)
      const v = sm.dist / 10
      uv.push(0, v, 1, v)
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

function checkerTexture(): THREE.Texture {
  const c = document.createElement('canvas')
  c.width = 64
  c.height = 64
  const g = c.getContext('2d')!
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
  tex.repeat.set(6, 1)
  return tex
}

/** 生成赛道及周边场景（路面、路肩、起跑线、拱门、树木、草地） */
export function buildTrack(track: TrackSpline): THREE.Group {
  const group = new THREE.Group()
  const hw = track.halfWidth

  // 草地
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(2400, 2400),
    new THREE.MeshLambertMaterial({ color: 0x3f7d46 }),
  )
  ground.rotation.x = -Math.PI / 2
  ground.position.set(20, -0.05, 120)
  group.add(ground)

  // 路面
  const road = new THREE.Mesh(
    ribbon(track, -hw, hw, 0.02, () => true),
    new THREE.MeshLambertMaterial({ color: 0x4a4f63 }),
  )
  group.add(road)

  // 中线
  group.add(
    new THREE.Mesh(
      ribbon(track, -0.25, 0.25, 0.04, (i) => Math.floor(i / 10) % 2 === 0),
      new THREE.MeshBasicMaterial({ color: 0xd8dcea }),
    ),
  )

  // 红白路肩
  for (const side of [-1, 1]) {
    const inner = side * hw
    const outer = side * (hw + 1.6)
    group.add(
      new THREE.Mesh(
        ribbon(track, inner, outer, 0.05, (i) => Math.floor(i / 7) % 2 === 0),
        new THREE.MeshLambertMaterial({ color: 0xe14b4b }),
      ),
    )
    group.add(
      new THREE.Mesh(
        ribbon(track, inner, outer, 0.05, (i) => Math.floor(i / 7) % 2 === 1),
        new THREE.MeshLambertMaterial({ color: 0xf3f5fa }),
      ),
    )
  }

  // 起跑线 + 拱门
  const s0 = track.samples[0]
  const line = new THREE.Mesh(
    new THREE.PlaneGeometry(hw * 2, 5),
    new THREE.MeshBasicMaterial({ map: checkerTexture() }),
  )
  line.rotation.x = -Math.PI / 2
  line.rotation.z = -s0.angle
  line.position.set(s0.pos.x, 0.06, s0.pos.z)
  group.add(line)

  const pillarMat = new THREE.MeshLambertMaterial({ color: 0xffb03a })
  for (const side of [-1, 1]) {
    const p = s0.pos.clone().addScaledVector(s0.right, side * (hw + 2.2))
    const pillar = new THREE.Mesh(new THREE.BoxGeometry(1.4, 9, 1.4), pillarMat)
    pillar.position.set(p.x, 4.5, p.z)
    group.add(pillar)
  }
  const banner = new THREE.Mesh(
    new THREE.BoxGeometry(hw * 2 + 6, 2.4, 0.6),
    new THREE.MeshLambertMaterial({ color: 0x2f6bff }),
  )
  banner.position.set(s0.pos.x, 9.6, s0.pos.z)
  banner.rotation.y = -s0.angle
  group.add(banner)

  // 树木（确定性摆放，只放在赛道外侧）
  const rng = makeRandom(20260927)
  const count = 160
  const trunk = new THREE.InstancedMesh(
    new THREE.CylinderGeometry(0.4, 0.5, 2.6, 6),
    new THREE.MeshLambertMaterial({ color: 0x6b4a2a }),
    count,
  )
  const crown = new THREE.InstancedMesh(
    new THREE.ConeGeometry(2.6, 6.5, 7),
    new THREE.MeshLambertMaterial({ color: 0x2c8a4b }),
    count,
  )
  const m = new THREE.Matrix4()
  for (let i = 0; i < count; i++) {
    const t = rng()
    const side = rng() < 0.5 ? -1 : 1
    const off = side * (hw + 8 + rng() * 34)
    const p = track.pointAt(t, off)
    const scale = 0.8 + rng() * 0.7
    m.makeScale(scale, scale, scale).setPosition(p.x, 1.3 * scale, p.z)
    trunk.setMatrixAt(i, m)
    m.makeScale(scale, scale, scale).setPosition(p.x, 4.8 * scale, p.z)
    crown.setMatrixAt(i, m)
  }
  trunk.instanceMatrix.needsUpdate = true
  crown.instanceMatrix.needsUpdate = true
  group.add(trunk, crown)

  return group
}
