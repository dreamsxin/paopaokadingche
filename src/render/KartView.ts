import * as THREE from 'three'
import type { KartPhysics } from '../physics/KartPhysics'
import { clamp, damp, makeRandom } from '../core/math'

const SPARK_COUNT = 48
const SPARK_LIFE = 0.42

interface Spark {
  x: number
  y: number
  z: number
  vx: number
  vy: number
  vz: number
  life: number
}

/** 一台卡丁车的可视化：车身 + 轮子 + 漂移火花 + 喷射尾焰 */
export class KartView {
  readonly group = new THREE.Group()
  private body = new THREE.Group()
  private wheels: THREE.Group[] = []
  private steerPivots: THREE.Group[] = []
  private flame: THREE.Mesh
  private sparkPoints: THREE.Points
  private sparks: Spark[] = []
  private sparkCursor = 0
  private rng = makeRandom(31)
  private roll = 0

  constructor(color: number, scene: THREE.Scene) {
    const paint = new THREE.MeshLambertMaterial({ color })
    const dark = new THREE.MeshLambertMaterial({ color: 0x23283a })
    const glass = new THREE.MeshLambertMaterial({ color: 0x9fd9ff })

    const chassis = new THREE.Mesh(new THREE.BoxGeometry(3.5, 0.55, 1.9), paint)
    chassis.position.y = 0.5
    const hood = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.5, 1.7), paint)
    hood.position.set(0.95, 0.85, 0)
    const cockpit = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.75, 1.5), glass)
    cockpit.position.set(-0.45, 1.0, 0)
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.34, 12, 10), paint)
    head.position.set(-0.45, 1.55, 0)
    const wing = new THREE.Mesh(new THREE.BoxGeometry(0.35, 0.7, 1.9), dark)
    wing.position.set(-1.75, 1.15, 0)
    this.body.add(chassis, hood, cockpit, head, wing)
    this.group.add(this.body)

    const wheelGeo = new THREE.CylinderGeometry(0.46, 0.46, 0.42, 12)
    for (const [wx, wz, front] of [
      [1.15, 1.02, 1],
      [1.15, -1.02, 1],
      [-1.2, 1.02, 0],
      [-1.2, -1.02, 0],
    ] as const) {
      // steerPivot(转向) -> spinPivot(滚动) -> mesh(轴向对齐 Z)
      const steerPivot = new THREE.Group()
      steerPivot.position.set(wx, 0.46, wz)
      const spinPivot = new THREE.Group()
      const mesh = new THREE.Mesh(wheelGeo, dark)
      mesh.rotation.x = Math.PI / 2
      spinPivot.add(mesh)
      steerPivot.add(spinPivot)
      this.body.add(steerPivot)
      this.wheels.push(spinPivot)
      if (front) this.steerPivots.push(steerPivot)
    }

    this.flame = new THREE.Mesh(
      new THREE.ConeGeometry(0.55, 2.6, 10),
      new THREE.MeshBasicMaterial({ color: 0x66ccff, transparent: true, opacity: 0.85 }),
    )
    this.flame.rotation.z = Math.PI / 2
    this.flame.position.set(-2.4, 0.6, 0)
    this.flame.visible = false
    this.body.add(this.flame)

    // 火花在世界空间，直接挂到场景
    const geo = new THREE.BufferGeometry()
    const positions = new Float32Array(SPARK_COUNT * 3)
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3))
    this.sparkPoints = new THREE.Points(
      geo,
      new THREE.PointsMaterial({
        color: 0xffd05a,
        size: 0.55,
        transparent: true,
        opacity: 0.9,
        depthWrite: false,
      }),
    )
    this.sparkPoints.frustumCulled = false
    scene.add(this.sparkPoints)
    for (let i = 0; i < SPARK_COUNT; i++) {
      this.sparks.push({ x: 0, y: -100, z: 0, vx: 0, vy: 0, vz: 0, life: 0 })
    }

    scene.add(this.group)
  }

  sync(kart: KartPhysics, dt: number, input?: { steer: number }): void {
    this.group.position.set(kart.x, 0, kart.z)
    this.group.rotation.y = -kart.heading

    // 车身随侧滑侧倾
    this.roll = damp(this.roll, clamp(kart.slip * 0.28, -0.3, 0.3), 8, dt)
    this.body.rotation.x = this.roll

    const spin = (kart.speed * dt) / 0.46
    for (const w of this.wheels) w.rotation.z -= spin
    const steerAngle = clamp((input?.steer ?? 0) * 0.42 + kart.slip * 0.25, -0.6, 0.6)
    for (const p of this.steerPivots) p.rotation.y = -steerAngle

    const d = kart.drift
    const boostQ = d.nitroTimer > 0 ? 1 : d.boostTimer > 0 ? 0.35 + 0.5 * d.boostStrength : 0
    this.flame.visible = boostQ > 0
    if (boostQ > 0) {
      const flicker = 0.85 + this.rng() * 0.3
      this.flame.scale.set(boostQ * flicker, 0.7 + boostQ * 0.6, boostQ * flicker)
      const mat = this.flame.material as THREE.MeshBasicMaterial
      mat.color.setHex(d.nitroTimer > 0 ? 0xff6ad5 : 0x66ccff)
    }

    this.updateSparks(kart, dt)
  }

  private updateSparks(kart: KartPhysics, dt: number): void {
    const drifting = kart.drift.state === 'drifting'
    if (drifting && Math.abs(kart.slip) > 0.18) {
      const emit = Math.abs(kart.slip) > 0.5 ? 3 : 1
      for (let e = 0; e < emit; e++) {
        const s = this.sparks[this.sparkCursor]
        this.sparkCursor = (this.sparkCursor + 1) % SPARK_COUNT
        const side = e % 2 === 0 ? 1 : -1
        const rx = Math.cos(kart.heading) * -1.2 + Math.cos(kart.heading + Math.PI / 2) * side
        const rz = Math.sin(kart.heading) * -1.2 + Math.sin(kart.heading + Math.PI / 2) * side
        s.x = kart.x + rx
        s.y = 0.25
        s.z = kart.z + rz
        const spread = (this.rng() - 0.5) * 6
        s.vx = -Math.cos(kart.velAngle) * 5 + spread
        s.vy = 3 + this.rng() * 4
        s.vz = -Math.sin(kart.velAngle) * 5 + spread
        s.life = SPARK_LIFE
      }
    }

    const attr = this.sparkPoints.geometry.getAttribute('position') as THREE.BufferAttribute
    const arr = attr.array as Float32Array
    for (let i = 0; i < SPARK_COUNT; i++) {
      const s = this.sparks[i]
      if (s.life > 0) {
        s.life -= dt
        s.x += s.vx * dt
        s.y += s.vy * dt
        s.z += s.vz * dt
        s.vy -= 14 * dt
        if (s.y < 0.05) {
          s.y = 0.05
          s.vy = 0
        }
      }
      const visible = s.life > 0
      arr[i * 3] = visible ? s.x : 0
      arr[i * 3 + 1] = visible ? s.y : -100
      arr[i * 3 + 2] = visible ? s.z : 0
    }
    attr.needsUpdate = true
  }

  dispose(scene: THREE.Scene): void {
    scene.remove(this.group)
    scene.remove(this.sparkPoints)
  }
}
