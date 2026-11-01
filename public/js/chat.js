import { state } from './state.js';
import { t } from './i18n.js';
import { escapeHtml, toast, errorMessage, copyText, formatRelative, confirmDialog } from './ui.js';
import * as api from './api.js';

const cache = new Map();
let controller = null;

function renderMessages(container, model) {
  const list = container.querySelector('#chatMessages');
  if (!list) return;

  if (model.loading) {
    list.innerHTML = `
      <div class="chat-bubble assistant">
        <span class="chat-typing" aria-label="${escapeHtml(t('common.loading'))}"><span></span><span></span><span></span></span>
      </div>`;
    return;
  }

  const items = model.messages;
  if (!items.length) {
    list.innerHTML = `<p class="small muted mb-0">${escapeHtml(t('chat.empty'))}</p>`;
    return;
  }

  const lastAssistantIndex = [...items].reverse().findIndex((message) => message.role === 'assistant');
  const lastAssistant = lastAssistantIndex === -1 ? -1 : items.length - 1 - lastAssistantIndex;

  list.innerHTML = items
    .map(
      (message, index) => `
      <div class="chat-bubble ${message.role === 'user' ? 'user' : 'assistant'}">
        ${escapeHtml(message.content)}
        ${
          message.role === 'assistant'
            ? `<div class="chat-meta">
                 <span>${escapeHtml(formatRelative(message.createdAt) || '')}</span>
               </div>
               <div class="chat-actions">
                 <button type="button" data-action="copy" data-index="${index}">
                   <i class="bi bi-clipboard" aria-hidden="true"></i> ${escapeHtml(t('chat.copy'))}
                 </button>
                 ${
                   index === lastAssistant
                     ? `<button type="button" data-action="regenerate"><i class="bi bi-arrow-repeat" aria-hidden="true"></i> ${escapeHtml(t('chat.regenerate'))}</button>`
                     : ''
                 }
               </div>`
            : ''
        }
      </div>`,
    )
    .join('');

  if (model.typing) {
    list.insertAdjacentHTML(
      'beforeend',
      `<div class="chat-bubble assistant"><span class="chat-typing" aria-label="${escapeHtml(t('chat.thinking'))}"><span></span><span></span><span></span></span></div>`,
    );
  }

  list.scrollTop = list.scrollHeight;
}

function updateComposer(container, model) {
  const input = container.querySelector('#chatInput');
  const button = container.querySelector('#chatSend');
  const notice = container.querySelector('#chatNotice');
  if (!input || !button) return;

  const aiReady = state.config?.aiConfigured !== false;
  const canUse = model.available && state.online && aiReady && !model.busy;

  input.disabled = !canUse;
  button.disabled = !canUse || !input.value.trim();

  if (!model.available) {
    notice.innerHTML = `<p class="small muted mb-2"><i class="bi bi-info-circle me-1" aria-hidden="true"></i>${escapeHtml(t('result.chatUnavailable'))}</p>`;
  } else if (!aiReady) {
    notice.innerHTML = `<p class="small muted mb-2"><i class="bi bi-exclamation-circle me-1" aria-hidden="true"></i>${escapeHtml(t('chat.aiDisabled'))}</p>`;
  } else if (!state.online) {
    notice.innerHTML = `<p class="small muted mb-2"><i class="bi bi-wifi-off me-1" aria-hidden="true"></i>${escapeHtml(t('chat.offline'))}</p>`;
  } else {
    notice.innerHTML = '';
  }
}

export function mountChat(container, record, { initialQuestion = '' } = {}) {
  controller?.abort();
  controller = new AbortController();
  const signal = controller.signal;

  const serverId = record.serverId;
  const cached = serverId ? cache.get(serverId) : null;
  const model = {
    available: Boolean(serverId) && record.status === 'completed' && Boolean(record.result),
    loading: false,
    typing: false,
    busy: false,
    messages: cached ? [...cached] : [],
    conversationId: null,
  };

  container.innerHTML = `
    <div class="chat-panel surface-card p-3 p-md-4">
      <div class="d-flex align-items-start justify-content-between gap-2 mb-3">
        <div>
          <h2 class="h6 fw-bold mb-1"><i class="bi bi-chat-dots me-1" aria-hidden="true"></i>${escapeHtml(t('chat.title'))}</h2>
          <p class="small muted mb-0">${escapeHtml(t('chat.subtitle'))}</p>
        </div>
        <button type="button" class="icon-button-sm" id="chatClear" title="${escapeHtml(t('chat.clear'))}" aria-label="${escapeHtml(t('chat.clear'))}">
          <i class="bi bi-trash" aria-hidden="true"></i>
        </button>
      </div>
      <div class="chat-messages" id="chatMessages" aria-live="polite"></div>
      <div id="chatNotice"></div>
      <form class="chat-composer" id="chatForm">
        <textarea id="chatInput" class="form-control" rows="1" maxlength="2000" placeholder="${escapeHtml(t('chat.placeholder'))}" aria-label="${escapeHtml(t('chat.placeholder'))}"></textarea>
        <button type="submit" class="btn btn-brand" id="chatSend" aria-label="${escapeHtml(t('chat.send'))}">
          <i class="bi bi-send" aria-hidden="true"></i>
        </button>
      </form>
    </div>`;

  const list = container.querySelector('#chatMessages');
  const form = container.querySelector('#chatForm');
  const input = container.querySelector('#chatInput');
  const clearButton = container.querySelector('#chatClear');

  const setModel = (patch) => {
    Object.assign(model, patch);
    renderMessages(container, model);
    updateComposer(container, model);
    if (clearButton) clearButton.hidden = model.messages.length === 0;
  };

  const load = async () => {
    if (!model.available) {
      renderMessages(container, model);
      updateComposer(container, model);
      return;
    }

    if (cached?.length) {
      renderMessages(container, model);
      updateComposer(container, model);
    } else {
      setModel({ loading: true });
    }

    if (!state.online) {
      setModel({ loading: false });
      return;
    }

    try {
      const data = await api.getChat(serverId);
      const messages = data.messages || [];
      cache.set(serverId, messages);
      setModel({ messages, loading: false, conversationId: data.conversationId });
    } catch (error) {
      setModel({ loading: false });
      if (!cached?.length) {
        list.innerHTML = `<p class="small muted mb-0">${escapeHtml(errorMessage(error))}</p>`;
      }
    }
  };

  const appendMessage = (message) => {
    model.messages.push(message);
    cache.set(serverId, [...model.messages]);
  };

  const send = async () => {
    const text = input.value.trim();
    if (!text || model.busy || !model.available) return;
    if (!state.online) {
      toast(t('chat.offline'), { type: 'warning' });
      return;
    }
    if (state.config?.aiConfigured === false) {
      toast(t('chat.aiDisabled'), { type: 'warning' });
      return;
    }

    model.busy = true;
    input.value = '';
    input.style.height = '';
    const temp = { id: 'temp', role: 'user', content: text, createdAt: new Date().toISOString(), locale: state.language };
    model.messages.push(temp);
    setModel({ typing: true });
    list.scrollTop = list.scrollHeight;

    try {
      const data = await api.sendChatMessage(serverId, text, state.language);
      model.messages = model.messages.filter((message) => message !== temp);
      if (data.userMessage) model.messages.push(data.userMessage);
      if (data.assistantMessage) model.messages.push(data.assistantMessage);
      cache.set(serverId, [...model.messages]);
      setModel({ typing: false, busy: false });
    } catch (error) {
      model.messages = model.messages.filter((message) => message !== temp);
      input.value = text;
      setModel({ typing: false, busy: false });
      toast(errorMessage(error), { type: 'error' });
      updateComposer(container, model);
    }
  };

  const regenerate = async () => {
    if (!model.available || model.busy) return;
    if (!state.online) {
      toast(t('chat.offline'), { type: 'warning' });
      return;
    }
    model.busy = true;
    setModel({ typing: true });

    try {
      const data = await api.regenerateChat(serverId, state.language);
      if (data.removedMessageId) {
        model.messages = model.messages.filter((message) => Number(message.id) !== Number(data.removedMessageId));
      } else {
        const lastAssistantIndex = [...model.messages].reverse().findIndex((message) => message.role === 'assistant');
        if (lastAssistantIndex !== -1) model.messages.splice(model.messages.length - 1 - lastAssistantIndex, 1);
      }
      if (data.assistantMessage) model.messages.push(data.assistantMessage);
      cache.set(serverId, [...model.messages]);
      setModel({ typing: false, busy: false });
    } catch (error) {
      setModel({ typing: false, busy: false });
      toast(errorMessage(error), { type: 'error' });
    }
  };

  const copy = async (index) => {
    const message = model.messages[index];
    if (!message) return;
    const ok = await copyText(message.content);
    if (ok) toast(t('chat.copied'), { type: 'success', timeout: 2000 });
  };

  list.addEventListener('click', (event) => {
    const button = event.target.closest('[data-action]');
    if (!button) return;
    if (button.dataset.action === 'copy') copy(Number(button.dataset.index));
    if (button.dataset.action === 'regenerate') regenerate();
  });

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    send();
  });

  input.addEventListener('input', () => {
    input.style.height = 'auto';
    input.style.height = `${Math.min(140, input.scrollHeight)}px`;
    const button = container.querySelector('#chatSend');
    if (button) button.disabled = !input.value.trim() || model.busy || !model.available;
  });

  input.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      send();
    }
  });

  clearButton?.addEventListener('click', async () => {
    const confirmed = await confirmDialog({
      title: t('chat.clearConfirmTitle'),
      body: t('chat.clearConfirmBody'),
      confirmLabel: t('chat.clear'),
    });
    if (!confirmed) return;
    try {
      if (model.available && state.online) await api.clearChat(serverId);
      model.messages = [];
      cache.delete(serverId);
      setModel({});
      toast(t('chat.cleared'), { type: 'success' });
    } catch (error) {
      toast(errorMessage(error), { type: 'error' });
    }
  });

  const updateConnectivity = () => updateComposer(container, model);
  window.addEventListener('online', updateConnectivity, { signal });
  window.addEventListener('offline', updateConnectivity, { signal });

  if (initialQuestion) {
    input.value = initialQuestion;
    input.style.height = 'auto';
    input.style.height = `${Math.min(140, input.scrollHeight)}px`;
    input.focus();
  }

  if (model.available && !cached && state.online) model.loading = true;
  renderMessages(container, model);
  updateComposer(container, model);
  if (clearButton) clearButton.hidden = model.messages.length === 0;
  load();
}
