import type { Request, Response, NextFunction } from "express";

export function serviceKeyAuth(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  const serviceKey = process.env.META_SERVICE_API_KEY;

  if (!serviceKey) {
    console.error("[meta-service] META_SERVICE_API_KEY not configured");
    res.status(500).json({ error: "Service not configured" });
    return;
  }

  const providedKey = req.headers["x-api-key"];
  if (!providedKey || providedKey !== serviceKey) {
    res.status(401).json({ error: "Invalid service key" });
    return;
  }

  next();
}
