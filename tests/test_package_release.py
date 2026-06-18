import unittest

from scripts import package_release


class TestPackageRelease(unittest.TestCase):
    def test_release_includes_required_launch_configuration_and_operator_copy(self):
        paths = {
            str(path.relative_to(package_release.PROJECT_ROOT))
            for path in package_release.iter_release_files()
        }

        self.assertIn(".env.production.example", paths)
        self.assertIn("GUMROAD_CONFIRMATION_COPY.md", paths)


if __name__ == "__main__":
    unittest.main(verbosity=2)
