import { Outlet, createRootRoute } from '@tanstack/react-router';

import { BannerChromium } from '../components/BannerChromium';
import { ShellLayout } from '../components/ShellLayout';

export const rootRoute = createRootRoute({
  component: () => (
    <ShellLayout banner={<BannerChromium />}>
      <Outlet />
    </ShellLayout>
  )
});
