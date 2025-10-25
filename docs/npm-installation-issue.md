# npm installation issue

While attempting to run `npm --prefix web install` the registry responded with `403 Forbidden` for scoped packages such as `@tanstack/react-router`. This prevents installing the project's dependencies inside the CI container, and consequently build and test commands fail early due to the missing packages.

If you have access credentials for the required registry mirror, configure them locally (for example via `.npmrc`) before re-running the install command. Otherwise, run the checks on a network that permits access to the public npm registry.
