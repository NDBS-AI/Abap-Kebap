# ABAP SQL Hierarchies — Full Syntax Reference

Sourced from SAP-samples/abap-cheat-sheets `10_ABAP_SQL_Hierarchies.md`. ABAP SQL and ABAP CDS wrap the SAP HANA built-in hierarchy functions **without loss of performance** — no AMDP needed. The examples below are for **Standard ABAP** (unrestricted scope) and come from class `CL_DEMO_SQL_HIERARCHIES`.

## Concept

A **SQL hierarchy** is a hierarchical data source usable in the `FROM` clause of ABAP SQL: a tabular set of rows (the hierarchy nodes) plus **hierarchy columns** carrying hierarchy-specific information per row.

To create a SQL hierarchy you need:
- **Data source** — any ABAP SQL data source (DB table, CDS view, or CTE) whose structure can represent hierarchical data.
- **Parent-child relation** — defined by a *self-association* (the **hierarchy association**) via a CDS association or CTE association. A data source exposing it is a **hierarchy source**.
- **Hierarchy creation** — either a CDS `define hierarchy` (outside the program) or the ABAP SQL `HIERARCHY` generator (inside the program).

## 1. The hierarchy source (self-association)

A CDS view exposing a self-association whose `ON` condition defines the parent-child relation:

```sql
@AccessControl.authorizationCheck: #NOT_REQUIRED
define view entity DEMO_CDS_SIMPLE_TREE_VIEW
  as select from demo_simple_tree
  association [1..1] to DEMO_CDS_SIMPLE_TREE_VIEW as _tree
    on $projection.parent = _tree.id
{
      _tree,
      key id,
      parent_id as parent,
      name
}
```

A row whose `parent` equals another row's `id` is a child of that other row. The `ON` condition can be more complex than shown.

## 2. CDS hierarchy — `define hierarchy`

Outsources the hierarchy creation to a reusable CDS entity (can carry DCL authorization, usable in many programs and other CDS views). The hierarchy source must be a CDS view exposing a hierarchy association.

```sql
define hierarchy DEMO_CDS_SIMPLE_TREE
  with parameters
    p_id : abap.int4
  as parent child hierarchy(
    source
      DEMO_CDS_SIMPLE_TREE_SOURCE
      child to parent association _tree
      start where
        id = :p_id
      siblings order by
        id ascending
    )
    {
      id,
      parent,
      name
    }
```

Most important additions of `DEFINE HIERARCHY`:
- `SOURCE` — the hierarchy source view.
- `CHILD TO PARENT ASSOCIATION` — the hierarchy (self-)association.
- `START WHERE` — defines the **root nodes** of the SQL hierarchy (here via input parameter `p_id`).
- `SIBLINGS ORDER BY` — sort order among sibling nodes (in addition to the parent-child order).
- Element list `{ ... }` — the columns of the SQL hierarchy.

Behavior: all lines satisfying `START WHERE` become the root node set; for each root, descendants satisfying the association `ON` condition are retrieved recursively until none remain. Further additions control multiple parents, orphans, and cycles. The element list may also include **hierarchy attributes** (rank, level, ...), but ABAP SQL adds the hierarchy columns implicitly when the hierarchy is accessed.

### Accessing a CDS hierarchy in ABAP SQL

```abap
DATA lv_root_id type demo_cds_simple_tree_view-id.

SELECT FROM demo_cds_simple_tree( p_id = @lv_root_id )
  FIELDS id,
         parent,
         name,
         hierarchy_rank,
         hierarchy_tree_size,
         hierarchy_parent_rank,
         hierarchy_level,
         hierarchy_is_cycle,
         hierarchy_is_orphan,
         node_id,
         parent_id
  INTO TABLE @FINAL(lt_cds_result).
```

All hierarchy columns can be added to the `SELECT` list even if not in the CDS element list — this is always possible when a SQL hierarchy is accessed in ABAP SQL.

## 3. ABAP SQL hierarchy generator — `HIERARCHY( ... )`

Defines a SQL hierarchy **inside the program** (one program only, like an ABAP SQL join vs a CDS join). Same syntax as `define hierarchy`, same result.

```abap
DATA lv_root_id TYPE demo_cds_simple_tree_view-id.

SELECT FROM HIERARCHY( SOURCE demo_cds_simple_tree_view
                       CHILD TO PARENT ASSOCIATION _tree
                       START WHERE id = @lv_root_id
                       SIBLINGS ORDER BY id
                       MULTIPLE PARENTS NOT ALLOWED ) "hierarchy
       FIELDS id,
              parent,
              name,
              hierarchy_rank,
              hierarchy_tree_size,
              hierarchy_parent_rank,
              hierarchy_level,
              hierarchy_is_cycle,
              hierarchy_is_orphan,
              node_id,
              parent_id
       INTO TABLE @FINAL(lt_asql_cds_result).

ASSERT lt_asql_cds_result = lt_cds_result.
```

`HIERARCHY( ... )` additions:
- `SOURCE` — a data source exposing the hierarchy association (CDS view or CTE).
- `CHILD TO PARENT ASSOCIATION _tree` — the hierarchy association.
- `START WHERE` — root node set.
- `SIBLINGS ORDER BY` — sibling order.
- `MULTIPLE PARENTS NOT ALLOWED` — one of the additions controlling hierarchy creation.

### Hierarchy generator over a CTE source

A CTE can act as the hierarchy source by exposing an association with `WITH ASSOCIATIONS`:

```abap
DATA lv_root_id type demo_cds_simple_tree_view-id.

WITH
  +cte_simple_tree_source AS
     ( SELECT FROM demo_simple_tree
              FIELDS id,
                     parent_id AS parent,
                     name )
        WITH ASSOCIATIONS (
          JOIN TO MANY +cte_simple_tree_source AS _tree
            ON +cte_simple_tree_source~parent = _tree~id )
  SELECT FROM HIERARCHY( SOURCE +cte_simple_tree_source
                         CHILD TO PARENT ASSOCIATION _tree
                         START WHERE id = @lv_root_id
                         SIBLINGS ORDER BY id
                         MULTIPLE PARENTS NOT ALLOWED ) "hierarchy
         FIELDS id, parent, name,
                hierarchy_rank, hierarchy_tree_size, hierarchy_parent_rank,
                hierarchy_level, hierarchy_is_cycle, hierarchy_is_orphan,
                node_id, parent_id
         INTO TABLE @FINAL(lt_asql_cte_result).

ASSERT lt_asql_cte_result = lt_cds_result.
```

## 4. CTE hierarchies — `WITH HIERARCHY`

A CTE producing hierarchical data can declare itself a SQL hierarchy of a freely chosen name with `WITH HIERARCHY`, so subsequent queries of the same `WITH` statement can use it (with implicit hierarchy columns or in navigators). A CTE exposed as a SQL hierarchy must itself access a SQL hierarchy — ultimately based on a CDS hierarchy or the `HIERARCHY` generator.

```abap
WITH
  +tree AS
    ( SELECT FROM demo_cds_simple_tree( p_id = @lv_root_id )
             FIELDS * )
      WITH HIERARCHY demo_cds_simple_tree
  SELECT FROM +tree "hierarchy
         FIELDS id, parent, name,
                hierarchy_rank, hierarchy_tree_size, hierarchy_parent_rank,
                hierarchy_level, hierarchy_is_cycle, hierarchy_is_orphan,
                node_id, parent_id
         INTO TABLE @FINAL(lt_cte_cds_result).
```

The CTE source can equally be the `HIERARCHY` generator over a CDS view or over another CTE (`WITH HIERARCHY asql_hierarchy` / `WITH HIERARCHY cte_hierarchy`). All forms yield the same result.

## 5. Hierarchy columns

Available implicitly whenever a SQL hierarchy is accessed:

| Column | Meaning |
|---|---|
| `hierarchy_rank` | Position of the node in the pre-order traversal |
| `hierarchy_tree_size` | Number of nodes in the node's subtree (incl. itself) |
| `hierarchy_parent_rank` | Rank of the node's parent (siblings share this value) |
| `hierarchy_level` | Depth level of the node |
| `hierarchy_is_cycle` | Whether the node starts a cycle |
| `hierarchy_is_orphan` | Whether the node is an orphan |
| `node_id` | Generated node identifier |
| `parent_id` | Generated parent identifier |

Navigators add further columns: `hierarchy_distance` (descendants/ancestors), `hierarchy_sibling_distance` (siblings), `hierarchy_aggregate_type` (aggregate navigators).

## 6. Hierarchy navigators

Hierarchy navigators are hierarchy functions that work on an **existing** SQL hierarchy (created via CDS hierarchy, the generator, or a CTE hierarchy) instead of creating one. If you need a hierarchy multiple times, create it once with a given root set and access it repeatedly with navigators — best for performance. Each navigator can add further hierarchy columns.

### HIERARCHY_DESCENDANTS

Fetches all descendants of the start node(s). Adds `HIERARCHY_DISTANCE` (positive). Optional `DISTANCE` parameter restricts the distance to the start node.

```abap
DATA lv_root_id TYPE demo_cds_simple_tree_view-id.
DATA lv_sub_id  TYPE demo_cds_simple_tree_view-id.

SELECT FROM HIERARCHY_DESCENDANTS(
              SOURCE demo_cds_simple_tree( p_id = @lv_root_id )
              START WHERE id = @lv_sub_id  )
  FIELDS id,
         parent_id,
         name,
         hierarchy_distance
  INTO TABLE @FINAL(lt_descendants).
```

### HIERARCHY_ANCESTORS

Returns the ancestors of a given node. `HIERARCHY_DISTANCE` is **negative**.

```abap
DATA lv_root_id TYPE demo_cds_simple_tree_view-id.
DATA lv_max_id  TYPE demo_cds_simple_tree_view-id.

SELECT FROM HIERARCHY_ANCESTORS(
              SOURCE demo_cds_simple_tree( p_id = @lv_root_id )
              START WHERE id = @lv_max_id )
  FIELDS id,
          parent_id,
          name,
          hierarchy_distance
  INTO TABLE @FINAL(lt_ancestors).
```

### HIERARCHY_SIBLINGS

Returns siblings (nodes sharing a parent — same `HIERARCHY_PARENT_RANK`). Adds `HIERARCHY_SIBLING_DISTANCE`.

```abap
DATA lv_root_id TYPE demo_cds_simple_tree_view-id.
DATA lv_sibl_id TYPE demo_cds_simple_tree_view-id.

SELECT FROM HIERARCHY_SIBLINGS(
              SOURCE demo_cds_simple_tree( p_id = @lv_root_id )
              START WHERE id = @lv_sibl_id )
  FIELDS id,
          parent_id,
          name,
          hierarchy_sibling_distance
  INTO TABLE @FINAL(lt_siblings).
```

### Hierarchy aggregate navigators

Apply aggregate functions to descendants/ancestors of a node:
- `HIERARCHY_DESCENDANTS_AGGREGATE`
- `HIERARCHY_ANCESTORS_AGGREGATE`

```abap
TYPES:
  BEGIN OF ty_value,
    id     TYPE i,
    amount TYPE p LENGTH 16 DECIMALS 2,
  END OF ty_value.

DATA lt_value_tab TYPE SORTED TABLE OF ty_value WITH UNIQUE KEY id.
DATA lv_root_id   TYPE demo_cds_simple_tree_view-id.
DATA lv_sub_id    TYPE demo_cds_simple_tree_view-id.

SELECT FROM HIERARCHY_DESCENDANTS_AGGREGATE(
              SOURCE demo_cds_simple_tree( p_id = @lv_sub_id  ) AS h
              JOIN @lt_value_tab AS v
                ON  v~id = h~id
              MEASURES SUM( v~amount ) AS amount_sum
              WHERE hierarchy_rank > 1
              WITH SUBTOTAL
              WITH BALANCE )
  FIELDS id,
         amount_sum,
         hierarchy_rank,
         hierarchy_aggregate_type
  INTO TABLE @FINAL(lt_descendants_aggregate).
```

- `MEASURES SUM( v~amount ) AS amount_sum` — the aggregate over each node's descendants.
- `WHERE` — restricts the result set with a freely programmable condition.
- `WITH SUBTOTAL` — adds a row where `HIERARCHY_AGGREGATE_TYPE = 1`: sum of all nodes meeting the `WHERE` condition.
- `WITH BALANCE` — adds a row where `HIERARCHY_AGGREGATE_TYPE = 2`: sum of all nodes **not** meeting the `WHERE` condition.

This also demonstrates joining a SQL hierarchy to an internal table (`@value_tab`) and using internal tables as ABAP SQL data sources — administrative parent-child data in one source, real values in another.

## Sources

- SELECT, FROM hierarchy_data (reference): https://help.sap.com/doc/abapdocu_cp_index_htm/CLOUD/en-US/index.htm?file=abenselect_hierarchy_data.htm
- DEFINE HIERARCHY: https://help.sap.com/doc/abapdocu_cp_index_htm/CLOUD/en-US/index.htm?file=abencds_f1_define_hierarchy.htm
- SELECT, FROM HIERARCHY (generator): https://help.sap.com/doc/abapdocu_cp_index_htm/CLOUD/en-US/index.htm?file=abenselect_hierarchy_generator.htm
- Hierarchy navigators: https://help.sap.com/doc/abapdocu_cp_index_htm/CLOUD/en-US/index.htm?file=abenselect_hierarchy_navigators.htm
- SAP-samples/abap-cheat-sheets — `10_ABAP_SQL_Hierarchies.md`: https://github.com/SAP-samples/abap-cheat-sheets
