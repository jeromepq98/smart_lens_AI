import { state } from '../state.js';
import { t } from '../i18n.js';
import {
  escapeHtml,
  toast,
  errorMessage,
  makeThumbnail,
  loadImage,
  formatBytes,
  applyBranding,
} from '../ui.js';
import { openCameraModal, openCropModal } from '../camera.js';
import { prepareScan, pushScan } from '../sync.js';
import { navigate } from '../router.js';
import { getConfig } from '../api.js';

const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/webp'];

let selected = null;
let submitting = false;

function clearSelected() {
  if (selected?.previewUrl) URL.revokeObjectURL(selected.previewUrl);
  selected = null;
}

function sourcePanelHtml() {
  const upload = state.config?.upload || { maxSizeMb: 10 };
  const daily = state.config?.limits?.dailyScans ?? 20;
  return `
    <div class="source-panel surface-card">
      <div class="source-grid">
        <button type="button" class="source-button primary" id="openCamera">
          <i class="bi bi-camera" aria-hidden="true"></i>
          <span>${escapeHtml(t('scanner.openCamera'))}<small class="d-block fw-normal opacity-75">${escapeHtml(t('scanner.openCameraHint'))}</small></span>
        </button>
        <button type="button" class="source-button" id="openUpload">
          <i class="bi bi-image" aria-hidden="true"></i>
          <span>${escapeHtml(t('scanner.upload'))}<small class="d-block fw-normal opacity-75">${escapeHtml(t('scanner.uploadHint'))}</small></span>
        </button>
      </div>
      <input type="file" id="fileInput" accept="image/jpeg,image/png,image/webp" hidden />
      <div class="drop-zone" id="dropZone">
        <i class="bi bi-cloud-arrow-up me-1" aria-hidden="true"></i>
        ${escapeHtml(t('scanner.dropHint'))}
      </div>
      <div class="scan-limits">
        <span><i class="bi bi-file-earmark-image" aria-hidden="true"></i>${escapeHtml(t('scanner.limits.types'))}</span>
        <span><i class="bi bi-hdd" aria-hidden="true"></i>${escapeHtml(t('scanner.limits.size', { size: upload.maxSizeMb }))}</span>
        <span><i class="bi bi-lightning-charge" aria-hidden="true"></i>${escapeHtml(t('scanner.limits.daily', { count: daily }))}</span>
      </div>
      <p class="small muted mt-3 mb-0">
        <i class="bi bi-shield-lock me-1" aria-hidden="true"></i>${escapeHtml(t('scanner.privacyNote'))}
      </p>
    </div>`;
}

function previewHtml() {
  const disabled = submitting ? 'disabled' : '';
  return `
    <div class="surface-card preview-card fade-up">
      <div class="preview-stage">
        <img src="${selected.previewUrl}" alt="${escapeHtml(t('scanner.ready'))}" />
        <div class="scan-frame" aria-hidden="true"></div>
      </div>
      <input type="file" id="fileInput" accept="image/jpeg,image/png,image/webp" hidden />
      <div class="preview-toolbar">
        <button type="button" class="btn btn-sm btn-outline-muted" id="retake">${escapeHtml(t('common.retake'))}</button>
        <button type="button" class="btn btn-sm btn-outline-muted" id="crop">${escapeHtml(t('scanner.crop'))}</button>
        <button type="button" class="btn btn-sm btn-outline-muted" id="changeImage">${escapeHtml(t('scanner.changeImage'))}</button>
        <div class="preview-meta">
          <span>${selected.width} × ${selected.height}</span>
          <span>${formatBytes(selected.size)}</span>
        </div>
      </div>
      <div class="analyze-bar">
        <button type="button" class="btn btn-brand w-100" id="analyze" ${disabled}>
          <i class="bi bi-stars me-1" aria-hidden="true"></i>
          ${escapeHtml(submitting ? t('common.analyzing') : t('common.analyze'))}
        </button>
        <div id="progressWrap" ${submitting ? '' : 'hidden'}>
          <div class="progress" role="progressbar" aria-label="${escapeHtml(t('scanner.uploadProgress', { percent: 0 }))}" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0">
            <div class="progress-bar" id="progressBar" style="width: 0%"></div>
          </div>
          <div class="analyzing-note mt-2"><i class="bi bi-stars" aria-hidden="true"></i><span id="progressLabel">${escapeHtml(t('scanner.uploadProgress', { percent: 0 }))}</span></div>
        </div>
        <p class="small muted mb-0"><i class="bi bi-info-circle me-1" aria-hidden="true"></i>${escapeHtml(t('scanner.analyzeHint'))}</p>
      </div>
    </div>`;
}

function aiNoticeHtml() {
  return `
    <div class="section-card fade-up" style="border-color: rgba(255, 193, 7, 0.45); background: rgba(255, 193, 7, 0.07)">
      <div class="d-flex gap-3 align-items-start">
        <i class="bi bi-exclamation-triangle-fill fs-4" style="color: #b8860b" aria-hidden="true"></i>
        <div>
          <h2 class="h6 fw-bold mb-1">${escapeHtml(t('scanner.aiDisabledTitle'))}</h2>
          <p class="muted small mb-2">${escapeHtml(t('scanner.aiDisabledBody'))}</p>
          <button type="button" class="btn btn-sm btn-outline-muted" id="recheckAi">${escapeHtml(t('scanner.recheck'))}</button>
        </div>
      </div>
    </div>`;
}

async function selectFile(file, source, container) {
  if (!file) return;

  if (!ALLOWED_TYPES.includes(file.type)) {
    toast(t('scanner.invalidType'), { type: 'error' });
    return;
  }

  const maxMb = state.config?.upload?.maxSizeMb ?? 10;
  if (file.size > maxMb * 1024 * 1024) {
    toast(t('scanner.invalidSize', { size: maxMb }), { type: 'error' });
    return;
  }

  const objectUrl = URL.createObjectURL(file);
  let image;
  try {
    image = await loadImage(objectUrl);
  } catch {
    URL.revokeObjectURL(objectUrl);
    toast(t('scanner.imageReadError'), { type: 'error' });
    return;
  }
  URL.revokeObjectURL(objectUrl);

  if (!image.naturalWidth || !image.naturalHeight) {
    toast(t('scanner.imageReadError'), { type: 'error' });
    return;
  }
  if (Math.max(image.naturalWidth, image.naturalHeight) > 12000) {
    toast(t('scanner.invalidDimension'), { type: 'error' });
    return;
  }

  const thumbnail = await makeThumbnail(file, 900).catch(() => null);
  clearSelected();
  selected = {
    blob: file,
    filename: file.name || `scan-${Date.now()}.jpg`,
    previewUrl: URL.createObjectURL(file),
    thumbnail: thumbnail?.dataUrl || null,
    width: image.naturalWidth,
    height: image.naturalHeight,
    size: file.size,
    source,
  };
  renderScanner(container);
}

async function replaceWithBlob(blob, filename, source, container) {
  const file = new File([blob], filename, { type: blob.type || 'image/jpeg' });
  await selectFile(file, source, container);
}

async function openCamera(container) {
  openCameraModal({
    onCapture: (blob) => {
      replaceWithBlob(blob, `camera-${Date.now()}.jpg`, 'camera', container);
    },
  });
}

function bindFileInput(container) {
  const fileInput = container.querySelector('#fileInput');
  fileInput?.addEventListener('change', () => {
    const file = fileInput.files?.[0];
    fileInput.value = '';
    if (file) selectFile(file, 'upload', container);
  });
  return fileInput;
}

function bindSourceEvents(container) {
  const fileInput = bindFileInput(container);
  const openUpload = () => fileInput?.click();

  container.querySelector('#openCamera')?.addEventListener('click', () => openCamera(container));
  container.querySelector('#openUpload')?.addEventListener('click', openUpload);

  const dropZone = container.querySelector('#dropZone');
  if (dropZone) {
    const stop = (event) => {
      event.preventDefault();
      event.stopPropagation();
    };
    ['dragenter', 'dragover'].forEach((type) =>
      dropZone.addEventListener(type, (event) => {
        stop(event);
        dropZone.classList.add('drag-active');
      }),
    );
    ['dragleave', 'dragend'].forEach((type) =>
      dropZone.addEventListener(type, (event) => {
        stop(event);
        dropZone.classList.remove('drag-active');
      }),
    );
    dropZone.addEventListener('drop', (event) => {
      stop(event);
      dropZone.classList.remove('drag-active');
      const file = event.dataTransfer?.files?.[0];
      if (file) selectFile(file, 'upload', container);
    });
    dropZone.addEventListener('click', openUpload);
  }

  container.querySelector('#recheckAi')?.addEventListener('click', async () => {
    try {
      const config = await getConfig();
      state.config = config;
      applyBranding(config);
      renderScanner(container);
      if (config.aiConfigured) toast(t('settings.aiConfigured'), { type: 'success' });
    } catch (error) {
      toast(errorMessage(error), { type: 'error' });
    }
  });
}

function bindPreviewEvents(container) {
  bindFileInput(container);

  container.querySelector('#retake')?.addEventListener('click', () => openCamera(container));
  container.querySelector('#changeImage')?.addEventListener('click', () => container.querySelector('#fileInput')?.click());

  container.querySelector('#crop')?.addEventListener('click', () => {
    if (!selected) return;
    openCropModal(selected.previewUrl, {
      onApply: (blob) => {
        replaceWithBlob(blob, selected.filename.replace(/\.(png|webp|jpeg|jpg)$/i, '') + '.jpg', selected.source, container);
      },
    });
  });

  container.querySelector('#analyze')?.addEventListener('click', () => analyze(container));
}

function setAnalyzing(container, percent, label) {
  const wrap = container.querySelector('#progressWrap');
  if (wrap) wrap.hidden = false;
  const bar = container.querySelector('#progressBar');
  if (bar) bar.style.width = `${percent}%`;
  const progress = container.querySelector('.progress');
  if (progress) progress.setAttribute('aria-valuenow', String(percent));
  const text = container.querySelector('#progressLabel');
  if (text && label) text.textContent = label;
  const button = container.querySelector('#analyze');
  if (button) {
    button.disabled = true;
    button.innerHTML = `<i class="bi bi-stars me-1" aria-hidden="true"></i>${escapeHtml(t('common.analyzing'))}`;
  }
}

async function analyze(container) {
  if (!selected || submitting) return;

  if (state.config?.aiConfigured === false) {
    toast(t('result.aiDisabled'), { type: 'warning' });
    return;
  }

  submitting = true;
  setAnalyzing(container, 0, t('scanner.uploadProgress', { percent: 0 }));

  try {
    const record = await prepareScan({
      blob: selected.blob,
      filename: selected.filename,
      language: state.language,
      source: selected.source,
      thumbnail: selected.thumbnail,
    });

    clearSelected();
    submitting = false;
    navigate(`/result/${record.id}`);
    pushScan(record.id).catch(() => {});
  } catch (error) {
    submitting = false;
    toast(errorMessage(error), { type: 'error' });
    renderScanner(container);
  }
}

export async function renderScanner(container) {
  const config = state.config || {};
  const aiReady = config.aiConfigured !== false;

  container.innerHTML = `
    ${aiReady ? '' : aiNoticeHtml()}
    <section class="scanner-hero${selected ? ' single' : ''}">
      <div class="hero-copy fade-up">
        <span class="hero-eyebrow"><i class="bi bi-stars" aria-hidden="true"></i>${escapeHtml(t('scanner.eyebrow'))}</span>
        <h1>${escapeHtml(t('scanner.title'))}</h1>
        <p>${escapeHtml(t('scanner.subtitle'))}</p>
        <div class="hero-tags">
          <span>${escapeHtml(t('scanner.tag.plant'))}</span>
          <span>${escapeHtml(t('scanner.tag.animal'))}</span>
          <span>${escapeHtml(t('scanner.tag.food'))}</span>
          <span>${escapeHtml(t('scanner.tag.electronics'))}</span>
          <span>${escapeHtml(t('scanner.tag.objects'))}</span>
        </div>
      </div>
      ${selected ? '' : sourcePanelHtml()}
    </section>
    ${selected ? previewHtml() : ''}
    <section class="section-card">
      <h2><i class="bi bi-lightbulb" aria-hidden="true"></i>${escapeHtml(t('scanner.tipTitle'))}</h2>
      <div class="row g-3">
        ${[t('scanner.tip1'), t('scanner.tip2'), t('scanner.tip3'), t('scanner.tip4')]
          .map(
            (tip, index) => `
          <div class="col-12 col-md-6">
            <div class="d-flex gap-2 small">
              <span class="chip chip-neutral">${index + 1}</span>
              <span class="muted pt-1">${escapeHtml(tip)}</span>
            </div>
          </div>`,
          )
          .join('')}
      </div>
    </section>
    <p class="text-center muted small mt-3">${escapeHtml(t('scanner.saveNote'))}</p>
  `;

  if (selected) bindPreviewEvents(container);
  else bindSourceEvents(container);
}
