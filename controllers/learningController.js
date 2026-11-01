import * as learningService from '../services/learningService.js';

export async function generateLearning(req, res) {
  const data = await learningService.generateLearning({
    scanId: req.validatedParams.id,
    sessionId: req.anonymousSessionId,
    level: req.body.level,
    language: req.body.language,
    ip: req.ip,
  });
  res.json({ data });
}
