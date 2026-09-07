# ABAP Naming Conventions

The naming convention the ABAP Kebap agents follow. It uses the classic
Hungarian-notation scheme SAP developers expect: a **scope prefix** + a **type
letter** + a descriptive name. This reference is the authoritative naming standard —
the `abap-clean-style` skill and all three agents defer to it over Clean ABAP's default
(prefix-free) naming.

> **Overriding this default:** a project may ship its own naming convention as a
> naming section in its `CLAUDE.md` / `AGENTS.md`; the project copy wins for work
> inside that project.
>
> **Scope of application:** apply to new code by default. Existing/legacy code gets
> minimum-invasive changes only — do not rename identifiers in code you are not
> otherwise touching.

---

## 1. Pattern

```
<scope><type>_<meaningful_name>
```

- `<scope>` — where the data lives / how it flows (member, local, parameter).
- `<type>` — the shape of the data (variable, structure, table, object, …).
- `<meaningful_name>` — lowercase, `snake_case`, business-meaningful.

Example: `mt_items`, `lv_count`, `iv_key`, `rt_messages`.

---

## 2. Scope prefix

| Scope | Prefix | Meaning |
|-------|--------|---------|
| Member (instance/static attribute) | `m` | `DATA` / `CLASS-DATA` in a class |
| Local (inside a method/form) | `l` | declared locally in a routine |
| IMPORTING parameter | `i` | passed **into** a method |
| EXPORTING parameter | `e` | passed **out** of a method |
| CHANGING parameter | `c` | passed in **and** back |
| RETURNING parameter | `r` | the single functional-call result |
| Global (report/program) | `g` | top-level program data (legacy reports) |
| Field symbol | `f` | a `FIELD-SYMBOLS` / `ASSIGN` target (always in `<...>`) |

---

## 3. Type letter

| Type letter | Data shape | Example |
|-------------|------------|---------|
| `v` | elementary **value** (scalar: `i`, `p`, `string`, `dats`, char, flag, …) | `lv_count`, `iv_key` |
| `s` | **structure** (work area / flat or deep struct) | `ls_line`, `is_data` |
| `t` | internal **table** | `lt_items`, `rt_messages` |
| `o` | **object** reference (`TYPE REF TO <class>`) | `lo_handler`, `mo_service` |
| `r` | **data / generic** reference (`TYPE REF TO data`) | `lr_line` |

> `r` as a **type letter** (data reference) is distinct from `r` as a
> **scope prefix** (returning). Context disambiguates: a returning object ref is
> `ro_...`, a returning table is `rt_...`, a returning scalar is `rv_...`.

> **No bare `result` exception.** `RETURNING VALUE(result)` is common ABAP idiom
> elsewhere, but it does **not** get a pass here — a `RETURNING` parameter follows the
> grid like any other: `rv_result`, `rs_result`, `rt_result`, `ro_result` (or a more
> specific business name with the same prefix, e.g. `rv_total`, `rt_invoices`).
>
> **RAP handler signatures are a separate case.** The conventional bare names in RAP
> behavior-pool handler methods (`keys`, `entities`, `failed`, `reported`, `mapped`,
> `requested_authorizations`, and the `RESULT result` of action/read/authorization
> handlers) are SAP's own near-universal convention for parameters the framework
> populates by contract, not ordinary method locals — leave them as found rather than
> applying the grid, since it is not established whether the framework binds these by
> declared name.

---

## 4. Combined prefixes (the full grid)

| | value (`v`) | structure (`s`) | table (`t`) | object ref (`o`) |
|--------------------|-------------|-----------------|-------------|------------------|
| **member** (`m`)   | `mv_`       | `ms_`           | `mt_`       | `mo_`            |
| **local** (`l`)    | `lv_`       | `ls_`           | `lt_`       | `lo_`            |
| **importing** (`i`)| `iv_`       | `is_`           | `it_`       | `io_`            |
| **exporting** (`e`)| `ev_`       | `es_`           | `et_`       | `eo_`            |
| **changing** (`c`) | `cv_`       | `cs_`           | `ct_`       | `co_`            |
| **returning** (`r`)| `rv_`       | `rs_`           | `rt_`       | `ro_`            |
| **field symbol** (`f`, in `<...>`) | `<fv_...>` | `<fs_...>` | `<ft_...>` | — |

---

## 5. Field symbols

Field symbols are always written in angle brackets and take the `f` scope prefix plus
the type letter of what they point at:

| Points at | Name | Example |
|-----------|------|---------|
| a value (scalar) | `<fv_...>` | `<fv_amount>` |
| a structure | `<fs_...>` | `<fs_line>` |
| an internal table | `<ft_...>` | `<ft_items>` |

---

## 6. What does **not** get the scope+type grid

These keep their own conventions:

| Item | Convention | Example |
|------|------------|---------|
| Local type definitions | `ty_` | `ty_line`, `ty_key` |
| Local table-type definitions | `tt_` | `tt_line`, `tt_item` |
| Structure **components** | plain business name | `ty_line-key` |
| Constants | `c_` | `c_status_completed` |
| Class names (customer) | single `Z`/`Y` + `_cl_` | `z<area>_cl_<purpose>` |
| Interface names | single `Z`/`Y` + `_if_` | `z<area>_if_<purpose>` |
| CDS interface / basic view | single `Z`/`Y` + `_i_` | `z<area>_i_<entity>` |
| CDS projection / consumption view | single `Z`/`Y` + `_c_` | `z<area>_c_<entity>` |
| Function module | single `Z`/`Y` + `_f_` | `z<area>_f_<purpose>` |
| Function group | single `Z`/`Y` + `_fg_` | `z<area>_fg_<purpose>` |
| Report / program | single `Z`/`Y` + `_r_` | `z<area>_r_<purpose>` |
| Domain (DDIC) | single `Z`/`Y` + `_do_` | `z<area>_do_<purpose>` |
| Data element (DDIC) | single `Z`/`Y` + `_de_` | `z<area>_de_<purpose>` |
| Structure (DDIC) | single `Z`/`Y` + `_s_` | `z<area>_s_<purpose>` |
| Database table (DDIC) | single `Z`/`Y` + `_t_` | `z<area>_t_<purpose>` |
| Table type (DDIC) | single `Z`/`Y` + `_tt_` | `z<area>_tt_<purpose>` |

> Customer objects use **one** leading `Z`/`Y`. A doubled `ZZ…`/`YY…` name is
> always a generator misfire — never a target.

### Object types not listed above

If you need to create a repository object whose type is **not** in the table above
(e.g. a message class, lock object, number range, enhancement spot, transformation,
search help, transaction code, …), do **not** invent a name silently:

1. Propose a name that follows the same shape — single `Z`/`Y`, a short area token,
   a two/three-letter type marker for the object, then a meaningful `snake_case`
   purpose (e.g. a message class → `z<area>_msg_<purpose>`, a lock object →
   `z<area>_e_<entity>`).
2. **Ask the user to confirm or adjust** that name before creating the object.
3. Once confirmed, reuse that decision consistently for the rest of the task.

---

## 7. Quick decision guide

1. **Field symbol?** → `<f` + type letter + name `>`: `<fv_>` value, `<fs_>` struct,
   `<ft_>` table.
2. **Where does it live?** member → `m`, local → `l`, parameter → `i`/`e`/`c`/`r`.
3. **What shape is it?** scalar → `v`, struct → `s`, table → `t`, object ref → `o`.
4. Concatenate + `_` + a lowercase, meaningful `snake_case` name.
5. If it's a type def, constant, structure component, class/interface, or CDS view →
   use the exceptions in §6 instead.

---

## References

- SAP Clean ABAP — Names:
  <https://github.com/SAP/styleguides/blob/main/clean-abap/CleanABAP.md#names>
- ABAP Keyword Documentation — data objects and parameters:
  <https://help.sap.com/doc/abapdocu_latest_index_htm/latest/en-US/index.htm>
