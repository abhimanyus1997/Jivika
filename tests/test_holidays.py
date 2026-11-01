import pytest
from fastapi.testclient import TestClient

import main
from jivika import holidays, jobs

client = TestClient(main.app)

# Trimmed from the live India and Germany feeds: CRLF, folded DESCRIPTION, escaped commas, a duplicate.
FEED = (
    "BEGIN:VCALENDAR\r\nVERSION:2.0\r\nX-WR-CALNAME:Holidays in India\r\n"
    "BEGIN:VEVENT\r\nDTSTART;VALUE=DATE:20260126\r\nDTEND;VALUE=DATE:20260127\r\n"
    "DESCRIPTION:Public holiday\r\nSUMMARY:Republic Day\r\nEND:VEVENT\r\n"
    "BEGIN:VEVENT\r\nDTSTART;VALUE=DATE:20260126\r\nDESCRIPTION:Public holiday\r\nSUMMARY:Republic Day\r\nEND:VEVENT\r\n"
    "BEGIN:VEVENT\r\nDTSTART;VALUE=DATE:20260216\r\n"
    "DESCRIPTION:Observance\\nTo hide observances\\, go to Google Calendar Setting\r\n s > Holidays in India\r\n"
    "SUMMARY:Vasant Panchami\r\nEND:VEVENT\r\n"
    "BEGIN:VEVENT\r\nDTSTART;VALUE=DATE:20260106\r\n"
    "DESCRIPTION:Public holiday in Baden-W\u00fcrttemberg\\, Bavaria\\, Saxony-Anhal\r\n t\r\n"
    "SUMMARY:Epiphany (regional holiday)\r\nEND:VEVENT\r\n"
    "BEGIN:VEVENT\r\nDTSTART:20260301T100000Z\r\nSUMMARY:Timed event is skipped\r\nEND:VEVENT\r\n"
    "BEGIN:VEVENT\r\nDTSTART;VALUE=DATE:20270126\r\nDESCRIPTION:Public holiday\r\nSUMMARY:Republic Day\r\nEND:VEVENT\r\n"
    "END:VCALENDAR\r\n"
)


@pytest.fixture
def feed(monkeypatch):
    calls = []

    def fake(url, headers=None, cap=jobs.MAX_BYTES, data=None):
        calls.append(url)
        return FEED.encode()

    monkeypatch.setattr(jobs, "fetch", fake)
    main._holiday_hits.clear()
    return calls


def test_parse_kinds_unfolding_and_duplicates():
    items = holidays.parse(FEED)
    assert items == [
        {"date": "2026-01-06", "name": "Epiphany (regional holiday)", "kind": "regional", "region": "Baden-W\u00fcrttemberg, Bavaria, Saxony-Anhalt"},
        {"date": "2026-01-26", "name": "Republic Day", "kind": "public"},
        {"date": "2026-02-16", "name": "Vasant Panchami", "kind": "observance"},
        {"date": "2027-01-26", "name": "Republic Day", "kind": "public"},
    ]


def test_route_filters_year_and_caches(feed):
    r = client.get("/api/holidays", params={"country": "IN", "year": 2026})
    assert r.status_code == 200
    body = r.json()
    assert body["country"] == "in" and body["year"] == 2026 and body["source"] == "Google public holiday calendar"
    assert [h["date"] for h in body["holidays"]] == ["2026-01-06", "2026-01-26", "2026-02-16"]
    assert feed == ["https://calendar.google.com/calendar/ical/en.indian%23holiday%40group.v.calendar.google.com/public/basic.ics"]
    assert client.get("/api/holidays", params={"country": "in", "year": 2027}).json()["holidays"][0]["name"] == "Republic Day"
    assert len(feed) == 1  # one cached feed serves every year


def test_route_rejects_unknown_country_and_bad_year(feed):
    assert client.get("/api/holidays", params={"country": "xx", "year": 2026}).status_code == 422
    assert client.get("/api/holidays", params={"country": "../", "year": 2026}).status_code == 422
    assert client.get("/api/holidays", params={"country": "in", "year": 1800}).status_code == 422
    assert feed == []


def test_route_502_when_feed_unavailable(monkeypatch):
    def down(*args, **kwargs):
        raise jobs.SourceError("Unavailable right now.")

    monkeypatch.setattr(jobs, "fetch", down)
    main._holiday_hits.clear()
    r = client.get("/api/holidays", params={"country": "in", "year": 2026})
    assert r.status_code == 502 and "holiday calendar is unavailable" in r.json()["detail"]
    monkeypatch.setattr(jobs, "fetch", lambda *a, **k: b"<html>not a calendar</html>")
    assert client.get("/api/holidays", params={"country": "in", "year": 2026}).status_code == 502


def test_rate_limit(feed):
    codes = [client.get("/api/holidays", params={"country": "in", "year": 2026}).status_code for _ in range(31)]
    assert codes[:30] == [200] * 30 and codes[30] == 429
