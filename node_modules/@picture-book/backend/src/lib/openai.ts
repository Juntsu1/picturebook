import OpenAI from 'openai';
import https from 'node:https';
import http from 'node:http';

/**
 * Convert any fetch body type to a Buffer before sending through the proxy tunnel.
 * This handles string, Uint8Array, ArrayBuffer, Blob, ReadableStream, and FormData.
 */
async function bodyToBuffer(body: BodyInit | null | undefined): Promise<Buffer | null> {
  if (!body) return null;
  if (typeof body === 'string') return Buffer.from(body);
  if (body instanceof Uint8Array) return Buffer.from(body);
  if (body instanceof ArrayBuffer) return Buffer.from(new Uint8Array(body));
  // FormData: convert via Request to get the properly encoded multipart body
  if (typeof FormData !== 'undefined' && body instanceof FormData) {
    const tempReq = new Request('http://localhost', { method: 'POST', body });
    const arrayBuf = await tempReq.arrayBuffer();
    return Buffer.from(new Uint8Array(arrayBuf));
  }
  if (typeof Blob !== 'undefined' && body instanceof Blob) {
    const arrayBuf = await body.arrayBuffer();
    return Buffer.from(new Uint8Array(arrayBuf));
  }
  if (typeof body === 'object' && typeof (body as ReadableStream).getReader === 'function') {
    const reader = (body as ReadableStream<Uint8Array>).getReader();
    const chunks: Uint8Array[] = [];
    let done = false;
    while (!done) {
      const result = await reader.read();
      done = result.done;
      if (result.value) chunks.push(result.value);
    }
    return Buffer.concat(chunks);
  }
  return null;
}

export function createOpenAIClient(): OpenAI {
  const proxyUrl = process.env.HTTPS_PROXY || process.env.HTTP_PROXY;

  if (!proxyUrl) {
    return new OpenAI({
      apiKey: process.env.OPENAI_API_KEY,
      timeout: 120_000,
    });
  }

  console.log(`[openai] プロキシ使用: ${proxyUrl}`);
  const proxyParsed = new URL(proxyUrl);

  // Custom fetch that tunnels through the corporate proxy using HTTP CONNECT
  const proxyFetch: typeof globalThis.fetch = async (input, init) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : (input as Request).url;
    const targetUrl = new URL(url);

    // Pre-convert body to Buffer so we don't need async inside the callback
    // For FormData, we also need to capture the correct Content-Type with boundary
    let bodyBuffer: Buffer | null = null;
    let formDataContentType: string | null = null;

    if (init?.body && typeof FormData !== 'undefined' && init.body instanceof FormData) {
      // FormData needs special handling: convert via Request to get proper multipart encoding
      const tempReq = new Request('http://localhost', { method: 'POST', body: init.body });
      formDataContentType = tempReq.headers.get('content-type');
      const arrayBuf = await tempReq.arrayBuffer();
      bodyBuffer = Buffer.from(new Uint8Array(arrayBuf));
    } else {
      bodyBuffer = await bodyToBuffer(init?.body);
    }

    return new Promise<Response>((resolve, reject) => {
      // Step 1: Send CONNECT request to proxy
      const connectReq = http.request({
        host: proxyParsed.hostname,
        port: Number(proxyParsed.port),
        method: 'CONNECT',
        path: `${targetUrl.hostname}:${targetUrl.port || 443}`,
      });

      connectReq.on('connect', (_res, socket) => {
        // Step 2: Build headers, replacing Content-Type for FormData if needed
        const rawHeaders = init?.headers instanceof Headers
          ? Object.fromEntries(init.headers.entries())
          : { ...((init?.headers as Record<string, string>) ?? {}) };

        if (formDataContentType) {
          rawHeaders['content-type'] = formDataContentType;
        }

        // Step 3: Make HTTPS request through the tunnel
        const tlsOptions = {
          hostname: targetUrl.hostname,
          port: Number(targetUrl.port) || 443,
          path: targetUrl.pathname + targetUrl.search,
          method: (init?.method ?? 'GET').toUpperCase(),
          headers: rawHeaders,
          socket,
          agent: false as const,
        } satisfies Record<string, unknown>;

        const req = https.request(tlsOptions, (res) => {
          const chunks: Buffer[] = [];
          res.on('data', (chunk: Buffer) => chunks.push(chunk));
          res.on('end', () => {
            const body = Buffer.concat(chunks);
            const headers = new Headers();
            for (const [key, value] of Object.entries(res.headers)) {
              if (value) {
                const vals = Array.isArray(value) ? value : [value];
                for (const v of vals) headers.append(key, v);
              }
            }
            resolve(new Response(body, {
              status: res.statusCode ?? 500,
              statusText: res.statusMessage ?? '',
              headers,
            }));
          });
        });

        req.on('error', reject);
        req.setTimeout(120_000, () => req.destroy(new Error('Request timed out')));

        if (bodyBuffer) {
          req.write(bodyBuffer);
        }
        req.end();
      });

      connectReq.on('error', reject);
      connectReq.setTimeout(30_000, () => connectReq.destroy(new Error('Proxy CONNECT timed out')));
      connectReq.end();
    });
  };

  return new OpenAI({
    apiKey: process.env.OPENAI_API_KEY,
    timeout: 120_000,
    fetch: proxyFetch,
  });
}
