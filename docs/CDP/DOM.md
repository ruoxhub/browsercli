# DOM

This domain exposes DOM read/write operations. Each DOM Node is represented with its mirror object
that has an `id`. This `id` can be used to get additional information on the Node, resolve it into
the JavaScript object wrapper, etc. It is important that client receives DOM events only for the
nodes that are known to the client. Backend keeps track of the nodes that were sent to the client
and never sends the same node twice. It is client's responsibility to collect information about
the nodes that were sent to the client. Note that `iframe` owner elements will return
corresponding document elements as their child nodes.

* **Source**: Browser Protocol (Chromium)
* **Dependencies**: [Runtime](Runtime.md), [Network](Network.md)

---

## Navigation

* [Types](#types)
* [Commands](#commands)
* [Events](#events)

[← Back to Index](README.md)

---

<a name="types"></a>
## Types

### <a name="nodeid"></a>NodeId

Unique DOM node identifier.

* **Type**: `integer`

### <a name="backendnodeid"></a>BackendNodeId

Unique DOM node identifier used to reference a node that may not have been pushed to the
front-end.

* **Type**: `integer`

### <a name="stylesheetid"></a>StyleSheetId

Unique identifier for a CSS stylesheet.

* **Type**: `string`

### <a name="backendnode"></a>BackendNode

Backend node with a friendly name.

* **Type**: `object`
* **Properties**:

| Name | Type | Description |
| --- | --- | --- |
| `nodeType` | `integer` | `Node`'s nodeType. |
| `nodeName` | `string` | `Node`'s nodeName. |
| `backendNodeId` | [BackendNodeId](#backendnodeid) |  |


### <a name="pseudotype"></a>PseudoType

Pseudo element type.

* **Type**: `string`
* **Allowed values**: `"first-line"`, `"first-letter"`, `"checkmark"`, `"before"`, `"after"`, `"expand-icon"`, `"picker-icon"`, `"interest-button"`, `"marker"`, `"backdrop"`, `"column"`, `"selection"`, `"search-text"`, `"target-text"`, `"spelling-error"`, `"grammar-error"`, `"highlight"`, `"first-line-inherited"`, `"scroll-marker"`, `"scroll-marker-group"`, `"scroll-button"`, `"scrollbar"`, `"scrollbar-thumb"`, `"scrollbar-button"`, `"scrollbar-track"`, `"scrollbar-track-piece"`, `"scrollbar-corner"`, `"resizer"`, `"input-list-button"`, `"view-transition"`, `"view-transition-group"`, `"view-transition-image-pair"`, `"view-transition-group-children"`, `"view-transition-old"`, `"view-transition-new"`, `"placeholder"`, `"file-selector-button"`, `"details-content"`, `"picker"`, `"select-listbox"`, `"permission-icon"`, `"overscroll-area-parent"`, `"overscroll-backdrop"`, `"skeleton"`

### <a name="shadowroottype"></a>ShadowRootType

Shadow root type.

* **Type**: `string`
* **Allowed values**: `"user-agent"`, `"open"`, `"closed"`

### <a name="compatibilitymode"></a>CompatibilityMode

Document compatibility mode.

* **Type**: `string`
* **Allowed values**: `"QuirksMode"`, `"LimitedQuirksMode"`, `"NoQuirksMode"`

### <a name="physicalaxes"></a>PhysicalAxes

ContainerSelector physical axes

* **Type**: `string`
* **Allowed values**: `"Horizontal"`, `"Vertical"`, `"Both"`

### <a name="logicalaxes"></a>LogicalAxes

ContainerSelector logical axes

* **Type**: `string`
* **Allowed values**: `"Inline"`, `"Block"`, `"Both"`

### <a name="scrollorientation"></a>ScrollOrientation

Physical scroll orientation

* **Type**: `string`
* **Allowed values**: `"horizontal"`, `"vertical"`

### <a name="node"></a>Node

DOM interaction is implemented in terms of mirror objects that represent the actual DOM nodes.
DOMNode is a base node mirror type.

* **Type**: `object`
* **Properties**:

| Name | Type | Description |
| --- | --- | --- |
| `nodeId` | [NodeId](#nodeid) | Node identifier that is passed into the rest of the DOM messages as the `nodeId`. Backend<br/>will only push node with given `id` once. It is aware of all requested nodes and will only<br/>fire DOM events for nodes known to the client. |
| `parentId`<br/>_optional_ | [NodeId](#nodeid) | The id of the parent node if any. |
| `backendNodeId` | [BackendNodeId](#backendnodeid) | The BackendNodeId for this node. |
| `nodeType` | `integer` | `Node`'s nodeType. |
| `nodeName` | `string` | `Node`'s nodeName. |
| `localName` | `string` | `Node`'s localName. |
| `nodeValue` | `string` | `Node`'s nodeValue. |
| `childNodeCount`<br/>_optional_ | `integer` | Child count for `Container` nodes. |
| `children`<br/>_optional_ | array of [Node](#node) | Child nodes of this node when requested with children. |
| `attributes`<br/>_optional_ | array of `string` | Attributes of the `Element` node in the form of flat array `[name1, value1, name2, value2]`. |
| `documentURL`<br/>_optional_ | `string` | Document URL that `Document` or `FrameOwner` node points to. |
| `baseURL`<br/>_optional_ | `string` | Base URL that `Document` or `FrameOwner` node uses for URL completion. |
| `publicId`<br/>_optional_ | `string` | `DocumentType`'s publicId. |
| `systemId`<br/>_optional_ | `string` | `DocumentType`'s systemId. |
| `internalSubset`<br/>_optional_ | `string` | `DocumentType`'s internalSubset. |
| `xmlVersion`<br/>_optional_ | `string` | `Document`'s XML version in case of XML documents. |
| `name`<br/>_optional_ | `string` | `Attr`'s name. |
| `value`<br/>_optional_ | `string` | `Attr`'s value. |
| `pseudoType`<br/>_optional_ | [PseudoType](#pseudotype) | Pseudo element type for this node. |
| `pseudoIdentifier`<br/>_optional_ | `string` | Pseudo element identifier for this node. Only present if there is a<br/>valid pseudoType. |
| `shadowRootType`<br/>_optional_ | [ShadowRootType](#shadowroottype) | Shadow root type. |
| `frameId`<br/>_optional_ | [Page.FrameId](Page.md#frameid) | Frame ID for frame owner elements. |
| `contentDocument`<br/>_optional_ | [Node](#node) | Content document for frame owner elements. |
| `shadowRoots`<br/>_optional_ | array of [Node](#node) | Shadow root list for given element host. |
| `templateContent`<br/>_optional_ | [Node](#node) | Content document fragment for template elements. |
| `pseudoElements`<br/>_optional_ | array of [Node](#node) | Pseudo elements associated with this node. |
| `importedDocument`<br/>_optional_ | [Node](#node) | `⚠️ deprecated` Deprecated, as the HTML Imports API has been removed (crbug.com/937746).<br/>This property used to return the imported document for the HTMLImport links.<br/>The property is always undefined now. |
| `distributedNodes`<br/>_optional_ | array of [BackendNode](#backendnode) | Distributed nodes for given insertion point. |
| `isSVG`<br/>_optional_ | `boolean` | Whether the node is SVG. |
| `compatibilityMode`<br/>_optional_ | [CompatibilityMode](#compatibilitymode) |  |
| `assignedSlot`<br/>_optional_ | [BackendNode](#backendnode) |  |
| `isScrollable`<br/>_optional_ | `boolean` | `🧪 experimental` |
| `affectedByStartingStyles`<br/>_optional_ | `boolean` | `🧪 experimental` |
| `adoptedStyleSheets`<br/>_optional_ | array of [StyleSheetId](#stylesheetid) | `🧪 experimental` |
| `adProvenance`<br/>_optional_ | [Network.AdProvenance](Network.md#adprovenance) | `🧪 experimental` |


### <a name="detachedelementinfo"></a>DetachedElementInfo

A structure to hold the top-level node of a detached tree and an array of its retained descendants.

* **Type**: `object`
* **Properties**:

| Name | Type | Description |
| --- | --- | --- |
| `treeNode` | [Node](#node) |  |
| `retainedNodeIds` | array of [NodeId](#nodeid) |  |


### <a name="rgba"></a>RGBA

A structure holding an RGBA color.

* **Type**: `object`
* **Properties**:

| Name | Type | Description |
| --- | --- | --- |
| `r` | `integer` | The red component, in the [0-255] range. |
| `g` | `integer` | The green component, in the [0-255] range. |
| `b` | `integer` | The blue component, in the [0-255] range. |
| `a`<br/>_optional_ | `number` | The alpha component, in the [0-1] range (default: 1). |


### <a name="quad"></a>Quad

An array of quad vertices, x immediately followed by y for each point, points clock-wise.

* **Type**: `array`

### <a name="boxmodel"></a>BoxModel

Box model.

* **Type**: `object`
* **Properties**:

| Name | Type | Description |
| --- | --- | --- |
| `content` | [Quad](#quad) | Content box |
| `padding` | [Quad](#quad) | Padding box |
| `border` | [Quad](#quad) | Border box |
| `margin` | [Quad](#quad) | Margin box |
| `width` | `integer` | Node width |
| `height` | `integer` | Node height |
| `shapeOutside`<br/>_optional_ | [ShapeOutsideInfo](#shapeoutsideinfo) | Shape outside coordinates |


### <a name="shapeoutsideinfo"></a>ShapeOutsideInfo

CSS Shape Outside details.

* **Type**: `object`
* **Properties**:

| Name | Type | Description |
| --- | --- | --- |
| `bounds` | [Quad](#quad) | Shape bounds |
| `shape` | array of `any` | Shape coordinate details |
| `marginShape` | array of `any` | Margin shape bounds |


### <a name="rect"></a>Rect

Rectangle.

* **Type**: `object`
* **Properties**:

| Name | Type | Description |
| --- | --- | --- |
| `x` | `number` | X coordinate |
| `y` | `number` | Y coordinate |
| `width` | `number` | Rectangle width |
| `height` | `number` | Rectangle height |


### <a name="csscomputedstyleproperty"></a>CSSComputedStyleProperty

* **Type**: `object`
* **Properties**:

| Name | Type | Description |
| --- | --- | --- |
| `name` | `string` | Computed style property name. |
| `value` | `string` | Computed style property value. |


---

<a name="commands"></a>
## Commands

### <a name="collectclassnamesfromsubtree"></a>collectClassNamesFromSubtree `🧪 experimental`

Collects class names for the node with given id and all of it's child nodes.

* **Parameters**:

| Name | Type | Description |
| --- | --- | --- |
| `nodeId` | [NodeId](#nodeid) | Id of the node to collect class names. |

* **Returns**:

| Name | Type | Description |
| --- | --- | --- |
| `classNames` | array of `string` | Class name list. |


### <a name="copyto"></a>copyTo `🧪 experimental`

Creates a deep copy of the specified node and places it into the target container before the
given anchor.

* **Parameters**:

| Name | Type | Description |
| --- | --- | --- |
| `nodeId` | [NodeId](#nodeid) | Id of the node to copy. |
| `targetNodeId` | [NodeId](#nodeid) | Id of the element to drop the copy into. |
| `insertBeforeNodeId`<br/>_optional_ | [NodeId](#nodeid) | Drop the copy before this node (if absent, the copy becomes the last child of<br/>`targetNodeId`). |

* **Returns**:

| Name | Type | Description |
| --- | --- | --- |
| `nodeId` | [NodeId](#nodeid) | Id of the node clone. |


### <a name="describenode"></a>describeNode

Describes node given its id, does not require domain to be enabled. Does not start tracking any
objects, can be used for automation.

* **Parameters**:

| Name | Type | Description |
| --- | --- | --- |
| `nodeId`<br/>_optional_ | [NodeId](#nodeid) | Identifier of the node. |
| `backendNodeId`<br/>_optional_ | [BackendNodeId](#backendnodeid) | Identifier of the backend node. |
| `objectId`<br/>_optional_ | [Runtime.RemoteObjectId](Runtime.md#remoteobjectid) | JavaScript object id of the node wrapper. |
| `depth`<br/>_optional_ | `integer` | The maximum depth at which children should be retrieved, defaults to 1. Use -1 for the<br/>entire subtree or provide an integer larger than 0. |
| `pierce`<br/>_optional_ | `boolean` | Whether or not iframes and shadow roots should be traversed when returning the subtree<br/>(default is false). |

* **Returns**:

| Name | Type | Description |
| --- | --- | --- |
| `node` | [Node](#node) | Node description. |


### <a name="scrollintoviewifneeded"></a>scrollIntoViewIfNeeded

Scrolls the specified rect of the given node into view if not already visible.
Note: exactly one between nodeId, backendNodeId and objectId should be passed
to identify the node.

* **Parameters**:

| Name | Type | Description |
| --- | --- | --- |
| `nodeId`<br/>_optional_ | [NodeId](#nodeid) | Identifier of the node. |
| `backendNodeId`<br/>_optional_ | [BackendNodeId](#backendnodeid) | Identifier of the backend node. |
| `objectId`<br/>_optional_ | [Runtime.RemoteObjectId](Runtime.md#remoteobjectid) | JavaScript object id of the node wrapper. |
| `rect`<br/>_optional_ | [Rect](#rect) | The rect to be scrolled into view, relative to the node's border box, in CSS pixels.<br/>When omitted, center of the node will be used, similar to Element.scrollIntoView. |

* **Returns**: None


### <a name="disable"></a>disable

Disables DOM agent for the given page.

* **Parameters**: None

* **Returns**: None


### <a name="discardsearchresults"></a>discardSearchResults `🧪 experimental`

Discards search results from the session with the given id. `getSearchResults` should no longer
be called for that search.

* **Parameters**:

| Name | Type | Description |
| --- | --- | --- |
| `searchId` | `string` | Unique search session identifier. |

* **Returns**: None


### <a name="enable"></a>enable

Enables DOM agent for the given page.

* **Parameters**:

| Name | Type | Description |
| --- | --- | --- |
| `includeWhitespace`<br/>_optional_ | `string` | `🧪 experimental` Whether to include whitespaces in the children array of returned Nodes.<br/>Allowed values: `"none"`, `"all"` |

* **Returns**: None


### <a name="focus"></a>focus

Focuses the given element.

* **Parameters**:

| Name | Type | Description |
| --- | --- | --- |
| `nodeId`<br/>_optional_ | [NodeId](#nodeid) | Identifier of the node. |
| `backendNodeId`<br/>_optional_ | [BackendNodeId](#backendnodeid) | Identifier of the backend node. |
| `objectId`<br/>_optional_ | [Runtime.RemoteObjectId](Runtime.md#remoteobjectid) | JavaScript object id of the node wrapper. |

* **Returns**: None


### <a name="getattributes"></a>getAttributes

Returns attributes for the specified node.

* **Parameters**:

| Name | Type | Description |
| --- | --- | --- |
| `nodeId` | [NodeId](#nodeid) | Id of the node to retrieve attributes for. |

* **Returns**:

| Name | Type | Description |
| --- | --- | --- |
| `attributes` | array of `string` | An interleaved array of node attribute names and values. |


### <a name="getboxmodel"></a>getBoxModel

Returns boxes for the given node.

* **Parameters**:

| Name | Type | Description |
| --- | --- | --- |
| `nodeId`<br/>_optional_ | [NodeId](#nodeid) | Identifier of the node. |
| `backendNodeId`<br/>_optional_ | [BackendNodeId](#backendnodeid) | Identifier of the backend node. |
| `objectId`<br/>_optional_ | [Runtime.RemoteObjectId](Runtime.md#remoteobjectid) | JavaScript object id of the node wrapper. |

* **Returns**:

| Name | Type | Description |
| --- | --- | --- |
| `model` | [BoxModel](#boxmodel) | Box model for the node. |


### <a name="getcontentquads"></a>getContentQuads `🧪 experimental`

Returns quads that describe node position on the page. This method
might return multiple quads for inline nodes.

* **Parameters**:

| Name | Type | Description |
| --- | --- | --- |
| `nodeId`<br/>_optional_ | [NodeId](#nodeid) | Identifier of the node. |
| `backendNodeId`<br/>_optional_ | [BackendNodeId](#backendnodeid) | Identifier of the backend node. |
| `objectId`<br/>_optional_ | [Runtime.RemoteObjectId](Runtime.md#remoteobjectid) | JavaScript object id of the node wrapper. |

* **Returns**:

| Name | Type | Description |
| --- | --- | --- |
| `quads` | array of [Quad](#quad) | Quads that describe node layout relative to viewport. |


### <a name="getdocument"></a>getDocument

Returns the root DOM node (and optionally the subtree) to the caller.
Implicitly enables the DOM domain events for the current target.

* **Parameters**:

| Name | Type | Description |
| --- | --- | --- |
| `depth`<br/>_optional_ | `integer` | The maximum depth at which children should be retrieved, defaults to 1. Use -1 for the<br/>entire subtree or provide an integer larger than 0. |
| `pierce`<br/>_optional_ | `boolean` | Whether or not iframes and shadow roots should be traversed when returning the subtree<br/>(default is false). |

* **Returns**:

| Name | Type | Description |
| --- | --- | --- |
| `root` | [Node](#node) | Resulting node. |


### <a name="getflatteneddocument"></a>getFlattenedDocument `⚠️ deprecated`

Returns the root DOM node (and optionally the subtree) to the caller.
Deprecated, as it is not designed to work well with the rest of the DOM agent.
Use DOMSnapshot.captureSnapshot instead.

* **Parameters**:

| Name | Type | Description |
| --- | --- | --- |
| `depth`<br/>_optional_ | `integer` | The maximum depth at which children should be retrieved, defaults to 1. Use -1 for the<br/>entire subtree or provide an integer larger than 0. |
| `pierce`<br/>_optional_ | `boolean` | Whether or not iframes and shadow roots should be traversed when returning the subtree<br/>(default is false). |

* **Returns**:

| Name | Type | Description |
| --- | --- | --- |
| `nodes` | array of [Node](#node) | Resulting node. |


### <a name="getnodesforsubtreebystyle"></a>getNodesForSubtreeByStyle `🧪 experimental`

Finds nodes with a given computed style in a subtree.

* **Parameters**:

| Name | Type | Description |
| --- | --- | --- |
| `nodeId` | [NodeId](#nodeid) | Node ID pointing to the root of a subtree. |
| `computedStyles` | array of [CSSComputedStyleProperty](#csscomputedstyleproperty) | The style to filter nodes by (includes nodes if any of properties matches). |
| `pierce`<br/>_optional_ | `boolean` | Whether or not iframes and shadow roots in the same target should be traversed when returning the<br/>results (default is false). |

* **Returns**:

| Name | Type | Description |
| --- | --- | --- |
| `nodeIds` | array of [NodeId](#nodeid) | Resulting nodes. |


### <a name="getnodeforlocation"></a>getNodeForLocation

Returns node id at given location. Depending on whether DOM domain is enabled, nodeId is
either returned or not.

* **Parameters**:

| Name | Type | Description |
| --- | --- | --- |
| `x` | `integer` | X coordinate. |
| `y` | `integer` | Y coordinate. |
| `includeUserAgentShadowDOM`<br/>_optional_ | `boolean` | False to skip to the nearest non-UA shadow root ancestor (default: false). |
| `ignorePointerEventsNone`<br/>_optional_ | `boolean` | Whether to ignore pointer-events: none on elements and hit test them. |

* **Returns**:

| Name | Type | Description |
| --- | --- | --- |
| `backendNodeId` | [BackendNodeId](#backendnodeid) | Resulting node. |
| `frameId` | [Page.FrameId](Page.md#frameid) | Frame this node belongs to. |
| `nodeId`<br/>_optional_ | [NodeId](#nodeid) | Id of the node at given coordinates, only when enabled and requested document. |


### <a name="getouterhtml"></a>getOuterHTML

Returns node's HTML markup.

* **Parameters**:

| Name | Type | Description |
| --- | --- | --- |
| `nodeId`<br/>_optional_ | [NodeId](#nodeid) | Identifier of the node. |
| `backendNodeId`<br/>_optional_ | [BackendNodeId](#backendnodeid) | Identifier of the backend node. |
| `objectId`<br/>_optional_ | [Runtime.RemoteObjectId](Runtime.md#remoteobjectid) | JavaScript object id of the node wrapper. |
| `includeShadowDOM`<br/>_optional_ | `boolean` | `🧪 experimental` Include all shadow roots. Equals to false if not specified. |

* **Returns**:

| Name | Type | Description |
| --- | --- | --- |
| `outerHTML` | `string` | Outer HTML markup. |


### <a name="getrelayoutboundary"></a>getRelayoutBoundary `🧪 experimental`

Returns the id of the nearest ancestor that is a relayout boundary.

* **Parameters**:

| Name | Type | Description |
| --- | --- | --- |
| `nodeId` | [NodeId](#nodeid) | Id of the node. |

* **Returns**:

| Name | Type | Description |
| --- | --- | --- |
| `nodeId` | [NodeId](#nodeid) | Relayout boundary node id for the given node. |


### <a name="getsearchresults"></a>getSearchResults `🧪 experimental`

Returns search results from given `fromIndex` to given `toIndex` from the search with the given
identifier.

* **Parameters**:

| Name | Type | Description |
| --- | --- | --- |
| `searchId` | `string` | Unique search session identifier. |
| `fromIndex` | `integer` | Start index of the search result to be returned. |
| `toIndex` | `integer` | End index of the search result to be returned. |

* **Returns**:

| Name | Type | Description |
| --- | --- | --- |
| `nodeIds` | array of [NodeId](#nodeid) | Ids of the search result nodes. |


### <a name="hidehighlight"></a>hideHighlight

Hides any highlight.

* **Parameters**: None

* **Returns**: None


### <a name="highlightnode"></a>highlightNode

Highlights DOM node.

* **Parameters**: None

* **Returns**: None


### <a name="highlightrect"></a>highlightRect

Highlights given rectangle.

* **Parameters**: None

* **Returns**: None


### <a name="markundoablestate"></a>markUndoableState `🧪 experimental`

Marks last undoable state.

* **Parameters**: None

* **Returns**: None


### <a name="moveto"></a>moveTo

Moves node into the new container, places it before the given anchor.

* **Parameters**:

| Name | Type | Description |
| --- | --- | --- |
| `nodeId` | [NodeId](#nodeid) | Id of the node to move. |
| `targetNodeId` | [NodeId](#nodeid) | Id of the element to drop the moved node into. |
| `insertBeforeNodeId`<br/>_optional_ | [NodeId](#nodeid) | Drop node before this one (if absent, the moved node becomes the last child of<br/>`targetNodeId`). |

* **Returns**:

| Name | Type | Description |
| --- | --- | --- |
| `nodeId` | [NodeId](#nodeid) | New id of the moved node. |


### <a name="performsearch"></a>performSearch `🧪 experimental`

Searches for a given string in the DOM tree. Use `getSearchResults` to access search results or
`cancelSearch` to end this search session.

* **Parameters**:

| Name | Type | Description |
| --- | --- | --- |
| `query` | `string` | Plain text or query selector or XPath search query. |
| `includeUserAgentShadowDOM`<br/>_optional_ | `boolean` | True to search in user agent shadow DOM. |

* **Returns**:

| Name | Type | Description |
| --- | --- | --- |
| `searchId` | `string` | Unique search session identifier. |
| `resultCount` | `integer` | Number of search results. |


### <a name="pushnodebypathtofrontend"></a>pushNodeByPathToFrontend `🧪 experimental`

Requests that the node is sent to the caller given its path. // FIXME, use XPath

* **Parameters**:

| Name | Type | Description |
| --- | --- | --- |
| `path` | `string` | Path to node in the proprietary format. |

* **Returns**:

| Name | Type | Description |
| --- | --- | --- |
| `nodeId` | [NodeId](#nodeid) | Id of the node for given path. |


### <a name="pushnodesbybackendidstofrontend"></a>pushNodesByBackendIdsToFrontend `🧪 experimental`

Requests that a batch of nodes is sent to the caller given their backend node ids.

* **Parameters**:

| Name | Type | Description |
| --- | --- | --- |
| `backendNodeIds` | array of [BackendNodeId](#backendnodeid) | The array of backend node ids. |

* **Returns**:

| Name | Type | Description |
| --- | --- | --- |
| `nodeIds` | array of [NodeId](#nodeid) | The array of ids of pushed nodes that correspond to the backend ids specified in<br/>backendNodeIds. |


### <a name="queryselector"></a>querySelector

Executes `querySelector` on a given node.

* **Parameters**:

| Name | Type | Description |
| --- | --- | --- |
| `nodeId` | [NodeId](#nodeid) | Id of the node to query upon. |
| `selector` | `string` | Selector string. |

* **Returns**:

| Name | Type | Description |
| --- | --- | --- |
| `nodeId` | [NodeId](#nodeid) | Query selector result. |


### <a name="queryselectorall"></a>querySelectorAll

Executes `querySelectorAll` on a given node.

* **Parameters**:

| Name | Type | Description |
| --- | --- | --- |
| `nodeId` | [NodeId](#nodeid) | Id of the node to query upon. |
| `selector` | `string` | Selector string. |

* **Returns**:

| Name | Type | Description |
| --- | --- | --- |
| `nodeIds` | array of [NodeId](#nodeid) | Query selector result. |


### <a name="gettoplayerelements"></a>getTopLayerElements `🧪 experimental`

Returns NodeIds of current top layer elements.
Top layer is rendered closest to the user within a viewport, therefore its elements always
appear on top of all other content.

* **Parameters**: None

* **Returns**:

| Name | Type | Description |
| --- | --- | --- |
| `nodeIds` | array of [NodeId](#nodeid) | NodeIds of top layer elements |


### <a name="getelementbyrelation"></a>getElementByRelation `🧪 experimental`

Returns the NodeId of the matched element according to certain relations.

* **Parameters**:

| Name | Type | Description |
| --- | --- | --- |
| `nodeId` | [NodeId](#nodeid) | Id of the node from which to query the relation. |
| `relation` | `string` | Type of relation to get.<br/>Allowed values: `"PopoverTarget"`, `"InterestTarget"`, `"CommandFor"` |

* **Returns**:

| Name | Type | Description |
| --- | --- | --- |
| `nodeId` | [NodeId](#nodeid) | NodeId of the element matching the queried relation. |


### <a name="redo"></a>redo `🧪 experimental`

Re-does the last undone action.

* **Parameters**: None

* **Returns**: None


### <a name="removeattribute"></a>removeAttribute

Removes attribute with given name from an element with given id.

* **Parameters**:

| Name | Type | Description |
| --- | --- | --- |
| `nodeId` | [NodeId](#nodeid) | Id of the element to remove attribute from. |
| `name` | `string` | Name of the attribute to remove. |

* **Returns**: None


### <a name="removenode"></a>removeNode

Removes node with given id.

* **Parameters**:

| Name | Type | Description |
| --- | --- | --- |
| `nodeId` | [NodeId](#nodeid) | Id of the node to remove. |

* **Returns**: None


### <a name="requestchildnodes"></a>requestChildNodes

Requests that children of the node with given id are returned to the caller in form of
`setChildNodes` events where not only immediate children are retrieved, but all children down to
the specified depth.

* **Parameters**:

| Name | Type | Description |
| --- | --- | --- |
| `nodeId` | [NodeId](#nodeid) | Id of the node to get children for. |
| `depth`<br/>_optional_ | `integer` | The maximum depth at which children should be retrieved, defaults to 1. Use -1 for the<br/>entire subtree or provide an integer larger than 0. |
| `pierce`<br/>_optional_ | `boolean` | Whether or not iframes and shadow roots should be traversed when returning the sub-tree<br/>(default is false). |

* **Returns**: None


### <a name="requestnode"></a>requestNode

Requests that the node is sent to the caller given the JavaScript node object reference. All
nodes that form the path from the node to the root are also sent to the client as a series of
`setChildNodes` notifications.

* **Parameters**:

| Name | Type | Description |
| --- | --- | --- |
| `objectId` | [Runtime.RemoteObjectId](Runtime.md#remoteobjectid) | JavaScript object id to convert into node. |

* **Returns**:

| Name | Type | Description |
| --- | --- | --- |
| `nodeId` | [NodeId](#nodeid) | Node id for given object. |


### <a name="resolvenode"></a>resolveNode

Resolves the JavaScript node object for a given NodeId or BackendNodeId.

* **Parameters**:

| Name | Type | Description |
| --- | --- | --- |
| `nodeId`<br/>_optional_ | [NodeId](#nodeid) | Id of the node to resolve. |
| `backendNodeId`<br/>_optional_ | [BackendNodeId](#backendnodeid) | Backend identifier of the node to resolve. |
| `objectGroup`<br/>_optional_ | `string` | Symbolic group name that can be used to release multiple objects. |
| `executionContextId`<br/>_optional_ | [Runtime.ExecutionContextId](Runtime.md#executioncontextid) | Execution context in which to resolve the node. |

* **Returns**:

| Name | Type | Description |
| --- | --- | --- |
| `object` | [Runtime.RemoteObject](Runtime.md#remoteobject) | JavaScript object wrapper for given node. |


### <a name="setattributevalue"></a>setAttributeValue

Sets attribute for an element with given id.

* **Parameters**:

| Name | Type | Description |
| --- | --- | --- |
| `nodeId` | [NodeId](#nodeid) | Id of the element to set attribute for. |
| `name` | `string` | Attribute name. |
| `value` | `string` | Attribute value. |

* **Returns**: None


### <a name="setattributesastext"></a>setAttributesAsText

Sets attributes on element with given id. This method is useful when user edits some existing
attribute value and types in several attribute name/value pairs.

* **Parameters**:

| Name | Type | Description |
| --- | --- | --- |
| `nodeId` | [NodeId](#nodeid) | Id of the element to set attributes for. |
| `text` | `string` | Text with a number of attributes. Will parse this text using HTML parser. |
| `name`<br/>_optional_ | `string` | Attribute name to replace with new attributes derived from text in case text parsed<br/>successfully. |

* **Returns**: None


### <a name="setfileinputfiles"></a>setFileInputFiles

Sets files for the given file input element.

* **Parameters**:

| Name | Type | Description |
| --- | --- | --- |
| `files` | array of `string` | Array of file paths to set. |
| `nodeId`<br/>_optional_ | [NodeId](#nodeid) | Identifier of the node. |
| `backendNodeId`<br/>_optional_ | [BackendNodeId](#backendnodeid) | Identifier of the backend node. |
| `objectId`<br/>_optional_ | [Runtime.RemoteObjectId](Runtime.md#remoteobjectid) | JavaScript object id of the node wrapper. |

* **Returns**: None


### <a name="setnodestacktracesenabled"></a>setNodeStackTracesEnabled `🧪 experimental`

Sets if stack traces should be captured for Nodes. See `Node.getNodeStackTraces`. Default is disabled.

* **Parameters**:

| Name | Type | Description |
| --- | --- | --- |
| `enable` | `boolean` | Enable or disable. |

* **Returns**: None


### <a name="getnodestacktraces"></a>getNodeStackTraces `🧪 experimental`

Gets stack traces associated with a Node. As of now, only provides stack trace for Node creation.

* **Parameters**:

| Name | Type | Description |
| --- | --- | --- |
| `nodeId` | [NodeId](#nodeid) | Id of the node to get stack traces for. |

* **Returns**:

| Name | Type | Description |
| --- | --- | --- |
| `creation`<br/>_optional_ | [Runtime.StackTrace](Runtime.md#stacktrace) | Creation stack trace, if available. |


### <a name="getfileinfo"></a>getFileInfo `🧪 experimental`

Returns file information for the given
File wrapper.

* **Parameters**:

| Name | Type | Description |
| --- | --- | --- |
| `objectId` | [Runtime.RemoteObjectId](Runtime.md#remoteobjectid) | JavaScript object id of the node wrapper. |

* **Returns**:

| Name | Type | Description |
| --- | --- | --- |
| `path` | `string` |  |


### <a name="getdetacheddomnodes"></a>getDetachedDomNodes `🧪 experimental`

Returns list of detached nodes

* **Parameters**: None

* **Returns**:

| Name | Type | Description |
| --- | --- | --- |
| `detachedNodes` | array of [DetachedElementInfo](#detachedelementinfo) | The list of detached nodes |


### <a name="setinspectednode"></a>setInspectedNode `🧪 experimental`

Enables console to refer to the node with given id via $x (see Command Line API for more details
$x functions).

* **Parameters**:

| Name | Type | Description |
| --- | --- | --- |
| `nodeId` | [NodeId](#nodeid) | DOM node id to be accessible by means of $x command line API. |

* **Returns**: None


### <a name="setnodename"></a>setNodeName

Sets node name for a node with given id.

* **Parameters**:

| Name | Type | Description |
| --- | --- | --- |
| `nodeId` | [NodeId](#nodeid) | Id of the node to set name for. |
| `name` | `string` | New node's name. |

* **Returns**:

| Name | Type | Description |
| --- | --- | --- |
| `nodeId` | [NodeId](#nodeid) | New node's id. |


### <a name="setnodevalue"></a>setNodeValue

Sets node value for a node with given id.

* **Parameters**:

| Name | Type | Description |
| --- | --- | --- |
| `nodeId` | [NodeId](#nodeid) | Id of the node to set value for. |
| `value` | `string` | New node's value. |

* **Returns**: None


### <a name="setouterhtml"></a>setOuterHTML

Sets node HTML markup, returns new node id.

* **Parameters**:

| Name | Type | Description |
| --- | --- | --- |
| `nodeId` | [NodeId](#nodeid) | Id of the node to set markup for. |
| `outerHTML` | `string` | Outer HTML markup to set. |

* **Returns**: None


### <a name="undo"></a>undo `🧪 experimental`

Undoes the last performed action.

* **Parameters**: None

* **Returns**: None


### <a name="getframeowner"></a>getFrameOwner `🧪 experimental`

Returns iframe node that owns iframe with the given domain.

* **Parameters**:

| Name | Type | Description |
| --- | --- | --- |
| `frameId` | [Page.FrameId](Page.md#frameid) |  |

* **Returns**:

| Name | Type | Description |
| --- | --- | --- |
| `backendNodeId` | [BackendNodeId](#backendnodeid) | Resulting node. |
| `nodeId`<br/>_optional_ | [NodeId](#nodeid) | Id of the node at given coordinates, only when enabled and requested document. |


### <a name="getcontainerfornode"></a>getContainerForNode `🧪 experimental`

Returns the query container of the given node based on container query
conditions: containerName, physical and logical axes, and whether it queries
scroll-state or anchored elements. If no axes are provided and
queriesScrollState is false, the style container is returned, which is the
direct parent or the closest element with a matching container-name.

* **Parameters**:

| Name | Type | Description |
| --- | --- | --- |
| `nodeId` | [NodeId](#nodeid) |  |
| `containerName`<br/>_optional_ | `string` |  |
| `physicalAxes`<br/>_optional_ | [PhysicalAxes](#physicalaxes) |  |
| `logicalAxes`<br/>_optional_ | [LogicalAxes](#logicalaxes) |  |
| `queriesScrollState`<br/>_optional_ | `boolean` |  |
| `queriesAnchored`<br/>_optional_ | `boolean` |  |

* **Returns**:

| Name | Type | Description |
| --- | --- | --- |
| `nodeId`<br/>_optional_ | [NodeId](#nodeid) | The container node for the given node, or null if not found. |


### <a name="getqueryingdescendantsforcontainer"></a>getQueryingDescendantsForContainer `🧪 experimental`

Returns the descendants of a container query container that have
container queries against this container.

* **Parameters**:

| Name | Type | Description |
| --- | --- | --- |
| `nodeId` | [NodeId](#nodeid) | Id of the container node to find querying descendants from. |

* **Returns**:

| Name | Type | Description |
| --- | --- | --- |
| `nodeIds` | array of [NodeId](#nodeid) | Descendant nodes with container queries against the given container. |


### <a name="getanchorelement"></a>getAnchorElement `🧪 experimental`

Returns the target anchor element of the given anchor query according to
https://www.w3.org/TR/css-anchor-position-1/#target.

* **Parameters**:

| Name | Type | Description |
| --- | --- | --- |
| `nodeId` | [NodeId](#nodeid) | Id of the positioned element from which to find the anchor. |
| `anchorSpecifier`<br/>_optional_ | `string` | An optional anchor specifier, as defined in<br/>https://www.w3.org/TR/css-anchor-position-1/#anchor-specifier.<br/>If not provided, it will return the implicit anchor element for<br/>the given positioned element. |

* **Returns**:

| Name | Type | Description |
| --- | --- | --- |
| `nodeId` | [NodeId](#nodeid) | The anchor element of the given anchor query. |


### <a name="forceshowpopover"></a>forceShowPopover `🧪 experimental`

When enabling, this API force-opens the popover identified by nodeId
and keeps it open until disabled.

* **Parameters**:

| Name | Type | Description |
| --- | --- | --- |
| `nodeId` | [NodeId](#nodeid) | Id of the popover HTMLElement |
| `enable` | `boolean` | If true, opens the popover and keeps it open. If false, closes the<br/>popover if it was previously force-opened. |
| `invokerNodeId`<br/>_optional_ | [BackendNodeId](#backendnodeid) | Optional ID of the element invoking this popover, used to establish the implicit anchor.<br/>If not provided, it will fall back to the first invoker in the document, preferring<br/>elements with a popovertarget attribute over those with a commandfor attribute. Note that<br/>if there are multiple invokers, this is just an estimate. |

* **Returns**:

| Name | Type | Description |
| --- | --- | --- |
| `nodeIds` | array of [NodeId](#nodeid) | List of popovers that were closed in order to respect popover stacking order. |


---

<a name="events"></a>
## Events

### <a name="attributemodified"></a>attributeModified

Fired when `Element`'s attribute is modified.

* **Parameters**:

| Name | Type | Description |
| --- | --- | --- |
| `nodeId` | [NodeId](#nodeid) | Id of the node that has changed. |
| `name` | `string` | Attribute name. |
| `value` | `string` | Attribute value. |


### <a name="adoptedstylesheetsmodified"></a>adoptedStyleSheetsModified `🧪 experimental`

Fired when `Element`'s adoptedStyleSheets are modified.

* **Parameters**:

| Name | Type | Description |
| --- | --- | --- |
| `nodeId` | [NodeId](#nodeid) | Id of the node that has changed. |
| `adoptedStyleSheets` | array of [StyleSheetId](#stylesheetid) | `🧪 experimental` New adoptedStyleSheets array. |


### <a name="attributeremoved"></a>attributeRemoved

Fired when `Element`'s attribute is removed.

* **Parameters**:

| Name | Type | Description |
| --- | --- | --- |
| `nodeId` | [NodeId](#nodeid) | Id of the node that has changed. |
| `name` | `string` | A ttribute name. |


### <a name="characterdatamodified"></a>characterDataModified

Mirrors `DOMCharacterDataModified` event.

* **Parameters**:

| Name | Type | Description |
| --- | --- | --- |
| `nodeId` | [NodeId](#nodeid) | Id of the node that has changed. |
| `characterData` | `string` | New text value. |


### <a name="childnodecountupdated"></a>childNodeCountUpdated

Fired when `Container`'s child node count has changed.

* **Parameters**:

| Name | Type | Description |
| --- | --- | --- |
| `nodeId` | [NodeId](#nodeid) | Id of the node that has changed. |
| `childNodeCount` | `integer` | New node count. |


### <a name="childnodeinserted"></a>childNodeInserted

Mirrors `DOMNodeInserted` event.

* **Parameters**:

| Name | Type | Description |
| --- | --- | --- |
| `parentNodeId` | [NodeId](#nodeid) | Id of the node that has changed. |
| `previousNodeId` | [NodeId](#nodeid) | Id of the previous sibling. |
| `node` | [Node](#node) | Inserted node data. |


### <a name="childnoderemoved"></a>childNodeRemoved

Mirrors `DOMNodeRemoved` event.

* **Parameters**:

| Name | Type | Description |
| --- | --- | --- |
| `parentNodeId` | [NodeId](#nodeid) | Parent id. |
| `nodeId` | [NodeId](#nodeid) | Id of the node that has been removed. |


### <a name="distributednodesupdated"></a>distributedNodesUpdated `🧪 experimental`

Called when distribution is changed.

* **Parameters**:

| Name | Type | Description |
| --- | --- | --- |
| `insertionPointId` | [NodeId](#nodeid) | Insertion point where distributed nodes were updated. |
| `distributedNodes` | array of [BackendNode](#backendnode) | Distributed nodes for given insertion point. |


### <a name="documentupdated"></a>documentUpdated

Fired when `Document` has been totally updated. Node ids are no longer valid.

* **Parameters**: None


### <a name="inlinestyleinvalidated"></a>inlineStyleInvalidated `🧪 experimental`

Fired when `Element`'s inline style is modified via a CSS property modification.

* **Parameters**:

| Name | Type | Description |
| --- | --- | --- |
| `nodeIds` | array of [NodeId](#nodeid) | Ids of the nodes for which the inline styles have been invalidated. |


### <a name="pseudoelementadded"></a>pseudoElementAdded `🧪 experimental`

Called when a pseudo element is added to an element.

* **Parameters**:

| Name | Type | Description |
| --- | --- | --- |
| `parentId` | [NodeId](#nodeid) | Pseudo element's parent element id. |
| `pseudoElement` | [Node](#node) | The added pseudo element. |


### <a name="toplayerelementsupdated"></a>topLayerElementsUpdated `🧪 experimental`

Called when top layer elements are changed.

* **Parameters**: None


### <a name="scrollableflagupdated"></a>scrollableFlagUpdated `🧪 experimental`

Fired when a node's scrollability state changes.

* **Parameters**:

| Name | Type | Description |
| --- | --- | --- |
| `nodeId` | [NodeId](#nodeid) | The id of the node. |
| `isScrollable` | `boolean` | If the node is scrollable. |


### <a name="adrelatedstateupdated"></a>adRelatedStateUpdated `🧪 experimental`

Fired when a node's ad related state changes.

* **Parameters**:

| Name | Type | Description |
| --- | --- | --- |
| `nodeId` | [NodeId](#nodeid) | The id of the node. |
| `adProvenance`<br/>_optional_ | [Network.AdProvenance](Network.md#adprovenance) | The provenance of the ad related node, if it is ad related. |


### <a name="affectedbystartingstylesflagupdated"></a>affectedByStartingStylesFlagUpdated `🧪 experimental`

Fired when a node's starting styles changes.

* **Parameters**:

| Name | Type | Description |
| --- | --- | --- |
| `nodeId` | [NodeId](#nodeid) | The id of the node. |
| `affectedByStartingStyles` | `boolean` | If the node has starting styles. |


### <a name="pseudoelementremoved"></a>pseudoElementRemoved `🧪 experimental`

Called when a pseudo element is removed from an element.

* **Parameters**:

| Name | Type | Description |
| --- | --- | --- |
| `parentId` | [NodeId](#nodeid) | Pseudo element's parent element id. |
| `pseudoElementId` | [NodeId](#nodeid) | The removed pseudo element id. |


### <a name="setchildnodes"></a>setChildNodes

Fired when backend wants to provide client with the missing DOM structure. This happens upon
most of the calls requesting node ids.

* **Parameters**:

| Name | Type | Description |
| --- | --- | --- |
| `parentId` | [NodeId](#nodeid) | Parent node id to populate with children. |
| `nodes` | array of [Node](#node) | Child nodes array. |


### <a name="shadowrootpopped"></a>shadowRootPopped `🧪 experimental`

Called when shadow root is popped from the element.

* **Parameters**:

| Name | Type | Description |
| --- | --- | --- |
| `hostId` | [NodeId](#nodeid) | Host element id. |
| `rootId` | [NodeId](#nodeid) | Shadow root id. |


### <a name="shadowrootpushed"></a>shadowRootPushed `🧪 experimental`

Called when shadow root is pushed into the element.

* **Parameters**:

| Name | Type | Description |
| --- | --- | --- |
| `hostId` | [NodeId](#nodeid) | Host element id. |
| `root` | [Node](#node) | Shadow root. |


