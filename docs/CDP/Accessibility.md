# Accessibility

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

### <a name="axnodeid"></a>AXNodeId

Unique accessibility node identifier.

* **Type**: `string`

### <a name="axvaluetype"></a>AXValueType

Enum of possible property types.

* **Type**: `string`
* **Allowed values**: `"boolean"`, `"tristate"`, `"booleanOrUndefined"`, `"idref"`, `"idrefList"`, `"integer"`, `"node"`, `"nodeList"`, `"number"`, `"string"`, `"computedString"`, `"token"`, `"tokenList"`, `"domRelation"`, `"role"`, `"internalRole"`, `"valueUndefined"`

### <a name="axvaluesourcetype"></a>AXValueSourceType

Enum of possible property sources.

* **Type**: `string`
* **Allowed values**: `"attribute"`, `"implicit"`, `"style"`, `"contents"`, `"placeholder"`, `"relatedElement"`

### <a name="axvaluenativesourcetype"></a>AXValueNativeSourceType

Enum of possible native property sources (as a subtype of a particular AXValueSourceType).

* **Type**: `string`
* **Allowed values**: `"description"`, `"figcaption"`, `"label"`, `"labelfor"`, `"labelwrapped"`, `"legend"`, `"rubyannotation"`, `"tablecaption"`, `"title"`, `"other"`

### <a name="axvaluesource"></a>AXValueSource

A single source for a computed AX property.

* **Type**: `object`
* **Properties**:

| Name | Type | Description |
| --- | --- | --- |
| `type` | [AXValueSourceType](#axvaluesourcetype) | What type of source this is. |
| `value`<br/>_optional_ | [AXValue](#axvalue) | The value of this property source. |
| `attribute`<br/>_optional_ | `string` | The name of the relevant attribute, if any. |
| `attributeValue`<br/>_optional_ | [AXValue](#axvalue) | The value of the relevant attribute, if any. |
| `superseded`<br/>_optional_ | `boolean` | Whether this source is superseded by a higher priority source. |
| `nativeSource`<br/>_optional_ | [AXValueNativeSourceType](#axvaluenativesourcetype) | The native markup source for this value, e.g. a `<label>` element. |
| `nativeSourceValue`<br/>_optional_ | [AXValue](#axvalue) | The value, such as a node or node list, of the native source. |
| `invalid`<br/>_optional_ | `boolean` | Whether the value for this property is invalid. |
| `invalidReason`<br/>_optional_ | `string` | Reason for the value being invalid, if it is. |


### <a name="axrelatednode"></a>AXRelatedNode

* **Type**: `object`
* **Properties**:

| Name | Type | Description |
| --- | --- | --- |
| `backendDOMNodeId` | [DOM.BackendNodeId](DOM.md#backendnodeid) | The BackendNodeId of the related DOM node. |
| `idref`<br/>_optional_ | `string` | The IDRef value provided, if any. |
| `text`<br/>_optional_ | `string` | The text alternative of this node in the current context. |


### <a name="axproperty"></a>AXProperty

* **Type**: `object`
* **Properties**:

| Name | Type | Description |
| --- | --- | --- |
| `name` | [AXPropertyName](#axpropertyname) | The name of this property. |
| `value` | [AXValue](#axvalue) | The value of this property. |


### <a name="axvalue"></a>AXValue

A single computed AX property.

* **Type**: `object`
* **Properties**:

| Name | Type | Description |
| --- | --- | --- |
| `type` | [AXValueType](#axvaluetype) | The type of this value. |
| `value`<br/>_optional_ | `any` | The computed value of this property. |
| `relatedNodes`<br/>_optional_ | array of [AXRelatedNode](#axrelatednode) | One or more related nodes, if applicable. |
| `sources`<br/>_optional_ | array of [AXValueSource](#axvaluesource) | The sources which contributed to the computation of this property. |


### <a name="axpropertyname"></a>AXPropertyName

Values of AXProperty name:
- from 'busy' to 'roledescription': states which apply to every AX node
- from 'live' to 'root': attributes which apply to nodes in live regions
- from 'autocomplete' to 'valuetext': attributes which apply to widgets
- from 'checked' to 'selected': states which apply to widgets
- from 'activedescendant' to 'owns': relationships between elements other than parent/child/sibling
- from 'activeFullscreenElement' to 'uninteresting': reasons why this noode is hidden

* **Type**: `string`
* **Allowed values**: `"actions"`, `"busy"`, `"disabled"`, `"editable"`, `"focusable"`, `"focused"`, `"hidden"`, `"hiddenRoot"`, `"invalid"`, `"keyshortcuts"`, `"settable"`, `"roledescription"`, `"live"`, `"atomic"`, `"relevant"`, `"root"`, `"autocomplete"`, `"hasPopup"`, `"level"`, `"multiselectable"`, `"orientation"`, `"multiline"`, `"readonly"`, `"required"`, `"valuemin"`, `"valuemax"`, `"valuetext"`, `"checked"`, `"expanded"`, `"modal"`, `"pressed"`, `"selected"`, `"activedescendant"`, `"controls"`, `"describedby"`, `"details"`, `"errormessage"`, `"flowto"`, `"labelledby"`, `"owns"`, `"url"`, `"activeFullscreenElement"`, `"activeModalDialog"`, `"activeAriaModalDialog"`, `"ariaHiddenElement"`, `"ariaHiddenSubtree"`, `"emptyAlt"`, `"emptyText"`, `"inertElement"`, `"inertSubtree"`, `"labelContainer"`, `"labelFor"`, `"notRendered"`, `"notVisible"`, `"presentationalRole"`, `"probablyPresentational"`, `"inactiveCarouselTabContent"`, `"uninteresting"`

### <a name="axnode"></a>AXNode

A node in the accessibility tree.

* **Type**: `object`
* **Properties**:

| Name | Type | Description |
| --- | --- | --- |
| `nodeId` | [AXNodeId](#axnodeid) | Unique identifier for this node. |
| `ignored` | `boolean` | Whether this node is ignored for accessibility |
| `ignoredReasons`<br/>_optional_ | array of [AXProperty](#axproperty) | Collection of reasons why this node is hidden. |
| `role`<br/>_optional_ | [AXValue](#axvalue) | This `Node`'s role, whether explicit or implicit. |
| `chromeRole`<br/>_optional_ | [AXValue](#axvalue) | This `Node`'s Chrome raw role. |
| `name`<br/>_optional_ | [AXValue](#axvalue) | The accessible name for this `Node`. |
| `description`<br/>_optional_ | [AXValue](#axvalue) | The accessible description for this `Node`. |
| `value`<br/>_optional_ | [AXValue](#axvalue) | The value for this `Node`. |
| `properties`<br/>_optional_ | array of [AXProperty](#axproperty) | All other properties |
| `parentId`<br/>_optional_ | [AXNodeId](#axnodeid) | ID for this node's parent. |
| `childIds`<br/>_optional_ | array of [AXNodeId](#axnodeid) | IDs for each of this node's child nodes. |
| `backendDOMNodeId`<br/>_optional_ | [DOM.BackendNodeId](DOM.md#backendnodeid) | The backend ID for the associated DOM node, if any. |
| `frameId`<br/>_optional_ | [Page.FrameId](Page.md#frameid) | The frame ID for the frame associated with this nodes document. |


---

<a name="commands"></a>
## Commands

### <a name="disable"></a>disable

Disables the accessibility domain.

* **Parameters**: None

* **Returns**: None


### <a name="enable"></a>enable

Enables the accessibility domain which causes `AXNodeId`s to remain consistent between method calls.
This turns on accessibility for the page, which can impact performance until accessibility is disabled.

* **Parameters**: None

* **Returns**: None


### <a name="getpartialaxtree"></a>getPartialAXTree `🧪 experimental`

Fetches the accessibility node and partial accessibility tree for this DOM node, if it exists.

* **Parameters**:

| Name | Type | Description |
| --- | --- | --- |
| `nodeId`<br/>_optional_ | [DOM.NodeId](DOM.md#nodeid) | Identifier of the node to get the partial accessibility tree for. |
| `backendNodeId`<br/>_optional_ | [DOM.BackendNodeId](DOM.md#backendnodeid) | Identifier of the backend node to get the partial accessibility tree for. |
| `objectId`<br/>_optional_ | [Runtime.RemoteObjectId](Runtime.md#remoteobjectid) | JavaScript object id of the node wrapper to get the partial accessibility tree for. |
| `fetchRelatives`<br/>_optional_ | `boolean` | Whether to fetch this node's ancestors, siblings and children. Defaults to true. |

* **Returns**:

| Name | Type | Description |
| --- | --- | --- |
| `nodes` | array of [AXNode](#axnode) | The `Accessibility.AXNode` for this DOM node, if it exists, plus its ancestors, siblings and<br/>children, if requested. |


### <a name="getfullaxtree"></a>getFullAXTree `🧪 experimental`

Fetches the entire accessibility tree for the root Document

* **Parameters**:

| Name | Type | Description |
| --- | --- | --- |
| `depth`<br/>_optional_ | `integer` | The maximum depth at which descendants of the root node should be retrieved.<br/>If omitted, the full tree is returned. |
| `frameId`<br/>_optional_ | [Page.FrameId](Page.md#frameid) | The frame for whose document the AX tree should be retrieved.<br/>If omitted, the root frame is used. |

* **Returns**:

| Name | Type | Description |
| --- | --- | --- |
| `nodes` | array of [AXNode](#axnode) |  |


### <a name="getrootaxnode"></a>getRootAXNode `🧪 experimental`

Fetches the root node.
Requires `enable()` to have been called previously.

* **Parameters**:

| Name | Type | Description |
| --- | --- | --- |
| `frameId`<br/>_optional_ | [Page.FrameId](Page.md#frameid) | The frame in whose document the node resides.<br/>If omitted, the root frame is used. |

* **Returns**:

| Name | Type | Description |
| --- | --- | --- |
| `node` | [AXNode](#axnode) |  |


### <a name="getaxnodeandancestors"></a>getAXNodeAndAncestors `🧪 experimental`

Fetches a node and all ancestors up to and including the root.
Requires `enable()` to have been called previously.

* **Parameters**:

| Name | Type | Description |
| --- | --- | --- |
| `nodeId`<br/>_optional_ | [DOM.NodeId](DOM.md#nodeid) | Identifier of the node to get. |
| `backendNodeId`<br/>_optional_ | [DOM.BackendNodeId](DOM.md#backendnodeid) | Identifier of the backend node to get. |
| `objectId`<br/>_optional_ | [Runtime.RemoteObjectId](Runtime.md#remoteobjectid) | JavaScript object id of the node wrapper to get. |

* **Returns**:

| Name | Type | Description |
| --- | --- | --- |
| `nodes` | array of [AXNode](#axnode) |  |


### <a name="getchildaxnodes"></a>getChildAXNodes `🧪 experimental`

Fetches a particular accessibility node by AXNodeId.
Requires `enable()` to have been called previously.

* **Parameters**:

| Name | Type | Description |
| --- | --- | --- |
| `id` | [AXNodeId](#axnodeid) |  |
| `frameId`<br/>_optional_ | [Page.FrameId](Page.md#frameid) | The frame in whose document the node resides.<br/>If omitted, the root frame is used. |

* **Returns**:

| Name | Type | Description |
| --- | --- | --- |
| `nodes` | array of [AXNode](#axnode) |  |


### <a name="queryaxtree"></a>queryAXTree `🧪 experimental`

Query a DOM node's accessibility subtree for accessible name and role.
This command computes the name and role for all nodes in the subtree, including those that are
ignored for accessibility, and returns those that match the specified name and role. If no DOM
node is specified, or the DOM node does not exist, the command returns an error. If neither
`accessibleName` or `role` is specified, it returns all the accessibility nodes in the subtree.

* **Parameters**:

| Name | Type | Description |
| --- | --- | --- |
| `nodeId`<br/>_optional_ | [DOM.NodeId](DOM.md#nodeid) | Identifier of the node for the root to query. |
| `backendNodeId`<br/>_optional_ | [DOM.BackendNodeId](DOM.md#backendnodeid) | Identifier of the backend node for the root to query. |
| `objectId`<br/>_optional_ | [Runtime.RemoteObjectId](Runtime.md#remoteobjectid) | JavaScript object id of the node wrapper for the root to query. |
| `accessibleName`<br/>_optional_ | `string` | Find nodes with this computed name. |
| `role`<br/>_optional_ | `string` | Find nodes with this computed role. |

* **Returns**:

| Name | Type | Description |
| --- | --- | --- |
| `nodes` | array of [AXNode](#axnode) | A list of `Accessibility.AXNode` matching the specified attributes,<br/>including nodes that are ignored for accessibility. |


---

<a name="events"></a>
## Events

### <a name="loadcomplete"></a>loadComplete `🧪 experimental`

The loadComplete event mirrors the load complete event sent by the browser to assistive
technology when the web page has finished loading.

* **Parameters**:

| Name | Type | Description |
| --- | --- | --- |
| `root` | [AXNode](#axnode) | New document root node. |


### <a name="nodesupdated"></a>nodesUpdated `🧪 experimental`

The nodesUpdated event is sent every time a previously requested node has changed the in tree.

* **Parameters**:

| Name | Type | Description |
| --- | --- | --- |
| `nodes` | array of [AXNode](#axnode) | Updated node data. |


