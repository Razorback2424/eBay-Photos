const INVALID_CHARACTERS = /[\\/:*?"<>|]/g;
const WHITESPACE = /\s+/g;
const UNDERSCORE_SEQUENCE = /_+/g;

export const sanitizeFolderSegment = (value: string): string => {
  if (!value) {
    return '';
  }
  return value
    .normalize('NFKC')
    .replace(INVALID_CHARACTERS, '')
    .trim()
    .replace(WHITESPACE, '_')
    .replace(UNDERSCORE_SEQUENCE, '_')
    .replace(/^_+|_+$/g, '');
};

export interface FolderNameInput {
  id: string;
  setName: string;
  cardName: string;
}

export interface FolderNameResult {
  id: string;
  setFolder: string;
  cardFolder: string;
  fullPath: string;
}

export const generateUniqueFolderNames = (items: FolderNameInput[]): FolderNameResult[] => {
  const sanitized = items.map((item) => {
    const setFolder = sanitizeFolderSegment(item.setName);
    const cardBase = sanitizeFolderSegment(item.cardName);
    return { id: item.id, setFolder, cardBase };
  });

  const counts = new Map<string, number>();

  return sanitized.map((item) => {
    if (!item.cardBase) {
      const fullPath = item.setFolder;
      return { id: item.id, setFolder: item.setFolder, cardFolder: '', fullPath };
    }
    const key = `${item.setFolder}__${item.cardBase}`.toLowerCase();
    const count = counts.get(key) ?? 0;
    counts.set(key, count + 1);
    const suffix = count === 0 ? '' : `_${count + 1}`;
    const cardFolder = `${item.cardBase}${suffix}`;
    const fullPath = item.setFolder ? `${item.setFolder}/${cardFolder}` : cardFolder;
    return { id: item.id, setFolder: item.setFolder, cardFolder, fullPath };
  });
};
