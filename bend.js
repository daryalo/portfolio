// Scroll bend effect (like paul-michel.framer.website):
// cards are redrawn in a fixed WebGL canvas, and the part of a card near the
// bottom of the viewport flares outward from the screen center.
// Without WebGL, with reduced motion, or opened via file:// the plain images stay visible.
(() => {
  const STRENGTH = 0.09;   // how far the bottom edge flares (share of distance to center)
  const START = 0.55;      // where the bend begins, as a share of viewport height
  const SEGMENTS = 40;     // mesh density along each axis
  const RADIUS = 10;       // card corner radius, px

  if (matchMedia("(prefers-reduced-motion: reduce)").matches) return;

  function enableScrollFallback() {
    const images = [...document.querySelectorAll(".card img, .story-image")];
    document.documentElement.classList.add("scroll-fallback");
    const update = () => {
      const height = innerHeight || 1;
      for (const img of images) {
        const rect = img.getBoundingClientRect();
        const centerY = rect.top + rect.height * 0.5;
        const t = Math.max(0, Math.min(1.4, (centerY / height - START) / (1 - START)));
        const strength = t * t;
        const scale = 1 + 0.1 * strength;
        const centerOffset = (rect.left + rect.width * 0.5 - innerWidth * 0.5) / Math.max(innerWidth * 0.5, 1);
        const shift = centerOffset * rect.width * 0.025 * strength;
        img.style.transformOrigin = "center";
        img.style.transform = `translateX(${shift.toFixed(2)}px) scaleX(${scale.toFixed(4)})`;
      }
    };
    addEventListener("scroll", update, { passive: true });
    addEventListener("resize", update);
    update();
  }

  const canvas = document.querySelector(".bend-canvas");
  if (!canvas) { enableScrollFallback(); return; }
  const gl = canvas.getContext("webgl", { premultipliedAlpha: true, antialias: true });
  if (!gl) { canvas.remove(); enableScrollFallback(); return; }

  const vert = `
    attribute vec2 aUv;
    uniform vec4 uRect;      // x, y, w, h in CSS px (y down)
    uniform vec2 uView;      // viewport size, CSS px
    uniform float uStrength;
    uniform float uStart;
    varying vec2 vUv;
    void main() {
      vec2 p = uRect.xy + aUv * uRect.zw;
      float t = clamp((p.y / uView.y - uStart) / (1.0 - uStart), 0.0, 1.4);
      p.x += (p.x - uView.x * 0.5) * uStrength * t * t;
      vUv = aUv;
      vec2 clip = p / uView * 2.0 - 1.0;
      gl_Position = vec4(clip.x, -clip.y, 0.0, 1.0);
    }`;

  const frag = `
    precision mediump float;
    uniform sampler2D uTex;
    uniform vec2 uSize;      // card size, px
    uniform vec2 uCover;     // uv scale for object-fit: cover
    uniform float uRadius;
    uniform float uZoom;
    varying vec2 vUv;
    void main() {
      vec2 uv = (vUv - 0.5) * uCover / uZoom + 0.5;
      vec4 color = texture2D(uTex, uv);
      vec2 q = abs(vUv - 0.5) * uSize - (uSize * 0.5 - uRadius);
      float d = length(max(q, 0.0)) - uRadius;
      float a = 1.0 - smoothstep(-0.75, 0.75, d);
      gl_FragColor = color * a;
    }`;

  function compile(type, src) {
    const s = gl.createShader(type);
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
    return s;
  }

  const program = gl.createProgram();
  gl.attachShader(program, compile(gl.VERTEX_SHADER, vert));
  gl.attachShader(program, compile(gl.FRAGMENT_SHADER, frag));
  gl.linkProgram(program);
  gl.useProgram(program);

  const loc = {};
  ["uRect", "uView", "uStrength", "uStart", "uTex", "uSize", "uCover", "uRadius", "uZoom"]
    .forEach((n) => (loc[n] = gl.getUniformLocation(program, n)));

  // Grid of triangles in 0..1 uv space
  const uvs = [];
  for (let y = 0; y < SEGMENTS; y++) {
    for (let x = 0; x < SEGMENTS; x++) {
      const x0 = x / SEGMENTS, x1 = (x + 1) / SEGMENTS;
      const y0 = y / SEGMENTS, y1 = (y + 1) / SEGMENTS;
      uvs.push(x0, y0, x1, y0, x0, y1, x0, y1, x1, y0, x1, y1);
    }
  }
  const buffer = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(uvs), gl.STATIC_DRAW);
  const aUv = gl.getAttribLocation(program, "aUv");
  gl.enableVertexAttribArray(aUv);
  gl.vertexAttribPointer(aUv, 2, gl.FLOAT, false, 0, 0);
  const vertexCount = uvs.length / 2;

  gl.enable(gl.BLEND);
  gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
  gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
  gl.uniform1f(loc.uStrength, STRENGTH);
  gl.uniform1f(loc.uStart, START);
  gl.uniform1f(loc.uRadius, RADIUS);
  gl.uniform1i(loc.uTex, 0);

  const textures = new Map(); // src -> texture
  const surfaces = [...document.querySelectorAll(".card, .story-image")].map((el) => ({
    el,
    img: el.matches("img") ? el : el.querySelector("img"),
  })).filter(({ img }) => img).map((surface) => ({
    ...surface,
    zoom: 1,
    zoomFrom: 1,
    zoomTarget: 1,
    zoomStartedAt: 0,
  }));
  const hoverSurfaces = surfaces.filter(({ el }) => el.matches(".card"));

  function setZoom(surface, active) {
    surface.zoomFrom = surface.zoom;
    surface.zoomTarget = active ? 1.045 : 1;
    surface.zoomStartedAt = performance.now();
    last = "";
  }

  for (const surface of hoverSurfaces) {
    surface.el.addEventListener("pointerenter", () => setZoom(surface, true));
    surface.el.addEventListener("pointerleave", () => setZoom(surface, false));
    surface.el.addEventListener("pointercancel", () => setZoom(surface, false));
  }

  function loadTexture(img) {
    if (!img.complete || !img.naturalWidth) return null;
    const source = img.currentSrc || img.src;
    if (textures.has(source)) {
      img.classList.add("gl-ready");
      return textures.get(source);
    }
    const tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, img); // throws on tainted images (file://)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    textures.set(source, tex);
    img.classList.add("gl-ready");
    return tex;
  }

  function resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.round(innerWidth * dpr);
    canvas.height = Math.round(innerHeight * dpr);
    gl.viewport(0, 0, canvas.width, canvas.height);
  }

  function draw() {
    const vw = innerWidth, vh = innerHeight;
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.uniform2f(loc.uView, vw, vh);

    for (const surface of surfaces) {
      const { el, img } = surface;
      const r = el.getBoundingClientRect();
      if (r.bottom < 0 || r.top > vh || !img.complete || !img.naturalWidth) continue;
      const texture = loadTexture(img);
      if (!texture) continue;
      gl.bindTexture(gl.TEXTURE_2D, texture);
      const imgAspect = img.naturalWidth / img.naturalHeight;
      const boxAspect = r.width / r.height;
      const cover = imgAspect > boxAspect ? [boxAspect / imgAspect, 1] : [1, imgAspect / boxAspect];
      gl.uniform4f(loc.uRect, r.left, r.top, r.width, r.height);
      gl.uniform2f(loc.uSize, r.width, r.height);
      gl.uniform2f(loc.uCover, cover[0], cover[1]);
      gl.uniform1f(loc.uZoom, surface.zoom);
      gl.drawArrays(gl.TRIANGLES, 0, vertexCount);
    }
  }

  let last = "";
  function loop() {
    const now = performance.now();
    for (const surface of hoverSurfaces) {
      if (surface.zoom === surface.zoomTarget) continue;
      const t = Math.min(1, (now - surface.zoomStartedAt) / 240);
      const eased = 1 - Math.pow(1 - t, 3);
      surface.zoom = surface.zoomFrom + (surface.zoomTarget - surface.zoomFrom) * eased;
      if (t === 1) surface.zoom = surface.zoomTarget;
    }
    const zoomState = hoverSurfaces.map(({ zoom }) => zoom.toFixed(4)).join(",");
    const key = `${scrollX},${scrollY},${innerWidth},${innerHeight},${zoomState}`;
    if (key !== last) {
      if (canvas.width !== Math.round(innerWidth * Math.min(devicePixelRatio || 1, 2))) resize();
      draw();
      last = key;
    }
    requestAnimationFrame(loop);
  }

  // Images below the fold are lazy-loaded. Keep their DOM version visible until
  // a texture is ready, then draw it on the same canvas as the homepage cards.
  for (const { img } of surfaces) {
    img.addEventListener("load", () => { last = ""; draw(); });
    img.addEventListener("error", () => { img.classList.remove("gl-ready"); });
  }

  try {
    resize();
    draw();
  } catch (err) {
    // Most often, page was opened via file:// so WebGL cannot read the images.
    console.warn("Bend effect disabled:", err);
    canvas.remove();
    enableScrollFallback();
    return;
  }

  document.documentElement.classList.add("gl-on");
  addEventListener("resize", () => { last = ""; });
  requestAnimationFrame(loop);
})();
