const BODY_READ_TIMEOUT_MS = 10000;

export class RequestBodyError extends Error {
  constructor(readonly reason: 'invalid' | 'too_large' | 'timeout') {
    super('The request body could not be read.');
  }
}

export async function readRequestBody(request: Request, limit: number, timeoutMs = BODY_READ_TIMEOUT_MS) {
  const length = request.headers.get('content-length');
  if (length !== null && !/^\d+$/.test(length)) throw new RequestBodyError('invalid');
  if (length !== null && Number(length) > limit) throw new RequestBodyError('too_large');
  const reader = request.body?.getReader();
  if (!reader) throw new RequestBodyError('invalid');
  let timedOut = false;
  const timeout = setTimeout(() => {
    timedOut = true;
    void reader.cancel().catch(() => {});
  }, timeoutMs);
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const part = await reader.read();
      if (timedOut) throw new RequestBodyError('timeout');
      if (part.done) break;
      size += part.value.byteLength;
      if (size > limit) throw new RequestBodyError('too_large');
      chunks.push(part.value);
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return bytes;
  } catch (error) {
    if (!timedOut) void reader.cancel().catch(() => {});
    throw error instanceof RequestBodyError ? error : new RequestBodyError('invalid');
  } finally {
    clearTimeout(timeout);
    reader.releaseLock();
  }
}
