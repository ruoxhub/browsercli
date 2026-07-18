# Overlay

`🧪 Experimental`

This domain provides various functionality related to drawing atop the inspected page.

* **Source**: Browser Protocol (Chromium)
* **Dependencies**: [DOM](DOM.md), [Page](Page.md), [Runtime](Runtime.md)

---

## Navigation

* [Types](#types)
* [Commands](#commands)
* [Events](#events)

[← Back to Index](README.md)

---

<a name="types"></a>
## Types

### <a name="sourceorderconfig"></a>SourceOrderConfig

Configuration data for drawing the source order of an elements children.

* **Type**: `object`
* **Properties**:

| Name | Type | Description |
| --- | --- | --- |
| `parentOutlineColor` | [DOM.RGBA](DOM.md#rgba) | the color to outline the given element in. |
| `childOutlineColor` | [DOM.RGBA](DOM.md#rgba) | the color to outline the child elements in. |


### <a name="gridhighlightconfig"></a>GridHighlightConfig

Configuration data for the highlighting of Grid elements.

* **Type**: `object`
* **Properties**:

| Name | Type | Description |
| --- | --- | --- |
| `showGridExtensionLines`<br/>_optional_ | `boolean` | Whether the extension lines from grid cells to the rulers should be shown (default: false). |
| `showPositiveLineNumbers`<br/>_optional_ | `boolean` | Show Positive line number labels (default: false). |
| `showNegativeLineNumbers`<br/>_optional_ | `boolean` | Show Negative line number labels (default: false). |
| `showAreaNames`<br/>_optional_ | `boolean` | Show area name labels (default: false). |
| `showLineNames`<br/>_optional_ | `boolean` | Show line name labels (default: false). |
| `showTrackSizes`<br/>_optional_ | `boolean` | Show track size labels (default: false). |
| `gridBorderColor`<br/>_optional_ | [DOM.RGBA](DOM.md#rgba) | The grid container border highlight color (default: transparent). |
| `cellBorderColor`<br/>_optional_ | [DOM.RGBA](DOM.md#rgba) | `⚠️ deprecated` The cell border color (default: transparent). Deprecated, please use rowLineColor and columnLineColor instead. |
| `rowLineColor`<br/>_optional_ | [DOM.RGBA](DOM.md#rgba) | The row line color (default: transparent). |
| `columnLineColor`<br/>_optional_ | [DOM.RGBA](DOM.md#rgba) | The column line color (default: transparent). |
| `gridBorderDash`<br/>_optional_ | `boolean` | Whether the grid border is dashed (default: false). |
| `cellBorderDash`<br/>_optional_ | `boolean` | `⚠️ deprecated` Whether the cell border is dashed (default: false). Deprecated, please us rowLineDash and columnLineDash instead. |
| `rowLineDash`<br/>_optional_ | `boolean` | Whether row lines are dashed (default: false). |
| `columnLineDash`<br/>_optional_ | `boolean` | Whether column lines are dashed (default: false). |
| `rowGapColor`<br/>_optional_ | [DOM.RGBA](DOM.md#rgba) | The row gap highlight fill color (default: transparent). |
| `rowHatchColor`<br/>_optional_ | [DOM.RGBA](DOM.md#rgba) | The row gap hatching fill color (default: transparent). |
| `columnGapColor`<br/>_optional_ | [DOM.RGBA](DOM.md#rgba) | The column gap highlight fill color (default: transparent). |
| `columnHatchColor`<br/>_optional_ | [DOM.RGBA](DOM.md#rgba) | The column gap hatching fill color (default: transparent). |
| `areaBorderColor`<br/>_optional_ | [DOM.RGBA](DOM.md#rgba) | The named grid areas border color (Default: transparent). |
| `gridBackgroundColor`<br/>_optional_ | [DOM.RGBA](DOM.md#rgba) | The grid container background color (Default: transparent). |


### <a name="flexcontainerhighlightconfig"></a>FlexContainerHighlightConfig

Configuration data for the highlighting of Flex container elements.

* **Type**: `object`
* **Properties**:

| Name | Type | Description |
| --- | --- | --- |
| `containerBorder`<br/>_optional_ | [LineStyle](#linestyle) | The style of the container border |
| `lineSeparator`<br/>_optional_ | [LineStyle](#linestyle) | The style of the separator between lines |
| `itemSeparator`<br/>_optional_ | [LineStyle](#linestyle) | The style of the separator between items |
| `mainDistributedSpace`<br/>_optional_ | [BoxStyle](#boxstyle) | Style of content-distribution space on the main axis (justify-content). |
| `crossDistributedSpace`<br/>_optional_ | [BoxStyle](#boxstyle) | Style of content-distribution space on the cross axis (align-content). |
| `rowGapSpace`<br/>_optional_ | [BoxStyle](#boxstyle) | Style of empty space caused by row gaps (gap/row-gap). |
| `columnGapSpace`<br/>_optional_ | [BoxStyle](#boxstyle) | Style of empty space caused by columns gaps (gap/column-gap). |
| `crossAlignment`<br/>_optional_ | [LineStyle](#linestyle) | Style of the self-alignment line (align-items). |


### <a name="flexitemhighlightconfig"></a>FlexItemHighlightConfig

Configuration data for the highlighting of Flex item elements.

* **Type**: `object`
* **Properties**:

| Name | Type | Description |
| --- | --- | --- |
| `baseSizeBox`<br/>_optional_ | [BoxStyle](#boxstyle) | Style of the box representing the item's base size |
| `baseSizeBorder`<br/>_optional_ | [LineStyle](#linestyle) | Style of the border around the box representing the item's base size |
| `flexibilityArrow`<br/>_optional_ | [LineStyle](#linestyle) | Style of the arrow representing if the item grew or shrank |


### <a name="linestyle"></a>LineStyle

Style information for drawing a line.

* **Type**: `object`
* **Properties**:

| Name | Type | Description |
| --- | --- | --- |
| `color`<br/>_optional_ | [DOM.RGBA](DOM.md#rgba) | The color of the line (default: transparent) |
| `pattern`<br/>_optional_ | `string` | The line pattern (default: solid)<br/>Allowed values: `"dashed"`, `"dotted"` |


### <a name="boxstyle"></a>BoxStyle

Style information for drawing a box.

* **Type**: `object`
* **Properties**:

| Name | Type | Description |
| --- | --- | --- |
| `fillColor`<br/>_optional_ | [DOM.RGBA](DOM.md#rgba) | The background color for the box (default: transparent) |
| `hatchColor`<br/>_optional_ | [DOM.RGBA](DOM.md#rgba) | The hatching color for the box (default: transparent) |


### <a name="contrastalgorithm"></a>ContrastAlgorithm

* **Type**: `string`
* **Allowed values**: `"aa"`, `"aaa"`, `"apca"`

### <a name="highlightconfig"></a>HighlightConfig

Configuration data for the highlighting of page elements.

* **Type**: `object`
* **Properties**:

| Name | Type | Description |
| --- | --- | --- |
| `showInfo`<br/>_optional_ | `boolean` | Whether the node info tooltip should be shown (default: false). |
| `showStyles`<br/>_optional_ | `boolean` | Whether the node styles in the tooltip (default: false). |
| `showRulers`<br/>_optional_ | `boolean` | Whether the rulers should be shown (default: false). |
| `showAccessibilityInfo`<br/>_optional_ | `boolean` | Whether the a11y info should be shown (default: true). |
| `showExtensionLines`<br/>_optional_ | `boolean` | Whether the extension lines from node to the rulers should be shown (default: false). |
| `contentColor`<br/>_optional_ | [DOM.RGBA](DOM.md#rgba) | The content box highlight fill color (default: transparent). |
| `paddingColor`<br/>_optional_ | [DOM.RGBA](DOM.md#rgba) | The padding highlight fill color (default: transparent). |
| `borderColor`<br/>_optional_ | [DOM.RGBA](DOM.md#rgba) | The border highlight fill color (default: transparent). |
| `marginColor`<br/>_optional_ | [DOM.RGBA](DOM.md#rgba) | The margin highlight fill color (default: transparent). |
| `eventTargetColor`<br/>_optional_ | [DOM.RGBA](DOM.md#rgba) | The event target element highlight fill color (default: transparent). |
| `shapeColor`<br/>_optional_ | [DOM.RGBA](DOM.md#rgba) | The shape outside fill color (default: transparent). |
| `shapeMarginColor`<br/>_optional_ | [DOM.RGBA](DOM.md#rgba) | The shape margin fill color (default: transparent). |
| `cssGridColor`<br/>_optional_ | [DOM.RGBA](DOM.md#rgba) | The grid layout color (default: transparent). |
| `colorFormat`<br/>_optional_ | [ColorFormat](#colorformat) | The color format used to format color styles (default: hex). |
| `gridHighlightConfig`<br/>_optional_ | [GridHighlightConfig](#gridhighlightconfig) | The grid layout highlight configuration (default: all transparent). |
| `flexContainerHighlightConfig`<br/>_optional_ | [FlexContainerHighlightConfig](#flexcontainerhighlightconfig) | The flex container highlight configuration (default: all transparent). |
| `flexItemHighlightConfig`<br/>_optional_ | [FlexItemHighlightConfig](#flexitemhighlightconfig) | The flex item highlight configuration (default: all transparent). |
| `contrastAlgorithm`<br/>_optional_ | [ContrastAlgorithm](#contrastalgorithm) | The contrast algorithm to use for the contrast ratio (default: aa). |
| `containerQueryContainerHighlightConfig`<br/>_optional_ | [ContainerQueryContainerHighlightConfig](#containerquerycontainerhighlightconfig) | The container query container highlight configuration (default: all transparent). |


### <a name="colorformat"></a>ColorFormat

* **Type**: `string`
* **Allowed values**: `"rgb"`, `"hsl"`, `"hwb"`, `"hex"`

### <a name="gridnodehighlightconfig"></a>GridNodeHighlightConfig

Configurations for Persistent Grid Highlight

* **Type**: `object`
* **Properties**:

| Name | Type | Description |
| --- | --- | --- |
| `gridHighlightConfig` | [GridHighlightConfig](#gridhighlightconfig) | A descriptor for the highlight appearance. |
| `nodeId` | [DOM.NodeId](DOM.md#nodeid) | Identifier of the node to highlight. |


### <a name="flexnodehighlightconfig"></a>FlexNodeHighlightConfig

* **Type**: `object`
* **Properties**:

| Name | Type | Description |
| --- | --- | --- |
| `flexContainerHighlightConfig` | [FlexContainerHighlightConfig](#flexcontainerhighlightconfig) | A descriptor for the highlight appearance of flex containers. |
| `nodeId` | [DOM.NodeId](DOM.md#nodeid) | Identifier of the node to highlight. |


### <a name="scrollsnapcontainerhighlightconfig"></a>ScrollSnapContainerHighlightConfig

* **Type**: `object`
* **Properties**:

| Name | Type | Description |
| --- | --- | --- |
| `snapportBorder`<br/>_optional_ | [LineStyle](#linestyle) | The style of the snapport border (default: transparent) |
| `snapAreaBorder`<br/>_optional_ | [LineStyle](#linestyle) | The style of the snap area border (default: transparent) |
| `scrollMarginColor`<br/>_optional_ | [DOM.RGBA](DOM.md#rgba) | The margin highlight fill color (default: transparent). |
| `scrollPaddingColor`<br/>_optional_ | [DOM.RGBA](DOM.md#rgba) | The padding highlight fill color (default: transparent). |


### <a name="scrollsnaphighlightconfig"></a>ScrollSnapHighlightConfig

* **Type**: `object`
* **Properties**:

| Name | Type | Description |
| --- | --- | --- |
| `scrollSnapContainerHighlightConfig` | [ScrollSnapContainerHighlightConfig](#scrollsnapcontainerhighlightconfig) | A descriptor for the highlight appearance of scroll snap containers. |
| `nodeId` | [DOM.NodeId](DOM.md#nodeid) | Identifier of the node to highlight. |


### <a name="hingeconfig"></a>HingeConfig

Configuration for dual screen hinge

* **Type**: `object`
* **Properties**:

| Name | Type | Description |
| --- | --- | --- |
| `rect` | [DOM.Rect](DOM.md#rect) | A rectangle represent hinge |
| `contentColor`<br/>_optional_ | [DOM.RGBA](DOM.md#rgba) | The content box highlight fill color (default: a dark color). |
| `outlineColor`<br/>_optional_ | [DOM.RGBA](DOM.md#rgba) | The content box highlight outline color (default: transparent). |


### <a name="displaycutoutshape"></a>DisplayCutoutShape

Supported display cutout shapes.

* **Type**: `string`
* **Allowed values**: `"pill"`, `"notch"`, `"circle"`, `"rectangle"`

### <a name="displaycutoutconfig"></a>DisplayCutoutConfig

Configuration for a display cutout.

* **Type**: `object`
* **Properties**:

| Name | Type | Description |
| --- | --- | --- |
| `rect` | [DOM.Rect](DOM.md#rect) | A rectangle representing the cutout bounds. |
| `shape` | [DisplayCutoutShape](#displaycutoutshape) | Shape used to draw the cutout. |
| `borderRadius`<br/>_optional_ | `integer` | Border radius for rounded cutout shapes. |
| `upperRadius`<br/>_optional_ | `integer` | Upper shoulder radius for notch cutout shapes. |
| `lowerRadius`<br/>_optional_ | `integer` | Lower transition radius for notch cutout shapes. |
| `cx`<br/>_optional_ | `integer` | Center x coordinate for circle cutout shapes. |
| `cy`<br/>_optional_ | `integer` | Center y coordinate for circle cutout shapes. |
| `radius`<br/>_optional_ | `integer` | Radius for circle cutout shapes. |
| `contentColor`<br/>_optional_ | [DOM.RGBA](DOM.md#rgba) | The cutout fill color (default: black). |


### <a name="windowcontrolsoverlayconfig"></a>WindowControlsOverlayConfig

Configuration for Window Controls Overlay

* **Type**: `object`
* **Properties**:

| Name | Type | Description |
| --- | --- | --- |
| `showCSS` | `boolean` | Whether the title bar CSS should be shown when emulating the Window Controls Overlay. |
| `selectedPlatform` | `string` | Selected platforms to show the overlay. |
| `themeColor` | `string` | The theme color defined in app manifest. |


### <a name="containerqueryhighlightconfig"></a>ContainerQueryHighlightConfig

* **Type**: `object`
* **Properties**:

| Name | Type | Description |
| --- | --- | --- |
| `containerQueryContainerHighlightConfig` | [ContainerQueryContainerHighlightConfig](#containerquerycontainerhighlightconfig) | A descriptor for the highlight appearance of container query containers. |
| `nodeId` | [DOM.NodeId](DOM.md#nodeid) | Identifier of the container node to highlight. |


### <a name="containerquerycontainerhighlightconfig"></a>ContainerQueryContainerHighlightConfig

* **Type**: `object`
* **Properties**:

| Name | Type | Description |
| --- | --- | --- |
| `containerBorder`<br/>_optional_ | [LineStyle](#linestyle) | The style of the container border. |
| `descendantBorder`<br/>_optional_ | [LineStyle](#linestyle) | The style of the descendants' borders. |


### <a name="isolatedelementhighlightconfig"></a>IsolatedElementHighlightConfig

* **Type**: `object`
* **Properties**:

| Name | Type | Description |
| --- | --- | --- |
| `isolationModeHighlightConfig` | [IsolationModeHighlightConfig](#isolationmodehighlightconfig) | A descriptor for the highlight appearance of an element in isolation mode. |
| `nodeId` | [DOM.NodeId](DOM.md#nodeid) | Identifier of the isolated element to highlight. |


### <a name="isolationmodehighlightconfig"></a>IsolationModeHighlightConfig

* **Type**: `object`
* **Properties**:

| Name | Type | Description |
| --- | --- | --- |
| `resizerColor`<br/>_optional_ | [DOM.RGBA](DOM.md#rgba) | The fill color of the resizers (default: transparent). |
| `resizerHandleColor`<br/>_optional_ | [DOM.RGBA](DOM.md#rgba) | The fill color for resizer handles (default: transparent). |
| `maskColor`<br/>_optional_ | [DOM.RGBA](DOM.md#rgba) | The fill color for the mask covering non-isolated elements (default: transparent). |


### <a name="inspectmode"></a>InspectMode

* **Type**: `string`
* **Allowed values**: `"searchForNode"`, `"searchForUAShadowDOM"`, `"captureAreaScreenshot"`, `"none"`

### <a name="inspectedelementanchorconfig"></a>InspectedElementAnchorConfig

* **Type**: `object`
* **Properties**:

| Name | Type | Description |
| --- | --- | --- |
| `nodeId`<br/>_optional_ | [DOM.NodeId](DOM.md#nodeid) | Identifier of the node to highlight. |
| `backendNodeId`<br/>_optional_ | [DOM.BackendNodeId](DOM.md#backendnodeid) | Identifier of the backend node to highlight. |


---

<a name="commands"></a>
## Commands

### <a name="disable"></a>disable

Disables domain notifications.

* **Parameters**: None

* **Returns**: None


### <a name="enable"></a>enable

Enables domain notifications.

* **Parameters**: None

* **Returns**: None


### <a name="gethighlightobjectfortest"></a>getHighlightObjectForTest

For testing.

* **Parameters**:

| Name | Type | Description |
| --- | --- | --- |
| `nodeId` | [DOM.NodeId](DOM.md#nodeid) | Id of the node to get highlight object for. |
| `includeDistance`<br/>_optional_ | `boolean` | Whether to include distance info. |
| `includeStyle`<br/>_optional_ | `boolean` | Whether to include style info. |
| `colorFormat`<br/>_optional_ | [ColorFormat](#colorformat) | The color format to get config with (default: hex). |
| `showAccessibilityInfo`<br/>_optional_ | `boolean` | Whether to show accessibility info (default: true). |

* **Returns**:

| Name | Type | Description |
| --- | --- | --- |
| `highlight` | `object` | Highlight data for the node. |


### <a name="getgridhighlightobjectsfortest"></a>getGridHighlightObjectsForTest

For Persistent Grid testing.

* **Parameters**:

| Name | Type | Description |
| --- | --- | --- |
| `nodeIds` | array of [DOM.NodeId](DOM.md#nodeid) | Ids of the node to get highlight object for. |

* **Returns**:

| Name | Type | Description |
| --- | --- | --- |
| `highlights` | `object` | Grid Highlight data for the node ids provided. |


### <a name="getsourceorderhighlightobjectfortest"></a>getSourceOrderHighlightObjectForTest

For Source Order Viewer testing.

* **Parameters**:

| Name | Type | Description |
| --- | --- | --- |
| `nodeId` | [DOM.NodeId](DOM.md#nodeid) | Id of the node to highlight. |

* **Returns**:

| Name | Type | Description |
| --- | --- | --- |
| `highlight` | `object` | Source order highlight data for the node id provided. |


### <a name="hidehighlight"></a>hideHighlight

Hides any highlight.

* **Parameters**: None

* **Returns**: None


### <a name="highlightframe"></a>highlightFrame `⚠️ deprecated`

Highlights owner element of the frame with given id.
Deprecated: Doesn't work reliably and cannot be fixed due to process
separation (the owner node might be in a different process). Determine
the owner node in the client and use highlightNode.

* **Parameters**:

| Name | Type | Description |
| --- | --- | --- |
| `frameId` | [Page.FrameId](Page.md#frameid) | Identifier of the frame to highlight. |
| `contentColor`<br/>_optional_ | [DOM.RGBA](DOM.md#rgba) | The content box highlight fill color (default: transparent). |
| `contentOutlineColor`<br/>_optional_ | [DOM.RGBA](DOM.md#rgba) | The content box highlight outline color (default: transparent). |

* **Returns**: None


### <a name="highlightnode"></a>highlightNode

Highlights DOM node with given id or with the given JavaScript object wrapper. Either nodeId or
objectId must be specified.

* **Parameters**:

| Name | Type | Description |
| --- | --- | --- |
| `highlightConfig` | [HighlightConfig](#highlightconfig) | A descriptor for the highlight appearance. |
| `nodeId`<br/>_optional_ | [DOM.NodeId](DOM.md#nodeid) | Identifier of the node to highlight. |
| `backendNodeId`<br/>_optional_ | [DOM.BackendNodeId](DOM.md#backendnodeid) | Identifier of the backend node to highlight. |
| `objectId`<br/>_optional_ | [Runtime.RemoteObjectId](Runtime.md#remoteobjectid) | JavaScript object id of the node to be highlighted. |
| `selector`<br/>_optional_ | `string` | Selectors to highlight relevant nodes. |

* **Returns**: None


### <a name="highlightquad"></a>highlightQuad

Highlights given quad. Coordinates are absolute with respect to the main frame viewport.

* **Parameters**:

| Name | Type | Description |
| --- | --- | --- |
| `quad` | [DOM.Quad](DOM.md#quad) | Quad to highlight |
| `color`<br/>_optional_ | [DOM.RGBA](DOM.md#rgba) | The highlight fill color (default: transparent). |
| `outlineColor`<br/>_optional_ | [DOM.RGBA](DOM.md#rgba) | The highlight outline color (default: transparent). |

* **Returns**: None


### <a name="highlightrect"></a>highlightRect

Highlights given rectangle. Coordinates are absolute with respect to the main frame viewport.
Issue: the method does not handle device pixel ratio (DPR) correctly.
The coordinates currently have to be adjusted by the client
if DPR is not 1 (see crbug.com/437807128).

* **Parameters**:

| Name | Type | Description |
| --- | --- | --- |
| `x` | `integer` | X coordinate |
| `y` | `integer` | Y coordinate |
| `width` | `integer` | Rectangle width |
| `height` | `integer` | Rectangle height |
| `color`<br/>_optional_ | [DOM.RGBA](DOM.md#rgba) | The highlight fill color (default: transparent). |
| `outlineColor`<br/>_optional_ | [DOM.RGBA](DOM.md#rgba) | The highlight outline color (default: transparent). |

* **Returns**: None


### <a name="highlightsourceorder"></a>highlightSourceOrder

Highlights the source order of the children of the DOM node with given id or with the given
JavaScript object wrapper. Either nodeId or objectId must be specified.

* **Parameters**:

| Name | Type | Description |
| --- | --- | --- |
| `sourceOrderConfig` | [SourceOrderConfig](#sourceorderconfig) | A descriptor for the appearance of the overlay drawing. |
| `nodeId`<br/>_optional_ | [DOM.NodeId](DOM.md#nodeid) | Identifier of the node to highlight. |
| `backendNodeId`<br/>_optional_ | [DOM.BackendNodeId](DOM.md#backendnodeid) | Identifier of the backend node to highlight. |
| `objectId`<br/>_optional_ | [Runtime.RemoteObjectId](Runtime.md#remoteobjectid) | JavaScript object id of the node to be highlighted. |

* **Returns**: None


### <a name="setinspectmode"></a>setInspectMode

Enters the 'inspect' mode. In this mode, elements that user is hovering over are highlighted.
Backend then generates 'inspectNodeRequested' event upon element selection.

* **Parameters**:

| Name | Type | Description |
| --- | --- | --- |
| `mode` | [InspectMode](#inspectmode) | Set an inspection mode. |
| `highlightConfig`<br/>_optional_ | [HighlightConfig](#highlightconfig) | A descriptor for the highlight appearance of hovered-over nodes. May be omitted if `enabled<br/>== false`. |

* **Returns**: None


### <a name="setshowadhighlights"></a>setShowAdHighlights

Highlights owner element of all frames detected to be ads.

* **Parameters**:

| Name | Type | Description |
| --- | --- | --- |
| `show` | `boolean` | True for showing ad highlights |

* **Returns**: None


### <a name="setpausedindebuggermessage"></a>setPausedInDebuggerMessage

* **Parameters**:

| Name | Type | Description |
| --- | --- | --- |
| `message`<br/>_optional_ | `string` | The message to display, also triggers resume and step over controls. |

* **Returns**: None


### <a name="setshowdebugborders"></a>setShowDebugBorders

Requests that backend shows debug borders on layers

* **Parameters**:

| Name | Type | Description |
| --- | --- | --- |
| `show` | `boolean` | True for showing debug borders |

* **Returns**: None


### <a name="setshowfpscounter"></a>setShowFPSCounter

Requests that backend shows the FPS counter

* **Parameters**:

| Name | Type | Description |
| --- | --- | --- |
| `show` | `boolean` | True for showing the FPS counter |

* **Returns**: None


### <a name="setshowgridoverlays"></a>setShowGridOverlays

Highlight multiple elements with the CSS Grid overlay.

* **Parameters**:

| Name | Type | Description |
| --- | --- | --- |
| `gridNodeHighlightConfigs` | array of [GridNodeHighlightConfig](#gridnodehighlightconfig) | An array of node identifiers and descriptors for the highlight appearance. |

* **Returns**: None


### <a name="setshowflexoverlays"></a>setShowFlexOverlays

* **Parameters**:

| Name | Type | Description |
| --- | --- | --- |
| `flexNodeHighlightConfigs` | array of [FlexNodeHighlightConfig](#flexnodehighlightconfig) | An array of node identifiers and descriptors for the highlight appearance. |

* **Returns**: None


### <a name="setshowscrollsnapoverlays"></a>setShowScrollSnapOverlays

* **Parameters**:

| Name | Type | Description |
| --- | --- | --- |
| `scrollSnapHighlightConfigs` | array of [ScrollSnapHighlightConfig](#scrollsnaphighlightconfig) | An array of node identifiers and descriptors for the highlight appearance. |

* **Returns**: None


### <a name="setshowcontainerqueryoverlays"></a>setShowContainerQueryOverlays

* **Parameters**:

| Name | Type | Description |
| --- | --- | --- |
| `containerQueryHighlightConfigs` | array of [ContainerQueryHighlightConfig](#containerqueryhighlightconfig) | An array of node identifiers and descriptors for the highlight appearance. |

* **Returns**: None


### <a name="setshowinspectedelementanchor"></a>setShowInspectedElementAnchor

* **Parameters**:

| Name | Type | Description |
| --- | --- | --- |
| `inspectedElementAnchorConfig` | [InspectedElementAnchorConfig](#inspectedelementanchorconfig) | Node identifier for which to show an anchor for. |

* **Returns**: None


### <a name="setshowpaintrects"></a>setShowPaintRects

Requests that backend shows paint rectangles

* **Parameters**:

| Name | Type | Description |
| --- | --- | --- |
| `result` | `boolean` | True for showing paint rectangles |

* **Returns**: None


### <a name="setshowlayoutshiftregions"></a>setShowLayoutShiftRegions

Requests that backend shows layout shift regions

* **Parameters**:

| Name | Type | Description |
| --- | --- | --- |
| `result` | `boolean` | True for showing layout shift regions |

* **Returns**: None


### <a name="setshowscrollbottleneckrects"></a>setShowScrollBottleneckRects

Requests that backend shows scroll bottleneck rects

* **Parameters**:

| Name | Type | Description |
| --- | --- | --- |
| `show` | `boolean` | True for showing scroll bottleneck rects |

* **Returns**: None


### <a name="setshowhittestborders"></a>setShowHitTestBorders `⚠️ deprecated`

Deprecated, no longer has any effect.

* **Parameters**:

| Name | Type | Description |
| --- | --- | --- |
| `show` | `boolean` | True for showing hit-test borders |

* **Returns**: None


### <a name="setshowwebvitals"></a>setShowWebVitals `⚠️ deprecated`

Deprecated, no longer has any effect.

* **Parameters**:

| Name | Type | Description |
| --- | --- | --- |
| `show` | `boolean` |  |

* **Returns**: None


### <a name="setshowviewportsizeonresize"></a>setShowViewportSizeOnResize

Paints viewport size upon main frame resize.

* **Parameters**:

| Name | Type | Description |
| --- | --- | --- |
| `show` | `boolean` | Whether to paint size or not. |

* **Returns**: None


### <a name="setshowhinge"></a>setShowHinge

Add a dual screen device hinge

* **Parameters**:

| Name | Type | Description |
| --- | --- | --- |
| `hingeConfig`<br/>_optional_ | [HingeConfig](#hingeconfig) | hinge data, null means hideHinge |

* **Returns**: None


### <a name="setshowdisplaycutout"></a>setShowDisplayCutout

Add a display cutout overlay.

* **Parameters**:

| Name | Type | Description |
| --- | --- | --- |
| `displayCutoutConfig`<br/>_optional_ | [DisplayCutoutConfig](#displaycutoutconfig) | display cutout data, null means hide display cutout |

* **Returns**: None


### <a name="setshowisolatedelements"></a>setShowIsolatedElements

Show elements in isolation mode with overlays.

* **Parameters**:

| Name | Type | Description |
| --- | --- | --- |
| `isolatedElementHighlightConfigs` | array of [IsolatedElementHighlightConfig](#isolatedelementhighlightconfig) | An array of node identifiers and descriptors for the highlight appearance. |

* **Returns**: None


### <a name="setshowwindowcontrolsoverlay"></a>setShowWindowControlsOverlay

Show Window Controls Overlay for PWA

* **Parameters**:

| Name | Type | Description |
| --- | --- | --- |
| `windowControlsOverlayConfig`<br/>_optional_ | [WindowControlsOverlayConfig](#windowcontrolsoverlayconfig) | Window Controls Overlay data, null means hide Window Controls Overlay |

* **Returns**: None


---

<a name="events"></a>
## Events

### <a name="inspectnoderequested"></a>inspectNodeRequested

Fired when the node should be inspected. This happens after call to `setInspectMode` or when
user manually inspects an element.

* **Parameters**:

| Name | Type | Description |
| --- | --- | --- |
| `backendNodeId` | [DOM.BackendNodeId](DOM.md#backendnodeid) | Id of the node to inspect. |


### <a name="nodehighlightrequested"></a>nodeHighlightRequested

Fired when the node should be highlighted. This happens after call to `setInspectMode`.

* **Parameters**:

| Name | Type | Description |
| --- | --- | --- |
| `nodeId` | [DOM.NodeId](DOM.md#nodeid) |  |


### <a name="screenshotrequested"></a>screenshotRequested

Fired when user asks to capture screenshot of some area on the page.

* **Parameters**:

| Name | Type | Description |
| --- | --- | --- |
| `viewport` | [Page.Viewport](Page.md#viewport) | Viewport to capture, in device independent pixels (dip). |


### <a name="inspectpanelshowrequested"></a>inspectPanelShowRequested

Fired when user asks to show the Inspect panel.

* **Parameters**:

| Name | Type | Description |
| --- | --- | --- |
| `backendNodeId` | [DOM.BackendNodeId](DOM.md#backendnodeid) | Id of the node to show in the panel. |


### <a name="inspectedelementwindowrestored"></a>inspectedElementWindowRestored

Fired when user asks to restore the Inspected Element floating window.

* **Parameters**:

| Name | Type | Description |
| --- | --- | --- |
| `backendNodeId` | [DOM.BackendNodeId](DOM.md#backendnodeid) | Id of the node to restore the floating window for. |


### <a name="inspectmodecanceled"></a>inspectModeCanceled

Fired when user cancels the inspect mode.

* **Parameters**: None


