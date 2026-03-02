import type { Request, Response, NextFunction } from "express";

export interface IdentityLocals {
  orgId: string;
  userId: string;
}

export function requireIdentity(
  req: Request,
  res: Response<unknown, IdentityLocals>,
  next: NextFunction,
): void {
  const orgId = req.headers["x-org-id"] as string | undefined;
  const userId = req.headers["x-user-id"] as string | undefined;

  if (!orgId || !userId) {
    res.status(400).json({
      error: "Missing required headers: x-org-id and x-user-id",
    });
    return;
  }

  res.locals.orgId = orgId;
  res.locals.userId = userId;
  next();
}
