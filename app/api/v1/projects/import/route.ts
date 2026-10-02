import { withApi } from '@/lib/api/handler';
import { revalidateProjectScreens } from '@/lib/api/revalidate';
import { importProjectBody } from '@/lib/api/schemas';
import { parseJsonBody } from '@/lib/api/validation';
import { getActiveProjectCount, importProject } from '@/lib/data';
import { describeImportImpact } from '@/lib/scores';

/**
 * POST /api/v1/projects/import — bring an already-running project in WITHOUT
 * the -15 entry charge (see `importProject` / `IMPORT_EVENT_MARKER`). It can
 * still push the portfolio over the soft cap; that bleed starts tomorrow.
 */
export const POST = withApi(
  async (request) => {
    const body = await parseJsonBody(request, importProjectBody);
    const activeBefore = await getActiveProjectCount();
    const project = await importProject(body);
    revalidateProjectScreens(project.id);

    const impact = project.isActive ? describeImportImpact(activeBefore + 1) : null;
    return { project, impact };
  },
  { status: 201 },
);
