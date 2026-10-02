import { withApi } from '@/lib/api/handler';
import { revalidateProjectScreens } from '@/lib/api/revalidate';
import { abandonProjectBody } from '@/lib/api/schemas';
import { parseId, parseJsonBody } from '@/lib/api/validation';
import { abandonProject, getProjectOrThrow } from '@/lib/data';
import { config } from '@/lib/config';

type Params = { id: string };

/**
 * POST /api/v1/projects/:id/abandon {reason?}
 * The worst outcome: -25 Focus and the linked reward is permanently forfeited.
 * Prefer /kill. Terminal projects → 409.
 */
export const POST = withApi<Params>(async (request, params) => {
  const id = parseId(params.id);
  const body = await parseJsonBody(request, abandonProjectBody);

  const before = await getProjectOrThrow(id);
  await abandonProject(id, body.reason);
  revalidateProjectScreens(id);
  const project = await getProjectOrThrow(id);

  return {
    project,
    fromStage: before.stage,
    forfeitedReward: project.reward?.status === 'forfeited' ? project.reward : null,
    focus: {
      immediateDelta: config.focus.abandonedPenalty,
      appliesOnNextRecompute: true,
    },
  };
});
