import { app } from "../../scripts/app.js";
import { svgIcon } from "./icons.js";
import { COMBINATORIAL_CONFIG, generatePromptTemplate } from "./prompt_templates.js";

// Chargement automatique avec cache-buster
const CSS_ID = "sm-style-link";
let link = document.getElementById(CSS_ID);
if (!link) {
  link = document.createElement("link");
  link.id = CSS_ID;
  link.rel = "stylesheet";
  link.type = "text/css";
  document.head.appendChild(link);
}
link.href = new URL("./subject_manager.css?t=" + Date.now(), import.meta.url).href;

const SECTION_COLORS = {
  red: "#a85d5d",
  green: "#5f9e73",
  blue: "#5f85b0",
  amber: "#b8975a",
  teal: "#5aa3a0",
  pink: "#a56a94",
  slate: "#7c88a0",
};

// ---------------------------------------------------------------------------
// Helpers & Utilities
// ---------------------------------------------------------------------------
function uid() {
  return "s_" + Math.random().toString(36).slice(2, 9) + Date.now().toString(36);
}

function slugify(label) {
  return (label || "").toLowerCase().trim().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "") || "section";
}

function uniqueKey(base, existingKeys) {
  let key = base, i = 2;
  while (existingKeys.has(key)) { key = `${base}_${i}`; i += 1; }
  return key;
}

function uniqueLabel(base, existingLabels) {
  if (!existingLabels.has(base)) return base;
  let i = 1, cand = `${base} (${i})`;
  while (existingLabels.has(cand)) { i += 1; cand = `${base} (${i})`; }
  return cand;
}

function formatTime(sec) {
  sec = Math.max(0, Number(sec) || 0);
  const m = Math.floor(sec / 60);
  const s = (sec % 60).toFixed(1);
  return `${m}:${s < 10 ? "0" : ""}${s}`;
}

function highlightPromptText(raw) {
  if (!raw) return "";
  let escaped = raw
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");

  // Balises <Subject ...> ou <Character ...> (avec nom éventuel)
  escaped = escaped.replace(
    /&lt;\s*(subject|character)[^&>]*&gt;(?:\s*\([^)]*\))?/gi,
    '<span class="hl-tag-subj">$&</span>'
  );

  // Balises <Picture ...>, <Image ...>, <Img ...>
  escaped = escaped.replace(
    /&lt;\s*(picture|image|img)[^&>]*&gt;/gi,
    '<span class="hl-tag-img">$&</span>'
  );

  // Balises <Audio ...>
  escaped = escaped.replace(
    /&lt;\s*audio[^&>]*&gt;/gi,
    '<span class="hl-tag-aud">$&</span>'
  );

  // Balises <Video ...>
  escaped = escaped.replace(
    /&lt;\s*video[^&>]*&gt;/gi,
    '<span class="hl-tag-vid">$&</span>'
  );

  if (escaped.endsWith("\n")) escaped += " ";
  return escaped;
}

function getNextSubjectName(allCategories) {
  const existingNames = new Set();
  Object.values(allCategories || {}).forEach((items) => {
    (items || []).forEach((it) => {
      if (it.name) existingNames.add(it.name.trim().toLowerCase());
    });
  });
  let i = 1;
  while (existingNames.has(`subject ${i}`)) { i++; }
  return `Subject ${i}`;
}

function getThumbnailUrl(pathOrName, bustCache = false) {
  if (!pathOrName) return "";
  if (pathOrName.startsWith("data:")) return pathOrName;
  const encoded = encodeURIComponent(pathOrName);
  const base = `/subject_manager/thumbnail?path=${encoded}`;
  return bustCache ? `${base}&t=${Date.now()}` : base;
}

function getMediaUrl(pathOrName, bustCache = false) {
  if (!pathOrName) return "";
  if (pathOrName.startsWith("data:")) return pathOrName;
  const encoded = encodeURIComponent(pathOrName);
  const base = `/subject_manager/view_file?path=${encoded}`;
  return bustCache ? `${base}&t=${Date.now()}` : base;
}

async function pickLocalMediaFile(mediaType) {
  try {
    const res = await fetchJSON("/subject_manager/pick_file", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type: mediaType }),
    });
    if (res && res.ok && res.path) {
      return res.path;
    }
  } catch (e) {
    console.warn("SubjectManager: pick_file failed", e);
  }
  return null;
}

async function uploadMediaFile(file) {
  const formData = new FormData();
  formData.append("file", file);
  const res = await fetch("/subject_manager/upload", { method: "POST", body: formData });
  if (!res.ok) {
    let err = null;
    try { err = await res.json(); } catch (e) {}
    throw new Error((err && err.error) || `Upload failed (${res.status})`);
  }
  return await res.json();
}

function sanitizeData(raw) {
  const data = raw && typeof raw === "object" ? raw : {};
  if (!Array.isArray(data.sections)) data.sections = [];
  if (!data.categories || typeof data.categories !== "object") data.categories = {};
  data.viewMode = data.viewMode === "list" ? "list" : "grid";

  const savedPreview = localStorage.getItem("sm_preview_mode");
  data.previewMode = data.previewMode ? (data.previewMode === "names" ? "names" : "text") : (savedPreview === "names" ? "names" : "text");

  if (!data.sections.length) {
    data.sections.push({ key: "subjects", label: "Subjects", enabled: true, randomizeOnQueue: false, color: null });
    data.categories["subjects"] = [];
  }

  data.sections = data.sections.map((s) => ({
    key: (s && s.key) || uid(),
    label: (s && s.label) || "Section",
    enabled: s && s.enabled === false ? false : true,
    randomizeOnQueue: !!(s && s.randomizeOnQueue),
    color: s && typeof s.color === "string" && SECTION_COLORS[s.color] ? s.color : null,
  }));

  data.sections.forEach((s) => {
    if (!Array.isArray(data.categories[s.key])) data.categories[s.key] = [];
    data.categories[s.key] = data.categories[s.key].map((it) => {
      const type = (it && it.subjectType) || "character";
      const config = COMBINATORIAL_CONFIG[type] || COMBINATORIAL_CONFIG.character;

      const imgs = Array.isArray(it && it.images) ? it.images.filter(Boolean).slice(0, 4) : [];
      const imgStates = Array.isArray(it && it.imageStates) ? it.imageStates.slice(0, imgs.length) : [];
      while (imgStates.length < imgs.length) imgStates.push(true);

      const imgTags = Array.isArray(it && it.imageTags) ? it.imageTags.slice(0, imgs.length) : [];
      while (imgTags.length < imgs.length) {
        imgTags.push([...(config.imageDefaultPreset[imgTags.length] || config.imageDefaultPreset[0])]);
      }

      return {
        id: (it && it.id) || uid(),
        name: (it && it.name) || "",
        subjectType: type,
        prompt: (it && it.prompt) || "",
        enablePrompt: it && it.enablePrompt === false ? false : true,
        images: imgs,
        imageStates: imgStates,
        imageTags: imgTags,
        enableImages: it && it.enableImages === false ? false : true,
        audio: it && it.audio && it.audio.file ? { file: it.audio.file, trimStart: it.audio.trimStart || 0, trimEnd: it.audio.trimEnd || 0 } : null,
        audioTags: Array.isArray(it && it.audioTags) ? it.audioTags : [...config.audioDefault],
        enableAudio: it && it.enableAudio === false ? false : true,
        video: it && it.video && it.video.file ? { file: it.video.file, trimStart: it.video.trimStart || 0, trimEnd: it.video.trimEnd || 0 } : null,
        videoTags: Array.isArray(it && it.videoTags) ? it.videoTags : [...config.videoDefault],
        enableVideo: it && it.enableVideo === false ? false : true,
        selected: !!(it && it.selected),
        allowRandom: it && it.allowRandom === false ? false : true,
        alwaysOn: !!(it && it.alwaysOn),
      };
    });
  });

  return data;
}

async function checkMediaPresence(filenames) {
  const uniqueFiles = [...new Set((filenames || []).filter(Boolean))];
  if (!uniqueFiles.length) return { results: {} };
  try {
    return await fetchJSON("/subject_manager/check_media", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ files: uniqueFiles }),
    });
  } catch (e) {
    return { results: {} };
  }
}

// ---------------------------------------------------------------------------
// Dessin de la Forme d'Onde Audio (Waveform Canvas)
// ---------------------------------------------------------------------------
const waveformCache = new Map();

async function renderAudioWaveform(canvas, audioUrl) {
  if (!canvas || !audioUrl) return;
  const ctx = canvas.getContext("2d");
  const width = (canvas.width = canvas.clientWidth || 280);
  const height = (canvas.height = canvas.clientHeight || 25);

  if (waveformCache.has(audioUrl)) {
    drawPeaks(ctx, waveformCache.get(audioUrl), width, height);
    return;
  }

  try {
    const res = await fetch(audioUrl);
    const buffer = await res.arrayBuffer();
    const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    const decoded = await audioCtx.decodeAudioData(buffer);
    const rawData = decoded.getChannelData(0);
    const samples = Math.floor(width / 2.5);
    const blockSize = Math.floor(rawData.length / samples);
    const peaks = [];

    for (let i = 0; i < samples; i++) {
      let sum = 0;
      for (let j = 0; j < blockSize; j++) {
        sum += Math.abs(rawData[i * blockSize + j]);
      }
      peaks.push(sum / blockSize);
    }

    const maxPeak = Math.max(...peaks, 0.01);
    const normalized = peaks.map((p) => p / maxPeak);
    waveformCache.set(audioUrl, normalized);
    drawPeaks(ctx, normalized, width, height);
    audioCtx.close();
  } catch (e) {}
}

function drawPeaks(ctx, peaks, width, height) {
  ctx.clearRect(0, 0, width, height);
  const barWidth = 2;
  const gap = 1;
  const centerY = height / 2;
  ctx.fillStyle = "#8a8a8a";

  peaks.forEach((peak, i) => {
    const x = i * (barWidth + gap);
    const barHeight = Math.max(2, peak * (height - 4));
    ctx.fillRect(x, centerY - barHeight / 2, barWidth, barHeight);
  });
}

// ---------------------------------------------------------------------------
// Calcul dynamique du mapping des sorties réelles (<S1>, <S2> + pins)
// ---------------------------------------------------------------------------
function computeActiveSubjectMapping(smData) {
  const mapping = new Map();
  let totalImg = 0;
  let totalAud = 0;
  let totalVid = 0;
  let subjectIdx = 1;

  smData.sections.forEach((s) => {
    if (!s.enabled) return;
    const items = smData.categories[s.key] || [];
    const secColor = s.color && SECTION_COLORS[s.color] ? SECTION_COLORS[s.color] : "var(--sm-green-border)";

    items.forEach((it) => {
      if (it.selected || it.alwaysOn) {
        const globalImgOn = it.enableImages !== false;
        const imgStates = it.imageStates || [];
        const activeImgs = (it.images || []).filter((src, idx) => src && globalImgOn && (imgStates[idx] === undefined || imgStates[idx] !== false));
        const validImgCount = activeImgs.length;
        const hasAud = (it.enableAudio !== false) && !!(it.audio && it.audio.file) && totalAud < 2;
        const hasVid = (it.enableVideo !== false) && !!(it.video && it.video.file) && totalVid < 2;

        let imgPins = [];
        if (validImgCount > 0 && totalImg < 8) {
          const start = totalImg + 1;
          const end = Math.min(8, totalImg + validImgCount);
          imgPins = start === end ? [`image_${start}`] : [`image_${start}..${end}`];
        }

        const audPins = hasAud ? [`audio_${totalAud + 1}`] : [];
        const vidPins = hasVid ? [`video_${totalVid + 1}`] : [];

        const allPins = [...imgPins, ...audPins, ...vidPins];
        const pinsSummary = allPins.length > 0 ? allPins.join(" | ") : "No outputs";

        mapping.set(it.id, {
          subjectIdx,
          subjectTag: `<S${subjectIdx}>`,
          fullTag: `<Subject ${subjectIdx}>`,
          pinsSummary,
          imgPins,
          audPins,
          vidPins,
          secColor,
          secLabel: s.label,
        });

        totalImg += validImgCount;
        if (hasAud) totalAud += 1;
        if (hasVid) totalVid += 1;
        subjectIdx += 1;
      }
    });
  });

  return mapping;
}

function createMediaMosaic(item) {
  const images = item.images || [];
  const validImgs = images.filter(Boolean);
  const states = item.imageStates || [];
  const globalImgOn = item.enableImages !== false;
  const count = validImgs.length;

  const wrap = document.createElement("div");
  wrap.className = "sm-tile-media";

  if (count === 0) {
    const empty = document.createElement("div");
    empty.className = "sm-tile-thumb-empty";
    empty.innerHTML = svgIcon("image", 26);
    wrap.appendChild(empty);
    return wrap;
  }

  function makeImgEl(src, slotIdx) {
    const isOff = !globalImgOn || (states[slotIdx] !== undefined && states[slotIdx] === false);
    const img = document.createElement("img");
    img.className = "sm-mosaic-img" + (isOff ? " sm-mosaic-off" : "");
    img.src = getThumbnailUrl(src);
    img.loading = "lazy";
    img.title = `Slot ${slotIdx + 1}: ${src}`;

    img.onerror = () => {
      const parent = img.parentElement;
      if (parent) {
        const missingBox = document.createElement("div");
        missingBox.className = "sm-mosaic-missing-box";
        missingBox.innerHTML = `<span style="color:#ff4444; font-size:16px; font-weight:bold;">✕</span>`;
        missingBox.title = `[MISSING FILE ON DISK]\n${src}`;
        parent.replaceChild(missingBox, img);
      }
    };

    return img;
  }

  if (count === 1) {
    const box = document.createElement("div");
    box.className = "sm-mosaic-single";
    box.appendChild(makeImgEl(validImgs[0], 0));
    wrap.appendChild(box);
  } else if (count === 2) {
    const box = document.createElement("div");
    box.className = "sm-mosaic-grid-2";
    validImgs.forEach((src, idx) => { box.appendChild(makeImgEl(src, idx)); });
    wrap.appendChild(box);
  } else if (count === 3) {
    const box = document.createElement("div");
    box.className = "sm-mosaic-grid-3";
    validImgs.forEach((src, idx) => {
      const img = makeImgEl(src, idx);
      img.classList.add(`sm-mosaic-item-${idx}`);
      box.appendChild(img);
    });
    wrap.appendChild(box);
  } else {
    const box = document.createElement("div");
    box.className = "sm-mosaic-grid-4";
    validImgs.slice(0, 4).forEach((src, idx) => { box.appendChild(makeImgEl(src, idx)); });
    wrap.appendChild(box);
  }

  return wrap;
}

function computePreview(data) {
  const lines = [];
  let totalImg = 0, totalAud = 0, totalVid = 0, subjectIdx = 1;

  data.sections.forEach((s) => {
    if (!s.enabled) return;
    const items = data.categories[s.key] || [];
    items.filter((it) => it.alwaysOn || it.selected).forEach((it) => {
      const globalImgOn = it.enableImages !== false;
      const imgStates = it.imageStates || [];
      const activeImgs = (it.images || []).filter((src, idx) => src && globalImgOn && (imgStates[idx] === undefined || imgStates[idx] !== false));
      const validImgCount = activeImgs.length;
      const hasAud = (it.enableAudio !== false) && !!(it.audio && it.audio.file);
      const hasVid = (it.enableVideo !== false) && !!(it.video && it.video.file);
      const hasTxt = (it.enablePrompt !== false);

      let p = (it.prompt || "").trim();
      if (p && hasTxt) {
        const itemLines = p.split("\n");
        const adaptedLines = [];

        itemLines.forEach((line) => {
          let str = line.trim();
          if (!str) return;

          let dropLine = false;
          const imgMatches = [...str.matchAll(/<\s*(picture|image|img)\s*(\d+)\s*>/gi)];
          if (imgMatches.length > 0) {
            for (const m of imgMatches) {
              const num = parseInt(m[2], 10);
              if (validImgCount === 0 || num > validImgCount) {
                dropLine = true;
                break;
              }
            }
          }
          if (!dropLine && /<\s*audio\s*\d+\s*>/i.test(str) && !hasAud) dropLine = true;
          if (!dropLine && /<\s*video\s*\d+\s*>/i.test(str) && !hasVid) dropLine = true;

          if (dropLine) return;

          str = str.replace(/<(picture|image|img|audio|video|subject|character)\s*(\d+)>/gi, (match, name, num) => {
            const low = name.toLowerCase();
            const n = parseInt(num, 10);
            if (low === "picture" || low === "image" || low === "img") {
              return `<${name} ${totalImg + n}>`;
            } else if (low === "audio") {
              return `<${name} ${totalAud + n}>`;
            } else if (low === "video") {
              return `<${name} ${totalVid + n}>`;
            } else if (low === "subject" || low === "character") {
              return `<${name} ${subjectIdx}>`;
            }
            return match;
          });

          str = str.replace(/\s{2,}/g, " ").trim();
          if (str) adaptedLines.push(str);
        });

        if (adaptedLines.length) {
          lines.push(adaptedLines.join("\n"));
        }
      }

      totalImg += validImgCount;
      if (hasAud) totalAud += 1;
      if (hasVid) totalVid += 1;
      subjectIdx += 1;
    });
  });

  return lines.join("\n\n");
}

function download(filename, text) {
  const blob = new Blob([text], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function mulberry32(seed) {
  return function () {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hashStr(s) {
  let h = 0;
  for (let i = 0; i < s.length; i++) { h = (h << 5) - h + s.charCodeAt(i); h |= 0; }
  return h;
}

async function fetchJSON(url, opts) {
  const res = await fetch(url, opts);
  let body = null;
  try { body = await res.json(); } catch (e) { body = null; }
  if (!res.ok) throw new Error((body && body.error) || `${res.status} ${res.statusText}`);
  return body;
}

const renderRegistry = new WeakMap();
const applyHeightRegistry = new WeakMap();

function applyQueueRandomization(appRef) {
  const graph = appRef.graph;
  if (!graph || !graph._nodes) return;
  graph._nodes.forEach((n) => {
    if (!n.smData || !n.widgets) return;
    const seedWidget = n.widgets.find((w) => w.name === "seed");
    const dataWidget = n.widgets.find((w) => w.name === "subject_data");
    if (!dataWidget) return;
    const seedVal = seedWidget ? Number(seedWidget.value) || 0 : 0;
    let changed = false;
    n.smData.sections.forEach((s) => {
      if (!s.randomizeOnQueue) return;
      const allItems = n.smData.categories[s.key] || [];
      const eligible = allItems.filter((it) => it.allowRandom !== false);
      if (!eligible.length) return;
      const rng = mulberry32(seedVal + hashStr(s.key));
      const idx = Math.floor(rng() * eligible.length);
      const chosenId = eligible[idx].id;
      allItems.forEach((it) => (it.selected = it.id === chosenId));
      changed = true;
    });
    if (changed) {
      dataWidget.value = JSON.stringify(n.smData);
      const fn = renderRegistry.get(n);
      if (fn) fn();
    }
  });
}

// ---------------------------------------------------------------------------
// Extension Registration
// ---------------------------------------------------------------------------
app.registerExtension({
  name: "SubjectManager.UI",

  async setup(appRef) {
    if (appRef.__smQueuePatched) return;
    appRef.__smQueuePatched = true;
    if (typeof appRef.queuePrompt === "function") {
      const orig = appRef.queuePrompt.bind(appRef);
      appRef.queuePrompt = async function (...args) {
        try {
          applyQueueRandomization(appRef);
        } catch (e) {
          console.warn("SubjectManager: randomize-on-queue failed", e);
        }
        return orig(...args);
      };
    }
  },

  async beforeRegisterNodeDef(nodeType, nodeData) {
    if (nodeData.name !== "SubjectManagerNode") return;

    const onResize = nodeType.prototype.onResize;
    nodeType.prototype.onResize = function (size) {
      const r = onResize ? onResize.apply(this, arguments) : undefined;
      if (Array.isArray(size)) {
        if (typeof size[0] === "number") this.size[0] = Math.max(340, size[0]);
        if (typeof size[1] === "number") {
          this.smDesiredHeight = Math.max(260, size[1]);
          this.size[1] = this.smDesiredHeight;
        }
      }
      const applyFn = applyHeightRegistry.get(this);
      if (applyFn) applyFn();
      this.setDirtyCanvas(true, true);
      return r;
    };

    const onDrawForeground = nodeType.prototype.onDrawForeground;
    nodeType.prototype.onDrawForeground = function (ctx) {
      const r = onDrawForeground ? onDrawForeground.apply(this, arguments) : undefined;
      const applyFn = applyHeightRegistry.get(this);
      if (applyFn) applyFn();
      return r;
    };

    const onNodeCreated = nodeType.prototype.onNodeCreated;
    nodeType.prototype.onNodeCreated = function () {
      const r = onNodeCreated ? onNodeCreated.apply(this, arguments) : undefined;
      const node = this;
      node.smDesiredHeight = (node.size && node.size[1]) || node.smDesiredHeight || 640;

      node.computeSize = function (out) {
        const minW = 340, minH = 260;
        if (out) { out[0] = minW; out[1] = minH; return out; }
        return [minW, minH];
      };

      const dataWidget = node.widgets && node.widgets.find((w) => w.name === "subject_data");
      if (dataWidget) {
        dataWidget.computeSize = () => [0, -4];
        if (dataWidget.inputEl) dataWidget.inputEl.style.display = "none";
        dataWidget.draw = function () {};
      }

      let initial = {};
      try {
        initial = dataWidget && dataWidget.value ? JSON.parse(dataWidget.value) : {};
      } catch (e) {
        initial = {};
      }
      node.smData = sanitizeData(initial);

      const state = {
        activeTab: node.smData.sections.length ? node.smData.sections[0].key : null,
        clipboard: [],
        editBarOpen: false,
        colorPickerOpen: false,
        openTileMenuId: null,
      };

      let activeFormMedia = [];
      function stopAllFormMedia() {
        activeFormMedia.forEach((m) => {
          try { m.pause(); m.currentTime = 0; } catch (e) {}
        });
        activeFormMedia = [];
      }

      function persist() {
        if (dataWidget) dataWidget.value = JSON.stringify(node.smData);
        node.setDirtyCanvas(true, true);
      }

      function activeItems() {
        if (!state.activeTab) return [];
        return node.smData.categories[state.activeTab] || [];
      }

      function activeSection() {
        return node.smData.sections.find((s) => s.key === state.activeTab) || null;
      }

      function duplicateItem(item) {
        const items = activeItems();
        const idx = items.findIndex((it) => it.id === item.id);
        if (idx === -1) return;

        const clone = JSON.parse(JSON.stringify(item));
        clone.id = uid();
        clone.name = clone.name ? `${clone.name} (Copy)` : "Subject Copy";
        clone.selected = false;
        clone.alwaysOn = false;

        items.splice(idx + 1, 0, clone);
        state.openTileMenuId = null;
        persist();
        renderList();
        updatePreview();
      }

      // Root DOM Layout
      const root = document.createElement("div");
      root.className = "sm-root";

      const presetRowEl = document.createElement("div");
      presetRowEl.className = "sm-zone-preset";
      const tabsEl = document.createElement("div");
      tabsEl.className = "sm-zone-tabs";
      const sectionToolbarEl = document.createElement("div");
      sectionToolbarEl.className = "sm-zone-options";
      const formEl = document.createElement("div");
      formEl.style.display = "none";
      const listEl = document.createElement("div");
      listEl.className = "sm-zone-list";
      const previewEl = document.createElement("div");
      previewEl.className = "sm-zone-preview";
      const previewTextEl = document.createElement("div");
      previewTextEl.className = "sm-preview-text";
      const previewSideEl = document.createElement("div");
      previewSideEl.className = "sm-preview-side";

      const previewCopyBtn = document.createElement("button");
      previewCopyBtn.className = "sm-preview-copy-btn";
      previewCopyBtn.innerHTML = svgIcon("copy", 13);
      previewCopyBtn.title = "Copy combined prompt text";
      previewCopyBtn.addEventListener("click", async (e) => {
        e.stopPropagation();
        const text = computePreview(node.smData);
        try {
          await navigator.clipboard.writeText(text);
          flashButton(previewCopyBtn);
        } catch (err) {
          const ta = document.createElement("textarea");
          ta.value = text;
          document.body.appendChild(ta);
          ta.select();
          document.execCommand("copy");
          document.body.removeChild(ta);
          flashButton(previewCopyBtn);
        }
      });

      const previewModeBtn = document.createElement("button");
      previewModeBtn.className = "sm-preview-mode-btn";
      previewModeBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        const next = node.smData.previewMode === "names" ? "text" : "names";
        node.smData.previewMode = next;
        try { localStorage.setItem("sm_preview_mode", next); } catch (err) {}
        persist();
        updatePreview();
      });

      previewSideEl.appendChild(previewCopyBtn);
      previewSideEl.appendChild(previewModeBtn);
      previewEl.appendChild(previewTextEl);
      previewEl.appendChild(previewSideEl);

      root.appendChild(presetRowEl);
      root.appendChild(tabsEl);
      root.appendChild(sectionToolbarEl);
      root.appendChild(formEl);
      root.appendChild(listEl);
      root.appendChild(previewEl);

      // Section JSON Import (Masqué)
      const importInput = document.createElement("input");
      importInput.type = "file";
      importInput.accept = "application/json";
      importInput.style.display = "none";
      root.appendChild(importInput);
      importInput.addEventListener("change", () => {
        const f = importInput.files && importInput.files[0];
        importInput.value = "";
        if (!f) return;
        const reader = new FileReader();
        reader.onload = () => {
          try {
            importSection(JSON.parse(reader.result));
          } catch (e) {
            alert("Invalid file: " + e.message);
          }
        };
        reader.readAsText(f);
      });

      // Import ZIP Bundle (Masqué)
      const importZipInput = document.createElement("input");
      importZipInput.type = "file";
      importZipInput.accept = ".zip,application/zip";
      importZipInput.style.display = "none";
      root.appendChild(importZipInput);

      importZipInput.addEventListener("change", async () => {
        const file = importZipInput.files && importZipInput.files[0];
        importZipInput.value = "";
        if (!file) return;

        const formData = new FormData();
        formData.append("file", file);

        try {
          const res = await fetch("/subject_manager/import_bundle", { method: "POST", body: formData });
          let json = null;
          const textResponse = await res.text();
          try {
            json = JSON.parse(textResponse);
          } catch (err) {
            throw new Error(`Server error (${res.status}): ${textResponse || res.statusText}`);
          }

          if (!res.ok || !json || !json.ok) {
            throw new Error((json && json.error) || `Import failed (${res.status})`);
          }

          await refreshPresetSelect(json.name);
          await loadPresetByName(json.name);
          alert(`Bundle successfully imported as "${json.name}" (${json.media_count} media files added). Existing presets were preserved.`);
        } catch (e) {
          alert("Import error: " + e.message);
        }
      });

      // =========================================================================
      // GESTIONNAIRE UNIVERSEL DE DRAG & DROP GLOBAL SUR SM-ROOT
      // =========================================================================
      async function handleGlobalDroppedFiles(files) {
        if (!files || !files.length) return;

        // 1. CAS : ARCHIVE PRESET BUNDLE (.ZIP)
        const zipFile = Array.from(files).find((f) => f.name.toLowerCase().endsWith(".zip"));
        if (zipFile) {
          const formData = new FormData();
          formData.append("file", zipFile);
          try {
            const res = await fetch("/subject_manager/import_bundle", { method: "POST", body: formData });
            const json = await res.json();
            if (!res.ok || !json.ok) throw new Error(json.error || "Zip import failed");
            await refreshPresetSelect(json.name);
            await loadPresetByName(json.name);
            alert(`Preset bundle "${json.name}" successfully imported (${json.media_count} media files added).`);
          } catch (e) {
            alert("Bundle import error: " + e.message);
          }
          return;
        }

        // 2. CAS : FICHIER JSON (SECTION OU PRESET COMPLET)
        const jsonFile = Array.from(files).find((f) => f.name.toLowerCase().endsWith(".json"));
        if (jsonFile) {
          const reader = new FileReader();
          reader.onload = async () => {
            try {
              const parsed = JSON.parse(reader.result);
              if (parsed.smSection) {
                importSection(parsed);
              } else if (Array.isArray(parsed.sections) && typeof parsed.categories === "object") {
                node.smData = sanitizeData(parsed);
                state.activeTab = node.smData.sections.length ? node.smData.sections[0].key : null;
                persist();
                renderAll();
              } else {
                alert("Unrecognized JSON format.");
              }
            } catch (e) {
              alert("JSON read error: " + e.message);
            }
          };
          reader.readAsText(jsonFile);
          return;
        }

        // 3. CAS : GROUPE DE FICHIERS MÉDIAS (IMAGES / AUDIO / VIDÉO) -> NOUVELLE CARTE
        const imageFiles = [];
        const audioFiles = [];
        const videoFiles = [];

        const ALLOWED_IMG = ["jpg", "jpeg", "png", "webp", "bmp"];
        const ALLOWED_AUD = ["mp3", "wav", "flac", "aac", "ogg", "m4a"];
        const ALLOWED_VID = ["mp4", "webm", "mkv", "mov", "avi"];

        for (const f of files) {
          const ext = f.name.split(".").pop().toLowerCase();
          if (f.type.startsWith("image/") || ALLOWED_IMG.includes(ext)) {
            imageFiles.push(f);
          } else if (f.type.startsWith("audio/") || ALLOWED_AUD.includes(ext)) {
            audioFiles.push(f);
          } else if (f.type.startsWith("video/") || ALLOWED_VID.includes(ext)) {
            videoFiles.push(f);
          }
        }

        if (!imageFiles.length && !audioFiles.length && !videoFiles.length) {
          return;
        }

        async function getFilePath(file) {
          if (file.path) return file.path;
          const upRes = await uploadMediaFile(file);
          return upRes.path || upRes.filename;
        }

        try {
          const uploadedImgs = [];
          for (const f of imageFiles.slice(0, 4)) {
            uploadedImgs.push(await getFilePath(f));
          }

          let uploadedAud = null;
          if (audioFiles.length > 0) {
            uploadedAud = await getFilePath(audioFiles[0]);
          }

          let uploadedVid = null;
          if (videoFiles.length > 0) {
            uploadedVid = await getFilePath(videoFiles[0]);
          }

          if (!state.activeTab || !node.smData.categories[state.activeTab]) {
            if (!node.smData.sections.length) {
              node.smData.sections.push({ key: "subjects", label: "Subjects", enabled: true, randomizeOnQueue: false, color: null });
              node.smData.categories["subjects"] = [];
            }
            state.activeTab = node.smData.sections[0].key;
          }

          const type = "character";
          const config = COMBINATORIAL_CONFIG[type] || COMBINATORIAL_CONFIG.character;

          const rawName = files[0].name.replace(/\.[^/.]+$/, "").replace(/[_\-\.]+/g, " ").trim();
          const cleanName = rawName.charAt(0).toUpperCase() + rawName.slice(1);

          const newCard = {
            id: uid(),
            name: cleanName || getNextSubjectName(node.smData.categories),
            subjectType: type,
            prompt: "",
            enablePrompt: true,
            images: uploadedImgs,
            imageStates: uploadedImgs.map(() => true),
            imageTags: uploadedImgs.map((_, idx) => [...(config.imageDefaultPreset[idx] || config.imageDefaultPreset[0])]),
            enableImages: true,
            audio: uploadedAud ? { file: uploadedAud, trimStart: 0, trimEnd: 0 } : null,
            audioTags: [...config.audioDefault],
            enableAudio: true,
            video: uploadedVid ? { file: uploadedVid, trimStart: 0, trimEnd: 0 } : null,
            videoTags: [...config.videoDefault],
            enableVideo: true,
            selected: false,
            allowRandom: true,
            alwaysOn: false,
          };

          newCard.prompt = generatePromptTemplate(type, newCard);
          node.smData.categories[state.activeTab].push(newCard);

          persist();
          renderAll();
        } catch (err) {
          console.error("Drop media error:", err);
          alert("Failed to create subject card from dropped files: " + err.message);
        }
      }

      // --- ÉCOUTEURS DRAG & DROP SUR LA RACINE DU NŒUD ---
      let rootDragCounter = 0;

      function isEditing() {
        return formEl && formEl.style.display !== "none";
      }

      root.ondragenter = (e) => {
        if (isEditing()) return;
        if (sectionDragSrc !== null || itemDragSrc !== null || itemSlotDragSrc !== null) return;
        e.preventDefault();
        rootDragCounter++;
        root.classList.add("sm-root-drag-over");
      };

      root.ondragover = (e) => {
        if (isEditing()) return;
        if (sectionDragSrc !== null || itemDragSrc !== null || itemSlotDragSrc !== null) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = "copy";
        if (!root.classList.contains("sm-root-drag-over")) {
          root.classList.add("sm-root-drag-over");
        }
      };

      root.ondragleave = (e) => {
        if (isEditing()) return;
        e.preventDefault();
        rootDragCounter--;
        if (rootDragCounter <= 0 || !root.contains(e.relatedTarget)) {
          rootDragCounter = 0;
          root.classList.remove("sm-root-drag-over");
        }
      };

      root.ondrop = async (e) => {
        if (isEditing()) return;

        e.preventDefault();
        rootDragCounter = 0;
        root.classList.remove("sm-root-drag-over"); // Éteint toujours le vert

        if (sectionDragSrc !== null || itemDragSrc !== null || itemSlotDragSrc !== null) {
          sectionDragSrc = null;
          itemDragSrc = null;
          itemSlotDragSrc = null;
          return;
        }

        const files = e.dataTransfer && e.dataTransfer.files;
        if (!files || files.length === 0) return;

        await handleGlobalDroppedFiles(files);
      };

      // Handlers
      function toggleRandomizeOnQueue(sec) {
        sec.randomizeOnQueue = !sec.randomizeOnQueue;
        persist();
        renderAll();
      }

      function addSection() {
        const label = window.prompt("New section name:");
        if (!label || !label.trim()) return;
        const existingKeys = new Set(Object.keys(node.smData.categories));
        const key = uniqueKey(slugify(label), existingKeys);
        node.smData.sections.push({ key, label: label.trim(), enabled: true, randomizeOnQueue: false, color: null });
        node.smData.categories[key] = [];
        state.activeTab = key;
        persist();
        renderAll();
      }

      function renameSection() {
        const sec = activeSection();
        if (!sec) return;
        const label = window.prompt("Rename section:", sec.label);
        if (!label || !label.trim()) return;
        sec.label = label.trim();
        persist();
        renderAll();
      }

      function deleteSection() {
        const sec = activeSection();
        if (!sec) return;
        if (node.smData.sections.length <= 1) {
          alert("You need to keep at least one section.");
          return;
        }
        if (!confirm(`Delete section "${sec.label}" and its items?`)) return;
        node.smData.sections = node.smData.sections.filter((s) => s.key !== sec.key);
        delete node.smData.categories[sec.key];
        state.activeTab = node.smData.sections.length ? node.smData.sections[0].key : null;
        persist();
        renderAll();
      }

      function toggleSectionEnabled(sec) {
        sec.enabled = !sec.enabled;
        persist();
        renderAll();
      }

      function enableAllSections() {
        node.smData.sections.forEach((s) => (s.enabled = true));
        persist();
        renderAll();
      }

      function disableAllSections() {
        node.smData.sections.forEach((s) => (s.enabled = false));
        persist();
        renderAll();
      }

      function randomizeAllSections() {
        node.smData.sections.forEach((s) => (s.randomizeOnQueue = true));
        persist();
        renderAll();
      }

      function disableRandomizeAllSections() {
        node.smData.sections.forEach((s) => (s.randomizeOnQueue = false));
        persist();
        renderAll();
      }

      function soloSection(sec) {
        node.smData.sections.forEach((s) => (s.enabled = s.key === sec.key));
        persist();
        renderAll();
      }

      function exportSection() {
        const sec = activeSection();
        if (!sec) return;
        const items = JSON.parse(JSON.stringify(activeItems()));
        const payload = { smSection: true, label: sec.label, items };
        download(`${slugify(sec.label)}.json`, JSON.stringify(payload, null, 2));
      }

      function importSection(parsed) {
        const items = Array.isArray(parsed && parsed.items) ? parsed.items : null;
        if (!items) { alert("Invalid subject section file."); return; }
        const label = (parsed.label || "Imported Section").trim() || "Imported Section";
        const existingLabels = new Set(node.smData.sections.map((s) => s.label));
        const finalLabel = uniqueLabel(label, existingLabels);
        const existingKeys = new Set(Object.keys(node.smData.categories));
        const key = uniqueKey(slugify(finalLabel), existingKeys);
        node.smData.sections.push({ key, label: finalLabel, enabled: true, randomizeOnQueue: false, color: null });
        node.smData.categories[key] = items.map((it) => {
          const type = (it && it.subjectType) || "character";
          const config = COMBINATORIAL_CONFIG[type] || COMBINATORIAL_CONFIG.character;
          const imgs = Array.isArray(it && it.images) ? it.images.filter(Boolean).slice(0, 4) : [];
          
          const imgTags = Array.isArray(it && it.imageTags) ? it.imageTags.slice(0, imgs.length) : [];
          while (imgTags.length < imgs.length) {
            imgTags.push([...(config.imageDefaultPreset[imgTags.length] || config.imageDefaultPreset[0])]);
          }

          return {
            id: uid(),
            name: (it && it.name) || "",
            subjectType: type,
            prompt: (it && it.prompt) || "",
            enablePrompt: it && it.enablePrompt === false ? false : true,
            images: imgs,
            imageStates: Array.isArray(it && it.imageStates) ? it.imageStates.slice(0, imgs.length) : [true, true, true, true],
            imageTags: imgTags,
            enableImages: it && it.enableImages === false ? false : true,
            audio: it && it.audio ? it.audio : null,
            audioTags: Array.isArray(it && it.audioTags) ? it.audioTags : [...config.audioDefault],
            enableAudio: it && it.enableAudio === false ? false : true,
            video: it && it.video ? it.video : null,
            videoTags: Array.isArray(it && it.videoTags) ? it.videoTags : [...config.videoDefault],
            enableVideo: it && it.enableVideo === false ? false : true,
            selected: false,
            allowRandom: it && it.allowRandom === false ? false : true,
            alwaysOn: !!(it && it.alwaysOn),
          };
        });
        state.activeTab = key;
        persist();
        renderAll();
      }

      // Presets
      async function fetchPresets() {
        try { return await fetchJSON("/subject_manager/presets"); }
        catch (e) { return { names: [], last: null }; }
      }

      async function refreshPresetSelect(selectName) {
        const { names, last } = await fetchPresets();
        presetSelect.innerHTML = "";
        const placeholder = document.createElement("option");
        placeholder.value = "";
        placeholder.textContent = "—";
        presetSelect.appendChild(placeholder);
        names.forEach((n) => {
          const opt = document.createElement("option");
          opt.value = n; opt.textContent = n;
          presetSelect.appendChild(opt);
        });
        const want = selectName || last || "";
        presetSelect.value = names.includes(want) ? want : "";
        renderPresetRow();
      }

      async function loadPresetByName(name) {
        const parsed = await fetchJSON(`/subject_manager/presets/${encodeURIComponent(name)}`);
        node.smData = sanitizeData(parsed);
        state.activeTab = node.smData.sections.length ? node.smData.sections[0].key : null;
        persist();
        renderAll();
        fetch("/subject_manager/last_used", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name }),
        }).catch(() => {});
      }

      const presetSelect = document.createElement("select");
      presetSelect.className = "sm-select sm-select-preset";
      presetSelect.title = "Saved presets";
      presetSelect.addEventListener("change", async () => {
        const name = presetSelect.value;
        if (!name) return;
        try { await loadPresetByName(name); }
        catch (e) { alert("Failed to load preset: " + e.message); }
      });

      function mkBtn(iconName, cls, title, onClick) {
        const b = document.createElement("button");
        b.className = "sm-btn" + (cls ? " " + cls : "");
        b.innerHTML = svgIcon(iconName, 15);
        if (title) b.title = title;
        b.addEventListener("click", (e) => { e.stopPropagation(); onClick(); });
        return b;
      }

      function flashButton(btn) {
        if (!btn) return;
        btn.classList.add("sm-flash");
        setTimeout(() => btn.classList.remove("sm-flash"), 650);
      }

      // --- Render Tabs ---
      let sectionDragSrc = null;
      function renderTabs() {
        tabsEl.innerHTML = "";
        node.smData.sections.forEach((s, index) => {
          const tab = document.createElement("div");
          const tabItems = node.smData.categories[s.key] || [];
          const totalCount = tabItems.length;
          const selectedCount = tabItems.filter((it) => it.selected || it.alwaysOn).length;
          const hasSelection = selectedCount > 0;
          const count = `${selectedCount}/${totalCount}`;

          tab.className = "sm-tab" +
            (state.activeTab === s.key ? " active" : "") +
            (hasSelection ? " sm-tab-has-selection" : "") +
            (!s.enabled ? " sm-tab-disabled" : "");
          tab.draggable = true;

          const colorBar = document.createElement("span");
          colorBar.className = "sm-tab-colorbar";
          colorBar.style.background = s.color ? SECTION_COLORS[s.color] : "transparent";
          tab.appendChild(colorBar);

          const iconsWrap = document.createElement("div");
          iconsWrap.className = "sm-tab-icons";

          const enableBtn = document.createElement("button");
          enableBtn.className = "sm-tab-mini-btn" + (s.enabled ? " on-enable" : "");
          enableBtn.innerHTML = svgIcon(s.enabled ? "eye" : "eyeOff", 13);
          enableBtn.title = s.enabled ? "Section enabled" : "Section disabled";
          enableBtn.addEventListener("click", (e) => { e.stopPropagation(); toggleSectionEnabled(s); });
          iconsWrap.appendChild(enableBtn);

          const diceBtn = document.createElement("button");
          diceBtn.className = "sm-tab-mini-btn" + (s.randomizeOnQueue ? " on-dice" : "");
          diceBtn.innerHTML = svgIcon("dice", 13);
          diceBtn.title = s.randomizeOnQueue ? "Randomize on queue: ON" : "Randomize on queue: OFF";
          diceBtn.addEventListener("click", (e) => { e.stopPropagation(); toggleRandomizeOnQueue(s); });
          iconsWrap.appendChild(diceBtn);

          tab.appendChild(iconsWrap);

          const sep0 = document.createElement("span");
          sep0.className = "sm-tab-sep";
          tab.appendChild(sep0);

          const label = document.createElement("span");
          label.textContent = s.label;
          tab.appendChild(label);

          const sep1 = document.createElement("span");
          sep1.className = "sm-tab-sep";
          tab.appendChild(sep1);

          const countEl = document.createElement("span");
          countEl.className = "sm-count";
          countEl.textContent = count;
          tab.appendChild(countEl);

          tab.addEventListener("click", () => {
            if (state.activeTab === s.key) return;
            state.activeTab = s.key;
            state.colorPickerOpen = false;
            closeForm();
            renderTabs();
            renderSectionToolbar();
            renderList();
            updatePreview();
          });

          tab.addEventListener("dragstart", (e) => { sectionDragSrc = index; e.dataTransfer.effectAllowed = "move"; });
          tab.addEventListener("dragover", (e) => e.preventDefault());
          tab.addEventListener("drop", (e) => {
            e.preventDefault();
            if (sectionDragSrc === null || sectionDragSrc === index) return;
            const arr = node.smData.sections;
            const [moved] = arr.splice(sectionDragSrc, 1);
            arr.splice(index, 0, moved);
            sectionDragSrc = null;
            persist();
            renderTabs();
          });

          tabsEl.appendChild(tab);
        });

        const addTab = document.createElement("div");
        addTab.className = "sm-tab sm-tab-add";
        addTab.innerHTML = svgIcon("plus", 16);
        addTab.title = "New section";
        addTab.addEventListener("click", addSection);
        tabsEl.appendChild(addTab);
      }

      // --- Render Preset Row ---
      function renderPresetRow() {
        presetRowEl.innerHTML = "";

        presetRowEl.appendChild(
          mkBtn("filePlus", "", "Start blank preset", () => {
            if (!confirm("Start a new blank preset? Unsaved changes will be lost.")) return;
            node.smData = sanitizeData({});
            state.activeTab = node.smData.sections[0].key;
            presetSelect.value = "";
            persist();
            renderAll();
          })
        );

        presetRowEl.appendChild(presetSelect);

        const saveBtn = mkBtn("save", "btn-tint-blue", "Save preset", async () => {
          const suggested = presetSelect.value || "";
          const name = window.prompt("Save preset as:", suggested);
          if (!name || !name.trim()) return;
          const clean = name.trim();
          try {
            await fetchJSON(`/subject_manager/presets/${encodeURIComponent(clean)}`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(node.smData),
            });
            await refreshPresetSelect(clean);
            flashButton(saveBtn);
          } catch (e) {
            alert("Failed to save preset: " + e.message);
          }
        });
        presetRowEl.appendChild(saveBtn);

        // Bouton Exporter Bundle ZIP
        const exportZipBtn = mkBtn("package", "btn-tint-purple", "Export full preset bundle (.zip with all media)", () => {
          const current = presetSelect.value;
          if (!current) {
            alert("Please save or select a preset before exporting.");
            return;
          }
          window.location.href = `/subject_manager/export_bundle/${encodeURIComponent(current)}`;
        });
        exportZipBtn.disabled = !presetSelect.value;
        presetRowEl.appendChild(exportZipBtn);

        // Bouton Importer Bundle ZIP
        const importZipBtn = mkBtn("download", "btn-tint-purple", "Import full preset bundle (.zip)", () => {
          importZipInput.click();
        });
        presetRowEl.appendChild(importZipBtn);

        const reloadBtn = mkBtn("refresh", "", "Reload selected preset", async () => {
          const current = presetSelect.value;
          if (!current || !confirm(`Reload preset "${current}"?`)) return;
          try { await loadPresetByName(current); } catch (e) { alert("Error: " + e.message); }
        });
        reloadBtn.disabled = !presetSelect.value;
        presetRowEl.appendChild(reloadBtn);

        const renameBtn = mkBtn("edit", "", "Rename preset", async () => {
          const current = presetSelect.value;
          if (!current) return;
          const newName = window.prompt("Rename preset:", current);
          if (!newName || !newName.trim() || newName.trim() === current) return;
          try {
            await fetchJSON(`/subject_manager/presets/${encodeURIComponent(current)}/rename`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ new_name: newName.trim() }),
            });
            await refreshPresetSelect(newName.trim());
          } catch (e) { alert("Error: " + e.message); }
        });
        renameBtn.disabled = !presetSelect.value;
        presetRowEl.appendChild(renameBtn);

        const delBtn = mkBtn("trash", "btn-tint-red", "Delete preset", async () => {
          const current = presetSelect.value;
          if (!current || !confirm(`Delete preset "${current}"?`)) return;
          try {
            await fetch(`/subject_manager/presets/${encodeURIComponent(current)}`, { method: "DELETE" });
            await refreshPresetSelect("");
          } catch (e) { alert("Error: " + e.message); }
        });
        delBtn.disabled = !presetSelect.value;
        presetRowEl.appendChild(delBtn);

        const sep1 = document.createElement("div");
        sep1.className = "sm-sep";
        presetRowEl.appendChild(sep1);

        presetRowEl.appendChild(
          mkBtn(node.smData.viewMode === "grid" ? "list" : "grid", "", "Toggle Grid / List view", () => {
            node.smData.viewMode = node.smData.viewMode === "grid" ? "list" : "grid";
            persist();
            renderAll();
          })
        );

        const sep2 = document.createElement("div");
        sep2.className = "sm-sep";
        presetRowEl.appendChild(sep2);

        presetRowEl.appendChild(mkBtn("eye", "btn-tint-green", "Enable all sections", enableAllSections));
        presetRowEl.appendChild(mkBtn("eyeOff", "btn-tint-green", "Disable all sections", disableAllSections));

        const sep3 = document.createElement("div");
        sep3.className = "sm-sep";
        presetRowEl.appendChild(sep3);

        presetRowEl.appendChild(mkBtn("dice", "btn-tint-purple", "Randomize ON for all", randomizeAllSections));
        presetRowEl.appendChild(mkBtn("diceOff", "btn-tint-purple", "Randomize OFF for all", disableRandomizeAllSections));
      }

      // --- Render Section Toolbar ---
      function renderSectionToolbar() {
        sectionToolbarEl.innerHTML = "";
        const sec = activeSection();
        if (!sec) return;

        const items = activeItems();
        const selectedCount = items.filter((it) => it.selected).length;
        const hasSelection = selectedCount > 0;
        const hasClipboard = state.clipboard.length > 0;

        sectionToolbarEl.appendChild(mkBtn("plus", "primary", "Add Subject Card", () => openForm(null)));

        const sep0 = document.createElement("div");
        sep0.className = "sm-sep";
        sectionToolbarEl.appendChild(sep0);

        sectionToolbarEl.appendChild(mkBtn("target", "", "Solo this section", () => soloSection(sec)));

        const sep0b = document.createElement("div");
        sep0b.className = "sm-sep";
        sectionToolbarEl.appendChild(sep0b);

        sectionToolbarEl.appendChild(mkBtn("upload", "", "Export section", exportSection));
        sectionToolbarEl.appendChild(mkBtn("download", "", "Import section", () => importInput.click()));

        const sep1 = document.createElement("div");
        sep1.className = "sm-sep";
        sectionToolbarEl.appendChild(sep1);

        const colorBtn = mkBtn("palette", state.colorPickerOpen ? "accent-on" : "", "Section color", () => {
          state.colorPickerOpen = !state.colorPickerOpen;
          renderSectionToolbar();
        });
        if (sec.color && SECTION_COLORS[sec.color]) {
          colorBtn.style.background = SECTION_COLORS[sec.color];
          colorBtn.style.color = "#fff";
        }
        sectionToolbarEl.appendChild(colorBtn);

        if (state.colorPickerOpen) {
          const picker = document.createElement("div");
          picker.className = "sm-color-picker";
          const noneSw = document.createElement("button");
          noneSw.className = "sm-color-swatch sm-color-none";
          noneSw.title = "No color";
          noneSw.addEventListener("click", () => { sec.color = null; state.colorPickerOpen = false; persist(); renderAll(); });
          picker.appendChild(noneSw);

          Object.keys(SECTION_COLORS).forEach((key) => {
            const sw = document.createElement("button");
            sw.className = "sm-color-swatch";
            sw.style.background = SECTION_COLORS[key];
            sw.title = key;
            sw.addEventListener("click", () => { sec.color = key; state.colorPickerOpen = false; persist(); renderAll(); });
            picker.appendChild(sw);
          });
          sectionToolbarEl.appendChild(picker);
        }

        sectionToolbarEl.appendChild(mkBtn("edit", "", "Rename section", renameSection));

        const delSecBtn = mkBtn("trash", "btn-tint-red", "Delete section", deleteSection);
        delSecBtn.disabled = node.smData.sections.length <= 1;
        sectionToolbarEl.appendChild(delSecBtn);

        const sep2 = document.createElement("div");
        sep2.className = "sm-sep";
        sectionToolbarEl.appendChild(sep2);

        sectionToolbarEl.appendChild(
          mkBtn("more", state.editBarOpen ? "accent-on" : "", "Toggle bulk actions", () => {
            state.editBarOpen = !state.editBarOpen;
            renderSectionToolbar();
          })
        );

        if (state.editBarOpen) {
          const ctx = document.createElement("div");
          ctx.className = "sm-toolbar-contextual";

          const delSelBtn = mkBtn("trash", "danger", "Delete selected", () => {
            node.smData.categories[state.activeTab] = items.filter((it) => !it.selected);
            persist(); renderAll();
          }, selectedCount || "");
          delSelBtn.disabled = !hasSelection;
          ctx.appendChild(delSelBtn);

          const copyBtn = mkBtn("copy", "", "Copy selected", () => {
            state.clipboard = items.filter((it) => it.selected).map((it) => JSON.parse(JSON.stringify(it)));
            renderSectionToolbar();
          }, selectedCount || "");
          copyBtn.disabled = !hasSelection;
          ctx.appendChild(copyBtn);

          const cutBtn = mkBtn("cut", "", "Cut selected", () => {
            state.clipboard = items.filter((it) => it.selected).map((it) => JSON.parse(JSON.stringify(it)));
            node.smData.categories[state.activeTab] = items.filter((it) => !it.selected);
            persist(); renderAll();
          }, selectedCount || "");
          cutBtn.disabled = !hasSelection;
          ctx.appendChild(cutBtn);

          const pasteBtn = mkBtn("paste", "", "Paste items", () => {
            const clones = state.clipboard.map((it) => ({ ...JSON.parse(JSON.stringify(it)), id: uid(), selected: false }));
            node.smData.categories[state.activeTab] = activeItems().concat(clones);
            persist(); renderAll();
          }, state.clipboard.length || "");
          pasteBtn.disabled = !hasClipboard;
          ctx.appendChild(pasteBtn);

          const moveSelect = document.createElement("select");
          moveSelect.className = "sm-select sm-select-move";
          const optDef = document.createElement("option");
          optDef.textContent = "move…";
          optDef.value = "";
          moveSelect.appendChild(optDef);
          node.smData.sections.filter((s) => s.key !== state.activeTab).forEach((s) => {
            const opt = document.createElement("option");
            opt.value = s.key; opt.textContent = s.label;
            moveSelect.appendChild(opt);
          });
          moveSelect.disabled = !hasSelection;
          moveSelect.addEventListener("change", () => {
            const target = moveSelect.value;
            if (!target) return;
            const moving = items.filter((it) => it.selected);
            node.smData.categories[state.activeTab] = items.filter((it) => !it.selected);
            node.smData.categories[target] = (node.smData.categories[target] || []).concat(moving);
            persist(); renderAll();
          });
          ctx.appendChild(moveSelect);

          const clearBtn = mkBtn("close", "", "Clear selection", () => {
            items.forEach((it) => (it.selected = false));
            persist(); renderAll();
          });
          clearBtn.disabled = !hasSelection;
          ctx.appendChild(clearBtn);

          sectionToolbarEl.appendChild(ctx);
        }
      }

      // --- Trimmer avec Puces Combinatoires Audio/Vidéo ---
      function createTrimmerComponent(label, mediaType, mediaObj, activeTags, availableTagOptions, onTagsChanged, isEnabled, isMissing, fullPath, onToggleEnable, onRemove) {
        const wrap = document.createElement("div");
        wrap.className = "sm-trimmer-box" + (isMissing ? " box-missing" : "");

        const head = document.createElement("div");
        head.className = "sm-trimmer-head";
        
        const leftHead = document.createElement("div");
        leftHead.style.display = "flex";
        leftHead.style.alignItems = "center";
        leftHead.style.gap = "6px";

        const mediaEl = mediaType === "video" ? document.createElement("video") : new Audio();
        if (!isMissing && mediaObj.file) {
          mediaEl.src = getMediaUrl(mediaObj.file, true);
          mediaEl.preload = "metadata";
          activeFormMedia.push(mediaEl);
        }

        const toggleBtn = document.createElement("button");
        toggleBtn.className = "sm-icon-btn";
        toggleBtn.innerHTML = svgIcon(isEnabled ? "eye" : "eyeOff", 13);
        toggleBtn.title = isEnabled ? "Media active (click to mute)" : "Media muted (click to activate)";
        toggleBtn.style.color = isEnabled ? "var(--sm-green-text-bright)" : "#777";
        toggleBtn.onclick = (e) => {
          e.preventDefault();
          mediaEl.pause();
          onToggleEnable();
        };

        const titleSpan = document.createElement("span");
        titleSpan.textContent = isMissing ? `[MISSING] ${label}` : label;
        titleSpan.title = fullPath || mediaObj.file;
        if (isMissing) {
          titleSpan.style.color = "var(--sm-missing-color)";
          titleSpan.style.fontWeight = "bold";
        } else if (!isEnabled) {
          titleSpan.style.color = "#777";
        }

        leftHead.appendChild(toggleBtn);
        leftHead.appendChild(titleSpan);
        head.appendChild(leftHead);

        // Timecodes Display
        const timeWrap = document.createElement("div");
        timeWrap.className = "sm-trimmer-time-display";
        const curSpan = document.createElement("span"); curSpan.className = "sm-time-val sm-time-cur"; curSpan.textContent = "0:00.0";
        const totSpan = document.createElement("span"); totSpan.className = "sm-time-val sm-time-tot"; totSpan.textContent = "0:00.0";
        const leftBrk = document.createElement("span"); leftBrk.className = "sm-time-bracket"; leftBrk.textContent = "[";
        const startSpan = document.createElement("span"); startSpan.className = "sm-time-val sm-time-trim-start"; startSpan.textContent = "0:00.0";
        const dashSpan = document.createElement("span"); dashSpan.className = "sm-time-trim-sep"; dashSpan.textContent = "-";
        const endSpan = document.createElement("span"); endSpan.className = "sm-time-val sm-time-trim-end"; endSpan.textContent = "0:00.0";
        const rightBrk = document.createElement("span"); rightBrk.className = "sm-time-bracket"; rightBrk.textContent = "]";
        const lenSpan = document.createElement("span"); lenSpan.className = "sm-time-val sm-time-trim-len"; lenSpan.textContent = "0.0s";

        if (isMissing) {
          timeWrap.innerHTML = "<span style='color:var(--sm-missing-color);'>[File missing]</span>";
        } else {
          timeWrap.appendChild(curSpan); timeWrap.appendChild(totSpan); timeWrap.appendChild(leftBrk);
          timeWrap.appendChild(startSpan); timeWrap.appendChild(dashSpan); timeWrap.appendChild(endSpan);
          timeWrap.appendChild(rightBrk); timeWrap.appendChild(lenSpan);
        }
        head.appendChild(timeWrap);
        wrap.appendChild(head);

        // Body Trimmer
        const body = document.createElement("div");
        body.className = "sm-trimmer-body";

        const playBtn = document.createElement("button");
        playBtn.className = "sm-btn";
        playBtn.innerHTML = svgIcon("play", 13);
        if (isMissing) playBtn.disabled = true;

        let totalDuration = 0;
        let trimStart = Number(mediaObj.trimStart) || 0;
        let trimEnd = Number(mediaObj.trimEnd) || 0;

        const trackWrap = document.createElement("div");
        trackWrap.className = "sm-trim-track-wrap";

        if (mediaType === "audio" && !isMissing && mediaObj.file) {
          const waveCanvas = document.createElement("canvas");
          waveCanvas.className = "sm-trim-waveform-canvas";
          trackWrap.appendChild(waveCanvas);
          setTimeout(() => { renderAudioWaveform(waveCanvas, getMediaUrl(mediaObj.file)); }, 10);
        }

        const activeZone = document.createElement("div"); activeZone.className = "sm-trim-active-zone";
        const handleLeft = document.createElement("div"); handleLeft.className = "sm-trim-handle sm-trim-handle-left";
        const handleRight = document.createElement("div"); handleRight.className = "sm-trim-handle sm-trim-handle-right";
        const playhead = document.createElement("div"); playhead.className = "sm-trim-playhead";

        trackWrap.appendChild(activeZone); trackWrap.appendChild(handleLeft);
        trackWrap.appendChild(handleRight); trackWrap.appendChild(playhead);

        function updateUI() {
          if (!totalDuration) return;
          const leftPct = (trimStart / totalDuration) * 100;
          const rightPct = (trimEnd / totalDuration) * 100;
          const curPct = (mediaEl.currentTime / totalDuration) * 100;

          handleLeft.style.left = `${leftPct}%`;
          handleRight.style.left = `${rightPct}%`;
          activeZone.style.left = `${leftPct}%`;
          activeZone.style.width = `${Math.max(0, rightPct - leftPct)}%`;
          playhead.style.left = `${curPct}%`;

          curSpan.textContent = formatTime(mediaEl.currentTime);
          totSpan.textContent = formatTime(totalDuration);
          startSpan.textContent = formatTime(trimStart);
          endSpan.textContent = formatTime(trimEnd);
          lenSpan.textContent = `${Math.max(0, trimEnd - trimStart).toFixed(1)}s`;
        }

        mediaEl.onloadedmetadata = () => {
          totalDuration = mediaEl.duration || 10;
          if (trimEnd <= 0 || trimEnd > totalDuration) { trimEnd = totalDuration; mediaObj.trimEnd = trimEnd; }
          if (trimStart < 0) trimStart = 0;
          updateUI();
        };

        playBtn.onclick = () => {
          if (isMissing) return;
          if (mediaEl.paused) {
            if (mediaEl.currentTime < trimStart || mediaEl.currentTime >= trimEnd) mediaEl.currentTime = trimStart;
            mediaEl.play();
            playBtn.innerHTML = svgIcon("pause", 13);
          } else {
            mediaEl.pause();
            playBtn.innerHTML = svgIcon("play", 13);
          }
        };

        mediaEl.ontimeupdate = () => {
          if (trimEnd > trimStart && mediaEl.currentTime >= trimEnd) {
            mediaEl.pause(); mediaEl.currentTime = trimStart; playBtn.innerHTML = svgIcon("play", 13);
          }
          updateUI();
        };

        function setupHandleDrag(handle, isStart) {
          handle.onmousedown = (e) => {
            if (isMissing) return;
            e.stopPropagation(); e.preventDefault();
            const rect = trackWrap.getBoundingClientRect();
            const onMouseMove = (moveEv) => {
              if (!totalDuration) return;
              const x = Math.max(0, Math.min(rect.width, moveEv.clientX - rect.left));
              const sec = (x / rect.width) * totalDuration;
              if (isStart) {
                trimStart = Math.min(sec, trimEnd - 0.1); trimStart = Math.max(0, trimStart);
                mediaObj.trimStart = trimStart; mediaEl.currentTime = trimStart;
              } else {
                trimEnd = Math.max(sec, trimStart + 0.1); trimEnd = Math.min(totalDuration, trimEnd);
                mediaObj.trimEnd = trimEnd; mediaEl.currentTime = trimEnd;
              }
              updateUI();
            };
            const onMouseUp = () => { window.removeEventListener("mousemove", onMouseMove); window.removeEventListener("mouseup", onMouseUp); };
            window.addEventListener("mousemove", onMouseMove); window.addEventListener("mouseup", onMouseUp);
          };
        }
        setupHandleDrag(handleLeft, true);
        setupHandleDrag(handleRight, false);

        trackWrap.onclick = (e) => {
          if (isMissing || !totalDuration) return;
          const rect = trackWrap.getBoundingClientRect();
          mediaEl.currentTime = (Math.max(0, Math.min(rect.width, e.clientX - rect.left)) / rect.width) * totalDuration;
          updateUI();
        };

        const delBtn = mkBtn("trash", "danger", "Remove media", () => { mediaEl.pause(); onRemove(); });

        body.appendChild(playBtn);
        body.appendChild(trackWrap);
        body.appendChild(delBtn);
        wrap.appendChild(body);

        if (mediaType === "video" && !isMissing) {
          mediaEl.style.width = "100%"; mediaEl.style.maxHeight = "110px"; mediaEl.style.background = "#000";
          if (!isEnabled) mediaEl.style.filter = "grayscale(1) opacity(0.35)";
          wrap.appendChild(mediaEl);
        }

        // --- Rangée de Puces Combinatoires Audio/Vidéo ---
        if (availableTagOptions && availableTagOptions.length > 0 && !isMissing) {
          const tagsRow = document.createElement("div");
          tagsRow.className = "sm-trimmer-tags-row";
          tagsRow.style.cssText = "display: flex !important; flex-direction: row !important; flex-wrap: wrap !important; gap: 4px !important; width: 100% !important; align-items: center !important; margin-top: 4px !important;";

          availableTagOptions.forEach((opt) => {
            const chip = document.createElement("button");
            const isActive = (activeTags || []).includes(opt.id);
            chip.className = "sm-chip-btn" + (isActive ? " active" : "");
            chip.style.cssText = "display: inline-flex !important; flex: 0 0 auto !important; width: auto !important; white-space: nowrap !important; font-size: 11px !important; padding: 4px 8px !important; font-weight: 500 !important;";
            chip.textContent = opt.label;

            const phrase = opt.desc || opt.label;
            if (mediaType === "audio") {
              chip.title = `<Audio 1> is the reference for <Subject 1>, establishing ${phrase}.`;
            } else if (mediaType === "video") {
              chip.title = `<Video 1> provides <Subject 1>'s ${phrase}.`;
            } else {
              chip.title = phrase;
            }

            chip.onclick = (e) => {
              e.preventDefault();
              if (activeTags.includes(opt.id)) {
                const idx = activeTags.indexOf(opt.id);
                activeTags.splice(idx, 1);
              } else {
                activeTags.push(opt.id);
              }
              chip.classList.toggle("active", activeTags.includes(opt.id));
              onTagsChanged(activeTags);
            };
            tagsRow.appendChild(chip);
          });
          wrap.appendChild(tagsRow);
        }

        return wrap;
      }

      // --- Helper for Media Enable/Disable Badges Bar (4 toggles) ---
      function createAssetToggles(item, onToggle) {
        const hasImgs = (item.images || []).filter(Boolean).length > 0;
        const hasAud = !!(item.audio && item.audio.file);
        const hasVid = !!(item.video && item.video.file);
        const hasTxt = !!(item.prompt && item.prompt.trim());

        if (!hasImgs && !hasAud && !hasVid && !hasTxt) return null;

        const wrap = document.createElement("div");
        wrap.className = "sm-tile-badges";

        if (hasImgs) {
          const imgBtn = document.createElement("button");
          const on = item.enableImages !== false;
          imgBtn.className = "sm-tile-badge-btn sm-badge-img" + (on ? " active" : " off");
          imgBtn.innerHTML = svgIcon("image", 12);
          imgBtn.title = on ? "Images: Active (Click to mute images)\n" + item.images.join("\n") : "Images: Muted (Click to activate images)";
          imgBtn.onclick = (e) => {
            e.stopPropagation();
            item.enableImages = !on;
            persist();
            onToggle();
          };
          wrap.appendChild(imgBtn);
        }

        if (hasAud) {
          const audBtn = document.createElement("button");
          const on = item.enableAudio !== false;
          audBtn.className = "sm-tile-badge-btn sm-badge-aud" + (on ? " active" : " off");
          audBtn.innerHTML = svgIcon("music", 12);
          audBtn.title = on ? `Audio: Active (Click to mute)\nFile: ${item.audio.file}` : `Audio: Muted\nFile: ${item.audio.file}`;
          audBtn.onclick = (e) => {
            e.stopPropagation();
            item.enableAudio = !on;
            persist();
            onToggle();
          };
          wrap.appendChild(audBtn);
        }

        if (hasVid) {
          const vidBtn = document.createElement("button");
          const on = item.enableVideo !== false;
          vidBtn.className = "sm-tile-badge-btn sm-badge-vid" + (on ? " active" : " off");
          vidBtn.innerHTML = svgIcon("video", 12);
          vidBtn.title = on ? `Video: Active (Click to mute)\nFile: ${item.video.file}` : `Video: Muted\nFile: ${item.video.file}`;
          vidBtn.onclick = (e) => {
            e.stopPropagation();
            item.enableVideo = !on;
            persist();
            onToggle();
          };
          wrap.appendChild(vidBtn);
        }

        if (hasTxt) {
          const txtBtn = document.createElement("button");
          const on = item.enablePrompt !== false;
          txtBtn.className = "sm-tile-badge-btn sm-badge-txt" + (on ? " active" : " off");
          txtBtn.innerHTML = svgIcon("fileText", 12);
          txtBtn.title = on ? "Prompt: Active (Click to mute text)" : "Prompt: Muted (Click to activate text)";
          txtBtn.onclick = (e) => {
            e.stopPropagation();
            item.enablePrompt = !on;
            persist();
            onToggle();
          };
          wrap.appendChild(txtBtn);
        }

        return wrap;
      }

      // --- Form Modal (Subject Card Editor) ---
      let itemSlotDragSrc = null;

      async function openForm(item, bustCacheOnOpen = false) {
        stopAllFormMedia();
        sectionToolbarEl.style.display = "none";
        listEl.style.display = "none";
        formEl.style.display = "flex";
        formEl.className = "sm-form";
        formEl.innerHTML = "<div style='color:#888; padding:8px;'>Checking media files...</div>";

        let promptInput = null;
        let promptBackdrop = null;
        let editorWrap = null;

        const isNew = item ? (item._isNew !== undefined ? item._isNew : false) : true;
        const targetId = item ? item.id : uid();
        const defaultName = isNew ? (item && item.name ? item.name : getNextSubjectName(node.smData.categories)) : (item ? item.name : "");
        const curType = (item && item.subjectType) || "character";
        const currentConfig = COMBINATORIAL_CONFIG[curType] || COMBINATORIAL_CONFIG.character;

        const initialImgs = item && Array.isArray(item.images) ? item.images.filter(Boolean).slice(0, 4) : [];
        const initialStates = item && Array.isArray(item.imageStates) ? item.imageStates.slice(0, initialImgs.length) : [];
        while (initialStates.length < initialImgs.length) initialStates.push(true);

        const initialTags = item && Array.isArray(item.imageTags) ? item.imageTags.slice(0, initialImgs.length) : [];
        while (initialTags.length < initialImgs.length) {
          initialTags.push([...(currentConfig.imageDefaultPreset[initialTags.length] || currentConfig.imageDefaultPreset[0])]);
        }

        const currentData = {
          id: targetId,
          _isNew: isNew,
          name: item && item.name !== undefined ? item.name : defaultName,
          subjectType: curType,
          prompt: item && item.prompt !== undefined ? item.prompt : "",
          enablePrompt: item && item.enablePrompt === false ? false : true,
          images: initialImgs,
          imageStates: initialStates,
          imageTags: initialTags,
          enableImages: item && item.enableImages === false ? false : true,
          audio: item && item.audio ? { ...item.audio } : null,
          audioTags: Array.isArray(item && item.audioTags) ? [...item.audioTags] : [...currentConfig.audioDefault],
          enableAudio: item && item.enableAudio === false ? false : true,
          video: item && item.video ? { ...item.video } : null,
          videoTags: Array.isArray(item && item.videoTags) ? [...item.videoTags] : [...currentConfig.videoDefault],
          enableVideo: item && item.enableVideo === false ? false : true,
          selected: item ? !!item.selected : false,
          allowRandom: item ? item.allowRandom !== false : true,
          alwaysOn: item ? !!item.alwaysOn : false,
        };

        const allFilesToCheck = [
          ...(currentData.images || []),
          currentData.audio ? currentData.audio.file : null,
          currentData.video ? currentData.video.file : null,
        ].filter(Boolean);

        const checkRes = await checkMediaPresence(allFilesToCheck);
        const filePresence = checkRes.results || {};

        formEl.innerHTML = "";

        if (isNew && !currentData.prompt) {
          currentData.prompt = generatePromptTemplate(currentData.subjectType, currentData);
        }

        // --- 1. LIGNE SUPÉRIEURE FIXE : [Type Icons] [Champ Nom] [Cancel] [Save] ---
        const topRow = document.createElement("div");
        topRow.className = "sm-form-top-row";

        const topTypeGroup = document.createElement("div");
        topTypeGroup.className = "sm-type-group";

        const charBtn = mkBtn(
          "user",
          currentData.subjectType === "character" ? "type-active" : "",
          "Character (Set subject type)",
          () => setCategory("character")
        );

        const objBtn = mkBtn(
          "box",
          currentData.subjectType === "object" ? "type-active" : "",
          "Object (Set subject type)",
          () => setCategory("object")
        );

        const sceneBtn = mkBtn(
          "mountain",
          currentData.subjectType === "scene" ? "type-active" : "",
          "Scene (Set subject type)",
          () => setCategory("scene")
        );

        topTypeGroup.appendChild(charBtn);
        topTypeGroup.appendChild(objBtn);
        topTypeGroup.appendChild(sceneBtn);
        topRow.appendChild(topTypeGroup);

        const nameInput = document.createElement("input");
        nameInput.type = "text";
        nameInput.placeholder = "Subject Name";
        nameInput.value = currentData.name;
        nameInput.style.flex = "1";
        nameInput.oninput = () => {
          currentData.name = nameInput.value;
        };
        topRow.appendChild(nameInput);

        const topActions = document.createElement("div");
        topActions.className = "sm-form-actions";

        const cancelBtn = mkBtn("close", "", "Cancel", closeForm);

        function syncCurrentInputs() {
          if (nameInput) currentData.name = nameInput.value;
          if (promptInput) currentData.prompt = promptInput.value;
        }

        function updatePromptFromRoles() {
          syncCurrentInputs();
          currentData.prompt = generatePromptTemplate(currentData.subjectType, currentData);
          if (promptInput) {
            promptInput.value = currentData.prompt;
            if (promptBackdrop) {
              promptBackdrop.innerHTML = highlightPromptText(currentData.prompt);
            }
          }
        }

        const saveBtn = mkBtn(isNew ? "plus" : "check", "primary", isNew ? "Add" : "Save", () => {
          stopAllFormMedia();
          syncCurrentInputs();
          currentData.name = currentData.name.trim() || defaultName;
          currentData.prompt = currentData.prompt.trim();

          const toSave = { ...currentData };
          delete toSave._isNew;

          if (isNew) {
            activeItems().push(toSave);
          } else {
            const idx = activeItems().findIndex((it) => it.id === targetId);
            if (idx !== -1) activeItems()[idx] = toSave;
            else activeItems().push(toSave);
          }
          persist();
          closeForm();
          renderAll();
        });

        topActions.appendChild(cancelBtn);
        topActions.appendChild(saveBtn);
        topRow.appendChild(topActions);
        formEl.appendChild(topRow);

        // --- CORPS DÉFILABLE (Reçoit tout le contenu sous la barre fixe) ---
        const formBodyEl = document.createElement("div");
        formBodyEl.className = "sm-form-body";

        // Clic n'importe où dans le corps = ferme la barre de tags
        formBodyEl.onclick = (e) => {
          if (activeOverlaySlotIndex !== null) {
            if (!e.target.closest(".sm-img-tags-bar") && !e.target.closest(".sm-slot-btn-tag-trigger")) {
              activeOverlaySlotIndex = null;
              renderImageSlots();
            }
          }
        };

        function setCategory(type) {
          currentData.subjectType = type;
          charBtn.classList.toggle("type-active", type === "character");
          objBtn.classList.toggle("type-active", type === "object");
          sceneBtn.classList.toggle("type-active", type === "scene");

          syncCurrentInputs();
          const newConfig = COMBINATORIAL_CONFIG[type] || COMBINATORIAL_CONFIG.character;
          currentData.imageTags = (currentData.images || []).map((_, idx) => [...(newConfig.imageDefaultPreset[idx] || newConfig.imageDefaultPreset[0])]);
          currentData.audioTags = [...newConfig.audioDefault];
          currentData.videoTags = [...newConfig.videoDefault];

          updatePromptFromRoles();
          renderImageSlots();
          renderAVBoxes();
        }

        // --- GESTIONNAIRE DE DRAG & DROP MULTI-FICHIERS SÉCURISÉ ---
        async function processDroppedFiles(files, targetSlotIndex = null) {
          if (!files || !files.length) return;
          const conf = COMBINATORIAL_CONFIG[currentData.subjectType] || COMBINATORIAL_CONFIG.character;

          const imageFiles = [];
          const audioFiles = [];
          const videoFiles = [];

          for (const f of files) {
            const ext = f.name.split('.').pop().toLowerCase();
            if (f.type.startsWith("image/") || ["jpg", "jpeg", "png", "webp", "bmp"].includes(ext)) {
              imageFiles.push(f);
            } else if (f.type.startsWith("audio/") || ["mp3", "wav", "flac", "aac", "ogg", "m4a"].includes(ext)) {
              audioFiles.push(f);
            } else if (f.type.startsWith("video/") || ["mp4", "webm", "mkv", "mov", "avi"].includes(ext)) {
              videoFiles.push(f);
            }
          }

          async function getFilePath(file) {
            if (file.path) return file.path;
            const upRes = await uploadMediaFile(file);
            return upRes.path || upRes.filename;
          }

          try {
            if (imageFiles.length > 0) {
              if (targetSlotIndex !== null && targetSlotIndex < 4) {
                const pathOrName = await getFilePath(imageFiles[0]);
                if (targetSlotIndex < currentData.images.length) {
                  currentData.images[targetSlotIndex] = pathOrName;
                  currentData.imageStates[targetSlotIndex] = true;
                } else {
                  currentData.images.push(pathOrName);
                  currentData.imageStates.push(true);
                  currentData.imageTags.push([...(conf.imageDefaultPreset[currentData.images.length - 1] || conf.imageDefaultPreset[0])]);
                }
                filePresence[pathOrName] = { exists: true, path: pathOrName };
              } else {
                for (const f of imageFiles) {
                  if (currentData.images.length >= 4) break;
                  const pathOrName = await getFilePath(f);
                  currentData.images.push(pathOrName);
                  currentData.imageStates.push(true);
                  currentData.imageTags.push([...(conf.imageDefaultPreset[currentData.images.length - 1] || conf.imageDefaultPreset[0])]);
                  filePresence[pathOrName] = { exists: true, path: pathOrName };
                }
              }
            }

            if (audioFiles.length > 0) {
              const pathOrName = await getFilePath(audioFiles[0]);
              currentData.audio = { file: pathOrName, trimStart: 0, trimEnd: 0 };
              currentData.audioTags = [...conf.audioDefault];
              currentData.enableAudio = true;
              filePresence[pathOrName] = { exists: true, path: pathOrName };
            }

            if (videoFiles.length > 0) {
              const pathOrName = await getFilePath(videoFiles[0]);
              currentData.video = { file: pathOrName, trimStart: 0, trimEnd: 0 };
              currentData.videoTags = [...conf.videoDefault];
              currentData.enableVideo = true;
              filePresence[pathOrName] = { exists: true, path: pathOrName };
            }
          } catch (err) {
            console.error("Drop processing error:", err);
            alert("Failed to load dropped file: " + err.message);
          }

          updatePromptFromRoles();
          renderImageSlots(true);
          renderAVBoxes();
        }

        let formDragCounter = 0;
        function clearAllDragStyles() {
          formDragCounter = 0;
          if (formEl) formEl.classList.remove("sm-form-drag-over");
          if (formEl) {
            formEl.querySelectorAll(".slot-drag-over").forEach((el) => el.classList.remove("slot-drag-over"));
          }
        }

        formEl.ondragenter = (e) => {
          if (itemSlotDragSrc !== null) return;
          e.preventDefault();
          formDragCounter++;
          formEl.classList.add("sm-form-drag-over");
        };

        formEl.ondragover = (e) => {
          if (itemSlotDragSrc !== null) return;
          e.preventDefault();
          e.dataTransfer.dropEffect = "copy";
          if (!formEl.classList.contains("sm-form-drag-over")) {
            formEl.classList.add("sm-form-drag-over");
          }
        };

        formEl.ondragleave = (e) => {
          if (itemSlotDragSrc !== null) return;
          e.preventDefault();
          formDragCounter--;
          if (formDragCounter <= 0 || !formEl.contains(e.relatedTarget)) {
            clearAllDragStyles();
          }
        };

        formEl.ondrop = async (e) => {
          if (itemSlotDragSrc !== null) return;
          e.preventDefault();
          clearAllDragStyles();
          const files = e.dataTransfer && e.dataTransfer.files;
          if (files && files.length) {
            try {
              await processDroppedFiles(files);
            } finally {
              clearAllDragStyles();
            }
          }
        };

        // --- SECTION IMAGES avec Barre Pleine Largeur sous les 4 images ---
        const imgSectionWrap = document.createElement("div");
        imgSectionWrap.className = "sm-form-img-section";

        const imgSlotsGrid = document.createElement("div");
        imgSlotsGrid.className = "sm-form-medias";

        const imgTagsBar = document.createElement("div");
        imgTagsBar.className = "sm-img-tags-bar";
        imgTagsBar.style.display = "none";

        imgSectionWrap.appendChild(imgSlotsGrid);
        imgSectionWrap.appendChild(imgTagsBar);

        let activeOverlaySlotIndex = null;

        function renderImageSlots(forceBust = false) {
          imgSlotsGrid.innerHTML = "";
          const curCount = currentData.images.length;
          const conf = COMBINATORIAL_CONFIG[currentData.subjectType] || COMBINATORIAL_CONFIG.character;

          for (let i = 0; i < 4; i++) {
            const col = document.createElement("div");
            col.className = "sm-form-slot-col";

            const slot = document.createElement("div");
            slot.className = "sm-form-img-slot";

            if (i < curCount) {
              const filename = currentData.images[i];
              const isSlotOn = currentData.imageStates[i] !== false;
              const slotTags = currentData.imageTags[i] || [];
              const fileInfo = filePresence[filename] || {};
              const isMissing = fileInfo.exists === false;
              const absPath = fileInfo.path || filename;

              slot.className = "sm-form-img-slot has-image";

              slot.draggable = true;
              slot.title = `Slot ${i + 1} (Drag to reorder)\nPath: ${absPath}`;

              slot.ondragstart = (e) => {
                itemSlotDragSrc = i;
                e.dataTransfer.effectAllowed = "move";
                e.dataTransfer.setData("text/plain", `${i}`);
                e.stopPropagation();
              };

              slot.ondragover = (e) => {
                e.preventDefault();
                e.stopPropagation();
                e.dataTransfer.dropEffect = "move";
                slot.classList.add("slot-drag-over");
              };

              slot.ondragleave = (e) => {
                e.stopPropagation();
                slot.classList.remove("slot-drag-over");
              };

              slot.ondrop = (e) => {
                e.preventDefault();
                e.stopPropagation();
                slot.classList.remove("slot-drag-over");

                if (e.dataTransfer.files && e.dataTransfer.files.length) {
                  processDroppedFiles(e.dataTransfer.files, i);
                  return;
                }

                if (itemSlotDragSrc === null || itemSlotDragSrc === i || itemSlotDragSrc >= curCount) {
                  itemSlotDragSrc = null;
                  return;
                }
                
                const [movedImg] = currentData.images.splice(itemSlotDragSrc, 1);
                currentData.images.splice(i, 0, movedImg);
                const [movedState] = currentData.imageStates.splice(itemSlotDragSrc, 1);
                currentData.imageStates.splice(i, 0, movedState);
                const [movedTags] = currentData.imageTags.splice(itemSlotDragSrc, 1);
                currentData.imageTags.splice(i, 0, movedTags);
                
                itemSlotDragSrc = null;
                updatePromptFromRoles();
                renderImageSlots();
              };

              if (isMissing) {
                slot.classList.add("slot-missing");
                const missBox = document.createElement("div");
                missBox.className = "sm-missing-content";
                missBox.innerHTML = `<span style="color:#ff4444; font-size:22px; font-weight:bold;">✕</span><span class="sm-missing-badge">MISSING</span>`;
                slot.appendChild(missBox);

                slot.onclick = async () => {
                  syncCurrentInputs();
                  const chosenPath = await pickLocalMediaFile("image");
                  if (chosenPath) {
                    currentData.images[i] = chosenPath;
                    currentData.imageStates[i] = true;
                    filePresence[chosenPath] = { exists: true, path: chosenPath };
                    updatePromptFromRoles();
                    renderImageSlots(true);
                  }
                };
              } else {
                const img = document.createElement("img");
                img.src = getThumbnailUrl(filename, forceBust || bustCacheOnOpen);
                if (!isSlotOn) img.classList.add("slot-off");
                slot.appendChild(img);

                const eyeBtn = document.createElement("button");
                eyeBtn.className = "sm-slot-btn-eye" + (isSlotOn ? "" : " off");
                eyeBtn.innerHTML = svgIcon(isSlotOn ? "eye" : "eyeOff", 12);
                eyeBtn.title = isSlotOn ? "Mute" : "Activate";
                eyeBtn.onclick = (e) => {
                  e.stopPropagation();
                  currentData.imageStates[i] = !isSlotOn;
                  renderImageSlots();
                };
                slot.appendChild(eyeBtn);

                const tagTrigger = document.createElement("button");
                const isTagActive = activeOverlaySlotIndex === i;
                tagTrigger.className = "sm-slot-btn-tag-trigger" + (isTagActive ? " active" : "");
                tagTrigger.innerHTML = svgIcon("tag", 16) + " Tags";
                tagTrigger.onclick = (e) => {
                  e.stopPropagation();
                  activeOverlaySlotIndex = (activeOverlaySlotIndex === i) ? null : i;
                  renderImageSlots();
                };
                slot.appendChild(tagTrigger);

                const tagCountBadge = document.createElement("span");
                tagCountBadge.className = "sm-slot-tag-count";
                tagCountBadge.textContent = `${slotTags.length} tags`;
                slot.appendChild(tagCountBadge);
              }

              const rm = document.createElement("button");
              rm.className = "sm-slot-btn-rm";
              rm.innerHTML = svgIcon("close", 12);
              rm.onclick = (e) => {
                e.stopPropagation();
                currentData.images.splice(i, 1);
                currentData.imageStates.splice(i, 1);
                currentData.imageTags.splice(i, 1);
                if (activeOverlaySlotIndex === i) activeOverlaySlotIndex = null;
                updatePromptFromRoles();
                renderImageSlots();
              };
              slot.appendChild(rm);

              col.appendChild(slot);

            } else if (i === curCount) {
              slot.innerHTML = `<span style="color:#666;">${svgIcon("plus", 18)}</span>`;
              slot.title = `Add Image for slot ${i + 1}`;
              slot.onclick = async () => {
                syncCurrentInputs();
                const chosenPath = await pickLocalMediaFile("image");
                if (chosenPath) {
                  currentData.images.push(chosenPath);
                  currentData.imageStates.push(true);
                  currentData.imageTags.push([...(conf.imageDefaultPreset[curCount] || conf.imageDefaultPreset[0])]);
                  filePresence[chosenPath] = { exists: true, path: chosenPath };
                  updatePromptFromRoles();
                  renderImageSlots(true);
                }
              };
              col.appendChild(slot);
            } else {
              slot.innerHTML = `<span style="color:#333; font-size:10px;">${i + 1}</span>`;
              slot.style.opacity = "0.25";
              slot.style.cursor = "not-allowed";
              col.appendChild(slot);
            }

            imgSlotsGrid.appendChild(col);
          }

          // --- RENDU DE LA BARRE PLEINE LARGEUR DES TAGS ---
          if (activeOverlaySlotIndex !== null && activeOverlaySlotIndex < curCount) {
            imgTagsBar.style.display = "flex";
            imgTagsBar.innerHTML = "";

            const head = document.createElement("div");
            head.className = "sm-img-tags-bar-head";
            head.innerHTML = `<span><b style="color:var(--sm-green-text-bright);">Image ${activeOverlaySlotIndex + 1}</b> Presets / Tags :</span>`;

            const closeBtn = document.createElement("button");
            closeBtn.className = "sm-icon-btn";
            closeBtn.innerHTML = svgIcon("close", 12);
            closeBtn.title = "Close tags panel";
            closeBtn.onclick = (e) => {
              e.stopPropagation();
              activeOverlaySlotIndex = null;
              renderImageSlots();
            };
            head.appendChild(closeBtn);
            imgTagsBar.appendChild(head);

            const chipsRow = document.createElement("div");
            chipsRow.className = "sm-img-tags-bar-chips";

            const slotTags = currentData.imageTags[activeOverlaySlotIndex] || [];

            conf.imageTags.forEach((tagOpt) => {
              const chip = document.createElement("button");
              const isActive = slotTags.includes(tagOpt.id);
              chip.className = "sm-chip-btn" + (isActive ? " active" : "");
              chip.textContent = tagOpt.label;

              const phrase = tagOpt.desc || tagOpt.label;
              chip.title = `<Picture ${activeOverlaySlotIndex + 1}> defines <Subject 1>'s ${phrase}.`;

              chip.onclick = (e) => {
                e.stopPropagation();
                if (slotTags.includes(tagOpt.id)) {
                  const tIdx = slotTags.indexOf(tagOpt.id);
                  slotTags.splice(tIdx, 1);
                } else {
                  slotTags.push(tagOpt.id);
                }
                chip.classList.toggle("active", slotTags.includes(tagOpt.id));
                updatePromptFromRoles();
                renderImageSlots();
              };
              chipsRow.appendChild(chip);
            });

            imgTagsBar.appendChild(chipsRow);
          } else {
            imgTagsBar.style.display = "none";
            imgTagsBar.innerHTML = "";
          }
        }

        renderImageSlots(bustCacheOnOpen);
        formBodyEl.appendChild(imgSectionWrap);

        // --- 3 & 4. SECTIONS AUDIO & VIDÉO AUTO-ADAPTATIVES ---
        const avContainer = document.createElement("div");
        avContainer.style.display = "flex";
        avContainer.style.flexDirection = "column";
        avContainer.style.gap = "3px";
        avContainer.style.width = "100%";

        function renderAVBoxes() {
          avContainer.innerHTML = "";
          const hasAud = !!(currentData.audio && currentData.audio.file);
          const hasVid = !!(currentData.video && currentData.video.file);
          const conf = COMBINATORIAL_CONFIG[currentData.subjectType] || COMBINATORIAL_CONFIG.character;

          if (!hasAud && !hasVid) {
            const emptyRow = document.createElement("div");
            emptyRow.style.display = "flex";
            emptyRow.style.gap = "4px";
            emptyRow.style.width = "100%";

            const upAud = mkBtn("music", "", "Add Audio", async () => {
              syncCurrentInputs();
              const chosenPath = await pickLocalMediaFile("audio");
              if (chosenPath) {
                currentData.audio = { file: chosenPath, trimStart: 0, trimEnd: 0 };
                currentData.audioTags = [...conf.audioDefault];
                currentData.enableAudio = true;
                filePresence[chosenPath] = { exists: true, path: chosenPath };
                updatePromptFromRoles();
                renderAVBoxes();
              }
            });
            upAud.style.flex = "1";

            const upVid = mkBtn("video", "", "Add Video", async () => {
              syncCurrentInputs();
              const chosenPath = await pickLocalMediaFile("video");
              if (chosenPath) {
                currentData.video = { file: chosenPath, trimStart: 0, trimEnd: 0 };
                currentData.videoTags = [...conf.videoDefault];
                currentData.enableVideo = true;
                filePresence[chosenPath] = { exists: true, path: chosenPath };
                updatePromptFromRoles();
                renderAVBoxes();
              }
            });
            upVid.style.flex = "1";

            emptyRow.appendChild(upAud);
            emptyRow.appendChild(upVid);
            avContainer.appendChild(emptyRow);
            return;
          }

          if (hasAud) {
            const aFile = currentData.audio.file;
            const aInfo = filePresence[aFile] || {};
            const isMissing = aInfo.exists === false;
            const absPath = aInfo.path || aFile;

            const trimmer = createTrimmerComponent(
              "Audio Ref",
              "audio",
              currentData.audio,
              currentData.audioTags,
              conf.audioTags,
              (newTags) => {
                currentData.audioTags = newTags;
                updatePromptFromRoles();
              },
              currentData.enableAudio !== false,
              isMissing,
              absPath,
              () => {
                currentData.enableAudio = currentData.enableAudio === false ? true : false;
                renderAVBoxes();
              },
              () => {
                currentData.audio = null;
                updatePromptFromRoles();
                renderAVBoxes();
              }
            );

            if (isMissing) {
              trimmer.style.cursor = "pointer";
              trimmer.onclick = async () => {
                syncCurrentInputs();
                const chosenPath = await pickLocalMediaFile("audio");
                if (chosenPath) {
                  currentData.audio.file = chosenPath;
                  filePresence[chosenPath] = { exists: true, path: chosenPath };
                  renderAVBoxes();
                }
              };
            }
            avContainer.appendChild(trimmer);
          } else {
            const upAud = mkBtn("music", "", "Add Audio Reference", async () => {
              syncCurrentInputs();
              const chosenPath = await pickLocalMediaFile("audio");
              if (chosenPath) {
                currentData.audio = { file: chosenPath, trimStart: 0, trimEnd: 0 };
                currentData.audioTags = [...conf.audioDefault];
                currentData.enableAudio = true;
                filePresence[chosenPath] = { exists: true, path: chosenPath };
                updatePromptFromRoles();
                renderAVBoxes();
              }
            });
            upAud.style.height = "22px";
            avContainer.appendChild(upAud);
          }

          if (hasVid) {
            const vFile = currentData.video.file;
            const vInfo = filePresence[vFile] || {};
            const isMissing = vInfo.exists === false;
            const absPath = vInfo.path || vFile;

            const trimmer = createTrimmerComponent(
              "Video Ref",
              "video",
              currentData.video,
              currentData.videoTags,
              conf.videoTags,
              (newTags) => {
                currentData.videoTags = newTags;
                updatePromptFromRoles();
              },
              currentData.enableVideo !== false,
              isMissing,
              absPath,
              () => {
                currentData.enableVideo = currentData.enableVideo === false ? true : false;
                renderAVBoxes();
              },
              () => {
                currentData.video = null;
                updatePromptFromRoles();
                renderAVBoxes();
              }
            );

            if (isMissing) {
              trimmer.style.cursor = "pointer";
              trimmer.onclick = async () => {
                syncCurrentInputs();
                const chosenPath = await pickLocalMediaFile("video");
                if (chosenPath) {
                  currentData.video.file = chosenPath;
                  filePresence[chosenPath] = { exists: true, path: chosenPath };
                  renderAVBoxes();
                }
              };
            }
            avContainer.appendChild(trimmer);
          } else {
            const upVid = mkBtn("video", "", "Add Video Reference", async () => {
              syncCurrentInputs();
              const chosenPath = await pickLocalMediaFile("video");
              if (chosenPath) {
                currentData.video = { file: chosenPath, trimStart: 0, trimEnd: 0 };
                currentData.videoTags = [...conf.videoDefault];
                currentData.enableVideo = true;
                filePresence[chosenPath] = { exists: true, path: chosenPath };
                updatePromptFromRoles();
                renderAVBoxes();
              }
            });
            upVid.style.height = "22px";
            avContainer.appendChild(upVid);
          }
        }

        renderAVBoxes();
        formBodyEl.appendChild(avContainer);

        // --- 5. EN-TÊTE PROMPT ---
        const promptHeader = document.createElement("div");
        promptHeader.className = "sm-prompt-header";

        const leftPromptHead = document.createElement("div");
        leftPromptHead.style.display = "flex";
        leftPromptHead.style.alignItems = "center";
        leftPromptHead.style.gap = "4px";

        let isTxtOn = currentData.enablePrompt !== false;
        const togglePromptBtn = document.createElement("button");
        togglePromptBtn.className = "sm-icon-btn";
        togglePromptBtn.innerHTML = svgIcon(isTxtOn ? "eye" : "eyeOff", 13);
        togglePromptBtn.style.color = isTxtOn ? "var(--sm-green-text-bright)" : "#777";
        togglePromptBtn.title = isTxtOn ? "Prompt active (click to mute text)" : "Prompt muted (click to activate text)";

        const lbl = document.createElement("span");
        lbl.textContent = "Subject Prompt:";
        lbl.style.color = isTxtOn ? "var(--sm-text-faint)" : "#777";

        togglePromptBtn.onclick = (e) => {
          e.preventDefault();
          isTxtOn = !isTxtOn;
          currentData.enablePrompt = isTxtOn;
          togglePromptBtn.innerHTML = svgIcon(isTxtOn ? "eye" : "eyeOff", 13);
          togglePromptBtn.style.color = isTxtOn ? "var(--sm-green-text-bright)" : "#777";
          togglePromptBtn.title = isTxtOn ? "Prompt active (click to mute text)" : "Prompt muted (click to activate text)";
          lbl.style.color = isTxtOn ? "var(--sm-text-faint)" : "#777";
          if (editorWrap) editorWrap.style.opacity = isTxtOn ? "1" : "0.45";
        };

        leftPromptHead.appendChild(togglePromptBtn);
        leftPromptHead.appendChild(lbl);
        promptHeader.appendChild(leftPromptHead);

        const rightPromptActions = document.createElement("div");
        rightPromptActions.className = "sm-form-actions";

        const copyPromptBtn = mkBtn("copy", "", "Copy prompt text", async () => {
          try { await navigator.clipboard.writeText(promptInput.value); flashButton(copyPromptBtn); } catch (e) {}
        });

        const pastePromptBtn = mkBtn("paste", "", "Paste prompt text", async () => {
          try { 
            const txt = await navigator.clipboard.readText();
            promptInput.value = txt;
            currentData.prompt = txt;
            if (promptBackdrop) promptBackdrop.innerHTML = highlightPromptText(txt);
            flashButton(pastePromptBtn); 
          } catch (e) {}
        });

        const clearPromptBtn = mkBtn("backspace", "", "Clear prompt text", () => {
          promptInput.value = "";
          currentData.prompt = "";
          if (promptBackdrop) promptBackdrop.innerHTML = "";
          promptInput.focus();
        });

        const pSep = document.createElement("div");
        pSep.className = "sm-sep";

        const genFromRolesBtn = mkBtn(
          "wand",
          "btn-tint-purple",
          "Generate / Reset prompt text based on selected tags",
          () => {
            updatePromptFromRoles();
            flashButton(genFromRolesBtn);
          }
        );

        rightPromptActions.appendChild(copyPromptBtn);
        rightPromptActions.appendChild(pastePromptBtn);
        rightPromptActions.appendChild(clearPromptBtn);
        rightPromptActions.appendChild(pSep);
        rightPromptActions.appendChild(genFromRolesBtn);

        promptHeader.appendChild(leftPromptHead);
        promptHeader.appendChild(rightPromptActions);
        formBodyEl.appendChild(promptHeader);

        // --- 6. ÉDITEUR PROMPT COLORÉ ---
        editorWrap = document.createElement("div");
        editorWrap.className = "sm-prompt-editor-wrap";
        if (!isTxtOn) editorWrap.style.opacity = "0.45";

        promptBackdrop = document.createElement("div");
        promptBackdrop.className = "sm-prompt-backdrop";
        promptBackdrop.innerHTML = highlightPromptText(currentData.prompt || "");

        promptInput = document.createElement("textarea");
        promptInput.className = "sm-prompt-input";
        promptInput.placeholder = "Prompt text...";
        promptInput.value = currentData.prompt || "";
        promptInput.spellcheck = false;

        function syncEditor() {
          currentData.prompt = promptInput.value;
          if (promptBackdrop) {
            promptBackdrop.innerHTML = highlightPromptText(promptInput.value);
          }
        }

        promptInput.oninput = syncEditor;
        promptInput.onscroll = () => {
          if (promptBackdrop) {
            promptBackdrop.scrollTop = promptInput.scrollTop;
            promptBackdrop.scrollLeft = promptInput.scrollLeft;
          }
        };

        editorWrap.appendChild(promptBackdrop);
        editorWrap.appendChild(promptInput);
        formBodyEl.appendChild(editorWrap);
        formEl.appendChild(formBodyEl);
      }

      function closeForm() {
        stopAllFormMedia();
        formEl.style.display = "none";
        formEl.innerHTML = "";
        sectionToolbarEl.style.display = "";
        listEl.style.display = "";
      }

      // --- Cards & Tiles Rendering ---
      let itemDragSrc = null;

      function soloSelect(item) {
        const sec = activeSection();
        if (sec && sec.randomizeOnQueue) sec.randomizeOnQueue = false;

        activeItems().forEach((it) => (it.selected = it.id === item.id));
        state.openTileMenuId = null;
        persist(); 
        renderAll();
      }

      function toggleSelect(item) {
        const sec = activeSection();
        if (sec && sec.randomizeOnQueue) sec.randomizeOnQueue = false;

        item.selected = !item.selected;
        state.openTileMenuId = null;
        persist(); 
        renderAll();
      }

      function attachDragReorder(el, index) {
        el.draggable = true;
        el.addEventListener("dragstart", (e) => { 
          itemDragSrc = index; 
          e.dataTransfer.effectAllowed = "move";
          e.dataTransfer.setData("text/plain", `${index}`);
          e.stopPropagation(); 
        });

        el.addEventListener("dragover", (e) => { 
          // Si ce n'est PAS un déplacement de carte interne, on laisse passer pour le drag global de fichiers !
          if (itemDragSrc === null) return;
          e.preventDefault(); 
          e.stopPropagation();
          el.classList.add("drag-over"); 
        });

        el.addEventListener("dragleave", (e) => {
          if (itemDragSrc === null) return;
          e.stopPropagation();
          el.classList.remove("drag-over");
        });

        el.addEventListener("drop", (e) => {
          // Si ce n'est PAS un déplacement interne, on laisse le drop monter à root pour créer le sujet
          if (itemDragSrc === null) return;

          e.preventDefault();
          e.stopPropagation();
          el.classList.remove("drag-over");

          if (itemDragSrc === index) {
            itemDragSrc = null;
            return;
          }

          const arr = activeItems();
          const [moved] = arr.splice(itemDragSrc, 1);
          arr.splice(index, 0, moved);
          itemDragSrc = null;
          persist(); 
          renderList(); 
          updatePreview();
        });
      }

      function makeAlwaysOnButton(item, cls) {
        const b = document.createElement("button");
        b.className = cls + (item.alwaysOn ? " sm-star-on" : "");
        b.innerHTML = svgIcon("star", 13);
        b.title = item.alwaysOn ? "Always-On: Enabled" : "Always-On: Disabled";
        b.addEventListener("click", (e) => {
          e.stopPropagation();
          item.alwaysOn = !item.alwaysOn;
          persist(); renderAll();
        });
        return b;
      }

      function buildEditButtons(item, onBeforeAction) {
        const editBtn = document.createElement("button");
        editBtn.className = "sm-icon-btn";
        editBtn.innerHTML = svgIcon("edit", 15);
        editBtn.title = "Edit subject";
        editBtn.onclick = (e) => { e.stopPropagation(); if (onBeforeAction) onBeforeAction(); openForm(item); };

        const randBtn = document.createElement("button");
        randBtn.className = "sm-icon-btn";
        randBtn.innerHTML = svgIcon(item.allowRandom === false ? "diceOff" : "dice", 15);
        randBtn.title = item.allowRandom === false ? "Excluded from Randomize" : "Included in Randomize";
        randBtn.onclick = (e) => {
          e.stopPropagation();
          if (onBeforeAction) onBeforeAction();
          item.allowRandom = item.allowRandom === false ? true : false;
          persist(); renderList(); updatePreview();
        };

        const delBtn = document.createElement("button");
        delBtn.className = "sm-icon-btn sm-icon-danger";
        delBtn.innerHTML = svgIcon("trash", 15);
        delBtn.title = "Delete";
        delBtn.onclick = (e) => {
          e.stopPropagation();
          if (onBeforeAction) onBeforeAction();
          node.smData.categories[state.activeTab] = activeItems().filter((it) => it.id !== item.id);
          persist(); renderAll();
        };

        return [editBtn, randBtn, delBtn];
      }

      function renderListModeCard(item, index, mappingInfo) {
        const card = document.createElement("div");
        card.className = "sm-card" + (item.selected ? " selected" : "") + (item.alwaysOn ? " sm-always-on" : "");
        attachDragReorder(card, index);

        const alwaysBtn = makeAlwaysOnButton(item, "sm-icon-btn sm-card-solo");
        card.appendChild(alwaysBtn);

        const thumbWrap = document.createElement("div");
        thumbWrap.className = "sm-thumb-wrap";
        thumbWrap.appendChild(createMediaMosaic(item));
        card.appendChild(thumbWrap);

        const body = document.createElement("div");
        body.className = "sm-card-body";
        body.title = mappingInfo
          ? `[${mappingInfo.subjectTag}] Outputs: ${mappingInfo.pinsSummary}\nClick text to solo select <${item.name || 'Subject'}>`
          : "Click text to solo select this subject";
        body.onclick = (e) => {
          e.stopPropagation();
          soloSelect(item);
        };

        const titleRow = document.createElement("div");
        titleRow.className = "sm-card-title-row";

        if (mappingInfo) {
          const idxBadge = document.createElement("span");
          idxBadge.className = "sm-tile-idx-badge";
          idxBadge.style.background = mappingInfo.secColor;
          idxBadge.textContent = mappingInfo.subjectTag;
          idxBadge.title = `${mappingInfo.fullTag} (${item.name || 'Subject'})\nOutputs: ${mappingInfo.pinsSummary}`;
          titleRow.appendChild(idxBadge);
        }

        const typeIcon = item.subjectType === "object" ? "box" : (item.subjectType === "scene" ? "mountain" : "user");
        const typeIconEl = document.createElement("span");
        typeIconEl.style.color = "#aaa";
        typeIconEl.style.display = "inline-flex";
        typeIconEl.innerHTML = svgIcon(typeIcon, 12);
        typeIconEl.title = `Type: ${item.subjectType}`;
        titleRow.appendChild(typeIconEl);

        const nameEl = document.createElement("span");
        nameEl.className = "sm-card-name";
        nameEl.textContent = item.name || "(Unnamed Subject)";
        titleRow.appendChild(nameEl);
        body.appendChild(titleRow);

        const promptEl = document.createElement("div");
        promptEl.className = "sm-card-prompt";
        promptEl.textContent = item.prompt || "";
        if (item.enablePrompt === false) {
          promptEl.style.opacity = "0.35";
        }
        body.appendChild(promptEl);
        card.appendChild(body);

        const actWrap = document.createElement("div");
        actWrap.className = "sm-card-actions";

        const togglesBar = createAssetToggles(item, () => {
          renderList();
          updatePreview();
        });
        if (togglesBar) actWrap.appendChild(togglesBar);

        const sep = document.createElement("div");
        sep.className = "sm-sep";
        actWrap.appendChild(sep);

        const dupBtn = document.createElement("button");
        dupBtn.className = "sm-icon-btn";
        dupBtn.innerHTML = svgIcon("copy", 14);
        dupBtn.title = "Duplicate subject card";
        dupBtn.onclick = (e) => {
          e.stopPropagation();
          duplicateItem(item);
        };
        actWrap.appendChild(dupBtn);

        const [editBtn, randBtn, delBtn] = buildEditButtons(item, () => {});
        actWrap.appendChild(randBtn);
        actWrap.appendChild(editBtn);
        actWrap.appendChild(delBtn);

        card.appendChild(actWrap);
        card.addEventListener("click", () => toggleSelect(item));
        return card;
      }

      function renderGridModeTile(item, index, mappingInfo) {
        const tile = document.createElement("div");
        tile.className = "sm-tile" +
          (item.selected ? " selected" : "") +
          (item.alwaysOn ? " sm-always-on" : "") +
          (state.openTileMenuId === item.id ? " menu-open" : "");
        attachDragReorder(tile, index);

        tile.addEventListener("mouseleave", () => {
          if (state.openTileMenuId === item.id) {
            state.openTileMenuId = null;
            renderList();
          }
        });

        const mediaWrap = createMediaMosaic(item);

        const topBadges = document.createElement("div");
        topBadges.className = "sm-tile-top-badges";
        topBadges.style.cssText = "position:absolute; top:0; right:0; z-index:6; display:flex; flex-direction:row; align-items:stretch; pointer-events:none; border-left:1px solid #333; border-bottom:1px solid #333;";

        if (mappingInfo) {
          const idxBadge = document.createElement("span");
          idxBadge.className = "sm-tile-idx-badge";
          idxBadge.style.cssText = `position:static; display:inline-flex; align-items:center; justify-content:center; padding:2px 5px; font-size:9px; font-weight:bold; color:#fff; background:${mappingInfo.secColor}; border-right:1px solid rgba(0,0,0,0.5); line-height:1; letter-spacing:-0.3px; border-radius:0;`;
          idxBadge.textContent = mappingInfo.subjectTag;
          idxBadge.title = `${mappingInfo.fullTag} (${item.name || 'Subject'})\nOutputs: ${mappingInfo.pinsSummary}`;
          topBadges.appendChild(idxBadge);
        }

        const typeIcon = item.subjectType === "object" ? "box" : (item.subjectType === "scene" ? "mountain" : "user");
        const typeBadge = document.createElement("div");
        typeBadge.className = "sm-tile-type-badge";
        typeBadge.style.cssText = "position:static; display:inline-flex; align-items:center; justify-content:center; padding:2px 4px; background:rgba(16,16,16,0.92); color:#ccc; border:none; border-radius:0;";
        typeBadge.innerHTML = svgIcon(typeIcon, 11);
        typeBadge.title = `Subject Type: ${item.subjectType}`;
        topBadges.appendChild(typeBadge);
        mediaWrap.appendChild(topBadges);

        const assetToggles = createAssetToggles(item, () => {
          renderList();
          updatePreview();
        });
        if (assetToggles) mediaWrap.appendChild(assetToggles);

        const btnCol = document.createElement("div");
        btnCol.className = "sm-tile-btncol";

        const alwaysBtn = makeAlwaysOnButton(item, "");
        btnCol.appendChild(alwaysBtn);

        const [editBtn, randBtn, delBtn] = buildEditButtons(item, () => { state.openTileMenuId = null; });

        const menuBtn = document.createElement("button");
        menuBtn.innerHTML = svgIcon("more", 12);
        menuBtn.title = "More actions";
        menuBtn.onclick = (e) => {
          e.stopPropagation();
          state.openTileMenuId = state.openTileMenuId === item.id ? null : item.id;
          renderList();
        };
        btnCol.appendChild(menuBtn);

        editBtn.onclick = (e) => {
          e.stopPropagation();
          state.openTileMenuId = null;
          openForm(item);
        };
        btnCol.appendChild(editBtn);

        mediaWrap.appendChild(btnCol);

        if (state.openTileMenuId === item.id) {
          const overlay = document.createElement("div");
          overlay.className = "sm-tile-menu-overlay";
          overlay.onclick = (e) => {
            if (e.target === overlay) { state.openTileMenuId = null; renderList(); }
          };

          const dupBtn = document.createElement("button");
          dupBtn.className = "sm-tile-grid-icon";
          dupBtn.innerHTML = svgIcon("copy", 14);
          dupBtn.title = "Duplicate subject card";
          dupBtn.onclick = (e) => {
            e.stopPropagation();
            duplicateItem(item);
          };

          [dupBtn, randBtn, delBtn].forEach((b) => {
            b.classList.add("sm-tile-grid-icon");
            overlay.appendChild(b);
          });
          mediaWrap.appendChild(overlay);
        }

        tile.appendChild(mediaWrap);

        const nameEl = document.createElement("div");
        nameEl.className = "sm-tile-name";
        nameEl.title = mappingInfo
          ? `[${mappingInfo.subjectTag}] Outputs: ${mappingInfo.pinsSummary}\nClick text to solo select <${item.name || 'Subject'}>`
          : `Click text to solo select <${item.name || 'Subject'}>`;
        nameEl.onclick = (e) => {
          e.stopPropagation();
          soloSelect(item);
        };

        const targetIconSpan = document.createElement("span");
        targetIconSpan.className = "sm-solo-target-icon";
        targetIconSpan.innerHTML = svgIcon("target", 11);
        nameEl.appendChild(targetIconSpan);

        const nameTextEl = document.createElement("span");
        nameTextEl.className = "sm-tile-name-text";
        nameTextEl.textContent = item.name || "(Unnamed Subject)";
        nameEl.appendChild(nameTextEl);
        tile.appendChild(nameEl);

        mediaWrap.addEventListener("click", (e) => {
          if (e.target.closest("button")) return;
          toggleSelect(item);
        });

        return tile;
      }

      function renderList() {
        listEl.innerHTML = "";
        if (!state.activeTab) {
          const hint = document.createElement("div");
          hint.className = "sm-empty-hint";
          hint.textContent = "No sections. Click + above to create one.";
          listEl.appendChild(hint);
          return;
        }

        const gridMode = node.smData.viewMode === "grid";
        listEl.className = "sm-zone-list " + (gridMode ? "sm-mode-grid" : "sm-mode-list");

        const items = activeItems();
        if (items.length === 0) {
          const hint = document.createElement("div");
          hint.className = "sm-empty-hint";
          hint.textContent = 'No subject cards yet. Click "+ Add Subject Card" to add one.';
          listEl.appendChild(hint);
          return;
        }

        const mapping = computeActiveSubjectMapping(node.smData);

        items.forEach((item, index) => {
          const mappingInfo = mapping.get(item.id) || null;
          listEl.appendChild(gridMode ? renderGridModeTile(item, index, mappingInfo) : renderListModeCard(item, index, mappingInfo));
        });
      }

      function updatePreview() {
        const isNames = node.smData.previewMode === "names";
        previewModeBtn.innerHTML = svgIcon(isNames ? "tag" : "fileText", 13);
        previewModeBtn.title = isNames ? "Preview: Names & Output Pins — click for Full prompt" : "Preview: Full prompt — click for Names";

        previewTextEl.innerHTML = "";
        let any = false;
        let totalImg = 0, totalAud = 0, totalVid = 0, subjectIdx = 1;

        node.smData.sections.forEach((s) => {
          if (!s.enabled) return;
          const items = node.smData.categories[s.key] || [];
          const activeItems = items.filter((it) => it.alwaysOn || it.selected);
          if (!activeItems.length) return;

          const secColor = s.color && SECTION_COLORS[s.color] ? SECTION_COLORS[s.color] : "var(--sm-green-text-bright)";

          if (isNames) {
            any = true;
            const secBlock = document.createElement("div");
            secBlock.style.marginBottom = "4px";

            const labelSpan = document.createElement("span");
            labelSpan.textContent = `${s.label}: `;
            labelSpan.style.color = "var(--sm-text-faint)";
            labelSpan.style.fontWeight = "bold";
            secBlock.appendChild(labelSpan);

            activeItems.forEach((it, itIdx) => {
              const globalImgOn = it.enableImages !== false;
              const imgStates = it.imageStates || [];
              const activeImgs = (it.images || []).filter((src, idx) => src && globalImgOn && (imgStates[idx] === undefined || imgStates[idx] !== false));
              const validImgCount = activeImgs.length;
              const hasAud = (it.enableAudio !== false) && !!(it.audio && it.audio.file) && totalAud < 2;
              const hasVid = (it.enableVideo !== false) && !!(it.video && it.video.file) && totalVid < 2;

              let imgRange = "";
              if (validImgCount > 0 && totalImg < 8) {
                const start = totalImg + 1;
                const end = Math.min(8, totalImg + validImgCount);
                imgRange = start === end ? `img_${start}` : `img_${start}..${end}`;
              }
              const audTag = hasAud ? `aud_${totalAud + 1}` : "";
              const vidTag = hasVid ? `vid_${totalVid + 1}` : "";

              const pins = [imgRange, audTag, vidTag].filter(Boolean).join(",");

              const itemSpan = document.createElement("span");
              itemSpan.style.color = secColor;
              const sTag = `<Subject ${subjectIdx}>`;
              const nameStr = it.name ? ` (${it.name.trim()})` : "";
              itemSpan.textContent = `${sTag}${nameStr}${pins ? ` [${pins}]` : ""}${itIdx < activeItems.length - 1 ? ", " : ""}`;
              secBlock.appendChild(itemSpan);

              totalImg += validImgCount;
              if (hasAud) totalAud += 1;
              if (hasVid) totalVid += 1;
              subjectIdx += 1;
            });

            previewTextEl.appendChild(secBlock);
          } else {
            activeItems.forEach((it) => {
              const globalImgOn = it.enableImages !== false;
              const imgStates = it.imageStates || [];
              const activeImgs = (it.images || []).filter((src, idx) => src && globalImgOn && (imgStates[idx] === undefined || imgStates[idx] !== false));
              const validImgCount = activeImgs.length;
              const hasAud = (it.enableAudio !== false) && !!(it.audio && it.audio.file);
              const hasVid = (it.enableVideo !== false) && !!(it.video && it.video.file);
              const hasTxt = (it.enablePrompt !== false);

              let p = (it.prompt || "").trim();
              if (p && hasTxt) {
                const itemLines = p.split("\n");
                const adaptedLines = [];

                itemLines.forEach((l) => {
                  let str = l.trim();
                  if (!str) return;

                  let dropLine = false;
                  const imgMatches = [...str.matchAll(/<\s*(picture|image|img)\s*(\d+)\s*>/gi)];
                  if (imgMatches.length > 0) {
                    for (const m of imgMatches) {
                      const num = parseInt(m[2], 10);
                      if (validImgCount === 0 || num > validImgCount) {
                        dropLine = true;
                        break;
                      }
                    }
                  }
                  if (!dropLine && /<\s*audio\s*\d+\s*>/i.test(str) && !hasAud) dropLine = true;
                  if (!dropLine && /<\s*video\s*\d+\s*>/i.test(str) && !hasVid) dropLine = true;

                  if (dropLine) return;

                  str = str.replace(/<(picture|image|img|audio|video|subject|character)\s*(\d+)>/gi, (match, name, num) => {
                    const low = name.toLowerCase();
                    const n = parseInt(num, 10);
                    if (low === "picture" || low === "image" || low === "img") {
                      return `<${name} ${totalImg + n}>`;
                    } else if (low === "audio") {
                      return `<${name} ${totalAud + n}>`;
                    } else if (low === "video") {
                      return `<${name} ${totalVid + n}>`;
                    } else if (low === "subject" || low === "character") {
                      return `<${name} ${subjectIdx}>`;
                    }
                    return match;
                  });

                  str = str.replace(/\s{2,}/g, " ").trim();
                  if (str) adaptedLines.push(str);
                });

                if (adaptedLines.length) {
                  any = true;
                  const block = document.createElement("div");
                  block.style.color = secColor;
                  block.style.marginBottom = "6px";
                  block.style.whiteSpace = "pre-wrap";
                  block.textContent = adaptedLines.join("\n");
                  previewTextEl.appendChild(block);
                }
              }

              totalImg += validImgCount;
              if (hasAud) totalAud += 1;
              if (hasVid) totalVid += 1;
              subjectIdx += 1;
            });
          }
        });

        if (!any) {
          previewTextEl.innerHTML = "<span style='color:var(--sm-text-ghost); font-style:italic;'>(nothing selected)</span>";
        }
      }

      function renderAll() {
        renderTabs();
        renderPresetRow();
        renderSectionToolbar();
        renderList();
        updatePreview();
      }

      renderRegistry.set(node, renderAll);

      function reservedHeight() {
        let total = 16;
        if (!node.widgets) return total;
        node.widgets.forEach((w) => {
          if (w === widget || w === dataWidget) return;
          let h = 26;
          try {
            if (typeof w.computeSize === "function") {
              const cs = w.computeSize(node.size ? node.size[0] : 300);
              if (Array.isArray(cs) && typeof cs[1] === "number") h = cs[1];
            }
          } catch (e) {}
          total += h + 4;
        });
        return total;
      }

      function computeAvailableHeight() {
        const nodeH = (node.size && node.size[1]) || node.smDesiredHeight || 640;
        return Math.max(160, nodeH - reservedHeight() - 16);
      }

      let widget = node.addDOMWidget("subject_manager_ui", "div", root, {
        getValue() { return dataWidget ? dataWidget.value : "{}"; },
        setValue(v) { if (dataWidget) dataWidget.value = v; },
      });

      widget.computeSize = function (width) {
        return [width, computeAvailableHeight()];
      };

      function applyDomHeight() {
        if (node.size && Array.isArray(node.size) && typeof node.size[1] === "number" && node.size[1] > 100) {
          node.smDesiredHeight = node.size[1];
        }
        const h = computeAvailableHeight();
        root.style.height = h + "px";
        root.style.maxHeight = h + "px";
        if (widget && widget.element) {
          widget.element.style.height = h + "px";
          widget.element.style.maxHeight = h + "px";
        }
      }
      applyHeightRegistry.set(node, applyDomHeight);

      node.setSize([node.size ? node.size[0] : 520, node.smDesiredHeight]);
      applyDomHeight();
      persist();
      renderAll();
      refreshPresetSelect().catch(() => {});

      setTimeout(() => {
        try { applyDomHeight(); node.setDirtyCanvas(true, true); } catch (e) {}
      }, 0);

      return r;
    };

    const onConfigure = nodeType.prototype.onConfigure;
    nodeType.prototype.onConfigure = function () {
      const r = onConfigure ? onConfigure.apply(this, arguments) : undefined;
      if (this.size && Array.isArray(this.size) && typeof this.size[1] === "number") {
        this.smDesiredHeight = this.size[1];
      }
      const applyFn = applyHeightRegistry.get(this);
      if (applyFn) applyFn();

      try {
        const dw = this.widgets && this.widgets.find((w) => w.name === "subject_data");
        if (dw && dw.value) {
          this.smData = sanitizeData(JSON.parse(dw.value));
          const fn = renderRegistry.get(this);
          if (fn) fn();
        }
      } catch (e) {
        console.warn("SubjectManager: failed to restore data", e);
      }
      return r;
    };
  },
});