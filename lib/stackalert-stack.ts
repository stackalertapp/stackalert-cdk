import * as cdk from "aws-cdk-lib";
import * as iam from "aws-cdk-lib/aws-iam";
import * as lambda from "aws-cdk-lib/aws-lambda";
import * as logs from "aws-cdk-lib/aws-logs";
import * as events from "aws-cdk-lib/aws-events";
import * as targets from "aws-cdk-lib/aws-events-targets";
import * as ssm from "aws-cdk-lib/aws-ssm";
import * as s3 from "aws-cdk-lib/aws-s3";
import * as sqs from 'aws-cdk-lib/aws-sqs';
import * as cloudwatch from 'aws-cdk-lib/aws-cloudwatch';
import { NagSuppressions } from 'cdk-nag';
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
 *   notificationChannels: 'slack,telegram',
 *   slackWebhookUrl: 'https://hooks.slack.com/...',
 *   telegramBotToken: 'bot123456:ABC-secret',
 *   telegramChatId: '-1001234567890',
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
   * Comma-separated list of notification channels to enable.
   * Valid values: `slack`, `telegram`, `pagerduty`
   *
   * SSM parameters and IAM permissions are created only for the listed channels.
   *
   * @default "slack"
   * @example "slack,telegram,pagerduty"
   */
  notificationChannels?: string;

  /**
   * Slack incoming webhook URL.
   * Required when `"slack"` is in {@link notificationChannels}.
   */
  slackWebhookUrl?: string;

  /**
   * Telegram bot token.
   * Required when `"telegram"` is in {@link notificationChannels}.
   */
  telegramBotToken?: string;

  /**
   * Telegram chat or group ID that will receive cost alerts.
   * Required when `"telegram"` is in {@link notificationChannels}.
   */
  telegramChatId?: string;

  /**
   * PagerDuty Events API v2 routing/integration key.
   * Required when `"pagerduty"` is in {@link notificationChannels}.
   */
  pagerdutyRoutingKey?: string;

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
 * - **SSM parameters** — per-channel secrets (Slack/Telegram/PagerDuty), created conditionally
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
export class StackAlertStack extends cdk.Stack {
  /**
   * The deployed Lambda function.
   *
   * Use this reference to grant additional permissions, add event sources,
   * or retrieve the function ARN for cross-stack wiring.
   */
  public readonly lambdaFunction: lambda.Function;

  /**
   * The Lambda execution IAM role.
   *
   * Expose this to allow other stacks to grant additional permissions without
   * coupling them to the internal role construct.
   */
  public readonly executionRole: iam.Role;

  /**
   * The SQS Dead Letter Queue for failed Lambda invocations.
   */
  public readonly dlq: sqs.Queue;

  /**
   * The CloudWatch alarm for Lambda errors.
   */
  public readonly errorAlarm: cloudwatch.Alarm;

  constructor(scope: Construct, id: string, props: StackAlertStackProps) {
    super(scope, id, props);

    const {
      environment,
      artifactS3Bucket,
      artifactS3Key,
      notificationChannels = "slack",
      slackWebhookUrl = "",
      telegramBotToken = "",
      telegramChatId = "",
      pagerdutyRoutingKey = "",
      crossAccountRoleArn,
      spikeThresholdPct = 50,
      spikeSchedule = events.Schedule.rate(cdk.Duration.hours(6)),
      digestSchedule = events.Schedule.cron({ minute: "0", hour: "8" }),
      lambdaMemoryMb = 256,
      lambdaTimeoutSeconds = 60,
      logRetentionDays = logs.RetentionDays.ONE_MONTH,
      reservedConcurrentExecutions = 2,
    } = props;

    // Parse active channels for conditional resource creation
    const channels = notificationChannels.split(",").map((c) => c.trim().toLowerCase());

    // ============================================================
    // SSM Parameters: per-channel secrets (created conditionally)
    // NOTE: CDK StringParameter stores as String type (not SecureString).
    // Rotate sensitive values directly in SSM console after first deploy.
    // ============================================================

    const slackWebhookUrlParam = channels.includes("slack")
      ? new ssm.StringParameter(this, "SlackWebhookUrl", {
          parameterName: `/stackalert/${environment}/slack-webhook-url`,
          description: "StackAlert Slack incoming webhook URL — managed by CDK",
          stringValue: slackWebhookUrl || "PLACEHOLDER",
          tier: ssm.ParameterTier.STANDARD,
        })
      : undefined;

    const telegramBotTokenParam = channels.includes("telegram")
      ? new ssm.StringParameter(this, "TelegramBotToken", {
          parameterName: `/stackalert/${environment}/telegram-bot-token`,
          description: "StackAlert Telegram bot token — managed by CDK",
          stringValue: telegramBotToken || "PLACEHOLDER",
          tier: ssm.ParameterTier.STANDARD,
        })
      : undefined;

    const pagerdutyRoutingKeyParam = channels.includes("pagerduty")
      ? new ssm.StringParameter(this, "PagerDutyRoutingKey", {
          parameterName: `/stackalert/${environment}/pagerduty-routing-key`,
          description: "StackAlert PagerDuty Events API v2 routing key — managed by CDK",
          stringValue: pagerdutyRoutingKey || "PLACEHOLDER",
          tier: ssm.ParameterTier.STANDARD,
        })
      : undefined;

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
    this.executionRole.addToPolicy(
      new iam.PolicyStatement({
        sid: "AllowCloudWatchLogs",
        effect: iam.Effect.ALLOW,
        actions: ["logs:CreateLogStream", "logs:PutLogEvents"],
        resources: [`${logGroup.logGroupArn}:*`],
      })
    );

    // SSM — read only the channel params that were created
    const ssmParamArns = [
      slackWebhookUrlParam?.parameterArn,
      telegramBotTokenParam?.parameterArn,
      pagerdutyRoutingKeyParam?.parameterArn,
    ].filter((arn): arn is string => arn !== undefined);

    if (ssmParamArns.length > 0) {
      this.executionRole.addToPolicy(
        new iam.PolicyStatement({
          sid: "AllowSSMGetChannelSecrets",
          effect: iam.Effect.ALLOW,
          actions: ["ssm:GetParameter"],
          resources: ssmParamArns,
        })
      );
    }

    // KMS — decrypt SSM SecureString with AWS managed key
    this.executionRole.addToPolicy(
      new iam.PolicyStatement({
        sid: "AllowKMSDecrypt",
        effect: iam.Effect.ALLOW,
        actions: ["kms:Decrypt"],
        resources: [
          `arn:aws:kms:${this.region}:${this.account}:alias/aws/ssm`,
        ],
      })
    );

    // Cost Explorer — read-only, no resource-level permissions supported
    this.executionRole.addToPolicy(
      new iam.PolicyStatement({
        sid: "AllowCostExplorerRead",
        effect: iam.Effect.ALLOW,
        actions: ["ce:GetCostAndUsage"],
        resources: ["*"],
      })
    );

    // STS — optional cross-account assume role
    if (crossAccountRoleArn) {
      this.executionRole.addToPolicy(
        new iam.PolicyStatement({
          sid: "AllowCrossAccountAssume",
          effect: iam.Effect.ALLOW,
          actions: ["sts:AssumeRole"],
          resources: [crossAccountRoleArn],
        })
      );
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
    const artifactBucket = s3.Bucket.fromBucketName(
      this,
      "ArtifactBucket",
      artifactS3Bucket
    );

    this.lambdaFunction = new lambda.Function(this, "Function", {
      functionName: `stackalert-${environment}`,
      description:
        "StackAlert — AWS cost spike detector. Alerts via Slack, Telegram, and/or PagerDuty when spend exceeds threshold.",
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
        // Which channels to fan-out to (comma-separated)
        NOTIFICATION_CHANNELS: notificationChannels,

        // Per-channel credentials — Lambda reads these directly from env vars
        SLACK_WEBHOOK_URL: slackWebhookUrl,
        TELEGRAM_BOT_TOKEN: telegramBotToken,
        TELEGRAM_CHAT_ID: telegramChatId,
        PAGERDUTY_ROUTING_KEY: pagerdutyRoutingKey,

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

    spikeRule.addTarget(
      new targets.LambdaFunction(this.lambdaFunction, {
        event: events.RuleTargetInput.fromObject({}),
      })
    );

    // Rule 2: Daily digest at 08:00 UTC
    const digestRule = new events.Rule(this, "DailyDigestRule", {
      ruleName: `stackalert-daily-digest-${environment}`,
      description: "Triggers StackAlert daily cost digest at 08:00 UTC",
      schedule: digestSchedule,
    });

    digestRule.addTarget(
      new targets.LambdaFunction(this.lambdaFunction, {
        event: events.RuleTargetInput.fromObject({}),
      })
    );

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

    new cdk.CfnOutput(this, "NotificationChannels", {
      value: notificationChannels,
      description: "Active notification channels",
    });

    new cdk.CfnOutput(this, "LogGroupName", {
      value: logGroup.logGroupName,
      description: "CloudWatch log group name",
    });

    new cdk.CfnOutput(this, "InvokeSpikeCommand", {
      value: `aws lambda invoke --function-name ${this.lambdaFunction.functionName} --payload '{}' --cli-binary-format raw-in-base64-out /tmp/out.json && cat /tmp/out.json`,
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
    NagSuppressions.addStackSuppressions(this, [
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
