/**
 * Example: Single AWS account monitoring (most common setup)
 *
 * Monitors one AWS account and sends Telegram alerts when
 * any service spends 50%+ more than its 7-day average.
 *
 * Steps:
 *   1. Download the latest Lambda binary from GitHub Releases:
 *      curl -Lo bootstrap.zip \
 *        $(curl -s https://api.github.com/repos/stackalertapp/stackalert-lambda/releases/latest \
 *          | grep browser_download_url | grep arm64 | cut -d'"' -f4)
 *
 *   2. Set credentials:
 *      export TELEGRAM_CHAT_ID=-1001234567890
 *      export TELEGRAM_BOT_TOKEN=1234567890:AAxx...
 *
 *   3. Deploy:
 *      cdk deploy --app "npx ts-node examples/single-account.ts"
 */

import * as cdk from "aws-cdk-lib";
import * as lambda from "aws-cdk-lib/aws-lambda";
import { StackAlertStack } from "../lib/stackalert-stack";

const app = new cdk.App();

new StackAlertStack(app, "StackAlert-SingleAccount", {
  env: {
    account: process.env.CDK_DEFAULT_ACCOUNT,
    region: process.env.CDK_DEFAULT_REGION || "eu-central-1",
  },
  description: "StackAlert — AWS cost spike detection (single account)",

  environment: "prod",

  // Lambda code: download bootstrap.zip from GitHub Releases first.
  // https://github.com/stackalertapp/stackalert-lambda/releases
  lambdaCode: lambda.Code.fromAsset(process.env.LAMBDA_ASSET_PATH || "./bootstrap.zip"),

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
