import unittest

from tidyai_agent.turn import card_action, route_turn, validate_note_op


class RouteTests(unittest.TestCase):
    def test_empty_project_stays_direct_even_with_memory_words(self):
        route = route_turn("remind me what we covered", project_has_notes=False)
        self.assertEqual(route.name, "direct")

    def test_plain_question_does_not_retrieve(self):
        route = route_turn("Explain torque.", project_has_notes=True)
        self.assertEqual(route.name, "direct")

    def test_memory_cue_retrieves_once(self):
        route = route_turn("remind me about torque", project_has_notes=True)
        self.assertEqual(route.name, "retrieve")

    def test_compare_is_agentic(self):
        route = route_turn(
            "compare torque and angular momentum across the notes",
            project_has_notes=True,
        )
        self.assertEqual(route.name, "agentic")


class CardTests(unittest.TestCase):
    def test_exact_key_goes_to_judge(self):
        self.assertEqual(card_action(exact_key=True, top_cosine=None), "judge_update")

    def test_high_cosine_goes_to_judge(self):
        self.assertEqual(card_action(exact_key=False, top_cosine=0.92), "judge_update")

    def test_just_under_threshold_creates(self):
        self.assertEqual(card_action(exact_key=False, top_cosine=0.919), "create")

    def test_no_embedding_creates_when_key_misses(self):
        self.assertEqual(card_action(exact_key=False, top_cosine=None), "create")


class NoteOpTests(unittest.TestCase):
    def test_equation_insert_ok(self):
        validate_note_op(
            {"op": "insert", "parentId": "page-1", "type": "equation", "payload": {"latex": "F=ma"}}
        )

    def test_html_type_rejected(self):
        with self.assertRaises(ValueError):
            validate_note_op({"op": "insert", "parentId": "page-1", "type": "html"})

    def test_replace_needs_id(self):
        with self.assertRaises(ValueError):
            validate_note_op({"op": "replace", "type": "paragraph"})

    def test_delete_needs_id(self):
        with self.assertRaises(ValueError):
            validate_note_op({"op": "delete"})


if __name__ == "__main__":
    unittest.main()
