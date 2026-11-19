/* FoodFind · fundo da página: uma faixa de linhas finas que corre devagar pela tela.
 *
 * Ideia tirada do "Background Paths" da Kokonut UI (MIT), um dos componentes mais
 * populares do 21st.dev: várias linhas em camadas formando uma fita inclinada, que
 * aparecem sendo "desenhadas" e se afastam do cursor. Este arquivo é uma
 * implementação própria em canvas, sem dependências, nas cores do FoodFind.
 *
 * Cuidados: fica atrás de tudo e não recebe cliques; para quando a aba fica oculta;
 * com "reduzir movimento" desenha um quadro só; no celular usa menos linhas e 30 qps.
 */
(function () {
  'use strict';

  function fluxo(canvas) {
    const ctx = canvas.getContext && canvas.getContext('2d');
    if (!ctx) return () => {};

    const small = window.matchMedia('(max-width: 760px)').matches;
    const still = window.matchMedia('(prefers-reduced-motion: reduce)');
    const fine = window.matchMedia('(hover: hover) and (pointer: fine)').matches;

    // Três camadas: do fundo (fina e clara) para a frente (mais grossa e marcada).
    const LAYERS = [
      { n: small ? 7 : 12, width: 1, alpha: 0.17, pace: 0.7, color: '200, 16, 46' },
      { n: small ? 7 : 12, width: 1.25, alpha: 0.23, pace: 0.85, color: '200, 16, 46' },
      { n: small ? 6 : 10, width: 1.5, alpha: 0.32, pace: 1, color: '214, 120, 8' }
    ];
    const POINTS = small ? 40 : 64;
    const DRAW_MS = 1400, STAGGER_MS = 40;

    let w = 0, h = 0, dpr = 1, t = 0, last = null, frame = 0, start = null;
    const mouse = { x: -9999, y: -9999 };

    const resize = () => {
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      w = window.innerWidth; h = window.innerHeight;
      canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };

    // Posição vertical de um ponto da linha: fita inclinada que ondula com o tempo.
    const lineY = (x, i, total, layer, time) => {
      const u = x / w;
      const center = h * (0.62 - 0.34 * u);               // sobe da esquerda para a direita
      const spread = Math.min(h, 900) * 0.32;
      const k = (i / Math.max(1, total - 1)) - 0.5;          // -0,5 … 0,5 dentro da fita
      const wave = Math.sin(u * 5.2 + time * layer.pace + i * 0.35) * 26
                 + Math.sin(u * 2.1 - time * 0.6 * layer.pace + i * 0.2) * 38;
      return center + k * spread + wave * (0.6 + Math.abs(k));
    };

    const ease = p => 1 - Math.pow(1 - p, 3);

    const draw = now => {
      if (start === null) start = now;
      ctx.clearRect(0, 0, w, h);
      let idx = 0;
      for (const layer of LAYERS) {
        ctx.lineWidth = layer.width;
        for (let i = 0; i < layer.n; i++, idx++) {
          const reveal = still.matches ? 1 : ease(Math.min(1, Math.max(0, (now - start - idx * STAGGER_MS) / DRAW_MS)));
          if (reveal <= 0) continue;
          // Mais forte no meio da fita, sumindo nas bordas.
          const edge = 1 - Math.abs(i / Math.max(1, layer.n - 1) - 0.5) * 2;
          ctx.strokeStyle = `rgba(${layer.color}, ${(layer.alpha * (0.35 + 0.65 * edge)).toFixed(3)})`;
          ctx.beginPath();
          const end = Math.max(2, Math.round(POINTS * reveal));
          for (let p = 0; p < end; p++) {
            const x = -0.05 * w + (p / (POINTS - 1)) * 1.1 * w;
            let y = lineY(x, i, layer.n, layer, t);
            if (fine) {
              // Afasta as linhas do cursor (raio de 150 px, até 48 px).
              const dx = x - mouse.x, dy = y - mouse.y, d = Math.hypot(dx, dy);
              if (d < 150) y += (dy >= 0 ? 1 : -1) * (1 - d / 150) * 48;
            }
            if (p === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
          }
          ctx.stroke();
        }
      }
    };

    const running = () => !still.matches && !document.hidden;
    const minGap = small ? 1000 / 30 : 0;
    const loop = now => {
      frame = 0;
      if (last === null || now - last >= minGap) {
        if (last !== null) t += Math.min((now - last) / 1000, 0.1) * 0.32;
        last = now;
        draw(now);
      }
      if (running()) frame = requestAnimationFrame(loop);
    };
    const kick = () => { if (!frame && running()) { last = null; frame = requestAnimationFrame(loop); } };

    resize();
    t = 4;
    if (running()) kick(); else draw(performance.now());

    const onResize = () => { resize(); if (!running()) draw(performance.now() + 1e6); };
    const onVis = () => kick();
    const onMove = e => { mouse.x = e.clientX; mouse.y = e.clientY; };
    const onLeave = () => { mouse.x = mouse.y = -9999; };
    window.addEventListener('resize', onResize);
    document.addEventListener('visibilitychange', onVis);
    still.addEventListener?.('change', () => { if (running()) kick(); else draw(performance.now() + 1e6); });
    if (fine) { window.addEventListener('pointermove', onMove, { passive: true }); document.addEventListener('pointerleave', onLeave); }
    canvas.classList.add('on');

    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener('resize', onResize);
      document.removeEventListener('visibilitychange', onVis);
      window.removeEventListener('pointermove', onMove);
    };
  }

  window.FoodFindFluxo = fluxo;
})();
