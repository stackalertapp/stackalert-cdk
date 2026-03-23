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
exports.StackAlertStack = void 0;
const cdk = __importStar(require("aws-cdk-lib"));
const iam = __importStar(require("aws-cdk-lib/aws-iam"));
const lambda = __importStar(require("aws-cdk-lib/aws-lambda"));
const logs = __importStar(require("aws-cdk-lib/aws-logs"));
const events = __importStar(require("aws-cdk-lib/aws-events"));
const targets = __importStar(require("aws-cdk-lib/aws-events-targets"));
const ssm = __importStar(require("aws-cdk-lib/aws-ssm"));
const s3 = __importStar(require("aws-cdk-lib/aws-s3"));
const sqs = __importStar(require("aws-cdk-lib/aws-sqs"));
const cloudwatch = __importStar(require("aws-cdk-lib/aws-cloudwatch"));
const cdk_nag_1 = require("cdk-nag");
/**
 * AWS CDK construct that deploys the full StackAlert infrastructure.
 *
 * StackAlert is an AWS cost spike detector that runs on a Graviton2 Lambda
 * (Rust runtime) and sends alerts to a Telegram chat when daily spend
 * exceeds a configurable threshold.
 *
 * ## Resources created
 *
 * - **Lambda function** — Rust binary on `provided.al2023` / `arm64`
 * - **IAM execution role** — least-privilege; scoped to specific log group,
 *   SSM parameter, and Cost Explorer read-only
 * - **SSM SecureString parameter** — stores the Telegram bot token
 * - **CloudWatch log group** — structured JSON logs with configurable retention
 * - **EventBridge rules** — spike check (default every 6 h) + daily digest (08:00 UTC)
 * - **SQS Dead Letter Queue** — captures failed Lambda invocations
 * - **CloudWatch alarms** — errors, throttles, and DLQ depth
 *
 * ## Public API
 *
 * After deployment the following properties are available for cross-stack references:
 * - {@link lambdaFunction} — the Lambda `Function` object
 * - {@link executionRole} — the Lambda execution `Role` object
 * - {@link dlq} — the SQS Dead Letter Queue
 * - {@link errorAlarm} — the CloudWatch Lambda error alarm
 *
 * @example
 * ```typescript
 * import { StackAlertStack } from 'stackalert-cdk';
 * import * as cdk from 'aws-cdk-lib';
 *
 * const app = new cdk.App();
 *
 * new StackAlertStack(app, 'StackAlert', {
 *   environment: 'prod',
 *   artifactS3Bucket: 'my-build-artifacts',
 *   artifactS3Key: 'stackalert-lambda/v1.2.3.zip',
 *   telegramChatId: '-1001234567890',
 *   telegramBotToken: 'bot123456:ABC-secret',
 *   spikeThresholdPct: 40,
 *   env: { account: process.env.CDK_DEFAULT_ACCOUNT, region: 'eu-central-1' },
 * });
 * ```
 */
class StackAlertStack extends cdk.Stack {
    constructor(scope, id, props) {
        super(scope, id, props);
        const { environment, artifactS3Bucket, artifactS3Key, telegramChatId, telegramBotToken, crossAccountRoleArn, spikeThresholdPct = 50, spikeSchedule = events.Schedule.rate(cdk.Duration.hours(6)), digestSchedule = events.Schedule.cron({ minute: "0", hour: "8" }), lambdaMemoryMb = 256, lambdaTimeoutSeconds = 60, logRetentionDays = logs.RetentionDays.ONE_MONTH, reservedConcurrentExecutions = 2, } = props;
        // ============================================================
        // SSM Parameter: Telegram bot token (SecureString)
        // ============================================================
        const botTokenParam = new ssm.StringParameter(this, "TelegramBotToken", {
            parameterName: `/stackalert/${environment}/telegram-bot-token`,
            description: "StackAlert Telegram bot token — managed by CDK",
            stringValue: telegramBotToken,
            tier: ssm.ParameterTier.STANDARD,
        });
        // ============================================================
        // CloudWatch Log Group: structured JSON logs
        // ============================================================
        const logGroup = new logs.LogGroup(this, "LogGroup", {
            logGroupName: `/aws/lambda/stackalert-${environment}`,
            retention: logRetentionDays,
            removalPolicy: cdk.RemovalPolicy.DESTROY,
        });
        // ============================================================
        // IAM Role: least-privilege execution role
        // ============================================================
        this.executionRole = new iam.Role(this, "LambdaRole", {
            roleName: `stackalert-lambda-${environment}`,
            description: "Execution role for StackAlert Lambda — AWS cost spike detector",
            assumedBy: new iam.ServicePrincipal("lambda.amazonaws.com"),
        });
        // CloudWatch Logs — write to the specific log group only
        this.executionRole.addToPolicy(new iam.PolicyStatement({
            sid: "AllowCloudWatchLogs",
            effect: iam.Effect.ALLOW,
            actions: ["logs:CreateLogStream", "logs:PutLogEvents"],
            resources: [`${logGroup.logGroupArn}:*`],
        }));
        // SSM — read the specific bot token parameter only
        this.executionRole.addToPolicy(new iam.PolicyStatement({
            sid: "AllowSSMGetBotToken",
            effect: iam.Effect.ALLOW,
            actions: ["ssm:GetParameter"],
            resources: [botTokenParam.parameterArn],
        }));
        // KMS — decrypt SSM SecureString with AWS managed key
        this.executionRole.addToPolicy(new iam.PolicyStatement({
            sid: "AllowKMSDecrypt",
            effect: iam.Effect.ALLOW,
            actions: ["kms:Decrypt"],
            resources: [
                `arn:aws:kms:${this.region}:${this.account}:alias/aws/ssm`,
            ],
        }));
        // Cost Explorer — read-only, no resource-level permissions supported
        this.executionRole.addToPolicy(new iam.PolicyStatement({
            sid: "AllowCostExplorerRead",
            effect: iam.Effect.ALLOW,
            actions: ["ce:GetCostAndUsage"],
            resources: ["*"],
        }));
        // STS — optional cross-account assume role
        if (crossAccountRoleArn) {
            this.executionRole.addToPolicy(new iam.PolicyStatement({
                sid: "AllowCrossAccountAssume",
                effect: iam.Effect.ALLOW,
                actions: ["sts:AssumeRole"],
                resources: [crossAccountRoleArn],
            }));
        }
        // ============================================================
        // SQS Dead Letter Queue — catches failed Lambda invocations
        // ============================================================
        this.dlq = new sqs.Queue(this, 'DLQ', {
            queueName: `stackalert-${environment}-dlq`,
            retentionPeriod: cdk.Duration.days(14),
            encryption: sqs.QueueEncryption.SQS_MANAGED,
        });
        // Grant Lambda execution role permission to send to DLQ
        this.dlq.grantSendMessages(this.executionRole);
        // ============================================================
        // Lambda Function: StackAlert (Rust, arm64, provided.al2023)
        // ============================================================
        const artifactBucket = s3.Bucket.fromBucketName(this, "ArtifactBucket", artifactS3Bucket);
        this.lambdaFunction = new lambda.Function(this, "Function", {
            functionName: `stackalert-${environment}`,
            description: "StackAlert — AWS cost spike detector. Alerts via Telegram when spend exceeds threshold.",
            code: lambda.Code.fromBucket(artifactBucket, artifactS3Key),
            handler: "bootstrap", // Rust Lambda convention
            runtime: lambda.Runtime.PROVIDED_AL2023,
            architecture: lambda.Architecture.ARM_64, // Graviton2: 20% cheaper
            role: this.executionRole,
            memorySize: lambdaMemoryMb,
            timeout: cdk.Duration.seconds(lambdaTimeoutSeconds),
            logGroup,
            loggingFormat: lambda.LoggingFormat.JSON,
            reservedConcurrentExecutions,
            deadLetterQueue: this.dlq,
            environment: {
                TELEGRAM_BOT_TOKEN_SSM_PARAM: botTokenParam.parameterName,
                TELEGRAM_CHAT_ID: telegramChatId,
                SPIKE_THRESHOLD_PCT: spikeThresholdPct.toString(),
                CROSS_ACCOUNT_ROLE_ARN: crossAccountRoleArn ?? "",
                RUST_LOG: "stackalert_lambda=info,aws_sdk=warn",
                DLQ_URL: this.dlq.queueUrl,
            },
        });
        // ============================================================
        // EventBridge Rules: scheduled triggers
        // ============================================================
        // Rule 1: Spike check every 6 hours
        const spikeRule = new events.Rule(this, "SpikeCheckRule", {
            ruleName: `stackalert-spike-check-${environment}`,
            description: "Triggers StackAlert spike detection every 6 hours",
            schedule: spikeSchedule,
        });
        spikeRule.addTarget(new targets.LambdaFunction(this.lambdaFunction, {
            event: events.RuleTargetInput.fromObject({ mode: "spike" }),
        }));
        // Rule 2: Daily digest at 08:00 UTC
        const digestRule = new events.Rule(this, "DailyDigestRule", {
            ruleName: `stackalert-daily-digest-${environment}`,
            description: "Triggers StackAlert daily cost digest at 08:00 UTC",
            schedule: digestSchedule,
        });
        digestRule.addTarget(new targets.LambdaFunction(this.lambdaFunction, {
            event: events.RuleTargetInput.fromObject({ mode: "digest" }),
        }));
        // ============================================================
        // CloudWatch Alarms
        // ============================================================
        this.errorAlarm = new cloudwatch.Alarm(this, 'LambdaErrorAlarm', {
            alarmName: `stackalert-${environment}-errors`,
            metric: this.lambdaFunction.metricErrors({
                period: cdk.Duration.minutes(5),
                statistic: 'Sum',
            }),
            threshold: 0,
            evaluationPeriods: 1,
            comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_THRESHOLD,
            treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
            alarmDescription: 'StackAlert Lambda returned errors',
        });
        const throttleAlarm = new cloudwatch.Alarm(this, 'LambdaThrottleAlarm', {
            alarmName: `stackalert-${environment}-throttles`,
            metric: this.lambdaFunction.metricThrottles({
                period: cdk.Duration.minutes(5),
                statistic: 'Sum',
            }),
            threshold: 0,
            evaluationPeriods: 1,
            comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_THRESHOLD,
            treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
            alarmDescription: 'StackAlert Lambda is being throttled',
        });
        const dlqAlarm = new cloudwatch.Alarm(this, 'DLQAlarm', {
            alarmName: `stackalert-${environment}-dlq-depth`,
            metric: this.dlq.metricNumberOfMessagesSent({
                period: cdk.Duration.minutes(5),
                statistic: 'Sum',
            }),
            threshold: 0,
            evaluationPeriods: 1,
            comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_THRESHOLD,
            treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
            alarmDescription: 'StackAlert DLQ received messages — Lambda failed silently',
        });
        // ============================================================
        // CloudFormation Outputs
        // ============================================================
        new cdk.CfnOutput(this, "LambdaFunctionName", {
            value: this.lambdaFunction.functionName,
            description: "StackAlert Lambda function name",
        });
        new cdk.CfnOutput(this, "LambdaFunctionArn", {
            value: this.lambdaFunction.functionArn,
            description: "StackAlert Lambda function ARN",
        });
        new cdk.CfnOutput(this, "ExecutionRoleArn", {
            value: this.executionRole.roleArn,
            description: "Lambda execution IAM role ARN",
        });
        new cdk.CfnOutput(this, "SSMParameterName", {
            value: botTokenParam.parameterName,
            description: "SSM parameter name for Telegram bot token",
        });
        new cdk.CfnOutput(this, "LogGroupName", {
            value: logGroup.logGroupName,
            description: "CloudWatch log group name",
        });
        new cdk.CfnOutput(this, "InvokeSpikeCommand", {
            value: `aws lambda invoke --function-name ${this.lambdaFunction.functionName} --payload '{"mode":"spike"}' --cli-binary-format raw-in-base64-out /tmp/out.json && cat /tmp/out.json`,
            description: "AWS CLI command to trigger a spike check",
        });
        new cdk.CfnOutput(this, 'DLQUrl', {
            value: this.dlq.queueUrl,
            description: 'Dead Letter Queue URL for failed Lambda invocations',
        });
        new cdk.CfnOutput(this, 'ErrorAlarmArn', {
            value: this.errorAlarm.alarmArn,
            description: 'CloudWatch alarm ARN for Lambda errors',
        });
        // ============================================================
        // Resource tagging
        // ============================================================
        cdk.Tags.of(this).add('Project', 'StackAlert');
        cdk.Tags.of(this).add('ManagedBy', 'CDK');
        cdk.Tags.of(this).add('Environment', environment);
        // ============================================================
        // cdk-nag suppressions for accepted findings
        // ============================================================
        cdk_nag_1.NagSuppressions.addStackSuppressions(this, [
            {
                id: 'AwsSolutions-IAM5',
                reason: 'Cost Explorer GetCostAndUsage does not support resource-level permissions — wildcard required by AWS.',
            },
            {
                id: 'AwsSolutions-L1',
                reason: 'Lambda uses provided.al2023 custom runtime (Rust binary) — managed runtime versions do not apply.',
            },
        ]);
        // Suppress unused variable warnings for alarms used only for side effects
        void throttleAlarm;
        void dlqAlarm;
    }
}
exports.StackAlertStack = StackAlertStack;
