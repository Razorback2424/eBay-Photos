import os
import tempfile
import unittest
from io import BytesIO

import cv2
import numpy as np
from werkzeug.datastructures import FileStorage

import process_and_organize as po
from photo_prep_app.services import processing as processing_service


class TestProcessAndOrganize(unittest.TestCase):
    def test_find_scan_file_case_insensitive(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            prev = os.getcwd()
            try:
                os.chdir(tmpdir)
                open("fronts.HEIC", "wb").close()
                found = po.find_scan_file("fronts")
                self.assertEqual(found, "fronts.HEIC")
            finally:
                os.chdir(prev)

    def test_find_scan_file_accepts_png_case_insensitive(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            prev = os.getcwd()
            try:
                os.chdir(tmpdir)
                open("fronts.PNG", "wb").close()
                found = po.find_scan_file("fronts")
                self.assertEqual(found, "fronts.PNG")
            finally:
                os.chdir(prev)

    def test_read_image_universal_reads_rgb_png_as_bgr(self):
        image = np.zeros((12, 10, 3), dtype=np.uint8)
        image[:, :] = (10, 20, 30)

        with tempfile.TemporaryDirectory() as tmpdir:
            path = os.path.join(tmpdir, "scan.png")
            cv2.imwrite(path, image)

            loaded = po.read_image_universal(path)

        self.assertIsNotNone(loaded)
        self.assertEqual(loaded.shape, image.shape)
        self.assertEqual(loaded.dtype, image.dtype)

    def test_read_image_universal_flattens_rgba_png_over_white(self):
        image = np.zeros((2, 2, 4), dtype=np.uint8)
        image[:, :] = (0, 0, 255, 0)
        image[0, 0] = (0, 0, 255, 255)
        image[0, 1] = (0, 0, 255, 128)

        with tempfile.TemporaryDirectory() as tmpdir:
            path = os.path.join(tmpdir, "scan.png")
            cv2.imwrite(path, image)

            loaded = po.read_image_universal(path)

        self.assertIsNotNone(loaded)
        self.assertEqual(loaded.shape, (2, 2, 3))
        np.testing.assert_array_equal(loaded[0, 0], np.array([0, 0, 255], dtype=np.uint8))
        np.testing.assert_array_equal(loaded[1, 1], np.array([255, 255, 255], dtype=np.uint8))

    def test_build_pairs_accepts_png_by_default(self):
        _, png_data = cv2.imencode(".png", np.zeros((8, 8, 3), dtype=np.uint8))
        front = FileStorage(stream=BytesIO(png_data.tobytes()), filename="front.png")
        back = FileStorage(stream=BytesIO(png_data.tobytes()), filename="back.PNG")

        with tempfile.TemporaryDirectory() as tmpdir:
            pairs, errors = processing_service.build_pairs([front], [back], tmpdir)

            self.assertEqual(errors, [])
            self.assertEqual(len(pairs), 1)
            self.assertTrue(os.path.exists(os.path.join(tmpdir, "pair-0001", "fronts.png")))
            self.assertTrue(os.path.exists(os.path.join(tmpdir, "pair-0001", "backs.png")))

    def test_create_quadrant_crops_outputs_four_images(self):
        image = np.full((1000, 800, 3), 255, dtype=np.uint8)
        with tempfile.TemporaryDirectory() as tmpdir:
            po.create_quadrant_crops(image, tmpdir, "card_front")
            expected = [
                "card_front_TL.jpg",
                "card_front_TR.jpg",
                "card_front_BR.jpg",
                "card_front_BL.jpg",
            ]
            for name in expected:
                path = os.path.join(tmpdir, name)
                self.assertTrue(os.path.exists(path), f"Missing crop: {name}")
                crop = cv2.imread(path)
                self.assertIsNotNone(crop, f"Unreadable crop: {name}")
                self.assertEqual(crop.shape[0], int(1000 * 0.6))
                self.assertEqual(crop.shape[1], int(800 * 0.6))

    def test_get_contours_robust_detects_multiple_cards(self):
        image = np.zeros((2600, 2000, 3), dtype=np.uint8)
        rectangles = [
            ((100, 100), (600, 800)),
            ((750, 150), (1250, 850)),
            ((1350, 200), (1850, 900)),
        ]
        for top_left, bottom_right in rectangles:
            cv2.rectangle(image, top_left, bottom_right, (255, 255, 255), -1)

        contours = po.get_contours_robust(image)
        self.assertEqual(len(contours), 3)

    def test_single_card_produces_ten_images(self):
        front = np.zeros((2600, 2000, 3), dtype=np.uint8)
        back = np.zeros((2600, 2000, 3), dtype=np.uint8)
        cv2.rectangle(front, (600, 500), (1400, 1900), (255, 255, 255), -1)
        cv2.rectangle(back, (600, 500), (1400, 1900), (255, 255, 255), -1)

        front_contours = po.sort_contours_tltr(po.get_contours_robust(front))
        back_contours = po.sort_contours_tltr(po.get_contours_robust(back))
        self.assertEqual(len(front_contours), 1)
        self.assertEqual(len(back_contours), 1)

        with tempfile.TemporaryDirectory() as tmpdir:
            folder = os.path.join(tmpdir, "Card_1")
            os.makedirs(folder, exist_ok=True)

            fx, fy, fw, fh = cv2.boundingRect(front_contours[0])
            fx0 = max(0, fx - po.PADDING)
            fy0 = max(0, fy - po.PADDING)
            fx1 = min(front.shape[1], fx + fw + po.PADDING)
            fy1 = min(front.shape[0], fy + fh + po.PADDING)
            front_crop = front[fy0:fy1, fx0:fx1]
            cv2.imwrite(os.path.join(folder, "Card_1_FRONT.jpg"), front_crop)
            po.create_quadrant_crops(front_crop, folder, "Card_1_FRONT")

            bx, by, bw, bh = cv2.boundingRect(back_contours[0])
            bx0 = max(0, bx - po.PADDING)
            by0 = max(0, by - po.PADDING)
            bx1 = min(back.shape[1], bx + bw + po.PADDING)
            by1 = min(back.shape[0], by + bh + po.PADDING)
            back_crop = back[by0:by1, bx0:bx1]
            cv2.imwrite(os.path.join(folder, "Card_1_BACK.jpg"), back_crop)
            po.create_quadrant_crops(back_crop, folder, "Card_1_BACK")

            jpgs = [f for f in os.listdir(folder) if f.lower().endswith(".jpg")]
            self.assertEqual(len(jpgs), 10, f"Expected 10 images, found {len(jpgs)}: {jpgs}")
            ok, missing = po.validate_card_outputs(folder, "Card_1")
            self.assertTrue(ok, f"Missing expected outputs: {missing}")
            self.assertEqual(missing, [])


if __name__ == "__main__":
    unittest.main(verbosity=2)
