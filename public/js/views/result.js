import { state, on, emit } from '../state.js';
import { t, languageDisplayName } from '../i18n.js';
import {
  escapeHtml,
  toast,
  errorMessage,
  errorMessageForCode,
  formatDate,
  confidenceMeta,
  categoryMeta,
  copyText,
  confirmDialog,
} from '../ui.js';
import * as db from '../db.js';
import * as api from '../api.js';
import {
  deleteLocalScan,
  fetchThumbnail,
  mapServerPayload,
  reanalyzeRecord,
  retryRecord,
} from '../sync.js';
import { navigate } from '../router.js';
import { exportScanPdf } from '../pdf.js';
import { mountLearning } from './learning.js';
import { mountChat } from '../chat.js';

const RECOMMENDATION_ICONS = {
  care: 'bi-heart-pulse',
  recipe: 'bi-egg-fried',
  usage: 'bi-lightbulb',
  maintenance: 'bi-tools',
  safety: 'bi-shield-exclamation',
  activity: 'bi-activity',
  other: 'bi-check2-circle',
};

let mounted = null;
let unsubscribers = [];
let notesTimer = null;
let notesStatusTimer = null;

function detach() {
  for (const off of unsubscribers) off();
  unsubscribers = [];
  if (notesTimer) clearTimeout(notesTimer);
  if (notesStatusTimer) clearTimeout(notesStatusTimer);
  notesTimer = null;
  notesStatusTimer = null;
  mounted = null;
}

function section(title, icon, inner, className = '') {
  return `
    <section class="section-card ${className}">
      <h2><i class="bi ${icon}" aria-hidden="true"></i>${escapeHtml(title)}</h2>
      ${inner}
    </section>`;
}

function bulletSection(title, icon, items) {
  if (!items?.length) return '';
  return section(
    title,
    icon,
    `<ul class="check-list">${items
      .map(
        (item) =>
          `<li><i class="bi bi-check2-circle" aria-hidden="true"></i><span>${escapeHtml(item)}</span></li>`,
      )
      .join('')}</ul>`,
  );
}

function imageMarkup(record) {
  if (record.thumbnail) {
    return `<img src="${escapeHtml(record.thumbnail)}" alt="${escapeHtml(
      record.result?.mainIdentification || t('common.image'),
    )}" />`;
  }
  return '<div class="result-image-placeholder"><i class="bi bi-image" aria-hidden="true"></i></div>';
}

function topBar(record) {
  return `
    <div class="d-flex flex-wrap align-items-center justify-content-between gap-2 mb-3">
      <a class="btn btn-sm btn-outline-muted" href="#/history">
        <i class="bi bi-arrow-left me-1" aria-hidden="true"></i>${escapeHtml(t('common.back'))}
      </a>
      <div class="d-flex flex-wrap gap-2">
        <button type="button" class="btn btn-sm btn-outline-muted" data-action="favorite" aria-pressed="${
          record.favorite ? 'true' : 'false'
        }" aria-label="${escapeHtml(t(record.favorite ? 'result.favoriteRemove' : 'result.favoriteAdd'))}">
          <i class="bi ${record.favorite ? 'bi-heart-fill' : 'bi-heart'} me-1" aria-hidden="true"></i>
          <span data-fav-label>${escapeHtml(t(record.favorite ? 'result.favoriteRemove' : 'result.favoriteAdd'))}</span>
        </button>
        ${
          record.status === 'completed' && record.result
            ? `<button type="button" class="btn btn-sm btn-outline-muted" data-action="pdf">
                 <i class="bi bi-file-earmark-pdf me-1" aria-hidden="true"></i>${escapeHtml(t('common.downloadPdf'))}
               </button>`
            : ''
        }
        <button type="button" class="btn btn-sm btn-outline-danger" data-action="delete">
          <i class="bi bi-trash me-1" aria-hidden="true"></i>${escapeHtml(t('common.delete'))}
        </button>
      </div>
    </div>`;
}

function pendingView(record) {
  const processing = record.status === 'processing';
  return `
    ${topBar(record)}
    <section class="surface-card result-hero fade-up">
      <div class="result-image-wrap">${imageMarkup(record)}</div>
      <div class="result-body">
        <div class="ai-loading">
          <div class="ai-orbit" aria-hidden="true">
            <span class="orbit-ring"></span>
            <span class="orbit-core"><i class="bi ${processing ? 'bi-stars' : 'bi-cloud-arrow-up'}"></i></span>
          </div>
          <h2>${escapeHtml(t(processing ? 'result.analyzingTitle' : 'result.pendingTitle'))}</h2>
          <p>${escapeHtml(t(processing ? 'result.analyzingBody' : 'result.pendingBody'))}</p>
          ${
            state.online
              ? ''
              : `<p class="small muted mb-0"><i class="bi bi-wifi-off me-1" aria-hidden="true"></i>${escapeHtml(
                  t('result.connectionNeeded'),
                )}</p>`
          }
          <div class="w-100" style="max-width: 380px">
            <div class="progress" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0" id="uploadProgress">
              <div class="progress-bar ${
                processing ? 'progress-bar-striped progress-bar-animated' : ''
              }" id="uploadBar" style="width: ${processing ? 100 : 0}%"></div>
            </div>
            <p class="small muted mt-2 mb-0" id="uploadLabel">${escapeHtml(
              processing ? t('common.analyzing') : t('result.queuedHint'),
            )}</p>
          </div>
          <div class="d-flex flex-wrap gap-2 justify-content-center">
            <button type="button" class="btn btn-brand" data-action="retry">
              <i class="bi bi-arrow-repeat me-1" aria-hidden="true"></i>${escapeHtml(t('result.retryUpload'))}
            </button>
            <a class="btn btn-outline-muted" href="#/scan">${escapeHtml(t('common.newScan'))}</a>
          </div>
        </div>
      </div>
    </section>`;
}

function failedView(record) {
  const message =
    errorMessageForCode(record.errorCode) || record.errorMessage || errorMessage({ code: record.errorCode });
  return `
    ${topBar(record)}
    <section class="surface-card result-hero fade-up">
      <div class="result-image-wrap">${imageMarkup(record)}</div>
      <div class="result-body">
        <div class="empty-state border-0 py-4">
          <div class="empty-icon"><i class="bi bi-exclamation-triangle" aria-hidden="true"></i></div>
          <h2>${escapeHtml(t('result.failedTitle'))}</h2>
          <p>${escapeHtml(t('result.failedBody'))}</p>
          <p class="small muted">${escapeHtml(message)}</p>
          <div class="d-flex flex-wrap gap-2 justify-content-center">
            <button type="button" class="btn btn-brand" data-action="retry">
              <i class="bi bi-arrow-repeat me-1" aria-hidden="true"></i>${escapeHtml(t('result.retryUpload'))}
            </button>
            <a class="btn btn-outline-muted" href="#/scan">${escapeHtml(t('common.newScan'))}</a>
          </div>
        </div>
      </div>
    </section>`;
}

function safetyHtml(result) {
  if (!result.safety?.length) return '';
  return `
    <section class="safety-card">
      <h2><i class="bi bi-shield-exclamation" aria-hidden="true"></i>${escapeHtml(t('result.safety'))}</h2>
      <ul>${result.safety.map((item) => `<li>${escapeHtml(item)}</li>`).join('')}</ul>
    </section>`;
}

function recommendationsHtml(record) {
  if (!record.recommendations?.length) return '';
  return section(
    t('result.recommendations'),
    'bi-lightbulb',
    `<div class="recommendation-list">${record.recommendations
      .map(
        (recommendation) => `
      <article class="recommendation-card">
        <div class="recommendation-icon">
          <i class="bi ${RECOMMENDATION_ICONS[recommendation.kind] || RECOMMENDATION_ICONS.other}" aria-hidden="true"></i>
        </div>
        <div>
          <h4>${escapeHtml(recommendation.title)}</h4>
          <p>${escapeHtml(recommendation.body)}</p>
        </div>
      </article>`,
      )
      .join('')}</div>`,
  );
}

function compareHtml(result) {
  const observations = result.observations || [];
  const assumptions = result.assumptions || [];
  if (!observations.length && !assumptions.length) return '';
  return section(
    t('result.compareTitle'),
    'bi-eye',
    `<div class="compare-grid">
      ${
        observations.length
          ? `<div class="compare-card">
               <h3><i class="bi bi-eye" aria-hidden="true"></i>${escapeHtml(t('result.observations'))}</h3>
               <p class="small muted mb-2">${escapeHtml(t('result.observationsHint'))}</p>
               <ul>${observations.map((item) => `<li>${escapeHtml(item)}</li>`).join('')}</ul>
             </div>`
          : ''
      }
      ${
        assumptions.length
          ? `<div class="compare-card">
               <h3><i class="bi bi-question-circle" aria-hidden="true"></i>${escapeHtml(t('result.assumptions'))}</h3>
               <p class="small muted mb-2">${escapeHtml(t('result.assumptionsHint'))}</p>
               <ul>${assumptions.map((item) => `<li>${escapeHtml(item)}</li>`).join('')}</ul>
             </div>`
          : ''
      }
    </div>`,
  );
}

function alternativesHtml(result) {
  if (!result.alternatives?.length) return '';
  return section(
    t('result.alternatives'),
    'bi-diagram-3',
    `<div class="alternatives-list">${result.alternatives
      .map(
        (alternative) => `
      <div class="alternative-row">
        <div class="flex-grow-1">
          <div class="name">${escapeHtml(alternative.name)}</div>
          ${alternative.note ? `<div class="note">${escapeHtml(alternative.note)}</div>` : ''}
        </div>
        <span class="chip chip-neutral">${escapeHtml(confidenceMeta(alternative.likelihood).label)}</span>
      </div>`,
      )
      .join('')}</div>`,
  );
}

function followUpHtml(result) {
  if (!result.followUpQuestions?.length) return '';
  return section(
    t('result.followUp'),
    'bi-chat-dots',
    `<div class="follow-up-list">${result.followUpQuestions
      .map(
        (question) =>
          `<button type="button" class="follow-up-chip" data-question="${escapeHtml(question)}">${escapeHtml(
            question,
          )}</button>`,
      )
      .join('')}</div>`,
  );
}

function notesHtml(record) {
  return section(
    t('result.notes'),
    'bi-journal-text',
    `<textarea class="form-control notes-area" id="resultNotes" rows="3" maxlength="2000" placeholder="${escapeHtml(
      t('result.notesPlaceholder'),
    )}">${escapeHtml(record.notes || '')}</textarea>
     <p class="small muted mb-0 mt-2" id="notesStatus" aria-live="polite"></p>`,
  );
}

function overviewHtml(record) {
  const result = record.result;
  return `
    ${safetyHtml(result)}
    ${section(
      t('result.description'),
      'bi-card-text',
      `<p class="mb-0" style="line-height: 1.65">${escapeHtml(result.description)}</p>`,
    )}
    ${recommendationsHtml(record)}
    ${bulletSection(t('result.characteristics'), 'bi-list-check', result.characteristics)}
    ${bulletSection(t('result.uses'), 'bi-hand-thumbs-up', result.commonUses)}
    ${bulletSection(t('result.facts'), 'bi-stars', result.interestingFacts)}
    ${compareHtml(result)}
    ${alternativesHtml(result)}
    ${followUpHtml(result)}
    ${notesHtml(record)}
    <p class="disclaimer-note mb-0"><i class="bi bi-info-circle me-1" aria-hidden="true"></i>${escapeHtml(
      t('result.disclaimer'),
    )}</p>`;
}

function heroHtml(record) {
  const result = record.result;
  const confidence = confidenceMeta(result.confidence);
  const category = categoryMeta(record.category);
  const categoryName = category.name || result.categorySlug || '';
  const categoryIcon = category.icon;
  const locale = result.locale || record.language;
  const analyzedSeconds =
    Number.isFinite(result.latencyMs) && result.latencyMs > 0
      ? Math.max(1, Math.round(result.latencyMs / 1000))
      : null;

  return `
    <section class="surface-card result-hero fade-up">
      <div class="result-image-wrap">
        ${imageMarkup(record)}
        ${categoryName ? `<span class="result-image-badge"><i class="bi ${escapeHtml(categoryIcon)}" aria-hidden="true"></i>${escapeHtml(categoryName)}</span>` : ''}
        <div class="result-image-actions">
          <button type="button" class="icon-button ${record.favorite ? 'active' : ''}" data-action="favorite"
            aria-pressed="${record.favorite ? 'true' : 'false'}"
            aria-label="${escapeHtml(t(record.favorite ? 'result.favoriteRemove' : 'result.favoriteAdd'))}"
            title="${escapeHtml(t(record.favorite ? 'result.favoriteRemove' : 'result.favoriteAdd'))}">
            <i class="bi ${record.favorite ? 'bi-heart-fill' : 'bi-heart'}" aria-hidden="true"></i>
          </button>
        </div>
      </div>
      <div class="result-body">
        <div class="result-heading">
          <div>
            <h1>${escapeHtml(result.mainIdentification || t('common.unknown'))}</h1>
            ${
              result.scientificName
                ? `<div class="scientific-name">${escapeHtml(result.scientificName)}</div>`
                : ''
            }
          </div>
          <span class="confidence-badge ${confidence.className}">
            <i class="bi ${
              result.confidence === 'high'
                ? 'bi-patch-check'
                : result.confidence === 'moderate'
                  ? 'bi-question-circle'
                  : 'bi-exclamation-circle'
            }" aria-hidden="true"></i>${escapeHtml(confidence.label)}
          </span>
        </div>
        <div class="result-tags">
          ${categoryName ? `<span class="chip"><i class="bi ${escapeHtml(categoryIcon)}" aria-hidden="true"></i>${escapeHtml(categoryName)}</span>` : ''}
          <span class="chip chip-neutral"><i class="bi bi-translate" aria-hidden="true"></i>${escapeHtml(
            languageDisplayName(locale),
          )}</span>
          <span class="chip chip-neutral"><i class="bi bi-clock" aria-hidden="true"></i>${escapeHtml(
            formatDate(record.createdAt),
          )}</span>
          ${
            analyzedSeconds
              ? `<span class="chip chip-neutral"><i class="bi bi-lightning-charge" aria-hidden="true"></i>${escapeHtml(
                  t('result.analyzedIn', { seconds: analyzedSeconds }),
                )}</span>`
              : ''
          }
        </div>
        <div class="result-actions">
          <button type="button" class="btn btn-brand" data-tab="chat">
            <i class="bi bi-chat-dots me-1" aria-hidden="true"></i>${escapeHtml(t('result.chat'))}
          </button>
          <button type="button" class="btn btn-brand-soft" data-action="copy">
            <i class="bi bi-clipboard me-1" aria-hidden="true"></i>${escapeHtml(t('common.copy'))}
          </button>
          <button type="button" class="btn btn-brand-soft" data-action="reanalyze">
            <i class="bi bi-arrow-repeat me-1" aria-hidden="true"></i>${escapeHtml(t('common.reanalyze'))}
          </button>
          <button type="button" class="btn btn-outline-danger" data-action="delete">
            <i class="bi bi-trash me-1" aria-hidden="true"></i>${escapeHtml(t('result.delete'))}
          </button>
        </div>
        ${
          result.uncertaintyNotes
            ? `<div class="uncertainty-card mt-3 mb-0">
                 <strong><i class="bi bi-exclamation-triangle" aria-hidden="true"></i>${escapeHtml(
                   t('result.uncertaintyTitle'),
                 )}</strong>
                 ${escapeHtml(result.uncertaintyNotes)}
               </div>`
            : ''
        }
      </div>
    </section>`;
}

function tabsHtml() {
  const tabs = [
    { id: 'overview', icon: 'bi-grid', label: t('result.overview') },
    { id: 'learn', icon: 'bi-mortarboard', label: t('result.learn') },
    { id: 'chat', icon: 'bi-chat-dots', label: t('result.chat') },
  ];
  return `
    <div class="view-tabs" role="tablist" aria-label="${escapeHtml(t('result.overview'))}">
      ${tabs
        .map(
          (tab) => `
        <button type="button" role="tab" data-tab="${tab.id}" aria-selected="${mounted.tab === tab.id}" class="${
          mounted.tab === tab.id ? 'active' : ''
        }">
          <i class="bi ${tab.icon}" aria-hidden="true"></i>${escapeHtml(tab.label)}
        </button>`,
        )
        .join('')}
    </div>`;
}

function renderCompleted() {
  const record = mounted.record;
  mounted.container.innerHTML = `
    ${topBar(record)}
    ${heroHtml(record)}
    ${tabsHtml()}
    <div id="resultTabContent"></div>`;
  renderTab();
  if (!record.thumbnail && record.hasImage && record.serverId && state.online) {
    fetchThumbnail(record).catch(() => {});
  }
}

function renderTab() {
  const content = mounted.container.querySelector('#resultTabContent');
  if (!content) return;
  const record = mounted.record;

  if (mounted.tab === 'learn') {
    content.innerHTML = '';
    mountLearning(content, record);
    return;
  }

  if (mounted.tab === 'chat') {
    content.innerHTML = '';
    const question = mounted.pendingQuestion;
    mounted.pendingQuestion = '';
    mountChat(content, record, { initialQuestion: question });
    return;
  }

  content.innerHTML = overviewHtml(record);
}

function paint() {
  if (!mounted?.container?.isConnected) return;
  const record = mounted.record;
  if (record.status === 'completed' && record.result) {
    renderCompleted();
    return;
  }
  if (record.status === 'pending' || record.status === 'processing') {
    mounted.container.innerHTML = pendingView(record);
    return;
  }
  mounted.container.innerHTML = failedView(record);
}

function syncFavoriteButtons() {
  if (!mounted) return;
  const favorite = Boolean(mounted.record.favorite);
  mounted.container.querySelectorAll('[data-action="favorite"]').forEach((button) => {
    button.classList.toggle('active', favorite);
    button.setAttribute('aria-pressed', favorite ? 'true' : 'false');
    const label = t(favorite ? 'result.favoriteRemove' : 'result.favoriteAdd');
    button.setAttribute('aria-label', label);
    button.title = label;
    const icon = button.querySelector('i');
    if (icon) {
      const margin = icon.classList.contains('me-1') ? ' me-1' : '';
      icon.className = `bi ${favorite ? 'bi-heart-fill' : 'bi-heart'}${margin}`;
    }
    const labelNode = button.querySelector('[data-fav-label]');
    if (labelNode) labelNode.textContent = label;
  });
}

async function toggleFavorite() {
  if (!mounted) return;
  const updated = await db.toggleFavorite(mounted.id).catch(() => null);
  if (!updated) return;
  mounted.record = { ...mounted.record, favorite: updated.favorite };
  syncFavoriteButtons();
  emit('data-changed', { id: mounted.id });
  toast(t(updated.favorite ? 'history.favoriteAdded' : 'history.favoriteRemoved'), {
    type: 'success',
    timeout: 1800,
  });
}

function buildSummary(record) {
  const result = record.result;
  const lines = [result.mainIdentification || t('common.unknown')];
  if (result.scientificName) lines.push(result.scientificName);
  if (result.description) lines.push('', result.description);
  if (record.recommendations?.length) {
    lines.push('', `${t('result.recommendations')}:`);
    for (const recommendation of record.recommendations) {
      lines.push(`- ${recommendation.title}: ${recommendation.body}`);
    }
  }
  if (result.safety?.length) {
    lines.push('', `${t('result.safety')}:`);
    for (const item of result.safety) lines.push(`- ${item}`);
  }
  if (record.notes) lines.push('', `${t('result.notes')}:`, record.notes);
  return lines.join('\n');
}

async function copySummary() {
  if (!mounted?.record?.result) return;
  const ok = await copyText(buildSummary(mounted.record));
  toast(t(ok ? 'common.copied' : 'error.generic'), { type: ok ? 'success' : 'error', timeout: 2000 });
}

function downloadPdf() {
  if (!mounted?.record?.result) return;
  try {
    exportScanPdf(mounted.record);
  } catch (error) {
    toast(error.message || errorMessage(error), { type: 'error' });
  }
}

async function deleteScan() {
  if (!mounted) return;
  const record = mounted.record;
  const confirmed = await confirmDialog({
    title: t('result.deleteConfirmTitle'),
    body: t('result.deleteConfirmBody'),
    confirmLabel: t('common.delete'),
  });
  if (!confirmed) return;

  if (record.serverId) {
    if (!state.online) {
      toast(t('error.offline'), { type: 'warning' });
      return;
    }
    try {
      await api.deleteScan(record.serverId);
    } catch (error) {
      if (error.code !== 'NOT_FOUND') {
        toast(errorMessage(error), { type: 'error' });
        return;
      }
    }
  }

  await deleteLocalScan(record.id);
}

async function reanalyze() {
  if (!mounted) return;
  const record = mounted.record;
  if (!record.serverId) {
    toast(t('error.scanFailed'), { type: 'warning' });
    return;
  }
  if (state.config?.aiConfigured === false) {
    toast(t('result.aiDisabled'), { type: 'warning' });
    return;
  }
  if (!state.online) {
    toast(t('error.offline'), { type: 'warning' });
    return;
  }

  const confirmed = await confirmDialog({
    title: t('result.reanalyzeConfirmTitle'),
    body: t('result.reanalyzeConfirmBody'),
    confirmLabel: t('common.reanalyze'),
    danger: false,
  });
  if (!confirmed) return;

  try {
    await reanalyzeRecord(record.id, state.language);
    toast(t('result.reanalyzed'), { type: 'success' });
  } catch (error) {
    toast(errorMessage(error) || t('result.reanalyzeFailed'), { type: 'error' });
  }
}

async function retryAnalysis() {
  if (!mounted) return;
  if (!state.online) {
    toast(t('error.offline'), { type: 'warning' });
    return;
  }
  if (state.config?.aiConfigured === false) {
    toast(t('result.aiDisabled'), { type: 'warning' });
    return;
  }

  const button = mounted.container.querySelector('[data-action="retry"]');
  if (button) button.disabled = true;

  try {
    const updated = await retryRecord(mounted.id);
    if (updated) mounted.record = updated;
    if (updated && (updated.status === 'pending' || updated.status === 'processing')) {
      toast(t('result.retryQueued'), { type: 'info' });
    }
    paint();
  } catch (error) {
    toast(errorMessage(error), { type: 'error' });
    paint();
  }
}

function readNotesArea() {
  return mounted?.container?.querySelector('#resultNotes') || null;
}

async function saveNotes(value) {
  if (!mounted) return;
  const id = mounted.id;
  try {
    const updated = await db.updateScan(id, { notes: value });
    if (!updated) return;
    mounted.record = { ...mounted.record, notes: value };
    emit('data-changed', { id });
    const status = mounted?.container?.querySelector('#notesStatus');
    if (status) {
      status.textContent = t('result.notesSaved');
      if (notesStatusTimer) clearTimeout(notesStatusTimer);
      notesStatusTimer = setTimeout(() => {
        if (status.isConnected) status.textContent = '';
      }, 2500);
    }
  } catch {
    // Notes stay in the textarea; the next edit retries the local save.
  }
}

function flushNotes() {
  const area = readNotesArea();
  if (!area || !mounted) return;
  if (area.value === (mounted.record.notes || '')) return;
  saveNotes(area.value);
}

function handleInput(event) {
  if (event.target.id !== 'resultNotes' || !mounted) return;
  if (notesTimer) clearTimeout(notesTimer);
  notesTimer = setTimeout(() => {
    notesTimer = null;
    const area = readNotesArea();
    if (area) saveNotes(area.value);
  }, 600);
}

function handleFocusOut(event) {
  if (event.target.id === 'resultNotes') flushNotes();
}

function setTab(tab) {
  if (!mounted || mounted.tab === tab) return;
  flushNotes();
  mounted.tab = tab;
  paint();
}

async function handleClick(event) {
  if (!mounted) return;

  const tabButton = event.target.closest('[data-tab]');
  if (tabButton) {
    event.preventDefault();
    setTab(tabButton.dataset.tab);
    return;
  }

  const question = event.target.closest('[data-question]');
  if (question) {
    mounted.pendingQuestion = question.dataset.question;
    setTab('chat');
    return;
  }

  const action = event.target.closest('[data-action]')?.dataset.action;
  if (!action) return;

  if (action === 'favorite') await toggleFavorite();
  else if (action === 'pdf') downloadPdf();
  else if (action === 'delete') await deleteScan();
  else if (action === 'reanalyze') await reanalyze();
  else if (action === 'retry') await retryAnalysis();
  else if (action === 'copy') await copySummary();
}

function subscribe() {
  unsubscribers.push(
    on('scan-updated', (payload) => {
      if (!mounted || !payload || payload.id !== mounted.id || !mounted.container?.isConnected) return;
      const previous = mounted.record;
      const next = { ...previous, ...payload };
      mounted.record = next;

      if (payload.thumbnail && !previous.thumbnail) {
        const slot = mounted.container.querySelector('.result-image-wrap');
        if (slot && !slot.querySelector('img')) {
          slot.insertAdjacentHTML('afterbegin', imageMarkup(next));
        }
      }

      const statusChanged = payload.status && payload.status !== previous.status;
      const resultChanged =
        payload.result && previous.result && payload.result.id !== previous.result.id;
      if (statusChanged || resultChanged) paint();
    }),
  );

  unsubscribers.push(
    on('scan-deleted', (payload) => {
      if (!mounted || payload?.id !== mounted.id) return;
      toast(t('result.deleted'), { type: 'success' });
      navigate('/history');
    }),
  );

  unsubscribers.push(
    on('upload-progress', (payload) => {
      if (!mounted || !payload || payload.id !== mounted.id) return;
      const bar = mounted.container.querySelector('#uploadBar');
      const label = mounted.container.querySelector('#uploadLabel');
      const progress = mounted.container.querySelector('#uploadProgress');
      if (bar) bar.style.width = `${payload.percent}%`;
      if (label) label.textContent = t('scanner.uploadProgress', { percent: payload.percent });
      if (progress) progress.setAttribute('aria-valuenow', String(payload.percent));
    }),
  );
}

function loadingView(container) {
  container.innerHTML = `
    <section class="section-card">
      <div class="ai-loading">
        <div class="ai-orbit" aria-hidden="true">
          <span class="orbit-ring"></span>
          <span class="orbit-core"><i class="bi bi-stars"></i></span>
        </div>
        <h2>${escapeHtml(t('common.loading'))}</h2>
      </div>
    </section>`;
}

function notFoundView(container) {
  container.innerHTML = `
    <section class="section-card">
      <div class="empty-state">
        <div class="empty-icon"><i class="bi bi-search" aria-hidden="true"></i></div>
        <h2>${escapeHtml(t('result.notFound'))}</h2>
        <p>${escapeHtml(t('result.notFoundBody'))}</p>
        <div class="d-flex flex-wrap gap-2 justify-content-center">
          <a class="btn btn-brand" href="#/scan">${escapeHtml(t('common.newScan'))}</a>
          <a class="btn btn-outline-muted" href="#/history">${escapeHtml(t('history.title'))}</a>
        </div>
      </div>
    </section>`;
}

export async function renderResult(container, params, query) {
  detach();
  loadingView(container);

  const id = params?.id;
  let record = null;
  try {
    record = await db.getScan(id);
  } catch {
    record = null;
  }

  if (!record && state.online) {
    try {
      const payload = await api.getScan(id);
      record = mapServerPayload(payload, { id: payload.id });
      await db.putScan(record);
      fetchThumbnail(record).catch(() => {});
    } catch {
      record = null;
    }
  }

  if (!record) {
    notFoundView(container);
    return;
  }

  const requestedTab = query?.get?.('tab');
  mounted = {
    id: record.id,
    container,
    record,
    tab: requestedTab === 'learn' || requestedTab === 'chat' ? requestedTab : 'overview',
    pendingQuestion: '',
  };

  const controller = new AbortController();
  container.addEventListener('click', handleClick, { signal: controller.signal });
  container.addEventListener('input', handleInput, { signal: controller.signal });
  container.addEventListener('focusout', handleFocusOut, { signal: controller.signal });
  unsubscribers.push(() => controller.abort());
  subscribe();

  paint();
}
