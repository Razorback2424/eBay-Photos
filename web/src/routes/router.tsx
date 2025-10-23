import { createRouter } from '@tanstack/react-router';

import { detectionsRoute } from './detections';
import { filesRoute } from './files';
import { namingRoute } from './naming';
import { outputRoute } from './output';
import { pairsRoute } from './pairs';
import { rootRoute } from './__root';

const routeTree = rootRoute.addChildren([
  filesRoute,
  detectionsRoute,
  pairsRoute,
  namingRoute,
  outputRoute
]);

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router;
  }
}

export const router = createRouter({
  routeTree
});
