begin;

insert into public.philippine_holidays
  (holiday_name, holiday_date, classification, geographic_scope, location, description, source_name, source_url, proclamation_number, verification_status)
values
  ('Santa Rosa Cityhood Anniversary', '2025-07-10', 'special_non_working', 'city', 'Santa Rosa, Laguna', '21st cityhood anniversary.', 'Presidential proclamation', 'https://elibrary.judiciary.gov.ph/thebookshelf/showdocs/7/99308', '948, s. 2025', 'verified'),
  ('Santa Rosa Cityhood Anniversary', '2026-07-10', 'special_non_working', 'city', 'Santa Rosa, Laguna', '22nd cityhood anniversary.', 'Presidential proclamation', 'https://elibrary.judiciary.gov.ph/thebookshelf/showdocs/7/101647', '1329, s. 2026', 'verified')
on conflict do nothing;

insert into public.philippine_holidays
  (holiday_name, holiday_date, classification, geographic_scope, location, description, source_name, source_url, verification_status)
select 'Araw ng Kapanganakan ni Dr. Jose P. Rizal', make_date(year, 6, 19),
  'special_non_working', 'province', 'Laguna', 'Province-wide holiday under Republic Act No. 11144.',
  'Republic Act No. 11144', 'https://elibrary.judiciary.gov.ph//thebookshelf//showdocs/2/86299', 'verified'
from generate_series(2025, 2027) as years(year)
on conflict do nothing;

commit;
