import { withApi } from '@/lib/api/handler';
import { revalidateProjectScreens } from '@/lib/api/revalidate';
import { moveProjectBody } from '@/lib/api/schemas';
import { parseId, parseJsonBody } from '@/lib/api/validation';
import { getProjectOrThrow, moveProjectStage, previewStageMove } from '@/lib/data';
import { config } from '@/lib/config';

type Params = { id: string };

/**
 * POST /api/v1/projects/:id/move {toStage, note?, stageTargetDate?}
 *
 * Goes through `moveProjectStage` — never blocked by the soft WIP cap, but
 * priced. Returns the project's new state plus the cost preview that applied
 * at the moment of the move (computed by `previewStageMove` just before it).
 *
 * `focus` spells out what the move means for this week's Focus, which is
 * computed live (v2): `GET /api/v1/focus/week` reflects it immediately.
 */
export const POST = withApi<Params>(async (request, params) => {
  const id = parseId(params.id);
  const body = await parseJsonBody(request, moveProjectBody);

  const before = await getProjectOrThrow(id);
  const costPreview = await previewStageMove(id, body.toStage);

  await moveProjectStage(id, body.toStage, {
    note: body.note,
    stageTargetDate: body.stageTargetDate,
  });
  revalidateProjectScreens(id);
  const project = await getProjectOrThrow(id);

  const changed = before.stage !== project.stage;
  // v2: starting something is only charged when it lands over the cap; areas
  // never pay (previewStageMove already reports isActivation=false for them).
  const isActivation = changed && costPreview.isActivation;
  const immediateDelta = !changed
    ? 0
    : isActivation && costPreview.overBy > 0
      ? config.focus.activationOverCapPenalty
      : body.toStage === 'done' && before.kind !== 'area'
        ? config.focus.doneBonus
        : 0;

  return {
    project,
    fromStage: before.stage,
    toStage: project.stage,
    changed,
    costPreview,
    focus: {
      immediateDelta,
      dailyBleedWhileOverCap: costPreview.overBy * config.focus.overCapPenaltyPerProjectPerDay,
      /** Over cap ⇒ unclaimed rewards are locked (SPEC-CHANGES §3). */
      overCap: costPreview.overBy > 0,
      /** v2: Focus is live — this is already in GET /focus/week. */
      appliesOnNextRecompute: false,
    },
  };
});
