/* FoodFind · fundo animado do topo da página inicial.
 *
 * Adaptado para JavaScript puro do efeito "Glass fold" da GradFlow
 * (https://gradflow.meerbahadin.dev, de Meer Bahadin, licença MIT),
 * encontrado no 21st.dev. O shader é o original; a parte React foi trocada
 * por uma função comum e foram acrescentados: pausa quando o topo sai da tela
 * ou a aba fica oculta, quadro parado com "reduzir movimento" e retorno
 * silencioso para o fundo em CSS quando o navegador não tem WebGL.
 *
 * Licença do código original (MIT):
 * Copyright (c) Meer Bahadin (GradFlow)
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to deal
 * in the Software without restriction, including without limitation the rights
 * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 * copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in all
 * copies or substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
 * SOFTWARE.
 */
(function () {
  'use strict';

  const VERTEX = `
    attribute vec2 position;
    varying vec2 vUv;
    void main() {
      vUv = position * 0.5 + 0.5;
      gl_Position = vec4(position, 0.0, 1.0);
    }`;

  const FRAGMENT = `
    precision highp float;
    uniform float u_time;
    uniform vec3 u_color1;
    uniform vec3 u_color2;
    uniform vec3 u_color3;
    uniform float u_scale;
    uniform float u_noise;
    uniform vec2 u_resolution;
    varying vec2 vUv;

    float grain(vec2 st) { return fract(sin(dot(st, vec2(12.9898, 78.233))) * 43758.5453); }
    vec2 centered(vec2 uv) { vec2 p = uv - 0.5; p.x *= u_resolution.x / max(u_resolution.y, 1.0); return p; }
    mat2 rot(float a) { float s = sin(a); float c = cos(a); return mat2(c, -s, s, c); }

    vec3 shade(vec2 uv, float time) {
      vec2 q = rot(0.6) * centered(uv) * 2.0 * u_scale;
      float t = time * 0.6;
      float pixel = 2.0 * u_scale / max(u_resolution.y, 1.0);
      vec3 color = mix(u_color2, u_color2 * 0.45, clamp(length(centered(uv)) * 1.3, 0.0, 1.0));
      for (int i = 0; i < 6; i++) {
        float fi = float(i);
        float bend = mod(fi, 2.0) * 2.0 - 1.0;
        float crease = (fi - 2.5) * 0.4
                     + 0.26 * sin(q.x * (1.05 + 0.12 * fi) + fi * 1.9 + t * (0.25 + 0.05 * fi))
                     + 0.1 * bend * q.x * q.x;
        float s = q.y - crease;
        float pane = smoothstep(-pixel, pixel, s);
        float back = max(s, 0.0);
        float body = exp(-back * 1.7);
        float fresnel = exp(-back * 8.0);
        float rim = exp(-back * 80.0);
        float inner = exp(-pow((back - 0.045) / 0.014, 2.0));
        float bloom = exp(-abs(s) * 20.0);
        vec3 tint = mix(u_color1, u_color3, clamp(fresnel * 0.6 + 0.08 + 0.14 * sin(fi * 2.1 + q.x * 0.8 + t * 0.2), 0.0, 1.0));
        vec3 light = tint * pane * (body * 0.42 + fresnel * 0.4)
                   + u_color3 * (pane * (rim * 0.6 + inner * 0.12) + bloom * 0.1);
        color += light * (1.0 - color);
      }
      return clamp(color, 0.0, 1.0);
    }

    void main() {
      vec3 color = shade(vUv, u_time);
      if (u_noise > 0.001) {
        float g = grain(vUv * 200.0 + u_time * 0.1);
        color *= 1.0 - u_noise * 0.4 + u_noise * g * 0.4;
      }
      gl_FragColor = vec4(color, 1.0);
    }`;

  function hexToVec3(hex) {
    const h = hex.replace('#', '');
    const full = h.length === 3 ? h.split('').map(c => c + c).join('') : h;
    const n = parseInt(full, 16);
    return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
  }

  function compile(gl, type, source) {
    const shader = gl.createShader(type);
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) throw new Error('shader');
    return shader;
  }

  /**
   * Liga o efeito num <canvas>. Devolve uma função que desliga tudo.
   * Se não houver WebGL, não faz nada e o fundo em CSS do contêiner continua valendo.
   */
  function glassFold(canvas, opts) {
    const o = Object.assign({ color1: '#c8102e', color2: '#1a0907', color3: '#ffb547', speed: 0.35, scale: 0.9, noise: 0.1 }, opts || {});
    let gl;
    try { gl = canvas.getContext('webgl', { antialias: false, alpha: false, powerPreference: 'low-power' }); } catch { gl = null; }
    if (!gl) return () => {};

    let program, buffer;
    try {
      program = gl.createProgram();
      gl.attachShader(program, compile(gl, gl.VERTEX_SHADER, VERTEX));
      gl.attachShader(program, compile(gl, gl.FRAGMENT_SHADER, FRAGMENT));
      gl.linkProgram(program);
      if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error('link');
    } catch { return () => {}; }
    gl.useProgram(program);

    buffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]), gl.STATIC_DRAW);
    const position = gl.getAttribLocation(program, 'position');
    gl.enableVertexAttribArray(position);
    gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0);

    const u = name => gl.getUniformLocation(program, name);
    const loc = { time: u('u_time'), c1: u('u_color1'), c2: u('u_color2'), c3: u('u_color3'), scale: u('u_scale'), noise: u('u_noise'), res: u('u_resolution') };
    gl.uniform3fv(loc.c1, hexToVec3(o.color1));
    gl.uniform3fv(loc.c2, hexToVec3(o.color2));
    gl.uniform3fv(loc.c3, hexToVec3(o.color3));
    gl.uniform1f(loc.scale, o.scale);
    gl.uniform1f(loc.noise, o.noise);

    const resize = () => {
      // Até 1,5x a densidade da tela: o efeito é macio e isso poupa bateria no celular.
      const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
      const w = Math.max(1, Math.round(canvas.clientWidth * dpr));
      const h = Math.max(1, Math.round(canvas.clientHeight * dpr));
      if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
      gl.viewport(0, 0, w, h);
    };

    // Começa num ponto bonito do ciclo, não do zero.
    let elapsed = 6, last = null, frame = 0, onScreen = true;
    const draw = now => {
      if (last !== null) elapsed += Math.min((now - last) / 1000, 0.1) * o.speed;
      last = now;
      resize();
      gl.uniform1f(loc.time, elapsed);
      gl.uniform2f(loc.res, canvas.width, canvas.height);
      gl.drawArrays(gl.TRIANGLES, 0, 6);
    };

    const still = window.matchMedia('(prefers-reduced-motion: reduce)');
    const running = () => !still.matches && onScreen && !document.hidden;
    const loop = now => { draw(now); frame = running() ? requestAnimationFrame(loop) : 0; };
    const kick = () => { if (!frame) { last = null; frame = requestAnimationFrame(loop); } };
    kick();
    canvas.classList.add('on');

    const ro = new ResizeObserver(() => { if (!running()) draw(performance.now()); });
    ro.observe(canvas);
    const io = new IntersectionObserver(entries => { onScreen = entries[0].isIntersecting; if (running()) kick(); });
    io.observe(canvas);
    const onVis = () => { if (running()) kick(); };
    document.addEventListener('visibilitychange', onVis);
    still.addEventListener?.('change', onVis);

    return () => {
      cancelAnimationFrame(frame);
      ro.disconnect(); io.disconnect();
      document.removeEventListener('visibilitychange', onVis);
      gl.deleteBuffer(buffer); gl.deleteProgram(program);
    };
  }

  window.FoodFindGlassFold = glassFold;
})();
