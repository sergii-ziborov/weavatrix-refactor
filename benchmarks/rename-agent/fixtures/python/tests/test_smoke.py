import unittest

from src.caller import run
from src.shadow import pick
from src.toplevel import DEFAULT_TARGET


class FixtureSmokeTest(unittest.TestCase):
    def test_imports_and_calls_still_work(self) -> None:
        self.assertEqual(run(" #main "), "#main/#main")
        self.assertEqual(DEFAULT_TARGET, "main")
        self.assertEqual(pick(3), 6)


if __name__ == "__main__":
    unittest.main()
