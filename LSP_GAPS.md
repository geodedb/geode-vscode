# LSP Semantic Analysis Gaps

This document tracks gaps in the GQL/Geode LSP semantic analyzer implementation.

## Critical Gaps

### 1. Case Sensitivity Mismatch

**Status**: FIXED
**Issue**: Node pattern names are stored as raw lexemes (preserving original case), but identifiers in expressions use IdentRepr with both `orig` and `cnf` (uppercase canonical form). The lookup logic was inconsistent.
**Fix**: Store all bindings in canonical (uppercase) form and look up using canonical form.

### 2. No Position Information in Errors

**Status**: FIXED
**Issue**: All semantic errors were reported at line 0, column 0 because the AST expressions don't carry source position information.
**Fix**: The AST would need position tracking added. For now, we report at line 0 which the editor will show as a file-level diagnostic.

### 3. RETURN Alias Tracking for Chained Queries

**Status**: FIXED
**Issue**: After `RETURN x AS y`, the alias `y` should be available in subsequent chained queries (`RETURN ... RETURN ...`), but wasn't tracked.
**Fix**: Add RETURN aliases to scope before processing next_query.

### 4. ListComprehension Variable Binding

**Status**: FIXED
**Issue**: In `[x IN list WHERE x > 0 | x.name]`, the variable `x` must be bound in scope when analyzing filter and map expressions.
**Fix**: Create a temporary scope with the comprehension variable when analyzing filter/map.

### 5. Nested Pattern Analysis

**Status**: FIXED
**Issue**: EXISTS, ShortestPath, PatternCount, and PatternComp expressions contain inner patterns that weren't analyzed.
**Fix**: Recursively analyze patterns in these expressions.

## Medium Priority Gaps

### 6. Missing Statement Types

**Status**: FIXED
**Issue**: DELETE, INSERT, SET, REMOVE, CALL statements weren't fully analyzed.
**Fix**: Added handlers for all statement types.

### 7. CALL YIELD Bindings

**Status**: FIXED
**Issue**: `CALL procedure() YIELD x, y` should make `x` and `y` available in scope.
**Fix**: Added yield binding collection.

### 8. Map Properties Not Analyzed

**Status**: FIXED
**Issue**: Properties in node patterns like `(n:Person {name: x})` where `x` is a variable weren't checked.
**Fix**: Added property value expression analysis.

### 9. count(*) Special Syntax

**Status**: FIXED
**Issue**: `count(*)` is parsed with `*` as a special identifier, but was flagged as undefined variable.
**Fix**: Skip checking `*` identifier since it's special syntax for aggregate functions.

## Low Priority / Future Improvements

### 10. Source Position Tracking in AST

**Status**: FIXED (partial)
**Issue**: Full position tracking requires AST changes to store token positions.
**Fix**: Added `findIdentifierPosition` to Document which searches for the undefined variable in the document text. Errors now highlight the actual identifier location instead of line 0, column 0. Note: This finds the first occurrence, which may not always be the exact usage location, but is a significant improvement.

- Skips comments (-- single-line, // single-line, /**/ multi-line)
- Skips string literals (single and double quoted)

### 11. Type Checking

**Status**: FIXED
**Issue**: No type checking (e.g., ensuring arithmetic operators get numbers).
**Fix**: Added basic type inference for literals and type checking for operators:

- Boolean operators (AND, OR, XOR, NOT) require boolean operands
- Arithmetic operators (+, -, *, /, %, ^) require numeric operands
- Unary negation requires numeric operand
- String literals with arithmetic operators (except +) are flagged
- Regex match operators require string operand
- Unknown types (variables, function calls) are not flagged to avoid false positives
- NULL type is allowed in all operators (three-valued logic: NULL propagates)

### 12. Label/Type Validation

**Status**: FIXED (partial)
**Issue**: No validation that labels or relationship types exist in schema.
**Fix**: Without schema access, full validation is not possible. However, implemented typo detection within documents:

- Tracks all labels and relationship types used in patterns
- Uses Levenshtein distance to detect similar labels (edit distance 1-2)
- Labels used only once that are similar to labels used multiple times are flagged as potential typos
- Example: If you use `:Person` twice and `:Persn` once, warns about possible typo
- Skips numeric suffix variants (Person1, Person2 not flagged as typos of Person)

## Implementation Notes

The semantic analyzer follows this order for Query analysis:

1. LET bindings (pre-MATCH)
2. MATCH pattern bindings (nodes, relationships, paths)
3. Inline LET bindings (post-MATCH)
4. CREATE pattern bindings (if present)
5. WHERE clause verification
6. FILTER clause verification
7. SET clause verification
8. REMOVE clause verification
9. DELETE items verification (for MATCH ... DELETE n queries)
10. WITH clause: verify expressions, then create new scope with WITH items
11. GROUP BY verification
12. HAVING verification
13. RETURN clause verification and alias binding
14. ORDER BY verification
15. Chained query recursion
