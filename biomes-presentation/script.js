/* ========================================
   SCRAPBOOK – Scroll animations, particles, gradients
   ======================================== */
(function () {
  'use strict';

  // --- Scroll-triggered animations ---
  const animEls = document.querySelectorAll('.anim');
  const animObs = new IntersectionObserver((entries) => {
    entries.forEach((e) => { if (e.isIntersecting) e.target.classList.add('visible'); });
  }, { threshold: 0.12, rootMargin: '0px 0px -30px 0px' });
  animEls.forEach((el) => animObs.observe(el));

  // --- Image error handling ---
  document.querySelectorAll('img').forEach((img) => {
    const handleError = () => {
      img.style.display = 'none';
      img.dataset.failed = 'true';
    };
    img.addEventListener('error', handleError);
    if (img.complete && img.naturalWidth === 0 && img.src) handleError();
  });

  // ========================================
  // PARTICLE SYSTEM
  // ========================================
  const particleConfigs = {
    intro:     { type: 'firefly', count: 12, sizeMin: 2, sizeMax: 5 },
    tundra:    { type: 'snow',    count: 35, sizeMin: 2, sizeMax: 6 },
    boreal:    { type: 'pine',    count: 18, sizeMin: 1, sizeMax: 3, wMin: 2, hMin: 8, wMax: 3, hMax: 14 },
    temprain:  { type: 'raindrop',count: 45, sizeMin: 1, sizeMax: 2, wMin: 1, hMin: 12, wMax: 2, hMax: 20 },
    deciduous: { type: 'leaf',    count: 20, sizeMin: 8, sizeMax: 16 },
    tropical:  { type: 'firefly', count: 18, sizeMin: 2, sizeMax: 5 },
    chaparral: { type: 'ember',   count: 12, sizeMin: 2, sizeMax: 5 },
    grassland: { type: 'seed',    count: 14, sizeMin: 2, sizeMax: 5 },
    savanna:   { type: 'dust',    count: 12, sizeMin: 3, sizeMax: 7 },
    desert:    { type: 'dust',    count: 15, sizeMin: 2, sizeMax: 5 },
  };

  // Leaf color palettes
  const leafColors = ['#c2884a', '#d4763a', '#b85c38', '#e6a23c', '#8b5a2b', '#c0392b'];

  function spawnParticles() {
    for (const [id, cfg] of Object.entries(particleConfigs)) {
      const section = document.getElementById(id);
      if (!section) continue;

      const container = document.createElement('div');
      container.className = 'particles';

      for (let i = 0; i < cfg.count; i++) {
        const p = document.createElement('div');
        p.className = 'particle ' + cfg.type;

        // Random position
        p.style.left = Math.random() * 100 + '%';
        p.style.top = Math.random() * 100 + '%';

        // Size
        if (cfg.wMin) {
          // Rectangular particles (rain, pine needles)
          const w = cfg.wMin + Math.random() * (cfg.wMax - cfg.wMin);
          const h = cfg.hMin + Math.random() * (cfg.hMax - cfg.hMin);
          p.style.width = w + 'px';
          p.style.height = h + 'px';
        } else {
          const size = cfg.sizeMin + Math.random() * (cfg.sizeMax - cfg.sizeMin);
          p.style.width = size + 'px';
          p.style.height = size + 'px';
        }

        // Varied timing
        const duration = getDuration(cfg.type);
        p.style.animationDuration = duration + 's';
        p.style.animationDelay = (Math.random() * duration) + 's';

        // Leaf colors
        if (cfg.type === 'leaf') {
          p.style.backgroundColor = leafColors[Math.floor(Math.random() * leafColors.length)];
        }

        container.appendChild(p);
      }

      section.appendChild(container);
    }
  }

  function getDuration(type) {
    switch (type) {
      case 'snow':     return 6 + Math.random() * 8;
      case 'leaf':     return 8 + Math.random() * 10;
      case 'raindrop': return 1.5 + Math.random() * 2;
      case 'ember':    return 5 + Math.random() * 6;
      case 'firefly':  return 4 + Math.random() * 8;
      case 'dust':     return 6 + Math.random() * 10;
      case 'seed':     return 6 + Math.random() * 8;
      case 'pine':     return 5 + Math.random() * 8;
      default:         return 5 + Math.random() * 5;
    }
  }

  // ========================================
  // GRADIENT FADES BETWEEN SECTIONS
  // ========================================
  function addGradientFades() {
    const sections = document.querySelectorAll('.biome-sec');
    sections.forEach((sec, i) => {
      // Don't add fade to the last section (end card)
      if (i >= sections.length - 1) return;
      const fade = document.createElement('div');
      fade.className = 'gradient-fade';
      sec.appendChild(fade);
    });
  }

  // ========================================
  // INITIALIZE
  // ========================================
  // Use requestAnimationFrame to not block initial render
  requestAnimationFrame(() => {
    spawnParticles();
    addGradientFades();
  });

})();
