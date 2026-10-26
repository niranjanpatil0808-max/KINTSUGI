"""Pinned messages (per room, for everyone in it) and the agent memory viewer (notes, limited to chats you can see)."""
from tests.test_workspace_team import Base


class TestPins(Base):
    def test_pin_shows_for_the_room_and_unpin_removes_it(self):
        self.invite_and_join("sam", rooms=["team"])
        mid = self.call("sam", "POST", "/api/say", {"room": "team", "text": "The launch is on Friday at 10:00"})[1]["id"]
        self.assertTrue(self.call("sam", "POST", "/api/pins/toggle", {"id": mid})[1]["pinned"])
        pins = self.call("owner", "GET", "/api/pins?room=team")[1]
        self.assertEqual([(p["id"], p["by"]) for p in pins], [(mid, "sam")])
        team = [r for r in self.call("sam", "GET", "/api/state")[1]["rooms"] if r["name"] == "team"][0]
        self.assertEqual(team["pins"], 1)
        self.assertFalse(self.call("owner", "POST", "/api/pins/toggle", {"id": mid})[1]["pinned"])
        self.assertEqual(self.call("owner", "GET", "/api/pins?room=team")[1], [])

    def test_people_outside_a_room_can_neither_pin_nor_read_its_pins(self):
        self.invite_and_join("sam", rooms=["team"])
        secret = self.ws.post("secret-room", "you", "the private plan")
        self.assertEqual(self.call("sam", "POST", "/api/pins/toggle", {"id": secret})[0], 400)
        self.call("owner", "POST", "/api/pins/toggle", {"id": secret})
        self.assertEqual(self.call("sam", "GET", "/api/pins?room=secret-room")[0], 403)
        self.assertNotIn("secret-room", [r["name"] for r in self.call("sam", "GET", "/api/state")[1]["rooms"]])

    def test_deleting_the_message_or_the_room_removes_the_pin(self):
        mid = self.ws.post("team", "you", "pin me")
        self.call("owner", "POST", "/api/pins/toggle", {"id": mid})
        self.call("owner", "POST", "/api/message/delete", {"id": mid})
        self.assertEqual(self.ws.db.one("SELECT COUNT(*) AS n FROM pins")["n"], 0)
        other = self.ws.post("secret-room", "you", "pin me too")
        self.ws.toggle_pin(other, "you")
        self.ws.delete_room("secret-room")
        self.assertEqual(self.ws.db.one("SELECT COUNT(*) AS n FROM pins")["n"], 0)

    def test_a_room_has_a_pin_limit(self):
        ids = [self.ws.post("team", "you", f"m{i}") for i in range(self.ws.MAX_PINS + 1)]
        for i in ids[:-1]:
            self.ws.toggle_pin(i, "you")
        self.assertEqual(self.call("owner", "POST", "/api/pins/toggle", {"id": ids[-1]})[0], 400)


class TestMemoryViewer(Base):
    def test_people_see_and_delete_only_notes_from_chats_they_are_in(self):
        self.invite_and_join("sam", rooms=["team"])
        team_note = self.ws.add_note("alice", "The team prefers short answers", room="team")
        secret_note = self.ws.add_note("alice", "Owner's salary is private", room="secret-room")
        old_note = self.ws.add_note("alice", "An old note recalled everywhere", room=None)
        seen = [n["id"] for n in self.call("sam", "GET", "/api/notes?agent=alice")[1]]
        self.assertEqual(seen, [team_note])  # not the private chat's note, not the chat-less one
        self.assertEqual(sorted(n["id"] for n in self.call("owner", "GET", "/api/notes?agent=alice")[1]), sorted([team_note, secret_note, old_note]))
        self.assertEqual(self.call("sam", "POST", "/api/notes/delete", {"id": secret_note})[0], 400)
        self.assertEqual(self.call("sam", "POST", "/api/notes/delete", {"id": old_note})[0], 400)
        self.assertEqual(self.call("sam", "POST", "/api/notes/delete", {"id": team_note})[0], 200)
        self.assertEqual(self.ws.search_notes("alice", "team prefers short answers", room="team"), [])
        self.assertTrue(any(r["event"] == "note-deleted" for r in self.ws.audit_log()))

    def test_unknown_agent(self):
        self.assertEqual(self.call("owner", "GET", "/api/notes?agent=nobody")[0], 400)
