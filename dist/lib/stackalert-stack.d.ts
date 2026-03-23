import * as cdk from "aws-cdk-lib";
import * as iam from "aws-cdk-lib/aws-iam";
import * as lambda from "aws-cdk-lib/aws-lambda";
import * as logs from "aws-cdk-lib/aws-logs";
import * as events from "aws-cdk-lib/aws-events";
import * as sqs from 'aws-cdk-lib/aws-sqs';
import * as cloudwatch from 'aws-cdk-lib/aws-cloudwatch';
import { Construct } from "constructs";
/**
 * Configuration properties for the StackAlertStack construct.
 *
 * All required props must be supplied; optional props fall back to safe defaults
 * that are suitable for a production deployment.
 *
 * @example
 * ```typescript
 * new StackAlertStack(app, 'StackAlert', {
 *   environment: 'prod',
 *   artifactS3Bucket: 'my-artifacts',
 *   artifactS3Key: 'stackalert-lambda/latest.zip',
 *   telegramChatId: '-1001234567890',
 *   telegramBotToken: '/stackalert/prod/telegram-bot-token',
 *   spikeThresholdPct: 50,
 *   env: { account: '123456789012', region: 'eu-central-1' },
 * });
 * ```
 */
export interface StackAlertStackProps extends cdk.StackProps {
    /**
     * Deployment environment identifier (e.g. `dev`, `staging`, `prod`).
     *
     * Used to namespace all resource names and SSM parameters so that multiple
     * environments can coexist in the same AWS account without collisions.
     */
    environment: string;
    /**
     * Name of the S3 bucket that contains the pre-built Lambda ZIP artifact.
     *
     * The artifact is produced by the `stackalert-lambda` CI pipeline and must
     * be accessible from the AWS account/region where this stack is deployed.
     */
    artifactS3Bucket: string;
    /**
     * S3 object key for the Lambda ZIP artifact (e.g. `stackalert-lambda/latest.zip`).
     *
     * Update this value to deploy a new version of the Lambda function.
     */
    artifactS3Key: string;
    /**
     * Telegram chat or group ID that will receive cost alerts.
     *
     * Obtain this by adding the bot to the target chat and calling
     * `https://api.telegram.org/bot<token>/getUpdates`.
     */
    telegramChatId: string;
    /**
     * Telegram bot token stored in SSM Parameter Store as a SecureString.
     *
     * The value is written to SSM by CDK and the Lambda function reads it
     * at runtime via `ssm:GetParameter`. Never pass a raw token here in
     * production — use a CDK context variable or CI secret.
     */
    telegramBotToken: string;
    /**
     * Optional IAM role ARN in a secondary AWS account for cross-account
     * Cost Explorer queries.
     *
     * When provided, the Lambda execution role is granted `sts:AssumeRole`
     * on this ARN so costs from the linked account can be included in reports.
     *
     * @default undefined — single-account mode
     */
    crossAccountRoleArn?: string;
    /**
     * Percentage increase in daily spend that triggers a spike alert.
     *
     * For example, a value of `50` means a 50 % day-over-day cost increase
     * will send a Telegram notification.
     *
     * @default 50
     */
    spikeThresholdPct?: number;
    /**
     * EventBridge schedule for the spike-detection check.
     *
     * Override this to run checks more or less frequently.
     *
     * @default events.Schedule.rate(cdk.Duration.hours(6))
     */
    spikeSchedule?: events.Schedule;
    /**
     * EventBridge schedule for the daily cost digest message.
     *
     * @default events.Schedule.cron({ minute: "0", hour: "8" }) — 08:00 UTC
     */
    digestSchedule?: events.Schedule;
    /**
     * Lambda function memory allocation in megabytes.
     *
     * Increase this if the function is hitting memory limits when processing
     * large Cost Explorer responses.
     *
     * @default 256
     */
    lambdaMemoryMb?: number;
    /**
     * Lambda function maximum execution time in seconds.
     *
     * @default 60
     */
    lambdaTimeoutSeconds?: number;
    /**
     * CloudWatch log retention period.
     *
     * @default logs.RetentionDays.ONE_MONTH (30 days)
     */
    logRetentionDays?: logs.RetentionDays;
    /**
     * Maximum concurrent Lambda executions. Prevents runaway invocations.
     * @default 2
     */
    reservedConcurrentExecutions?: number;
}
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
export declare class StackAlertStack extends cdk.Stack {
    /**
     * The deployed Lambda function.
     *
     * Use this reference to grant additional permissions, add event sources,
     * or retrieve the function ARN for cross-stack wiring.
     */
    readonly lambdaFunction: lambda.Function;
    /**
     * The Lambda execution IAM role.
     *
     * Expose this to allow other stacks to grant additional permissions without
     * coupling them to the internal role construct.
     */
    readonly executionRole: iam.Role;
    /**
     * The SQS Dead Letter Queue for failed Lambda invocations.
     */
    readonly dlq: sqs.Queue;
    /**
     * The CloudWatch alarm for Lambda errors.
     */
    readonly errorAlarm: cloudwatch.Alarm;
    constructor(scope: Construct, id: string, props: StackAlertStackProps);
}
