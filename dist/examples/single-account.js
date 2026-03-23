"use strict";
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
const stackalert_stack_1 = require("../lib/stackalert-stack");
const app = new cdk.App();
new stackalert_stack_1.StackAlertStack(app, "StackAlert-SingleAccount", {
    env: {
        account: process.env.CDK_DEFAULT_ACCOUNT,
        region: process.env.CDK_DEFAULT_REGION || "eu-central-1",
    },
    description: "StackAlert — AWS cost spike detection (single account)",
    environment: "prod",
    // Lambda artifact — built by stackalert-lambda CI and uploaded to S3
    artifactS3Bucket: process.env.ARTIFACT_S3_BUCKET,
    artifactS3Key: process.env.ARTIFACT_S3_KEY || "stackalert-lambda/latest.zip",
    // Telegram: set via environment variables, never hardcode secrets
    telegramChatId: process.env.TELEGRAM_CHAT_ID,
    telegramBotToken: process.env.TELEGRAM_BOT_TOKEN,
    // Alert when spend is 50% above the 7-day average
    spikeThresholdPct: 50,
    tags: {
        Project: "stackalert",
        ManagedBy: "cdk",
    },
});
