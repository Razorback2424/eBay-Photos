import { Outlet, createRootRoute } from '@tanstack/react-router';

import { ShellLayout } from '../components/ShellLayout';

export const rootRoute = createRootRoute({
  component: () => (
    <ShellLayout>
      <Outlet />
    </ShellLayout>
  )
});
