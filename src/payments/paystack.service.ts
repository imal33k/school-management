import { BadGatewayException, Injectable, ServiceUnavailableException } from '@nestjs/common';

@Injectable()
export class PaystackService {
  private get secretKey() {
    return process.env.PAYSTACK_SECRET_KEY;
  }

  private ensureConfigured() {
    if (!this.secretKey) throw new ServiceUnavailableException('Paystack is not configured');
  }

  async initialize(input: { email: string; amount: number; reference: string; callbackUrl?: string; metadata?: Record<string, unknown> }) {
    this.ensureConfigured();
    const response = await fetch('https://api.paystack.co/transaction/initialize', {
      method: 'POST',
      headers: { Authorization: `Bearer ${this.secretKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: input.email,
        amount: Math.round(input.amount * 100),
        reference: input.reference,
        callback_url: input.callbackUrl,
        metadata: input.metadata,
      }),
    });
    const body: any = await response.json().catch(() => ({}));
    if (!response.ok || !body.status) throw new BadGatewayException(body.message || 'Paystack initialization failed');
    return body.data;
  }

  async verify(reference: string) {
    this.ensureConfigured();
    const response = await fetch(`https://api.paystack.co/transaction/verify/${encodeURIComponent(reference)}`, {
      headers: { Authorization: `Bearer ${this.secretKey}` },
    });
    const body: any = await response.json().catch(() => ({}));
    if (!response.ok || !body.status) throw new BadGatewayException(body.message || 'Paystack verification failed');
    return body.data;
  }
}
