import { createRoute } from '@tanstack/react-router';

import { UploadStep } from '../steps/Upload/UploadStep';
import { rootRoute } from './__root';

export const filesRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/',
  component: UploadStep
});
