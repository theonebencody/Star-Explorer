export function createSolarSystemBodies(THREE) {
  const {
    SphereGeometry,
    PlaneGeometry,
    RingGeometry,
    Mesh,
    ShaderMaterial,
    MeshStandardMaterial,
    TextureLoader,
    Color,
    Vector3,
    PointLight,
    DoubleSide,
    AdditiveBlending,
    BackSide,
    FrontSide
  } = THREE;

  // Utility for noise generation in shaders
  const noiseGLSL = `
    vec3 mod289(vec3 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
    vec4 mod289(vec4 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
    vec4 permute(vec4 x) { return mod289(((x*34.0)+1.0)*x); }
    vec4 taylorInvSqrt(vec4 r) { return 1.79284291400159 - 0.85373472095314 * r; }
    float snoise(vec3 v) {
      const vec2 C = vec2(1.0/6.0, 1.0/3.0);
      const vec4 D = vec4(0.0, 0.5, 1.0, 2.0);
      vec3 i = floor(v + dot(v, C.yyy));
      vec3 x0 = v - i + dot(i, C.xxx);
      vec3 g = step(x0.yzx, x0.xyz);
      vec3 l = 1.0 - g;
      vec3 i1 = min(g.xyz, l.zxy);
      vec3 i2 = max(g.xyz, l.zxy);
      vec3 x1 = x0 - i1 + C.xxx;
      vec3 x2 = x0 - i2 + C.yyy;
      vec3 x3 = x0 - D.yyy;
      i = mod289(i);
      vec4 p = permute(permute(permute(i.z + vec4(0.0, i1.z, i2.z, 1.0)) + i.y + vec4(0.0, i1.y, i2.y, 1.0)) + i.x + vec4(0.0, i1.x, i2.x, 1.0));
      float n_ = 0.142857142857;
      vec3 ns = n_ * D.wyz - D.xzx;
      vec4 j = p - 49.0 * floor(p * ns.z * ns.z);
      vec4 x_ = floor(j * ns.z);
      vec4 y_ = floor(j - 7.0 * x_);
      vec4 x = x_ * ns.x + ns.yyyy;
      vec4 y = y_ * ns.x + ns.yyyy;
      vec4 h = 1.0 - abs(x) - abs(y);
      vec4 b0 = vec4(x.xy, y.xy);
      vec4 b1 = vec4(x.zw, y.zw);
      vec4 s0 = floor(b0)*2.0 + 1.0;
      vec4 s1 = floor(b1)*2.0 + 1.0;
      vec4 sh = -step(h, vec4(0.0));
      vec4 a0 = b0.xzyw + s0.xzyw*sh.xxyy;
      vec4 a1 = b1.xzyw + s1.xzyw*sh.zzww;
      vec3 p0 = vec3(a0.xy, h.x);
      vec3 p1 = vec3(a0.zw, h.y);
      vec3 p2 = vec3(a1.xy, h.z);
      vec3 p3 = vec3(a1.zw, h.w);
      vec4 norm = taylorInvSqrt(vec4(dot(p0,p0), dot(p1,p1), dot(p2,p2), dot(p3,p3)));
      p0 *= norm.x;
      p1 *= norm.y;
      p2 *= norm.z;
      p3 *= norm.w;
      vec4 m = max(0.6 - vec4(dot(x0,x0), dot(x1,x1), dot(x2,x2), dot(x3,x3)), 0.0);
      m = m * m;
      return 42.0 * dot(m*m, vec4(dot(p0,x0), dot(p1,x1), dot(p2,x2), dot(p3,x3)));
    }
  `;

  // Common Fresnel glow for atmospheres
  const fresnelGLSL = `
    float fresnel(float bias, float scale, float power, vec3 normal, vec3 viewDir) {
      return bias + scale * pow(1.0 + dot(normalize(viewDir), normal), power);
    }
  `;

  // Sun shaders with animated granulation and corona
  const sunVertexShader = `
    varying vec3 vNormal;
    varying vec3 vPosition;
    void main() {
      vNormal = normal;
      vPosition = position;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `;
  const sunFragmentShader = `
    uniform float time;
    varying vec3 vNormal;
    varying vec3 vPosition;
    ${noiseGLSL}
    void main() {
      vec3 color = vec3(1.0, 0.5, 0.2);
      float noise = snoise(vPosition * 0.1 + time * 0.05);
      color += noise * 0.3;
      float intensity = dot(normalize(vNormal), normalize(-vPosition));
      float glow = pow(1.0 - intensity, 2.0) * 0.5;
      color += glow * vec3(1.0, 0.8, 0.5);
      gl_FragColor = vec4(color, 1.0);
    }
  `;
  const coronaVertexShader = `
    varying vec3 vPosition;
    void main() {
      vPosition = position;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `;
  const coronaFragmentShader = `
    uniform float time;
    varying vec3 vPosition;
    ${noiseGLSL}
    void main() {
      float dist = length(vPosition);
      float noise = snoise(vPosition * 0.05 + time * 0.1);
      float alpha = (1.0 - smoothstep(1.2, 1.5, dist)) * (0.5 + noise * 0.5);
      vec3 color = vec3(1.0, 0.8, 0.5);
      gl_FragColor = vec4(color, alpha * 0.3);
    }
  `;

  // Planet-specific shaders
  const planetShaders = {
    mercury: {
      fragment: `
        uniform float time;
        varying vec3 vNormal;
        varying vec3 vPosition;
        ${noiseGLSL}
        ${fresnelGLSL}
        void main() {
          float noise = snoise(vPosition * 0.2);
          vec3 color = vec3(0.5 + noise * 0.2);
          float fres = fresnel(0.1, 0.5, 2.0, vNormal, -vPosition);
          color += fres * vec3(0.3);
          gl_FragColor = vec4(color, 1.0);
        }
      `
    },
    venus: {
      fragment: `
        uniform float time;
        varying vec3 vNormal;
        varying vec3 vPosition;
        ${noiseGLSL}
        ${fresnelGLSL}
        void main() {
          float noise = snoise(vPosition * 0.1 + time * 0.02);
          vec3 color = vec3(0.9, 0.8, 0.4) + noise * 0.1;
          float fres = fresnel(0.2, 0.8, 3.0, vNormal, -vPosition);
          color += fres * vec3(0.5, 0.5, 0.2);
          gl_FragColor = vec4(color, 1.0);
        }
      `
    },
    earth: {
      fragment: `
        uniform float time;
        varying vec3 vNormal;
        varying vec3 vPosition;
        ${noiseGLSL}
        ${fresnelGLSL}
        void main() {
          float noise = snoise(vPosition * 0.2);
          float lat = asin(vPosition.y / length(vPosition));
          float ocean = smoothstep(-0.2, 0.2, noise);
          vec3 color = mix(vec3(0.0, 0.3, 0.7), vec3(0.3, 0.5, 0.2), ocean);
          float fres = fresnel(0.1, 0.6, 3.0, vNormal, -vPosition);
          color += fres * vec3(0.2, 0.4, 0.8);
          gl_FragColor = vec4(color, 1.0);
        }
      `
    },
    mars: {
      fragment: `
        uniform float time;
        varying vec3 vNormal;
        varying vec3 vPosition;
        ${noiseGLSL}
        ${fresnelGLSL}
        void main() {
          float noise = snoise(vPosition * 0.2);
          float lat = asin(vPosition.y / length(vPosition));
          float ice = smoothstep(0.7, 0.9, abs(lat));
          vec3 color = mix(vec3(0.7, 0.3, 0.2), vec3(0.9, 0.9, 0.9), ice);
          color += noise * 0.1;
          float fres = fresnel(0.1, 0.4, 2.0, vNormal, -vPosition);
          color += fres * vec3(0.3, 0.2, 0.2);
          gl_FragColor = vec4(color, 1.0);
        }
      `
    },
    jupiter: {
      fragment: `
        uniform float time;
        varying vec3 vNormal;
        varying vec3 vPosition;
        ${noiseGLSL}
        ${fresnelGLSL}
        void main() {
          float lat = asin(vPosition.y / length(vPosition));
          float noise = snoise(vPosition * 0.1 + time * 0.05 + lat * 2.0);
          float band = sin(lat * 10.0) * 0.2 + 0.8;
          vec3 color = vec3(0.8, 0.6, 0.4) * band + noise * 0.1;
          float spot = smoothstep(0.1, 0.3, length(vPosition.xy - vec2(0.5, 0.2)));
          color = mix(color, vec3(0.6, 0.2, 0.1), 1.0 - spot);
          float fres = fresnel(0.1, 0.5, 2.0, vNormal, -vPosition);
          color += fres * vec3(0.3);
          gl_FragColor = vec4(color, 1.0);
        }
      `
    },
    saturn: {
      fragment: `
        uniform float time;
        varying vec3 vNormal;
        varying vec3 vPosition;
        ${noiseGLSL}
        ${fresnelGLSL}
        void main() {
          float lat = asin(vPosition.y / length(vPosition));
          float noise = snoise(vPosition * 0.1 + time * 0.03 + lat * 3.0);
          float band = sin(lat * 8.0) * 0.15 + 0.85;
          vec3 color = vec3(0.9, 0.8, 0.5) * band + noise * 0.1;
          float fres = fresnel(0.1, 0.6, 3.0, vNormal, -vPosition);
          color += fres * vec3(0.3, 0.3, 0.2);
          gl_FragColor = vec4(color, 1.0);
        }
      `
    },
    uranus: {
      fragment: `
        uniform float time;
        varying vec3 vNormal;
        varying vec3 vPosition;
        ${noiseGLSL}
        ${fresnelGLSL}
        void main() {
          float noise = snoise(vPosition * 0.1 + time * 0.02);
          vec3 color = vec3(0.5, 0.8, 0.8) + noise * 0.05;
          float fres = fresnel(0.2, 0.7, 3.0, vNormal, -vPosition);
          color += fres * vec3(0.2, 0.5, 0.5);
          gl_FragColor = vec4(color, 1.0);
        }
      `
    },
    neptune: {
      fragment: `
        uniform float time;
        varying vec3 vNormal;
        varying vec3 vPosition;
        ${noiseGLSL}
        ${fresnelGLSL}
        void main() {
          float noise = snoise(vPosition * 0.1 + time * 0.03);
          vec3 color = vec3(0.2, 0.5, 0.8) + noise * 0.1;
          float spot = smoothstep(0.2, 0.4, length(vPosition.xy + vec2(0.3, 0.1)));
          color = mix(color, vec3(0.1, 0.3, 0.6), 1.0 - spot);
          float fres = fresnel(0.2, 0.8, 3.0, vNormal, -vPosition);
          color += fres * vec3(0.2, 0.4, 0.7);
          gl_FragColor = vec4(color, 1.0);
        }
      `
    }
  };

  // Common vertex shader for planets
  const planetVertexShader = `
    varying vec3 vNormal;
    varying vec3 vPosition;
    void main() {
      vNormal = normal;
      vPosition = position;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `;

  // Cloud shader for Earth
  const cloudVertexShader = `
    varying vec3 vNormal;
    void main() {
      vNormal = normal;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `;
  const cloudFragmentShader = `
    uniform float time;
    varying vec3 vNormal;
    ${noiseGLSL}
    void main() {
      float noise = snoise(vNormal * 0.3 + time * 0.01);
      float alpha = smoothstep(0.0, 0.5, noise);
      vec3 color = vec3(1.0);
      gl_FragColor = vec4(color, alpha * 0.7);
    }
  `;

  // Sizes (scaled down for visualization, maintaining relative proportions)
  const sizes = {
    sun: 10.0,
    mercury: 0.383,
    venus: 0.949,
    earth: 1.0,
    mars: 0.532,
    jupiter: 11.21,
    saturn: 9.45,
    uranus: 4.01,
    neptune: 3.88,
    moon: 0.273,
    phobos: 0.017,
    deimos: 0.01,
    io: 0.286,
    europa: 0.245,
    ganymede: 0.413,
    callisto: 0.378,
    titan: 0.404,
    enceladus: 0.039
  };

  // Axial tilts in degrees
  const axialTilts = {
    sun: 7.25,
    mercury: 0.03,
    venus: 177.4,
    earth: 23.44,
    mars: 25.19,
    jupiter: 3.13,
    saturn: 26.73,
    uranus: 97.77,
    neptune: 28.32
  };

  // Rotation speeds (relative to Earth's day, scaled for visibility)
  const rotationSpeeds = {
    sun: 0.04,
    mercury: 0.017,
    venus: 0.004,
    earth: 1.0,
    mars: 0.97,
    jupiter: 2.4,
    saturn: 2.3,
    uranus: 1.4,
    neptune: 1.5,
    moon: 0.036,
    phobos: 3.2,
    deimos: 0.8,
    io: 0.57,
    europa: 0.28,
    ganymede: 0.14,
    callisto: 0.06,
    titan: 0.063,
    enceladus: 0.73
  };

  // Create Sun
  const sunGeometry = new SphereGeometry(sizes.sun, 64, 64);
  const sunMaterial = new ShaderMaterial({
    vertexShader: sunVertexShader,
    fragmentShader: sunFragmentShader,
    uniforms: { time: { value: 0.0 } }
  });
  const sun = new Mesh(sunGeometry, sunMaterial);
  sun.userData.type = 'sun';
  sun.update = function(time) {
    this.material.uniforms.time.value = time;
    this.rotation.y = time * rotationSpeeds.sun;
  };

  // Corona
  const coronaGeometry = new SphereGeometry(sizes.sun * 1.5, 64, 64);
  const coronaMaterial = new ShaderMaterial({
    vertexShader: coronaVertexShader,
    fragmentShader: coronaFragmentShader,
    uniforms: { time: { value: 0.0 } },
    transparent: true,
    side: BackSide,
    blending: AdditiveBlending
  });
  const corona = new Mesh(coronaGeometry, coronaMaterial);
  corona.update = function(time) {
    this.material.uniforms.time.value = time;
  };
  sun.add(corona);

  // Sun light
  const sunLight = new PointLight(0xffffff, 50.0, 1000.0);
  sunLight.position.set(0, 0, 0);

  // Create planets
  const planets = {};
  const planetNames = ['mercury', 'venus', 'earth', 'mars', 'jupiter', 'saturn', 'uranus', 'neptune'];
  planetNames.forEach(name => {
    const geometry = new SphereGeometry(sizes[name], 64, 64);
    const material = new ShaderMaterial({
      vertexShader: planetVertexShader,
      fragmentShader: planetShaders[name].fragment,
      uniforms: { time: { value: 0.0 } }
    });
    const planet = new Mesh(geometry, material);
    planet.userData.type = name;
    planet.rotation.x = axialTilts[name] * Math.PI / 180;
    planet.update = function(time) {
      this.material.uniforms.time.value = time;
      this.rotation.y = time * rotationSpeeds[name];
    };
    planets[name] = planet;
  });

  // Earth clouds
  const cloudGeometry = new SphereGeometry(sizes.earth * 1.02, 64, 64);
  const cloudMaterial = new ShaderMaterial({
    vertexShader: cloudVertexShader,
    fragmentShader: cloudFragmentShader,
    uniforms: { time: { value: 0.0 } },
    transparent: true
  });
  const earthClouds = new Mesh(cloudGeometry, cloudMaterial);
  earthClouds.userData.type = 'earthClouds';
  earthClouds.update = function(time) {
    this.material.uniforms.time.value = time;
    this.rotation.y = time * rotationSpeeds.earth * 1.1;
  };
  planets.earth.add(earthClouds);

  // Saturn rings
  const saturnRingGeometry = new RingGeometry(sizes.saturn * 1.2, sizes.saturn * 2.5, 64);
  const saturnRingMaterial = new ShaderMaterial({
    vertexShader: `
      varying vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      uniform float time;
      varying vec2 vUv;
      ${noiseGLSL}
      void main() {
        float dist = length(vUv - 0.5);
        float noise = snoise(vec3(vUv * 10.0, time * 0.01));
        float alpha = smoothstep(0.0, 0.1, dist) * smoothstep(0.4, 0.5, 1.0 - dist);
        alpha *= (0.7 + noise * 0.3);
        float cassini = smoothstep(0.2, 0.22, dist) * smoothstep(0.24, 0.26, 1.0 - dist);
        alpha *= cassini;
        vec3 color = vec3(0.9, 0.85, 0.8) + noise * 0.1;
        gl_FragColor = vec4(color, alpha * 0.6);
      }
    `,
    uniforms: { time: { value: 0.0 } },
    transparent: true,
    side: DoubleSide
  });
  const saturnRings = new Mesh(saturnRingGeometry, saturnRingMaterial);
  saturnRings.rotation.x = Math.PI / 2;
  saturnRings.userData.type = 'saturnRings';
  saturnRings.update = function(time) {
    this.material.uniforms.time.value = time;
    this.rotation.z = time * rotationSpeeds.saturn * 0.5;
  };
  planets.saturn.add(saturnRings);

  // Uranus rings
  const uranusRingGeometry = new RingGeometry(sizes.uranus * 1.1, sizes.uranus * 1.5, 32);
  const uranusRingMaterial = new MeshStandardMaterial({
    color: 0xaaaaaa,
    transparent: true,
    opacity: 0.3,
    side: DoubleSide
  });
  const uranusRings = new Mesh(uranusRingGeometry, uranusRingMaterial);
  uranusRings.rotation.x = Math.PI / 2;
  uranusRings.userData.type = 'uranusRings';
  uranusRings.update = function(time) {
    this.rotation.z = time * rotationSpeeds.uranus * 0.5;
  };
  planets.uranus.add(uranusRings);

  // Moons
  const moons = {};
  const moonNames = ['moon', 'phobos', 'deimos', 'io', 'europa', 'ganymede', 'callisto', 'titan', 'enceladus'];
  const moonColors = {
    moon: 0xaaaaaa,
    phobos: 0x666666,
    deimos: 0x555555,
    io: 0xcc9900,
    europa: 0xccccdd,
    ganymede: 0x888888,
    callisto: 0x666666,
    titan: 0xcc8800,
    enceladus: 0xdddddd
  };
  moonNames.forEach(name => {
    const geometry = new SphereGeometry(sizes[name], 32, 32);
    const material = new MeshStandardMaterial({
      color: moonColors[name],
      roughness: 0.9,
      metalness: 0.1
    });
    const moon = new Mesh(geometry, material);
    moon.userData.type = name;
    moon.update = function(time) {
      this.rotation.y = time * rotationSpeeds[name];
    };
    moons[name] = moon;
  });

  return {
    sun,
    mercury: planets.mercury,
    venus: planets.venus,
    earth: planets.earth,
    earthClouds,
    mars: planets.mars,
    jupiter: planets.jupiter,
    saturn: planets.saturn,
    saturnRings,
    uranus: planets.uranus,
    uranusRings,
    neptune: planets.neptune,
    moon: moons.moon,
    phobos: moons.phobos,
    deimos: moons.deimos,
    io: moons.io,
    europa: moons.europa,
    ganymede: moons.ganymede,
    callisto: moons.callisto,
    titan: moons.titan,
    enceladus: moons.enceladus,
    lights: { sunLight },
    meta: { rotationSpeeds, axialTilts, sizes }
  };
}
