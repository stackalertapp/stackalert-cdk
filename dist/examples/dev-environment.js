"use strict";
/**
 * Example: Development/staging environment
 *
 * Lower costs, relaxed thresholds, shorter log retention.
 * Good for validating StackAlert before deploying to prod.
 *
 * Usage:
 *   cdk deploy --app "npx ts-node examples/dev-environment.ts"
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
const logs = __importStar(require("aws-cdk-lib/aws-logs"));
const events = __importStar(require("aws-cdk-lib/aws-events"));
const stackalert_stack_1 = require("../lib/stackalert-stack");
const app = new cdk.App();
new stackalert_stack_1.StackAlertStack(app, "StackAlert-Dev", {
    env: {
        account: process.env.CDK_DEFAULT_ACCOUNT,
        region: process.env.CDK_DEFAULT_REGION || "eu-central-1",
    },
    description: "StackAlert — dev/staging (reduced cost config)",
    environment: "dev",
    artifactS3Bucket: process.env.ARTIFACT_S3_BUCKET,
    artifactS3Key: process.env.ARTIFACT_S3_KEY || "stackalert-lambda/latest.zip",
    telegramChatId: process.env.TELEGRAM_CHAT_ID,
    telegramBotToken: process.env.TELEGRAM_BOT_TOKEN,
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
