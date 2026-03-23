# stackalert-cdk

[![CI](https://github.com/stackalertapp/stackalert-cdk/actions/workflows/ci.yml/badge.svg)](https://github.com/stackalertapp/stackalert-cdk/actions/workflows/ci.yml)
[![Deploy](https://github.com/stackalertapp/stackalert-cdk/actions/workflows/deploy.yml/badge.svg)](https://github.com/stackalertapp/stackalert-cdk/actions/workflows/deploy.yml)

AWS CDK v2 (TypeScript) infrastructure for [StackAlert](https://github.com/stackalertapp/stackalert-lambda) — AWS cost spike detection with alerts via **Slack**, **Telegram**, and/or **PagerDuty**.

## Resources Created

| Resource | Description |
|---|---|
| `Lambda::Function` | StackAlert Rust Lambda (arm64, provided.al2023) |
| `IAM::Role` | Least-privilege execution role |
| `Events::Rule` × 2 | Spike check (every 6h) + daily digest (08:00 UTC) |
| `SSM::Parameter` | Per-channel secrets (only for enabled channels) |
| `SQS::Queue` | Dead-letter queue for failed Lambda invocations |
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

# Slack (default channel)
export NOTIFICATION_CHANNELS=slack
export SLACK_WEBHOOK_URL=https://hooks.slack.com/services/T00000000/B00000000/XXXXXXXX

# Optional: add Telegram
# export NOTIFICATION_CHANNELS=slack,telegram
# export TELEGRAM_BOT_TOKEN=1234567890:AAXXXXXXXX
# export TELEGRAM_CHAT_ID=-1001234567890

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
| `NOTIFICATION_CHANNELS` | ❌ | `slack` | Comma-separated: `slack`, `telegram`, `pagerduty` |
| `SLACK_WEBHOOK_URL` | ⚡ | `""` | Slack webhook URL _(required when slack enabled)_ |
| `TELEGRAM_BOT_TOKEN` | ⚡ | `""` | Telegram bot token _(required when telegram enabled)_ |
| `TELEGRAM_CHAT_ID` | ⚡ | `""` | Telegram chat/group ID _(required when telegram enabled)_ |
| `PAGERDUTY_ROUTING_KEY` | ⚡ | `""` | PagerDuty routing key _(required when pagerduty enabled)_ |
| `SPIKE_THRESHOLD_PCT` | ❌ | `50` | Alert threshold percentage |
| `CROSS_ACCOUNT_ROLE_ARN` | ❌ | — | IAM role for cross-account monitoring |
| `ENVIRONMENT` | ❌ | `prod` | Deployment environment name |

> ⚡ = Required when the corresponding channel is listed in `NOTIFICATION_CHANNELS`

## Testing

```bash
npm test
```

Tests use the [AWS CDK assertions library](https://docs.aws.amazon.com/cdk/api/v2/docs/aws-cdk-lib.assertions-readme.html) to validate the generated CloudFormation template — no AWS account needed.

## Manual Invocation

```bash
aws lambda invoke \
  --function-name stackalert-prod \
  --payload '{}' \
  --cli-binary-format raw-in-base64-out \
  /tmp/out.json && cat /tmp/out.json
```
