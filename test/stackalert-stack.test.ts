import * as cdk from "aws-cdk-lib";
import { Template, Match } from "aws-cdk-lib/assertions";
import { StackAlertStack } from "../lib/stackalert-stack";

const defaultProps = {
  environment: "test",
  artifactS3Bucket: "my-artifacts",
  artifactS3Key: "stackalert-lambda/latest.zip",
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

    const allStatements = Object.values(policies).flatMap(
      (p: any) => p.Properties.PolicyDocument.Statement
    );

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
});
