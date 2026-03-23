/**
 * Example: Development/staging environment
 *
 * Lower costs, relaxed thresholds, shorter log retention.
 * Good for validating StackAlert before deploying to prod.
 *
 * Usage:
 *   cdk deploy --app "npx ts-node examples/dev-environment.ts"
 */

import * as cdk from "aws-cdk-lib";
import * as logs from "aws-cdk-lib/aws-logs";
import * as events from "aws-cdk-lib/aws-events";
import { StackAlertStack } from "../lib/stackalert-stack";

const app = new cdk.App();

new StackAlertStack(app, "StackAlert-Dev", {
  env: {
    account: process.env.CDK_DEFAULT_ACCOUNT,
    region: process.env.CDK_DEFAULT_REGION || "eu-central-1",
  },
  description: "StackAlert — dev/staging (reduced cost config)",

  environment: "dev",

  artifactS3Bucket: process.env.ARTIFACT_S3_BUCKET!,
  artifactS3Key: process.env.ARTIFACT_S3_KEY || "stackalert-lambda/latest.zip",

  telegramChatId: process.env.TELEGRAM_CHAT_ID!,
  telegramBotToken: process.env.TELEGRAM_BOT_TOKEN!,

  // Higher threshold in dev — only alert on really unexpected spikes
  spikeThresholdPct: 200,

  // Check once a day in dev to avoid noisy alerts during development
  spikeSchedule: events.Schedule.rate(cdk.Duration.hours(24)),

  // Shorter retention for dev logs
  logRetentionDays: logs.RetentionDays.ONE_WEEK,

  // Minimum memory for dev (saves cost)
  lambdaMemoryMb: 128,

  tags: {
    Project: "stackalert",
    ManagedBy: "cdk",
    Environment: "dev",
  },
});
