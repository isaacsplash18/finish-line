import { withApi } from '@/lib/api/handler';
import { revalidateProjectScreens } from '@/lib/api/revalidate';
import { updateProjectBody } from '@/lib/api/schemas';
import { parseId, parseJsonBody } from '@/lib/api/validation';
import {
  eraseProject,
  getProjectOrThrow,
  setProjectKind,
  setProjectRepo,
  updateProject,
} from '@/lib/data';

type Params = { id: string };

/** GET /api/v1/projects/:id — project + stage events + key dates + reward. */
export const GET = withApi<Params>(async (_request, params) => {
  return getProjectOrThrow(parseId(params.id));
});

/**
 * PATCH /api/v1/projects/:id — name / resolution / next_action /
 * stage_target_date, plus v2 `kind` ('project' | 'area') and `github_repo`
 * ("owner/name", a github.com URL, or null to unlink). Editing next_action is
 * a progress signal: it resets the 14-day clock and clears Stuck.
 */
export const PATCH = withApi<Params>(async (request, params) => {
  const id = parseId(params.id);
  const { kind, github_repo: githubRepo, ...fields } = await parseJsonBody(request, updateProjectBody);
  await getProjectOrThrow(id); // 404 rather than a DB error for unknown ids
  if (Object.keys(fields).length > 0) await updateProject(id, fields);
  if (kind !== undefined) await setProjectKind(id, kind);
  if (githubRepo !== undefined) await setProjectRepo(id, githubRepo);
  revalidateProjectScreens(id);
  return getProjectOrThrow(id);
});

/**
 * DELETE /api/v1/projects/:id — ERASE a data-entry mistake (hard delete).
 * 409 unless the project is fresh: no claimed reward, and every stage event
 * is from today or from an import. Done / Killed / Abandoned are the real
 * exits — see `eraseProject` in lib/data/projects.ts.
 */
export const DELETE = withApi<Params>(async (_request, params) => {
  const id = parseId(params.id);
  const result = await eraseProject(id);
  revalidateProjectScreens(id);
  return result;
});
