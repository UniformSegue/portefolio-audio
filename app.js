const state = {
  data: null,
  currentTrackIndex: 0,
  isPlaying: false,
  activeInstrumentCat: 'ALL',
  activeProjectCat: 'ALL',
  wavesurfer: null,
  modalTrackIndex: null
};

function esc(str = '') {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function formatTime(seconds) {
  if (!Number.isFinite(seconds) || seconds < 0) return '00:00';
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
}

function getYouTubeEmbedUrl(url) {
  try {
    const parsed = new URL(url);
    if (parsed.hostname.includes('youtu.be')) {
      return `https://www.youtube.com/embed/${parsed.pathname.slice(1)}`;
    }
    if (parsed.hostname.includes('youtube.com')) {
      const v = parsed.searchParams.get('v');
      if (v) return `https://www.youtube.com/embed/${v}`;
      if (parsed.pathname.startsWith('/embed/')) return url;
    }
  } catch (_) {}
  return url;
}

function parseMasteryPercent(levelStr = '') {
  const match = String(levelStr).match(/(\d+)\s*%/);
  if (match) return Math.min(100, Math.max(10, Number(match[1])));
  const lower = String(levelStr).toLowerCase();
  if (lower.includes('expert') || lower.includes('maîtrise')) return 95;
  if (lower.includes('avancé')) return 80;
  if (lower.includes('intermédiaire')) return 65;
  if (lower.includes('débutant') || lower.includes('initiation')) return 35;
  return 75;
}

// Pilote la rotation des bobines de la cassette et le statut LED
function setTapeDeckState(playing) {
  const reels = document.querySelectorAll('#track-modal .tape-reel');
  const led = document.getElementById('tape-led');
  const statusLabel = document.getElementById('tape-status-label');

  reels.forEach(reel => {
    reel.classList.toggle('is-playing', Boolean(playing));
  });

  if (led) {
    led.className = playing
      ? 'w-1.5 h-1.5 rounded-full bg-neonCyan animate-ping'
      : 'w-1.5 h-1.5 rounded-full bg-zinc-600';
  }

  if (statusLabel) {
    statusLabel.textContent = playing
      ? 'TAPE_DECK // RUNNING'
      : 'TAPE_DECK // PAUSED';
    statusLabel.className = playing ? 'text-neonCyan' : 'text-zinc-500';
  }
}

// Simule le transfert de bande magnétique entre la bobine gauche et droite selon l'avancement
function updateTapeSpools(progressRatio = 0) {
  const clamped = Math.min(1, Math.max(0, progressRatio));
  const leftPack = document.getElementById('tape-pack-left');
  const rightPack = document.getElementById('tape-pack-right');

  if (leftPack && rightPack) {
    const leftWidth = (12 - clamped * 8).toFixed(1);
    const rightWidth = (4 + clamped * 8).toFixed(1);
    const leftRadius = (28 - clamped * 5).toFixed(1);
    const rightRadius = (23 + clamped * 5).toFixed(1);

    leftPack.setAttribute('stroke-width', leftWidth);
    leftPack.setAttribute('r', leftRadius);
    rightPack.setAttribute('stroke-width', rightWidth);
    rightPack.setAttribute('r', rightRadius);
  }
}

// 1. RENDU HERO
function renderHero(hero) {
  document.getElementById('nav-logo').textContent = `${hero.alias || 'PORTFOLIO'} //`;
  document.title = `${hero.alias || 'Portfolio'} — Audio & Hardware Lab`;

  const linksHtml = (hero.links || [])
    .map(l => `
      <a href="${esc(l.url)}" target="_blank" rel="noopener noreferrer"
         class="px-4 py-2 rounded-lg bg-panel border border-border hover:border-neonCyan hover:text-neonCyan font-mono text-xs uppercase tracking-wider transition flex items-center gap-2">
        <span>${esc(l.label)}</span>
        <span class="text-zinc-600">↗</span>
      </a>
    `).join('');

  document.getElementById('hero-container').className = 'space-y-6';
  document.getElementById('hero-container').innerHTML = `
    <div class="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-panel border border-border font-mono text-xs text-neonCyan">
      <span class="w-2 h-2 rounded-full bg-neonCyan animate-ping"></span>
      <span>${esc(hero.status || 'ONLINE')}</span>
    </div>
    <div class="space-y-3 max-w-3xl">
      <h1 class="text-4xl sm:text-6xl font-bold tracking-tight text-white">${esc(hero.alias)}</h1>
      <p class="font-mono text-sm sm:text-base text-neonPurple">${esc(hero.tagline)}</p>
      <p class="text-zinc-400 leading-relaxed pt-2">${esc(hero.bio)}</p>
    </div>
    <div class="flex flex-wrap gap-3 pt-2">${linksHtml}</div>
  `;
}

// 2. LECTEUR AUDIO, CASSETTE TAPE & MODALE WAVESURFER
function initAudioPlayer(tracks) {
  const audio = document.getElementById('audio-element');
  const btnPlay = document.getElementById('btn-play');
  const playLabel = document.getElementById('play-label');
  const btnPrev = document.getElementById('btn-prev');
  const btnNext = document.getElementById('btn-next');
  const seekSlider = document.getElementById('seek-slider');
  const volSlider = document.getElementById('volume-slider');
  const curTimeEl = document.getElementById('current-time');
  const totTimeEl = document.getElementById('total-duration');
  const eqIndicator = document.getElementById('eq-indicator');
  const errorEl = document.getElementById('audio-error');

  document.getElementById('track-count').textContent = `${tracks.length} TRACKS`;

  if (!tracks.length) {
    document.getElementById('playlist-container').innerHTML =
      `<p class="font-mono text-xs text-zinc-500">Aucune piste dans data.json.</p>`;
    return;
  }

  function renderPlaylist() {
    document.getElementById('playlist-container').innerHTML = tracks.map((t, idx) => {
      const active = idx === state.currentTrackIndex;
      return `
        <div class="track-row w-full p-3.5 rounded-xl border transition flex items-center justify-between gap-4 ${
          active
            ? 'bg-zinc-900/90 border-neonCyan text-white'
            : 'bg-panel border-border hover:border-zinc-600 text-zinc-300'
        }">
          <button data-play-index="${idx}" class="flex items-center gap-3.5 min-w-0 flex-1 text-left">
            <span class="font-mono text-xs ${active ? 'text-neonCyan font-bold' : 'text-zinc-600'}">
              ${String(idx + 1).padStart(2, '0')}
            </span>
            <div class="min-w-0">
              <p class="font-bold text-sm truncate">${esc(t.title)}</p>
              <p class="font-mono text-[11px] text-zinc-500 truncate">
                ${esc(t.BPM)} BPM • ${esc(t.key)} • ${(t.tags || []).map(esc).join(' / ')}
              </p>
            </div>
          </button>

          <div class="flex items-center gap-3 shrink-0">
            <button data-detail-index="${idx}"
              class="px-2.5 py-1 rounded-md bg-zinc-900 border border-border hover:border-neonCyan hover:text-neonCyan font-mono text-[11px] text-zinc-400 transition">
              DÉTAILS
            </button>
            <span class="font-mono text-xs text-zinc-400 w-11 text-right">${esc(t.duration || '--:--')}</span>
          </div>
        </div>
      `;
    }).join('');

    document.querySelectorAll('[data-play-index]').forEach(btn => {
      btn.addEventListener('click', () => {
        const idx = Number(btn.dataset.playIndex);
        if (idx === state.currentTrackIndex && state.isPlaying) {
          pauseTrack();
        } else {
          loadTrack(idx, true);
        }
      });
    });

    document.querySelectorAll('[data-detail-index]').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        openTrackModal(Number(btn.dataset.detailIndex));
      });
    });
  }

  function loadTrack(index, autoplay = false) {
    state.currentTrackIndex = (index + tracks.length) % tracks.length;
    const t = tracks[state.currentTrackIndex];
    errorEl.classList.add('hidden');

    document.getElementById('player-title').textContent = t.title;
    document.getElementById('player-bpm').textContent = `${t.BPM} BPM`;
    document.getElementById('player-key').textContent = t.key;
    document.getElementById('player-cover').src = t.cover || '';
    document.getElementById('player-tags').innerHTML = (t.tags || [])
      .map(tag => `<span class="px-2 py-0.5 rounded bg-zinc-900 border border-border font-mono text-[10px] text-zinc-400">${esc(tag)}</span>`)
      .join('');

    totTimeEl.textContent = t.duration || '00:00';
    curTimeEl.textContent = '00:00';
    seekSlider.value = 0;
    updateTapeSpools(0);

    audio.src = t.src;
    renderPlaylist();

    if (autoplay) playTrack();
  }

  function playTrack() {
    audio.play().then(() => {
      state.isPlaying = true;
      playLabel.textContent = 'PAUSE';
      eqIndicator.classList.remove('hidden');
      setTapeDeckState(true);
      renderPlaylist();
    }).catch(() => {
      state.isPlaying = false;
      playLabel.textContent = 'PLAY';
      eqIndicator.classList.add('hidden');
      setTapeDeckState(false);
      errorEl.textContent = `Fichier introuvable ou non supporté : ${tracks[state.currentTrackIndex].src}`;
      errorEl.classList.remove('hidden');
    });
  }

  function pauseTrack() {
    audio.pause();
    state.isPlaying = false;
    playLabel.textContent = 'PLAY';
    eqIndicator.classList.add('hidden');
    setTapeDeckState(false);
    renderPlaylist();
  }

  btnPlay.addEventListener('click', () => (state.isPlaying ? pauseTrack() : playTrack()));
  btnPrev.addEventListener('click', () => loadTrack(state.currentTrackIndex - 1, state.isPlaying));
  btnNext.addEventListener('click', () => loadTrack(state.currentTrackIndex + 1, state.isPlaying));

  audio.addEventListener('timeupdate', () => {
    if (audio.duration) {
      const ratio = audio.currentTime / audio.duration;
      seekSlider.value = ratio * 100;
      const formattedCur = formatTime(audio.currentTime);
      const formattedTot = formatTime(audio.duration);
      curTimeEl.textContent = formattedCur;
      totTimeEl.textContent = formattedTot;

      if (state.modalTrackIndex === state.currentTrackIndex) {
        document.getElementById('modal-current-time').textContent = formattedCur;
        document.getElementById('modal-total-time').textContent = formattedTot;
        updateTapeSpools(ratio);
      }
    }
  });

  // Synchronisation directe des boutons et des bobines de la cassette sur les événements natifs
  audio.addEventListener('play', () => {
    document.getElementById('modal-play-btn').textContent = 'PAUSE';
    setTapeDeckState(true);
  });

  audio.addEventListener('pause', () => {
    document.getElementById('modal-play-btn').textContent = 'PLAY';
    setTapeDeckState(false);
  });

  seekSlider.addEventListener('input', () => {
    if (audio.duration) {
      audio.currentTime = (seekSlider.value / 100) * audio.duration;
    }
  });

  volSlider.addEventListener('input', () => {
    audio.volume = Number(volSlider.value);
  });

  audio.addEventListener('ended', () => {
    setTapeDeckState(false);
    loadTrack(state.currentTrackIndex + 1, true);
  });

  document.getElementById('player-cover-trigger').addEventListener('click', () => {
    openTrackModal(state.currentTrackIndex);
  });

  const modal = document.getElementById('track-modal');
  const modalPlayBtn = document.getElementById('modal-play-btn');

  function openTrackModal(index) {
    state.modalTrackIndex = index;
    const t = tracks[index];

    if (index !== state.currentTrackIndex) {
      loadTrack(index, state.isPlaying);
    }

    document.getElementById('modal-cover').src = t.cover || '';
    document.getElementById('modal-title').textContent = t.title;
    document.getElementById('modal-bpm').textContent = `${t.BPM} BPM`;
    document.getElementById('modal-key').textContent = `KEY: ${t.key}`;
    document.getElementById('modal-duration').textContent = t.duration || '00:00';
    document.getElementById('modal-process').textContent =
      t.process_description || 'Aucune note de production renseignée pour ce morceau.';

    const reelCounter = document.getElementById('tape-reel-counter');
    if (reelCounter) {
      reelCounter.textContent = `${t.BPM} BPM // KEY ${t.key}`;
    }

    document.getElementById('modal-tags').innerHTML = (t.tags || [])
      .map(tag => `<span class="px-2.5 py-0.5 rounded bg-zinc-900 border border-border font-mono text-xs text-zinc-300">${esc(tag)}</span>`)
      .join('');

    const gearBlock = document.getElementById('modal-gear-block');
    if (t.gear_used && t.gear_used.length) {
      gearBlock.classList.remove('hidden');
      document.getElementById('modal-gear').innerHTML = t.gear_used
        .map(g => `<span class="px-2.5 py-1 rounded bg-neonPurple/10 border border-neonPurple/40 font-mono text-xs text-neonPurple">${esc(g)}</span>`)
        .join('');
    } else {
      gearBlock.classList.add('hidden');
    }

    modalPlayBtn.textContent = state.isPlaying ? 'PAUSE' : 'PLAY';
    document.getElementById('modal-current-time').textContent = formatTime(audio.currentTime);
    document.getElementById('modal-total-time').textContent = t.duration || '00:00';

    // Synchronise l'état des bobines dès l'ouverture de la modale
    setTapeDeckState(state.isPlaying);
    updateTapeSpools(audio.duration ? audio.currentTime / audio.duration : 0);

    modal.classList.remove('hidden');
    modal.classList.add('flex');
    document.body.style.overflow = 'hidden';

    const statusEl = document.getElementById('waveform-status');
    statusEl.textContent = 'ANALYSE DU SPECTRE AUDIO...';

    if (state.wavesurfer) {
      state.wavesurfer.destroy();
    }

    if (window.WaveSurfer) {
      state.wavesurfer = WaveSurfer.create({
        container: '#waveform-container',
        media: audio,
        interact: false,
        waveColor: '#27272a',
        progressColor: '#00f0ff',
        cursorColor: '#a855f7',
        barWidth: 3,
        barGap: 2,
        barRadius: 2,
        height: 96,
        normalize: true
      });

      document.getElementById('waveform-container').onclick = (e) => {
        if (audio.duration) {
          const rect = e.currentTarget.getBoundingClientRect();
          const clickPosition = (e.clientX - rect.left) / rect.width;
          audio.currentTime = clickPosition * audio.duration;
        }
      };

      state.wavesurfer.on('ready', () => {
        statusEl.textContent = 'CLIQUEZ SUR L\'ONDE POUR NAVIGUER';
      });

      state.wavesurfer.on('error', () => {
        statusEl.textContent = 'FORME D\'ONDE INDISPONIBLE (VÉRIFIEZ LE FICHIER AUDIO)';
      });
    }
  }

  function closeTrackModal() {
    modal.classList.add('hidden');
    modal.classList.remove('flex');
    document.body.style.overflow = '';
  }

  modalPlayBtn.addEventListener('click', () => {
    state.isPlaying ? pauseTrack() : playTrack();
  });

  document.getElementById('modal-close').addEventListener('click', closeTrackModal);
  document.getElementById('track-modal-backdrop').addEventListener('click', closeTrackModal);
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !modal.classList.contains('hidden')) {
      closeTrackModal();
    }
  });

  audio.volume = Number(volSlider.value);
  loadTrack(0, false);
}

// 3. RENDU VIDÉOS & AMV
function renderVideos(videos) {
  document.getElementById('video-count').textContent = `${videos.length} CLIPS`;
  const grid = document.getElementById('videos-grid');

  grid.innerHTML = videos.map(v => {
    const isYT = v.type === 'youtube' || v.url.includes('youtube.com') || v.url.includes('youtu.be');
    const mediaHtml = isYT
      ? `<iframe src="${esc(getYouTubeEmbedUrl(v.url))}" title="${esc(v.title)}"
           class="w-full aspect-video bg-black" frameborder="0"
           allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
           allowfullscreen loading="lazy"></iframe>`
      : `<video src="${esc(v.url)}" controls preload="metadata" class="w-full aspect-video bg-black object-cover"></video>`;

    return `
      <article class="bg-panel border border-border rounded-xl overflow-hidden flex flex-col hover:border-neonPurple/60 transition">
        ${mediaHtml}
        <div class="p-5 space-y-2 flex-1 flex flex-col justify-between">
          <div class="space-y-1">
            <div class="flex items-center justify-between gap-2">
              <span class="font-mono text-[11px] text-neonPurple uppercase">${esc(v.anime || 'AMV')}</span>
              <span class="font-mono text-[10px] px-2 py-0.5 rounded bg-zinc-900 border border-border text-zinc-500 uppercase">${isYT ? 'YOUTUBE' : 'LOCAL MP4'}</span>
            </div>
            <h3 class="text-lg font-bold text-white">${esc(v.title)}</h3>
          </div>
          <p class="text-sm text-zinc-400 leading-relaxed pt-1">${esc(v.description || '')}</p>
        </div>
      </article>
    `;
  }).join('');
}

// 4. RENDU INSTRUMENTS & TOOLS
function renderInstruments(items) {
  const filtersEl = document.getElementById('instruments-filters');
  const gridEl = document.getElementById('instruments-grid');
  if (!filtersEl || !gridEl) return;

  const categories = ['ALL', ...new Set(items.map(i => i.category).filter(Boolean))];

  function updateView() {
    filtersEl.innerHTML = categories.map(cat => {
      const active = state.activeInstrumentCat === cat;
      return `
        <button data-inst-cat="${esc(cat)}"
          class="px-3 py-1 rounded-md border transition uppercase ${
            active
              ? 'bg-neonCyan text-black border-neonCyan font-bold'
              : 'bg-panel border-border text-zinc-400 hover:border-zinc-500'
          }">
          ${esc(cat)}
        </button>
      `;
    }).join('');

    filtersEl.querySelectorAll('[data-inst-cat]').forEach(btn => {
      btn.addEventListener('click', () => {
        state.activeInstrumentCat = btn.dataset.instCat;
        updateView();
      });
    });

    const filtered = state.activeInstrumentCat === 'ALL'
      ? items
      : items.filter(i => i.category === state.activeInstrumentCat);

    gridEl.innerHTML = filtered.map((item) => {
      const realIndex = items.indexOf(item);
      const percent = parseMasteryPercent(item.mastery_level);
      return `
        <article data-inst-index="${realIndex}"
          class="group cursor-pointer bg-panel border border-border rounded-xl overflow-hidden hover:border-neonCyan transition flex flex-col">
          <div class="h-44 bg-zinc-900 overflow-hidden relative border-b border-border">
            <img src="${esc(item.image)}" alt="${esc(item.name)}"
                 class="w-full h-full object-cover opacity-85 group-hover:scale-105 group-hover:opacity-100 transition duration-500" loading="lazy" />
            <span class="absolute top-3 left-3 px-2.5 py-1 rounded bg-void/90 border border-border font-mono text-[10px] text-neonCyan uppercase">
              ${esc(item.category)}
            </span>
            <span class="absolute bottom-3 right-3 px-2.5 py-1 rounded bg-void/90 border border-border font-mono text-[10px] text-zinc-300">
              ${esc(item.practice_since || '')}
            </span>
          </div>
          <div class="p-5 flex-1 flex flex-col justify-between space-y-4">
            <div class="space-y-2">
              <h3 class="text-lg font-bold text-white group-hover:text-neonCyan transition">${esc(item.name)}</h3>
              <p class="text-sm text-zinc-400 leading-relaxed line-clamp-2">${esc(item.description)}</p>
            </div>
            <div class="space-y-2 pt-2 border-t border-border/60">
              <div class="flex items-center justify-between font-mono text-[11px]">
                <span class="text-zinc-500">MAÎTRISE</span>
                <span class="text-neonCyan font-bold">${esc(item.mastery_level || 'Avancé')}</span>
              </div>
              <div class="w-full h-1.5 bg-zinc-900 rounded-full overflow-hidden">
                <div class="h-full bg-neonCyan" style="width: ${percent}%"></div>
              </div>
              <div class="pt-1 flex justify-end">
                <span class="font-mono text-[10px] text-zinc-400 group-hover:text-neonCyan uppercase tracking-wider">Voir la fiche →</span>
              </div>
            </div>
          </div>
        </article>
      `;
    }).join('');

    gridEl.querySelectorAll('[data-inst-index]').forEach(card => {
      card.addEventListener('click', () => {
        const item = items[Number(card.dataset.instIndex)];
        openItemModal('instrument', item);
      });
    });
  }

  updateView();
}

// 5. RENDU PROJETS HARDWARE & ACOUSTIQUE
function renderProjects(items) {
  const filtersEl = document.getElementById('projects-filters');
  const gridEl = document.getElementById('projects-grid');
  if (!filtersEl || !gridEl) return;

  const categories = ['ALL', ...new Set(items.map(i => i.category).filter(Boolean))];

  function updateView() {
    filtersEl.innerHTML = categories.map(cat => {
      const active = state.activeProjectCat === cat;
      return `
        <button data-proj-cat="${esc(cat)}"
          class="px-3 py-1 rounded-md border transition uppercase ${
            active
              ? 'bg-neonPurple text-black border-neonPurple font-bold'
              : 'bg-panel border-border text-zinc-400 hover:border-zinc-500'
          }">
          ${esc(cat)}
        </button>
      `;
    }).join('');

    filtersEl.querySelectorAll('[data-proj-cat]').forEach(btn => {
      btn.addEventListener('click', () => {
        state.activeProjectCat = btn.dataset.projCat;
        updateView();
      });
    });

    const filtered = state.activeProjectCat === 'ALL'
      ? items
      : items.filter(i => i.category === state.activeProjectCat);

    gridEl.innerHTML = filtered.map((item) => {
      const realIndex = items.indexOf(item);
      const isDone = String(item.status || '').toLowerCase().includes('termin');
      const statusClasses = isDone
        ? 'bg-emerald-950/90 border-emerald-700/60 text-emerald-300'
        : 'bg-amber-950/90 border-amber-700/60 text-amber-300';

      return `
        <article data-proj-index="${realIndex}"
          class="group cursor-pointer bg-panel border border-border rounded-xl overflow-hidden hover:border-neonPurple transition flex flex-col">
          <div class="h-44 bg-zinc-900 overflow-hidden relative border-b border-border">
            <img src="${esc(item.image)}" alt="${esc(item.title || item.name)}"
                 class="w-full h-full object-cover opacity-85 group-hover:scale-105 group-hover:opacity-100 transition duration-500" loading="lazy" />
            <span class="absolute top-3 left-3 px-2.5 py-1 rounded bg-void/90 border border-border font-mono text-[10px] text-neonPurple uppercase">
              ${esc(item.category)}
            </span>
            <span class="absolute top-3 right-3 px-2.5 py-1 rounded border font-mono text-[10px] uppercase ${statusClasses}">
              ${esc(item.status || 'PROJET')}
            </span>
          </div>
          <div class="p-5 flex-1 flex flex-col justify-between space-y-4">
            <div class="space-y-2">
              <h3 class="text-lg font-bold text-white group-hover:text-neonPurple transition">${esc(item.title || item.name)}</h3>
              <p class="text-sm text-zinc-400 leading-relaxed line-clamp-2">${esc(item.description)}</p>
            </div>
            <div class="space-y-3 pt-2 border-t border-border/60">
              <div class="flex flex-wrap gap-1.5">
                ${(item.specs || []).map(s => `
                  <span class="px-2 py-0.5 rounded bg-zinc-900 font-mono text-[10px] text-zinc-300 border border-border">
                    ${esc(s)}
                  </span>
                `).join('')}
              </div>
              <div class="flex justify-end">
                <span class="font-mono text-[10px] text-zinc-400 group-hover:text-neonPurple uppercase tracking-wider">Détails de conception →</span>
              </div>
            </div>
          </div>
        </article>
      `;
    }).join('');

    gridEl.querySelectorAll('[data-proj-index]').forEach(card => {
      card.addEventListener('click', () => {
        const item = items[Number(card.dataset.projIndex)];
        openItemModal('project', item);
      });
    });
  }

  updateView();
}

// 6. MODALE UNIFIÉE POUR INSTRUMENTS & PROJETS HARDWARE
function initItemModal() {
  const modal = document.getElementById('item-modal');
  const closeBtn = document.getElementById('item-modal-close');
  const backdrop = document.getElementById('item-modal-backdrop');
  if (!modal || !closeBtn || !backdrop) return;

  function closeItemModal() {
    modal.classList.add('hidden');
    modal.classList.remove('flex');
    document.body.style.overflow = '';
  }

  closeBtn.addEventListener('click', closeItemModal);
  backdrop.addEventListener('click', closeItemModal);
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !modal.classList.contains('hidden')) {
      closeItemModal();
    }
  });
}

function openItemModal(type, item) {
  const modal = document.getElementById('item-modal');
  if (!modal) return;
  const instMeta = document.getElementById('item-modal-instrument-meta');
  const projMeta = document.getElementById('item-modal-project-meta');
  const headerLabel = document.getElementById('item-modal-header-label');
  const dot = document.getElementById('item-modal-dot');
  const catEl = document.getElementById('item-modal-category');
  const descTitle = document.getElementById('item-modal-desc-title');

  document.getElementById('item-modal-image').src = item.image || '';
  document.getElementById('item-modal-category').textContent = item.category || '';
  document.getElementById('item-modal-description').textContent = item.description || '';

  if (type === 'instrument') {
    headerLabel.textContent = '// INSTRUMENT_&_TOOL_INSPECTOR';
    dot.className = 'w-2 h-2 rounded-full bg-neonCyan animate-pulse';
    catEl.className = 'font-mono text-xs text-neonCyan uppercase tracking-wider';
    descTitle.textContent = '// UTILISATION & WORKFLOW';

    document.getElementById('item-modal-title').textContent = item.name || '';
    document.getElementById('item-modal-mastery-text').textContent = item.mastery_level || 'Avancé';
    document.getElementById('item-modal-mastery-bar').style.width = `${parseMasteryPercent(item.mastery_level)}%`;
    document.getElementById('item-modal-since').textContent = item.practice_since || '-';

    instMeta.classList.remove('hidden');
    projMeta.classList.add('hidden');
  } else {
    headerLabel.textContent = '// HARDWARE_&_ACOUSTICS_INSPECTOR';
    dot.className = 'w-2 h-2 rounded-full bg-neonPurple animate-pulse';
    catEl.className = 'font-mono text-xs text-neonPurple uppercase tracking-wider';
    descTitle.textContent = '// CONCEPTION & ARCHITECTURE TECHNIQUE';

    document.getElementById('item-modal-title').textContent = item.title || item.name || '';

    const statusEl = document.getElementById('item-modal-status');
    const isDone = String(item.status || '').toLowerCase().includes('termin');
    statusEl.textContent = item.status || 'En développement';
    statusEl.className = isDone
      ? 'px-2.5 py-0.5 rounded font-bold uppercase bg-emerald-950 border border-emerald-700 text-emerald-300'
      : 'px-2.5 py-0.5 rounded font-bold uppercase bg-amber-950 border border-amber-700 text-amber-300';

    document.getElementById('item-modal-specs').innerHTML = (item.specs || [])
      .map(s => `<span class="px-2.5 py-1 rounded bg-neonPurple/10 border border-neonPurple/40 font-mono text-xs text-neonPurple">${esc(s)}</span>`)
      .join('');

    projMeta.classList.remove('hidden');
    instMeta.classList.add('hidden');
  }

  modal.classList.remove('hidden');
  modal.classList.add('flex');
  document.body.style.overflow = 'hidden';
}

// INITIALISATION GLOBALE
async function bootstrap() {
  try {
    const res = await fetch(`./data.json?v=${Date.now()}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    state.data = data;

    renderHero(data.hero || {});
    initAudioPlayer(data.tracks || []);
    renderVideos(data.videos || []);
    renderInstruments(data.instruments_tools || []);
    renderProjects(data.hardware_projects || data.labo || []);
    initItemModal();
  } catch (err) {
    console.error('Erreur détaillée bootstrap:', err);
    const heroEl = document.getElementById('hero-container');
    if (heroEl) {
      heroEl.innerHTML = `
        <div class="p-4 rounded-xl bg-rose-950/40 border border-rose-800 font-mono text-xs text-rose-300">
          Erreur d'initialisation JS : <strong>${esc(err.message)}</strong>.<br>
          Vérifiez la console (F12) ou rafraîchissez le cache (Ctrl+Shift+R).
        </div>
      `;
    }
  }
}

document.addEventListener('DOMContentLoaded', bootstrap);