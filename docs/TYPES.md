# Types (UDT)

A **type** is a class for data. It defines what one kind of thing has (a
Motor has Speed, Setpoint, Label …) and where each value comes from. You
declare the type once, then make as many **instances** as you need (M101 …
M150). Any screen, faceplate template or Logic flow can use an instance by
name. Change the type, and every instance follows.

## 1. A type

Types tab → **+ Type**.

| Part | What |
| --- | --- |
| **Parameters** | What differs per instance, e.g. `Group`, `Node`, `Device`. Built in: `{InstanceName}`, `{ParentInstanceName}`. |
| **Members** | name · data type (number / boolean / string / object / array / color, or **another type**) · default · unit · access (read or read / write) · **tag**. |

- **A member with a tag** takes its value live from that tag. The tag
  address uses the parameters:
  `{sparkplug:{Group}::{Node}::{Device}::Speed}`.
- **A member without a tag** is a value: the default, or the instance's own
  override.
- **A member whose data type is another type** nests it (a Pump has a
  `motor: Motor`). The nested instance gets the parent's parameters, and
  its member name as `{InstanceName}`.

## 2. Instances

An instance is a **variable** whose type is the type. It has everything a
variable has: scope, Set / Get / On Variable Change, and binding.

| Where | How |
| --- | --- |
| **App** (every screen) | Types tab → *Instances*: a name, plus a value per parameter. |
| Screen / group / frame | Its Variables list: choose the type as the variable's type, and write the parameters as `Device=M101, Group=G1`. |

## 3. Using an instance

| Where | Example |
| --- | --- |
| Any prop (⛓ Variable / Expression) | `{M101.Speed}`, `M101: {M101.Speed} rpm`, `{P1.motor.Running}` |
| The binding picker | lists `M101` and all its members |
| A faceplate template | a param `motor`; pass `{M101}` in the instance's paramValues. Inside, bind `{motor.Speed}`, `{motor.Label}`. The same template serves every Motor. |
| A write (field / button / knob) | Write Tag `{M101.Setpoint}`. |

- **Live updates:** a member with a tag behaves exactly like that tag
  (`{M101.Speed}` becomes `{sparkplug:G1::E1::M101::Speed}`), including
  inside an expression.
- **Writes:** only a **read / write** member takes one.
  - A member with a tag writes that tag.
  - A value member is set on the instance, so everything bound to it
    updates and watchers fire.
  - A read-only member refuses the write.

## 4. How it works

- **Model:** `src/model/types.js`. `buildInstance()` turns a type plus
  parameters into a plain object. A member with a tag holds a `BindingRef`
  (the tag text with the parameters filled in). The renderers treat a
  `BindingRef` as that binding, so it resolves, updates live and writes like
  the tag itself.
- **Storage:** types live on the project config node (`types`) and reach the
  page with the app variables (`window.__NEXA_APP__`).

**Coming later:** type inheritance (a child type extends a parent), per-member
alarms / history, expression members (Status from Running and Fault), and
checking that a template param only accepts instances of one type.

Tests:

| Test | Covers |
| --- | --- |
| `test/mock-udt.js` | the deployed page |
| `test/model-tree.test.js` | the model |
