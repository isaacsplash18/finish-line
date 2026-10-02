import { withApi } from '@/lib/api/handler';
import { revalidateProjectScreens } from '@/lib/api/revalidate';
import { updateProjectBody } from '@/lib/api/schemas';
import { parseId, parseJsonBody } from '@/lib/api/validation';
import { eraseProject, getProjectOrThrow, updateProject } from '@/lib/data';

type Params = { id: string };

/** GET /api/v1/projects/:id — project + stage events + key dates + reward. */
export const GET = withApi<Params>(async (_request, params) => {
  return getProjectOrThrow(parseId(params.id));
});

/**
 * PATCH /api/v1/projects/:id — name / resolution / next_action /
 * stage_target_date. Editing next_action resets the 14-day staleness clock.
 */
export const PATCH = withApi<Params>(async (request, params) => {
  const id = parseId(params.id);
  const body = await parseJsonBody(request, updateProjectBody);
  await getProjectOrThrow(id); // 404 rather than a DB error for unknown ids
  await updateProject(id, body);
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
