import { withApi } from '@/lib/api/handler';
import { revalidateAllScreens } from '@/lib/api/revalidate';
import { updateKeyDateBody } from '@/lib/api/schemas';
import { parseId, parseJsonBody } from '@/lib/api/validation';
import { NotFoundError, deleteKeyDate, getKeyDate, updateKeyDate } from '@/lib/data';

type Params = { id: string };

async function requireKeyDate(id: string) {
  const keyDate = await getKeyDate(id);
  if (!keyDate) throw new NotFoundError('Key date', id);
  return keyDate;
}

/** PATCH /api/v1/key-dates/:id {name?, date?, project_id?} */
export const PATCH = withApi<Params>(async (request, params) => {
  const id = parseId(params.id);
  const body = await parseJsonBody(request, updateKeyDateBody);
  await requireKeyDate(id);
  const keyDate = Object.keys(body).length ? await updateKeyDate(id, body) : await requireKeyDate(id);
  revalidateAllScreens();
  return keyDate;
});

/** DELETE /api/v1/key-dates/:id */
export const DELETE = withApi<Params>(async (_request, params) => {
  const id = parseId(params.id);
  await requireKeyDate(id);
  await deleteKeyDate(id);
  revalidateAllScreens();
  return { id, deleted: true };
});
