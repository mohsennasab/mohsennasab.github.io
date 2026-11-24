/* Interactive scripts for Python for H&H Modeling and Analysis */
(function () {
  "use strict";

  const DATA = window.COURSE_DATA;
  const STORAGE_KEY = "hh_python_course_done_v1";

  /* ---------------- Clipboard helper ---------------- */
  function copyText(text, btn) {
    if (!navigator.clipboard) {
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.select();
      try {
        document.execCommand("copy");
      } catch (e) {
        /* ignore */
      }
      document.body.removeChild(ta);
    } else {
      navigator.clipboard.writeText(text).catch(function () {});
    }
    if (btn) {
      const orig = btn.dataset.orig || btn.textContent;
      btn.dataset.orig = orig;
      btn.textContent = "Copied";
      setTimeout(function () {
        btn.textContent = orig;
      }, 1400);
    }
  }

  /* ---------------- 1. Curriculum & Progress ---------------- */
  function loadDoneSet() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      return new Set(raw ? JSON.parse(raw) : []);
    } catch (e) {
      return new Set();
    }
  }

  function saveDoneSet(set) {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(Array.from(set)));
    } catch (e) {
      /* ignore storage restrictions */
    }
  }

  const state = {
    path: "all",
    level: "all",
    query: "",
    openModules: new Set([1, 10]),
    doneLessons: loadDoneSet(),
    activeCodeTab: DATA.codeTabs[0].id,
    toolCategory: "All"
  };

  const totalLessons = DATA.modules.reduce(function (acc, m) {
    return acc + m.lessons.length;
  }, 0);

  function updateProgressUI() {
    const count = state.doneLessons.size;
    const pct = totalLessons ? Math.round((count / totalLessons) * 100) : 0;
    const label = document.getElementById("progressText");
    const fill = document.getElementById("progressFill");
    if (label) {
      label.textContent = count + " / " + totalLessons + " lessons completed";
    }
    if (fill) {
      fill.style.width = pct + "%";
    }
  }

  function levelBadgeClass(level) {
    const low = level.toLowerCase();
    if (low.indexOf("advanced") !== -1) return "badge-advanced";
    if (low.indexOf("intermediate") !== -1) return "badge-intermediate";
    return "badge-beginner";
  }

  function moduleMatches(mod) {
    if (state.path !== "all") {
      const pathObj = DATA.paths.find(function (p) {
        return p.id === state.path;
      });
      if (pathObj && pathObj.moduleNums && pathObj.moduleNums.indexOf(mod.num) === -1) {
        return false;
      }
    }
    if (state.level !== "all") {
      if (mod.level.toLowerCase().indexOf(state.level) === -1) {
        return false;
      }
    }
    if (state.query.trim()) {
      const q = state.query.trim().toLowerCase();
      const hay = [
        mod.title,
        mod.summary,
        mod.overview,
        mod.studyArea,
        mod.libraries.join(" "),
        mod.lessons.map(function (l) {
          return l.title + " " + l.notebook;
        }).join(" ")
      ]
        .join(" ")
        .toLowerCase();
      if (hay.indexOf(q) === -1) {
        return false;
      }
    }
    return true;
  }

  function renderPaths() {
    const wrap = document.getElementById("pathRow");
    const note = document.getElementById("pathNote");
    if (!wrap) return;
    wrap.innerHTML = "";
    DATA.paths.forEach(function (p) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "path-btn" + (state.path === p.id ? " active" : "");
      btn.textContent = p.label;
      btn.addEventListener("click", function () {
        state.path = p.id;
        renderPaths();
        renderModules();
      });
      wrap.appendChild(btn);
    });
    const activeObj = DATA.paths.find(function (p) {
      return p.id === state.path;
    });
    if (note && activeObj) {
      note.textContent = activeObj.description;
    }
  }

  function renderModules() {
    const list = document.getElementById("moduleList");
    if (!list) return;
    list.innerHTML = "";

    const filtered = DATA.modules.filter(moduleMatches);
    if (!filtered.length) {
      const empty = document.createElement("div");
      empty.className = "empty-state";
      empty.textContent = "No modules match that filter. Clear the search box or switch back to All Modules.";
      list.appendChild(empty);
      return;
    }

    filtered.forEach(function (mod) {
      const isOpen = state.openModules.has(mod.num);
      const doneInMod = mod.lessons.filter(function (l) {
        return state.doneLessons.has(l.id);
      }).length;

      const card = document.createElement("article");
      card.className = "module-card" + (isOpen ? " is-open" : "");
      card.id = "module-" + mod.num;

      const trigger = document.createElement("button");
      trigger.type = "button";
      trigger.className = "module-trigger";
      trigger.setAttribute("aria-expanded", String(isOpen));
      trigger.innerHTML =
        '<span class="mod-num">Module ' + mod.num + '</span>' +
        '<div class="mod-head-main">' +
        '  <h3>' + mod.title + '</h3>' +
        '  <p>' + mod.summary + '</p>' +
        '</div>' +
        '<div class="mod-head-meta">' +
        '  <span class="badge ' + levelBadgeClass(mod.level) + '">' + mod.level + '</span>' +
        '  <span class="mod-count">' + doneInMod + '/' + mod.lessons.length + ' done</span>' +
        '  <svg class="chevron" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M4 6l4 4 4-4"/></svg>' +
        '</div>';

      trigger.addEventListener("click", function () {
        if (state.openModules.has(mod.num)) {
          state.openModules.delete(mod.num);
        } else {
          state.openModules.add(mod.num);
        }
        renderModules();
      });

      const body = document.createElement("div");
      body.className = "module-body";

      const libsHtml = mod.libraries
        .map(function (lib) {
          return '<span class="lib-tag">' + lib + '</span>';
        })
        .join("");

      const outcomesHtml = mod.outcomes
        .map(function (item) {
          return "<li>" + item + "</li>";
        })
        .join("");

      body.innerHTML =
        '<div class="mod-overview-grid">' +
        '  <div class="mod-overview-text">' +
        '    <p>' + mod.overview + '</p>' +
        '    <p class="mod-study-line"><strong>Study area &amp; data:</strong> ' + mod.studyArea + '</p>' +
        '    <div class="lib-tags">' + libsHtml + '</div>' +
        '  </div>' +
        '  <div class="mod-outcomes">' +
        '    <h4>Learning Objectives</h4>' +
        '    <ul>' + outcomesHtml + '</ul>' +
        '  </div>' +
        '</div>' +
        '<div class="lessons-block"><h4>Lessons &amp; Notebooks</h4></div>';

      const lessonsBlock = body.querySelector(".lessons-block");
      mod.lessons.forEach(function (lesson) {
        const checked = state.doneLessons.has(lesson.id);
        const colabUrl = DATA.colabBase + "/" + mod.slug + "/" + lesson.notebook;
        const ghUrl = DATA.repoUrl + "/blob/main/notebooks/" + mod.slug + "/" + lesson.notebook;

        const row = document.createElement("div");
        row.className = "lesson-row" + (checked ? " is-done" : "");

        const label = document.createElement("label");
        label.className = "lesson-check-label";
        const cb = document.createElement("input");
        cb.type = "checkbox";
        cb.checked = checked;
        cb.addEventListener("change", function () {
          if (cb.checked) {
            state.doneLessons.add(lesson.id);
          } else {
            state.doneLessons.delete(lesson.id);
          }
          saveDoneSet(state.doneLessons);
          updateProgressUI();
          renderModules();
        });

        const codeSpan = document.createElement("span");
        codeSpan.className = "lesson-code";
        codeSpan.textContent = lesson.code;

        const titleSpan = document.createElement("span");
        titleSpan.textContent = lesson.title;

        label.appendChild(cb);
        label.appendChild(codeSpan);
        label.appendChild(titleSpan);

        const linksDiv = document.createElement("div");
        linksDiv.className = "lesson-links";
        linksDiv.innerHTML =
          '<a class="btn btn-sm btn-colab" href="' + colabUrl + '" target="_blank" rel="noopener noreferrer">Open in Colab</a>' +
          '<a class="btn btn-sm" href="' + ghUrl + '" target="_blank" rel="noopener noreferrer">GitHub</a>';

        row.appendChild(label);
        row.appendChild(linksDiv);
        lessonsBlock.appendChild(row);
      });

      /* Module folder link + copyable AI prompt */
      const promptBox = document.createElement("div");
      promptBox.className = "ai-prompt-box";
      const promptLeft = document.createElement("div");
      promptLeft.innerHTML =
        '<span class="ai-prompt-label">Try Asking Your AI Assistant</span>' +
        '<p class="ai-prompt-text">"' + mod.aiPrompt + '"</p>';
      const promptActions = document.createElement("div");
      promptActions.className = "lesson-links";

      const copyBtn = document.createElement("button");
      copyBtn.type = "button";
      copyBtn.className = "btn btn-sm";
      copyBtn.textContent = "Copy Prompt";
      copyBtn.addEventListener("click", function () {
        copyText(mod.aiPrompt, copyBtn);
      });

      const folderLink = document.createElement("a");
      folderLink.className = "btn btn-sm";
      folderLink.href = DATA.githubBase + "/" + mod.slug;
      folderLink.target = "_blank";
      folderLink.rel = "noopener noreferrer";
      folderLink.textContent = "Module Files";

      promptActions.appendChild(copyBtn);
      promptActions.appendChild(folderLink);
      promptBox.appendChild(promptLeft);
      promptBox.appendChild(promptActions);
      body.appendChild(promptBox);

      card.appendChild(trigger);
      card.appendChild(body);
      list.appendChild(card);
    });
  }

  /* ---------------- 2. Code Mental-Model Explorer ---------------- */
  function renderCodeExplorer() {
    const tabsWrap = document.getElementById("codeTabs");
    const panel = document.getElementById("codePanel");
    if (!tabsWrap || !panel) return;

    tabsWrap.innerHTML = "";
    DATA.codeTabs.forEach(function (tab) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "code-tab" + (state.activeCodeTab === tab.id ? " active" : "");
      btn.textContent = tab.tabLabel;
      btn.addEventListener("click", function () {
        state.activeCodeTab = tab.id;
        renderCodeExplorer();
      });
      tabsWrap.appendChild(btn);
    });

    const active = DATA.codeTabs.find(function (t) {
      return t.id === state.activeCodeTab;
    }) || DATA.codeTabs[0];

    panel.innerHTML =
      '<div class="code-explain">' +
      '  <span class="code-explain-badge">' + active.moduleRef + '</span>' +
      '  <h3>' + active.heading + '</h3>' +
      '  <div class="compare-box"><strong>Traditional Spreadsheet or GIS Steps</strong>' + active.excelHabit + '</div>' +
      '  <div class="compare-box python-side"><strong>Python Workflow</strong>' + active.pythonPattern + '</div>' +
      '  <a class="btn btn-sm btn-colab" href="' + active.notebookUrl + '" target="_blank" rel="noopener noreferrer">Open This Notebook in Colab</a>' +
      '</div>' +
      '<div class="code-editor-wrap">' +
      '  <div class="code-editor-bar">' +
      '    <span>' + active.moduleRef + '</span>' +
      '    <button type="button" class="btn btn-sm" id="copyCodeBtn">Copy Code</button>' +
      '  </div>' +
      '  <pre class="code-pre"><code></code></pre>' +
      '</div>';

    panel.querySelector("code").textContent = active.code;
    const copyCodeBtn = document.getElementById("copyCodeBtn");
    if (copyCodeBtn) {
      copyCodeBtn.addEventListener("click", function () {
        copyText(active.code, copyCodeBtn);
      });
    }
  }

  /* ---------------- 3. Ecosystem Tools Grid ---------------- */
  function renderTools() {
    const filterWrap = document.getElementById("toolsFilters");
    const grid = document.getElementById("toolsGrid");
    if (!filterWrap || !grid) return;

    const categories = ["All", "Data Access", "Terrain & GIS", "Modeling & Calibration", "Climate & Plotting"];
    filterWrap.innerHTML = "";
    categories.forEach(function (cat) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "pill" + (state.toolCategory === cat ? " active" : "");
      btn.textContent = cat;
      btn.addEventListener("click", function () {
        state.toolCategory = cat;
        renderTools();
      });
      filterWrap.appendChild(btn);
    });

    grid.innerHTML = "";
    const visible = DATA.tools.filter(function (t) {
      return state.toolCategory === "All" || t.category === state.toolCategory;
    });

    visible.forEach(function (tool) {
      const a = document.createElement("a");
      a.className = "tool-card";
      a.href = tool.url;
      a.target = "_blank";
      a.rel = "noopener noreferrer";
      a.innerHTML =
        '<div class="tool-top"><strong>' + tool.name + '</strong><span class="tool-cat">' + tool.category + '</span></div>' +
        '<p>' + tool.desc + '</p>';
      grid.appendChild(a);
    });
  }

  /* ---------------- 4. Quotes Grid ---------------- */
  function renderQuotes() {
    const grid = document.getElementById("quotesGrid");
    if (!grid) return;
    grid.innerHTML = "";
    DATA.quotes.forEach(function (q) {
      const fig = document.createElement("figure");
      fig.className = "quote-card";
      fig.innerHTML =
        '<blockquote>"' + q.text + '"</blockquote>' +
        '<figcaption class="quote-focus">' + q.focus + '</figcaption>';
      grid.appendChild(fig);
    });
  }

  /* ---------------- 5. Hero Water Resources + Python Animation ---------------- */
  function initHydroCanvas() {
    const canvas = document.getElementById("hydroCanvas");
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    const cnSlider = document.getElementById("cnSlider");
    const cnValueEl = document.getElementById("cnValue");
    const triggerBtn = document.getElementById("triggerStormBtn");
    const pauseBtn = document.getElementById("pauseSimBtn");
    const readoutEl = document.getElementById("simReadout");

    const reduceMotion = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    const sim = {
      width: 520,
      height: 295,
      cn: Number(cnSlider ? cnSlider.value : 78),
      paused: reduceMotion,
      t: 0,
      stormIntensity: 0.72,
      rainDrops: [],
      runoffParticles: [],
      infilTicks: [],
      historyRain: [],
      historyQ: [],
      histMax: 96,
      lastQ: 110,
      peakQ: 420
    };

    /* Compute SCS Curve Number retention and runoff depth for a 2.50 in design storm */
    function scsMetrics(cn) {
      const P = 2.5;
      const S = 1000 / cn - 10;
      const Ia = 0.2 * S;
      const Pe = P > Ia ? Math.pow(P - Ia, 2) / (P + 0.8 * S) : 0;
      return { P: P, S: S, Pe: Pe };
    }

    function seedInitialHistory() {
      sim.historyRain = [];
      sim.historyQ = [];
      const m = scsMetrics(sim.cn);
      for (let i = 0; i < sim.histMax; i++) {
        const u = i / sim.histMax;
        const rain = u > 0.35 && u < 0.62 ? Math.sin(((u - 0.35) / 0.27) * Math.PI) * 0.85 : 0;
        const lag = u > 0.42 ? Math.exp(-Math.pow((u - 0.68) / 0.16, 2)) : 0;
        const q = 85 + lag * (280 + (sim.cn - 50) * 14) * (0.4 + m.Pe / 2.2);
        sim.historyRain.push(rain);
        sim.historyQ.push(q);
      }
      sim.lastQ = sim.historyQ[sim.historyQ.length - 1];
      sim.peakQ = Math.round(Math.max.apply(null, sim.historyQ));
    }

    function updateReadout() {
      if (!readoutEl) return;
      const m = scsMetrics(sim.cn);
      const qNow = Math.round(sim.lastQ);
      readoutEl.innerHTML =
        '<span class="tok-comment"># Design storm P = 2.5 in, CN = ' + sim.cn + '</span>\n' +
        'S = 1000 / ' + sim.cn + ' - 10       <span class="tok-comment"># Retention: ' + m.S.toFixed(2) + ' in</span>\n' +
        'Q = <span class="tok-fn">scs_runoff</span>(' + m.P.toFixed(1) + ', ' + sim.cn + ')  <span class="tok-comment"># ' + m.Pe.toFixed(2) + ' in -> ' + qNow + ' cfs</span>';
    }

    function resizeCanvas() {
      const rect = canvas.getBoundingClientRect();
      if (!rect.width) return;
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      sim.width = rect.width;
      sim.height = rect.height || 295;
      canvas.width = Math.round(sim.width * dpr);
      canvas.height = Math.round(sim.height * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }

    function slopeY(x, w, hScene) {
      const peakEnd = w * 0.25;
      const channelStart = w * 0.68;
      if (x <= peakEnd) {
        return hScene * 0.62;
      }
      if (x >= channelStart) {
        return hScene * 0.84;
      }
      const u = (x - peakEnd) / (channelStart - peakEnd);
      return hScene * (0.62 + 0.22 * u);
    }

    function triggerPulse() {
      sim.stormIntensity = 1.0;
    }

    function stepSimulation() {
      sim.t += 0.032;
      sim.stormIntensity = Math.max(0.05, sim.stormIntensity * 0.992);
      if (Math.random() < 0.008 && sim.stormIntensity < 0.16) {
        sim.stormIntensity = 0.92;
      }

      const w = sim.width;
      const hScene = sim.height * 0.56;
      const m = scsMetrics(sim.cn);
      const runoffRatio = Math.min(0.95, Math.max(0.12, (sim.cn - 42) / 55));

      /* Spawn precipitation drops */
      const spawnCount = sim.stormIntensity > 0.22 ? Math.ceil(sim.stormIntensity * 4) : (Math.random() < 0.25 ? 1 : 0);
      for (let i = 0; i < spawnCount; i++) {
        sim.rainDrops.push({
          x: w * (0.20 + Math.random() * 0.48),
          y: 12 + Math.random() * 14,
          vy: 3.4 + Math.random() * 1.4,
          vx: -0.45
        });
      }

      /* Move falling raindrops */
      for (let i = sim.rainDrops.length - 1; i >= 0; i--) {
        const d = sim.rainDrops[i];
        d.x += d.vx;
        d.y += d.vy;
        const groundY = slopeY(d.x, w, hScene);
        if (d.y >= groundY) {
          if (Math.random() < runoffRatio) {
            sim.runoffParticles.push({ x: d.x, y: groundY - 2, vx: 1.45 + (sim.cn - 55) * 0.025 });
          } else {
            sim.infilTicks.push({ x: d.x, y: groundY + 2, life: 1.0 });
          }
          sim.rainDrops.splice(i, 1);
        }
      }

      /* Move overland runoff toward channel */
      let arrivalFlow = 0;
      for (let i = sim.runoffParticles.length - 1; i >= 0; i--) {
        const p = sim.runoffParticles[i];
        p.x += p.vx;
        p.y = slopeY(p.x, w, hScene) - 2;
        if (p.x >= w * 0.68) {
          arrivalFlow += 1;
          sim.runoffParticles.splice(i, 1);
        }
      }

      for (let i = sim.infilTicks.length - 1; i >= 0; i--) {
        sim.infilTicks[i].life -= 0.04;
        sim.infilTicks[i].y += 0.35;
        if (sim.infilTicks[i].life <= 0) {
          sim.infilTicks.splice(i, 1);
        }
      }

      /* Update hydrograph trace every 3 animation frames */
      if (Math.round(sim.t * 30) % 2 === 0) {
        const rainBar = sim.stormIntensity > 0.18 ? sim.stormIntensity : 0;
        const targetQ = 85 + (sim.stormIntensity * 340 + arrivalFlow * 45) * (0.45 + m.Pe / 2.2) * (0.7 + (sim.cn - 50) / 80);
        sim.lastQ = sim.lastQ + 0.14 * (targetQ - sim.lastQ);
        sim.historyRain.push(Math.min(1, rainBar));
        sim.historyQ.push(Math.min(1150, Math.max(70, sim.lastQ)));
        if (sim.historyRain.length > sim.histMax) sim.historyRain.shift();
        if (sim.historyQ.length > sim.histMax) sim.historyQ.shift();
        sim.peakQ = Math.round(Math.max.apply(null, sim.historyQ));
        updateReadout();
      }
    }

    function drawTree(x, y, scale, isDark) {
      ctx.fillStyle = isDark ? "#735a44" : "#5a4634";
      ctx.fillRect(x - 1.5 * scale, y - 4 * scale, 3 * scale, 4 * scale);
      ctx.fillStyle = isDark ? "#4a9257" : "#3f7a49";
      ctx.beginPath();
      ctx.moveTo(x, y - 18 * scale);
      ctx.lineTo(x - 7 * scale, y - 4 * scale);
      ctx.lineTo(x + 7 * scale, y - 4 * scale);
      ctx.closePath();
      ctx.fill();
    }

    function drawHouse(x, y, isDark) {
      ctx.fillStyle = isDark ? "#2a3b4e" : "#e6ebf0";
      ctx.strokeStyle = isDark ? "#7f95ad" : "#4a5b6c";
      ctx.lineWidth = 1;
      ctx.fillRect(x - 7, y - 9, 14, 9);
      ctx.strokeRect(x - 7, y - 9, 14, 9);
      ctx.fillStyle = isDark ? "#93a9c0" : "#4a5b6c";
      ctx.beginPath();
      ctx.moveTo(x - 9, y - 9);
      ctx.lineTo(x, y - 16);
      ctx.lineTo(x + 9, y - 9);
      ctx.closePath();
      ctx.fill();
    }

    function drawScene() {
      const w = sim.width;
      const h = sim.height;
      const hScene = h * 0.56;
      const isDark = document.documentElement.dataset.theme === "dark";
      ctx.clearRect(0, 0, w, h);

      /* Subtle sky tint */
      const skyGrad = ctx.createLinearGradient(0, 0, 0, hScene);
      if (isDark) {
        skyGrad.addColorStop(0, sim.stormIntensity > 0.35 ? "#132131" : "#111c29");
        skyGrad.addColorStop(1, "rgba(17, 28, 41, 0.2)");
      } else {
        skyGrad.addColorStop(0, sim.stormIntensity > 0.35 ? "#edf3f9" : "#f7fafc");
        skyGrad.addColorStop(1, "rgba(250, 250, 247, 0.2)");
      }
      ctx.fillStyle = skyGrad;
      ctx.fillRect(0, 0, w, hScene);

      /* Storm cloud band */
      const cloudAlpha = 0.25 + sim.stormIntensity * 0.55;
      ctx.fillStyle = isDark
        ? "rgba(92, 118, 146, " + cloudAlpha.toFixed(2) + ")"
        : "rgba(130, 152, 174, " + cloudAlpha.toFixed(2) + ")";
      [0.30, 0.42, 0.54].forEach(function (cx, idx) {
        ctx.beginPath();
        ctx.arc(w * cx, 22 + (idx % 2) * 3, 18, 0, Math.PI * 2);
        ctx.arc(w * cx + 16, 20, 15, 0, Math.PI * 2);
        ctx.arc(w * cx - 14, 24, 13, 0, Math.PI * 2);
        ctx.fill();
      });

      /* Mountain ridge on left (matches course pixel emblem) */
      ctx.fillStyle = isDark ? "#3b4c5e" : "#7a8b9b";
      ctx.beginPath();
      ctx.moveTo(w * 0.02, hScene * 0.64);
      ctx.lineTo(w * 0.14, hScene * 0.16);
      ctx.lineTo(w * 0.28, hScene * 0.66);
      ctx.closePath();
      ctx.fill();

      /* Secondary foothill peak */
      ctx.fillStyle = isDark ? "#4d6175" : "#95a5b5";
      ctx.beginPath();
      ctx.moveTo(w * 0.16, hScene * 0.66);
      ctx.lineTo(w * 0.25, hScene * 0.31);
      ctx.lineTo(w * 0.35, hScene * 0.68);
      ctx.closePath();
      ctx.fill();

      /* Ridge peak highlight */
      ctx.fillStyle = isDark ? "#dce7f3" : "#ffffff";
      ctx.strokeStyle = isDark ? "#8ea4bc" : "#cbd6e2";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(w * 0.14, hScene * 0.16);
      ctx.lineTo(w * 0.085, hScene * 0.36);
      ctx.lineTo(w * 0.15, hScene * 0.32);
      ctx.lineTo(w * 0.205, hScene * 0.37);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();

      /* Hillslope polygon fading between vegetated green (low CN) and paved slate (high CN) */
      const urbanFrac = Math.max(0, Math.min(1, (sim.cn - 55) / 37));
      if (isDark) {
        ctx.fillStyle = urbanFrac > 0.65 ? "#4a5664" : urbanFrac > 0.35 ? "#43604b" : "#386847";
      } else {
        ctx.fillStyle = urbanFrac > 0.65 ? "#c5cdd4" : urbanFrac > 0.35 ? "#9ab58d" : "#78a66c";
      }
      ctx.beginPath();
      ctx.moveTo(0, hScene * 0.62);
      ctx.lineTo(w * 0.25, hScene * 0.62);
      ctx.lineTo(w * 0.68, hScene * 0.84);
      ctx.lineTo(w, hScene * 0.84);
      ctx.lineTo(w, hScene);
      ctx.lineTo(0, hScene);
      ctx.closePath();
      ctx.fill();

      /* Impervious paved terrace strip proportional to CN */
      if (urbanFrac > 0.15) {
        ctx.fillStyle = isDark
          ? "rgba(155, 174, 195, " + (urbanFrac * 0.48).toFixed(2) + ")"
          : "rgba(106, 123, 140, " + (urbanFrac * 0.55).toFixed(2) + ")";
        ctx.beginPath();
        ctx.moveTo(w * 0.36, slopeY(w * 0.36, w, hScene));
        ctx.lineTo(w * (0.36 + 0.28 * urbanFrac), slopeY(w * (0.36 + 0.28 * urbanFrac), w, hScene));
        ctx.lineTo(w * (0.36 + 0.28 * urbanFrac), slopeY(w * (0.36 + 0.28 * urbanFrac), w, hScene) + 6);
        ctx.lineTo(w * 0.36, slopeY(w * 0.36, w, hScene) + 6);
        ctx.closePath();
        ctx.fill();
      }

      /* Vegetative trees (reduce at high CN) & urban houses (appear above CN 70) */
      const numTrees = Math.max(1, Math.round(5 - urbanFrac * 4));
      [0.29, 0.35, 0.42, 0.49, 0.56].slice(0, numTrees).forEach(function (fx, idx) {
        const tx = w * fx;
        drawTree(tx, slopeY(tx, w, hScene), 0.9 + (idx % 2) * 0.15, isDark);
      });
      if (urbanFrac > 0.38) {
        drawHouse(w * 0.52, slopeY(w * 0.52, w, hScene), isDark);
      }
      if (urbanFrac > 0.68) {
        drawHouse(w * 0.60, slopeY(w * 0.60, w, hScene), isDark);
      }

      /* River channel bed and flowing water body on the right side */
      const chLeft = w * 0.67;
      const chBaseY = hScene * 0.84;
      const stageBoost = Math.min(11, (sim.lastQ - 70) / 85);
      const waterTop = chBaseY - 3 - stageBoost;

      ctx.fillStyle = isDark ? "#1c5791" : "#2b6cb0";
      ctx.beginPath();
      ctx.moveTo(chLeft, waterTop);
      ctx.lineTo(w, waterTop);
      ctx.lineTo(w, hScene);
      ctx.lineTo(chLeft, hScene);
      ctx.closePath();
      ctx.fill();

      /* Python dual-tone streamline waves (Python blue crest + Python gold streamline) gliding downstream */
      const speedMult = 1.6 + stageBoost * 0.25;
      ctx.lineWidth = 2.4;
      ctx.strokeStyle = "#8cc8f8";
      ctx.beginPath();
      for (let x = chLeft + 6; x <= w - 4; x += 6) {
        const y = waterTop + 5 + Math.sin(x * 0.09 - sim.t * speedMult) * 2.2;
        if (x === chLeft + 6) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.stroke();

      ctx.strokeStyle = "#f2c144";
      ctx.lineWidth = 2.2;
      ctx.beginPath();
      for (let x = chLeft + 6; x <= w - 4; x += 6) {
        const y = waterTop + 9 + Math.cos(x * 0.09 - sim.t * speedMult * 1.1) * 2.2;
        if (x === chLeft + 6) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.stroke();

      /* USGS Gauge post near right channel edge */
      const gx = w * 0.90;
      ctx.strokeStyle = isDark ? "#dce7f3" : "#142233";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(gx, hScene * 0.48);
      ctx.lineTo(gx, hScene * 0.96);
      ctx.stroke();
      ctx.fillStyle = isDark ? "#dce7f3" : "#142233";
      ctx.font = '600 10px "IBM Plex Mono", monospace';
      ctx.fillText("USGS Q", gx - 18, hScene * 0.44);
      ctx.fillStyle = isDark ? "#f2c144" : "#d99b16";
      ctx.beginPath();
      ctx.arc(gx, waterTop, 4, 0, Math.PI * 2);
      ctx.fill();

      /* Raindrops, soil infiltration ticks, and overland flow droplets */
      ctx.strokeStyle = isDark ? "#6db5f5" : "#2b6cb0";
      ctx.lineWidth = 1.4;
      sim.rainDrops.forEach(function (d) {
        ctx.beginPath();
        ctx.moveTo(d.x, d.y);
        ctx.lineTo(d.x + d.vx * 1.6, d.y + 6);
        ctx.stroke();
      });

      sim.infilTicks.forEach(function (t) {
        ctx.strokeStyle = isDark
          ? "rgba(82, 183, 120, " + t.life.toFixed(2) + ")"
          : "rgba(47, 122, 77, " + t.life.toFixed(2) + ")";
        ctx.beginPath();
        ctx.moveTo(t.x, t.y);
        ctx.lineTo(t.x, t.y + 5);
        ctx.stroke();
      });

      ctx.fillStyle = isDark ? "#6db5f5" : "#2b6cb0";
      sim.runoffParticles.forEach(function (p) {
        ctx.beginPath();
        ctx.arc(p.x, p.y, 2.3, 0, Math.PI * 2);
        ctx.fill();
      });

      /* ---------------- Lower Panel: Hyetograph + Hydrograph ---------------- */
      const chartTop = hScene + 8;
      const chartBot = h - 18;
      const chartH = chartBot - chartTop;
      const padL = 54;
      const padR = 14;
      const plotW = w - padL - padR;

      ctx.fillStyle = isDark ? "#111b27" : "#ffffff";
      ctx.fillRect(0, hScene, w, h - hScene);
      ctx.strokeStyle = isDark ? "#253548" : "#dfe4ea";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(0, hScene);
      ctx.lineTo(w, hScene);
      ctx.stroke();

      /* Light horizontal discharge reference gridlines */
      ctx.strokeStyle = isDark ? "#1e2d3f" : "#eef2f6";
      [0.25, 0.5, 0.75].forEach(function (frac) {
        const y = chartBot - chartH * frac;
        ctx.beginPath();
        ctx.moveTo(padL, y);
        ctx.lineTo(w - padR, y);
        ctx.stroke();
      });

      /* Inverted rainfall hyetograph bars at top of chart */
      const n = sim.historyQ.length;
      const barW = plotW / sim.histMax;
      ctx.fillStyle = isDark ? "rgba(93, 168, 236, 0.45)" : "rgba(79, 163, 219, 0.55)";
      for (let i = 0; i < n; i++) {
        const rb = sim.historyRain[i];
        if (rb > 0.01) {
          const bh = rb * (chartH * 0.30);
          ctx.fillRect(padL + i * barW, chartTop, Math.max(1.5, barW - 1), bh);
        }
      }

      /* Discharge Q(t) hydrograph area + curve */
      const maxQScale = 1200;
      ctx.beginPath();
      for (let i = 0; i < n; i++) {
        const x = padL + (i / (sim.histMax - 1)) * plotW;
        const y = chartBot - (sim.historyQ[i] / maxQScale) * (chartH * 0.92);
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.strokeStyle = isDark ? "#5da8ec" : "#1b4f72";
      ctx.lineWidth = 2.2;
      ctx.stroke();

      ctx.lineTo(padL + plotW, chartBot);
      ctx.lineTo(padL, chartBot);
      ctx.closePath();
      ctx.fillStyle = isDark ? "rgba(93, 168, 236, 0.16)" : "rgba(43, 108, 176, 0.12)";
      ctx.fill();

      /* Current live gauge dot */
      const curY = chartBot - (sim.lastQ / maxQScale) * (chartH * 0.92);
      ctx.fillStyle = isDark ? "#f2c144" : "#d99b16";
      ctx.beginPath();
      ctx.arc(padL + plotW, curY, 4.2, 0, Math.PI * 2);
      ctx.fill();

      /* Clean axis labels */
      ctx.fillStyle = isDark ? "#7f95ad" : "#6a7b8c";
      ctx.font = '500 10px "IBM Plex Mono", monospace';
      ctx.fillText("Q (cfs)", 6, chartTop + 12);
      ctx.fillText("1000", 6, chartTop + 26);
      ctx.fillText("0", 24, chartBot);
      ctx.fillStyle = isDark ? "#dce7f3" : "#142233";
      ctx.fillText("Time (scrolling right to gauge)", padL + 4, h - 5);
      ctx.fillText("Now: " + Math.round(sim.lastQ) + " cfs", w - 92, h - 5);
    }

    function loop() {
      if (!sim.paused) {
        stepSimulation();
      }
      drawScene();
      requestAnimationFrame(loop);
    }

    if (cnSlider) {
      cnSlider.addEventListener("input", function () {
        sim.cn = Number(cnSlider.value);
        if (cnValueEl) cnValueEl.textContent = String(sim.cn);
        updateReadout();
        if (sim.paused) drawScene();
      });
    }

    if (triggerBtn) {
      triggerBtn.addEventListener("click", function () {
        triggerPulse();
        updateReadout();
      });
    }

    if (pauseBtn) {
      pauseBtn.textContent = sim.paused ? "Play" : "Pause";
      pauseBtn.addEventListener("click", function () {
        sim.paused = !sim.paused;
        pauseBtn.textContent = sim.paused ? "Play" : "Pause";
      });
    }

    canvas.addEventListener("click", function () {
      triggerPulse();
    });

    resizeCanvas();
    seedInitialHistory();
    updateReadout();
    window.addEventListener("resize", function () {
      resizeCanvas();
      drawScene();
    });
    window.addEventListener("hh-theme-change", function () {
      drawScene();
    });
    requestAnimationFrame(loop);
  }

  /* ---------------- 6. Theme Toggle (Light / Dark) ---------------- */
  function initThemeToggle() {
    const btn = document.getElementById("themeToggleBtn");
    const THEME_KEY = "hh_python_theme";
    const SUN_SVG =
      '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true">' +
      '<circle cx="8" cy="8" r="3"></circle>' +
      '<path d="M8 1.5v1.6M8 12.9v1.6M1.5 8h1.6M12.9 8h1.6M3.4 3.4l1.1 1.1M11.5 11.5l1.1 1.1M12.6 3.4l-1.1 1.1M4.5 11.5l-1.1 1.1"></path>' +
      "</svg>";
    const MOON_SVG =
      '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true">' +
      '<path d="M13.2 9.8A5.5 5.5 0 0 1 6.2 2.8a5.5 5.5 0 1 0 7 7z"></path>' +
      "</svg>";

    function renderBtn(theme) {
      if (!btn) return;
      const isDark = theme === "dark";
      btn.setAttribute("aria-pressed", String(isDark));
      btn.innerHTML = (isDark ? SUN_SVG : MOON_SVG) + "<span>" + (isDark ? "Light" : "Dark") + "</span>";
    }

    const current = document.documentElement.dataset.theme === "dark" ? "dark" : "light";
    renderBtn(current);

    if (btn) {
      btn.addEventListener("click", function () {
        const next = document.documentElement.dataset.theme === "dark" ? "light" : "dark";
        document.documentElement.dataset.theme = next;
        try {
          localStorage.setItem(THEME_KEY, next);
        } catch (e) {
          /* ignore storage errors */
        }
        renderBtn(next);
        window.dispatchEvent(new CustomEvent("hh-theme-change"));
      });
    }
  }

  /* ---------------- 7. Initialize Filters & Controls ---------------- */
  function initCurriculumControls() {
    const levelPills = document.querySelectorAll("[data-level]");
    levelPills.forEach(function (pill) {
      pill.addEventListener("click", function () {
        state.level = pill.dataset.level;
        levelPills.forEach(function (p) {
          p.classList.toggle("active", p === pill);
        });
        renderModules();
      });
    });

    const searchInput = document.getElementById("moduleSearch");
    if (searchInput) {
      searchInput.addEventListener("input", function () {
        state.query = searchInput.value;
        if (state.query.trim()) {
          DATA.modules.forEach(function (m) {
            if (moduleMatches(m)) state.openModules.add(m.num);
          });
        }
        renderModules();
      });
    }

    const resetBtn = document.getElementById("resetProgressBtn");
    if (resetBtn) {
      resetBtn.addEventListener("click", function () {
        state.doneLessons.clear();
        saveDoneSet(state.doneLessons);
        updateProgressUI();
        renderModules();
      });
    }
  }

  document.addEventListener("DOMContentLoaded", function () {
    initThemeToggle();
    initCurriculumControls();
    renderPaths();
    updateProgressUI();
    renderModules();
    renderCodeExplorer();
    renderTools();
    renderQuotes();
    initHydroCanvas();
  });
})();
