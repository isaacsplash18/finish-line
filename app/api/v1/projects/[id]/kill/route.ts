import { withApi } from '@/lib/api/handler';
import { revalidateProjectScreens } from '@/lib/api/revalidate';
import { killProjectBody } from '@/lib/api/schemas';
import { parseId, parseJsonBody } from '@/lib/api/validation';
import { getKillPreview, getProjectOrThrow, killProject } from '@/lib/data';
import { config } from '@/lib/config';

type Params = { id: string };

/**
 * POST /api/v1/projects/:id/kill {reason}
 * Reason required. Killing from Building or beyond is a decisive kill
 * (+10 Focus); killing an Idea is neutral. Terminal projects → 409.
 */
export const POST = withApi<Params>(async (request, params) => {
  const id = parseId(params.id);
  const body = await parseJsonBody(request, killProjectBody);

  const { project: before, bonusCopy } = await getKillPreview(id);
  await killProject(id, body.reason);
  revalidateProjectScreens(id);
  const project = await getProjectOrThrow(id);

  return {
    project,
    fromStage: before.stage,
    killBonus: bonusCopy,
    focus: {
      // Areas are never scored (SPEC-V2 §5).
      immediateDelta: bonusCopy && before.kind !== 'area' ? config.focus.decisiveKillBonus : 0,
      appliesOnNextRecompute: false,
    },
  };
});
