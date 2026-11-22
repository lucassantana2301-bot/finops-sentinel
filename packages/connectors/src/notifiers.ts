import { createHmac } from 'node:crypto';
import { renderAlertText, type AlertEvent, type Notifier, type Severity } from '@fns/core';
import { fetchWithRetry, type RetryOptions } from './http.js';

function assertWebhookUrl(raw: string, allowInsecure: boolean): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error('URL de webhook inválida');
  }
  const local = url.hostname === 'localhost' || url.hostname === '127.0.0.1';
  if (url.protocol !== 'https:' && !(allowInsecure && local)) {
    throw new Error('webhook precisa usar HTTPS');
  }
  return url;
}

const EMOJI: Record<Severity, string> = {
  low: ':information_source:',
  medium: ':warning:',
  high: ':rotating_light:',
  critical: ':fire:',
};
const MAX_BLOCKS = 20;

/**
 * Slack Incoming Webhook. A URL é um segredo (quem tem a URL posta no canal), então nunca vai para log
 * nem para mensagem de erro.
 */
export class SlackNotifier implements Notifier {
  readonly name = 'slack';
  private readonly url: URL;

  constructor(
    webhookUrl: string,
    private readonly http: RetryOptions = {},
  ) {
    this.url = assertWebhookUrl(webhookUrl, false);
    if (this.url.hostname !== 'hooks.slack.com') throw new Error('webhook do Slack deve apontar para hooks.slack.com');
  }

  async send(events: readonly AlertEvent[], context: { currency: string }): Promise<void> {
    if (events.length === 0) return;
    const shown = events.slice(0, MAX_BLOCKS);
    const blocks: unknown[] = [
      { type: 'header', text: { type: 'plain_text', text: `FinOps Sentinel: ${events.length} alerta(s) de custo` } },
      ...shown.map((event) => ({
        type: 'section',
        text: { type: 'mrkdwn', text: `${EMOJI[event.severity]} ${renderAlertText(event, context.currency)}` },
      })),
    ];
    if (events.length > shown.length) {
      blocks.push({
        type: 'context',
        elements: [{ type: 'mrkdwn', text: `+${events.length - shown.length} alerta(s) no painel` }],
      });
    }
    const response = await fetchWithRetry(
      this.url.toString(),
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ text: `${events.length} alerta(s) de custo`, blocks }),
      },
      this.http,
    ).catch((error: unknown) => {
      throw new Error(`Slack recusou a mensagem (${error instanceof Error ? error.message : 'erro de rede'})`);
    });
    await response.body?.cancel();
  }
}

/**
 * Webhook genérico (n8n, Teams via Power Automate, PagerDuty Events, Lambda...). Com `secret`, assina o
 * corpo com HMAC-SHA256 no cabeçalho `X-FinOps-Signature: sha256=<hex>` para o receptor validar a origem.
 */
export class WebhookNotifier implements Notifier {
  readonly name = 'webhook';
  private readonly url: URL;

  constructor(
    webhookUrl: string,
    private readonly options: { secret?: string; allowInsecureLocalhost?: boolean; http?: RetryOptions } = {},
  ) {
    this.url = assertWebhookUrl(webhookUrl, options.allowInsecureLocalhost ?? false);
  }

  async send(events: readonly AlertEvent[], context: { currency: string }): Promise<void> {
    if (events.length === 0) return;
    const body = JSON.stringify({
      source: 'finops-sentinel',
      sentAt: new Date().toISOString(),
      currency: context.currency,
      events: events.map((event) => ({
        kind: event.kind,
        severity: event.severity,
        dedupKey: event.dedupKey,
        text: renderAlertText(event, context.currency),
        data:
          event.kind === 'anomaly' ? event.anomaly : { budget: event.status.budget, forecast: event.status.forecast },
      })),
    });
    const headers: Record<string, string> = { 'content-type': 'application/json' };
    if (this.options.secret) {
      headers['x-finops-signature'] = `sha256=${createHmac('sha256', this.options.secret).update(body).digest('hex')}`;
    }
    const response = await fetchWithRetry(
      this.url.toString(),
      { method: 'POST', headers, body },
      this.options.http,
    ).catch((error: unknown) => {
      throw new Error(`webhook recusou a mensagem (${error instanceof Error ? error.message : 'erro de rede'})`);
    });
    await response.body?.cancel();
  }
}
