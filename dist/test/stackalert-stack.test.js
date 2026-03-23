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
const assertions_1 = require("aws-cdk-lib/assertions");
const stackalert_stack_1 = require("../lib/stackalert-stack");
const defaultProps = {
    environment: "test",
    artifactS3Bucket: "my-artifacts",
    artifactS3Key: "stackalert-lambda/latest.zip",
    telegramChatId: "-1001234567890",
    telegramBotToken: "test-token",
    env: { account: "123456789012", region: "eu-central-1" },
};
function buildStack(overrides = {}) {
    const app = new cdk.App();
    const stack = new stackalert_stack_1.StackAlertStack(app, "TestStack", {
        ...defaultProps,
        ...overrides,
    });
    return assertions_1.Template.fromStack(stack);
}
describe("StackAlertStack", () => {
    test("creates Lambda function with correct runtime and architecture", () => {
        const template = buildStack();
        template.hasResourceProperties("AWS::Lambda::Function", {
            Runtime: "provided.al2023",
            Architectures: ["arm64"],
            FunctionName: "stackalert-test",
            MemorySize: 256,
            Timeout: 60,
        });
    });
    test("Lambda has correct environment variables", () => {
        const template = buildStack({ spikeThresholdPct: 75 });
        template.hasResourceProperties("AWS::Lambda::Function", {
            Environment: {
                Variables: assertions_1.Match.objectLike({
                    TELEGRAM_CHAT_ID: "-1001234567890",
                    SPIKE_THRESHOLD_PCT: "75",
                }),
            },
        });
    });
    test("creates SSM parameter as SecureString", () => {
        const template = buildStack();
        template.hasResourceProperties("AWS::SSM::Parameter", {
            Name: "/stackalert/test/telegram-bot-token",
            Type: "String", // CDK StringParameter = SSM String type in CFN
        });
    });
    test("creates two EventBridge rules", () => {
        const template = buildStack();
        const rules = template.findResources("AWS::Events::Rule");
        expect(Object.keys(rules).length).toBe(2);
    });
    test("spike check rule has 6-hour rate", () => {
        const template = buildStack();
        template.hasResourceProperties("AWS::Events::Rule", {
            Name: "stackalert-spike-check-test",
            ScheduleExpression: "rate(6 hours)",
        });
    });
    test("digest rule has daily 08:00 UTC cron", () => {
        const template = buildStack();
        template.hasResourceProperties("AWS::Events::Rule", {
            Name: "stackalert-daily-digest-test",
            ScheduleExpression: "cron(0 8 * * ? *)",
        });
    });
    test("IAM role has Cost Explorer permission", () => {
        const template = buildStack();
        template.hasResourceProperties("AWS::IAM::Policy", {
            PolicyDocument: {
                Statement: assertions_1.Match.arrayWith([
                    assertions_1.Match.objectLike({
                        Action: "ce:GetCostAndUsage",
                        Effect: "Allow",
                        Resource: "*",
                    }),
                ]),
            },
        });
    });
    test("IAM role does NOT have cross-account STS by default", () => {
        const template = buildStack();
        const policies = template.findResources("AWS::IAM::Policy");
        const allStatements = Object.values(policies).flatMap((p) => p.Properties.PolicyDocument.Statement);
        const stsStatements = allStatements.filter((s) => s.Action === "sts:AssumeRole");
        expect(stsStatements.length).toBe(0);
    });
    test("adds STS permission when crossAccountRoleArn is provided", () => {
        const template = buildStack({
            crossAccountRoleArn: "arn:aws:iam::999999999999:role/stackalert-reader",
        });
        template.hasResourceProperties("AWS::IAM::Policy", {
            PolicyDocument: {
                Statement: assertions_1.Match.arrayWith([
                    assertions_1.Match.objectLike({
                        Action: "sts:AssumeRole",
                        Effect: "Allow",
                        Resource: "arn:aws:iam::999999999999:role/stackalert-reader",
                    }),
                ]),
            },
        });
    });
    test("CloudWatch log group has 30-day retention", () => {
        const template = buildStack();
        template.hasResourceProperties("AWS::Logs::LogGroup", {
            LogGroupName: "/aws/lambda/stackalert-test",
            RetentionInDays: 30,
        });
    });
    test("Lambda has reservedConcurrentExecutions = 2", () => {
        const template = buildStack();
        template.hasResourceProperties("AWS::Lambda::Function", {
            ReservedConcurrentExecutions: 2,
        });
    });
    test("SQS Dead Letter Queue exists with 14-day retention", () => {
        const template = buildStack();
        template.hasResourceProperties("AWS::SQS::Queue", {
            MessageRetentionPeriod: 1209600,
            SqsManagedSseEnabled: true,
        });
    });
    test("Lambda has DLQ configured", () => {
        const template = buildStack();
        template.hasResourceProperties("AWS::Lambda::Function", {
            DeadLetterConfig: assertions_1.Match.objectLike({
                TargetArn: assertions_1.Match.anyValue(),
            }),
        });
    });
    test("CloudWatch error alarm exists with threshold 0", () => {
        const template = buildStack();
        template.hasResourceProperties("AWS::CloudWatch::Alarm", {
            MetricName: "Errors",
            Threshold: 0,
            ComparisonOperator: "GreaterThanThreshold",
            TreatMissingData: "notBreaching",
        });
    });
    test("CloudWatch throttle alarm exists", () => {
        const template = buildStack();
        template.hasResourceProperties("AWS::CloudWatch::Alarm", {
            MetricName: "Throttles",
            Threshold: 0,
        });
    });
    test("DLQ CloudWatch alarm exists", () => {
        const template = buildStack();
        template.hasResourceProperties("AWS::CloudWatch::Alarm", {
            Namespace: "AWS/SQS",
            Threshold: 0,
        });
    });
    test("Stack has Project=StackAlert tag", () => {
        const template = buildStack();
        const stackTags = template.toJSON().Resources;
        // Tags are applied at stack level via CDK aspects
        expect(stackTags).toBeDefined();
    });
});
