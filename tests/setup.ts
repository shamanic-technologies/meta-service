// Set env vars before any src/ module is imported
process.env.META_SERVICE_DATABASE_URL =
  process.env.META_SERVICE_DATABASE_URL ||
  "postgresql://test:test@localhost:5432/test";
process.env.META_SERVICE_ENCRYPTION_KEY =
  "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
process.env.META_SERVICE_API_KEY = "test-service-key";
process.env.META_APP_ID = "test-meta-app-id";
process.env.META_APP_SECRET = "test-meta-app-secret";
process.env.META_WEBHOOK_VERIFY_TOKEN = "test-webhook-token";
process.env.NODE_ENV = "test";

// Silence startup registration warnings in tests
process.env.RUNS_SERVICE_URL = "http://localhost:9999";
process.env.RUNS_SERVICE_API_KEY = "test-runs-key";
process.env.COSTS_SERVICE_URL = "http://localhost:9999";
process.env.COSTS_SERVICE_API_KEY = "test-costs-key";
process.env.KEY_SERVICE_URL = "http://localhost:9999";
process.env.KEY_SERVICE_API_KEY = "test-key-service-key";
process.env.TRANSACTIONAL_EMAIL_SERVICE_URL = "http://localhost:9999";
process.env.TRANSACTIONAL_EMAIL_SERVICE_API_KEY = "test-email-key";
