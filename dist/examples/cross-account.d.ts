/**
 * Example: Cross-account monitoring
 *
 * StackAlert Lambda runs in account A and assumes a role in account B
 * to read Cost Explorer data. Useful for centralized monitoring or
 * when you want to monitor production from a tooling account.
 *
 * Prerequisites:
 *   1. Create a read-only IAM role in account B:
 *      - Trust: allow account A to assume it
 *      - Policy: ce:GetCostAndUsage on *
 *
 * Usage:
 *   export TELEGRAM_CHAT_ID=-1001234567890
 *   export TELEGRAM_BOT_TOKEN=1234567890:AAxx...
 *   export ARTIFACT_S3_BUCKET=my-stackalert-artifacts
 *   export CROSS_ACCOUNT_ROLE_ARN=arn:aws:iam::TARGET_ACCOUNT:role/stackalert-cost-reader
 *   cdk deploy --app "npx ts-node examples/cross-account.ts"
 */
export {};
