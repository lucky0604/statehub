/**
 * Resolve the right importer for an integration based on its provider.
 *
 * The three importers (github, plane, linear) share the same
 * preview/run call shape but take different issue types (GithubIssue,
 * PlaneIssue, LinearIssue). We erase the issue type to `unknown[]` at
 * the dispatch boundary — each importer casts internally — so the API
 * routes can be provider-agnostic.
 *
 * Source: agent_flow/implementation/v1/phases/phase-06-import-integration.md
 *         §5.1-5.3 (per-provider mapping), P06C dispatch.
 */
import {
  integrationService,
  githubIssuesImporter,
  planeIssuesImporter,
  linearIssuesImporter,
  type IntegrationProvider,
  type ActorContext,
  type ImportPreview,
  type ImportRunResult,
  ValidationError,
  type DbClient,
} from "@statehub/domain";

export interface GenericImportInput {
  projectId: string;
  stateId: string;
  issues: unknown[];
}

export type GenericImporter = {
  preview(
    db: DbClient,
    workspaceId: string,
    integrationId: string,
    input: GenericImportInput,
  ): Promise<ImportPreview>;
  run(
    db: DbClient,
    actor: ActorContext,
    workspaceId: string,
    integrationId: string,
    input: GenericImportInput,
  ): Promise<ImportRunResult>;
};

/**
 * Look up the integration and return the matching importer. Throws
 * ValidationError if the integration doesn't exist or the provider has
 * no importer (e.g. markdown, which is export-only).
 */
export async function resolveImporter(
  db: DbClient,
  workspaceId: string,
  integrationId: string,
): Promise<{ importer: GenericImporter; provider: IntegrationProvider }> {
  const integration = await integrationService.get(db, workspaceId, integrationId);
  if (!integration) {
    throw new ValidationError(`integration not found: ${integrationId}`);
  }
  const importer: GenericImporter | null =
    integration.provider === "github"
      ? (githubIssuesImporter as unknown as GenericImporter)
      : integration.provider === "plane"
        ? (planeIssuesImporter as unknown as GenericImporter)
        : integration.provider === "linear"
          ? (linearIssuesImporter as unknown as GenericImporter)
          : null;
  if (!importer) {
    throw new ValidationError(
      `provider "${integration.provider}" has no importer (export-only?)`,
    );
  }
  return { importer, provider: integration.provider };
}
