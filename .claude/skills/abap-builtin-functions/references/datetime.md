# Date, Time & Time Stamp — Full Reference

Source: SAP-samples/abap-cheat-sheets `23_Date_and_Time.md` and `24_Builtin_Functions.md`. Syntax copied verbatim. Focus follows the cheat sheet: **ABAP for Cloud Development** (with classic notes).

Back to [SKILL.md](../SKILL.md). Related: [numeric.md](numeric.md), [builtin-catalog.md](builtin-catalog.md), [abap-data-objects](../../abap-data-objects/SKILL.md).

---

## 1. Data types

### Built-in ABAP types

| Type | Length | Format | Value range | Initial | Notes |
|---|---|---|---|---|---|
| `d` | 8 char | `yyyymmdd` | yyyy 0001–9999, mm 01–12, dd 01–31 | `00000000` | character-like; numeric context ⇒ days since 01.01.0001 |
| `t` | 6 char | `hhmmss` | hh 00–23, mm 00–59, ss 00–59 | `000000` | character-like; numeric context ⇒ seconds since 00:00:00 |
| `utclong` | 8 byte | ISO 8601, 100 ns | 0001-01-01T00:00:00.0000000 … 9999-12-31T23:59:59.9999999 | special | **recommended** time stamp; UTC; 8-byte integer internally |

### Built-in DDIC types / data elements (tables, CDS, typed literals only)

- `datn` → mapped to `d`; `timn` → mapped to `t`; `utclong` → identically named ABAP type.
- `dats` / `tims` — older; require conversion to actual date/time types.
- **Recommendation:** for DB storage prefer `datn` / `timn` (optimized) over `dats` / `tims`; for UTC time stamps use `utclong`.
- Data elements `timestamp` / `timestampl` represent time stamps as **packed numbers** (released APIs):
  - `timestamp` — short, to the second, format `yyyymmddhhmmss`.
  - `timestampl` — long, to 100 ns (7 decimals), format `yyyymmddhhmmss.sssssss`.

```abap
DATA lv_some_date TYPE d.            lv_some_date = '20240101'.
DATA(lv_some_time) = CONV t( '123456' ).
FINAL(lv_utc_ts)   = CONV utclong( '2024-01-01 15:30:00' ).
DATA lv_ts_short TYPE timestamp.     lv_ts_short = '20240101082802'.
DATA lv_ts_long  TYPE timestampl VALUE '20240101082802.1700020'.
```

> Time stamps of the ABAP runtime are **POSIX**: 86400 seconds/day, no leap seconds, time-zone independent.
> In **ABAP Cloud** do NOT use `sy-datum`, `sy-uzeit`, `sy-timlo`, `sy-datlo` etc. — use `cl_abap_context_info` or XCO. In **classic** ABAP these system fields are fine.

---

## 2. Time zone

```abap
"Recommended: cl_abap_context_info
TRY.
    DATA(lv_tz) = cl_abap_context_info=>get_user_time_zone( ).  "e.g. UTC
  CATCH cx_abap_context_info_error.
ENDTRY.

"XCO
DATA(lv_tz_w_xco)     = xco_cp_time=>time_zone->user->value.
DATA(lv_tz_w_xco_utc) = xco_cp_time=>time_zone->utc->value.
```

CDS view with time-zone info: `I_TIMEZONE`. On SAP BTP ABAP Environment the time zone defaults to UTC.

---

## 3. Date

### Retrieving / creating

```abap
"Current date (UTC) — base type dats, mapped to d
DATA(lv_utc_date) = cl_abap_context_info=>get_system_date( ).  "e.g. 20240101

"XCO (results are type string); 'as' applies a format, 'date' takes optional time zone
DATA(lv_date_abap)  = xco_cp=>sy->date( )->as( xco_cp_time=>format->abap )->value.              "20250101
DATA(lv_date_basic) = xco_cp=>sy->date( )->as( xco_cp_time=>format->iso_8601_basic )->value.    "20250101
DATA(lv_date_ext)   = xco_cp=>sy->date( )->as( xco_cp_time=>format->iso_8601_extended )->value. "2025-01-01
DATA(lv_date_user)  = xco_cp=>sy->date( xco_cp_time=>time_zone->user )->as( xco_cp_time=>format->iso_8601_basic )->value.
DATA(lv_date_utc)   = xco_cp=>sy->date( xco_cp_time=>time_zone->utc  )->as( xco_cp_time=>format->iso_8601_basic )->value.

"Current date parts
DATA(lv_day)   = xco_cp=>sy->date( )->day.
DATA(lv_month) = xco_cp=>sy->date( )->month.
DATA(lv_year)  = xco_cp=>sy->date( )->year.

"Creating
DATA lv_date_cr2 TYPE d VALUE '20240202'.
DATA(lv_date_cr3) = CONV d( '20240303' ).
DATA(lo_xco_date) = xco_cp_time=>date( iv_year = 2024 iv_month = 3 iv_day = 3 ).
DATA(lv_date_cr4) = lo_xco_date->as( xco_cp_time=>format->iso_8601_extended )->value. "2024-03-03
```

### Validity

```abap
TRY.
    DATA(lv_inv_date1) = EXACT d( '20240231' ).  "CX_SY_CONVERSION_NO_DATE (Feb 31)
  CATCH cx_sy_conversion_no_date.
ENDTRY.
"Assigning an invalid date to a numeric type produces the initial value (0).
DATA(lv_inv_date3) = CONV i( CONV d( '20240231' ) ). ASSERT lv_inv_date3 = 0.
```

The runtime checks validity in lossless assignments (`EXACT`), conversions to time stamps, and assignments to numeric fields.

### Character-like access

```abap
DATA lv_some_date TYPE d VALUE '20240102'.
DATA(lv_year_sub)  = substring( val = lv_some_date off = 0 len = 4 ). "2024
DATA(lv_month_sub) = substring( val = lv_some_date off = 4 len = 2 ). "01
DATA(lv_day_sub)   = substring( val = lv_some_date off = 6 len = 2 ). "02
DATA(lv_yr)        = lv_some_date(4).      "2024 (offset/length)
DATA(lv_mo)        = lv_some_date+4(2).    "01
lv_some_date+4(2)  = '10'.              "write access -> 20241002
```

Comparison rule for `d`/`t`: compared left to right; first differing character decides which is greater (works naturally with `yyyymmdd`). Ranges tables (`TYPE RANGE OF d`) work with `IN`.

### Numeric access / calculations

```abap
DATA lv_date_calc_1 TYPE d VALUE '20240101'.
DATA lv_date_calc_2 TYPE d VALUE '20231227'.
DATA(lv_days_diff)            = lv_date_calc_1 - lv_date_calc_2.        "5
DATA(lv_days_since_0001)      = CONV i( lv_date_calc_1 ).            "738887
DATA(lv_weekday1)             = ( 5 + lv_date_calc_1 MOD 7 ) MOD 7 + 1. "1 = Monday (2=Tue…7=Sun)
DATA(lv_first_day_of_month)   = CONV d( replace( val = `202403020` off = 6 len = 2 with = `01` ) ). "20240301
DATA(lv_last_day_prev_month)  = CONV d( lv_first_day_of_month - 1 ).   "20240229
```

### XCO additions / subtractions

```abap
DATA(lv_add5) = xco_cp=>sy->date( )->add( iv_day = 5 )->as( xco_cp_time=>format->iso_8601_extended )->value.
DATA(lv_addm) = xco_cp=>sy->date( )->add( iv_day = 1 iv_month = 1 iv_year = 1 )->as( xco_cp_time=>format->iso_8601_extended )->value.
DATA(lv_sub)  = xco_cp=>sy->date( )->subtract( iv_day = 1 iv_month = 1 iv_year = 1 )->as( xco_cp_time=>format->iso_8601_extended )->value.

"io_calculation parameter for month-end edge cases:
" ->preserving (default): mathematical; invalid result raises an exception
" ->ultimo: clamps to the actual last day of the month (e.g. Aug 31 + 1 month = Sep 30)
DATA(lv_ultimo) = xco_cp_time=>date( iv_year = '2024' iv_month = '08' iv_day = '31'
              )->add( iv_month = 1 io_calculation = xco_cp_time=>date_calculation->ultimo
              )->as( xco_cp_time=>format->iso_8601_extended )->value. "2024-09-30
```

### CL_ABAP_DATFM — date format conversions (internal ⇄ external)

```abap
"Date format values: '1' DD.MM.YYYY  '2' MM/DD/YYYY  '3' MM-DD-YYYY  '4' YYYY.MM.DD
"'5' YYYY/MM/DD  '6' YYYY-MM-DD (ISO)  '7'-'9' Japanese  'A'/'B' Islamic  'C' Iranian
cl_abap_datfm=>conv_date_int_to_ext( EXPORTING im_datint = CONV d( '20240202' ) im_datfmdes = '6'
                                     IMPORTING ex_datext = DATA(lv_ext) ex_datfmused = DATA(lv_fmt) ).
cl_abap_datfm=>conv_date_ext_to_int( EXPORTING im_datext = lv_ext im_datfmdes = '6'
                                     IMPORTING ex_datint = DATA(lv_int_d) ex_datfmused = lv_fmt ).
DATA(lv_datfm)         = cl_abap_datfm=>get_datfm( ).             "active format
DATA(lv_country_datfm) = cl_abap_datfm=>get_country_datfm( 'DE' ).
DATA(lv_is_valid)      = cl_abap_datfm=>check_date_format( '1' ). "abap_true
```

Exceptions: `cx_abap_datfm_format_unknown`, `cx_abap_datfm_no_date`, `cx_abap_datfm_invalid_date`, `cx_abap_datfm_ambiguous`.

---

## 4. Time

### Retrieving / accessing / creating

```abap
DATA(lv_utc_time) = cl_abap_context_info=>get_system_time( ).    "e.g. 152450

DATA(lv_time_ext) = xco_cp=>sy->time( )->as( xco_cp_time=>format->iso_8601_extended )->value. "16:09:07
DATA(lv_sec_xco)  = xco_cp=>sy->time( xco_cp_time=>time_zone->user )->second.
DATA(lv_min_xco)  = xco_cp=>sy->time( xco_cp_time=>time_zone->user )->minute.
DATA(lv_hr_xco)   = xco_cp=>sy->time( xco_cp_time=>time_zone->user )->hour.

DATA lv_some_time TYPE t VALUE '123456'.
DATA(lv_hour_extr) = substring( val = lv_some_time off = 0 len = 2 ). "12
DATA(lv_hour_part) = lv_some_time(2).      "12
lv_some_time+4(2)  = '10'.              "123410

DATA lv_time_cr2 TYPE t VALUE '112400'.
DATA(lv_time_cr3) = CONV t( '120000' ).
DATA(lo_xco_time) = xco_cp_time=>time( iv_hour = '08' iv_minute = '34' iv_second = '05' ).
DATA(lv_time_cr4) = lo_xco_time->as( xco_cp_time=>format->iso_8601_extended )->value. "08:34:05
```

### Calculations

```abap
"Type t -> i conversion: hh*3600 + mm*60 + ss (seconds since 00:00:00)
DATA lv_time4calc TYPE t VALUE '115708'.
DATA(lv_seconds_total) = CONV i( lv_time4calc ).            "43028
DATA(lv_calc_hours)    = lv_seconds_total DIV 3600.         "11
DATA(lv_min_calc)      = ( lv_seconds_total - lv_calc_hours * 3600 ) DIV 60. "57
DATA(lv_sec_calc)      = ( lv_seconds_total - lv_calc_hours * 3600 ) - lv_min_calc * 60. "8

"XCO add / subtract
DATA(lv_add) = xco_cp=>sy->time( xco_cp_time=>time_zone->user )->add( iv_hour = 1 iv_minute = 1 iv_second = 1 )->as( xco_cp_time=>format->iso_8601_extended )->value.
DATA(lv_sub) = xco_cp=>sy->time( xco_cp_time=>time_zone->user )->subtract( iv_hour = 1 iv_minute = 1 iv_second = 1 )->as( xco_cp_time=>format->iso_8601_extended )->value.
```

### Time delta across midnight — the MOD 86400 idiom

`lv_time2 - lv_time1` yields type `i` (seconds) and can be negative. `MOD 86400` (seconds/day) normalizes to the positive elapsed time, regardless of sign:

```abap
DATA: lv_time1 TYPE t VALUE '210000', lv_time2 TYPE t VALUE '040000'.
DATA(lv_time_diff) = lv_time2 - lv_time1.                       "-61200 (raw)
DATA(lv_elapsed)   = ( lv_time2 - lv_time1 ) MOD 86400.         "25200 seconds (7 h)
DATA(lv_minutes)   = CONV decfloat34( ( ( lv_time2 - lv_time1 ) MOD 86400 ) / 60 ).   "420
DATA(lv_hours_dec) = CONV decfloat34( ( ( lv_time2 - lv_time1 ) MOD 86400 ) / 3600 ). "7

"Split into a type-t result with DIV/MOD
DATA lv_diff_time TYPE t.
lv_diff_time(2)   = ( ( lv_time2 - lv_time1 ) MOD 86400 ) DIV 3600.
lv_diff_time+2(2) = ( ( ( lv_time2 - lv_time1 ) MOD 86400 ) MOD 3600 ) DIV 60.
lv_diff_time+4(2) = ( ( ( lv_time2 - lv_time1 ) MOD 86400 ) MOD 3600 ) MOD 60. "'070000'
```

> Use `DIV`, not `/`: `( … ) DIV 3600` truncates to `15`; `( … ) / 3600` into an integer target **rounds** to `16`.

### CL_ABAP_TIMEFM — time format conversions

```abap
cl_abap_timefm=>conv_time_int_to_ext( EXPORTING time_int = CONV t( '123456' )
                                                without_seconds = abap_false
                                                format_according_to = cl_abap_timefm=>iso
                                      IMPORTING time_ext = DATA(lv_time_str) ). "12:34:56
cl_abap_timefm=>conv_time_ext_to_int( EXPORTING time_ext = lv_time_str
                                      IMPORTING time_int = DATA(lv_time_int) ). "123456
```

Exceptions: `cx_parameter_invalid_range`, `cx_abap_timefm_invalid`.

---

## 5. Time stamps — type utclong (recommended)

### Retrieve / create / modify

```abap
DATA(lv_ts1) = utclong_current( ).                            "type utclong
DATA lv_ts8 TYPE utclong VALUE '2024-11-05 15:30:00'.
DATA(lv_ts9) = CONV utclong( '2024-11-03 05:30:00' ).

"XCO moment (return type string)
DATA(lv_ts_ext) = xco_cp=>sy->moment( )->as( xco_cp_time=>format->iso_8601_extended )->value. "2025-01-01T16:23:20
DATA(lv_ts10)   = xco_cp_time=>moment( iv_year = '2024' iv_month = '01' iv_day = '01'
                                    iv_hour = '12' iv_minute = '34' iv_second = '55'
                                  )->as( xco_cp_time=>format->iso_8601_extended )->value.
"overwrite specific components
DATA(lv_ts12)   = xco_cp_time=>moment( iv_year = '2024' iv_month = '03' iv_day = '05' iv_hour = '02' iv_minute = '54' iv_second = '12'
                                  )->overwrite( iv_year = '2025' iv_month = '07' iv_day = '15' iv_hour = '01'
                                  )->as( xco_cp_time=>format->iso_8601_extended )->value. "2025-07-15T01:54:12
```

### utclong_add — add/subtract (no year/month params; negative = subtract)

```abap
DATA(lv_utc4calc) = CONV utclong( '2024-01-01 15:55:14.1173220' ).
DATA(lv_plus1h)  = utclong_add( val = lv_utc4calc hours = 1 ).   "…16:55:14…
DATA(lv_minus1h) = utclong_add( val = lv_utc4calc hours = -1 ).  "…14:55:14…
DATA(lv_allp)    = utclong_add( val = lv_utc4calc
                             days = 1                       "type i
                             hours = 2                      "type i
                             minutes = CONV int8( '13' )
                             seconds = CONV decfloat34( '53.12' ) ).
```

At least one parameter besides `val` must be specified. Parameters: `days`, `hours`, `minutes`, `seconds` (no years/months — use XCO for those).

### XCO add / subtract / interval

```abap
DATA(lo_ts_ref1) = xco_cp_time=>moment( iv_year = '2024' iv_month = '01' iv_day = '01' iv_hour = '11' iv_minute = '37' iv_second = '54' ).
DATA(lv_addymd)  = lo_ts_ref1->add( iv_day = 1 iv_month = 2 iv_year = 3 )->as( xco_cp_time=>format->iso_8601_extended )->value. "2027-03-02T11:37:54
DATA(lv_subymd)  = lo_ts_ref1->subtract( iv_day = 1 iv_month = 2 iv_year = 3 )->as( xco_cp_time=>format->iso_8601_extended )->value. "2020-10-31T11:37:54

"Interval + contains
DATA(lo_interval) = xco_cp=>sy->moment( )->interval_to( lo_ts_ref1 ).
DATA(lv_inside)   = lo_interval->contains( lo_ts_ref1 ).   "abap_bool
DATA(lv_low)      = lo_interval->lower_bound->as( xco_cp_time=>format->iso_8601_extended )->value.
DATA(lv_high)     = lo_interval->upper_bound->as( xco_cp_time=>format->iso_8601_extended )->value.
```

### utclong_diff — exact difference (type decfloat34, seconds)

```abap
DATA(lv_ts16) = CONV utclong( '2024-01-01 05:30:00' ).
DATA(lv_ts17) = CONV utclong( '2024-01-01 06:30:00' ).
DATA(lv_diff1) = utclong_diff( high = lv_ts17 low = lv_ts16 ). "3600
DATA(lv_diff2) = utclong_diff( high = lv_ts16 low = lv_ts17 ). "-3600
```

### CONVERT UTCLONG — utclong ⇄ local date/time

```abap
"utclong -> local date/time
CONVERT UTCLONG CONV utclong( '2024-11-03 05:30:00' )
        INTO DATE DATA(lv_date_utc) TIME DATA(lv_time_utc) TIME ZONE 'EST'. "20241103 / 013000

"with fractional seconds + daylight saving flag
CONVERT UTCLONG CONV utclong( '2024-08-08 09:23:11.7681270' )
        INTO DATE lv_date_utc TIME lv_time_utc
             FRACTIONAL SECONDS DATA(lv_fract) "0.768127
             DAYLIGHT SAVING TIME DATA(lv_dst) "X
             TIME ZONE 'EST'.
"Initial time zone -> no conversion. Non-existent zone -> CX_SY_CONVERSION_NO_DATE_TIME.

"local date/time -> utclong
CONVERT DATE CONV d( '20240101' ) TIME CONV t( '112458' )
        TIME ZONE 'EST' INTO UTCLONG DATA(lv_utcl). "2024-01-01 16:24:58.0000000
```

Validity errors when converting INTO UTCLONG: `cx_sy_conversion_no_date` (bad date), `cx_sy_conversion_no_time` (bad time), `cx_sy_conversion_no_date_time` (bad fractions/DST combo), `cx_parameter_invalid_range` (bad DST value).

### CL_ABAP_UTCLONG — utilities

```abap
"diff into components
cl_abap_utclong=>diff( EXPORTING high = CONV utclong( '2024-01-03 10:35:12' )
                                 low  = CONV utclong( '2024-01-01 05:30:00' )
                       IMPORTING days = DATA(lv_diff_days) hours = DATA(lv_diff_hours) minutes = DATA(lv_diff_minutes) seconds = DATA(lv_diff_seconds) ). "2 / 5 / 5 / 12

"read a character-like time stamp into utclong
DATA(lv_ts_string) = |{ utclong_current( ) TIMESTAMP = ENVIRONMENT TIMEZONE = 'UTC' }|.
TRY.
    cl_abap_utclong=>read( EXPORTING string = lv_ts_string timezone = 'UTC'
                           IMPORTING value  = DATA(lv_utc_ts) ).
  CATCH cx_abap_utclong_invalid.
ENDTRY.
```

---

## 6. Time stamps in packed numbers (timestamp / timestampl)

Only a few ABAP statements treat these specially; most interpret them as numbers.

### GET TIME STAMP

```abap
DATA lv_ts_short TYPE timestamp.  GET TIME STAMP FIELD lv_ts_short. "e.g. 20240101081317
DATA lv_ts_long  TYPE timestampl. GET TIME STAMP FIELD lv_ts_long.  "e.g. 20240101081317.81011
GET TIME STAMP FIELD DATA(lv_ts_inl).                            "inline -> short form (timestamp)
```

### CONVERT TIME STAMP — packed ⇄ local date/time

```abap
GET TIME STAMP FIELD DATA(lv_tsf).
DATA(lv_user_tz) = cl_abap_context_info=>get_user_time_zone( ).
CONVERT TIME STAMP lv_tsf TIME ZONE lv_user_tz INTO DATE DATA(lv_dat) TIME DATA(lv_tim).

"timestampl source -> fractions ignored; with DAYLIGHT SAVING TIME flag
CONVERT TIME STAMP CONV timestamp( '20240808112458' ) TIME ZONE 'EST'
        INTO DATE lv_dat TIME lv_tim DAYLIGHT SAVING TIME DATA(lv_dst). "lv_dst = abap_true

"sy-subrc: invalid time zone -> 8 ; invalid time stamp -> 12

"local -> packed
DATA lv_ts_conv TYPE timestamp.
CONVERT DATE CONV d( '20240101' ) TIME CONV t( '112458' )
        INTO TIME STAMP lv_ts_conv TIME ZONE 'EST'. "20240101162458
```

### CL_ABAP_TSTMP — calculate / convert packed time stamps

```abap
GET TIME STAMP FIELD DATA(lv_tsa).
DATA(lv_tsb)     = cl_abap_tstmp=>add( tstmp = lv_tsa secs = 3600 ).         "+1 h
DATA(lv_tsc)     = cl_abap_tstmp=>subtractsecs( tstmp = lv_tsa secs = 7200 )."-2 h
DATA lv_tsl TYPE timestampl. GET TIME STAMP FIELD lv_tsl.
DATA(lv_tsd)     = cl_abap_tstmp=>move_to_short( lv_tsl ).                   "timestampl -> timestamp
DATA(lv_ts2utcl) = cl_abap_tstmp=>tstmp2utclong( lv_tsl ).                   "-> utclong
DATA(lv_utcl2ts) = cl_abap_tstmp=>utclong2tstmp_short( lv_ts2utcl ).         "utclong -> timestamp
DATA(lv_utcl2tsl)= cl_abap_tstmp=>utclong2tstmp( lv_ts2utcl ).               "utclong -> timestampl
```

---

## 7. Unix time stamps (XCO)

Unix time stamp = seconds since 1970-01-01 00:00:00 UTC.

```abap
DATA(lv_unix_now)    = xco_cp=>sy->unix_timestamp( )->value.
DATA(lv_unix_custom) = xco_cp_time=>moment( iv_year = '2024' iv_month = '11' iv_day = '03'
                                         iv_hour = '07' iv_minute = '12' iv_second = '30'
                                       )->get_unix_timestamp( )->value. "1730617950
"Unix seconds -> utclong via utclong_add
DATA(lv_ts_from_unix) = utclong_add( val = CONV utclong( '1970-01-01 00:00:00' ) seconds = 1730617950 ).
```

---

## 8. Date/time in string templates

```abap
"DATE = USER | RAW | ISO | ENVIRONMENT
DATA(lv_d1) = |{ cl_abap_context_info=>get_system_date( ) DATE = ISO }|.  "2024-01-01
DATA(lv_d2) = |{ cl_abap_context_info=>get_system_date( ) DATE = RAW }|.  "20240101
"TIME = ISO | RAW | USER | ENVIRONMENT
DATA(lv_t1) = |{ cl_abap_context_info=>get_system_time( ) TIME = ISO }|.  "14:37:24
"TIMESTAMP = SPACE | ISO | USER | ENVIRONMENT
DATA(lv_s1) = |{ utclong_current( ) TIMESTAMP = ISO }|.                   "2024-01-01T14:39:50,4071110
"TIMEZONE (+ COUNTRY) for localized output
DATA(lv_z1) = |{ utclong_current( ) TIMEZONE = 'UTC' }|.
DATA(lv_z2) = |{ utclong_current( ) TIMEZONE = 'CET' COUNTRY = 'DE ' }|.  "30.12.2024 15:43:20,…
```

---

## 9. SQL / CDS date & time functions

Available in both ABAP SQL and ABAP CDS (same names). See full list in [builtin-catalog.md](builtin-catalog.md). Generic functions accept `d`/`t`/`utclong`; type-specific variants exist for `datn`/`dats`/`timn`/`tims`/`timestamp`/`utclong`.

```abap
SELECT SINGLE FROM i_timezone FIELDS
  is_valid( @lv_ti ) AS isvalid,                       "1
  extract_year( @lv_utc ) AS extr_year,                "2024
  dayname( @lv_da ) AS day_name,                       "Monday
  monthname( @lv_utc ) AS month_name,                  "February
  weekday( @lv_utc ) AS week_day,                      "3
  days_between( @lv_utc, utclong`2024-02-25 08:14:26` ) AS days_bw, "10
  add_days( @lv_da, 2 ) AS add_days,                   "20240124
  add_months( @lv_utc, 3 ) AS add_months,              "2024-05-15 …
  dats_add_days( dats`20240812`, 4 ) AS dats_add,   "20240816
  dats_add_months( dats`20240812`, 3 ) AS dats_addm,"20241112
  extract_hour( @lv_utc ) AS extr_hour,                "5
  utcl_current( ) AS utcl_current,
  utcl_add_seconds( @lv_utc, 5 ) AS sec_add_utc,
  utcl_seconds_between( utclong`2024-02-25 08:14:26`, utclong`2024-02-25 08:15:17` ) AS sec_bw, "51
  tstmp_is_valid( @lv_tmst ) AS ts_valid,              "1
  tstmp_current_utctimestamp( ) AS ts_current,
  tstmp_to_dats( tstmp = @lv_tmst, tzone = CAST( char`EST` AS CHAR( 6 ) ) ) AS to_dats, "20240808
  dats_tims_to_tstmp( date = @lv_da, time = @lv_ti, tzone = CAST( char`EST` AS CHAR( 6 ) ) ) AS to_tstmp
WHERE TimeZoneID = char`EST`
INTO @DATA(ls_result).
```

---

## 10. Calendar-related information

### Factory calendar (released API)

`CL_SCAL_API` is deprecated — use `cl_fhc_calendar_runtime` with the interfaces `if_fhc_fcal_runtime` (factory calendar), `if_fhc_hcal_runtime` (holiday calendar), and `if_fhc_holiday_runtime` (holidays). Create a runtime with `create_factorycalendar_runtime` / `create_holidaycalendar_runtime` / `create_holiday_runtime`; all calls raise `cx_fhc_runtime`.

- **Factory-calendar runtime** (`if_fhc_fcal_runtime`) — working-day checks and date calculations: `is_date_workingday`, `calc_workingdays_between_dates`, `add_workingdays_to_date`, `subtract_workingdays_from_date`, `convert_date_to_factorydate` / `convert_factorydate_to_date`, `get_validity_start` / `get_validity_end`.
- **Holiday-calendar runtime** (`if_fhc_hcal_runtime`): `is_holiday`, `get_holiday`, `calc_holidays_between_dates`.

```abap
TRY.
    DATA(lo_factory_calendar) = cl_fhc_calendar_runtime=>create_factorycalendar_runtime(
                               iv_factorycalendar_id = '<factory calendar ID>' ).
    DATA(lv_date_from_factorydate) = lo_factory_calendar->convert_factorydate_to_date(
                                    iv_factorydate = '123' ).
    "further calls: is_date_workingday, calc_workingdays_between_dates,
    "add_workingdays_to_date, subtract_workingdays_from_date, ...
  CATCH cx_fhc_runtime INTO DATA(lo_calendar_error).
    "exception handling
ENDTRY.
```

The FHC API uses 32-digit calendar IDs (recommended to store); map legacy 2-/3-digit SCAL IDs during a transition with `cl_fhc_calendar_id_mapper=>create_id_mapper( )` + `if_fhc_id_mapper` (`mapping_fcal_legacyid_to_id` etc.). Independent helpers in `cl_scal_utils` (exception `cx_scal`): `date_get_week`, `date_compute_day`, `week_get_first_day`, `month_names_get`.

Also covered in the *Released ABAP Classes* cheat sheet (`22_Released_ABAP_Classes.md`) "Calendar-Related Information" section.

---

## Sources

- ABAP Keyword Doc — Date and Time Processing: https://help.sap.com/doc/abapdocu_cp_index_htm/CLOUD/en-US/index.htm?file=abendate_time_processing.htm
- ABAP Keyword Doc — `utclong_current` / `utclong_add` / `utclong_diff`, `CONVERT UTCLONG`, `CONVERT TIME STAMP`, `GET TIME STAMP`
- XCO Library: https://help.sap.com/docs/btp/sap-business-technology-platform/xco-library?version=Cloud
- Factory Calendar (SAP BTP ABAP Environment, `cl_fhc_calendar_runtime` / `cl_scal_utils`): https://github.com/SAP-docs/btp-cloud-platform/blob/main/docs/30-development/factory-calendar-f7cbd3c.md
- SAP-samples/abap-cheat-sheets — `23_Date_and_Time.md`, `24_Builtin_Functions.md`
