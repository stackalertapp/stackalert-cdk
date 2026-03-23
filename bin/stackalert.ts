#!/usr/bin/env node
import * as cdk from "aws-cdk-lib";
import { StackAlertStack } from "../lib/stackalert-stack";

const app = new cdk.App();

// Read configuration from CDK context or environment variables
const environment = app.node.tryGetContext("environment") ?? process.env.ENVIRONMENT ?? "prod";
const region = app.node.tryGetContext("region") ?? process.env.AWS_REGION ?? "eu-central-1";
const accountId = process.env.CDK_DEFAULT_ACCOUNT;

new StackAlertStack(app, `StackAlert-${environment}`, {
  env: {
    account: accountId,
    region,
  },
  environment,

  // Lambda artifact from S3 (built by stackalert-lambda CI)
  artifactS3Bucket: app.node.tryGetContext("artifactS3Bucket") ?? process.env.ARTIFACT_S3_BUCKET ?? "",
  artifactS3Key: app.node.tryGetContext("artifactS3Key") ?? process.env.ARTIFACT_S3_KEY ?? "stackalert-lambda/latest.zip",

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

  tags: {
    Project: "stackalert",
    ManagedBy: "cdk",
    Repository: "stackalertapp/stackalert-cdk",
    Environment: environment,
  },
});
