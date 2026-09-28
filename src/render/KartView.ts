import * as THREE from 'three'
import type { KartPhysics } from '../physics/KartPhysics'
import { clamp, damp, makeRandom } from '../core/math'
import { outline, softCircleTexture, toon } from './Materials'
import type { KartStyle } from '../karts/catalog'

const DEFAULT_STYLE: KartStyle = { body: [1, 1, 1], nose: 1, wing: 1, fin: 1, thrusters: 2 }

const SPARK_COUNT = 40
const SPARK_LIFE = 0.42
const SMOKE_COUNT = 36
const SMOKE_LIFE = 0.9
const SKID_QUADS = 110
const SKID_INTERVAL = 0.03

/** 集气时霓虹渐亮的目标色 / 氮气时的目标色 */
const NEON_CHARGE = new THREE.Color(0xfff3b0)
const NEON_NITRO = new THREE.Color(0xff6ad5)

interface Particle {
  x: number
  y: number
  z: number
  vx: number
  vy: number
  vz: number
  life: number
  max: number
}

// 共享几何：所有卡丁车复用，减少显存与创建开销
const GEO = {
  hull: new THREE.BoxGeometry(3.4, 0.4, 1.7),
  deck: new THREE.BoxGeometry(2.3, 0.32, 1.3),
  nose: new THREE.ConeGeometry(0.66, 1.05, 4),
  canopy: new THREE.SphereGeometry(0.6, 14, 8, 0, Math.PI * 2, 0, Math.PI / 2),
  head: new THREE.SphereGeometry(0.28, 12, 10),
  fin: new THREE.BoxGeometry(0.95, 0.55, 0.1),
  wing: new THREE.BoxGeometry(0.55, 0.1, 1.95),
  wingStrut: new THREE.BoxGeometry(0.14, 0.55, 0.14),
  sideStrip: new THREE.BoxGeometry(2.4, 0.08, 0.12),
  noseStrip: new THREE.BoxGeometry(0.12, 0.1, 1.0),
  lightBar: new THREE.BoxGeometry(0.14, 0.18, 1.35),
  thruster: new THREE.CylinderGeometry(0.3, 0.26, 0.85, 12),
  thrusterRing: new THREE.TorusGeometry(0.3, 0.06, 6, 16),
  hubRing: new THREE.TorusGeometry(0.24, 0.045, 6, 16),
  tire: new THREE.CylinderGeometry(0.45, 0.45, 0.4, 14),
  rim: new THREE.CylinderGeometry(0.24, 0.24, 0.42, 10),
  flame: new THREE.ConeGeometry(0.3, 1.9, 10),
  shadow: new THREE.PlaneGeometry(4.8, 3.1),
  underglow: new THREE.PlaneGeometry(4.6, 2.8),
}

/**
 * 近未来科幻卡丁车：楔形车体 + 玻璃座舱 + 双推进器 + 霓虹光带。
 * 霓虹亮度与漂移集气/喷射联动 —— 车身本身就是一根"气槽"。
 */
export class KartView {
  readonly group = new THREE.Group()
  private body = new THREE.Group()
  private wheels: THREE.Group[] = []
  private steerPivots: THREE.Group[] = []
  private flames: THREE.Mesh[] = []
  private nozzles: Array<{ pivot: THREE.Group; ring: THREE.Mesh; flame: THREE.Mesh }> = []
  private flameMat: THREE.MeshBasicMaterial
  private nozzleScale = 1
  private neonMat: THREE.MeshBasicMaterial
  private neonBase: THREE.Color
  private glowMat: THREE.MeshBasicMaterial
  private shadow: THREE.Mesh
  private sparks: THREE.Points
  private smoke: THREE.Points
  private sparkPool: Particle[] = []
  private smokePool: Particle[] = []
  private sparkCursor = 0
  private smokeCursor = 0
  private skid: THREE.Mesh
  private skidCursor = 0
  private skidTimer = 0
  private lastSkid: { lx: number; lz: number; rx: number; rz: number } | null = null
  private rng: () => number
  private roll = 0
  private squash = 1
  private heat = 0

  constructor(color: number, scene: THREE.Scene, seed = 7, style: KartStyle = DEFAULT_STYLE) {
    this.rng = makeRandom(seed * 7919 + 13)
    const [bx, by, bz] = style.body
    const paint = toon(color)
    // 深色车漆：座舱/裙边用，撑出层次
    const deepColor = new THREE.Color(color).multiplyScalar(0.55)
    const deep = toon(deepColor.getHex())
    const dark = toon(0x1b2033)
    const tire = toon(0x14182a)
    const metal = toon(0x8f97ab)
    const glass = new THREE.MeshToonMaterial({
      color: 0x4fc3ff,
      transparent: true,
      opacity: 0.45,
    })

    // 霓虹：每台车一份材质（颜色要随集气变化），比车漆亮一档
    this.neonBase = new THREE.Color(color).lerp(new THREE.Color(0xffffff), 0.3)
    this.neonMat = new THREE.MeshBasicMaterial({ color: this.neonBase.clone() })

    const hull = new THREE.Mesh(GEO.hull, paint)
    hull.scale.set(bx, by, bz)
    hull.position.y = 0.44 * by
    const deck = new THREE.Mesh(GEO.deck, deep)
    deck.scale.set(bx, by, bz)
    deck.position.set(-0.25 * bx, 0.72 * by, 0)
    // 楔形车头：压扁的四棱锥，尖端朝前；长度由车型决定
    const nose = new THREE.Mesh(GEO.nose, paint)
    nose.rotation.z = -Math.PI / 2
    nose.scale.set(1, style.nose, 0.75 * bz)
    nose.position.set(1.78 * bx, 0.46 * by, 0)
    const canopy = new THREE.Mesh(GEO.canopy, glass)
    canopy.scale.set(1.15, 0.95, 0.85)
    canopy.position.set(-0.15 * bx, 0.86 * by, 0)
    const head = new THREE.Mesh(GEO.head, toon(0xffe3c0))
    head.position.set(-0.3 * bx, 0.98 * by, 0)
    const fin = new THREE.Mesh(GEO.fin, deep)
    fin.scale.set(1, style.fin, 1)
    fin.position.set(-1.3 * bx, 0.78 * by + 0.27 * style.fin, 0)
    const finEdge = new THREE.Mesh(GEO.noseStrip, this.neonMat)
    finEdge.scale.set(7, 0.6, 0.8)
    finEdge.rotation.y = Math.PI / 2
    finEdge.position.set(-1.3 * bx, 0.78 * by + 0.55 * style.fin, 0)
    const wing = new THREE.Mesh(GEO.wing, dark)
    wing.scale.set(1, 1, style.wing)
    wing.position.set(-2.0 * bx, 1.22 * by, 0)
    const wingGlow = new THREE.Mesh(GEO.lightBar, this.neonMat)
    wingGlow.scale.set(0.5, 0.35, 1.4 * style.wing)
    wingGlow.position.set(-2.18 * bx, 1.22 * by, 0)
    const lightBar = new THREE.Mesh(GEO.lightBar, this.neonMat)
    lightBar.scale.set(1, 1, bz)
    lightBar.position.set(-2.1 * bx, 0.7 * by, 0)
    const noseStrip = new THREE.Mesh(GEO.noseStrip, this.neonMat)
    noseStrip.position.set(1.55 * bx, 0.62 * by, 0)

    this.body.add(hull, deck, nose, canopy, head, fin, finEdge, wing, wingGlow, lightBar, noseStrip)

    // 侧裙霓虹 + 悬浮尾翼支柱
    for (const z of [-1, 1]) {
      const strip = new THREE.Mesh(GEO.sideStrip, this.neonMat)
      strip.scale.set(bx, 1, 1)
      strip.position.set(0.15 * bx, 0.52 * by, z * 0.88 * bz)
      const skirt = new THREE.Mesh(GEO.sideStrip, deep)
      skirt.scale.set(1.05 * bx, 2.6, 1.6)
      skirt.position.set(0.15 * bx, 0.32 * by, z * 0.9 * bz)
      const strut = new THREE.Mesh(GEO.wingStrut, dark)
      strut.position.set(-1.95 * bx, 0.92 * by, z * 0.62 * style.wing)
      this.body.add(strip, skirt, strut)
    }

    // 推进器：1 个居中大喷，或 2 个对称喷口。每个喷口自带 pivot，可做矢量偏转
    const thrusterZ = style.thrusters === 1 ? [0] : [-0.52 * bz, 0.52 * bz]
    const thrusterScale = style.thrusters === 1 ? 1.35 : 1
    this.nozzleScale = thrusterScale
    this.flameMat = new THREE.MeshBasicMaterial({
      color: 0x8fd8ff,
      transparent: true,
      opacity: 0.85,
    })
    for (const z of thrusterZ) {
      const pivot = new THREE.Group()
      pivot.position.set(-1.85 * bx, 0.6 * by, z)
      const thruster = new THREE.Mesh(GEO.thruster, metal)
      thruster.rotation.z = Math.PI / 2
      thruster.scale.setScalar(thrusterScale)
      const ring = new THREE.Mesh(GEO.thrusterRing, this.neonMat)
      ring.rotation.y = Math.PI / 2
      ring.scale.setScalar(thrusterScale)
      ring.position.x = -0.43 * bx
      const flame = new THREE.Mesh(GEO.flame, this.flameMat)
      flame.rotation.z = Math.PI / 2
      flame.position.x = -1.15 * bx
      flame.visible = false
      pivot.add(thruster, ring, flame)
      this.body.add(pivot)
      this.nozzles.push({ pivot, ring, flame })
      this.flames.push(flame)
    }

    // 卡通描边：只给车体主块，避免 draw call 翻倍
    const shell = new THREE.Mesh(GEO.hull, outline())
    shell.scale.set(bx * 1.09, by * 1.09, bz * 1.09)
    shell.position.copy(hull.position)
    this.body.add(shell)

    for (const [wx, wz, front] of [
      [1.25, 1.0, 1],
      [1.25, -1.0, 1],
      [-1.3, 1.02, 0],
      [-1.3, -1.02, 0],
    ] as const) {
      // steerPivot(转向) -> spinPivot(滚动) -> 轮胎/轮毂/霓虹轮圈
      const steerPivot = new THREE.Group()
      steerPivot.position.set(wx * bx, 0.45, wz * bz)
      const spinPivot = new THREE.Group()
      const tireMesh = new THREE.Mesh(GEO.tire, tire)
      tireMesh.rotation.x = Math.PI / 2
      const rimMesh = new THREE.Mesh(GEO.rim, metal)
      rimMesh.rotation.x = Math.PI / 2
      const hub = new THREE.Mesh(GEO.hubRing, this.neonMat)
      hub.position.z = wz > 0 ? 0.21 : -0.21
      spinPivot.add(tireMesh, rimMesh, hub)
      steerPivot.add(spinPivot)
      this.body.add(steerPivot)
      this.wheels.push(spinPivot)
      if (front) this.steerPivots.push(steerPivot)
    }

    this.group.add(this.body)
    scene.add(this.group)

    // 车底霓虹地灯（随集气变亮）
    this.glowMat = new THREE.MeshBasicMaterial({
      map: softCircleTexture(),
      color: this.neonBase.clone(),
      transparent: true,
      opacity: 0.25,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    })
    const glow = new THREE.Mesh(GEO.underglow, this.glowMat)
    glow.rotation.x = -Math.PI / 2
    glow.position.y = 0.06
    this.group.add(glow)

    // 车底软阴影（比 shadowMap 便宜得多，移动端也稳）
    this.shadow = new THREE.Mesh(
      GEO.shadow,
      new THREE.MeshBasicMaterial({
        map: softCircleTexture(),
        color: 0x0a1020,
        transparent: true,
        opacity: 0.34,
        depthWrite: false,
      }),
    )
    this.shadow.rotation.x = -Math.PI / 2
    this.shadow.position.y = 0.04
    scene.add(this.shadow)

    this.sparks = this.makePoints(SPARK_COUNT, 0xbfefff, 0.6, 0.95, this.sparkPool, SPARK_LIFE)
    this.smoke = this.makePoints(SMOKE_COUNT, 0xdfe6f2, 2.4, 0.34, this.smokePool, SMOKE_LIFE)
    scene.add(this.sparks, this.smoke)

    this.skid = this.makeSkid()
    scene.add(this.skid)
  }

  private makePoints(
    count: number,
    color: number,
    size: number,
    opacity: number,
    pool: Particle[],
    life: number,
  ): THREE.Points {
    const geo = new THREE.BufferGeometry()
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(count * 3), 3))
    const points = new THREE.Points(
      geo,
      new THREE.PointsMaterial({
        color,
        size,
        map: softCircleTexture(),
        transparent: true,
        opacity,
        depthWrite: false,
      }),
    )
    points.frustumCulled = false
    for (let i = 0; i < count; i++) {
      pool.push({ x: 0, y: -500, z: 0, vx: 0, vy: 0, vz: 0, life: 0, max: life })
    }
    return points
  }

  private makeSkid(): THREE.Mesh {
    const geo = new THREE.BufferGeometry()
    const pos = new Float32Array(SKID_QUADS * 4 * 3)
    for (let i = 0; i < pos.length; i += 3) pos[i + 1] = -500
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3))
    const idx: number[] = []
    for (let q = 0; q < SKID_QUADS; q++) {
      const b = q * 4
      idx.push(b, b + 2, b + 1, b + 1, b + 2, b + 3)
    }
    geo.setIndex(idx)
    const mesh = new THREE.Mesh(
      geo,
      new THREE.MeshBasicMaterial({
        color: 0x23262f,
        transparent: true,
        opacity: 0.42,
        depthWrite: false,
      }),
    )
    mesh.frustumCulled = false
    return mesh
  }

  sync(kart: KartPhysics, dt: number, input?: { steer: number }): void {
    this.group.position.set(kart.x, 0, kart.z)
    this.group.rotation.y = -kart.heading

    // 侧滑侧倾 + 喷射时轻微前压
    this.roll = damp(this.roll, clamp(kart.slip * 0.3, -0.32, 0.32), 8, dt)
    this.body.rotation.x = this.roll
    const d = kart.drift
    const wantSquash = d.boosting ? 0.94 : 1
    this.squash = damp(this.squash, wantSquash, 7, dt)
    this.body.scale.set(1 + (1 - this.squash) * 1.5, this.squash, 1)

    const spin = (kart.speed * dt) / 0.45
    for (const w of this.wheels) w.rotation.z -= spin
    const steerAngle = clamp((input?.steer ?? 0) * 0.42 + kart.slip * 0.25, -0.6, 0.6)
    for (const p of this.steerPivots) p.rotation.y = -steerAngle

    this.shadow.position.set(kart.x, 0.04, kart.z)
    this.shadow.rotation.z = -kart.heading

    // 霓虹随集气/喷射升温：车身发光强度就是气槽读数
    const targetHeat = d.nitroTimer > 0 ? 1 : Math.max(clamp(d.charge, 0, 1), d.boostTimer > 0 ? 0.8 : 0)
    this.heat = damp(this.heat, targetHeat, 12, dt)
    const hot = d.nitroTimer > 0 ? NEON_NITRO : NEON_CHARGE
    this.neonMat.color.copy(this.neonBase).lerp(hot, this.heat)
    this.glowMat.color.copy(this.neonMat.color)
    this.glowMat.opacity = 0.2 + 0.55 * this.heat

    const boostQ = d.nitroTimer > 0 ? 1 : d.boostTimer > 0 ? 0.35 + 0.5 * d.boostStrength : 0
    this.updateNozzles(kart, steerAngle, boostQ)

    this.emit(kart, dt)
    this.advance(this.sparkPool, this.sparks, dt, 15, 0.05)
    this.advance(this.smokePool, this.smoke, dt, -1.2, 0.2)
  }

  /**
   * 矢量喷口：开度与尾焰随推力变化 —— 松油门喷口收拢无焰，满油门中等蓝焰，
   * 小喷/氮气才是长焰；喷口还会随转向做小角度偏转（推力矢量）。
   */
  private updateNozzles(kart: KartPhysics, steerAngle: number, boostQ: number): void {
    const d = kart.drift
    const t = kart.thrust
    const base = Math.min(1, t) // 0..1 油门段
    const extra = Math.max(0, t - 1) // >1 的喷射段
    const flicker = 0.9 + this.rng() * 0.2
    // 喷口开度：怠速 0.7，满油门 1.0，喷射时进一步张开
    const open = (0.7 + 0.3 * base + 0.3 * extra) * this.nozzleScale
    const visible = t > 0.12
    const length = (0.35 + 0.5 * base + 1.1 * extra) * flicker * this.nozzleScale
    const width = (0.45 + 0.3 * base + 0.35 * extra) * this.nozzleScale

    this.flameMat.color.setHex(
      d.nitroTimer > 0 ? 0xff6ad5 : boostQ > 0 ? 0x66ccff : 0x8fd8ff,
    )
    this.flameMat.opacity = 0.55 + 0.35 * Math.min(1, base + extra)

    for (const n of this.nozzles) {
      n.ring.scale.setScalar(open)
      // 推力矢量：喷口朝转向反方向偏一点，视觉上"推着车头转"
      n.pivot.rotation.y = steerAngle * 0.4
      n.flame.visible = visible
      if (visible) {
        n.flame.scale.set(width, length, width)
        // 焰锥半长 = 1.9/2 * length，锚点后移让焰根始终贴在喷口出口
        n.flame.position.x = -0.45 - 0.95 * length
      }
    }
  }

  private emit(kart: KartPhysics, dt: number): void {
    const drifting = kart.drift.state === 'drifting'
    const slipAbs = Math.abs(kart.slip)
    const rightX = -Math.sin(kart.heading)
    const rightZ = Math.cos(kart.heading)
    const rearX = kart.x - Math.cos(kart.heading) * 1.25
    const rearZ = kart.z - Math.sin(kart.heading) * 1.25

    if (drifting && slipAbs > 0.18) {
      const count = slipAbs > 0.5 ? 3 : 1
      for (let e = 0; e < count; e++) {
        const side = e % 2 === 0 ? 1 : -1
        const p = this.sparkPool[this.sparkCursor]
        this.sparkCursor = (this.sparkCursor + 1) % SPARK_COUNT
        p.x = rearX + rightX * side
        p.y = 0.24
        p.z = rearZ + rightZ * side
        const spread = (this.rng() - 0.5) * 6
        p.vx = -Math.cos(kart.velAngle) * 5 + spread
        p.vy = 3 + this.rng() * 4
        p.vz = -Math.sin(kart.velAngle) * 5 + spread
        p.life = p.max
      }
      const s = this.smokePool[this.smokeCursor]
      this.smokeCursor = (this.smokeCursor + 1) % SMOKE_COUNT
      const side = this.smokeCursor % 2 === 0 ? 1 : -1
      s.x = rearX + rightX * side * 1.05
      s.y = 0.3
      s.z = rearZ + rightZ * side * 1.05
      s.vx = -Math.cos(kart.velAngle) * 2 + (this.rng() - 0.5) * 3
      s.vy = 1.2 + this.rng() * 1.4
      s.vz = -Math.sin(kart.velAngle) * 2 + (this.rng() - 0.5) * 3
      s.life = s.max
    }

    // 胎印
    this.skidTimer -= dt
    const wantSkid = drifting && slipAbs > 0.22 && kart.speed > 8 && !kart.offRoad
    if (!wantSkid) {
      this.lastSkid = null
      return
    }
    if (this.skidTimer > 0) return
    this.skidTimer = SKID_INTERVAL
    const lx = rearX + rightX * 1.0
    const lz = rearZ + rightZ * 1.0
    const rx = rearX - rightX * 1.0
    const rz = rearZ - rightZ * 1.0
    if (this.lastSkid) {
      const attr = this.skid.geometry.getAttribute('position') as THREE.BufferAttribute
      const arr = attr.array as Float32Array
      const base = this.skidCursor * 4 * 3
      const y = 0.035
      const pts = [
        [this.lastSkid.lx, this.lastSkid.lz],
        [this.lastSkid.rx, this.lastSkid.rz],
        [lx, lz],
        [rx, rz],
      ]
      pts.forEach(([px, pz], i) => {
        arr[base + i * 3] = px
        arr[base + i * 3 + 1] = y
        arr[base + i * 3 + 2] = pz
      })
      attr.needsUpdate = true
      this.skidCursor = (this.skidCursor + 1) % SKID_QUADS
    }
    this.lastSkid = { lx, lz, rx, rz }
  }

  private advance(
    pool: Particle[],
    points: THREE.Points,
    dt: number,
    gravity: number,
    floor: number,
  ): void {
    const attr = points.geometry.getAttribute('position') as THREE.BufferAttribute
    const arr = attr.array as Float32Array
    for (let i = 0; i < pool.length; i++) {
      const p = pool[i]
      if (p.life > 0) {
        p.life -= dt
        p.x += p.vx * dt
        p.y += p.vy * dt
        p.z += p.vz * dt
        p.vy -= gravity * dt
        if (p.y < floor) {
          p.y = floor
          p.vy = 0
        }
      }
      const alive = p.life > 0
      arr[i * 3] = alive ? p.x : 0
      arr[i * 3 + 1] = alive ? p.y : -500
      arr[i * 3 + 2] = alive ? p.z : 0
    }
    attr.needsUpdate = true
  }

  dispose(scene: THREE.Scene): void {
    scene.remove(this.group, this.shadow, this.sparks, this.smoke, this.skid)
    this.skid.geometry.dispose()
    this.sparks.geometry.dispose()
    this.smoke.geometry.dispose()
    this.neonMat.dispose()
    this.glowMat.dispose()
    this.flameMat.dispose()
  }
}
