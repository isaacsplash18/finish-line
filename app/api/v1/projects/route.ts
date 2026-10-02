import { withApi } from '@/lib/api/handler';
import { revalidateProjectScreens } from '@/lib/api/revalidate';
import { createProjectBody, listProjectsQuery } from '@/lib/api/schemas';
import { parseJsonBody, parseQuery } from '@/lib/api/validation';
import { createProject, getActiveProjectCount, getProjects } from '@/lib/data';
import { describeActivationCost } from '@/lib/scores';

/**
 * GET /api/v1/projects[?includeTerminal=true][&stuck=true]
 * Pipeline projects (Done/Killed/Abandoned excluded unless includeTerminal).
 */
export const GET = withApi(async (request) => {
  const query = parseQuery(request, listProjectsQuery);
  return getProjects({
    includeTerminal: query.includeTerminal ?? false,
    onlyStuck: query.stuck ?? false,
  });
});

/**
 * POST /api/v1/projects — create. `next_action` required. Creating straight
 * into Building/Commercialising is allowed at any count (soft cap) and priced:
 * `costPreview` is the price tag the UI would have shown (null for Idea /
 * Shipped, which are free).
 */
export const POST = withApi(
  async (request) => {
    const body = await parseJsonBody(request, createProjectBody);
    const activeBefore = await getActiveProjectCount();
    const project = await createProject(body);
    revalidateProjectScreens(project.id);

    const costPreview = project.isActive
      ? describeActivationCost(activeBefore + 1, { isNewBuild: project.stage === 'building' })
      : null;

    return { project, costPreview };
  },
  { status: 201 },
);
