import * as cdk from "aws-cdk-lib";
import * as iam from "aws-cdk-lib/aws-iam";
import * as lambda from "aws-cdk-lib/aws-lambda";
import * as logs from "aws-cdk-lib/aws-logs";
import * as events from "aws-cdk-lib/aws-events";
import * as targets from "aws-cdk-lib/aws-events-targets";
import * as ssm from "aws-cdk-lib/aws-ssm";
import * as s3 from "aws-cdk-lib/aws-s3";
import { Construct } from "constructs";

export interface StackAlertStackProps extends cdk.StackProps {
  /** Deployment environment (dev / staging / prod) */
  environment: string;

  /** S3 bucket containing the pre-built Lambda ZIP (from stackalert-lambda CI) */
  artifactS3Bucket: string;

  /** S3 key for the Lambda ZIP artifact */
  artifactS3Key: string;

  /** Telegram chat/group ID */
  telegramChatId: string;

  /** Telegram bot token (stored in SSM SecureString) */
  telegramBotToken: string;

  /** Optional: IAM role ARN in another account for cross-account Cost Explorer queries */
  crossAccountRoleArn?: string;

  /** Spike threshold percentage (default: 50) */
  spikeThresholdPct?: number;

  /** Spike check schedule (default: every 6 hours) */
  spikeSchedule?: events.Schedule;

  /** Daily digest schedule (default: 08:00 UTC) */
  digestSchedule?: events.Schedule;

  /** Lambda memory in MB (default: 256) */
  lambdaMemoryMb?: number;

  /** Lambda timeout in seconds (default: 60) */
  lambdaTimeoutSeconds?: number;

  /** CloudWatch log retention in days (default: 30) */
  logRetentionDays?: logs.RetentionDays;
}

export class StackAlertStack extends cdk.Stack {
  /** The deployed Lambda function */
  public readonly lambdaFunction: lambda.Function;

  /** The Lambda execution role */
  public readonly executionRole: iam.Role;

  constructor(scope: Construct, id: string, props: StackAlertStackProps) {
    super(scope, id, props);

    const {
      environment,
      artifactS3Bucket,
      artifactS3Key,
      telegramChatId,
      telegramBotToken,
      crossAccountRoleArn,
      spikeThresholdPct = 50,
      spikeSchedule = events.Schedule.rate(cdk.Duration.hours(6)),
      digestSchedule = events.Schedule.cron({ minute: "0", hour: "8" }),
      lambdaMemoryMb = 256,
      lambdaTimeoutSeconds = 60,
      logRetentionDays = logs.RetentionDays.ONE_MONTH,
    } = props;

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
    this.executionRole.addToPolicy(
      new iam.PolicyStatement({
        sid: "AllowCloudWatchLogs",
        effect: iam.Effect.ALLOW,
        actions: ["logs:CreateLogStream", "logs:PutLogEvents"],
        resources: [`${logGroup.logGroupArn}:*`],
      })
    );

    // SSM — read the specific bot token parameter only
    this.executionRole.addToPolicy(
      new iam.PolicyStatement({
        sid: "AllowSSMGetBotToken",
        effect: iam.Effect.ALLOW,
        actions: ["ssm:GetParameter"],
        resources: [botTokenParam.parameterArn],
      })
    );

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
        "StackAlert — AWS cost spike detector. Alerts via Telegram when spend exceeds threshold.",
      code: lambda.Code.fromBucket(artifactBucket, artifactS3Key),
      handler: "bootstrap", // Rust Lambda convention
      runtime: lambda.Runtime.PROVIDED_AL2023,
      architecture: lambda.Architecture.ARM_64, // Graviton2: 20% cheaper
      role: this.executionRole,
      memorySize: lambdaMemoryMb,
      timeout: cdk.Duration.seconds(lambdaTimeoutSeconds),
      logGroup,
      loggingFormat: lambda.LoggingFormat.JSON,
      environment: {
        TELEGRAM_BOT_TOKEN_SSM_PARAM: botTokenParam.parameterName,
        TELEGRAM_CHAT_ID: telegramChatId,
        SPIKE_THRESHOLD_PCT: spikeThresholdPct.toString(),
        CROSS_ACCOUNT_ROLE_ARN: crossAccountRoleArn ?? "",
        RUST_LOG: "stackalert_lambda=info,aws_sdk=warn",
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
        event: events.RuleTargetInput.fromObject({ mode: "spike" }),
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
        event: events.RuleTargetInput.fromObject({ mode: "digest" }),
      })
    );

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
  }
}
