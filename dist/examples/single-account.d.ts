/**
 * Example: Single AWS account monitoring (most common setup)
 *
 * Monitors one AWS account and sends Telegram alerts when
 * any service spends 50%+ more than its 7-day average.
 *
 * Usage:
 *   export TELEGRAM_CHAT_ID=-1001234567890
 *   export TELEGRAM_BOT_TOKEN=1234567890:AAxx...
 *   export ARTIFACT_S3_BUCKET=my-stackalert-artifacts
 *   npx ts-node examples/single-account.ts
 *
 * Or deploy via CDK:
 *   cdk deploy --app "npx ts-node examples/single-account.ts"
 */
export {};
