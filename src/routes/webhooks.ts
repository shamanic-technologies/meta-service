import { Router } from "express";

const router = Router();

// GET /webhooks/meta — Webhook verification
router.get("/webhooks/meta", (req, res) => {
  const mode = req.query["hub.mode"] as string;
  const token = req.query["hub.verify_token"] as string;
  const challenge = req.query["hub.challenge"] as string;

  const verifyToken = process.env.META_WEBHOOK_VERIFY_TOKEN;

  if (mode === "subscribe" && token === verifyToken) {
    res.status(200).send(challenge);
    return;
  }

  res.status(403).json({ error: "Verification failed" });
});

// POST /webhooks/meta — Receive webhook events
router.post("/webhooks/meta", (req, res) => {
  const { object, entry } = req.body as {
    object: string;
    entry: Array<{
      id: string;
      time: number;
      changes?: Array<{ field: string; value: unknown }>;
    }>;
  };

  console.log(
    `[meta-service] Webhook received: object=${object}, entries=${entry?.length ?? 0}`,
  );

  // Acknowledge immediately — process asynchronously if needed
  res.status(200).json({ received: true });
});

export default router;
