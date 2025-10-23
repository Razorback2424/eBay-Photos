import { Outlet, createRootRoute } from '@tanstack/react-router';

import { BannerChromium } from '../components/BannerChromium';
import { ShellLayout } from '../components/ShellLayout';

const RootComponent = () => (
  <ShellLayout banner={<BannerChromium />}>
    <Outlet />
  </ShellLayout>
);

export const rootRoute = createRootRoute({
  component: RootComponent
});
