import { state } from '../state.js';
import { t } from '../i18n.js';
import { escapeHtml, toast, errorMessage } from '../ui.js';
import * as api from '../api.js';
import * as db from '../db.js';

const cache = new Map();
let preferredLevel = 'beginner';

function cacheKey(record, level) {
  return `${record.serverId || record.id}:${level}:${state.language}`;
}

function emptyState(icon, title, body, action = '') {
  return `
    <div class="empty-state">
      <div class="empty-icon"><i class="bi ${icon}" aria-hidden="true"></i></div>
      <h2>${escapeHtml(title)}</h2>
      <p>${escapeHtml(body)}</p>
      ${action}
    </div>`;
}

export function mountLearning(container, record) {
  const featureEnabled = state.config?.features?.learningMode !== false;
  const canUse = Boolean(record.serverId) && record.status === 'completed' && Boolean(record.result);

  let level = preferredLevel;
  let content = cache.get(cacheKey(record, level)) || null;
  let busy = false;
  let error = null;
  const answered = new Set();

  const render = () => {
    if (!featureEnabled) {
      container.innerHTML = emptyState(
        'bi-mortarboard',
        t('learning.featureOff'),
        t('learning.subtitle'),
      );
      return;
    }
    if (!canUse) {
      container.innerHTML = emptyState(
        'bi-mortarboard',
        t('learning.needScan'),
        t('learning.needScanBody'),
        `<a class="btn btn-brand" href="#/scan">${escapeHtml(t('common.newScan'))}</a>`,
      );
      return;
    }

    container.innerHTML = `
      <div class="learning-intro mb-3">
        <div>
          <div class="d-flex align-items-center gap-2 flex-wrap mb-2">
            <span class="chip"><i class="bi bi-book" aria-hidden="true"></i>${escapeHtml(t('learning.guide'))}</span>
            <span class="chip chip-neutral">${escapeHtml(t('learning.scanContext'))}: ${escapeHtml(record.result.mainIdentification)}</span>
          </div>
          <p class="muted small mb-0">${escapeHtml(t('learning.subtitle'))}</p>
        </div>
        <div class="d-flex flex-wrap gap-2 align-items-center justify-content-md-end">
          <div class="level-switch" role="group" aria-label="${escapeHtml(t('learning.beginner'))} / ${escapeHtml(t('learning.advanced'))}">
            <button type="button" data-level="beginner" class="${level === 'beginner' ? 'active' : ''}">${escapeHtml(t('learning.beginner'))}</button>
            <button type="button" data-level="advanced" class="${level === 'advanced' ? 'active' : ''}">${escapeHtml(t('learning.advanced'))}</button>
          </div>
          <button type="button" class="btn btn-brand" id="learningGenerate" ${busy ? 'disabled' : ''}>
            <i class="bi bi-magic me-1" aria-hidden="true"></i>
            ${escapeHtml(busy ? t('learning.regenerating') : content ? t('learning.newContent') : t('learning.generate'))}
          </button>
        </div>
      </div>
      <div id="learningContent">
        ${busy && !content ? skeleton() : ''}
        ${error ? errorState(error) : ''}
        ${content ? contentHtml(content) : ''}
        ${!content && !busy && !error ? introState() : ''}
      </div>
    `;

    container.querySelectorAll('[data-level]').forEach((button) => {
      button.addEventListener('click', () => {
        if (busy) return;
        const next = button.dataset.level;
        if (next === level) return;
        level = next;
        preferredLevel = next;
        content = cache.get(cacheKey(record, level)) || null;
        error = null;
        answered.clear();
        render();
      });
    });

    container.querySelector('#learningGenerate')?.addEventListener('click', () => generate(true));

    container.querySelectorAll('[data-quiz-index]').forEach((button) => {
      button.addEventListener('click', () => {
        const index = Number(button.dataset.quizIndex);
        const option = Number(button.dataset.optionIndex);
        if (answered.has(index)) return;
        answered.add(index);
        const question = content.quiz[index];
        const correct = option === question.answerIndex;
        const card = button.closest('.quiz-card');
        card.querySelectorAll('.quiz-option').forEach((item, itemIndex) => {
          item.disabled = true;
          if (itemIndex === question.answerIndex) item.classList.add('correct');
        });
        if (!correct) button.classList.add('wrong');
        const feedback = card.querySelector('.quiz-feedback');
        if (feedback) {
          feedback.innerHTML = `<strong>${escapeHtml(correct ? t('learning.correct') : t('learning.wrong'))}</strong> ${escapeHtml(question.explanation)}`;
        }
      });
    });
  };

  const generate = async (force) => {
    if (busy) return;
    if (!state.online) {
      toast(t('learning.offline'), { type: 'warning' });
      return;
    }
    if (state.config?.aiConfigured === false) {
      toast(t('result.aiDisabled'), { type: 'warning' });
      return;
    }

    busy = true;
    error = null;
    render();

    try {
      const data = await api.generateLearning(record.serverId, level, state.language);
      content = data;
      answered.clear();
      cache.set(cacheKey(record, level), data);
    } catch (err) {
      error = errorMessage(err);
      toast(error, { type: 'error' });
    } finally {
      busy = false;
      render();
    }
  };

  render();
}

export async function renderLearningPage(container) {
  container.innerHTML = `
    <h1 class="page-title">${escapeHtml(t('learning.title'))}</h1>
    <p class="page-subtitle">${escapeHtml(t('learning.subtitle'))}</p>
    <div id="learningPageMount">
      <div class="section-card">
        <div class="skeleton skeleton-line short"></div>
        <div class="skeleton skeleton-line"></div>
      </div>
    </div>`;

  const mount = container.querySelector('#learningPageMount');
  const records = await db.getAllScans().catch(() => []);
  const record = records.find((item) => item.status === 'completed' && item.result);

  if (!record) {
    mount.innerHTML = emptyState(
      'bi-mortarboard',
      t('learning.needScan'),
      t('learning.needScanBody'),
      `<a class="btn btn-brand" href="#/scan">${escapeHtml(t('common.newScan'))}</a>`,
    );
    return;
  }

  mount.innerHTML = `
    <div class="mb-3">
      <a class="btn btn-sm btn-outline-muted" href="#/result/${escapeHtml(record.id)}">
        <i class="bi bi-arrow-up-right me-1" aria-hidden="true"></i>${escapeHtml(t('result.overview'))}
      </a>
    </div>
    <div id="learningMount"></div>`;
  mountLearning(mount.querySelector('#learningMount'), record);
}

function skeleton() {
  return `
    <div class="section-card">
      <div class="skeleton skeleton-line short"></div>
      <div class="skeleton skeleton-line"></div>
      <div class="skeleton skeleton-line"></div>
      <div class="skeleton skeleton-block mt-3"></div>
    </div>`;
}

function introState() {
  return `
    <div class="section-card text-center">
      <div class="empty-state border-0" style="padding: 26px 8px">
        <div class="empty-icon"><i class="bi bi-stars" aria-hidden="true"></i></div>
        <h2>${escapeHtml(t('learning.title'))}</h2>
        <p>${escapeHtml(t('learning.subtitle'))}</p>
      </div>
    </div>`;
}

function errorState(message) {
  return `<p class="small text-danger mb-0">${escapeHtml(message)}</p>`;
}

function contentHtml(content) {
  return `
    <section class="section-card">
      <h2><i class="bi bi-journal-text" aria-hidden="true"></i>${escapeHtml(t('learning.explanation'))}</h2>
      <p class="mb-0" style="line-height: 1.65">${escapeHtml(content.explanation)}</p>
    </section>

    <section class="section-card">
      <h2><i class="bi bi-lightbulb" aria-hidden="true"></i>${escapeHtml(t('learning.facts'))}</h2>
      <ul class="check-list">
        ${(content.facts || [])
          .map(
            (fact) =>
              `<li><i class="bi bi-check2-circle" aria-hidden="true"></i><span>${escapeHtml(fact)}</span></li>`,
          )
          .join('')}
      </ul>
    </section>

    <section class="section-card">
      <h2><i class="bi bi-tools" aria-hidden="true"></i>${escapeHtml(t('learning.activity'))}</h2>
      <p class="mb-0" style="line-height: 1.65">${escapeHtml(content.activity)}</p>
    </section>

    ${
      content.glossary?.length
        ? `<section class="section-card">
            <h2><i class="bi bi-book" aria-hidden="true"></i>${escapeHtml(t('learning.glossary'))}</h2>
            <dl class="glossary-list">
              ${content.glossary
                .map(
                  (entry) => `
                <div>
                  <dt>${escapeHtml(entry.term)}</dt>
                  <dd>${escapeHtml(entry.definition)}</dd>
                </div>`,
                )
                .join('')}
            </dl>
          </section>`
        : ''
    }

    ${
      content.quiz?.length
        ? `<section class="section-card">
            <h2><i class="bi bi-patch-question" aria-hidden="true"></i>${escapeHtml(t('learning.quiz'))}</h2>
            <p class="small muted">${escapeHtml(t('learning.quizHint'))}</p>
            <div class="d-grid gap-3">
              ${content.quiz
                .map(
                  (question, index) => `
                <div class="quiz-card" data-question="${index}">
                  <div class="quiz-question">${index + 1}. ${escapeHtml(question.question)}</div>
                  <div class="quiz-options">
                    ${question.options
                      .map(
                        (option, optionIndex) => `
                      <button type="button" class="quiz-option" data-quiz-index="${index}" data-option-index="${optionIndex}">
                        ${escapeHtml(option)}
                      </button>`,
                      )
                      .join('')}
                  </div>
                  <div class="quiz-feedback"></div>
                </div>`,
                )
                .join('')}
            </div>
          </section>`
        : ''
    }`;
}
