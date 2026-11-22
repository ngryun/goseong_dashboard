import datetime as dt
import json
import os
from pathlib import Path
import sys
import tempfile
import unittest
from unittest import mock
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import build_weather

KST = build_weather.KST


def at(day, hour, minute=0):
    return dt.datetime(2026, 11, day, hour, minute, tzinfo=KST)


def hour_items(date, hour, sky='1', pty='0', pop='0', tmp='5'):
    values = dict(TMP=tmp, SKY=sky, PTY=pty, POP=pop, PCP='강수없음', SNO='적설없음', WSD='2', REH='40')
    return [dict(category=c, fcstDate=date, fcstTime=f'{hour:02d}00', fcstValue=v, nx=85, ny=145) for c, v in values.items()]


def extreme(date, category, value):
    return dict(category=category, fcstDate=date, fcstTime='0600' if category == 'TMN' else '1500', fcstValue=value, nx=85, ny=145)


def answer(items, total=None):
    return {'response': {'header': {'resultCode': '00', 'resultMsg': 'NORMAL_SERVICE'},
                         'body': {'dataType': 'JSON', 'items': {'item': items}, 'totalCount': len(items) if total is None else total}}}


# 02:00 issue: all of the 22nd (clear) with its low/high, and the 23rd.
MORNING = ([i for h in range(3, 24) for i in hour_items('20261122', h)]
           + [extreme('20261122', 'TMN', '-4.0'), extreme('20261122', 'TMX', '8.0')]
           + [i for h in range(24) for i in hour_items('20261123', h, sky='3')])
# 14:00 issue: the rest of the 22nd turns to snow, the 23rd is overcast in the morning and rainy later,
# the 25th comes in three-hour steps and the 26th has only midnight.
AFTERNOON = ([i for h in range(15, 24) for i in hour_items('20261122', h, sky='4', pty='3' if h == 17 else '0', pop='70' if h == 17 else '30')]
             + [i for h in range(24) for i in hour_items('20261123', h, sky='4', pty='1' if h in (13, 14) else '4' if h == 16 else '0', pop='60' if h >= 12 else '20')]
             + [extreme('20261123', 'TMN', '2.0'), extreme('20261123', 'TMX', '11.0')]
             + [i for h in range(0, 24, 3) for i in hour_items('20261125', h, sky='3' if h in (6, 12, 15) else '1')]
             + [extreme('20261125', 'TMN', '-2.4')]
             + hour_items('20261126', 0))
ISSUES = {('20261122', '0200'): MORNING, ('20261122', '1400'): AFTERNOON}


def fake_fetch(base_date, base_time, page):
    return answer(ISSUES[base_date, base_time])


class WeatherTests(unittest.TestCase):
    def test_latest_base_waits_for_publication_and_falls_back_to_the_previous_night(self):
        base = build_weather.latest_base
        self.assertEqual(base(at(22, 10, 24)), at(22, 8))
        self.assertEqual(base(at(22, 8, 10)), at(22, 5), 'an issue is not requested before it is served')
        self.assertEqual(base(at(22, 8, 15)), at(22, 8))
        self.assertEqual(base(at(22, 1, 0)), at(21, 23))
        self.assertEqual(base(dt.datetime(2026, 11, 22, 1, 24, tzinfo=dt.timezone.utc)), at(22, 8), 'GitHub runners use UTC')

    def test_days_merge_the_morning_issue_with_the_latest_one(self):
        data = build_weather.build(at(22, 14, 40), fake_fetch)
        self.assertEqual((data['base'], data['place'], data['grid'], data['errors']), ('2026-11-22T14:00+09:00', '고성군 간성읍', [85, 145], []))
        self.assertEqual(data['checked_at'], '2026-11-22T05:40:00+00:00')
        self.assertEqual([d['date'] for d in data['days']], ['2026-11-22', '2026-11-23', '2026-11-25'],
                         'a day with only its first hours is left out')
        today, tomorrow, later = data['days']
        # Hours already past and the low/high come from 02:00; the afternoon comes from the 14:00 issue.
        self.assertEqual((today['tmin'], today['tmax']), (-4, 8))
        self.assertEqual(today['am'], dict(sky='clear', pop=0))
        self.assertEqual(today['pm'], dict(sky='snow', pop=70))
        self.assertEqual((today['sky'], today['pop']), ('snow', 70))
        # The newer issue replaces the whole day it covers; rain outranks a shower, and the higher chance is kept.
        self.assertEqual(tomorrow['am'], dict(sky='overcast', pop=20))
        self.assertEqual(tomorrow['pm'], dict(sky='rain', pop=60))
        self.assertEqual((tomorrow['tmin'], tomorrow['tmax']), (2, 11))
        # Three-hour steps still give both halves; a tie between skies goes to the cloudier one.
        self.assertEqual((later['am']['sky'], later['pm']['sky'], later['sky']), ('cloudy', 'cloudy', 'cloudy'))
        self.assertEqual((later['tmin'], later['tmax']), (-2, None))

    def test_before_the_morning_issue_only_the_latest_one_is_read(self):
        calls = []

        def fetch(base_date, base_time, page):
            calls.append((base_date, base_time, page))
            return answer([i for h in range(24) for i in hour_items('20261122', h)])

        data = build_weather.build(at(22, 1, 30), fetch)
        self.assertEqual(calls, [('20261121', '2300', 1)])
        self.assertEqual([d['date'] for d in data['days']], ['2026-11-22'])

    def test_a_failed_morning_issue_is_reported_but_the_latest_one_is_used(self):
        def fetch(base_date, base_time, page):
            if base_time == '0200':
                raise ValueError('시간 초과')
            return answer(AFTERNOON)

        data = build_weather.build(at(22, 14, 40), fetch)
        self.assertEqual(data['errors'], ['오늘 02시 발표분: 시간 초과'])
        self.assertEqual([d['date'] for d in data['days']], ['2026-11-23', '2026-11-25'], 'today has no morning hours without the 02:00 issue')

    def test_issue_is_read_page_by_page(self):
        items = [i for h in range(24) for i in hour_items('20261122', h)]
        pages = []

        def fetch(base_date, base_time, page):
            pages.append(page)
            return answer(items[(page - 1) * 100:page * 100], total=len(items))

        self.assertEqual(len(build_weather.fetch_issue(at(22, 2), fetch)), len(items))
        self.assertEqual(pages, [1, 2])

    def test_api_error_writes_an_empty_forecast_and_does_not_fail_the_run(self):
        def fetch(base_date, base_time, page):
            return {'response': {'header': {'resultCode': '30', 'resultMsg': 'SERVICE_KEY_IS_NOT_REGISTERED_ERROR'}}}

        with tempfile.TemporaryDirectory() as folder:
            output = Path(folder) / 'weather.json'
            with mock.patch('sys.stderr'), mock.patch('sys.stdout'):
                code = build_weather.main(['--output', str(output)], fetch=fetch, now=at(22, 14, 40))
            data = json.loads(output.read_text(encoding='utf-8'))
        self.assertEqual(code, 0)
        self.assertEqual((data['days'], data['base']), ([], None))
        self.assertIn('SERVICE_KEY_IS_NOT_REGISTERED_ERROR', data['errors'][0])

    def test_without_a_key_nothing_is_written(self):
        with tempfile.TemporaryDirectory() as folder:
            output = Path(folder) / 'weather.json'
            with mock.patch.dict(os.environ, {}, clear=True), mock.patch('sys.stdout'):
                self.assertEqual(build_weather.main(['--output', str(output)]), 0)
            self.assertFalse(output.exists())

    def test_request_failure_message_does_not_contain_the_key(self):
        def refuse(url, timeout):
            raise OSError(f'cannot open {url}')

        with mock.patch('urllib.request.urlopen', refuse), mock.patch('time.sleep'):
            with self.assertRaises(ValueError) as caught:
                build_weather.fetch_page('SECRET-KEY', '20261122', '0200', 1)
        self.assertNotIn('SECRET-KEY', str(caught.exception))


if __name__ == '__main__':
    unittest.main()
