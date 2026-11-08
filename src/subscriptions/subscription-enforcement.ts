export function isSubscriptionEnforcementBypassed(): boolean {
  return process.env.BYPASS_SUBSCRIPTION_CHECK === 'true';
}
