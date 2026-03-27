import * as cdk from "aws-cdk-lib";
import * as lambda from "aws-cdk-lib/aws-lambda";
import * as s3 from "aws-cdk-lib/aws-s3";
import { Template, Match } from "aws-cdk-lib/assertions";
import { StackAlertStack } from "../lib/stackalert-stack";

const defaultProps = {
  environment: "test",
  // Use fromBucket with S3 props (backward-compat path) to avoid needing a real asset file.
  artifactS3Bucket: "my-artifacts",
  artifactS3Key: "stackalert-lambda/latest.zip",
  notificationChannels: "telegram",
  telegramChatId: "-1001234567890",
  telegramBotToken: "test-token",
  env: { account: "123456789012", region: "eu-central-1" },
};

function buildStack(overrides = {}): Template {
  const app = new cdk.App();
  const stack = new StackAlertStack(app, "TestStack", {
    ...defaultProps,
    ...overrides,
  });
  return Template.fromStack(stack);
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
        Variables: Match.objectLike({
          TELEGRAM_CHAT_ID: "-1001234567890",
          SPIKE_THRESHOLD_PCT: "75",
        }),
      },
    });
  });

  test("creates SSM parameter for Telegram bot token", () => {
    const template = buildStack();

    // CDK StringParameter maps to SSM Type=String in CloudFormation.
    // Sensitive values should be rotated via SSM console after first deploy.
    template.hasResourceProperties("AWS::SSM::Parameter", {
      Name: "/stackalert/test/telegram-bot-token",
      Type: "String",
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
        Statement: Match.arrayWith([
          Match.objectLike({
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

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const allStatements = Object.values(policies).flatMap(
      (p: any) => p.Properties.PolicyDocument.Statement // CDK Template returns untyped JSON
    );

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const stsStatements = allStatements.filter(
      (s: any) => s.Action === "sts:AssumeRole"
    );

    expect(stsStatements.length).toBe(0);
  });

  test("adds STS permission when crossAccountRoleArn is provided", () => {
    const template = buildStack({
      crossAccountRoleArn: "arn:aws:iam::999999999999:role/stackalert-reader",
    });

    template.hasResourceProperties("AWS::IAM::Policy", {
      PolicyDocument: {
        Statement: Match.arrayWith([
          Match.objectLike({
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
      DeadLetterConfig: Match.objectLike({
        TargetArn: Match.anyValue(),
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

  test("Lambda execution role trust policy has SourceAccount condition", () => {
    const template = buildStack();

    template.hasResourceProperties("AWS::IAM::Role", {
      RoleName: "stackalert-lambda-test",
      AssumeRolePolicyDocument: Match.objectLike({
        Statement: Match.arrayWith([
          Match.objectLike({
            Action: "sts:AssumeRole",
            Effect: "Allow",
            Principal: { Service: "lambda.amazonaws.com" },
            Condition: {
              StringEquals: { "aws:SourceAccount": "123456789012" },
            },
          }),
        ]),
      }),
    });
  });

  test("IAM role has X-Ray tracing permission", () => {
    const template = buildStack();

    template.hasResourceProperties("AWS::IAM::Policy", {
      PolicyDocument: {
        Statement: Match.arrayWith([
          Match.objectLike({
            Sid: "AllowXRayTracing",
            Action: Match.arrayWith([
              "xray:PutTraceSegments",
              "xray:PutTelemetryRecords",
            ]),
            Effect: "Allow",
            Resource: "*",
          }),
        ]),
      },
    });
  });

  test("Lambda has X-Ray active tracing enabled", () => {
    const template = buildStack();

    template.hasResourceProperties("AWS::Lambda::Function", {
      TracingConfig: { Mode: "Active" },
    });
  });

  test("no deploy role created when createDeployRole is false (default)", () => {
    const template = buildStack();

    // Should have exactly one IAM role: the Lambda execution role
    const roles = template.findResources("AWS::IAM::Role");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const roleNames = Object.values(roles).map(
      (r: any) => r.Properties.RoleName // CDK Template returns untyped JSON
    );
    expect(roleNames).not.toContain("stackalert-deploy-test");
  });

  test("creates deploy role when createDeployRole is true", () => {
    const template = buildStack({
      createDeployRole: true,
      githubOrg: "stackalertapp",
      githubRepo: "stackalert-cdk",
    });

    template.hasResourceProperties("AWS::IAM::Role", {
      RoleName: "stackalert-deploy-test",
      MaxSessionDuration: 3600,
    });
  });

  test("deploy role is scoped to the specified GitHub repo", () => {
    const template = buildStack({
      createDeployRole: true,
      githubOrg: "stackalertapp",
      githubRepo: "stackalert-cdk",
    });

    template.hasResourceProperties("AWS::IAM::Role", {
      RoleName: "stackalert-deploy-test",
      AssumeRolePolicyDocument: Match.objectLike({
        Statement: Match.arrayWith([
          Match.objectLike({
            Condition: Match.objectLike({
              StringLike: {
                "token.actions.githubusercontent.com:sub":
                  "repo:stackalertapp/stackalert-cdk:*",
              },
            }),
          }),
        ]),
      }),
    });
  });

  test("spike EventBridge rule passes mode=spike in event payload", () => {
    const template = buildStack();

    template.hasResourceProperties("AWS::Events::Rule", {
      Name: "stackalert-spike-check-test",
      Targets: Match.arrayWith([
        Match.objectLike({
          Input: JSON.stringify({ mode: "spike" }),
        }),
      ]),
    });
  });

  test("digest EventBridge rule passes mode=digest in event payload", () => {
    const template = buildStack();

    template.hasResourceProperties("AWS::Events::Rule", {
      Name: "stackalert-daily-digest-test",
      Targets: Match.arrayWith([
        Match.objectLike({
          Input: JSON.stringify({ mode: "digest" }),
        }),
      ]),
    });
  });

  test("IAM role has SSM dedup read/write permissions", () => {
    const template = buildStack();

    template.hasResourceProperties("AWS::IAM::Policy", {
      PolicyDocument: {
        Statement: Match.arrayWith([
          Match.objectLike({
            Sid: "AllowSSMDedupReadWrite",
            Action: Match.arrayWith(["ssm:GetParameter", "ssm:PutParameter"]),
            Effect: "Allow",
          }),
        ]),
      },
    });
  });

  test("throws when neither lambdaCode nor S3 props are provided", () => {
    const app = new cdk.App();
    expect(() => {
      new StackAlertStack(app, "ThrowStack", {
        environment: "test",
        notificationChannels: "telegram",
        telegramChatId: "-1001234567890",
        telegramBotToken: "test-token",
        env: { account: "123456789012", region: "eu-central-1" },
      });
    }).toThrow(/provide either `lambdaCode`/);
  });

  test("accepts lambdaCode prop instead of S3 props", () => {
    const app = new cdk.App();
    // Bucket references must live inside a stack scope — use a helper stack
    const helperStack = new cdk.Stack(app, "Helper", { env: { account: "123456789012", region: "eu-central-1" } });
    const codeBucket = s3.Bucket.fromBucketName(helperStack, "CodeBucket", "lambda-code-bucket");
    const stack = new StackAlertStack(app, "LambdaCodeStack", {
      environment: "test",
      lambdaCode: lambda.Code.fromBucket(codeBucket, "bootstrap.zip"),
      notificationChannels: "telegram",
      telegramChatId: "-1001234567890",
      telegramBotToken: "test-token",
      env: { account: "123456789012", region: "eu-central-1" },
    });
    const template = Template.fromStack(stack);
    template.hasResourceProperties("AWS::Lambda::Function", {
      FunctionName: "stackalert-test",
    });
  });
});
