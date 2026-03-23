# stackalert-cdk

AWS CDK v2 (TypeScript) infrastructure for [StackAlert](https://github.com/stackalertapp/stackalert-lambda) — AWS cost spike detection via Telegram.

## Resources Created

| Resource | Description |
|---|---|
| `Lambda::Function` | StackAlert Rust Lambda (arm64, provided.al2023) |
| `IAM::Role` | Least-privilege execution role |
| `Events::Rule` × 2 | Spike check (every 6h) + daily digest (08:00 UTC) |
| `SSM::Parameter` | Telegram bot token (SecureString) |
| `Logs::LogGroup` | JSON-structured Lambda logs (30-day retention) |

## Prerequisites

1. **Node.js 22+** and **AWS CDK CLI** (`npm install -g aws-cdk`)
2. **Lambda artifact in S3** — built by [stackalert-lambda CI](https://github.com/stackalertapp/stackalert-lambda)
3. **CDK Bootstrap** — run once per account/region: `cdk bootstrap aws://ACCOUNT/eu-central-1`

## Quick Start

```bash
npm install

# Set required environment variables
export ARTIFACT_S3_BUCKET=my-stackalert-artifacts
export TELEGRAM_CHAT_ID=-1001234567890
export TELEGRAM_BOT_TOKEN=1234567890:AAXXXXXXXX

# Synthesize CloudFormation template (no AWS calls)
npm run synth

# Deploy
npm run deploy
```

## Configuration

| Environment Variable | Required | Default | Description |
|---|---|---|---|
| `ARTIFACT_S3_BUCKET` | ✅ | — | S3 bucket with Lambda ZIP |
| `ARTIFACT_S3_KEY` | ❌ | `stackalert-lambda/latest.zip` | S3 key for ZIP artifact |
| `TELEGRAM_CHAT_ID` | ✅ | — | Telegram chat/group ID |
| `TELEGRAM_BOT_TOKEN` | ✅ | — | Telegram bot token |
| `SPIKE_THRESHOLD_PCT` | ❌ | `50` | Alert threshold percentage |
| `CROSS_ACCOUNT_ROLE_ARN` | ❌ | — | IAM role for cross-account monitoring |
| `ENVIRONMENT` | ❌ | `prod` | Deployment environment name |

## Testing

```bash
npm test
```

Tests use the [AWS CDK assertions library](https://docs.aws.amazon.com/cdk/api/v2/docs/aws-cdk-lib.assertions-readme.html) to validate the generated CloudFormation template — no AWS account needed.

## Manual Invocation

```bash
# Spike check
aws lambda invoke \
  --function-name stackalert-prod \
  --payload '{"mode":"spike"}' \
  --cli-binary-format raw-in-base64-out \
  /tmp/out.json && cat /tmp/out.json

# Daily digest
aws lambda invoke \
  --function-name stackalert-prod \
  --payload '{"mode":"digest"}' \
  --cli-binary-format raw-in-base64-out \
  /tmp/out.json && cat /tmp/out.json
```
