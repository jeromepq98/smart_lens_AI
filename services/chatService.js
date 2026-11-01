import { withTransaction } from '../config/db.js';
import * as messageModel from '../models/message.js';
import * as conversationModel from '../models/conversation.js';
import * as scanModel from '../models/scan.js';
import { getScanContext } from './scanService.js';
import { getEffectiveSettings } from './settingsService.js';
import { answerFollowUp } from './geminiChat.js';
import { recordAiUsage } from './geminiClient.js';
import { hashIp } from '../utils/hash.js';
import { normalizeLanguage } from '../utils/language.js';
import { badRequest, conflict, notFound } from '../utils/errors.js';

export async function getChat({ scanId, sessionId }) {
  const scan = await scanModel.findByIdForSession(scanId, sessionId);
  if (!scan) throw notFound('Scan not found.');

  const conversation = await conversationModel.findByScanId(scanId);
  if (!conversation) {
    return { scanId, conversationId: null, messages: [] };
  }

  const messages = await messageModel.listByConversation(conversation.id);
  return {
    scanId,
    conversationId: conversation.id,
    messages: messages.map(messageModel.mapMessage),
  };
}

export async function sendMessage({ scanId, sessionId, content, language, ip }) {
  const trimmed = String(content || '').trim();
  if (!trimmed) throw badRequest('The message cannot be empty.');

  const settings = await getEffectiveSettings();
  const { aiResult, recommendations } = await getScanContext(scanId, sessionId);
  const locale = normalizeLanguage(language, aiResult.locale);

  const conversation = await withTransaction((connection) =>
    conversationModel.ensure(connection, scanId, sessionId),
  );

  let userMessage = null;
  try {
    userMessage = await messageModel.add({
      conversationId: conversation.id,
      role: 'user',
      content: trimmed,
      locale,
    });

    const historyRows = await messageModel.listRecent(conversation.id, 20);
    const answer = await answerFollowUp({
      aiResult,
      recommendations,
      history: historyRows.map((row) => ({ role: row.role, content: row.content })),
      language: locale,
      settings,
    });

    const assistantMessage = await messageModel.add({
      conversationId: conversation.id,
      role: 'assistant',
      content: answer.content,
      locale,
      model: answer.model,
      tokensIn: answer.usage.tokensIn,
      tokensOut: answer.usage.tokensOut,
    });
    await conversationModel.touch(null, conversation.id);

    await recordAiUsage({
      sessionId,
      scanId,
      kind: 'chat',
      endpoint: '/api/chat/:scanId/messages',
      model: answer.model,
      tokensIn: answer.usage.tokensIn,
      tokensOut: answer.usage.tokensOut,
      status: 'success',
      latencyMs: answer.latencyMs,
      ipHash: hashIp(ip),
      settings,
    });

    return {
      conversationId: conversation.id,
      userMessage: messageModel.mapMessage(userMessage),
      assistantMessage: messageModel.mapMessage(assistantMessage),
    };
  } catch (error) {
    if (userMessage) await messageModel.removeById(userMessage.id).catch(() => {});

    await recordAiUsage({
      sessionId,
      scanId,
      kind: 'chat',
      endpoint: '/api/chat/:scanId/messages',
      model: settings.ai.textModel,
      tokensIn: error.usage?.tokensIn || 0,
      tokensOut: error.usage?.tokensOut || 0,
      status: 'error',
      errorCode: error.code || 'CHAT_FAILED',
      ipHash: hashIp(ip),
      settings,
    });

    throw error;
  }
}

export async function regenerateAnswer({ scanId, sessionId, language, ip }) {
  const settings = await getEffectiveSettings();
  const { aiResult, recommendations } = await getScanContext(scanId, sessionId);
  const conversation = await conversationModel.findByScanId(scanId);
  if (!conversation) throw conflict('Start a conversation before regenerating an answer.');

  const removed = await messageModel.removeLastAssistant(conversation.id);
  const historyRows = await messageModel.listRecent(conversation.id, 20);
  const last = historyRows[historyRows.length - 1];

  if (!last || last.role !== 'user') {
    if (removed) {
      await messageModel.add({
        conversationId: conversation.id,
        role: 'assistant',
        content: removed.content,
        locale: removed.locale,
        model: removed.model,
        tokensIn: removed.tokens_in,
        tokensOut: removed.tokens_out,
      });
    }
    throw conflict('Ask a question before regenerating an answer.');
  }

  const locale = normalizeLanguage(language || last.locale, aiResult.locale);

  try {
    const answer = await answerFollowUp({
      aiResult,
      recommendations,
      history: historyRows.map((row) => ({ role: row.role, content: row.content })),
      language: locale,
      settings,
    });

    const assistantMessage = await messageModel.add({
      conversationId: conversation.id,
      role: 'assistant',
      content: answer.content,
      locale,
      model: answer.model,
      tokensIn: answer.usage.tokensIn,
      tokensOut: answer.usage.tokensOut,
    });
    await conversationModel.touch(null, conversation.id);

    await recordAiUsage({
      sessionId,
      scanId,
      kind: 'chat',
      endpoint: '/api/chat/:scanId/regenerate',
      model: answer.model,
      tokensIn: answer.usage.tokensIn,
      tokensOut: answer.usage.tokensOut,
      status: 'success',
      latencyMs: answer.latencyMs,
      ipHash: hashIp(ip),
      settings,
    });

    return {
      conversationId: conversation.id,
      removedMessageId: removed ? Number(removed.id) : null,
      assistantMessage: messageModel.mapMessage(assistantMessage),
    };
  } catch (error) {
    if (removed) {
      await messageModel
        .add({
          conversationId: conversation.id,
          role: 'assistant',
          content: removed.content,
          locale: removed.locale,
          model: removed.model,
          tokensIn: removed.tokens_in,
          tokensOut: removed.tokens_out,
        })
        .catch(() => {});
    }

    await recordAiUsage({
      sessionId,
      scanId,
      kind: 'chat',
      endpoint: '/api/chat/:scanId/regenerate',
      model: settings.ai.textModel,
      tokensIn: error.usage?.tokensIn || 0,
      tokensOut: error.usage?.tokensOut || 0,
      status: 'error',
      errorCode: error.code || 'REGENERATE_FAILED',
      ipHash: hashIp(ip),
      settings,
    });

    throw error;
  }
}

export async function clearChat({ scanId, sessionId }) {
  const scan = await scanModel.findByIdForSession(scanId, sessionId);
  if (!scan) throw notFound('Scan not found.');

  const conversation = await conversationModel.findByScanId(scanId);
  if (conversation) {
    await conversationModel.removeByScanId(scanId);
  }
}
