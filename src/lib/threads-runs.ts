/**
 * Every Threads call made for a connected account outside a request (the post import, the
 * insights read, the token refresh) runs on a run of the CONNECTING org (OUTCOME-FINEST-1106,
 * owner 2026-11-06: « le coût est facturé à l'org pas à nous »). No request carries an identity
 * there, so it comes from the account row: its org, its brand, the user who connected it. The
 * Threads API is free, so these runs carry no cost line: they are the org's record that the work
 * happened, and the place any future cost of it lands.
 */
import type { ThreadsAccount } from "../db/schema.js";
import { completeRun, createRun } from "./services.js";

export const SERVICE_NAME = "meta-service";

/** The identity a run for this account is opened with: the account row's, never ours. */
export function accountRunIdentity(account: ThreadsAccount) {
  return {
    orgId: account.orgId,
    userId: account.connectedByUserId,
    brandId: account.brandId,
    serviceName: SERVICE_NAME,
  };
}

/** Opens a run of the account's org, runs `work` on it, closes it completed or failed. */
export async function onAccountRun<T>(
  account: ThreadsAccount,
  taskName: string,
  work: (runId: string) => Promise<T>,
  opts: { parentRunId?: string; idempotencyKey?: string } = {},
): Promise<T> {
  const run = await createRun(
    { ...accountRunIdentity(account), taskName, ...(opts.parentRunId ? { parentRunId: opts.parentRunId } : {}) },
    opts.idempotencyKey,
  );
  try {
    const out = await work(run.id);
    await completeRun(run.id, "completed").catch((err) =>
      console.error(`[meta-service] run ${run.id} (${taskName}) not closed:`, err instanceof Error ? err.message : err),
    );
    return out;
  } catch (err) {
    await completeRun(run.id, "failed", (err instanceof Error ? err.message : String(err)).slice(0, 500)).catch(() => {});
    throw err;
  }
}
