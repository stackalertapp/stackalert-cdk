#!/usr/bin/env node
import * as cdk from "aws-cdk-lib";
import * as lambda from "aws-cdk-lib/aws-lambda";
import { StackAlertStack } from "../lib/stackalert-stack";

const app = new cdk.App();

// Read configuration from CDK context or environment variables
const environment = app.node.tryGetContext("environment") ?? process.env.ENVIRONMENT ?? "prod";
const region = app.node.tryGetContext("region") ?? process.env.AWS_REGION ?? "eu-central-1";
const accountId = process.env.CDK_DEFAULT_ACCOUNT;

// ── Lambda code source (choose one) ──────────────────────────────────────────
// Option A: explicit lambdaCode override (recommended).
//   Download the latest binary from:
//   https://github.com/stackalertapp/stackalert-lambda/releases
//
//   curl -Lo bootstrap.zip \
//     $(curl -s https://api.github.com/repos/stackalertapp/stackalert-lambda/releases/latest \
//       | grep browser_download_url | grep arm64 | cut -d'"' -f4)
//
// Option B: S3 artifact (legacy — set ARTIFACT_S3_BUCKET env var).
// ─────────────────────────────────────────────────────────────────────────────
const artifactS3Bucket = app.node.tryGetContext("artifactS3Bucket") ?? process.env.ARTIFACT_S3_BUCKET;
const artifactS3Key = app.node.tryGetContext("artifactS3Key") ?? process.env.ARTIFACT_S3_KEY ?? "stackalert-lambda/latest.zip";
const localAssetPath = process.env.LAMBDA_ASSET_PATH; // e.g. ./bootstrap.zip

// Resolve code source: local asset > S3 bucket > error
let lambdaCode: lambda.Code | undefined;
if (localAssetPath) {
  lambdaCode = lambda.Code.fromAsset(localAssetPath);
}

new StackAlertStack(app, `StackAlert-${environment}`, {
  env: {
    account: accountId,
    region,
  },
  environment,

  // Lambda code: use explicit lambdaCode when LAMBDA_ASSET_PATH is set,
  // otherwise fall back to S3 via artifactS3Bucket/artifactS3Key.
  ...(lambdaCode ? { lambdaCode } : { artifactS3Bucket, artifactS3Key }),

  // Notification channels (comma-separated: slack, telegram, pagerduty)
  notificationChannels: process.env.NOTIFICATION_CHANNELS ?? "slack",

  // Per-channel credentials (pass via env vars in CI — never commit to source)
  slackWebhookUrl: process.env.SLACK_WEBHOOK_URL ?? "",
  telegramBotToken: process.env.TELEGRAM_BOT_TOKEN ?? "",
  telegramChatId: process.env.TELEGRAM_CHAT_ID ?? "",
  pagerdutyRoutingKey: process.env.PAGERDUTY_ROUTING_KEY ?? "",

  // Optional: cross-account monitoring
  crossAccountRoleArn: process.env.CROSS_ACCOUNT_ROLE_ARN,

  // Alert threshold (default: 50%)
  spikeThresholdPct: parseInt(process.env.SPIKE_THRESHOLD_PCT ?? "50", 10),

  // Optional: GitHub Actions OIDC deploy role (set CREATE_DEPLOY_ROLE=true to enable)
  createDeployRole: process.env.CREATE_DEPLOY_ROLE === "true",
  githubOrg: process.env.GITHUB_ORG ?? "",
  githubRepo: process.env.GITHUB_REPO ?? "",

  tags: {
    Project: "stackalert",
    ManagedBy: "cdk",
    Repository: "stackalertapp/stackalert-cdk",
    Environment: environment,
  },
});
