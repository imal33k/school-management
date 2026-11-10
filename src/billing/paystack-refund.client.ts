import { BadGatewayException, Injectable, ServiceUnavailableException } from '@nestjs/common';

// Asks Paystack to send a customer's money back.
// Kept apart from the payment code so that file is not touched.
@Injectable()
export class PaystackRefundClient {
  async refund(input: { transaction: string; reason: string }): Promise<{ id: string; status: string }> {
    const key = process.env.PAYSTACK_SECRET_KEY;

    if (!key) {
      throw new ServiceUnavailableException('Paystack is not configured');
    }

    let response: Response;

    try {
      response = await fetch('https://api.paystack.co/refund', {
        method: 'POST',
        headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ transaction: input.transaction, merchant_note: input.reason }),
        signal: AbortSignal.timeout(15_000),
      });
    } catch (error) {
      throw new ServiceUnavailableException('Unable to reach Paystack', { cause: error });
    }

    let body: any;

    try {
      body = await response.json();
    } catch {
      throw new BadGatewayException('Paystack returned an unreadable response');
    }

    if (!response.ok || !body?.status || !body?.data) {
      throw new BadGatewayException(body?.message || 'Paystack did not accept the refund');
    }

    return { id: String(body.data.id ?? ''), status: String(body.data.status ?? 'pending') };
  }
}
