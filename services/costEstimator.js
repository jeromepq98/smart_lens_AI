export function estimateCost(kind, tokens, settings) {
  const pricing = settings?.cost || {};
  const isVision = kind === 'vision';
  const inputPerMillion = Number(
    isVision ? pricing.visionInputPer1M : pricing.textInputPer1M,
  ) || 0;
  const outputPerMillion = Number(
    isVision ? pricing.visionOutputPer1M : pricing.textOutputPer1M,
  ) || 0;

  const cost =
    (Number(tokens?.tokensIn || 0) / 1_000_000) * inputPerMillion +
    (Number(tokens?.tokensOut || 0) / 1_000_000) * outputPerMillion;

  return Number(cost.toFixed(6));
}
