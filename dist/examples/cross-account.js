"use strict";
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
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
const cdk = __importStar(require("aws-cdk-lib"));
const events = __importStar(require("aws-cdk-lib/aws-events"));
const stackalert_stack_1 = require("../lib/stackalert-stack");
const app = new cdk.App();
new stackalert_stack_1.StackAlertStack(app, "StackAlert-CrossAccount", {
    env: {
        account: process.env.CDK_DEFAULT_ACCOUNT,
        region: process.env.CDK_DEFAULT_REGION || "eu-central-1",
    },
    description: "StackAlert — AWS cost spike detection (cross-account)",
    environment: "prod",
    artifactS3Bucket: process.env.ARTIFACT_S3_BUCKET,
    artifactS3Key: process.env.ARTIFACT_S3_KEY || "stackalert-lambda/latest.zip",
    telegramChatId: process.env.TELEGRAM_CHAT_ID,
    telegramBotToken: process.env.TELEGRAM_BOT_TOKEN,
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
