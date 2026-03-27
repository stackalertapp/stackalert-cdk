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

import * as cdk from "aws-cdk-lib";
import * as lambda from "aws-cdk-lib/aws-lambda";
import * as events from "aws-cdk-lib/aws-events";
import { StackAlertStack } from "../lib/stackalert-stack";

const app = new cdk.App();

new StackAlertStack(app, "StackAlert-CrossAccount", {
  env: {
    account: process.env.CDK_DEFAULT_ACCOUNT,
    region: process.env.CDK_DEFAULT_REGION || "eu-central-1",
  },
  description: "StackAlert — AWS cost spike detection (cross-account)",

  environment: "prod",

  // Lambda code: download bootstrap.zip from GitHub Releases first.
  // https://github.com/stackalertapp/stackalert-lambda/releases
  lambdaCode: lambda.Code.fromAsset(process.env.LAMBDA_ASSET_PATH || "./bootstrap.zip"),

  telegramChatId: process.env.TELEGRAM_CHAT_ID!,
  telegramBotToken: process.env.TELEGRAM_BOT_TOKEN!,

  // Cross-account role ARN in the target account
  crossAccountRoleArn: process.env.CROSS_ACCOUNT_ROLE_ARN,

  // Tighter threshold for cross-account (you care more about surprises)
  spikeThresholdPct: 30,

  // Check every 2 hours instead of 6 (higher frequency for production monitoring)
  spikeSchedule: events.Schedule.rate(cdk.Duration.hours(2)),

  tags: {
    Project: "stackalert",
    ManagedBy: "cdk",
  },
});
