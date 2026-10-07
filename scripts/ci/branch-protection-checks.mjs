export const WORKFLOW_NAME = 'staging-readiness';

export const DEVELOP_REQUIRED_JOB_NAMES = Object.freeze([
  'Static checks',
  'Workspace suites',
  'Mobile production export',
  'Mobile HTTP smoke',
  'Disposable PostgreSQL suites',
  'Staging tooling and Compose tests',
  'Security audit',
  'Security secrets',
  'Image build scan SBOM api',
  'Image build scan SBOM worker',
  'Image build scan SBOM admin-web',
  'Secretless qualification (disposable PostgreSQL)',
]);

export const PROTECTED_STAGING_JOB_NAME =
  'Protected staging qualification (ephemeral Compose)';

export const PRODUCTION_RELEASE_WORKFLOW_NAME = 'production-release';
export const PRODUCTION_RELEASE_JOB_NAME = 'Production release';

export function statusCheckContext(workflowName, jobName) {
  return `${workflowName} / ${jobName}`;
}

export const DEVELOP_REQUIRED_STATUS_CHECKS = Object.freeze(
  DEVELOP_REQUIRED_JOB_NAMES.map((jobName) =>
    statusCheckContext(WORKFLOW_NAME, jobName),
  ),
);

export const STAGING_BRANCH_REQUIRED_STATUS_CHECKS = DEVELOP_REQUIRED_STATUS_CHECKS;

export const SECRETLESS_QUALIFICATION = Object.freeze({
  qualificationClass: 'secretless-disposable-postgresql',
  stagingQualification: false,
  productionQualification: false,
});
