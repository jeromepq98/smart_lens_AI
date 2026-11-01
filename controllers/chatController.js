import * as chatService from '../services/chatService.js';

export async function getChat(req, res) {
  const data = await chatService.getChat({
    scanId: req.validatedParams.scanId,
    sessionId: req.anonymousSessionId,
  });
  res.json({ data });
}

export async function sendMessage(req, res) {
  const data = await chatService.sendMessage({
    scanId: req.validatedParams.scanId,
    sessionId: req.anonymousSessionId,
    content: req.body.content,
    language: req.body.language,
    ip: req.ip,
  });
  res.status(201).json({ data });
}

export async function regenerateAnswer(req, res) {
  const data = await chatService.regenerateAnswer({
    scanId: req.validatedParams.scanId,
    sessionId: req.anonymousSessionId,
    language: req.body.language,
    ip: req.ip,
  });
  res.json({ data });
}

export async function clearChat(req, res) {
  await chatService.clearChat({
    scanId: req.validatedParams.scanId,
    sessionId: req.anonymousSessionId,
  });
  res.status(204).end();
}
