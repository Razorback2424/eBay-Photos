import { ChangeEvent, useId } from 'react';
import { createRoute } from '@tanstack/react-router';

import { StepNavigation } from '../components/StepNavigation';
import { rootRoute } from './__root';
import { Stack } from '../ui/Stack';
import { Text } from '../ui/Text';
import { FileAsset, useSessionStore } from '../state/session';

const toAsset = (file: File): FileAsset => ({
  id: `${file.name}-${file.size}-${file.lastModified}`,
  name: file.name,
  size: file.size,
  type: file.type,
  lastModified: file.lastModified
});

const FilesStep = () => {
  const inputId = useId();
  const { files, setFiles } = useSessionStore((state) => ({
    files: state.files,
    setFiles: state.setFiles
  }));

  const handleFileChange = (event: ChangeEvent<HTMLInputElement>) => {
    const selection = event.target.files;
    if (!selection) return;
    const assets = Array.from(selection).map(toAsset);
    setFiles(assets);
  };

  return (
    <Stack gap={24}>
      <Stack gap={8}>
        <Text as="h2" variant="title">
          Import your product photos
        </Text>
        <Text variant="body">
          Select the imagery you want to process. Only metadata is stored locally while you work through the
          wizard.
        </Text>
      </Stack>
      <label htmlFor={inputId}>
        <Text as="span" variant="label">
          Choose files
        </Text>
      </label>
      <input id={inputId} type="file" multiple onChange={handleFileChange} aria-describedby={`${inputId}-help`} />
      <Text id={`${inputId}-help`} variant="muted">
        Supported formats: JPEG, PNG, HEIC. Drag and drop is coming soon.
      </Text>
      {files.length > 0 && (
        <Stack gap={4} aria-live="polite">
          <Text as="h3" variant="label">
            Selected files
          </Text>
          <ul>
            {files.map((file) => (
              <li key={file.id}>
                <Text as="span" variant="body">
                  {file.name} — {(file.size / 1024).toFixed(1)} KB
                </Text>
              </li>
            ))}
          </ul>
        </Stack>
      )}
      <StepNavigation step="files" nextLabel="Review detections" nextDisabled={files.length === 0} />
    </Stack>
  );
};

export const filesRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/',
  component: FilesStep
});
