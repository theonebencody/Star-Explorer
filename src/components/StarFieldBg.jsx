import { useEffect, useRef } from 'react'

// CSS fallback gradient — shown immediately, stays if 3D is skipped
const FALLBACK_STYLE_DARK = {
  position: 'fixed', inset: 0, zIndex: -1,
  background: 'linear-gradient(180deg, #0a0a0f 0%, #0b1528 40%, #0d1117 100%)',
  pointerEvents: 'none',
}
const FALLBACK_STYLE_LIGHT = {
  position: 'fixed', inset: 0, zIndex: -1,
  background: 'linear-gradient(180deg, #f5f6f8 0%, #eef0f4 40%, #e4e7ed 100%)',
  pointerEvents: 'none',
}

function shouldSkip3D() {
  if (typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches) return true
  // Low-memory detection: deviceMemory (Chrome/Edge) or hardwareConcurrency fallback (all browsers)
  if (typeof navigator !== 'undefined') {
    if (navigator.deviceMemory && navigator.deviceMemory < 4) return true
    if (navigator.hardwareConcurrency && navigator.hardwareConcurrency <= 2) return true
  }
  return false
}

function isLightTheme() {
  return document.documentElement.getAttribute('data-theme') === 'light'
}

export default function StarFieldBg() {
  const containerRef = useRef(null)
  const skip = shouldSkip3D()
  const light = isLightTheme()

  useEffect(() => {
    if (skip || light) return  // No 3D stars in light mode or reduced motion
    const el = containerRef.current
    if (!el) return

    let disposed = false
    let raf = 0

    // Lazy-load Three.js
    import('three').then(THREE => {
      if (disposed) return

      // ── Setup ──
      const canvas = document.createElement('canvas')
      canvas.style.cssText = 'position:fixed;inset:0;width:100%;height:100%;z-index:-1;pointer-events:none;display:block'
      el.appendChild(canvas)

      const renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: false, powerPreference: 'low-power' })
      const isMob = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent)
      renderer.setPixelRatio(Math.min(window.devicePixelRatio, isMob ? 1.5 : 2))
      renderer.setSize(window.innerWidth, window.innerHeight)
      renderer.setClearColor(0x000000, 0)

      const scene = new THREE.Scene()
      const camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 1000)
      camera.position.z = 1

      // ── Stars (Points with varying size & brightness) ──
      const COUNT = isMob ? 1500 : 3500
      const positions = new Float32Array(COUNT * 3)
      const sizes = new Float32Array(COUNT)
      const brightness = new Float32Array(COUNT)

      for (let i = 0; i < COUNT; i++) {
        // Distribute in a sphere shell
        const r = 80 + Math.random() * 320
        const theta = Math.random() * Math.PI * 2
        const phi = Math.acos(2 * Math.random() - 1)
        positions[i * 3]     = r * Math.sin(phi) * Math.cos(theta)
        positions[i * 3 + 1] = r * Math.sin(phi) * Math.sin(theta)
        positions[i * 3 + 2] = r * Math.cos(phi)
        sizes[i] = 0.5 + Math.random() * 2.5
        brightness[i] = 0.3 + Math.random() * 0.7
      }

      const geom = new THREE.BufferGeometry()
      geom.setAttribute('position', new THREE.BufferAttribute(positions, 3))
      geom.setAttribute('aSize', new THREE.BufferAttribute(sizes, 1))
      geom.setAttribute('aBright', new THREE.BufferAttribute(brightness, 1))

      const mat = new THREE.ShaderMaterial({
        uniforms: { uTime: { value: 0 } },
        vertexShader: `
          attribute float aSize;
          attribute float aBright;
          varying float vBright;
          void main() {
            vBright = aBright;
            vec4 mv = modelViewMatrix * vec4(position, 1.0);
            gl_PointSize = aSize * (200.0 / -mv.z);
            gl_Position = projectionMatrix * mv;
          }
        `,
        fragmentShader: `
          varying float vBright;
          void main() {
            // Soft circle
            float d = length(gl_PointCoord - 0.5) * 2.0;
            if (d > 1.0) discard;
            float alpha = (1.0 - d * d) * vBright;
            // Slight blue-white tint
            vec3 col = mix(vec3(0.75, 0.82, 1.0), vec3(1.0), vBright);
            gl_FragColor = vec4(col, alpha * 0.85);
          }
        `,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      })

      const points = new THREE.Points(geom, mat)
      scene.add(points)

      // ── Mouse parallax ──
      let mx = 0, my = 0
      const onMouse = (e) => {
        mx = (e.clientX / window.innerWidth - 0.5) * 2
        my = (e.clientY / window.innerHeight - 0.5) * 2
      }
      window.addEventListener('mousemove', onMouse, { passive: true })

      // ── Device tilt (mobile) ──
      let tx = 0, ty = 0
      const onOrientation = (e) => {
        tx = (e.gamma || 0) / 45  // -1 to 1
        ty = (e.beta || 0) / 45
      }
      window.addEventListener('deviceorientation', onOrientation, { passive: true })

      // ── Resize ──
      const onResize = () => {
        renderer.setSize(window.innerWidth, window.innerHeight)
        camera.aspect = window.innerWidth / window.innerHeight
        camera.updateProjectionMatrix()
      }
      window.addEventListener('resize', onResize, { passive: true })

      // ── Animate ──
      let t0 = performance.now()
      const animate = () => {
        if (disposed) return
        raf = requestAnimationFrame(animate)

        const now = performance.now()
        const dt = (now - t0) / 1000
        t0 = now

        // Slow rotation
        points.rotation.y += dt * 0.008
        points.rotation.x += dt * 0.003

        // Parallax (blend mouse + device tilt)
        const px = mx || tx
        const py = my || ty
        camera.position.x += (px * 0.8 - camera.position.x) * 0.02
        camera.position.y += (-py * 0.5 - camera.position.y) * 0.02
        camera.lookAt(0, 0, 0)

        renderer.render(scene, camera)
      }
      animate()

      // Fade out CSS gradient once 3D is ready
      el.style.background = 'none'
    })

    return () => {
      disposed = true
      cancelAnimationFrame(raf)
      const c = el?.querySelector('canvas')
      if (c) { c.remove() }
    }
  }, [skip, light])

  return <div ref={containerRef} style={light ? FALLBACK_STYLE_LIGHT : FALLBACK_STYLE_DARK} aria-hidden="true" />
}
