import { create } from 'zustand';

import type { DetectedCard } from '../types/detections';

export interface ManualDetectionAdjustment {
  id: string;
  card: DetectedCard;
}

export interface DetectionAdjustment {
  disabledAuto: number[];
  manual: ManualDetectionAdjustment[];
}

export type SessionStep = 'files' | 'sourcePairs' | 'detections' | 'pairs' | 'naming' | 'output';
export type IntakeMode = 'simple' | 'batch';
export type InferredSide = 'front' | 'back' | 'unknown';

export interface FileAsset {
  id: string;
  name: string;
  size: number;
  type: string;
  lastModified: number;
  relativePath?: string;
  inferredSide?: InferredSide;
}

export interface SourcePair {
  id: string;
  primaryFileId: string;
  secondaryFileId: string;
  status: 'draft' | 'confirmed';
  confidence?: number;
  reason?: string;
  matchType: 'auto' | 'manual';
}

export interface WorkingImageInfo {
  blob: Blob;
  width: number;
  height: number;
  originalBlob: Blob;
  originalWidth: number;
  originalHeight: number;
  scaleX: number;
  scaleY: number;
}

export interface Detection {
  id: string;
  fileId: string;
  label: string;
  confidence: number;
  bounds: [number, number, number, number];
  accepted: boolean | null;
}

export interface Pairing {
  id: string;
  sourcePairId: string;
  primaryFileId: string;
  primaryDetectionId?: string;
  secondaryFileId?: string;
  secondaryDetectionId?: string;
  status: 'pending' | 'matched' | 'rejected';
}

export interface NamingPreset {
  id: string;
  pairId: string;
  cardName: string;
  setName: string;
  setFolder: string;
  cardFolder: string;
  folderPath: string;
}

export interface OutputConfig {
  directoryHandle: FileSystemDirectoryHandle | null;
  directoryName: string;
  includeManifests: boolean;
  format: 'jpeg' | 'png';
  quality: number;
  includeWarped: boolean;
  includeCenteringOverlay: boolean;
}

const SIMPLE_STEPS: SessionStep[] = ['files', 'detections', 'pairs', 'naming', 'output'];
const BATCH_STEPS: SessionStep[] = ['files', 'sourcePairs', 'detections', 'pairs', 'naming', 'output'];

export const SESSION_STEPS: SessionStep[] = BATCH_STEPS;

export const getSessionSteps = (mode: IntakeMode): SessionStep[] => (mode === 'batch' ? BATCH_STEPS : SIMPLE_STEPS);

export const STEP_PATHS: Record<SessionStep, string> = {
  files: '/',
  sourcePairs: '/source-pairs',
  detections: '/detections',
  pairs: '/pairs',
  naming: '/naming',
  output: '/output'
};

const initialState = {
  intakeMode: 'simple' as IntakeMode,
  files: [] as FileAsset[],
  sourcePairs: [] as SourcePair[],
  skippedFileIds: [] as string[],
  detections: [] as Detection[],
  pairs: [] as Pairing[],
  naming: [] as NamingPreset[],
  output: null as OutputConfig | null,
  currentStep: 'files' as SessionStep,
  completedSteps: [] as SessionStep[],
  workingImages: {} as Record<string, WorkingImageInfo>,
  detectedCards: {} as Record<string, DetectedCard[]>,
  detectionAdjustments: {} as Record<string, DetectionAdjustment>
};

export type SessionState = typeof initialState & {
  setIntakeMode: (mode: IntakeMode) => void;
  setFiles: (files: FileAsset[]) => void;
  setSourcePairs: (pairs: SourcePair[]) => void;
  confirmSourcePairs: () => void;
  setSkippedFileIds: (fileIds: string[]) => void;
  setDetections: (detections: Detection[]) => void;
  setPairs: (pairs: Pairing[]) => void;
  setPairsForSourcePair: (sourcePairId: string, pairs: Pairing[]) => void;
  setNaming: (naming: NamingPreset[]) => void;
  setOutput: (output: OutputConfig | null) => void;
  setCurrentStep: (step: SessionStep) => void;
  completeStep: (step: SessionStep) => void;
  setWorkingImage: (fileId: string, info: WorkingImageInfo | null) => void;
  clearWorkingImages: () => void;
  setDetectedCards: (fileId: string, cards: DetectedCard[]) => void;
  toggleDetectionActive: (fileId: string, index: number) => void;
  addManualDetection: (fileId: string, card: DetectedCard) => void;
  removeManualDetection: (fileId: string, manualId: string) => void;
  clearWorkflowData: () => void;
  getVisibleSteps: () => SessionStep[];
  getConfirmedSourcePairs: () => SourcePair[];
  reset: () => void;
  canAccessStep: (step: SessionStep) => boolean;
  getFirstAccessibleStep: () => SessionStep;
  getNextStep: (step: SessionStep) => SessionStep | null;
  getPreviousStep: (step: SessionStep) => SessionStep | null;
};

export const useSessionStore = create<SessionState>((set, get) => ({
  ...initialState,
  setIntakeMode: (mode) => set({ intakeMode: mode }),
  setFiles: (files) => set({ files }),
  setSourcePairs: (sourcePairs) => set({ sourcePairs }),
  confirmSourcePairs: () =>
    set((state) => ({
      sourcePairs: state.sourcePairs.map((pair) => ({
        ...pair,
        status: 'confirmed'
      }))
    })),
  setSkippedFileIds: (skippedFileIds) => set({ skippedFileIds }),
  setDetections: (detections) => set({ detections }),
  setPairs: (pairs) => set({ pairs }),
  setPairsForSourcePair: (sourcePairId, nextPairs) =>
    set((state) => ({
      pairs: [
        ...state.pairs.filter((pair) => pair.sourcePairId !== sourcePairId),
        ...nextPairs
      ]
    })),
  setNaming: (naming) => set({ naming }),
  setOutput: (output) => set({ output }),
  setCurrentStep: (step) => set({ currentStep: step }),
  completeStep: (step) =>
    set((state) => {
      if (state.completedSteps.includes(step)) {
        return state;
      }
      return {
        completedSteps: [...state.completedSteps, step]
      };
    }),
  setWorkingImage: (fileId, info) =>
    set((state) => {
      const next = { ...state.workingImages };
      if (info) {
        next[fileId] = info;
      } else {
        delete next[fileId];
      }
      return { workingImages: next };
    }),
  clearWorkingImages: () => set({ workingImages: {}, detectedCards: {} }),
  setDetectedCards: (fileId, cards) =>
    set((state) => {
      const next = { ...state.detectedCards };
      if (!cards || cards.length === 0) {
        delete next[fileId];
        const adjustments = { ...state.detectionAdjustments };
        delete adjustments[fileId];
        return { detectedCards: next, detectionAdjustments: adjustments };
      } else {
        next[fileId] = cards;
        const adjustments = { ...state.detectionAdjustments };
        if (!adjustments[fileId]) {
          adjustments[fileId] = { disabledAuto: [], manual: [] };
        }
        return { detectedCards: next, detectionAdjustments: adjustments };
      }
    }),
  toggleDetectionActive: (fileId, index) =>
    set((state) => {
      const current = state.detectionAdjustments[fileId] ?? { disabledAuto: [], manual: [] };
      const disabledSet = new Set(current.disabledAuto);
      if (disabledSet.has(index)) {
        disabledSet.delete(index);
      } else {
        disabledSet.add(index);
      }
      return {
        detectionAdjustments: {
          ...state.detectionAdjustments,
          [fileId]: {
            ...current,
            disabledAuto: Array.from(disabledSet).sort((a, b) => a - b)
          }
        }
      };
    }),
  addManualDetection: (fileId, card) =>
    set((state) => {
      const current = state.detectionAdjustments[fileId] ?? { disabledAuto: [], manual: [] };
      const manualId = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
      return {
        detectionAdjustments: {
          ...state.detectionAdjustments,
          [fileId]: {
            ...current,
            manual: [...current.manual, { id: manualId, card }]
          }
        }
      };
    }),
  removeManualDetection: (fileId, manualId) =>
    set((state) => {
      const current = state.detectionAdjustments[fileId];
      if (!current) {
        return state;
      }
      const nextManual = current.manual.filter((item) => item.id !== manualId);
      return {
        detectionAdjustments: {
          ...state.detectionAdjustments,
          [fileId]: {
            ...current,
            manual: nextManual
          }
        }
      };
    }),
  clearWorkflowData: () =>
    set((state) => ({
      sourcePairs: [],
      skippedFileIds: [],
      detections: [],
      pairs: [],
      naming: [],
      output: null,
      completedSteps: state.currentStep === 'files' ? [] : ['files'],
      workingImages: {},
      detectedCards: {},
      detectionAdjustments: {}
    })),
  getVisibleSteps: () => getSessionSteps(get().intakeMode),
  getConfirmedSourcePairs: () => get().sourcePairs.filter((pair) => pair.status === 'confirmed'),
  reset: () =>
    set({
      ...initialState,
      workingImages: {},
      detectedCards: {}
    }),
  canAccessStep: (step) => {
    const orderedSteps = getSessionSteps(get().intakeMode);
    const idx = orderedSteps.indexOf(step);
    if (idx === -1) {
      return false;
    }
    if (idx <= 0) {
      return true;
    }
    const prevStep = orderedSteps[idx - 1];
    return get().completedSteps.includes(prevStep);
  },
  getFirstAccessibleStep: () => {
    const orderedSteps = getSessionSteps(get().intakeMode);
    const { completedSteps } = get();
    for (const step of orderedSteps) {
      if (!completedSteps.includes(step)) {
        return step;
      }
    }
    return orderedSteps[orderedSteps.length - 1];
  },
  getNextStep: (step) => {
    const orderedSteps = getSessionSteps(get().intakeMode);
    const idx = orderedSteps.indexOf(step);
    if (idx === -1) return null;
    return orderedSteps[idx + 1] ?? null;
  },
  getPreviousStep: (step) => {
    const orderedSteps = getSessionSteps(get().intakeMode);
    const idx = orderedSteps.indexOf(step);
    if (idx <= 0) return null;
    return orderedSteps[idx - 1];
  }
}));

export const getStepPath = (step: SessionStep) => STEP_PATHS[step];
