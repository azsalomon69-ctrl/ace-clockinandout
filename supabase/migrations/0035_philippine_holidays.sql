begin;

create table public.philippine_holidays (
  id uuid primary key default gen_random_uuid(),
  holiday_name text not null check (length(btrim(holiday_name)) between 1 and 160),
  holiday_date date not null check (holiday_date between date '2000-01-01' and date '2099-12-31'),
  year integer generated always as (extract(year from holiday_date)::integer) stored,
  classification text not null check (classification in ('regular','special_non_working','special_working','other_non_working')),
  description text not null default '',
  geographic_scope text not null default 'national' check (geographic_scope in ('national','region','province','city','municipality')),
  location text not null default '',
  source_name text not null default '',
  source_url text not null default '' check (source_url = '' or source_url like 'https://%'),
  proclamation_number text not null default '',
  verification_status text not null default 'pending' check (verification_status in ('verified','pending')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((geographic_scope = 'national') = (btrim(location) = '')),
  check (verification_status <> 'verified' or (btrim(source_name) <> '' and source_url <> ''))
);

create unique index philippine_holidays_identity on public.philippine_holidays
  (holiday_date, lower(btrim(holiday_name)), geographic_scope, lower(btrim(location)));
create index philippine_holidays_year on public.philippine_holidays (year, holiday_date);
alter table public.philippine_holidays enable row level security;
revoke all on public.philippine_holidays from public, anon, authenticated;
grant select, insert, update, delete on public.philippine_holidays to service_role;

with annual(year, proclamation, source_url, maundy, friday, saturday, heroes, chinese, extra_name, extra_day) as (
  values
    (2025, '727, s. 2024', 'https://lawphil.net/executive/proc/proc2024/proc_727_2024.html', '04-17', '04-18', '04-19', '08-25', '01-29', 'All Saints'' Day Eve', '10-31'),
    (2026, '1006, s. 2025', 'https://lawphil.net/executive/proc/proc2025/proc_1006_2025.html', '04-02', '04-03', '04-04', '08-31', '02-17', 'All Souls'' Day', '11-02'),
    (2027, '1427, s. 2026', 'https://elibrary.judiciary.gov.ph/thebookshelf/showdocs/7/102791', '03-25', '03-26', '03-27', '08-30', '02-06', 'All Souls'' Day', '11-02')
)
insert into public.philippine_holidays
  (holiday_name, holiday_date, classification, source_name, source_url, proclamation_number, verification_status)
select item.name, (annual.year || '-' || item.day)::date, item.classification,
  'Presidential proclamation', annual.source_url, annual.proclamation, 'verified'
from annual
cross join lateral (values
  ('New Year''s Day', '01-01', 'regular'),
  ('Maundy Thursday', annual.maundy, 'regular'),
  ('Good Friday', annual.friday, 'regular'),
  ('Araw ng Kagitingan', '04-09', 'regular'),
  ('Labor Day', '05-01', 'regular'),
  ('Independence Day', '06-12', 'regular'),
  ('National Heroes Day', annual.heroes, 'regular'),
  ('Bonifacio Day', '11-30', 'regular'),
  ('Christmas Day', '12-25', 'regular'),
  ('Rizal Day', '12-30', 'regular'),
  ('Ninoy Aquino Day', '08-21', 'special_non_working'),
  ('All Saints'' Day', '11-01', 'special_non_working'),
  ('Feast of the Immaculate Conception', '12-08', 'special_non_working'),
  ('Last Day of the Year', '12-31', 'special_non_working'),
  ('EDSA People Power Revolution Anniversary', '02-25', 'special_working'),
  ('Chinese New Year', annual.chinese, 'special_non_working'),
  ('Black Saturday', annual.saturday, 'special_non_working'),
  (annual.extra_name, annual.extra_day, 'special_non_working'),
  ('Christmas Eve', '12-24', 'special_non_working')
) item(name, day, classification);

insert into public.philippine_holidays
 (holiday_name, holiday_date, classification, geographic_scope, location, description, source_name, source_url, proclamation_number, verification_status)
values
 ('National and Local Elections', '2025-05-12', 'special_non_working', 'national', '', 'One-time election day declaration.', 'Presidential Communications Office', 'https://pco.gov.ph/news_releases/pbbm-declares-may-12-a-non-working-holiday-for-natl-local-polls/', '878, s. 2025', 'verified'),
 ('Eid''l Fitr', '2025-04-01', 'regular', 'national', '', 'Feast of Ramadan.', 'Presidential Communications Office', 'https://pco.gov.ph/news_releases/pbbm-greets-muslims-at-the-end-of-ramadan-urges-them-to-continue-serving-others/', '839, s. 2025', 'verified'),
 ('Eid''l Adha', '2025-06-06', 'regular', 'national', '', 'Feast of Sacrifice.', 'Presidential Communications Office', 'https://pco.gov.ph/news_releases/pbbm-declares-june-6-regular-holiday-for-eidl-adha-observance/', '911, s. 2025', 'verified'),
 ('Eid''l Fitr', '2026-03-20', 'regular', 'national', '', 'Feast of Ramadan.', 'Presidential Communications Office', 'https://pco.gov.ph/news_releases/palace-declares-march-20-regular-holiday-nationwide-for-eidl-fitr/', '1189, s. 2026', 'verified'),
 ('Eid''l Adha', '2026-05-27', 'regular', 'national', '', 'Feast of Sacrifice.', 'Presidential Communications Office', 'https://pco.gov.ph/news_releases/palace-declares-may-27-as-a-regular-holiday-for-eidl-adha-observance/', '1264, s. 2026', 'verified'),
 ('Ilocos Norte Founding Anniversary', '2026-02-02', 'special_non_working', 'province', 'Ilocos Norte', '', 'Presidential proclamation', 'https://lawphil.net/executive/proc/proc2026/proc_1147_2026.html', '1147, s. 2026', 'verified'),
 ('Science City of Muñoz Charter Anniversary', '2026-12-09', 'special_non_working', 'city', 'Science City of Muñoz, Nueva Ecija', '', 'Presidential Communications Office', 'https://pco.gov.ph/news_releases/president-marcos-declares-special-non-working-days-in-14-municipalities-three-cities-and-a-province-to-celebrate-various-occasions/', '1513, s. 2026', 'verified'),
 ('Carmen Special Non-Working Day', '2026-11-17', 'special_non_working', 'municipality', 'Carmen, Surigao del Sur', '', 'Official Gazette', 'https://officialgazette.gov.ph/section/executive-issuances/proclamations/', '1487, s. 2026', 'verified');

commit;
