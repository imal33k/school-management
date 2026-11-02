import {
  BadGatewayException,
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common';

interface PaystackInitializeResult {
  authorization_url: string;
  access_code: string;
  reference: string;
}

interface PaystackVerifyResult {
  reference: string;
  status: string;
  amount: number;
  gateway_response?: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

@Injectable()
export class PaystackService {
  private getSecretKey() {
    const key = process.env.PAYSTACK_SECRET_KEY;
    if (!key) {
      throw new ServiceUnavailableException('Paystack is not configured');
    }
    return key;
  }

  private async request(
    path: string,
    method: 'GET' | 'POST',
    body?: Record<string, unknown>,
  ): Promise<Record<string, unknown>> {
    const secretKey = this.getSecretKey();
    let response: Response;

    try {
      response = await fetch(`https://api.paystack.co${path}`, {
        method,
        headers: {
          Authorization: `Bearer ${secretKey}`,
          'Content-Type': 'application/json',
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
        signal: AbortSignal.timeout(10_000),
      });
    } catch (error) {
      throw new ServiceUnavailableException('Unable to reach Paystack', {
        cause: error,
      });
    }

    let responseBody: unknown;
    try {
      responseBody = await response.json();
    } catch (error) {
      throw new BadGatewayException('Paystack returned an invalid response', {
        cause: error,
      });
    }

    if (!isRecord(responseBody)) {
      throw new BadGatewayException('Paystack returned an invalid response');
    }

    if (
      !response.ok ||
      responseBody.status !== true ||
      !isRecord(responseBody.data)
    ) {
      const message =
        typeof responseBody.message === 'string'
          ? responseBody.message
          : 'Paystack request failed';
      throw new BadGatewayException(message);
    }

    return responseBody.data;
  }

  async initialize(input: {
    email: string;
    amount: number;
    reference: string;
    callbackUrl?: string;
    metadata?: Record<string, unknown>;
    subaccountCode?: string;
  }): Promise<PaystackInitializeResult> {
    if (!Number.isFinite(input.amount) || input.amount <= 0) {
      throw new BadGatewayException('Payment amount must be positive');
    }

    const data = await this.request('/transaction/initialize', 'POST', {
      email: input.email,
      amount: Math.round(input.amount * 100),
      reference: input.reference,
      callback_url: input.callbackUrl,
      metadata: input.metadata,
      ...(input.subaccountCode
        ? {
            subaccount: input.subaccountCode,
            bearer: 'subaccount',
          }
        : {}),
    });

    if (
      typeof data.authorization_url !== 'string' ||
      typeof data.access_code !== 'string' ||
      typeof data.reference !== 'string'
    ) {
      throw new BadGatewayException(
        'Paystack returned an incomplete initialization response',
      );
    }

    return {
      authorization_url: data.authorization_url,
      access_code: data.access_code,
      reference: data.reference,
    };
  }

  async createSubaccount(input: {
    businessName: string;
    settlementBank: string;
    accountNumber: string;
  }): Promise<string> {
    const data = await this.request('/subaccount', 'POST', {
      business_name: input.businessName,
      settlement_bank: input.settlementBank,
      account_number: input.accountNumber,
      percentage_charge: 0,
    });

    if (typeof data.subaccount_code !== 'string') {
      throw new BadGatewayException(
        'Paystack returned an incomplete subaccount response',
      );
    }

    return data.subaccount_code;
  }

  async verify(reference: string): Promise<PaystackVerifyResult> {
    const data = await this.request(
      `/transaction/verify/${encodeURIComponent(reference)}`,
      'GET',
    );

    if (
      typeof data.reference !== 'string' ||
      typeof data.status !== 'string' ||
      typeof data.amount !== 'number'
    ) {
      throw new BadGatewayException(
        'Paystack returned an incomplete verification response',
      );
    }

    return {
      reference: data.reference,
      status: data.status,
      amount: data.amount,
      ...(typeof data.gateway_response === 'string'
        ? { gateway_response: data.gateway_response }
        : {}),
    };
  }
}
