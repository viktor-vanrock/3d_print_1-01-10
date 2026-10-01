import type { Response } from "express";

export async function streamSseEvents(response: Response, source: AsyncIterable<string>, onError?: (error: unknown) => void): Promise<void> {
  const iterator = source[Symbol.asyncIterator]();
  let first: IteratorResult<string>;
  try {
    first = await iterator.next();
  } catch (error) {
    onError?.(error);
    response.destroy();
    return;
  }
  if (first.done || response.destroyed) {
    response.destroy();
    try {
      await iterator.return?.();
    } catch {
      // The connection is already closed.
    }
    return;
  }
  response.status(200);
  response.setHeader("Content-Type", "text/event-stream; charset=utf-8");
  response.setHeader("Cache-Control", "no-cache, no-transform");
  response.setHeader("Connection", "keep-alive");
  response.setHeader("X-Accel-Buffering", "no");
  response.flushHeaders();
  const keepAlive = setInterval(() => {
    if (!response.destroyed && !response.writableEnded) response.write(": keep-alive\n\n");
  }, 25_000);
  keepAlive.unref();
  try {
    response.write(first.value);
    while (!response.destroyed) {
      const next = await iterator.next();
      if (next.done) break;
      response.write(next.value);
    }
  } catch (error) {
    onError?.(error);
    response.destroy();
  } finally {
    clearInterval(keepAlive);
    try {
      await iterator.return?.();
    } catch {
      response.destroy();
    }
    if (!response.destroyed && !response.writableEnded) response.end();
  }
}
