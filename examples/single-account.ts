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

import * as cdk from "aws-cdk-lib";
import { StackAlertStack } from "../lib/stackalert-stack";

const app = new cdk.App();

new StackAlertStack(app, "StackAlert-SingleAccount", {
  env: {
    account: process.env.CDK_DEFAULT_ACCOUNT,
    region: process.env.CDK_DEFAULT_REGION || "eu-central-1",
  },
  description: "StackAlert — AWS cost spike detection (single account)",

  environment: "prod",

  // Lambda artifact — built by stackalert-lambda CI and uploaded to S3
  artifactS3Bucket: process.env.ARTIFACT_S3_BUCKET!,
  artifactS3Key: process.env.ARTIFACT_S3_KEY || "stackalert-lambda/latest.zip",

  // Telegram: set via environment variables, never hardcode secrets
  telegramChatId: process.env.TELEGRAM_CHAT_ID!,
  telegramBotToken: process.env.TELEGRAM_BOT_TOKEN!,

  // Alert when spend is 50% above the 7-day average
  spikeThresholdPct: 50,

  tags: {
    Project: "stackalert",
    ManagedBy: "cdk",
  },
});
