#!/usr/bin/env node
"use strict";
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
// Read configuration from CDK context or environment variables
const environment = app.node.tryGetContext("environment") ?? process.env.ENVIRONMENT ?? "prod";
const region = app.node.tryGetContext("region") ?? process.env.AWS_REGION ?? "eu-central-1";
const accountId = process.env.CDK_DEFAULT_ACCOUNT;
new stackalert_stack_1.StackAlertStack(app, `StackAlert-${environment}`, {
    env: {
        account: accountId,
        region,
    },
    environment,
    // Lambda artifact from S3 (built by stackalert-lambda CI)
    artifactS3Bucket: app.node.tryGetContext("artifactS3Bucket") ?? process.env.ARTIFACT_S3_BUCKET ?? "",
    artifactS3Key: app.node.tryGetContext("artifactS3Key") ?? process.env.ARTIFACT_S3_KEY ?? "stackalert-lambda/latest.zip",
    // Telegram config (pass via env vars in CI — never commit to source)
    telegramChatId: process.env.TELEGRAM_CHAT_ID ?? "",
    telegramBotToken: process.env.TELEGRAM_BOT_TOKEN ?? "",
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
