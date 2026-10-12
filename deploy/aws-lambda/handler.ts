import '../shared/node-binding.js';
import { handleAgentRequest, json, type ReceiverEnvironment } from '../shared/receiver.js';

export interface LambdaEvent {
  httpMethod: string;
  path: string;
  headers: Record<string, string | undefined>;
  body: string | null;
  isBase64Encoded: boolean;
  queryStringParameters?: Record<string, string | undefined> | null;
}
export function createHandler(env: ReceiverEnvironment) {
  return async (event: LambdaEvent) => {
    const headers = new Headers();
    for (const [name, value] of Object.entries(event.headers)) if (value !== undefined) headers.set(name, value);
    let response: Response;
    try {
      if (event.body && event.body.length > 24_000) response = json({ error: 'body_too_large' }, 413);
      else {
        const body = event.body === null ? undefined : Buffer.from(event.body, event.isBase64Encoded ? 'base64' : 'utf8');
        const url = new URL(event.path, 'https://lambda.openagent.invalid');
        response = await handleAgentRequest(new Request(url, { method: event.httpMethod, headers,
          ...(!['GET', 'HEAD'].includes(event.httpMethod) && body !== undefined ? { body: new Uint8Array(body) } : {}),
        }), env);
      }
    } catch { response = json({ error: 'invalid_request' }, 400); }
    return { statusCode: response.status, headers: Object.fromEntries(response.headers), body: await response.text(), isBase64Encoded: false };
  };
}
export const handler = createHandler(process.env);
