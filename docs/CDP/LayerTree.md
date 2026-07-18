# LayerTree

`🧪 Experimental`

* **Source**: Browser Protocol (Chromium)
* **Dependencies**: [DOM](DOM.md)

---

## Navigation

* [Types](#types)
* [Commands](#commands)
* [Events](#events)

[← Back to Index](README.md)

---

<a name="types"></a>
## Types

### <a name="layerid"></a>LayerId

Unique Layer identifier.

* **Type**: `string`

### <a name="snapshotid"></a>SnapshotId

Unique snapshot identifier.

* **Type**: `string`

### <a name="scrollrect"></a>ScrollRect

Rectangle where scrolling happens on the main thread.

* **Type**: `object`
* **Properties**:

| Name | Type | Description |
| --- | --- | --- |
| `rect` | [DOM.Rect](DOM.md#rect) | Rectangle itself. |
| `type` | `string` | Reason for rectangle to force scrolling on the main thread<br/>Allowed values: `"RepaintsOnScroll"`, `"TouchEventHandler"`, `"WheelEventHandler"` |


### <a name="stickypositionconstraint"></a>StickyPositionConstraint

Sticky position constraints.

* **Type**: `object`
* **Properties**:

| Name | Type | Description |
| --- | --- | --- |
| `stickyBoxRect` | [DOM.Rect](DOM.md#rect) | Layout rectangle of the sticky element before being shifted |
| `containingBlockRect` | [DOM.Rect](DOM.md#rect) | Layout rectangle of the containing block of the sticky element |
| `nearestLayerShiftingStickyBox`<br/>_optional_ | [LayerId](#layerid) | The nearest sticky layer that shifts the sticky box |
| `nearestLayerShiftingContainingBlock`<br/>_optional_ | [LayerId](#layerid) | The nearest sticky layer that shifts the containing block |


### <a name="picturetile"></a>PictureTile

Serialized fragment of layer picture along with its offset within the layer.

* **Type**: `object`
* **Properties**:

| Name | Type | Description |
| --- | --- | --- |
| `x` | `number` | Offset from owning layer left boundary |
| `y` | `number` | Offset from owning layer top boundary |
| `picture` | `string` | Base64-encoded snapshot data. (Encoded as a base64 string when passed over JSON) |


### <a name="layer"></a>Layer

Information about a compositing layer.

* **Type**: `object`
* **Properties**:

| Name | Type | Description |
| --- | --- | --- |
| `layerId` | [LayerId](#layerid) | The unique id for this layer. |
| `parentLayerId`<br/>_optional_ | [LayerId](#layerid) | The id of parent (not present for root). |
| `backendNodeId`<br/>_optional_ | [DOM.BackendNodeId](DOM.md#backendnodeid) | The backend id for the node associated with this layer. |
| `offsetX` | `number` | Offset from parent layer, X coordinate. |
| `offsetY` | `number` | Offset from parent layer, Y coordinate. |
| `width` | `number` | Layer width. |
| `height` | `number` | Layer height. |
| `transform`<br/>_optional_ | array of `number` | Transformation matrix for layer, default is identity matrix |
| `anchorX`<br/>_optional_ | `number` | Transform anchor point X, absent if no transform specified |
| `anchorY`<br/>_optional_ | `number` | Transform anchor point Y, absent if no transform specified |
| `anchorZ`<br/>_optional_ | `number` | Transform anchor point Z, absent if no transform specified |
| `paintCount` | `integer` | Indicates how many time this layer has painted. |
| `drawsContent` | `boolean` | Indicates whether this layer hosts any content, rather than being used for<br/>transform/scrolling purposes only. |
| `invisible`<br/>_optional_ | `boolean` | Set if layer is not visible. |
| `scrollRects`<br/>_optional_ | array of [ScrollRect](#scrollrect) | Rectangles scrolling on main thread only. |
| `stickyPositionConstraint`<br/>_optional_ | [StickyPositionConstraint](#stickypositionconstraint) | Sticky position constraint information |


### <a name="paintprofile"></a>PaintProfile

Array of timings, one per paint step.

* **Type**: `array`

---

<a name="commands"></a>
## Commands

### <a name="compositingreasons"></a>compositingReasons

Provides the reasons why the given layer was composited.

* **Parameters**:

| Name | Type | Description |
| --- | --- | --- |
| `layerId` | [LayerId](#layerid) | The id of the layer for which we want to get the reasons it was composited. |

* **Returns**:

| Name | Type | Description |
| --- | --- | --- |
| `compositingReasons` | array of `string` | A list of strings specifying reasons for the given layer to become composited. |
| `compositingReasonIds` | array of `string` | A list of strings specifying reason IDs for the given layer to become composited. |


### <a name="disable"></a>disable

Disables compositing tree inspection.

* **Parameters**: None

* **Returns**: None


### <a name="enable"></a>enable

Enables compositing tree inspection.

* **Parameters**: None

* **Returns**: None


### <a name="loadsnapshot"></a>loadSnapshot

Returns the snapshot identifier.

* **Parameters**:

| Name | Type | Description |
| --- | --- | --- |
| `tiles` | array of [PictureTile](#picturetile) | An array of tiles composing the snapshot. |

* **Returns**:

| Name | Type | Description |
| --- | --- | --- |
| `snapshotId` | [SnapshotId](#snapshotid) | The id of the snapshot. |


### <a name="makesnapshot"></a>makeSnapshot

Returns the layer snapshot identifier.

* **Parameters**:

| Name | Type | Description |
| --- | --- | --- |
| `layerId` | [LayerId](#layerid) | The id of the layer. |

* **Returns**:

| Name | Type | Description |
| --- | --- | --- |
| `snapshotId` | [SnapshotId](#snapshotid) | The id of the layer snapshot. |


### <a name="profilesnapshot"></a>profileSnapshot

* **Parameters**:

| Name | Type | Description |
| --- | --- | --- |
| `snapshotId` | [SnapshotId](#snapshotid) | The id of the layer snapshot. |
| `minRepeatCount`<br/>_optional_ | `integer` | The maximum number of times to replay the snapshot (1, if not specified). |
| `minDuration`<br/>_optional_ | `number` | The minimum duration (in seconds) to replay the snapshot. |
| `clipRect`<br/>_optional_ | [DOM.Rect](DOM.md#rect) | The clip rectangle to apply when replaying the snapshot. |

* **Returns**:

| Name | Type | Description |
| --- | --- | --- |
| `timings` | array of [PaintProfile](#paintprofile) | The array of paint profiles, one per run. |


### <a name="releasesnapshot"></a>releaseSnapshot

Releases layer snapshot captured by the back-end.

* **Parameters**:

| Name | Type | Description |
| --- | --- | --- |
| `snapshotId` | [SnapshotId](#snapshotid) | The id of the layer snapshot. |

* **Returns**: None


### <a name="replaysnapshot"></a>replaySnapshot

Replays the layer snapshot and returns the resulting bitmap.

* **Parameters**:

| Name | Type | Description |
| --- | --- | --- |
| `snapshotId` | [SnapshotId](#snapshotid) | The id of the layer snapshot. |
| `fromStep`<br/>_optional_ | `integer` | The first step to replay from (replay from the very start if not specified). |
| `toStep`<br/>_optional_ | `integer` | The last step to replay to (replay till the end if not specified). |
| `scale`<br/>_optional_ | `number` | The scale to apply while replaying (defaults to 1). |

* **Returns**:

| Name | Type | Description |
| --- | --- | --- |
| `dataURL` | `string` | A data: URL for resulting image. |


### <a name="snapshotcommandlog"></a>snapshotCommandLog

Replays the layer snapshot and returns canvas log.

* **Parameters**:

| Name | Type | Description |
| --- | --- | --- |
| `snapshotId` | [SnapshotId](#snapshotid) | The id of the layer snapshot. |

* **Returns**:

| Name | Type | Description |
| --- | --- | --- |
| `commandLog` | array of `object` | The array of canvas function calls. |


---

<a name="events"></a>
## Events

### <a name="layerpainted"></a>layerPainted

* **Parameters**:

| Name | Type | Description |
| --- | --- | --- |
| `layerId` | [LayerId](#layerid) | The id of the painted layer. |
| `clip` | [DOM.Rect](DOM.md#rect) | Clip rectangle. |


### <a name="layertreedidchange"></a>layerTreeDidChange

* **Parameters**:

| Name | Type | Description |
| --- | --- | --- |
| `layers`<br/>_optional_ | array of [Layer](#layer) | Layer tree, absent if not in the compositing mode. |


