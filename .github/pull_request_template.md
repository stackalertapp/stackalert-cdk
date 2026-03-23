## What

<!-- Describe what this PR changes. Be specific. -->

## Why

<!-- Explain the motivation. Link to issues if applicable. -->

## Testing done

<!-- Describe how this was tested. -->

- [ ] `npm test` passes locally
- [ ] `npx cdk synth` produces valid CloudFormation
- [ ] Tested manually in dev/staging environment (describe what you verified)

## Security checklist

- [ ] `npm audit --audit-level=high` passes (no high or critical vulnerabilities)
- [ ] No hardcoded secrets, API keys, or credentials in code or config
- [ ] `npx cdk synth` passes without errors
- [ ] IAM permissions reviewed for least-privilege (no wildcard actions unless justified)
- [ ] Any new environment variables are documented and stored in SSM/Secrets Manager

## Notes for reviewers

<!-- Optional: anything the reviewer should pay special attention to. -->
