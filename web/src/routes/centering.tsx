import { createRoute } from '@tanstack/react-router';

import { CenteringToolPage } from '../steps/Centering/CenteringToolPage';
import { rootRoute } from './__root';

export const centeringRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/centering',
  component: CenteringToolPage
});
