import cv2
import os
import pytesseract
from pytesseract import Output
import re
import math
import json
import shutil
from datetime import date
import pillow_heif
from PIL import Image
import numpy as np

try:
    import requests
    HAS_REQUESTS = True
except ImportError:
    requests = None
    HAS_REQUESTS = False

# --- Configuration ---
SUPPORTED_EXTENSIONS = ('.jpg', '.jpeg', '.heic')
PADDING = 150
OCR_CONFIG = "--psm 6 -l eng"

# Ratio of the padded card image height used for the name region in OCR.
# Using only the top part of the card reduces background clutter and improves recognition.
ROI_RATIO = 0.25

# OCR window placement and orientation sweep
ROI_X_START_RATIO = 0.05
ROI_WIDTH_RATIO = 0.9
ROI_Y_START_RATIO = 0.03
ROI_HEIGHT_RATIO = 0.18
ROTATION_CANDIDATES = (0, 90, 180, 270)

# When True, also save the warped (perspective-corrected) image for debugging.
# Listing images will always use the original photo crop to avoid squishing.
SAVE_WARPED_DEBUG = os.environ.get("POKEMON_SAVE_WARPED", "").lower() in {"1", "true", "yes", "on"}

def score_ocr_candidate(text):
    """Scores an OCR candidate string for likelihood of being a card name."""
    cleaned = text.strip()
    if not cleaned:
        return 0
    letters = sum(ch.isalpha() for ch in cleaned)
    digits = sum(ch.isdigit() for ch in cleaned)
    penalty = sum(not (ch.isalnum() or ch.isspace() or ch in "-'/") for ch in cleaned)
    # Favor alphabetic-heavy strings, allow some digits, penalize junk.
    return letters * 2 + digits - penalty * 2

# Collector-number OCR configuration (Phase 1 fallback; Phase 2 upgrades add detector/recognizer support)
NUM_REGEX = re.compile(r"\b(\d{1,3})\s*/\s*(\d{1,3})\b")
ALNUM_REGEX = re.compile(r"\b[A-Z]{1,5}\s*-?\s*\d{1,4}\b")
CARD_API_URL = "https://api.pokemontcg.io/v2/cards"

COLLECTOR_ROI_CANDIDATES = [
    {"x_start": 0.02, "x_end": 0.32, "y_start": 0.84, "y_end": 0.98},  # bottom-left standard (first)
    {"x_start": 0.01, "x_end": 0.34, "y_start": 0.78, "y_end": 0.98},  # bottom-left tall
    {"x_start": 0.33, "x_end": 0.67, "y_start": 0.84, "y_end": 0.98},  # bottom-center
    {"x_start": 0.30, "x_end": 0.70, "y_start": 0.78, "y_end": 0.98},  # bottom-center tall
    {"x_start": 0.68, "x_end": 0.98, "y_start": 0.84, "y_end": 0.98},  # bottom-right standard
    {"x_start": 0.60, "x_end": 0.98, "y_start": 0.78, "y_end": 0.98},  # bottom-right tall
]
COLLECTOR_SCALE_FACTORS = (2.0, 2.6, 3.0)
COLLECTOR_OCR_CONFIGS = (
    "--psm 7 -l eng -c tessedit_char_whitelist=0123456789/",
    "--psm 6 -l eng -c tessedit_char_whitelist=0123456789/",
    "--psm 13 -l eng -c tessedit_char_whitelist=0123456789/",
    "--psm 7 -l eng -c tessedit_char_whitelist=0123456789/ABCDEFGHIJKLMNOPQRSTUVWXYZ",
    "--psm 6 -l eng -c tessedit_char_whitelist=0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ/",
)

# Continuous bottom band used for detector-first search (Phase 2)
BOTTOM_BAND = {"x_start": 0.0, "x_end": 1.0, "y_start": 0.80, "y_end": 0.99}

# External OCR pipeline toggles (Phase 2: detector -> recognizer)
USE_EASY_OCR = os.environ.get("POKEMON_USE_EASYOCR", "").lower() in {"1", "true", "yes", "on"}
USE_PADDLE_OCR = os.environ.get("POKEMON_USE_PADDLEOCR", "").lower() in {"1", "true", "yes", "on"}
EAST_MODEL_PATH = os.environ.get("POKEMON_EAST_MODEL", "")
CRAFT_MODEL_PATH = os.environ.get("POKEMON_CRAFT_MODEL", "")

# Optional API key support + simple in-memory cache
API_KEY = os.environ.get("POKEMONTCG_API_KEY", "").strip()
HEADERS = {"X-Api-Key": API_KEY} if API_KEY else None
CARD_CACHE = {}

# Additional collector-number patterns (e.g., GG01/GG70, TG01/TG30, digit suffixes like 12a/151)
GG_REGEX = re.compile(r"\b[A-Z]{1,4}\s*\d{1,3}\s*/\s*[A-Z]{1,4}\s*\d{1,3}\b")
NUM_WITH_SUFFIX_REGEX = re.compile(r"\b(\d{1,3}[A-Za-z]?)\s*/\s*(\d{1,3}[A-Za-z]?)\b")

# Visual reference configuration (Phase 1 shortlisting)
REFERENCE_DIR = "_Card_Reference"
REFERENCE_METADATA_FILE = "metadata.json"
REFERENCE_TOP_K = 5
REFERENCE_ACCEPT_SCORE = 0.72
ART_REGION = {
    "x_start": 0.08,
    "x_end": 0.92,
    "y_start": 0.15,
    "y_end": 0.68,
}

AUTO_ACCEPT_THRESHOLD = 0.75
CONF_WEIGHTS = {"visual": 0.5, "number": 0.3, "api": 0.2}

# Global caches
REFERENCE_INDEX = None
TEXT_DETECTOR = None
EASYOCR_READER = None
PADDLE_OCR_READER = None

# Optional debug flag (set POKEMON_DEBUG=1 to enable)
DEBUG = os.environ.get("POKEMON_DEBUG", "").lower() in {"1", "true", "yes", "on"}

# --- Helper Functions ---
def find_scan_file(basename):
    """To locate the first valid image file for a given basename."""
    for ext in SUPPORTED_EXTENSIONS:
        filename = f"{basename}{ext}"
        if os.path.exists(filename):
            return filename
    return None

def read_image_universal(filepath):
    """To take any valid filepath and return a standardized OpenCV image object."""
    try:
        if filepath.lower().endswith(('.jpg', '.jpeg')):
            return cv2.imread(filepath)
        elif filepath.lower().endswith('.heic'):
            heif_file = pillow_heif.read_heif(filepath)
            image = Image.frombytes(
                heif_file.mode,
                heif_file.size,
                heif_file.data,
                "raw",
                heif_file.mode,
                heif_file.stride,
            )
            return cv2.cvtColor(np.array(image), cv2.COLOR_RGB2BGR)
    except Exception as e:
        print(f"Error reading or converting {filepath}: {e}")
        return None
    return None

def euclidean_distance(p1, p2):
    """Calculates Euclidean distance."""
    return math.sqrt((p1[0] - p2[0])**2 + (p1[1] - p2[1])**2)

def sanitize_filename(name):
    """Removes invalid characters for folder names."""
    return re.sub(r'[\\/*?:"<>|]', "", name).strip().replace(" ", "_")

def sort_contours_tltr(contours):
    """Sorts contours from top-to-bottom, then left-to-right."""
    boxes = [cv2.boundingRect(c) for c in contours]
    return [c for _, c in sorted(zip(boxes, contours), key=lambda z: (z[0][1], z[0][0]))]

def get_contour_center(contour):
    """Calculates the center (x,y) of a contour."""
    M = cv2.moments(contour)
    return (int(M["m10"] / M["m00"]), int(M["m01"] / M["m00"])) if M["m00"] != 0 else (0, 0)

def rotate_image(image, angle):
    """Rotates an image by multiples of 90 degrees."""
    if angle == 0:
        return image
    if angle == 90:
        return cv2.rotate(image, cv2.ROTATE_90_CLOCKWISE)
    if angle == 180:
        return cv2.rotate(image, cv2.ROTATE_180)
    if angle == 270:
        return cv2.rotate(image, cv2.ROTATE_90_COUNTERCLOCKWISE)
    raise ValueError(f"Unsupported rotation angle: {angle}")

def rect_iou(rect_a, rect_b):
    """Calculates IoU between two bounding rectangles."""
    ax, ay, aw, ah = rect_a
    bx, by, bw, bh = rect_b
    ax2, ay2 = ax + aw, ay + ah
    bx2, by2 = bx + bw, by + bh

    inter_x1, inter_y1 = max(ax, bx), max(ay, by)
    inter_x2, inter_y2 = min(ax2, bx2), min(ay2, by2)
    inter_w = max(0, inter_x2 - inter_x1)
    inter_h = max(0, inter_y2 - inter_y1)
    inter_area = inter_w * inter_h
    if inter_area == 0:
        return 0.0

    area_a = aw * ah
    area_b = bw * bh
    union_area = area_a + area_b - inter_area
    return inter_area / union_area if union_area else 0.0

def merge_overlapping_contours(contours, overlap_threshold=0.35):
    """Merges heavily overlapping contours (e.g., fragmented card edges)."""
    contours = list(contours)
    merged = True
    while merged and len(contours) > 1:
        merged = False
        for i in range(len(contours)):
            rect_i = cv2.boundingRect(contours[i])
            for j in range(i + 1, len(contours)):
                rect_j = cv2.boundingRect(contours[j])
                if rect_iou(rect_i, rect_j) > overlap_threshold:
                    combined_pts = np.vstack((contours[i], contours[j]))
                    contours.pop(j)
                    contours.pop(i)
                    contours.append(cv2.convexHull(combined_pts))
                    merged = True
                    break
            if merged:
                break
    return contours

def preprocess_for_ocr(roi):
    """Standardizes an ROI for OCR."""
    gray = cv2.cvtColor(roi, cv2.COLOR_BGR2GRAY)
    try:
        clahe = cv2.createCLAHE(clipLimit=2.5, tileGridSize=(8, 8))
        gray = clahe.apply(gray)
    except cv2.error:
        pass
    blurred = cv2.GaussianBlur(gray, (5, 5), 0)
    adaptive = cv2.adaptiveThreshold(
        blurred,
        255,
        cv2.ADAPTIVE_THRESH_GAUSSIAN_C,
        cv2.THRESH_BINARY,
        31,
        5,
    )
    _, otsu = cv2.threshold(blurred, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)
    combined = cv2.bitwise_and(adaptive, otsu)
    if cv2.mean(combined)[0] < 128:
        combined = cv2.bitwise_not(combined)
    kernel = cv2.getStructuringElement(cv2.MORPH_RECT, (2, 2))
    return cv2.morphologyEx(combined, cv2.MORPH_CLOSE, kernel)

def preprocess_collector_roi(roi):
    """Generates binarized variants tuned for collector-number text."""
    gray = cv2.cvtColor(roi, cv2.COLOR_BGR2GRAY)
    # Specular suppression via clipping very bright regions
    _, clipped = cv2.threshold(gray, 235, 235, cv2.THRESH_TRUNC)
    gray = clipped.astype(np.uint8)
    try:
        clahe = cv2.createCLAHE(clipLimit=2.0, tileGridSize=(8, 8))
        gray = clahe.apply(gray)
    except cv2.error:
        pass
    bilateral = cv2.bilateralFilter(gray, 7, 50, 50)
    blurred = cv2.GaussianBlur(bilateral, (3, 3), 0)
    adaptive = cv2.adaptiveThreshold(
        blurred,
        255,
        cv2.ADAPTIVE_THRESH_GAUSSIAN_C,
        cv2.THRESH_BINARY,
        31,
        5,
    )
    _, otsu = cv2.threshold(blurred, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)
    mixes = [
        adaptive,
        otsu,
        cv2.bitwise_and(adaptive, otsu),
        cv2.bitwise_or(adaptive, otsu),
    ]
    variants = []
    for img in mixes:
        variants.append(img)
        if cv2.mean(img)[0] < 128:
            variants.append(cv2.bitwise_not(img))
    # Deduplicate by simple checksum to avoid unnecessary OCR runs
    unique = []
    seen = set()
    for var in variants:
        key = var.mean(), var.std()
        if key in seen:
            continue
        seen.add(key)
        unique.append(var)
    return unique, gray, blurred

def normalize_collector_candidate(text):
    """Attempts to extract and normalize a collector-number token from OCR text."""
    if not text:
        return None

    cleaned = text.upper().replace("\n", " ").replace("\r", " ")
    collapsed = re.sub(r"\s+", "", cleaned)
    digit_friendly = (
        collapsed.replace("O", "0")
        .replace("I", "1")
        .replace("L", "1")
        .replace("|", "1")
    )

    samples = [cleaned, collapsed, digit_friendly]
    matches = []
    pattern_priority = [
        ("ratio", NUM_REGEX),
        ("ratio_suffix", NUM_WITH_SUFFIX_REGEX),
        ("gg_ratio", GG_REGEX),
        ("promo", ALNUM_REGEX),
    ]

    for sample in samples:
        for label, pattern in pattern_priority:
            for match in pattern.finditer(sample):
                token = re.sub(r"\s+", "", match.group(0))
                digits = sum(ch.isdigit() for ch in token)
                letters = sum(ch.isalpha() for ch in token)
                if digits == 0:
                    continue
                if label == "promo":
                    if digits < 2 or letters < 2:
                        continue
                matches.append((label, token))

    if not matches:
        return None

    priority_order = {"ratio": 0, "ratio_suffix": 1, "gg_ratio": 2, "promo": 3}

    def sort_key(item):
        label, token = item
        digits = sum(ch.isdigit() for ch in token)
        letters = sum(ch.isalpha() for ch in token)
        return (
            priority_order.get(label, 99),
            -digits,
            -letters,
            len(token),
        )

    best_label, best_token = min(matches, key=sort_key)
    return best_token

def extract_art_region(card_image):
    """Returns the central art box crop used for visual matching."""
    h, w = card_image.shape[:2]
    x0 = int(w * ART_REGION["x_start"])
    x1 = int(w * ART_REGION["x_end"])
    y0 = int(h * ART_REGION["y_start"])
    y1 = int(h * ART_REGION["y_end"])
    if x1 <= x0 or y1 <= y0:
        return card_image
    crop = card_image[y0:y1, x0:x1]
    return crop if crop.size else card_image

def compute_art_embedding(card_image):
    """Computes a simple image embedding using HSV histograms and edge density."""
    art = extract_art_region(card_image)
    if art.size == 0:
        return None
    resized = cv2.resize(art, (256, 256), interpolation=cv2.INTER_AREA)
    hsv = cv2.cvtColor(resized, cv2.COLOR_BGR2HSV)
    hist_bins = 32
    hist_ranges = [(0, 180), (0, 256), (0, 256)]
    features = []
    for channel, hist_range in enumerate(hist_ranges):
        hist = cv2.calcHist([hsv], [channel], None, [hist_bins], hist_range)
        hist = cv2.normalize(hist, hist).flatten()
        features.append(hist)

    gray = cv2.cvtColor(resized, cv2.COLOR_BGR2GRAY)
    gray = cv2.GaussianBlur(gray, (5, 5), 0)
    canny = cv2.Canny(gray, 50, 150)
    edge_hist = cv2.calcHist([canny], [0], None, [hist_bins], [0, 256])
    edge_hist = cv2.normalize(edge_hist, edge_hist).flatten()
    features.append(edge_hist)

    vec = np.concatenate(features).astype(np.float32)
    norm = np.linalg.norm(vec)
    if norm == 0:
        return None
    return vec / norm

def load_text_detector():
    """Lazily loads an EAST or CRAFT detector if models are provided."""
    global TEXT_DETECTOR
    if TEXT_DETECTOR is not None:
        return TEXT_DETECTOR

    if EAST_MODEL_PATH and os.path.exists(EAST_MODEL_PATH):
        try:
            net = cv2.dnn.readNet(EAST_MODEL_PATH)
            TEXT_DETECTOR = ("east", net)
            if DEBUG:
                print(f"[DEBUG] Loaded EAST detector from {EAST_MODEL_PATH}.")
            return TEXT_DETECTOR
        except cv2.error as exc:
            print(f"Warning: Could not load EAST model ({exc}).")

    # Placeholder: CRAFT integration would require additional dependencies; skip if not available.
    TEXT_DETECTOR = None
    return None

def detect_text_regions(image, min_confidence=0.5):
    """Runs a text detector over the image and returns bounding boxes."""
    detector = load_text_detector()
    if not detector:
        return []

    method, net = detector
    if method == "east":
        # Resize to multiples of 32 while preserving aspect ratio; keep scale to map back
        H, W = image.shape[:2]
        newW = max(32, (W // 32) * 32)
        newH = max(32, (H // 32) * 32)
        rW = W / float(newW)
        rH = H / float(newH)
        resized = cv2.resize(image, (newW, newH))

        blob = cv2.dnn.blobFromImage(resized, 1.0, (newW, newH), (123.68, 116.78, 103.94), swapRB=True, crop=False)
        net.setInput(blob)
        (scores, geometry) = net.forward(["feature_fusion/Conv_7/Sigmoid", "feature_fusion/concat_3"])

        num_rows, num_cols = scores.shape[2:4]
        rects = []
        confidences = []

        for y in range(num_rows):
            scores_data = scores[0, 0, y]
            x0_data = geometry[0, 0, y]
            x1_data = geometry[0, 1, y]
            x2_data = geometry[0, 2, y]
            x3_data = geometry[0, 3, y]
            angles_data = geometry[0, 4, y]

            for x in range(num_cols):
                score = float(scores_data[x])
                if score < min_confidence:
                    continue

                offset_x = x * 4.0
                offset_y = y * 4.0
                angle = angles_data[x]
                cos = np.cos(angle)
                sin = np.sin(angle)

                h = x0_data[x] + x2_data[x]
                w = x1_data[x] + x3_data[x]

                end_x = offset_x + (cos * x1_data[x]) + (sin * x2_data[x])
                end_y = offset_y - (sin * x1_data[x]) + (cos * x2_data[x])
                start_x = end_x - w
                start_y = end_y - h

                # Map to original image coordinates
                sx = int(start_x * rW)
                sy = int(start_y * rH)
                ex = int(end_x * rW)
                ey = int(end_y * rH)

                # Clamp and skip degenerate boxes
                sx = max(0, min(W - 1, sx))
                sy = max(0, min(H - 1, sy))
                ex = max(0, min(W - 1, ex))
                ey = max(0, min(H - 1, ey))
                if ex <= sx or ey <= sy:
                    continue

                rects.append((sx, sy, ex, ey))
                confidences.append(score)

        if not rects:
            return []

        # Prepare boxes for NMS in (x, y, w, h)
        nms_boxes = [(x, y, ex - x, ey - y) for (x, y, ex, ey) in rects]
        indices = cv2.dnn.NMSBoxes(nms_boxes, confidences, min_confidence, 0.4)
        output = []
        if indices is not None and len(indices) > 0:
            for i in np.array(indices).flatten().tolist():
                x, y, w, h = nms_boxes[i]
                ex, ey = x + w, y + h
                output.append((x, y, ex, ey, float(confidences[i])))
        return output

    return []

def ensure_reference_index():
    """Loads the visual reference index once per process."""
    global REFERENCE_INDEX
    if REFERENCE_INDEX is not None:
        return REFERENCE_INDEX

    meta_path = os.path.join(REFERENCE_DIR, REFERENCE_METADATA_FILE)
    if not os.path.exists(meta_path):
        if DEBUG:
            print(f"[DEBUG] Reference metadata not found at {meta_path}.")
        REFERENCE_INDEX = None
        return None

    try:
        with open(meta_path, "r", encoding="utf-8") as fh:
            metadata = json.load(fh)
    except (OSError, json.JSONDecodeError) as exc:
        print(f"Warning: Could not load reference metadata ({exc}).")
        REFERENCE_INDEX = None
        return None

    if isinstance(metadata, dict):
        # Allow metadata stored as {"cards": [...]}
        metadata = metadata.get("cards", [])

    entries = []
    embeddings = []

    for entry in metadata:
        image_rel = entry.get("image")
        if not image_rel:
            continue
        image_path = os.path.join(REFERENCE_DIR, image_rel)
        if not os.path.exists(image_path):
            continue

        ref_image = read_image_universal(image_path)
        if ref_image is None:
            ref_image = cv2.imread(image_path)
        if ref_image is None:
            continue

        embedding = compute_art_embedding(ref_image)
        if embedding is None:
            continue

        entries.append({
            "id": entry.get("id"),
            "name": entry.get("name"),
            "number": entry.get("number"),
            "set_id": entry.get("set", {}).get("id") if isinstance(entry.get("set"), dict) else entry.get("set_id"),
            "set_name": entry.get("set", {}).get("name") if isinstance(entry.get("set"), dict) else entry.get("set_name"),
            "image": image_rel,
        })
        embeddings.append(embedding)

    if not embeddings:
        if DEBUG:
            print("[DEBUG] No valid reference embeddings were generated.")
        REFERENCE_INDEX = None
        return None

    matrix = np.vstack(embeddings).astype(np.float32)
    REFERENCE_INDEX = {
        "entries": entries,
        "matrix": matrix,
    }
    return REFERENCE_INDEX

def load_easyocr_reader():
    """Loads an EasyOCR reader on demand."""
    global EASYOCR_READER
    if EASYOCR_READER is not None:
        return EASYOCR_READER
    if not USE_EASY_OCR:
        return None
    try:
        import easyocr
    except ImportError:
        print("Warning: easyocr not installed. Disable POKEMON_USE_EASYOCR or install the package.")
        EASYOCR_READER = None
        return None
    try:
        EASYOCR_READER = easyocr.Reader(["en"], gpu=False)
        if DEBUG:
            print("[DEBUG] EasyOCR reader initialized.")
    except Exception as exc:
        print(f"Warning: could not initialize EasyOCR reader ({exc}).")
        EASYOCR_READER = None
    return EASYOCR_READER

def load_paddle_reader():
    """Loads PaddleOCR on demand."""
    global PADDLE_OCR_READER
    if PADDLE_OCR_READER is not None:
        return PADDLE_OCR_READER
    if not USE_PADDLE_OCR:
        return None
    try:
        from paddleocr import PaddleOCR
    except ImportError:
        print("Warning: paddleocr not installed. Disable POKEMON_USE_PADDLEOCR or install the package.")
        PADDLE_OCR_READER = None
        return None
    try:
        PADDLE_OCR_READER = PaddleOCR(lang="en", use_angle_cls=False, show_log=False)
        if DEBUG:
            print("[DEBUG] PaddleOCR reader initialized.")
    except Exception as exc:
        print(f"Warning: could not initialize PaddleOCR reader ({exc}).")
        PADDLE_OCR_READER = None
    return PADDLE_OCR_READER

def run_advanced_recognizer(image, allowlist="0123456789/"):
    """Uses EasyOCR or PaddleOCR (if enabled) to read text from the provided image."""
    texts = []

    if USE_EASY_OCR:
        reader = load_easyocr_reader()
        if reader:
            try:
                results = reader.readtext(image, detail=0, allowlist=allowlist)
                texts.extend(results)
            except Exception as exc:
                if DEBUG:
                    print(f"[DEBUG] EasyOCR error: {exc}")

    if USE_PADDLE_OCR:
        reader = load_paddle_reader()
        if reader:
            try:
                results = reader.ocr(image, det=False, cls=False)
                for res in results:
                    if isinstance(res, str):
                        texts.append(res)
                    elif isinstance(res, (list, tuple)) and res:
                        texts.append(res[0])
            except Exception as exc:
                if DEBUG:
                    print(f"[DEBUG] PaddleOCR error: {exc}")

    return max(texts, key=len, default="") if texts else ""

def find_visual_candidates(card_image, top_k=REFERENCE_TOP_K):
    """Returns top-k visual matches for the provided card image."""
    index = ensure_reference_index()
    if not index:
        return []

    embedding = compute_art_embedding(card_image)
    if embedding is None:
        return []

    matrix = index["matrix"]
    # Normalize query vector (already normalized in compute_art_embedding)
    scores = matrix.dot(embedding)
    if scores.size == 0:
        return []

    order = np.argsort(scores)[::-1]
    candidates = []
    for rank in order[:top_k]:
        score = float(scores[rank])
        entry = index["entries"][rank]
        candidates.append({
            "score": score,
            "name": entry.get("name"),
            "number": entry.get("number"),
            "set_id": entry.get("set_id"),
            "set_name": entry.get("set_name"),
            "id": entry.get("id"),
            "image": entry.get("image"),
        })
    return candidates

def compute_final_confidence(visual_score=None, has_number=False, api_hit=False):
    score = 0.0
    if visual_score is not None:
        score += max(0.0, min(1.0, float(visual_score))) * CONF_WEIGHTS["visual"]
    if has_number:
        score += CONF_WEIGHTS["number"]
    if api_hit:
        score += CONF_WEIGHTS["api"]
    return max(0.0, min(1.0, score))

def write_manifest(folder, data):
    try:
        with open(os.path.join(folder, "manifest.json"), "w", encoding="utf-8") as fh:
            json.dump(data, fh, indent=2, ensure_ascii=False)
    except Exception as exc:
        print(f"  - Could not write manifest: {exc}")

def orient_and_ocr_card(warped_image):
    """Finds the rotation that yields the strongest name signal and returns OCR results."""
    candidates = []
    for angle in ROTATION_CANDIDATES:
        rotated = rotate_image(warped_image, angle)
        h, w = rotated.shape[:2]
        x0 = int(w * ROI_X_START_RATIO)
        y0 = int(h * ROI_Y_START_RATIO)
        x1 = min(w, x0 + int(w * ROI_WIDTH_RATIO))
        y1 = min(h, y0 + int(h * ROI_HEIGHT_RATIO))
        if x1 <= x0 or y1 <= y0:
            continue

        roi = rotated[y0:y1, x0:x1]
        if roi.size == 0:
            continue

        processed = preprocess_for_ocr(roi)
        try:
            ocr_text = pytesseract.image_to_string(processed, config=OCR_CONFIG)
        except pytesseract.TesseractError:
            continue

        orientation_candidates = []
        try:
            data = pytesseract.image_to_data(processed, config=OCR_CONFIG, output_type=Output.DICT)
        except pytesseract.TesseractError:
            data = None

        if data:
            grouped = {}
            for idx, text in enumerate(data['text']):
                try:
                    conf = float(data['conf'][idx])
                except ValueError:
                    conf = -1
                if conf < 0 or not text.strip():
                    continue

                key = (
                    data['block_num'][idx],
                    data['par_num'][idx],
                    data['line_num'][idx],
                )
                entry = grouped.setdefault(key, {
                    "texts": [],
                    "top": data['top'][idx],
                    "height": data['height'][idx],
                })
                entry["texts"].append(text.strip())
                entry["top"] = min(entry["top"], data['top'][idx])
                entry["height"] = max(entry["height"], data['height'][idx])

            roi_height = processed.shape[0]
            for entry in grouped.values():
                candidate = " ".join(entry["texts"]).strip()
                if not candidate:
                    continue
                base = score_ocr_candidate(candidate)
                if base <= 0:
                    continue
                word_penalty = max(0, len(candidate.split()) - 3) * 3
                length_penalty = max(0, len(candidate) - 22) * 2
                y_mid = entry["top"] + entry["height"] / 2
                vertical_bonus = max(0.0, 1.0 - (y_mid / max(roi_height, 1))) * 5
                total_score = base - word_penalty - length_penalty + vertical_bonus
                orientation_candidates.append((candidate, total_score))

        if not orientation_candidates:
            lines = [line.strip() for line in ocr_text.split('\n') if line.strip()]
            for line in lines:
                base = score_ocr_candidate(line)
                if base <= 0:
                    continue
                word_penalty = max(0, len(line.split()) - 3) * 3
                length_penalty = max(0, len(line) - 22) * 2
                total_score = base - word_penalty - length_penalty
                orientation_candidates.append((line, total_score))

        for candidate_text, total_score in orientation_candidates:
            candidates.append({
                "angle": angle,
                "text": candidate_text if candidate_text else "Unknown",
                "score": total_score,
                "raw": ocr_text,
            })

    if not candidates:
        return warped_image, "Unknown", "", 0

    def candidate_key(entry):
        return (
            entry["score"],
            score_ocr_candidate(entry["text"]),
            -len(entry["text"]),
        )

    best_entry = max(candidates, key=candidate_key)
    best_text = best_entry["text"].strip() or "Unknown"
    primary_angle = best_entry["angle"]
    best_image = rotate_image(warped_image, primary_angle)

    final_angle = primary_angle
    if best_image.shape[0] < best_image.shape[1]:
        best_image = rotate_image(best_image, 270)
        final_angle = (primary_angle + 270) % 360

    return best_image, best_text, best_entry["raw"], final_angle

def merge_text_boxes(boxes, y_tolerance_ratio=0.7, x_tolerance_ratio=1.5):
    """Merges horizontally-aligned text boxes into lines."""
    if not boxes:
        return []

    # Sort by vertical position, then horizontal
    boxes.sort(key=lambda b: (b[1], b[0]))

    merged_lines = []
    if not boxes:
        return merged_lines

    current_line = list(boxes[0])

    for i in range(1, len(boxes)):
        next_box = boxes[i]
        # Box format is (x0, y0, x1, y1, conf)
        x0, y0, x1, y1, _ = current_line
        nx0, ny0, nx1, ny1, _ = next_box

        line_height = max(y1 - y0, ny1 - ny0)
        if line_height == 0: # Avoid division by zero with zero-height boxes
            continue

        # Check for vertical alignment (y-centers are close)
        y_center = y0 + (y1 - y0) / 2
        ny_center = ny0 + (ny1 - ny0) / 2
        y_tolerance = line_height * y_tolerance_ratio
        is_aligned = abs(y_center - ny_center) < y_tolerance

        # Check for horizontal proximity (gap is not too large)
        x_tolerance = line_height * x_tolerance_ratio
        is_proximal = (nx0 - x1) < x_tolerance

        if is_aligned and is_proximal:
            # Merge boxes: extend the current line
            current_line[0] = min(x0, nx0)
            current_line[1] = min(y0, ny0)
            current_line[2] = max(x1, nx1)
            current_line[3] = max(y1, ny1)
            # Keep the confidence of the first box in the line
        else:
            # Finish current line and start a new one
            merged_lines.append(tuple(current_line))
            current_line = list(next_box)

    merged_lines.append(tuple(current_line))
    return merged_lines

def ocr_collector_number(card_image):
    """Extracts the collector number using a line-based detector-recognizer pipeline."""
    orientations = (0, 180)
    for angle in orientations:
        rotated = rotate_image(card_image, angle) if angle else card_image
        h, w = rotated.shape[:2]

        if not (USE_EASY_OCR or USE_PADDLE_OCR):
            continue

        # 1. Extract and upsample the bottom band
        bx0, bx1 = int(w * BOTTOM_BAND["x_start"]), int(w * BOTTOM_BAND["x_end"])
        by0, by1 = int(h * BOTTOM_BAND["y_start"]), int(h * BOTTOM_BAND["y_end"])
        if bx1 <= bx0 or by1 <= by0:
            continue

        band = rotated[by0:by1, bx0:bx1]
        scale_factor = 2.5
        upsampled_band = cv2.resize(band, None, fx=scale_factor, fy=scale_factor, interpolation=cv2.INTER_CUBIC)

        # 2. Detect text regions and merge into lines
        boxes = detect_text_regions(upsampled_band, min_confidence=0.5)
        if not boxes:
            continue
        
        merged_lines = merge_text_boxes(boxes)

        # 3. Recognize text in filtered lines
        for (x0, y0, x1, y1, conf) in merged_lines:
            line_w, line_h = x1 - x0, y1 - y0
            if line_w < line_h * 1.5:  # Filter out non-line-like boxes
                continue

            line_crop = upsampled_band[y0:y1, x0:x1]
            if line_crop.size == 0:
                continue

            # Pass 1: Strict allowlist for number/number format
            rec_text = run_advanced_recognizer(line_crop, allowlist="0123456789/")
            candidate = normalize_collector_candidate(rec_text)
            if DEBUG:
                print(f"[DEBUG] line-detector (num) -> {rec_text!r} -> {candidate}")
            if candidate and "/" in candidate:
                return {"value": candidate, "source": "detector_line", "raw": rec_text, "angle": angle, "confidence": float(conf)}

            # Pass 2: Relaxed allowlist for alphanumeric promos
            rec_text_alnum = run_advanced_recognizer(line_crop, allowlist="0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ")
            candidate_alnum = normalize_collector_candidate(rec_text_alnum)
            if DEBUG:
                print(f"[DEBUG] line-detector (alnum) -> {rec_text_alnum!r} -> {candidate_alnum}")
            if candidate_alnum:
                return {"value": candidate_alnum, "source": "detector_line_alnum", "raw": rec_text_alnum, "angle": angle, "confidence": float(conf)}

    # Fallback to legacy method if the new pipeline fails
    if DEBUG:
        print("[DEBUG] Line-based detection failed, falling back to legacy ROI scan.")
    return ocr_collector_number_legacy(card_image)

def ocr_collector_number_legacy(card_image):
    """Extracts the collector number by scanning multiple orientations, ROIs, and OCR configs."""
    orientations = (0, 180)
    for angle in orientations:
        rotated = rotate_image(card_image, angle) if angle else card_image
        h, w = rotated.shape[:2]

        # Phase 2: detector-first over a continuous bottom band (prefer bottom-left boxes)
        if USE_EASY_OCR or USE_PADDLE_OCR:
            bx0 = int(w * BOTTOM_BAND["x_start"]); bx1 = int(w * BOTTOM_BAND["x_end"])
            by0 = int(h * BOTTOM_BAND["y_start"]); by1 = int(h * BOTTOM_BAND["y_end"])
            if bx1 > bx0 and by1 > by0:
                band = rotated[by0:by1, bx0:bx1]
                boxes = detect_text_regions(band, min_confidence=0.6)
                # Sort boxes: left-most first, then closer to bottom (y2 desc)
                boxes = sorted(boxes, key=lambda b: (b[0], -b[3]))

                # Pass 1: digits + '/' only
                for (x0b, y0b, x1b, y1b, conf_b) in boxes:
                    crop = band[y0b:y1b, x0b:x1b]
                    if crop.size == 0:
                        continue
                    rec_text = run_advanced_recognizer(crop, allowlist="0123456789/")
                    candidate = normalize_collector_candidate(rec_text)
                    if DEBUG:
                        print(f"[DEBUG] band-detector (num) box=({x0b},{y0b},{x1b},{y1b}) -> {rec_text!r} -> {candidate}")
                    if candidate:
                        return {
                            "value": candidate,
                            "source": "detector",
                            "raw": rec_text,
                            "angle": angle,
                            "box": [int(bx0 + x0b), int(by0 + y0b), int(bx0 + x1b), int(by0 + y1b)],
                            "confidence": float(conf_b),
                        }

                # Pass 2: relax to alphanumeric for promos (e.g., SWSH123, SVP###)
                for (x0b, y0b, x1b, y1b, conf_b) in boxes:
                    crop = band[y0b:y1b, x0b:x1b]
                    if crop.size == 0:
                        continue
                    rec_text = run_advanced_recognizer(crop, allowlist="0123456789/ABCDEFGHIJKLMNOPQRSTUVWXYZ")
                    candidate = normalize_collector_candidate(rec_text)
                    if DEBUG:
                        print(f"[DEBUG] band-detector (alnum) box=({x0b},{y0b},{x1b},{y1b}) -> {rec_text!r} -> {candidate}")
                    if candidate:
                        return {
                            "value": candidate,
                            "source": "detector",
                            "raw": rec_text,
                            "angle": angle,
                            "box": [int(bx0 + x0b), int(by0 + y0b), int(bx0 + x1b), int(by0 + y1b)],
                            "confidence": float(conf_b),
                        }

        for roi_def in COLLECTOR_ROI_CANDIDATES:
            x0 = int(w * roi_def["x_start"])
            x1 = int(w * roi_def["x_end"])
            y0 = int(h * roi_def["y_start"])
            y1 = int(h * roi_def["y_end"])
            if x1 <= x0 or y1 <= y0:
                continue

            roi = rotated[y0:y1, x0:x1]
            if roi.size == 0:
                continue

            variants, _, _ = preprocess_collector_roi(roi)

            # Phase 2: detector+recognizer pipeline
            if USE_EASY_OCR or USE_PADDLE_OCR:
                detector_boxes = detect_text_regions(roi, min_confidence=0.6)
                if detector_boxes:
                    sorted_boxes = sorted(detector_boxes, key=lambda b: (b[0], -b[3]))
                    for bx0, by0, bx1, by1, conf in sorted_boxes:
                        height = by1 - by0
                        if height < 10:
                            continue
                        candidate_crop = roi[by0:by1, bx0:bx1]
                        if candidate_crop.size == 0:
                            continue

                        # Pass 1: digits + '/'
                        rec_text = run_advanced_recognizer(candidate_crop, allowlist="0123456789/")
                        candidate = normalize_collector_candidate(rec_text)
                        if not candidate:
                            # Pass 2: relaxed alphanumeric for promos
                            rec_text = run_advanced_recognizer(candidate_crop, allowlist="0123456789/ABCDEFGHIJKLMNOPQRSTUVWXYZ")
                            candidate = normalize_collector_candidate(rec_text)
                        if DEBUG:
                            print(f"[DEBUG] detector-recognizer text={rec_text!r} -> {candidate}")
                        if candidate:
                            return {
                                "value": candidate,
                                "source": "detector",
                                "raw": rec_text,
                                "angle": angle,
                                "box": [int(x0 + bx0), int(y0 + by0), int(x0 + bx1), int(y0 + by1)],
                                "confidence": float(conf),
                            }
                # If no boxes or no successful read, fall back to legacy variants below

            for preprocessed in variants:
                for scale in COLLECTOR_SCALE_FACTORS:
                    scaled = cv2.resize(preprocessed, None, fx=scale, fy=scale, interpolation=cv2.INTER_CUBIC)
                    kernel = cv2.getStructuringElement(cv2.MORPH_RECT, (2, 2))
                    thick = cv2.morphologyEx(scaled, cv2.MORPH_CLOSE, kernel)

                    for cfg in COLLECTOR_OCR_CONFIGS:
                        try:
                            text = pytesseract.image_to_string(thick, config=cfg)
                        except pytesseract.TesseractError:
                            continue
                        candidate = normalize_collector_candidate(text)
                        if DEBUG:
                            print(f"[DEBUG] collector angle={angle} cfg={cfg} text={text!r} -> {candidate}")
                        if candidate:
                            return {
                                "value": candidate,
                                "source": "tesseract_line",
                                "raw": text,
                                "angle": angle,
                                "config": cfg,
                            }

                        try:
                            data = pytesseract.image_to_data(thick, config=cfg, output_type=Output.DICT)
                        except pytesseract.TesseractError:
                            continue

                        tokens = []
                        for idx, text_val in enumerate(data["text"]):
                            try:
                                conf_val = float(data["conf"][idx])
                            except (ValueError, TypeError):
                                conf_val = -1
                            if conf_val < 10:
                                continue
                            token = text_val.strip().upper()
                            if not token:
                                continue
                            if not any(ch.isdigit() or ch in {"/", "O", "I", "L"} for ch in token):
                                continue
                            x_coord = data["left"][idx]
                            tokens.append((x_coord, token))

                        if tokens:
                            tokens.sort(key=lambda t: t[0])
                            combined = "".join(token for _, token in tokens)
                            candidate = normalize_collector_candidate(combined)
                            if DEBUG:
                                print(f"[DEBUG] collector data tokens={tokens} -> {combined} -> {candidate}")
                            if candidate:
                                return {
                                    "value": candidate,
                                    "source": "tesseract_boxes",
                                    "raw": combined,
                                    "angle": angle,
                                    "config": cfg,
                                }
    return {"value": None, "source": None, "raw": None}

def lookup_card_title(collector_number, set_hint=None):
    """Queries the Pokémon TCG API for a canonical card title."""
    if not collector_number:
        return None
    # Serve from cache if available
    cache_key = (collector_number, set_hint)
    if cache_key in CARD_CACHE:
        return CARD_CACHE[cache_key]
    if not HAS_REQUESTS:
        return None
    query = f"number:{collector_number}"
    if set_hint:
        query += f" set.id:{set_hint}"
    params = {"q": query, "select": "name,number,set"}
    try:
        if DEBUG:
            print(f"[DEBUG] API q={query}")
        kwargs = {"params": params, "timeout": 5}
        if HEADERS:
            kwargs["headers"] = HEADERS
        response = requests.get(CARD_API_URL, **kwargs)
        response.raise_for_status()
    except (requests.RequestException, ValueError):
        return None

    payload = response.json()
    cards = payload.get("data") if isinstance(payload, dict) else None
    if DEBUG and isinstance(payload, dict):
        print(f"[DEBUG] API response count={payload.get('count')} data_len={len(cards) if cards else 0}")
    if not cards:
        return None

    primary = cards[0]
    name = primary.get("name")
    set_info = primary.get("set") or {}
    set_id = set_info.get("id")
    if name:
        CARD_CACHE[cache_key] = (name, set_id)
        return (name, set_id)
    return None


def lookup_card_by_text(name_fragment=None, ability_fragment=None, set_hint=None):
    if not HAS_REQUESTS:
        return None
    queries = []
    if name_fragment:
        frag = re.sub(r"\s+", "* ", name_fragment.strip())
        queries.append(f"name:{frag}*")
    if ability_fragment:
        qtxt = ability_fragment.strip().replace('"', '')
        if len(qtxt) >= 4:
            queries.append(f'attacks.text:"{qtxt}"')
    for q in queries:
        query = q
        if set_hint:
            query += f" set.id:{set_hint}"
        params = {"q": query, "select": "name,number,set"}
        try:
            if DEBUG:
                print(f"[DEBUG] API (text) q={query}")
            kwargs = {"params": params, "timeout": 5}
            if HEADERS:
                kwargs["headers"] = HEADERS
            r = requests.get(CARD_API_URL, **kwargs)
            r.raise_for_status()
            payload = r.json()
            data = payload.get("data", []) if isinstance(payload, dict) else []
            if data:
                name = data[0].get("name")
                set_id = (data[0].get("set") or {}).get("id")
                return (name, set_id)
        except Exception:
            continue
    return None

def safe_move(src, dst_dir):
    """Moves a file, adding a suffix to avoid name collisions."""
    try:
        base = os.path.basename(src)
        name, ext = os.path.splitext(base)
        candidate = os.path.join(dst_dir, base)
        n = 1
        while os.path.exists(candidate):
            candidate = os.path.join(dst_dir, f"{name}_{n}{ext}")
            n += 1
        shutil.move(src, candidate)
    except Exception as e:
        print(f"Could not move {src}: {e}")

def get_contours_robust(image):
    """Uses Canny edge detection with a dynamic area threshold."""
    gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
    blur = cv2.GaussianBlur(gray, (5, 5), 0)
    edges = cv2.Canny(blur, 50, 150)
    kernel = cv2.getStructuringElement(cv2.MORPH_RECT, (5, 5))
    closed = cv2.morphologyEx(edges, cv2.MORPH_CLOSE, kernel, iterations=2)
    contours, _ = cv2.findContours(closed, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    
    H, W = gray.shape
    min_area = max(250000, 0.015 * (H * W)) # Use 1.5% of image area or 250k px
    filtered = [c for c in contours if cv2.contourArea(c) > min_area]
    return merge_overlapping_contours(filtered)

def order_points(pts):
    """Sorts the four points of a quadrilateral into a consistent order:
    top-left, top-right, bottom-right, bottom-left."""
    rect = np.zeros((4, 2), dtype="float32")
    s = pts.sum(axis=1)
    rect[0] = pts[np.argmin(s)]
    rect[2] = pts[np.argmax(s)]
    diff = np.diff(pts, axis=1)
    rect[1] = pts[np.argmin(diff)]
    rect[3] = pts[np.argmax(diff)]
    return rect

def create_quadrant_crops(image, folder_path, base_name):
    """Creates four overlapping 60% quadrant crops."""
    try:
        H, W, _ = image.shape
        # Define the regions for the four quadrants (top-left, top-right, bottom-left, bottom-right)
        # Each crop is 60% of the width and height
        crop_w, crop_h = int(W * 0.6), int(H * 0.6)

        quadrants = {
            "TL": (0, 0, crop_w, crop_h),
            "TR": (W - crop_w, 0, W, crop_h),
            "BL": (0, H - crop_h, crop_w, H),
            "BR": (W - crop_w, H - crop_h, W, H),
        }

        for name, (left, top, right, bottom) in quadrants.items():
            # Ensure crop dimensions are valid
            if right <= left or bottom <= top:
                continue
            crop = image[top:bottom, left:right]
            cv2.imwrite(os.path.join(folder_path, f"{base_name}_{name}.jpg"), crop)
    except Exception as e:
        print(f"  - Could not create quadrant crops: {e}")

if __name__ == "__main__":
    front_filename = find_scan_file("fronts")
    back_filename = find_scan_file("backs")

    if not front_filename or not back_filename:
        error_message = "Error: Cannot find required scan files. "
        if not front_filename:
            error_message += "Missing 'fronts' file. "
        if not back_filename:
            error_message += "Missing 'backs' file. "
        error_message += f"Supported extensions are {SUPPORTED_EXTENSIONS}."
        print(error_message)
        raise SystemExit(1)

    front_image = read_image_universal(front_filename)
    back_image = read_image_universal(back_filename)

    if front_image is None or back_image is None:
        print("Error: One or both images could not be read. Check file integrity.")
        raise SystemExit(1)

    reference_data = ensure_reference_index()
    if reference_data and DEBUG:
        print(f"[DEBUG] Loaded {len(reference_data['entries'])} reference cards for visual search.")

    H_front, W_front, _ = front_image.shape
    H_back, W_back, _ = back_image.shape

    front_contours = sort_contours_tltr(get_contours_robust(front_image))
    back_contours = sort_contours_tltr(get_contours_robust(back_image))

    print(f"Fronts detected: {len(front_contours)} | Backs detected: {len(back_contours)}")

    if DEBUG:
        east_present = bool(EAST_MODEL_PATH) and os.path.exists(EAST_MODEL_PATH)
        print(f"[DEBUG] Detector: EAST={'yes' if east_present else 'no'} EasyOCR={'yes' if USE_EASY_OCR else 'no'} PaddleOCR={'yes' if USE_PADDLE_OCR else 'no'}")

    identified_cards = []
    
    # Define the dimensions for the warped, top-down image of the card.
    # A standard playing card ratio is 2.5" x 3.5", which is 1:1.4.
    # We'll use a higher resolution for better OCR quality.
    WARPED_WIDTH = 900
    WARPED_HEIGHT = int(WARPED_WIDTH * 1.4)

    print(f"--- Processing {len(front_contours)} card fronts... ---")
    for i, contour in enumerate(front_contours):
        # Approximate the contour to a polygon
        peri = cv2.arcLength(contour, True)
        approx = cv2.approxPolyDP(contour, 0.02 * peri, True)

        # If the contour approximation has more than 4 points, fall back to a minimum-area rectangle.
        if len(approx) < 4:
            print(f"  - Skipping contour {i+1} (too few points for a card).")
            continue
        if len(approx) > 4:
            print(f"  - Contour {i+1}: using minAreaRect fallback (points={len(approx)}).")
            rect_points = cv2.boxPoints(cv2.minAreaRect(contour))
            rect = order_points(rect_points)
        else:
            rect = order_points(approx.reshape(4, 2))
        (tl, tr, br, bl) = rect

        # Compute the destination points for the perspective transform
        dst = np.array([
            [0, 0],
            [WARPED_WIDTH - 1, 0],
            [WARPED_WIDTH - 1, WARPED_HEIGHT - 1],
            [0, WARPED_HEIGHT - 1]], dtype="float32")

        # Compute the perspective transform matrix and then apply it
        M = cv2.getPerspectiveTransform(rect, dst)
        warped_card_img = cv2.warpPerspective(front_image, M, (WARPED_WIDTH, WARPED_HEIGHT))

        normalized_card_img, card_name_raw, ocr_text_raw, rotation_used = orient_and_ocr_card(warped_card_img)
        if rotation_used:
            print(f"  - Contour {i+1}: rotated {rotation_used}° to align text.")

        visual_candidates = find_visual_candidates(normalized_card_img)
        visual_hint = None
        if visual_candidates:
            top_candidate = visual_candidates[0]
            print(
                f"    • Visual shortlist: {top_candidate.get('name','?')} "
                f"(#{top_candidate.get('number','?')} | {top_candidate.get('set_id','?')}) "
                f"score={top_candidate['score']:.3f}"
            )
            if top_candidate["score"] >= REFERENCE_ACCEPT_SCORE:
                visual_hint = top_candidate

        cn_info = ocr_collector_number(normalized_card_img)
        collector_number = cn_info.get("value") if isinstance(cn_info, dict) else None
        resolved_name = None
        set_hint = visual_hint.get("set_id") if visual_hint and visual_hint.get("set_id") else None

        if not collector_number and visual_hint and visual_hint.get("number"):
            collector_number = visual_hint["number"]
            print(f"    • Using visual match number {collector_number} (score {visual_hint['score']:.3f}).")

        api_hit = False
        if collector_number:
            lookup = lookup_card_title(collector_number, set_hint)
            if lookup:
                resolved_name, api_set_id = lookup
                api_hit = True
                if api_set_id:
                    set_hint = api_set_id
                print(f"    • Matched collector number {collector_number} -> {resolved_name} (set {set_hint}).")

        if not resolved_name and visual_hint and visual_hint.get("name"):
            resolved_name = visual_hint["name"]

        # Phase 3 fallback: try text fragments via API if still unresolved
        if not resolved_name:
            name_frag = None
            if card_name_raw:
                # Find all alphabetic tokens, prefer longer ones to avoid short, common words.
                name_tokens = sorted(re.findall(r"[A-Za-z]{5,}", card_name_raw), key=len, reverse=True)
                if name_tokens:
                    name_frag = name_tokens[0]
            
            abil_frag = None
            if ocr_text_raw:
                tokens = [t for t in re.findall(r"[A-Za-z]{4,}", ocr_text_raw) if t.lower() not in {"and","the","with","from","this","that"}]
                if tokens:
                    abil_frag = tokens[0]
            
            if name_frag or abil_frag:
                text_lookup = lookup_card_by_text(name_frag, abil_frag, set_hint)
                if text_lookup:
                    resolved_name, api_set_id = text_lookup
                    api_hit = True
                    if api_set_id:
                        set_hint = api_set_id
                    print(f"    • Resolved by text query -> {resolved_name} (set {set_hint}).")

        # Final candidate selection
        card_name_candidates = [
            resolved_name,
            card_name_raw.strip() if card_name_raw else "",
            visual_hint.get("name") if visual_hint else "",
            "Unknown",
        ]
        card_name = next(name for name in card_name_candidates if name)
        collector_number_formatted = collector_number.replace('/', '_') if collector_number else ""

        # Confidence gating (Phase 4)
        visual_score = visual_hint['score'] if visual_hint else None
        has_number = bool(collector_number)
        final_conf = compute_final_confidence(visual_score, has_number, api_hit)
        auto_accept = final_conf >= AUTO_ACCEPT_THRESHOLD

        folder_name_base = sanitize_filename(f"{card_name}_{collector_number_formatted}" if collector_number_formatted else card_name)
        if not auto_accept:
            folder_name_base = sanitize_filename(f"Uncertain_{card_name}")

        final_folder_name = f"{folder_name_base}_{i+1}"
        os.makedirs(final_folder_name, exist_ok=True)
        print(f"  -> Created folder: {final_folder_name} (confidence={final_conf:.2f}{'' if auto_accept else ' • routed to Uncertain'})")

        # Persist manifest for audit
        manifest = {
            "chosen_name": card_name,
            "collector_number": collector_number,
            "set_hint": set_hint,
            "visual_top": visual_hint,
            "confidence": final_conf,
            "auto_accept": auto_accept,
            "cn_info": cn_info,
            "ocr_name_raw": card_name_raw,
        }
        write_manifest(final_folder_name, manifest)

        # Save a listing-friendly front (no perspective warp). This preserves the original photo geometry.
        fx, fy, fw, fh = cv2.boundingRect(contour)
        fx0, fy0 = max(0, fx - PADDING), max(0, fy - PADDING)
        fx1, fy1 = min(W_front, fx + fw + PADDING), min(H_front, fy + fh + PADDING)
        if fx1 > fx0 and fy1 > fy0:
            front_crop = front_image[fy0:fy1, fx0:fx1]
        else:
            front_crop = normalized_card_img

        cv2.imwrite(os.path.join(final_folder_name, f"{final_folder_name}_FRONT.jpg"), front_crop)
        create_quadrant_crops(normalized_card_img, final_folder_name, f"{final_folder_name}_FRONT")

        # Optionally save the warped, normalized card for debugging/QA
        if DEBUG or SAVE_WARPED_DEBUG:
            cv2.imwrite(os.path.join(final_folder_name, f"{final_folder_name}_FRONT_WARPED.jpg"), normalized_card_img)

        # Use the original contour center for matching with the back
        cx, cy = get_contour_center(contour)
        identified_cards.append({"folder": final_folder_name, "center_norm": (cx / W_front, cy / H_front)})
    
    print(f"Fronts processed (usable): {len(identified_cards)}")

    print(f"\n--- Processing and matching {len(back_contours)} card backs... ---")
    if not identified_cards:
        print("No card fronts were processed; skipping back matching.")
    
    elif len(identified_cards) == len(back_contours):
        def norm_pts(contours, W, H):
            return [(get_contour_center(c)[0]/W, get_contour_center(c)[1]/H) for c in contours]
        
        fp = [ic['center_norm'] for ic in identified_cards]
        bp = norm_pts(back_contours, W_back, H_back)
        n = len(fp)

        d_order = sum(euclidean_distance(fp[i], bp[i]) for i in range(n))
        d_rev = sum(euclidean_distance(fp[i], bp[n-1-i]) for i in range(n))

        backs_in_order = back_contours if d_order <= d_rev else list(reversed(back_contours))
        if d_order > d_rev:
            print("Reversed back order detected. Adjusting match order.")

        for i, contour in enumerate(backs_in_order):
            folder = identified_cards[i]['folder']
            x, y, w, h = cv2.boundingRect(contour)
            x0,y0,x1,y1 = max(0,x-PADDING), max(0,y-PADDING), min(W_back,x+w+PADDING), min(H_back,y+h+PADDING)
            if x1 <= x0 or y1 <= y0: continue
            padded_back_img = back_image[y0:y1, x0:x1]
            cv2.imwrite(os.path.join(folder, f"{folder}_BACK.jpg"), padded_back_img)
            create_quadrant_crops(padded_back_img, folder, f"{folder}_BACK")
    else:
        print("Warning: Mismatched counts. Falling back to normalized nearest-neighbor matching.")
        unused_fronts = set(range(len(identified_cards)))
        for contour in back_contours:
            bx, by = get_contour_center(contour)
            b_norm = (bx / W_back, by / H_back)
            
            def dist_norm(i):
                fx, fy = identified_cards[i]['center_norm']
                return euclidean_distance((fx, fy), b_norm)

            if unused_fronts:
                best_match_idx = min(unused_fronts, key=dist_norm)
                unused_fronts.remove(best_match_idx)
            else:
                best_match_idx = min(range(len(identified_cards)), key=dist_norm)
            
            folder = identified_cards[best_match_idx]['folder']
            x,y,w,h = cv2.boundingRect(contour)
            x0,y0,x1,y1 = max(0,x-PADDING), max(0,y-PADDING), min(W_back,x+w+PADDING), min(H_back,y+h+PADDING)
            if x1 <= x0 or y1 <= y0: continue
            padded_back_img = back_image[y0:y1, x0:x1]
            cv2.imwrite(os.path.join(folder, f"{folder}_BACK.jpg"), padded_back_img)
            create_quadrant_crops(padded_back_img, folder, f"{folder}_BACK")

    today_str = date.today().strftime('%Y-%m-%d')
    archive_dir = os.path.join("_Processed_Scans", today_str)
    os.makedirs(archive_dir, exist_ok=True)
    safe_move(front_filename, archive_dir)
    safe_move(back_filename, archive_dir)
    print(f"\n--- Archived original scans to {archive_dir} ---")
    print("--- All processing complete! ---")
