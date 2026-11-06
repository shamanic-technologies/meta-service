import type { NextFunction, Request, Response } from "express";
import { ThreadsApiError } from "../lib/threads-client.js";
import { ThreadsPublishConflictError } from "../lib/threads-publications.js";
import {
  ThreadsInsightsUnavailableError,
  ThreadsReconnectRequiredError,
  ThreadsRequestError,
} from "../lib/threads-accounts.js";

/**
 * Threads failures, typed so a caller learns what is wrong: a login that cannot
 * be finished as asked (400), an account whose login Threads no longer accepts
 * (409, `reason: needs_reconnect`), and Threads refusing a call (502, Threads'
 * own code and message). Anything else falls through to the generic handler.
 */
export function threadsErrorHandler(
  err: Error,
  _req: Request,
  res: Response,
  next: NextFunction,
): void {
  if (err instanceof ThreadsRequestError) {
    res.status(400).json({ error: err.message });
    return;
  }
  if (err instanceof ThreadsReconnectRequiredError) {
    res.status(409).json({
      error: err.message,
      reason: "needs_reconnect",
      accountId: err.accountId,
    });
    return;
  }
  if (err instanceof ThreadsInsightsUnavailableError) {
    res.status(409).json({ error: err.message, reason: err.reason, accountId: err.accountId });
    return;
  }
  if (err instanceof ThreadsPublishConflictError) {
    res.status(409).json({
      error: err.message,
      reason: err.reason,
      publicationId: err.publicationId,
    });
    return;
  }
  if (err instanceof ThreadsApiError) {
    console.error("Threads API error:", err.message, err.threadsError);
    res.status(502).json({
      error: err.message,
      details: { operation: err.operation, threads: err.threadsError },
    });
    return;
  }
  next(err);
}
