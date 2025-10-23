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

export type SessionStep = 'files' | 'detections' | 'pairs' | 'naming' | 'output';

export interface FileAsset {
  id: string;
  name: string;
  size: number;
  type: string;
  lastModified: number;
}

export interface WorkingImageInfo {
  blob: Blob;
  width: number;
  height: number;
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
  primaryFileId: string;
  primaryDetectionId?: string;
  secondaryFileId?: string;
  secondaryDetectionId?: string;
  status: 'pending' | 'matched' | 'rejected';
}

export interface NamingPreset {
  id: string;
  pairId: string;
  title: string;
  subtitle?: string;
  keywords: string[];
}

export interface OutputConfig {
  directory: string;
  includeManifests: boolean;
  format: 'json' | 'csv' | 'xml';
}

export const SESSION_STEPS: SessionStep[] = [
  'files',
  'detections',
  'pairs',
  'naming',
  'output'
];

export const STEP_PATHS: Record<SessionStep, string> = {
  files: '/',
  detections: '/detections',
  pairs: '/pairs',
  naming: '/naming',
  output: '/output'
};

const initialState = {
  files: [] as FileAsset[],
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
  setFiles: (files: FileAsset[]) => void;
  setDetections: (detections: Detection[]) => void;
  setPairs: (pairs: Pairing[]) => void;
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
  reset: () => void;
  canAccessStep: (step: SessionStep) => boolean;
  getFirstAccessibleStep: () => SessionStep;
  getNextStep: (step: SessionStep) => SessionStep | null;
  getPreviousStep: (step: SessionStep) => SessionStep | null;
};

export const useSessionStore = create<SessionState>((set, get) => ({
  ...initialState,
  setFiles: (files) => set({ files }),
  setDetections: (detections) => set({ detections }),
  setPairs: (pairs) => set({ pairs }),
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
  reset: () =>
    set({
      ...initialState,
      workingImages: {},
      detectedCards: {}
    }),
  canAccessStep: (step) => {
    const idx = SESSION_STEPS.indexOf(step);
    if (idx <= 0) {
      return true;
    }
    const prevStep = SESSION_STEPS[idx - 1];
    return get().completedSteps.includes(prevStep);
  },
  getFirstAccessibleStep: () => {
    const { completedSteps } = get();
    for (const step of SESSION_STEPS) {
      if (!completedSteps.includes(step)) {
        return step;
      }
    }
    return SESSION_STEPS[SESSION_STEPS.length - 1];
  },
  getNextStep: (step) => {
    const idx = SESSION_STEPS.indexOf(step);
    if (idx === -1) return null;
    return SESSION_STEPS[idx + 1] ?? null;
  },
  getPreviousStep: (step) => {
    const idx = SESSION_STEPS.indexOf(step);
    if (idx <= 0) return null;
    return SESSION_STEPS[idx - 1];
  }
}));

export const getStepPath = (step: SessionStep) => STEP_PATHS[step];
